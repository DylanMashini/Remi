import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH, SESSION_COOKIE, hashToken } from "@/lib/auth";
import { jsonError, readJson, str } from "../_shared";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Send a JSON body.", 400);
  const token = str(body.token);
  const password = typeof body.password === "string" ? body.password : "";
  if (!token) return jsonError("This reset link is missing its token.", 400);
  if (password.length < MIN_PASSWORD_LENGTH) return jsonError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const tokenHash = hashToken(token);
  const now = new Date();

  const ok = await prisma.$transaction(async (tx) => {
    // Claim the token atomically so it can only ever be used once.
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash, purpose: "RESET", usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;
    const row = await tx.authToken.findUniqueOrThrow({ where: { tokenHash } });
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: row.userId } });
    // Any other outstanding reset links for this user stop working too.
    await tx.authToken.updateMany({ where: { userId: row.userId, purpose: "RESET", usedAt: null }, data: { usedAt: now } });
    return true;
  });

  if (!ok) return jsonError("This reset link has expired or was already used. Ask for a new one.", 400);
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
