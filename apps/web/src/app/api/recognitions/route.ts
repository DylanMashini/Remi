import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { knownLine, UNKNOWN_LINE } from "@/lib/line";
import { logEvent } from "@/lib/events";
import { speechIdFor } from "@/lib/tts";
import { errorResponse, HttpError, readJson } from "../_lib/http";

type Incoming = {
  events?: { personId?: string | null; score?: number; box?: number[]; count?: number }[];
};

const MAX_EVENTS = 4;

/**
 * The phone (Swift `LocalRecognition`, Core ML) matched a glasses frame against the family roster
 * on the device and already applied the 5 min / 60 s debounce. It sends only the decision; this
 * route logs RECOGNITION / UNKNOWN + SPOKEN and returns the sentence to say. No camera frame ever
 * reaches the server: this is the only recognition path.
 */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const body = await readJson<Incoming>(req);
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (events.length === 0) throw new HttpError(400, "events must be a non-empty array");

    const lines: string[] = [];
    const announced: string[] = [];
    let sawUnknown = false;
    for (const e of events) {
      const score = typeof e.score === "number" && Number.isFinite(e.score) ? Math.round(e.score * 1000) / 1000 : 0;
      const box = Array.isArray(e.box) && e.box.length === 4 ? e.box.map((v) => Math.round(Number(v) || 0)) : undefined;
      if (typeof e.personId === "string" && e.personId) {
        if (announced.includes(e.personId)) continue;
        const person = await prisma.person.findFirst({
          where: { id: e.personId, patientId },
          select: {
            id: true,
            name: true,
            relationship: true,
            notes: true,
            memories: { where: { useInCallout: true }, orderBy: { createdAt: "desc" }, take: 1, select: { calloutText: true } },
          },
        });
        if (!person) throw new HttpError(404, `Unknown person ${e.personId}`);
        const line = knownLine({ ...person, memory: person.memories[0]?.calloutText ?? null });
        lines.push(line);
        announced.push(person.id);
        await logEvent(patientId, "RECOGNITION", line, { personId: person.id, data: { score, box, source: "device" } });
      } else if (!sawUnknown) {
        sawUnknown = true;
        // Strangers are announced only when nobody known is in frame (the phone applies the same rule).
        if (announced.length === 0) {
          lines.push(UNKNOWN_LINE);
          await logEvent(patientId, "UNKNOWN", UNKNOWN_LINE, { data: { score, box, count: e.count ?? 1, source: "device" } });
        }
      }
    }

    if (lines.length === 0) return Response.json({});
    const text = lines.join(" ");
    const speechId = speechIdFor(text);
    await logEvent(patientId, "SPOKEN", text, {
      personId: announced.length === 1 ? announced[0] : null,
      data: { speechId, source: "device" },
    });
    return Response.json({ speak: { speechId, text } });
  } catch (error) {
    return errorResponse(error);
  }
}
