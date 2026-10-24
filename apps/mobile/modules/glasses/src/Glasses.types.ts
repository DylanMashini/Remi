import type { ViewProps } from 'react-native';

export type AudioRoute = 'a2dp' | 'hfp' | 'speaker' | 'other';

export type GlassesStatus = {
  registration: 'unregistered' | 'registering' | 'registered';
  connection: 'disconnected' | 'connecting' | 'connected';
  streaming: boolean;
  audioRoute: AudioRoute;
  mock: boolean;
};

export type Face = {
  /** [x, y, w, h] in pixels of the uploaded frame. */
  box: [number, number, number, number];
  personId?: string;
  name?: string;
  relationship?: string;
  score: number;
};

export type SpeakLine = { speechId: string; text: string };

export type FrameResult = {
  faces: Face[];
  speak?: SpeakLine;
  frameWidth: number;
  frameHeight: number;
};

export type ConfigureOptions = { backendUrl: string; token: string };

/** Extension to CONTRACT.md: `mock: true` runs the same pipeline on MockDeviceKit with the phone's back camera. */
export type StartStreamOptions = { mock?: boolean };

export type EnrollPersonOptions = {
  name: string;
  relationship?: string;
  notes?: string;
  /** file:// URIs (1 to 3). */
  photoUris: string[];
};

export type EnrollResult = { personId: string; samples: number };

export type AskResult = { question: string; answer: string };

/** Transcript of what the wearer just said (Remember visits). */
export type ListenResult = { text: string };

export type GlassesModuleEvents = {
  onStatus: (status: GlassesStatus) => void;
  onFrameResult: (result: FrameResult) => void;
  onAudioRoute: (event: { route: AudioRoute; portName: string }) => void;
  onSpoken: (event: { text: string; route: string }) => void;
  onError: (event: { message: string }) => void;
};

export type GlassesPreviewProps = ViewProps;
