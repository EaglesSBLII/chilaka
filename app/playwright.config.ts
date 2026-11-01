import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 1,
  workers: 1, // suite mutates IndexedDB state; keep deterministic
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // no single action may hang the whole test — detached-element races throw
    // quickly and the solvers retry instead
    actionTimeout: 10_000,
    permissions: [],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
