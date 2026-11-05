'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { env } = require('./env');
const { gotoWithRetry } = require('./navigation');
const { LoginPage } = require('../../pages/LoginPage');
const { WorkspacePage } = require('../../pages/WorkspacePage');

const SIGN_IN_ENDPOINT = '/api/v1/auth/sign-in/email';
const INVALID_CREDENTIALS = /invalid email or password/i;

// Better Auth's built-in custom rule for /sign-in/email is 3 requests per
// 10 seconds. TaskForge returns 429 when that is exceeded. The suite uses one
// shared owner account, so pace login submissions instead of treating normal
// UI coverage as an auth failure. A small safety margin covers the boundary.
const LOGIN_WINDOW_MS = 10_000;
const LOGIN_MAX_REQUESTS = 3;
const LOGIN_WINDOW_SAFETY_MS = 1_000;
let loginRequestTimestamps = [];

async function waitForLoginSlot() {
  for (;;) {
    const now = Date.now();
    loginRequestTimestamps = loginRequestTimestamps.filter(
      (timestamp) => now - timestamp < LOGIN_WINDOW_MS,
    );

    if (loginRequestTimestamps.length < LOGIN_MAX_REQUESTS) {
      loginRequestTimestamps.push(now);
      return;
    }

    const oldest = loginRequestTimestamps[0];
    const remainingMs =
      LOGIN_WINDOW_MS - (now - oldest) + LOGIN_WINDOW_SAFETY_MS;

    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(remainingMs, 250)),
    );
  }
}

function clean(value) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Redacts credentials if a pre-hydration form submission put them in the URL. */
function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    for (const key of ['email', 'password', 'token', 'code']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function hasCredentialQuery(value) {
  try {
    const url = new URL(value);
    return url.searchParams.has('email') || url.searchParams.has('password');
  } catch {
    return false;
  }
}

/**
 * A native form submission before React hydrates performs a GET and leaks the
 * password into the URL (QA-012). Wait for React's onSubmit handler to be
 * attached before filling or clicking the form.
 */
async function waitForLoginFormHydration(page) {
  await new LoginPage(page).waitForHydration();
}

/**
 * Next.js renders its route announcer with role="alert" as well, so a plain
 * getByRole('alert') can be ambiguous. Read the first alert that has text.
 */
async function readAlert(page) {
  const alerts = page.locator('[role="alert"]');
  const count = await alerts.count();

  for (let index = 0; index < count; index += 1) {
    const text = clean(await alerts.nth(index).textContent().catch(() => ''));
    if (text) {
      return text;
    }
  }

  return '';
}

/**
 * Submits the login form on the current /login page and reports the exact
 * outcome. It never throws for an expected 401/invalid-credentials response.
 */
async function attemptLogin(page, credentials, attempt = 1) {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  let status;
  let retryAfterMs;
  let contentType;
  let apiCode;
  let apiKeys;
  let alertText = '';
  let outcome = 'error';
  let error;

  try {
    const loginPage = new LoginPage(page);

    await loginPage.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await waitForLoginFormHydration(page);

    // Keep the suite below Better Auth's 3-per-10s sign-in limit. Wait before
    // filling the form so a slow gate cannot race a client-side re-render and
    // clear the inputs.
    await waitForLoginSlot();

    await loginPage.fillCredentials(credentials);

    // Capture the API status and non-sensitive response metadata for
    // diagnostics, but do not make the result depend on it: a successful
    // response can still arrive before the client-side redirect. Never retain
    // the response body because it contains the session token.
    const responsePromise = page
      .waitForResponse(
        (response) => response.url().includes(SIGN_IN_ENDPOINT),
        { timeout: 20_000 },
      )
      .catch(() => undefined);

    await loginPage.submit();

    const response = await responsePromise;
    status = response?.status();

    if (response) {
      const responseHeaders = response.headers();
      contentType = responseHeaders['content-type'];

      const retryAfterSeconds = Number(
        responseHeaders['x-retry-after'] ??
          responseHeaders['retry-after'] ??
          Number.NaN,
      );
      retryAfterMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1_000
        : undefined;

      const body = await response.json().catch(() => undefined);
      if (body && typeof body === 'object') {
        apiKeys = Object.keys(body).sort();
        if (typeof body.code === 'string') {
          apiCode = body.code;
        }
      }
    }

    try {
      const handle = await page.waitForFunction(
        () => {
          const alert = document.querySelector('[role="alert"]');
          const text = (alert?.textContent ?? '').replace(/\s+/g, ' ').trim();

          if (window.location.pathname !== '/login') {
            return { kind: 'success' };
          }

          if (/invalid email or password/i.test(text)) {
            return { kind: 'invalid', text };
          }

          return false;
        },
        undefined,
        { timeout: 20_000 },
      );

      const value = await handle.jsonValue();

      if (value.kind === 'success') {
        // Wait for the authenticated shell, not just the URL change.
        await page
          .getByRole('button', { name: 'Account menu' })
          .waitFor({ state: 'visible', timeout: 20_000 });
        outcome = 'success';
      } else {
        alertText = clean(value.text);
        outcome = status === 429 ? 'rate_limited' : 'invalid';
      }
    } catch {
      // Fall through and classify from the final page state.
      alertText = await readAlert(page);
      if (status === 429) {
        outcome = 'rate_limited';
      } else if (INVALID_CREDENTIALS.test(alertText)) {
        outcome = 'invalid';
      } else {
        outcome = 'timeout';
        error = `Timed out waiting for sign-in outcome (path=${new URL(page.url()).pathname}, status=${status ?? 'n/a'})`;
      }
    }
  } catch (cause) {
    outcome = 'error';
    error = cause instanceof Error ? cause.message : String(cause);
    alertText = await readAlert(page);
  }

  return {
    attempt,
    outcome,
    startedAt,
    durationMs: Date.now() - start,
    status,
    retryAfterMs,
    contentType,
    apiCode,
    apiKeys,
    credentialUrlLeak: hasCredentialQuery(page.url()),
    url: sanitizeUrl(page.url()),
    alert: alertText || undefined,
    error,
  };
}

/** Opens /login and waits for the form, retrying transient navigation errors. */
async function openLoginPage(page, options = {}) {
  const maxAttempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  let lastError;

  for (let current = 1; current <= maxAttempts; current += 1) {
    try {
      const loginPage = new LoginPage(page);
      await gotoWithRetry(page, '/login', { attempts: 2 });
      await loginPage.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
      await loginPage.waitForHydration();
      return;
    } catch (cause) {
      lastError = cause;
      if (current < maxAttempts) {
        await page.waitForTimeout(delayMs * current);
      }
    }
  }

  throw lastError;
}

/**
 * Performs one logical sign-in, retrying only when the server explicitly
 * returns 429 with X-Retry-After. Invalid credentials and timeouts are returned
 * immediately so callers can assert the real authentication outcome.
 */
async function loginWithRateLimitRetry(
  page,
  credentials,
  attemptNumber = 1,
  options = {},
) {
  const maxRetries = options.maxRateLimitRetries ?? 2;
  const fallbackDelayMs = options.retryDelayMs ?? 5_000;
  const attempts = [];

  for (let current = 0; current <= maxRetries; current += 1) {
    const result = await attemptLogin(page, credentials, attemptNumber);
    attempts.push(result);

    if (result.outcome !== 'rate_limited' || current === maxRetries) {
      return attempts;
    }

    await page.waitForTimeout(
      Math.max(result.retryAfterMs ?? fallbackDelayMs, 1_000),
    );
    await openLoginPage(page);
  }

  return attempts;
}

/**
 * Logs in with retries. Retries are recorded, not hidden, so QA-003 remains
 * visible in the attached diagnostics.
 */
async function loginWithRetry(page, credentials, options = {}) {
  const maxAttempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const attempts = [];

  for (let current = 1; current <= maxAttempts; current += 1) {
    let loginPageReady = false;

    try {
      await openLoginPage(page);
      loginPageReady = true;
    } catch (cause) {
      attempts.push({
        attempt: current,
        outcome: 'error',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        credentialUrlLeak: false,
        url: sanitizeUrl(page.url()),
        error: `Could not open /login: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }

    if (loginPageReady) {
      const result = await attemptLogin(page, credentials, current);
      attempts.push(result);

      if (result.outcome === 'success') {
        return { success: true, attempts };
      }
    }

    if (current < maxAttempts) {
      const lastAttempt = attempts.at(-1);
      const backoffMs =
        lastAttempt?.outcome === 'rate_limited'
          ? Math.max(lastAttempt.retryAfterMs ?? 0, retryDelayMs * current * 2)
          : retryDelayMs * current;

      await page.waitForTimeout(backoffMs);
    }
  }

  return { success: false, attempts };
}

/**
 * Logs into a disposable context (used by the auth setup project) and writes
 * the storage state for later module specs.
 */
async function loginAndSaveState(browser, credentials, storagePath, options = {}) {
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });

  const context = await browser.newContext({ baseURL: env.baseURL });
  const page = await context.newPage();

  try {
    const result = await loginWithRetry(page, credentials, options);
    if (result.success) {
      await context.storageState({ path: storagePath });
    }
    return result;
  } finally {
    await context.close();
  }
}

/** Asserts that the app shell is rendered for an authenticated user. */
async function expectAuthenticated(page) {
  await new WorkspacePage(page).expectAuthenticated();
}

/** Logs out through the account menu and waits for the login page. */
async function logout(page) {
  const workspacePage = new WorkspacePage(page);

  await workspacePage.openAccountMenu();
  await workspacePage.logOut();

  try {
    await workspacePage.waitForLoginUrl();
  } catch (cause) {
    // Logging out clears the auth cookie and navigates to /login. If that
    // navigation hits a transient DNS/network error, verify the cleared
    // session with an explicit navigation instead of failing on the redirect.
    await gotoWithRetry(page, '/login');

    if (new URL(page.url()).pathname !== '/login') {
      throw cause;
    }
  }
}

/** Human-readable diagnostics for a failed login assertion. */
function formatLoginDiagnostics(result) {
  const lines = result.attempts.map((attempt) => {
    const status = attempt.status ?? 'n/a';
    return [
      `#${attempt.attempt}: ${attempt.outcome}`,
      `status=${status}`,
      attempt.apiCode ? `apiCode=${attempt.apiCode}` : undefined,
      `url=${attempt.url}`,
      attempt.credentialUrlLeak ? 'credentialUrlLeak=true' : undefined,
      attempt.alert ? `alert="${attempt.alert}"` : undefined,
      attempt.error ? `error="${attempt.error}"` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
  });

  return [
    `Sign-in did not succeed after ${result.attempts.length} attempt(s).`,
    ...lines,
  ].join('\n');
}

module.exports = {
  attemptLogin,
  expectAuthenticated,
  formatLoginDiagnostics,
  gotoWithRetry,
  loginAndSaveState,
  loginWithRateLimitRetry,
  loginWithRetry,
  logout,
  openLoginPage,
  waitForLoginFormHydration,
};
