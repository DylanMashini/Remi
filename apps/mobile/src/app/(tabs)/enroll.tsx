import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Body, Button, Display, Field } from '@/components/ui';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
import { errorMessage, Glasses } from '@/lib/glasses';

const MAX_PHOTOS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function EnrollScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const nameRef = useRef<TextInputInstance>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [ready, setReady] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [shooting, setShooting] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const takeOne = async (): Promise<string | null> => {
    const pic = await camera.current?.takePictureAsync({ quality: 0.7, shutterSound: false });
    return pic?.uri ?? null;
  };

  // One tap fills the remaining slots in a quick burst.
  const burst = async () => {
    if (!camera.current || shooting) return;
    setShooting(true);
    setError(null);
    setSaved(null);
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
      setError(`Camera: ${errorMessage(e)}`);
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
      setError(`Glasses photo: ${errorMessage(e)}`);
    }
  };

  const reset = () => {
    setPhotos([]);
    setName('');
    setRelationship('');
    setNotes('');
    setError(null);
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
      setSaved(n);
      reset();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!permission) return <SafeAreaView style={styles.safe} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Display>Add a person</Display>

          {saved ? (
            <Banner title="Saved." body={`Recall will now say ${saved}'s name.`} onClose={() => setSaved(null)} />
          ) : null}

          {permission.granted ? (
            <View style={styles.cameraWrap}>
              <CameraView
                ref={camera}
                style={StyleSheet.absoluteFill}
                facing={facing}
                onCameraReady={() => setReady(true)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
                style={styles.flip}
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
                <Text style={styles.flipText}>Flip</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.cameraWrap, styles.center]}>
              <Body style={{ color: Colors.linen, textAlign: 'center' }}>
                Recall needs the camera to take three photos of a face.
              </Body>
              <Button title="Allow camera" onPress={requestPermission} style={{ marginTop: Spacing.four }} />
            </View>
          )}

          <View style={styles.strip}>
            {Array.from({ length: MAX_PHOTOS }).map((_, i) =>
              photos[i] ? (
                <Pressable
                  key={photos[i]}
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}>
                  <Image source={{ uri: photos[i] }} style={styles.thumb} contentFit="cover" />
                </Pressable>
              ) : (
                <View key={`empty-${i}`} style={[styles.thumb, styles.thumbEmpty]}>
                  <Text style={styles.thumbNum}>{i + 1}</Text>
                </View>
              )
            )}
          </View>

          <View style={styles.row}>
            <Button
              title={photos.length >= MAX_PHOTOS ? '3 photos ready' : photos.length ? 'Take the rest' : 'Take 3 photos'}
              onPress={burst}
              loading={shooting}
              disabled={!permission.granted || !ready || photos.length >= MAX_PHOTOS}
              style={{ flex: 1 }}
            />
            <Button
              title="From glasses"
              variant="outline"
              onPress={fromGlasses}
              disabled={photos.length >= MAX_PHOTOS}
            />
          </View>
          <Text style={styles.hint}>Tap a photo to retake it. Good light, face the camera.</Text>

          <Field
            ref={nameRef}
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Sarah"
            autoCapitalize="words"
            returnKeyType="next"
          />
          <Field
            label="How they're connected"
            value={relationship}
            onChangeText={setRelationship}
            placeholder="daughter, friend, judge"
            autoCapitalize="none"
          />
          <Field
            label="A warm memory to share"
            value={notes}
            onChangeText={setNotes}
            placeholder="She brought you tulips last week."
            multiline
            hint="Read aloud through the glasses. Keep it to one sentence."
          />

          {error ? <Banner tone="attention" title="Not saved" body={error} /> : null}

          <Button
            title="Save"
            size="calm"
            onPress={save}
            loading={saving}
            disabled={!name.trim() || photos.length === 0}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.linen },
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.eight },
  cameraWrap: {
    height: 300,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.six },
  flip: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.three,
    paddingHorizontal: Spacing.four,
    height: 44,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
  },
  flipText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  strip: { flexDirection: 'row', gap: Spacing.three },
  thumb: { width: 88, height: 88, borderRadius: Radii.sm },
  thumbEmpty: {
    backgroundColor: Colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.line,
    borderStyle: 'dashed',
  },
  thumbNum: { fontFamily: Fonts.display, fontSize: 22, color: Colors.inkSoft },
  row: { flexDirection: 'row', gap: Spacing.three },
  hint: { fontFamily: Fonts.body, fontSize: 14, color: Colors.inkSoft },
});
