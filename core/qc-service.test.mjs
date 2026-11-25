import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQcMeasurement } from "./qc-domain.mjs";
import { createQcService, QcServiceError } from "./qc-service.mjs";

const actorId = "81000000-0000-4000-8000-000000000001";
const facilityId = "81000000-0000-4000-8000-000000000002";
const runId = "81000000-0000-4000-8000-000000000003";
const requestId = "81000000-0000-4000-8000-000000000004";
const auth = { verified: true, actorId, facilityId, capabilities: ["record-qc", "manage-qc"] };
const updatedAt = "2026-11-25T00:00:00.000Z";

function target(overrides = {}) {
  return {
    targetKey: "DOUGH-BALL", kind: "weight", unit: "g", minimum: "450", maximum: "550",
    active: true, revision: 1, updatedBy: actorId, updatedAt, ...overrides,
  };
}

function record(kind = "weight-check", details = {}) {
  const base = kind === "weight-check" ? {
    phase: "pre-run", value: "500", unit: "g", targetKey: "DOUGH-BALL", notes: "",
    target: target(), outcome: "pass", notEvaluatedReason: null,
  } : { productCode: "FLOUR-01", lotNumber: "LOT-A", notes: "" };
  return {
    recordId: "81000000-0000-4000-8000-000000000005", sequence: "1", runId,
    kind, actorId, relatedRecordId: null, details: { ...base, ...details }, recordedAt: updatedAt,
  };
}

function dashboard(records = [record()]) {
  return { run: { id: runId }, highWaterMark: records.at(-1)?.sequence ?? "0", records };
}

function serviceWith(result) {
  const calls = [];
  return {
    calls,
    service: createQcService({ query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [{ result: typeof result === "function" ? result(values) : result }] };
    } }),
  };
}

test("QC target evaluation pins pass, fail, and every not-evaluated reason", () => {
  const input = { kind: "weight-check", value: "500", unit: "g", targetKey: "DOUGH-BALL", target: target() };
  assert.deepEqual(evaluateQcMeasurement(input), { outcome: "pass", notEvaluatedReason: null });
  assert.equal(evaluateQcMeasurement({ ...input, value: "551" }).outcome, "fail");
  assert.equal(evaluateQcMeasurement({ ...input, value: "449" }).outcome, "fail");
  assert.equal(evaluateQcMeasurement({ ...input, targetKey: null, target: null }).notEvaluatedReason, "no-reviewed-target");
  assert.equal(evaluateQcMeasurement({ ...input, target: null }).notEvaluatedReason, "target-unavailable");
  assert.equal(evaluateQcMeasurement({ ...input, target: target({ active: false }) }).notEvaluatedReason, "target-inactive");
  assert.equal(evaluateQcMeasurement({ ...input, target: target({ unit: "kg" }) }).notEvaluatedReason, "unit-mismatch");
  assert.equal(evaluateQcMeasurement({ ...input, target: target({ kind: "brix" }) }).notEvaluatedReason, "target-kind-mismatch");
});

test("QC service records normalized lots with a server hash and parameterized identity", async () => {
  const lot = record("lot", { lotNumber: "LOT-A", notes: "Intact" });
  lot.details = { notes: "Intact", lotNumber: "LOT-A", productCode: "FLOUR-01" };
  const { service, calls } = serviceWith({ outcome: "accepted", replayed: false, record: lot, ...dashboard([lot]) });
  const result = await service.record({ auth, kind: "lot", requestId, runId, details: {
    productCode: "FLOUR-01", lotNumber: "  LOT-A  ", notes: "  Intact  ",
  } });
  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /record_qc_lot/);
  assert.deepEqual(calls[0].values.slice(0, 2), [actorId, requestId]);
  assert.match(calls[0].values[2], /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(calls[0].values[4]), lot.details);
});

test("QC measurement responses are recomputed rather than trusting a stored outcome", async () => {
  const { service } = serviceWith({ outcome: "accepted", replayed: false, record: record(), ...dashboard() });
  await service.record({ auth, kind: "weight-check", requestId, runId, details: {
    phase: "pre-run", value: "500", unit: "g", targetKey: "DOUGH-BALL", notes: "",
  } });
  const wrong = serviceWith({ outcome: "accepted", replayed: false,
    record: record("weight-check", { outcome: "fail" }), ...dashboard([record("weight-check", { outcome: "fail" })]) });
  await assert.rejects(() => wrong.service.record({ auth, kind: "weight-check", requestId, runId, details: {
    phase: "pre-run", value: "500", unit: "g", targetKey: "DOUGH-BALL", notes: "",
  } }), (error) => error instanceof QcServiceError && error.status === 502);
});

test("QC targets require manager capability and revision-fenced normalized bounds", async () => {
  const accepted = { outcome: "accepted", replayed: false, target: target(), targets: [target()] };
  const { service, calls } = serviceWith(accepted);
  const result = await service.saveTarget({ auth, requestId, targetKey: "DOUGH-BALL", expectedRevision: 0, details: {
    kind: "weight", unit: "g", minimum: "450", maximum: "550", active: true,
  } });
  assert.equal(result.target.revision, 1);
  assert.match(calls[0].text, /save_qc_target/);
  await assert.rejects(() => service.saveTarget({ auth: { ...auth, capabilities: ["record-qc"] },
    requestId, targetKey: "DOUGH-BALL", expectedRevision: 0, details: accepted.target }), /QC manager/);
  await assert.rejects(() => service.saveTarget({ auth, requestId, targetKey: "DOUGH-BALL", expectedRevision: 0,
    details: { kind: "weight", unit: "g", minimum: null, maximum: null, active: true } }), /at least one/);
});

test("QC reads reject unauthenticated, unauthorized, malformed, and invalid storage responses", async () => {
  const { service, calls } = serviceWith(dashboard());
  await assert.rejects(() => service.getDashboard({ auth: null, runId }), /Sign in/);
  await assert.rejects(() => service.getDashboard({ auth: { ...auth, capabilities: [] }, runId }), /does not include/);
  await assert.rejects(() => service.getDashboard({ auth, runId: "not-a-run" }), /UUID/);
  assert.equal(calls.length, 0);
  const invalid = serviceWith({ run: { id: runId }, highWaterMark: "0", records: "none" });
  await assert.rejects(() => invalid.service.getDashboard({ auth, runId }), /invalid response/);
});

test("QC storage errors map to deliberate safe statuses without exposing SQL", async () => {
  for (const [code, status] of [["P0002", 404], ["42501", 403], ["P2002", 409], ["22023", 400]]) {
    const service = createQcService({ query: async () => { throw Object.assign(new Error("private SQL detail"), { code }); } });
    await assert.rejects(() => service.getTargets({ auth }), (error) => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /private SQL/);
      return true;
    });
  }
});
