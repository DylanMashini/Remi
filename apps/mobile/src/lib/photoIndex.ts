/**
 * Photo library index: the phone indexes faces in its own newest 2,000 photos (on-device model,
 * PhotoIndex.swift) so whoever is adding a person can pick real photos of them for the remaining
 * enrollment slots. Phone-local, never synced, never uploaded. Identical for caregiver and wearer
 * accounts: there is deliberately no role check in this file or in the screens that use it.
 *
 * The index is a separate store from the roster the glasses match against. Nothing from it
 * reaches the roster unless the person enrolling taps a suggestion and saves.
 */
import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';

import { addGlassesListener, errorMessage, Glasses, glassesHas, type PhotoIndexStatus } from '@/lib/glasses';

/** False on dev builds that predate the Swift functions; every screen hides the feature then. */
export const photoIndexSupported = glassesHas('photoIndexStart');

const NOTICE_KEY = 'recall.photoIndexNoticeDismissed';

let state: PhotoIndexStatus | null = null;
const subs = new Set<() => void>();

function set(next: PhotoIndexStatus) {
  state = next;
  subs.forEach((cb) => cb());
}

let listening = false;
function ensureListener() {
  if (listening || !photoIndexSupported) return;
  listening = true;
  addGlassesListener('onPhotoIndex', set);
}

export function hasPhotoAccess(s: PhotoIndexStatus | null): boolean {
  return s?.permission === 'authorized' || s?.permission === 'limited';
}

export async function refreshPhotoIndex(): Promise<PhotoIndexStatus | null> {
  if (!photoIndexSupported) return null;
  try {
    const s = await Glasses.photoIndexStatus();
    set(s);
    return s;
  } catch (e) {
    console.warn('[photoIndex] status failed:', errorMessage(e));
    return null;
  }
}

/** Live status (null until the first read). Subscribes to onPhotoIndex. */
export function usePhotoIndex(): PhotoIndexStatus | null {
  ensureListener();
  useEffect(() => {
    if (state == null) refreshPhotoIndex();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state
  );
}

/** Asks for Photos permission the first time, then starts or resumes. */
export async function startPhotoIndex(): Promise<PhotoIndexStatus> {
  const s = await Glasses.photoIndexStart();
  set(s);
  return s;
}

export async function pausePhotoIndex(): Promise<PhotoIndexStatus> {
  const s = await Glasses.photoIndexPause();
  set(s);
  return s;
}

export async function clearPhotoIndex(): Promise<void> {
  await Glasses.photoIndexClear();
  await refreshPhotoIndex();
}

/**
 * At launch, after sign-in. Resumes silently when permission was already granted and the index
 * is unfinished. Never shows the permission prompt: that comes from Settings or the one-time
 * notice on the add-person screen.
 */
export async function resumePhotoIndexIfAllowed(): Promise<void> {
  const s = await refreshPhotoIndex();
  if (!s || !hasPhotoAccess(s)) return;
  if (s.state === 'done' || s.state === 'indexing') return;
  try {
    await startPhotoIndex();
  } catch (e) {
    console.warn('[photoIndex] resume failed:', errorMessage(e));
  }
}

export async function photoIndexNoticeDismissed(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(NOTICE_KEY)) === '1';
  } catch {
    return true;
  }
}

export async function dismissPhotoIndexNotice(): Promise<void> {
  try {
    await SecureStore.setItemAsync(NOTICE_KEY, '1');
  } catch (e) {
    console.warn('[photoIndex] could not persist notice dismissal:', errorMessage(e));
  }
}

const n = (x: number) => x.toLocaleString();

/** Settings row copy. Role-neutral on purpose: the index belongs to this phone, whoever holds it. */
export function photoIndexDetail(s: PhotoIndexStatus | null): string {
  if (!s) return 'Checking…';
  if (s.permission === 'denied') return 'Photos access is off. Allow it in iOS Settings to use suggestions.';
  const scope = s.permission === 'limited' ? ' Only the photos you selected are included.' : '';
  switch (s.state) {
    case 'indexing':
      return `Indexing ${n(s.indexed)} of ${n(s.total)} photos, ${n(s.faces)} faces.${scope}`;
    case 'paused':
      return `Paused at ${n(s.indexed)} of ${n(s.total)} photos, ${n(s.faces)} faces. Stays on this phone.${scope}`;
    case 'done':
      return `${n(s.total)} photos indexed, ${n(s.faces)} faces. Stays on this phone.${scope}`;
    default:
      return s.error
        ? `Could not index: ${s.error}`
        : 'Not indexed. Recall can find photos of a person when you add them.';
  }
}
