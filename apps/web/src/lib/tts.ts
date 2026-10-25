import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Text-to-speech with ElevenLabs, cached on disk so the same words always sound the same.
 * speechId = first 16 hex chars of sha256(text). The text is registered when the id is minted
 * (memory + .cache/speech/<id>.txt) and audio generation starts in the background right away.
 */

const CACHE_DIR = path.join(process.cwd(), ".cache", "speech");
const DEFAULT_MODEL = "eleven_flash_v2_5"; // ElevenLabs' low-latency model
const OUTPUT_FORMAT = "mp3_44100_128";
/**
 * "Bella - Professional, Bright, Warm", one of ElevenLabs' premade voices. Premade voices work on
 * every plan; Voice Library voices (like "Lauren") return 402 `paid_plan_required` on the free
 * plan, which silently sent the whole demo to Apple speech (Oct 24).
 */
const DEFAULT_VOICE = "hpp4J3VqNfWAUOO0d1Us";

export class TtsError extends Error {
  name = "TtsError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const g = globalThis as unknown as {
  __recallSpeechText?: Map<string, string>;
  __recallSpeechInflight?: Map<string, Promise<Buffer>>;
};
const texts = (g.__recallSpeechText ??= new Map());
const inflight = (g.__recallSpeechInflight ??= new Map());

const ID_RE = /^[0-9a-f]{16}$/;

export function ttsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function voiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
}

/** Make sure the audio for `text` exists (or is being generated). Fire-and-forget. */
export function prewarmSpeech(text: string): void {
  speechIdFor(text);
}

/** Registers text and returns its speechId. Kicks off audio generation in the background. */
export function speechIdFor(text: string): string {
  const id = createHash("sha256").update(text).digest("hex").slice(0, 16);
  if (!texts.has(id)) {
    texts.set(id, text);
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(path.join(CACHE_DIR, `${id}.txt`), text, "utf8");
    } catch (error) {
      console.error("[tts] could not persist speech text", error);
    }
  }
  if (ttsConfigured()) {
    getSpeechAudio(id).catch((error) => console.error(`[tts] prewarm ${id} failed:`, error instanceof Error ? error.message : error));
  }
  return id;
}

async function textFor(id: string): Promise<string | null> {
  const cached = texts.get(id);
  if (cached) return cached;
  try {
    const text = await readFile(path.join(CACHE_DIR, `${id}.txt`), "utf8");
    texts.set(id, text);
    return text;
  } catch {
    return null;
  }
}

async function generate(text: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = voiceId();
  if (!key) throw new TtsError(503, "ElevenLabs is not configured (ELEVENLABS_API_KEY). Phone should fall back to on-device speech.");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL }),
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

/** Returns MP3 bytes for a speechId: disk cache first, else generate once and cache. */
export async function getSpeechAudio(id: string): Promise<Buffer> {
  if (!ID_RE.test(id)) throw new TtsError(400, "Invalid speech id");
  const mp3Path = path.join(CACHE_DIR, `${id}.mp3`);
  try {
    return await readFile(mp3Path);
  } catch {
    // not cached yet
  }
  const existing = inflight.get(id);
  if (existing) return existing;
  const job = (async () => {
    const text = await textFor(id);
    if (!text) throw new TtsError(404, "Unknown speech id");
    const audio = await generate(text);
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${mp3Path}.${process.pid}.tmp`;
    await writeFile(tmp, audio);
    await rename(tmp, mp3Path);
    return audio;
  })();
  inflight.set(id, job);
  try {
    return await job;
  } finally {
    inflight.delete(id);
  }
}
