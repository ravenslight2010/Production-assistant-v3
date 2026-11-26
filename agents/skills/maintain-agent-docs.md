# Skill: maintain the agent handoff

Use when adding project knowledge, changing commands or workflows, closing an
incident, or completing a roadmap slice.

## Put knowledge in the right place

- `agents/AGENTS.md`: short orientation, invariants, and an index of every
  skill/memory document.
- `agents/skills/`: reusable procedures with triggers, commands, safeguards,
  and observable completion evidence.
- `agents/memory/architecture.md`: stable system structure and data ownership.
- `agents/memory/decisions.md`: dated ADRs with rationale and consequences.
- `agents/memory/gotchas.md`: concrete failure modes, detection, root-cause fix,
  and the regression layer now required.
- `agents/memory/browser-and-ci.md`: current test topology and dated hosted
  repair evidence.
- `agents/memory/qc-roadmap.md`: pointers and constraints for the approved QC
  sequence; the research plan remains the detailed source of truth.

Do not duplicate an entire plan or source file into memory. Record the decision,
current constraint, source path, and what a future agent must recheck.

## Keep it true and safe

1. Verify commands and paths against current source before documenting them.
2. Distinguish durable rules from dated observations. Include a date/commit for
   CI results and measured performance; do not present an old green run as the
   current head's result.
3. Use relative Markdown links for repository material and external HTTPS links
   for official product guidance.
4. Index every new skill/memory file from `agents/AGENTS.md`.
5. Never add tokens, session cookies, private connection strings, raw workbooks,
   production rows, private operational captures, or unsanitized diagnostics.
   Synthetic examples must be unmistakably non-live.
6. Remove or correct stale instructions in the same change that makes them
   stale. Do not leave contradictory procedures for the next agent to resolve.

## Verify

```sh
node agents/scripts/check-agent-docs.mjs
node --test agents/scripts/agent-docs.test.mjs
pnpm test
```

The checker validates the index, relative link targets, and common credential
patterns. Its tests are included in `pnpm test`. Add a regression test when the
checker gains a new rule; a clean scan does not prove technical accuracy, so the
author must still verify the documented commands and claims.
