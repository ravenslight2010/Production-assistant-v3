# Browser and hosted CI memory

Current topology verified against `c09a9b4110ee7b6886f551da591ac38bf2473eba`
on 2026-11-27. Re-read the workflows before relying on this map.

## Repository-native browser tests

- `pnpm test:browser` runs `node --test e2e/*.test.mjs`, not Playwright's
  project runner.
- Harnesses serve production `dist/` on loopback and mock API routes. Build
  first; no live application server or real database is required.
- Chromium is the default. Set both `BROWSER` and `BROWSER_ENGINE` for WebKit
  or Firefox because older harnesses use the latter.
- WebKit/Firefox skip only the four Chromium visual comparisons. Behavioral,
  denial, retry, offline, accessibility, and sync coverage remains applicable.
- Visual failures may write ignored `test-results/qc-visual/` diagnostics; these
  are not reviewed baselines and must not be committed.

Procedure: [Run browser tests](../skills/run-browser-tests.md).

## Automatic hosted lanes

| Workflow | Blocking evidence |
| --- | --- |
| `Test` | Syntax, generated API parity, typecheck, unit tests, Chromium/WebKit/Firefox browser suites, real-Postgres tests, no-AI and research guards |
| `Safari iOS` | WebKit with emulated iPhone/iPad viewports on macOS |
| `Android Chrome` | Chromium mobile viewport emulation |
| `PWA checks` | Built manifest and service-worker presence |
| `CodeQL` | Static analysis according to its workflow triggers |

The production dependency audit in `Test` is currently advisory through
`continue-on-error: true`; do not describe it as a blocking security gate.

`Repair` runs only for a failed pull-request `Test` workflow, so a skip after a
successful push is expected. Windows 10/11 workflows are `workflow_dispatch`
only and require suitable self-hosted runners. None of the browser workflows is
physical-device evidence by itself.

## Dated repair evidence

At `2926a4decd86a5dd214d39e179789bf0a89074ca` (`Fix Safari launcher and
workbook queue readiness`), the hosted `Test`, `Safari iOS`, `Android Chrome`,
`PWA checks`, and `CodeQL` runs succeeded. `Repair` skipped as expected.

Local evidence at that same commit:

- Chromium: 46 passed, 0 failed.
- WebKit: 42 passed, 4 Chromium-only visual comparisons skipped, 0 failed.
- Firefox: 42 passed, 4 Chromium-only visual comparisons skipped, 0 failed.
- Public Node tests: 279 passed, 6 skipped, 0 failed.
- Build, typecheck, generated API parity, no-AI/research guards, syntax checks,
  and `git diff --check` passed.

These are historical results for `2926a4d`, not a standing claim about later
commits. No independent V6 review or physical-device qualification was performed.

## Repairs already made — do not regress them

- Six multi-engine harnesses once ran `which chromium` unconditionally on macOS
  even though the resulting path was unused. Safari failed before WebKit could
  launch. The dead lookup was removed; Chromium-only harnesses retained their
  conditional executable lookup.
- Mobile workflows now invoke the self-contained harness with explicit engine
  variables rather than a nonexistent Playwright project or a real server that
  needs an unavailable database.
- The mixed-workbook scenario waits for the source file input to become enabled
  before `setInputFiles()`. This fixes readiness without changing queue,
  rejection, exact-retry, staging, or no-Apply assertions.
- Inventory reconnect tests wait for canonical requests and enabled controls
  before reload. WebKit page-error filtering was not added.

Detailed failure rules live in [Gotchas](gotchas.md); hosted repair procedure
lives in [Repair hosted CI](../skills/repair-hosted-ci.md).
