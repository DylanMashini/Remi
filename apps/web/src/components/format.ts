// Formatting helpers shared by server and client components. The demo runs in Eastern time.
export const TIME_ZONE = "America/New_York";

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIME_ZONE });
const shortDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE });

export function formatTime(d: Date | string): string {
  return timeFmt.format(new Date(d));
}

export function formatDayHeading(d: Date): string {
  return dayFmt.format(d).toUpperCase();
}

/** "2:14 PM" if the same day as `now`, otherwise "Oct 18, 2:14 PM". */
export function formatWhen(d: Date | string, now: Date): string {
  const date = new Date(d);
  if (dayKeyFmt.format(date) === dayKeyFmt.format(now)) return timeFmt.format(date);
  return `${shortDayFmt.format(date)}, ${timeFmt.format(date)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The exact line the glasses say for a known person (matches CONTRACT.md). */
export function knownLine(p: { name: string; relationship?: string | null; notes?: string | null }): string {
  const parts = [p.relationship ? `This is ${p.name}, your ${p.relationship}.` : `This is ${p.name}.`];
  if (p.notes?.trim()) parts.push(p.notes.trim());
  return parts.join(" ");
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
