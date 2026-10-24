import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { eventInclude, serializeEvent } from "@/lib/events";
import { errorResponse, HttpError } from "../_lib/http";

export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : null;
    if (since && Number.isNaN(since.getTime())) throw new HttpError(400, "since must be an ISO date");
    const limitRaw = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 100;
    const events = await prisma.event.findMany({
      where: { patientId, ...(since ? { createdAt: { gt: since } } : {}) },
      include: eventInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return Response.json({ events: events.map(serializeEvent) });
  } catch (error) {
    return errorResponse(error);
  }
}
