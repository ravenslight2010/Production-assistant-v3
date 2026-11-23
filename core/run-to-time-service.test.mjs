import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createRunToTimeService, RunToTimeServiceError } from "./run-to-time-service.mjs";

const AUTH = {
  verified: true,
  facilityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const COMMAND = {
  runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  commandId: "run-to-time-1",
  expectedRevision: 3,
  runToTime: "7:15 PM",
};

function fixture({ result, authorized = true } = {}) {
  const calls = [];
  const authorizations = [];
  const service = createRunToTimeService({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [{ result: result ?? {
        outcome: "accepted", replayed: false, commandId: COMMAND.commandId,
        run: { id: COMMAND.runId, revision: 4, runToTime: "19:15" },
      } }] };
    },
    authorize: async (context) => {
      authorizations.push(context);
      return authorized;
    },
  });
  return { service, calls, authorizations };
}

test("uses server identity, lifecycle authorization, canonical time, and parameterized SQL", async () => {
  const { service, calls, authorizations } = fixture();
  const result = await service.execute({ auth: AUTH, command: COMMAND });
  assert.equal(result.outcome, "accepted");
  assert.deepEqual(authorizations, [{ auth: AUTH, action: "run.lifecycle.command", commandType: "run_to_time" }]);
  assert.match(calls[0].text, /v3\.apply_run_to_time_command/);
  assert.equal(calls[0].text.includes(COMMAND.runId), false);
  const expectedHash = createHash("sha256").update(JSON.stringify({
    facilityId: AUTH.facilityId,
    actorId: AUTH.actorId,
    runId: COMMAND.runId,
    commandId: COMMAND.commandId,
    commandType: "run_to_time",
    expectedRevision: 3,
    runToTime: "19:15",
  })).digest("hex");
  assert.deepEqual(calls[0].values, [
    AUTH.facilityId, COMMAND.runId, AUTH.actorId, COMMAND.commandId, expectedHash, "19:15", 3,
  ]);
});

test("normalizes UUID casing before hashing and persistence", async () => {
  const { service, calls } = fixture();
  await service.execute({
    auth: { ...AUTH, facilityId: AUTH.facilityId.toUpperCase(), actorId: AUTH.actorId.toUpperCase() },
    command: { ...COMMAND, runId: COMMAND.runId.toUpperCase() },
  });
  assert.deepEqual(calls[0].values.slice(0, 3), [AUTH.facilityId, COMMAND.runId, AUTH.actorId]);
});

test("fails closed before database access for invalid identity, authorization, and commands", async () => {
  const unauthenticated = fixture();
  await assert.rejects(unauthenticated.service.execute({ auth: { ...AUTH, verified: false }, command: COMMAND }),
    (error) => error instanceof RunToTimeServiceError && error.status === 401);
  assert.equal(unauthenticated.calls.length, 0);

  const denied = fixture({ authorized: false });
  await assert.rejects(denied.service.execute({ auth: AUTH, command: COMMAND }),
    (error) => error instanceof RunToTimeServiceError && error.status === 403);
  assert.equal(denied.calls.length, 0);

  const invalid = fixture();
  for (const command of [
    { ...COMMAND, runToTime: "24:00" }, { ...COMMAND, runToTime: "7:15" },
    { ...COMMAND, expectedRevision: -1 }, { ...COMMAND, commandId: " padded" },
    { ...COMMAND, runId: "bad" }, { ...COMMAND, actorId: AUTH.actorId },
  ]) {
    await assert.rejects(invalid.service.execute({ auth: AUTH, command }),
      (error) => error instanceof RunToTimeServiceError && error.status === 400);
  }
  assert.equal(invalid.calls.length, 0);
});

test("returns conflict and completed-run outcomes unchanged", async () => {
  for (const result of [
    { outcome: "conflict", expectedRevision: 2, currentRun: { revision: 3, runToTime: "19:15" } },
    { outcome: "invalid_transition", currentStatus: "completed", currentRun: { revision: 5, runToTime: "19:15" } },
  ]) {
    const { service } = fixture({ result });
    assert.deepEqual(await service.execute({ auth: AUTH, command: COMMAND }), result);
  }
});

test("rejects malformed storage responses instead of claiming confirmation", async () => {
  const { service } = fixture({ result: { ok: true } });
  await assert.rejects(service.execute({ auth: AUTH, command: COMMAND }),
    (error) => error instanceof RunToTimeServiceError && error.code === "INVALID_STORAGE_RESPONSE" && error.status === 502);
});
