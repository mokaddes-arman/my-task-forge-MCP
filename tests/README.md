# TaskForge Playwright Suite

TypeScript (Page Object Model) + Playwright end-to-end tests for `https://mytaskforge.net/`.

## Project structure

```text
pages/        Page objects: all locators and page actions live here
  BasePage.ts
  AppShellPage.ts
  HomePage.ts
  TasksPage.ts
  CalendarPage.ts
  LoginPage.ts
  WorkspacePage.ts
fixtures/     Playwright fixtures that inject page objects and credentials
  auth.fixture.ts
  pages.fixture.ts
utils/        Shared auth, env and navigation helpers
tests/        Specs and the auth setup project
```

Follow the Page Object Model: specs call page-object methods and must not use
`page.locator(...)` or page-specific `getByRole(...)` directly. Add a new method
to the relevant page object instead.

## Prerequisites

- Node.js 20+ on macOS or Windows.
- Google Chrome installed (the `*-chrome` projects use `channel: "chrome"`).
- `.env` at the project root:

```dotenv
BASE_URL = https://mytaskforge.net/
owner_email = <owner sign-in email>
owner_password = "<owner password>"
# optional, defaults to /abdul-s-workspace
WORKSPACE_PATH = /abdul-s-workspace
```

`.env` is gitignored. Never commit credentials or storage state. Quote the
password if it contains `#`; dotenv treats an unquoted `#` as a comment.

## Install
 
```sh
npm install
```

`postinstall` downloads the Playwright Chromium, Firefox and WebKit builds.
The Chrome projects still use your installed Google Chrome.

## Projects

| Project | Files | Auth state | Purpose |
|---|---|---|---|
| `auth-chrome`, `auth-firefox`, `auth-webkit` | `tests/00-auth.spec.ts` | empty | Standalone auth coverage; every test starts logged out |
| `setup` | `tests/auth.setup.ts` | empty | Logs in once and writes `playwright/.auth/user.json` |
| `modules-chrome`, `modules-firefox`, `modules-webkit` | `tests/0[1-9]-*.spec.ts`, `tests/1[0-9]-*.spec.ts` | saved | Module specs reuse the saved session |

Run everything:

```sh
npm test
```

Run only auth (all three browsers):

```sh
npm run test:auth:all
```

Refresh the saved session without running module tests:

```sh
npm run test:setup
```

Type-check:

```sh
npm run typecheck
```

HTML report:

```sh
npm run report
```

## Auth coverage (`tests/00-auth.spec.ts`)

`Login page UI`

1. Renders the form, password toggle, forgot-password and register links.
2. Empty fields show inline validation without calling the sign-in API.
3. An invalid email format is rejected before the sign-in API.
4. Password visibility toggles without losing the value.

`Authentication`

5. Valid owner credentials authenticate and return a JSON API response.
6. Invalid credentials return `401` and do not create a session.
7. Authenticated `storageState` persists into a new browser context.
8. A fresh unauthenticated context is redirected from protected routes.
9. Logout clears the session and protects workspace routes.
10. Clearing session cookies redirects protected routes to login.
11. QA-003 regression guard: repeated fresh-context sign-ins are consistent.

Animations/loading are handled with visibility and response/URL assertions, not
fixed sleeps. The suite is serial (`workers: 1`) because it uses one shared owner
account.

## Module coverage

| # | Module | Spec | Page object |
|---|---|---|---|
| 01 | Home | `tests/01-home.spec.ts` | `pages/HomePage.ts` (extends `AppShellPage`) |
| 02 | Tasks | `tests/02-tasks.spec.ts` | `pages/TasksPage.ts` (extends `AppShellPage`) |
| 03 | Calendar | `tests/03-calendar.spec.ts` | `pages/CalendarPage.ts` (extends `AppShellPage`) |
| 04 | Schedule | planned | planned |
| 05 | Time clock | planned | planned |
| 06 | Timesheets | planned | planned |
| 07 | Leave | planned | planned |
| 08 | Labor cost | planned | planned |
| 09 | Payroll | planned | planned |
| 10 | Working now | planned | planned |
| 11 | Chat | planned | planned |
| 12 | Announcements | planned | planned |
| 13 | Notifications | planned | planned |
| 14 | Projects | planned | planned |
| 15 | Departments | planned | planned |
| 16 | Employees | planned | planned |
| 17 | Settings | planned | planned |

### Module 1 — Home

Read-only checks: dashboard load and greeting, six KPI cards with well-formed
values, setup checklist link targets plus one navigation test per step, quick
access links, My day widgets and leave balances, loading-skeleton replacement
(QA-007), and the global shell/sidebar plus realtime status (QA-001).

Module specs use `fixtures/pages.fixture.ts`, which injects page objects and a
saved-session restore hook. A transient `/login` redirect on module navigation is
retried once without repeating UI login; auth behaviour itself stays covered by
`tests/00-auth.spec.ts`.

### Module 2 — Tasks

Read-only checks: module load, numeric tab counts, all five tab routes and
selection state, per-tab zero-state copy, search no-match and clear behaviour,
Status + Priority filter combinations with clear-filters recovery, filter
popover option sets, and the due-from/due-until date-range controls. Task
creation, editing, completion and deletion are deferred because they mutate the
shared workspace.

### Module 3 — Calendar

Read-only checks: month view load, month grid structure, previous/next/Today
navigation and Today disabled state on the current period, Month/Week view
switching with a seven-day week grid and week navigation, independent layer
toggles, Department/Project/Employee filter combinations with clear-filters
recovery, filter option/search-box inventories, and the empty-month copy over an
intact grid. Event drill-down, timezone-boundary placement and event show/hide
verification are deferred until scheduled data exists.


## Known constraints handled by the helpers

- **Rate limiting:** Better Auth limits `/sign-in/email`; TaskForge returns
  `429` with `X-Retry-After`. `utils/auth.ts` paces submissions and
  retries after the advertised delay. Do not run multiple auth tests in
  parallel with the same account.
- **Hydration:** submitting `/login` before React attaches `onSubmit` causes a
  native GET and puts the password in the URL (QA-012). The helper waits for
  React's form handler before filling/submitting.
- **Transient network/DNS errors:** `gotoWithRetry` retries
  `ERR_NAME_NOT_RESOLVED` / `ERR_NETWORK_CHANGED` navigations.
- **Realtime host:** `api.mytaskforge.net` does not resolve (QA-001), so tests
  must assert persisted HTTP state and must not depend on live updates.
- **Free plan limits:** members `5/5`, projects `1/1` (QA-005). Creation tests
  need a staging workspace or explicit approval/data cleanup.

## Adding module specs

Create files in order:

```text
tests/01-home.spec.ts
tests/02-tasks.spec.ts
...
tests/17-settings.spec.ts
```

The `modules-*` projects automatically pick up `01` through `17` and supply
`playwright/.auth/user.json`. Keep tests non-destructive unless the scenario is
explicitly approved. Reuse the `loginPage` / `workspacePage` fixtures rather
than logging in or querying the DOM inside each spec.

## Safety

- No application source code is modified by this suite.
- Tests sign in/out and read pages; they do not create, update or delete
  workspace records.
- Do not commit `.env`, `playwright/.auth/`, `test-results/` or
  `playwright-report/` — all are gitignored.
