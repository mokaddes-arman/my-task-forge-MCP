import { test, expect } from '../fixtures/pages.fixture';
import { TASK_TAB_KEYS } from '../pages/TasksPage';

/**
 * Module 2 — Tasks.
 *
 * Read-only coverage: module load, tab routing/counts, zero-state copy, search,
 * filter popovers, filter combinations and the date-range control. Creating,
 * editing, completing or deleting tasks is intentionally out of scope because
 * it mutates the shared workspace.
 *
 * Run: npm run test:modules:chrome -- tests/02-tasks.spec.ts
 */
test.describe('Tasks (Module 2)', () => {
  test('loads the task list with tabs, search and filters', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();

    await tasksPage.expectTitle(/Tasks .+ TaskForge/i);
    await tasksPage.expectPath(tasksPage.workspaceHref('/tasks'));
    await tasksPage.expectLoaded();
  });

  test('keeps tab counts, selection, URL and zero-state copy in sync', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();

    for (const key of TASK_TAB_KEYS) {
      await tasksPage.selectTab(key);
      await tasksPage.expectActiveTab(key);

      const count = await tasksPage.tabCount(key);

      expect(count, `Tab "${key}" count`).toBeGreaterThanOrEqual(0);

      if (count === 0) {
        await tasksPage.expectEmptyState(key);
      } else {
        await expect(tasksPage.emptyState(key)).toBeHidden();
      }
    }

    await tasksPage.selectTab('my');
    await tasksPage.expectActiveTab('my');
  });

  test('shows the My Tasks zero state when no tasks are assigned', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();

    const count = await tasksPage.tabCount('my');

    test.skip(
      count > 0,
      'The workspace now has assigned tasks; the zero state is not applicable.',
    );

    await tasksPage.expectEmptyState('my');
    await tasksPage.expectNoBrokenValues();
  });

  test('search shows a no-match state and clearing it restores the list', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();

    await tasksPage.searchFor('zzzz-no-such-task');
    await tasksPage.expectNoMatchState();

    await expect
      .poll(() => tasksPage.activeFilterCount())
      .toBeGreaterThan(0);

    await tasksPage.clearSearch();

    await expect(tasksPage.searchInput).toHaveValue('');
    await expect(tasksPage.clearSearchButton).toBeHidden();
    await expect(tasksPage.noMatchMessage).toBeHidden();
    await expect
      .poll(() => tasksPage.activeFilterCount())
      .toBe(0);
  });

  test('combines Status and Priority filters, then clears them', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();

    await tasksPage.selectFilterOption('Status', /^In Progress$/);
    await tasksPage.expectFilterCount('Status', 1);

    await tasksPage.selectFilterOption('Priority', /^High/);
    await tasksPage.expectFilterCount('Priority', 1);
    await tasksPage.expectActiveFilterCount(2);

    await expect(tasksPage.clearFiltersEmptyButton).toBeVisible();

    await tasksPage.clearFilters();

    await tasksPage.expectFilterCount('Status', 0);
    await tasksPage.expectFilterCount('Priority', 0);
    await tasksPage.expectActiveFilterCount(0);
    await expect(tasksPage.noMatchMessage).toBeHidden();
  });

  test('filter popovers expose the expected option sets', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();
    await tasksPage.expectFilterOptionSets();
  });

  test('date range filter exposes due-from and due-until inputs', async ({
    tasksPage,
  }) => {
    await tasksPage.goto();
    await tasksPage.expectDateRangeFilter();
  });
});
