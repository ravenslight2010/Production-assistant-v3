import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import * as XLSX from "xlsx";
import { createInventoryApi } from "./inventory-api.mjs";

const MANAGER = {
  verified: true,
  facilityId: "10000000-0000-4000-8000-000000000001",
  actorId: "10000000-0000-4000-8000-000000000002",
  capabilities: ["manage-inventory"],
};
const WAREHOUSE_ID = "10000000-0000-4000-8000-000000000003";

async function withApi(t, { auth = MANAGER, csrf = true, query = async () => ({ rows: [{ result: [] }] }), logger = () => {} } = {}) {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return query(text, values);
    },
  };
  const handler = createInventoryApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger,
  });
  const server = createServer(handler);
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

function workbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Procedure");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

test("inventory routes require a verified manager before database access", async (t) => {
  const unauthenticated = await withApi(t, { auth: null });
  const unauthResponse = await send(unauthenticated.baseUrl, "/api/v3/inventory/warehouses");
  assert.equal(unauthResponse.status, 401);
  assert.deepEqual(await unauthResponse.json(), { error: "Sign in to access inventory." });
  assert.equal(unauthenticated.calls.length, 0);

  const operator = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  const operatorResponse = await send(operator.baseUrl, "/api/v3/inventory/warehouses");
  assert.equal(operatorResponse.status, 403);
  assert.equal(operator.calls.length, 0);

  const restrictedPreview = await send(operator.baseUrl, "/api/v3/imports/workbooks/preview", {
    method: "POST",
    body: {},
  });
  assert.equal(restrictedPreview.status, 403);
  assert.equal(operator.calls.length, 0);
});

test("staff receive only guidance and mark-counted access while managers configure schedules", async (t) => {
  const staff = { ...MANAGER, capabilities: [] };
  const guidance = { factoryDate: "2026-11-21", cycleCounts: [], freezerPull: { groups: [] } };
  const api = await withApi(t, {
    auth: staff,
    query: async (sql) => ({ rows: [{ result: sql.includes("mark_cycle_counted") ? {
      outcome: "accepted", replayed: false, confirmationId: "10000000-0000-4000-8000-000000000012",
      section: "Dry storage", countedOn: "2026-11-21",
    } : guidance }] }),
  });
  const read = await send(api.baseUrl, "/api/v3/inventory/warehouse-guidance");
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), guidance);
  const marked = await send(api.baseUrl, "/api/v3/inventory/cycle-counts/mark", {
    method: "POST", body: { requestId: "count-staff-1", section: "Dry storage" },
  });
  assert.equal(marked.status, 200);
  assert.match(api.calls[1].text, /mark_cycle_counted/u);
  assert.equal(api.calls[1].values[4], "Dry storage");

  const configured = await send(api.baseUrl, "/api/v3/inventory/cycle-counts/schedules", {
    method: "POST", body: { requestId: "count-config-1", section: "Dry storage", cadenceDays: 7, enabled: true, expectedRevision: 0 },
  });
  assert.equal(configured.status, 403);
  const stock = await send(api.baseUrl, "/api/v3/inventory/warehouses");
  assert.equal(stock.status, 403);
  assert.equal(api.calls.length, 2);

  const noCsrf = await withApi(t, { auth: staff, csrf: false });
  const denied = await send(noCsrf.baseUrl, "/api/v3/inventory/cycle-counts/mark", {
    method: "POST", csrf: false, body: { requestId: "count-staff-2", section: "Dry storage" },
  });
  assert.equal(denied.status, 403);
  assert.equal(noCsrf.calls.length, 0);

  const manager = await withApi(t, { query: async () => ({ rows: [{ result: {
    outcome: "created", replayed: false,
    schedule: { section: "Dry storage", cadenceDays: 7, enabled: true, lastCountedOn: null, revision: 1 },
  } }] }) });
  const saved = await send(manager.baseUrl, "/api/v3/inventory/cycle-counts/schedules", {
    method: "POST", body: { requestId: "count-config-2", section: "Dry storage", cadenceDays: 7, enabled: true, expectedRevision: 0 },
  });
  assert.equal(saved.status, 200);
  assert.match(manager.calls[0].text, /save_cycle_count_schedule/u);
  assert.deepEqual(manager.calls[0].values.slice(4), ["Dry storage", 7, true, 0]);
});

test("warehouse guidance settings are strict, manager-only, and server hashed", async (t) => {
  const productId = "10000000-0000-4000-8000-000000000030";
  const api = await withApi(t, { query: async () => ({ rows: [{ result: { outcome: "saved", replayed: false, revision: 4 } }] }) });
  const staff = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  const body = {
    requestId: "guidance-settings-1", expirySoonDays: 14,
    reorderPoints: [{ productId, threshold: "12.500" }], expectedRevision: 3,
  };
  const denied = await send(staff.baseUrl, "/api/v3/inventory/warehouse-guidance", { method: "POST", body });
  assert.equal(denied.status, 403);
  assert.equal(staff.calls.length, 0);
  const saved = await send(api.baseUrl, "/api/v3/inventory/warehouse-guidance", { method: "POST", body });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { outcome: "saved", replayed: false, revision: 4 });
  assert.match(api.calls[0].text, /save_warehouse_guidance_settings/u);
  assert.deepEqual(api.calls[0].values.slice(4), [14, JSON.stringify(body.reorderPoints), 3]);
  const hashed = createHash("sha256").update(JSON.stringify({
    expirySoonDays: 14, reorderPoints: body.reorderPoints, expectedRevision: 3,
  })).digest("hex");
  assert.equal(api.calls[0].values[3], hashed);

  const malformed = [
    { ...body, requestId: "guidance-extra", extra: true },
    { ...body, requestId: "guidance-days", expirySoonDays: 366 },
    { ...body, requestId: "guidance-revision", expectedRevision: -1 },
    { ...body, requestId: "guidance-negative", reorderPoints: [{ productId, threshold: "-1" }] },
    { ...body, requestId: "guidance-number", reorderPoints: [{ productId, threshold: 12 }] },
    { ...body, requestId: "guidance-duplicate", reorderPoints: [{ productId, threshold: "1" }, { productId: productId.toUpperCase(), threshold: "2" }] },
  ];
  for (const candidate of malformed) {
    const response = await send(api.baseUrl, "/api/v3/inventory/warehouse-guidance", { method: "POST", body: candidate });
    assert.equal(response.status, 400);
  }
  assert.equal(api.calls.length, 1);
  const noCsrf = await withApi(t, { csrf: false });
  const csrfDenied = await send(noCsrf.baseUrl, "/api/v3/inventory/warehouse-guidance", { method: "POST", csrf: false, body });
  assert.equal(csrfDenied.status, 403);
  assert.equal(noCsrf.calls.length, 0);
});

test("freezer surplus APIs are strict, manager-only, and server hashed", async (t) => {
  const runId = "10000000-0000-4000-8000-000000000020";
  const lotId = "10000000-0000-4000-8000-000000000021";
  const scheduleRunId = "10000000-0000-4000-8000-000000000022";
  const eventId = "10000000-0000-4000-8000-000000000023";
  const api = await withApi(t, { query: async (sql) => ({ rows: [{ result: sql.includes("list_freezer_surplus") ? {
    lots: [], runs: [], scheduleRuns: [], allocations: [], events: [],
  } : { outcome: "accepted", replayed: false } }] }) });
  const staff = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  const staffRead = await send(staff.baseUrl, "/api/v3/inventory/freezer-surplus");
  assert.equal(staffRead.status, 403);
  assert.equal(staff.calls.length, 0);
  const read = await send(api.baseUrl, "/api/v3/inventory/freezer-surplus");
  assert.equal(read.status, 200);
  const confirm = { requestId: "surplus-confirm", runId, cases: 8 };
  assert.equal((await send(api.baseUrl, "/api/v3/inventory/freezer-surplus/confirm", { method: "POST", body: confirm })).status, 200);
  assert.match(api.calls[1].text, /confirm_freezer_surplus/u);
  assert.deepEqual(api.calls[1].values.slice(4), [runId, 8]);
  const allocation = { requestId: "surplus-allocate", lotId, productionDate: "2026-11-22", scheduleRunId, cases: 3, expectedRevision: 1 };
  assert.equal((await send(api.baseUrl, "/api/v3/inventory/freezer-surplus/allocations", { method: "POST", body: allocation })).status, 200);
  assert.deepEqual(api.calls[2].values.slice(4), [lotId, "2026-11-22", scheduleRunId, 3, 1]);
  const adjustment = { requestId: "surplus-adjust", lotId, eventType: "correction", cases: -1, reason: "Correct receipt", expectedRevision: 2, correctsEventId: eventId };
  assert.equal((await send(api.baseUrl, "/api/v3/inventory/freezer-surplus/adjustments", { method: "POST", body: adjustment })).status, 200);
  assert.deepEqual(api.calls[3].values.slice(4), [lotId, "correction", -1, "Correct receipt", 2, eventId]);
  const invalid = await send(api.baseUrl, "/api/v3/inventory/freezer-surplus/adjustments", {
    method: "POST", body: { ...adjustment, requestId: "missing-link", correctsEventId: undefined },
  });
  assert.equal(invalid.status, 400);
  const invalidDamageLink = await send(api.baseUrl, "/api/v3/inventory/freezer-surplus/adjustments", {
    method: "POST", body: { ...adjustment, requestId: "damage-link", eventType: "damage", cases: 1 },
  });
  assert.equal(invalidDamageLink.status, 400);
  assert.equal(api.calls.length, 4);
});

test("inventory movements preserve legacy hashes and validate optional lot metadata", async (t) => {
  const accepted = {
    outcome: "accepted", replayed: false,
    movementId: "10000000-0000-4000-8000-000000000010",
    warehouseId: WAREHOUSE_ID, productCode: "FLOUR", quantity: "25", revision: 1,
  };
  const api = await withApi(t, {
    query: async () => ({ rows: [{ result: accepted }] }),
  });
  const legacyBody = {
    commandId: "movement-legacy", warehouseId: WAREHOUSE_ID, productCode: "FLOUR",
    type: "receipt", quantity: "25", reason: "Legacy receipt",
  };
  const legacyResponse = await send(api.baseUrl, "/api/v3/inventory/movements", {
    method: "POST", body: legacyBody,
  });
  assert.equal(legacyResponse.status, 200);
  const legacyPayload = {
    warehouseId: WAREHOUSE_ID, productCode: "FLOUR", type: "receipt", quantity: "25", reason: "Legacy receipt",
  };
  const legacyHash = createHash("sha256").update(JSON.stringify(legacyPayload), "utf8").digest("hex");
  assert.equal(api.calls[0].values[3], legacyHash);
  assert.match(api.calls[0].text, /\$10::text, \$11::date, \$12::date/u);
  assert.deepEqual(api.calls[0].values.slice(9), [null, null, null]);

  const lotBody = {
    ...legacyBody, commandId: "movement-lot", lotNumber: "  LOT-A  ",
    receivedOn: "2026-11-01", expiresOn: "2026-12-01",
  };
  const lotResponse = await send(api.baseUrl, "/api/v3/inventory/movements", {
    method: "POST", body: lotBody,
  });
  assert.equal(lotResponse.status, 200);
  assert.deepEqual(api.calls[1].values.slice(9), ["LOT-A", "2026-11-01", "2026-12-01"]);
  assert.notEqual(api.calls[1].values[3], legacyHash);

  const rejectedBodies = [
    { ...legacyBody, commandId: "negative-lot", type: "adjustment", quantity: "-1", lotNumber: "LOT-A" },
    { ...legacyBody, commandId: "bad-date", receivedOn: "2026-02-30" },
    { ...legacyBody, commandId: "bad-expiration", receivedOn: "2026-12-01", expiresOn: "2026-11-30" },
    { ...legacyBody, commandId: "null-lot", lotNumber: null },
  ];
  for (const body of rejectedBodies) {
    const response = await send(api.baseUrl, "/api/v3/inventory/movements", { method: "POST", body });
    assert.equal(response.status, 400);
  }
  assert.equal(api.calls.length, 2);
});

test("inventory transfers remain strict and CSRF protected", async (t) => {
  const targetId = "10000000-0000-4000-8000-000000000004";
  const accepted = {
    outcome: "accepted", replayed: false, transferId: "10000000-0000-4000-8000-000000000011",
    productCode: "FLOUR", quantity: "5", sourceWarehouseId: WAREHOUSE_ID,
    sourceQuantity: "20", sourceRevision: 2, targetWarehouseId: targetId,
    targetQuantity: "5", targetRevision: 1,
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: accepted }] }) });
  const body = {
    commandId: "transfer-1", sourceWarehouseId: WAREHOUSE_ID, targetWarehouseId: targetId,
    productCode: "FLOUR", quantity: "5", reason: "Line replenishment",
  };
  const extra = await send(api.baseUrl, "/api/v3/inventory/transfers", {
    method: "POST", body: { ...body, lotNumber: "LOT-A" },
  });
  assert.equal(extra.status, 400);
  const sameWarehouse = await send(api.baseUrl, "/api/v3/inventory/transfers", {
    method: "POST", body: { ...body, targetWarehouseId: WAREHOUSE_ID },
  });
  assert.equal(sameWarehouse.status, 400);
  assert.equal(api.calls.length, 0);

  const response = await send(api.baseUrl, "/api/v3/inventory/transfers", { method: "POST", body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), accepted);
  assert.match(api.calls[0].text, /transfer_inventory/u);
  assert.deepEqual(api.calls[0].values.slice(4), [WAREHOUSE_ID, targetId, "FLOUR", "5", "Line replenishment"]);

  const noCsrf = await withApi(t, { csrf: false });
  const denied = await send(noCsrf.baseUrl, "/api/v3/inventory/transfers", { method: "POST", body, csrf: false });
  assert.equal(denied.status, 403);
  assert.equal(noCsrf.calls.length, 0);
});

test("reviewed die defaults are manager-only, strict, and attributed idempotent writes", async (t) => {
  const defaults = {
    crustsPerCycle: 0,
    cycleSpeed: 1.5,
    speedAdjustment: 1,
    freezerTime: 20,
    casesPerLayer: 5,
    preTunnelMin: null,
    postTunnelMin: null,
    pressOvenMin: 0,
    frontlineMin: null,
  };
  const saved = {
    outcome: "created", dieCode: "DIE-A", revision: 1, status: "active", defaults, replayed: false,
  };
  const api = await withApi(t, {
    query: async (sql) => {
      if (sql.includes("list_die_defaults")) return { rows: [{ result: [{ code: "DIE-A", name: "Die A" }] }] };
      if (sql.includes("list_die_default_events")) return { rows: [{ result: [] }] };
      if (sql.includes("save_die_default")) return { rows: [{ result: saved }] };
      throw new Error("Unexpected database operation");
    },
  });
  const read = await send(api.baseUrl, "/api/v3/inventory/die-defaults?limit=25");
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { defaults: [{ code: "DIE-A", name: "Die A" }], history: [] });
  assert.deepEqual(api.calls.slice(0, 2).map((call) => call.values), [
    [MANAGER.facilityId],
    [MANAGER.facilityId, 25],
  ]);

  const invalid = await send(api.baseUrl, "/api/v3/inventory/die-defaults", {
    method: "POST",
    body: {
      requestId: "die-a-create", dieCode: "DIE-A", expectedRevision: 0,
      defaults: { ...defaults, crustsPerCycle: null }, enabled: true,
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 2);
  const response = await send(api.baseUrl, "/api/v3/inventory/die-defaults", {
    method: "POST",
    body: {
      requestId: "die-a-create", dieCode: "DIE-A", expectedRevision: 0, defaults, enabled: true,
    },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), saved);
  const write = api.calls[2];
  assert.match(write.text, /save_die_default/);
  assert.deepEqual(write.values.slice(0, 3), [MANAGER.facilityId, MANAGER.actorId, "die-a-create"]);
  assert.match(write.values[3], /^[0-9a-f]{64}$/u);
  assert.equal(write.values[4], "DIE-A");
  assert.equal(write.values[5], 0);
  assert.equal(write.values[6], JSON.stringify(defaults));
  assert.equal(write.values[7], true);

  const operator = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  assert.equal((await send(operator.baseUrl, "/api/v3/inventory/die-defaults")).status, 403);
  assert.equal((await send(operator.baseUrl, "/api/v3/inventory/die-defaults", {
    method: "POST",
    body: { requestId: "die-a-create", dieCode: "DIE-A", expectedRevision: 0, defaults, enabled: true },
  })).status, 403);
  assert.equal(operator.calls.length, 0);

  const noCsrf = await withApi(t, { csrf: false });
  assert.equal((await send(noCsrf.baseUrl, "/api/v3/inventory/die-defaults", {
    method: "POST",
    body: { requestId: "die-a-create", dieCode: "DIE-A", expectedRevision: 0, defaults, enabled: true },
    csrf: false,
  })).status, 403);
  assert.equal(noCsrf.calls.length, 0);
});

test("setup import CSV is validated before staging and request hash is server-computed", async (t) => {
  const staged = {
    outcome: "staged",
    importId: "10000000-0000-4000-8000-000000000004",
    kind: "products",
    rowCount: 1,
    replayed: false,
  };
  const api = await withApi(t, {
    query: async () => ({ rows: [{ result: staged }] }),
  });
  const invalid = await send(api.baseUrl, "/api/v3/imports", {
    method: "POST",
    body: { requestId: "import-1", kind: "products", csv: "name,code,unit\nFlour,FLOUR,lb\n" },
  });
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 0);

  const response = await send(api.baseUrl, "/api/v3/imports", {
    method: "POST",
    body: { requestId: "import-1", kind: "products", csv: "code,name,unit\nFLOUR,Bread Flour,lb\n" },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ...staged,
    records: [{ code: "FLOUR", name: "Bread Flour", unit: "lb" }],
  });
  assert.match(api.calls[0].text, /stage_setup_import/);
  assert.deepEqual(api.calls[0].values.slice(0, 5), [
    MANAGER.facilityId,
    MANAGER.actorId,
    "import-1",
    api.calls[0].values[3],
    "products",
  ]);
  assert.match(api.calls[0].values[3], /^[0-9a-f]{64}$/);
  assert.notEqual(api.calls[0].values[3], "client-hash");
  assert.equal(api.calls[0].values[5], JSON.stringify([{ code: "FLOUR", name: "Bread Flour", unit: "lb" }]));
});

test("approved setup catalogs are manager-only, strict, and staged with a server hash", async (t) => {
  const staged = {
    outcome: "staged",
    importId: "10000000-0000-4000-8000-000000000005",
    family: "ingredients",
    rowCount: 1,
    replayed: false,
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: staged }] }) });
  const invalid = await send(api.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: {
      requestId: "catalog-1",
      family: "ingredients",
      csv: "code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\nI-1,Flour,oops,[],true,,true\n",
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 0);

  const response = await send(api.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: {
      requestId: "catalog-1",
      family: "ingredients",
      csv: 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
        'I-1,Flour,"[]","[]",true,,true\n',
    },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, {
    ...staged,
    records: [{
      code: "I-1",
      name: "Flour",
      data: { categories: [], allergens: [], allergensReviewed: true, mergedIntoCode: null, enabled: true },
    }],
  });
  assert.match(api.calls[0].text, /stage_setup_catalog_import/u);
  assert.match(api.calls[0].values[3], /^[0-9a-f]{64}$/u);
  assert.equal(api.calls[0].values[4], "ingredients");
});

test("typed catalog reads and edits are bounded, strict, and server hashed", async (t) => {
  const record = { code: "DIE-1", name: "12 inch", data: {} };
  const fingerprint = "a".repeat(64);
  const staged = {
    outcome: "staged", importId: "10000000-0000-4000-8000-000000000005",
    family: "die-types", rowCount: 1, replayed: false,
  };
  const api = await withApi(t, {
    query: async (sql) => ({ rows: [{ result: sql.includes("list_setup_catalog_records")
      ? { family: "die-types", records: [{ ...record, fingerprint }], nextCursor: null }
      : staged }] }),
  });
  const page = await send(api.baseUrl, "/api/v3/setup-catalog/records?family=die-types&limit=100");
  assert.equal(page.status, 200);
  assert.deepEqual(await page.json(), { family: "die-types", records: [{ ...record, fingerprint }], nextCursor: null });
  assert.deepEqual(api.calls[0].values.slice(1), ["die-types", 100, null]);

  const invalidPage = await send(api.baseUrl, "/api/v3/setup-catalog/records?family=die-types&after=bad%20cursor");
  assert.equal(invalidPage.status, 400);
  const invalidEdit = await send(api.baseUrl, "/api/v3/setup-catalog/edits", {
    method: "POST",
    body: { requestId: "typed-invalid", family: "die-types", record: { ...record, extra: true }, expectedFingerprint: fingerprint },
  });
  assert.equal(invalidEdit.status, 400);
  assert.equal(api.calls.length, 1);

  const response = await send(api.baseUrl, "/api/v3/setup-catalog/edits", {
    method: "POST",
    body: { requestId: "typed-1", family: "die-types", record, expectedFingerprint: fingerprint },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ...staged, records: [record] });
  const call = api.calls[1];
  assert.match(call.text, /stage_setup_catalog_edit/u);
  assert.deepEqual(call.values.slice(4), ["die-types", JSON.stringify(record), fingerprint]);
  assert.equal(call.values[3], createHash("sha256").update(JSON.stringify({
    family: "die-types", record, expectedFingerprint: fingerprint,
  })).digest("hex"));

  const operator = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  assert.equal((await send(operator.baseUrl, "/api/v3/setup-catalog/records?family=die-types")).status, 403);
  const noCsrf = await withApi(t, { csrf: false });
  assert.equal((await send(noCsrf.baseUrl, "/api/v3/setup-catalog/edits", {
    method: "POST", csrf: false,
    body: { requestId: "typed-no-csrf", family: "die-types", record, expectedFingerprint: fingerprint },
  })).status, 403);
  assert.equal(operator.calls.length + noCsrf.calls.length, 0);
});

test("typed product capacity reads and edits are bounded, strict, and server hashed", async (t) => {
  const record = {
    code: "DOUGH-1", name: "House dough", productCode: "PIZZA",
    data: {
      sourceFamily: "dough-procedure", sourceKey: null, fileName: null, fileSha256: null, source: null,
      doughballYield: 100, doughballWeightOz: null, doughballsPerTray: null,
    },
  };
  const fingerprint = "b".repeat(64);
  const staged = {
    outcome: "staged", importId: "10000000-0000-4000-8000-000000000015",
    kind: "recipes", rowCount: 1, replayed: false,
  };
  const api = await withApi(t, {
    query: async (sql) => ({ rows: [{ result: sql.includes("list_setup_master_records")
      ? { kind: "recipes", records: [{ ...record, fingerprint }], nextCursor: null }
      : staged }] }),
  });
  const page = await send(api.baseUrl, "/api/v3/imports/records?kind=recipes&limit=100");
  assert.equal(page.status, 200);
  assert.deepEqual(await page.json(), { kind: "recipes", records: [{ ...record, fingerprint }], nextCursor: null });
  assert.deepEqual(api.calls[0].values.slice(1), ["recipes", 100, null]);

  const invalidPage = await send(api.baseUrl, "/api/v3/imports/records?kind=recipes&after=bad%20cursor");
  assert.equal(invalidPage.status, 400);
  const invalidEdit = await send(api.baseUrl, "/api/v3/imports/edits", {
    method: "POST",
    body: {
      requestId: "master-invalid", kind: "recipes", expectedFingerprint: fingerprint,
      record: { ...record, data: { ...record.data, doughballYield: 0 } },
    },
  });
  assert.equal(invalidEdit.status, 400);
  assert.equal(api.calls.length, 1);

  const response = await send(api.baseUrl, "/api/v3/imports/edits", {
    method: "POST",
    body: { requestId: "master-1", kind: "recipes", record, expectedFingerprint: fingerprint },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ...staged, records: [record] });
  const call = api.calls[1];
  assert.match(call.text, /stage_setup_master_edit/u);
  assert.deepEqual(call.values.slice(4), ["recipes", JSON.stringify(record), fingerprint]);
  assert.equal(call.values[3], createHash("sha256").update(JSON.stringify({
    kind: "recipes", record, expectedFingerprint: fingerprint,
  })).digest("hex"));

  const operator = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  assert.equal((await send(operator.baseUrl, "/api/v3/imports/records?kind=recipes")).status, 403);
  const noCsrf = await withApi(t, { csrf: false });
  assert.equal((await send(noCsrf.baseUrl, "/api/v3/imports/edits", {
    method: "POST", csrf: false,
    body: { requestId: "master-no-csrf", kind: "recipes", record, expectedFingerprint: fingerprint },
  })).status, 403);
  assert.equal(operator.calls.length + noCsrf.calls.length, 0);
});

test("setup catalog history and writes stay manager-only and CSRF protected", async (t) => {
  const operator = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  const read = await send(operator.baseUrl, "/api/v3/setup-catalog/imports");
  assert.equal(read.status, 403);
  assert.equal(operator.calls.length, 0);
  const write = await send(operator.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: {
      requestId: "catalog-denied",
      family: "ingredients",
      csv: 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
        'I-1,Flour,"[]","[]",true,,true\n',
    },
  });
  assert.equal(write.status, 403);
  assert.equal(operator.calls.length, 0);

  const noCsrf = await withApi(t, { csrf: false });
  const rejected = await send(noCsrf.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: {
      requestId: "catalog-no-csrf",
      family: "ingredients",
      csv: 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
        'I-1,Flour,"[]","[]",true,,true\n',
    },
    csrf: false,
  });
  assert.equal(rejected.status, 403);
  assert.equal(noCsrf.calls.length, 0);

  const restrictedPreview = await send(operator.baseUrl, "/api/v3/setup-catalog/imports/workbooks/preview", {
    method: "POST",
    body: { family: "sauce-guides", fileName: "sauce.xlsx", workbookBase64: workbookBase64([["Acme uses Sauce on Classic at 3oz"]]) },
  });
  assert.equal(restrictedPreview.status, 403);
  assert.equal(operator.calls.length, 0);
});

test("source workbook preview is manager-only and its reviewed summary is bound to an idempotent stage", async (t) => {
  const csv = 'code,name,brand,flavor,values_json\n' +
    'SAUCE-ACME,Acme Classic,Acme,Classic,"{""frontlineRecipeName"":""House Red"",""sauceOzPerPizza"":3.5}"\n';
  const summary = {
    sourceFamily: "sauce-guides",
    sourceSha256: "a".repeat(64),
    parserVersion: "v1-source-import/2",
    sourceRows: 1,
    importedRows: 1,
    skippedRows: 0,
    unresolvedRows: 0,
  };
  const seenRequests = new Map();
  const api = await withApi(t, {
    query: async (sql, values) => {
      assert.match(sql, /stage_setup_catalog_import/u);
      const priorHash = seenRequests.get(values[2]);
      if (priorHash && priorHash !== values[3]) {
        throw Object.assign(new Error("Import request ID was reused with different details"), { code: "22023" });
      }
      const replayed = priorHash !== undefined;
      seenRequests.set(values[2], values[3]);
      return { rows: [{ result: {
        outcome: "staged",
        importId: "10000000-0000-4000-8000-000000000009",
        family: "run-templates",
        rowCount: JSON.parse(values[5]).length,
        revision: 1,
        sourceSummary: JSON.parse(values[6]),
        replayed,
      } }] };
    },
  });
  const preview = await send(api.baseUrl, "/api/v3/setup-catalog/imports/workbooks/preview", {
    method: "POST",
    body: {
      family: "sauce-guides",
      fileName: "sauce.xlsx",
      workbookBase64: workbookBase64([["Acme uses House Red on Classic at 3.5oz"]]),
    },
  });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.family, "sauce-guides");
  assert.equal(previewBody.parserVersion, "v1-source-import/2");
  assert.equal(previewBody.records.length, 1);
  assert.equal(previewBody.records[0].record.data.values.sauceOzPerPizza, 3.5);
  assert.equal(api.calls.length, 0);

  const request = {
    requestId: "source-sauce-1",
    family: "run-templates",
    csv,
    sourceSummary: summary,
    sourceRecords: [{
      code: "SAUCE-ACME",
      source: { workbook: "sauce.xlsx", cell: "Sheet1!A1" },
      sourceDetails: { procedure: "literal" },
    }],
  };
  const staged = await send(api.baseUrl, "/api/v3/setup-catalog/imports", { method: "POST", body: request });
  assert.equal(staged.status, 201);
  assert.deepEqual((await staged.json()).sourceSummary, summary);
  assert.deepEqual(JSON.parse(api.calls[0].values[6]), summary);
  assert.deepEqual(JSON.parse(api.calls[0].values[5])[0].source, request.sourceRecords[0].source);
  assert.deepEqual(JSON.parse(api.calls[0].values[5])[0].sourceDetails, request.sourceRecords[0].sourceDetails);
  assert.equal(Object.hasOwn(JSON.parse(api.calls[0].values[5])[0], "sourceRecords"), false);
  assert.match(api.calls[0].values[3], /^[0-9a-f]{64}$/u);

  const replay = await send(api.baseUrl, "/api/v3/setup-catalog/imports", { method: "POST", body: request });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(api.calls[0].values[3], api.calls[1].values[3]);
  assert.equal(api.calls[0].values[5], api.calls[1].values[5]);
  assert.equal(api.calls[0].values[6], api.calls[1].values[6]);

  const mismatched = await send(api.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: { ...request, sourceSummary: { ...summary, sourceSha256: "b".repeat(64) } },
  });
  assert.equal(mismatched.status, 400);
  assert.notEqual(api.calls[0].values[3], api.calls[2].values[3]);

  const missingCitation = await send(api.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: { ...request, requestId: "source-sauce-missing-citation", sourceRecords: undefined },
  });
  assert.equal(missingCitation.status, 400);
  assert.equal(api.calls.length, 3, "missing citations must not reach canonical staging");

  const legacy = await send(api.baseUrl, "/api/v3/setup-catalog/imports", {
    method: "POST",
    body: {
      ...request,
      requestId: "source-sauce-legacy",
      sourceSummary: { ...summary, parserVersion: "v1-source-import/1" },
    },
  });
  assert.equal(legacy.status, 400);
  assert.equal(api.calls.length, 3, "legacy parser summaries must not reach new staging");
});

test("combined review API projects canonical pinned imports without a setup-writing command", async (t) => {
  const specId = "a0000000-0000-4000-8000-000000000001";
  const mixId = "b0000000-0000-4000-8000-000000000002";
  const reviewId = "c0000000-0000-4000-8000-000000000003";
  const payload = {
    id: reviewId,
    createdBy: "99000000-0000-4000-8000-000000000001",
    createdAt: "2026-11-24T00:00:00.000Z",
    replayed: false,
    imports: [
      {
        importId: specId, revision: 1, family: "run-templates", status: "staged",
        sourceSummary: {
          sourceFamily: "spec-sheets", sourceSha256: "a".repeat(64), parserVersion: "v1-source-import/2",
          sourceRows: 1, importedRows: 1, skippedRows: 0, unresolvedRows: 0,
        },
        records: [{
          code: "RUN-A", name: "Run A",
          data: { brand: "Example", flavor: "House", values: { frontlineRecipeName: "House Red", sauceOzPerPizza: 3 } },
          source: { workbook: "spec.xlsx", cell: "Spec!A1" }, sourceDetails: null,
        }],
      },
      {
        importId: mixId, revision: 1, family: "mixes", status: "applied",
        sourceSummary: {
          sourceFamily: "premix-sheets", sourceSha256: "b".repeat(64), parserVersion: "v1-source-import/2",
          sourceRows: 1, importedRows: 1, skippedRows: 0, unresolvedRows: 0,
        },
        records: [{
          code: "HOUSE-RED", name: "House Red",
          data: { brand: "Example", flavor: "House", batchSizeLbs: 40, daysEarly: 1, notes: "", isPrep: true, enabled: true, components: [] },
          source: { workbook: "sauce.xlsx", cell: "Sauce!A2" }, sourceDetails: { literal: true },
        }],
      },
    ],
    currentRecords: [],
  };
  const api = await withApi(t, {
    query: async (sql, values) => {
      if (sql.includes("create_combined_setup_review")) {
        assert.deepEqual(JSON.parse(values[4]), [specId, mixId]);
        return { rows: [{ result: payload }] };
      }
      if (sql.includes("get_combined_setup_review")) return { rows: [{ result: { ...payload, replayed: undefined } }] };
      if (sql.includes("list_combined_setup_reviews")) {
        return { rows: [{ result: [{ id: reviewId, createdBy: payload.createdBy, createdAt: payload.createdAt, importCount: 2, recordCount: 2 }] }] };
      }
      throw new Error("Unexpected combined-review query");
    },
  });
  const body = { requestId: "combined-api", importIds: [mixId, specId] };
  const created = await send(api.baseUrl, "/api/v3/setup-catalog/combined-reviews", { method: "POST", body });
  assert.equal(created.status, 201);
  const review = await created.json();
  assert.equal(review.id, reviewId);
  assert.deepEqual(review.imports.map((item) => item.importId), [specId, mixId]);
  assert.equal(review.missingDependencies.length, 0);
  assert.equal(review.entries.find((entry) => entry.field === "values.sauceOzPerPizza").disposition, "fill");
  assert.equal(review.entries.find((entry) => entry.field === "values.sauceOzPerPizza").proposals[0].source.cell, "Spec!A1");
  assert.equal(api.calls.every((call) => !/apply_setup_catalog_import|stage_setup_catalog_edit/u.test(call.sql)), true);

  const reopened = await send(api.baseUrl, `/api/v3/setup-catalog/combined-reviews/${reviewId}`);
  assert.equal(reopened.status, 200);
  assert.equal((await reopened.json()).replayed, false);
  const listed = await send(api.baseUrl, "/api/v3/setup-catalog/combined-reviews?limit=10");
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).reviews[0].recordCount, 2);

  const duplicate = await send(api.baseUrl, "/api/v3/setup-catalog/combined-reviews", {
    method: "POST", body: { requestId: "combined-duplicate", importIds: [specId, specId] },
  });
  assert.equal(duplicate.status, 400);
});

test("workbook source rows are linked exactly and staged through the reviewed import lifecycle", async (t) => {
  const api = await withApi(t, {
    query: async (sql, values) => {
      if (sql.includes("list_inventory_products")) {
        return { rows: [{ result: [{ code: "DOUGH-A", name: "North Shop", active: true }] }] };
      }
      if (sql.includes("list_workbook_source_links")) return { rows: [{ result: [] }] };
      if (sql.includes("stage_setup_import")) {
        return { rows: [{ result: {
          outcome: "staged",
          importId: "10000000-0000-4000-8000-000000000008",
          kind: values[4],
          rowCount: JSON.parse(values[5]).length,
          replayed: false,
        } }] };
      }
      throw new Error("Unexpected test query");
    },
  });
  const response = await send(api.baseUrl, "/api/v3/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "dough-workbook-1",
      family: "dough-procedure",
      fileName: "north-dough.xlsx",
      productLinks: [],
      workbookBase64: workbookBase64([
        ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
        ["North Shop", 7.7, 310.5, 645.19, 84],
      ]),
    },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.sourceFamily, "dough-procedure");
  assert.equal(body.linkedCount, 1);
  assert.equal(body.unmatchedCount, 0);
  assert.equal(body.records[0].productCode, "DOUGH-A");
  assert.equal(body.records[0].data.doughballYield, 645.19);
  assert.equal(body.records[0].data.source.yieldCell, "Procedure!D2");
  const stageCall = api.calls.find((call) => call.text.includes("stage_setup_import"));
  assert.ok(stageCall);
  assert.equal(stageCall.values[4], "recipes");
  assert.notEqual(stageCall.values[3], "client-hash");
});

test("workbook upload rejects unmatched rows and legacy XLS files without staging", async (t) => {
  const api = await withApi(t, {
    query: async (sql) => {
      if (sql.includes("list_inventory_products")) return { rows: [{ result: [] }] };
      if (sql.includes("list_workbook_source_links")) return { rows: [{ result: [] }] };
      throw new Error("Workbook with no matches should not stage");
    },
  });
  const validWorkbook = workbookBase64([
    ["Pizza", "Notes", "Pizzas/CS"],
    ["North Shop", "", 12],
  ]);
  const unmatched = await send(api.baseUrl, "/api/v3/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "shipping-no-match",
      family: "shipping-guide",
      fileName: "shipping.xlsx",
      productLinks: [],
      workbookBase64: validWorkbook,
    },
  });
  assert.equal(unmatched.status, 409);
  assert.match((await unmatched.json()).error, /select an active product/iu);

  const unsupported = await send(api.baseUrl, "/api/v3/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "wrong-family",
      family: "dough-procedure",
      fileName: "schedule.xls",
      productLinks: [],
      workbookBase64: validWorkbook,
    },
  });
  assert.equal(unsupported.status, 400);
  assert.equal(api.calls.length, 2);
});

test("workbook preview is read-only and manager mappings can stage only unresolved active products", async (t) => {
  const workbook = workbookBase64([
    ["Pizza", "Notes", "Pizzas/CS"],
    ["Known Product", "", 12],
    ["Misspelled Product", "", 10],
    ["Ambiguous Product", "", 8],
  ]);
  const products = [
    { code: "KNOWN", name: "Known Product", active: true },
    { code: "TARGET", name: "Correct Product", active: true },
    { code: "DUP-A", name: "Ambiguous Product", active: true },
    { code: "DUP-B", name: " ambiguous product ", active: true },
  ];
  const api = await withApi(t, {
    query: async (sql, values) => {
      if (sql.includes("list_inventory_products")) return { rows: [{ result: products }] };
      if (sql.includes("list_workbook_source_links")) return { rows: [{ result: [] }] };
      if (sql.includes("stage_setup_import")) {
        return { rows: [{ result: {
          outcome: "staged",
          importId: "10000000-0000-4000-8000-000000000008",
          kind: values[4],
          rowCount: JSON.parse(values[5]).length,
          replayed: false,
        } }] };
      }
      throw new Error("Unexpected workbook mapping query");
    },
  });
  const preview = await send(api.baseUrl, "/api/v3/imports/workbooks/preview", {
    method: "POST",
    body: { family: "shipping-guide", fileName: "shipping.xlsx", workbookBase64: workbook },
  });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.deepEqual(previewBody.rows.map(({ reason }) => reason), ["exact", "unmatched", "ambiguous"]);
  assert.equal(previewBody.products.length, products.length);
  assert.equal(api.calls.some((call) => call.text.includes("stage_setup_import")), false);

  const mapping = [{ sourceKey: previewBody.rows[1].sourceKey, productCode: "TARGET" }];
  const staged = await send(api.baseUrl, "/api/v3/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "shipping-manager-map",
      family: "shipping-guide",
      fileName: "shipping.xlsx",
      productLinks: mapping,
      workbookBase64: workbook,
    },
  });
  assert.equal(staged.status, 201);
  const stagedBody = await staged.json();
  assert.equal(stagedBody.linkedCount, 2);
  assert.equal(stagedBody.managerMappedCount, 1);
  assert.deepEqual(stagedBody.unmatchedRows.map(({ reason }) => reason), ["ambiguous"]);
  assert.deepEqual(stagedBody.records.map(({ productCode }) => productCode), ["KNOWN", "TARGET"]);
  assert.equal(api.calls.some((call) => call.text.includes("stage_setup_import")), true);

  const exactOverride = await send(api.baseUrl, "/api/v3/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "shipping-exact-override",
      family: "shipping-guide",
      fileName: "shipping.xlsx",
      productLinks: [{ sourceKey: previewBody.rows[0].sourceKey, productCode: "TARGET" }],
      workbookBase64: workbook,
    },
  });
  assert.equal(exactOverride.status, 400);
  assert.match((await exactOverride.json()).error, /unmatched workbook row/u);

  const inactiveOverride = await send(api.baseUrl, "/api/v3/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "shipping-inactive-override",
      family: "shipping-guide",
      fileName: "shipping.xlsx",
      productLinks: [{ sourceKey: previewBody.rows[1].sourceKey, productCode: "INACTIVE" }],
      workbookBase64: workbook,
    },
  });
  assert.equal(inactiveOverride.status, 400);
  assert.match((await inactiveOverride.json()).error, /active product/u);
});

test("setup import details can be reopened by another manager", async (t) => {
  const importId = "10000000-0000-4000-8000-000000000007";
  const record = {
    id: importId,
    kind: "recipes",
    status: "staged",
    records: [{ code: "DOUGH", name: "Bread Dough", productCode: "FLOUR", data: { hydration: 0.62 } }],
    createdBy: MANAGER.actorId,
    appliedBy: null,
    undoneBy: null,
    createdAt: "2026-11-16T12:00:00.000Z",
    appliedAt: null,
    undoneAt: null,
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: record }] }) });
  const response = await send(api.baseUrl, `/api/v3/imports/${importId}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).import, record);
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, importId]);
});

test("write routes enforce CSRF and bound the CSV body", async (t) => {
  const denied = await withApi(t, { csrf: false });
  const response = await send(denied.baseUrl, "/api/v3/inventory/warehouses", {
    method: "POST",
    body: { requestId: "warehouse-1", name: "Main" },
  });
  assert.equal(response.status, 403);
  assert.equal(denied.calls.length, 0);

  const api = await withApi(t);
  const oversized = await send(api.baseUrl, "/api/v3/imports", {
    method: "POST",
    body: { requestId: "too-large", kind: "products", csv: "x".repeat(2 * 1024 * 1024) },
  });
  assert.equal(oversized.status, 413);
  assert.equal(api.calls.length, 0);
});

test("CSV staging is rate-limited per manager with a Retry-After response", async (t) => {
  const api = await withApi(t, {
    query: async () => ({
      rows: [{
        result: {
          outcome: "staged",
          importId: "10000000-0000-4000-8000-000000000004",
          kind: "products",
          rowCount: 1,
          replayed: false,
        },
      }],
    }),
  });
  for (let index = 0; index < 10; index += 1) {
    const response = await send(api.baseUrl, "/api/v3/imports", {
      method: "POST",
      body: {
        requestId: `limited-${index}`,
        kind: "products",
        csv: `code,name,unit\nP${index},Product ${index},each\n`,
      },
    });
    assert.equal(response.status, 201);
  }
  const limited = await send(api.baseUrl, "/api/v3/imports", {
    method: "POST",
    body: { requestId: "limited-final", kind: "products", csv: "code,name,unit\nLAST,Last product,each\n" },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(api.calls.length, 10);
});

test("warehouse reads stay facility-scoped and reject unsupported query parameters", async (t) => {
  const api = await withApi(t, {
    query: async () => ({ rows: [{ result: [{ id: WAREHOUSE_ID, name: "Main", active: true }] }] }),
  });
  const response = await send(api.baseUrl, "/api/v3/inventory/warehouses?facilityId=other");
  assert.equal(response.status, 400);
  assert.equal(api.calls.length, 0);

  const valid = await send(api.baseUrl, `/api/v3/inventory/stock?warehouseId=${WAREHOUSE_ID}`);
  assert.equal(valid.status, 200);
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, WAREHOUSE_ID]);
});

test("production warehouse selection uses a manager-scoped, server-hashed command", async (t) => {
  const selection = {
    outcome: "accepted",
    replayed: false,
    warehouse: {
      id: WAREHOUSE_ID,
      name: "Main",
      active: true,
      isProduction: true,
      openingCountApplied: true,
    },
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: selection }] }) });
  const denied = await withApi(t, { csrf: false });
  const blocked = await send(denied.baseUrl, "/api/v3/inventory/production-warehouse", {
    method: "POST",
    body: { requestId: "set-production-1", warehouseId: WAREHOUSE_ID },
  });
  assert.equal(blocked.status, 403);
  assert.equal(denied.calls.length, 0);

  const response = await send(api.baseUrl, "/api/v3/inventory/production-warehouse", {
    method: "POST",
    body: { requestId: "set-production-1", warehouseId: WAREHOUSE_ID },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), selection);
  assert.match(api.calls[0].text, /v3\.set_production_warehouse/);
  assert.deepEqual(api.calls[0].values.slice(0, 3), [
    MANAGER.facilityId,
    MANAGER.actorId,
    "set-production-1",
  ]);
  assert.match(api.calls[0].values[3], /^[0-9a-f]{64}$/);
  assert.equal(api.calls[0].values[4], WAREHOUSE_ID);
});

test("opening-count history is manager-scoped and bounded", async (t) => {
  const api = await withApi(t, {
    query: async () => ({
      rows: [{ result: [{
        id: "10000000-0000-4000-8000-000000000005",
        warehouseId: WAREHOUSE_ID,
        warehouseName: "Main",
        status: "reviewed",
        rowCount: 1,
        createdAt: "2026-11-16T12:00:00.000Z",
      }] }],
    }),
  });
  const response = await send(api.baseUrl, "/api/v3/inventory/opening-counts?limit=25");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).counts[0].status, "reviewed");
  assert.match(api.calls[0].text, /list_opening_counts/);
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, 25]);

  const invalid = await send(api.baseUrl, "/api/v3/inventory/opening-counts?limit=101");
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 1);
});

test("movement history uses a bounded timestamp-and-ID cursor", async (t) => {
  const movementId = "10000000-0000-4000-8000-000000000006";
  const occurredAt = "2026-11-16T12:00:00.123456Z";
  const api = await withApi(t, {
    query: async () => ({
      rows: [{ result: {
        items: [{ id: movementId, actorId: MANAGER.actorId, occurredAt }],
        nextCursor: { id: movementId, occurredAt },
      } }],
    }),
  });
  const url = new URL(`/api/v3/inventory/movements?warehouseId=${WAREHOUSE_ID}&limit=25&beforeAt=${encodeURIComponent(occurredAt)}&beforeId=${movementId}`, "http://test");
  const response = await send(api.baseUrl, `${url.pathname}${url.search}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).nextCursor, { id: movementId, occurredAt });
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, WAREHOUSE_ID, 25, occurredAt, movementId]);

  const invalid = await send(api.baseUrl, `/api/v3/inventory/movements?warehouseId=${WAREHOUSE_ID}&beforeId=${movementId}`);
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 1);
});

test("unexpected database errors are safe to callers and do not log request data", async (t) => {
  const logs = [];
  const api = await withApi(t, {
    query: async () => {
      throw Object.assign(new Error("sensitive SQL and CSV contents"), { code: "XX001", name: "DatabaseError" });
    },
    logger: (entry) => logs.push(entry),
  });
  const response = await send(api.baseUrl, "/api/v3/inventory/warehouses");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "The inventory request could not be completed. Refresh and try again.",
  });
  assert.doesNotMatch(JSON.stringify(logs), /sensitive SQL|CSV contents/);
  assert.equal(logs[0].event, "v3.inventory_api.error");
  assert.equal(logs[0].operation, "list_warehouses");
});
