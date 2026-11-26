# Skill: repair hosted CI without weakening coverage

Use this when a GitHub-hosted workflow is red or when a local pass and hosted
result disagree.

## 1. Establish the failing contract

1. Fetch current `origin/main` and identify the exact commit and run.
2. Read the failed job and first causal error, not only the final timeout.
3. Determine whether the failure is in product code, test timing, harness
   setup, runner provisioning, or an intentionally non-blocking advisory step.
4. Reproduce with the same engine and repository-native command. If the exact
   hosted platform is unavailable, say so and use the closest supported local
   check without calling it equivalent.

Read [Browser and CI memory](../memory/browser-and-ci.md) for the workflow map
and [Gotchas](../memory/gotchas.md) before changing browser launch or timing.

## 2. Make the smallest causal repair

- Delete dead runner-specific setup when the selected engine never uses it.
  Do not move a Chromium executable lookup into a WebKit run.
- Match the harness's actual engine variables and commands. Do not invent
  Playwright projects or require a live database for route-mocked `dist/` tests.
- Repair timing with a concrete retrying prerequisite. Do not replace the
  expected value, remove an assertion, broaden an error filter, or suppress a
  failing job.
- Keep Chromium-only visual comparisons explicit; preserve behavioral coverage
  on WebKit and Firefox.
- Leave unrelated workflow policy alone. In particular, the existing production
  dependency audit is advisory; do not silently turn that into a product-test
  failure or use it to excuse another red step.

## 3. Verify in widening circles

1. Focused failing scenario on the affected engine.
2. Complete affected browser file and complete affected engine.
3. Full unit/typecheck/build/generated-client/guard checks relevant to the
   changed surface.
4. Full Chromium, WebKit, and Firefox browser matrix for shared harness or
   workflow changes.
5. Real-Postgres harness for SQL or service-query changes.

Record exact counts, skips, and unrun checks. An independent reviewer is a
separate evidence requirement; never label self-review as independent V6 proof.

## 4. Publish and watch

Follow [Verify and publish](verify-and-publish.md). Use a normal non-forced
update and confirm the published tree/commit before watching workflows.

Watch every automatic workflow triggered by the published commit: `Test`,
`Safari iOS`, `Android Chrome`, `PWA checks`, and `CodeQL` when applicable.
`Repair` should skip after a successful `Test` run; that skip is expected.
Windows 10/11 are manual-only and require self-hosted runners, so do not list
them as automatic failures or physical-device evidence.

A green emulated lane repairs CI only. It does not authorize deployment or prove
physical-device/production readiness.
