import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';

import { Button, Field, IconButton, Notice, Screen, ScreenHeader, TextButton } from '@/components/ui';
import { Gutter, Spacing } from '@/constants/theme';
import { firstName } from '@/lib/format';
import { errorMessage } from '@/lib/glasses';
import { useSession, type Role } from '@/lib/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CreateAccount() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role = params.role === 'WEARER' ? 'WEARER' : 'CAREGIVER';
  const caregiver = role === 'CAREGIVER';
  const { signUp } = useSession();

  const [patientName, setPatientName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const nameRef = useRef<TextInputInstance>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const emailOk = EMAIL_RE.test(email.trim());
  const passwordOk = password.length >= 8;
  const complete = (!caregiver || patientName.trim()) && name.trim() && emailOk && passwordOk;

  const submit = async () => {
    setTouched(true);
    if (!complete) return;
    setBusy(true);
    setError(null);
    try {
      await signUp({ role, name, patientName: caregiver ? patientName : name, email, password });
      // Signed in: the root stack swaps to the tabs.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const who = caregiver && patientName.trim() ? firstName(patientName) : null;

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive">
          <View style={styles.nav}>
            <IconButton name="chevron.left" label="Back" onPress={() => router.back()} tone="surface" />
          </View>
          <ScreenHeader
            title={caregiver ? 'Set up for someone' : 'Set up for yourself'}
            lead={
              caregiver
                ? 'You get a caregiver account. The glasses speak to them; this phone and the web dashboard are yours.'
                : 'Your account is for you. The glasses will speak to you, and this phone shows what they say.'
            }
          />

          <View style={styles.form}>
            {caregiver ? (
              <Field
                label="Who will wear the glasses?"
                value={patientName}
                onChangeText={setPatientName}
                placeholder="Their first name"
                autoCapitalize="words"
                autoComplete="off"
                textContentType="none"
                returnKeyType="next"
                autoFocus
                onSubmitEditing={() => nameRef.current?.focus()}
                hint="This is how the glasses will address them."
                error={touched && !patientName.trim() ? 'Enter their name.' : null}
              />
            ) : null}
            <Field
              ref={nameRef}
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder={caregiver ? 'Your name' : 'Your first name'}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              returnKeyType="next"
              autoFocus={!caregiver}
              onSubmitEditing={() => emailRef.current?.focus()}
              error={touched && !name.trim() ? 'Enter your name.' : null}
            />
            <Field
              ref={emailRef}
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              error={touched && !emailOk ? 'Enter a valid email address.' : null}
            />
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              passwordRules="minlength: 8;"
              returnKeyType="go"
              onSubmitEditing={submit}
              hint="At least 8 characters."
              error={touched && !passwordOk ? 'Use at least 8 characters.' : null}
            />

            {error ? <Notice tone="attention" title="Account not created" body={error} onDismiss={() => setError(null)} /> : null}

            <Button
              title={who ? `Create account for ${who}` : 'Create account'}
              size="large"
              onPress={submit}
              loading={busy}
              style={{ marginTop: Spacing.two }}
            />
            <TextButton
              title="Already set up? Sign in"
              onPress={() => router.replace('/(auth)/sign-in')}
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
