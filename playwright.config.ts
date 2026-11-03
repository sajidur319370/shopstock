import { defineConfig, devices } from '@playwright/test';

/**
 * TR-09/TR-11: the journeys in a real browser against the PRODUCTION build, on a disposable database.
 * CI installs Chromium (`npx playwright install --with-deps chromium`). Locally, an installed browser
 * works too: `PW_CHANNEL=msedge npm run e2e` (or chrome) skips the download.
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1, // one shared database: the journeys run in order (files are numbered)
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run e2e:server -w @shopstock/api',
    url: 'http://localhost:4100/ready',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL } }],
});
