import { requireNativeView } from 'expo';
import type * as React from 'react';

import type { GlassesPreviewProps } from './Glasses.types';

const NativeView: React.ComponentType<GlassesPreviewProps> = requireNativeView('Glasses');

/** Renders the latest glasses frame natively (aspect fit). Pixels never cross the JS bridge. */
export function GlassesPreview(props: GlassesPreviewProps) {
  return <NativeView {...props} />;
}
