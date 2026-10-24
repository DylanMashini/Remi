import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { errorResponse, HttpError, readJson } from "../_lib/http";

export async function GET(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const reminders = await prisma.reminder.findMany({ where: { patientId }, orderBy: { dueAt: "asc" } });
    return Response.json({ reminders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, patientId } = await requireSession(req);
    const body = await readJson<{ text?: unknown; dueAt?: unknown }>(req);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new HttpError(400, "text is required");
    if (text.length > 500) throw new HttpError(400, "text is too long (max 500 characters)");
    const dueAt = typeof body.dueAt === "string" || typeof body.dueAt === "number" ? new Date(body.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) throw new HttpError(400, "dueAt must be an ISO date");
    const reminder = await prisma.reminder.create({ data: { patientId, text, dueAt, createdById: user.id } });
    return Response.json({ reminder }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
