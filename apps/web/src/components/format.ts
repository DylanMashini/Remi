// Formatting helpers shared by server and client components. The demo runs in Eastern time.
export const TIME_ZONE = "America/New_York";

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TIME_ZONE });
const shortDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE });

export function formatTime(d: Date | string): string {
  return timeFmt.format(new Date(d));
}

/** "Saturday, October 24". Sentence case, the same line the phone shows. */
export function formatDayHeading(d: Date): string {
  return dayFmt.format(d);
}

export function formatShortDay(d: Date | string): string {
  return shortDayFmt.format(new Date(d));
}

/** "Today at 2:14 PM", "Yesterday at 9:05 AM", "Oct 18 at 4:00 PM". */
export function formatWhenText(d: Date | string, now: Date): string {
  const date = new Date(d);
  const key = dayKeyFmt.format(date);
  if (key === dayKeyFmt.format(now)) return `Today at ${timeFmt.format(date)}`;
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === dayKeyFmt.format(y)) return `Yesterday at ${timeFmt.format(date)}`;
  return `${shortDayFmt.format(date)} at ${timeFmt.format(date)}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Day key in the demo time zone, e.g. "2026-10-24". */
export function dayKey(d: Date | string): string {
  return dayKeyFmt.format(new Date(d));
}

/** Weekday letter for a day key, e.g. "Sat". */
export function weekdayShort(d: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TIME_ZONE }).format(new Date(d));
}

/** "Good morning" / "Good afternoon" / "Good evening" in the demo time zone. */
export function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TIME_ZONE }).format(now));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The exact line the glasses say for a known person (matches lib/match.ts and CONTRACT.md). */
export function knownLine(p: { name: string; relationship?: string | null; notes?: string | null; memory?: string | null }): string {
  const parts = [p.relationship ? `This is ${p.name}, your ${p.relationship}.` : `This is ${p.name}.`];
  if (p.notes?.trim()) parts.push(sentence(p.notes));
  if (p.memory?.trim()) parts.push(sentence(p.memory));
  return parts.join(" ");
}

/** "Just now", "12 minutes ago", "3 hours ago", "Yesterday", "4 days ago". */
export function formatAgo(d: Date | string, now: Date): string {
  const ms = now.getTime() - new Date(d).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return shortDayFmt.format(new Date(d));
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
