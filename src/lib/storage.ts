import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Token-ul de sesiune: în Keychain/Keystore pe telefon, în localStorage pe web.
export const SESSION_KEY = 'taf.session';

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        if (value === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
        return;
      }
      if (value === null) await SecureStore.deleteItemAsync(key);
      // Citibil și cu telefonul blocat (după prima deblocare): „Ești lângă salon” rulează în fundal.
      else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    } catch {
      // Fără stocare: utilizatorul va intra din nou în cont data viitoare.
    }
  },
};
