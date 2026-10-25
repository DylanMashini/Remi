import { describeTimes } from "@/lib/medication-text";
import { ensureDoses, todaysDoses } from "@/lib/medications";
import { prisma } from "@/lib/prisma";

/** Builds the context packet sent to Claude on every ask (see CONTRACT.md). */

const TIME_ZONE = process.env.APP_TIME_ZONE || "America/New_York";

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

/** Midnight today in TIME_ZONE, as a UTC Date. */
function startOfToday(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
  return new Date(now.getTime() - elapsed - now.getMilliseconds());
}

export async function buildContext(patientId: string): Promise<string> {
  const now = new Date();
  const today = startOfToday(now);
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [patient, roster, seen, utterances, upcoming, recent] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId }, select: { name: true } }),
    prisma.person.findMany({
      where: { patientId },
      select: {
        name: true,
        relationship: true,
        notes: true,
        memories: { orderBy: { createdAt: "desc" }, take: 3, select: { calloutText: true, useInCallout: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.event.findMany({
      where: { patientId, type: "RECOGNITION", createdAt: { gte: today } },
      select: { createdAt: true, person: { select: { name: true, relationship: true, notes: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.event.findMany({
      where: { patientId, type: "UTTERANCE", createdAt: { gte: tenMinAgo } },
      select: { createdAt: true, text: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reminder.findMany({
      where: { patientId, firedAt: null, dueAt: { lte: tomorrow } },
      select: { text: true, dueAt: true },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.reminder.findMany({
      where: { patientId, firedAt: { gte: threeHoursAgo } },
      select: { text: true, firedAt: true },
      orderBy: { firedAt: "desc" },
      take: 5,
    }),
  ]);

  const lines: string[] = [];
  lines.push(`Wearer: ${patient?.name ?? "the wearer"}. They live with memory loss and are wearing audio glasses.`);
  lines.push(`Current local time: ${fmtDateTime(now)}.`);
  lines.push(`Place: ${process.env.PLACE || "the ECoRE building at Penn State"}.`);

  lines.push("", "People the family enrolled (the only people you may name):");
  if (roster.length === 0) lines.push("- none yet");
  for (const p of roster) {
    lines.push(`- ${p.name}${p.relationship ? `, ${p.relationship}` : ""}${p.notes ? `. Note: ${p.notes}` : ""}`);
    for (const m of p.memories) lines.push(`  - What the wearer remembers about them: ${m.calloutText}`);
  }

  lines.push("", "People recognized today:");
  if (seen.length === 0) lines.push("- nobody yet");
  for (const e of seen) {
    if (!e.person) continue;
    lines.push(`- ${fmtTime(e.createdAt)}: ${e.person.name}${e.person.relationship ? ` (${e.person.relationship})` : ""}`);
  }

  lines.push("", "What was said nearby in the last 10 minutes (ambient transcript, may be imperfect):");
  if (utterances.length === 0) lines.push("- nothing recorded");
  for (const u of utterances) lines.push(`- ${fmtTime(u.createdAt)}: "${u.text}"`);

  lines.push("", "Upcoming reminders (next 24 hours):");
  if (upcoming.length === 0) lines.push("- none");
  for (const r of upcoming) lines.push(`- ${fmtTime(r.dueAt)}: ${r.text}`);

  lines.push("", "Reminders already given in the last 3 hours:");
  if (recent.length === 0) lines.push("- none");
  for (const r of recent) if (r.firedAt) lines.push(`- ${fmtTime(r.firedAt)}: ${r.text}`);

  // Medication: the schedule and how today went, so "did I take my pills?" has a true answer.
  await ensureDoses(patientId, now);
  const doses = await todaysDoses(patientId, now);
  const meds = new Map<string, { name: string; dose: string | null; times: string[] }>();
  for (const d of doses) meds.set(d.medication.id, { name: d.medication.name, dose: d.medication.dose, times: d.medication.times });
  lines.push("", "Medication (set by the family; if asked whether a dose was taken, answer from the status below and never guess):");
  if (meds.size === 0) lines.push("- none");
  for (const m of meds.values()) lines.push(`- ${m.name}${m.dose ? `, ${m.dose}` : ""}: ${describeTimes(m.times)}`);
  if (doses.length) {
    lines.push("Today's doses:");
    for (const d of doses) {
      const status =
        d.status === "taken"
          ? `taken (noted by family at ${fmtTime(d.reminder!.takenAt!)})`
          : d.status === "said"
            ? `reminder was spoken at ${fmtTime(d.reminder!.firedAt!)}, not yet marked taken`
            : d.status === "skipped"
              ? "skipped by the family"
              : d.status === "due"
                ? "due now"
                : d.status === "upcoming"
                  ? "coming up"
                  : "added after its time, not spoken today";
      lines.push(`- ${fmtTime(d.dueAt)} ${d.medication.name}: ${status}`);
    }
  }

  return lines.join("\n");
}
