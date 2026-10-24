import { requireSession } from "@/lib/auth";
import { getSpeechAudio } from "@/lib/tts";
import { errorResponse } from "../../_lib/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession(req);
    const { id } = await params;
    const audio = await getSpeechAudio(id);
    return new Response(new Uint8Array(audio), {
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(audio.length),
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
