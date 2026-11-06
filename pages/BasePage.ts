import { expect, type Page } from '@playwright/test';
import { env } from '../utils/env';
import {
  gotoWithRetry,
  type NavigationRetryOptions,
} from '../utils/navigation';

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

  async expectTitle(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(pattern);
  }
}
