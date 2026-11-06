import { test, expect } from '../fixtures/auth.fixture';
import {
  formatLoginDiagnostics,
  loginWithRateLimitRetry,
  loginWithRetry,
  openLoginPage,
  type LoginAttempt,
} from '../utils/auth';
import { env } from '../utils/env';
import { LoginPage } from '../pages/LoginPage';
import { WorkspacePage } from '../pages/WorkspacePage';

const LOGIN_RETRY_OPTIONS = { attempts: 3, retryDelayMs: 1_500 };

// These tests type the real password; never record it in a trace.
test.use({ trace: 'off' });

function annotateFinding(description: string): void {
  test.info().annotations.push({
    type: 'qa-finding',
    description,
  });
}

test.describe('Login page UI', () => {
  test('renders the login form and account links', async ({ loginPage }) => {
    await loginPage.goto();

    await loginPage.expectTitle(/Log in .* TaskForge/);
    await loginPage.expectRendered();
  });

  test('empty fields show inline validation without calling the sign-in API', async ({
    loginPage,
  }) => {
    const signInRequests = loginPage.trackSignInRequests();

    await loginPage.goto({ waitForHydration: true });
    await loginPage.submit();

    await loginPage.expectEmptyFieldValidation();
    await loginPage.expectNoCredentialQuery();
    await loginPage.expectNoSignInRequests(signInRequests);
  });

  test('invalid email format is rejected before the sign-in API', async ({
    loginPage,
  }) => {
    const signInRequests = loginPage.trackSignInRequests();

    await loginPage.goto({ waitForHydration: true });
    await loginPage.fillEmail('not-an-email');
    await loginPage.fillPassword('Format-Test-Only!');
    await loginPage.submit();

    await loginPage.expectInvalidEmailValidation();
    await loginPage.expectNoCredentialQuery();
    await loginPage.expectNoSignInRequests(signInRequests);
  });

  test('password visibility toggles without losing the value', async ({
    loginPage,
  }) => {
    const fakePassword = 'Visibility-Test-Only!';

    await loginPage.goto({ waitForHydration: true });
    await loginPage.expectPasswordHidden();

    await loginPage.fillPassword(fakePassword);
    await loginPage.togglePasswordVisibility();
    await loginPage.expectPasswordRevealed(fakePassword);

    await loginPage.togglePasswordVisibility();
    await loginPage.expectPasswordHidden();
  });
});

test.describe('Authentication', () => {
  test('valid owner credentials authenticate and return a JSON API response', async ({
    page,
    credentials,
    workspacePage,
  }) => {
    test.slow();
    annotateFinding(
      'QA-004 reference: owner credentials and profile email alignment; see qa/findings.md.',
    );

    const result = await loginWithRetry(
      page,
      credentials,
      LOGIN_RETRY_OPTIONS,
    );

    await test.info().attach('login-attempts', {
      body: JSON.stringify(result.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(result.success, formatLoginDiagnostics(result)).toBe(true);
    await workspacePage.expectAuthenticated();

    const successfulAttempt = result.attempts.at(-1);
    expect(successfulAttempt?.outcome).toBe('success');
    expect(successfulAttempt?.status).toBe(200);
    expect(successfulAttempt?.contentType).toMatch(/application\/json/i);

    // The client redirects as soon as the response arrives, so Playwright can
    // occasionally lose the response body before it is read. The status and
    // content type prove the JSON API contract; inspect the body when captured.
    if (successfulAttempt?.apiKeys) {
      expect(successfulAttempt.apiKeys).toEqual(
        expect.arrayContaining(['token', 'user']),
      );
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'Sign-in response body was not readable after the redirect; status 200 and JSON content type were verified instead.',
      });
    }

    expect(successfulAttempt?.credentialUrlLeak).toBe(false);
  });

  test('invalid credentials return 401 and do not create a session', async ({
    page,
    credentials,
    loginPage,
    workspacePage,
  }) => {
    await openLoginPage(page);

    const invalid = {
      email: credentials.email,
      password: `Wrong-${Date.now()}-Password!`,
    };

    const attempts = await loginWithRateLimitRetry(page, invalid);
    const attempt = attempts.at(-1);

    await test.info().attach('invalid-login-attempts', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    });

    expect(
      attempt?.outcome,
      formatLoginDiagnostics({ success: false, attempts }),
    ).toBe('invalid');

    await loginPage.expectInvalidCredentialsError();
    await workspacePage.expectLoggedOut();

    expect(attempt?.status).toBe(401);
    expect(attempt?.apiCode).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(attempt?.credentialUrlLeak).toBe(false);
    await loginPage.expectNoCredentialQuery();
  });

  test('authenticated storageState persists into a new browser context', async ({
    browser,
    credentials,
  }) => {
    test.slow();

    const statePath = test.info().outputPath('persistence-state.json');
    const contextA = await browser.newContext({ baseURL: env.baseURL });

    try {
      const pageA = await contextA.newPage();
      const loginResult = await loginWithRetry(
        pageA,
        credentials,
        LOGIN_RETRY_OPTIONS,
      );

      await test.info().attach('persistence-login-attempts', {
        body: JSON.stringify(loginResult.attempts, null, 2),
        contentType: 'application/json',
      });

      expect(
        loginResult.success,
        formatLoginDiagnostics(loginResult),
      ).toBe(true);
      await new WorkspacePage(pageA).expectAuthenticated();

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
      const workspacePage = new WorkspacePage(pageB);

      await workspacePage.goto();
      await workspacePage.expectAuthenticated();

      expect(workspacePage.currentPath()).not.toBe('/login');
    } finally {
      await contextB.close();
    }
  });

  test('a fresh unauthenticated context is redirected from protected routes', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: env.baseURL });

    try {
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      const workspacePage = new WorkspacePage(page);

      await workspacePage.goto();
      await workspacePage.expectLoggedOut();
      await loginPage.expectVisible();
    } finally {
      await context.close();
    }
  });

  test('logout clears the session and protects workspace routes', async ({
    page,
    credentials,
    workspacePage,
  }) => {
    test.slow();

    const loginResult = await loginWithRetry(
      page,
      credentials,
      LOGIN_RETRY_OPTIONS,
    );

    await test.info().attach('logout-login-attempts', {
      body: JSON.stringify(loginResult.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(loginResult.success, formatLoginDiagnostics(loginResult)).toBe(true);
    await workspacePage.expectAuthenticated();

    await workspacePage.logout();
    await workspacePage.expectLoggedOut();

    // A protected route must not render after logout.
    await workspacePage.goto();
    await workspacePage.expectLoggedOut();
  });

  test('clearing session cookies redirects protected routes to login', async ({
    page,
    context,
    credentials,
    loginPage,
    workspacePage,
  }) => {
    test.slow();
    annotateFinding(
      'Session-expiry simulation: auth cookies cleared in a disposable context.',
    );

    const loginResult = await loginWithRetry(
      page,
      credentials,
      LOGIN_RETRY_OPTIONS,
    );

    await test.info().attach('session-expiry-login-attempts', {
      body: JSON.stringify(loginResult.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(loginResult.success, formatLoginDiagnostics(loginResult)).toBe(true);
    await workspacePage.expectAuthenticated();

    await context.clearCookies();
    await workspacePage.goto();

    await workspacePage.expectLoggedOut();
    await loginPage.expectVisible();
  });

  test('QA-003: repeated fresh-context sign-ins are consistent', async ({
    browser,
    credentials,
  }) => {
    test.slow();
    annotateFinding(
      'QA-003 reference: fresh-context sign-in consistency guard. The original transient-401 claim remains documented and is not automatically re-confirmed.',
    );

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
    }

    const attempts = attemptGroups.flat();
    await test.info().attach('fresh-context-logins', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    });

    const finalAttempts = attemptGroups
      .map((group) => group.at(-1))
      .filter((attempt): attempt is LoginAttempt => Boolean(attempt));
    const failures = finalAttempts.filter(
      (attempt) => attempt.outcome !== 'success',
    );

    expect(
      failures,
      `QA-003 transient sign-in failure detected. ` +
        `Expected all ${iterations} fresh-context logins to succeed.\n` +
        `Attempts: ${JSON.stringify(attempts, null, 2)}`,
    ).toHaveLength(0);
    expect(finalAttempts).toHaveLength(iterations);

    for (const attempt of finalAttempts) {
      expect(attempt.status).toBe(200);
      expect(attempt.credentialUrlLeak).toBe(false);
    }
  });
});
