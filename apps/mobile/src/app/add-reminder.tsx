import { DatePicker, Host } from '@expo/ui/swift-ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Notice, Screen, SheetHeader } from '@/components/ui';
import { Colors, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { api } from '@/lib/api';
import { timeOf, whenText } from '@/lib/format';
import { errorMessage } from '@/lib/glasses';
import { useSession, wearerName } from '@/lib/session';

const PRESETS: { label: string; minutes: number }[] = [
  { label: 'In 1 minute', minutes: 1 },
  { label: 'In 10 minutes', minutes: 10 },
  { label: 'In 1 hour', minutes: 60 },
];

function fromNow(minutes: number): Date {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setSeconds(0, 0);
  return d;
}

export default function AddReminderScreen() {
  const { token, account } = useSession();
  const who = wearerName(account);
  const [text, setText] = useState('');
  const [dueAt, setDueAt] = useState<Date>(() => fromNow(10));
  // "now" ticks on a timer so the preset targets and the past check stay pure during render.
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const presetTarget = (minutes: number) => {
    const d = new Date(now + minutes * 60_000);
    d.setSeconds(0, 0);
    return d;
  };

  const past = dueAt.getTime() < now - 30_000;
  const canSave = !!text.trim() && !past && !!token;

  const save = async () => {
    if (!canSave || !token) return;
    setBusy(true);
    setError(null);
    try {
      await api.addReminder(token, text.trim(), dueAt);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <SheetHeader title="Add a reminder" onClose={() => router.back()} />
      <View style={styles.form}>
        <Field
          label={`What the glasses will say to ${who}`}
          value={text}
          onChangeText={setText}
          placeholder="Lunch is at 12:30. Sarah is coming at 4."
          multiline
          autoFocus
          hint="Short and warm. It is spoken exactly as written."
        />

        <View style={{ gap: Spacing.two }}>
          <Text style={styles.label}>When</Text>
          <View style={styles.presets}>
            {PRESETS.map((p) => {
              const target = presetTarget(p.minutes);
              const active = Math.abs(target.getTime() - dueAt.getTime()) < 60_000;
              return (
                <Pressable
                  key={p.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setDueAt(target)}
                  style={({ pressed }) => [
                    styles.preset,
                    active && styles.presetActive,
                    pressed && { opacity: 0.7 },
                  ]}>
                  <Text style={[styles.presetText, active && { color: Colors.harborDeep }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.picker}>
            <Text style={styles.pickerLabel}>{whenText(dueAt)}</Text>
            <Host matchContents alignment="trailing">
              <DatePicker
                selection={dueAt}
                displayedComponents={['date', 'hourAndMinute']}
                range={{ start: new Date() }}
                onDateChange={(d) => {
                  const next = new Date(d);
                  next.setSeconds(0, 0);
                  setDueAt(next);
                }}
              />
            </Host>
          </View>
          {past ? <Text style={styles.warn}>That time has already passed.</Text> : null}
        </View>

        {error ? <Notice tone="attention" title="Not saved" body={error} onDismiss={() => setError(null)} /> : null}

        <Button
          title={text.trim() ? `Remind at ${timeOf(dueAt)}` : 'Add reminder'}
          size="large"
          onPress={save}
          loading={busy}
          disabled={!canSave}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: Gutter, paddingBottom: Spacing.six, gap: Spacing.five },
  label: { ...Type.secondaryBold, color: Colors.ink },
  presets: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  preset: {
    height: 40,
    paddingHorizontal: Spacing.four,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.line,
    justifyContent: 'center',
  },
  presetActive: { backgroundColor: Colors.harborMist, borderColor: Colors.harbor },
  presetText: { ...Type.secondaryBold, color: Colors.ink },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    backgroundColor: Colors.surface,
    borderRadius: Radii.sm,
    borderWidth: 1.5,
    borderColor: Colors.line,
    paddingHorizontal: Spacing.four,
    minHeight: 52,
  },
  pickerLabel: { ...Type.body, color: Colors.ink },
  warn: { ...Type.secondary, color: Colors.attention },
});
