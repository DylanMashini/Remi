import { cookies } from "next/headers";
import { SESSION_COOKIE, deleteRequestSession } from "@/lib/auth";

export async function POST(req: Request) {
  await deleteRequestSession(req);
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
