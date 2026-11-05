'use strict';

/**
 * Navigates with a few retries for transient DNS/network changes. The app is
 * hosted behind Cloudflare and the QA environment occasionally reports
 * ERR_NAME_NOT_RESOLVED/ERR_NETWORK_CHANGED on a single navigation.
 */
async function gotoWithRetry(page, url, options = {}) {
  const maxAttempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  let lastError;

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

module.exports = { gotoWithRetry };
