/**
 * Ask answers via the OpenAI Realtime API (gpt-realtime-2.1): one WebSocket session per question.
 * The wearer's audio (and optionally the glasses frame they are looking at) go in; plain text comes
 * out and is spoken through the ElevenLabs voice like every other line. The frame is held in memory
 * for the duration of the request only and is never written anywhere.
 */
import WebSocket from "ws";
import { TONE_RULES } from "@/lib/claude";
import { buildContext } from "@/lib/context";

const MODEL = () => process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
const TRANSCRIBE_MODEL = () => process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const REALTIME_RATE = 24000; // the only PCM rate the Realtime API accepts
const TIMEOUT_MS = 25_000;
const TRANSCRIPT_GRACE_MS = 4_000;

export class RealtimeError extends Error {
  name = "RealtimeError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type AskInput = {
  patientId: string;
  /** 16 kHz (or any rate) mono PCM16 WAV from the phone. */
  wav?: Buffer;
  /** Typed question (JSON path, or tests). */
  text?: string;
  /** JPEG of what the glasses see right now, if the phone had a fresh frame. */
  frame?: Buffer;
};

export type AskResult = {
  /** What the wearer said (transcript), or the typed text. "" when nothing was heard. */
  question: string;
  answer: string;
  model: string;
};

type RealtimeEvent = {
  type: string;
  event_id?: string;
  error?: { message?: string; code?: string };
  transcript?: string;
  item_id?: string;
  response?: {
    status?: string;
    status_details?: { error?: { message?: string }; reason?: string; type?: string } | null;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
};

// MARK: WAV handling

type Pcm = { samples: Int16Array; rate: number };

/** Reads a RIFF/WAVE buffer: returns the first channel's PCM16 samples and the sample rate. */
export function decodeWav(wav: Buffer): Pcm {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new RealtimeError(400, "Body is not a WAV file");
  }
  let rate = 16000;
  let channels = 1;
  let bits = 16;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      channels = wav.readUInt16LE(start + 2) || 1;
      rate = wav.readUInt32LE(start + 4) || 16000;
      bits = wav.readUInt16LE(start + 14) || 16;
    } else if (id === "data") {
      if (bits !== 16) throw new RealtimeError(400, `Unsupported WAV: ${bits}-bit`);
      const end = Math.min(wav.length, start + size);
      const frames = Math.floor((end - start) / (2 * channels));
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = wav.readInt16LE(start + i * 2 * channels);
      return { samples, rate };
    }
    offset = start + size + (size % 2);
  }
  throw new RealtimeError(400, "WAV has no data chunk");
}

/** Linear-interpolation resample to 24 kHz (voice band only; good enough for speech). */
export function resample(pcm: Pcm, target = REALTIME_RATE): Int16Array {
  if (pcm.rate === target) return pcm.samples;
  const ratio = pcm.rate / target;
  const n = Math.floor(pcm.samples.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.samples.length - 1);
    const t = pos - i0;
    out[i] = Math.round(pcm.samples[i0] * (1 - t) + pcm.samples[i1] * t);
  }
  return out;
}

function toBase64(samples: Int16Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64");
}

// MARK: Session

function instructions(context: string, hasFrame: boolean): string {
  const sight = hasFrame
    ? "\n\nAn image is attached: it is what the wearer sees right now through the camera in their glasses, taken as they asked. Use it when the question is about what is in front of them (what is this, where am I, who is here, what does this say). Describe plainly; never name a person from the picture alone. People may only be named from the enrolled list in the context."
    : "";
  return `${TONE_RULES}${sight}\n\nContext right now:\n${context}`;
}

/**
 * Runs one question through the Realtime API. Resolves with the transcript and the answer; rejects
 * with RealtimeError (503 for a missing key, 502 for an upstream failure or timeout).
 */
export async function askRealtime(input: AskInput): Promise<AskResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new RealtimeError(503, "OPENAI_API_KEY is not set; cannot answer questions");
  if (!input.wav && !input.text) throw new RealtimeError(400, "Nothing to ask");
  const model = MODEL();

  const [context, pcm] = await Promise.all([
    buildContext(input.patientId),
    Promise.resolve(input.wav ? resample(decodeWav(input.wav)) : null),
  ]);

  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${key}` },
    handshakeTimeout: 10_000,
  });

  return new Promise<AskResult>((resolve, reject) => {
    let answer: string | null = null;
    let transcript: string | null = input.text ?? null;
    let finished = false;
    let graceTimer: NodeJS.Timeout | null = null;

    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve({ question: (transcript ?? "").trim(), answer: (answer ?? "").trim(), model });
    };
    const timer = setTimeout(() => finish(new RealtimeError(502, `Realtime answer timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
    const send = (event: Record<string, unknown>) => ws.send(JSON.stringify(event));

    /** Both halves are in once we have an answer and (for audio) a transcript. */
    const maybeDone = () => {
      if (answer === null) return;
      if (transcript !== null) return finish();
      // The transcription runs in parallel and usually lands first; give it a moment, then go on
      // without it (the route falls back to its own STT for the log).
      graceTimer ??= setTimeout(() => finish(), TRANSCRIPT_GRACE_MS);
    };

    ws.on("error", (e) => finish(new RealtimeError(502, `Realtime connection failed: ${e.message}`)));
    ws.on("close", (code, reason) => {
      if (!finished) finish(new RealtimeError(502, `Realtime socket closed (${code}) ${reason.toString()}`.trim()));
    });

    ws.on("open", () => {
      send({
        type: "session.update",
        session: {
          type: "realtime",
          output_modalities: ["text"],
          instructions: instructions(context, Boolean(input.frame)),
          audio: {
            input: {
              format: { type: "audio/pcm", rate: REALTIME_RATE },
              turn_detection: null,
              transcription: { model: TRANSCRIBE_MODEL(), language: "en" },
            },
          },
        },
      });
    });

    ws.on("message", (raw) => {
      let ev: RealtimeEvent;
      try {
        ev = JSON.parse(raw.toString()) as RealtimeEvent;
      } catch {
        return;
      }
      switch (ev.type) {
        case "session.updated": {
          if (input.frame) {
            send({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: "What I see right now through my glasses:" },
                  { type: "input_image", image_url: `data:image/jpeg;base64,${input.frame.toString("base64")}` },
                ],
              },
            });
          }
          if (pcm) {
            // Audio goes through the buffer (not an item) so the server transcribes it for the log.
            send({ type: "input_audio_buffer.append", audio: toBase64(pcm) });
            send({ type: "input_audio_buffer.commit" });
          } else {
            send({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text", text: input.text }] },
            });
            send({ type: "response.create", response: { output_modalities: ["text"] } });
          }
          break;
        }
        case "input_audio_buffer.committed":
          send({ type: "response.create", response: { output_modalities: ["text"] } });
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (!input.text) transcript = ev.transcript ?? "";
          maybeDone();
          break;
        case "conversation.item.input_audio_transcription.failed":
          console.warn("[realtime] input transcription failed", ev.error?.message);
          transcript = "";
          maybeDone();
          break;
        case "response.done": {
          const r = ev.response;
          if (r?.status && r.status !== "completed") {
            const why = r.status_details?.error?.message ?? r.status_details?.reason ?? r.status;
            return finish(new RealtimeError(502, `Realtime response ${r.status}: ${why}`));
          }
          answer = (r?.output ?? [])
            .flatMap((item) => item.content ?? [])
            .filter((c) => c.type === "output_text" || c.type === "text")
            .map((c) => c.text ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          maybeDone();
          break;
        }
        case "error": {
          const msg = ev.error?.message ?? "unknown error";
          const status = /api key|authentication|invalid_api_key/i.test(msg) ? 503 : 502;
          finish(new RealtimeError(status, `Realtime API error: ${msg}`));
          break;
        }
        default:
          break;
      }
    });
  });
}

// MARK: Live conversation (phone ↔ OpenAI directly)

/**
 * The live conversation does not pass through this server: the phone opens its own WebSocket to the
 * Realtime API with a short-lived client secret minted here. The secret carries the whole session
 * config (instructions with the context packet, voice, turn detection), so the API key never leaves
 * the server and the phone never has to send instructions.
 */

const CLIENT_SECRET_TTL_S = 600;
const CHAT_VOICE = () => process.env.OPENAI_REALTIME_VOICE || "marin";
/** Spoken a little slower than default for an older listener (0.25 to 1.5). */
const CHAT_SPEED = () => clamp(num(process.env.REALTIME_SPEECH_SPEED, 0.9), 0.25, 1.5);

export type TurnDetection =
  | {
      type: "server_vad";
      threshold: number;
      prefix_padding_ms: number;
      silence_duration_ms: number;
      create_response: true;
      interrupt_response: boolean;
    }
  | { type: "semantic_vad"; eagerness: "low" | "medium" | "high" | "auto"; create_response: true; interrupt_response: boolean };

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Whether the wearer may talk over the glasses. Off by default: open-ear speakers next to the mic make echo-triggered interruptions likely. */
export function bargeInEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.REALTIME_BARGE_IN ?? "");
}

/**
 * How the API decides the wearer has finished speaking. Older people pause mid-sentence, so the
 * default waits 1.5 s of silence (the API default is 0.5 s) before the model answers.
 *   REALTIME_TURN_DETECTION=server_vad (default) | semantic_vad
 *   REALTIME_SILENCE_MS=1500   server_vad: silence that ends a turn
 *   REALTIME_VAD_THRESHOLD=0.5 server_vad: 0..1, higher needs louder speech (noisy rooms)
 *   REALTIME_PREFIX_MS=400     server_vad: audio kept from before speech was detected
 *   REALTIME_EAGERNESS=low     semantic_vad: low lets the wearer take their time
 */
export function turnDetection(): TurnDetection {
  const interrupt = bargeInEnabled();
  if ((process.env.REALTIME_TURN_DETECTION || "").toLowerCase() === "semantic_vad") {
    const e = (process.env.REALTIME_EAGERNESS || "low").toLowerCase();
    const eagerness = e === "medium" || e === "high" || e === "auto" ? e : "low";
    return { type: "semantic_vad", eagerness, create_response: true, interrupt_response: interrupt };
  }
  return {
    type: "server_vad",
    threshold: clamp(num(process.env.REALTIME_VAD_THRESHOLD, 0.5), 0, 1),
    prefix_padding_ms: Math.round(clamp(num(process.env.REALTIME_PREFIX_MS, 400), 0, 2000)),
    silence_duration_ms: Math.round(clamp(num(process.env.REALTIME_SILENCE_MS, 1500), 200, 10_000)),
    create_response: true,
    interrupt_response: interrupt,
  };
}

const CHAT_RULES = `This is a live spoken conversation, not a single question. Rules for the conversation:
- Keep every reply to one or two short sentences, then stop and wait. Let the wearer lead.
- The wearer may pause mid-thought. If what they said is incomplete or unclear, answer the part you understood or ask one gentle question. Never say you did not hear them more than once in a row.
- If they repeat a question, answer again in the same words as before, warmly, as if for the first time.
- Pictures may arrive during the conversation showing what the wearer sees right now through their glasses. Use a picture only for questions about what is in front of them. Describe plainly; never name a person from a picture alone.
- No lists, no headings, no asides about being an AI. Just speak.`;

export const CHAT_GREETING = "I'm listening.";
export const CHAT_FAREWELL = "I'm here whenever you need me.";

function chatInstructions(context: string, exchanges: { question: string; answer: string }[]): string {
  const repeats =
    exchanges.length === 0
      ? "- none yet"
      : exchanges
          .slice(0, 20)
          .reverse()
          .map((x) => `- Asked: "${x.question}" You answered: "${x.answer}"`)
          .join("\n");
  return `${TONE_RULES}\n\n${CHAT_RULES}\n\nQuestions already answered in the last two hours (if asked again, give the same answer in the same words):\n${repeats}\n\nContext right now:\n${context}`;
}

export type ChatSession = {
  /** Ephemeral key for the phone's WebSocket (Authorization: Bearer ...). */
  clientSecret: string;
  expiresAt: string;
  /** The WebSocket URL to open. */
  url: string;
  model: string;
  voice: string;
  turnDetection: TurnDetection;
  bargeIn: boolean;
  greeting: string;
  farewell: string;
};

type ClientSecretResponse = {
  value?: string;
  expires_at?: number;
  error?: { message?: string };
};

/**
 * Mints a client secret whose session config carries the tone rules, the context packet and the
 * turn-detection settings. The phone connects with it directly; nothing of the conversation's audio
 * passes through this server (the phone posts each finished turn's text to /api/realtime/turns).
 */
export async function createChatSession(input: { patientId: string; context: string; exchanges: { question: string; answer: string }[] }): Promise<ChatSession> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new RealtimeError(503, "OPENAI_API_KEY is not set; the live conversation is unavailable");
  const model = MODEL();
  const detection = turnDetection();
  const body = {
    expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_S },
    session: {
      type: "realtime",
      model,
      instructions: chatInstructions(input.context, input.exchanges),
      output_modalities: ["audio"],
      max_output_tokens: 300,
      audio: {
        input: {
          format: { type: "audio/pcm", rate: REALTIME_RATE },
          turn_detection: detection,
          transcription: { model: TRANSCRIBE_MODEL(), language: "en" },
          // The glasses' mics sit on the temples, close to the mouth.
          noise_reduction: { type: "near_field" },
        },
        output: {
          format: { type: "audio/pcm", rate: REALTIME_RATE },
          voice: CHAT_VOICE(),
          speed: CHAT_SPEED(),
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new RealtimeError(502, `Could not reach OpenAI for a conversation token: ${error instanceof Error ? error.message : String(error)}`);
  }
  const json = (await res.json().catch(() => ({}))) as ClientSecretResponse;
  if (!res.ok || !json.value) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    throw new RealtimeError(res.status === 401 ? 503 : 502, `OpenAI refused the conversation token: ${msg}`);
  }
  return {
    clientSecret: json.value,
    expiresAt: new Date((json.expires_at ?? Math.floor(Date.now() / 1000) + CLIENT_SECRET_TTL_S) * 1000).toISOString(),
    url: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    model,
    voice: CHAT_VOICE(),
    turnDetection: detection,
    bargeIn: detection.interrupt_response,
    greeting: CHAT_GREETING,
    farewell: CHAT_FAREWELL,
  };
}
