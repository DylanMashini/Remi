/**
 * Remember: a few minutes with the people in the wearer's life, one face at a time.
 *
 * This is deliberately not a quiz. The two answers are "Yes, I know them" and "Tell me". A yes
 * becomes an invitation to share a memory in their own words (recorded through the Swift module,
 * transcribed, kept with one tap). A "tell me" plays the introduction through the glasses, the
 * same words they would hear if the person walked up. Nothing is scored; every visit is logged
 * for the caregiver as a pattern, never as a result.
 */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, EmptyState, Field, Icon, IconButton, Notice, Screen, TextButton } from '@/components/ui';
import { Colors, Fonts, Gutter, Radii, Shadow, Spacing, Type } from '@/constants/theme';
import { api, type Person } from '@/lib/api';
import { pushSpoken } from '@/lib/feed';
import { firstName } from '@/lib/format';
import { errorMessage, Glasses, glassesHas } from '@/lib/glasses';
import { BACKEND_URL, useSession, wearerName } from '@/lib/session';

const VISIT_SIZE = 5;

type Step =
  | { kind: 'intro' }
  | { kind: 'ask'; i: number }
  | { kind: 'tell'; i: number }
  | { kind: 'review'; i: number; text: string; source: 'WEARER_VOICE' | 'WEARER_TYPED' }
  | { kind: 'reveal'; i: number; line: string; spoken: boolean }
  | { kind: 'done' };

type Tally = { knew: number; told: number; memories: number };

/** Least recently visited first, then the people seen most recently. */
function orderForVisit(people: Person[]): Person[] {
  return [...people]
    .sort((a, b) => {
      const ra = a.lastRememberedAt ? +new Date(a.lastRememberedAt) : 0;
      const rb = b.lastRememberedAt ? +new Date(b.lastRememberedAt) : 0;
      if (ra !== rb) return ra - rb;
      const sa = a.lastSeenAt ? +new Date(a.lastSeenAt) : 0;
      const sb = b.lastSeenAt ? +new Date(b.lastSeenAt) : 0;
      return sb - sa;
    })
    .slice(0, VISIT_SIZE);
}

export default function RememberScreen() {
  const { token, account } = useSession();
  const who = wearerName(account);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [visit, setVisit] = useState<Person[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [tally, setTally] = useState<Tally>({ knew: 0, told: 0, memories: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setPeople(await api.people(token));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (step.kind === 'intro' || step.kind === 'done') load();
    }, [load, step.kind])
  );

  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : undefined), [token]);

  const begin = () => {
    if (!people?.length) return;
    setVisit(orderForVisit(people));
    setTally({ knew: 0, told: 0, memories: 0 });
    setError(null);
    setStep({ kind: 'ask', i: 0 });
  };

  const advance = (i: number) => {
    if (i + 1 >= visit.length) setStep({ kind: 'done' });
    else setStep({ kind: 'ask', i: i + 1 });
  };

  const knew = async (i: number) => {
    if (!token) return;
    setTally((t) => ({ ...t, knew: t.knew + 1 }));
    setStep({ kind: 'tell', i });
    api.remember(token, visit[i].id, true).catch((e) => console.warn('[remember] log failed', errorMessage(e)));
  };

  const tellMe = async (i: number) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const { line, speechId } = await api.remember(token, visit[i].id, false);
      setTally((t) => ({ ...t, told: t.told + 1 }));
      setStep({ kind: 'reveal', i, line, spoken: false });
      pushSpoken(line, 'recognition');
      Glasses.speak(speechId, line)
        .then(() => setStep((s) => (s.kind === 'reveal' && s.i === i ? { ...s, spoken: true } : s)))
        .catch((e) => console.warn('[remember] speak failed', errorMessage(e)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const keep = async (i: number, text: string, source: 'WEARER_VOICE' | 'WEARER_TYPED') => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.addMemory(token, visit[i].id, { text, source });
      setTally((t) => ({ ...t, memories: t.memories + 1 }));
      advance(i);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const person = 'i' in step ? visit[step.i] : null;
  const photo = (p: Person) => (p.photoUrl ?? p.avatarUrl ? `${BACKEND_URL}${p.photoUrl ?? p.avatarUrl}` : null);

  return (
    <Screen edges={['top']}>
      {step.kind === 'intro' ? (
        <Intro
          people={people}
          who={who}
          error={error}
          onBegin={begin}
          onDismissError={() => setError(null)}
          headers={headers}
        />
      ) : step.kind === 'done' ? (
        <Done tally={tally} total={visit.length} onAgain={begin} onClose={() => setStep({ kind: 'intro' })} />
      ) : person ? (
        <View style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <IconButton name="xmark" label="End the visit" tone="sand" size={40} onPress={() => setStep({ kind: 'intro' })} />
            <Progress total={visit.length} current={step.i} />
            <View style={{ width: 40 }} />
          </View>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {error ? <Notice tone="attention" body={error} onDismiss={() => setError(null)} /> : null}
            {step.kind === 'ask' ? (
              <Ask person={person} photo={photo(person)} headers={headers} busy={busy} onKnew={() => knew(step.i)} onTell={() => tellMe(step.i)} />
            ) : step.kind === 'tell' ? (
              <Tell
                person={person}
                headers={headers}
                onHeard={(text, source) => setStep({ kind: 'review', i: step.i, text, source })}
                onSkip={() => advance(step.i)}
                onError={setError}
              />
            ) : step.kind === 'review' ? (
              <Review
                person={person}
                text={step.text}
                busy={busy}
                onKeep={() => keep(step.i, step.text, step.source)}
                onAgain={() => setStep({ kind: 'tell', i: step.i })}
                onSkip={() => advance(step.i)}
              />
            ) : (
              <Reveal person={person} photo={photo(person)} headers={headers} line={step.line} spoken={step.spoken} onNext={() => advance(step.i)} />
            )}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}

// ---------- Steps ----------

function Intro({
  people,
  who,
  error,
  onBegin,
  onDismissError,
  headers,
}: {
  people: Person[] | null;
  who: string;
  error: string | null;
  onBegin: () => void;
  onDismissError: () => void;
  headers?: Record<string, string>;
}) {
  const preview = people ? orderForVisit(people).slice(0, 3) : [];
  return (
    <ScrollView contentContainerStyle={styles.intro} showsVerticalScrollIndicator={false}>
      <View style={{ gap: Spacing.two }}>
        <Text style={Type.display} accessibilityRole="header">
          Remember
        </Text>
        <Text style={[Type.body, { color: Colors.inkSoft, maxWidth: 320 }]}>
          A few minutes with the people in your life. One face at a time, no hurry.
        </Text>
      </View>

      {error ? <Notice tone="attention" title="Remember didn't load" body={error} onDismiss={onDismissError} /> : null}

      {people && people.length === 0 ? (
        <EmptyState
          icon="person.2"
          title="No one to visit yet"
          body={`Add the people ${who === 'you' ? 'you see' : `${who} sees`} most, and they will appear here.`}
          action={<Button title="Add a person" icon="plus" onPress={() => router.push('/add-person')} />}
        />
      ) : (
        <>
          <View style={styles.introCard}>
            <View style={styles.stack}>
              {preview.map((p, i) => (
                <View key={p.id} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -18, zIndex: 3 - i }]}>
                  <Avatar name={p.name} uri={p.avatarUrl ? `${BACKEND_URL}${p.avatarUrl}` : null} headers={headers} size={64} />
                </View>
              ))}
            </View>
            <View style={{ gap: Spacing.one }}>
              <Text style={styles.introCardTitle}>
                {people ? `${Math.min(people.length, VISIT_SIZE)} ${Math.min(people.length, VISIT_SIZE) === 1 ? 'person' : 'people'} to visit` : 'Getting ready'}
              </Text>
              <Text style={[Type.secondary, { color: Colors.inkSoft }]}>
                {who === 'you' ? 'You will see' : `${who} will see`} a photo and be asked, gently, who it is. Knowing is lovely.
                Not knowing is fine too.
              </Text>
            </View>
            <Button title="Begin" size="large" icon="arrow.right" onPress={onBegin} disabled={!people?.length} />
          </View>

          <View style={styles.rules}>
            <Rule icon="hand.raised" text="Nothing is scored, and no one is corrected." />
            <Rule icon="eyeglasses" text="If a name slips away, the glasses simply say it." />
            <Rule icon="quote.bubble" text="What you remember is kept in your own words, and the glasses can say it next time." />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Rule({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
  return (
    <View style={styles.rule}>
      <Icon name={icon} size={18} color={Colors.harborDeep} weight="semibold" />
      <Text style={[Type.secondary, { color: Colors.inkSoft, flex: 1 }]}>{text}</Text>
    </View>
  );
}

function Progress({ total, current }: { total: number; current: number }) {
  return (
    <View style={styles.progress} accessibilityLabel={`${current + 1} of ${total}`} accessibilityRole="progressbar">
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.segment, { backgroundColor: i <= current ? Colors.apricotDeep : Colors.line }]} />
      ))}
    </View>
  );
}

function Portrait({ person, photo, headers, size = 'large' }: { person: Person; photo: string | null; headers?: Record<string, string>; size?: 'large' | 'small' }) {
  if (size === 'small') {
    return <Avatar name={person.name} uri={person.avatarUrl ? `${BACKEND_URL}${person.avatarUrl}` : null} headers={headers} size={72} />;
  }
  return (
    <View style={styles.portraitWrap}>
      {photo ? (
        <Image source={{ uri: photo, headers, cacheKey: photo }} style={styles.portrait} contentFit="cover" transition={200} accessibilityLabel="A familiar face" />
      ) : (
        <View style={[styles.portrait, styles.portraitEmpty]}>
          <Avatar name={person.name} size={120} ring={false} />
        </View>
      )}
    </View>
  );
}

function Ask({
  person,
  photo,
  headers,
  busy,
  onKnew,
  onTell,
}: {
  person: Person;
  photo: string | null;
  headers?: Record<string, string>;
  busy: boolean;
  onKnew: () => void;
  onTell: () => void;
}) {
  return (
    <View style={{ gap: Spacing.six }}>
      <Portrait person={person} photo={photo} headers={headers} />
      <Text style={styles.question} accessibilityRole="header">
        Do you know who this is?
      </Text>
      <View style={{ gap: Spacing.three }}>
        <Button title="Yes, I know them" size="large" icon="heart.fill" onPress={onKnew} disabled={busy} />
        <Button title="Tell me who it is" size="large" variant="quiet" onPress={onTell} loading={busy} />
      </View>
    </View>
  );
}

/** A slow breathing ring around the mic while listening. Motion only while listening. */
function Breathing({ children }: { children: React.ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });
  return (
    <View style={styles.micWrap}>
      <Animated.View style={[styles.micRing, { transform: [{ scale }], opacity }]} />
      {children}
    </View>
  );
}

function Tell({
  person,
  headers,
  onHeard,
  onSkip,
  onError,
}: {
  person: Person;
  headers?: Record<string, string>;
  onHeard: (text: string, source: 'WEARER_VOICE' | 'WEARER_TYPED') => void;
  onSkip: () => void;
  onError: (m: string) => void;
}) {
  const canListen = glassesHas('startListening');
  const [mode, setMode] = useState<'idle' | 'listening' | 'thinking' | 'typing'>(canListen ? 'idle' : 'typing');
  const [typed, setTyped] = useState('');
  const first = firstName(person.name);

  const toggle = async () => {
    if (mode === 'idle') {
      try {
        await Glasses.startListening();
        setMode('listening');
      } catch (e) {
        onError(`The microphone didn't start: ${errorMessage(e)}`);
        setMode('typing');
      }
    } else if (mode === 'listening') {
      setMode('thinking');
      try {
        const { text } = await Glasses.stopListening();
        if (text.trim()) onHeard(text.trim(), 'WEARER_VOICE');
        else {
          onError("I didn't catch that. Try once more, or type it.");
          setMode('idle');
        }
      } catch (e) {
        onError(errorMessage(e));
        setMode('idle');
      }
    }
  };

  const hint =
    mode === 'listening'
      ? "Listening. Tap when you're done."
      : mode === 'thinking'
        ? 'Writing it down'
        : 'Tap, then talk';

  return (
    <View style={{ gap: Spacing.six }}>
      <View style={styles.personRow}>
        <Portrait person={person} photo={null} headers={headers} size="small" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.personName}>{person.name}</Text>
          {person.relationship ? <Text style={[Type.secondary, { color: Colors.harborDeep }]}>Your {person.relationship}</Text> : null}
        </View>
      </View>

      <View style={{ gap: Spacing.two }}>
        <Text style={styles.question} accessibilityRole="header">
          Tell me about {first}.
        </Text>
        <Text style={[Type.body, { color: Colors.inkSoft }]}>A memory, something {first} loves, how you met. Anything at all.</Text>
      </View>

      {mode === 'typing' ? (
        <View style={{ gap: Spacing.four }}>
          <Field
            label="In your words"
            value={typed}
            onChangeText={setTyped}
            placeholder={`${first} taught me to bake bread.`}
            multiline
            autoFocus
          />
          <Button title="That's it" size="large" onPress={() => onHeard(typed.trim(), 'WEARER_TYPED')} disabled={!typed.trim()} />
          {canListen ? <TextButton title="Talk instead" onPress={() => setMode('idle')} style={{ alignSelf: 'center' }} /> : null}
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: Spacing.four }}>
          {mode === 'listening' ? (
            <Breathing>
              <MicButton mode={mode} onPress={toggle} />
            </Breathing>
          ) : (
            <View style={styles.micWrap}>
              <MicButton mode={mode} onPress={toggle} />
            </View>
          )}
          <Text style={[Type.headline, { color: mode === 'listening' ? Colors.harborDeep : Colors.ink }]} accessibilityLiveRegion="polite">
            {hint}
          </Text>
          {mode === 'idle' ? <TextButton title="Type instead" onPress={() => setMode('typing')} /> : null}
        </View>
      )}

      <TextButton title="Nothing comes to mind right now" onPress={onSkip} color={Colors.inkSoft} style={{ alignSelf: 'center' }} />
    </View>
  );
}

function MicButton({ mode, onPress }: { mode: 'idle' | 'listening' | 'thinking'; onPress: () => void }) {
  const listening = mode === 'listening';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Done talking' : 'Start talking'}
      accessibilityState={{ busy: mode === 'thinking' }}
      disabled={mode === 'thinking'}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mic,
        { backgroundColor: listening ? Colors.ink : Colors.harbor, opacity: pressed ? 0.85 : mode === 'thinking' ? 0.6 : 1 },
      ]}>
      <Icon name={listening ? 'stop.fill' : mode === 'thinking' ? 'ellipsis' : 'mic.fill'} size={36} color={Colors.surface} weight="bold" />
    </Pressable>
  );
}

function Review({
  person,
  text,
  busy,
  onKeep,
  onAgain,
  onSkip,
}: {
  person: Person;
  text: string;
  busy: boolean;
  onKeep: () => void;
  onAgain: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={{ gap: Spacing.six }}>
      <View style={{ gap: Spacing.two }}>
        <Text style={[Type.secondaryBold, { color: Colors.inkSoft }]}>About {firstName(person.name)}, you said</Text>
        <View style={styles.quote}>
          <Text style={styles.quoteMark}>&ldquo;</Text>
          <Text style={styles.quoteText}>{text}</Text>
        </View>
      </View>
      <Text style={[Type.body, { color: Colors.inkSoft }]}>
        Keep it, and the glasses can remind you of it the next time {firstName(person.name)} walks up.
      </Text>
      <View style={{ gap: Spacing.three }}>
        <Button title="Keep this memory" size="large" icon="checkmark" onPress={onKeep} loading={busy} />
        <Button title="Say it again" size="large" variant="quiet" onPress={onAgain} disabled={busy} />
        <TextButton title="Skip for now" onPress={onSkip} color={Colors.inkSoft} style={{ alignSelf: 'center' }} />
      </View>
    </View>
  );
}

function Reveal({
  person,
  photo,
  headers,
  line,
  spoken,
  onNext,
}: {
  person: Person;
  photo: string | null;
  headers?: Record<string, string>;
  line: string;
  spoken: boolean;
  onNext: () => void;
}) {
  return (
    <View style={{ gap: Spacing.five }}>
      <Portrait person={person} photo={photo} headers={headers} />
      <View style={{ gap: 2 }}>
        <Text style={styles.revealName} accessibilityRole="header">
          {person.name}
        </Text>
        {person.relationship ? <Text style={[Type.headline, { color: Colors.harborDeep }]}>Your {person.relationship}</Text> : null}
      </View>
      <View style={styles.said}>
        <View style={styles.saidHead}>
          <Icon name="eyeglasses" size={16} color={Colors.harborDeep} weight="semibold" />
          <Text style={[Type.secondaryBold, { color: Colors.harborDeep }]}>{spoken ? 'The glasses said' : 'The glasses are saying'}</Text>
        </View>
        <Text style={styles.saidText} accessibilityLiveRegion="polite">
          {line}
        </Text>
      </View>
      <Button title="Next" size="large" icon="arrow.right" onPress={onNext} />
    </View>
  );
}

function Done({ tally, total, onAgain, onClose }: { tally: Tally; total: number; onAgain: () => void; onClose: () => void }) {
  const closing =
    tally.memories > 0
      ? `You added ${tally.memories} ${tally.memories === 1 ? 'memory' : 'memories'}. The glasses will carry ${tally.memories === 1 ? 'it' : 'them'} with you.`
      : 'Thank you for sitting with them a while.';
  return (
    <ScrollView contentContainerStyle={styles.intro} showsVerticalScrollIndicator={false}>
      <View style={styles.doneMark}>
        <Icon name="heart.fill" size={36} color={Colors.apricotDeep} weight="semibold" />
      </View>
      <View style={{ gap: Spacing.two }}>
        <Text style={Type.display} accessibilityRole="header">
          That&apos;s everyone for now.
        </Text>
        <Text style={[Type.body, { color: Colors.inkSoft }]}>{closing}</Text>
      </View>
      <View style={styles.tally}>
        <TallyRow icon="heart.fill" tone={Colors.apricotMist} fg={Colors.apricotDeep} label="Knew right away" value={`${tally.knew} of ${total}`} />
        <View style={styles.tallyLine} />
        <TallyRow icon="eyeglasses" tone={Colors.harborMist} fg={Colors.harborDeep} label="Heard the introduction" value={`${tally.told}`} />
        <View style={styles.tallyLine} />
        <TallyRow icon="quote.bubble.fill" tone={Colors.sand} fg={Colors.ink} label="New memories" value={`${tally.memories}`} />
      </View>
      <View style={{ gap: Spacing.three }}>
        <Button title="Done" size="large" onPress={onClose} />
        <Button title="Visit again" variant="quiet" onPress={onAgain} />
      </View>
    </ScrollView>
  );
}

function TallyRow({ icon, tone, fg, label, value }: { icon: React.ComponentProps<typeof Icon>['name']; tone: string; fg: string; label: string; value: string }) {
  return (
    <View style={styles.tallyRow}>
      <View style={[styles.tallyIcon, { backgroundColor: tone }]}>
        <Icon name={icon} size={18} color={fg} weight="semibold" />
      </View>
      <Text style={[Type.body, { flex: 1 }]}>{label}</Text>
      <Text style={[Type.headline, { color: Colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: Gutter, paddingTop: Spacing.three, paddingBottom: Spacing.ten, gap: Spacing.six },
  introCard: { backgroundColor: Colors.surface, borderRadius: Radii.lg, padding: Spacing.six, gap: Spacing.five, ...Shadow },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderRadius: 36, borderWidth: 3, borderColor: Colors.surface },
  introCardTitle: { fontFamily: Fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: Colors.ink },
  rules: { gap: Spacing.three, paddingHorizontal: Spacing.one },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.four,
    paddingHorizontal: Gutter,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  progress: { flex: 1, flexDirection: 'row', gap: 6, maxWidth: 220 },
  segment: { flex: 1, height: 5, borderRadius: 3 },
  body: { paddingHorizontal: Gutter, paddingTop: Spacing.three, paddingBottom: Spacing.ten, gap: Spacing.four },

  portraitWrap: { borderRadius: Radii.lg, overflow: 'hidden', backgroundColor: Colors.sand, ...Shadow },
  portrait: { width: '100%', aspectRatio: 4 / 5 },
  portraitEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.apricotMist },
  question: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: Colors.ink },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  personName: { fontFamily: Fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: Colors.ink },
  micWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  micRing: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.harbor },
  mic: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', ...Shadow },

  quote: { backgroundColor: Colors.surface, borderRadius: Radii.lg, padding: Spacing.six, paddingTop: Spacing.four, gap: 0 },
  quoteMark: { fontFamily: Fonts.display, fontSize: 56, lineHeight: 56, color: Colors.apricot, marginBottom: -Spacing.four },
  quoteText: { ...Type.spoken, color: Colors.ink },

  revealName: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: Colors.ink },
  said: { backgroundColor: Colors.harborMist, borderRadius: Radii.md, padding: Spacing.five, gap: Spacing.two },
  saidHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  saidText: { ...Type.spoken, fontSize: 22, lineHeight: 29, color: Colors.ink },

  doneMark: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.apricotMist, alignItems: 'center', justifyContent: 'center' },
  tally: { backgroundColor: Colors.surface, borderRadius: Radii.md, overflow: 'hidden' },
  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: 14 },
  tallyIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tallyLine: { height: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.hairline, marginLeft: Spacing.four },
});
