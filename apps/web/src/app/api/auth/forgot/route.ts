import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/auth";
import { appUrl, sendResetEmail } from "@/lib/email";
import { RESET_TOKEN_MINUTES, createAuthToken, readJson, requestOrigin } from "../_shared";

/** Always 204, whether or not the account exists (no account enumeration). */
export async function POST(req: Request) {
  const body = await readJson(req);
  const email = normalizeEmail(body?.email);
  if (email) {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const token = await createAuthToken(user.id, "RESET", RESET_TOKEN_MINUTES * 60 * 1000);
        const link = `${appUrl(requestOrigin(req))}/reset?token=${encodeURIComponent(token)}`;
        await sendResetEmail(user.email, user.name, link);
      }
    } catch (error) {
      console.error("[auth/forgot] reset email failed:", error);
    }
  }
  return new Response(null, { status: 204 });
}
