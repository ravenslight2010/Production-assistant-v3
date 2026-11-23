import assert from "node:assert/strict";
import test from "node:test";
import { createRunOperationsService, RunOperationsServiceError } from "./run-operations-service.mjs";

const FACILITY_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000002";
const RUN_ID = "10000000-0000-4000-8000-000000000003";
const STOP_ID = "10000000-0000-4000-8000-000000000004";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID, capabilities: ["manage-factory-settings"] };
const RUN = { id: RUN_ID, revision: 2, operationalNotes: "", stoppages: [] };

function fixture(overrides = {}) {
  const calls = [];
  const service = createRunOperationsService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("get_stop_reason_settings")) {
        return { rows: [{ result: { revision: 0, reasons: ["Break"], updatedAt: null } }] };
      }
      if (sql.includes("save_stop_reason_settings")) {
        return { rows: [{ result: { outcome: "accepted", replayed: false, settings: { revision: 1, reasons: JSON.parse(params[5]), updatedAt: null } } }] };
      }
      return { rows: [{ result: { outcome: "accepted", replayed: false, run: RUN } }] };
    },
    authorize: async () => true,
    ...overrides,
  });
  return { service, calls };
}

test("normalizes operational commands and hashes verified canonical identity", async () => {
  const { service, calls } = fixture();
  const result = await service.execute({ auth: AUTH, command: {
    runId: RUN_ID.toUpperCase(), commandId: "operation-1", commandType: "start_stop", expectedRevision: 1,
    details: { reason: "  Break  ", notes: "Operator note" },
  } });
  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /apply_run_operation_command/);
  assert.deepEqual(calls[0].params.slice(0, 4), [FACILITY_ID, RUN_ID, ACTOR_ID, "operation-1"]);
  assert.match(calls[0].params[4], /^[0-9a-f]{64}$/);
  assert.equal(calls[0].params[5], "start_stop");
  assert.deepEqual(JSON.parse(calls[0].params[6]), { reason: "Break", notes: "Operator note" });
  assert.equal(calls[0].params[7], 1);
});

test("rejects lifecycle pause time edits and late-policy client bypass shapes before storage", async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.execute({ auth: AUTH, command: {
    runId: RUN_ID, commandId: "bad-times", commandType: "update_stoppage", expectedRevision: 1,
    details: { stoppageId: STOP_ID, reason: "Break", notes: "", startedAt: "2026-11-20T12:00:00.000Z" },
  } }), (error) => error instanceof RunOperationsServiceError && error.status === 400);
  await assert.rejects(service.execute({ auth: AUTH, command: {
    runId: RUN_ID, commandId: "bad-policy", commandType: "set_pause_tunnel", expectedRevision: 1,
    details: { stoppageId: STOP_ID, stopTunnel: true },
  } }), /only keep the tunnel running/);
  assert.equal(calls.length, 0);
});

test("requires verified identity and server authorization", async () => {
  const { service, calls } = fixture({ authorize: async () => false });
  await assert.rejects(service.execute({ auth: AUTH, command: {
    runId: RUN_ID, commandId: "denied", commandType: "set_notes", expectedRevision: 1,
    details: { operationalNotes: "text" },
  } }), (error) => error.status === 403);
  assert.equal(calls.length, 0);
});

test("stop reason reads and saves preserve bounded unique manager-owned settings", async () => {
  const { service, calls } = fixture();
  assert.deepEqual((await service.getStopReasons({ auth: AUTH })).reasons, ["Break"]);
  const result = await service.saveStopReasons({ auth: AUTH, command: {
    commandId: "reasons-1", expectedRevision: 0, reasons: [" Break ", "Quality hold"],
  } });
  assert.deepEqual(result.settings.reasons, ["Break", "Quality hold"]);
  assert.equal(calls.length, 2);
  await assert.rejects(service.saveStopReasons({ auth: { ...AUTH, capabilities: [] }, command: {
    commandId: "reasons-2", expectedRevision: 0, reasons: ["Break"],
  } }), (error) => error.status === 403);
  await assert.rejects(service.saveStopReasons({ auth: AUTH, command: {
    commandId: "reasons-3", expectedRevision: 0, reasons: ["Break", " break "],
  } }), /unique/);
  assert.equal(calls.length, 2);
});

test("invalid storage results fail closed", async () => {
  const { service } = fixture({ query: async () => ({ rows: [{ result: { outcome: "accepted", run: { id: RUN_ID } } }] }) });
  await assert.rejects(service.execute({ auth: AUTH, command: {
    runId: RUN_ID, commandId: "bad-storage", commandType: "set_notes", expectedRevision: 1,
    details: { operationalNotes: "text" },
  } }), (error) => error.code === "INVALID_STORAGE_RESPONSE" && error.status === 502);
});
