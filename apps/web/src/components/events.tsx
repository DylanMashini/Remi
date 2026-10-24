import { AnswerIcon, BellIcon, ChatIcon, PersonIcon, QuestionIcon, SpeakerIcon } from "./icons";

export type EventKind = "RECOGNITION" | "UNKNOWN" | "UTTERANCE" | "QUESTION" | "ANSWER" | "REMINDER" | "SPOKEN";

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
  RECOGNITION: { label: "Recognized", Icon: PersonIcon, tone: "bg-harbor-mist text-harbor-deep" },
  UNKNOWN: { label: "Someone new", Icon: PersonIcon, tone: "bg-attention-bg text-attention" },
  UTTERANCE: { label: "Conversation", Icon: ChatIcon, tone: "bg-sand text-ink" },
  QUESTION: { label: "Asked", Icon: QuestionIcon, tone: "bg-sand text-ink" },
  ANSWER: { label: "Answered", Icon: AnswerIcon, tone: "bg-harbor-mist text-harbor-deep" },
  REMINDER: { label: "Reminder", Icon: BellIcon, tone: "bg-sand text-ink" },
  SPOKEN: { label: "Heard", Icon: SpeakerIcon, tone: "bg-harbor text-white" },
};

export function kindOf(type: string) {
  return KINDS[type as EventKind] ?? KINDS.UTTERANCE;
}

export function isRepeat(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { repeat?: unknown }).repeat === true;
}

/** Human label for an event, e.g. "Ruth heard" or "Recognized Sarah". */
export function eventTitle(type: string, patientName: string, personName?: string | null): string {
  switch (type) {
    case "SPOKEN":
      return `${patientName} heard`;
    case "RECOGNITION":
      return personName ? `Recognized ${personName}` : "Recognized someone";
    case "UNKNOWN":
      return "Someone new was here";
    case "QUESTION":
      return `${patientName} asked`;
    case "ANSWER":
      return "Recall answered";
    case "REMINDER":
      return "Reminder";
    case "UTTERANCE":
      return "Conversation";
    default:
      return kindOf(type).label;
  }
}

export function EventIcon({ type, size = 40 }: { type: string; size?: number }) {
  const { Icon, tone } = kindOf(type);
  return (
    <div
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-sm ${tone}`}
    >
      <Icon size={Math.round(size * 0.5)} />
    </div>
  );
}
