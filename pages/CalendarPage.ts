import { expect, type Locator, type Page } from '@playwright/test';
import { AppShellPage, type ShellPageOptions } from './AppShellPage';

export type CalendarView = 'Month' | 'Week';

export const CALENDAR_LAYERS = [
  'Tasks',
  'Milestones',
  'Shifts',
  'Leave',
  'Holidays',
] as const;

export const CALENDAR_FILTERS = [
  'Department',
  'Project',
  'Employee',
] as const;

export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];
export type CalendarFilter = (typeof CALENDAR_FILTERS)[number];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calendar module (Module 3). Read-only coverage for month/week navigation,
 * layer toggles, filters and the empty-month grid. Events do not currently
 * exist, so event drill-down and timezone placement are deferred.
 */
export class CalendarPage extends AppShellPage {
  readonly heading: Locator;
  readonly description: Locator;
  readonly periodHeading: Locator;
  readonly grid: Locator;
  readonly monthRadio: Locator;
  readonly weekRadio: Locator;
  readonly previousButton: Locator;
  readonly todayButton: Locator;
  readonly nextButton: Locator;
  readonly filterDialog: Locator;
  readonly clearFiltersButton: Locator;
  readonly emptyMessage: Locator;

  constructor(page: Page, options: ShellPageOptions = {}) {
    super(page, options);
    this.heading = this.main.getByRole('heading', {
      name: 'Calendar',
      level: 1,
      exact: true,
    });
    this.description = this.main
      .getByText(
        /Deadlines, shifts, leave and holidays across every project you can see\./,
      )
      .first();
    this.periodHeading = this.main
      .getByRole('heading', { level: 2 })
      .first();
    this.grid = this.main.getByRole('grid');
    this.monthRadio = this.main.getByRole('radio', {
      name: 'Month',
      exact: true,
    });
    this.weekRadio = this.main.getByRole('radio', {
      name: 'Week',
      exact: true,
    });
    this.previousButton = this.main.getByRole('button', {
      name: /^Previous (month|week)$/,
    });
    this.todayButton = this.main.getByRole('button', {
      name: 'Today',
      exact: true,
    });
    this.nextButton = this.main.getByRole('button', {
      name: /^Next (month|week)$/,
    });
    this.filterDialog = page.getByRole('dialog').last();
    this.clearFiltersButton = this.main
      .getByRole('button', { name: /^Clear filters \(\d+\)$/ })
      .first();
    this.emptyMessage = this.main.getByText('Nothing scheduled.', {
      exact: true,
    });
  }

  async goto(): Promise<void> {
    await this.gotoAuthenticated(this.workspaceHref('/calendar'));
    await this.heading.waitFor({ state: 'visible', timeout: 30_000 });
    await this.periodHeading.waitFor({ state: 'visible', timeout: 30_000 });
    await this.grid.waitFor({ state: 'visible', timeout: 30_000 });
    await this.waitForSkeletonsToClear();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.description).toBeVisible();
    await expect(this.periodHeading).toBeVisible();
    await expect(this.periodHeading).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
    await expect(this.grid).toBeVisible();

    await expect(this.previousButton).toBeVisible();
    await expect(this.todayButton).toBeVisible();
    await expect(this.todayButton).toBeDisabled();
    await expect(this.nextButton).toBeVisible();

    await expect(this.monthRadio).toBeChecked();
    await expect(this.weekRadio).not.toBeChecked();
    await expect(this.main.getByText('Show', { exact: true })).toBeVisible();

    for (const layer of CALENDAR_LAYERS) {
      await expect(this.layerButton(layer)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }

    for (const filter of CALENDAR_FILTERS) {
      await expect(this.filterButton(filter)).toBeVisible();
    }

    await this.expectMonthGrid();
    await this.expectNoBrokenValues();
  }

  async periodLabel(): Promise<string> {
    return ((await this.periodHeading.textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async expectView(view: CalendarView): Promise<void> {
    await expect(this.viewRadio(view)).toBeChecked();
  }

  async selectView(view: CalendarView): Promise<void> {
    await this.viewRadio(view).click();
    await expect(this.viewRadio(view)).toBeChecked();
    await this.waitForGrid();
    await this.waitForSkeletonsToClear();
  }

  async previousPeriod(): Promise<void> {
    await this.previousButton.click();
    await this.waitForGrid();
  }

  async nextPeriod(): Promise<void> {
    await this.nextButton.click();
    await this.waitForGrid();
  }

  async goToToday(): Promise<void> {
    await this.todayButton.click();
    await this.waitForGrid();
  }

  async expectMonthGrid(): Promise<void> {
    await expect(this.grid).toHaveAttribute(
      'aria-label',
      new RegExp(`^${escapeRegExp(await this.periodLabel())}$`),
    );

    const cells = this.grid.getByRole('gridcell');
    const headers = this.grid.getByRole('columnheader');

    await expect(headers).toHaveCount(7);
    await expect(headers).toHaveText([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);

    const cellCount = await cells.count();

    expect(cellCount, 'Month grid cell count').toBeGreaterThanOrEqual(28);
    expect(cellCount, 'Month grid cell count').toBeLessThanOrEqual(42);
    expect(cellCount % 7, 'Month grid rows').toBe(0);
  }

  async expectWeekGrid(): Promise<void> {
    await expect(this.grid).toHaveAttribute('aria-label', /^Week of /);

    const cells = this.grid.getByRole('gridcell');
    const headers = this.grid.getByRole('columnheader');

    await expect(headers).toHaveCount(7);
    await expect(cells).toHaveCount(7);
  }

  async gridCellLabels(): Promise<string[]> {
    return this.grid
      .getByRole('gridcell')
      .evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute('aria-label') ?? ''),
      );
  }

  async expectEmptyMonth(): Promise<void> {
    await expect(this.emptyMessage).toBeVisible();

    const labels = await this.gridCellLabels();

    expect(labels.length).toBeGreaterThanOrEqual(28);
    expect(
      labels.every((label) => /nothing scheduled/i.test(label)),
      'Every month cell should report no scheduled events',
    ).toBe(true);
  }

  layerButton(layer: CalendarLayer): Locator {
    return this.main.getByRole('button', { name: layer, exact: true });
  }

  async expectLayerPressed(
    layer: CalendarLayer,
    pressed: boolean,
  ): Promise<void> {
    await expect(this.layerButton(layer)).toHaveAttribute(
      'aria-pressed',
      String(pressed),
    );
  }

  async toggleLayer(layer: CalendarLayer): Promise<void> {
    await this.layerButton(layer).click();
    await this.waitForSkeletonsToClear();
  }

  filterButton(label: CalendarFilter): Locator {
    return this.main
      .getByRole('button', { name: new RegExp(`^${label}(?: \\d+)?$`) })
      .first();
  }

  async filterCount(label: CalendarFilter): Promise<number> {
    const text = ((await this.filterButton(label).textContent()) ?? '').replace(
      /\s+/g,
      '',
    );
    const match = text.match(/(\d+)$/);

    return match ? Number(match[1]) : 0;
  }

  async expectFilterCount(
    label: CalendarFilter,
    count: number,
  ): Promise<void> {
    await expect
      .poll(() => this.filterCount(label), {
        message: `Expected calendar filter "${label}" to show ${count} active value(s)`,
      })
      .toBe(count);
  }

  async activeFilterCount(): Promise<number> {
    if ((await this.clearFiltersButton.count()) === 0) {
      return 0;
    }

    const text = (await this.clearFiltersButton.textContent()) ?? '';
    const match = text.match(/\((\d+)\)/);

    return match ? Number(match[1]) : 0;
  }

  async expectActiveFilterCount(count: number): Promise<void> {
    await expect.poll(() => this.activeFilterCount()).toBe(count);
  }

  async openFilter(label: CalendarFilter): Promise<void> {
    await this.filterButton(label).click();
    await expect(this.filterDialog).toBeVisible();
  }

  async closeFilter(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.filterDialog).toBeHidden();
  }

  /**
   * Applies the first available option. The underlying filters are shared
   * workspace data, so tests do not hard-code member or project names.
   */
  async selectFirstFilterOption(label: CalendarFilter): Promise<void> {
    await this.openFilter(label);

    const option = this.filterDialog.getByRole('option').first();

    await expect(option).toBeVisible();
    await option.click();
    await this.expectFilterCount(label, 1);
    await this.closeFilter();
    await this.waitForSkeletonsToClear();
  }

  async clearFilters(): Promise<void> {
    if ((await this.clearFiltersButton.count()) === 0) {
      return;
    }

    await this.clearFiltersButton.click();
    await this.expectActiveFilterCount(0);
    await this.waitForSkeletonsToClear();
  }

  /** Verifies each filter popover exposes options and the expected search box. */
  async expectFilterOptionSets(): Promise<void> {
    await this.expectFilterOptions('Department', { minimum: 1 });
    await this.expectFilterOptions('Project', {
      minimum: 1,
      searchPlaceholder: 'Search project…',
    });
    await this.expectFilterOptions('Employee', {
      minimum: 2,
      searchPlaceholder: 'Search employee…',
    });
  }

  async expectNoBrokenValues(): Promise<void> {
    await expect(this.main).not.toContainText(/NaN|undefined|Invalid Date/);
  }

  private viewRadio(view: CalendarView): Locator {
    return view === 'Month' ? this.monthRadio : this.weekRadio;
  }

  private async waitForGrid(): Promise<void> {
    await this.grid.waitFor({ state: 'visible', timeout: 30_000 });
    await this.grid
      .getByRole('gridcell')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  private async expectFilterOptions(
    label: CalendarFilter,
    options: { minimum: number; searchPlaceholder?: string },
  ): Promise<void> {
    await this.openFilter(label);

    const choices = this.filterDialog.getByRole('option');

    await expect(
      choices.first(),
      `Filter "${label}" should expose options`,
    ).toBeVisible();
    expect(await choices.count()).toBeGreaterThanOrEqual(options.minimum);

    if (options.searchPlaceholder) {
      const search = this.filterDialog.getByRole('combobox');

      await expect(search).toBeVisible();
      await expect(search).toHaveAttribute(
        'placeholder',
        options.searchPlaceholder,
      );
    }

    await this.closeFilter();
  }
}
