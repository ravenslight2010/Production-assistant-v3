import assert from "node:assert/strict";
import test from "node:test";
import { createRunService, RunServiceError } from "./run-service.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const PRODUCTION_DATE = "2026-11-10";
const RUN_ID = "00000000-0000-4000-8000-000000000004";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID };
const SETUP = {
  label: "Line A / five cheese",
  targetCases: 105,
  productCode: "FIVE-CHEESE",
  productionSetupCode: "LINE-A",
};
const PRODUCTION_PLAN = {
  code: "LINE-A",
  name: "Main line",
  warehouse: { id: "00000000-0000-4000-8000-000000000005", name: "Main warehouse" },
  recipes: [{
    code: "DOUGH-RECIPE",
    name: "Dough recipe",
    stationKey: "dough",
    ingredients: [{
      productId: "00000000-0000-4000-8000-000000000006",
      productCode: "FLOUR",
      productName: "Flour",
      quantity: "10",
      unit: "lb",
    }],
  }],
  packagingPerCase: [{
    productId: "00000000-0000-4000-8000-000000000007",
    productCode: "CARTON",
    productName: "Carton",
    quantity: "1",
    unit: "each",
  }],
};
const RUN = {
  id: RUN_ID,
  status: "planned",
  productionDate: PRODUCTION_DATE,
  revision: 0,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  startedAt: null,
  pausedAt: null,
  resumedAt: null,
  completedAt: null,
  runToTime: "19:15",
  operationalNotes: "",
  setupSnapshot: { ...SETUP, productionPlan: PRODUCTION_PLAN },
  effectiveProductionPlan: PRODUCTION_PLAN,
  substitutionOverlay: null,
  stoppages: [],
  pauseIntervals: [],
};

function makeService({ query, authorize = async () => true } = {}) {
  return createRunService({
    query: query ?? (async () => ({ rows: [{ result: null }] })),
    authorize,
  });
}

test("creates a server-owned run using verified identity and a canonical idempotency hash", async () => {
  let call;
  const service = makeService({
    query: async (sql, params) => {
      call = { sql, params };
      return { rows: [{ result: { outcome: "created", replayed: false, run: RUN } }] };
    },
  });

  const result = await service.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP });

  assert.equal(result.outcome, "created");
  assert.equal(result.run.id, RUN_ID);
  assert.match(call.sql, /v3\.create_planned_run/);
  assert.deepEqual(call.params.slice(0, 3), [FACILITY_ID, ACTOR_ID, REQUEST_ID]);
  assert.match(call.params[3], /^[0-9a-f]{64}$/);
  assert.equal(call.params[4], PRODUCTION_DATE);
  assert.deepEqual(JSON.parse(call.params[5]), SETUP);
});

test("trims a run label before hashing and persistence", async () => {
  let storedSetup;
  const service = makeService({
    query: async (_sql, params) => {
      storedSetup = JSON.parse(params[5]);
      return {
        rows: [{
          result: {
            outcome: "created",
            replayed: false,
            run: { ...RUN, setupSnapshot: { ...storedSetup, productionPlan: PRODUCTION_PLAN } },
          },
        }],
      };
    },
  });

  const result = await service.create({
    auth: AUTH,
    requestId: REQUEST_ID,
    productionDate: PRODUCTION_DATE,
    setupSnapshot: { label: "  Morning run  ", targetCases: 12, productCode: "PIZZA", productionSetupCode: "LINE" },
  });

  assert.deepEqual(storedSetup, {
    label: "Morning run", targetCases: 12, productCode: "PIZZA", productionSetupCode: "LINE",
  });
  assert.equal(result.run.setupSnapshot.label, "Morning run");
});

test("persists a die setup snapshot and compares JSON values independent of key order", async () => {
  const lineSettings = {
    crustsPerCycle: 8, cycleSpeed: 77, speedAdjustment: 1, freezerTime: 22,
    casesPerLayer: 4, preTunnelMin: null, postTunnelMin: null, pressOvenMin: null, frontlineMin: null,
  };
  const requestSetup = {
    ...SETUP,
    dieSetup: { dieTypeCode: "DIE-A", expectedRevision: 3, lineSettings },
  };
  const storedLineSettings = Object.fromEntries(Object.entries(lineSettings).reverse());
  const service = makeService({
    query: async (_sql, params) => {
      const submitted = JSON.parse(params[5]);
      return {
        rows: [{
          result: {
            outcome: "created",
            replayed: false,
            run: {
              ...RUN,
              setupSnapshot: {
                ...submitted,
                productionPlan: PRODUCTION_PLAN,
                dieSetup: {
                  dieTypeCode: "DIE-A",
                  dieTypeName: "Die A",
                  defaultStatus: "active",
                  defaultRevision: 3,
                  lineSettings: storedLineSettings,
                },
              },
            },
          },
        }],
      };
    },
  });
  const result = await service.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: requestSetup });
  assert.deepEqual(JSON.parse(JSON.stringify(result.run.setupSnapshot.dieSetup.lineSettings)), lineSettings);
});

test("rejects unsupported setup fields and invalid values before database work", async () => {
  let queryCount = 0;
  const service = makeService({
    query: async () => {
      queryCount += 1;
      return { rows: [{ result: null }] };
    },
  });

  const invalidSetups = [
    null,
    { label: "Run", targetCases: 1, facilityId: FACILITY_ID },
    { label: " ", targetCases: 1 },
    { label: "x".repeat(121), targetCases: 1 },
    { label: "Run", targetCases: 0 },
    { label: "Run", targetCases: 1.5 },
    { label: "Run", targetCases: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const setupSnapshot of invalidSetups) {
    await assert.rejects(
      service.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot }),
      (error) => error instanceof RunServiceError && error.status === 400,
    );
  }
  assert.equal(queryCount, 0);
});

test("rejects invalid request IDs, missing verified identity, and denied authorization", async () => {
  let queryCount = 0;
  const service = makeService({
    query: async () => {
      queryCount += 1;
      return { rows: [{ result: { outcome: "created", replayed: false, run: RUN } }] };
    },
    authorize: async () => false,
  });

  await assert.rejects(
    service.create({ auth: AUTH, requestId: "not-a-uuid", setupSnapshot: SETUP }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service.create({ auth: { facilityId: FACILITY_ID, actorId: ACTOR_ID }, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP }),
    (error) => error.status === 401,
  );
  await assert.rejects(
    service.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP }),
    (error) => error.status === 403,
  );
  assert.equal(queryCount, 0);
});

test("returns idempotent creation replay and maps reused request IDs to conflict", async () => {
  const service = makeService({
    query: async () => ({ rows: [{ result: { outcome: "created", replayed: true, run: RUN } }] }),
  });
  const result = await service.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP });
  assert.equal(result.replayed, true);

  const conflict = makeService({
    query: async () => {
      const error = new Error("sensitive database detail");
      error.code = "22023";
      throw error;
    },
  });
  await assert.rejects(
    conflict.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP }),
    (error) => error.status === 409 && !error.message.includes("sensitive"),
  );
  const stale = makeService({
    query: async () => { throw Object.assign(new Error("stale revision"), { code: "40001" }); },
  });
  await assert.rejects(
    stale.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP }),
    (error) => error.status === 409 && error.code === "STALE_DIE_DEFAULT",
  );
});

test("reads runs only in the authenticated facility scope and enforces bounded list limits", async () => {
  const calls = [];
  const service = makeService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("v3.get_run")) return { rows: [{ result: RUN }] };
      return { rows: [{ result: [RUN] }] };
    },
  });

  assert.deepEqual(await service.get({ auth: AUTH, runId: RUN_ID }), RUN);
  assert.deepEqual(await service.list({ auth: AUTH, limit: 25 }), [RUN]);
  assert.deepEqual(calls[0].params, [FACILITY_ID, RUN_ID]);
  assert.deepEqual(calls[1].params, [FACILITY_ID, 25]);
  assert.match(calls[0].sql, /v3\.get_run/);
  assert.match(calls[1].sql, /v3\.list_runs/);

  await assert.rejects(service.list({ auth: AUTH, limit: 101 }), (error) => error.status === 400);
  assert.equal(calls.length, 2);
});

test("reads a monotonic run-list version from the outbox position", async () => {
  const calls = [];
  const service = makeService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ result: "42" }] };
    },
  });

  assert.equal(await service.listVersion({ auth: AUTH }), "42");
  assert.deepEqual(calls[0].params, [FACILITY_ID]);
  assert.match(calls[0].sql, /MAX\(sequence\)/);
  assert.match(calls[0].sql, /facility_id = \$1/);

  await assert.rejects(
    makeService({ query: async () => ({ rows: [{ result: 42 }] }) }).listVersion({ auth: AUTH }),
    (error) => error.status === 502 && error.code === "INVALID_STORAGE_RESPONSE",
  );
  await assert.rejects(
    makeService({ query: async () => ({ rows: [{ result: null }] }) }).listVersion({ auth: AUTH }),
    (error) => error.status === 502 && error.code === "INVALID_STORAGE_RESPONSE",
  );
  await assert.rejects(
    makeService().listVersion({ auth: { verified: false } }),
    (error) => error.status === 401,
  );
});

test("lists runs with their outbox version in one query for conditional polls", async () => {
  const calls = [];
  const service = makeService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ version: "3112", result: [RUN] }] };
    },
  });

  const listed = await service.listWithVersion({ auth: AUTH, limit: 50 });
  assert.deepEqual(listed, { version: "3112", runs: [RUN] });
  assert.equal(calls.length, 1, "version and list must share one round trip");
  assert.deepEqual(calls[0].params, [AUTH.facilityId, 50]);
  assert.match(calls[0].sql, /MAX\(sequence\)/);
  assert.match(calls[0].sql, /list_runs/);

  await assert.rejects(
    makeService({ query: async () => ({ rows: [{ version: "3112" }] }) }).listWithVersion({ auth: AUTH }),
    (error) => error.status === 502 && error.code === "INVALID_STORAGE_RESPONSE",
  );
  await assert.rejects(
    makeService({ query: async () => ({ rows: [{ version: "nope", result: [] }] }) }).listWithVersion({ auth: AUTH }),
    (error) => error.status === 502 && error.code === "INVALID_STORAGE_RESPONSE",
  );
  await assert.rejects(
    makeService().listWithVersion({ auth: { verified: false } }),
    (error) => error.status === 401,
  );
});

test("fails explicitly on malformed canonical storage results", async () => {
  for (const malformed of [
    { ...RUN, createdAt: "2026-11-10T12:00:00+00:00" },
    { ...RUN, runToTime: "7:15 PM" },
    { ...RUN, runToTime: undefined },
  ]) {
    const service = makeService({ query: async () => ({ rows: [{ result: malformed }] }) });
    await assert.rejects(
      service.get({ auth: AUTH, runId: RUN_ID }),
      (error) => error.status === 502 && error.code === "INVALID_STORAGE_RESPONSE",
    );
  }
});

test("strict imported rules reject preparation with a safe definitive response", async () => {
  const service = makeService({
    query: async () => { throw Object.assign(new Error("private storage details"), { code: "P2001" }); },
  });
  await assert.rejects(
    service.create({ auth: AUTH, requestId: REQUEST_ID, productionDate: PRODUCTION_DATE, setupSnapshot: SETUP }),
    (error) => error.status === 422 && error.code === "PRODUCTION_RULES_BLOCKED"
      && !error.message.includes("private storage details"),
  );
});
