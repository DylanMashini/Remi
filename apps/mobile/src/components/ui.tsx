import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';

export function Display({ style, ...p }: TextProps) {
  return <Text {...p} style={[styles.display, style]} />;
}

export function Body({ style, ...p }: TextProps) {
  return <Text {...p} style={[styles.body, style]} />;
}

export function Label({ style, ...p }: TextProps) {
  return <Text {...p} style={[styles.label, style]} />;
}

type Tone = 'mist' | 'attention' | 'urgent' | 'sand';
const toneColors: Record<Tone, { bg: string; fg: string }> = {
  mist: { bg: Colors.harborMist, fg: Colors.harborDeep },
  attention: { bg: Colors.attentionBg, fg: Colors.attention },
  urgent: { bg: Colors.urgentBg, fg: Colors.urgent },
  sand: { bg: Colors.sand, fg: Colors.ink },
};

export function Chip({ label, tone = 'sand', dot }: { label: string; tone?: Tone; dot?: boolean }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: c.fg }]} /> : null}
      <Text style={[styles.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'quiet';
  size?: 'calm' | 'care';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityHint?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'care',
  disabled,
  loading,
  icon,
  style,
  textStyle,
  accessibilityHint,
}: ButtonProps) {
  const calm = size === 'calm';
  const v = {
    primary: { bg: Colors.harbor, fg: Colors.surface, border: Colors.harbor },
    outline: { bg: Colors.surface, fg: Colors.harborDeep, border: Colors.harbor },
    quiet: { bg: Colors.sand, fg: Colors.ink, border: Colors.sand },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          height: calm ? 72 : 48,
          paddingHorizontal: calm ? Spacing.six : 22,
          backgroundColor: v.bg,
          borderColor: v.border,
          borderWidth: variant === 'outline' ? (calm ? 2 : 1.5) : 0,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {loading ? <ActivityIndicator color={v.fg} /> : icon}
      <Text
        style={[
          calm ? styles.calmText : styles.careText,
          { color: v.fg },
          textStyle,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

export const Field = forwardRef<TextInputInstance, TextInputProps & { label: string; hint?: string }>(
  function Field({ label, hint, style, ...p }, ref) {
    return (
      <View style={{ gap: Spacing.two }}>
        <Label>{label}</Label>
        <TextInput
          ref={ref}
          placeholderTextColor={Colors.inkSoft}
          {...p}
          style={[styles.input, p.multiline && styles.inputMulti, style]}
        />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    );
  }
);

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Banner({
  title,
  body,
  tone = 'mist',
  onClose,
}: {
  title: string;
  body?: string;
  tone?: 'mist' | 'attention';
  onClose?: () => void;
}) {
  const c = toneColors[tone];
  return (
    <Pressable
      onPress={onClose}
      accessibilityRole={onClose ? 'button' : undefined}
      accessibilityHint={onClose ? 'Dismiss' : undefined}
      style={[
        styles.banner,
        { backgroundColor: c.bg },
        tone === 'attention' && { borderWidth: 1.5, borderColor: Colors.attentionBorder },
      ]}>
      <Text style={[styles.bannerTitle, { color: tone === 'attention' ? c.fg : Colors.ink }]}>
        {title}
      </Text>
      {body ? <Text style={styles.bannerBody}>{body}</Text> : null}
    </Pressable>
  );
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

const styles = StyleSheet.create({
  display: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 32, lineHeight: 36 },
  body: { fontFamily: Fonts.body, color: Colors.ink, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: Fonts.bodyBold, color: Colors.ink, fontSize: 15 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: 14,
    borderRadius: Radii.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontFamily: Fonts.bodyBold, fontSize: 15 },
  button: {
    borderRadius: Radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  calmText: { fontFamily: Fonts.display, fontSize: 24 },
  careText: { fontFamily: Fonts.bodyBold, fontSize: 16 },
  input: {
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.line,
    borderRadius: Radii.sm,
    paddingHorizontal: 14,
    fontFamily: Fonts.body,
    fontSize: 17,
    color: Colors.ink,
    backgroundColor: Colors.surface,
  },
  inputMulti: { height: 76, paddingTop: Spacing.three, textAlignVertical: 'top' },
  hint: { fontFamily: Fonts.body, fontSize: 14, color: Colors.inkSoft },
  card: { backgroundColor: Colors.surface, borderRadius: Radii.md, padding: Spacing.six, gap: 18 },
  banner: { borderRadius: 24, padding: Spacing.five, gap: Spacing.one },
  bannerTitle: { fontFamily: Fonts.display, fontSize: 22, lineHeight: 28 },
  bannerBody: { fontFamily: Fonts.body, fontSize: 18, lineHeight: 26, color: Colors.ink },
});
