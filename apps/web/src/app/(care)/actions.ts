"use server";

import bcrypt from "bcryptjs";
import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { getCare } from "@/components/care";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH, SESSION_COOKIE, hashToken, newToken } from "@/lib/auth";
import { appUrl } from "@/lib/email";
import { INVITE_DAYS } from "@/lib/invites";
import { dropFutureDoses, ensureDoses, isClockTime } from "@/lib/medications";
import { cleanCallout, cleanMemoryText, distill } from "@/lib/memories";
import { prisma } from "@/lib/prisma";

export async function deleteEvent(eventId: string) {
  const { patientId } = await getCare();
  await prisma.event.deleteMany({ where: { id: eventId, patientId } });
  refresh();
}

export type ReminderFormState = { error?: string; ok?: boolean };

export async function addReminder(_prev: ReminderFormState, formData: FormData): Promise<ReminderFormState> {
  const { patientId, user, patientName } = await getCare();
  const text = String(formData.get("text") ?? "").trim();
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  // Browsers send datetime-local in the caregiver's local time; the client adds the UTC offset.
  const offset = String(formData.get("tzOffset") ?? "").trim();
  // Quick presets ("in 10 minutes") send an ISO instant instead.
  const dueIso = String(formData.get("dueAtIso") ?? "").trim();
  if (!text) return { error: `Write what ${patientName} should hear.` };
  if (text.length > 200) return { error: "Keep it short. One sentence works best." };
  if (!dueRaw && !dueIso) return { error: "Pick a time." };
  let dueAt = dueIso ? new Date(dueIso) : new Date(dueRaw);
  if (!dueIso && offset && /^-?\d+$/.test(offset) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueRaw)) {
    // getTimezoneOffset() minutes: UTC = local + offset.
    dueAt = new Date(Date.parse(`${dueRaw}:00Z`) + Number(offset) * 60_000);
  }
  if (Number.isNaN(dueAt.getTime())) return { error: "That time did not look right. Try again." };
  if (dueAt.getTime() < Date.now() - 60_000) return { error: "That time has already passed. Pick a later one." };
  await prisma.reminder.create({ data: { patientId, text, dueAt, createdById: user.id } });
  refresh();
  return { ok: true };
}

/** Renames the person Remi speaks to. Used by Settings. */
export async function updatePatientName(_prev: FormState, formData: FormData): Promise<FormState> {
  const { patientId } = await getCare();
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { error: "A name is needed." };
  if (name.length > 100) return { error: "Keep the name short." };
  await prisma.patient.update({ where: { id: patientId }, data: { name } });
  refresh();
  return { ok: true };
}

/** Renames the signed-in account. Used by Settings. */
export async function updateAccountName(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user } = await getCare();
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { error: "A name is needed." };
  if (name.length > 100) return { error: "Keep the name short." };
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  refresh();
  return { ok: true };
}

/** Deletes every moment in the log for this patient. Reminders, people and memories stay. */
export async function clearAllEvents() {
  const { patientId } = await getCare();
  await prisma.event.deleteMany({ where: { patientId } });
  refresh();
}

export async function deleteReminder(reminderId: string) {
  const { patientId } = await getCare();
  await prisma.reminder.deleteMany({ where: { id: reminderId, patientId } });
  refresh();
}

export type FormState = { error?: string; ok?: boolean };

/** Edits what Remi says for one person: name, relationship, note. */
export async function updateCallout(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { patientId } = await getCare();
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  const relationship = String(formData.get("relationship") ?? "").replace(/\s+/g, " ").trim();
  const notes = String(formData.get("notes") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { error: "A name is needed." };
  if (name.length > 100 || relationship.length > 100) return { error: "Keep the name and relationship short." };
  if (notes.length > 500) return { error: "Keep the note to a sentence or two." };
  const { count } = await prisma.person.updateMany({
    where: { id: personId, patientId },
    data: { name, relationship: relationship || null, notes: notes || null },
  });
  if (count === 0) return { error: "This person is no longer in the roster." };
  refresh();
  return { ok: true };
}

/** Caregiver adds a memory in their own words; it is distilled into the spoken sentence. */
export async function addMemory(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { patientId, user } = await getCare();
  const text = cleanMemoryText(formData.get("text"));
  if (!text) return { error: "Write the memory first." };
  const person = await prisma.person.findFirst({ where: { id: personId, patientId }, select: { id: true, name: true, relationship: true } });
  if (!person) return { error: "This person is no longer in the roster." };
  const { callout, usable } = await distill(text, person);
  await prisma.memory.create({
    data: { patientId, personId: person.id, text, calloutText: callout, useInCallout: usable, source: "CAREGIVER", createdById: user.id },
  });
  refresh();
  return { ok: true };
}

export async function setMemorySpoken(memoryId: string, useInCallout: boolean) {
  const { patientId } = await getCare();
  await prisma.memory.updateMany({ where: { id: memoryId, patientId }, data: { useInCallout } });
  refresh();
}

export async function updateMemoryCallout(memoryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { patientId } = await getCare();
  const callout = cleanCallout(formData.get("calloutText"));
  if (!callout) return { error: "The spoken sentence cannot be empty." };
  await prisma.memory.updateMany({
    where: { id: memoryId, patientId },
    data: { calloutText: /[.!?]$/.test(callout) ? callout : `${callout}.` },
  });
  refresh();
  return { ok: true };
}

export async function deleteMemory(memoryId: string) {
  const { patientId } = await getCare();
  await prisma.memory.deleteMany({ where: { id: memoryId, patientId } });
  refresh();
}

// ---------- Account ----------

/** Changes the signed-in user's password after checking the current one; other sign-ins end. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user } = await getCare();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!current) return { error: "Enter your current password." };
  if (next.length < MIN_PASSWORD_LENGTH) return { error: `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (next !== confirm) return { error: "The two new passwords do not match." };
  if (!(await bcrypt.compare(current, user.passwordHash))) return { error: "That is not your current password." };
  const passwordHash = await bcrypt.hash(next, BCRYPT_COST);
  const mine = (await cookies()).get(SESSION_COOKIE)?.value;
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id, ...(mine ? { tokenHash: { not: hashToken(mine) } } : {}) } }),
  ]);
  refresh();
  return { ok: true };
}

export type InviteState = { error?: string; url?: string };

/** Mints a one-week invite link that lets another family member join this account. */
export async function createInvite(): Promise<InviteState> {
  const { patientId, user } = await getCare();
  const token = newToken();
  await prisma.invite.create({
    data: { patientId, createdById: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000) },
  });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https");
  refresh();
  return { url: `${appUrl(`${proto}://${host}`)}/join?token=${encodeURIComponent(token)}` };
}

export async function revokeInvite(inviteId: string) {
  const { patientId } = await getCare();
  await prisma.invite.deleteMany({ where: { id: inviteId, patientId, usedAt: null } });
  refresh();
}

/** Removes another family member's login from this account (never your own). */
export async function removeFamilyMember(userId: string) {
  const { patientId, user } = await getCare();
  if (userId === user.id) return;
  await prisma.user.deleteMany({ where: { id: userId, patientId } });
  refresh();
}

// ---------- Medication ----------

function readMedication(formData: FormData): { error?: string; name: string; dose: string | null; instructions: string | null; times: string[] } {
  const clean = (k: string) => String(formData.get(k) ?? "").replace(/\s+/g, " ").trim();
  const name = clean("name");
  const dose = clean("dose");
  const instructions = clean("instructions");
  const times = [...new Set(formData.getAll("times").map(String).filter(isClockTime))].sort();
  if (!name) return { error: "What is the medication called?", name, dose, instructions, times };
  if (name.length > 80 || dose.length > 80) return { error: "Keep the name and dose short.", name, dose, instructions, times };
  if (instructions.length > 200) return { error: "Keep the instructions to one sentence.", name, dose, instructions, times };
  if (times.length === 0) return { error: "Pick at least one time of day.", name, dose, instructions, times };
  if (times.length > 6) return { error: "Six times a day is the most Remi will say.", name, dose, instructions, times };
  return { name, dose: dose || null, instructions: instructions || null, times };
}

export async function addMedication(_prev: FormState, formData: FormData): Promise<FormState> {
  const { patientId, user } = await getCare();
  const m = readMedication(formData);
  if (m.error) return { error: m.error };
  await prisma.medication.create({
    data: { patientId, name: m.name, dose: m.dose, instructions: m.instructions, times: m.times, createdById: user.id },
  });
  await ensureDoses(patientId);
  refresh();
  return { ok: true };
}

export async function updateMedication(medicationId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { patientId } = await getCare();
  const m = readMedication(formData);
  if (m.error) return { error: m.error };
  const { count } = await prisma.medication.updateMany({
    where: { id: medicationId, patientId },
    data: { name: m.name, dose: m.dose, instructions: m.instructions, times: m.times },
  });
  if (count === 0) return { error: "This medication was removed." };
  await dropFutureDoses(medicationId);
  await ensureDoses(patientId);
  refresh();
  return { ok: true };
}

/** Pausing keeps the medication on the list but Remi stops saying its doses. */
export async function setMedicationActive(medicationId: string, active: boolean) {
  const { patientId } = await getCare();
  await prisma.medication.updateMany({ where: { id: medicationId, patientId }, data: { active } });
  await dropFutureDoses(medicationId);
  if (active) await ensureDoses(patientId);
  refresh();
}

export async function deleteMedication(medicationId: string) {
  const { patientId } = await getCare();
  await prisma.medication.deleteMany({ where: { id: medicationId, patientId } });
  refresh();
}

/** A caregiver notes that a dose was taken (or undoes that). */
export async function setDoseTaken(reminderId: string, taken: boolean) {
  const { patientId } = await getCare();
  await prisma.reminder.updateMany({
    where: { id: reminderId, patientId, medicationId: { not: null } },
    data: taken ? { takenAt: new Date(), skippedAt: null } : { takenAt: null },
  });
  refresh();
}

/** Skip one dose: it is marked fired so the phone never speaks it, and shown as skipped. */
export async function skipDose(reminderId: string) {
  const { patientId } = await getCare();
  const now = new Date();
  await prisma.reminder.updateMany({
    where: { id: reminderId, patientId, medicationId: { not: null }, firedAt: null },
    data: { firedAt: now, skippedAt: now },
  });
  refresh();
}
