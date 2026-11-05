import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { env, type OwnerCredentials } from './env';

export type LoginOutcome =
  | 'success'
  | 'invalid'
  | 'rate_limited'
  | 'timeout'
  | 'error';

export interface LoginAttempt {
  attempt: number;
  outcome: LoginOutcome;
  startedAt: string;
  durationMs: number;
  status?: number;
  retryAfterMs?: number;
  url: string;
  alert?: string;
  error?: string;
}

export interface LoginResult {
  success: boolean;
  attempts: LoginAttempt[];
}

export interface LoginRetryOptions {
  attempts?: number;
  retryDelayMs?: number;
}

const SIGN_IN_ENDPOINT = '/api/v1/auth/sign-in/email';
const INVALID_CREDENTIALS = /invalid email or password/i;

// Better Auth's built-in custom rule for /sign-in/email is 3 requests per
// 10 seconds. TaskForge returns 429 when that is exceeded. The suite uses one
// shared owner account, so pace login submissions instead of treating normal
// UI coverage as an auth failure. A small safety margin covers the boundary.
const LOGIN_WINDOW_MS = 10_000;
const LOGIN_MAX_REQUESTS = 3;
const LOGIN_WINDOW_SAFETY_MS = 1_000;
let loginRequestTimestamps: number[] = [];

async function waitForLoginSlot(): Promise<void> {
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

    await new Promise((resolve) => setTimeout(resolve, Math.max(remainingMs, 250)));
  }
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Redacts credentials if a pre-hydration form submission put them in the URL. */
function sanitizeUrl(value: string): string {
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

/**
 * A native form submission before React hydrates performs a GET and leaks the
 * password into the URL (observed while building this suite). Wait for React's
 * onSubmit handler to be attached before filling or clicking the form.
 */
export async function waitForLoginFormHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const form = document.querySelector('form');
      if (!form) {
        return false;
      }

      const formWithReact = form as unknown as Record<
        string,
        { onSubmit?: unknown }
      >;
      const propsKey = Object.keys(form).find(
        (key) =>
          key.startsWith('__reactProps$') ||
          key.startsWith('__reactEventHandlers$'),
      );

      return (
        !!propsKey && typeof formWithReact[propsKey]?.onSubmit === 'function'
      );
    },
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Next.js renders its route announcer with role="alert" as well, so a plain
 * getByRole('alert') can be ambiguous. Read the first alert that has text.
 */
async function readAlert(page: Page): Promise<string> {
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
export async function attemptLogin(
  page: Page,
  credentials: OwnerCredentials,
  attempt = 1,
): Promise<LoginAttempt> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  let status: number | undefined;
  let retryAfterMs: number | undefined;
  let alertText = '';
  let outcome: LoginOutcome = 'error';
  let error: string | undefined;

  try {
    const email = page.getByRole('textbox', { name: 'Email' });
    const password = page.getByRole('textbox', { name: 'Password' });
    const submit = page.getByRole('button', { name: 'Log in', exact: true });

    await email.waitFor({ state: 'visible', timeout: 15_000 });
    await waitForLoginFormHydration(page);

    // Keep the suite below Better Auth's 3-per-10s sign-in limit. Wait before
    // filling the form so a slow gate cannot race a client-side re-render and
    // clear the inputs.
    await waitForLoginSlot();

    await email.fill(credentials.email);
    await password.fill(credentials.password);

    // Capture the API status for QA-003 diagnostics, but do not make the
    // result depend on it: a successful response can still arrive before the
    // client-side redirect.
    const responsePromise = page
      .waitForResponse(
        (response) => response.url().includes(SIGN_IN_ENDPOINT),
        { timeout: 20_000 },
      )
      .catch(() => undefined);

    await submit.click();

    const response = await responsePromise;
    status = response?.status();

    const responseHeaders = response?.headers();
    const retryAfterSeconds = Number(
      responseHeaders?.['x-retry-after'] ??
        responseHeaders?.['retry-after'] ??
        Number.NaN,
    );
    retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1_000
      : undefined;

    try {
      const handle = await page.waitForFunction(
        () => {
          const alert = document.querySelector('[role="alert"]');
          const text = (alert?.textContent ?? '').replace(/\s+/g, ' ').trim();

          if (window.location.pathname !== '/login') {
            return { kind: 'success' as const };
          }

          if (/invalid email or password/i.test(text)) {
            return { kind: 'invalid' as const, text };
          }

          return false;
        },
        undefined,
        { timeout: 20_000 },
      );

      const value = (await handle.jsonValue()) as {
        kind: 'success' | 'invalid';
        text?: string;
      };

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
    url: sanitizeUrl(page.url()),
    alert: alertText || undefined,
    error,
  };
}

/**
 * Navigates with a few retries for transient DNS/network changes. The app is
 * hosted behind Cloudflare and the QA environment occasionally reports
 * ERR_NAME_NOT_RESOLVED/ERR_NETWORK_CHANGED on a single navigation.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const maxAttempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  let lastError: unknown;

  for (let current = 1; current <= maxAttempts; current += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
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

/** Opens /login and waits for the form, retrying transient navigation errors. */
export async function openLoginPage(
  page: Page,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const maxAttempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  let lastError: unknown;

  for (let current = 1; current <= maxAttempts; current += 1) {
    try {
      await gotoWithRetry(page, '/login', { attempts: 2 });
      await page
        .getByRole('textbox', { name: 'Email' })
        .waitFor({ state: 'visible', timeout: 15_000 });
      await waitForLoginFormHydration(page);
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
export async function loginWithRateLimitRetry(
  page: Page,
  credentials: OwnerCredentials,
  attemptNumber = 1,
  options: { maxRateLimitRetries?: number; retryDelayMs?: number } = {},
): Promise<LoginAttempt[]> {
  const maxRetries = options.maxRateLimitRetries ?? 2;
  const fallbackDelayMs = options.retryDelayMs ?? 5_000;
  const attempts: LoginAttempt[] = [];

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
 * Logs in with retries. Retries are recorded, not hidden, so QA-003 (transient
 * 401 responses) remains visible in the attached diagnostics.
 */
export async function loginWithRetry(
  page: Page,
  credentials: OwnerCredentials,
  options: LoginRetryOptions = {},
): Promise<LoginResult> {
  const maxAttempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const attempts: LoginAttempt[] = [];

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
export async function loginAndSaveState(
  browser: Browser,
  credentials: OwnerCredentials,
  storagePath: string,
  options: LoginRetryOptions = {},
): Promise<LoginResult> {
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
export async function expectAuthenticated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).not.toBe('/login');
}

/** Logs out through the account menu and waits for the login page. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();

  const logOut = page
    .getByRole('menuitem', { name: /log out/i })
    .or(page.getByRole('button', { name: /log out/i }))
    .or(page.getByText('Log out', { exact: true }));

  await logOut.first().click();

  try {
    await page.waitForURL((url) => url.pathname === '/login', {
      timeout: 20_000,
    });
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
export function formatLoginDiagnostics(result: LoginResult): string {
  const lines = result.attempts.map((attempt) => {
    const status = attempt.status ?? 'n/a';
    return [
      `#${attempt.attempt}: ${attempt.outcome}`,
      `status=${status}`,
      `url=${attempt.url}`,
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
