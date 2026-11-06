import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../utils/env';
import { AppShellPage, type ShellPageOptions } from './AppShellPage';

export interface KpiDefinition {
  label: string;
  valuePattern: RegExp;
}

/** KPI cards observed on the Home dashboard. Values are data-driven. */
export const HOME_KPIS: readonly KpiDefinition[] = [
  { label: 'Employees', valuePattern: /^\d[\d,]*$/ },
  { label: 'Working now', valuePattern: /^\d[\d,]*$/ },
  { label: 'Tasks due', valuePattern: /^\d[\d,]*$/ },
  { label: 'Open projects', valuePattern: /^\d[\d,]*$/ },
  {
    label: 'Hours this week',
    valuePattern: /^(?:\d+h(?: \d+m)?|\d+m)$/,
  },
  { label: 'Est. labor cost', valuePattern: /^\$[\d,]+\.\d{2}$/ },
] as const;

export const SETUP_LINKS: Readonly<Record<string, string>> = {
  'Add employees': '/employees',
  'Add offices': '/settings/locations',
  'Create a project': '/projects',
  'Build the schedule': '/schedule',
} as const;

export const QUICK_ACCESS_LINKS: Readonly<Record<string, string>> = {
  Tasks: '/tasks',
  Schedule: '/schedule',
  'Working now': '/working-now',
  Timesheets: '/timesheets',
  Chat: '/chat',
  'Labor cost': '/reports/labor-cost',
} as const;

/**
 * Home dashboard (Module 1). Encapsulates the greeting, KPI cards, setup
 * checklist, daily summary and My day widgets.
 */
export class HomePage extends AppShellPage {
  readonly greetingHeading: Locator;
  readonly welcomeCopy: Locator;
  readonly businessOverview: Locator;
  readonly businessOverviewHeading: Locator;
  readonly myDay: Locator;
  readonly myDayHeading: Locator;
  readonly newTaskButton: Locator;
  readonly newTaskDialog: Locator;
  readonly newTaskProjectCombobox: Locator;
  readonly closeNewTaskButton: Locator;
  readonly myTasksLink: Locator;
  readonly setupCard: Locator;
  readonly setupLinks: Locator;
  readonly taskStatusHeading: Locator;
  readonly completionImage: Locator;
  readonly needsAttentionHeading: Locator;
  readonly quickAccessLabel: Locator;
  readonly latestAnnouncementsHeading: Locator;
  readonly whosOutHeading: Locator;
  readonly holidaysHeading: Locator;
  readonly headcountHeading: Locator;
  readonly myScheduleLink: Locator;
  readonly clockInLink: Locator;
  readonly requestLeaveLink: Locator;
  readonly allTasksLink: Locator;
  readonly leaveBalanceItems: Locator;

  constructor(page: Page, options: ShellPageOptions = {}) {
    super(page, options);
    this.greetingHeading = this.main
      .getByRole('heading', { level: 1 })
      .first();
    this.welcomeCopy = this.main
      .getByText(/Here.s what.s happening in .* today\.?/i)
      .first();
    this.businessOverview = page.getByRole('region', {
      name: 'Business overview',
      exact: true,
    });
    this.businessOverviewHeading = this.businessOverview.getByRole('heading', {
      name: 'Business overview',
      level: 2,
    });
    this.myDay = page.getByRole('region', { name: 'My day', exact: true });
    this.myDayHeading = this.myDay.getByRole('heading', {
      name: 'My day',
      level: 2,
    });
    this.newTaskButton = this.main.getByRole('button', {
      name: 'New task',
      exact: true,
    });
    this.newTaskDialog = page.getByRole('dialog', { name: 'New task' });
    this.newTaskProjectCombobox = this.newTaskDialog.getByRole('combobox', {
      name: 'Project',
    });
    this.closeNewTaskButton = this.newTaskDialog.getByRole('button', {
      name: 'Close',
    });
    this.myTasksLink = this.main.getByRole('link', {
      name: 'My tasks',
      exact: true,
    });
    this.setupCard = this.main
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText('Get set up', { exact: true }) })
      .first();
    this.setupLinks = this.setupCard.getByRole('link');
    this.taskStatusHeading = this.businessOverview.getByText('Task status', {
      exact: true,
    });
    this.completionImage = this.businessOverview.getByRole('img', {
      name: /% completed/i,
    });
    this.needsAttentionHeading = this.businessOverview.getByText(
      'Needs attention',
      { exact: true },
    );
    this.quickAccessLabel = this.businessOverview.getByText('Quick access', {
      exact: true,
    });
    this.latestAnnouncementsHeading = this.businessOverview.getByText(
      'Latest announcements',
      { exact: true },
    );
    this.whosOutHeading = this.businessOverview
      .getByText(/Who.s out/i)
      .first();
    this.holidaysHeading = this.businessOverview.getByText(
      'Upcoming holidays',
      { exact: true },
    );
    this.headcountHeading = this.businessOverview.getByText(
      'Headcount by department',
      { exact: true },
    );
    this.myScheduleLink = this.myDay.getByRole('link', {
      name: 'My schedule',
      exact: true,
    });
    this.clockInLink = this.myDay.getByRole('link', {
      name: 'Clock in',
      exact: true,
    });
    this.requestLeaveLink = this.myDay.getByRole('link', {
      name: 'Request',
      exact: true,
    });
    this.allTasksLink = this.myDay.getByRole('link', {
      name: 'All tasks',
      exact: true,
    });
    this.leaveBalanceItems = this.myDay
      .getByRole('listitem')
      .filter({ hasText: /Vacation|Sick|Personal|Unpaid leave/i });
  }

  /**
   * Opens the dashboard and waits for data-backed content (not just the
   * greeting). Returns the time to stable content for QA-007 tracking.
   */
  async open(): Promise<number> {
    const startedAt = Date.now();

    await this.gotoAuthenticated(env.workspacePath);
    await this.greetingHeading.waitFor({ state: 'visible', timeout: 30_000 });
    await this.businessOverviewHeading.waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    await this.waitForSkeletonsToClear();

    return Date.now() - startedAt;
  }

  async goto(): Promise<void> {
    await this.open();
  }

  kpiCard(label: string): Locator {
    return this.main
      .locator('[data-slot="card"]')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .first();
  }

  kpiValue(label: string): Locator {
    return this.kpiCard(label).locator('p').first();
  }

  setupLink(label: string): Locator {
    return this.setupCard.getByRole('link', { name: label, exact: true });
  }

  quickAccessLink(label: string): Locator {
    return this.businessOverview.getByRole('link', {
      name: label,
      exact: true,
    });
  }

  async expectLoaded(): Promise<void> {
    await expect(this.greetingHeading).toBeVisible();
    await expect(this.greetingHeading).toHaveText(
      /^Good (?:morning|afternoon|evening), .+!$/i,
    );
    await expect(this.welcomeCopy).toBeVisible();
    await expect(this.businessOverviewHeading).toBeVisible();
    await expect(this.myDayHeading).toBeVisible();
    await expect(this.newTaskButton).toBeVisible();
    await this.expectNoBrokenValues();
  }

  async expectKpis(): Promise<void> {
    for (const kpi of HOME_KPIS) {
      const card = this.kpiCard(kpi.label);

      await expect(card, `${kpi.label} KPI card`).toBeVisible();
      await expect(
        this.kpiValue(kpi.label),
        `${kpi.label} KPI value`,
      ).toHaveText(kpi.valuePattern);
    }
  }

  /**
   * Opens the New task dialog and closes it without creating a task. Covers the
   * safe, non-destructive part of quick task creation (H-05).
   */
  async expectNewTaskDialogCanOpenAndClose(): Promise<void> {
    await this.newTaskButton.click();
    await expect(this.newTaskDialog).toBeVisible();
    await expect(
      this.newTaskDialog.getByRole('heading', {
        name: 'New task',
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      this.newTaskDialog.getByText(
        'Choose a project first, then describe the task.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(this.newTaskProjectCombobox).toBeVisible();

    await this.closeNewTaskButton.click();
    await expect(this.newTaskDialog).toBeHidden();
    await expect(this.newTaskButton).toBeVisible();
  }

  async expectDashboardSections(): Promise<void> {    await expect(this.taskStatusHeading).toBeVisible();
    await expect(this.completionImage).toBeVisible();
    await expect(this.needsAttentionHeading).toBeVisible();
    await expect(this.quickAccessLabel).toBeVisible();
    await expect(this.latestAnnouncementsHeading).toBeVisible();
    await expect(this.whosOutHeading).toBeVisible();
    await expect(this.holidaysHeading).toBeVisible();
    await expect(this.headcountHeading).toBeVisible();
  }

  async expectQuickAccessLinks(): Promise<void> {
    for (const [label, segment] of Object.entries(QUICK_ACCESS_LINKS)) {
      const link = this.quickAccessLink(label);

      await expect(link, `Quick access link "${label}"`).toBeVisible();
      await expect(link).toHaveAttribute('href', this.workspaceHref(segment));
    }
  }

  async setupChecklistItems(): Promise<
    Array<{ label: string; href: string }>
  > {
    const count = await this.setupLinks.count();
    const items: Array<{ label: string; href: string }> = [];

    for (let index = 0; index < count; index += 1) {
      const link = this.setupLinks.nth(index);
      const label = ((await link.textContent()) ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const href = (await link.getAttribute('href')) ?? '';

      if (label && href) {
        items.push({ label, href });
      }
    }

    return items;
  }

  async expectSetupChecklist(): Promise<void> {
    await expect(this.setupCard).toBeVisible();

    const items = await this.setupChecklistItems();

    expect(
      items.length,
      'Setup checklist should expose at least one step',
    ).toBeGreaterThan(0);

    for (const item of items) {
      const segment = SETUP_LINKS[item.label];

      if (segment) {
        expect(item.href, `Setup link "${item.label}" target`).toBe(
          this.workspaceHref(segment),
        );
      }
    }
  }

  async isSetupLinkVisible(label: string): Promise<boolean> {
    return this.setupLink(label).isVisible().catch(() => false);
  }

  async expectSetupLinkTarget(label: string, segment: string): Promise<void> {
    const link = this.setupLink(label);

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', this.workspaceHref(segment));
  }

  /**
   * Clicks a setup step and waits for its route. If navigation stalls or the
   * app transiently redirects to /login (QA-003-class behaviour), restore the
   * saved session, reopen Home and retry. Returns true when a retry was used.
   */
  async openSetupLink(label: string, segment: string): Promise<boolean> {
    const targetPath = this.workspaceHref(segment);
    const attempts = 3;
    let retried = false;

    for (let current = 1; current <= attempts; current += 1) {
      await this.setupLink(label).click();

      try {
        await expect
          .poll(
            () => {
              const path = this.currentPath();
              return path === targetPath || path === '/login';
            },
            { timeout: 10_000, intervals: [250, 500, 1_000] },
          )
          .toBe(true);
      } catch {
        // Treat a stalled navigation like an auth redirect and recover below.
      }

      if (this.currentPath() === targetPath) {
        return retried;
      }

      retried = true;
      await this.restoreSession?.();
      await this.gotoAuthenticated(env.workspacePath);
    }

    await this.expectPath(segment);

    return retried;
  }

  async expectMyDay(): Promise<void> {
    await expect(this.myDayHeading).toBeVisible();
    await expect(
      this.myDay.getByText('Hours this week', { exact: true }),
    ).toBeVisible();

    await expect(this.myScheduleLink).toHaveAttribute(
      'href',
      this.workspaceHref('/schedule?mine=1'),
    );
    await expect(this.clockInLink).toHaveAttribute(
      'href',
      this.workspaceHref('/time-clock'),
    );
    await expect(this.requestLeaveLink).toHaveAttribute(
      'href',
      this.workspaceHref('/leave'),
    );
    await expect(this.allTasksLink).toHaveAttribute(
      'href',
      this.workspaceHref('/tasks'),
    );

    for (const leaveType of ['Vacation', 'Sick', 'Personal', 'Unpaid leave']) {
      await expect(
        this.leaveBalanceItems.filter({ hasText: leaveType }).first(),
        `${leaveType} leave balance`,
      ).toBeVisible();
    }
  }

  async expectNoBrokenValues(): Promise<void> {
    await expect(this.main).not.toContainText(
      /NaN|undefined|Invalid Date/,
    );
  }
}
