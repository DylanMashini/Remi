import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Body, Display, initials } from '@/components/ui';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/glasses';
import { apiFetch, readError, useSession } from '@/lib/session';

type Person = {
  id: string;
  name: string;
  relationship: string | null;
  notes: string | null;
  avatarUrl: string | null;
  samples: number;
  lastSeenAt: string | null;
};

function lastSeen(iso: string | null): string {
  if (!iso) return 'Not seen yet';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `Seen ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `Seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export default function PeopleScreen() {
  const { backendUrl, token } = useSession();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(backendUrl, '/api/people', { token });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { people?: Person[] };
      setPeople(body.people ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [backendUrl, token]);

  // Reload whenever the tab gains focus, so a just-enrolled person shows up.
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <FlatList
        data={people ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.harbor} />
        }
        ListHeaderComponent={
          <View style={{ gap: Spacing.three, marginBottom: Spacing.two }}>
            <Display>People</Display>
            <Body style={{ color: Colors.inkSoft }}>
              Recall only recognizes the people your family adds here.
            </Body>
            {error ? <Banner tone="attention" title="Couldn't load people" body={error} /> : null}
          </View>
        }
        ListEmptyComponent={
          people ? (
            <Body style={{ color: Colors.inkSoft }}>No one yet. Add someone from the Enroll tab.</Body>
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.row,
              index === 0 && styles.first,
              index === (people?.length ?? 0) - 1 && styles.last,
            ]}>
            {item.avatarUrl ? (
              <Image
                source={{
                  uri: `${backendUrl}${item.avatarUrl}`,
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  cacheKey: item.avatarUrl,
                }}
                style={styles.avatar}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.avatarText}>{initials(item.name)}</Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>
                {[item.relationship, `${item.samples} photo${item.samples === 1 ? '' : 's'}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {item.notes ? (
                <Text style={styles.notes} numberOfLines={2}>
                  {item.notes}
                </Text>
              ) : null}
            </View>
            <Text style={styles.seen}>{lastSeen(item.lastSeenAt)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.linen },
  list: { padding: Spacing.four, paddingBottom: Spacing.eight },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: Spacing.five,
    backgroundColor: Colors.surface,
  },
  first: { borderTopLeftRadius: Radii.md, borderTopRightRadius: Radii.md },
  last: { borderBottomLeftRadius: Radii.md, borderBottomRightRadius: Radii.md },
  sep: { height: 1, backgroundColor: Colors.sand, marginHorizontal: Spacing.five },
  avatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: Colors.apricot },
  avatarEmpty: { backgroundColor: Colors.apricot, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.display, fontSize: 22, color: Colors.ink },
  name: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 15, color: Colors.harborDeep },
  notes: { fontFamily: Fonts.body, fontSize: 14, color: Colors.inkSoft },
  seen: { fontFamily: Fonts.body, fontSize: 13, color: Colors.inkSoft, alignSelf: 'flex-start' },
});
