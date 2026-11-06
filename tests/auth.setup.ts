import fs from 'node:fs';
import { test as setup, expect } from '../fixtures/auth.fixture';
import { formatLoginDiagnostics, loginAndSaveState } from '../utils/auth';

setup.setTimeout(120_000);

/**
 * Runs once before the `modules-*` projects and stores the authenticated
 * session. Module specs inherit `storageState` from playwright.config.ts and do
 * not need to log in through the UI.
 */
setup(
  'authenticate owner and save storage state',
  async ({ browser, credentials, authStoragePath }) => {
    const result = await loginAndSaveState(
      browser,
      credentials,
      authStoragePath,
      { attempts: 3, retryDelayMs: 1_500 },
    );

    await setup.info().attach('login-attempts', {
      body: JSON.stringify(result.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(result.success, formatLoginDiagnostics(result)).toBe(true);
    expect(
      fs.existsSync(authStoragePath),
      `Expected storage state at ${authStoragePath}`,
    ).toBe(true);

    const state = JSON.parse(fs.readFileSync(authStoragePath, 'utf8')) as {
      cookies?: unknown[];
      origins?: unknown[];
    };

    expect(
      (state.cookies?.length ?? 0) + (state.origins?.length ?? 0),
      'Storage state should contain at least one cookie or origin',
    ).toBeGreaterThan(0);
  },
);
