import type { SFSymbol } from 'expo-symbols';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sky } from '@/components/brand';
import { Button, EmptyState, Group, Icon, IconButton, Notice, PressableScale, Row, Screen } from '@/components/ui';
import { Colors, Fonts, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { api, type EventJson, type Reminder } from '@/lib/api';
import { longDate, startOfToday, timeOf, whenText } from '@/lib/format';
import { errorMessage } from '@/lib/glasses';
import { useSession, wearerName } from '@/lib/session';

const SHOWN: EventJson['type'][] = ['RECOGNITION', 'UNKNOWN', 'QUESTION', 'ANSWER', 'REMINDER', 'PRACTICE'];

function describe(e: EventJson, who: string): { icon: SFSymbol; tone: 'dusk' | 'apricot' | 'sand'; title: string } {
  switch (e.type) {
    case 'RECOGNITION':
      return { icon: 'person.fill.checkmark', tone: 'apricot', title: e.personName ? `${e.personName} was here` : 'Someone familiar was here' };
    case 'UNKNOWN':
      return { icon: 'person.fill.questionmark', tone: 'sand', title: 'Someone new was here' };
    case 'QUESTION':
      return { icon: 'bubble.left.fill', tone: 'dusk', title: e.data?.repeat ? `${capitalize(who)} asked again` : `${capitalize(who)} asked` };
    case 'ANSWER':
      return { icon: 'eyeglasses', tone: 'dusk', title: 'The glasses answered' };
    case 'REMINDER':
      return { icon: 'bell.fill', tone: 'dusk', title: 'Reminder spoken' };
    case 'PRACTICE': {
      const name = e.personName ?? 'someone';
      if (e.data?.kind === 'memory') {
        return {
          icon: 'quote.bubble.fill',
          tone: 'apricot',
          title: e.data.source === 'CAREGIVER' ? `A memory of ${name} was added` : `${capitalize(who)} shared a memory of ${name}`,
        };
      }
      return e.data?.knew
        ? { icon: 'heart.fill', tone: 'apricot', title: `${capitalize(who)} knew ${name}` }
        : { icon: 'heart', tone: 'apricot', title: `${capitalize(who)} was reminded of ${name}` };
    }
    default:
      return { icon: 'circle', tone: 'sand', title: e.type };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function TodayScreen() {
  const { token, account } = useSession();
  const insets = useSafeAreaInsets();
  const who = wearerName(account);
  const [events, setEvents] = useState<EventJson[] | null>(null);
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [ev, rem] = await Promise.all([api.events(token, startOfToday(), 200), api.reminders(token)]);
      setEvents(ev.filter((e) => SHOWN.includes(e.type)));
      setReminders(rem.filter((r) => !r.firedAt).sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const deleteEvent = (e: EventJson) => {
    if (!token) return;
    Alert.alert('Delete this moment?', 'It is removed from Recall for good.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteEvent(token, e.id);
            setEvents((list) => list?.filter((x) => x.id !== e.id) ?? null);
          } catch (err) {
            setError(errorMessage(err));
          }
        },
      },
    ]);
  };

  const deleteReminder = (r: Reminder) => {
    if (!token) return;
    Alert.alert('Remove this reminder?', `"${r.text}" will not be spoken.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteReminder(token, r.id);
            setReminders((list) => list?.filter((x) => x.id !== r.id) ?? null);
          } catch (err) {
            setError(errorMessage(err));
          }
        },
      },
    ]);
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dusk} progressViewOffset={insets.top} />}>
        {/* The one place on this screen that carries the brand: today's sky, down to the horizon. */}
        <Sky style={[styles.sky, { paddingTop: insets.top + Spacing.three }]}>
          <View style={styles.skyInner}>
            <View style={{ flex: 1, gap: Spacing.one }}>
              <Text style={[Type.secondary, { color: Colors.inkSoft }]}>{longDate()}</Text>
              <Text style={[Type.display, { color: Colors.ink }]} accessibilityRole="header">
                Today
              </Text>
            </View>
            <View style={{ paddingTop: Spacing.one }}>
              <IconButton name="plus" label="Add a reminder" onPress={() => router.push('/add-reminder')} tone="dusk" />
            </View>
          </View>
        </Sky>

        {error ? <Notice tone="attention" title="Today didn't load" body={error} onDismiss={() => setError(null)} /> : null}

        {events && !events.some((e) => e.type === 'PRACTICE') ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Open Remember"
            accessibilityHint="A few minutes with the people you know"
            onPress={() => router.navigate('/(tabs)/remember')}
            style={styles.invite}>
            <View style={styles.inviteIcon}>
              <Icon name="photo.on.rectangle" size={22} color={Colors.apricotDeep} weight="semibold" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.inviteTitle}>A few minutes to remember</Text>
              <Text style={[Type.secondary, { color: Colors.inkSoft }]}>
                Sit with the people {who === 'you' ? 'you know' : `${who} knows`}, one face at a time.
              </Text>
            </View>
            <Icon name="chevron.right" size={14} color={Colors.inkMute} weight="bold" />
          </PressableScale>
        ) : null}

        <Group
          title="Coming up"
          footer={reminders?.length ? 'The glasses say each one at its time. Touch and hold to remove one.' : undefined}>
          {reminders && reminders.length > 0 ? (
            reminders.map((r) => (
              <Row
                key={r.id}
                leading={
                  <View style={styles.time}>
                    <Text style={styles.timeText}>{timeOf(r.dueAt)}</Text>
                    {!isToday(r.dueAt) ? <Text style={styles.timeSub}>{whenText(r.dueAt).split(' at ')[0]}</Text> : null}
                  </View>
                }
                title={r.text}
                onLongPress={() => deleteReminder(r)}
                accessibilityHint="Touch and hold to remove"
              />
            ))
          ) : (
            <View style={styles.quietEmpty}>
              <Text style={styles.quietEmptyTitle}>Nothing scheduled</Text>
              <Text style={styles.quietEmptyBody}>
                Add a reminder and the glasses will say it to {who} at the right moment.
              </Text>
              <Button title="Add a reminder" variant="secondary" icon="bell" onPress={() => router.push('/add-reminder')} style={{ alignSelf: 'flex-start', marginTop: Spacing.two }} />
            </View>
          )}
        </Group>

        {events && events.length > 0 ? (
          <Group title="Moments" footer="Only moments are kept; camera frames are never saved. Touch and hold a moment to delete it.">
            {events.map((e) => {
              const d = describe(e, who);
              return (
                <Row
                  key={e.id}
                  icon={d.icon}
                  iconTone={d.tone}
                  title={d.title}
                  detail={e.text}
                  value={timeOf(e.createdAt)}
                  valueTone="mute"
                  onLongPress={() => deleteEvent(e)}
                  accessibilityHint="Touch and hold to delete"
                />
              );
            })}
          </Group>
        ) : events ? (
          <EmptyState
            icon="sun.max"
            title="A quiet day so far"
            body="Moments appear here as the glasses recognize people, answer questions, and speak reminders."
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Gutter, paddingBottom: Spacing.ten, gap: Spacing.five },
  sky: { marginHorizontal: -Gutter, paddingHorizontal: Gutter, paddingBottom: Spacing.five + 2 },
  skyInner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  time: { width: 72, gap: 1 },
  timeText: { ...Type.secondaryBold, color: Colors.duskDeep },
  timeSub: { ...Type.caption, color: Colors.inkMute },
  quietEmpty: { padding: Spacing.five, gap: Spacing.one },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    padding: Spacing.four,
    borderWidth: 1.5,
    borderColor: Colors.apricotMist,
  },
  inviteIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.apricotMist, alignItems: 'center', justifyContent: 'center' },
  inviteTitle: { fontFamily: Fonts.display, fontSize: 18, lineHeight: 24, letterSpacing: -0.2, color: Colors.ink },
  quietEmptyTitle: { ...Type.headline, color: Colors.ink },
  quietEmptyBody: { ...Type.secondary, color: Colors.inkSoft },
});
