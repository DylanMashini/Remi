import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH, SESSION_COOKIE, createSession, normalizeEmail, sessionCookieOptions, toPublicUser } from "@/lib/auth";
import { findInvite } from "@/lib/invites";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";
import { Prisma } from "@/generated/prisma/client";
import { jsonError, readJson, str } from "../_shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accepts a family invite: creates a caregiver login on the inviting account's patient and
 * signs the new user in. One invite, one account.
 */
export async function POST(req: Request) {
  const wait = rateLimit(`join:${clientIp(req)}`, 10, 10 * 60_000);
  if (wait) return tooMany(wait);
  const body = await readJson(req);
  if (!body) return jsonError("Send a JSON body.", 400);

  const token = str(body.token);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const name = str(body.name);
  if (!EMAIL_RE.test(email)) return jsonError("Enter a valid email address.", 400);
  if (password.length < MIN_PASSWORD_LENGTH) return jsonError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  if (!name) return jsonError("Enter your name.", 400);

  const invite = await findInvite(token);
  if (!invite) return jsonError("This invite link has expired or was already used. Ask for a new one.", 410);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return jsonError("An account with this email already exists. Sign in instead.", 409);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date(), usedByEmail: email } });
      if (claimed.count !== 1) throw new Error("used");
      return tx.user.create({
        data: { email, passwordHash, name, role: "CAREGIVER", patientId: invite.patientId, emailVerifiedAt: new Date() },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "used") return jsonError("This invite link was just used. Ask for a new one.", 410);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return jsonError("An account with this email already exists.", 409);
    throw error;
  }

  const { token: session, expiresAt } = await createSession(user.id, "WEB");
  (await cookies()).set(SESSION_COOKIE, session, sessionCookieOptions(expiresAt, req));
  return Response.json({ user: toPublicUser(user) }, { status: 201 });
}
