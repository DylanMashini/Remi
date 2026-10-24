import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { invalidateRoster } from "@/lib/match";
import { cleanCallout, cleanMemoryText, serializeMemory } from "@/lib/memories";
import { errorResponse, HttpError, readJson } from "../../_lib/http";

type Params = { params: Promise<{ id: string }> };

/** Edit a memory's words, its spoken sentence, or whether the glasses say it. */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const body = await readJson<{ text?: unknown; calloutText?: unknown; useInCallout?: unknown }>(req);
    const existing = await prisma.memory.findFirst({ where: { id, patientId }, select: { id: true } });
    if (!existing) throw new HttpError(404, "Memory not found");

    const data: { text?: string; calloutText?: string; useInCallout?: boolean } = {};
    if (body.text !== undefined) {
      const t = cleanMemoryText(body.text);
      if (!t) throw new HttpError(400, "text cannot be empty");
      data.text = t;
    }
    if (body.calloutText !== undefined) {
      const c = cleanCallout(body.calloutText);
      if (!c) throw new HttpError(400, "calloutText cannot be empty");
      data.calloutText = /[.!?]$/.test(c) ? c : `${c}.`;
    }
    if (body.useInCallout !== undefined) {
      if (typeof body.useInCallout !== "boolean") throw new HttpError(400, "useInCallout must be true or false");
      data.useInCallout = body.useInCallout;
    }
    const memory = await prisma.memory.update({ where: { id }, data });
    invalidateRoster(patientId);
    return Response.json({ memory: serializeMemory(memory) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const { count } = await prisma.memory.deleteMany({ where: { id, patientId } });
    if (count === 0) throw new HttpError(404, "Memory not found");
    invalidateRoster(patientId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
