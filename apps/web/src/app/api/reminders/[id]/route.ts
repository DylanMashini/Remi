import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { errorResponse, HttpError } from "../../_lib/http";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const { count } = await prisma.reminder.deleteMany({ where: { id, patientId } });
    if (count === 0) throw new HttpError(404, "Reminder not found");
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
