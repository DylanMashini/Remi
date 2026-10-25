/**
 * Text-to-speech with ElevenLabs. Stateless: the speechId *is* the text (base64url, with the
 * model name prefixed when the line needs the expressive model), so any server instance can turn
 * an id back into audio with no shared cache. The phone caches each MP3 on disk
 * (Library/Caches/speech/<id>.mp3), so a line is generated once per device.
 */

const DEFAULT_MODEL = "eleven_flash_v2_5"; // ElevenLabs' low-latency model
/**
 * Flash ignores audio tags like `[laughs]` or `[whispers]`; only the v3/v4 family performs them.
 * v4 Turbo is the low-latency member of that family (~100 ms), so a tagged line costs little extra.
 */
const EXPRESSIVE_MODEL = "eleven_v4_turbo";
const OUTPUT_FORMAT = "mp3_44100_128";
/**
 * "Bella - Professional, Bright, Warm", one of ElevenLabs' premade voices. Premade voices work on
 * every plan; Voice Library voices (like "Lauren") return 402 `paid_plan_required` on the free
 * plan, which silently sent the whole demo to Apple speech (Oct 24).
 */
const DEFAULT_VOICE = "hpp4J3VqNfWAUOO0d1Us";
/** Longest line we will synthesize from an id (a few paragraphs; ElevenLabs allows far more). */
const MAX_TEXT_CHARS = 5000;

export class TtsError extends Error {
  name = "TtsError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,8192}$/;
const MODEL_PREFIX_RE = /^(eleven_[a-z0-9_]+)\n/;

export function ttsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function voiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
}

/** `[laughs]`, `[whispers]`, `[evil laugh]`: a short bracketed stage direction. */
const AUDIO_TAG_RE = /\[[^\[\]\n]{1,60}\]/g;

export function hasAudioTags(text: string): boolean {
  return new RegExp(AUDIO_TAG_RE.source).test(text);
}

/**
 * The words as they should be shown and logged: audio tags are performed by the voice, not read
 * aloud, so they leave the display text. Keeps the tagged text for the audio itself (see speechIdFor).
 */
export function withoutAudioTags(text: string): string {
  return text
    .replace(AUDIO_TAG_RE, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function modelFor(text: string): string {
  if (hasAudioTags(text)) return process.env.ELEVENLABS_EXPRESSIVE_MODEL_ID || EXPRESSIVE_MODEL;
  return process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
}

/**
 * Returns the speechId for `text`: base64url of the text, prefixed with the model name when the
 * line needs the expressive model so Flash audio is never replayed for a tagged line. Pure; no
 * server state, so the id works on any instance and the phone can cache by it.
 */
export function speechIdFor(text: string): string {
  const model = modelFor(text);
  const keyed = model === DEFAULT_MODEL ? text : `${model}\n${text}`;
  return Buffer.from(keyed, "utf8").toString("base64url");
}

/** Inverse of speechIdFor: the text to synthesize and the model to use. */
function decodeSpeechId(id: string): { text: string; model: string } {
  if (!ID_RE.test(id)) throw new TtsError(400, "Invalid speech id");
  let keyed: string;
  try {
    keyed = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    throw new TtsError(400, "Invalid speech id");
  }
  const m = MODEL_PREFIX_RE.exec(keyed);
  const text = m ? keyed.slice(m[0].length) : keyed;
  if (!text.trim()) throw new TtsError(400, "Empty speech id");
  if (text.length > MAX_TEXT_CHARS) throw new TtsError(413, "Speech text too long");
  return { text, model: m ? m[1] : modelFor(text) };
}

async function generate(text: string, model: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = voiceId();
  if (!key) throw new TtsError(503, "ElevenLabs is not configured (ELEVENLABS_API_KEY). Phone should fall back to on-device speech.");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch (error) {
    throw new TtsError(502, `ElevenLabs request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 402 ? " (402 usually means a Voice Library voice on the free plan; use a premade voice id or unset ELEVENLABS_VOICE_ID)" : "";
    throw new TtsError(502, `ElevenLabs TTS returned ${res.status}${hint}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Returns MP3 bytes for a speechId. Generated on every call; the phone is the only cache. */
export async function getSpeechAudio(id: string): Promise<Buffer> {
  const { text, model } = decodeSpeechId(id);
  return generate(text, model);
}
