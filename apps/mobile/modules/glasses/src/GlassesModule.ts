import { NativeModule, requireNativeModule } from 'expo';

import type {
  AskResult,
  ConfigureOptions,
  EnrollPersonOptions,
  EnrollResult,
  GlassesModuleEvents,
  GlassesStatus,
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
  speak(speechId: string, text: string): Promise<void>;
}

export default requireNativeModule<GlassesModule>('Glasses');
