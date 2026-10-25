/** Typed caregiver API calls (JSON only; bytes go through the Swift module). See CONTRACT.md. */
import { apiJson } from '@/lib/session';

export type Person = {
  id: string;
  name: string;
  relationship: string | null;
  notes: string | null;
  avatarUrl: string | null;
  /** Full enrollment photo, for the Remember portrait. */
  photoUrl: string | null;
  photoUrls?: string[];
  /** Number of enrollment photos. */
  photoCount: number;
  lastSeenAt: string | null;
  /** The exact sentence Remi says when this person walks up. */
  line: string;
  /** `/api/speech/<speechId>` is the ElevenLabs audio for `line` (the Swift module prefetches it). */
  speechId?: string;
  memoryCount: number;
  lastRememberedAt: string | null;
};

export type MemorySource = 'WEARER_VOICE' | 'WEARER_TYPED' | 'CAREGIVER';

export type Memory = {
  id: string;
  personId: string;
  /** The speaker's own words. */
  text: string;
  /** The one sentence the glasses may say. */
  calloutText: string;
  useInCallout: boolean;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
};

export type Visit = { id: string; knew: boolean; at: string };

export type PersonDetail = Person & { memories: Memory[]; visits: Visit[] };

export type EventType = 'RECOGNITION' | 'UNKNOWN' | 'UTTERANCE' | 'QUESTION' | 'ANSWER' | 'REMINDER' | 'SPOKEN' | 'PRACTICE';

export type EventJson = {
  id: string;
  type: EventType;
  text: string;
  personId: string | null;
  personName: string | null;
  data: { repeat?: boolean; score?: number; kind?: 'visit' | 'memory'; knew?: boolean; source?: MemorySource } | null;
  createdAt: string;
};

export type Reminder = {
  id: string;
  text: string;
  dueAt: string;
  firedAt: string | null;
  createdAt: string;
};

const id = (s: string) => encodeURIComponent(s);

export const api = {
  people: (token: string) => apiJson<{ people: Person[] }>('/api/people', { token }).then((b) => b.people ?? []),
  person: (token: string, personId: string) =>
    apiJson<{ person: PersonDetail }>(`/api/people/${id(personId)}`, { token }).then((b) => b.person),
  updatePerson: (token: string, personId: string, patch: { name?: string; relationship?: string | null; notes?: string | null }) =>
    apiJson<{ person: PersonDetail }>(`/api/people/${id(personId)}`, { method: 'PATCH', token, json: patch }).then((b) => b.person),
  deletePerson: (token: string, personId: string) =>
    apiJson<void>(`/api/people/${id(personId)}`, { method: 'DELETE', token }),

  addMemory: (token: string, personId: string, input: { text: string; calloutText?: string; source: MemorySource; useInCallout?: boolean }) =>
    apiJson<{ memory: Memory; usable: boolean }>(`/api/people/${id(personId)}/memories`, { method: 'POST', token, json: input }),
  updateMemory: (token: string, memoryId: string, patch: { text?: string; calloutText?: string; useInCallout?: boolean }) =>
    apiJson<{ memory: Memory }>(`/api/memories/${id(memoryId)}`, { method: 'PATCH', token, json: patch }).then((b) => b.memory),
  deleteMemory: (token: string, memoryId: string) =>
    apiJson<void>(`/api/memories/${id(memoryId)}`, { method: 'DELETE', token }),

  /** One step of a Remember visit. Returns the line Remi says and its speechId. */
  remember: (token: string, personId: string, knew: boolean) =>
    apiJson<{ line: string; speechId: string }>('/api/remember', { method: 'POST', token, json: { personId, knew } }),

  /** Newest events first. `types` filters server-side so chatty UTTERANCE/SPOKEN rows do not crowd out the ones shown. */
  events: (token: string, since?: Date, limit = 200, types?: EventType[]) =>
    apiJson<{ events: EventJson[] }>(
      `/api/events?limit=${limit}${since ? `&since=${encodeURIComponent(since.toISOString())}` : ''}${
        types?.length ? `&types=${types.join(',')}` : ''
      }`,
      { token }
    ).then((b) => b.events ?? []),
  deleteEvent: (token: string, eventId: string) =>
    apiJson<void>(`/api/events/${id(eventId)}`, { method: 'DELETE', token }),
  reminders: (token: string) =>
    apiJson<{ reminders: Reminder[] }>('/api/reminders', { token }).then((b) => b.reminders ?? []),
  addReminder: (token: string, text: string, dueAt: Date) =>
    apiJson<{ reminder: Reminder }>('/api/reminders', { method: 'POST', token, json: { text, dueAt: dueAt.toISOString() } }),
  deleteReminder: (token: string, reminderId: string) =>
    apiJson<void>(`/api/reminders/${id(reminderId)}`, { method: 'DELETE', token }),
};
