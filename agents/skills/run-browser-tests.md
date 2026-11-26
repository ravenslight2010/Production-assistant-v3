# Skill: run and change browser tests

Use this before editing `e2e/`, browser-related CI, visual baselines, or
accessibility coverage.

## Harness architecture

Browser tests are Node tests in `e2e/*.browser.test.mjs`; `pnpm test:browser`
expands to `node --test e2e/*.test.mjs`. There is no `playwright.config.*` or
Playwright project named `chromium-mobile`.

Current harnesses:

- serve the built `dist/` through an ephemeral loopback HTTP server;
- intercept `/api/v3/**` with deterministic Playwright route mocks;
- default to Chromium, with newer harnesses selecting `BROWSER` and older ones
  also accepting `BROWSER_ENGINE`;
- use local/disposable fixtures rather than a shared backend.

Build first. Do not start a real server, provide a production database, or
invent a Playwright project merely to run these files. Live smoke and stress
work are different procedures.

## Run the matrix

Use pinned Node 24.22.3 and the lockfile-pinned dependencies:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium webkit firefox
pnpm run build
pnpm test:browser
BROWSER=webkit BROWSER_ENGINE=webkit pnpm test:browser
BROWSER=firefox BROWSER_ENGINE=firefox pnpm test:browser
```

Set both engine variables for the full suite because harness generations differ.
For a focused file, pass it directly to Node, preserving the same engine
environment:

```sh
BROWSER=webkit BROWSER_ENGINE=webkit node --test e2e/setup-catalog.browser.test.mjs
```

Run the smallest failing file while diagnosing, then rerun the complete affected
engine and the full browser matrix before publication. A Chromium-only pass does
not establish WebKit or Firefox behavior.

## Write reliable scenarios

- Await Playwright actions and web-first assertions. Use role/label locators
  with exact names when dynamic text could collide.
- Assert the actual postcondition; do not hide a missing outcome behind a
  conditional, caught error, or `|| true`.
- Wait for the real prerequisite before an action. If a file input or button is
  disabled during canonical loading, use a retrying `toBeEnabled()` assertion
  before interacting with it. Do not replace the expected result or add a broad
  sleep.
- For controlled inputs, assert the expected value with a retrying matcher
  rather than a one-shot read.
- Keep route mocks deterministic and unexpected requests visible. Never filter
  out page errors merely to make an engine pass.
- Preserve offline/read-only, idempotent-retry, conflict, and denial cases when
  repairing timing. Timing fixes belong in the test only when application source
  proves the application behavior is already correct.

## Visual comparisons

`e2e/qc-visual.browser.test.mjs` compares reviewed Chromium baselines. WebKit
and Firefox skip only the four Chromium image comparisons, not the behavioral
suites.

The fixtures use deterministic API data, frozen time, a pinned Inter font,
stable font loading, reduced motion, and blocked service workers. Missing
baselines fail. The whole-image mismatch cap is `0.001`; the per-pixel
rasterization-noise threshold is `0.6`.

Recreate baselines only after reviewing an intentional UI change:

```sh
UPDATE_QC_VISUAL_BASELINES=1 node --test e2e/qc-visual.browser.test.mjs
```

Review every changed image. Never regenerate baselines just to make an
unexpected diff disappear, and do not commit ignored failure artifacts.

## Accessibility

`e2e/qc-accessibility.browser.test.mjs` uses `@axe-core/playwright` and asserts
zero serious/critical violations after stable rendering, alongside keyboard and
focus scenarios. Let transitions settle before scanning; do not weaken the rule
set or exclude a genuinely broken control. Automated scans do not replace manual
screen-reader or visual-contrast review.

## Evidence boundary

Hosted WebKit and mobile Chromium lanes are browser emulation, not physical
iOS Safari, Android Chrome, or PWA qualification. Report the exact engine,
viewport, commit, and counts. Keep skipped tests visible and never claim a
blocked or unrun lane passed.
