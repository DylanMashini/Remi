import { NativeModule, requireNativeModule } from 'expo';

import type {
  AskResult,
  ConfigureOptions,
  EnrollPersonOptions,
  EnrollResult,
  GlassesModuleEvents,
  GlassesStatus,
  ListenResult,
  RosterSyncResult,
  StartStreamOptions,
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
  startListening(): Promise<void>;
  stopListening(): Promise<ListenResult>;
  speak(speechId: string, text: string): Promise<void>;
  /** Re-embeds the roster from the enrollment photos (on-device recognition). */
  syncRoster(): Promise<RosterSyncResult>;
}

export default requireNativeModule<GlassesModule>('Glasses');
