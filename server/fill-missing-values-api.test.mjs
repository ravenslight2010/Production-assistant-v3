import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createFillMissingValuesApi } from "./fill-missing-values-api.mjs";

const STAFF = {
  verified: true,
  facilityId: "20000000-0000-4000-8000-000000000001",
  actorId: "20000000-0000-4000-8000-000000000002",
  capabilities: [],
};
const MANAGER = { ...STAFF, capabilities: ["manage-profiles"] };

const LEARNED_VALUES = [
  { productCode: "CHEESE-16", fieldKey: "sauce.barrelLbs", value: "450", updatedAt: "2026-11-28T06:00:00.000Z" },
];

async function withApi(t, { auth = MANAGER, csrf = true, query, logger = () => {} } = {}) {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return query(text, values);
    },
  };
  const handler = createFillMissingValuesApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger,
  });
  const server = createServer(async (request, response) => {
    if (await handler(request, response)) return;
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found." }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls };
}

function send(baseUrl, path, { method = "GET", body, csrf = true } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : {
      "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": "ok" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("GET serves learned values to any signed-in staff member", async (t) => {
  const { baseUrl, calls } = await withApi(t, {
    auth: STAFF,
    query: async () => ({ rows: [{ result: LEARNED_VALUES }] }),
  });
  const response = await send(baseUrl, "/api/v3/fill-missing-values");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { values: LEARNED_VALUES });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [STAFF.facilityId]);
});

test("GET rejects unauthenticated sessions before touching the database", async (t) => {
  const { baseUrl, calls } = await withApi(t, {
    auth: null,
    query: async () => ({ rows: [{ result: [] }] }),
  });
  const response = await send(baseUrl, "/api/v3/fill-missing-values");
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("POST saves rows only for managers with a valid CSRF token", async (t) => {
  const rows = [{ productCode: "CHEESE-16", fieldKey: "sauce.barrelLbs", value: "450" }];
  const { baseUrl, calls } = await withApi(t, {
    query: async (text, values) => {
      assert.match(text, /v3\.save_fill_missing_values/);
      return { rows: [{ result: { saved: rows.length } }] };
    },
  });
  const response = await send(baseUrl, "/api/v3/fill-missing-values", { method: "POST", body: { rows } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[0], MANAGER.facilityId);
  assert.equal(calls[0].values[1], MANAGER.actorId);
  assert.equal(calls[0].values[2], JSON.stringify(rows));
});

test("POST rejects staff without manage-profiles before CSRF or database access", async (t) => {
  const { baseUrl, calls } = await withApi(t, { auth: STAFF });
  const response = await send(baseUrl, "/api/v3/fill-missing-values", {
    method: "POST",
    body: { rows: [{ productCode: "P", fieldKey: "f", value: "1" }] },
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /manager/i);
  assert.equal(calls.length, 0);
});

test("POST rejects manager requests without a CSRF token before the database", async (t) => {
  const { baseUrl, calls } = await withApi(t, { csrf: false });
  const response = await send(baseUrl, "/api/v3/fill-missing-values", {
    method: "POST",
    csrf: false,
    body: { rows: [{ productCode: "P", fieldKey: "f", value: "1" }] },
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /refresh your session/i);
  assert.equal(calls.length, 0);
});

test("POST validates row shape and bounds before the database", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const badRow = await send(baseUrl, "/api/v3/fill-missing-values", {
    method: "POST",
    body: { rows: [{ productCode: "P", fieldKey: "f" }] },
  });
  assert.equal(badRow.status, 400);
  const empty = await send(baseUrl, "/api/v3/fill-missing-values", { method: "POST", body: { rows: [] } });
  assert.equal(empty.status, 400);
  const notRows = await send(baseUrl, "/api/v3/fill-missing-values", { method: "POST", body: { values: [] } });
  assert.equal(notRows.status, 400);
  assert.equal(calls.length, 0);
});

test("POST surfaces unexpected storage results as a safe 502", async (t) => {
  const { baseUrl } = await withApi(t, { query: async () => ({ rows: [{ result: null }] }) });
  const response = await send(baseUrl, "/api/v3/fill-missing-values", {
    method: "POST",
    body: { rows: [{ productCode: "P", fieldKey: "f", value: "1" }] },
  });
  assert.equal(response.status, 502);
});

test("passes through requests outside the fill-missing values path", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const direct = createFillMissingValuesApi({
    pool: { query: async () => ({ rows: [] }) },
    authenticate: async () => STAFF,
    verifyCsrf: async () => true,
  });
  assert.equal(await direct({ url: "/api/v3/other" }, {}), false);
  assert.equal(await direct({ url: "/api/v3/fill-missing-values?x=1" }, {}), false);
  const composed = await send(baseUrl, "/api/v3/fill-missing-values/anything");
  assert.equal(composed.status, 404);
  assert.equal(calls.length, 0);
});

test("rejects other methods on the values path with 405", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const response = await send(baseUrl, "/api/v3/fill-missing-values", { method: "PUT" });
  assert.equal(response.status, 405);
  assert.equal(calls.length, 0);
});
