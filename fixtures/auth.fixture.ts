import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import {
  ownerCredentials,
  STORAGE_STATE,
  type Credentials,
} from '../utils/env';

interface AuthFixtures {
  credentials: Credentials;
  loginPage: LoginPage;
  workspacePage: WorkspacePage;
  authStoragePath: string;
}

export const test = base.extend<AuthFixtures>({
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

export { expect };
