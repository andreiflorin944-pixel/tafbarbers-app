import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Alege o poză din galerie (sau o face cu camera) și o micșorează la cel mult 1200 px,
 * ca să încapă sub limita serverului. Întoarce adresa locală a pozei sau null dacă renunță.
 */
export async function pickImage(opts: { camera?: boolean; square?: boolean } = {}): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: !!opts.square, aspect: opts.square ? [1, 1] : undefined };
  if (opts.camera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const res = opts.camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const big = Math.max(a.width ?? 0, a.height ?? 0);
  const resize = big > 1200 ? [{ resize: (a.width ?? 0) >= (a.height ?? 0) ? { width: 1200 } : { height: 1200 } }] : [];
  const out = await manipulateAsync(a.uri, resize, { compress: 0.75, format: SaveFormat.JPEG });
  return out.uri;
}
