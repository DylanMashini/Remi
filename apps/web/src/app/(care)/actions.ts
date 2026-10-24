"use server";

import { refresh } from "next/cache";
import { getCare } from "@/components/care";
import { invalidateRoster } from "@/lib/match";
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

/** Renames the person the glasses speak to. Used by Settings. */
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

/** Edits what the glasses say for one person: name, relationship, note. */
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
  invalidateRoster(patientId);
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
  invalidateRoster(patientId);
  refresh();
  return { ok: true };
}

export async function setMemorySpoken(memoryId: string, useInCallout: boolean) {
  const { patientId } = await getCare();
  await prisma.memory.updateMany({ where: { id: memoryId, patientId }, data: { useInCallout } });
  invalidateRoster(patientId);
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
  invalidateRoster(patientId);
  refresh();
  return { ok: true };
}

export async function deleteMemory(memoryId: string) {
  const { patientId } = await getCare();
  await prisma.memory.deleteMany({ where: { id: memoryId, patientId } });
  invalidateRoster(patientId);
  refresh();
}
