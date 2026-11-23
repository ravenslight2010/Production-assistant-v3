import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createMixApi } from "./mix-api.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";
const INGREDIENT_ID = "00000000-0000-4000-8000-000000000004";
const MIX_ID = "00000000-0000-4000-8000-000000000005";
const REQUEST_ID = "00000000-0000-4000-8000-000000000006";
const LOT_ID = "00000000-0000-4000-8000-000000000008";
const DATE = "2026-11-24";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID, capabilities: ["manage-inventory"] };
const RECIPE = {
  id: MIX_ID, kind: "product", productId: PRODUCT_ID, productName: "Pizza", name: "Sauce", notes: "",
  batchSizeLbs: "20.000000", daysEarly: 2, enabled: true, revision: 1, updatedAt: "2026-11-23T12:00:00.000Z",
  components: [{ ingredientProductId: INGREDIENT_ID, ingredientName: "Tomatoes", ouncesPerPizza: "2.000000", referencePoundsPerBatch: null }],
};
const CATALOG = { recipes: [RECIPE], products: [{ productId: PRODUCT_ID, productCode: "PIZZA", productName: "Pizza", baseUnit: "case" }] };
const PLAN = { makeDate: DATE, derivedAt: "2026-11-24T12:00:00.000Z", groups: [] };
const SURPLUS = { revision: 1, lots: [] };

async function withApi(t, { auth = AUTH, csrf = true, failure = null } = {}) {
  const calls = [];
  const receipts = new Map();
  const logs = [];
  const pool = {
    async query(config) {
      assert.equal(config.query_timeout, 5_000);
      calls.push(config);
      if (failure) throw failure;
      if (config.text.includes("list_mix_recipes")) return { rows: [{ result: CATALOG }] };
      if (config.text.includes("get_mix_plan")) return { rows: [{ result: PLAN }] };
      if (config.text.includes("get_mix_surplus")) return { rows: [{ result: SURPLUS }] };
      if (config.text.includes("apply_mix_recipe_command")) {
        const requestId = config.values[2];
        const previous = receipts.get(requestId);
        if (previous) {
          assert.equal(previous, config.values[3]);
          return { rows: [{ result: { outcome: "accepted", replayed: true, requestId, recipe: RECIPE, catalog: CATALOG } }] };
        }
        receipts.set(requestId, config.values[3]);
        return { rows: [{ result: { outcome: "accepted", replayed: false, requestId, recipe: RECIPE, catalog: CATALOG } }] };
      }
      if (config.text.includes("apply_mix_plan_command")) {
        return { rows: [{ result: { outcome: "conflict", replayed: false, reason: "finalized", plan: PLAN } }] };
      }
      if (config.text.includes("apply_mix_surplus_command")) {
        return { rows: [{ result: { outcome: "accepted", replayed: false, requestId: config.values[2], surplus: SURPLUS } }] };
      }
      throw new Error("Unexpected query");
    },
  };
  const handler = createMixApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async () => csrf,
    logger: (record) => logs.push(record),
  });
  const server = createServer(async (request, response) => {
    if (await handler(request, response)) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found." }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls, logs };
}

async function send(baseUrl, path, { method = "GET", body, csrf = true, contentType = "application/json" } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = contentType;
  if (csrf && method !== "GET") headers["X-CSRF-Token"] = "test";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const recipeBody = {
  requestId: REQUEST_ID,
  expectedRevision: 1,
  command: { type: "disable", mixId: MIX_ID },
};
const planBody = {
  requestId: REQUEST_ID,
  expectedRevision: 0,
  command: { type: "set-amount", productionDate: DATE, mixId: MIX_ID, productId: PRODUCT_ID, alreadyMadeLbs: "0", actualMadeLbs: "0" },
};
const surplusBody = {
  requestId: REQUEST_ID,
  expectedRevision: 1,
  command: { type: "void", lotId: LOT_ID },
};

test("verified facility staff can read all Mix Plan resources without inventory-manager permission", async (t) => {
  const fixture = await withApi(t, { auth: { ...AUTH, capabilities: [] } });
  const recipes = await send(fixture.baseUrl, "/api/v3/mix-recipes");
  assert.equal(recipes.status, 200);
  assert.deepEqual((await recipes.json()).catalog, CATALOG);
  const plan = await send(fixture.baseUrl, `/api/v3/mix-plan?makeDate=${DATE}`);
  assert.equal(plan.status, 200);
  assert.deepEqual((await plan.json()).plan, PLAN);
  const surplus = await send(fixture.baseUrl, "/api/v3/mix-surplus");
  assert.equal(surplus.status, 200);
  assert.deepEqual((await surplus.json()).surplus, SURPLUS);
  assert.equal(fixture.calls.length, 3);
  assert.ok(fixture.calls.every((call) => call.values[0] === FACILITY_ID));

  const badDate = await send(fixture.baseUrl, "/api/v3/mix-plan?makeDate=2026-02-30");
  assert.equal(badDate.status, 400);
  const extraQuery = await send(fixture.baseUrl, "/api/v3/mix-surplus?limit=10");
  assert.equal(extraQuery.status, 400);
  assert.equal(fixture.calls.length, 3);
});

test("recipe commands require manager permission and CSRF and support exact retry", async (t) => {
  const denied = await withApi(t, { auth: { ...AUTH, capabilities: [] } });
  const forbidden = await send(denied.baseUrl, "/api/v3/mix-recipes/commands", { method: "POST", body: recipeBody });
  assert.equal(forbidden.status, 403);
  assert.equal(denied.calls.length, 0);

  const noCsrf = await withApi(t, { csrf: false });
  const csrfResponse = await send(noCsrf.baseUrl, "/api/v3/mix-recipes/commands", { method: "POST", body: recipeBody });
  assert.equal(csrfResponse.status, 403);
  assert.equal(noCsrf.calls.length, 0);

  const fixture = await withApi(t);
  const accepted = await send(fixture.baseUrl, "/api/v3/mix-recipes/commands", { method: "POST", body: recipeBody });
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal((await accepted.json()).replayed, false);
  const replay = await send(fixture.baseUrl, "/api/v3/mix-recipes/commands", { method: "POST", body: recipeBody });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].values[1], ACTOR_ID);
  assert.equal(fixture.calls[0].values[5], JSON.stringify({ type: "disable", mixId: MIX_ID }));
});

test("plan conflicts retain canonical state and surplus commands return current lots", async (t) => {
  const fixture = await withApi(t);
  const conflict = await send(fixture.baseUrl, "/api/v3/mix-plan/commands", { method: "POST", body: planBody });
  assert.equal(conflict.status, 409);
  const conflictBody = await conflict.json();
  assert.equal(conflictBody.reason, "finalized");
  assert.deepEqual(conflictBody.plan, PLAN);
  const surplus = await send(fixture.baseUrl, "/api/v3/mix-surplus/commands", { method: "POST", body: surplusBody });
  assert.equal(surplus.status, 200);
  assert.deepEqual((await surplus.json()).surplus, SURPLUS);
});

test("strict transport, methods, authentication, and safe failures are enforced", async (t) => {
  const unauthenticated = await withApi(t, { auth: { verified: false } });
  assert.equal((await send(unauthenticated.baseUrl, "/api/v3/mix-recipes")).status, 401);
  assert.equal(unauthenticated.calls.length, 0);

  const fixture = await withApi(t);
  const wrongType = await send(fixture.baseUrl, "/api/v3/mix-recipes/commands", {
    method: "POST", body: JSON.stringify(recipeBody), contentType: "text/plain",
  });
  assert.equal(wrongType.status, 415);
  const malformed = await send(fixture.baseUrl, "/api/v3/mix-recipes/commands", { method: "POST", body: "{" });
  assert.equal(malformed.status, 400);
  const extra = await send(fixture.baseUrl, "/api/v3/mix-recipes/commands", { method: "POST", body: { ...recipeBody, extra: true } });
  assert.equal(extra.status, 400);
  const wrongMethod = await send(fixture.baseUrl, "/api/v3/mix-recipes", { method: "POST", body: recipeBody });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");
  const unrelated = await send(fixture.baseUrl, "/api/v3/mix-plan/other");
  assert.equal(unrelated.status, 404);
  assert.equal(fixture.calls.length, 0);

  const failing = await withApi(t, { failure: new Error("private storage detail") });
  const failure = await send(failing.baseUrl, "/api/v3/mix-recipes");
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "The Mix Plan request could not be completed. Refresh and try again." });
  assert.equal(failing.logs.length, 1);
  assert.ok(!JSON.stringify(failing.logs).includes("private storage detail"));
});
