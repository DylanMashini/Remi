import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { speechIdFor } from "@/lib/tts";
import { errorResponse } from "../../_lib/http";

/** Phone polls every 15 s. Returns due reminders once each and marks them fired. */
export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const now = new Date();
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
      await logEvent(patientId, "REMINDER", r.text, { data: { reminderId: r.id, dueAt: r.dueAt.toISOString(), speechId } });
      await logEvent(patientId, "SPOKEN", r.text, { data: { speechId, source: "reminder", reminderId: r.id } });
      reminders.push({ id: r.id, text: r.text, speechId });
    }
    return Response.json({ reminders });
  } catch (error) {
    return errorResponse(error);
  }
}
