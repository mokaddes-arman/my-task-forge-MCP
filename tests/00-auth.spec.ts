import { expect, test } from '@playwright/test';
import {
  expectAuthenticated,
  formatLoginDiagnostics,
  gotoWithRetry,
  loginWithRateLimitRetry,
  loginWithRetry,
  logout,
  openLoginPage,
  type LoginAttempt,
} from './helpers/auth';
import { env, ownerCredentials } from './helpers/env';

const credentials = ownerCredentials();

/**
 * Standalone authentication coverage.
 *
 * This project starts with an empty storage state. It verifies both the happy
 * path and the QA-003 transient-401 concern before later module specs consume
 * the saved storage state from the setup project.
 */
test.describe('Authentication', () => {
  test('valid owner credentials authenticate and render the workspace shell', async ({
    page,
  }) => {
    test.slow();

    const result = await loginWithRetry(page, credentials, {
      attempts: 3,
      retryDelayMs: 1_500,
    });

    await test.info().attach('login-attempts', {
      body: JSON.stringify(result.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(result.success, formatLoginDiagnostics(result)).toBe(true);
    await expectAuthenticated(page);

    const successfulAttempt = result.attempts.at(-1);
    expect(successfulAttempt?.outcome).toBe('success');

    // The sign-in endpoint should respond with a 2xx status. This is asserted
    // when the response was observed; the UI redirect is the primary oracle.
    if (successfulAttempt?.status !== undefined) {
      expect(successfulAttempt.status).toBeGreaterThanOrEqual(200);
      expect(successfulAttempt.status).toBeLessThan(300);
    }
  });

  test('invalid credentials show an error and do not create a session', async ({
    page,
  }) => {
    await openLoginPage(page);

    const invalid = {
      email: credentials.email,
      password: `Wrong-${Date.now()}-Password!`,
    };

    const attempts = await loginWithRateLimitRetry(page, invalid);
    const attempt = attempts.at(-1)!;

    await test.info().attach('invalid-login-attempts', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    });

    expect(
      attempt.outcome,
      formatLoginDiagnostics({ success: false, attempts }),
    ).toBe('invalid');

    const errorAlert = page
      .getByRole('alert')
      .filter({ hasText: /invalid email or password/i });

    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/invalid email or password/i);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(
      0,
    );

    if (attempt.status !== undefined) {
      expect(attempt.status).toBe(401);
    }
  });

  test('authenticated storageState persists into a new browser context', async ({
    browser,
  }) => {
    test.slow();

    const statePath = test.info().outputPath('persistence-state.json');
    const contextA = await browser.newContext({ baseURL: env.baseURL });

    try {
      const pageA = await contextA.newPage();
      const loginResult = await loginWithRetry(pageA, credentials, {
        attempts: 3,
        retryDelayMs: 1_500,
      });

      await test.info().attach('persistence-login-attempts', {
        body: JSON.stringify(loginResult.attempts, null, 2),
        contentType: 'application/json',
      });

      expect(
        loginResult.success,
        formatLoginDiagnostics(loginResult),
      ).toBe(true);
      await expectAuthenticated(pageA);

      // Persist the authenticated cookies/local storage, then discard the
      // original context. Context B must still be authenticated.
      await contextA.storageState({ path: statePath });
    } finally {
      await contextA.close();
    }

    const contextB = await browser.newContext({
      baseURL: env.baseURL,
      storageState: statePath,
    });

    try {
      const pageB = await contextB.newPage();
      await gotoWithRetry(pageB, env.workspacePath);
      await expectAuthenticated(pageB);

      expect(new URL(pageB.url()).pathname).not.toBe('/login');
    } finally {
      await contextB.close();
    }
  });

  test('logout clears the session and protects workspace routes', async ({
    page,
  }) => {
    test.slow();

    const loginResult = await loginWithRetry(page, credentials, {
      attempts: 3,
      retryDelayMs: 1_500,
    });

    await test.info().attach('logout-login-attempts', {
      body: JSON.stringify(loginResult.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(loginResult.success, formatLoginDiagnostics(loginResult)).toBe(true);
    await expectAuthenticated(page);

    await logout(page);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(
      0,
    );

    // A protected route must not render after logout.
    await gotoWithRetry(page, env.workspacePath);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(
      0,
    );
  });

  test('QA-003: repeated fresh-context sign-ins are consistent', async ({
    browser,
  }) => {
    test.slow();

    const iterations = 3;
    const attemptGroups: LoginAttempt[][] = [];

    for (let current = 1; current <= iterations; current += 1) {
      const context = await browser.newContext({ baseURL: env.baseURL });

      try {
        const page = await context.newPage();
        await openLoginPage(page);

        attemptGroups.push(
          await loginWithRateLimitRetry(page, credentials, current, {
            maxRateLimitRetries: 2,
          }),
        );
      } finally {
        await context.close();
      }

      // Give the auth endpoint a small amount of breathing room between fresh
      // contexts so the test measures consistency rather than burst rate limits.
      if (current < iterations) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }

    const attempts = attemptGroups.flat();
    await test.info().attach('fresh-context-logins', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    });

    const finalAttempts = attemptGroups
      .map((group) => group.at(-1))
      .filter((attempt): attempt is LoginAttempt => !!attempt);
    const failures = finalAttempts.filter(
      (attempt) => attempt.outcome !== 'success',
    );

    expect(
      failures,
      `QA-003 transient sign-in failure detected. ` +
        `Expected all ${iterations} fresh-context logins to succeed.\n` +
        `Attempts: ${JSON.stringify(attempts, null, 2)}`,
    ).toHaveLength(0);
  });
});
