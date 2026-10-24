/**
 * Recall design tokens. One light theme, calm and warm, shared with the caregiver web app.
 *
 * Rules of thumb used across the app:
 * - Nunito 800 only for screen titles and the words the glasses say. Everything else is
 *   Atkinson Hyperlegible, a typeface designed for low-vision readers.
 * - Apricot means "a person". Harbor means "the product is acting". Attention is reserved for
 *   something the caregiver should fix. Red never appears in the wearer's path.
 * - Status is always a word next to a dot, never color alone.
 */

export const Colors = {
  // Grounds
  linen: '#F5F3EE',
  surface: '#FFFFFF',
  sand: '#ECE8DF',
  hairline: '#EAE6DD',
  line: '#D9D4C8',

  // Text
  ink: '#1E2B2F',
  inkSoft: '#4F5D61',
  inkMute: '#5F6C70',

  // Brand
  harbor: '#2C6E68',
  harborDeep: '#1F524D',
  harborMist: '#DCEBE7',
  harborMistDeep: '#C5DED8',

  // People
  apricot: '#F2B48C',
  apricotDeep: '#D98C5A',
  apricotMist: '#FBE7D8',

  // Caregiver signals
  attention: '#8A4B00',
  attentionBg: '#FCEBD0',
  attentionBorder: '#F3D3A3',
  urgent: '#9E2A22',
  urgentBg: '#FBE4E1',

  // The viewfinder
  night: '#121C1F',
  nightSoft: '#1E2B2F',
  nightText: '#C9D3D1',
  nightMute: '#8A989C',
} as const;

/** Font family names, matching the keys loaded in app/_layout.tsx. */
export const Fonts = {
  display: 'Nunito_800ExtraBold',
  displayBold: 'Nunito_700Bold',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
} as const;

/** Type scale. Line heights are fixed so stacked text aligns to the 4pt grid. */
export const Type = {
  display: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  title: { fontFamily: Fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  spoken: { fontFamily: Fonts.display, fontSize: 26, lineHeight: 33, letterSpacing: -0.3 },
  headline: { fontFamily: Fonts.bodyBold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 24 },
  secondary: { fontFamily: Fonts.body, fontSize: 15, lineHeight: 20 },
  secondaryBold: { fontFamily: Fonts.bodyBold, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 18 },
  captionBold: { fontFamily: Fonts.bodyBold, fontSize: 13, lineHeight: 18 },
} as const;

export const Radii = {
  xs: 8,
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
  ten: 40,
  twelve: 48,
} as const;

/** Side gutter for every screen. */
export const Gutter = Spacing.five;

/** One soft shadow, used only on things that float (the viewfinder card, sheets). */
export const Shadow = {
  shadowColor: '#1E2B2F',
  shadowOpacity: 0.08,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
} as const;
