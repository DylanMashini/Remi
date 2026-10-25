/**
 * Remi UI kit. Small, boring, consistent. Every screen is built from these pieces so the
 * app reads as one product: one type scale, one radius hierarchy, one way to show status.
 * The brand marks (wordmark, horizon mark, sky) live in brand.tsx.
 */
import { Image } from 'expo-image';
import { SymbolView, type SFSymbol, type SymbolWeight } from 'expo-symbols';
import { Children, forwardRef, Fragment, isValidElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Colors, Fonts, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { initials } from '@/lib/format';

// ---------- Text ----------

type TxtProps = TextProps & { color?: string };

function makeText(base: TextStyle, defaultColor: string) {
  return function Txt({ style, color, ...p }: TxtProps) {
    return <Text {...p} style={[base, { color: color ?? defaultColor }, style]} />;
  };
}

export const Display = makeText(Type.display, Colors.ink);
export const Title = makeText(Type.title, Colors.ink);
export const Headline = makeText(Type.headline, Colors.ink);
export const Body = makeText(Type.body, Colors.ink);
export const Secondary = makeText(Type.secondary, Colors.inkSoft);
export const Caption = makeText(Type.caption, Colors.inkMute);

// ---------- Icon ----------

export function Icon({
  name,
  size = 22,
  color = Colors.ink,
  weight = 'medium',
  style,
}: {
  name: SFSymbol;
  size?: number;
  color?: string;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
      fallback={<View style={{ width: size, height: size }} />}
    />
  );
}

// ---------- Buttons ----------

type Variant = 'primary' | 'secondary' | 'quiet' | 'destructive' | 'night';

const variants: Record<Variant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
  primary: { bg: Colors.dusk, bgPressed: Colors.duskDeep, fg: Colors.surface },
  secondary: { bg: Colors.surface, bgPressed: Colors.duskMist, fg: Colors.duskDeep, border: Colors.dusk },
  quiet: { bg: Colors.sand, bgPressed: Colors.line, fg: Colors.ink },
  destructive: { bg: Colors.urgentBg, bgPressed: '#F5CFCA', fg: Colors.urgent },
  night: { bg: Colors.ink, bgPressed: Colors.night, fg: Colors.linen },
};

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  /** large = 64pt, the wearer-facing size. regular = 50pt. */
  size?: 'regular' | 'large';
  icon?: SFSymbol;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'regular',
  icon,
  disabled,
  loading,
  style,
  accessibilityHint,
}: ButtonProps) {
  const v = variants[variant];
  const large = size === 'large';
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          height: large ? 64 : 50,
          paddingHorizontal: large ? Spacing.six : Spacing.five,
          backgroundColor: pressed ? v.bgPressed : v.bg,
          borderColor: v.border ?? 'transparent',
          borderWidth: v.border ? 1.5 : 0,
          opacity: disabled && !loading ? 0.4 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : icon ? (
        <Icon name={icon} size={large ? 22 : 18} color={v.fg} weight="semibold" />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          large ? styles.buttonTextLarge : styles.buttonText,
          { color: v.fg },
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

/** A text-only action, for the least important choice on a screen. */
export function TextButton({
  title,
  onPress,
  color = Colors.duskDeep,
  style,
}: {
  title: string;
  onPress: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.6 : 1 }, style]}>
      <Text style={[Type.secondaryBold, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({
  name,
  label,
  onPress,
  size = 44,
  tone = 'sand',
  style,
}: {
  name: SFSymbol;
  label: string;
  onPress: () => void;
  size?: number;
  tone?: 'sand' | 'surface' | 'dusk' | 'night';
  style?: StyleProp<ViewStyle>;
}) {
  const bg = { sand: Colors.sand, surface: Colors.surface, dusk: Colors.dusk, night: 'rgba(21,18,31,0.72)' }[tone];
  const fg = tone === 'dusk' || tone === 'night' ? Colors.surface : Colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, opacity: pressed ? 0.7 : 1 },
        styles.center,
        style,
      ]}>
      <Icon name={name} size={Math.round(size * 0.45)} color={fg} weight="semibold" />
    </Pressable>
  );
}

// ---------- Form ----------

export const Field = forwardRef<
  TextInputInstance,
  TextInputProps & { label: string; hint?: string; error?: string | null }
>(function Field({ label, hint, error, style, ...p }, ref) {
  return (
    <View style={{ gap: Spacing.two }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={Colors.inkMute}
        selectionColor={Colors.dusk}
        {...p}
        accessibilityLabel={p.accessibilityLabel ?? label}
        style={[styles.input, p.multiline && styles.inputMulti, error ? styles.inputError : null, style]}
      />
      {error ? (
        <Text style={[Type.secondary, { color: Colors.attention }]}>{error}</Text>
      ) : hint ? (
        <Text style={[Type.secondary, { color: Colors.inkMute }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

// ---------- Grouped lists ----------

/** A white surface that holds rows separated by hairlines, like a settings group. */
export function Group({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const items = Children.toArray(children).filter((c) => isValidElement(c) || typeof c === 'string');
  return (
    <View style={[{ gap: Spacing.two }, style]}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.group}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.hairline} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
    </View>
  );
}

type RowProps = {
  title: string;
  detail?: string;
  /** Right-aligned value, for status rows. */
  value?: string;
  valueTone?: 'default' | 'good' | 'attention' | 'mute';
  icon?: SFSymbol;
  iconTone?: 'dusk' | 'apricot' | 'sand' | 'attention';
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
};

export function Row({
  title,
  detail,
  value,
  valueTone = 'default',
  icon,
  iconTone = 'sand',
  leading,
  trailing,
  chevron,
  onPress,
  onLongPress,
  accessibilityHint,
}: RowProps) {
  const valueColor = {
    default: Colors.ink,
    good: Colors.duskDeep,
    attention: Colors.attention,
    mute: Colors.inkMute,
  }[valueTone];
  const iconBg = {
    dusk: Colors.duskMist,
    apricot: Colors.apricotMist,
    sand: Colors.sand,
    attention: Colors.attentionBg,
  }[iconTone];
  const iconFg = {
    dusk: Colors.duskDeep,
    apricot: Colors.apricotDeep,
    sand: Colors.ink,
    attention: Colors.attention,
  }[iconTone];
  const content = (
    <>
      {leading ??
        (icon ? (
          <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
            <Icon name={icon} size={18} color={iconFg} weight="semibold" />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[Type.body, { color: Colors.ink }]}>{title}</Text>
        {detail ? <Text style={[Type.secondary, { color: Colors.inkSoft }]}>{detail}</Text> : null}
      </View>
      {value ? (
        <Text style={[Type.secondaryBold, { color: valueColor, textAlign: 'right', flexShrink: 1 }]}>{value}</Text>
      ) : null}
      {trailing}
      {chevron ? <Icon name="chevron.right" size={14} color={Colors.inkMute} weight="bold" /> : null}
    </>
  );
  if (!onPress && !onLongPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: Colors.linen }]}>
      {content}
    </Pressable>
  );
}

/** A selectable option with a title and a sentence, for the onboarding choice. */
export function ChoiceCard({
  title,
  body,
  icon,
  onPress,
}: {
  title: string;
  body: string;
  icon: SFSymbol;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && { backgroundColor: Colors.duskMist, borderColor: Colors.dusk }]}>
      <View style={[styles.rowIcon, { backgroundColor: Colors.duskMist, width: 48, height: 48, borderRadius: 24 }]}>
        <Icon name={icon} size={24} color={Colors.duskDeep} weight="semibold" />
      </View>
      <View style={{ flex: 1, gap: Spacing.one }}>
        <Text style={[Type.title, { fontSize: 20, lineHeight: 26, color: Colors.ink }]}>{title}</Text>
        <Text style={[Type.secondary, { color: Colors.inkSoft }]}>{body}</Text>
      </View>
      <Icon name="chevron.right" size={16} color={Colors.duskDeep} weight="bold" />
    </Pressable>
  );
}

// ---------- Feedback ----------

export function Notice({
  tone = 'info',
  title,
  body,
  icon,
  onDismiss,
  action,
}: {
  tone?: 'info' | 'attention' | 'success';
  title?: string;
  body: string;
  icon?: SFSymbol;
  onDismiss?: () => void;
  action?: ReactNode;
}) {
  const c = {
    info: { bg: Colors.duskMist, fg: Colors.duskDeep, icon: 'info.circle.fill' as SFSymbol },
    success: { bg: Colors.duskMist, fg: Colors.duskDeep, icon: 'checkmark.circle.fill' as SFSymbol },
    attention: { bg: Colors.attentionBg, fg: Colors.attention, icon: 'exclamationmark.circle.fill' as SFSymbol },
  }[tone];
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: c.bg, borderColor: tone === 'attention' ? Colors.attentionBorder : c.bg }]}>
      <Icon name={icon ?? c.icon} size={20} color={c.fg} weight="semibold" style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[Type.headline, { color: tone === 'attention' ? c.fg : Colors.ink }]}>{title}</Text> : null}
        <Text style={[Type.secondary, { color: tone === 'attention' ? c.fg : Colors.ink }]}>{body}</Text>
        {action}
      </View>
      {onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={10}>
          <Icon name="xmark" size={14} color={c.fg} weight="bold" />
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatusDot({ tone, size = 8 }: { tone: 'good' | 'idle' | 'attention'; size?: number }) {
  const bg = { good: Colors.dusk, idle: Colors.inkMute, attention: Colors.attention }[tone];
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }} />;
}

/** The one place status lives: a dot and a few words. */
export function StatusPill({
  tone,
  label,
  onPress,
}: {
  tone: 'good' | 'idle' | 'attention';
  label: string;
  onPress?: () => void;
}) {
  const fg = { good: Colors.duskDeep, idle: Colors.inkSoft, attention: Colors.attention }[tone];
  const bg = { good: Colors.duskMist, idle: Colors.sand, attention: Colors.attentionBg }[tone];
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      accessibilityHint={onPress ? 'Opens glasses settings' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}>
      <StatusDot tone={tone} />
      <Text style={[Type.secondaryBold, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Avatar({
  name,
  uri,
  headers,
  size = 56,
  ring = true,
}: {
  name: string;
  uri?: string | null;
  headers?: Record<string, string>;
  size?: number;
  ring?: boolean;
}) {
  const ringStyle = ring ? { borderWidth: Math.max(2, Math.round(size / 24)), borderColor: Colors.apricot } : null;
  if (uri) {
    return (
      <Image
        source={{ uri, headers, cacheKey: uri }}
        accessibilityLabel={`Photo of ${name}`}
        style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: Colors.apricotMist }, ringStyle]}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      accessibilityLabel={`${name}'s initials`}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: Colors.apricot }, styles.center, ringStyle]}>
      <Text style={{ fontFamily: Fonts.display, fontSize: Math.round(size * 0.4), color: Colors.ink }}>{initials(name)}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: SFSymbol;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={[styles.rowIcon, { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.sand }]}>
        <Icon name={icon} size={30} color={Colors.inkSoft} weight="regular" />
      </View>
      <Text style={[Type.title, { color: Colors.ink, textAlign: 'center' }]}>{title}</Text>
      <Text style={[Type.body, { color: Colors.inkSoft, textAlign: 'center', maxWidth: 300 }]}>{body}</Text>
      {action ? <View style={{ marginTop: Spacing.two }}>{action}</View> : null}
    </View>
  );
}

// ---------- Screen chrome ----------

export function Screen({
  children,
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

/** Large left-aligned title, optional lead sentence, optional action on the right. */
export function ScreenHeader({
  title,
  lead,
  eyebrow,
  action,
}: {
  title: string;
  lead?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: Spacing.one }}>
        {eyebrow ? <Text style={[Type.secondary, { color: Colors.inkSoft }]}>{eyebrow}</Text> : null}
        <Text style={[Type.display, { color: Colors.ink }]} accessibilityRole="header">
          {title}
        </Text>
        {lead ? <Text style={[Type.body, { color: Colors.inkSoft, marginTop: Spacing.one }]}>{lead}</Text> : null}
      </View>
      {action ? <View style={{ paddingTop: Spacing.one }}>{action}</View> : null}
    </View>
  );
}

/** Top bar for a modal sheet: a dismiss action and a centered title. */
export function SheetHeader({
  title,
  onClose,
  closeLabel = 'Cancel',
  right,
}: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetSide}>
        <TextButton title={closeLabel} onPress={onClose} />
      </View>
      <Text style={[Type.headline, { color: Colors.ink }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.sheetSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

/** Pins actions above the home indicator, with a hairline so content scrolls beneath. */
export function BottomBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView edges={['bottom']} style={[styles.bottomBar, style]}>
      {children}
    </SafeAreaView>
  );
}

export function PressableScale({ children, style, ...p }: PressableProps & { children: ReactNode }) {
  return (
    <Pressable {...p} style={({ pressed }) => [style as StyleProp<ViewStyle>, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: Colors.linen },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.four,
    paddingHorizontal: Gutter,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  button: {
    borderRadius: Radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  buttonText: { fontFamily: Fonts.bodyBold, fontSize: 17, lineHeight: 22 },
  buttonTextLarge: { fontFamily: Fonts.display, fontSize: 21, lineHeight: 26, letterSpacing: -0.2 },
  textButton: { minHeight: 44, justifyContent: 'center' },
  fieldLabel: { ...Type.secondaryBold, color: Colors.ink },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: Colors.line,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    fontFamily: Fonts.body,
    fontSize: 17,
    lineHeight: 22,
    color: Colors.ink,
    backgroundColor: Colors.surface,
  },
  inputMulti: { minHeight: 88, textAlignVertical: 'top' },
  inputError: { borderColor: Colors.attention },
  groupTitle: { ...Type.secondaryBold, color: Colors.inkSoft, paddingHorizontal: Spacing.one },
  groupFooter: { ...Type.secondary, color: Colors.inkMute, paddingHorizontal: Spacing.one },
  group: { backgroundColor: Colors.surface, borderRadius: Radii.md, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.hairline, marginLeft: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    minHeight: 56,
  },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    padding: Spacing.five,
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radii.md,
    borderWidth: 1.5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    minHeight: 36,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.ten,
    paddingHorizontal: Spacing.six,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Gutter,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  sheetSide: { width: 80 },
  bottomBar: {
    paddingHorizontal: Gutter,
    paddingTop: Spacing.three,
    backgroundColor: Colors.linen,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.line,
  },
});
