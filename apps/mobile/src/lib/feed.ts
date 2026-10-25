/**
 * App-wide live state fed by glasses events and the reminder poller, so the Live screen keeps
 * its state across tab switches. Everything spoken lands in `spoken` (clarity: shown on screen).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import {
  addGlassesListener,
  defaultStatus,
  errorMessage,
  Glasses,
  type ChatState,
  type Face,
  type GlassesStatus,
} from '@/lib/glasses';
import { apiFetch, readError } from '@/lib/session';

export type SpokenSource = 'recognition' | 'answer' | 'reminder';

export type SpokenLine = {
  id: string;
  text: string;
  source: SpokenSource;
  at: number;
  route?: string; // filled when onSpoken arrives
  /** -1 (left) to 1 (right): the side of the frame the recognized face was on. */
  pan?: number;
  question?: string; // for answers
};

/** Which ear a line was whispered into, for the screen. Null when centred or unknown. */
export function panSide(pan?: number): 'left' | 'right' | null {
  if (pan == null) return null;
  if (pan <= -0.2) return 'left';
  if (pan >= 0.2) return 'right';
  return null;
}

/** The live conversation as the screen shows it. `idle` when none is running. */
export type Chat = {
  state: ChatState | 'idle';
  sessionId: string | null;
  /** What the wearer is saying (partial until the turn is transcribed). */
  user: string;
  /** What the glasses are saying (grows as the model speaks). */
  assistant: string;
  turns: number;
  /** Why the last conversation ended ("stopped", "idle", "error"). */
  endedReason: string | null;
  /** How the current session detects turns, for the screen's hint. */
  silenceMs: number;
  /** "phone" (Ask Remi button) or "wake" ("Hey Remi" heard on the phone). */
  trigger: 'phone' | 'wake';
};

export const idleChat: Chat = { state: 'idle', sessionId: null, user: '', assistant: '', turns: 0, endedReason: null, silenceMs: 0, trigger: 'phone' };

export type Feed = {
  status: GlassesStatus;
  chat: Chat;
  portName: string | null;
  faces: Face[];
  frameWidth: number;
  frameHeight: number;
  lastFrameAt: number;
  spoken: SpokenLine[]; // newest first
  reminder: { id: string; text: string; at: number } | null;
  error: { message: string; at: number } | null;
};

let state: Feed = {
  status: defaultStatus,
  chat: idleChat,
  portName: null,
  faces: [],
  frameWidth: 504,
  frameHeight: 896,
  lastFrameAt: 0,
  spoken: [],
  reminder: null,
  error: null,
};

const subs = new Set<() => void>();

function set(patch: Partial<Feed>) {
  state = { ...state, ...patch };
  subs.forEach((s) => s());
}

export function getFeed(): Feed {
  return state;
}

export function useFeed(): Feed {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state
  );
}

let seq = 0;
export function pushSpoken(text: string, source: SpokenSource, extra: Partial<SpokenLine> = {}) {
  const line: SpokenLine = { id: `${Date.now()}-${seq++}`, text, source, at: Date.now(), ...extra };
  set({ spoken: [line, ...state.spoken].slice(0, 30) });
}

export function setStatus(status: GlassesStatus) {
  set({ status });
}

/**
 * Re-reads the module's status after a call that changes it (start/stop stream, wake word).
 * The Swift module emits onStatus before those calls resolve, so this only confirms; callers must
 * never spread a render-time snapshot over the store, which replaces fresh connection/audioRoute
 * values with stale ones.
 */
export async function refreshStatus() {
  try {
    set({ status: await Glasses.getStatus() });
  } catch (e) {
    console.warn('[feed] getStatus failed:', errorMessage(e));
  }
}

export function reportError(e: unknown) {
  set({ error: { message: errorMessage(e), at: Date.now() } });
}

export function clearError() {
  set({ error: null });
}

export function dismissReminder() {
  set({ reminder: null });
}

function setChat(patch: Partial<Chat>) {
  set({ chat: { ...state.chat, ...patch } });
}

/** Starts a live conversation. Resolves once the socket is opening; progress arrives via onChat. */
export async function startChat() {
  setChat({ ...idleChat, state: 'connecting', trigger: 'phone' });
  try {
    const r = await Glasses.startChat();
    setChat({ sessionId: r.sessionId, silenceMs: r.silenceMs });
    return r;
  } catch (e) {
    setChat({ state: 'idle' });
    throw e;
  }
}

export async function stopChat() {
  try {
    await Glasses.stopChat();
  } finally {
    if (state.chat.state !== 'idle') setChat({ state: 'ended', endedReason: 'stopped', user: '', assistant: '' });
  }
}

/** Back to the resting screen after a conversation has ended. */
export function clearChat() {
  set({ chat: idleChat });
}

/** Subscribe to every glasses event while mounted. Mount once, in the signed-in layout. */
export function useGlassesFeed() {
  useEffect(() => {
    const subsList = [
      addGlassesListener('onStatus', (status) => set({ status: { ...state.status, ...status } })),
      addGlassesListener('onFrameResult', (r) => {
        set({
          faces: r.faces ?? [],
          frameWidth: r.frameWidth || state.frameWidth,
          frameHeight: r.frameHeight || state.frameHeight,
          lastFrameAt: Date.now(),
        });
        if (r.speak?.text) pushSpoken(r.speak.text, 'recognition', { pan: r.speak.pan });
      }),
      addGlassesListener('onAudioRoute', ({ route, portName }) =>
        set({ status: { ...state.status, audioRoute: route }, portName })
      ),
      addGlassesListener('onSpoken', ({ text, route, pan }) => {
        // Attach the actual route (and side) to the newest matching line, or log it if we never saw it.
        const idx = state.spoken.findIndex((l) => l.text === text && !l.route);
        if (idx >= 0) {
          const spoken = state.spoken.slice();
          spoken[idx] = { ...spoken[idx], route, pan };
          set({ spoken });
        } else {
          pushSpoken(text, 'recognition', { route, pan });
        }
      }),
      addGlassesListener('onError', ({ message }) => reportError(message)),
      addGlassesListener('onWake', () => {
        // Swift is starting the conversation itself; show it from the first moment.
        setChat({ ...idleChat, state: 'connecting', trigger: 'wake' });
      }),
      addGlassesListener('onChat', (ev) => {
        if (ev.kind === 'started') {
          setChat({ sessionId: ev.sessionId, silenceMs: ev.silenceMs, trigger: ev.trigger === 'wake' ? 'wake' : 'phone' });
        } else if (ev.kind === 'state') {
          if (ev.state === 'ended') {
            setChat({ state: 'ended', endedReason: ev.reason ?? 'ended', user: '', assistant: '' });
          } else if (ev.state === 'hearing') {
            // A new turn: the previous exchange has already landed in `spoken`.
            setChat({ state: 'hearing', user: '', assistant: '' });
          } else {
            setChat({ state: ev.state, sessionId: ev.sessionId });
          }
        } else if (ev.kind === 'transcript') {
          setChat(ev.role === 'user' ? { user: ev.text } : { assistant: ev.text });
        } else if (ev.kind === 'turn') {
          setChat({ turns: state.chat.turns + 1 });
          pushSpoken(ev.answer, 'answer', { question: ev.question || undefined, route: ev.route });
        }
      }),
    ];
    Glasses.getStatus()
      .then((s) => set({ status: s }))
      .catch((e) => console.warn('[feed] getStatus failed:', errorMessage(e)));
    return () => subsList.forEach((s) => s.remove());
  }, []);
}

/** Poll /api/reminders/due every 15 s while signed in and foregrounded; speak each one. */
export function useReminderPoller(token: string | null) {
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await apiFetch('/api/reminders/due', { token });
        if (!res.ok) throw new Error(`Reminders: ${await readError(res)}`);
        const body = (await res.json()) as {
          reminders?: { id: string; text: string; speechId: string }[];
        };
        for (const r of body.reminders ?? []) {
          set({ reminder: { id: r.id, text: r.text, at: Date.now() } });
          pushSpoken(r.text, 'reminder');
          try {
            await Glasses.speak(r.speechId, r.text);
          } catch (e) {
            reportError(e);
          }
        }
      } catch (e) {
        console.warn('[reminders]', errorMessage(e));
      } finally {
        inFlight = false;
      }
    };

    const start = () => {
      if (timer) return;
      poll();
      timer = setInterval(poll, 15000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [token]);
}
