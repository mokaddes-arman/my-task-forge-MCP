import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { LoginPage, INVALID_CREDENTIALS } from '../pages/LoginPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import type { Credentials } from './env';
import { env } from './env';

const SIGN_IN_ENDPOINT = '/api/v1/auth/sign-in/email';

// Better Auth's built-in custom rule for /sign-in/email is 3 requests per
// 10 seconds. TaskForge returns 429 when that is exceeded. The suite uses one
// shared owner account, so pace login submissions instead of treating normal
// UI coverage as an auth failure. A small safety margin covers the boundary.
const LOGIN_WINDOW_MS = 10_000;
const LOGIN_MAX_REQUESTS = 3;
const LOGIN_WINDOW_SAFETY_MS = 1_000;
let loginRequestTimestamps: number[] = [];

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
  contentType?: string;
  apiCode?: string;
  apiKeys?: string[];
  credentialUrlLeak: boolean;
  url: string;
  alert?: string;
  error?: string;
}

export interface LoginResult {
  success: boolean;
  attempts: LoginAttempt[];
}

export interface LoginOptions {
  attempts?: number;
  retryDelayMs?: number;
}

export interface RateLimitRetryOptions {
  maxRateLimitRetries?: number;
  retryDelayMs?: number;
}

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

    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(remainingMs, 250)),
    );
  }
}

/**
 * A retried sign-in can succeed after the previous attempt timed out waiting
 * for the redirect. Treat an already-authenticated page as success instead of
 * retrying against a page that no longer shows /login.
 */
async function isAuthenticated(page: Page): Promise<boolean> {
  return new WorkspacePage(page).isAuthenticated();
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

function hasCredentialQuery(value: string): boolean {
  try {
    const url = new URL(value);
    return url.searchParams.has('email') || url.searchParams.has('password');
  } catch {
    return false;
  }
}

/**
 * Submits the login form on the current /login page and reports the exact
 * outcome. It never throws for an expected 401/invalid-credentials response.
 */
export async function attemptLogin(
  page: Page,
  credentials: Credentials,
  attempt = 1,
): Promise<LoginAttempt> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const loginPage = new LoginPage(page);
  const workspacePage = new WorkspacePage(page);
  let status: number | undefined;
  let retryAfterMs: number | undefined;
  let contentType: string | undefined;
  let apiCode: string | undefined;
  let apiKeys: string[] | undefined;
  let alertText = '';
  let outcome: LoginOutcome = 'error';
  let error: string | undefined;

  try {
    await loginPage.waitForForm();
    await loginPage.waitForHydration();

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

      const body: unknown = await response.json().catch(() => undefined);
      if (body && typeof body === 'object') {
        apiKeys = Object.keys(body).sort();
        const code = (body as { code?: unknown }).code;
        if (typeof code === 'string') {
          apiCode = code;
        }
      }
    }

    try {
      const value = await loginPage.waitForSignInOutcome();

      if (value.kind === 'success') {
        // Wait for the authenticated shell, not just the URL change.
        await workspacePage.waitForAuthenticated();
        outcome = 'success';
      } else {
        alertText = value.text;
        outcome = status === 429 ? 'rate_limited' : 'invalid';
      }
    } catch {
      // The redirect can land just after the wait expires. Confirm the page
      // state before calling the attempt a failure.
      if (await workspacePage.isAuthenticated()) {
        outcome = 'success';
      } else {
        alertText = await loginPage.readAlert();
        if (status === 429) {
          outcome = 'rate_limited';
        } else if (INVALID_CREDENTIALS.test(alertText)) {
          outcome = 'invalid';
        } else {
          outcome = 'timeout';
          error = `Timed out waiting for sign-in outcome (path=${loginPage.currentPath()}, status=${status ?? 'n/a'})`;
        }
      }
    }
  } catch (cause) {
    if (await isAuthenticated(page)) {
      outcome = 'success';
    } else {
      outcome = 'error';
      error = cause instanceof Error ? cause.message : String(cause);
      alertText = await loginPage.readAlert();
    }
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
export async function openLoginPage(
  page: Page,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const maxAttempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  let lastError: unknown;

  for (let current = 1; current <= maxAttempts; current += 1) {
    try {
      await new LoginPage(page).goto({ waitForHydration: true });
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
  credentials: Credentials,
  attemptNumber = 1,
  options: RateLimitRetryOptions = {},
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

    if (await isAuthenticated(page)) {
      result.outcome = 'success';
      return attempts;
    }

    await openLoginPage(page);
  }

  return attempts;
}

/**
 * Logs in with retries. Retries are recorded, not hidden, so QA-003 remains
 * visible in the attached diagnostics.
 */
export async function loginWithRetry(
  page: Page,
  credentials: Credentials,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const maxAttempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1_500;
  const attempts: LoginAttempt[] = [];

  for (let current = 1; current <= maxAttempts; current += 1) {
    // A previous attempt may have finished logging in after its wait expired.
    if (current > 1 && (await isAuthenticated(page))) {
      attempts.at(-1)!.outcome = 'success';
      return { success: true, attempts };
    }

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
      let backoffMs = retryDelayMs * current;

      if (lastAttempt?.outcome === 'rate_limited') {
        // The server's window may include requests from an earlier run, so
        // wait a full window and let the local pacer start clean.
        loginRequestTimestamps = [];
        backoffMs = Math.max(
          lastAttempt.retryAfterMs ?? 0,
          LOGIN_WINDOW_MS + LOGIN_WINDOW_SAFETY_MS,
        );
      }

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
  credentials: Credentials,
  storagePath: string,
  options: LoginOptions = {},
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
  await new WorkspacePage(page).expectAuthenticated();
}

/** Human-readable diagnostics for a failed login assertion. */
export function formatLoginDiagnostics(result: {
  attempts: LoginAttempt[];
  success?: boolean;
}): string {
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
