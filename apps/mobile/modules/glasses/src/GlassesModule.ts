import { NativeModule, requireNativeModule } from 'expo';

import type {
  AskResult,
  ChatStartResult,
  ChatStopResult,
  ConfigureOptions,
  EnrollPersonOptions,
  EnrollResult,
  GlassesModuleEvents,
  GlassesStatus,
  ListenResult,
  PhotoCandidate,
  PhotoIndexStatus,
  RosterSyncResult,
  StartStreamOptions,
  WakeWordResult,
} from './Glasses.types';

declare class GlassesModule extends NativeModule<GlassesModuleEvents> {
  configure(opts: ConfigureOptions): Promise<void>;
  register(): Promise<void>;
  startStream(opts?: StartStreamOptions): Promise<void>;
  stopStream(): Promise<void>;
  getStatus(): Promise<GlassesStatus>;
  enrollPerson(p: EnrollPersonOptions): Promise<EnrollResult>;
  captureGlassesPhoto(): Promise<string>;
  startAsk(): Promise<void>;
  stopAsk(): Promise<AskResult>;
  /** Live conversation with automatic turns (see Glasses.types ChatEvent). One at a time. */
  startChat(): Promise<ChatStartResult>;
  stopChat(): Promise<ChatStopResult>;
  /** "Hey Remi" on the phone (sherpa-onnx keyword spotter, nothing leaves the device). Starts a chat when heard. */
  setWakeWord(on: boolean): Promise<WakeWordResult>;
  startListening(): Promise<void>;
  stopListening(): Promise<ListenResult>;
  speak(speechId: string, text: string): Promise<void>;
  /** Re-embeds the roster from the enrollment photos (on-device recognition). */
  syncRoster(): Promise<RosterSyncResult>;
  /** Photo library index: suggestions while enrolling. Phone-local; never read by recognition. */
  photoIndexStatus(): Promise<PhotoIndexStatus>;
  /** Requests Photos permission if never asked, then starts or resumes indexing. */
  photoIndexStart(): Promise<PhotoIndexStatus>;
  photoIndexPause(): Promise<PhotoIndexStatus>;
  photoIndexClear(): Promise<void>;
  /** Embeds the largest face in the seed photo and returns up to 12 diverse matches, best first. */
  photoIndexSearch(seedPhotoUri: string): Promise<PhotoCandidate[]>;
  /** file:// JPEG of the candidate's photo, ready for enrollPerson.photoUris. */
  photoIndexExport(candidateId: string): Promise<string>;
}

export default requireNativeModule<GlassesModule>('Glasses');
