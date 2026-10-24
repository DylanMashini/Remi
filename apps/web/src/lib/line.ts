/**
 * The words the glasses say. Face matching happens on the phone (Core ML in
 * `apps/mobile/modules/glasses`); the server only builds the sentence and logs the moment.
 */

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * "This is {name}, your {relationship}. {notes} {memory}" with missing parts omitted.
 * The same words every time for the same person: consistency is comfort.
 * `memory` is the newest memory marked "say this", already distilled into one sentence.
 */
export function knownLine(p: { name: string; relationship?: string | null; notes?: string | null; memory?: string | null }): string {
  const rel = p.relationship?.trim();
  const parts = [rel ? `This is ${p.name.trim()}, your ${rel}.` : `This is ${p.name.trim()}.`];
  if (p.notes) parts.push(sentence(p.notes));
  if (p.memory) parts.push(sentence(p.memory));
  return parts.filter(Boolean).join(" ");
}

export const UNKNOWN_LINE = "Someone new is here.";
