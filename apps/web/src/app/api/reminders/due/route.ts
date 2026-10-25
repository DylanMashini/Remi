import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { ensureDoses } from "@/lib/medications";
import { speechIdFor, withoutAudioTags } from "@/lib/tts";
import { errorResponse } from "../../_lib/http";

/** Phone polls every 15 s. Returns due reminders once each and marks them fired. */
export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const now = new Date();
    // Medication doses become reminder rows here, so the phone needs nothing new.
    await ensureDoses(patientId, now);
    const due = await prisma.reminder.findMany({
      where: { patientId, firedAt: null, dueAt: { lte: now } },
      orderBy: { dueAt: "asc" },
    });
    const reminders: { id: string; text: string; speechId: string }[] = [];
    for (const r of due) {
      // Claim atomically so two concurrent polls never fire the same reminder twice.
      const claimed = await prisma.reminder.updateMany({ where: { id: r.id, firedAt: null }, data: { firedAt: now } });
      if (claimed.count !== 1) continue;
      const speechId = speechIdFor(r.text);
      const text = withoutAudioTags(r.text);
      const medication = r.medicationId ? { medicationId: r.medicationId } : {};
      await logEvent(patientId, "REMINDER", text, { data: { reminderId: r.id, dueAt: r.dueAt.toISOString(), speechId, ...medication } });
      await logEvent(patientId, "SPOKEN", text, { data: { speechId, source: "reminder", reminderId: r.id, ...medication } });
      reminders.push({ id: r.id, text, speechId });
    }
    return Response.json({ reminders });
  } catch (error) {
    return errorResponse(error);
  }
}
