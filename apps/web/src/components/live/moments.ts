import type { EventJson } from "../events";

/**
 * The live feed shows moments, not rows. One recognition and the line Remi said for it are one
 * moment; a question and its answer are one exchange. This groups raw events (newest first)
 * into moments (newest first) with a small time window per pairing.
 */

export type MomentKind = "recognition" | "unknown" | "exchange" | "reminder" | "spoken" | "heard" | "remembered";

export type Moment = {
  id: string;
  kind: MomentKind;
  at: string;
  personId: string | null;
  personName: string | null;
  /** The main text: the question, the ambient words, or the spoken line. */
  text: string;
  /** What Remi said in reply (exchange) or the line said for a recognition/reminder. */
  spoken: string | null;
  repeat: boolean;
  trigger: boolean;
  chat: boolean;
};

const PAIR_MS = 8_000;
const ANSWER_MS = 90_000;

function flag(data: unknown, key: string): boolean {
  return typeof data === "object" && data !== null && Boolean((data as Record<string, unknown>)[key]);
}

function source(data: unknown): string | null {
  const s = typeof data === "object" && data !== null ? (data as { source?: unknown }).source : null;
  return typeof s === "string" ? s : null;
}

export function toMoments(events: EventJson[]): Moment[] {
  const asc = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const out: Moment[] = [];
  const t = (e: EventJson) => new Date(e.createdAt).getTime();

  for (const e of asc) {
    const prev = out[out.length - 1];
    const prevEvent = prev ? new Date(prev.at).getTime() : 0;
    switch (e.type) {
      case "RECOGNITION":
        out.push({ id: e.id, kind: "recognition", at: e.createdAt, personId: e.personId, personName: e.personName, text: e.text, spoken: null, repeat: false, trigger: flag(e.data, "trigger"), chat: false });
        break;
      case "UNKNOWN":
        // Several strangers in one frame arrive as separate rows; keep one moment.
        if (prev && prev.kind === "unknown" && t(e) - prevEvent < PAIR_MS) break;
        out.push({ id: e.id, kind: "unknown", at: e.createdAt, personId: null, personName: null, text: e.text, spoken: null, repeat: false, trigger: flag(e.data, "trigger"), chat: false });
        break;
      case "QUESTION":
        out.push({ id: e.id, kind: "exchange", at: e.createdAt, personId: null, personName: null, text: e.text, spoken: null, repeat: flag(e.data, "repeat"), trigger: false, chat: source(e.data) === "chat" });
        break;
      case "ANSWER":
        if (prev && prev.kind === "exchange" && prev.spoken === null && t(e) - prevEvent < ANSWER_MS) {
          prev.spoken = e.text;
          break;
        }
        out.push({ id: e.id, kind: "exchange", at: e.createdAt, personId: null, personName: null, text: "", spoken: e.text, repeat: false, trigger: false, chat: source(e.data) === "chat" });
        break;
      case "REMINDER":
        out.push({ id: e.id, kind: "reminder", at: e.createdAt, personId: null, personName: null, text: e.text, spoken: e.text, repeat: false, trigger: false, chat: false });
        break;
      case "SPOKEN": {
        const src = source(e.data);
        // The spoken line belongs to the moment just before it: a recognition, a stranger, a reminder, or an answer.
        if (prev && t(e) - prevEvent < PAIR_MS) {
          if ((prev.kind === "recognition" || prev.kind === "unknown") && prev.spoken === null) {
            prev.spoken = e.text;
            break;
          }
          if (prev.kind === "reminder" && src === "reminder") break;
          if (prev.kind === "exchange" && prev.spoken === e.text) break;
        }
        // A spoken line for several people at once (glasses button) may follow more than one recognition.
        if (flag(e.data, "trigger")) {
          for (let i = out.length - 1; i >= 0 && t(e) - new Date(out[i].at).getTime() < PAIR_MS; i--) {
            if ((out[i].kind === "recognition" || out[i].kind === "unknown") && out[i].spoken === null) out[i].spoken = e.text;
          }
          if (out.some((m) => m.spoken === e.text && t(e) - new Date(m.at).getTime() < PAIR_MS)) break;
        }
        out.push({ id: e.id, kind: "spoken", at: e.createdAt, personId: e.personId, personName: e.personName, text: e.text, spoken: e.text, repeat: false, trigger: flag(e.data, "trigger"), chat: src === "chat" });
        break;
      }
      case "UTTERANCE":
        out.push({ id: e.id, kind: "heard", at: e.createdAt, personId: null, personName: null, text: e.text, spoken: null, repeat: false, trigger: false, chat: false });
        break;
      case "PRACTICE":
        out.push({ id: e.id, kind: "remembered", at: e.createdAt, personId: e.personId, personName: e.personName, text: e.text, spoken: null, repeat: false, trigger: false, chat: false });
        break;
      default:
        out.push({ id: e.id, kind: "spoken", at: e.createdAt, personId: e.personId, personName: e.personName, text: e.text, spoken: null, repeat: false, trigger: false, chat: false });
    }
  }
  return out.reverse();
}
