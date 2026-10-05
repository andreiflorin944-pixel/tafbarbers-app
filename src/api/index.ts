import Constants from 'expo-constants';
import { httpApi } from './http';
import { mockApi } from './mock';

// Adresa serverului: din `extra.apiUrl` în app.json sau din EXPO_PUBLIC_API_URL.
// Goală = aplicația merge cu datele de test.
const apiUrl: string = process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string | undefined) || '';

export const api = apiUrl ? httpApi(apiUrl) : mockApi;
export const usingMock = !apiUrl;
export { ApiError } from './client';
export type { BookingApi } from './client';
