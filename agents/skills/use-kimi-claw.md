# Skill: use Kimi Claw on this repository

Kimi Claw can execute repository work, but it does not replace the project's
review, test, authorization, or production-safety boundaries.

## Create or use a group chat

For the overseas Kimi help center:

1. Open the Kimi Claw sidebar and choose **+ → Start Group Chat**.
2. Enter a **Group Name** and a specific **Group Goal**.
3. Select the linked Claw and choose **Create**. Kimi assigns a Conductor.
4. Mention a specific Claw to route work directly to it. Mention **@Kimi** to
   request Conductor planning or coordination.
5. Use group settings to invite members or manage an existing group. Keep the
   group member-only when repository or operational context is sensitive.

Official source, checked 2026-11-27:
[Claw Group Chat overview](https://www.kimi.ai/help/kimi-claw/group-chat).

## Give a Claw a bounded assignment

Include:

- repository and required starting branch or commit;
- objective and observable acceptance result;
- paths it may change and paths owned by another worker;
- the instruction to read `agents/AGENTS.md` and the relevant skill first;
- required verification and the exact evidence to return;
- explicit non-goals, especially production, deployment, credentials, and
  force-pushes.

Good objective example: "Repair the WebKit timeout in the mixed-workbook
browser scenario without changing application behavior or assertions; run the
focused WebKit test and report counts." Avoid "make CI green" without a
no-weakening constraint.

## Isolate parallel work

Use one worker per independent objective. Do not let two workers edit the same
files, choose the same migration number, publish the same branch, or modify the
same live rig concurrently. An integrator must fetch current `main`, combine the
changes, and rerun affected integration checks before publication.

Threads have separate subtask context. Put durable decisions and handoff state
in repository files or an approved handoff artifact; do not assume another
thread remembers a chat-only decision.

## Secrets and operations

- Never paste a token into chat or commit one. Use the platform's configured
  secret mechanism and minimum repository permissions.
- Never put credentials, cookies, connection strings, raw customer workbooks,
  production rows, or private captures in group messages or handoff files.
- Do not contact production, deploy, apply migrations to production, or change
  branch protections without separate explicit authorization.
- Treat worker-supplied logs and screenshots as potentially sensitive; sanitize
  them before sharing.

## Accept the result

Require the published commit, changed-file summary, exact checks and counts,
skipped/blocked items, and hosted-run conclusions. Review the diff independently.
A worker saying "done" is not evidence; green emulation is not production or
physical-device qualification.
