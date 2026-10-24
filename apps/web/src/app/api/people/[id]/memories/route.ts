import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { invalidateRoster } from "@/lib/match";
import { cleanCallout, cleanMemoryText, distill, serializeMemory } from "@/lib/memories";
import type { MemorySource } from "@/generated/prisma/client";
import { errorResponse, HttpError, readJson } from "../../../_lib/http";

const SOURCES: MemorySource[] = ["WEARER_VOICE", "WEARER_TYPED", "CAREGIVER"];

/**
 * Adds a memory about this person. `text` is the speaker's own words; the server distills it into
 * a one-sentence callout (Claude, or a local trim without a key). `calloutText` may be supplied
 * directly (caregiver edits) and skips distillation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { patientId, user } = await requireSession(req);
    const { id } = await params;
    const body = await readJson<{ text?: unknown; calloutText?: unknown; source?: unknown; useInCallout?: unknown }>(req);
    const text = cleanMemoryText(body.text);
    if (!text) throw new HttpError(400, "text is required");
    const source = SOURCES.includes(body.source as MemorySource)
      ? (body.source as MemorySource)
      : user.role === "WEARER"
        ? "WEARER_TYPED"
        : "CAREGIVER";

    const person = await prisma.person.findFirst({ where: { id, patientId }, select: { id: true, name: true, relationship: true } });
    if (!person) throw new HttpError(404, "Person not found");

    let calloutText = cleanCallout(body.calloutText);
    let usable = true;
    if (!calloutText) ({ callout: calloutText, usable } = await distill(text, person));
    const useInCallout = typeof body.useInCallout === "boolean" ? body.useInCallout : usable;

    const memory = await prisma.memory.create({
      data: { patientId, personId: person.id, text, calloutText, useInCallout, source, createdById: user.id },
    });
    invalidateRoster(patientId);
    await logEvent(patientId, "PRACTICE", calloutText, {
      personId: person.id,
      data: { kind: "memory", memoryId: memory.id, source, useInCallout },
    });
    return Response.json({ memory: serializeMemory(memory), usable }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
