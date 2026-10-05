import { httpApi } from './http';
import { mockApi } from './mock';
import { apiUrl } from './staff';

// Adresa serverului: din `extra.apiUrl` în app.json sau din EXPO_PUBLIC_API_URL.
// Goală = aplicația merge cu datele de test.
export const api = apiUrl ? httpApi(apiUrl) : mockApi;
export const usingMock = !apiUrl;
export { apiUrl };
export { ApiError } from './client';
export type { BookingApi } from './client';
