import { test as authTest } from './auth.fixture';
import { CalendarPage } from '../pages/CalendarPage';
import { HomePage } from '../pages/HomePage';
import { TasksPage } from '../pages/TasksPage';
import { restoreSessionCookies } from '../utils/auth';

interface PageFixtures {
  homePage: HomePage;
  tasksPage: TasksPage;
  calendarPage: CalendarPage;
}

/**
 * Module-spec fixtures. Auth fixtures remain available, and storageState is
 * supplied by the Playwright `modules-*` projects. Page objects receive a
 * session-restore hook so a transient /login redirect can be recovered without
 * repeating UI login.
 */
export const test = authTest.extend<PageFixtures>({
  homePage: async ({ page, context, authStoragePath }, use) => {
    await use(
      new HomePage(page, {
        restoreSession: () => restoreSessionCookies(context, authStoragePath),
      }),
    );
  },
  tasksPage: async ({ page, context, authStoragePath }, use) => {
    await use(
      new TasksPage(page, {
        restoreSession: () => restoreSessionCookies(context, authStoragePath),
      }),
    );
  },
  calendarPage: async ({ page, context, authStoragePath }, use) => {
    await use(
      new CalendarPage(page, {
        restoreSession: () => restoreSessionCookies(context, authStoragePath),
      }),
    );
  },
});

export { expect } from './auth.fixture';
