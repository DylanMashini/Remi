import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  BCRYPT_COST,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  createSession,
  normalizeEmail,
  sessionCookieOptions,
  toPublicUser,
} from "@/lib/auth";
import { appUrl, sendVerifyEmail } from "@/lib/email";
import { Prisma, type UserRole } from "@/generated/prisma/client";
import { VERIFY_TOKEN_HOURS, createAuthToken, jsonError, readJson, requestOrigin, str } from "../_shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Send a JSON body.", 400);

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const name = str(body.name);
  // "wearer" = setting Remi up for themselves (they are the patient); default is a caregiver.
  const role: UserRole = str(body.role).toLowerCase() === "wearer" ? "WEARER" : "CAREGIVER";
  const patientName = role === "WEARER" ? str(body.patientName) || name : str(body.patientName);

  if (!EMAIL_RE.test(email)) return jsonError("Enter a valid email address.", 400);
  if (password.length < MIN_PASSWORD_LENGTH) return jsonError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  if (!name) return jsonError("Enter your name.", 400);
  if (!patientName) return jsonError("Enter the name of the person you care for.", 400);


  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return jsonError("An account with this email already exists.", 409);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({ data: { name: patientName } });
      return tx.user.create({ data: { email, passwordHash, name, role, patientId: patient.id } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("An account with this email already exists.", 409);
    }
    throw error;
  }

  // Same as login: `?client=device` returns a bearer token for the phone instead of a cookie.
  const device = new URL(req.url).searchParams.get("client") === "device";
  const { token, expiresAt } = await createSession(user.id, device ? "DEVICE" : "WEB");
  if (!device) (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt, req));

  // Email failure must never fail signup.
  try {
    const verifyToken = await createAuthToken(user.id, "VERIFY", VERIFY_TOKEN_HOURS * 60 * 60 * 1000);
    const link = `${appUrl(requestOrigin(req))}/api/auth/verify?token=${encodeURIComponent(verifyToken)}`;
    await sendVerifyEmail(user.email, user.name, link);
  } catch (error) {
    console.error("[auth/signup] verify email failed:", error);
  }

  return Response.json(device ? { user: toPublicUser(user), token } : { user: toPublicUser(user) }, { status: 201 });
}
