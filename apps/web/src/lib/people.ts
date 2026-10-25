import { prisma } from "@/lib/prisma";
import { knownLine } from "@/lib/line";
import { serializeMemory, type MemoryJson } from "@/lib/memories";
import { speechIdFor, withoutAudioTags } from "@/lib/tts";

/** Shape of a person in `GET /api/people` and `GET /api/people/[id]` (see CONTRACT.md). */
export type PersonJson = {
  id: string;
  name: string;
  relationship: string | null;
  notes: string | null;
  avatarUrl: string | null;
  /** Full enrollment photo, for the Remember portrait. */
  photoUrl: string | null;
  /** Every enrollment photo (oldest first); the phone embeds these for on-device recognition. */
  photoUrls: string[];
  /** Number of enrollment photos (the phone embeds each one for on-device recognition). */
  photoCount: number;
  lastSeenAt: string | null;
  /** The exact sentence Remi says when this person walks up. */
  line: string;
  /** `/api/speech/<speechId>` is the ElevenLabs audio for `line`; minting it here prewarms the server cache. */
  speechId: string;
  memoryCount: number;
  lastRememberedAt: string | null;
};

export type PersonDetailJson = PersonJson & {
  memories: MemoryJson[];
  /** Remember visits, newest first: knew = said "Yes, I know them". */
  visits: { id: string; knew: boolean; at: string }[];
};

const personSelect = {
  id: true,
  name: true,
  relationship: true,
  notes: true,
  avatarFileId: true,
  files: { where: { kind: "FACE_PHOTO" as const }, orderBy: { createdAt: "asc" as const }, select: { id: true } },
  _count: { select: { memories: true } },
  memories: { where: { useInCallout: true }, orderBy: { createdAt: "desc" as const }, take: 1, select: { calloutText: true } },
} as const;

type PersonRow = {
  id: string;
  name: string;
  relationship: string | null;
  notes: string | null;
  avatarFileId: string | null;
  files: { id: string }[];
  _count: { memories: number };
  memories: { calloutText: string }[];
};

function toJson(p: PersonRow, lastSeen: Date | null | undefined, lastRemembered: Date | null | undefined): PersonJson {
  const line = knownLine({ ...p, memory: p.memories[0]?.calloutText ?? null });
  return {
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    notes: p.notes,
    avatarUrl: p.avatarFileId ? `/api/files/${p.avatarFileId}` : null,
    photoUrl: p.files[0] ? `/api/files/${p.files[0].id}` : p.avatarFileId ? `/api/files/${p.avatarFileId}` : null,
    photoUrls: p.files.map((f) => `/api/files/${f.id}`),
    photoCount: p.files.length,
    lastSeenAt: lastSeen?.toISOString() ?? null,
    line: withoutAudioTags(line),
    speechId: speechIdFor(line),
    memoryCount: p._count.memories,
    lastRememberedAt: lastRemembered?.toISOString() ?? null,
  };
}

async function lastEventByPerson(patientId: string, type: "RECOGNITION" | "PRACTICE") {
  const rows = await prisma.event.groupBy({
    by: ["personId"],
    where: { patientId, type, personId: { not: null } },
    _max: { createdAt: true },
  });
  return new Map(rows.map((r) => [r.personId, r._max.createdAt]));
}

export async function listPeople(patientId: string): Promise<PersonJson[]> {
  const [people, seen, remembered] = await Promise.all([
    prisma.person.findMany({ where: { patientId }, orderBy: { createdAt: "asc" }, select: personSelect }),
    lastEventByPerson(patientId, "RECOGNITION"),
    lastEventByPerson(patientId, "PRACTICE"),
  ]);
  return people.map((p) => toJson(p, seen.get(p.id), remembered.get(p.id)));
}

export async function getPerson(patientId: string, id: string): Promise<PersonDetailJson | null> {
  const person = await prisma.person.findFirst({ where: { id, patientId }, select: personSelect });
  if (!person) return null;
  const [lastSeen, memories, visits] = await Promise.all([
    prisma.event.findFirst({ where: { patientId, personId: id, type: "RECOGNITION" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.memory.findMany({ where: { personId: id }, orderBy: { createdAt: "desc" } }),
    prisma.event.findMany({
      where: { patientId, personId: id, type: "PRACTICE", data: { path: ["kind"], equals: "visit" } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, data: true, createdAt: true },
    }),
  ]);
  return {
    ...toJson(person, lastSeen?.createdAt, visits[0]?.createdAt),
    memories: memories.map(serializeMemory),
    visits: visits.map((v) => ({ id: v.id, knew: knewFrom(v.data), at: v.createdAt.toISOString() })),
  };
}

export function knewFrom(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { knew?: unknown }).knew === true;
}
