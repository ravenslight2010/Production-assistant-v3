import assert from "node:assert/strict";
import test from "node:test";
import {
  FillMissingScanError,
  createFillMissingScanService,
} from "./fill-missing-scan-service.mjs";

const FACILITY_ID = "30000000-0000-4000-8000-000000000001";
const RUN_ID = "30000000-0000-4000-8000-000000000010";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: "30000000-0000-4000-8000-000000000002" };

const CATALOG_PRODUCT = {
  code: "CHEESE-16",
  doughCapacity: { pizzasPerCase: 16 },
  sauce: { barrelLbs: 425 },
};

function runFixture(overrides = {}) {
  return {
    id: RUN_ID,
    setupSnapshot: { productCode: "CHEESE-16" },
    stationProgress: {},
    ...overrides,
  };
}

function makeService({ run = runFixture(), learnedValues = [], products = [CATALOG_PRODUCT], queryErrors = false } = {}) {
  const calls = [];
  const runs = {
    get: async ({ runId }) => (runId === RUN_ID ? run : null),
    listProducts: async () => ({ products }),
  };
  const query = async (text, values) => {
    calls.push({ text, values });
    if (queryErrors) throw new Error("storage down");
    return { rows: [{ result: learnedValues }] };
  };
  return { service: createFillMissingScanService({ runs, query }), calls };
}

test("returns null when the run does not exist", async () => {
  const { service } = makeService();
  assert.equal(await service.build({ auth: AUTH, runId: "30000000-0000-4000-8000-000000000099" }), null);
});

test("builds gaps with learned proposals beating catalog defaults", async () => {
  const { service, calls } = makeService({
    learnedValues: [
      { productCode: "CHEESE-16", fieldKey: "sauce.barrelLbs", value: "450" },
    ],
  });
  const scan = await service.build({ auth: AUTH, runId: RUN_ID });
  assert.equal(scan.runId, RUN_ID);
  assert.equal(scan.productCode, "CHEESE-16");
  const gap = scan.gaps.find((item) => item.key === "sauce.barrelLbs");
  assert.ok(gap);
  assert.equal(gap.source, "learned");
  assert.equal(gap.proposedValue, 450);
  assert.deepEqual(gap.apply, { kind: "station_command", station: "sauce", field: "barrelLbs" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [FACILITY_ID]);
});

test("falls back to catalog values when nothing is learned", async () => {
  const { service } = makeService();
  const scan = await service.build({ auth: AUTH, runId: RUN_ID });
  const gap = scan.gaps.find((item) => item.key === "cheese.pizzasPerCase");
  assert.equal(gap.source, "catalog");
  assert.equal(gap.proposedValue, 16);
  const unlearned = scan.gaps.find((item) => item.key === "sauce.barrelLbs");
  assert.equal(unlearned.source, "none");
  assert.equal(unlearned.proposedValue, undefined);
});

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

test("maps storage failures to a retryable scan error", async () => {
  const { service } = makeService({ queryErrors: true });
  const error = await captureRejection(service.build({ auth: AUTH, runId: RUN_ID }));
  assert.ok(error instanceof FillMissingScanError);
  assert.equal(error.code, "STORAGE_ERROR");
  assert.equal(error.status, 503);
});

test("rejects unauthenticated and malformed sessions", async () => {
  const { service } = makeService();
  const anonymous = await captureRejection(service.build({ auth: null, runId: RUN_ID }));
  assert.equal(anonymous.status, 401);
  const malformed = await captureRejection(
    service.build({ auth: { verified: true, facilityId: "nope" }, runId: RUN_ID }),
  );
  assert.equal(malformed.status, 401);
});

test("requires run readers and a query function at construction", () => {
  assert.throws(() => createFillMissingScanService({ query: async () => ({ rows: [] }) }), /run read services/i);
  assert.throws(
    () => createFillMissingScanService({
      runs: { get: async () => null, listProducts: async () => ({ products: [] }) },
    }),
    /query function/i,
  );
});
