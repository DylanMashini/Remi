import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInputInstance,
  View,
} from 'react-native';

import { Button, Field, Icon, IconButton, Notice, Screen, SheetHeader } from '@/components/ui';
import { Colors, Fonts, Gutter, Radii, Spacing, Type } from '@/constants/theme';
import { useFeed } from '@/lib/feed';
import { firstName, introductionLine, shortDate } from '@/lib/format';
import { errorMessage, Glasses, type PhotoCandidate } from '@/lib/glasses';
import {
  dismissPhotoIndexNotice,
  photoIndexNoticeDismissed,
  photoIndexSupported,
  startPhotoIndex,
  usePhotoIndex,
} from '@/lib/photoIndex';
import { useSession, wearerName } from '@/lib/session';

const MAX_PHOTOS = 3;
/** What to ask for before each shot, so the three embeddings are not near-duplicates. */
const SHOT_HINTS = [
  'Face the camera, then tap the shutter.',
  'Nice. Now turn a little to one side.',
  'One more, a bit closer or farther away.',
] as const;
const SHUTTER = 72;

export default function AddPersonScreen() {
  const { account } = useSession();
  const { status } = useFeed();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const nameRef = useRef<TextInputInstance>(null);
  const relationshipRef = useRef<TextInputInstance>(null);
  const notesRef = useRef<TextInputInstance>(null);

  const [facing, setFacing] = useState<CameraType>('back');
  const [ready, setReady] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [shooting, setShooting] = useState(false);
  const [flash, setFlash] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; relationship: string; notes: string; photo: string } | null>(null);

  // Library suggestions. Same behaviour for caregiver and wearer accounts; only the copy differs.
  const photoIndex = usePhotoIndex();
  const [found, setFound] = useState<{ seed: string; list: PhotoCandidate[] } | null>(null);
  const [exported, setExported] = useState<Record<string, string>>({}); // candidate id -> file URI
  const [exporting, setExporting] = useState<string | null>(null);
  const [indexNotice, setIndexNotice] = useState(false);

  const who = wearerName(account);
  const wearer = account?.role === 'WEARER';
  const glassesReady = status.connection === 'connected' && !status.mock;
  const seedUri = photos[0];
  const full = photos.length >= MAX_PHOTOS;
  const indexHasFaces = (photoIndex?.faces ?? 0) > 0;
  // Results are keyed by the seed photo, so a changed first photo clears the grid without a setState.
  const candidates = seedUri && indexHasFaces && found?.seed === seedUri ? found.list : [];

  // Search the on-device index whenever the first photo changes.
  useEffect(() => {
    if (!photoIndexSupported || !seedUri || !indexHasFaces) return;
    let alive = true;
    Glasses.photoIndexSearch(seedUri)
      .then((list) => {
        if (alive) setFound({ seed: seedUri, list });
      })
      .catch((e) => {
        // A seed without a detectable face just means no suggestions; the save step reports it.
        console.warn('[add-person] photo search:', errorMessage(e));
        if (alive) setFound({ seed: seedUri, list: [] });
      });
    return () => {
      alive = false;
    };
  }, [seedUri, indexHasFaces]);

  // One-time offer to index, only while permission has never been asked. Dismissal is persisted.
  useEffect(() => {
    if (!photoIndexSupported || photoIndex?.permission !== 'notDetermined') return;
    let alive = true;
    photoIndexNoticeDismissed().then((done) => {
      if (alive && !done) setIndexNotice(true);
    });
    return () => {
      alive = false;
    };
  }, [photoIndex?.permission]);

  const closeIndexNotice = () => {
    setIndexNotice(false);
    dismissPhotoIndexNotice();
  };

  const indexNow = async () => {
    closeIndexNotice();
    try {
      await startPhotoIndex();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggleCandidate = async (c: PhotoCandidate) => {
    const uri = exported[c.id];
    if (uri && photos.includes(uri)) {
      setPhotos((p) => p.filter((u) => u !== uri));
      return;
    }
    if (exporting) return;
    setExporting(c.id);
    setError(null);
    try {
      const file = uri ?? (await Glasses.photoIndexExport(c.id));
      setExported((m) => ({ ...m, [c.id]: file }));
      setPhotos((p) => {
        if (p.includes(file)) return p;
        if (p.length < MAX_PHOTOS) return [...p, file];
        // The strip is full: swap the newest live photo out, never
        // the seed (photo 1). If every slot is a library pick, swap the newest of those.
        const libraryUris = new Set(Object.values(exported));
        let idx = -1;
        for (let i = p.length - 1; i >= 1; i--) {
          if (!libraryUris.has(p[i])) {
            idx = i;
            break;
          }
        }
        if (idx < 0) idx = p.length - 1;
        return p.map((u, i) => (i === idx ? file : u));
      });
    } catch (e) {
      setError(`That photo couldn't be used: ${errorMessage(e)}`);
    } finally {
      setExporting(null);
    }
  };

  const chosenCount = candidates.filter((c) => exported[c.id] && photos.includes(exported[c.id])).length;
  const slotsLeft = MAX_PHOTOS - photos.length;
  const pickCopy =
    slotsLeft >= 2
      ? 'Pick up to two.'
      : slotsLeft === 1
        ? 'Pick one.'
        : chosenCount >= MAX_PHOTOS - 1
          ? 'Tap one to remove it.'
          : 'Tap one to swap it in for the last photo.';
  const foundCopy =
    candidates.length === 1
      ? `Found 1 photo that looks like this person. ${pickCopy}`
      : `Found ${candidates.length} photos that look like this person. ${pickCopy}`;

  const takeOne = async (): Promise<string | null> => {
    const pic = await camera.current?.takePictureAsync({ quality: 0.7, shutterSound: false });
    return pic?.uri ?? null;
  };

  // One tap, one photo. Suggestions from the library appear as soon as the first one lands.
  const takePhoto = async () => {
    if (!camera.current || shooting || photos.length >= MAX_PHOTOS) return;
    setShooting(true);
    setError(null);
    try {
      const uri = await takeOne();
      if (uri) {
        setFlash(true);
        setTimeout(() => setFlash(false), 90);
        setPhotos((p) => (p.length < MAX_PHOTOS ? [...p, uri] : p));
      }
    } catch (e) {
      setError(`The camera didn't respond: ${errorMessage(e)}`);
    } finally {
      setShooting(false);
    }
  };

  const fromGlasses = async () => {
    if (full) return;
    setError(null);
    try {
      const uri = await Glasses.captureGlassesPhoto();
      setPhotos((p) => [...p, uri].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(`The glasses couldn't take a photo: ${errorMessage(e)}`);
    }
  };

  const reset = () => {
    setPhotos([]);
    setName('');
    setRelationship('');
    setNotes('');
    setError(null);
    setSaved(null);
    setFound(null);
    setExported({});
  };

  const save = async () => {
    const n = name.trim();
    if (!n || photos.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Only file URIs cross the bridge; Swift reads and uploads the bytes.
      await Glasses.enrollPerson({
        name: n,
        relationship: relationship.trim() || undefined,
        notes: notes.trim() || undefined,
        photoUris: photos,
        // Other photos enroll the face closest to this one, so a group shot picks the right person.
        seedPhotoUri: photos[0],
      });
      setSaved({ name: n, relationship: relationship.trim(), notes: notes.trim(), photo: photos[0] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Screen edges={['bottom']}>
        <SheetHeader title="Person added" onClose={() => router.back()} closeLabel="Done" />
        <View style={styles.done}>
          <Image source={{ uri: saved.photo }} style={styles.doneAvatar} contentFit="cover" accessibilityLabel={`Photo of ${saved.name}`} />
          <Text style={styles.doneTitle} accessibilityRole="header">
            {firstName(saved.name)} is added
          </Text>
          <Text style={styles.doneBody}>
            The next time {firstName(saved.name)} walks up, the glasses will say:
          </Text>
          <View style={styles.quote}>
            <Text style={styles.quoteText}>{introductionLine(saved)}</Text>
          </View>
          <View style={{ gap: Spacing.three, width: '100%', marginTop: Spacing.four }}>
            <Button title="Done" size="large" onPress={() => router.back()} />
            <Button title="Add another person" variant="quiet" onPress={reset} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <SheetHeader title="Add a person" onClose={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={24}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
          <View style={styles.cameraWrap}>
            {permission?.granted ? (
              <>
                <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} onCameraReady={() => setReady(true)} />
                {flash ? <View style={[StyleSheet.absoluteFill, styles.flash]} pointerEvents="none" /> : null}
                <View style={styles.guide} pointerEvents="none" />

                <View style={styles.hintPill} pointerEvents="none">
                  <Text style={styles.hintText}>{full ? 'Three photos ready.' : SHOT_HINTS[photos.length]}</Text>
                </View>

                <View style={styles.controls}>
                  <View style={styles.controlSide}>
                    {glassesReady ? (
                      <IconButton name="eyeglasses" label="Take a photo with the glasses" tone="night" size={44} onPress={fromGlasses} />
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={full ? 'Three photos taken' : `Take photo ${photos.length + 1} of ${MAX_PHOTOS}`}
                    accessibilityState={{ disabled: !ready || full, busy: shooting }}
                    onPress={takePhoto}
                    disabled={!ready || full || shooting}
                    hitSlop={8}
                    style={({ pressed }) => [styles.shutterRing, (full || !ready) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
                    {({ pressed }) => <View style={[styles.shutterCore, pressed && styles.shutterCorePressed]} />}
                  </Pressable>
                  <View style={styles.controlSide}>
                    <IconButton
                      name="arrow.triangle.2.circlepath.camera"
                      label="Switch camera"
                      tone="night"
                      size={44}
                      onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
                    />
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.cameraAsk}>
                <Icon name="camera" size={32} color={Colors.nightText} weight="light" />
                <Text style={styles.cameraAskText}>Remi needs the camera to take a few photos of a face.</Text>
                {permission ? <Button title="Allow the camera" onPress={requestPermission} /> : null}
              </View>
            )}
          </View>

          <View style={styles.strip}>
            {Array.from({ length: MAX_PHOTOS }).map((_, i) =>
              photos[i] ? (
                <Pressable
                  key={photos[i]}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${i + 1}. Tap to remove and retake.`}
                  onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                  style={styles.thumbWrap}>
                  <Image source={{ uri: photos[i] }} style={styles.thumb} contentFit="cover" />
                  <View style={styles.thumbCheck}>
                    <Icon name="checkmark" size={10} color={Colors.surface} weight="bold" />
                  </View>
                </Pressable>
              ) : (
                <View key={`empty-${i}`} style={[styles.thumbWrap, styles.thumbEmpty, i === photos.length && styles.thumbNext]}>
                  <Text style={styles.thumbNum}>{i + 1}</Text>
                </View>
              )
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.stripTitle}>{full ? 'Three photos ready' : `${photos.length} of ${MAX_PHOTOS} photos`}</Text>
              <Text style={styles.stripHint}>
                {photos.length === 0 ? 'One is enough to start. Three from different angles works best.' : 'Tap a photo to remove it and retake.'}
              </Text>
            </View>
          </View>

          {seedUri && candidates.length > 0 ? (
            <View style={styles.library}>
              <View style={{ gap: 2 }}>
                <Text style={styles.libraryTitle}>From your photos</Text>
                <Text style={styles.libraryHint}>{foundCopy}</Text>
              </View>
              <View style={styles.grid}>
                {candidates.map((c) => {
                  const uri = exported[c.id];
                  const chosen = !!uri && photos.includes(uri);
                  const date = c.takenAt ? shortDate(new Date(c.takenAt)) : '';
                  return (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${chosen ? 'Remove' : 'Add'} photo${date ? ` from ${date}` : ''}`}
                      accessibilityState={{ selected: chosen, busy: exporting === c.id }}
                      onPress={() => toggleCandidate(c)}
                      style={({ pressed }) => [styles.cell, pressed && { opacity: 0.85 }]}>
                      <View style={[styles.cellImageWrap, chosen && styles.cellChosen]}>
                        <Image source={{ uri: c.thumbUri }} style={styles.cellImage} contentFit="cover" />
                        {chosen ? (
                          <View style={styles.cellCheck}>
                            <Icon name="checkmark" size={11} color={Colors.surface} weight="bold" />
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.cellDate} numberOfLines={1}>
                        {date || ' '}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {indexNotice ? (
            <Notice
              icon="photo.on.rectangle"
              title="Suggest photos from your library"
              body={
                wearer
                  ? 'Recall can find photos of the people you add in your own photos, on this phone. Nothing leaves the phone.'
                  : `Recall can find photos of the people you add for ${who} in your own photos, on this phone. Nothing leaves the phone.`
              }
              onDismiss={closeIndexNotice}
              action={
                <View style={{ flexDirection: 'row', marginTop: Spacing.two }}>
                  <Button title="Index photos" variant="secondary" icon="photo.on.rectangle" onPress={indexNow} />
                </View>
              }
            />
          ) : null}

          <View style={styles.form}>
            <Field
              ref={nameRef}
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Sarah"
              autoCapitalize="words"
              autoComplete="off"
              returnKeyType="next"
              onSubmitEditing={() => relationshipRef.current?.focus()}
            />
            <Field
              ref={relationshipRef}
              label={`Who they are to ${who}`}
              value={relationship}
              onChangeText={setRelationship}
              placeholder="daughter, neighbor, nurse"
              autoCapitalize="none"
              autoComplete="off"
              returnKeyType="next"
              onSubmitEditing={() => notesRef.current?.focus()}
              hint='Spoken as "your daughter", so keep it lowercase.'
            />
            <Field
              ref={notesRef}
              label="One warm thing to say"
              value={notes}
              onChangeText={setNotes}
              placeholder="She brought you tulips last week."
              multiline
              hint="Read aloud right after the name. One short sentence."
            />
          </View>

          {error ? <Notice tone="attention" title="Not added" body={error} onDismiss={() => setError(null)} /> : null}

          <Button
            title={name.trim() ? `Add ${firstName(name)}` : 'Add person'}
            size="large"
            onPress={save}
            loading={saving}
            disabled={!name.trim() || photos.length === 0}
          />
          <Text style={styles.footnote}>Photos are stored privately and only matched against people in this list.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Gutter, paddingBottom: Spacing.eight, gap: Spacing.four },
  cameraWrap: {
    height: 420,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: Colors.night,
  },
  flash: { backgroundColor: Colors.surface, opacity: 0.9 },
  guide: {
    position: 'absolute',
    alignSelf: 'center',
    top: 64,
    width: 176,
    height: 224,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: 'rgba(245,243,238,0.55)',
  },
  hintPill: {
    position: 'absolute',
    top: Spacing.three,
    alignSelf: 'center',
    maxWidth: '86%',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(21,18,31,0.62)',
  },
  hintText: { ...Type.secondaryBold, color: Colors.surface, textAlign: 'center' },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.six,
  },
  controlSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: {
    width: SHUTTER - 16,
    height: SHUTTER - 16,
    borderRadius: (SHUTTER - 16) / 2,
    backgroundColor: Colors.surface,
  },
  shutterCorePressed: { transform: [{ scale: 0.88 }] },
  cameraAsk: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.six, gap: Spacing.four },
  cameraAskText: { ...Type.body, color: Colors.nightText, textAlign: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  thumbWrap: { width: 60, height: 60, borderRadius: Radii.sm, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  thumbCheck: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.dusk,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmpty: {
    backgroundColor: Colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.line,
    borderStyle: 'dashed',
  },
  thumbNext: { borderColor: Colors.dusk, borderStyle: 'solid' },
  thumbNum: { fontFamily: Fonts.display, fontSize: 18, color: Colors.inkMute },
  stripTitle: { ...Type.secondaryBold, color: Colors.ink, marginLeft: Spacing.two },
  stripHint: { ...Type.caption, color: Colors.inkMute, marginLeft: Spacing.two },
  library: { gap: Spacing.three, paddingTop: Spacing.one },
  libraryTitle: { ...Type.secondaryBold, color: Colors.ink },
  libraryHint: { ...Type.caption, color: Colors.inkMute },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  cell: { width: '31.5%', gap: 4 },
  cellImageWrap: { aspectRatio: 1, borderRadius: Radii.sm, overflow: 'hidden', backgroundColor: Colors.sand, borderWidth: 2, borderColor: 'transparent' },
  cellChosen: { borderColor: Colors.dusk },
  cellImage: { width: '100%', height: '100%' },
  cellCheck: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.dusk,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellDate: { ...Type.caption, color: Colors.inkMute, textAlign: 'center' },
  form: { gap: Spacing.five, paddingTop: Spacing.two },
  footnote: { ...Type.caption, color: Colors.inkMute, textAlign: 'center' },
  done: { flex: 1, alignItems: 'center', paddingHorizontal: Gutter, paddingTop: Spacing.eight, gap: Spacing.three },
  doneAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 5, borderColor: Colors.apricot, backgroundColor: Colors.apricotMist },
  doneTitle: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: Colors.ink, marginTop: Spacing.two },
  doneBody: { ...Type.body, color: Colors.inkSoft, textAlign: 'center' },
  quote: { backgroundColor: Colors.duskMist, borderRadius: Radii.md, padding: Spacing.five, width: '100%' },
  quoteText: { ...Type.spoken, fontSize: 22, lineHeight: 29, color: Colors.ink, textAlign: 'center' },
});
