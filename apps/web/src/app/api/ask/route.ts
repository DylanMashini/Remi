import { requireSession } from "@/lib/auth";
import { answerQuestion, normalizeQuestion } from "@/lib/claude";
import { previousAnswer } from "@/lib/asks";
import { logEvent } from "@/lib/events";
import { askRealtime, RealtimeError } from "@/lib/realtime";
import { transcribe } from "@/lib/stt";
import { speechIdFor } from "@/lib/tts";
import { errorResponse, HttpError, readBytes, readJson } from "../_lib/http";

const NOT_HEARD = "I didn't catch that. You can ask me again.";
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

type Input = { text?: string; wav?: Buffer; frame?: Buffer; source: "text" | "audio" };

async function filePart(form: FormData, name: string, max: number, what: string): Promise<Buffer | undefined> {
  const part = form.get(name);
  if (!part || typeof part === "string") return undefined;
  if (part.size > max) throw new HttpError(413, `${what} is too large`);
  const buf = Buffer.from(await part.arrayBuffer());
  return buf.length ? buf : undefined;
}

/**
 * Accepts, in order of preference: multipart/form-data (`audio` WAV or `text`, plus an optional
 * `frame` JPEG of what the glasses see), raw `audio/wav`, or JSON `{text}`.
 */
async function readInput(req: Request): Promise<Input> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "Body must be multipart/form-data");
    }
    const wav = await filePart(form, "audio", MAX_AUDIO_BYTES, "Audio");
    const frame = await filePart(form, "frame", MAX_FRAME_BYTES, "Frame");
    const textField = form.get("text");
    const text = typeof textField === "string" && textField.trim() ? textField.trim() : undefined;
    if (!wav && !text) throw new HttpError(400, "Send an audio file or text");
    return wav ? { wav, frame, source: "audio" } : { text, frame, source: "text" };
  }
  if (contentType.includes("application/json")) {
    const body = await readJson<{ text?: unknown }>(req);
    if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "text is required");
    return { text: body.text.trim(), source: "text" };
  }
  return { wav: await readBytes(req, "audio/wav"), source: "audio" };
}

/**
 * Realtime (audio + frame straight into gpt-realtime) first. If the realtime key is missing or the
 * call fails, fall back to the older chain: our own STT, then Claude on the text (no frame).
 */
async function answer(patientId: string, input: Input): Promise<{ question: string; answer: string; model: string; frame: boolean }> {
  const frame = Boolean(input.frame);
  try {
    const r = await askRealtime({ patientId, wav: input.wav, text: input.text, frame: input.frame });
    let question = r.question;
    if (!question && input.wav) {
      // The realtime transcript did not arrive in time; we still need the words for the log.
      question = await transcribe(input.wav).catch(() => "");
    }
    return { question, answer: r.answer, model: r.model, frame };
  } catch (error) {
    const skippable = error instanceof RealtimeError && error.status >= 500;
    if (!skippable || !process.env.ANTHROPIC_API_KEY) throw error;
    console.error("[ask] realtime failed, falling back to STT + Claude:", error.message);
    const question = input.text ?? (await transcribe(input.wav!));
    if (!question) return { question: "", answer: "", model: "claude", frame: false };
    return { question, answer: await answerQuestion(patientId, question), model: "claude", frame: false };
  }
}

export async function POST(req: Request) {
  try {
    const { patientId } = await requireSession(req);
    const input = await readInput(req);
    const result = await answer(patientId, input);
    const question = result.question;

    if (!question) {
      // Nothing heard: answer gently, log nothing as a question.
      return Response.json({ question: "", answer: NOT_HEARD, speechId: speechIdFor(NOT_HEARD), frame: result.frame });
    }

    // Repeats get the same words as last time, whatever the model said this time.
    const normalized = normalizeQuestion(question);
    const prior = await previousAnswer(patientId, normalized);
    const answerText = prior ? prior.text : result.answer || "I'm not sure right now. Let's ask your family together.";

    const qEvent = await logEvent(patientId, "QUESTION", question, {
      data: {
        normalized,
        source: input.source,
        frame: result.frame,
        model: result.model,
        repeat: Boolean(prior),
        ...(prior ? { repeatOf: prior.questionEventId } : {}),
      },
    });
    const speechId = speechIdFor(answerText);
    await logEvent(patientId, "ANSWER", answerText, { data: { questionEventId: qEvent.id, speechId, repeat: Boolean(prior), model: result.model } });
    await logEvent(patientId, "SPOKEN", answerText, { data: { speechId, source: "ask" } });

    return Response.json({ question, answer: answerText, speechId, frame: result.frame });
  } catch (error) {
    return errorResponse(error);
  }
}
