import { prisma } from "@/lib/prisma";
import { requireSession, toPublicUser, unauthorized } from "@/lib/auth";

/** GET /api/auth/me -> {user, patient: {id, name}} or 401. Lets the phone and web check a session. */
export async function GET(req: Request) {
  try {
    const { user, patientId } = await requireSession(req);
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, name: true } });
    return Response.json({ user: toPublicUser(user), patient });
  } catch (error) {
    return unauthorized(error);
  }
}
