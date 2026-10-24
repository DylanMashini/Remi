import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { SessionKind, User } from "@/generated/prisma/client";

export const SESSION_COOKIE = "recall_session";
const WEB_SESSION_DAYS = 30;
const DEVICE_SESSION_DAYS = 90;

export type AuthContext = { user: User; patientId: string };

export class AuthError extends Error {
  status = 401;
  constructor(message = "Not signed in") {
    super(message);
  }
}

/** Random URL-safe token. Only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session row and returns the raw token (cookie value or bearer token). */
export async function createSession(userId: string, kind: SessionKind): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const days = kind === "DEVICE" ? DEVICE_SESSION_DAYS : WEB_SESSION_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, kind, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

async function sessionFromToken(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return { user: session.user, patientId: session.user.patientId };
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice(7).trim();
}

/**
 * Resolves the signed-in caregiver from a bearer token (phone) or the session cookie (web).
 * Pass the request in route handlers; omit it in server components and server actions.
 * Throws AuthError when there is no valid session.
 */
export async function requireSession(req?: Request): Promise<AuthContext> {
  const fromBearer = req ? await sessionFromToken(bearerToken(req)) : null;
  if (fromBearer) return fromBearer;
  const cookieStore = await cookies();
  const fromCookie = await sessionFromToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  throw new AuthError();
}

/** Same as requireSession but returns null instead of throwing. */
export async function getSession(req?: Request): Promise<AuthContext | null> {
  try {
    return await requireSession(req);
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}

/** Wraps a route handler so AuthError becomes a JSON 401. */
export function unauthorized(error: unknown): Response {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: 401 });
  throw error;
}

// ---- Helpers for /api/auth/* (added by the auth slice; existing exports above are unchanged) ----

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

export type PublicUser = Pick<User, "id" | "email" | "name" | "patientId" | "emailVerifiedAt" | "createdAt">;

/** The only user shape that may leave the server. Never includes passwordHash. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    patientId: user.patientId,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * Cookie options for the web session cookie. Secure only in production AND over HTTPS:
 * the demo runs `next start` (production) over plain http on the hotspot LAN IP, where a
 * Secure cookie would be silently dropped by the browser.
 */
export function sessionCookieOptions(expiresAt: Date, req?: Request) {
  const proto = req?.headers.get("x-forwarded-proto") ?? (req ? new URL(req.url).protocol.replace(":", "") : "https");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && proto === "https",
    path: "/",
    expires: expiresAt,
  };
}

/** Deletes the session identified by the request's bearer token and/or session cookie. */
export async function deleteRequestSession(req: Request): Promise<void> {
  const cookieStore = await cookies();
  const tokens = [bearerToken(req), cookieStore.get(SESSION_COOKIE)?.value].filter((t): t is string => !!t);
  if (tokens.length === 0) return;
  await prisma.session.deleteMany({ where: { tokenHash: { in: tokens.map(hashToken) } } });
}
