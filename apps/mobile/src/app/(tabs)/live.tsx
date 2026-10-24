import { useEffect, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Chip } from '@/components/ui';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import {
  clearError,
  dismissReminder,
  pushSpoken,
  reportError,
  setStatus,
  useFeed,
  type SpokenLine,
} from '@/lib/feed';
import { errorMessage, Glasses, GlassesPreviewView, type AudioRoute } from '@/lib/glasses';

const FACE_TTL_MS = 1500;

function audioChip(route: AudioRoute, portName: string | null) {
  switch (route) {
    case 'a2dp':
      return <Chip tone="mist" dot label="Audio: Glasses" />;
    case 'hfp':
      return <Chip tone="mist" dot label="Audio: Glasses (call mode)" />;
    case 'speaker':
      return <Chip tone="attention" dot label="Audio: Phone speaker" />;
    default:
      return <Chip tone="attention" dot label={`Audio: ${portName ?? 'not glasses'}`} />;
  }
}

function routeLabel(route?: string): { text: string; warn: boolean } | null {
  if (!route) return null;
  const r = route.toLowerCase();
  if (r.includes('a2dp') || r.includes('hfp') || r.includes('bluetooth') || r.includes('glasses')) {
    return { text: 'Spoken through the glasses', warn: false };
  }
  if (r.includes('speaker')) return { text: 'Played on the phone speaker', warn: true };
  return { text: `Played on ${route}`, warn: true };
}

const sourceLabel: Record<SpokenLine['source'], string> = {
  recognition: 'Recognized',
  answer: 'Answer',
  reminder: 'Reminder',
};

function timeOf(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function LiveScreen() {
  const feed = useFeed();
  const { height } = useWindowDimensions();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [expiredFrameAt, setExpiredFrameAt] = useState(0);
  const [streamBusy, setStreamBusy] = useState(false);
  const [ask, setAsk] = useState<'idle' | 'listening' | 'thinking'>('idle');
  const [qa, setQa] = useState<{ question: string; answer: string } | null>(null);

  // Hide boxes once no new frame result has arrived for FACE_TTL_MS.
  useEffect(() => {
    if (!feed.lastFrameAt) return;
    const at = feed.lastFrameAt;
    const t = setTimeout(() => setExpiredFrameAt(at), FACE_TTL_MS);
    return () => clearTimeout(t);
  }, [feed.lastFrameAt]);

  const { status } = feed;
  const connected = status.connection === 'connected';
  const facesFresh = feed.lastFrameAt > 0 && feed.lastFrameAt !== expiredFrameAt;

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

  const toggleStream = async (mock = false) => {
    setStreamBusy(true);
    try {
      if (status.streaming) {
        await Glasses.stopStream();
        setStatus({ ...status, streaming: false });
      } else {
        await Glasses.startStream(mock ? { mock: true } : undefined);
        setStatus({ ...status, streaming: true, mock });
      }
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
        setQa(null);
        setAsk('listening');
      } catch (e) {
        reportError(e);
      }
    } else if (ask === 'listening') {
      setAsk('thinking');
      try {
        const r = await Glasses.stopAsk();
        setQa(r);
        if (r.answer) pushSpoken(r.answer, 'answer');
      } catch (e) {
        reportError(`Ask failed: ${errorMessage(e)}`);
      } finally {
        setAsk('idle');
      }
    }
  };

  const last = feed.spoken[0];
  const lastRoute = routeLabel(last?.route);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>Recall</Text>
        {status.mock ? <Chip tone="sand" label="Mock device" /> : null}
      </View>
      <View style={styles.chips}>
        <Chip
          tone={connected ? 'mist' : 'attention'}
          dot
          label={
            connected
              ? 'Glasses connected'
              : status.connection === 'connecting'
                ? 'Connecting…'
                : 'Glasses not connected'
          }
        />
        <Chip tone={status.streaming ? 'mist' : 'sand'} dot label={status.streaming ? 'Streaming' : 'Not streaming'} />
        {audioChip(status.audioRoute, feed.portName)}
      </View>

      <View style={[styles.preview, { height: Math.round(height * 0.36) }]} onLayout={onLayout}>
        {GlassesPreviewView ? (
          <GlassesPreviewView style={StyleSheet.absoluteFill} />
        ) : (
          <View style={styles.previewEmpty}>
            <Text style={styles.previewEmptyText}>Glasses preview is not in this build.</Text>
          </View>
        )}
        {!status.streaming && GlassesPreviewView ? (
          <View style={styles.previewEmpty} pointerEvents="none">
            <Text style={styles.previewEmptyText}>Press Start to see what the glasses see.</Text>
          </View>
        ) : null}
        {facesFresh && scale > 0
          ? feed.faces.map((f, i) => {
              const [x, y, w, h] = f.box;
              const known = !!f.name;
              const color = known ? Colors.apricot : Colors.attention;
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
                      borderColor: color,
                    },
                  ]}>
                  <View
                    style={[
                      styles.faceLabel,
                      { backgroundColor: known ? Colors.apricot : Colors.attentionBg },
                    ]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.faceLabelText, { color: known ? Colors.ink : Colors.attention }]}>
                      {known ? f.name : 'Someone new'}
                    </Text>
                  </View>
                </View>
              );
            })
          : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        {feed.error ? (
          <Banner tone="attention" title="Heads up" body={feed.error.message} onClose={clearError} />
        ) : null}
        {feed.reminder ? (
          <Banner title="Reminder" body={feed.reminder.text} onClose={dismissReminder} />
        ) : null}

        <View style={styles.lineCard}>
          <Text style={styles.lineMeta}>
            {last ? `${sourceLabel[last.source]} · ${timeOf(last.at)}` : 'Glasses said'}
          </Text>
          <Text style={styles.lineText} accessibilityLiveRegion="polite">
            {last ? `“${last.text}”` : 'Nothing yet. When someone familiar walks up, their name appears here.'}
          </Text>
          {lastRoute ? (
            <Text style={[styles.lineRoute, lastRoute.warn && { color: Colors.attention }]}>
              {lastRoute.text}
            </Text>
          ) : null}
        </View>

        {ask === 'listening' ? (
          <View style={styles.listening}>
            <View style={styles.listeningDot} />
            <View style={{ gap: Spacing.one, flex: 1 }}>
              <Text style={styles.listeningTitle}>I&apos;m listening…</Text>
              <Text style={styles.listeningSub}>Press again when the question is done.</Text>
            </View>
          </View>
        ) : null}

        {qa ? (
          <View style={styles.qa}>
            <Text style={styles.qaLabel}>Asked</Text>
            <Text style={styles.qaQuestion}>{qa.question || '(no words heard)'}</Text>
            <Text style={styles.qaLabel}>Answered</Text>
            <Text style={styles.qaAnswer}>{qa.answer}</Text>
          </View>
        ) : null}

        {feed.spoken.length > 1 ? (
          <View style={styles.history}>
            <Text style={styles.qaLabel}>Earlier</Text>
            {feed.spoken.slice(1, 6).map((l) => (
              <Text key={l.id} style={styles.historyLine}>
                <Text style={styles.historyTime}>{timeOf(l.at)}  </Text>
                {l.text}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {!status.streaming && !streamBusy ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => toggleStream(true)}
          style={styles.mockLink}>
          <Text style={styles.mockLinkText}>No glasses? Start with the phone camera</Text>
        </Pressable>
      ) : null}
      <View style={styles.actions}>
        <Button
          title={status.streaming ? 'Stop' : 'Start'}
          variant={status.streaming ? 'quiet' : 'outline'}
          size="calm"
          onPress={() => toggleStream()}
          loading={streamBusy}
          style={{ flex: 1 }}
        />
        <Button
          title={ask === 'listening' ? 'Done' : ask === 'thinking' ? 'Thinking…' : 'Ask'}
          size="calm"
          onPress={toggleAsk}
          loading={ask === 'thinking'}
          disabled={ask === 'thinking'}
          style={{ flex: 2, backgroundColor: ask === 'listening' ? Colors.ink : Colors.harbor }}
          accessibilityHint="Press, let the wearer ask a question, then press again"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mockLink: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
  mockLinkText: { fontFamily: Fonts.body, color: Colors.harborDeep, textDecorationLine: 'underline', fontSize: 15 },
  safe: { flex: 1, backgroundColor: Colors.linen },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.six,
    paddingTop: Spacing.two,
  },
  wordmark: { fontFamily: Fonts.display, fontSize: 28, color: Colors.harbor },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.six,
    paddingVertical: Spacing.three,
  },
  preview: {
    marginHorizontal: Spacing.four,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  previewEmpty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.six,
  },
  previewEmptyText: {
    fontFamily: Fonts.body,
    fontSize: 17,
    color: Colors.listeningText,
    textAlign: 'center',
  },
  faceBox: { position: 'absolute', borderWidth: 3, borderRadius: Radii.sm },
  faceLabel: {
    position: 'absolute',
    top: -30,
    left: -3,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    maxWidth: 220,
  },
  faceLabelText: { fontFamily: Fonts.display, fontSize: 16 },
  body: { padding: Spacing.four, gap: Spacing.four },
  lineCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.lg,
    padding: Spacing.six,
    gap: Spacing.two,
  },
  lineMeta: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.inkSoft },
  lineText: { fontFamily: Fonts.display, fontSize: 28, lineHeight: 36, color: Colors.ink },
  lineRoute: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.harborDeep },
  listening: {
    backgroundColor: Colors.ink,
    borderRadius: 24,
    padding: Spacing.six,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  listeningDot: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.harbor,
    borderWidth: 10,
    borderColor: 'rgba(143,209,199,0.18)',
  },
  listeningTitle: { fontFamily: Fonts.display, fontSize: 22, color: Colors.linen },
  listeningSub: { fontFamily: Fonts.body, fontSize: 17, color: Colors.listeningText },
  qa: { backgroundColor: Colors.harborMist, borderRadius: 24, padding: Spacing.five, gap: Spacing.one },
  qaLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.inkSoft, marginTop: Spacing.one },
  qaQuestion: { fontFamily: Fonts.body, fontSize: 19, lineHeight: 26, color: Colors.ink },
  qaAnswer: { fontFamily: Fonts.display, fontSize: 22, lineHeight: 29, color: Colors.harborDeep },
  history: { gap: Spacing.two, paddingHorizontal: Spacing.two },
  historyLine: { fontFamily: Fonts.body, fontSize: 16, lineHeight: 22, color: Colors.inkSoft },
  historyTime: { fontFamily: Fonts.bodyBold, color: Colors.inkSoft },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
});
