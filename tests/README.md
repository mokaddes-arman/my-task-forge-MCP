# TaskForge Playwright Suite

TypeScript + Playwright end-to-end tests for `https://mytaskforge.net/`.

## Prerequisites

- Node.js 20+ (tested with Node 24.21.0, npm 11.19.0).
- Google Chrome installed (`channel: "chrome"` is used in `playwright.config.ts`).
- `.env` at the project root:

```dotenv
BASE_URL = https://mytaskforge.net/
owner_email = <owner sign-in email>
owner_password = <owner password>
# optional, defaults to /abdul-s-workspace
WORKSPACE_PATH = /abdul-s-workspace
```

`.env` is gitignored. Never commit credentials or storage state.

## Install

```powershell
npm install
```

Playwright uses the system Chrome channel, so no `playwright install` is
required unless you change the channel to bundled Chromium.

## Projects

| Project | Files | Auth state | Purpose |
|---|---|---|---|
| `auth` | `tests/00-auth.spec.ts` | empty | Standalone auth coverage; every test starts logged out |
| `setup` | `tests/auth.setup.ts` | empty | Logs in once and writes `playwright/.auth/user.json` |
| `modules` | `tests/0[1-9]-*.spec.ts`, `tests/1[0-9]-*.spec.ts` | saved | Module specs reuse the saved session |

Run everything:

```powershell
npm test
```

Run only auth:

```powershell
npm run test:auth
```

Refresh the saved session without running module tests:

```powershell
npm run test:setup
```

Type-check:

```powershell
npm run typecheck
```

HTML report:

```powershell
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
  `429` with `X-Retry-After`. `tests/helpers/auth.ts` paces submissions and
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

The `modules` project automatically picks up `01` through `17` and supplies
`playwright/.auth/user.json`. Keep tests non-destructive unless the scenario is
explicitly approved. Reuse the helpers rather than logging in inside each spec.

## Safety

- No application source code is modified by this suite.
- Tests sign in/out and read pages; they do not create, update or delete
  workspace records.
- Do not commit `.env`, `playwright/.auth/`, `test-results/` or
  `playwright-report/` — all are gitignored.
