import { prisma } from "@/lib/prisma";
import { hashToken, newToken } from "@/lib/auth";
import type { AuthTokenPurpose } from "@/generated/prisma/client";

export const VERIFY_TOKEN_HOURS = 48;
export const RESET_TOKEN_MINUTES = 30;

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/** Parses a JSON object body; returns null when the body is missing or not an object. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Creates a one-time email token and returns the raw value (only the hash is stored). */
export async function createAuthToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<string> {
  const token = newToken();
  await prisma.authToken.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

/**
 * The origin the client actually used. `req.url` reflects the bind address (0.0.0.0 under
 * `next start -H 0.0.0.0`), which is useless in links and redirects, so prefer the Host header.
 */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
