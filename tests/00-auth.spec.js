'use strict';

const { test, expect } = require('../fixtures/auth.fixture');
const {
  expectAuthenticated,
  formatLoginDiagnostics,
  gotoWithRetry,
  loginWithRateLimitRetry,
  loginWithRetry,
  logout,
  openLoginPage,
} = require('./helpers/auth');
const { env } = require('./helpers/env');
const { LoginPage } = require('../pages/LoginPage');
const { WorkspacePage } = require('../pages/WorkspacePage');

const LOGIN_RETRY_OPTIONS = { attempts: 3, retryDelayMs: 1_500 };

function annotateFinding(description) {
  test.info().annotations.push({
    type: 'qa-finding',
    description,
  });
}

test.describe('Login page UI', () => {
  test('renders the login form and account links', async ({
    page,
    loginPage,
  }) => {
    await loginPage.goto();

    await expect(page).toHaveTitle(/Log in .* TaskForge/);
    await loginPage.expectRendered();
  });

  test('empty fields show inline validation without calling the sign-in API', async ({
    page,
    loginPage,
  }) => {
    const signInRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/auth/sign-in/email')) {
        signInRequests.push(request.url());
      }
    });

    await loginPage.goto({ waitForHydration: true });
    await loginPage.submit();

    await expect(loginPage.errorAlert(/enter your email/i)).toBeVisible();
    await expect(loginPage.errorAlert(/enter your password/i)).toBeVisible();
    await expect(loginPage.emailInput).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(loginPage.passwordInput).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await loginPage.expectNoCredentialQuery();
    expect(signInRequests).toHaveLength(0);
  });

  test('invalid email format is rejected before the sign-in API', async ({
    page,
    loginPage,
  }) => {
    const signInRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/auth/sign-in/email')) {
        signInRequests.push(request.url());
      }
    });

    await loginPage.goto({ waitForHydration: true });
    await loginPage.fillEmail('not-an-email');
    await loginPage.fillPassword('Format-Test-Only!');
    await loginPage.submit();

    await expect(
      loginPage.errorAlert(/enter a valid email address/i),
    ).toBeVisible();
    await expect(loginPage.emailInput).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await loginPage.expectNoCredentialQuery();
    expect(signInRequests).toHaveLength(0);
  });

  test('password visibility toggles without losing the value', async ({
    loginPage,
  }) => {
    const fakePassword = 'Visibility-Test-Only!';

    await loginPage.goto({ waitForHydration: true });
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    await expect(loginPage.passwordToggle).toHaveAttribute(
      'aria-label',
      'Show password',
    );

    await loginPage.fillPassword(fakePassword);
    await loginPage.togglePasswordVisibility();

    await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');
    await expect(loginPage.passwordInput).toHaveValue(fakePassword);
    await expect(loginPage.passwordToggle).toHaveAttribute(
      'aria-label',
      'Hide password',
    );

    await loginPage.togglePasswordVisibility();

    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    await expect(loginPage.passwordToggle).toHaveAttribute(
      'aria-label',
      'Show password',
    );
  });
});

test.describe('Authentication', () => {
  // Credential-entry tests must not record fill actions or request payloads.
  test.use({ trace: 'off' });

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
    expect(successfulAttempt?.apiKeys).toEqual(
      expect.arrayContaining(['token', 'user']),
    );
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

    await expect(
      loginPage.errorAlert(/invalid email or password/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(workspacePage.accountMenuButton).toHaveCount(0);

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

  test('a fresh unauthenticated context is redirected from protected routes', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: env.baseURL });

    try {
      const page = await context.newPage();
      await gotoWithRetry(page, env.workspacePath);

      await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
      await expect(new LoginPage(page).emailInput).toBeVisible();
      await expect(new WorkspacePage(page).accountMenuButton).toHaveCount(0);
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

    await logout(page);
    await workspacePage.expectLoggedOut();

    // A protected route must not render after logout.
    await gotoWithRetry(page, env.workspacePath);
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
    await gotoWithRetry(page, env.workspacePath);

    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(loginPage.emailInput).toBeVisible();
    await expect(workspacePage.accountMenuButton).toHaveCount(0);
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
    const attemptGroups = [];

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
      .filter(Boolean);
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
