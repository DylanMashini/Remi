import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { transcribe } from "@/lib/stt";
import { errorResponse, readBytes } from "../_lib/http";

/** ~10 s ambient audio chunk in, transcript out. Audio is discarded; only the text is logged. */
export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const wav = await readBytes(req, "audio/wav");
    const text = await transcribe(wav);
    if (text) await logEvent(patientId, "UTTERANCE", text);
    return Response.json({ text });
  } catch (error) {
    return errorResponse(error);
  }
}
