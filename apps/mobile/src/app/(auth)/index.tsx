import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, Icon, Screen, TextButton, Wordmark } from '@/components/ui';
import { Colors, Fonts, Gutter, Spacing } from '@/constants/theme';
import { BACKEND_URL } from '@/lib/session';

export default function Welcome() {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Wordmark size={26} />
      </View>

      <View style={styles.hero}>
        <View style={styles.mark}>
          <Icon name="eyeglasses" size={44} color={Colors.surface} weight="regular" />
        </View>
        <Text style={styles.headline} accessibilityRole="header">
          A name, a face,{'\n'}a gentle reminder.
        </Text>
        <Body color={Colors.inkSoft} style={{ maxWidth: 320 }}>
          Recall lives in a pair of glasses. It quietly says who is here, what was just said, and
          what comes next.
        </Body>
      </View>

      <View style={styles.actions}>
        {!BACKEND_URL ? (
          <Text style={styles.config}>This build has no server configured. Set EXPO_PUBLIC_BACKEND_URL and restart Metro.</Text>
        ) : null}
        <Button title="Get started" size="large" onPress={() => router.push('/(auth)/who')} />
        <TextButton
          title="I already have an account"
          onPress={() => router.push('/(auth)/sign-in')}
          style={{ alignSelf: 'center' }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: Gutter, paddingTop: Spacing.four },
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Gutter,
    gap: Spacing.five,
  },
  mark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.harbor,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1,
    color: Colors.ink,
  },
  actions: { paddingHorizontal: Gutter, paddingBottom: Spacing.four, gap: Spacing.three },
  config: { fontFamily: Fonts.bodyBold, fontSize: 14, lineHeight: 20, color: Colors.attention },
});
