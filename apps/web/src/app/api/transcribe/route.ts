import { requireSession } from "@/lib/auth";
import { transcribe } from "@/lib/stt";
import { errorResponse, readBytes } from "../_lib/http";

/**
 * Speech to text for the Remember flow: WAV in, `{text}` out. Nothing is logged here; the words
 * only persist if the wearer keeps them as a memory (POST /api/people/[id]/memories).
 */
export async function POST(req: Request) {
  try {
    await requireSession(req);
    const wav = await readBytes(req, "audio/wav");
    const text = await transcribe(wav);
    return Response.json({ text });
  } catch (error) {
    return errorResponse(error);
  }
}
