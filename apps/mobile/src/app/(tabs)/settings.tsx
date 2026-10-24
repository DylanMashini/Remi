import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button, Group, Notice, Row, Screen, ScreenHeader } from '@/components/ui';
import { Gutter, Spacing } from '@/constants/theme';
import { setStatus, useFeed } from '@/lib/feed';
import { hostOf } from '@/lib/format';
import { errorMessage, Glasses, glassesAvailable, glassesHas } from '@/lib/glasses';
import { BACKEND_URL, useSession } from '@/lib/session';

export default function SettingsScreen() {
  const { account, signOut } = useSession();
  const { status, portName } = useFeed();
  const [msg, setMsg] = useState<{ tone: 'success' | 'attention'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'attention', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const connection =
    status.connection === 'connected' ? 'Connected' : status.connection === 'connecting' ? 'Connecting' : 'Not connected';
  const registration =
    status.registration === 'registered' ? 'Paired' : status.registration === 'registering' ? 'Pairing' : 'Not paired';
  const audio =
    status.audioRoute === 'a2dp'
      ? 'Through the glasses'
      : status.audioRoute === 'hfp'
        ? 'Through the glasses (call quality)'
        : status.audioRoute === 'speaker'
          ? 'Phone speaker'
          : portName
            ? portName
            : 'Not set yet';
  const audioGood = status.audioRoute === 'a2dp' || status.audioRoute === 'hfp';

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'The glasses stop until someone signs in again on this phone.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);

  const caregiver = account?.role !== 'WEARER';

  const localSupported = glassesHas('setLocalRecognition');
  const local = status.localRecognition === true;
  const toggleLocal = (on: boolean) =>
    run(
      'local',
      async () => setStatus(await Glasses.setLocalRecognition(on)),
      on ? 'Faces are now recognized on this phone. Camera frames stay on the device.' : 'Faces are recognized by the server again.'
    );
  const rosterText =
    status.rosterPeople && status.rosterPeople > 0
      ? `${status.rosterPeople} ${status.rosterPeople === 1 ? 'person' : 'people'}, ${status.rosterSamples ?? 0} photos ready`
      : 'No one loaded yet';

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Settings" />

        {msg ? <Notice tone={msg.tone} body={msg.text} onDismiss={() => setMsg(null)} /> : null}

        <Group title="Account">
          <Row title="Name" value={account?.name ?? ''} />
          <Row title="Email" value={account?.email ?? ''} valueTone="mute" />
          <Row
            title={caregiver ? 'Caring for' : 'Set up for'}
            value={caregiver ? account?.patient.name ?? '' : 'Yourself'}
            valueTone="good"
          />
        </Group>

        <Group
          title="Glasses"
          footer={
            status.registration === 'registered'
              ? 'Pairing is done once. To re-pair, turn on Developer Mode in the Meta AI app and pair again.'
              : 'Pairing opens the Meta AI app. Turn on Developer Mode there first: Settings, App Info, tap the version five times.'
          }>
          <Row title="Connection" value={connection} valueTone={status.connection === 'connected' ? 'good' : 'mute'} />
          <Row title="Paired with Meta AI" value={registration} valueTone={status.registration === 'registered' ? 'good' : 'attention'} />
          <Row
            title="Voice plays"
            value={audio}
            valueTone={audioGood ? 'good' : status.audioRoute === 'speaker' ? 'attention' : 'mute'}
          />
          <Row title="Camera" value={status.mock ? 'Phone camera' : 'Ray-Ban Meta'} valueTone="mute" />
          <View style={styles.buttons}>
            <Button
              title={status.registration === 'registered' ? 'Pair again' : 'Pair glasses'}
              icon="link"
              loading={busy === 'register'}
              onPress={() => run('register', () => Glasses.register(), 'Finish pairing in the Meta AI app, then come back here.')}
              style={{ flex: 1 }}
            />
            <Button
              title="Check again"
              variant="quiet"
              loading={busy === 'status'}
              onPress={() => run('status', async () => setStatus(await Glasses.getStatus()), 'Status is up to date.')}
            />
          </View>
        </Group>

        <Group
          title="Recognition"
          footer={
            localSupported
              ? 'On: each camera frame is matched on this phone with a small face model and discarded; only who was seen is sent to the memory log. Off: frames go to the Recall server for matching.'
              : 'This build does not include the on-device face model. Faces are matched by the Recall server.'
          }>
          <Row
            icon="iphone"
            iconTone="harbor"
            title="Recognize faces on this phone"
            detail={local ? rosterText : 'Frames are matched by the server'}
            trailing={
              <Switch
                value={local}
                disabled={!localSupported || busy === 'local'}
                onValueChange={toggleLocal}
                accessibilityLabel="Recognize faces on this phone"
              />
            }
          />
          {local ? (
            <View style={styles.buttons}>
              <Button
                title="Refresh people"
                variant="quiet"
                icon="arrow.clockwise"
                loading={busy === 'roster'}
                onPress={() =>
                  run(
                    'roster',
                    async () => {
                      const r = await Glasses.syncRoster();
                      setStatus(await Glasses.getStatus());
                      setMsg({ tone: 'success', text: `${r.people} ${r.people === 1 ? 'person' : 'people'} loaded, ${r.samples} photos ready.` });
                    },
                    'People are up to date.'
                  )
                }
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
        </Group>

        <Group title="Privacy" footer="These are built in, not settings. They cannot be turned off.">
          <Row icon="person.2" iconTone="harbor" title="Only people you add are recognized" detail="No search of strangers, ever." />
          <Row icon="eye.slash" iconTone="harbor" title="Camera frames are never saved" detail="Each frame is matched in memory and discarded." />
          <Row icon="trash" iconTone="harbor" title="You can delete any moment" detail="Touch and hold a moment in Today." />
        </Group>

        <Group title="About">
          <Row title="Version" value={Constants.expoConfig?.version ?? '1.0.0'} valueTone="mute" />
          <Row title="Server" value={BACKEND_URL ? hostOf(BACKEND_URL) : 'Not configured'} valueTone={BACKEND_URL ? 'mute' : 'attention'} />
          <Row title="Glasses module" value={glassesAvailable ? 'Loaded' : 'Missing from this build'} valueTone={glassesAvailable ? 'mute' : 'attention'} />
        </Group>

        <Button title="Sign out" variant="quiet" onPress={confirmSignOut} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Gutter, paddingBottom: Spacing.ten, gap: Spacing.five },
  buttons: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.four, paddingTop: Spacing.two },
});
