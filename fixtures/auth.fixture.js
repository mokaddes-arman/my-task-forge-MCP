'use strict';

const base = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');
const { WorkspacePage } = require('../pages/WorkspacePage');
const { ownerCredentials, STORAGE_STATE } = require('../tests/helpers/env');

const test = base.test.extend({
  credentials: async ({}, use) => {
    await use(ownerCredentials());
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  workspacePage: async ({ page }, use) => {
    await use(new WorkspacePage(page));
  },
  authStoragePath: async ({}, use) => {
    await use(STORAGE_STATE);
  },
});

module.exports = { test, expect: base.expect };
