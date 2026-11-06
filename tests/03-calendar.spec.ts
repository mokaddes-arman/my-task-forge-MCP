import { test, expect } from '../fixtures/pages.fixture';
import {
  CALENDAR_FILTERS,
  CALENDAR_LAYERS,
} from '../pages/CalendarPage';

/**
 * Module 3 — Calendar.
 *
 * Read-only coverage: month/week views, period navigation, Today state, layer
 * toggles, filter combinations and the empty-month grid. Event drill-down and
 * timezone placement await scheduled data.
 *
 * Run: npm run test:modules:chrome -- tests/03-calendar.spec.ts
 */
test.describe('Calendar (Module 3)', () => {
  test('loads the month view with navigation, layers and filters', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();

    await calendarPage.expectTitle(/Calendar .+ TaskForge/i);
    await calendarPage.expectPath(calendarPage.workspaceHref('/calendar'));
    await calendarPage.expectLoaded();
  });

  test('moves between months and returns to the current month', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();

    const currentMonth = await calendarPage.periodLabel();
    const path = calendarPage.workspaceHref('/calendar');

    await expect(calendarPage.todayButton).toBeDisabled();

    await calendarPage.nextPeriod();
    await expect(calendarPage.periodHeading).not.toHaveText(currentMonth);
    await expect(calendarPage.todayButton).toBeEnabled();

    await calendarPage.previousPeriod();
    await expect(calendarPage.periodHeading).toHaveText(currentMonth);
    await expect(calendarPage.todayButton).toBeDisabled();

    await calendarPage.previousPeriod();
    await expect(calendarPage.periodHeading).not.toHaveText(currentMonth);
    await expect(calendarPage.todayButton).toBeEnabled();

    await calendarPage.goToToday();
    await expect(calendarPage.periodHeading).toHaveText(currentMonth);
    await expect(calendarPage.todayButton).toBeDisabled();

    await calendarPage.expectMonthGrid();
    await calendarPage.expectPath(path);
  });

  test('switches to a seven-day week view and navigates weeks', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();

    const currentMonth = await calendarPage.periodLabel();

    await calendarPage.selectView('Week');
    await calendarPage.expectView('Week');
    await expect(calendarPage.periodHeading).toHaveText(/ – /);
    await calendarPage.expectWeekGrid();

    const currentWeek = await calendarPage.periodLabel();

    await expect(calendarPage.todayButton).toBeDisabled();

    await calendarPage.previousPeriod();
    await expect(calendarPage.periodHeading).not.toHaveText(currentWeek);
    await expect(calendarPage.todayButton).toBeEnabled();
    await expect(calendarPage.grid).toHaveAttribute('aria-label', /^Week of /);

    await calendarPage.nextPeriod();
    await expect(calendarPage.periodHeading).toHaveText(currentWeek);
    await expect(calendarPage.todayButton).toBeDisabled();

    await calendarPage.previousPeriod();
    await calendarPage.goToToday();
    await expect(calendarPage.periodHeading).toHaveText(currentWeek);
    await expect(calendarPage.todayButton).toBeDisabled();
    await calendarPage.expectWeekGrid();

    await calendarPage.selectView('Month');
    await calendarPage.expectView('Month');
    await expect(calendarPage.periodHeading).toHaveText(currentMonth);
    await calendarPage.expectMonthGrid();
    await calendarPage.expectPath(calendarPage.workspaceHref('/calendar'));
  });

  test('toggles each event layer independently', async ({ calendarPage }) => {
    await calendarPage.goto();

    for (const layer of CALENDAR_LAYERS) {
      await calendarPage.expectLayerPressed(layer, true);
      await calendarPage.toggleLayer(layer);
      await calendarPage.expectLayerPressed(layer, false);

      for (const other of CALENDAR_LAYERS.filter((item) => item !== layer)) {
        await calendarPage.expectLayerPressed(other, true);
      }

      await calendarPage.toggleLayer(layer);
      await calendarPage.expectLayerPressed(layer, true);
    }

    await calendarPage.expectPath(calendarPage.workspaceHref('/calendar'));
  });

  test('applies Department, Project and Employee filters, then clears them', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();

    for (let index = 0; index < CALENDAR_FILTERS.length; index += 1) {
      const filter = CALENDAR_FILTERS[index];

      await calendarPage.selectFirstFilterOption(filter);
      await calendarPage.expectFilterCount(filter, 1);
      await calendarPage.expectActiveFilterCount(index + 1);
    }

    await expect(calendarPage.clearFiltersButton).toBeVisible();

    await calendarPage.clearFilters();

    for (const filter of CALENDAR_FILTERS) {
      await calendarPage.expectFilterCount(filter, 0);
    }

    await calendarPage.expectActiveFilterCount(0);
    await expect(calendarPage.clearFiltersButton).toBeHidden();
  });

  test('filter popovers expose options and search inputs', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();
    await calendarPage.expectFilterOptionSets();
  });

  test('shows the empty-month copy over an intact grid', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();

    test.skip(
      !(await calendarPage.emptyMessage.isVisible()),
      'The calendar now has scheduled events; the empty-month check is not applicable.',
    );

    await calendarPage.expectEmptyMonth();
    await calendarPage.expectMonthGrid();
    await calendarPage.expectNoBrokenValues();
  });
});
