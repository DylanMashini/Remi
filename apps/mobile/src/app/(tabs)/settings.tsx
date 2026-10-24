import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Card, Display, Field, Label } from '@/components/ui';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { setStatus, useFeed } from '@/lib/feed';
import { errorMessage, Glasses, glassesAvailable } from '@/lib/glasses';
import { useSession } from '@/lib/session';

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, warn && { color: Colors.attention }]}>{v}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { backendUrl, setBackendUrl, signOut, userName } = useSession();
  const { status, portName } = useFeed();
  const [url, setUrl] = useState(backendUrl);
  const [msg, setMsg] = useState<{ tone: 'mist' | 'attention'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'mist', text: ok });
    } catch (e) {
      setMsg({ tone: 'attention', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const refresh = () =>
    run(
      'status',
      async () => setStatus(await Glasses.getStatus()),
      'Status updated.'
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Display>Settings</Display>
        {msg ? <Banner tone={msg.tone} title={msg.tone === 'mist' ? 'Done' : 'Heads up'} body={msg.text} onClose={() => setMsg(null)} /> : null}

        <Card>
          <Label>Glasses</Label>
          <Row k="Native module" v={glassesAvailable ? 'Loaded' : 'Missing from this build'} warn={!glassesAvailable} />
          <Row k="Registration" v={status.registration} warn={status.registration !== 'registered'} />
          <Row k="Connection" v={status.connection} warn={status.connection !== 'connected'} />
          <Row k="Streaming" v={status.streaming ? 'Yes' : 'No'} />
          <Row
            k="Audio route"
            v={`${status.audioRoute}${portName ? ` (${portName})` : ''}`}
            warn={status.audioRoute === 'speaker' || status.audioRoute === 'other'}
          />
          {status.mock ? <Row k="Device" v="Mock Device Kit" /> : null}
          <View style={styles.buttons}>
            <Button
              title="Register glasses"
              loading={busy === 'register'}
              onPress={() => run('register', () => Glasses.register(), 'Finish in the Meta AI app, then come back.')}
            />
            <Button title="Refresh" variant="quiet" loading={busy === 'status'} onPress={refresh} />
          </View>
        </Card>

        <Card>
          <Field
            label="Backend URL"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint="Mac's LAN IP on the phone hotspot, port 3000."
          />
          <Button
            title="Save URL"
            variant="outline"
            loading={busy === 'url'}
            disabled={url.trim() === backendUrl}
            onPress={() => run('url', () => setBackendUrl(url), 'Backend URL saved and sent to the glasses module.')}
          />
        </Card>

        <Card>
          <Label>Account</Label>
          {userName ? <Row k="Signed in as" v={userName} /> : null}
          <Button title="Sign out" variant="quiet" onPress={signOut} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.linen },
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.eight },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.four },
  k: { fontFamily: Fonts.body, fontSize: 16, color: Colors.inkSoft },
  v: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink, flexShrink: 1, textAlign: 'right' },
  buttons: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
});
