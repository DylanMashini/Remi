import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Group, Notice, Row, Screen, ScreenHeader } from '@/components/ui';
import { Colors, Gutter, Spacing } from '@/constants/theme';
import { setStatus, useFeed } from '@/lib/feed';
import { hostOf } from '@/lib/format';
import { errorMessage, Glasses, glassesAvailable, glassesHas } from '@/lib/glasses';
import {
  clearPhotoIndex,
  hasPhotoAccess,
  pausePhotoIndex,
  photoIndexDetail,
  photoIndexSupported,
  startPhotoIndex,
  usePhotoIndex,
} from '@/lib/photoIndex';
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

  const canSync = glassesHas('syncRoster');

  // Photo library index: same row, same buttons, whoever is signed in. It is this phone's library.
  const photoIndex = usePhotoIndex();
  const indexing = photoIndex?.state === 'indexing';
  const indexDone = photoIndex?.state === 'done';
  const indexDenied = photoIndex?.permission === 'denied';
  const indexProgress = photoIndex && photoIndex.total > 0 ? Math.min(1, photoIndex.indexed / photoIndex.total) : 0;
  const indexTitle = indexing ? 'Pause' : photoIndex?.state === 'paused' ? 'Resume' : indexDone ? 'Index again' : 'Index photos';
  const indexHasData = !!photoIndex && (photoIndex.faces > 0 || photoIndex.indexed > 0);
  const confirmClearIndex = () =>
    Alert.alert('Clear the photo index?', 'Recall forgets the faces it found in your photos. You can index again any time.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => run('indexClear', clearPhotoIndex, 'Photo index cleared.') },
    ]);
  const rosterText =
    status.rosterPeople && status.rosterPeople > 0
      ? `${status.rosterPeople} ${status.rosterPeople === 1 ? 'person' : 'people'}, ${status.rosterSamples ?? 0} photos ready on this phone`
      : 'People load onto the phone when the glasses start';

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
          footer="A small face model runs on this phone. Each camera frame is matched here and discarded; only who was seen goes to the memory log. No picture ever leaves the phone.">
          <Row icon="iphone" iconTone="harbor" title="Faces are recognized on this phone" detail={rosterText} />
          <View style={styles.buttons}>
            <Button
              title="Refresh people"
              variant="quiet"
              icon="arrow.clockwise"
              disabled={!canSync}
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
          {photoIndexSupported ? (
            <View>
              <Row
                icon="photo.on.rectangle"
                iconTone={indexDenied ? 'attention' : 'harbor'}
                title="Photo library"
                detail={photoIndexDetail(photoIndex)}
              />
              {indexing || photoIndex?.state === 'paused' ? (
                <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ now: Math.round(indexProgress * 100), min: 0, max: 100 }}>
                  <View style={[styles.progressFill, { width: `${Math.max(2, indexProgress * 100)}%` }]} />
                </View>
              ) : null}
              <View style={styles.buttons}>
                {indexDenied ? (
                  <Button title="Open iOS Settings" variant="quiet" icon="gear" onPress={() => Linking.openSettings()} style={{ flex: 1 }} />
                ) : (
                  <Button
                    title={indexTitle}
                    variant={indexing ? 'secondary' : 'quiet'}
                    icon={indexing ? 'pause.fill' : 'photo.on.rectangle'}
                    loading={busy === 'index'}
                    onPress={() =>
                      run(
                        'index',
                        async () => {
                          if (indexing) {
                            await pausePhotoIndex();
                            return;
                          }
                          const s = await startPhotoIndex();
                          if (!hasPhotoAccess(s)) throw new Error('Photos access is off. Allow it in iOS Settings to use suggestions.');
                        },
                        indexing ? 'Indexing paused.' : 'Indexing your photos on this phone.'
                      )
                    }
                    style={{ flex: 1 }}
                  />
                )}
                {indexHasData ? <Button title="Clear index" variant="quiet" loading={busy === 'indexClear'} onPress={confirmClearIndex} /> : null}
              </View>
            </View>
          ) : null}
        </Group>

        <Group title="Privacy" footer="These are built in, not settings. They cannot be turned off.">
          <Row icon="person.2" iconTone="harbor" title="Only people you add are recognized" detail="No search of strangers, ever." />
          <Row icon="eye.slash" iconTone="harbor" title="Camera frames never leave the phone" detail="Each frame is matched on the phone and discarded." />
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
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.sand,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.one,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: Colors.harbor },
});
