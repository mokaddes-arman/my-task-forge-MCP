import fs from 'node:fs';
import { test as setup, expect } from '@playwright/test';
import { formatLoginDiagnostics, loginAndSaveState } from './helpers/auth';
import { ownerCredentials, STORAGE_STATE } from './helpers/env';

setup.setTimeout(90_000);

/**
 * Runs once before the `modules` project and stores the authenticated session.
 * Future module specs inherit `storageState` from playwright.config.ts and do
 * not need to log in through the UI.
 */
setup('authenticate owner and save storage state', async ({ browser }) => {
  const result = await loginAndSaveState(
    browser,
    ownerCredentials(),
    STORAGE_STATE,
    { attempts: 3, retryDelayMs: 1_500 },
  );

  await setup.info().attach('login-attempts', {
    body: JSON.stringify(result.attempts, null, 2),
    contentType: 'application/json',
  });

  expect(result.success, formatLoginDiagnostics(result)).toBe(true);
  expect(
    fs.existsSync(STORAGE_STATE),
    `Expected storage state at ${STORAGE_STATE}`,
  ).toBe(true);

  const state = JSON.parse(fs.readFileSync(STORAGE_STATE, 'utf8')) as {
    cookies?: unknown[];
    origins?: unknown[];
  };

  expect(
    (state.cookies?.length ?? 0) + (state.origins?.length ?? 0),
    'Storage state should contain at least one cookie or origin',
  ).toBeGreaterThan(0);
});
