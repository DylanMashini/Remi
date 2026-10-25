/**
 * Who is signed in, and where the backend lives.
 *
 * The backend URL is fixed at build time from EXPO_PUBLIC_BACKEND_URL (apps/mobile/.env.local,
 * see .env.example). There is deliberately no in-app override: the wearer never configures
 * anything, and the caregiver should never see a URL field.
 */
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { errorMessage, Glasses } from '@/lib/glasses';
import { resumePhotoIndexIfAllowed } from '@/lib/photoIndex';

const TOKEN_KEY = 'recall.token';
const ACCOUNT_KEY = 'recall.account';

export const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/+$/, '');

export type Role = 'CAREGIVER' | 'WEARER';

export type Account = {
  name: string;
  email: string;
  role: Role;
  patient: { id: string; name: string };
};

type PublicUser = { id: string; email: string; name: string; role?: Role; patientId: string };

export type SignUpInput = {
  role: Role;
  name: string;
  patientName: string;
  email: string;
  password: string;
};

type Session = {
  ready: boolean;
  token: string | null;
  account: Account | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

async function storeGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    console.warn('[session] read failed', key, errorMessage(e));
    return null;
  }
}

/** fetch with a timeout and a human error for an unreachable backend. */
export async function apiFetch(
  path: string,
  init: RequestInit & { token?: string | null; timeoutMs?: number } = {}
): Promise<Response> {
  if (!BACKEND_URL) {
    throw new Error('This build has no server configured. Set EXPO_PUBLIC_BACKEND_URL and restart Metro.');
  }
  const { token, timeoutMs = 12000, headers, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BACKEND_URL}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new Error("Can't reach Remi right now. Check the connection and try again.");
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
  return `Something went wrong (${res.status}).`;
}

/** JSON request helper for caregiver calls. Throws a readable Error on any non-2xx. */
export async function apiJson<T>(
  path: string,
  init: RequestInit & { token?: string | null; json?: unknown } = {}
): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await apiFetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers as object) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) throw new Error(await readError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function toAccount(user: PublicUser, patient: { id: string; name: string } | null): Account {
  return {
    name: user.name,
    email: user.email,
    role: user.role ?? 'CAREGIVER',
    patient: patient ?? { id: user.patientId, name: user.name },
  };
}

async function persist(token: string, account: Account) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
}

async function configureGlasses(token: string) {
  try {
    await Glasses.configure({ backendUrl: BACKEND_URL, token });
    // Resume the photo library index if permission was granted earlier. Never prompts.
    resumePhotoIndexIfAllowed();
  } catch (e) {
    // Signed in anyway; the Live screen surfaces glasses errors.
    console.warn('[session] Glasses.configure failed:', errorMessage(e));
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const clear = useCallback(async () => {
    setToken(null);
    setAccount(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(ACCOUNT_KEY).catch(() => {});
  }, []);

  // Restore the saved session, then confirm it with the server in the background.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [t, a] = await Promise.all([storeGet(TOKEN_KEY), storeGet(ACCOUNT_KEY)]);
      if (!alive) return;
      let saved: Account | null = null;
      if (a) {
        try {
          saved = JSON.parse(a) as Account;
        } catch {
          saved = null;
        }
      }
      setToken(t);
      setAccount(saved);
      setReady(true);
      if (!t) return;
      configureGlasses(t);
      try {
        const res = await apiFetch('/api/auth/me', { token: t });
        if (!alive) return;
        if (res.status === 401) {
          await clear();
          return;
        }
        if (res.ok) {
          const body = (await res.json()) as { user: PublicUser; patient: { id: string; name: string } | null };
          const fresh = toAccount(body.user, body.patient);
          setAccount(fresh);
          await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(fresh));
        }
      } catch (e) {
        // Offline: keep the saved session.
        console.warn('[session] could not confirm session:', errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [clear]);

  const finishSignIn = useCallback(async (t: string, user: PublicUser) => {
    let patient: { id: string; name: string } | null = null;
    try {
      const me = await apiJson<{ patient: { id: string; name: string } | null }>('/api/auth/me', { token: t });
      patient = me.patient;
    } catch (e) {
      console.warn('[session] /me after sign-in failed:', errorMessage(e));
    }
    const acct = toAccount(user, patient);
    await persist(t, acct);
    await configureGlasses(t);
    setAccount(acct);
    setToken(t);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch('/api/auth/login?client=device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? "That email and password don't match." : await readError(res));
      }
      const body = (await res.json()) as { token?: string; user?: PublicUser };
      if (!body.token || !body.user) throw new Error('The server did not return a device token.');
      await finishSignIn(body.token, body.user);
    },
    [finishSignIn]
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const res = await apiFetch('/api/auth/signup?client=device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email.trim(),
          password: input.password,
          name: input.name.trim(),
          patientName: input.patientName.trim(),
          role: input.role.toLowerCase(),
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { token?: string; user?: PublicUser };
      if (!body.token || !body.user) {
        // Older server without device sign-up: fall back to a normal sign-in.
        await signIn(input.email, input.password);
        return;
      }
      await finishSignIn(body.token, body.user);
    },
    [finishSignIn, signIn]
  );

  const signOut = useCallback(async () => {
    const t = token;
    await clear();
    Glasses.stopStream().catch(() => {});
    if (t) apiFetch('/api/auth/logout', { method: 'POST', token: t }).catch(() => {});
  }, [token, clear]);

  const value = useMemo(
    () => ({ ready, token, account, signIn, signUp, signOut }),
    [ready, token, account, signIn, signUp, signOut]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}

/** How to refer to the wearer in copy: "Ruth" for a caregiver, "you" for the wearer themselves. */
export function wearerName(account: Account | null): string {
  if (!account) return 'the wearer';
  return account.role === 'WEARER' ? 'you' : account.patient.name;
}
