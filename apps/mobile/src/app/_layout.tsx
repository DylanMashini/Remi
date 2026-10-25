import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import { Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { Colors } from '@/constants/theme';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 300 });

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.dusk,
    background: Colors.linen,
    card: Colors.surface,
    text: Colors.ink,
    border: Colors.line,
  },
};

function RootStack() {
  const { ready, token } = useSession();
  const [fontsLoaded, fontError] = useFonts({
    Nunito_700Bold,
    Nunito_800ExtraBold,
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });
  const done = ready && (fontsLoaded || fontError != null);

  useEffect(() => {
    if (fontError) console.warn('[fonts] failed to load, using system fonts', fontError);
  }, [fontError]);

  useEffect(() => {
    if (done) SplashScreen.hideAsync();
  }, [done]);

  if (!done) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.linen } }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="person/[id]" />
        <Stack.Screen name="add-person" options={{ presentation: 'modal', gestureEnabled: false }} />
        <Stack.Screen name="add-reminder" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-person" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-memory" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="dark" />
      <SessionProvider>
        <RootStack />
      </SessionProvider>
    </ThemeProvider>
  );
}
