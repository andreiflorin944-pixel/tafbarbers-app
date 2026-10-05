import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// În dezvoltare, /v1 merge la serverul local (wrangler dev). În producție panoul e servit
// de același Worker, deci aceeași adresă.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/v1': 'http://127.0.0.1:8787' } },
});
