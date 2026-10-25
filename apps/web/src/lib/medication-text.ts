/**
 * Client-safe medication helpers (no database import): the dose-time presets, formatting, and
 * the exact words Remi says. `lib/medications.ts` holds the server side.
 */

/** Names for the common dose times. The picker offers these; anything else is a custom time. */
export const DOSE_PRESETS: { time: string; label: string }[] = [
  { time: "08:00", label: "Morning" },
  { time: "12:00", label: "Midday" },
  { time: "18:00", label: "Evening" },
  { time: "21:00", label: "Bedtime" },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClockTime(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/** "08:00" -> "8:00 AM". */
export function formatClockTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "8:00 AM and 8:00 PM" / "8:00 AM, 12:00 PM and 6:00 PM". */
export function describeTimes(times: string[]): string {
  const t = [...times].sort().map(formatClockTime);
  if (t.length === 0) return "No times set";
  if (t.length === 1) return t[0];
  return `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The words Remi says for a dose. Short, warm, declarative; one fact per sentence.
 * "It is time for your Donepezil, one tablet. Take it with breakfast."
 */
export function medicationLine(m: { name: string; dose?: string | null; instructions?: string | null }): string {
  const dose = m.dose?.trim();
  const first = dose ? `It is time for your ${m.name.trim()}, ${dose}.` : `It is time for your ${m.name.trim()}.`;
  const rest = m.instructions ? sentence(m.instructions) : "";
  return [first, rest].filter(Boolean).join(" ");
}

export type DoseStatus = "upcoming" | "due" | "said" | "taken" | "skipped" | "missed-setup";

export const DOSE_STATUS_LABEL: Record<DoseStatus, string> = {
  upcoming: "Coming up",
  due: "Due now",
  said: "Remi said it",
  taken: "Taken",
  skipped: "Skipped",
  "missed-setup": "Added after this time",
};
