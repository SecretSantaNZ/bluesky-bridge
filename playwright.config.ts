import { defineConfig } from '@playwright/test';

/**
 * Integration (e2e) tests.
 *
 * The harness in `e2e/fixtures.ts` builds the real Fastify app in-process with
 * a fresh in-memory SQLite database per test and a fake Bluesky app-view (msw)
 * -- nothing ever reaches real Bluesky or Mastodon. See `e2e/README.md`.
 *
 * Requires the client assets to be built first (npm run test:e2e does this):
 *   node build-client.mjs build
 */
export default defineConfig({
  testDir: 'e2e',
  // Snapshot files live in e2e/__screenshots__ if screenshot tests are added
  timeout: 30_000,
  globalTimeout: 10 * 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workerCount: process.env.CI ? 2 : 4,
  reporter: [['list', { printSteps: false }]],
  use: {
    // The app under test binds a random port per test; `browser` fixture pages
    // get their baseURL from the per-test `app` fixture instead.
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
  },
  outputDir: 'test-results',
  snapshotDir: 'e2e/__screenshots__',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
});
