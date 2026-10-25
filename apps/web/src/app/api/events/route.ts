import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { eventInclude, serializeEvent } from "@/lib/events";
import { EventType } from "@/generated/prisma/client";
import { errorResponse, HttpError } from "../_lib/http";

/** Parse `?types=RECOGNITION,UNKNOWN`; unknown names are ignored. Empty/absent means no filter. */
function parseTypes(raw: string | null): EventType[] {
  if (!raw) return [];
  const valid = new Set<string>(Object.values(EventType));
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is EventType => valid.has(s));
}

export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (since && Number.isNaN(since.getTime())) throw new HttpError(400, "since must be an ISO date");
    const limitRaw = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 100;
    const types = parseTypes(url.searchParams.get("types"));
    const events = await prisma.event.findMany({
      where: {
        patientId,
        ...(since ? { createdAt: { gt: since } } : {}),
        ...(types.length ? { type: { in: types } } : {}),
      },
      include: eventInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return Response.json({ events: events.map(serializeEvent) });
  } catch (error) {
    return errorResponse(error);
  }
}
