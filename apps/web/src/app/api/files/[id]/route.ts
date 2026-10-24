import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { openFile } from "@/lib/storage";
import { errorResponse, HttpError } from "../../_lib/http";

/** Authenticated proxy for enrollment photos and avatars. Raw blob URLs never reach clients. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { patientId } = await requireSession(req);
    const { id } = await params;
    const file = await prisma.file.findFirst({ where: { id, patientId } });
    if (!file) throw new HttpError(404, "File not found");
    const body = await openFile(file);
    if (!body) throw new HttpError(404, "File content missing");
    const payload: BodyInit = Buffer.isBuffer(body) ? new Uint8Array(body) : (body as ReadableStream);
    return new Response(payload, {
      headers: {
        "content-type": file.contentType,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
