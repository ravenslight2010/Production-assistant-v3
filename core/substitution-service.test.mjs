import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createSubstitutionService,
  normalizeSubstitutionCommand,
  SubstitutionServiceError,
} from "./substitution-service.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const RULE_ID = "00000000-0000-4000-8000-000000000004";
const REQUEST_ID = "00000000-0000-4000-8000-000000000005";
const DATE = "2026-11-18";
const AUTH = {
  verified: true,
  facilityId: FACILITY_ID,
  actorId: ACTOR_ID,
  capabilities: ["manage-factory-settings"],
};
const RULE = {
  id: RULE_ID,
  ingredient: "Flour",
  action: "swap",
  substituteProductId: PRODUCT_ID,
  substituteProductCode: "FLOUR-B",
  substituteProductName: "Flour B",
};
const OVERLAY = {
  productionDate: DATE,
  revision: 1,
  rules: [RULE],
  updatedAt: "2026-11-18T12:00:00.000Z",
};
const PRODUCTS = [{ productId: PRODUCT_ID, productCode: "FLOUR-B", productName: "Flour B", baseUnit: "lb" }];

function serviceWith(query) {
  return createSubstitutionService({ query });
}

test("canonical substitution commands support swap, add, remove, and clear", () => {
  assert.deepEqual(normalizeSubstitutionCommand({
    type: "upsert",
    rule: { id: null, ingredient: "  Flour  ", action: "swap", substituteProductId: PRODUCT_ID.toUpperCase(), quantity: null },
  }), {
    type: "upsert",
    rule: { id: null, ingredient: "Flour", action: "swap", substituteProductId: PRODUCT_ID, quantity: null },
  });
  assert.equal(normalizeSubstitutionCommand({
    type: "upsert",
    rule: { id: null, ingredient: "Flour", action: "add", substituteProductId: PRODUCT_ID, quantity: "2.500000" },
  }).rule.quantity, "2.500000");
  assert.deepEqual(normalizeSubstitutionCommand({
    type: "upsert",
    rule: { id: RULE_ID, ingredient: "Flour", action: "remove", substituteProductId: null, quantity: null },
  }).rule.action, "remove");
  assert.deepEqual(normalizeSubstitutionCommand({ type: "remove", ruleId: RULE_ID.toUpperCase() }), { type: "remove", ruleId: RULE_ID });
  assert.deepEqual(normalizeSubstitutionCommand({ type: "clear" }), { type: "clear" });
});

test("invalid substitution commands fail before database work", async () => {
  let queries = 0;
  const service = serviceWith(async () => { queries += 1; });
  const invalidCommands = [
    { type: "upsert", rule: { id: null, ingredient: "Flour", action: "add", substituteProductId: PRODUCT_ID, quantity: null } },
    { type: "upsert", rule: { id: null, ingredient: "Flour", action: "remove", substituteProductId: PRODUCT_ID, quantity: null } },
    { type: "upsert", rule: { id: null, ingredient: "Flour", action: "swap", substituteProductId: PRODUCT_ID, quantity: "0" } },
    { type: "upsert", rule: { id: null, ingredient: "Flour", action: "swap", substituteProductId: PRODUCT_ID, quantity: null, extra: true } },
    { type: "delete", ruleId: RULE_ID },
  ];
  for (const command of invalidCommands) {
    await assert.rejects(service.execute({ auth: AUTH, requestId: REQUEST_ID, productionDate: DATE, expectedRevision: 0, command }),
      (error) => error instanceof SubstitutionServiceError && error.status === 400);
  }
  await assert.rejects(service.get({ auth: { ...AUTH, capabilities: [] }, productionDate: DATE }),
    (error) => error instanceof SubstitutionServiceError && error.status === 403);
  await assert.rejects(service.get({ auth: AUTH, productionDate: "2026-02-30" }),
    (error) => error instanceof SubstitutionServiceError && error.status === 400);
  assert.equal(queries, 0);
});

test("overlay and product reads are facility-scoped and validate canonical storage", async () => {
  const calls = [];
  const service = serviceWith(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("get_substitution_overlay")) return { rows: [{ result: OVERLAY }] };
    if (sql.includes("list_substitution_products")) return { rows: [{ result: PRODUCTS }] };
    throw new Error("Unexpected query");
  });
  assert.deepEqual(await service.get({ auth: AUTH, productionDate: DATE }), OVERLAY);
  assert.deepEqual(await service.listProducts({ auth: AUTH }), PRODUCTS);
  assert.deepEqual(calls.map((call) => call.params), [[FACILITY_ID, DATE], [FACILITY_ID]]);
  assert.ok(calls.every((call) => call.sql.includes("$1")));
});

test("commands use a normalized canonical hash and preserve accepted, replay, and stale outcomes", async () => {
  const calls = [];
  const service = serviceWith(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ result: {
      outcome: "accepted", replayed: calls.length === 2, commandId: REQUEST_ID, overlay: OVERLAY,
    } }] };
  });
  const input = {
    auth: AUTH,
    requestId: REQUEST_ID.toUpperCase(),
    productionDate: DATE,
    expectedRevision: 0,
    command: {
      type: "upsert",
      rule: { id: null, ingredient: " Flour ", action: "swap", substituteProductId: PRODUCT_ID.toUpperCase(), quantity: null },
    },
  };
  const first = await service.execute(input);
  const replay = await service.execute(input);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(calls[0].params[3], REQUEST_ID);
  assert.equal(calls[0].params[4], calls[1].params[4]);
  const expectedHash = createHash("sha256").update(JSON.stringify({
    facilityId: FACILITY_ID,
    actorId: ACTOR_ID,
    productionDate: DATE,
    expectedRevision: 0,
    command: {
      type: "upsert",
      rule: { id: null, ingredient: "Flour", action: "swap", substituteProductId: PRODUCT_ID, quantity: null },
    },
  })).digest("hex");
  assert.equal(calls[0].params[4], expectedHash);
  assert.deepEqual(JSON.parse(calls[0].params[6]), {
    type: "upsert",
    rule: { id: null, ingredient: "Flour", action: "swap", substituteProductId: PRODUCT_ID, quantity: null },
  });

  const staleService = serviceWith(async () => ({ rows: [{ result: {
    outcome: "conflict", replayed: false, expectedRevision: 0, currentOverlay: { ...OVERLAY, revision: 2 },
  } }] }));
  const stale = await staleService.execute(input);
  assert.equal(stale.outcome, "conflict");
  assert.equal(stale.currentOverlay.revision, 2);
});

test("storage failures use safe statuses and malformed results fail explicitly", async () => {
  for (const [code, status] of [["P0002", 409], ["23505", 409], ["42501", 403], ["22023", 400]]) {
    const service = serviceWith(async () => {
      const error = new Error("sensitive database detail");
      error.code = code;
      throw error;
    });
    await assert.rejects(service.listProducts({ auth: AUTH }), (error) => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /sensitive/);
      return true;
    });
  }
  const malformed = serviceWith(async () => ({ rows: [{ result: { outcome: "accepted", replayed: false } }] }));
  await assert.rejects(malformed.execute({
    auth: AUTH, requestId: REQUEST_ID, productionDate: DATE, expectedRevision: 0, command: { type: "clear" },
  }), (error) => error instanceof SubstitutionServiceError && error.status === 502);
});
