'use strict';

const { expect } = require('@playwright/test');

class WorkspacePage {
  constructor(page) {
    this.page = page;
    this.accountMenuButton = page.getByRole('button', {
      name: 'Account menu',
    });
    this.main = page.getByRole('main');
    this.logOutMenuItem = page
      .getByRole('menuitem', { name: /log out/i })
      .or(page.getByRole('button', { name: /log out/i }))
      .or(page.getByText('Log out', { exact: true }));
  }

  async expectAuthenticated() {
    await expect(this.accountMenuButton).toBeVisible({ timeout: 20_000 });
    await expect(this.main).toBeVisible({ timeout: 20_000 });
    await expect(this.page).not.toHaveURL(/\/login(?:\?.*)?$/);
  }

  async expectLoggedOut() {
    await expect(this.page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(this.accountMenuButton).toHaveCount(0);
  }

  async openAccountMenu() {
    await this.accountMenuButton.click();
  }

  async logOut() {
    await this.logOutMenuItem.first().click();
  }

  async waitForLoginUrl() {
    await this.page.waitForURL((url) => url.pathname === '/login', {
      timeout: 20_000,
    });
  }
}

module.exports = { WorkspacePage };
