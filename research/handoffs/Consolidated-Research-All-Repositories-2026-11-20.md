# Consolidated Research — All Repositories and Branches

**Research date:** 2026-11-20  
**Owner:** ravenslight2010  
**Scope:** prior available session research and handoffs; four GitHub repositories; every current branch; pull-request disposition; current and branch-only documentation/research/evidence paths.  
**Repository access during this compilation:** read-only. No branch, PR, deployment, database, or production state was changed.

## 1. How to use this report

This is a pinned research compilation, not a release approval or implementation authorization.

- Repository and branch claims refer to the SHAs listed below, observed on 2026-11-20.
- “Implemented” means a source path exists. It does not mean signed-in, published, physical-device, or production verification passed.
- Historical test results remain bound to their original commit, date, environment, and data boundary. They are not aggregated into a current release PASS.
- The appendices are a complete path and branch inventory. The narrative synthesizes the load-bearing current documents and prior handoffs; it does not claim that every archived file was reread verbatim.
- Raw customer workbooks, production rows, credentials, connection strings, cookies, protected operational captures, and credential-bearing uploads are excluded.

## 2. Executive findings

1. **There are four repositories and 77 current branches.** Only one open PR was found: PRC draft PR #163. Most other branches are merged PR/dependency history or closed superseded work.
2. **PRC V1 and standalone Replit V2 are not interchangeable trees.** Standalone V2 contains a separate application under `v2/`, plus an older retained V1/reference baseline. It is not a clean superset of current PRC `main`.
3. **The standalone V2 source was recovered from PRC `Replit`, then advanced.** At the pinned comparison, the recovered branch had 130 `v2/` files; current standalone V2 has 148. Of the 130 shared paths, 103 are byte-identical and 27 changed; standalone V2 adds 18 paths, including schedule planning/import, reviewed die defaults, production-rule enforcement, and activation support.
4. **The two repositories with “v2” in their names are different efforts.** `Lucias-production-assistant-v2` is a TypeScript/Drizzle/Clerk purpose-first rebuild with its own database and deployment boundary. `Replit-v2-main` is the framework-light Node `.mjs`/PostgreSQL `v2` schema application recovered from PRC’s `Replit` line. Do not merge their requirements, credentials, evidence, or data models by name alone.
5. **Both V2 lines retain release gates.** Lucia’s own status marks WP1–WP7 partial and requires signed-in core-journey evidence. Standalone V2’s readiness/pilot records require isolated deployment, physical-device, operational, and cutover qualification. Recovery CI is valuable source evidence, not production approval.
6. **Local Coding Assistant moved after its 2026-11-19 handoff.** Nine commits advanced `main` from `8a51d49…` to `4a3a9b5…`, adding task, workflow, memory, secret-store, testing, multi-file editing, and optional Auto file-edit capabilities. The one-click installer still installs immutable source `55fdafc…`; it does not install those newer commits. No checks on the newer head are claimed here.
7. **Older synchronization and migration instructions are historical.** Do not replay the old `kimi` reconstruction, 39-target serial-to-identity conversion, Git-based audit-input restoration, or old staging branches. Later integration and private reviewed-input/serial-generator/Publish policy supersede them.
8. **The HP Pavilion report is test-host evidence only.** It was blocked for the intended Windows/Docker host path, and its `qwen3:4b` candidate was explicitly unmeasured. It does not qualify the future production host or prove GPU inference.

## 3. Repository and PR snapshot

| Repository | Default branch | Pinned head | Head date | Latest subject | Branches | PRs: open / merged / closed unmerged |
|---|---|---|---|---|---:|---:|
| `Production-run-calculator` | `main` | `8769908bc25f5ed05943d1a2e50f34dee108b91a` | 2026-11-19 | `build(deps-dev): bump vitest from 5.0.5 to 5.1.0 (#169)` | 51 | 1 / 116 / 61 |
| `Replit-v2-main` | `main` | `7413225e5577a952570f37c207e6c940166c8e61` | 2026-11-19 | `Add portable capability catalog and validation` | 1 | 0 / 8 / 4 |
| `Lucias-production-assistant-v2` | `main` | `e3ab0880ed95b7e0a9581b2ca9f7da368d11c8c1` | 2026-11-19 | `Add ended_at to run-control column contract.` | 12 | 0 / 20 / 17 |
| `local-coding-assistant` | `main` | `4a3a9b5e1326f76bcabea74bcecf5aa9ff42007c` | 2026-11-20 | `Expand current task instead of stacking follow-ups.` | 13 | 0 / 12 / 0 |
| **Total** | — | — | — | — | **77** | **1 / 156 / 82** |

PR totals include historical PRs whose branches no longer exist. The branch ledger below covers branches that still exist at the snapshot.

## 4. Research precedence and current authority

Use the newest applicable source, but do not confuse recency with authorization.

1. **Current source and current owner-approved scope** govern implementation facts.
2. **SHA-bound current tests and browser/database evidence** govern only the lanes they actually ran.
3. **Later handoffs supersede earlier reconstruction instructions** where they explicitly conflict.
4. **Archived plans, task snapshots, branch maps, readiness reports, and session exports** remain useful history, not current status by themselves.
5. **Deployment, cutover, production-data, and migration operations require separate authorization.** Research never supplies it.

### Resolved historical conflicts

| Historical guidance | Current disposition |
|---|---|
| Replay the old `kimi` reconstruction or staging branches to integrate Replit | **Superseded.** Replit source content reached main through the later #143/#144/#142 integration line. Do not replay old branches. |
| Perform the old 39-target serial-to-identity conversion | **Superseded.** Later policy uses the current serial-generator/Publish approach. Do not run the old conversion. |
| Restore audit inputs from Git history | **Superseded.** Later policy uses private reviewed-input materialization and explicit authorization. |
| Treat the historical `Replit`-branch self-hosting guide as current production publication authority | **False.** It is an optional historical LAN design. Replit remains the authorized V1 production publication route; GitHub CI/Docker evidence does not prove what is live. |
| Treat the V2 2026-11-18 NO-GO/pilot documents as current live-status proof | **False.** They are dated gates. Later recovery evidence exists, but no current production approval follows automatically. |
| Treat the old `+ +` / literal-NaN prompt bug as an open current-main defect | **False.** It was fixed on main in October 2026. Do not reopen it without a new regression. |
| Treat old branch maps, Full Plan status tables, or cancelled/archived task records as open requirements | **False.** Reconcile against current source and owner-approved scope. |

## 5. Production Run Calculator V1

**Pinned source:** `Production-run-calculator` `main` @ `8769908bc25f5ed05943d1a2e50f34dee108b91a`.

### 5.1 Architecture and research corpus

- pnpm monorepo; React 19, Vite, Tailwind v4; Express 5 API; PostgreSQL/Drizzle; Zod and OpenAPI-generated contracts.
- Existing day-state `/api/sync` and automatic-tracking research is V1-specific. It must not be assumed to define either V2 line.
- Current documented toolchain includes Node 24.21.0, pnpm 12.8.1, TypeScript 6.0.3, and `typescript-native` mapped to TypeScript 7.0.2.
- Current-main inventory contains **982 selected documentation/research/evidence paths**. This includes `.agents/memory`, `docs`, `research`, release evidence, AI governance/evaluation, import design, inventory, synchronization, self-hosting, installers, security, and runbooks. The complete path index is in Appendix C.

### 5.2 Durable research conclusions

- **AI authority:** AI is advisory. Human Apply and deterministic validation/release gates retain authority over operational data and QC/release decisions.
- **Local AI:** self-hosted OpenAI-compatible serving through Ollama/llama.cpp is the researched route; in-browser inference is not the selected architecture.
- **Distillation:** sequence-level KD and Qwen3-8B QLoRA were research candidates, not automatic promotion. Train/dev/never-look holdout separation, anti-poison labels, and conditional quality/latency gates remain required.
- **Imports:** source preview, changed-row review, explicit Apply, safe retry, persisted history, and no silent deletion from missing rows are the governing safety model.
- **Import Gold and evaluation:** capture and promotion require explicit source/use authorization; previews do not authorize training, alias learning, or inventory mutation.
- **Sync and automatic tracking:** stale writes, wake/reconnect, sequence continuity, worker/server ownership, and cross-device freshness require separate evidence. Browser tests do not prove physical sleep/wake or published behavior.
- **Evidence discipline:** preserve PASS / NOT RUN / BLOCKED distinctions and bind claims to source revision, environment, and data classification.

### 5.3 Material non-main branches

#### `Replit` @ `82c2f8858fab962a9b018f780470024693814dd1`

- +590/-94 by ancestry against current main; 590 unique commits.
- Contains the recovered V2 source/research line and extensive historical V1/reference material.
- PR #143 merged into a feature branch, not directly into current main. The branch’s other historical PRs do not make its current tip merged.
- Its latest subject adds the V2 next-phase handoff for QC, account reset, schedule import, die defaults, freezer pull, cycle counts, allergens/substitutions, mix planning, app updates, E2E, and architectural preserves.
- It is a source/recovery reference, not an authorization to merge 590 commits or operate a database.

#### `feature/local-coding-assistant` @ `38a4342357eef3d780ffab614aa60bdc5c0a5d93`

- The only open PR: **draft #163**, `feat: add local coding assistant host selection`.
- +91/-17 against current main; 91 unique commits.
- Adds a fail-closed `codingAssistant` hardware/model recommendation separate from the app’s AI candidate.
- Recorded evidence: eight Node tests and static profile/JSON checks passed; native Windows/.NET tests were not run in that environment.
- OpenCode runtime enforcement, Windows isolation, outbound traffic, and host-load impact remain unqualified. The PR itself says not to merge until native validation and review pass.

#### `sync/replit-wake-sequence-fix` @ `5c57ca8719620726f37a5c96b0dddb4479aabda6`

- One unique commit; +1/-81; PR #148 closed unmerged.
- Changed four files: screen-off wake E2E, `useAutoTrack`, and home-sync coordination source/tests.
- Retain as a closed candidate/reference only. Do not call the fix shipped.

#### `agent/windows-metadata-validation` @ `eb5905542b703992562a5992b77f36835953d249`

- PR #129 closed; historical validation-only line.
- It is not a release branch and must not be merged as one.

#### `kimi` and `kimi-replit-2026-10-27`

- `kimi` @ `757eb1322a366aafc96be71ddaa5a334da92a410`: +278/-88, no PR; latest subject `Correct schema transfer parity`.
- `kimi-replit-2026-10-27` @ `eac1461fae83bb97defd05b0ec5d119732f516b8`: +279/-88, no PR; latest subject `Prepare main audit reconciliation`.
- Both are historical reconstruction/reconciliation lines. Later handoffs explicitly supersede their old merge/migration recommendations.

Other divergent branches with merged PRs are retained branch refs, not automatically active work; squash/rebase workflows can leave them non-ancestor even after merge. The complete ledger disambiguates them.

## 6. Standalone Replit V2

**Pinned source:** `Replit-v2-main` `main` @ `7413225e5577a952570f37c207e6c940166c8e61`.

### 6.1 Identity and recovery

- Separate Git history: initial commit `b1e6eeeff2160d2f0d156aa522053ab0e360b7ad` has no parents.
- `replit.md` declares `v2/` the current runtime and older artifact/shared-library code as V1 reference.
- Recovery record: source restored from PRC `Replit` @ `82c2f8858fab962a9b018f780470024693814dd1`; recovered V2 subtree `1b57fc61e18048ef87c9f549623c3f20d57649d0`.
- Recovery evidence reported 154 unit cases passed, two private-corpus cases explicitly skipped, 13 browser cases passed, and disposable PostgreSQL checks passed. This is supported-runtime source evidence, not managed-database or production authorization.

### 6.2 Tree comparison with V1

| Tree measure | Count |
|---|---:|
| V1 current-main blob files | 4,571 |
| Standalone V2 current-main blob files | 3,992 |
| Shared paths | 2,007 |
| Byte-identical shared paths | 821 |
| Changed shared paths | 1,186 |
| V1-only paths | 2,564 |
| V2-only paths | 1,985 |
| V2-only paths under `v2/` | 148 |
| V2-only paths under `_archived/` | 1,686 |

Conclusion: V2 is a replacement application with retained legacy/reference material, not a patch that automatically contains current V1 changes.

### 6.3 Current application model

- Framework-light browser client and Node `.mjs` server; direct PostgreSQL via `pg`; SQL migrations, functions, triggers, and grants.
- V2 objects isolated in PostgreSQL schema `v2`. This is schema isolation, not a separate physical database.
- Server-owned canonical run state; revision-checked commands; stable idempotency keys; events, receipts, and outbox records.
- Separately supervised API and leased station worker. Server-side automatic progress continues without an open browser; browser ticks are not authoritative.
- V2-owned Argon2id authentication, opaque sessions, CSRF, role checks, and revocation. No V1 sessions or credentials.
- Read-only cached browser view while disconnected; writes wait for reconnection and server confirmation.
- Multi-warehouse inventory, new physical opening counts, append-only movements, receipts, transfers, and exact-once run-completion consumption.
- Frozen product/recipe/setup/warehouse snapshots on runs.
- Reviewed CSV/source-workbook imports, production-rule enforcement, reviewed die defaults, schedule planning, and schedule-workbook import.
- Package baseline: Node 24.22.3, `pg` 8.23.1, `@e965/xlsx` 0.20.3 through the `xlsx` mapping, and Playwright 1.65.1. The retained root/legacy area remains on its older pnpm/TypeScript baseline.

### 6.4 Migration inventory

Current `v2/db/` contains migrations `0001-run-control`, `0002-staff-auth`, `0003-production-stations`, `0004-import-inventory`, `0005-dough-capacity-sources`, `0006-run-inventory-linkage`, `0007-approved-setup-catalogs`, `0007-staff-role-equivalents`, `0008-production-rule-enforcement`, `0008-reviewed-die-defaults`, and `0009-production-schedules`.

Their presence does not authorize applying them to a managed or production database.

### 6.5 Research roadmap and evidence gates

The current research set separates approved first-release outcomes from later proposals:

- **First-release core:** run control, all stations, inventory, imports, multi-device sync, and server automatic tracking; web/PWA first; read-only offline.
- **Cutover boundary:** approved setup/master data and roles only; fresh sign-in; no historical runs; no V1 on-hand/history transfer; fresh reviewed physical count.
- **Next-phase candidates:** full QC, account reset approval, fuller schedule import, freezer pull, cycle counts, allergens/substitutions, operational Mix Plan, app-update polish, and a broader E2E matrix.
- **Already delivered in the later standalone source:** reviewed die defaults and material schedule/production-rule additions. Do not treat every item in the older next-phase handoff as still unimplemented.
- **Preserve:** server-owned auto-track, revisions/idempotency/outbox, staged imports, schema isolation, read-only offline, fractional dough yield, leased worker, cutover discipline, workbook-based math verification, and least privilege.

`READINESS-REPORT.md` and `PILOT-DEPLOYMENT-RECORD.md` captured 2026-11-18 boundaries and a then-current NO-GO. Later recovery work improves source evidence but does not itself complete published-host, physical-device, operator, cutover, or production gates.

## 7. Lucia’s Production Assistant V2

**Pinned source:** `Lucias-production-assistant-v2` `main` @ `e3ab0880ed95b7e0a9581b2ca9f7da368d11c8c1`.

### 7.1 Separate architecture and scope

- Separate Replit project, database, deployment, and credentials. Never connect it to V1 production data or reuse V1 cookies/sessions.
- pnpm 10.26.1 workspaces, Node 24, TypeScript 5.9, Express 5, PostgreSQL/Drizzle, Zod v4, Orval/OpenAPI, and esbuild.
- Replit-managed Clerk sign-in; API-issued short-lived `v2_session` bound to the verified Clerk user/session; facility membership and role resolved from PostgreSQL on every request.
- Facility-scoped revision-checked run commands, stable idempotency, and one transaction for lifecycle change + receipt + audit + outbox.
- Purpose-first rebuild, not a feature-for-feature V1 clone. Do not port the V1 sync engine.
- Workbook priority confirmed: product specs → dough → cheese → sauce → mix/premix → shipping → schedule. Pre-import-date schedule rows may be ignored.

### 7.2 Purpose-completion status

The 2026-11-13 status document marks WP0 complete and WP1–WP7 partial:

| Area | Implemented/source evidence | Remaining material acceptance |
|---|---|---|
| Day-plan import | Product/process importers, cleanup/merge, schedule-to-planned-run, reviewed requirement snapshots | Fresh signed-in real/synthetic workbook-to-floor browser apply/replay path |
| Station execution | Shared line timer, revision-safe counts, prep readiness, separate early-pull items | Two signed-in browser contexts and complete supported stage actions |
| Live production math | Captured requirements, count-driven remaining demand, synthetic golden case | Signed-in live refresh after another session changes counts |
| Inventory | Opening counts, adjustments, actual-use confirmation, stale-stock/retry/double-deduction tests | Signed-in inventory and confirmed-use UI |
| Quality | Run-tied ounce checks, customer tolerances, finished-weight ranges, unresolved applicator blocking | Signed-in in-range/out-of-range/unresolved/permission/completed-run journeys |
| Dashboard/UX | Today cockpit, quality attention, midnight worker sweep, role-aware primary action | Signed-in roles/state rendering and physical phone behavior |
| Hardening/CI | Local typecheck/build/web/API tests on the documented toolchain | Current GitHub CI and full signed-in core journey without bypassing Clerk/facility authorization |

### 7.3 Reserved VM evidence

- Separate API and worker supervision and synthetic shared-database checks were exercised.
- Configured pools: API 4, worker 2; one outgoing + one incoming pair has a **configuration-based upper bound of 12 connections**.
- Production read-replica settings produced a documented 356-connection 80% planning ceiling. That is capacity arithmetic, not an observed primary-connection peak.
- Multiple published VM replacements and health recovery were observed, but pool-event logs had sequence/lifecycle gaps. No reliable measured restart-overlap peak was established.
- The corrected published size was 1 vCPU / 4 GiB. A full independent compute restart and complete instrumented overlap capture remain unproven in the record.

### 7.4 Branch-specific watch item

`cursor/fix-sync-server-health-094f` @ `7473a7eaf9dc5fc5b34815b22386406685ca90e5` has one unique commit, is seven behind, and has no PR. It changes CI, API app/routes, health tests, and the run-control DB contract test; latest subject is `Fix CI run-control contract and Clerk-blocked healthz`. It is unmerged candidate work, not current-main behavior.

Most other non-ancestor Lucia branches are closed unmerged major dependency updates. `production-deps-72e10e6b28` merged through PR #38; CI branches merged through PRs #2 and #6.

## 8. Local Coding Assistant

**Pinned current source:** `local-coding-assistant` `main` @ `4a3a9b5e1326f76bcabea74bcecf5aa9ff42007c`.  
**Prior handoff source:** `8a51d49df18d3b3f9170e0014cee9c439efb0806` on 2026-11-19.

### 8.1 Verified baseline from the prior handoff

At the prior handoff head:

- PRs #1–#12 were merged; open PR count was zero.
- `smoke`, `bundle`, and `windows-package` passed on `8a51d49…`.
- Local application suite: 39 tests, 38 passed, one intentional unpackaged-root skip; Windows CI explicitly ran the packaged-server case.
- Real Chromium checks covered streaming, repository switching, Pack behavior, prompt estimates, and desktop/mobile layout with mock Ollama.
- Session-scoped canonical repositories, centralized credential/path exclusions, SHA-256-bound approvals, atomic replacement, bounded outcome-only audit, disconnect cancellation, backpressure, Windows process-tree cleanup, repository-scoped memory/context, opt-in Pack, and one total prompt budget were implemented.
- One-click source was pinned to commit `55fdafc13fc303ed6f2319a09dcc7ab10945508e` with codeload SHA-256 `fe50348c8ca64d94029a40440ebbb24c58bab31485be663844ef29b5992f3352`.

These claims remain pinned to that head. They are not re-certified for current main in this report.

### 8.2 Current security and operating model

- Pure Node built-ins; no npm runtime dependencies.
- Loopback-only server `127.0.0.1:7843`; Ollama `127.0.0.1:11434`; OpenAI-compatible `/v1/chat/completions`; browser SSE streaming.
- Same-origin and JSON-content-type enforcement for writes.
- Shell disabled unless `CA_ALLOW_SHELL=1`; shell commands still require approval.
- Immutable codeload source plus SHA-256 verification; versioned source folders preserve memory and avoid overwriting existing source installations.
- No .NET SDK, npm dependencies, or build tools are required to install/run the assistant.
- Desktop-style Edge/default-browser launcher, not a self-contained native `.exe`.
- Physical clean-machine Windows qualification remains required for native Ollama installation, hardware/model setup, Edge launch, inference, shell cleanup, reboot/startup, and duplicate-server behavior.

### 8.3 Nine post-handoff commits

Current main adds, by commit subjects and current documentation:

- Task creation, Next task loading, and expansion of the current task rather than stacked follow-ups.
- Model memory, richer session export, what-changed summary, searchable memory, secret store, workflows, context trimming, and skills doctor.
- Full testing ladder and security/vulnerability testing skills.
- File creation, multi-file patch, outlines, and additional coding skills.
- Optional **Auto** file edits/creates/patches without a prompt; shell still asks.

This optional Auto mode means the earlier handoff’s universal approval-first edit description is not a complete description of current-main behavior. Current main and its installer payload require separate security/regression qualification before new claims are made.

### 8.4 Installer drift

Current `Get-CodeAgent.cmd` still pins:

- `VERSION=55fdafc13fc303ed6f2319a09dcc7ab10945508e`
- `EXPECTED=fe50348c8ca64d94029a40440ebbb24c58bab31485be663844ef29b5992f3352`

Therefore, the nine newer main commits are not in the current one-click installed payload. Do not silently change this to mutable `main`; any future refresh must pair a reviewed immutable commit with its verified archive hash.

### 8.5 Test-host report

`RunCalculator-Host-Report.json` was generated 2026-11-01 in inspection-only mode:

- Overall status: **blocked** for the intended Windows/Docker host path because the detected edition was Windows Home (`Core`).
- Intel i7-6500U x64, 12.0 GiB installed RAM, 6.3 GiB available at inspection, 827.7 GiB free system-disk space.
- Virtualization/SLAT reported; WSL generation parsing was unknown; Docker was not detected.
- `qwen3:4b` was a conservative candidate for one loaded model/one inference at a time, with quality, latency, GPU/container acceleration, and vision/OCR unqualified.
- The report allowed a core-app-without-AI outcome and rejected assuming a larger model would leave sufficient headroom.
- No installation, model download, provider call, or application-data access occurred.

This was a disposable test laptop, not the future production host. The report is not a clean-machine qualification of Local Coding Assistant.

## 9. Cross-repository research synthesis

| Theme | Consolidated conclusion |
|---|---|
| Operational AI | Keep AI advisory. Human Apply and deterministic gates control operational changes and release/QC authority. |
| Local inference | Use a local OpenAI-compatible server where qualified; hardware detection gives candidates, not quality/performance proof. |
| Training/distillation | Keep train/dev/never-look holdouts separate; anti-poison labeling and explicit source-use approval are prerequisites. |
| Import automation | Host watcher/polling may detect and stage stable files; manager review and explicit Apply remain mandatory by default. |
| File stability | Ignore temporary names, wait for stable size across polls, SHA-256 dedupe, restrict extensions/types, and fail closed on unknown mapping. |
| Import correctness | Preserve source cells/warnings, changed-row review, idempotent Apply, history/reload, and partial-failure reporting. Never infer deletion from missing rows. |
| Run state | V2 designs favor server-owned state, revisions, idempotency, receipts/events/outbox, and worker authority over automatic progress. |
| Offline | Cached read-only operation is approved in the standalone V2 model; disconnected writes wait. Lucia offline controls are disabled and live retry remains to be verified. |
| Inventory | Start from a new physical count at cutover; preserve append-only receipts/ledger and exact-once consumption; no historical run/stock transfer by default. |
| LAN hosting | Historical optional design: Caddy + one API + persistent PostgreSQL + optional Ollama; no Postgres/Ollama host-port exposure; local secrets and tested backups. |
| Updates | Historical preferred design: immutable GHCR images and controlled `plant-stable` promotion after smoke tests, not every push during production. This is not current deployment authorization. |
| Validation | Unit, API, browser emulation, hosted Windows, published VM, and physical-device evidence are different lanes and cannot substitute for one another. |
| Credentials | Never embed credentials in source, installers, reports, logs, screenshots, or handoffs. Live credentials are ephemeral and should be rotated/deleted after use. |

## 10. Current watchlist — not a work authorization

1. **PRC draft PR #163:** keep open until its own native Windows/.NET and runtime-isolation gates are satisfied; do not merge as a side effect of this research.
2. **PRC `Replit`:** retain as source/recovery reference. Do not bulk-merge or replay old integration instructions.
3. **PRC closed wake-sync candidate #148:** if wake continuity becomes active again, compare the candidate against current source rather than assuming it is shipped or still applies.
4. **Standalone V2:** qualify the current head separately; preserve source recovery and complete isolated pilot, signed-in manager journey, physical-device, operator, and cutover evidence before release claims.
5. **Lucia V2:** complete signed-in core journeys and current CI; resolve the unPR’d health/CI candidate only through a fresh reviewed change if still needed.
6. **Local Coding Assistant:** qualify the nine post-handoff commits and optional Auto behavior; keep the installer pin immutable; perform physical clean-machine qualification before expanding installation claims.
7. **Self-hosting/auto-import research:** retain as design input only. Any implementation or production-host change needs a separate approved task.

No additional code-fix task is started by this report.

## 11. Prior artifact provenance

| Artifact | Role | SHA-256 |
|---|---|---|
| `SESSION-EXPORT-and-HANDOFF-2026-09-18-to-2026-10-24.docx` | Master historical session export: AI, local models, distillation, sanitizer/NaN findings, Replit integration, identity, security, flakes, branch cleanup | `9e3c68e6a41c7b5b6ec45e85b61668756852a66a20d289efef7acc5f0b049ffe` |
| `Replit-main-synchronization-fix-handoff.docx` | Historical 2026-10-25 reconstruction; later merge/migration recommendations superseded | `7c1b40389b1cbd7aa423a5cba0424cfaedbc70af15921fbe6663a0710bf5cb86` |
| `Replit-synchronization-and-repair-handoff-2026-11-01.docx` | Later synchronization/handoff authority; supersedes old identity/Git-audit restoration plan | `3ca776a26275d3b8909d7c4995b0af51bb00982f45957383251182a06e24d030` |
| `COMPLETE-self-host-lan-github-guide-2026-10-24.md` | Full historical LAN/Docker/Caddy/Postgres/Ollama and update guide | `c6a8426a9860a8371527c246ea07d39aa2dfea8b1c0b653b8f32f47dee21dedd` |
| `self-host-lan-github-updates-research-2026-10-24.md` | Source-build versus GHCR promotion research | `fbaee59699e7ffc571020978419437ffa42b795d69e20f0bdefa04dc9a8320d4` |
| `auto-import-local-files-research-2026-10-24.md` | Drop-folder staging, stability, dedupe, security, and human-Apply design | `63406376cb08db5f7964ab31fc8c36c17fe77798df79de016370ed55aab39cc6` |
| `RunCalculator-Host-Report.json` | Inspection-only disposable Windows test-host evidence | `e150125bf3e772189a218b60551bd3e18ee01346065802164a323845a0f5fb45` |
| `Local-Coding-Assistant-Handoff-2026-11-19.md` | PR #7–#12 and pinned verification record; current main has since advanced | `521a465d1d2a7d68e5c8dbd5d0becb5f51469658b36d23602a6116d2fd66d646` |

A credential-bearing upload was deliberately not read, hashed, quoted, or included.

## 12. Branch ledger conventions

- **Ahead/behind** is ancestry relative to the repository’s pinned `main`, not a merge recommendation.
- **Unique commits** counts commits reachable from the branch but not main.
- **Research** counts selected documentation/research/evidence paths introduced relative to the merge base; “not-main” counts those paths absent from current main.
- **Merged PR** means the PR API records `merged_at`; it does not imply that the retained branch tip is an ancestor of main.
- **No PR + divergent** means unmerged or externally integrated history requiring manual interpretation; it does not automatically mean active work.
- Dates are committer dates where available. Subjects are truncated only for table readability; SHAs remain complete in the source inventory and shortened to 12 characters in the ledger.

## Appendix A — Complete current-branch ledger (77 branches)

### A.1 `Production-run-calculator` — 51 branches

Pinned `main`: `8769908bc25f5ed05943d1a2e50f34dee108b91a`.

| Branch | Head | Ahead / behind | Unique | PR disposition | Research / not-main | Last date | Latest subject |
|---|---:|---:|---:|---|---:|---|---|
| `main` | `8769908bc25f` | +0 / -0 | 0 | Current default branch | 982 / 0 | 2026-11-19 | build(deps-dev): bump vitest from 5.0.5 to 5.1.0 (#169) |
| `agent/windows-metadata-validation` | `eb5905542b70` | +186 / -94 | 186 | Closed unmerged #129 → `Replit` | 854 / 0 | 2026-10-23 | Keep unapproved private exports fail-closed on Windows |
| `automation/dependabot-patch-automerge` | `f661641886f9` | +0 / -81 | 0 | Ancestor of main; no PR | 981 / 0 | 2026-10-31 | Add read-only Windows server host inspector (#146) |
| `chore/serial-to-identity` | `60a1c78060aa` | +0 / -243 | 0 | Merged #119 (2026-10-19) | 1137 / 314 | 2026-10-19 | refactor(db): convert legacy serial columns to identity columns |
| `chore/skill-frontmatter-effort` | `51a588f3eb73` | +0 / -213 | 0 | Merged #124 (2026-10-20) | 1155 / 329 | 2026-10-20 | chore(skills): drop unsupported effort key from property-based-testing frontmatter |
| `cursor/sync-server-startup-9fc9` | `71e248db4fc9` | +6 / -16 | 6 | Merged #179 (2026-11-17) | 982 / 0 | 2026-11-16 | fix(ci): public-source build-identity gates and pinned-Node cache race |
| `dependabot/github_actions/pnpm/action-setup-6.1.1` | `318452782d3c` | +1 / -59 | 1 | Merged #150 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump pnpm/action-setup from 6.1.0 to 6.1.1 |
| `dependabot/npm_and_yarn/google/genai-2.31.0` | `41c5f6793d6d` | +0 / -70 | 0 | Merged #147 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump @google/genai from 2.30.0 to 2.32.0 |
| `dependabot/npm_and_yarn/hookform/resolvers-6.0.0` | `3ce95380f9ed` | +0 / -58 | 0 | Merged #135 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump @hookform/resolvers from 5.9.2 to 7.0.3 |
| `dependabot/npm_and_yarn/orval-8.44.0` | `721874ec9b72` | +0 / -60 | 0 | Merged #132 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump orval from 8.43.0 to 8.46.0 |
| `dependabot/npm_and_yarn/react-resizable-panels-4.14.8` | `a807d5518770` | +0 / -58 | 0 | Merged #133 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump react-resizable-panels from 4.14.5 to 4.18.1 |
| `dependabot/npm_and_yarn/tanstack/react-query-5.104.5` | `7bb9fca6b0e5` | +0 / -70 | 0 | Merged #138 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump @tanstack/react-query from 5.104.4 to 5.106.1 |
| `dependabot/npm_and_yarn/thread-stream-4.2.1` | `07d4b24d3312` | +1 / -17 | 1 | Merged #173 (2026-11-19) | 982 / 0 | 2026-11-15 | build(deps-dev): bump thread-stream from 4.2.0 to 4.2.1 |
| `dependabot/npm_and_yarn/typedoc-plugin-markdown-4.14.1` | `4edfd90ea982` | +0 / -62 | 0 | Merged #137 (2026-11-09) | 982 / 0 | 2026-11-09 | Bump typedoc-plugin-markdown from 4.14.0 to 4.14.1 |
| `dependabot/npm_and_yarn/vitest-5.1.0` | `3bdf80106d8f` | +1 / -3 | 1 | Merged #169 (2026-11-19) | 982 / 0 | 2026-11-19 | build(deps-dev): bump vitest from 5.0.5 to 5.1.0 |
| `feat/pool-delay-telemetry` | `c427de8a2813` | +0 / -213 | 0 | Merged #123 (2026-10-20) | 1155 / 329 | 2026-10-20 | feat(observability): log database-checkout and server-delay telemetry |
| `feat/windows-auto-installer` | `14f87c4fc10e` | +5 / -75 | 5 | Merged #149 (2026-11-09) | 982 / 0 | 2026-11-08 | Merge branch 'main' into feat/windows-auto-installer |
| `feat/windows-lan-self-hosting` | `d6a1cb34f10f` | +369 / -88 | 369 | Merged #142 (2026-10-31) | 979 / 0 | 2026-10-31 | Isolate raw browser outputs from retained release evidence |
| `feat/windows-server-installer` | `e98fd246c082` | +0 / -82 | 0 | Merged #146 (2026-11-01) | 981 / 0 | 2026-10-31 | Authorize reviewed CI inputs for installer PR |
| `feature/local-coding-assistant` | `38a4342357ee` | +91 / -17 | 91 | **Open #163; draft** | 1007 / 25 | 2026-11-15 | Add Get-CodeAgent.cmd bootstrapper — downloads and runs latest installer with no git pull. |
| `fix/a11y-amber-badge-contrast` | `38a9575c7603` | +0 / -213 | 0 | Merged #122 (2026-10-20) | 1155 / 329 | 2026-10-20 | fix(a11y): darken manager-attention count badges to meet contrast minimum |
| `fix/a11y-menu-close-race` | `b54434dc20c1` | +0 / -215 | 0 | Merged #121 (2026-10-20) | 1155 / 329 | 2026-10-19 | test(a11y): wait for dropdown unmount before scanning manager setup dialog |
| `fix/e2e-sleeps-absence-assertions` | `a31f2f6dcb3e` | +0 / -243 | 0 | Merged #118 (2026-10-19) | 1137 / 314 | 2026-10-19 | test(e2e): replace hard-coded sleeps and unproven absence assertions |
| `fix/main-api-spec-shellcheck-inventory` | `3d27c7e6456e` | +0 / -38 | 0 | Merged #157 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): restore api-spec check:shell to start with shellcheck |
| `fix/main-ci-heap-and-unit-budget` | `af49b3c825ec` | +0 / -40 | 0 | Merged #156 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): raise Typecheck heap; allow low-capacity unit tests via env |
| `fix/main-ci-no-env-wait` | `417b62dc28c3` | +0 / -50 | 0 | Merged #152 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): stop main jobs waiting on protected environments |
| `fix/main-ci-public-source-walk` | `dcbafc418471` | +0 / -47 | 0 | Merged #153 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): make public CI builds complete without private audits |
| `fix/main-ci-remaining-failures` | `790b0db0ade4` | +0 / -45 | 0 | Merged #154 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): Docker public source + shellcheck for typecheck path |
| `fix/main-client-dependency-anchors-safe` | `9a9d83ac4f86` | +0 / -18 | 0 | Merged #168 (2026-11-10) | 982 / 0 | 2026-11-10 | fix(web): do not crash browser on optional dependencyAuditAnchors resolve |
| `fix/main-corpus-skip-inside-tests` | `8267231a276a` | +0 / -22 | 0 | Merged #166 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): skip corpus-harness suites inside tests under CI_PUBLIC_SOURCE |
| `fix/main-green-deps-and-outbox-idle` | `2934e9478652` | +0 / -76 | 0 | Merged #151 (2026-11-09) | 981 / 0 | 2026-11-09 | fix(ci): stop failing PR jobs on missing reviewed-input restore |
| `fix/main-green-pr-audit` | `acb31e86b586` | +3 / -87 | 3 | Merged #145 (2026-11-01) | 980 / 0 | 2026-11-01 | Bound incident capture across reloads and arm lock cancellation before readiness |
| `fix/main-regenerate-orval-client` | `228c4df3d1c9` | +0 / -42 | 0 | Merged #155 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): allow 2 CPU workers for calculator tests under CI_PUBLIC_SOURCE |
| `fix/main-remove-orphan-shellcheck-wrapper` | `658bc705aa56` | +0 / -36 | 0 | Merged #158 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): remove orphan api-spec run-shellcheck.sh from inventory |
| `fix/main-restore-shell-inventory-validation` | `50a63f8c9857` | +0 / -30 | 0 | Merged #161 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): restore shell-inventory validation; fix shellcheck SC2034 |
| `fix/main-skip-corpus-harness-public-ci` | `ec9f29d2f21c` | +0 / -26 | 0 | Merged #164 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): exclude corpus-harness from public library unit sweep |
| `fix/main-skip-corpus-package-test` | `1b4d20431c28` | +0 / -24 | 0 | Merged #165 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): do not crash API on optional pino-pretty resolve; skip corpus tests |
| `fix/main-skip-more-private-script-tests` | `fcf5e78e2be9` | +0 / -32 | 0 | Merged #160 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): skip second-pass and zip-asset tests without private assets |
| `fix/main-skip-source-tests-public-ci` | `0f5f50bddb6b` | +0 / -34 | 0 | Merged #159 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): skip private source-library script tests under CI_PUBLIC_SOURCE |
| `fix/main-skip-workbook-and-source-lib-tests` | `9d38adf0e4e0` | +0 / -28 | 0 | Merged #162 (2026-11-09) | 982 / 0 | 2026-11-09 | fix(ci): skip workbook and source-library unit tests without assets |
| `fix/main-unit-library-sweep-fi` | `8350c4114ea8` | +0 / -20 | 0 | Merged #167 (2026-11-10) | 982 / 0 | 2026-11-10 | fix(ci): remove stray fi from unit library-sweep run step |
| `fix/run-templates-flush-drain` | `d17dea975282` | +0 / -89 | 0 | Merged #128 (2026-10-21) | 1241 / 405 | 2026-10-21 | Drain in-flight flushes between tests; use real-timer abort path |
| `fix/run-templates-timer-margin` | `a698e3b78835` | +0 / -92 | 0 | Merged #127 (2026-10-21) | 1241 / 405 | 2026-10-21 | Give fake-timer advancement 1s margin over the 30s write timeout |
| `integration/main-preserve-replit-024a8763` | `bbf89c4a7c5c` | +1 / -88 | 1 | Merged #144 (2026-10-31) → `feat/windows-lan-self-hosting` | 1241 / 405 | 2026-10-31 | fix: prepare main integration with current Replit run-template safeguards |
| `kimi` | `757eb1322a36` | +278 / -88 | 278 | **Divergent; no PR found** | 926 / 5 | 2026-10-24 | Correct schema transfer parity |
| `kimi-main-reconciliation` | `b9f7d7a59772` | +2 / -88 | 2 | Merged #131 (2026-10-24) → `kimi` | 1241 / 405 | 2026-10-24 | Preserve Replit run-template regression coverage |
| `kimi-replit-2026-10-27` | `eac1461fae83` | +279 / -88 | 279 | **Divergent; no PR found** | 926 / 5 | 2026-10-26 | Prepare main audit reconciliation |
| `merge/replit-integration` | `70be58f359c3` | +0 / -254 | 0 | Merged #108 (2026-10-18) | 1137 / 314 | 2026-10-19 | test: align a11y field-check expectations with the current catalog rendering |
| `merge/replit-updates` | `f26903f1078f` | +0 / -221 | 0 | Merged #17 (2026-09-05); Merged #120 (2026-10-19) | 1155 / 329 | 2026-10-19 | test: update diagnostic event expectations for bounded API evidence taxonomy |
| `Replit` | `82c2f8858fab` | +590 / -94 | 590 | Merged #62 (2026-09-17); Merged #125 (2026-10-20); Merged #126 (2026-10-21); Merged #143 (2026-10-31) → `feat/windows-lan-self-hosting`; Closed unmerged #15; Closed unmerged #83 → `coderabbit/review-base-2` | 1090 / 125 | 2026-11-18 | Add V2 next-phase handoff: QC, account reset, schedule import, die defaults, freezer pull, cycle counts, allergen/substitutions, mix plan, app updates, E2E, and architectural preserves. |
| `sync/replit-wake-sequence-fix` | `5c57ca871962` | +1 / -81 | 1 | Closed unmerged #148 | 981 / 0 | 2026-11-04 | Fix wake recovery sequence continuity and retry handling |

### A.2 `Replit-v2-main` — 1 branches

Pinned `main`: `7413225e5577a952570f37c207e6c940166c8e61`.

| Branch | Head | Ahead / behind | Unique | PR disposition | Research / not-main | Last date | Latest subject |
|---|---:|---:|---:|---|---:|---|---|
| `main` | `7413225e5577` | +0 / -0 | 0 | Current default branch | 383 / 0 | 2026-11-19 | Add portable capability catalog and validation |

### A.3 `Lucias-production-assistant-v2` — 12 branches

Pinned `main`: `e3ab0880ed95b7e0a9581b2ca9f7da368d11c8c1`.

| Branch | Head | Ahead / behind | Unique | PR disposition | Research / not-main | Last date | Latest subject |
|---|---:|---:|---:|---|---:|---|---|
| `main` | `e3ab0880ed95` | +0 / -0 | 0 | Current default branch | 37 / 0 | 2026-11-19 | Add ended_at to run-control column contract. |
| `cursor/fix-sync-server-health-094f` | `7473a7eaf9dc` | +1 / -7 | 1 | **Divergent; no PR found** | 37 / 0 | 2026-11-16 | Fix CI run-control contract and Clerk-blocked healthz |
| `dependabot/npm_and_yarn/date-fns-4.4.0` | `124f110c5eac` | +1 / -142 | 1 | Closed unmerged #20 | 7 / 0 | 2026-11-11 | chore(deps): bump date-fns from 3.6.0 to 4.4.0 |
| `dependabot/npm_and_yarn/hookform/resolvers-7.0.3` | `e9dddb586c3c` | +1 / -142 | 1 | Closed unmerged #16 | 7 / 0 | 2026-11-11 | chore(deps): bump @hookform/resolvers from 3.10.0 to 7.0.3 |
| `dependabot/npm_and_yarn/npm_and_yarn-571e357d2d` | `73a9988a55e8` | +0 / -148 | 0 | Merged #1 (2026-11-11) | 6 / 0 | 2026-11-11 | Bump fast-uri |
| `dependabot/npm_and_yarn/production-deps-72e10e6b28` | `f9a533c56c47` | +1 / -6 | 1 | Merged #38 (2026-11-16) | 37 / 0 | 2026-11-16 | chore(deps): bump the production-deps group with 6 updates |
| `dependabot/npm_and_yarn/react-day-picker-10.0.2` | `3fce1bf3abda` | +1 / -142 | 1 | Closed unmerged #19 | 7 / 0 | 2026-11-11 | chore(deps): bump react-day-picker from 9.14.0 to 10.0.2 |
| `dependabot/npm_and_yarn/react-resizable-panels-4.19.1` | `bb1657a74359` | +1 / -142 | 1 | Closed unmerged #21 | 7 / 0 | 2026-11-11 | chore(deps): bump react-resizable-panels from 2.1.9 to 4.19.1 |
| `dependabot/npm_and_yarn/recharts-3.10.1` | `d0a032aca9a1` | +1 / -142 | 1 | Closed unmerged #14 | 7 / 0 | 2026-11-11 | chore(deps): bump recharts from 2.15.4 to 3.10.1 |
| `dependabot/npm_and_yarn/thread-stream-4.2.1` | `129f35a642d8` | +1 / -142 | 1 | Closed unmerged #17 | 7 / 0 | 2026-11-11 | chore(deps): bump thread-stream from 3.1.0 to 4.2.1 |
| `feat/github-workflows-ci` | `043f97970b75` | +0 / -146 | 0 | Merged #2 (2026-11-11) | 7 / 0 | 2026-11-11 | ci: add lean GitHub workflows and Dependabot for V2 |
| `feat/more-github-workflows` | `93727e93b40b` | +0 / -144 | 0 | Merged #6 (2026-11-11) | 7 / 0 | 2026-11-11 | ci: add CodeQL, dependency review, codegen drift, lockfile checks |

### A.4 `local-coding-assistant` — 13 branches

Pinned `main`: `4a3a9b5e1326f76bcabea74bcecf5aa9ff42007c`.

| Branch | Head | Ahead / behind | Unique | PR disposition | Research / not-main | Last date | Latest subject |
|---|---:|---:|---:|---|---:|---|---|
| `main` | `4a3a9b5e1326` | +0 / -0 | 0 | Current default branch | 17 / 0 | 2026-11-20 | Expand current task instead of stacking follow-ups. |
| `ci/hardened-windows-package` | `0e49d7dc8bb5` | +0 / -12 | 0 | Merged #11 (2026-11-19) | 14 / 0 | 2026-11-19 | Harden CI and qualify Windows package |
| `feat/approval-first-coding-loop` | `ddc4bcd01f0a` | +1 / -30 | 1 | Merged #4 (2026-11-17) → `fix/lossless-chat-streaming` | 14 / 0 | 2026-11-17 | Add approval-first coding loop |
| `feat/windows-desktop-app` | `4d5010b85622` | +0 / -26 | 0 | Merged #6 (2026-11-19) | 14 / 0 | 2026-11-17 | Open Code Agent in a desktop app window |
| `fix/approval-tool-lifecycle` | `09a4baba87b6` | +0 / -16 | 0 | Merged #9 (2026-11-19) | 14 / 0 | 2026-11-19 | Harden approvals and tool lifecycle |
| `fix/ci-server-smoke-tests` | `8d18e821e5ab` | +0 / -34 | 0 | Merged #1 (2026-11-16) | 14 / 0 | 2026-11-16 | Make CI verify server startup |
| `fix/coding-loop-to-main` | `c8e2643d0ef7` | +0 / -28 | 0 | Merged #5 (2026-11-17) | 14 / 0 | 2026-11-17 | Add approval-first coding loop |
| `fix/installer-hardened-source-pin` | `8f086fcabcb0` | +0 / -10 | 0 | Merged #12 (2026-11-19) | 14 / 0 | 2026-11-19 | Pin installer to hardened merged source |
| `fix/local-server-security` | `3d9af08fcda5` | +0 / -32 | 0 | Merged #2 (2026-11-16) | 14 / 0 | 2026-11-16 | Harden local chat server security |
| `fix/lossless-chat-streaming` | `7dde8e008e3b` | +2 / -30 | 2 | Merged #3 (2026-11-17) | 14 / 0 | 2026-11-17 | Merge pull request #4 from ravenslight2010/feat/approval-first-coding-loop |
| `fix/repository-context-budget` | `b7be87959a27` | +0 / -14 | 0 | Merged #10 (2026-11-19) | 14 / 0 | 2026-11-19 | Scope context by repository and budget prompts |
| `fix/session-repository-isolation` | `983a6fb5bc5a` | +0 / -18 | 0 | Merged #8 (2026-11-19) | 14 / 0 | 2026-11-19 | Test session isolation and centralized file policy |
| `fix/standalone-installer` | `f77f5549f34a` | +0 / -22 | 0 | Merged #7 (2026-11-19) | 14 / 0 | 2026-11-19 | Pin and document one-click Windows bootstrap |

## Appendix B — Branch-specific research path index

This deduplicated index lists selected documentation/research/evidence paths that occur on a non-main branch but are absent from that repository’s current main. It records location, not current validity. PRC is the only repository with such paths in this snapshot.

### B.1 `Production-run-calculator` — 555 unique branch-only paths

<details>
<summary>Expand 555 paths and their carrying branches</summary>

| Path | Carrying branch(es) |
|---|---|
| `.agents/memory/browser-inventory-preflight.md` | `Replit` |
| `.agents/memory/follow-up-task-scope.md` | `Replit` |
| `.agents/memory/idle-downtime-observation.md` | `Replit` |
| `.agents/memory/local-security-fork-scanning.md` | `Replit` |
| `.agents/memory/node-typings-runtime-major.md` | `Replit` |
| `.agents/memory/pr-dependency-snapshot-isolation.md` | `Replit` |
| `.agents/memory/preview-port-discovery.md` | `Replit` |
| `.agents/memory/pure-test-environments.md` | `Replit` |
| `.agents/memory/replit-artifact-discovery.md` | `Replit` |
| `.agents/memory/replit-db-clone-scope.md` | `Replit` |
| `.agents/memory/v1-data-recovery-boundary.md` | `Replit` |
| `.agents/memory/v2-scope.md` | `Replit` |
| `.agents/memory/vitest-source-file-reads.md` | `Replit` |
| `_archived/v1/README.md` | `Replit` |
| `_archived/v1/artifacts/api-server/src/routes/capabilities/README.md` | `Replit` |
| `_archived/v1/artifacts/run-calculator/docs/performance-audit-2026-08-23.md` | `Replit` |
| `_archived/v1/artifacts/run-calculator/docs/performance-budgets.md` | `Replit` |
| `_archived/v1/artifacts/run-calculator/docs/performance-live-trace-2026-09-05.md` | `Replit` |
| `_archived/v1/artifacts/run-calculator/e2e/README.md` | `Replit` |
| `_archived/v1/artifacts/run-calculator/release-evidence/preview-home.jpg` | `Replit` |
| `_archived/v1/artifacts/run-calculator/src/departments/README.md` | `Replit` |
| `agent-skills/README.md` | `feature/local-coding-assistant` |
| `agent-skills/drizzle-best-practices/README.md` | `feature/local-coding-assistant` |
| `agent-skills/e2e-reviewer/evals/files/diff-review/README.md` | `feature/local-coding-assistant` |
| `agent-skills/playwright-debugger/references/trace-media-analysis.md` | `feature/local-coding-assistant` |
| `agent-skills/playwright-test-generator/scenario-design.md` | `feature/local-coding-assistant` |
| `agent-skills/prc-release-ops/references/merge-runbook.md` | `feature/local-coding-assistant` |
| `agent-skills/prc-release-ops/references/research-index.md` | `feature/local-coding-assistant` |
| `agent-skills/skill-creator/references/design-principles.md` | `feature/local-coding-assistant` |
| `attached_assets/0_Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_10.08.26_1792375594591.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/0_Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1791920475343.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/0_Updated_Pre_Mix_Sheets_1792375580804.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/20261013_110902_1791907799780.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/20261013_110912_1791907799751.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/20261013_111326_1791912331589.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/20261013_143848_1791920345273.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/AISelect_20261003_181536_Replit_1791069506218.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Agentic-Bug-Hunter-main_1789336705554.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Aldo's_Dough_Mixing_Procedure_-_09_1785045239855.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Aldo's_Dough_Mixing_Procedure_-_09_1792509612999.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Aldo's_Pizza_Specs_-_09_1783188271692.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Aldo's_Pizza_Specs_-_09_1785046071844.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Aldo's_Pizza_Specs_-_09_1792510065483.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Aldo_Pizza_Sauce_02_1792509673599.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Alfredo_Pizza_Sauce_07_1792509674005.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Anthropic-Cybersecurity-Skills-main_1789345857689.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Asiago_Sauce_02_1792509674024.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Basha's_Original_Pizza_Recipe_Specs_-_3_1785046071967.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Basha's_Original_Pizza_Recipe_Specs_-_3_1792510065542.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Basha's_Ultra_Thin_Pizza_Recipe_Specs_-_2_1785046072054.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Basha's_Ultra_Thin_Pizza_Recipe_Specs_-_2_1792510065554.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Bobo's_Buffalo_Pizza_Sauce_-_01_1792509674043.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Bobo's_Pizza_Recipe_Specs_-_29_1785046072324.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Bobo's_Pizza_Recipe_Specs_-_29_1792510065566.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Bobo's_Pizza_Sauce_01_1792509674074.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Brand_Dough_Mixing_Procedure_-_08_1785045240089.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Brand_Dough_Mixing_Procedure_-_08_1792509613457.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Brand_Marriott_Pizza_Sauce_03_1792509674113.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Brand_Pizza_Recipe_Specs_-_14_1785046072149.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Brand_Pizza_Recipe_Specs_-_14_1792510065583.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/CLIProxyAPI-main_1789336705501.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/CRB_Dough_Mixing_Procedure_-_39_1784998550156.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/CRB_Dough_Mixing_Procedure_-_39_1785045240161.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/CRB_Dough_Mixing_Procedure_-_40_1792509613484.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_10.08.26_1792509443119.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_10.08.26_1792509560149.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Claude-Autopilot-main_1789337301141.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Claude-BugHunter-main_1789336705536.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Corner_Booth_Recipe_Specs_-_24_1785046072719.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Corner_Booth_Recipe_Specs_-_24_1792510065607.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Costco_Pizza_Recipe_Specs_-_14_1785046072607.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Costco_Pizza_Recipe_Specs_-_14_1792510065628.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/CyberStrike-main_1789345857863.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ECC-main_1789337301178.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/El_Primo's_Pizza_Recipe_Specs_-_01_1792510065652.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/FSD_7_Inch_Pizza_Specs_-_03_1785046072492.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/FSD_7_Inch_Pizza_Specs_-_03_1792510065676.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/FULL-PLAN-production-run-calculator-2026-10-03_1791084665943.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Four_Hands_Red_Hot_Pizza_Sauce_-_03_1792509674127.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/FreeRide-main_1789336705442.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Garlic_Alfredo_Pizza_Sauce_02_1792509674095.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Gravy_Sauce_-_05_1792509674357.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Halal_Pizza_Recipe_Specs_-_01_1792510065706.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Hannaford's_Pizza_Recipe_Specs_-_19_1785046072405.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Hannaford's_Pizza_Recipe_Specs_-_19_1787089580920.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Hannaford's_Pizza_Recipe_Specs_-_19_1792510065720.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Kroger_Pizza_Recipe_Specs_-_01_1792510065734.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lowe's_7_Inch_Pizza_Specs_-_06_1785046072247.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lowe's_7_Inch_Pizza_Specs_-_06_1792510065752.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lowe's_French_Fry_Dough_Mixing_Procedure_-_03_1785045240242.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lowe's_French_Fry_Dough_Mixing_Procedure_-_03_1792509613523.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lowe's_Pizza_Recipe_Specs_-_28_1785046072820.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lowe's_Pizza_Recipe_Specs_-_28_1792510065782.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lucia's_7_Inch_Morning_Melts_Pizza_Specs_-_08_1785046073101.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lucia's_7_Inch_Morning_Melts_Pizza_Specs_-_08_1792510065883.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lucia's_French_Fry_Dough_Mixing_Procedure_-_06_1785045240321.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lucia's_French_Fry_Dough_Mixing_Procedure_-_06_1792509613561.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lucia's_Pinsa_Pizzas_-_03_1785046073198.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lucia's_Pinsa_Pizzas_-_03_1792510065910.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lucia_Craft_Pizza_(New)_Recipe_Specs_-_04_1792510065824.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lucia_Craft_Pizza_Recipe_Specs_-_03_1784998537459.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lucia_Craft_Pizza_Recipe_Specs_-_03_1785046072920.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lucia_Pizza_Recipe_Specs_-_35_1785046073006.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Lucia_Pizza_Recipe_Specs_-_35_1792510065856.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Lucia_Pizza_Sauce_06_1792509674143.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Malted_Barley_Dough_Mixing_Procedure_-_29_1785045240746.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Malted_Barley_Dough_Mixing_Procedure_-_29_1792509613597.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Malted_Barley_Process_1792509613634.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Margherita_Dough_Mixing_Procedure_-_05_1785045240663.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Margherita_Dough_Mixing_Procedure_-_05_1792509613673.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Masa_Dough,_Natural,_(Lowe's)_Mixing_Procedure_-_04_1785045240485.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Masa_Dough,_Natural,_(Lowe's)_Mixing_Procedure_-_04_1792509614967.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Masa_Dough_(El_Primo)_Mixing_Procedure_-_01_1792509614905.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Masa_Dough_Mixing_Procedure_-_12_1785045240576.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Masa_Dough_Mixing_Procedure_-_12_1792509614931.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1785046073602.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Mauro's_Pinsa_Pizza_Recipe_Specs_-_02_1792510065932.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Medulla's_TOI_Pizza_Sauce_03_1792509674249.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Microwavable_Lucia's_Dough_Mixing_Procedure_-_04_1785045240403.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Microwavable_Lucia's_Dough_Mixing_Procedure_-_04_1792509615004.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Modified_Malted_Barley_Dough_Mixing_Procedure_-_07_1785045240871.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Modified_Malted_Barley_Dough_Mixing_Procedure_-_07_1792509621548.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Mystic_Pizza_Sauce_05_1792509674266.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Naan_Dough_Mixing_Procedure_-_12_1785045240949.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Naan_Dough_Mixing_Procedure_-_12_1792509621568.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/New_Lucia's_Pizzas_09.09.26_1792510065944.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Nob_Hill_Pizza_Recipe_Specs_-_3_1785046073491.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Nob_Hill_Pizza_Recipe_Specs_-_3_1792510120454.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/OmniRoute-main_1789345857927.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/PRC_Security_&_Bug_Scan_2026-10-21_1792524042592.docx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/PR_BODY_1790731543338.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/PR_BODY_1790769342015.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Price_Chopper_Pizza_Recipe_Specs_-_05_1785046073402.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Price_Chopper_Pizza_Recipe_Specs_-_05_1792510120541.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Production_Schedule_10-20-26_1792509479355.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Production_Schedule_10-20-26_1792509521366.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/REVIEW_1790731543406.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/REVIEW_1790769341653.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Schnuck's_Pizza_Recipe_Specs_-_1_1792510120553.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261003_175047_Replit_1791067987323.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261003_175047_Replit_1791069506255.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261003_181502_Replit_1791069506237.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261003_181547_Replit_1791069506200.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261003_181632_Replit_1791069506179.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261003_181720_Replit_1791069506085.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121618_Replit_1791479870519.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121618_Replit_1791479887631.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121618_Replit_1791483024417.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121618_Replit_1791483052476.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121644_Replit_1791479887624.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121644_Replit_1791483024412.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_121644_Replit_1791483052468.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130918_Replit_1791483024407.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130918_Replit_1791483052458.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130924_Replit_1791483024403.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130924_Replit_1791483052451.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130938_Replit_1791483024397.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130938_Replit_1791483052442.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130942_Replit_1791483015353.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130942_Replit_1791483024384.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_130942_Replit_1791483052421.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_142803_Chrome_1791487978282.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261008_142811_Chrome_1791487978274.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261015_080531_Chrome_1792075827735.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261015_124523_Chrome_1792115519384.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261015_211215_Chrome_1792116778340.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261015_211235_Chrome_1792116778327.jpg` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261016_225153_Chrome_1792209158353.jpg` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261016_225207_Chrome_1792209158340.jpg` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261016_225217_Chrome_1792209158322.jpg` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261016_234255_Chrome_1792212204295.jpg` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/Screenshot_20261019_082937_Chrome_1792416602810.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_115340_Chrome_1792428846713.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_121121_Chrome_1792429894332.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_125125_Chrome_1792432295962.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_125302_Chrome_1792432484261.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_125309_Chrome_1792432484256.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_125319_Chrome_1792432484234.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261019_131151_Chrome_1792433526174.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261020_092207_Chrome_1792506794547.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261020_092249_Chrome_1792506794538.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Screenshot_20261020_103816_Chrome_1792510726783.jpg` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Shipping_and_Palletizing_Guide_10.12.26_1792509456239.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Shipping_and_Palletizing_Guide_10.12.26_1792509534750.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Show_Me_Dough_Pizza_Recipe_Specs_-_17_1785046073283.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Show_Me_Dough_Pizza_Recipe_Specs_-_17_1792510120568.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Show_Me_Dough_Pizza_Recipe_Specs_-_18_1792510120587.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Sriracha_Dough_Mixing_Procedure_-_01_1785045241026.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/Sriracha_Dough_Mixing_Procedure_-_02_1792509621601.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Sweet_Chili_Sauce_03_1792509674290.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Sweet_and_Sour_Sauce_02_1792509674227.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Tikka_Masala_Process_1792509674315.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Updated_Pre_Mix_Sheets_1792509467628.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/Updated_Pre_Mix_Sheets_1792509543922.xlsx` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/^_Joe's_Sauce_Guide_11_1785253192591.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/^_Pizza_to_Dough_Recipes_36_1785253208168.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/accessibility-baseline_1789337301251.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/adapter-contract-review-2026-09-29_1790768916356.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/agent-skills-cli-main_1789345857497.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/agent-teams-ai-main_1789345857724.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/agentic-awesome-skills-main_1789345857674.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-deep-dive-continuation-2026-09-28_1790731446594.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-deep-dive-continuation-2026-09-28_1790769119001.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-phase0-adapter-dataset-design-2026-09-28_1790731446581.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-phase0-adapter-dataset-design-2026-09-28_1790769119193.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-research-continuation-codebase-map-2026-09-29_1790731446461.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-research-continuation-codebase-map-2026-09-29_1790769119242.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-tailored-to-app-research-2026-09-28_1790731446608.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/ai-tailored-to-app-research-2026-09-28_1790769119279.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/all-remaining-deep-dives-2026-09-19_1789838602850.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/all-remaining-deep-dives-2026-09-19_1790731446723.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/all-remaining-deep-dives-2026-09-19_1790769119333.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/apply-branch_1790731542494.sh` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/apply-branch_1790769119380.sh` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/arscontexta-main_1789336705485.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/auto-deep-researcher-24x7-main_1789345857811.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/autocontext-main_1789345857786.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/autoharness-main_1789345857907.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-ai-coding-techniques-main_1789345857586.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-ai-tools-main_1789337301163.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-claude-code-main_1789335929493.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-claude-code-main_1789336705388.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-claude-design-main_1789336705457.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-claude-plugins-main_1789336705470.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-gamedev-agent-skills-main_1789345857651.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/awesome-skills-main_1789345857560.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/best-skills-main_1789345857610.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/bug-and-security-audit-replit-2026-09-20_1789935931022.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/bug-and-security-audit-replit-2026-09-20_1790731446634.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/bug-and-security-audit-replit-2026-09-20_1790769119445.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/bug-hunter-main_1789345857706.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/capability-research-pack-2026-09-18_1789791313450.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/check-licenses_1789337301268.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/cheese-recipes-2026-10-17_1792215212956.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/cheese-recipes-2026-10-17_1792215383262.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/claude-code-recipes-main_1789336705516.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/claude-code-settings-main_1789345857743.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/claude-octopus-main_1789345857837.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/client_1790731542586.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/client_1790731542650.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/client_1790769119499.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/codexskills-main_1788409954395.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/codexskills-main_1789337301209.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/consolidated-master-backlog-2026-10-03_1791084665972.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/consolidated-master-backlog-full-2026-10-03_1791084665959.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/deep-dive-research-continuation-2026-09-19_1789836340857.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-backfill-spec-2026-09-30_1790768916472.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-dataset-gap_1790731542713.patch` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-dataset-gap_1790769119546.patch` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-dataset-lib-2026-09-28-1_1790769119584.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-dataset-lib-2026-09-28_1790731446507.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-dataset-lib-2026-09-28_1790731446539.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distill-dataset-lib-2026-09-28_1790769119628.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distillation-experiment-design-2026-09-28_1790731542779.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/distillation-experiment-design-2026-09-28_1790769119676.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/domain-deep-dives-2026-09-19_1789838602879.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/domain-deep-dives-2026-09-19_1790731446737.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/domain-deep-dives-2026-09-19_1790769119716.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/dough-recipes-2026-10-17_1792214579353.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/embedded-lan-offline-ai-architecture-2026-10-03_1791084666015.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/execution-start-2026-10-06_1791338463809.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/free-open-source-ai-agents-research-2026-10-03_1791084666046.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/further-research-2026-09-18_1789790501440.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/handle-sensitive-data_1789337301285.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/headroom-main_1789352961018.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/health_1790731543125.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/health_1790769119776.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/how-to-build-ai-research-2026-09-28_1790731446620.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/how-to-build-ai-research-2026-09-28_1790769119835.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/how-to-build-an-ai-research-2026-09-28_1790731542978.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/how-to-build-an-ai-research-2026-09-28_1790731543055.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/how-to-build-an-ai-research-2026-09-28_1790769119879.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/how-to-build-an-ai-research-2026-09-28_1790769342366.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/https-github-com-ravenslight2010-production-run_1789337301228.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/idea-backlog_1789789063087.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/improvement-research-2026-09-18_1789789062990.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/instrument-observability_1789338223796.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/local-ai-adapter-checklist-2026-10-03_1791084666002.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/local-ai-installation-research-2026-09-26_1790731542906.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/local-ai-installation-research-2026-09-26_1790769119965.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/local-ai-installation-research-2026-09-26_1790769342308.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/main-vs-replit-branch-map-2026-09-20_1789932158670.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/main-vs-replit-branch-map-2026-09-20_1790731446665.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/main-vs-replit-branch-map-2026-09-20_1790769120032.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/main-vs-replit-branch-map-2026-09-20_1790769342251.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/make-apps-resilient_1789337301301.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/migration-failure-diagnostics-1792545042104.txt` | `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation` |
| `attached_assets/mixes-2026-10-17_1792215212990.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/mixes-2026-10-17_1792215383288.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/models_1790731542849.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/models_1790731543195.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/models_1790769120122.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/models_1790769342207.ts` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/nan-fix-coordinated-commit-draft_1791063195213.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/nan-fix-coordinated-commit-draft_1791338495073.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/near-dup-hashing-research-2026-09-28_1790731446526.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/near-dup-hashing-research-2026-09-28_1790769120179.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/near-dup-hashing-research-2026-09-28_1790769342143.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/no-api-local-ai-agents-research-2026-10-03_1791084666029.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/one-skill-to-rule-them-all-main_1789345857885.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/option-b-self-hosted-ai-deep-dive-2026-09-26_1790731543265.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/option-b-self-hosted-ai-deep-dive-2026-09-26_1790769342065.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/pilot-shell-main_1789345857764.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/plant-docker-compose-ollama-sketch-2026-10-03_1791084665988.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/pre-implementation-research-pack-2026-09-19_1789838602745.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/pre-implementation-research-pack-2026-09-19_1790731446706.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/pre-implementation-research-pack-2026-09-19_1790769341925.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/pre-publish-review_1789338223740.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/published-peer-sse-not-supported-gates-2026-10-10_1791726704828.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/qlora-distillation-techniques-2026-09-28_1790731446569.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/qlora-distillation-techniques-2026-09-28_1790769341842.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/qlora-unsloth-config-and-train-checklist-2026-09-28_1790731446554.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/qlora-unsloth-config-and-train-checklist-2026-09-28_1790769341782.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/reconnect-reliability-deep-dive-2026-09-19_1789833155602.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-agent-brief-sse-option-a-2026-10-03_1791084665916.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-agent-brief-sse-option-a-2026-10-03_1791338463834.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-handoff-readiness-sse-qc-2026-10-03_1791063221602.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-handoff-readiness-sse-qc-2026-10-03_1791084666079.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-uptime-brief-for-agent-2026-09-20_1789934089785.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-uptime-brief-for-agent-2026-09-20_1790731446649.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/replit-uptime-brief-for-agent-2026-09-20_1790769341732.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/responsive-cross-device-ui_1789338223682.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sanitizer-deep-read-2026-09-30_1791063195325.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sanitizer-deep-read-2026-09-30_1791063195393.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sauce-recipes-2026-10-17_(1)_1792215289894.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/sauce-recipes-2026-10-17_(1)_1792215383219.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917-kqtezech_expo_picard_replit_dev_schedule.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917-kqtezech_picard_replit_dev_3001_mobile.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917-kqtezech_picard_replit_dev_3001_schedule.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917-kqtezech_picard_replit_dev_mobile.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-dough_Current.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-dough_TimersInline.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-dough_TimersPanel.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-dough_TimersTimeline.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-packaging_Current.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-packaging_VariantA.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-packaging_VariantAB.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-packaging_VariantB.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-packaging_VariantC.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-run_CompactStrip.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-run_Current.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-run_ManagerHub.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-run_VariantA.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-run_VariantB.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/de4fa38f-10e1-481d-ab62-4ad238a33ebf-00-cptzdyqx3917_picard_replit_dev_mockup_preview_tab-run_VariantC.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/screenshots/replit_com_ravenslight2010_Production-calc-app.png` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/secure-ai-features_1789338223643.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/server-research-2026-09-19_1789833173142.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/server-research-deep-dive-2026-09-19_1789833173062.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sheet_20260929_185016_generated_by_Kimi_AI_1790769341591.csv` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sheet_20260929_185028_generated_by_Kimi_AI_1790769341531.csv` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/skills-main_1789336705416.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/skillstead-main_1789345857440.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/AUDIT-REPORT-2026-07-18.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/AUDIT-REPORT-2026-07-21.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/AUDIT-REPORT-2026-08-26.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/CHEESE-RECONCILIATION-2026-08-26-APPROVAL.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi`, `kimi-main-reconciliation`, `kimi-replit-2026-10-27`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/CHEESE-RECONCILIATION-2026-08-26.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi`, `kimi-main-reconciliation`, `kimi-replit-2026-10-27`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/production-snapshot-2026-08-26-post-correction.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/production-snapshot-2026-08-26.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/source-comparison-2026-08-26-post-correction.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/source-comparison-2026-08-26.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/source-library-manifest-2026-08-26.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi`, `kimi-main-reconciliation`, `kimi-replit-2026-10-27`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi`, `kimi-main-reconciliation`, `kimi-replit-2026-10-27`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.sha256` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/audits/tikka-masala-resolution-2026-08-26.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi`, `kimi-main-reconciliation`, `kimi-replit-2026-10-27`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/cheese/Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer_-_07.10.26_1784339826076.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Aldo's_Dough_Mixing_Procedure_-_09_1784339683714.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Brand_Dough_Mixing_Procedure_-_08_1784339683868.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/CRB_Dough_Mixing_Procedure_-_39_1784339683921.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Lowe's_French_Fry_Dough_Mixing_Procedure_-_03_1784339683985.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Lucia's_French_Fry_Dough_Mixing_Procedure_-_06_1784339684078.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Malted_Barley_Dough_Mixing_Procedure_-_29_1784339684152.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Margherita_Dough_Mixing_Procedure_-_05_1784339684241.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Masa_Dough,_Natural,_(Lowe's)_Mixing_Procedure_-_04_1784339684386.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Masa_Dough_Mixing_Procedure_-_12_1784339684313.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Microwavable_Lucia's_Dough_Mixing_Procedure_-_04_1784339684454.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Modified_Malted_Barley_Dough_Mixing_Procedure_-_07_1784339684515.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Naan_Dough_Mixing_Procedure_-_12_1784339684591.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/dough/Sriracha_Dough_Mixing_Procedure_-_01_1784339684659.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/premix/Updated_Pre_Mix_Sheets_1784339838726.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Aldo_Pizza_Sauce_02_1784339518984.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Alfredo_Pizza_Sauce_07_1784339519130.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Asiago_Sauce_02_1784339519196.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Bobo's_Buffalo_Pizza_Sauce_-_01_1784339519274.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Bobo's_Pizza_Sauce_01_1784339519352.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Brand_Marriott_Pizza_Sauce_03_1784339519433.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Four_Hands_Red_Hot_Pizza_Sauce_-_03_1784339519513.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Garlic_Alfredo_Pizza_Sauce_02_1784339519592.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Gravy_Sauce_-_05_1784339519678.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Lucia_Pizza_Sauce_06_1784339519754.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Medulla's_TOI_Pizza_Sauce_03_1784339519838.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Mystic_Pizza_Sauce_05_1784339519919.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Sweet_Chili_Sauce_02_1784339520083.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Sweet_and_Sour_Sauce_02_1784339519999.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/sauce/Tikka_Masala_Process_1784339520201.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/schedule/Production_Schedule_7-8-26_1784339875921.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/shipping/Shipping_and_Palletizing_Guide_07.02.2026_1784339849858.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Basha's_Original_Pizza_Recipe_Specs_-_3_1784339783551.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Basha's_Ultra_Thin_Pizza_Recipe_Specs_-_2_1784339783640.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Bobo's_Pizza_Recipe_Specs_-_29_1784339783713.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Brand_Pizza_Recipe_Specs_-_14_1784339783800.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Corner_Booth_Recipe_Specs_-_24_1784339783909.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Costco_Pizza_Recipe_Specs_-_14_1784339783975.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/FSD_7_Inch_Pizza_Specs_-_03_1784339784063.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Hannaford's_Pizza_Recipe_Specs_-_19_1784339784165.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Lowe's_7_Inch_Pizza_Specs_-_06_1784339784279.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Lowe's_Pizza_Recipe_Specs_-_28_1784339784386.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Lucia's_7_Inch_Morning_Melts_Pizza_Specs_-_08_1784339784700.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Lucia's_Pinsa_Pizzas_-_03_1784339784809.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Lucia_Craft_Pizza_(New)_Recipe_Specs_-_01_1784339784487.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Lucia_Pizza_Recipe_Specs_-_35_1784339784592.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1784339784913.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Nob_Hill_Pizza_Recipe_Specs_-_3_1784339785017.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Price_Chopper_Pizza_Recipe_Specs_-_05_1784339785110.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/source-library/specs/Show_Me_Dough_Pizza_Recipe_Specs_-_17_1784339785174.xlsx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/spec-parse-prompt-nan-bug-2026-09-30_1790768916572.docx` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/specs-2026-10-17_1792215213010.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/specs-2026-10-17_1792215383305.xlsx` | `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-updates` |
| `attached_assets/superpowers-main_1789337301193.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sync-deep-dive-2026-09-19_1789833173024.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sync-diagnostic-history-2026-09-17_1789669148496.json` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sync-outbox-wiring-deep-dive-2026-10-10_1791726704851.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/sync-system-improvements-plan_1789789063044.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/the-state-of-ai-powered-software-development_1789872090323.pdf` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/the-state-of-ai-powered-software-development_1790731446682.pdf` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/the-state-of-ai-powered-software-development_1790769340777.pdf` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/validate-and-encode-input_1789338223536.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/vercel-labs-skills-find-skills_1789352960985.zip` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/vet-dependencies_1789338223580.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/web_app_improvements_report_1791063221564.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `attached_assets/web_app_improvements_report_1791084666062.md` | `chore/serial-to-identity`, `chore/skill-frontmatter-effort`, `feat/pool-delay-telemetry`, `fix/a11y-amber-badge-contrast`, `fix/a11y-menu-close-race`, `fix/e2e-sleeps-absence-assertions`, `fix/run-templates-flush-drain`, `fix/run-templates-timer-margin`, `integration/main-preserve-replit-024a8763`, `kimi-main-reconciliation`, `merge/replit-integration`, `merge/replit-updates` |
| `docs/coding-agent-complete-guide-2026-11-05.md` | `feature/local-coding-assistant` |
| `docs/coding-agent-stack-research-2026-11-05.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant-preview.html` | `feature/local-coding-assistant` |
| `docs/coding-assistant/coding-assistant-useful-items-install.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant/context/test-release-matrix.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant/context/threat_model.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant/context/web-navigation-notices-audit.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant/context/web-push-registration-telemetry.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant/fixtures/host-report-candidate-7b.json` | `feature/local-coding-assistant` |
| `docs/coding-assistant/host-report-contract.md` | `feature/local-coding-assistant` |
| `docs/coding-assistant/opencode-readonly.example.json` | `feature/local-coding-assistant` |
| `docs/coding-assistant/opencode-recommended.example.json` | `feature/local-coding-assistant` |
| `docs/coding-assistant/pilot-runbook.md` | `feature/local-coding-assistant` |
| `docs/dependency-override-consumer-checks-2026-11-05.md` | `Replit` |
| `docs/dependency-remediation-2026-11-05.md` | `Replit` |
| `docs/dependency-update-inventory-2026-11-05.md` | `Replit` |
| `docs/dependency-upgrade-report-2026-11-16.md` | `Replit` |
| `docs/dependency-workspace-inventory-2026-11-16.json` | `Replit` |
| `docs/evidence/background-wake-correlation-2026-11-06.md` | `Replit` |
| `docs/evidence/database-connection-budget-2026-11-07.md` | `Replit` |
| `docs/evidence/glob-minimatch-security-remediation.md` | `Replit` |
| `docs/evidence/pool-acquisition-operation-review-2026-11-05.md` | `Replit` |
| `docs/evidence/reliability-closure-browser-full-before-2026-11-03.md` | `Replit` |
| `docs/evidence/reliability-closure-production-pool-pressure-2026-11-02.json` | `Replit` |
| `docs/evidence/reliability-closure-supported-production-observations.json` | `Replit` |
| `docs/evidence/web-push-license-approval-2026-11-16.md` | `Replit` |
| `docs/isolated-background-concurrency-trial.md` | `Replit` |
| `docs/local-coding-assistant-plan.md` | `feature/local-coding-assistant` |
| `docs/node-typescript-upgrade-reassessment-2026-11-05.md` | `Replit` |
| `docs/retained-startup-tools-experiment.md` | `Replit` |
| `docs/security/picomatch-remediation.md` | `Replit` |
| `docs/startup-tools-diagnostic.md` | `Replit` |
| `docs/typescript-7-readiness-2026-11-05.md` | `Replit` |
| `patches/picomatch/README.md` | `Replit` |
| `release-evidence/browser-full/FINAL-REPORT-2026-11-04-before-attempt-2.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-02.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-03.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04-attempt-1.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04-attempt-2.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04-attempt-3.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04-attempt-4.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04-attempt-5.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04-attempt-6.md` | `Replit` |
| `release-evidence/browser-full/RERUN-2026-11-04.md` | `Replit` |
| `release-evidence/screen-off-wake/DEVICE-CHECK-2026-11-07.md` | `Replit` |
| `research/production-to-development-copy-preflight.md` | `Replit` |
| `research/sources/aws-transactional-outbox.md` | `Replit` |
| `research/sources/chrome-timer-throttling.md` | `Replit` |
| `research/sources/heroku-background-jobs-queueing.md` | `Replit` |
| `research/sources/node-postgres-pool-sizing.md` | `Replit` |
| `research/sources/nodejs-event-loop.md` | `Replit` |
| `research/sources/postgresql-explicit-locking.md` | `Replit` |
| `research/sources/postgresql-select-locking.md` | `Replit` |
| `research/sources/redis-pub-sub.md` | `Replit` |
| `research/sources/search-snippets.md` | `Replit` |
| `research/sources/v2-mdn-page-visibility.md` | `Replit` |
| `research/sources/v2-replit-artifact-vs-project.md` | `Replit` |
| `research/sources/v2-replit-artifacts.md` | `Replit` |
| `research/sources/v2-replit-autoscale.md` | `Replit` |
| `research/sources/v2-replit-deployment-types.md` | `Replit` |
| `research/sources/v2-replit-projects.md` | `Replit` |
| `research/sources/v2-replit-publishing-overview.md` | `Replit` |
| `research/sources/v2-replit-reserved-vm.md` | `Replit` |
| `research/sources/whatwg-server-sent-events.md` | `Replit` |
| `research/v2-server-architecture.md` | `Replit` |
| `research/v2-server-architecture/notes.md` | `Replit` |
| `research/v2-server-architecture/production-evidence.md` | `Replit` |
| `research/v2-server-architecture/replit-feasibility.md` | `Replit` |
| `scripts/ca/README.md` | `feature/local-coding-assistant` |
| `scripts/ca/helpers/README.md` | `feature/local-coding-assistant` |
| `scripts/self-host/coding-assistant/README.md` | `feature/local-coding-assistant` |
| `v2/HANDOFF.md` | `Replit` |
| `v2/READINESS-REPORT.md` | `Replit` |
| `v2/README.md` | `Replit` |
| `v2/research/NEXT-PHASE-HANDOFF.md` | `Replit` |
| `v2/research/README.md` | `Replit` |
| `v2/research/archive/README.md` | `Replit` |
| `v2/research/archive/repo-mirror/.agents/memory/v2-scope.md` | `Replit` |
| `v2/research/archive/repo-mirror/attached_assets/FULL-PLAN-production-run-calculator-2026-10-03_1791084665943.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/evidence/audited-import-safety.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/evidence/home-opening-byte-guard-decision-2026-10-21.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/evidence/home-opening-graph-measurement-2026-10-20.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/evidence/inventory-accounting-2026-10-22.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/evidence/published-background-db-investigation-2026-10-08.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/idea-backlog.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/import-system-plan.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/import-template-downloads.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/inventory-autodeduction-plan.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/mixed-workbook-review.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/next-app-decomposition-roadmap-2026-10-16.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md` | `Replit` |
| `v2/research/archive/repo-mirror/docs/research-reconciliation/coverage-ledger.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/additional-domain-research-synthesis-2026-09-19.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-mdn-page-visibility.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-artifact-vs-project.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-artifacts.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-autoscale.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-deployment-types.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-projects.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-publishing-overview.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/sources/v2-replit-reserved-vm.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/v2-server-architecture.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/v2-server-architecture/production-evidence.md` | `Replit` |
| `v2/research/archive/repo-mirror/research/v2-server-architecture/replit-feasibility.md` | `Replit` |
| `v2/research/archive/task-records/3715.md` | `Replit` |
| `v2/research/archive/task-records/3907.md` | `Replit` |
| `v2/research/archive/task-records/3908.md` | `Replit` |
| `v2/research/archive/task-records/3909.md` | `Replit` |
| `v2/research/archive/task-records/3910.md` | `Replit` |
| `v2/research/archive/task-records/3911.md` | `Replit` |
| `v2/research/archive/task-records/3912.md` | `Replit` |
| `v2/research/archive/task-records/3913.md` | `Replit` |
| `v2/research/archive/task-records/3914.md` | `Replit` |
| `v2/research/archive/task-records/3915.md` | `Replit` |
| `v2/research/gaps.md` | `Replit` |
| `v2/research/roadmap.md` | `Replit` |
| `v2/research/source-catalog.json` | `Replit` |
| `v2/research/source-catalog.md` | `Replit` |
| `v2/research/v1-import-source-matrix.md` | `Replit` |
| `v2/research/v1-to-v2.md` | `Replit` |
| `v2/research/validation.md` | `Replit` |

</details>

### B.2 `Replit-v2-main` — 0 unique branch-only paths

None.

### B.3 `Lucias-production-assistant-v2` — 0 unique branch-only paths

None.

### B.4 `local-coding-assistant` — 0 unique branch-only paths

None.

## Appendix C — Current-main research and evidence path index

These are selected documentation/research/evidence paths, not a claim that every file is a normative research decision. Binary release-evidence filenames are indexed without reproducing their contents.

### C.1 `Production-run-calculator` — 982 paths @ `8769908bc25f5ed05943d1a2e50f34dee108b91a`

<details>
<summary>.agents/memory — 533 paths</summary>

```text
.agents/memory/MEMORY.md
.agents/memory/a11y-coverage-gate.md
.agents/memory/a11y-dialog-browser-fixtures.md
.agents/memory/a11y-reload-fixtures.md
.agents/memory/account-lifecycle-sessions.md
.agents/memory/acknowledged-master-data-propagation.md
.agents/memory/additive-push-force-schema.md
.agents/memory/ai-benchmark-network-boundary.md
.agents/memory/ai-corrections-full-coverage.md
.agents/memory/ai-data-not-in-day-state.md
.agents/memory/ai-deep-dive-continuation-2026-09-28.md
.agents/memory/ai-delivery-governance.md
.agents/memory/ai-evaluation-framework-boundary.md
.agents/memory/ai-json-retry.md
.agents/memory/ai-match-import.md
.agents/memory/ai-memory-health-audits.md
.agents/memory/ai-model-routing-and-streaming.md
.agents/memory/ai-optimize-assistant.md
.agents/memory/ai-phase0-adapter-dataset-design-2026-09-28.md
.agents/memory/ai-reviewer-and-corrections.md
.agents/memory/ai-system-research.md
.agents/memory/ai-tailored-to-app-research-2026-09-28.md
.agents/memory/alias-kind-contract-lockstep.md
.agents/memory/all-remaining-deep-dives-2026-09-19.md
.agents/memory/allergen-foundation.md
.agents/memory/allergen-tracking-plan.md
.agents/memory/allergen-tracking.md
.agents/memory/android-keyboard-avoidance.md
.agents/memory/api-json-error-handler.md
.agents/memory/api-route-composition.md
.agents/memory/api-route-typecheck-isolation.md
.agents/memory/applicator-tolerance-columns.md
.agents/memory/apply-source-evidence-retention.md
.agents/memory/approved-ingredient-identities.md
.agents/memory/ask-the-day-chat.md
.agents/memory/atomic-import-operations.md
.agents/memory/audit-log-scope-boundary.md
.agents/memory/audit-maintenance-workflow.md
.agents/memory/auth-identity-cache.md
.agents/memory/automatic-staged-supply.md
.agents/memory/autosave-edit-attribution.md
.agents/memory/autotrack-coordination-research.md
.agents/memory/autotrack-over-provisioning.md
.agents/memory/autotrack-remainder-carry.md
.agents/memory/autotrack-stale-delta.md
.agents/memory/autotrack-zero-seed.md
.agents/memory/background-db-recovery.md
.agents/memory/background-scheduler-backoff.md
.agents/memory/batch-upsert-transaction.md
.agents/memory/battery-performance-research.md
.agents/memory/bounded-archive-range-reads.md
.agents/memory/brand-fan-linked-name-narrowing.md
.agents/memory/brand-profile-server-pool.md
.agents/memory/brand-quote-typo-fold.md
.agents/memory/brand-rename-aliases.md
.agents/memory/brand-scoped-import-names.md
.agents/memory/browser-attempt-retention-policy.md
.agents/memory/browser-check-boundaries.md
.agents/memory/browser-compatibility-index.md
.agents/memory/browser-e2e-disposable-database.md
.agents/memory/browser-e2e-local-origin.md
.agents/memory/browser-evidence-assertions.md
.agents/memory/browser-fixture-seeding.md
.agents/memory/browser-fixture-server-identifiers.md
.agents/memory/browser-localstorage-availability.md
.agents/memory/browser-matrix-isolation.md
.agents/memory/browser-navigation-scroll.md
.agents/memory/browser-peer-startup-ordering.md
.agents/memory/browser-release-case-contract.md
.agents/memory/browser-request-observer-query-strings.md
.agents/memory/browser-sync-workflow-startup.md
.agents/memory/browser-timer-fixtures.md
.agents/memory/build-integration-isolation.md
.agents/memory/bundle-boundary-manifests.md
.agents/memory/button-default-submit-footgun.md
.agents/memory/capability-gated-controlled-dialogs.md
.agents/memory/capability-research-pack-2026-09-18.md
.agents/memory/case-based-production-input-validity.md
.agents/memory/cases-line-occupancy.md
.agents/memory/cast-screens.md
.agents/memory/cheese-catch-all-flavors.md
.agents/memory/cheese-import-link-to-existing.md
.agents/memory/cheese-mirror-applicators.md
.agents/memory/cheese-server-master-data.md
.agents/memory/cheese-share-oz-basis.md
.agents/memory/ci-pinned-evidence.md
.agents/memory/claude-bugs.md
.agents/memory/clerk-auth-gating.md
.agents/memory/codeexecution-network-globals.md
.agents/memory/codex-fixes.md
.agents/memory/cold-start-import-hang.md
.agents/memory/complete-sync-snapshot-fencing.md
.agents/memory/completed-history-durability.md
.agents/memory/completed-run-stock-corrections.md
.agents/memory/container-image-migration.md
.agents/memory/container-image-release-evidence.md
.agents/memory/corpus-harness.md
.agents/memory/correcting-import-alias-cleanup.md
.agents/memory/cross-channel-auto-track-claims.md
.agents/memory/cross-run-autosave-contamination.md
.agents/memory/crust-dough-name-backstop.md
.agents/memory/crust-run-no-dough-batches.md
.agents/memory/csv-spreadsheet-safety.md
.agents/memory/cycle-count.md
.agents/memory/daily-reset-auth-boundary.md
.agents/memory/daily-reset-trigger.md
.agents/memory/data-health-undo-coverage.md
.agents/memory/database-capacity-evidence.md
.agents/memory/dated-sync-authorization.md
.agents/memory/day-timeline-estimate-policy.md
.agents/memory/db-integration-test-harness.md
.agents/memory/declaration-compatibility-dependencies.md
.agents/memory/dedicated-e2e-database.md
.agents/memory/deferred-gemini-fallback.md
.agents/memory/delayed-onboarding-overlay.md
.agents/memory/delete-undelete-stamps.md
.agents/memory/deletion-tombstones.md
.agents/memory/demand-forecast.md
.agents/memory/dependency-override-scope.md
.agents/memory/deployment-log-fallback.md
.agents/memory/detached-process-lock-inheritance.md
.agents/memory/detached-process-reaping.md
.agents/memory/deterministic-ai-gates.md
.agents/memory/dev-db-connection-exhaustion.md
.agents/memory/diagnostic-persistence-scope.md
.agents/memory/die-defaults-switch-aware.md
.agents/memory/die-picker-e2e-names.md
.agents/memory/die-size-source.md
.agents/memory/die-type-master-heal.md
.agents/memory/die-types-merge-exclusion.md
.agents/memory/disposable-database-test-startup.md
.agents/memory/docker-browser-smoke-runtime.md
.agents/memory/docker-caddy-smoke-image.md
.agents/memory/docker-compose-env-file-overrides.md
.agents/memory/docker-container-readiness.md
.agents/memory/docker-healthcheck-setns.md
.agents/memory/dough-correction-browser-fixture.md
.agents/memory/dough-family-collapse.md
.agents/memory/dough-inline-timers.md
.agents/memory/dough-sauce-server-master-data.md
.agents/memory/dough-weight-server-pool.md
.agents/memory/doughball-variant-customers-matching.md
.agents/memory/doughball-variants.md
.agents/memory/downtime-trends.md
.agents/memory/draining-run-selection.md
.agents/memory/drizzle-generator-evaluation.md
.agents/memory/drizzle-partial-push.md
.agents/memory/drizzle-raw-timestamp-decoding.md
.agents/memory/dropdown-scroll-snap.md
.agents/memory/duplicate-review-ledger.md
.agents/memory/esbuild-override-placement.md
.agents/memory/event-loop-delay-monitor-warmup.md
.agents/memory/excel-import-export.md
.agents/memory/explicit-profile-ack.md
.agents/memory/expo-secure-store-web-crash.md
.agents/memory/express-route-uniqueness.md
.agents/memory/factory-baseline-ownership.md
.agents/memory/field-check-evidence-boundary.md
.agents/memory/field-verification.md
.agents/memory/fill-missing-assistant.md
.agents/memory/fill-missing-shared-lib.md
.agents/memory/finalized-report-authenticity.md
.agents/memory/finished-case-adjustment-audit.md
.agents/memory/floor-mode.md
.agents/memory/forecast-accuracy.md
.agents/memory/formula-import-safety.md
.agents/memory/freezer-phase-indicators.md
.agents/memory/freezer-pull.md
.agents/memory/freezer-wip-completion.md
.agents/memory/frontline-formula-parity.md
.agents/memory/frontline-is-sauce.md
.agents/memory/full-release-browser-refresh.md
.agents/memory/further-research-2026-09-18.md
.agents/memory/gemini-fallback-cache-identity.md
.agents/memory/generic-jsx-breaks-metadata-plugin.md
.agents/memory/github-actions-connector-quirk.md
.agents/memory/github-actions-evidence-extraction.md
.agents/memory/github-actions-job-summary-visibility.md
.agents/memory/github-ci-trigger-access.md
.agents/memory/github-external-fork-verification.md
.agents/memory/github-git-push.md
.agents/memory/github-workflow-scope.md
.agents/memory/guarded-undo-dependency-membership.md
.agents/memory/historical-repair-compatibility.md
.agents/memory/hmr-context-split.md
.agents/memory/home-render-tdz.md
.agents/memory/how-to-build-ai-research-2026-09-28.md
.agents/memory/how-to-build-an-ai-research-2026-09-28.md
.agents/memory/http-security-policy.md
.agents/memory/idea-backlog.md
.agents/memory/import-gen-guard.md
.agents/memory/import-gold-owner-authorization.md
.agents/memory/import-lifecycle-row-identity.md
.agents/memory/import-order-dedup-keys.md
.agents/memory/import-redirect-aliases.md
.agents/memory/import-review-dialog-layering.md
.agents/memory/import-run-merge.md
.agents/memory/import-schedule-date-default.md
.agents/memory/import-source-file-semantics.md
.agents/memory/import-system-plan.md
.agents/memory/importer-audit-recovery.md
.agents/memory/importer-redesign-plan.md
.agents/memory/improvement-research-2026-09-18.md
.agents/memory/incident-diagnosis.md
.agents/memory/incident-notifications-research.md
.agents/memory/ingredient-batch-weights.md
.agents/memory/ingredient-catalog.md
.agents/memory/ingredient-dedupe.md
.agents/memory/ingredient-merge.md
.agents/memory/inline-skill-path-references.md
.agents/memory/integration-test-db-binding.md
.agents/memory/inventory-autodeduction-plan.md
.agents/memory/inventory-consume-idempotency.md
.agents/memory/inventory-gap-analysis.md
.agents/memory/inventory-math-shared-lib.md
.agents/memory/inventory-settings-concurrency.md
.agents/memory/ipv6-loopback-test-environment.md
.agents/memory/isolated-db-may-predate-migrations.md
.agents/memory/isolated-destructive-browser-tests.md
.agents/memory/isolated-env-stale-workspace-links.md
.agents/memory/isolated-test-process-cleanup.md
.agents/memory/large-source-audit-captures.md
.agents/memory/learned-import-aliases.md
.agents/memory/learned-memory-pattern.md
.agents/memory/line-map-station-activity.md
.agents/memory/line-station-order.md
.agents/memory/live-line-speed-timer-rebase.md
.agents/memory/live-performance-trace.md
.agents/memory/live-run-context-clock-isolation.md
.agents/memory/live-sync-web-mobile.md
.agents/memory/local-ai-installation-research-2026-09-26.md
.agents/memory/local-arm64-toolchain.md
.agents/memory/local-browser-suite-routing.md
.agents/memory/local-ci-postgres-parity.md
.agents/memory/local-model-memory-headroom.md
.agents/memory/local-postgres-socket-dir.md
.agents/memory/local-production-graph-build.md
.agents/memory/local-release-browser-fixture-base.md
.agents/memory/local-result-comparability.md
.agents/memory/local-to-server-name-consolidation.md
.agents/memory/local-validation-runtime-index.md
.agents/memory/managed-rebase-tree-recovery.md
.agents/memory/master-data-audit-boundary.md
.agents/memory/master-data-health-ownership.md
.agents/memory/merge-category-tabs.md
.agents/memory/merge-deny-and-change-history.md
.agents/memory/merge-server-master-data-repoint.md
.agents/memory/merge-suggest-research.md
.agents/memory/merge-suggest.md
.agents/memory/merge-target-must-survive.md
.agents/memory/merge-tombstones.md
.agents/memory/metadata-maintenance-supported-hosts.md
.agents/memory/mix-applicator-slots.md
.agents/memory/mix-plan-snapshot-refresh.md
.agents/memory/mix-plan-snapshot.md
.agents/memory/mix-reconcile.md
.agents/memory/mixed-workbook-review-boundary.md
.agents/memory/mixes.md
.agents/memory/mixseed-alias-set.md
.agents/memory/mobile-module-tdz-cycle.md
.agents/memory/mobile-require-cycle-init.md
.agents/memory/mobile-run-context-v2.md
.agents/memory/mobile-seed-ordering.md
.agents/memory/mobile-select-field.md
.agents/memory/mockup-graduation-inline.md
.agents/memory/mounted-ai-cost-paths.md
.agents/memory/mpl-web-push-approval.md
.agents/memory/multi-day-lookahead-plan.md
.agents/memory/multi-file-ai-import.md
.agents/memory/multi-location-inventory.md
.agents/memory/multi-sheet-schedule-import.md
.agents/memory/name-match-near-dup.md
.agents/memory/native-pnpm-runtime.md
.agents/memory/natural-pep-name-poison.md
.agents/memory/nav-structure.md
.agents/memory/near-dup-hashing-research-2026-09-28.md
.agents/memory/near-dup-scan-perf.md
.agents/memory/near-exact-link-profile-propagation.md
.agents/memory/nested-pnpm-exit-codes.md
.agents/memory/no-store-cache-headers.md
.agents/memory/notification-prefs.md
.agents/memory/notification-view-refire.md
.agents/memory/npm-registry-script-metadata.md
.agents/memory/npm-tarball-transport.md
.agents/memory/observability-safe-events.md
.agents/memory/offline-command-receipts.md
.agents/memory/offline-operational-intents.md
.agents/memory/onboarding-ack-latch.md
.agents/memory/onboarding-seen-flag.md
.agents/memory/one-time-data-heals.md
.agents/memory/one-time-data-purge.md
.agents/memory/open-form-profile-clobber.md
.agents/memory/openssl-test-ca-subject-uniqueness.md
.agents/memory/operational-dialog-viewport-safety.md
.agents/memory/operational-health-policy.md
.agents/memory/operational-read-model-integrity.md
.agents/memory/operational-runtime-index.md
.agents/memory/operations-api-compatibility-window.md
.agents/memory/orval-query-coerce-quirk.md
.agents/memory/orval-zod-declaration-order.md
.agents/memory/overproduction-surplus-plan.md
.agents/memory/packaging-calc-receipts.md
.agents/memory/packaging-pause-clock-handoff.md
.agents/memory/packaging-settings.md
.agents/memory/packaging-speed-feedback.md
.agents/memory/partial-sync-contract.md
.agents/memory/password-change-session-invalidation.md
.agents/memory/password-reset-relay.md
.agents/memory/pep-applicator-combine.md
.agents/memory/per-pizza-advisory-limits.md
.agents/memory/phantom-recipe-names.md
.agents/memory/phone-e2e-form-overrides.md
.agents/memory/photo-stock-intake.md
.agents/memory/physical-total-attestations.md
.agents/memory/pinned-node-nix-runner.md
.agents/memory/pinned-pnpm-after-refresh.md
.agents/memory/playwright-304-responses.md
.agents/memory/playwright-list-discovery.md
.agents/memory/playwright-offline-sse.md
.agents/memory/pnpm-outdated-scope-limits.md
.agents/memory/pnpm-workspace-tool-cache.md
.agents/memory/pnpm12-lockfile-provenance.md
.agents/memory/policy-evidence-anchors.md
.agents/memory/pool-acquisition-deadlines.md
.agents/memory/post-merge-setup.md
.agents/memory/pre-implementation-research-pack-2026-09-19.md
.agents/memory/premix-import.md
.agents/memory/prep-inventory-accounting.md
.agents/memory/prep-mix-identities.md
.agents/memory/press-done-model.md
.agents/memory/prior-run-drain-completion.md
.agents/memory/proactive-alerts.md
.agents/memory/production-evidence-revision-binding.md
.agents/memory/production-line-canvas-reference.md
.agents/memory/production-publish-workflow.md
.agents/memory/production-reporting-plan.md
.agents/memory/production-rules.md
.agents/memory/profile-autofill-from-saved-sheets.md
.agents/memory/profile-cleanup-migration.md
.agents/memory/profile-clobber-blank-form.md
.agents/memory/profile-display-identity.md
.agents/memory/profile-force-apply.md
.agents/memory/profile-import-precedence.md
.agents/memory/profile-write-gating.md
.agents/memory/protected-job-effects.md
.agents/memory/provider-audit-isolation.md
.agents/memory/publish-python-environment.md
.agents/memory/pwa-deferred-cache-policy.md
.agents/memory/pwa-offline-eventsource-fixtures.md
.agents/memory/pwa-update-prompts.md
.agents/memory/qc-allergen-phase1-decisions.md
.agents/memory/qc-badge-normal-flow.md
.agents/memory/qc-brix-targets.md
.agents/memory/qc-department-plan.md
.agents/memory/qlora-distillation-techniques-2026-09-28.md
.agents/memory/qlora-power-margin-boundary.md
.agents/memory/qlora-unsloth-config-and-train-checklist-2026-09-28.md
.agents/memory/quality-and-waste-ai.md
.agents/memory/queue-history-cursor-precision.md
.agents/memory/rate-limit-shared-store.md
.agents/memory/react-day-picker-v10.md
.agents/memory/readiness-evidence.md
.agents/memory/ready-made-sauce.md
.agents/memory/recipe-apply-shared-lib.md
.agents/memory/recipe-assistant.md
.agents/memory/recipe-merge-sync-receive.md
.agents/memory/recipe-name-only-attachment.md
.agents/memory/recipe-print-share.md
.agents/memory/recipe-row-unit-provenance.md
.agents/memory/release-audit-endpoint.md
.agents/memory/release-browser-coverage-contract.md
.agents/memory/release-browser-evidence.md
.agents/memory/release-check-shard-budget.md
.agents/memory/release-db-readiness.md
.agents/memory/release-evidence-index.md
.agents/memory/release-evidence-isolation.md
.agents/memory/release-evidence-verifier-mode.md
.agents/memory/release-evidence.md
.agents/memory/release-finalization-retry.md
.agents/memory/release-gate-dependencies.md
.agents/memory/release-guide-authority-claims.md
.agents/memory/release-node-pinning.md
.agents/memory/release-run-cancellation.md
.agents/memory/release-runner-lock-history.md
.agents/memory/release-runner-loopback-probes.md
.agents/memory/render-clock-split.md
.agents/memory/reorder-list.md
.agents/memory/repair-definition-fingerprints.md
.agents/memory/replit-actions-needed.md
.agents/memory/replit-config-validator.md
.agents/memory/replit-custom-migrations.md
.agents/memory/replit-production-detection.md
.agents/memory/replit-staging-project-boundary.md
.agents/memory/reset-request-nav-badge.md
.agents/memory/responsive-browser-fixtures.md
.agents/memory/retained-ai-cache-boundary.md
.agents/memory/retention-pagination-consistency.md
.agents/memory/retention-queue-filter-policy.md
.agents/memory/retired-ai-data-retention.md
.agents/memory/revision-bound-release-evidence.md
.agents/memory/revision-trend-attribution.md
.agents/memory/rn-custom-font-weights.md
.agents/memory/roadmap-synthesis.md
.agents/memory/role-gating.md
.agents/memory/run-calc-parity-test.md
.agents/memory/run-complete-alert-timing.md
.agents/memory/run-list-loss-protection.md
.agents/memory/run-meta-lww.md
.agents/memory/run-to-time-operator-policy.md
.agents/memory/runtime-library-cli-boundaries.md
.agents/memory/same-name-pool-dups.md
.agents/memory/sandbox-auto-refresh.md
.agents/memory/sandbox-isolation-test.md
.agents/memory/sandbox-scope-isolation.md
.agents/memory/sauce-auto-track-failure-identity.md
.agents/memory/sauce-barrel-breakdown-signature.md
.agents/memory/saved-spec-reconcile.md
.agents/memory/saved-spec-snapshot-prune.md
.agents/memory/schedule-import-401.md
.agents/memory/schedule-move-canonical-writes.md
.agents/memory/schedule-move.md
.agents/memory/scheduled-day-client-date.md
.agents/memory/scheduled-day-response-validation.md
.agents/memory/scheduled-evaluation-idempotency.md
.agents/memory/scheduled-queue-warning-channel.md
.agents/memory/scheduled-recipe-check.md
.agents/memory/scheduled-run-profile-snapshot.md
.agents/memory/scoped-offline-master-data-queues.md
.agents/memory/secret-refresh-shell.md
.agents/memory/section-scoped-online-edits.md
.agents/memory/seeded-placeholder-runs.md
.agents/memory/server-empty-over-populated-guard.md
.agents/memory/server-local-alert-ownership.md
.agents/memory/server-operational-projection.md
.agents/memory/server-side-refactor-status.md
.agents/memory/server-templates-supervisor-pin.md
.agents/memory/session-boundary-integration-fixtures.md
.agents/memory/setup-profiles-editor.md
.agents/memory/shared-ai-memory.md
.agents/memory/shared-master-data-refresh.md
.agents/memory/shared-recipe-freeze-coverage.md
.agents/memory/shared-recipe-refresh-run-identity.md
.agents/memory/shell-lint-inventory.md
.agents/memory/shell-signal-cleanup-output.md
.agents/memory/shipping-guide-import.md
.agents/memory/signup-bootstrap-hardening.md
.agents/memory/skill-catalog-ci-roots.md
.agents/memory/skill-session-registry-refresh.md
.agents/memory/sleep-wake-sync-fences.md
.agents/memory/slow-network-auth-timing.md
.agents/memory/source-audit-cli-paths.md
.agents/memory/source-audit-report-versions.md
.agents/memory/source-heal-stale-client-fence.md
.agents/memory/source-library-pool-exception-fingerprints.md
.agents/memory/source-reconciliation-evidence-boundary.md
.agents/memory/source-workbook-layouts.md
.agents/memory/spec-alias-hygiene.md
.agents/memory/spec-export.md
.agents/memory/spec-import-batch-vs-perpizza.md
.agents/memory/spec-import-brand-backfill.md
.agents/memory/spec-import-chunk-union.md
.agents/memory/spec-import-hash-reuse.md
.agents/memory/spec-import-name-first-relink.md
.agents/memory/spec-import-name-link-authority.md
.agents/memory/spec-import-scale-harness.md
.agents/memory/spec-import-seed-pattern.md
.agents/memory/spec-import-stub-pollution.md
.agents/memory/spec-import.md
.agents/memory/spec-preset-seeding.md
.agents/memory/spec-reimport-rename-memory.md
.agents/memory/spec-wins-recipe-overwrite.md
.agents/memory/sse-disconnect-registration.md
.agents/memory/sse-meta-stamp-source.md
.agents/memory/sse-test-reader-timeouts.md
.agents/memory/sse-topology-choice.md
.agents/memory/staff-account-deletion-policy.md
.agents/memory/staging-test-handoff.md
.agents/memory/startup-failure-evidence.md
.agents/memory/stick-pep-types.md
.agents/memory/stoppage-analytics-plan.md
.agents/memory/stoppage-light-theme-contrast.md
.agents/memory/strict-profile-ack.md
.agents/memory/string-reference-purge-safety.md
.agents/memory/supervisor-pin-vs-role.md
.agents/memory/surplus-confirmation-receipts.md
.agents/memory/sync-async-crash-safety.md
.agents/memory/sync-autotracking-priority.md
.agents/memory/sync-body-limit.md
.agents/memory/sync-conflict-policy.md
.agents/memory/sync-first-load-form-heal.md
.agents/memory/sync-http-failure-handling.md
.agents/memory/sync-integration-reset-isolation.md
.agents/memory/sync-listener-stop-diagnostics.md
.agents/memory/sync-reset-boundary-hardening.md
.agents/memory/sync-retry-storms.md
.agents/memory/sync-snapshot-identity.md
.agents/memory/sync-system-improvements-plan.md
.agents/memory/tailwind-playwright-visible-selectors.md
.agents/memory/task-platform-evidence-limits.md
.agents/memory/temp-substitutions.md
.agents/memory/today-schedule-edit-live-path.md
.agents/memory/touch-picker-browser-coverage.md
.agents/memory/typescript-source-bundle-hashing.md
.agents/memory/typescript7-audit-boundaries.md
.agents/memory/unified-setup-editing.md
.agents/memory/visual-regression-baselines.md
.agents/memory/vite8-config-loader.md
.agents/memory/vitest-count-evidence.md
.agents/memory/vitest-hook-cleanup.md
.agents/memory/voice-ask-input.md
.agents/memory/voice-ask-output.md
.agents/memory/voice-command-e2e-seam.md
.agents/memory/voice-commands.md
.agents/memory/wake-sync-claim-fence.md
.agents/memory/warehouse-inventory-boundary.md
.agents/memory/warehouse-staging-checklist.md
.agents/memory/web-brand-palette.md
.agents/memory/web-form-button-submit-reload.md
.agents/memory/web-mobile-parity.md
.agents/memory/web-test-harness.md
.agents/memory/webkit-compatibility-lane-boundary.md
.agents/memory/webkit-gio-tls-runtime.md
.agents/memory/webkit-native-select-color-scheme.md
.agents/memory/webkit-nix-launch.md
.agents/memory/webkit-operational-report-fixture.md
.agents/memory/webkit-review-test-timing.md
.agents/memory/windows-lan-self-hosting.md
.agents/memory/workbook-workflow-safety-index.md
.agents/memory/workflow-configuration-side-effects.md
.agents/memory/workspace-lock-refresh-pruning.md
.agents/memory/xlsx-audit-false-positive.md
.agents/memory/zip-asset-inventory.md
.agents/memory/zod4-form-resolver.md
```

</details>

<details>
<summary>.agents/skills — 3 paths</summary>

```text
.agents/skills/README.md
.agents/skills/skill-audit-2026-08.md
.agents/skills/skill-creator/references/design-principles.md
```

</details>

<details>
<summary>artifacts — 9 paths</summary>

```text
artifacts/api-server/src/routes/capabilities/README.md
artifacts/release-evidence/optimized-calculator-preview-after-proxy-fix.jpg
artifacts/release-evidence/optimized-calculator-preview.jpg
artifacts/run-calculator/docs/performance-audit-2026-08-23.md
artifacts/run-calculator/docs/performance-budgets.md
artifacts/run-calculator/docs/performance-live-trace-2026-09-05.md
artifacts/run-calculator/e2e/README.md
artifacts/run-calculator/release-evidence/preview-home.jpg
artifacts/run-calculator/src/departments/README.md
```

</details>

<details>
<summary>docs — 334 paths</summary>

```text
docs/agent-memory-infrastructure-history-audit.md
docs/ai-corrections-evaluation-data-audit-2026-10-02.md
docs/ai-data-retention-policy-2026-09-05.md
docs/ai-deep-dive-continuation-2026-09-28.md
docs/ai-evaluation-tool-comparison-2026-09-14.md
docs/ai-feature-value-audit-2026-09-05.md
docs/ai-knowledge/README.md
docs/ai-knowledge/manifest.json
docs/ai-phase0-adapter-dataset-design-2026-09-28.md
docs/ai-provider-dependency-refresh-2026-10-02.md
docs/ai-system-research.md
docs/ai-tailored-to-app-research-2026-09-28.md
docs/all-remaining-deep-dives-2026-09-19.md
docs/allergen-tracking-plan.md
docs/audit-log-append-only.md
docs/auto-track-main-coverage-reconciliation-2026-09-06.md
docs/auto-track-sync-reliability-audit-2026-10-19.md
docs/automatic-build-version-reporting.md
docs/autotrack-coordination-research.md
docs/battery-performance-research.md
docs/branch-claims-validation-2026-10-23.md
docs/branch-map-2026-09-21.md
docs/browser-attempt-progress.md
docs/capability-research-pack-2026-09-18.md
docs/coderabbit-pr-83-85-disposition.md
docs/container-builder-security-refresh.md
docs/dependency-update-inventory-2026-09-14.md
docs/dependency-update-inventory-2026-09-25.md
docs/dependency-update-inventory-2026-10-02.md
docs/dependency-update-inventory-2026-10-14.md
docs/docker-caddy-browser-performance.md
docs/docker-caddy-reviewed-inputs.md
docs/evidence/agent-stalls-investigation-2026-10-23.md
docs/evidence/agent-storage-merge-stalls-2026-10-30.md
docs/evidence/audited-import-safety.md
docs/evidence/background-database-phase-contract.md
docs/evidence/break-planning-repair.md
docs/evidence/conditional-qlora-promotion-bar-2026-10-02.md
docs/evidence/conditional-qlora-training-decision-2026-10-02.md
docs/evidence/development-generator-health-2026-10-26.md
docs/evidence/distillation-backfill-decision-2026-10-02.json
docs/evidence/distillation-dataset-safety-review-2026-10-02.md
docs/evidence/export-integrity-audit-2026-10-18.md
docs/evidence/external-skill-archives-2026-10-23.json
docs/evidence/external-skill-searches-2026-10-23.json
docs/evidence/external-skill-sources-2026-10-23.json
docs/evidence/external-skill-verification-2026-10-23.json
docs/evidence/facility-pending-status.md
docs/evidence/field-check-diagnosis-2026-10-16.md
docs/evidence/field-check-export-2026-10-16.md
docs/evidence/field-check-filters-2026-10-16.md
docs/evidence/full-browser-repair-progress-2026-10-24.md
docs/evidence/full-browser-runtime-certification-2026-10-24.md
docs/evidence/full-browser-runtime-generated-2026-10-24.md
docs/evidence/full-browser-runtime-supporting-gates-2026-10-24.json
docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md
docs/evidence/historical-import-discrepancy-review-2026-10-13.md
docs/evidence/home-opening-byte-guard-decision-2026-10-21.md
docs/evidence/home-opening-graph-measurement-2026-10-20.md
docs/evidence/import-gold-approvals-ui.md
docs/evidence/import-gold-lab-2026-10-21.md
docs/evidence/import-gold-source-use-decision.md
docs/evidence/import-review-timing.md
docs/evidence/inventory-accounting-2026-10-22.md
docs/evidence/isolated-staging-2026-10-30.json
docs/evidence/isolated-staging-2026-10-30.md
docs/evidence/local-ai-evaluation-results-2026-10-16.md
docs/evidence/local-model-endpoint-setup-2026-10-08.md
docs/evidence/local-spec-import-benchmark-blocker-2026-10-02.md
docs/evidence/measure-home-opening-graph.mjs
docs/evidence/measure-home-opening-graph.test.mjs
docs/evidence/metadata-maintenance-native-validation.md
docs/evidence/metadata-platform-integration-2026-10-23.md
docs/evidence/operational-audit-boundary.md
docs/evidence/packaging-tracking-recovery.md
docs/evidence/per-pizza-advisory-review-2026-10-04.md
docs/evidence/pnpm-startup-verification.md
docs/evidence/production-delay-phase-attribution-2026-10-24.md
docs/evidence/production-stalls-2026-10-26.md
docs/evidence/provider-comparison-gate-review-2026-10-08.md
docs/evidence/published-background-db-investigation-2026-10-05.md
docs/evidence/published-background-db-investigation-2026-10-08.md
docs/evidence/published-identity-reconciliation-2026-10-26.md
docs/evidence/published-runtime-reliability-2026-10-24.md
docs/evidence/qc-slice-7-intelligence/coverage-check-map.md
docs/evidence/qc-slice-7-intelligence/desktop-chromium-browser-result.json
docs/evidence/qc-slice-7-intelligence/desktop-chromium-report.jpg
docs/evidence/qc-slice-7-intelligence/desktop-webkit-browser-result.json
docs/evidence/qc-slice-7-intelligence/desktop-webkit-report.jpg
docs/evidence/qc-slice-7-intelligence/failure-ledger.md
docs/evidence/qc-slice-7-intelligence/phone-chromium-browser-result.json
docs/evidence/qc-slice-7-intelligence/phone-chromium-report.jpg
docs/evidence/qc-slice-7-intelligence/phone-webkit-browser-result.json
docs/evidence/qc-slice-7-intelligence/phone-webkit-report.jpg
docs/evidence/qc-slice-7-intelligence/tablet-landscape-chromium-browser-result.json
docs/evidence/qc-slice-7-intelligence/tablet-landscape-chromium-report.jpg
docs/evidence/qc-slice-7-intelligence/tablet-landscape-webkit-browser-result.json
docs/evidence/qc-slice-7-intelligence/tablet-landscape-webkit-report.jpg
docs/evidence/qc-slice-7-intelligence/tablet-portrait-chromium-browser-result.json
docs/evidence/qc-slice-7-intelligence/tablet-portrait-chromium-report.jpg
docs/evidence/qc-slice-7-intelligence/tablet-portrait-webkit-browser-result.json
docs/evidence/qc-slice-7-intelligence/tablet-portrait-webkit-report.jpg
docs/evidence/reduced-browser-persistence.md
docs/evidence/release-identity-discovery-dry-run-2026-10-03.md
docs/evidence/reliability-closure-production-window.md
docs/evidence/reliability-closure-progress.md
docs/evidence/reliability-closure-task-register.json
docs/evidence/reproduce-typescript-7-comparison.sh
docs/evidence/review-defect-fixes-2026-10-03.md
docs/evidence/runtime-stalls-investigation-2026-10-21.md
docs/evidence/scheduled-check-database-latency-2026-10-31.md
docs/evidence/security-ci-report-dispositions-2026-10-24.md
docs/evidence/shared-update-live-observation-2026-10-26.md
docs/evidence/shared-update-observation-prerequisites-2026-10-26.md
docs/evidence/source-library-live-pool-capture-2026-10-08.json
docs/evidence/source-library-pool-diagnostics-2026-10-12-v2.json
docs/evidence/source-library-pool-live-capture-2026-10-12-v2.json
docs/evidence/source-library-pool-mismatch-diagnostics-2026-10-08.json
docs/evidence/source-library-pool-owner-approved-differences-2026-10-08.json
docs/evidence/source-library-pool-owner-approved-differences-2026-10-12-v2.json
docs/evidence/source-library-pool-owner-review-2026-10-08.md
docs/evidence/source-library-pool-owner-review-2026-10-12-v2.md
docs/evidence/sse-capacity-observation-2026-10-11.json
docs/evidence/sse-capacity-platform-metrics.template.json
docs/evidence/sse-capacity-reason-code-followup-2026-10-13.json
docs/evidence/sse-capacity-reason-code-followup-2026-10-14.json
docs/evidence/sse-topology-observation-2026-10-10.json
docs/evidence/sync-peer-fanout-2026-10-10.json
docs/evidence/sync-peer-fanout-2026-10-11.json
docs/evidence/typescript-7-comparison-2026-09-15-correction.md
docs/evidence/typescript-7-comparison-2026-09-15.json
docs/evidence/typescript-7-declaration-approvals.json
docs/evidence/typescript-7-declaration-contracts-current.json
docs/evidence/windows-metadata-maintenance-validation-2026-10-22.md
docs/evidence/workbook-import-retry/README.md
docs/evidence/workbook-import-retry/ai-provider.json
docs/evidence/workbook-import-retry/audit-report.md
docs/evidence/workbook-import-retry/failure-ledger.json
docs/evidence/workbook-import-retry/fallback-availability-diagnostics.jsonl
docs/evidence/workbook-import-retry/manifest.json
docs/evidence/workbook-import-retry/matrix.json
docs/evidence/workbook-import-retry/retry-attempt-01.json
docs/evidence/workbook-import-retry/retry-attempt-02.json
docs/evidence/workbook-import-retry/retry-attempt-03.json
docs/evidence/workbook-import-retry/retry-attempt-04.json
docs/evidence/workbook-import-retry/retry-attempt.json
docs/evidence/workbook-import-retry/retry-provider-telemetry-03.json
docs/evidence/workbook-import-retry/retry-provider-telemetry-04.json
docs/evidence/workbook-import-retry/retry-provider-telemetry.json
docs/evidence/workbook-import-retry/retry-runtime-errors.json
docs/evidence/workbook-import-retry/retry-verification.json
docs/external-skill-evaluation-brief-2026-10-23.md
docs/external-skill-research-2026-10-23.md
docs/external-skill-search-ledger-2026-10-23.md
docs/follow-up-dependency-submission.md
docs/follow-up-ordering-review.md
docs/frontline-supply-recovery-evidence.md
docs/full-browser-inventory.md
docs/further-research-2026-09-18.md
docs/gemini-skill-trigger-review-2026-10-07.md
docs/github-branch-state.md
docs/guarded-github-push.md
docs/guarded-master-data-undo.md
docs/home-architecture.md
docs/how-to-build-ai-research-2026-09-28.md
docs/how-to-build-an-ai-research-2026-09-28.md
docs/idea-backlog.md
docs/import-lifecycle-integrity-audit-2026-09-06.md
docs/import-system-plan.md
docs/import-template-downloads.md
docs/importer-redesign-plan.md
docs/improvement-research-2026-09-18.md
docs/incident-notifications-research.md
docs/ingredient-identity-resolution-2026-09-15.md
docs/inventory-autodeduction-plan.md
docs/inventory-gap-analysis.md
docs/isolated-staging.md
docs/line-transit-split-verification.md
docs/local-ai-deployment.md
docs/local-ai-evaluation.md
docs/local-ai-installation-research-2026-09-26.md
docs/manager-action-queue-performance.md
docs/master-data-health-audit-2026-08-24.md
docs/merge-suggest-research.md
docs/metadata-maintenance-macos.md
docs/mixed-workbook-review.md
docs/multi-day-lookahead-plan.md
docs/near-dup-hashing-research-2026-09-28.md
docs/next-app-decomposition-roadmap-2026-10-16.md
docs/node-26-compatibility-comparison-2026-10-06.json
docs/node-26-compatibility-evaluation-2026-10-06.md
docs/node-runtime-research-2026-10-14.md
docs/option-b-self-hosted-ai-deep-dive-2026-09-26.md
docs/overproduction-surplus-plan.md
docs/pre-implementation-research-pack-2026-09-19.md
docs/production-auto-track-history-audit-2026-09-14.md
docs/production-line/production-line.png
docs/production-reporting-plan.md
docs/pwa-plugin-vite-2-evaluation-2026-10-14.md
docs/pwa-update-repair-evidence.md
docs/qc-allergen-phase2-proposal.md
docs/qc-department-plan.md
docs/qc-responsive-repair-verification-2026-10-23.md
docs/qlora-distillation-techniques-2026-09-28.md
docs/qlora-unsloth-config-and-train-checklist-2026-09-28.md
docs/readiness-multi-instance-workload.md
docs/real-device-floor-controls.md
docs/reconciliation-report-2026-09-21.md
docs/reconciliation-report-2026-10-20.md
docs/reconnect-reliability-deep-dive-2026-09-19.md
docs/recovery-operations-parity.md
docs/release-evidence-handoff.md
docs/release-operations.md
docs/report-signing-key-rotation.md
docs/repository-cleanup-2026-08-25.md
docs/repository-quality-systems-audit-2026-09-06.md
docs/research-reconciliation/README.md
docs/research-reconciliation/app-wide-audit-2026-10-29.md
docs/research-reconciliation/coverage-ledger.md
docs/research-reconciliation/inventory.json
docs/research-reconciliation/inventory.py
docs/research-reconciliation/matrix.md
docs/research-reconciliation/primary-research.md
docs/research-reconciliation/published-inventory-boundary-2026-10-30.md
docs/research-reconciliation/published-inventory-staging-2026-10-30.json
docs/research-reconciliation/sources.md
docs/retained-ai-service-contracts.md
docs/schema-safe-rollback-rehearsal-evidence.md
docs/screen-off-wake-test-protocol.md
docs/second-pass-reviewer-benchmark-2026-09-05.json
docs/second-pass-reviewer-benchmark-2026-09-05.md
docs/second-pass-reviewer-benchmark-2026-10-06.json
docs/second-pass-reviewer-benchmark-2026-10-06.md
docs/second-pass-reviewer-live-observations-2026-09-05.json
docs/second-pass-reviewer-live-observations-2026-10-06.json
docs/security/braces-cve-2026-93687.md
docs/self-host/README.md
docs/self-host/auto-installer.md
docs/self-host/branch-audit.md
docs/self-host/fresh-build-profile.md
docs/self-host/integration-2026-10-31.md
docs/self-host/pr-usefulness-and-main-green.md
docs/self-host/preflight-and-build-boundary.md
docs/self-host/qualification.md
docs/self-host/windows-installer-phase-1.md
docs/server-live-state-authority.md
docs/server-research-2026-09-19.md
docs/server-research-deep-dive-2026-09-19.md
docs/shared-live-station-run-identity-verification.md
docs/shared-record-cache-execution.md
docs/skill-catalog-managed-warnings.md
docs/spec-import-gold-review.md
docs/staff-role-permissions-audit-2026-10-30.md
docs/stoppage-analytics-plan.md
docs/storage-sync-ownership.md
docs/superpowers/plans/2026-09-03-schema-safe-application-rollback-rehearsal.md
docs/superpowers/plans/2026-09-06-auto-track-engine.md
docs/superpowers/plans/2026-09-13-server-live-calc-stream-slice2.md
docs/superpowers/plans/2026-09-13-server-live-calc-stream-slice3.md
docs/superpowers/plans/2026-09-13-server-live-calc-stream.md
docs/superpowers/plans/2026-09-14-server-live-calc-stream-slice4.md
docs/superpowers/plans/2026-09-14-server-live-calc-stream-slice5.md
docs/superpowers/plans/2026-09-14-server-live-calc-stream-slice6.md
docs/superpowers/plans/2026-09-14-server-warehouse-coverage-runlines.md
docs/superpowers/plans/2026-09-15-mix-surplus-ledger.md
docs/superpowers/plans/2026-10-03-automatic-build-version-reporting.md
docs/superpowers/plans/2026-10-03-source-based-readiness-identity.md
docs/superpowers/plans/2026-10-05-source-library-capture-endpoint-plan.md
docs/superpowers/specs/2026-08-17-hide-zero-pull-ingredient-prep-design.md
docs/superpowers/specs/2026-08-20-production-data-health-check-design.md
docs/superpowers/specs/2026-08-20-spec-import-profile-repair-design.md
docs/superpowers/specs/2026-08-21-e2e-isolation-design.md
docs/superpowers/specs/2026-08-22-crb-variant-matching-design.md
docs/superpowers/specs/2026-08-22-home-screen-performance-design.md
docs/superpowers/specs/2026-08-22-recovery-audit-design.md
docs/superpowers/specs/2026-08-22-release-check-design.md
docs/superpowers/specs/2026-08-25-gemini-live-failure-alert-design.md
docs/superpowers/specs/2026-08-25-gemini-manual-skill-trigger-design.md
docs/superpowers/specs/2026-08-27-data-health-workspace-design.md
docs/superpowers/specs/2026-08-27-packaging-autotrack-pause-handoff-design.md
docs/superpowers/specs/2026-09-02-ingredient-catalog-dedupe-design.md
docs/superpowers/specs/2026-09-02-release-concurrency-stress-design.md
docs/superpowers/specs/2026-09-03-physical-line-pause-resume-design.md
docs/superpowers/specs/2026-09-03-schema-safe-application-rollback-rehearsal-design.md
docs/superpowers/specs/2026-09-04-cross-run-progress-isolation-design.md
docs/superpowers/specs/2026-09-05-warehouse-inventory-navigation-design.md
docs/superpowers/specs/2026-09-06-auto-track-engine-decomposition-design.md
docs/superpowers/specs/2026-09-07-recipe-unit-confirmation-design.md
docs/superpowers/specs/2026-09-08-source-reconciliation-manager-owned-batch-size-design.md
docs/superpowers/specs/2026-09-09-recipe-pool-freshness-fence-design.md
docs/superpowers/specs/2026-09-13-server-live-calc-stream-design.md
docs/superpowers/specs/2026-09-13-server-live-calc-stream-slice2-design.md
docs/superpowers/specs/2026-09-13-server-live-calc-stream-slice3-design.md
docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice4-design.md
docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice5-design.md
docs/superpowers/specs/2026-09-14-server-live-calc-stream-slice6-design.md
docs/superpowers/specs/2026-09-14-server-warehouse-coverage-runlines-design.md
docs/superpowers/specs/2026-09-15-mix-surplus-ledger-design.md
docs/superpowers/specs/2026-09-16-sse-schedule-lease-refresh-design.md
docs/superpowers/specs/2026-09-24-release-full-browser-regressions-design.md
docs/superpowers/specs/2026-09-24-screen-off-wake-section-snapshots-design.md
docs/superpowers/specs/2026-09-29-release-workflow-staging-design.md
docs/superpowers/specs/2026-10-02-ai-corrections-evaluation-data-design.md
docs/superpowers/specs/2026-10-02-responsive-webkit-debug-evidence-design.md
docs/superpowers/specs/2026-10-02-sauce-recipe-refresh-e2e-startup-design.md
docs/superpowers/specs/2026-10-03-automatic-build-version-reporting-design.md
docs/superpowers/specs/2026-10-03-source-based-readiness-identity-design.md
docs/superpowers/specs/2026-10-04-per-pizza-advisory-review-design.md
docs/superpowers/specs/2026-10-05-ingredient-allergen-foundation-design.md
docs/superpowers/specs/2026-10-05-selected-pending-profile-snapshot-design.md
docs/superpowers/specs/2026-10-05-source-library-capture-endpoint-design.md
docs/superpowers/specs/2026-10-05-toolchain-browser-release-blockers-design.md
docs/superpowers/specs/2026-10-06-applicator-stock-on-hand-design.md
docs/superpowers/specs/2026-10-06-release-verification-recovery-design.md
docs/sync-convergence-soak.md
docs/sync-deep-dive-2026-09-19.md
docs/sync-health-sentinel.md
docs/sync-recovery-performance-2026-10-19.md
docs/sync-reliability-unified-plan-2026-09-19.md
docs/sync-system-improvements-plan.md
docs/sync-top-level-merge-inventory-2026-10-08.md
docs/sync-tracking-baseline-2026-10-26.md
docs/test-lane-catalog.json
docs/test-release-matrix.md
docs/testing-skill-multi-device-evaluation.json
docs/toolchain-evaluation-2026-10-04.md
docs/typescript-7-migration-research.md
docs/typescript-7-resource-approval-evidence.json
docs/updated-canvas-app-audit.md
docs/uptime-and-operational-backlog-decision-2026-10-02.md
docs/web-navigation-notices-audit.md
docs/web-push-registration-telemetry.md
docs/windows-metadata-maintenance.md
docs/zip-asset-review-2026-09-14.md
```

</details>

<details>
<summary>release-evidence — 11 paths</summary>

```text
release-evidence/ai-evaluations/deterministic-import-corpus.json
release-evidence/ai-evaluations/docs/second-pass-reviewer-benchmark-2026-09-05.json
release-evidence/ai-evaluations/docs/second-pass-reviewer-benchmark-2026-10-06.json
release-evidence/browser-full/FINAL-REPORT.md
release-evidence/readiness-recovery/README.md
release-evidence/readiness-recovery/readiness-recovery.json
release-evidence/screen-off-wake/FINAL-REPORT.md
release-evidence/source-library-reconciliation.json
release-evidence/sse-topology-observation-2026-10-09.json
release-evidence/typescript-7-comparison.json
release-evidence/web-push-license-approval-2026-10-09.md
```

</details>

<details>
<summary>research — 51 paths</summary>

```text
research/additional-domain-research-synthesis-2026-09-19.md
research/ai-readiness-policy-research.md
research/db-pool-topology-research.md
research/deep-dive-research-continuation-2026-09-19.md
research/gap-readiness-dependency.md
research/gap-replit-sse-contract.md
research/notes.md
research/reconnect-causality-research.md
research/sources.json
research/sources/ai-readiness-01-kubernetes-probes.md
research/sources/ai-readiness-02-aws-graceful-degradation.md
research/sources/ai-readiness-04-microsoft-circuit-breaker.md
research/sources/ai-readiness-05-openai-errors.md
research/sources/ai-readiness-06-google-sre-slos.md
research/sources/gapfill-authoritative-snippets.md
research/sources/gapfill-aws-graceful-degradation-02.md
research/sources/gapfill-kubernetes-readiness-01.md
research/sources/gapfill-replit-01-deployment-types.md
research/sources/gapfill-replit-02-autoscale.md
research/sources/gapfill-replit-03-reserved-vm.md
research/sources/payload-01-rfc6902.md
research/sources/payload-02-rfc7396.md
research/sources/payload-03-http-compression.md
research/sources/payload-04-sse-standard.md
research/sources/payload-05-google-sre-percentiles.md
research/sources/payload-06-otel-metrics.md
research/sources/pool-01-node-postgres-sizing.md
research/sources/pool-04-pgbouncer-usage.md
research/sources/pool-05-pgbouncer-config.md
research/sources/pool-06-node-postgres-api.md
research/sources/pool-07-postgresql-connections.md
research/sources/pool-08-replit-deployment-types.md
research/sources/pool-09-postgresql-limits.md
research/sources/pool-10-node-postgres-github.md
research/sources/pool-11-replit-autoscale.md
research/sources/reconnect-01-rfc9110.md
research/sources/reconnect-02-azure-concurrency.md
research/sources/reconnect-03-hlc-usenix.md
research/sources/reconnect-04-lamport-clocks.md
research/sources/reconnect-05-node-postgres-pool.md
research/sources/sse-01-replit-deployment-types.md
research/sources/sse-02-whatwg-eventsource.md
research/sources/sse-03-mdn-using-sse.md
research/sources/sse-04-nginx-proxy-module.md
research/sources/sse-05-node-http.md
research/sources/sse-06-redis-pubsub.md
research/sources/sse-07-w3c-eventsource.md
research/sse-deployment-research.md
research/sse-scale-verification-2026-09-20.md
research/sync-payload-research.md
research/sync-reliability-operations-deep-dive-2026-09-19.md
```

</details>

<details>
<summary>root/other — 38 paths</summary>

```text
README.md
gemini-skill-trigger-benchmark.json
gemini-skill-trigger-benchmark.md
lib/db/dev/README.md
lib/distill-dataset/README.md
release-evidence-archive/expired/published-deployment-handoff-2026-09-24.json
release-evidence-archive/stale-browser-diagnostic-2026-09-28-0138/FINAL-REPORT.md
release-evidence-archive/stale-full-2026-09-14/evidence/browser-full/FINAL-REPORT.md
release-evidence-archive/stale-full-2026-09-14/evidence/browser-smoke/webkit-result.json
release-evidence-archive/stale-full-2026-09-14/evidence/clean-start/browser-result.json
release-evidence-archive/stale-full-2026-09-14/evidence/clean-start/clean-start-evidence.json
release-evidence-archive/stale-full-2026-09-14/evidence/clean-start/preview-home.png
release-evidence-archive/stale-full-2026-09-14/evidence/release-check-checkpoint.md
release-evidence-archive/stale-full-2026-09-14/evidence/release-check-report.md
release-evidence-archive/stale-full-2026-09-14/evidence/release-check-state.json
release-evidence-archive/stale-full-2026-09-14/evidence/report-key-rotation-preflight.json
release-evidence-archive/stale-full-2026-09-14/evidence/source-library-reconciliation.json
release-evidence-archive/stale-full-2026-09-14/evidence/typescript-7-comparison.json
release-evidence-current/preview-api-health.jpg
release-evidence-current/preview-web.jpg
release-evidence-task2593-standard-clean/browser-smoke/webkit-result.json
release-evidence-task2593-standard-clean/clean-start/browser-result.json
release-evidence-task2593-standard-clean/clean-start/clean-start-evidence.json
release-evidence-task2593-standard-clean/clean-start/preview-home.png
release-evidence-task2593-standard-clean/release-check-checkpoint.md
release-evidence-task2593-standard-clean/release-check-state.json
release-evidence-task2593-standard-clean/release-speed-analysis.md
release-evidence-task2593-standard-clean/report-key-rotation-preflight.json
release-evidence-task2593-standard/clean-start/browser-result.json
release-evidence-task2593-standard/clean-start/clean-start-evidence.json
release-evidence-task2593-standard/clean-start/preview-home.png
release-evidence-task2593-standard/release-check-state.json
release-evidence-task2593-standard/report-key-rotation-preflight.json
release-evidence-typescript-7-promotion/release-check-checkpoint.md
release-evidence-typescript-7-promotion/release-check-state.json
release-evidence-typescript-7-promotion/report-key-rotation-preflight.json
skill-trigger-benchmark.json
skill-trigger-benchmark.md
```

</details>

<details>
<summary>scripts — 3 paths</summary>

```text
scripts/src/release-evidence-handoff.mts
scripts/src/release-evidence-handoff.test.mts
scripts/src/release-evidence.test.mts
```

</details>

### C.2 `Replit-v2-main` — 383 paths @ `7413225e5577a952570f37c207e6c940166c8e61`

<details>
<summary>.agents/memory — 275 paths</summary>

```text
.agents/memory/MEMORY.md
.agents/memory/a11y-coverage-gate.md
.agents/memory/a11y-dialog-browser-fixtures.md
.agents/memory/a11y-reload-fixtures.md
.agents/memory/additive-push-force-schema.md
.agents/memory/ai-corrections-full-coverage.md
.agents/memory/ai-data-not-in-day-state.md
.agents/memory/ai-json-retry.md
.agents/memory/ai-match-import.md
.agents/memory/ai-memory-health-audits.md
.agents/memory/ai-model-routing-and-streaming.md
.agents/memory/ai-optimize-assistant.md
.agents/memory/ai-reviewer-and-corrections.md
.agents/memory/alias-kind-contract-lockstep.md
.agents/memory/allergen-tracking.md
.agents/memory/android-keyboard-avoidance.md
.agents/memory/api-json-error-handler.md
.agents/memory/applicator-tolerance-columns.md
.agents/memory/ask-the-day-chat.md
.agents/memory/auth-identity-cache.md
.agents/memory/autosave-edit-attribution.md
.agents/memory/autotrack-over-provisioning.md
.agents/memory/autotrack-remainder-carry.md
.agents/memory/autotrack-stale-delta.md
.agents/memory/autotrack-zero-seed.md
.agents/memory/batch-upsert-transaction.md
.agents/memory/brand-fan-linked-name-narrowing.md
.agents/memory/brand-profile-server-pool.md
.agents/memory/brand-quote-typo-fold.md
.agents/memory/brand-rename-aliases.md
.agents/memory/brand-scoped-import-names.md
.agents/memory/browser-fixture-seeding.md
.agents/memory/browser-sync-workflow-startup.md
.agents/memory/browser-timer-fixtures.md
.agents/memory/button-default-submit-footgun.md
.agents/memory/cases-line-occupancy.md
.agents/memory/cast-screens.md
.agents/memory/cheese-catch-all-flavors.md
.agents/memory/cheese-import-link-to-existing.md
.agents/memory/cheese-mirror-applicators.md
.agents/memory/cheese-server-master-data.md
.agents/memory/cheese-share-oz-basis.md
.agents/memory/clerk-auth-gating.md
.agents/memory/cold-start-import-hang.md
.agents/memory/configuration-recovery-scope.md
.agents/memory/corpus-harness.md
.agents/memory/correcting-import-alias-cleanup.md
.agents/memory/cross-channel-auto-track-claims.md
.agents/memory/cross-run-autosave-contamination.md
.agents/memory/crust-dough-name-backstop.md
.agents/memory/crust-run-no-dough-batches.md
.agents/memory/cycle-count.md
.agents/memory/daily-reset-auth-boundary.md
.agents/memory/daily-reset-trigger.md
.agents/memory/db-integration-test-harness.md
.agents/memory/delayed-onboarding-overlay.md
.agents/memory/delete-undelete-stamps.md
.agents/memory/deletion-tombstones.md
.agents/memory/demand-forecast.md
.agents/memory/detached-process-reaping.md
.agents/memory/deterministic-ai-gates.md
.agents/memory/dev-db-connection-exhaustion.md
.agents/memory/die-defaults-switch-aware.md
.agents/memory/die-picker-e2e-names.md
.agents/memory/die-size-source.md
.agents/memory/die-type-master-heal.md
.agents/memory/die-types-merge-exclusion.md
.agents/memory/dough-family-collapse.md
.agents/memory/dough-inline-timers.md
.agents/memory/dough-sauce-server-master-data.md
.agents/memory/dough-weight-server-pool.md
.agents/memory/doughball-variant-customers-matching.md
.agents/memory/doughball-variants.md
.agents/memory/downtime-trends.md
.agents/memory/draining-run-selection.md
.agents/memory/dropdown-scroll-snap.md
.agents/memory/esbuild-override-placement.md
.agents/memory/excel-import-export.md
.agents/memory/expo-secure-store-web-crash.md
.agents/memory/fill-missing-assistant.md
.agents/memory/fill-missing-shared-lib.md
.agents/memory/floor-mode.md
.agents/memory/forecast-accuracy.md
.agents/memory/formula-import-safety.md
.agents/memory/freezer-phase-indicators.md
.agents/memory/freezer-pull.md
.agents/memory/freezer-wip-completion.md
.agents/memory/frontline-formula-parity.md
.agents/memory/frontline-is-sauce.md
.agents/memory/generic-jsx-breaks-metadata-plugin.md
.agents/memory/github-actions-connector-quirk.md
.agents/memory/github-actions-job-summary-visibility.md
.agents/memory/github-external-fork-verification.md
.agents/memory/github-git-push.md
.agents/memory/hmr-context-split.md
.agents/memory/home-render-tdz.md
.agents/memory/import-gen-guard.md
.agents/memory/import-order-dedup-keys.md
.agents/memory/import-redirect-aliases.md
.agents/memory/import-run-merge.md
.agents/memory/import-schedule-date-default.md
.agents/memory/import-source-file-semantics.md
.agents/memory/importer-audit-recovery.md
.agents/memory/incident-diagnosis.md
.agents/memory/ingredient-batch-weights.md
.agents/memory/ingredient-catalog.md
.agents/memory/ingredient-dedupe.md
.agents/memory/ingredient-merge.md
.agents/memory/integration-test-db-binding.md
.agents/memory/inventory-consume-idempotency.md
.agents/memory/inventory-math-shared-lib.md
.agents/memory/inventory-settings-concurrency.md
.agents/memory/isolated-db-may-predate-migrations.md
.agents/memory/isolated-destructive-browser-tests.md
.agents/memory/large-source-audit-captures.md
.agents/memory/learned-import-aliases.md
.agents/memory/learned-memory-pattern.md
.agents/memory/line-station-order.md
.agents/memory/live-run-context-clock-isolation.md
.agents/memory/live-sync-web-mobile.md
.agents/memory/local-to-server-name-consolidation.md
.agents/memory/master-data-health-ownership.md
.agents/memory/merge-category-tabs.md
.agents/memory/merge-deny-and-change-history.md
.agents/memory/merge-server-master-data-repoint.md
.agents/memory/merge-suggest.md
.agents/memory/merge-target-must-survive.md
.agents/memory/merge-tombstones.md
.agents/memory/mix-applicator-slots.md
.agents/memory/mix-reconcile.md
.agents/memory/mixes.md
.agents/memory/mixseed-alias-set.md
.agents/memory/mobile-module-tdz-cycle.md
.agents/memory/mobile-require-cycle-init.md
.agents/memory/mobile-run-context-v2.md
.agents/memory/mobile-seed-ordering.md
.agents/memory/mobile-select-field.md
.agents/memory/mockup-graduation-inline.md
.agents/memory/mounted-ai-cost-paths.md
.agents/memory/multi-file-ai-import.md
.agents/memory/multi-location-inventory.md
.agents/memory/multi-sheet-schedule-import.md
.agents/memory/name-match-near-dup.md
.agents/memory/natural-pep-name-poison.md
.agents/memory/nav-structure.md
.agents/memory/near-dup-scan-perf.md
.agents/memory/near-exact-link-profile-propagation.md
.agents/memory/no-store-cache-headers.md
.agents/memory/notification-prefs.md
.agents/memory/notification-view-refire.md
.agents/memory/observability-safe-events.md
.agents/memory/onboarding-seen-flag.md
.agents/memory/one-time-data-heals.md
.agents/memory/one-time-data-purge.md
.agents/memory/open-form-profile-clobber.md
.agents/memory/orval-query-coerce-quirk.md
.agents/memory/packaging-pause-clock-handoff.md
.agents/memory/packaging-settings.md
.agents/memory/packaging-speed-feedback.md
.agents/memory/partial-sync-contract.md
.agents/memory/password-change-session-invalidation.md
.agents/memory/password-reset-relay.md
.agents/memory/pep-applicator-combine.md
.agents/memory/phantom-recipe-names.md
.agents/memory/phone-e2e-form-overrides.md
.agents/memory/photo-stock-intake.md
.agents/memory/playwright-offline-sse.md
.agents/memory/post-merge-setup.md
.agents/memory/premix-import.md
.agents/memory/press-done-model.md
.agents/memory/proactive-alerts.md
.agents/memory/production-line-canvas-reference.md
.agents/memory/production-rules.md
.agents/memory/profile-autofill-from-saved-sheets.md
.agents/memory/profile-cleanup-migration.md
.agents/memory/profile-clobber-blank-form.md
.agents/memory/profile-force-apply.md
.agents/memory/profile-write-gating.md
.agents/memory/pwa-update-prompts.md
.agents/memory/quality-and-waste-ai.md
.agents/memory/queue-history-cursor-precision.md
.agents/memory/rate-limit-shared-store.md
.agents/memory/ready-made-sauce.md
.agents/memory/recipe-apply-shared-lib.md
.agents/memory/recipe-assistant.md
.agents/memory/recipe-merge-sync-receive.md
.agents/memory/recipe-name-only-attachment.md
.agents/memory/recipe-print-share.md
.agents/memory/release-browser-coverage-contract.md
.agents/memory/release-browser-evidence.md
.agents/memory/release-check-shard-budget.md
.agents/memory/release-evidence-isolation.md
.agents/memory/release-evidence-verifier-mode.md
.agents/memory/render-clock-split.md
.agents/memory/reorder-list.md
.agents/memory/reset-request-nav-badge.md
.agents/memory/revision-bound-release-evidence.md
.agents/memory/rn-custom-font-weights.md
.agents/memory/role-gating.md
.agents/memory/run-calc-parity-test.md
.agents/memory/run-complete-alert-timing.md
.agents/memory/run-list-loss-protection.md
.agents/memory/run-meta-lww.md
.agents/memory/same-name-pool-dups.md
.agents/memory/sandbox-auto-refresh.md
.agents/memory/sandbox-isolation-test.md
.agents/memory/sandbox-scope-isolation.md
.agents/memory/sauce-barrel-breakdown-signature.md
.agents/memory/saved-spec-reconcile.md
.agents/memory/saved-spec-snapshot-prune.md
.agents/memory/schedule-import-401.md
.agents/memory/schedule-move-canonical-writes.md
.agents/memory/schedule-move.md
.agents/memory/schedule-timezone.md
.agents/memory/scheduled-day-client-date.md
.agents/memory/scheduled-day-response-validation.md
.agents/memory/scheduled-recipe-check.md
.agents/memory/scheduled-run-profile-snapshot.md
.agents/memory/secret-refresh-shell.md
.agents/memory/seeded-placeholder-runs.md
.agents/memory/server-empty-over-populated-guard.md
.agents/memory/server-templates-supervisor-pin.md
.agents/memory/setup-profiles-editor.md
.agents/memory/shared-ai-memory.md
.agents/memory/shell-lint-inventory.md
.agents/memory/shipping-guide-import.md
.agents/memory/signup-bootstrap-hardening.md
.agents/memory/skill-catalog-ci-roots.md
.agents/memory/source-audit-report-versions.md
.agents/memory/source-workbook-layouts.md
.agents/memory/spec-alias-hygiene.md
.agents/memory/spec-export.md
.agents/memory/spec-import-batch-vs-perpizza.md
.agents/memory/spec-import-brand-backfill.md
.agents/memory/spec-import-chunk-union.md
.agents/memory/spec-import-hash-reuse.md
.agents/memory/spec-import-name-first-relink.md
.agents/memory/spec-import-name-link-authority.md
.agents/memory/spec-import-scale-harness.md
.agents/memory/spec-import-seed-pattern.md
.agents/memory/spec-import-stub-pollution.md
.agents/memory/spec-import.md
.agents/memory/spec-preset-seeding.md
.agents/memory/spec-reimport-rename-memory.md
.agents/memory/spec-wins-recipe-overwrite.md
.agents/memory/sse-disconnect-registration.md
.agents/memory/sse-meta-stamp-source.md
.agents/memory/stick-pep-types.md
.agents/memory/strict-profile-ack.md
.agents/memory/supervisor-pin-vs-role.md
.agents/memory/sync-async-crash-safety.md
.agents/memory/sync-body-limit.md
.agents/memory/sync-first-load-form-heal.md
.agents/memory/sync-http-failure-handling.md
.agents/memory/sync-integration-reset-isolation.md
.agents/memory/sync-reset-boundary-hardening.md
.agents/memory/sync-retry-storms.md
.agents/memory/sync-snapshot-identity.md
.agents/memory/temp-substitutions.md
.agents/memory/today-schedule-edit-live-path.md
.agents/memory/unified-setup-editing.md
.agents/memory/v2-product-boundaries.md
.agents/memory/version-capability-catalog.md
.agents/memory/visual-regression-baselines.md
.agents/memory/voice-ask-input.md
.agents/memory/voice-ask-output.md
.agents/memory/voice-command-e2e-seam.md
.agents/memory/voice-commands.md
.agents/memory/warehouse-staging-checklist.md
.agents/memory/web-brand-palette.md
.agents/memory/web-form-button-submit-reload.md
.agents/memory/web-mobile-parity.md
.agents/memory/web-test-harness.md
.agents/memory/webkit-gio-tls-runtime.md
.agents/memory/xlsx-audit-false-positive.md
```

</details>

<details>
<summary>.agents/skills — 2 paths</summary>

```text
.agents/skills/README.md
.agents/skills/skill-audit-2026-08.md
```

</details>

<details>
<summary>artifacts — 7 paths</summary>

```text
artifacts/release-evidence/optimized-calculator-preview-after-proxy-fix.jpg
artifacts/release-evidence/optimized-calculator-preview.jpg
artifacts/run-calculator/docs/performance-audit-2026-08-23.md
artifacts/run-calculator/docs/performance-budgets.md
artifacts/run-calculator/e2e/README.md
artifacts/run-calculator/release-evidence/preview-home.jpg
artifacts/run-calculator/src/departments/README.md
```

</details>

<details>
<summary>docs — 35 paths</summary>

```text
docs/capabilities/README.md
docs/capabilities/V3-START-CHECKLIST.md
docs/capabilities/catalog.json
docs/capabilities/summary.md
docs/dependency-security-remediation.md
docs/guarded-github-push.md
docs/home-architecture.md
docs/manager-action-queue-performance.md
docs/master-data-health-audit-2026-08-24.md
docs/recovery-operations-parity.md
docs/recovery/v2-development-activation-plan.md
docs/recovery/v2-restoration-2026-11-19.md
docs/release-operations.md
docs/repository-cleanup-2026-08-25.md
docs/screen-off-wake-test-protocol.md
docs/superpowers/specs/2026-08-17-hide-zero-pull-ingredient-prep-design.md
docs/superpowers/specs/2026-08-20-production-data-health-check-design.md
docs/superpowers/specs/2026-08-20-spec-import-profile-repair-design.md
docs/superpowers/specs/2026-08-21-e2e-isolation-design.md
docs/superpowers/specs/2026-08-22-crb-variant-matching-design.md
docs/superpowers/specs/2026-08-22-home-screen-performance-design.md
docs/superpowers/specs/2026-08-22-recovery-audit-design.md
docs/superpowers/specs/2026-08-22-release-check-design.md
docs/superpowers/specs/2026-08-25-gemini-live-failure-alert-design.md
docs/superpowers/specs/2026-08-25-gemini-manual-skill-trigger-design.md
docs/superpowers/specs/2026-08-27-data-health-workspace-design.md
docs/superpowers/specs/2026-08-27-packaging-autotrack-pause-handoff-design.md
docs/superpowers/specs/2026-09-02-ingredient-catalog-dedupe-design.md
docs/superpowers/specs/2026-09-02-release-concurrency-stress-design.md
docs/superpowers/specs/2026-11-19-portable-capability-catalog-design.md
docs/sync-convergence-soak.md
docs/test-release-matrix.md
docs/testing-skill-multi-device-evaluation.json
docs/updated-canvas-app-audit.md
docs/web-navigation-notices-audit.md
```

</details>

<details>
<summary>release-evidence — 3 paths</summary>

```text
release-evidence/browser-full/FINAL-REPORT.md
release-evidence/browser-smoke/webkit-result.json
release-evidence/report-key-rotation-preflight.json
```

</details>

<details>
<summary>research — 4 paths</summary>

```text
research/v2-server-architecture.md
research/v2-server-architecture/notes.md
research/v2-server-architecture/production-evidence.md
research/v2-server-architecture/replit-feasibility.md
```

</details>

<details>
<summary>root/other — 6 paths</summary>

```text
README.md
_archived/v1/artifacts/run-calculator/generated-artifacts/offline-tool-trace.2TFOcC/report.json
gemini-skill-trigger-benchmark.json
gemini-skill-trigger-benchmark.md
skill-trigger-benchmark.json
skill-trigger-benchmark.md
```

</details>

<details>
<summary>scripts — 1 paths</summary>

```text
scripts/src/release-evidence.test.mts
```

</details>

<details>
<summary>v2 — 3 paths</summary>

```text
v2/HANDOFF.md
v2/READINESS-REPORT.md
v2/README.md
```

</details>

<details>
<summary>v2/research — 9 paths</summary>

```text
v2/research/NEXT-PHASE-HANDOFF.md
v2/research/README.md
v2/research/gaps.md
v2/research/roadmap.md
v2/research/source-catalog.json
v2/research/source-catalog.md
v2/research/v1-import-source-matrix.md
v2/research/v1-to-v2.md
v2/research/validation.md
```

</details>

<details>
<summary>v2/research/archive — 38 paths</summary>

```text
v2/research/archive/README.md
v2/research/archive/repo-mirror/.agents/memory/v2-scope.md
v2/research/archive/repo-mirror/attached_assets/FULL-PLAN-production-run-calculator-2026-10-03_1791084665943.md
v2/research/archive/repo-mirror/docs/evidence/audited-import-safety.md
v2/research/archive/repo-mirror/docs/evidence/home-opening-byte-guard-decision-2026-10-21.md
v2/research/archive/repo-mirror/docs/evidence/home-opening-graph-measurement-2026-10-20.md
v2/research/archive/repo-mirror/docs/evidence/inventory-accounting-2026-10-22.md
v2/research/archive/repo-mirror/docs/evidence/published-background-db-investigation-2026-10-08.md
v2/research/archive/repo-mirror/docs/idea-backlog.md
v2/research/archive/repo-mirror/docs/import-system-plan.md
v2/research/archive/repo-mirror/docs/import-template-downloads.md
v2/research/archive/repo-mirror/docs/inventory-autodeduction-plan.md
v2/research/archive/repo-mirror/docs/mixed-workbook-review.md
v2/research/archive/repo-mirror/docs/next-app-decomposition-roadmap-2026-10-16.md
v2/research/archive/repo-mirror/docs/research-reconciliation/app-wide-audit-2026-10-29.md
v2/research/archive/repo-mirror/docs/research-reconciliation/coverage-ledger.md
v2/research/archive/repo-mirror/research/additional-domain-research-synthesis-2026-09-19.md
v2/research/archive/repo-mirror/research/sources/v2-mdn-page-visibility.md
v2/research/archive/repo-mirror/research/sources/v2-replit-artifact-vs-project.md
v2/research/archive/repo-mirror/research/sources/v2-replit-artifacts.md
v2/research/archive/repo-mirror/research/sources/v2-replit-autoscale.md
v2/research/archive/repo-mirror/research/sources/v2-replit-deployment-types.md
v2/research/archive/repo-mirror/research/sources/v2-replit-projects.md
v2/research/archive/repo-mirror/research/sources/v2-replit-publishing-overview.md
v2/research/archive/repo-mirror/research/sources/v2-replit-reserved-vm.md
v2/research/archive/repo-mirror/research/v2-server-architecture.md
v2/research/archive/repo-mirror/research/v2-server-architecture/production-evidence.md
v2/research/archive/repo-mirror/research/v2-server-architecture/replit-feasibility.md
v2/research/archive/task-records/3715.md
v2/research/archive/task-records/3907.md
v2/research/archive/task-records/3908.md
v2/research/archive/task-records/3909.md
v2/research/archive/task-records/3910.md
v2/research/archive/task-records/3911.md
v2/research/archive/task-records/3912.md
v2/research/archive/task-records/3913.md
v2/research/archive/task-records/3914.md
v2/research/archive/task-records/3915.md
```

</details>

### C.3 `Lucias-production-assistant-v2` — 37 paths @ `e3ab0880ed95b7e0a9581b2ca9f7da368d11c8c1`

<details>
<summary>.agents/memory — 20 paths</summary>

```text
.agents/memory/MEMORY.md
.agents/memory/api-integration-test-runner.md
.agents/memory/authenticated-browser-notebooks.md
.agents/memory/deferred-visual-verification.md
.agents/memory/dependabot-catalog-updates.md
.agents/memory/drizzle-kit-push-composite-pk-params.md
.agents/memory/drizzle-push-safeguards.md
.agents/memory/enum-addition-publish-staging.md
.agents/memory/import-to-run-flow.md
.agents/memory/pnpm-patched-lockfile-compatibility.md
.agents/memory/pnpm9-override-location.md
.agents/memory/product-quality-tolerances.md
.agents/memory/product-setup-provenance.md
.agents/memory/profile-edit-concurrency.md
.agents/memory/publish-check-constraint-formatting.md
.agents/memory/pwa-update-activation.md
.agents/memory/station-count-requirement-scaling.md
.agents/memory/station-timer-behavior.md
.agents/memory/temporary-esm-integration-bundles.md
.agents/memory/vm-replacement-overlap-evidence.md
```

</details>

<details>
<summary>.github — 1 paths</summary>

```text
.github/README.md
```

</details>

<details>
<summary>artifacts — 1 paths</summary>

```text
artifacts/lucia-production-assistant-v2/test/browser/README.md
```

</details>

<details>
<summary>docs — 15 paths</summary>

```text
docs/evidence/purpose-completion/WP0-notes.md
docs/evidence/purpose-completion/WP1-notes.md
docs/evidence/purpose-completion/WP2-notes.md
docs/evidence/purpose-completion/WP3-notes.md
docs/evidence/purpose-completion/WP4-notes.md
docs/evidence/purpose-completion/WP5-notes.md
docs/evidence/purpose-completion/WP6-notes.md
docs/evidence/purpose-completion/WP7-notes.md
docs/facility-role-permissions.md
docs/purpose-completion-status.md
docs/replit-github-sync.md
docs/schedule-import-browser-verification.md
docs/ux/upgraded-v1-acceptance.md
docs/ux/v1-feel-reference.md
docs/v2-reserved-vm-pilot-evidence.md
```

</details>

### C.4 `local-coding-assistant` — 17 paths @ `4a3a9b5e1326f76bcabea74bcecf5aa9ff42007c`

<details>
<summary>docs — 14 paths</summary>

```text
docs/coding-assistant/capabilities.md
docs/coding-assistant/coding-assistant-useful-items-install.md
docs/coding-assistant/context/getting-started.md
docs/coding-assistant/context/test-release-matrix.md
docs/coding-assistant/context/threat_model.md
docs/coding-assistant/context/web-navigation-notices-audit.md
docs/coding-assistant/context/web-push-registration-telemetry.md
docs/coding-assistant/default-repo.md
docs/coding-assistant/examples/task-drop.json
docs/coding-assistant/fixtures/host-report-candidate-7b.json
docs/coding-assistant/host-report-contract.md
docs/coding-assistant/opencode-readonly.example.json
docs/coding-assistant/opencode-recommended.example.json
docs/coding-assistant/pilot-runbook.md
```

</details>

<details>
<summary>root/other — 1 paths</summary>

```text
README.md
```

</details>

<details>
<summary>scripts — 2 paths</summary>

```text
scripts/ca/README.md
scripts/ca/helpers/README.md
```

</details>

## Appendix D — Operational and safety boundaries

- Never force-push `main`; do not alter branch protections or bypass required checks without explicit authorization.
- Do not directly change Replit or `main` for an old synchronization plan. Do not replay superseded branches or migrations.
- No production database operation or cutover is authorized by this report. Local migration success is not production/Replit Publish compatibility evidence.
- Only the authorized Replit deployment route publishes the active V1 production app. Source recovery, CI, Docker, and GHCR research do not publish anything.
- Do not weaken tests or claim unrun, skipped, blocked, historical, or environment-specific checks as current passes.
- PR #129 is validation-only. PR #163 is a draft with its own unresolved native/runtime gates. Historical PR #142/#145/#146 authorizations do not transfer to new work.
- Do not commit credentials, connection strings, cookies, raw operational records, protected build-source bytes, or private reviewed inputs. Keep ignored operational reconciliation files out of commits.
- Never paste tokens into chat or embed them in an installer. Any later fine-grained PAT must be repository-scoped with minimum access, stored with chmod 600 where applicable, never echoed, scrubbed after use, and deleted/rotated by the user afterward.
- Do not disable Windows security, SmartScreen, execution-policy protections, TLS validation, firewall protection, or certificate warnings.
- Do not expose PostgreSQL or Ollama host ports. Do not automatically overwrite/delete an existing installation or database.
- Do not contact live AI providers merely because credentials exist. Do not copy V1 credentials, sessions, production data, historical runs, or inventory balances into either V2 line.
- Avoid conflicting edits in work owned by another active task. Branch drift discovered during research is not authorization to start a fix.

## Appendix E — Coverage checklist

- [x] Four repositories represented.
- [x] 77 current branches represented in Appendix A.
- [x] Branch-to-PR disposition, divergence, changed-area counts, dates, and research counts included.
- [x] 555 unique PRC branch-only research paths indexed in Appendix B.
- [x] 1,419 current-main selected research/documentation/evidence paths indexed in Appendix C.
- [x] Eight available prior research/handoff/host artifacts inventoried and hashed.
- [x] Credential-bearing upload excluded.
- [x] Active work separated from merged history, closed unmerged candidates, duplicates, and superseded guidance.
- [x] No repository or operational state changed by this compilation.

**End of consolidated research report.**
