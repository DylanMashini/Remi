/**
 * The Remi brand, in three pieces that are only ever drawn here:
 *
 * - `HorizonMark`: a sun half-risen over a line. The app icon, the avatar beside everything Remi
 *   says, and the listening indicator are all this one mark.
 * - `Wordmark`: "remi" in Nunito 800, lowercase, with the sun as the dot of the i. Real type (a
 *   dotless ı), so it sets like text at any size.
 * - `Sky`: the sunrise gradient, keyed to the hour. Used on exactly two surfaces: the Today header
 *   and the place Remi speaks or listens. Nowhere else.
 *
 * No native gradient module is in the dev client, so `Sky` paints thin horizontal strips; at 36
 * strips over a 140pt surface the bands are under 4pt and read as a smooth sky.
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Colors, Fonts, Sky as SkyStops, skyPeriod, type SkyPeriod } from '@/constants/theme';

// ---------- Horizon mark ----------

type MarkProps = {
  /** Width of the horizon line. The sun is 62% of it. */
  size?: number;
  /** Color of the line: dusk on light surfaces, night text on the viewfinder. */
  line?: string;
  sun?: string;
  /**
   * idle: half-risen and still. listening: the sun lifts and settles, slowly, while Remi listens.
   * rising: one sunrise from behind the horizon, for first paint.
   */
  state?: 'idle' | 'listening' | 'rising';
  style?: StyleProp<ViewStyle>;
};

export function HorizonMark({ size = 24, line = Colors.dusk, sun = Colors.sun, state = 'idle', style }: MarkProps) {
  const d = Math.round(size * 0.62);
  const r = d / 2;
  const t = Math.max(2, Math.round(size * 0.09));
  const [lift] = useState(() => new Animated.Value(state === 'rising' ? r : 0));

  useEffect(() => {
    lift.stopAnimation();
    if (state === 'listening') {
      // Between 40% and 60% risen. Slow enough to be calm, visible enough to say "listening".
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(lift, { toValue: -r * 0.2, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(lift, { toValue: r * 0.2, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    if (state === 'rising') {
      lift.setValue(r);
      Animated.timing(lift, { toValue: 0, duration: 1100, easing: Easing.bezier(0.2, 0.7, 0.2, 1), useNativeDriver: true }).start();
      return;
    }
    Animated.timing(lift, { toValue: 0, duration: 300, useNativeDriver: true }).start();
  }, [state, lift, r]);

  return (
    <View style={[{ width: size, height: r + t, alignItems: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: d, height: r, overflow: 'hidden' }}>
        <Animated.View style={{ width: d, height: d, borderRadius: r, backgroundColor: sun, transform: [{ translateY: lift }] }} />
      </View>
      <View style={{ width: size, height: t, borderRadius: t / 2, backgroundColor: line }} />
    </View>
  );
}

// ---------- Wordmark ----------

/**
 * "remi", set in Nunito 800 with the sun as the dot of the i.
 *
 * Nunito's metrics (1000/em): the ı stem is centred at 0.1335em, its top at 0.499em, and the dot
 * of a real i sits from about 0.59em to 0.73em above the baseline. With lineHeight equal to
 * fontSize, React Native centres the font box in the line, which puts the baseline 0.829em below
 * the top of the text box. The half-disc is 0.26em wide and its flat edge sits 0.555em above the
 * baseline: a hair lower than a true dot, a sun just clearing the stem (measured from the
 * reference artwork). The wordmark is always dusk; the sun is always sun.
 */
export function Wordmark({ size = 26, color = Colors.dusk, sun = Colors.sun }: { size?: number; color?: string; sun?: string }) {
  const em = size;
  const sunW = em * 0.26;
  const sunH = sunW / 2;
  const sunTop = em * (0.829 - 0.555) - sunH;
  const textStyle = { fontFamily: Fonts.display, fontSize: size, lineHeight: size, color, letterSpacing: -em * 0.02 };
  return (
    <View style={styles.wordmark} accessibilityRole="header" accessibilityLabel="Remi">
      <Text style={textStyle} allowFontScaling={false}>
        rem
      </Text>
      <View>
        <Text style={textStyle} allowFontScaling={false}>
          ı
        </Text>
        <View
          style={{
            position: 'absolute',
            left: em * 0.0035,
            top: sunTop,
            width: sunW,
            height: sunH,
            borderTopLeftRadius: sunH,
            borderTopRightRadius: sunH,
            backgroundColor: sun,
          }}
        />
      </View>
    </View>
  );
}

// ---------- Sky ----------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
}

/** Colors for N strips through a three-stop gradient (high sky, mid at 55%, horizon). */
function strips(stops: readonly [string, string, string], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    out.push(p < 0.55 ? mix(stops[0], stops[1], p / 0.55) : mix(stops[1], stops[2], (p - 0.55) / 0.45));
  }
  return out;
}

/** The sky right now, re-read when the screen is shown again (it changes four times a day). */
export function useSkyPeriod(): SkyPeriod {
  const [period, setPeriod] = useState<SkyPeriod>(() => skyPeriod(new Date().getHours()));
  useEffect(() => {
    const id = setInterval(() => setPeriod(skyPeriod(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  return period;
}

/**
 * A surface painted with the hour's sky and a horizon line along its bottom edge. Children sit
 * on top. Text on a Sky is always ink: every sky is light enough for 7:1.
 */
export function Sky({
  children,
  style,
  period,
  horizon = true,
  ...rest
}: ViewProps & {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  period?: SkyPeriod;
  /** Draw the 2pt dusk line along the bottom. Off when the surface is clipped by a parent. */
  horizon?: boolean;
}) {
  const now = useSkyPeriod();
  const stops = SkyStops[period ?? now];
  const bands = useMemo(() => strips(stops, 36), [stops]);
  return (
    <View {...rest} style={[{ overflow: 'hidden', backgroundColor: stops[1] }, style]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {bands.map((c, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c }} />
        ))}
        {horizon ? <View style={styles.horizon} /> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'flex-start' },
  horizon: { height: 2, backgroundColor: Colors.dusk },
});
