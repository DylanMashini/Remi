import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { requestOrigin } from "../_shared";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = requestOrigin(req);
  const token = url.searchParams.get("token")?.trim();
  const now = new Date();

  if (token) {
    const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (row && row.purpose === "VERIFY" && !row.usedAt && row.expiresAt > now) {
      await prisma.$transaction([
        prisma.authToken.update({ where: { id: row.id }, data: { usedAt: now } }),
        prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } }),
      ]);
      return Response.redirect(new URL("/?verified=1", origin), 303);
    }
  }
  return Response.redirect(new URL("/?verified=0", origin), 303);
}
