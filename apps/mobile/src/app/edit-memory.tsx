/**
 * Add or edit one memory. A memory has two faces: the speaker's own words, kept as said, and the
 * one sentence the glasses may say. Both can be changed by the wearer or a caregiver.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { HorizonMark } from '@/components/brand';
import { Button, Field, Group, Notice, Row, Screen, SheetHeader } from '@/components/ui';
import { Colors, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { api, type Memory } from '@/lib/api';
import { errorMessage } from '@/lib/glasses';
import { useSession } from '@/lib/session';

export default function EditMemoryScreen() {
  const { id, personId } = useLocalSearchParams<{ id?: string; personId: string }>();
  const { token, account } = useSession();
  const editing = !!id;
  const [memory, setMemory] = useState<Memory | null>(null);
  const [personName, setPersonName] = useState<string>('');
  const [text, setText] = useState('');
  const [callout, setCallout] = useState('');
  const [on, setOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !personId) return;
    api
      .person(token, personId)
      .then((p) => {
        setPersonName(p.name);
        const m = id ? p.memories.find((x) => x.id === id) : undefined;
        if (m) {
          setMemory(m);
          setText(m.text);
          setCallout(m.calloutText);
          setOn(m.useInCallout);
        }
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token, personId, id]);

  const save = async () => {
    if (!token || !personId || !text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (memory) {
        await api.updateMemory(token, memory.id, {
          text: text.trim(),
          ...(callout.trim() ? { calloutText: callout.trim() } : {}),
          useInCallout: on,
        });
      } else {
        await api.addMemory(token, personId, {
          text: text.trim(),
          ...(callout.trim() ? { calloutText: callout.trim() } : {}),
          source: account?.role === 'WEARER' ? 'WEARER_TYPED' : 'CAREGIVER',
          useInCallout: on,
        });
      }
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  const remove = () => {
    if (!token || !memory) return;
    Alert.alert('Delete this memory?', 'It is removed from Recall for good.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMemory(token, memory.id);
            router.back();
          } catch (e) {
            setError(errorMessage(e));
          }
        },
      },
    ]);
  };

  const first = personName.split(/\s+/)[0] ?? '';

  return (
    <Screen edges={['bottom']}>
      <SheetHeader title={editing ? 'A memory' : 'Add a memory'} onClose={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={24}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
          {callout.trim() || text.trim() ? (
            <View style={styles.preview}>
              <View style={styles.previewHead}>
                <HorizonMark size={18} />
                <Text style={[Type.secondaryBold, { color: Colors.duskDeep }]}>
                  {on ? 'After the introduction, the glasses can say' : 'Kept, but not spoken'}
                </Text>
              </View>
              <Text style={styles.previewText}>{callout.trim() || 'A short sentence is written for you when you save.'}</Text>
            </View>
          ) : null}

          <Field
            label={first ? `In your words, about ${first}` : 'In your words'}
            value={text}
            onChangeText={setText}
            placeholder={`${first || 'She'} taught me to bake bread.`}
            multiline
            autoFocus={!editing}
            hint="Kept exactly as written."
          />
          <Field
            label="The sentence the glasses say"
            value={callout}
            onChangeText={setCallout}
            placeholder={editing ? '' : 'Leave empty and Recall writes one from your words.'}
            hint='Second person, one short sentence: "She taught you to bake bread."'
          />

          <Group>
            <Row
              icon="speaker.wave.2.fill"
              iconTone="dusk"
              title="Say this through the glasses"
              detail="The newest memory that is on is spoken."
              trailing={<Switch value={on} onValueChange={setOn} trackColor={{ true: Colors.dusk, false: Colors.line }} accessibilityLabel="Say this through the glasses" />}
            />
          </Group>

          {error ? <Notice tone="attention" title="Not saved" body={error} onDismiss={() => setError(null)} /> : null}

          <Button title={editing ? 'Save' : 'Keep this memory'} size="large" onPress={save} loading={saving} disabled={!text.trim()} />
          {memory ? <Button title="Delete this memory" variant="destructive" icon="trash" onPress={remove} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Gutter, paddingBottom: Spacing.eight, gap: Spacing.four },
  preview: { backgroundColor: Colors.duskMist, borderRadius: Radii.md, padding: Spacing.five, gap: Spacing.two },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewText: { ...Type.spoken, fontSize: 22, lineHeight: 29, color: Colors.ink },
});
