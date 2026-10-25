/**
 * Thin, defensive wrapper around the local Swift module (modules/glasses).
 * Coded against CONTRACT.md "Swift module". If the native module or a function is missing
 * (old dev build, Expo Go, simulator), calls reject with a clear message instead of crashing.
 */
import type { ComponentType } from 'react';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ViewProps } from 'react-native';

export type AudioRoute = 'a2dp' | 'hfp' | 'speaker' | 'other';

export type GlassesStatus = {
  registration: 'unregistered' | 'registering' | 'registered';
  connection: 'disconnected' | 'connecting' | 'connected';
  streaming: boolean;
  audioRoute: AudioRoute;
  mock: boolean;
  /** On-device roster size (people, embedded photos). Older builds omit it. */
  rosterPeople?: number;
  rosterSamples?: number;
  /** "Hey Remi" listening is on. Older builds omit it. */
  wakeWord?: boolean;
};

export type Face = {
  box: [number, number, number, number];
  personId?: string;
  name?: string;
  relationship?: string;
  score?: number;
};

/** `pan` is -1 (left) to 1 (right): where the announced face sits in the frame. */
export type Speak = { speechId: string; text: string; pan: number };

export type FrameResult = {
  faces: Face[];
  speak?: Speak;
  frameWidth: number;
  frameHeight: number;
};

/** See CONTRACT.md "Photo library index". Phone-local; suggestions for enrollment only. */
export type PhotoIndexStatus = {
  permission: 'notDetermined' | 'denied' | 'limited' | 'authorized';
  state: 'idle' | 'indexing' | 'paused' | 'done';
  indexed: number;
  total: number;
  faces: number;
  skipped: number;
  upgraded: number;
  error?: string;
};

export type PhotoCandidate = { id: string; score: number; thumbUri: string; takenAt: string };

/** Live conversation (see CONTRACT.md "Live conversation"). */
export type ChatState = 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'ended';

export type ChatStartResult = {
  sessionId: string;
  model: string;
  voice: string;
  bargeIn: boolean;
  turnDetection: string;
  silenceMs: number;
  micSource: string;
  /** "phone" (Ask Remi button) or "wake" ("Hey Remi" heard). Older builds omit it. */
  trigger?: string;
};

export type ChatEvent =
  | { kind: 'state'; state: ChatState; reason?: string | null; sessionId: string }
  | ({ kind: 'started' } & ChatStartResult)
  | { kind: 'transcript'; role: 'user' | 'assistant'; text: string; final: boolean; sessionId: string }
  | { kind: 'turn'; question: string; answer: string; frame: boolean; route: string; sessionId: string };

export type EnrollInput = {
  name: string;
  relationship?: string;
  notes?: string;
  photoUris: string[];
  /** The first photo; other photos enroll the face closest to it (group shots). */
  seedPhotoUri?: string;
};

type Events = {
  onStatus: GlassesStatus;
  onPhotoIndex: PhotoIndexStatus;
  onFrameResult: FrameResult;
  onAudioRoute: { route: AudioRoute; portName: string };
  /** `pan` is -1 (left) to 1 (right): the side the line was heard from. */
  onSpoken: { text: string; route: string; pan: number };
  onError: { message: string };
  /** The wearer pressed a button on the glasses (capture = top right of the right temple). */
  onButton: { button: 'capture' | 'action' };
  /** Live conversation progress. */
  onChat: ChatEvent;
  /** "Hey Remi" was heard on the phone; a conversation is starting. */
  onWake: { keyword: string; source: string };
};

type Subscription = { remove: () => void };

type NativeGlasses = {
  configure?: (opts: { backendUrl: string; token: string }) => Promise<void>;
  register?: () => Promise<void>;
  startStream?: (opts?: { mock?: boolean }) => Promise<void>;
  stopStream?: () => Promise<void>;
  getStatus?: () => Promise<GlassesStatus>;
  enrollPerson?: (p: EnrollInput) => Promise<{ personId: string; photos: number }>;
  captureGlassesPhoto?: () => Promise<string>;
  startAsk?: () => Promise<void>;
  stopAsk?: () => Promise<{ question: string; answer: string; sawFrame?: boolean }>;
  startChat?: () => Promise<ChatStartResult>;
  stopChat?: () => Promise<{ ended: boolean; turns: number }>;
  setWakeWord?: (on: boolean) => Promise<{ enabled: boolean; phrase: string }>;
  startListening?: () => Promise<void>;
  stopListening?: () => Promise<{ text: string }>;
  speak?: (speechId: string, text: string) => Promise<void>;
  whoIsHere?: () => Promise<{ text: string | null }>;
  syncRoster?: () => Promise<{ people: number; samples: number }>;
  clearCooldown?: () => Promise<void>;
  photoIndexStatus?: () => Promise<PhotoIndexStatus>;
  photoIndexStart?: () => Promise<PhotoIndexStatus>;
  photoIndexPause?: () => Promise<PhotoIndexStatus>;
  photoIndexClear?: () => Promise<void>;
  photoIndexSearch?: (seedPhotoUri: string) => Promise<PhotoCandidate[]>;
  photoIndexExport?: (candidateId: string) => Promise<string>;
  addListener?: (event: string, listener: (payload: never) => void) => Subscription;
};

// Prefer the local package (it may export GlassesPreview); fall back to the raw native module.
let pkg: { default?: NativeGlasses; GlassesPreview?: ComponentType<ViewProps> } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pkg = require('../../modules/glasses');
} catch (e) {
  console.warn('[glasses] local module failed to load:', e instanceof Error ? e.message : e);
}

const native: NativeGlasses | null =
  pkg?.default ?? (requireOptionalNativeModule('Glasses') as NativeGlasses | null);

export const glassesAvailable = native != null;

/** True when this dev build's Swift module has a function (older builds may predate it). */
export function glassesHas(fn: keyof NativeGlasses): boolean {
  return typeof native?.[fn] === 'function';
}

function missing(fn: string): Error {
  return new Error(
    native
      ? `Glasses module has no ${fn}(). Rebuild the dev client with the latest Swift module.`
      : 'Glasses native module is not in this build. Run "pnpm ios:device" to rebuild.'
  );
}

function call<K extends keyof NativeGlasses>(fn: K): NonNullable<NativeGlasses[K]> {
  const f = native?.[fn];
  if (typeof f !== 'function') {
    return ((..._args: unknown[]) => Promise.reject(missing(String(fn)))) as never;
  }
  return (f as (...a: unknown[]) => unknown).bind(native) as never;
}

export const Glasses = {
  configure: (opts: { backendUrl: string; token: string }) => call('configure')(opts),
  register: () => call('register')(),
  /** mock=true runs the pipeline on MockDeviceKit with the phone's back camera (no glasses). */
  startStream: (opts?: { mock?: boolean }) => call('startStream')(opts),
  stopStream: () => call('stopStream')(),
  getStatus: () => call('getStatus')(),
  enrollPerson: (p: EnrollInput) => call('enrollPerson')(p),
  captureGlassesPhoto: () => call('captureGlassesPhoto')(),
  /** Mic capture for a question; stopAsk uploads the audio plus the latest glasses frame to /api/ask and speaks the answer. */
  startAsk: () => call('startAsk')(),
  stopAsk: () => call('stopAsk')(),
  /**
   * Live conversation: the phone streams the mic straight to OpenAI's Realtime API and plays the
   * answers over the glasses; the API decides when the wearer has finished speaking. Progress
   * arrives as onChat events. Ends on stopChat, after 90 s of silence, or on a connection failure.
   */
  startChat: () => call('startChat')(),
  stopChat: () => call('stopChat')(),
  /**
   * "Hey Remi": an on-device keyword spotter (sherpa-onnx) listens to the same mic audio while the
   * glasses stream and starts a conversation when it hears the phrase, with the words said right
   * after it. Nothing leaves the phone until then. Off by default; gate UI on glassesHas('setWakeWord').
   */
  setWakeWord: (on: boolean) => call('setWakeWord')(on),
  /** Mic capture for a memory; stopListening uploads to /api/transcribe and returns the words. */
  startListening: () => call('startListening')(),
  stopListening: () => call('stopListening')(),
  speak: (speechId: string, text: string) => call('speak')(speechId, text),
  /**
   * What the glasses' capture button does: name everyone in view right now (cooldown ignored) or
   * say nobody is there. Resolves with the words spoken (null if a press was already in flight).
   */
  whoIsHere: () => call('whoIsHere')(),
  /** Re-embed everyone's enrollment photos on the phone (faces are matched on-device). */
  syncRoster: () => call('syncRoster')(),
  /** Forget who was announced recently so the next sighting is spoken again at once (rehearsals, retakes). */
  clearCooldown: () => call('clearCooldown')(),
  /**
   * Photo library index (suggestions while adding a person). Built from this phone's own library,
   * stays on this phone, identical for caregiver and wearer accounts. Gate UI on
   * glassesHas('photoIndexStart') so older dev builds degrade to the plain flow.
   */
  photoIndexStatus: () => call('photoIndexStatus')(),
  photoIndexStart: () => call('photoIndexStart')(),
  photoIndexPause: () => call('photoIndexPause')(),
  photoIndexClear: () => call('photoIndexClear')(),
  photoIndexSearch: (seedPhotoUri: string) => call('photoIndexSearch')(seedPhotoUri),
  photoIndexExport: (candidateId: string) => call('photoIndexExport')(candidateId),
};

/** Subscribe to a module event; a no-op if the module or event emitter is missing. */
export function addGlassesListener<E extends keyof Events>(
  event: E,
  listener: (payload: Events[E]) => void
): Subscription {
  if (!native || typeof native.addListener !== 'function') return { remove: () => {} };
  try {
    return native.addListener(event, listener as (payload: never) => void);
  } catch (e) {
    console.warn(`[glasses] addListener(${event}) failed`, e);
    return { remove: () => {} };
  }
}

function resolvePreview(): ComponentType<ViewProps> | null {
  if (pkg?.GlassesPreview) return pkg.GlassesPreview;
  if (!native) return null;
  try {
    return requireNativeView<ViewProps>('Glasses');
  } catch (e) {
    console.warn('[glasses] GlassesPreview view unavailable', e);
    return null;
  }
}

/** Native frame preview component, or null when the build has no such view. */
export const GlassesPreviewView = resolvePreview();

export const defaultStatus: GlassesStatus = {
  registration: 'unregistered',
  connection: 'disconnected',
  streaming: false,
  audioRoute: 'other',
  mock: false,
  rosterPeople: 0,
  rosterSamples: 0,
  wakeWord: false,
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong.';
}

/**
 * After a person or their words change on the server, re-embed the roster on the phone so Remi says
 * the new words (or stops naming a deleted person) without waiting for the next stream start.
 * Fire-and-forget: a failure is logged, never shown, and the next stream start syncs anyway.
 */
export function resyncRoster(): void {
  if (!glassesHas('syncRoster')) return;
  Glasses.syncRoster().catch((e) => console.warn('[glasses] roster resync failed:', errorMessage(e)));
}
