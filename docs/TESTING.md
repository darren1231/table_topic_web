# Regression testing

This repository uses two deliberately separate test layers:

- **Static contracts (`node:test`)** catch inexpensive structural regressions such as duplicate IDs, missing core elements, invalid configuration, script order, and JavaScript syntax. They are guardrails, not complete functional tests.
- **Browser tests (Playwright Chromium)** exercise user-visible behavior in the real static application. The suite runs against `http-server` and never needs a Vercel deployment.

A successful Vercel deployment, a successful `node --check`, or an HTML page that merely loads is **not** a substitute for the browser suite.

## Install

Use Node.js 20 or newer:

```sh
npm ci
npx playwright install --with-deps chromium
```

No API key, Supabase account, or microphone permission is required. Browser tests block non-local requests, use the built-in coach, clear browser storage between tests, and fail on unexpected page or console errors.

## Run tests

Run syntax checks, static contracts, and all Playwright tests:

```sh
npm test
```

Run one layer:

```sh
npm run test:unit
npm run test:e2e
```

Run one Playwright file, test title, or headed debug session:

```sh
npx playwright test tests/e2e/practice.spec.js
npx playwright test -g "try again"
npx playwright test tests/e2e/practice.spec.js --headed
```

The HTML report is written to `playwright-report/`. Open the most recent report with:

```sh
npx playwright show-report
```

On failure, Playwright retains a screenshot and trace under `test-results/`; CI uploads both directories as the `playwright-diagnostics` artifact.

## Visual snapshots

Visual tests intentionally screenshot a few stable elements rather than whole pages. Snapshot baselines under `tests/e2e/visual.spec.js-snapshots/` are committed. Animation is disabled and a small pixel-difference ratio handles platform rendering noise.

Only update snapshots when the UI change is intentional and reviewed:

```sh
npx playwright test tests/e2e/visual.spec.js --update-snapshots
npm run test:e2e
```

Review the changed PNGs before committing them. Never update a snapshot merely to silence an unexplained regression.

## Add regression coverage

1. Put inexpensive document/config contracts in `tests/unit/` and behavior in `tests/e2e/`.
2. Reuse `tests/helpers/app-fixture.js` so storage isolation, external-request blocking, and runtime-error collection remain consistent.
3. Assert observable outcomes rather than implementation details or arbitrary timeouts.
4. Keep each test independent; do not rely on order or data left by another test.
5. Mock browser capabilities or remote provider boundaries. Never add real credentials or require a physical microphone.
6. Keep screenshots scoped to stable elements and mask dates, timers, or other dynamic text when adding a visual test that contains them.

For a bug fix, first add a test that reproduces the bug and confirm that it fails, then implement the fix and confirm it passes. A new feature should include at least one happy-path test and one failure, boundary, or recovery test.

## Branch protection (manual repository setting)

After this workflow lands, a repository administrator should open **Settings → Branches → Branch protection rules** (or the repository ruleset), target `main`, enable required status checks, and require **`regression-tests`** before merging. Do not select the Vercel deployment status in its place: deployment and regression testing are separate checks. This repository setting is intentionally not changed by application code or this workflow.
