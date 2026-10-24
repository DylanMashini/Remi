import { prisma } from "@/lib/prisma";
import type { EventType, Prisma } from "@/generated/prisma/client";

export type EventJson = {
  id: string;
  type: EventType;
  text: string;
  personId: string | null;
  personName: string | null;
  data: unknown;
  createdAt: string;
};

export const eventInclude = { person: { select: { name: true } } } as const;

type EventWithPerson = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

export function serializeEvent(e: EventWithPerson): EventJson {
  return {
    id: e.id,
    type: e.type,
    text: e.text,
    personId: e.personId,
    personName: e.person?.name ?? null,
    data: e.data ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Writes one row to the memory log. Everything seen, heard, and said goes through here. */
export async function logEvent(
  patientId: string,
  type: EventType,
  text: string,
  opts: { personId?: string | null; data?: Prisma.InputJsonValue } = {},
) {
  const event = await prisma.event.create({
    data: { patientId, type, text, personId: opts.personId ?? null, data: opts.data },
  });
  console.log(`[event] ${type}${opts.personId ? ` person=${opts.personId}` : ""}: ${text}`);
  return event;
}
