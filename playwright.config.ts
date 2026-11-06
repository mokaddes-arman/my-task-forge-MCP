import { defineConfig, type Project } from '@playwright/test';
import { env, STORAGE_STATE } from './utils/env';

const AUTH_TEST = /00-auth\.spec\.ts/;
const SETUP_TEST = /auth\.setup\.ts/;
const MODULE_TEST = /(?:0[1-9]|1[0-9])-.*\.spec\.ts/;
const EMPTY_STATE = { cookies: [], origins: [] };

type BrowserName = 'chromium' | 'firefox' | 'webkit';
type ExtraUse = { channel?: 'chrome' };

function authProject(
  name: string,
  browserName: BrowserName,
  extraUse: ExtraUse = {},
): Project {
  return {
    name,
    testMatch: AUTH_TEST,
    use: {
      browserName,
      storageState: EMPTY_STATE,
      ...extraUse,
    },
  };
}

function moduleProject(
  name: string,
  browserName: BrowserName,
  extraUse: ExtraUse = {},
): Project {
  return {
    name,
    testMatch: MODULE_TEST,
    dependencies: ['setup'],
    use: {
      browserName,
      storageState: STORAGE_STATE,
      ...extraUse,
    },
  };
}

/**
 * TaskForge QA configuration.
 *
 * Auth projects start with an empty storage state and run the same spec in
 * Chrome, Firefox and WebKit. The setup project logs in once and writes the
 * shared storage state used by the module projects.
 *
 * Workers are intentionally pinned to 1 for the initial suite. The application
 * has a known sign-in consistency issue (QA-003) and a shared owner account, so
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
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: env.baseURL,
    headless: process.env.HEADED !== '1',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    authProject('auth-chrome', 'chromium', { channel: 'chrome' }),
    authProject('auth-firefox', 'firefox'),
    authProject('auth-webkit', 'webkit'),
    {
      name: 'setup',
      testMatch: SETUP_TEST,
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        storageState: EMPTY_STATE,
        // Setup types the real password; keep it out of traces.
        trace: 'off',
      },
    },
    moduleProject('modules-chrome', 'chromium', { channel: 'chrome' }),
    moduleProject('modules-firefox', 'firefox'),
    moduleProject('modules-webkit', 'webkit'),
  ],
});
