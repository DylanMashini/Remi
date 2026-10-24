/**
 * Speech-to-text for 16 kHz mono WAV. ElevenLabs Scribe first, OpenAI transcription as fallback.
 */

const ELEVEN_MODEL = () => process.env.ELEVENLABS_STT_MODEL || "scribe_v2";
const OPENAI_MODEL = () => process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";

export class SttError extends Error {
  name = "SttError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function wavForm(wav: Buffer, modelField: string, model: string): FormData {
  const form = new FormData();
  form.append(modelField, model);
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  return form;
}

async function elevenLabs(wav: Buffer, key: string): Promise<string> {
  const form = wavForm(wav, "model_id", ELEVEN_MODEL());
  form.append("language_code", "en");
  form.append("tag_audio_events", "false");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

async function openAI(wav: Buffer, key: string): Promise<string> {
  const form = wavForm(wav, "model", OPENAI_MODEL());
  form.append("language", "en");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

export async function transcribe(wav: Buffer): Promise<string> {
  const eleven = process.env.ELEVENLABS_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!eleven && !openai) throw new SttError(503, "No speech-to-text key configured (ELEVENLABS_API_KEY or OPENAI_API_KEY)");
  const errors: string[] = [];
  if (eleven) {
    try {
      return await elevenLabs(wav, eleven);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      console.error("[stt] ElevenLabs failed, trying OpenAI:", errors.at(-1));
    }
  }
  if (openai) {
    try {
      return await openAI(wav, openai);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new SttError(502, `Transcription failed: ${errors.join(" | ")}`);
}
