import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    // The browser only ever talks to :5173, so dev is "same origin" just like production.
    // API_PROXY lets a second stack run beside your dev servers (e.g. a test API on :4100).
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:4000' },
  },
});
