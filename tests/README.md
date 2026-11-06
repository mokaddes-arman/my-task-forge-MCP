# TaskForge Playwright Suite

TypeScript (Page Object Model) + Playwright end-to-end tests for `https://mytaskforge.net/`.

## Project structure

```text
pages/        Page objects: all locators and page actions live here
  BasePage.ts
  LoginPage.ts
  WorkspacePage.ts
fixtures/     Playwright fixtures that inject page objects and credentials
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

1. Valid owner credentials authenticate and render the workspace shell.
2. Invalid credentials show the inline error and do not create a session.
3. Authenticated `storageState` persists into a new browser context.
4. Logout clears the session and protects workspace routes.
5. QA-003 regression guard: 3 fresh-context sign-ins must all succeed.

Animations/loading are handled with visibility and response/URL assertions, not
fixed sleeps. The suite is serial (`workers: 1`) because it uses one shared owner
account.

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
