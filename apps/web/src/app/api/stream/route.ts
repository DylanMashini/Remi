import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { eventInclude, serializeEvent } from "@/lib/events";
import { errorResponse } from "../_lib/http";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;

/** SSE: one `event: event` per new Event row. Polls the DB every 1 s per connection. */
export async function GET(req: Request) {
  let patientId: string;
  try {
    ({ patientId } = await requireSession(req));
  } catch (error) {
    return errorResponse(error);
  }

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  // Cursor: newest createdAt seen, plus ids at exactly that timestamp (avoids same-ms misses).
  let cursor = new Date();
  let seenAtCursor = new Set<string>();

  // Resume: on reconnect the browser sends the last `id:` it received. Start the cursor at that
  // row so anything created while the connection was down (Vercel maxDuration, network blip) is
  // replayed instead of lost. Unknown or foreign ids fall back to "now".
  const lastEventId = req.headers.get("last-event-id")?.trim();
  if (lastEventId) {
    try {
      const last = await prisma.event.findFirst({
        where: { id: lastEventId, patientId },
        select: { createdAt: true },
      });
      if (last) {
        cursor = last.createdAt;
        const sameMs = await prisma.event.findMany({
          where: { patientId, createdAt: cursor },
          select: { id: true },
        });
        // The row they already have, and any row at the same ms that sorts at or before it, are
        // seen. Rows at that ms with an id sorting after it have not been sent yet (we emit in
        // createdAt asc, id asc order), so leave them out and they replay.
        seenAtCursor = new Set(sameMs.map((r) => r.id).filter((id) => id <= lastEventId));
      }
    } catch (error) {
      console.error("[stream] resume lookup failed", error);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      send(`retry: 2000\n: connected\n\n`);

      let busy = false;
      poll = setInterval(async () => {
        if (busy || closed) return;
        busy = true;
        try {
          const rows = await prisma.event.findMany({
            where: { patientId, createdAt: { gte: cursor } },
            include: eventInclude,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 200,
          });
          for (const row of rows) {
            if (row.createdAt.getTime() === cursor.getTime() && seenAtCursor.has(row.id)) continue;
            if (row.createdAt.getTime() > cursor.getTime()) {
              cursor = row.createdAt;
              seenAtCursor = new Set();
            }
            seenAtCursor.add(row.id);
            send(`id: ${row.id}\nevent: event\ndata: ${JSON.stringify(serializeEvent(row))}\n\n`);
          }
        } catch (error) {
          console.error("[stream] poll failed", error);
        } finally {
          busy = false;
        }
      }, POLL_MS);

      heartbeat = setInterval(() => send(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);

      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
