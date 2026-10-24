import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clearDebounce, invalidateRoster } from "@/lib/match";
import { deleteBlobs } from "@/lib/storage";
import { errorResponse, HttpError } from "../../_lib/http";

/** Deletes a person, their photos (blobs + rows), and samples. Events stay with personId nulled. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const person = await prisma.person.findFirst({
      where: { id, patientId },
      include: { files: { select: { id: true, url: true, pathname: true } } },
    });
    if (!person) throw new HttpError(404, "Person not found");
    await deleteBlobs(person.files);
    // Cascades: File rows (personId), FaceSamples; Event.personId is SetNull.
    await prisma.person.delete({ where: { id: person.id } });
    invalidateRoster(patientId);
    clearDebounce(patientId, person.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
