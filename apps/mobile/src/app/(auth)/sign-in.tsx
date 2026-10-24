import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';

import { Button, Field, IconButton, Notice, Screen, ScreenHeader, TextButton } from '@/components/ui';
import { Gutter, Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/glasses';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.nav}>
            <IconButton name="chevron.left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)'))} tone="surface" />
          </View>
          <ScreenHeader title="Welcome back" lead="Sign in to the account that set up the glasses." />
          <View style={styles.form}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              returnKeyType="next"
              autoFocus
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            {error ? <Notice tone="attention" title="Not signed in" body={error} onDismiss={() => setError(null)} /> : null}
            <Button
              title="Sign in"
              size="large"
              onPress={submit}
              loading={busy}
              disabled={!email.trim() || !password}
              style={{ marginTop: Spacing.two }}
            />
            <TextButton
              title="New here? Create an account"
              onPress={() => router.replace('/(auth)/who')}
              style={{ alignSelf: 'center' }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: Spacing.eight },
  nav: { paddingHorizontal: Gutter, paddingTop: Spacing.two },
  form: { paddingHorizontal: Gutter, gap: Spacing.five },
});
