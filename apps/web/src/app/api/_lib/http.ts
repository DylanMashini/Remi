import { unstable_rethrow } from "next/navigation";
import { AuthError } from "@/lib/auth";

/** Throw from route code to return `{ error }` with a specific status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Errors from upstream services (ElevenLabs, Claude) carry a status too. */
type StatusError = Error & { status?: number; extra?: Record<string, unknown> };

/** Converts any thrown value into a JSON error response. Logs unexpected errors. */
export function errorResponse(error: unknown): Response {
  // Let Next's internal signals (prerender bail-out on request.headers, redirects) propagate.
  unstable_rethrow(error);
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, ...error.extra }, { status: error.status });
  }
  const e = error as StatusError;
  if (e && typeof e.status === "number" && e.status >= 400 && e.status < 600 && e.message) {
    console.error(`[api] ${e.name}: ${e.message}`);
    return Response.json({ error: e.message, ...e.extra }, { status: e.status });
  }
  console.error("[api] unexpected error", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}

export async function readBytes(req: Request, what: string): Promise<Buffer> {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) throw new HttpError(400, `Empty body: expected ${what}`);
  return buf;
}
