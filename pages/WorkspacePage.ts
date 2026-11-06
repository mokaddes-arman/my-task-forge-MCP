import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../utils/env';
import { gotoWithRetry } from '../utils/navigation';
import { BasePage } from './BasePage';

export class WorkspacePage extends BasePage {
  readonly accountMenuButton: Locator;
  readonly main: Locator;
  readonly logOutMenuItem: Locator;

  constructor(page: Page) {
    super(page);
    this.accountMenuButton = page.getByRole('button', {
      name: 'Account menu',
    });
    this.main = page.getByRole('main');
    this.logOutMenuItem = page
      .getByRole('menuitem', { name: /log out/i })
      .or(page.getByRole('button', { name: /log out/i }))
      .or(page.getByText('Log out', { exact: true }));
  }

  async goto(path: string = env.workspacePath): Promise<void> {
    await this.navigate(path);
  }

  async waitForAuthenticated(timeout = 20_000): Promise<void> {
    await this.accountMenuButton.waitFor({ state: 'visible', timeout });
  }

  async expectAuthenticated(): Promise<void> {
    await this.waitForAuthenticated();
    await expect(this.main).toBeVisible({ timeout: 20_000 });
    await expect(this.page).not.toHaveURL(/\/login(?:\?.*)?$/);
  }

  async expectLoggedOut(): Promise<void> {
    await expect(this.page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(this.accountMenuButton).toHaveCount(0);
  }

  async expectNoAccountMenu(): Promise<void> {
    await expect(this.accountMenuButton).toHaveCount(0);
  }

  /** Non-throwing check used by the retry helpers. */
  async isAuthenticated(timeout = 2_000): Promise<boolean> {
    if (this.currentPath() === '/login') {
      return false;
    }

    try {
      await this.waitForAuthenticated(timeout);
      return true;
    } catch {
      return false;
    }
  }

  async openAccountMenu(): Promise<void> {
    await this.accountMenuButton.click();
  }

  async logOut(): Promise<void> {
    await this.logOutMenuItem.first().click();
  }

  async waitForLoginUrl(): Promise<void> {
    await this.page.waitForURL((url) => url.pathname === '/login', {
      timeout: 20_000,
    });
  }

  /** Logs out through the account menu and waits for the login page. */
  async logout(): Promise<void> {
    await this.openAccountMenu();
    await this.logOut();

    try {
      await this.waitForLoginUrl();
    } catch (cause) {
      // Logging out clears the auth cookie and navigates to /login. If that
      // navigation hits a transient DNS/network error, verify the cleared
      // session with an explicit navigation instead of failing on the redirect.
      await gotoWithRetry(this.page, '/login');

      if (this.currentPath() !== '/login') {
        throw cause;
      }
    }
  }
}
