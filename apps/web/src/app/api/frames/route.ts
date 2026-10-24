import { requireSession } from "@/lib/auth";
import { embedFaces } from "@/lib/face";
import { knownLine, matchFaces, shouldAnnouncePerson, shouldAnnounceUnknown, UNKNOWN_LINE } from "@/lib/match";
import { logEvent } from "@/lib/events";
import { speechIdFor } from "@/lib/tts";
import { errorResponse, readBytes } from "../_lib/http";

type FaceOut = {
  box: [number, number, number, number];
  personId?: string;
  name?: string;
  relationship?: string | null;
  score: number;
};

/** One glasses frame in, faces + optional spoken line out. The frame is never stored. */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const jpeg = await readBytes(req, "image/jpeg frame");
    const detected = await embedFaces(jpeg);
    const matches = await matchFaces(patientId, detected);

    const faces: FaceOut[] = matches.map((m) =>
      m.person
        ? { box: m.box, personId: m.person.id, name: m.person.name, relationship: m.person.relationship, score: m.score }
        : { box: m.box, score: m.score },
    );

    // Decide what to say. Known people first (each debounced 5 min); unknown only if nobody known is announced.
    const lines: string[] = [];
    const announced = new Set<string>();
    for (const m of matches) {
      if (!m.person || announced.has(m.person.id)) continue;
      if (!shouldAnnouncePerson(patientId, m.person.id)) continue;
      announced.add(m.person.id);
      const line = knownLine(m.person);
      lines.push(line);
      await logEvent(patientId, "RECOGNITION", line, { personId: m.person.id, data: { score: m.score, box: m.box } });
    }
    const unknown = matches.filter((m) => !m.person);
    if (lines.length === 0 && unknown.length > 0 && matches.every((m) => !m.person) && shouldAnnounceUnknown(patientId)) {
      lines.push(UNKNOWN_LINE);
      await logEvent(patientId, "UNKNOWN", UNKNOWN_LINE, { data: { score: unknown[0].score, box: unknown[0].box, count: unknown.length } });
    }

    let speak: { speechId: string; text: string } | undefined;
    if (lines.length) {
      const text = lines.join(" ");
      const speechId = speechIdFor(text);
      speak = { speechId, text };
      await logEvent(patientId, "SPOKEN", text, {
        personId: announced.size === 1 ? [...announced][0] : null,
        data: { speechId, source: "frame" },
      });
    }

    return Response.json(speak ? { faces, speak } : { faces });
  } catch (error) {
    return errorResponse(error);
  }
}
