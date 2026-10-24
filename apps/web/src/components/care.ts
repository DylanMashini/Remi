import { cache } from "react";
import { redirect } from "next/navigation";
import { AuthError, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Signed-in caregiver plus the patient's name, for server components and server actions.
 * Redirects to /login when there is no session. Deduped per request.
 */
export const getCare = cache(async () => {
  let ctx;
  try {
    ctx = await requireSession();
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }
  const patient = await prisma.patient.findUnique({
    where: { id: ctx.patientId },
    select: { name: true },
  });
  return { user: ctx.user, patientId: ctx.patientId, patientName: patient?.name ?? "Your person" };
});
