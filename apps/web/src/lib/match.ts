import { prisma } from "@/lib/prisma";
import type { DetectedFace } from "@/lib/face";

export const MATCH_THRESHOLD = 0.5;
const KNOWN_DEBOUNCE_MS = 5 * 60 * 1000;
const UNKNOWN_DEBOUNCE_MS = 60 * 1000;

/** `memory` is the newest memory marked "say this", already distilled into one sentence. */
export type RosterPerson = { id: string; name: string; relationship: string | null; notes: string | null; memory: string | null };
type Sample = { person: RosterPerson; embedding: Float32Array };

// In-memory caches live on globalThis so they survive dev hot reloads.
const g = globalThis as unknown as {
  __recallSamples?: Map<string, Promise<Sample[]>>;
  __recallDebounce?: Map<string, Map<string, number>>;
};
const sampleCache = (g.__recallSamples ??= new Map());
const debounce = (g.__recallDebounce ??= new Map());

async function loadSamples(patientId: string): Promise<Sample[]> {
  const rows = await prisma.faceSample.findMany({
    where: { person: { patientId } },
    select: {
      embedding: true,
      person: {
        select: {
          id: true,
          name: true,
          relationship: true,
          notes: true,
          memories: { where: { useInCallout: true }, orderBy: { createdAt: "desc" }, take: 1, select: { calloutText: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    person: {
      id: r.person.id,
      name: r.person.name,
      relationship: r.person.relationship,
      notes: r.person.notes,
      memory: r.person.memories[0]?.calloutText ?? null,
    },
    embedding: Float32Array.from(r.embedding),
  }));
}

function samplesFor(patientId: string): Promise<Sample[]> {
  let p = sampleCache.get(patientId);
  if (!p) {
    p = loadSamples(patientId);
    p.catch(() => sampleCache.delete(patientId));
    sampleCache.set(patientId, p);
  }
  return p;
}

/** Call after enrolling, editing, or deleting anyone in this patient's roster, or changing their memories. */
export function invalidateRoster(patientId: string) {
  sampleCache.delete(patientId);
}

/** Embeddings are L2-normalized, so cosine similarity is the dot product. */
function dot(a: Float32Array, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export type FaceMatch = {
  box: [number, number, number, number];
  score: number;
  person: RosterPerson | null; // null when below threshold
};

/** Matches each detected face against the enrolled roster only (no stranger search). */
export async function matchFaces(patientId: string, faces: DetectedFace[]): Promise<FaceMatch[]> {
  const samples = await samplesFor(patientId);
  return faces.map((face) => {
    // A person's score is their best sample.
    const best = new Map<string, { person: RosterPerson; score: number }>();
    for (const s of samples) {
      const score = dot(s.embedding, face.embedding);
      const cur = best.get(s.person.id);
      if (!cur || score > cur.score) best.set(s.person.id, { person: s.person, score });
    }
    let top: { person: RosterPerson; score: number } | null = null;
    for (const candidate of best.values()) if (!top || candidate.score > top.score) top = candidate;
    const score = top ? Math.round(top.score * 1000) / 1000 : 0;
    return {
      box: face.box.map((v) => Math.round(v)) as [number, number, number, number],
      score,
      person: top && top.score >= MATCH_THRESHOLD ? top.person : null,
    };
  });
}

/** Returns true (and records the time) if this key has not been announced within the window. */
function claim(patientId: string, key: string, windowMs: number): boolean {
  let m = debounce.get(patientId);
  if (!m) debounce.set(patientId, (m = new Map()));
  const now = Date.now();
  const last = m.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  m.set(key, now);
  return true;
}

export function shouldAnnouncePerson(patientId: string, personId: string) {
  return claim(patientId, `p:${personId}`, KNOWN_DEBOUNCE_MS);
}

export function shouldAnnounceUnknown(patientId: string) {
  return claim(patientId, "unknown", UNKNOWN_DEBOUNCE_MS);
}

/** Forget debounce state for one person (e.g. after deleting them). */
export function clearDebounce(patientId: string, personId?: string) {
  if (!personId) debounce.delete(patientId);
  else debounce.get(patientId)?.delete(`p:${personId}`);
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * "This is {name}, your {relationship}. {notes} {memory}" with missing parts omitted.
 * The same words every time for the same person: consistency is comfort.
 */
export function knownLine(p: { name: string; relationship?: string | null; notes?: string | null; memory?: string | null }): string {
  const rel = p.relationship?.trim();
  const parts = [rel ? `This is ${p.name.trim()}, your ${rel}.` : `This is ${p.name.trim()}.`];
  if (p.notes) parts.push(sentence(p.notes));
  if (p.memory) parts.push(sentence(p.memory));
  return parts.filter(Boolean).join(" ");
}

export const UNKNOWN_LINE = "Someone new is here.";
