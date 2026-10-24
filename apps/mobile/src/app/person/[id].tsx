import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Avatar, Button, Group, Icon, IconButton, Notice, Row, Screen, TextButton } from '@/components/ui';
import { Colors, Fonts, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { api, type Memory, type PersonDetail } from '@/lib/api';
import { agoText, firstName, lastSeenText } from '@/lib/format';
import { errorMessage } from '@/lib/glasses';
import { BACKEND_URL, useSession, wearerName } from '@/lib/session';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, account } = useSession();
  const who = wearerName(account);
  const [person, setPerson] = useState<PersonDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    if (!token || !id) return;
    api
      .person(token, id)
      .then((p) => {
        setPerson(p);
        setError(null);
      })
      .catch((e) => {
        if (/not found/i.test(errorMessage(e))) setPerson(null);
        else setError(errorMessage(e));
      });
  }, [token, id]);

  // Reload when a sheet (edit person, edit memory) closes.
  useFocusEffect(
    useCallback(() => {
      load();
      setNow(Date.now());
    }, [load])
  );

  const toggleMemory = async (m: Memory, on: boolean) => {
    if (!token || !person) return;
    setPerson({ ...person, memories: person.memories.map((x) => (x.id === m.id ? { ...x, useInCallout: on } : x)) });
    try {
      await api.updateMemory(token, m.id, { useInCallout: on });
      load();
    } catch (e) {
      setError(errorMessage(e));
      load();
    }
  };

  const remove = () => {
    if (!person || !token) return;
    Alert.alert(
      `Remove ${firstName(person.name)}?`,
      `Recall will stop recognizing ${firstName(person.name)} and delete their photos and memories. Past moments stay in Today without a name.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await api.deletePerson(token, person.id);
              router.back();
            } catch (e) {
              setError(errorMessage(e));
              setRemoving(false);
            }
          },
        },
      ]
    );
  };

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const knew = person?.visits.filter((v) => v.knew).length ?? 0;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.nav}>
        <IconButton name="chevron.left" label="Back to people" onPress={() => router.back()} tone="surface" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {error ? <Notice tone="attention" body={error} onDismiss={() => setError(null)} /> : null}

        {person === undefined ? (
          <ActivityIndicator color={Colors.harbor} style={{ marginTop: Spacing.ten }} />
        ) : person === null ? (
          <Notice tone="info" body="This person is no longer in the roster." />
        ) : (
          <>
            <View style={styles.hero}>
              <Avatar name={person.name} uri={person.avatarUrl ? `${BACKEND_URL}${person.avatarUrl}` : null} headers={headers} size={128} />
              <Text style={styles.name} accessibilityRole="header">
                {person.name}
              </Text>
              {person.relationship ? <Text style={styles.relationship}>{capitalize(person.relationship)}</Text> : null}
            </View>

            <View style={styles.quote}>
              <View style={styles.quoteHead}>
                <Icon name="eyeglasses" size={16} color={Colors.harborDeep} weight="semibold" />
                <Text style={styles.quoteLabel}>What the glasses say</Text>
                <View style={{ flex: 1 }} />
                <TextButton title="Edit" onPress={() => router.push({ pathname: '/edit-person', params: { id: person.id } })} />
              </View>
              <Text style={styles.quoteText}>{person.line}</Text>
              <Text style={[Type.caption, { color: Colors.inkMute }]}>
                Name, relationship, a note, then the newest memory switched on below.
              </Text>
            </View>

            <Group
              title="Memories"
              footer={
                person.memories.length
                  ? 'Switched on means the glasses can say it. The newest one that is on is spoken. Tap a memory to change its words.'
                  : undefined
              }>
              {person.memories.map((m) => (
                <Row
                  key={m.id}
                  title={m.calloutText}
                  detail={`${m.source === 'CAREGIVER' ? 'Added by family' : who === 'you' ? 'You said' : `${who} said`}: “${m.text}”`}
                  trailing={
                    <Switch
                      value={m.useInCallout}
                      onValueChange={(on) => toggleMemory(m, on)}
                      trackColor={{ true: Colors.harbor, false: Colors.line }}
                      accessibilityLabel={`Say this through the glasses: ${m.calloutText}`}
                    />
                  }
                  onPress={() => router.push({ pathname: '/edit-memory', params: { id: m.id, personId: person.id } })}
                  accessibilityHint="Opens this memory to edit it"
                />
              ))}
              {person.memories.length === 0 ? (
                <View style={styles.quietEmpty}>
                  <Text style={[Type.headline, { color: Colors.ink }]}>No memories yet</Text>
                  <Text style={[Type.secondary, { color: Colors.inkSoft }]}>
                    They arrive from the Remember tab, when {who === 'you' ? 'you say' : `${who} says`} something about{' '}
                    {firstName(person.name)}. You can also add one here.
                  </Text>
                </View>
              ) : null}
              <Row
                icon="plus"
                iconTone="harbor"
                title="Add a memory"
                onPress={() => router.push({ pathname: '/edit-memory', params: { personId: person.id } })}
                chevron
              />
            </Group>

            <Group title="Together">
              <Row
                icon="heart.fill"
                iconTone="apricot"
                title="Remember visits"
                value={person.visits.length ? `Knew ${knew} of ${person.visits.length}` : 'None yet'}
                valueTone={person.visits.length ? 'good' : 'mute'}
              />
              <Row icon="clock" iconTone="sand" title="Last seen" value={lastSeenText(person.lastSeenAt).replace(/^Seen /, '')} valueTone="mute" />
              <Row
                icon="photo.on.rectangle"
                iconTone="sand"
                title="Last visit"
                value={person.lastRememberedAt ? agoText(person.lastRememberedAt, now) : 'Not yet'}
                valueTone="mute"
              />
              <Row icon="camera" iconTone="sand" title="Photos" value={`${person.samples}`} valueTone="mute" />
            </Group>

            <Button
              title={`Remove ${firstName(person.name)}`}
              variant="destructive"
              icon="trash"
              onPress={remove}
              loading={removing}
              style={{ marginTop: Spacing.two }}
            />
            <Text style={styles.footnote}>Removing deletes their photos, face data and memories from Recall.</Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  nav: { paddingHorizontal: Gutter, paddingTop: Spacing.two },
  scroll: { paddingHorizontal: Gutter, paddingTop: Spacing.four, paddingBottom: Spacing.eight, gap: Spacing.five },
  hero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  name: { fontFamily: Fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.6, color: Colors.ink, textAlign: 'center', marginTop: Spacing.two },
  relationship: { ...Type.headline, color: Colors.harborDeep },
  quote: { backgroundColor: Colors.harborMist, borderRadius: Radii.md, padding: Spacing.five, paddingTop: Spacing.two, gap: Spacing.two },
  quoteHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quoteLabel: { ...Type.secondaryBold, color: Colors.harborDeep },
  quoteText: { ...Type.spoken, fontSize: 22, lineHeight: 29, color: Colors.ink },
  quietEmpty: { padding: Spacing.four, gap: Spacing.one },
  footnote: { ...Type.caption, color: Colors.inkMute, textAlign: 'center' },
});
