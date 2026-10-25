import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { knownLine } from "@/lib/line";
import { calloutFor } from "@/lib/memories";
import { speechIdFor, withoutAudioTags } from "@/lib/tts";
import { errorResponse, HttpError, readJson } from "../_lib/http";

/**
 * One step of a Remember visit. `knew: true` means the wearer said "Yes, I know them";
 * `knew: false` means they asked to be told. Either way the response carries the exact line Remi
 * says for this person and its speechId, so the phone can play it through the glasses.
 * Logged as a PRACTICE event so the caregiver sees the pattern. Never scored, never corrected.
 */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const body = await readJson<{ personId?: unknown; knew?: unknown }>(req);
    if (typeof body.personId !== "string") throw new HttpError(400, "personId is required");
    if (typeof body.knew !== "boolean") throw new HttpError(400, "knew must be true or false");

    const person = await prisma.person.findFirst({
      where: { id: body.personId, patientId },
      select: { id: true, name: true, relationship: true, notes: true },
    });
    if (!person) throw new HttpError(404, "Person not found");

    const spoken = knownLine({ ...person, memory: await calloutFor(person.id) });
    const speechId = speechIdFor(spoken);
    const line = withoutAudioTags(spoken);
    await logEvent(patientId, "PRACTICE", body.knew ? `Knew ${person.name} right away` : `Was reminded who ${person.name} is`, {
      personId: person.id,
      data: { kind: "visit", knew: body.knew, speechId },
    });
    if (!body.knew) await logEvent(patientId, "SPOKEN", line, { personId: person.id, data: { speechId, source: "remember" } });

    return Response.json({ line, speechId });
  } catch (error) {
    return errorResponse(error);
  }
}
