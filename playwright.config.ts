import { defineConfig } from '@playwright/test';
import { env, STORAGE_STATE } from './tests/helpers/env';

/**
 * TaskForge QA configuration.
 *
 * Projects:
 *  - auth    : standalone authentication spec (starts logged out)
 *  - setup   : logs in once and writes playwright/.auth/user.json
 *  - modules : all future module specs, reusing the saved storage state
 *
 * Workers are intentionally pinned to 1 for the initial suite. The application
 * has a known transient sign-in issue (QA-003) and a shared owner account, so
 * serial execution keeps diagnostics deterministic. Raise workers only after
 * dedicated test accounts/workspaces exist.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: env.baseURL,
    channel: 'chrome',
    headless: process.env.HEADED !== '1',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'auth',
      testMatch: /00-auth\.spec\.ts/,
      use: {
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: 'modules',
      testMatch: /(?:0[1-9]|1[0-9])-.*\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        storageState: STORAGE_STATE,
      },
    },
  ],
});
