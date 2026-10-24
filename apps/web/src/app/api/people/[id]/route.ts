import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clearDebounce, invalidateRoster } from "@/lib/match";
import { getPerson } from "@/lib/people";
import { deleteBlobs } from "@/lib/storage";
import { errorResponse, HttpError, readJson } from "../../_lib/http";

type Params = { params: Promise<{ id: string }> };

/** One person with their memories and Remember visits. */
export async function GET(req: Request, { params }: Params) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const person = await getPerson(patientId, id);
    if (!person) throw new HttpError(404, "Person not found");
    return Response.json({ person });
  } catch (error) {
    return errorResponse(error);
  }
}

function text(v: unknown, key: string, max: number, required = false): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return required ? undefined : null;
  if (typeof v !== "string") throw new HttpError(400, `${key} must be a string`);
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length > max) throw new HttpError(400, `${key} is too long (max ${max} characters)`);
  if (!t) return required ? undefined : null;
  return t;
}

/** Edit the callout: name, relationship, note. Any field may be omitted; null clears it. */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const body = await readJson<{ name?: unknown; relationship?: unknown; notes?: unknown }>(req);
    const name = text(body.name, "name", 100, true) ?? undefined;
    const relationship = text(body.relationship, "relationship", 100);
    const notes = text(body.notes, "notes", 500);
    if (body.name !== undefined && !name) throw new HttpError(400, "name cannot be empty");
    const existing = await prisma.person.findFirst({ where: { id, patientId }, select: { id: true } });
    if (!existing) throw new HttpError(404, "Person not found");
    await prisma.person.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(relationship !== undefined ? { relationship } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
    });
    invalidateRoster(patientId);
    const person = await getPerson(patientId, id);
    return Response.json({ person });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Deletes a person, their photos (blobs + rows), samples and memories. Events stay with personId nulled. */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const person = await prisma.person.findFirst({
      where: { id, patientId },
      include: { files: { select: { id: true, url: true, pathname: true } } },
    });
    if (!person) throw new HttpError(404, "Person not found");
    await deleteBlobs(person.files);
    // Cascades: File rows (personId), FaceSamples, Memories; Event.personId is SetNull.
    await prisma.person.delete({ where: { id: person.id } });
    invalidateRoster(patientId);
    clearDebounce(patientId, person.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
