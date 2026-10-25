import { prisma } from "@/lib/prisma";
import type { Medication, Reminder } from "@/generated/prisma/client";

/**
 * Medication doses ride the reminder pipeline. Each active medication has local clock times
 * ("08:00"); `ensureDoses` turns the ones still ahead today and tomorrow into Reminder rows
 * (unique on medicationId + dueAt, so calling it often is harmless). The phone keeps polling
 * `/api/reminders/due` exactly as before and speaks each dose once.
 */

export const TIME_ZONE = process.env.APP_TIME_ZONE || "America/New_York";

export { DOSE_PRESETS, DOSE_STATUS_LABEL, describeTimes, formatClockTime, isClockTime, medicationLine, type DoseStatus } from "@/lib/medication-text";
import { isClockTime, medicationLine, type DoseStatus } from "@/lib/medication-text";

// ---------- time zone helpers (no dependency; two-pass offset correction handles DST days) ----------

function zoneParts(d: Date): { y: number; m: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

/** Minutes the zone is ahead of UTC at instant `d`. */
function zoneOffsetMinutes(d: Date): number {
  const p = zoneParts(d);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** "2026-10-25" for an instant, in the app zone. */
export function localDayKey(d: Date): string {
  const p = zoneParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The instant at local `time` ("08:00") on local day `dayKey` ("2026-10-25"). */
export function instantAt(dayKey: string, time: string): Date {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let guess = new Date(naive - zoneOffsetMinutes(new Date(naive)) * 60_000);
  // Second pass for the hour around a DST switch.
  guess = new Date(naive - zoneOffsetMinutes(guess) * 60_000);
  return guess;
}

/** Day key for `days` after the local day of `d`. */
export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

// ---------- materialization ----------

const GRACE_MS = 2 * 60_000;

/**
 * Creates Reminder rows for every dose of every active medication that is still ahead (today
 * and tomorrow, local). Doses whose time already passed when the medication was added are not
 * created, so Remi never says "time for your morning pills" at three in the afternoon.
 */
export async function ensureDoses(patientId: string, now = new Date()): Promise<void> {
  const meds = await prisma.medication.findMany({ where: { patientId, active: true } });
  if (meds.length === 0) return;
  const today = localDayKey(now);
  const days = [today, addDays(today, 1)];
  const rows: { patientId: string; medicationId: string; text: string; dueAt: Date; createdById: string | null }[] = [];
  for (const med of meds) {
    const text = medicationLine(med);
    for (const day of days) {
      for (const time of med.times) {
        if (!isClockTime(time)) continue;
        const dueAt = instantAt(day, time);
        if (dueAt.getTime() < now.getTime() - GRACE_MS) continue;
        rows.push({ patientId, medicationId: med.id, text, dueAt, createdById: med.createdById });
      }
    }
  }
  if (rows.length) await prisma.reminder.createMany({ data: rows, skipDuplicates: true });
}

/** Drops this medication's future, unspoken doses (after an edit, pause, or delete) so they are rebuilt from the new times. */
export async function dropFutureDoses(medicationId: string): Promise<void> {
  await prisma.reminder.deleteMany({ where: { medicationId, firedAt: null } });
}

// ---------- today's schedule for the dashboard ----------

export type Dose = {
  key: string;
  medication: Medication;
  time: string;
  dueAt: Date;
  reminder: Reminder | null;
  status: DoseStatus;
};

/**
 * Every dose that belongs to local today, in time order, joined with the reminder row that
 * represents it (if any). A dose with no row is one whose time had already passed when the
 * medication was added; it is shown, not spoken.
 */
export async function todaysDoses(patientId: string, now = new Date()): Promise<Dose[]> {
  const today = localDayKey(now);
  const start = instantAt(today, "00:00");
  const end = instantAt(addDays(today, 1), "00:00");
  const [meds, reminders] = await Promise.all([
    prisma.medication.findMany({ where: { patientId }, orderBy: { createdAt: "asc" } }),
    prisma.reminder.findMany({ where: { patientId, medicationId: { not: null }, dueAt: { gte: start, lt: end } } }),
  ]);
  const byKey = new Map(reminders.map((r) => [`${r.medicationId}:${r.dueAt.getTime()}`, r]));
  const doses: Dose[] = [];
  for (const med of meds) {
    if (!med.active) continue;
    for (const time of med.times) {
      if (!isClockTime(time)) continue;
      const dueAt = instantAt(today, time);
      const reminder = byKey.get(`${med.id}:${dueAt.getTime()}`) ?? null;
      doses.push({ key: `${med.id}:${time}`, medication: med, time, dueAt, reminder, status: statusOf(reminder, dueAt, now) });
    }
  }
  return doses.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

function statusOf(r: Reminder | null, dueAt: Date, now: Date): DoseStatus {
  if (r?.takenAt) return "taken";
  if (r?.skippedAt) return "skipped";
  if (r?.firedAt) return "said";
  if (!r) return dueAt.getTime() < now.getTime() - GRACE_MS ? "missed-setup" : "upcoming";
  return dueAt.getTime() <= now.getTime() ? "due" : "upcoming";
}
