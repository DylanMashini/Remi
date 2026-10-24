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
};

export type Face = {
  box: [number, number, number, number];
  personId?: string;
  name?: string;
  relationship?: string;
  score?: number;
};

export type Speak = { speechId: string; text: string };

export type FrameResult = {
  faces: Face[];
  speak?: Speak;
  frameWidth: number;
  frameHeight: number;
};

type Events = {
  onStatus: GlassesStatus;
  onFrameResult: FrameResult;
  onAudioRoute: { route: AudioRoute; portName: string };
  onSpoken: { text: string; route: string };
  onError: { message: string };
};

type Subscription = { remove: () => void };

type NativeGlasses = {
  configure?: (opts: { backendUrl: string; token: string }) => Promise<void>;
  register?: () => Promise<void>;
  startStream?: (opts?: { mock?: boolean }) => Promise<void>;
  stopStream?: () => Promise<void>;
  getStatus?: () => Promise<GlassesStatus>;
  enrollPerson?: (p: {
    name: string;
    relationship?: string;
    notes?: string;
    photoUris: string[];
  }) => Promise<{ personId: string; photos: number }>;
  captureGlassesPhoto?: () => Promise<string>;
  startAsk?: () => Promise<void>;
  stopAsk?: () => Promise<{ question: string; answer: string }>;
  startListening?: () => Promise<void>;
  stopListening?: () => Promise<{ text: string }>;
  speak?: (speechId: string, text: string) => Promise<void>;
  syncRoster?: () => Promise<{ people: number; samples: number }>;
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
  enrollPerson: (p: { name: string; relationship?: string; notes?: string; photoUris: string[] }) =>
    call('enrollPerson')(p),
  captureGlassesPhoto: () => call('captureGlassesPhoto')(),
  startAsk: () => call('startAsk')(),
  stopAsk: () => call('stopAsk')(),
  /** Mic capture for a memory; stopListening uploads to /api/transcribe and returns the words. */
  startListening: () => call('startListening')(),
  stopListening: () => call('stopListening')(),
  speak: (speechId: string, text: string) => call('speak')(speechId, text),
  /** Re-embed everyone's enrollment photos on the phone (faces are matched on-device). */
  syncRoster: () => call('syncRoster')(),
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
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong.';
}
