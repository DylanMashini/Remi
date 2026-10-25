import type { ViewProps } from 'react-native';

export type AudioRoute = 'a2dp' | 'hfp' | 'speaker' | 'other';

export type GlassesStatus = {
  registration: 'unregistered' | 'registering' | 'registered';
  connection: 'disconnected' | 'connecting' | 'connected';
  streaming: boolean;
  audioRoute: AudioRoute;
  mock: boolean;
  /** Size of the on-device roster: people, and enrollment photos embedded on the phone. */
  rosterPeople: number;
  rosterSamples: number;
};

export type Face = {
  /** [x, y, w, h] in pixels of the camera frame. */
  box: [number, number, number, number];
  personId?: string;
  name?: string;
  relationship?: string;
  score: number;
};

/** `pan` is -1 (left) to 1 (right): where the announced face was in the frame. */
export type SpeakLine = { speechId: string; text: string; pan: number };

/** Result of matching one frame on the phone. The frame itself is discarded. */
export type FrameResult = {
  faces: Face[];
  /** Present when a line is about to be spoken; speechId is "" until /api/recognitions answers. */
  speak?: SpeakLine;
  frameWidth: number;
  frameHeight: number;
};

export type RosterSyncResult = { people: number; samples: number };

export type ConfigureOptions = { backendUrl: string; token: string };

/** Extension to CONTRACT.md: `mock: true` runs the same pipeline on MockDeviceKit with the phone's back camera. */
export type StartStreamOptions = { mock?: boolean };

export type EnrollPersonOptions = {
  name: string;
  relationship?: string;
  notes?: string;
  /** file:// URIs (1 to 3). */
  photoUris: string[];
  /**
   * Normally photoUris[0]. In every other photo the face closest to this photo's largest face is
   * enrolled (group shots picked from the library); a photo whose best face scores below 0.4 is
   * rejected. Without it each photo's largest face is used.
   */
  seedPhotoUri?: string;
};

/**
 * On-device photo library index (PhotoIndex.swift). Phone-local, role-agnostic, never uploaded or
 * synced. Only used to suggest photos of a person who is already being enrolled; the glasses
 * recognition path never reads it.
 */
export type PhotoIndexStatus = {
  permission: 'notDetermined' | 'denied' | 'limited' | 'authorized';
  state: 'idle' | 'indexing' | 'paused' | 'done';
  /** Assets processed (including zero-face and skipped). */
  indexed: number;
  /** Assets in scope (max 2000). */
  total: number;
  /** Face entries stored. */
  faces: number;
  /** Assets not on this device (iCloud originals are never downloaded). */
  skipped: number;
  /** Assets that needed the 2048 px pass for a small face. */
  upgraded: number;
  /** Last indexing error, if any. */
  error?: string;
};

export type PhotoCandidate = {
  /** Opaque; pass to photoIndexExport. */
  id: string;
  /** Cosine similarity to the seed face (>= 0.45). */
  score: number;
  /** file:// 256 px square face crop for the grid. */
  thumbUri: string;
  /** ISO 8601, or "" when the asset has no date. */
  takenAt: string;
};

export type EnrollResult = { personId: string; photos: number };

export type AskResult = { question: string; answer: string };

/** Transcript of what the wearer just said (Remember visits). */
export type ListenResult = { text: string };

export type GlassesModuleEvents = {
  onStatus: (status: GlassesStatus) => void;
  onFrameResult: (result: FrameResult) => void;
  onAudioRoute: (event: { route: AudioRoute; portName: string }) => void;
  onSpoken: (event: { text: string; route: string; pan: number }) => void;
  onError: (event: { message: string }) => void;
  /** At most every 500 ms while indexing, and once on every state change. */
  onPhotoIndex: (status: PhotoIndexStatus) => void;
};

export type GlassesPreviewProps = ViewProps;
