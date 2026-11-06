import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../utils/env';
import {
  gotoWithRetry,
  type NavigationRetryOptions,
} from '../utils/navigation';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shared navigation and assertion helpers for every page object. Page objects
 * own all selectors; tests only call their methods.
 */
export class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(path: string, options?: NavigationRetryOptions): Promise<void> {
    await gotoWithRetry(this.page, path, options);
  }

  currentPath(): string {
    return new URL(this.page.url()).pathname;
  }

  async expectUrl(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(pattern);
  }

  /** Asserts the current pathname, ignoring query/hash differences. */
  async expectPath(path: string): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`${escapeRegExp(path)}(?:[?#].*)?$`),
    );
  }

  async expectTitle(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(pattern);
  }

  /**
   * Dashboard/report modules render skeleton placeholders before their data
   * arrives (QA-007). Wait for real content by asserting no skeleton slots
   * remain in the given scope.
   */
  async waitForSkeletonsToClear(
    scope?: Locator,
    timeout = 30_000,
  ): Promise<void> {
    const target = scope ?? this.page.locator('body');

    await expect
      .poll(() => target.locator('[data-slot="skeleton"]').count(), {
        timeout,
        message: 'Expected loading skeletons to be replaced by real content',
      })
      .toBe(0);
  }
}
