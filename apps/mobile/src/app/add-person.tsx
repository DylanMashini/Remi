import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
import { firstName, introductionLine } from '@/lib/format';
import { errorMessage, Glasses } from '@/lib/glasses';
import { useSession, wearerName } from '@/lib/session';

const MAX_PHOTOS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; relationship: string; notes: string; photo: string } | null>(null);

  const who = wearerName(account);
  const glassesReady = status.connection === 'connected' && !status.mock;

  const takeOne = async (): Promise<string | null> => {
    const pic = await camera.current?.takePictureAsync({ quality: 0.7, shutterSound: false });
    return pic?.uri ?? null;
  };

  // One tap fills the remaining slots in a quick burst.
  const burst = async () => {
    if (!camera.current || shooting) return;
    setShooting(true);
    setError(null);
    try {
      const got: string[] = [...photos];
      while (got.length < MAX_PHOTOS) {
        const uri = await takeOne();
        if (!uri) break;
        got.push(uri);
        setPhotos([...got]);
        if (got.length < MAX_PHOTOS) await sleep(250);
      }
      if (!name) nameRef.current?.focus();
    } catch (e) {
      setError(`The camera didn't respond: ${errorMessage(e)}`);
    } finally {
      setShooting(false);
    }
  };

  const fromGlasses = async () => {
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
                <View style={styles.guide} pointerEvents="none" />
                <IconButton
                  name="camera.rotate"
                  label="Switch camera"
                  tone="night"
                  size={40}
                  onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
                  style={styles.flip}
                />
              </>
            ) : (
              <View style={styles.cameraAsk}>
                <Icon name="camera" size={32} color={Colors.nightText} weight="light" />
                <Text style={styles.cameraAskText}>Recall needs the camera to take three photos of a face.</Text>
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
                  accessibilityLabel={`Photo ${i + 1}. Tap to retake.`}
                  onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                  style={styles.thumbWrap}>
                  <Image source={{ uri: photos[i] }} style={styles.thumb} contentFit="cover" />
                  <View style={styles.thumbCheck}>
                    <Icon name="checkmark" size={10} color={Colors.surface} weight="bold" />
                  </View>
                </Pressable>
              ) : (
                <View key={`empty-${i}`} style={[styles.thumbWrap, styles.thumbEmpty]}>
                  <Text style={styles.thumbNum}>{i + 1}</Text>
                </View>
              )
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.stripTitle}>
                {photos.length >= MAX_PHOTOS ? 'Three photos ready' : `${photos.length} of ${MAX_PHOTOS} photos`}
              </Text>
              <Text style={styles.stripHint}>Good light, facing the camera. Tap a photo to retake it.</Text>
            </View>
          </View>

          <View style={styles.row}>
            <Button
              title={photos.length >= MAX_PHOTOS ? 'Photos taken' : photos.length ? 'Take the rest' : 'Take 3 photos'}
              icon={photos.length >= MAX_PHOTOS ? 'checkmark' : 'camera.fill'}
              onPress={burst}
              loading={shooting}
              disabled={!permission?.granted || !ready || photos.length >= MAX_PHOTOS}
              style={{ flex: 1 }}
            />
            {glassesReady ? (
              <Button title="From the glasses" icon="eyeglasses" variant="secondary" onPress={fromGlasses} disabled={photos.length >= MAX_PHOTOS} />
            ) : null}
          </View>

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
    height: 280,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: Colors.night,
  },
  guide: {
    position: 'absolute',
    alignSelf: 'center',
    top: 36,
    width: 164,
    height: 208,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: 'rgba(245,243,238,0.55)',
  },
  flip: { position: 'absolute', right: Spacing.three, top: Spacing.three },
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
    backgroundColor: Colors.harbor,
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
  thumbNum: { fontFamily: Fonts.display, fontSize: 18, color: Colors.inkMute },
  stripTitle: { ...Type.secondaryBold, color: Colors.ink, marginLeft: Spacing.two },
  stripHint: { ...Type.caption, color: Colors.inkMute, marginLeft: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three },
  form: { gap: Spacing.five, paddingTop: Spacing.two },
  footnote: { ...Type.caption, color: Colors.inkMute, textAlign: 'center' },
  done: { flex: 1, alignItems: 'center', paddingHorizontal: Gutter, paddingTop: Spacing.eight, gap: Spacing.three },
  doneAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 5, borderColor: Colors.apricot, backgroundColor: Colors.apricotMist },
  doneTitle: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: Colors.ink, marginTop: Spacing.two },
  doneBody: { ...Type.body, color: Colors.inkSoft, textAlign: 'center' },
  quote: { backgroundColor: Colors.harborMist, borderRadius: Radii.md, padding: Spacing.five, width: '100%' },
  quoteText: { ...Type.spoken, fontSize: 22, lineHeight: 29, color: Colors.ink, textAlign: 'center' },
});
