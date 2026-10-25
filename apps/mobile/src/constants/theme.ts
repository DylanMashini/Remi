/**
 * Remi design tokens. One light theme, calm and warm, shared with the caregiver web app
 * (apps/web/src/app/globals.css mirrors these values).
 *
 * The brand is a sunrise: every day starts fresh, and Remi carries the day for the wearer. The
 * motif lives in exactly three places so it stays a brand and not a theme: the wordmark (the sun
 * is the dot of the i), the surface where Remi speaks or listens, and the Today header. Everything
 * else is flat linen and white.
 *
 * Rules of thumb used across the app:
 * - Nunito 800 only for screen titles and the words Remi says. Everything else is
 *   Atkinson Hyperlegible, a typeface designed for low-vision readers.
 * - Apricot means "a person". Dusk means "Remi is acting" (it is the horizon line under the sun).
 *   Sun is the brand's own color and appears only on the marks. Attention is reserved for
 *   something the caregiver should fix. Red never appears in the wearer's path.
 * - Text sits on the sky gradient only in ink; the sky is always light enough for 7:1 contrast.
 * - Status is always a word next to a dot, never color alone.
 * - Evenings are warm amber, never dark or cool. Caregivers know the word "sundowning".
 */

export const Colors = {
  // Grounds
  linen: '#F5F3EE',
  surface: '#FFFFFF',
  sand: '#ECE8DF',
  hairline: '#EAE6DD',
  line: '#D9D4C8',

  // Text (plum charcoal, so ink and dusk read as one sky)
  ink: '#26222F',
  inkSoft: '#564F63',
  inkMute: '#675F75',

  // Brand: dusk is the horizon line, the color of "Remi is acting"
  dusk: '#4A3F6B',
  duskDeep: '#352D50',
  duskMist: '#EBE6F3',
  duskMistDeep: '#DCD4E8',

  // Brand: the sun. Marks only, never text.
  sun: '#F2A64B',
  sunDeep: '#C9782A',

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
  night: '#15121F',
  nightSoft: '#26222F',
  nightText: '#CFC9D8',
  nightMute: '#918BA0',
} as const;

/**
 * The sky, by hour. Three stops, top to bottom: high sky, mid, horizon. Each is light enough
 * that ink text keeps at least 7:1 contrast, so the gradient never costs legibility.
 * Night stays warm (dusky rose into ember), never navy.
 */
export type SkyPeriod = 'dawn' | 'day' | 'evening' | 'night';

export const Sky: Record<SkyPeriod, readonly [string, string, string]> = {
  dawn: ['#E9DDF0', '#F6D3CF', '#FBDCB0'],
  day: ['#FBF0D2', '#FADFB0', '#F6C98F'],
  evening: ['#F2D5C6', '#F0B48E', '#E99A9C'],
  night: ['#D9CDE3', '#E8C7C9', '#F1CFA9'],
} as const;

/** Which sky is up at a given hour (0 to 23). */
export function skyPeriod(hour: number): SkyPeriod {
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 9 && hour < 16) return 'day';
  if (hour >= 16 && hour < 20) return 'evening';
  return 'night';
}

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
  shadowColor: '#26222F',
  shadowOpacity: 0.08,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
} as const;
