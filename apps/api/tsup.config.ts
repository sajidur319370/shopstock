import { defineConfig } from 'tsup';

// tsup 9 dropped the --noExternal CLI flag: it lives here now.
export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // The workspace package is TypeScript source (no build of its own): bundle it in. Real npm
  // dependencies stay external and come from node_modules on the server (npm ci).
  noExternal: ['@shopstock/shared'],
});
