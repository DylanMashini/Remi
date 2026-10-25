import { hashToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const INVITE_DAYS = 7;

/** Looks up a live (unused, unexpired) invite by its raw token. */
export async function findInvite(token: string) {
  if (!token) return null;
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { patient: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
  });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return null;
  return invite;
}
