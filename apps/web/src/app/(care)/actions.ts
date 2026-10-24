"use server";

import { refresh } from "next/cache";
import { getCare } from "@/components/care";
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
  if (!text) return { error: `Write what ${patientName} should hear.` };
  if (text.length > 200) return { error: "Keep it short. One sentence works best." };
  if (!dueRaw) return { error: "Pick a time." };
  let dueAt = new Date(dueRaw);
  if (offset && /^-?\d+$/.test(offset) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueRaw)) {
    // getTimezoneOffset() minutes: UTC = local + offset.
    dueAt = new Date(Date.parse(`${dueRaw}:00Z`) + Number(offset) * 60_000);
  }
  if (Number.isNaN(dueAt.getTime())) return { error: "That time did not look right. Try again." };
  await prisma.reminder.create({ data: { patientId, text, dueAt, createdById: user.id } });
  refresh();
  return { ok: true };
}

export async function deleteReminder(reminderId: string) {
  const { patientId } = await getCare();
  await prisma.reminder.deleteMany({ where: { id: reminderId, patientId } });
  refresh();
}
