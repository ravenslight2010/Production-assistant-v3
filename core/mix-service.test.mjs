import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createMixService,
  MixServiceError,
  normalizeMixPlanCommand,
  normalizeMixRecipeCommand,
  normalizeMixSurplusCommand,
} from "./mix-service.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const INGREDIENT_ID = "00000000-0000-4000-8000-000000000004";
const MIX_ID = "00000000-0000-4000-8000-000000000005";
const REQUEST_ID = "00000000-0000-4000-8000-000000000006";
const RUN_ID = "00000000-0000-4000-8000-000000000007";
const LOT_ID = "00000000-0000-4000-8000-000000000008";
const DATE = "2026-11-24";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID, capabilities: ["manage-inventory"] };
const RECIPE = {
  id: MIX_ID,
  kind: "product",
  productId: PRODUCT_ID,
  productName: "Pizza",
  name: "Sauce",
  notes: "",
  batchSizeLbs: "20.000000",
  daysEarly: 2,
  enabled: true,
  revision: 1,
  updatedAt: "2026-11-23T12:00:00.000Z",
  components: [{
    ingredientProductId: INGREDIENT_ID,
    ingredientName: "Tomatoes",
    ouncesPerPizza: "2.000000",
    referencePoundsPerBatch: null,
  }],
};
const CATALOG = {
  recipes: [RECIPE],
  products: [{ productId: PRODUCT_ID, productCode: "PIZZA", productName: "Pizza", baseUnit: "case" }],
};
const CONTRIBUTION = {
  key: `run:${RUN_ID}`,
  runId: RUN_ID,
  scheduleRunId: null,
  source: "live",
  label: "Live run",
  productId: PRODUCT_ID,
  productName: "Pizza",
  cases: 10,
  pizzas: 144,
  componentLbs: 18,
  ingredients: [{ productId: INGREDIENT_ID, name: "Tomatoes", ouncesPerPizza: 2 }],
  warnings: [],
};
const ENTRY = {
  key: `${DATE}:${MIX_ID}:${PRODUCT_ID}`,
  productionDate: DATE,
  daysUntil: 0,
  mixId: MIX_ID,
  kind: "product",
  productId: PRODUCT_ID,
  productName: "Pizza",
  name: "Sauce",
  notes: "",
  batchSizeLbs: 20,
  daysEarly: 2,
  componentLbs: 18,
  wasteLbs: 2.7,
  startupLbs: 20,
  totalLbs: 40.7,
  manualAlreadyMadeLbs: 0,
  allocatedSurplusLbs: 0,
  alreadyMadeLbs: 0,
  remainingLbs: 40.7,
  batches: 2.035,
  actualMadeLbs: 0,
  revision: 0,
  components: [{
    ingredientProductId: INGREDIENT_ID,
    ingredientName: "Tomatoes",
    referencePoundsPerBatch: null,
    plannedLbs: 18,
    pullLbs: 18,
    missingRuns: [],
  }],
  contributions: [CONTRIBUTION],
  warnings: [],
  finalized: false,
  finalization: null,
};
const PLAN = { makeDate: DATE, derivedAt: "2026-11-24T12:00:00.000Z", groups: [{ productionDate: DATE, daysUntil: 0, entries: [ENTRY] }] };
const SURPLUS = {
  revision: 1,
  lots: [{
    id: LOT_ID,
    mixId: MIX_ID,
    productId: PRODUCT_ID,
    mixName: "Sauce",
    productName: "Pizza",
    productionDate: DATE,
    source: "manual",
    amountMadeLbs: "5.000000",
    surplusLbs: "5.000000",
    allocatedLbs: "0.000000",
    remainingLbs: "5.000000",
    location: "Cooler",
    sourceFinalizationRunId: null,
    voided: false,
    createdAt: "2026-11-24T12:00:00.000Z",
    allocations: [],
  }],
};

function serviceWith(query) {
  return createMixService({ query });
}

test("mix commands normalize stable identities, decimal strings, and ordered components", () => {
  const recipe = normalizeMixRecipeCommand({
    type: "upsert",
    recipe: {
      id: null,
      kind: "product",
      productId: PRODUCT_ID.toUpperCase(),
      name: "  Sauce  ",
      notes: "Batch note",
      batchSizeLbs: "20.500000",
      daysEarly: 2,
      enabled: true,
      components: [{ ingredientProductId: INGREDIENT_ID.toUpperCase(), ouncesPerPizza: "2.000000", referencePoundsPerBatch: null }],
    },
  });
  assert.equal(recipe.recipe.name, "Sauce");
  assert.equal(recipe.recipe.productId, PRODUCT_ID);
  assert.equal(recipe.recipe.components[0].ingredientProductId, INGREDIENT_ID);
  assert.deepEqual(normalizeMixRecipeCommand({ type: "disable", mixId: MIX_ID.toUpperCase() }), { type: "disable", mixId: MIX_ID });
  assert.deepEqual(normalizeMixPlanCommand({
    type: "set-amount", productionDate: DATE, mixId: MIX_ID, productId: PRODUCT_ID,
    alreadyMadeLbs: "5.000000", actualMadeLbs: "0",
  }).alreadyMadeLbs, "5.000000");
  assert.deepEqual(normalizeMixSurplusCommand({ type: "allocate", lotId: LOT_ID, targetDate: "2026-11-25", quantityLbs: "0" }), {
    type: "allocate", lotId: LOT_ID, targetDate: "2026-11-25", quantityLbs: "0",
  });
  assert.equal(normalizeMixSurplusCommand({
    type: "record", mixId: MIX_ID, productId: PRODUCT_ID, productionDate: DATE, quantityLbs: "5", location: "  Cooler  ",
  }).location, "Cooler");
  assert.deepEqual(normalizeMixSurplusCommand({ type: "void", lotId: LOT_ID }), { type: "void", lotId: LOT_ID });
});

test("invalid commands and insufficient permissions fail before database work", async () => {
  let queries = 0;
  const service = serviceWith(async () => { queries += 1; });
  const { productName, revision: storedRevision, updatedAt, ...recipeInput } = RECIPE;
  const invalid = [
    () => normalizeMixRecipeCommand({ type: "upsert", recipe: { ...recipeInput, components: [] } }),
    () => normalizeMixRecipeCommand({ type: "upsert", recipe: { ...recipeInput, batchSizeLbs: "-1" } }),
    () => normalizeMixPlanCommand({ type: "set-amount", productionDate: "2026-02-30", mixId: MIX_ID, productId: PRODUCT_ID, alreadyMadeLbs: "0", actualMadeLbs: "0" }),
    () => normalizeMixSurplusCommand({ type: "record", mixId: MIX_ID, productId: PRODUCT_ID, productionDate: DATE, quantityLbs: "0", location: "Cooler" }),
    () => normalizeMixSurplusCommand({ type: "allocate", lotId: LOT_ID, targetDate: DATE, quantityLbs: "1", extra: true }),
  ];
  for (const callback of invalid) assert.throws(callback, (error) => error instanceof MixServiceError && error.status === 400);
  await assert.rejects(service.getPlan({ auth: { verified: false }, makeDate: DATE }), (error) => error.status === 401);
  await assert.rejects(service.getPlan({ auth: AUTH, makeDate: "2026-02-30" }), (error) => error.status === 400);
  await assert.rejects(service.executePlan({ auth: { ...AUTH, capabilities: [] }, requestId: REQUEST_ID, expectedRevision: 0, command: {
    type: "set-amount", productionDate: DATE, mixId: MIX_ID, productId: PRODUCT_ID, alreadyMadeLbs: "0", actualMadeLbs: "0",
  } }), (error) => error.status === 403);
  assert.equal(queries, 0);
});

test("all-staff reads are facility scoped and validate canonical storage", async () => {
  const calls = [];
  const service = serviceWith(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("list_mix_recipes")) return { rows: [{ result: CATALOG }] };
    if (sql.includes("get_mix_plan")) return { rows: [{ result: PLAN }] };
    if (sql.includes("get_mix_surplus")) return { rows: [{ result: SURPLUS }] };
    throw new Error("Unexpected query");
  });
  const auth = { ...AUTH, capabilities: [] };
  assert.deepEqual(await service.getRecipes({ auth }), CATALOG);
  assert.deepEqual(await service.getPlan({ auth, makeDate: DATE }), PLAN);
  assert.deepEqual(await service.getSurplus({ auth }), SURPLUS);
  assert.deepEqual(calls.map((call) => call.params), [[FACILITY_ID], [FACILITY_ID, DATE], [FACILITY_ID]]);
  const broken = serviceWith(async () => ({ rows: [{ result: { ...PLAN, groups: null } }] }));
  await assert.rejects(broken.getPlan({ auth, makeDate: DATE }), (error) => error.status === 502);
});

test("recipe commands hash normalized input and preserve accepted, replay, and conflict responses", async () => {
  const calls = [];
  const command = { type: "disable", mixId: MIX_ID.toUpperCase() };
  const normalized = { type: "disable", mixId: MIX_ID };
  const accepted = { outcome: "accepted", replayed: false, requestId: REQUEST_ID, recipe: { ...RECIPE, enabled: false }, catalog: CATALOG };
  const service = serviceWith(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ result: calls.length === 1 ? accepted : { ...accepted, replayed: true } }] };
  });
  const first = await service.executeRecipes({ auth: AUTH, requestId: REQUEST_ID, expectedRevision: 1, command });
  const replay = await service.executeRecipes({ auth: AUTH, requestId: REQUEST_ID, expectedRevision: 1, command });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  const expectedHash = createHash("sha256").update(JSON.stringify({
    channel: "recipes", facilityId: FACILITY_ID, actorId: ACTOR_ID, expectedRevision: 1, command: normalized,
  })).digest("hex");
  assert.equal(calls[0].params[3], expectedHash);
  assert.equal(calls[0].params[5], JSON.stringify(normalized));
  assert.ok(calls[0].sql.includes("apply_mix_recipe_command"));

  const conflict = serviceWith(async () => ({ rows: [{ result: { outcome: "conflict", replayed: false, catalog: CATALOG } }] }));
  assert.equal((await conflict.executeRecipes({ auth: AUTH, requestId: REQUEST_ID, expectedRevision: 0, command })).outcome, "conflict");
});

test("plan and surplus commands return validated canonical state and safe storage errors", async () => {
  const planCommand = { type: "set-amount", productionDate: DATE, mixId: MIX_ID, productId: PRODUCT_ID, alreadyMadeLbs: "1", actualMadeLbs: "0" };
  const surplusCommand = { type: "void", lotId: LOT_ID };
  const service = serviceWith(async (sql) => ({ rows: [{ result: sql.includes("apply_mix_plan")
    ? { outcome: "accepted", replayed: false, requestId: REQUEST_ID, plan: PLAN }
    : { outcome: "conflict", replayed: false, reason: "over_allocation", surplus: SURPLUS } }] }));
  assert.equal((await service.executePlan({ auth: AUTH, requestId: REQUEST_ID, expectedRevision: 0, command: planCommand })).plan, PLAN);
  assert.equal((await service.executeSurplus({ auth: AUTH, requestId: REQUEST_ID, expectedRevision: 1, command: surplusCommand })).reason, "over_allocation");

  const denied = serviceWith(async () => { throw Object.assign(new Error("private SQL"), { code: "42501" }); });
  await assert.rejects(denied.getSurplus({ auth: AUTH }), (error) => error.status === 403 && !error.message.includes("private SQL"));
  const stale = serviceWith(async () => { throw Object.assign(new Error("private SQL"), { code: "40001" }); });
  await assert.rejects(stale.getRecipes({ auth: AUTH }), (error) => error.status === 409);
});
