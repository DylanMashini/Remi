import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, type TextInputInstance, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Display, Field } from '@/components/ui';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/glasses';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { backendUrl, signIn } = useSession();
  const [url, setUrl] = useState(backendUrl);
  const [email, setEmail] = useState('demo@recall.local');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(url, email, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={{ gap: Spacing.two }}>
            <Text style={styles.wordmark}>Recall</Text>
            <Display>Welcome back.</Display>
            <Body style={{ color: Colors.inkSoft }}>
              Sign in as the caregiver. The glasses use this phone to remember faces and speak.
            </Body>
          </View>
          <Card>
            <Field
              label="Backend URL"
              value={url}
              onChangeText={setUrl}
              placeholder="http://192.168.x.x:3000"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint="Your Mac's LAN IP on the phone hotspot. Not localhost."
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.linen },
  scroll: { padding: Spacing.six, gap: Spacing.six, paddingTop: Spacing.eight },
  wordmark: { fontFamily: Fonts.display, fontSize: 22, color: Colors.harbor },
  error: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.attention },
});
