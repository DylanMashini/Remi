/**
 * Recall design tokens ("Kindred" look). Light only: calm and warm.
 */

export const Colors = {
  linen: '#F5F3EE', // ground
  surface: '#FFFFFF',
  sand: '#ECE8DF',
  ink: '#1E2B2F',
  inkSoft: '#4F5D61',
  line: '#D9D4C8',
  harbor: '#2C6E68', // primary
  harborDeep: '#1F524D',
  harborMist: '#DCEBE7',
  apricot: '#F2B48C',
  attention: '#8A4B00',
  attentionBg: '#FCEBD0',
  attentionBorder: '#F3D3A3',
  urgent: '#9E2A22', // care-only
  urgentBg: '#FBE4E1',
  listeningText: '#C9D3D1',
} as const;

/** Font family names, matching the keys loaded in app/_layout.tsx. */
export const Fonts = {
  display: 'Nunito_800ExtraBold',
  displayBold: 'Nunito_700Bold',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
} as const;

export const Radii = {
  sm: 12,
  md: 20,
  lg: 28,
  pill: 999,
} as const;

/** 4pt spacing scale. */
export const Spacing = {
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
  eight: 32,
} as const;

export const Shadow = {
  shadowColor: '#1E2B2F',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
} as const;
