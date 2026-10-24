/** Small date and text helpers shared by the screens. All times are the phone's local time. */

export function timeOf(input: number | string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function isToday(d: Date): boolean {
  return d.toDateString() === new Date().toDateString();
}

export function longDate(d: Date = new Date()): string {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** "Today at 2:14 PM", "Yesterday at 9:05 AM", "Oct 18 at 4:00 PM". */
export function whenText(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = isToday(d)
    ? 'Today'
    : d.toDateString() === yesterday.toDateString()
      ? 'Yesterday'
      : shortDate(d);
  return `${day} at ${timeOf(d)}`;
}

/** "Seen today at 2:14 PM" or "Not seen yet". */
export function lastSeenText(iso: string | null): string {
  if (!iso) return 'Not seen yet';
  return `Seen ${whenText(iso).replace(/^(\w)/, (c) => c.toLowerCase())}`;
}

/** A time-of-day greeting for the Today screen. */
export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Builds the sentence the glasses say for a known person, the same way the server does:
 * name, relationship, the caregiver's note, then the newest memory switched on.
 */
export function introductionLine(p: { name: string; relationship?: string | null; notes?: string | null; memory?: string | null }): string {
  const parts = [p.relationship?.trim() ? `This is ${p.name.trim()}, your ${p.relationship.trim()}.` : `This is ${p.name.trim()}.`];
  if (p.notes?.trim()) parts.push(sentence(p.notes));
  if (p.memory?.trim()) parts.push(sentence(p.memory));
  return parts.join(' ');
}

/** "Just now", "12 minutes ago", "3 hours ago", "Yesterday", "Oct 18". */
export function agoText(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return shortDate(new Date(iso));
}

/** Strips scheme and path from a URL for display. */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}
