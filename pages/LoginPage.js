'use strict';

const { expect } = require('@playwright/test');

class LoginPage {
  constructor(page) {
    this.page = page;
    this.heading = page.getByRole('heading', {
      name: 'Welcome back',
      level: 1,
    });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.rememberMeCheckbox = page.getByRole('checkbox', {
      name: /remember me/i,
    });
    this.passwordToggle = page.getByRole('button', {
      name: /show password|hide password/i,
    });
    this.submitButton = page.getByRole('button', {
      name: 'Log in',
      exact: true,
    });
    this.forgotPasswordLink = page.getByRole('link', {
      name: 'Forgot your password?',
    });
    this.signupLink = page.getByRole('link', { name: 'Register now' });
    this.alerts = page.locator('[role="alert"]');
  }

  async goto(options = {}) {
    const { waitForHydration = false } = options;
    await this.page.goto('/login', { waitUntil: 'domcontentloaded' });
    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });

    if (waitForHydration) {
      await this.waitForHydration();
    }
  }

  /**
   * A native form submission before React hydrates performs a GET and leaks the
   * password into the URL (QA-012). Wait for React's onSubmit handler to be
   * attached before filling or clicking the form.
   */
  async waitForHydration() {
    await this.page.waitForFunction(
      () => {
        const form = document.querySelector('form');
        if (!form) {
          return false;
        }

        const propsKey = Object.keys(form).find(
          (key) =>
            key.startsWith('__reactProps$') ||
            key.startsWith('__reactEventHandlers$'),
        );

        return !!propsKey && typeof form[propsKey]?.onSubmit === 'function';
      },
      undefined,
      { timeout: 20_000 },
    );
  }

  async fillEmail(email) {
    await this.emailInput.fill(email);
  }

  async fillPassword(password) {
    await this.passwordInput.fill(password);
  }

  async fillCredentials(credentials) {
    await this.fillEmail(credentials.email);
    await this.fillPassword(credentials.password);
  }

  async submit() {
    await this.submitButton.click();
  }

  async togglePasswordVisibility() {
    await this.passwordToggle.click();
  }

  async getPasswordType() {
    return this.page.locator('input[name="password"]').getAttribute('type');
  }

  errorAlert(text) {
    return this.alerts.filter({ hasText: text }).first();
  }

  async expectRendered() {
    await expect(this.heading).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
    await expect(this.rememberMeCheckbox).toBeVisible();
    await expect(this.submitButton).toBeVisible();
    await expect(this.passwordToggle).toHaveAttribute(
      'aria-label',
      'Show password',
    );
    await expect(this.forgotPasswordLink).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await expect(this.signupLink).toHaveAttribute('href', '/signup');
  }

  async expectNoCredentialQuery() {
    await expect(this.page).not.toHaveURL(/[?&](email|password)=/i);
  }
}

module.exports = { LoginPage };
