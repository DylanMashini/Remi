import { AnswerIcon, BellIcon, ChatIcon, MemoryIcon, PersonIcon, QuestionIcon, SpeakerIcon } from "./icons";
import { HorizonMark } from "./Logo";

export type EventKind = "RECOGNITION" | "UNKNOWN" | "UTTERANCE" | "QUESTION" | "ANSWER" | "REMINDER" | "SPOKEN" | "PRACTICE";

/** Event JSON as returned by GET /api/events and the /api/stream SSE feed. */
export type EventJson = {
  id: string;
  type: EventKind;
  text: string;
  personId: string | null;
  personName: string | null;
  data: unknown;
  createdAt: string;
};

const KINDS: Record<EventKind, { label: string; Icon: typeof PersonIcon; tone: string }> = {
  RECOGNITION: { label: "Recognized", Icon: PersonIcon, tone: "bg-apricot-mist text-apricot-deep" },
  UNKNOWN: { label: "Someone new", Icon: PersonIcon, tone: "bg-attention-bg text-attention" },
  UTTERANCE: { label: "Conversation", Icon: ChatIcon, tone: "bg-sand text-ink" },
  QUESTION: { label: "Asked Remi", Icon: QuestionIcon, tone: "bg-sand text-ink" },
  ANSWER: { label: "Remi answered", Icon: AnswerIcon, tone: "bg-dusk-mist text-dusk-deep" },
  REMINDER: { label: "Remi reminded", Icon: BellIcon, tone: "bg-dusk-mist text-dusk-deep" },
  SPOKEN: { label: "Remi said", Icon: SpeakerIcon, tone: "bg-dusk text-white" },
  PRACTICE: { label: "Remembered", Icon: MemoryIcon, tone: "bg-apricot-mist text-apricot-deep" },
};

export function kindOf(type: string) {
  return KINDS[type as EventKind] ?? KINDS.UTTERANCE;
}

export function isRepeat(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { repeat?: unknown }).repeat === true;
}

/** PRACTICE events: a visit (knew / was told) or a kept memory. */
export function practiceKind(data: unknown): "knew" | "told" | "memory" {
  const d = (typeof data === "object" && data !== null ? data : {}) as { kind?: unknown; knew?: unknown };
  if (d.kind === "memory") return "memory";
  return d.knew === true ? "knew" : "told";
}

/** Human label for an event, e.g. "Remi said" or "Recognized Sarah". Remi is named, never "the glasses". */
export function eventTitle(type: string, patientName: string, personName?: string | null, data?: unknown): string {
  switch (type) {
    case "PRACTICE": {
      const kind = practiceKind(data);
      const who = personName ?? "someone";
      if (kind === "memory") {
        const source = (data as { source?: string } | null)?.source;
        return source === "CAREGIVER" ? `A memory of ${who} was added` : `${patientName} shared a memory of ${who}`;
      }
      return kind === "knew" ? `${patientName} knew ${who}` : `${patientName} was reminded of ${who}`;
    }
    case "SPOKEN":
      return (data as { trigger?: unknown } | null)?.trigger ? `${patientName} asked Remi who was here` : "Remi said";
    case "RECOGNITION":
      return personName ? `Recognized ${personName}` : "Recognized someone";
    case "UNKNOWN":
      return "Someone new was here";
    case "QUESTION":
      return `${patientName} asked Remi`;
    case "ANSWER":
      return "Remi answered";
    case "REMINDER":
      return "Remi reminded";
    case "UTTERANCE":
      return "Conversation";
    default:
      return kindOf(type).label;
  }
}

/** SPOKEN rows carry the horizon mark: it is Remi's own avatar. Everything else keeps its icon. */
export function EventIcon({ type, size = 40 }: { type: string; size?: number }) {
  const { Icon, tone } = kindOf(type);
  if (type === "SPOKEN") {
    return (
      <div style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-sm bg-dusk-mist">
        <HorizonMark size={Math.round(size * 0.55)} />
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-sm ${tone}`}
    >
      <Icon size={Math.round(size * 0.5)} />
    </div>
  );
}
