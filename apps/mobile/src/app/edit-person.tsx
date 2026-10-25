/** Edit the introduction the glasses give for one person: name, relationship, note. */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, type TextInputInstance, View } from 'react-native';

import { HorizonMark } from '@/components/brand';
import { Button, Field, Notice, Screen, SheetHeader } from '@/components/ui';
import { Colors, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { api, type PersonDetail } from '@/lib/api';
import { introductionLine } from '@/lib/format';
import { errorMessage, resyncRoster } from '@/lib/glasses';
import { useSession, wearerName } from '@/lib/session';

export default function EditPersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, account } = useSession();
  const who = wearerName(account);
  const relationshipRef = useRef<TextInputInstance>(null);
  const notesRef = useRef<TextInputInstance>(null);
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    api
      .person(token, id)
      .then((p) => {
        setPerson(p);
        setName(p.name);
        setRelationship(p.relationship ?? '');
        setNotes(p.notes ?? '');
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token, id]);

  const memory = person?.memories.find((m) => m.useInCallout)?.calloutText ?? null;
  const preview = introductionLine({ name: name.trim() || 'this person', relationship, notes, memory });
  const dirty = !!person && (name.trim() !== person.name || relationship.trim() !== (person.relationship ?? '') || notes.trim() !== (person.notes ?? ''));

  const save = async () => {
    if (!token || !id || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updatePerson(token, id, {
        name: name.trim(),
        relationship: relationship.trim() || null,
        notes: notes.trim() || null,
      });
      resyncRoster();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <SheetHeader title="The introduction" onClose={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={24}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
          <View style={styles.preview}>
            <View style={styles.previewHead}>
              <HorizonMark size={18} />
              <Text style={[Type.secondaryBold, { color: Colors.duskDeep }]}>Remi will say</Text>
            </View>
            <Text style={styles.previewText}>{preview}</Text>
          </View>

          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="off"
            returnKeyType="next"
            onSubmitEditing={() => relationshipRef.current?.focus()}
          />
          <Field
            ref={relationshipRef}
            label={`Who they are to ${who}`}
            value={relationship}
            onChangeText={setRelationship}
            placeholder="daughter, neighbor, nurse"
            autoCapitalize="none"
            autoComplete="off"
            returnKeyType="next"
            onSubmitEditing={() => notesRef.current?.focus()}
            hint='Spoken as "your daughter", so keep it lowercase.'
          />
          <Field
            ref={notesRef}
            label="One warm thing to say"
            value={notes}
            onChangeText={setNotes}
            placeholder="She brought you tulips last week."
            multiline
            hint="Read aloud right after the name. One short sentence."
          />

          {error ? <Notice tone="attention" title="Not saved" body={error} onDismiss={() => setError(null)} /> : null}

          <Button title="Save" size="large" onPress={save} loading={saving} disabled={!dirty || !name.trim()} />
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
