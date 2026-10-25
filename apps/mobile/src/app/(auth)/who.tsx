import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ChoiceCard, IconButton, Screen, ScreenHeader, Secondary } from '@/components/ui';
import { Gutter, Spacing } from '@/constants/theme';

export default function WhoScreen() {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.nav}>
        <IconButton name="chevron.left" label="Back" onPress={() => router.back()} tone="surface" />
      </View>
      <ScreenHeader
        title="Who will wear the glasses?"
        lead="This shapes how Remi speaks and what you see on this phone. You can add family later."
      />
      <View style={styles.choices}>
        <ChoiceCard
          icon="person.fill"
          title="I will"
          body="I'm setting Remi up for myself."
          onPress={() => router.push({ pathname: '/(auth)/create', params: { role: 'WEARER' } })}
        />
        <ChoiceCard
          icon="person.2.fill"
          title="Someone I care for"
          body="I'm a family member or caregiver. I'll manage people and reminders for them."
          onPress={() => router.push({ pathname: '/(auth)/create', params: { role: 'CAREGIVER' } })}
        />
      </View>
      <View style={styles.footer}>
        <Secondary>
          Either way, Remi only recognizes people you add. Camera frames are never saved.
        </Secondary>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { paddingHorizontal: Gutter, paddingTop: Spacing.two },
  choices: { paddingHorizontal: Gutter, gap: Spacing.three },
  footer: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: Gutter, paddingBottom: Spacing.six },
});
