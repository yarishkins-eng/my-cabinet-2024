import { defineConfig } from 'vitest/config';
import path from 'path';

// Standalone test config (kept separate from vite.config.ts to avoid pulling
// the React plugin / dev proxy into the test run and to minimise merge surface
// with upstream). Pure-logic units run in the lightweight `node` environment —
// no jsdom is needed until component tests arrive in a later phase.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
