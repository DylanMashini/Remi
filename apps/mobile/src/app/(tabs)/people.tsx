import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, EmptyState, Icon, IconButton, Notice, Screen, ScreenHeader } from '@/components/ui';
import { Colors, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { api, type Person } from '@/lib/api';
import { lastSeenText } from '@/lib/format';
import { errorMessage } from '@/lib/glasses';
import { BACKEND_URL, useSession, wearerName } from '@/lib/session';

export default function PeopleScreen() {
  const { token, account } = useSession();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setPeople(await api.people(token));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [token]);

  // Reload whenever the tab gains focus, so a just-added person shows up.
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

  const who = wearerName(account);
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const count = people?.length ?? 0;

  return (
    <Screen edges={['top']}>
      <FlatList
        data={people ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dusk} />}
        ListHeaderComponent={
          <View>
            <ScreenHeader
              title="People"
              lead={
                count
                  ? `Recall recognizes ${count === 1 ? 'one person' : `these ${count} people`}, and no one else.`
                  : undefined
              }
              action={<IconButton name="plus" label="Add a person" onPress={() => router.push('/add-person')} tone="dusk" />}
            />
            {error ? (
              <View style={{ marginBottom: Spacing.four }}>
                <Notice tone="attention" title="People didn't load" body={error} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          people ? (
            <EmptyState
              icon="person.2"
              title="No one yet"
              body={`Add the people ${who === 'you' ? 'you see' : `${who} sees`} most. Three photos and a name is all it takes.`}
              action={<Button title="Add a person" icon="plus" onPress={() => router.push('/add-person')} />}
            />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}${item.relationship ? `, ${item.relationship}` : ''}. ${lastSeenText(item.lastSeenAt)}`}
            accessibilityHint="Opens their details"
            onPress={() => router.push({ pathname: '/person/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              styles.row,
              index === 0 && styles.first,
              index === count - 1 && styles.last,
              pressed && { backgroundColor: Colors.linen },
            ]}>
            <Avatar name={item.name} uri={item.avatarUrl ? `${BACKEND_URL}${item.avatarUrl}` : null} headers={headers} size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.relationship ? capitalize(item.relationship) : 'No relationship set'}</Text>
            </View>
            <Text style={styles.seen}>{lastSeenText(item.lastSeenAt)}</Text>
            <Icon name="chevron.right" size={14} color={Colors.inkMute} weight="bold" />
          </Pressable>
        )}
      />
    </Screen>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Gutter, paddingBottom: Spacing.ten },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    backgroundColor: Colors.surface,
  },
  first: { borderTopLeftRadius: Radii.md, borderTopRightRadius: Radii.md },
  last: { borderBottomLeftRadius: Radii.md, borderBottomRightRadius: Radii.md },
  sep: { height: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.hairline, marginLeft: Spacing.four + 52 + Spacing.three },
  name: { ...Type.headline, color: Colors.ink },
  sub: { ...Type.secondary, color: Colors.inkSoft },
  seen: { ...Type.caption, color: Colors.inkMute, maxWidth: 110, textAlign: 'right' },
});
