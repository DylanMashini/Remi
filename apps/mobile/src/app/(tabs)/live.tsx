import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { HorizonMark, Sky, Wordmark } from '@/components/brand';
import { BottomBar, Button, Group, Icon, IconButton, Notice, Row, Screen, StatusPill, TextButton } from '@/components/ui';
import { Colors, Fonts, Gutter, Radii, Shadow, Spacing, Type } from '@/constants/theme';
import { clearError, dismissReminder, panSide, pushSpoken, reportError, setStatus, useFeed, type SpokenLine } from '@/lib/feed';
import { timeOf } from '@/lib/format';
import { errorMessage, Glasses, GlassesPreviewView, type GlassesStatus } from '@/lib/glasses';
import { useSession, wearerName } from '@/lib/session';

const FACE_TTL_MS = 1500;

function statusPill(status: GlassesStatus, portName: string | null): { tone: 'good' | 'idle' | 'attention'; label: string } {
  if (status.streaming && status.mock) return { tone: 'good', label: 'Phone camera' };
  if (status.streaming && (status.audioRoute === 'speaker' || status.audioRoute === 'other')) {
    return { tone: 'attention', label: portName && status.audioRoute === 'other' ? `Audio on ${portName}` : 'Audio on phone speaker' };
  }
  if (status.connection === 'connected') return { tone: 'good', label: 'Glasses connected' };
  if (status.connection === 'connecting') return { tone: 'idle', label: 'Connecting' };
  return { tone: 'idle', label: 'Glasses not connected' };
}

function routeText(route?: string, pan?: number): { text: string; warn: boolean } | null {
  if (!route) return null;
  const r = route.toLowerCase();
  if (r.includes('a2dp') || r.includes('hfp') || r.includes('bluetooth') || r.includes('glasses')) {
    // A2DP is stereo: the name is whispered from the side the person is standing on.
    const side = r.includes('a2dp') ? panSide(pan) : null;
    return { text: side ? `Whispered in the ${side} ear` : 'Spoken through the glasses', warn: false };
  }
  if (r.includes('speaker')) return { text: 'Played on the phone speaker', warn: true };
  return { text: `Played on ${route}`, warn: true };
}

/** Everything Remi says is attributed to Remi by name, never to "the glasses". */
const sourceLabel: Record<SpokenLine['source'], string> = {
  recognition: 'Remi said',
  answer: 'Remi answered',
  reminder: 'Remi reminded',
};

export default function LiveScreen() {
  const feed = useFeed();
  const { account } = useSession();
  const { height } = useWindowDimensions();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [expiredFrameAt, setExpiredFrameAt] = useState(0);
  const [streamBusy, setStreamBusy] = useState(false);
  const [ask, setAsk] = useState<'idle' | 'listening' | 'thinking'>('idle');

  // Hide boxes once no new frame result has arrived for FACE_TTL_MS.
  useEffect(() => {
    if (!feed.lastFrameAt) return;
    const at = feed.lastFrameAt;
    const t = setTimeout(() => setExpiredFrameAt(at), FACE_TTL_MS);
    return () => clearTimeout(t);
  }, [feed.lastFrameAt]);

  const { status } = feed;
  const facesFresh = feed.lastFrameAt > 0 && feed.lastFrameAt !== expiredFrameAt;
  const who = wearerName(account);
  const possessive = who === 'you' ? 'your' : `${who}'s`;

  // Aspect-fit mapping from frame pixels to the preview view.
  const fw = feed.frameWidth || 504;
  const fh = feed.frameHeight || 896;
  const scale = box.w && box.h ? Math.min(box.w / fw, box.h / fh) : 0;
  const offX = (box.w - fw * scale) / 2;
  const offY = (box.h - fh * scale) / 2;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setBox({ w: width, h });
  };

  const startStream = async (mock = false) => {
    setStreamBusy(true);
    try {
      await Glasses.startStream(mock ? { mock: true } : undefined);
      setStatus({ ...status, streaming: true, mock });
    } catch (e) {
      reportError(e);
    } finally {
      setStreamBusy(false);
    }
  };

  const stopStream = async () => {
    setStreamBusy(true);
    try {
      await Glasses.stopStream();
      setStatus({ ...status, streaming: false });
    } catch (e) {
      reportError(e);
    } finally {
      setStreamBusy(false);
    }
  };

  const toggleAsk = async () => {
    if (ask === 'idle') {
      try {
        await Glasses.startAsk();
        setAsk('listening');
      } catch (e) {
        reportError(e);
      }
    } else if (ask === 'listening') {
      setAsk('thinking');
      try {
        const r = await Glasses.stopAsk();
        if (r.answer) pushSpoken(r.answer, 'answer', { question: r.question });
      } catch (e) {
        reportError(`Ask failed: ${errorMessage(e)}`);
      } finally {
        setAsk('idle');
      }
    }
  };

  const last = feed.spoken[0];
  const lastRoute = routeText(last?.route, last?.pan);
  const pill = statusPill(status, feed.portName);
  const viewfinderHeight = Math.max(300, Math.round(height * 0.42));

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <Wordmark />
        <StatusPill tone={pill.tone} label={pill.label} onPress={() => router.navigate('/(tabs)/settings')} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        {feed.error ? (
          <Notice tone="attention" title="Something needs attention" body={feed.error.message} onDismiss={clearError} />
        ) : null}
        {feed.reminder ? (
          <Notice tone="info" icon="bell.fill" title="Remi reminded" body={feed.reminder.text} onDismiss={dismissReminder} />
        ) : null}

        <View style={styles.card}>
          <View style={[styles.viewfinder, { height: viewfinderHeight }]} onLayout={onLayout}>
            {GlassesPreviewView ? <GlassesPreviewView style={StyleSheet.absoluteFill} /> : null}

            {!status.streaming ? (
              <View style={styles.resting} pointerEvents="none">
                <Icon name="eyeglasses" size={40} color={Colors.nightText} weight="light" />
                <Text style={styles.restingTitle}>
                  {GlassesPreviewView ? 'The glasses are resting' : 'Preview is not in this build'}
                </Text>
                <Text style={styles.restingBody}>
                  {GlassesPreviewView
                    ? `Start to see what ${possessive} glasses see, and what they say.`
                    : 'Rebuild the app with the glasses module to see the camera here.'}
                </Text>
              </View>
            ) : null}

            {status.streaming && !feed.lastFrameAt ? (
              <View style={[styles.badge, styles.badgeTopLeft]}>
                <Text style={styles.badgeText}>Waiting for the first frame</Text>
              </View>
            ) : status.streaming && status.mock ? (
              <View style={[styles.badge, styles.badgeTopLeft]}>
                <Icon name="iphone" size={12} color={Colors.nightText} weight="semibold" />
                <Text style={styles.badgeText}>Phone camera</Text>
              </View>
            ) : null}

            {facesFresh && scale > 0
              ? feed.faces.map((f, i) => {
                  const [x, y, w, h] = f.box;
                  const known = !!f.name;
                  return (
                    <View
                      key={`${f.personId ?? 'u'}-${i}`}
                      pointerEvents="none"
                      style={[
                        styles.faceBox,
                        {
                          left: offX + x * scale,
                          top: offY + y * scale,
                          width: w * scale,
                          height: h * scale,
                          borderColor: known ? Colors.apricot : Colors.nightText,
                        },
                      ]}>
                      <View style={[styles.faceLabel, { backgroundColor: known ? Colors.apricot : Colors.sand }]}>
                        <Text numberOfLines={1} style={styles.faceLabelText}>
                          {known ? f.name : 'Someone new'}
                        </Text>
                      </View>
                    </View>
                  );
                })
              : null}
          </View>

          {/* Remi's voice sits on the sky of the hour; the card ends at the horizon line. */}
          <Sky style={styles.words}>
            {last ? (
              <>
                <View style={styles.meta}>
                  <View style={styles.metaRow}>
                    <HorizonMark size={18} />
                    <Text style={styles.metaText}>
                      {sourceLabel[last.source]} at {timeOf(last.at)}
                    </Text>
                  </View>
                  {last.source === 'answer' && last.question ? (
                    <Text style={styles.question} numberOfLines={2}>
                      {who === 'you' ? 'You asked' : `${who} asked`}: {last.question}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.spoken} accessibilityLiveRegion="polite">
                  {last.text}
                </Text>
                {lastRoute ? (
                  <View style={styles.route}>
                    <Icon
                      name={lastRoute.warn ? 'speaker.wave.2.fill' : 'eyeglasses'}
                      size={14}
                      color={lastRoute.warn ? Colors.attention : Colors.duskDeep}
                      weight="semibold"
                    />
                    <Text style={[styles.routeText, lastRoute.warn && { color: Colors.attention }]}>{lastRoute.text}</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.metaRow}>
                  <HorizonMark size={18} />
                  <Text style={styles.metaText}>Remi hasn&apos;t spoken yet</Text>
                </View>
                <Text style={styles.spokenEmpty}>
                  When someone {who === 'you' ? 'you know walks' : `${who} knows walks`} up, Remi says their name here.
                </Text>
              </>
            )}
          </Sky>
        </View>

        {ask === 'listening' ? (
          <Sky style={styles.listening} accessibilityLiveRegion="polite">
            <HorizonMark size={56} state="listening" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.listeningTitle}>Remi is listening</Text>
              <Text style={styles.listeningBody}>Ask your question out loud, then tap Done.</Text>
            </View>
          </Sky>
        ) : null}

        {feed.spoken.length > 1 ? (
          <Group title="Earlier">
            {feed.spoken.slice(1, 8).map((l) => (
              <Row key={l.id} title={l.text} detail={sourceLabel[l.source]} value={timeOf(l.at)} valueTone="mute" />
            ))}
          </Group>
        ) : null}
      </ScrollView>

      <BottomBar>
        {status.streaming ? (
          <View style={styles.actions}>
            <IconButton name="stop.fill" label="Stop the glasses" onPress={stopStream} size={64} tone="sand" />
            <Button
              title={ask === 'listening' ? 'Done' : ask === 'thinking' ? 'Remi is thinking' : 'Ask Remi'}
              icon={ask === 'idle' ? 'mic.fill' : undefined}
              variant={ask === 'listening' ? 'night' : 'primary'}
              size="large"
              onPress={toggleAsk}
              loading={ask === 'thinking' || streamBusy}
              style={{ flex: 1 }}
              accessibilityHint="Tap, let the wearer ask Remi a question out loud, then tap Done"
            />
          </View>
        ) : (
          <View style={{ gap: Spacing.one }}>
            <Button
              title="Start the glasses"
              icon="eyeglasses"
              size="large"
              onPress={() => startStream(false)}
              loading={streamBusy}
            />
            <TextButton
              title="No glasses here? Use the phone camera"
              onPress={() => startStream(true)}
              style={{ alignSelf: 'center' }}
            />
          </View>
        )}
      </BottomBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Gutter,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  body: { paddingHorizontal: Gutter, paddingBottom: Spacing.six, gap: Spacing.four },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    ...Shadow,
  },
  viewfinder: { backgroundColor: Colors.night, overflow: 'hidden' },
  resting: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(18,28,31,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.eight,
    gap: Spacing.three,
  },
  restingTitle: { fontFamily: Fonts.display, fontSize: 20, lineHeight: 26, color: Colors.linen, textAlign: 'center' },
  restingBody: { ...Type.secondary, color: Colors.nightText, textAlign: 'center', maxWidth: 260 },
  badge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(18,28,31,0.72)',
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    height: 28,
  },
  badgeTopLeft: { top: Spacing.three, left: Spacing.three },
  badgeText: { ...Type.captionBold, color: Colors.nightText },
  faceBox: { position: 'absolute', borderWidth: 3, borderRadius: Radii.sm },
  faceLabel: {
    position: 'absolute',
    top: -30,
    left: -3,
    paddingHorizontal: 10,
    height: 26,
    justifyContent: 'center',
    borderRadius: Radii.pill,
    maxWidth: 220,
  },
  faceLabelText: { fontFamily: Fonts.display, fontSize: 15, color: Colors.ink },
  words: { padding: Spacing.five, paddingBottom: Spacing.five + 2, gap: Spacing.two },
  meta: { gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  metaText: { ...Type.secondaryBold, color: Colors.duskDeep },
  question: { ...Type.secondary, color: Colors.inkSoft },
  spoken: { ...Type.spoken, color: Colors.ink },
  spokenEmpty: { ...Type.body, color: Colors.inkSoft },
  route: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.one },
  routeText: { ...Type.secondaryBold, color: Colors.duskDeep },
  listening: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    borderRadius: Radii.md,
    padding: Spacing.five,
  },
  listeningTitle: { fontFamily: Fonts.display, fontSize: 20, lineHeight: 26, color: Colors.ink },
  listeningBody: { ...Type.secondary, color: Colors.inkSoft },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
