import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createRunOutcomeCommandService,
  RunOutcomeCommandServiceError,
} from "./run-outcome-service.mjs";

const AUTH = {
  verified: true,
  facilityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

const COMMAND = {
  runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  commandId: "cmd-outcome-01",
  expectedRevision: 1,
  actualCases: 104,
  wasteLbs: 3.25,
};

function createService({ queryResult, authorizeResult = true } = {}) {
  const calls = [];
  const authorizations = [];
  const service = createRunOutcomeCommandService({
    query: async (text, values) => {
      calls.push({ text, values });
      return queryResult ?? {
        rows: [{
          result: {
            outcome: "accepted",
            replayed: false,
            run: { id: COMMAND.runId, status: "running", revision: 2, actualCases: 104, wasteLbs: 3.25 },
          },
        }],
      };
    },
    authorize: async (context) => {
      authorizations.push(context);
      return authorizeResult;
    },
  });
  return { service, calls, authorizations };
}

test("records outcome through the parameterized command with a canonical request hash", async () => {
  const { service, calls, authorizations } = createService();
  const result = await service.execute({ auth: AUTH, command: COMMAND });

  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /v3\.apply_run_outcome_command/);
  assert.deepEqual(calls[0].values.slice(0, 6), [
    AUTH.facilityId,
    COMMAND.runId,
    AUTH.actorId,
    COMMAND.commandId,
    createHash("sha256")
      .update(JSON.stringify({
        facilityId: AUTH.facilityId,
        actorId: AUTH.actorId,
        runId: COMMAND.runId,
        commandId: COMMAND.commandId,
        actualCases: COMMAND.actualCases,
        wasteLbs: COMMAND.wasteLbs,
        expectedRevision: COMMAND.expectedRevision,
      }))
      .digest("hex"),
    COMMAND.expectedRevision,
  ]);
  assert.deepEqual(calls[0].values.slice(6), [COMMAND.actualCases, COMMAND.wasteLbs]);
  assert.deepEqual(authorizations, [{
    auth: AUTH,
    action: "run.lifecycle.command",
    commandType: "run_outcome",
  }]);
});

test("null clears either field, including both at once (v1 clearing parity)", async () => {
  const { service, calls } = createService();
  await service.execute({
    auth: AUTH,
    command: { ...COMMAND, commandId: "cmd-outcome-clear", wasteLbs: null },
  });
  assert.deepEqual(calls[0].values.slice(6), [COMMAND.actualCases, null]);
  await service.execute({
    auth: AUTH,
    command: { ...COMMAND, commandId: "cmd-outcome-clear-all", actualCases: null, wasteLbs: null },
  });
  assert.deepEqual(calls[1].values.slice(6), [null, null]);
});

test("rejects non-integer or out-of-range case counts before any database call", async () => {
  for (const actualCases of [10.5, -1, 10000001, Number.NaN, "104", Number.POSITIVE_INFINITY]) {
    const { service, calls, authorizations } = createService();
    await assert.rejects(
      service.execute({ auth: AUTH, command: { ...COMMAND, actualCases } }),
      (error) => error instanceof RunOutcomeCommandServiceError
        && error.code === "INVALID_COMMAND" && error.status === 400,
      `actualCases ${String(actualCases)} must be rejected`,
    );
    assert.equal(calls.length, 0);
    assert.equal(authorizations.length, 0);
  }
});

test("rejects non-finite or negative waste before any database call", async () => {
  for (const wasteLbs of [-0.5, Number.NaN, Number.POSITIVE_INFINITY, "3", 10000001]) {
    const { service, calls } = createService();
    await assert.rejects(
      service.execute({ auth: AUTH, command: { ...COMMAND, wasteLbs } }),
      (error) => error instanceof RunOutcomeCommandServiceError
        && error.code === "INVALID_COMMAND" && error.status === 400,
      `wasteLbs ${String(wasteLbs)} must be rejected`,
    );
    assert.equal(calls.length, 0);
  }
});

test("rejects malformed identities and command envelopes", async () => {
  const badCommands = [
    { ...COMMAND, commandId: " padded" },
    { ...COMMAND, commandId: "x".repeat(201) },
    { ...COMMAND, expectedRevision: -1 },
    { ...COMMAND, expectedRevision: 1.5 },
    { ...COMMAND, runId: "not-a-uuid" },
  ];
  for (const command of badCommands) {
    const { service, calls } = createService();
    await assert.rejects(
      service.execute({ auth: AUTH, command }),
      (error) => error instanceof RunOutcomeCommandServiceError
        && error.code === "INVALID_COMMAND",
      JSON.stringify(command),
    );
    assert.equal(calls.length, 0);
  }
});

test("rejects missing verified identity before authorization or database access", async () => {
  const { service, calls, authorizations } = createService();
  await assert.rejects(
    service.execute({ auth: { ...AUTH, verified: false }, command: COMMAND }),
    (error) => error instanceof RunOutcomeCommandServiceError
      && error.code === "UNAUTHENTICATED" && error.status === 401,
  );
  assert.equal(authorizations.length, 0);
  assert.equal(calls.length, 0);
});

test("fails closed when the server policy denies the command", async () => {
  const { service, calls } = createService({ authorizeResult: false });
  await assert.rejects(
    service.execute({ auth: AUTH, command: COMMAND }),
    (error) => error instanceof RunOutcomeCommandServiceError
      && error.code === "FORBIDDEN" && error.status === 403,
  );
  assert.equal(calls.length, 0);
});

test("surfaces an unexpected database result as a storage failure, never a success", async () => {
  const { service } = createService({ queryResult: { rows: [{ result: { outcome: "exploded" } }] } });
  await assert.rejects(
    service.execute({ auth: AUTH, command: COMMAND }),
    (error) => error instanceof RunOutcomeCommandServiceError
      && error.code === "INVALID_STORAGE_RESPONSE" && error.status === 502,
  );
});

test("conflict and invalid_transition outcomes pass through untouched", async () => {
  const conflictService = createService({
    queryResult: { rows: [{ result: { outcome: "conflict", expectedRevision: 1, currentRun: { revision: 4 } } }] },
  });
  const conflict = await conflictService.service.execute({ auth: AUTH, command: COMMAND });
  assert.equal(conflict.outcome, "conflict");

  const transitionService = createService({
    queryResult: { rows: [{ result: { outcome: "invalid_transition", currentStatus: "planned" } }] },
  });
  const transition = await transitionService.service.execute({ auth: AUTH, command: COMMAND });
  assert.equal(transition.outcome, "invalid_transition");
});

test("normalizes UUID casing before hashing and database use", async () => {
  const { service, calls } = createService();
  await service.execute({
    auth: {
      ...AUTH,
      facilityId: AUTH.facilityId.toUpperCase(),
      actorId: AUTH.actorId.toUpperCase(),
    },
    command: { ...COMMAND, runId: COMMAND.runId.toUpperCase() },
  });
  assert.deepEqual(calls[0].values.slice(0, 3), [
    AUTH.facilityId,
    COMMAND.runId,
    AUTH.actorId,
  ]);
});

test("requires constructor wiring", () => {
  assert.throws(() => createRunOutcomeCommandService({ authorize: async () => true }),
    /parameterized database query/);
  assert.throws(() => createRunOutcomeCommandService({ query: async () => ({ rows: [] }) }),
    /authorization function/);
});
