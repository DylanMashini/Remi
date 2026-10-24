import { NativeModule, requireNativeModule } from 'expo';

import type { GlassesModuleEvents, GlassesStatus } from './Glasses.types';

declare class GlassesModule extends NativeModule<GlassesModuleEvents> {
  hello(): string;
  getStatus(): Promise<GlassesStatus>;
}

export default requireNativeModule<GlassesModule>('Glasses');
