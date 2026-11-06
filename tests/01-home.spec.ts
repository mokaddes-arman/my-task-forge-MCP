import { test, expect } from '../fixtures/pages.fixture';
import { SETUP_LINKS } from '../pages/HomePage';

/**
 * Module 1 — Home dashboard.
 *
 * Read-only coverage: page load, KPI rendering, setup/quick-access links,
 * My day widgets, loading-skeleton replacement and global shell navigation.
 * No records are created, updated or deleted.
 *
 * Run: npm run test:modules:chrome -- tests/01-home.spec.ts
 */
test.describe('Home dashboard (Module 1)', () => {
  test('loads the owner dashboard with greeting and overview regions', async ({
    homePage,
  }) => {
    await homePage.goto();

    await homePage.expectTitle(/Home .+ TaskForge/i);
    await homePage.expectPath(homePage.workspaceHref(''));
    await homePage.expectLoaded();
    await expect(homePage.newTaskButton).toBeVisible();
    await expect(homePage.myTasksLink).toHaveAttribute(
      'href',
      homePage.workspaceHref('/tasks'),
    );
  });

  test('renders every KPI card with a populated, well-formed value', async ({
    homePage,
  }) => {
    await homePage.goto();
    await homePage.expectKpis();

    // Overview widgets should be present alongside the KPI cards.
    await homePage.expectDashboardSections();
  });

  test('New task dialog opens with a project selector and closes cleanly', async ({
    homePage,
  }) => {
    await homePage.goto();
    await homePage.expectNewTaskDialogCanOpenAndClose();
  });

  test('setup checklist exposes the expected link targets', async ({
    homePage,
  }) => {
    await homePage.goto();
    await homePage.expectSetupChecklist();
  });

  // Each step runs in its own authenticated context. A single long test that
  // navigates back and forth could lose the session on slower engines.
  for (const [label, segment] of Object.entries(SETUP_LINKS)) {
    test(`setup checklist step "${label}" opens ${segment}`, async ({
      homePage,
    }) => {
      await homePage.goto();

      test.skip(
        !(await homePage.isSetupLinkVisible(label)),
        `Setup step "${label}" is already complete in this workspace`,
      );

      await homePage.expectSetupLinkTarget(label, segment);
      const retried = await homePage.openSetupLink(label, segment);

      if (retried) {
        test.info().annotations.push({
          type: 'qa-finding',
          description:
            'QA-003 reference: the stored session was transiently redirected to /login during module navigation and succeeded after one retry.',
        });
      }
    });
  }

  test('quick access shortcuts point at the expected modules', async ({
    homePage,
  }) => {
    await homePage.goto();
    await homePage.expectQuickAccessLinks();
  });

  test('My day shows schedule, clock, leave and task shortcuts', async ({
    homePage,
  }) => {
    await homePage.goto();
    await homePage.expectMyDay();
    await homePage.expectNoBrokenValues();
  });

  test('QA-007: loading skeletons are replaced by stable dashboard content', async ({
    homePage,
  }) => {
    const elapsedMs = await homePage.open();

    await homePage.expectLoaded();
    await homePage.expectKpis();
    await homePage.waitForSkeletonsToClear();

    test.info().annotations.push({
      type: 'timing',
      description: `Dashboard reached stable content in ${elapsedMs}ms.`,
    });

    if (elapsedMs > 3_000) {
      test.info().annotations.push({
        type: 'qa-finding',
        description:
          'QA-007 reference: dashboard content took longer than 3s to replace loading skeletons.',
      });
    }

    expect(
      elapsedMs,
      'QA-007: dashboard should replace loading skeletons within 15s',
    ).toBeLessThan(15_000);
  });

  test('global shell exposes all navigation and reports realtime status', async ({
    homePage,
  }) => {
    await homePage.goto();

    await homePage.expectSidebarNavigation();
    await expect(homePage.searchButton).toBeVisible();
    await expect(homePage.createButton).toBeVisible();
    await expect(homePage.notificationsButton).toBeVisible();
    await expect(homePage.accountMenuButton).toBeVisible();
    await expect(homePage.headerClockInLink).toHaveAttribute(
      'href',
      homePage.workspaceHref('/time-clock'),
    );

    const realtimeStatus = await homePage.expectRealtimeStatusReported();

    if (/reconnecting/i.test(realtimeStatus)) {
      test.info().annotations.push({
        type: 'qa-finding',
        description:
          'QA-001 reference: realtime transport is disconnected; live-update assertions remain deferred.',
      });
    }
  });
});
