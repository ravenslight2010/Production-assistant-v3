import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQcMeasurement, hasNewQcEvidenceSinceSignOff } from "./qc-domain.mjs";
import { createQcService, QcServiceError } from "./qc-service.mjs";

const actorId = "81000000-0000-4000-8000-000000000001";
const facilityId = "81000000-0000-4000-8000-000000000002";
const runId = "81000000-0000-4000-8000-000000000003";
const requestId = "81000000-0000-4000-8000-000000000004";
const auth = { verified: true, actorId, facilityId, capabilities: ["record-qc", "manage-qc"] };
const updatedAt = "2026-11-25T00:00:00.000Z";
const component = {
  componentKey: "recipe:0:ingredient:0", componentType: "ingredient",
  recipeCode: "DOUGH", recipeName: "Dough", stationKey: "dough",
  productId: null, productCode: "FLOUR-01", productName: "Flour", quantity: "1", unit: "kg",
};
const componentSnapshot = {
  productionDate: "2026-11-25", source: "effective-plan", overlayRevision: 0,
  planCode: "PLAN-1", planName: "Plan 1",
};
const allergenMapping = {
  componentKey: component.componentKey, productCode: component.productCode,
  status: "reviewed", allergens: ["wheat"],
};

function target(overrides = {}) {
  return {
    targetKey: "DOUGH-BALL", kind: "weight", unit: "g", minimum: "450", maximum: "550",
    active: true, revision: 1, updatedBy: actorId, updatedAt, ...overrides,
  };
}

function record(kind = "weight-check", details = {}, overrides = {}) {
  const bases = {
    "weight-check": {
      phase: "pre-run", value: "500", unit: "g", targetKey: "DOUGH-BALL", notes: "",
      target: target(), outcome: "pass", notEvaluatedReason: null,
    },
    lot: { productCode: "FLOUR-01", lotNumber: "LOT-A", notes: "" },
    "component-check": {
      componentKey: component.componentKey, presence: "present", notes: "", component, componentSnapshot,
    },
    "allergen-review": {
      componentKey: component.componentKey, stagingStatus: "staged", notes: "",
      component, componentSnapshot, allergenMapping,
    },
    cleaning: { area: "Mixer 1", status: "cleaned", notes: "" },
    "cleaning-verification": { status: "verified", notes: "" },
    "sign-off": { highWaterMark: "1" },
  };
  return {
    recordId: "81000000-0000-4000-8000-000000000005", sequence: "1", runId,
    kind, actorId, relatedRecordId: kind === "cleaning-verification"
      ? "81000000-0000-4000-8000-000000000006" : null,
    details: { ...bases[kind], ...details }, recordedAt: updatedAt, ...overrides,
  };
}

function dashboard(records = [record()], overrides = {}) {
  return {
    run: { id: runId }, highWaterMark: records.at(-1)?.sequence ?? "0", records,
    components: [component], componentSnapshot, allergenMappings: [allergenMapping],
    signOff: null, newEvidenceSinceSignOff: false, ...overrides,
  };
}

function signedDashboard({ replayed = false } = {}) {
  const cleaning = record("cleaning");
  const signOff = record("sign-off", { highWaterMark: "1" }, {
    recordId: "81000000-0000-4000-8000-000000000007", sequence: "2",
  });
  return {
    outcome: "accepted", replayed, record: signOff,
    ...dashboard([cleaning, signOff], {
      signOff: {
        recordId: signOff.recordId, actorId, highWaterMark: "1", signedAt: updatedAt,
      },
    }),
  };
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

test("QC sign-off staleness ignores the sign-off itself and detects only later evidence", () => {
  const cleaning = record("cleaning", {}, { sequence: "2" });
  const laterSignOff = record("sign-off", { highWaterMark: "2" }, { sequence: "3" });
  const signOff = { highWaterMark: "1" };
  assert.equal(hasNewQcEvidenceSinceSignOff([], null), false);
  assert.equal(hasNewQcEvidenceSinceSignOff([record()], signOff), false);
  assert.equal(hasNewQcEvidenceSinceSignOff([cleaning, laterSignOff], signOff), true);
  assert.equal(hasNewQcEvidenceSinceSignOff([laterSignOff], { highWaterMark: "2" }), false);
  assert.throws(() => hasNewQcEvidenceSinceSignOff("none", signOff), /records must be an array/);
  assert.throws(() => hasNewQcEvidenceSinceSignOff([], { highWaterMark: "01" }), /high-water mark/);
});

test("QC run verification records normalize commands and preserve server-owned evidence", async (t) => {
  const cases = [
    ["component-check", {
      componentKey: component.componentKey, presence: "unknown", notes: "  Not checked  ",
    }, { presence: "unknown", notes: "Not checked" }],
    ["allergen-review", {
      componentKey: component.componentKey, stagingStatus: "unknown", notes: "  Review later  ",
    }, { stagingStatus: "unknown", notes: "Review later" }],
    ["cleaning", { area: "  Mixer 1  ", status: "unknown", notes: "  Not checked  " },
      { area: "Mixer 1", status: "unknown", notes: "Not checked" }],
  ];
  for (const [kind, details, expected] of cases) {
    await t.test(kind, async () => {
      const stored = record(kind, expected);
      const { service, calls } = serviceWith({ outcome: "accepted", replayed: false, record: stored, ...dashboard([stored]) });
      const result = await service.record({ auth, kind, requestId, runId, details });
      assert.equal(result.record.kind, kind);
      assert.match(calls[0].text, new RegExp(kind === "component-check" ? "record_qc_component_check"
        : kind === "allergen-review" ? "record_qc_allergen_review" : "record_qc_cleaning"));
      assert.match(calls[0].values[2], /^[0-9a-f]{64}$/);
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(JSON.parse(calls[0].values[4])[key], value);
      }
      assert.equal("component" in JSON.parse(calls[0].values[4]), false);
      assert.equal("componentSnapshot" in JSON.parse(calls[0].values[4]), false);
      assert.equal("allergenMapping" in JSON.parse(calls[0].values[4]), false);
    });
  }
});

test("QC run verification rejects unsupported states before database work", async () => {
  const { service, calls } = serviceWith(dashboard());
  await assert.rejects(() => service.record({ auth, kind: "component-check", requestId, runId,
    details: { componentKey: "recipe:0:ingredient:0", presence: "yes", notes: "" } }), /present, absent, or unknown/);
  await assert.rejects(() => service.record({ auth, kind: "allergen-review", requestId, runId,
    details: { componentKey: "packaging:0", stagingStatus: "staged", notes: "" } }), /effective ingredient/);
  await assert.rejects(() => service.record({ auth, kind: "cleaning", requestId, runId,
    details: { area: "Mixer", status: "done", notes: "" } }), /cleaned, not cleaned, or unknown/);
  assert.equal(calls.length, 0);
});

test("QC cleaning verification hashes the target and requires an independent manager command", async () => {
  const cleaning = record("cleaning", {}, { recordId: "81000000-0000-4000-8000-000000000006" });
  const verification = record("cleaning-verification", { notes: "Confirmed" }, { sequence: "2" });
  const { service, calls } = serviceWith({
    outcome: "accepted", replayed: false, record: verification, ...dashboard([cleaning, verification]),
  });
  const result = await service.verifyCleaning({ auth, requestId, cleaningRecordId: cleaning.recordId,
    details: { status: "verified", notes: "  Confirmed  " } });
  assert.equal(result.record.relatedRecordId, cleaning.recordId);
  assert.match(calls[0].text, /verify_qc_cleaning/);
  assert.deepEqual(calls[0].values.slice(0, 2), [actorId, requestId]);
  assert.equal(calls[0].values[3], cleaning.recordId);
  assert.deepEqual(JSON.parse(calls[0].values[4]), { status: "verified", notes: "Confirmed" });
  await assert.rejects(() => service.verifyCleaning({ auth: { ...auth, capabilities: ["record-qc"] },
    requestId, cleaningRecordId: cleaning.recordId, details: { status: "verified", notes: "" } }), /QC manager/);
});

test("QC sign-off validates accepted, replayed, and stale canonical responses", async () => {
  const accepted = serviceWith(signedDashboard());
  const result = await accepted.service.signOff({ auth, requestId, runId, expectedHighWaterMark: "1" });
  assert.equal(result.outcome, "accepted");
  assert.match(accepted.calls[0].text, /sign_off_qc_run/);
  assert.deepEqual(accepted.calls[0].values.slice(0, 2), [actorId, requestId]);
  assert.equal(accepted.calls[0].values[4], "1");

  const replayed = serviceWith(signedDashboard({ replayed: true }));
  assert.equal((await replayed.service.signOff({ auth, requestId, runId, expectedHighWaterMark: "1" })).replayed, true);

  const later = record("lot", {}, { sequence: "3" });
  const conflict = serviceWith({
    outcome: "conflict", replayed: false, expectedHighWaterMark: "1",
    ...dashboard([record("cleaning"), record("sign-off", { highWaterMark: "1" }, {
      recordId: "81000000-0000-4000-8000-000000000007", sequence: "2",
    }), later], {
      signOff: {
        recordId: "81000000-0000-4000-8000-000000000007", actorId,
        highWaterMark: "1", signedAt: updatedAt,
      },
      newEvidenceSinceSignOff: true,
    }),
  });
  assert.equal((await conflict.service.signOff({ auth, requestId, runId, expectedHighWaterMark: "1" })).outcome, "conflict");
  await assert.rejects(() => accepted.service.signOff({ auth, requestId, runId, expectedHighWaterMark: "01" }), /high-water mark/);
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
