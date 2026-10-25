import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, createSession, normalizeEmail, sessionCookieOptions, toPublicUser } from "@/lib/auth";
import { clientIp, rateLimit, tooMany } from "@/lib/ratelimit";
import { jsonError, readJson } from "../_shared";

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcryptDummy();
function bcryptDummy(): string {
  return bcrypt.hashSync("recall-dummy-password", 12);
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Send a JSON body.", 400);

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return jsonError("Enter your email and password.", 400);

  // 20 attempts per 10 minutes per address, 10 per account: slows guessing, never locks a family out for long.
  const wait = Math.max(rateLimit(`login:${clientIp(req)}`, 20, 10 * 60_000), rateLimit(`login:${email}`, 10, 10 * 60_000));
  if (wait) return tooMany(wait);

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return jsonError("That email and password do not match.", 401);

  const device = new URL(req.url).searchParams.get("client") === "device";
  const { token, expiresAt } = await createSession(user.id, device ? "DEVICE" : "WEB");

  if (device) return Response.json({ user: toPublicUser(user), token });

  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt, req));
  return Response.json({ user: toPublicUser(user) });
}
