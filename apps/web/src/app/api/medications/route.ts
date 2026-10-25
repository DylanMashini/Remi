import { requireSession } from "@/lib/auth";
import { ensureDoses, todaysDoses } from "@/lib/medications";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "../_lib/http";

/**
 * Read-only view of the medication schedule for the phone or another family screen:
 * the list, and today's doses with their status. Doses are spoken through
 * `/api/reminders/due` like any other reminder; nothing here changes what is said.
 */
export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const now = new Date();
    await ensureDoses(patientId, now);
    const [medications, doses] = await Promise.all([
      prisma.medication.findMany({ where: { patientId }, orderBy: { createdAt: "asc" } }),
      todaysDoses(patientId, now),
    ]);
    return Response.json({
      medications: medications.map((m) => ({
        id: m.id,
        name: m.name,
        dose: m.dose,
        instructions: m.instructions,
        times: m.times,
        active: m.active,
        createdAt: m.createdAt.toISOString(),
      })),
      today: doses.map((d) => ({
        medicationId: d.medication.id,
        reminderId: d.reminder?.id ?? null,
        name: d.medication.name,
        dose: d.medication.dose,
        time: d.time,
        dueAt: d.dueAt.toISOString(),
        status: d.status,
        firedAt: d.reminder?.firedAt?.toISOString() ?? null,
        takenAt: d.reminder?.takenAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
