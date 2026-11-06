import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../utils/env';
import { AppShellPage, type ShellPageOptions } from './AppShellPage';

export type TaskTabKey = 'my' | 'team' | 'overdue' | 'upcoming' | 'completed';

export interface TaskTabDefinition {
  label: string;
  query: string;
  emptyMessage: string;
}

/** Tabs on the Tasks module, with their URL query and zero-task copy. */
export const TASK_TABS: Readonly<Record<TaskTabKey, TaskTabDefinition>> = {
  my: {
    label: 'My Tasks',
    query: '',
    emptyMessage: 'Nothing assigned to you is open. Enjoy the quiet.',
  },
  team: {
    label: 'Team Tasks',
    query: '?tab=team',
    emptyMessage: 'Your departments have no open tasks.',
  },
  overdue: {
    label: 'Overdue',
    query: '?tab=overdue',
    emptyMessage: 'Nothing is overdue.',
  },
  upcoming: {
    label: 'Upcoming',
    query: '?tab=upcoming',
    emptyMessage: 'Nothing is due in the next 7 days.',
  },
  completed: {
    label: 'Completed',
    query: '?tab=completed',
    emptyMessage: 'Nothing was completed in the last 30 days.',
  },
} as const;

export const TASK_TAB_KEYS: readonly TaskTabKey[] = [
  'my',
  'team',
  'overdue',
  'upcoming',
  'completed',
] as const;

export const TASK_FILTERS = [
  'Employee',
  'Department',
  'Project',
  'Status',
  'Priority',
  'Due',
  'Date range',
] as const;

/**
 * Tasks module (Module 2). Read-only coverage for tabs, counts, empty states,
 * search and the filter popovers. Task creation/editing is intentionally not
 * exercised because it mutates shared workspace data.
 */
export class TasksPage extends AppShellPage {
  readonly heading: Locator;
  readonly description: Locator;
  readonly tabList: Locator;
  readonly searchInput: Locator;
  readonly clearSearchButton: Locator;
  readonly filterDialog: Locator;
  readonly noMatchMessage: Locator;
  readonly clearFiltersCountButton: Locator;
  readonly clearFiltersEmptyButton: Locator;
  readonly dateFromInput: Locator;
  readonly dateUntilInput: Locator;

  constructor(page: Page, options: ShellPageOptions = {}) {
    super(page, options);
    this.heading = this.main.getByRole('heading', {
      name: 'Tasks',
      level: 1,
      exact: true,
    });
    this.description = this.main
      .getByText(
        /Everything on your plate and your team.s, across every active project\./,
      )
      .first();
    this.tabList = page.getByRole('tablist');
    this.searchInput = this.main.getByRole('textbox', {
      name: 'Search tasks',
    });
    this.clearSearchButton = this.main.getByRole('button', {
      name: 'Clear search',
      exact: true,
    });
    this.filterDialog = page.getByRole('dialog').last();
    this.noMatchMessage = this.main.getByText('No tasks match your filters', {
      exact: true,
    });
    this.clearFiltersCountButton = this.main
      .getByRole('button', { name: /^Clear filters \(\d+\)$/ })
      .first();
    this.clearFiltersEmptyButton = this.main.getByRole('button', {
      name: 'Clear filters',
      exact: true,
    });
    this.dateFromInput = this.filterDialog.getByRole('textbox', {
      name: 'Due from',
    });
    this.dateUntilInput = this.filterDialog.getByRole('textbox', {
      name: 'Due until',
    });
  }

  async goto(): Promise<void> {
    await this.gotoAuthenticated(this.workspaceHref('/tasks'));
    await this.heading.waitFor({ state: 'visible', timeout: 30_000 });
    await this.tabList.waitFor({ state: 'visible', timeout: 30_000 });
    await this.waitForTaskCounts();
    await this.waitForSkeletonsToClear();
  }

  tab(key: TaskTabKey): Locator {
    const { label } = TASK_TABS[key];

    return this.tabList.getByRole('tab', { name: new RegExp(`^${label}`) });
  }

  emptyState(key: TaskTabKey): Locator {
    return this.main.getByText(TASK_TABS[key].emptyMessage, { exact: true });
  }

  filterButton(label: string): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return this.main
      .getByRole('button', {
        name: new RegExp(`^${escaped}(?:\\s+\\d+)?$`),
      })
      .first();
  }

  /** Badge count for a tab, or -1 while the badge is not numeric. */
  async tabCount(key: TaskTabKey): Promise<number> {
    const badge = this.tab(key).locator('span').last();
    const text = ((await badge.textContent()) ?? '').trim();
    const match = text.match(/^(\d+)/);

    return match ? Number(match[1]) : -1;
  }

  async tabCounts(): Promise<number[]> {
    const counts: number[] = [];

    for (const key of TASK_TAB_KEYS) {
      counts.push(await this.tabCount(key));
    }

    return counts;
  }

  async waitForTaskCounts(timeout = 30_000): Promise<void> {
    await expect
      .poll(async () => (await this.tabCounts()).every((count) => count >= 0), {
        timeout,
        message: 'Expected every task tab to render a numeric count',
      })
      .toBe(true);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.description).toBeVisible();
    await expect(this.tabList).toBeVisible();
    await this.waitForTaskCounts();

    for (const key of TASK_TAB_KEYS) {
      await expect(this.tab(key)).toBeVisible();
    }

    await expect(this.searchInput).toBeVisible();

    for (const filter of TASK_FILTERS) {
      await expect(this.filterButton(filter)).toBeVisible();
    }

    await this.expectActiveTab('my');
    await this.expectNoBrokenValues();
  }

  async selectTab(key: TaskTabKey): Promise<void> {
    const tab = this.tab(key);

    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() => new URL(this.page.url()).search, {
        message: `Expected tab "${TASK_TABS[key].label}" to sync its URL`,
      })
      .toBe(TASK_TABS[key].query);
    await this.waitForSkeletonsToClear();
  }

  async expectActiveTab(key: TaskTabKey): Promise<void> {
    await expect(this.tab(key)).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() => new URL(this.page.url()).search)
      .toBe(TASK_TABS[key].query);
  }

  async expectEmptyState(key: TaskTabKey): Promise<void> {
    await expect(this.emptyState(key)).toBeVisible();
  }

  async searchFor(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await expect(this.searchInput).toHaveValue(term);
    await expect(this.clearSearchButton).toBeVisible();
    await this.waitForSkeletonsToClear();
  }

  async clearSearch(): Promise<void> {
    await this.clearSearchButton.click();
    await expect(this.searchInput).toHaveValue('');
    await expect(this.clearSearchButton).toBeHidden();
    await this.waitForSkeletonsToClear();
  }

  async expectNoMatchState(): Promise<void> {
    await expect(this.noMatchMessage).toBeVisible();
    await expect(this.clearFiltersEmptyButton).toBeVisible();
    await expect(this.clearFiltersCountButton).toBeVisible();
  }

  async activeFilterCount(): Promise<number> {
    if ((await this.clearFiltersCountButton.count()) === 0) {
      return 0;
    }

    const text = (await this.clearFiltersCountButton.textContent()) ?? '';
    const match = text.match(/\((\d+)\)/);

    return match ? Number(match[1]) : 0;
  }

  async expectActiveFilterCount(count: number): Promise<void> {
    await expect
      .poll(() => this.activeFilterCount())
      .toBe(count);
  }

  async filterCount(label: string): Promise<number> {
    const text = ((await this.filterButton(label).textContent()) ?? '').replace(
      /\s+/g,
      '',
    );
    const match = text.match(/(\d+)$/);

    return match ? Number(match[1]) : 0;
  }

  async expectFilterCount(label: string, count: number): Promise<void> {
    await expect
      .poll(() => this.filterCount(label), {
        message: `Expected filter "${label}" to show ${count} active value(s)`,
      })
      .toBe(count);
  }

  async openFilter(label: string): Promise<void> {
    await this.filterButton(label).click();
    await expect(this.filterDialog).toBeVisible();
  }

  async closeFilter(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.filterDialog).toBeHidden();
  }

  async selectFilterOption(
    label: string,
    option: string | RegExp,
  ): Promise<void> {
    await this.openFilter(label);

    const target = this.filterDialog.getByRole('option', { name: option });

    await expect(target).toBeVisible();
    await target.click();
    await this.closeFilter();
    await this.waitForSkeletonsToClear();
  }

  async clearFilters(): Promise<void> {
    if ((await this.clearFiltersCountButton.count()) === 0) {
      return;
    }

    await this.clearFiltersCountButton.click();
    await expect
      .poll(() => this.activeFilterCount())
      .toBe(0);
    await this.waitForSkeletonsToClear();
  }

  /**
   * Opens each filter popover and verifies the expected option set without
   * selecting anything.
   */
  async expectFilterOptionSets(): Promise<void> {
    await this.expectFilterOptions('Employee', {
      includes: ['Unassigned'],
      minimum: 2,
    });
    await this.expectFilterOptions('Department', { minimum: 1 });
    await this.expectFilterOptions('Project', { minimum: 1 });
    await this.expectFilterOptions('Status', {
      includes: ['To Do', 'In Progress', 'Done'],
      minimum: 3,
    });
    await this.expectFilterOptions('Priority', {
      includes: ['Urgent', 'High', 'Medium', 'Low', 'None'],
      minimum: 5,
    });
    await this.expectFilterOptions('Due', {
      includes: [
        'Overdue',
        'Today',
        'This week',
        'Next 7 days',
        'No due date',
      ],
      minimum: 5,
    });
  }

  async expectDateRangeFilter(): Promise<void> {
    await this.openFilter('Date range');
    await expect(this.dateFromInput).toBeVisible();
    await expect(this.dateUntilInput).toBeVisible();
    await this.closeFilter();
  }

  async expectNoBrokenValues(): Promise<void> {
    await expect(this.main).not.toContainText(/NaN|undefined|Invalid Date/);
  }

  private async expectFilterOptions(
    label: string,
    options: { includes?: string[]; minimum?: number } = {},
  ): Promise<void> {
    await this.openFilter(label);

    const choices = this.filterDialog.getByRole('option');

    await expect(
      choices.first(),
      `Filter "${label}" should expose options`,
    ).toBeVisible();
    expect(await choices.count()).toBeGreaterThanOrEqual(options.minimum ?? 1);

    for (const text of options.includes ?? []) {
      await expect(
        choices.filter({ hasText: text }).first(),
        `Filter "${label}" option "${text}"`,
      ).toBeVisible();
    }

    await this.closeFilter();
  }
}
