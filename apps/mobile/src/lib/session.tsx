import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { errorMessage, Glasses } from '@/lib/glasses';

const TOKEN_KEY = 'recall.token';
const BACKEND_KEY = 'recall.backendUrl';
// Set EXPO_PUBLIC_BACKEND_URL in apps/mobile/.env.local (the ngrok tunnel during dev, the real domain for the demo).
export const DEFAULT_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://192.168.1.10:3000';

type Session = {
  ready: boolean;
  token: string | null;
  backendUrl: string;
  userName: string | null;
  signIn: (backendUrl: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setBackendUrl: (url: string) => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

async function storeGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    console.warn('[session] read failed', key, errorMessage(e));
    return null;
  }
}

/** fetch with a timeout and a human error for unreachable backends. */
export async function apiFetch(
  backendUrl: string,
  path: string,
  init: RequestInit & { token?: string | null; timeoutMs?: number } = {}
): Promise<Response> {
  const { token, timeoutMs = 10000, headers, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${backendUrl}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new Error(
      `Can't reach ${backendUrl}. Is the Mac on the same hotspot and the server running?`
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // body was not JSON
  }
  return `Request failed (${res.status}).`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [backendUrl, setBackend] = useState(DEFAULT_BACKEND);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, b] = await Promise.all([storeGet(TOKEN_KEY), storeGet(BACKEND_KEY)]);
      if (!alive) return;
      const url = b ?? DEFAULT_BACKEND;
      setBackend(url);
      setToken(t);
      setReady(true);
      if (t) {
        Glasses.configure({ backendUrl: url, token: t }).catch((e) =>
          console.warn('[session] Glasses.configure failed:', errorMessage(e))
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setBackendUrl = useCallback(
    async (url: string) => {
      const u = normalizeUrl(url);
      setBackend(u);
      await SecureStore.setItemAsync(BACKEND_KEY, u);
      if (token) await Glasses.configure({ backendUrl: u, token });
    },
    [token]
  );

  const signIn = useCallback(async (url: string, email: string, password: string) => {
    const u = normalizeUrl(url);
    if (!u) throw new Error('Enter the backend URL.');
    const res = await apiFetch(u, '/api/auth/login?client=device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Wrong email or password.' : await readError(res));
    const body = (await res.json()) as { token?: string; user?: { name?: string; email?: string } };
    if (!body.token) throw new Error('Server did not return a device token.');
    await SecureStore.setItemAsync(BACKEND_KEY, u);
    await SecureStore.setItemAsync(TOKEN_KEY, body.token);
    setBackend(u);
    setUserName(body.user?.name ?? body.user?.email ?? null);
    try {
      await Glasses.configure({ backendUrl: u, token: body.token });
    } catch (e) {
      // Signed in anyway; the Live screen will show glasses errors.
      console.warn('[session] Glasses.configure failed:', errorMessage(e));
    }
    setToken(body.token);
  }, []);

  const signOut = useCallback(async () => {
    const t = token;
    setToken(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    Glasses.stopStream().catch(() => {});
    if (t) {
      apiFetch(backendUrl, '/api/auth/logout', { method: 'POST', token: t }).catch(() => {});
    }
  }, [token, backendUrl]);

  const value = useMemo(
    () => ({ ready, token, backendUrl, userName, signIn, signOut, setBackendUrl }),
    [ready, token, backendUrl, userName, signIn, signOut, setBackendUrl]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
