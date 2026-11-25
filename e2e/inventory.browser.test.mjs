import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, firefox } from "playwright";
import { parseOpeningCountCsv } from "../core/import-csv.mjs";

const CSRF_TOKEN = "b".repeat(43);
const STAFF_ID = "76000000-0000-4000-8000-000000000001";
const WAREHOUSE_ID = "76000000-0000-4000-8000-000000000002";
const TARGET_WAREHOUSE_ID = "76000000-0000-4000-8000-000000000004";
const COUNT_ID = "76000000-0000-4000-8000-000000000003";
const PRODUCT_IDS = [
  "76000000-0000-4000-8000-000000000011",
  "76000000-0000-4000-8000-000000000012",
];
const MOVEMENT_IDS = [
  "76000000-0000-4000-8000-000000000021",
  "76000000-0000-4000-8000-000000000022",
];
const GROUP_ID = "76000000-0000-4000-8000-000000000030";
const SURPLUS_RUN_ZERO = "76000000-0000-4000-8000-000000000061";
const SURPLUS_RUN_STORE = "76000000-0000-4000-8000-000000000062";
const SURPLUS_LOT_ID = "76000000-0000-4000-8000-000000000063";
const SURPLUS_SCHEDULE_RUN_ID = "76000000-0000-4000-8000-000000000064";
const SURPLUS_RECEIPT_EVENT_ID = "76000000-0000-4000-8000-000000000065";
const SURPLUS_ALLOCATION_ID = "76000000-0000-4000-8000-000000000066";
const SURPLUS_ALLOCATION_EVENT_ID = "76000000-0000-4000-8000-000000000067";
const SURPLUS_DAMAGE_EVENT_ID = "76000000-0000-4000-8000-000000000068";
const SURPLUS_CORRECTION_EVENT_ID = "76000000-0000-4000-8000-000000000069";
const CSV = "product_code,quantity\nDOUGH-A,12.5\nCHEESE-A,0\n";
const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);
const PRODUCTS = [
  { id: PRODUCT_IDS[0], code: "DOUGH-A", name: "Browser Dough", unit: "lb", active: true },
  { id: PRODUCT_IDS[1], code: "CHEESE-A", name: "Browser Cheese", unit: "lb", active: true },
];

async function serveDist(t) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    let asset = PUBLIC_FILES.get(pathname);
    if (!asset && /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pathname)) {
      asset = [pathname.slice(1), pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"];
    }
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(new URL(asset[0], DIST));
      response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openBrowser(t) {
  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browserType = { webkit, firefox }[process.env.BROWSER] || chromium;
  const args = browserType === chromium ? ["--no-sandbox"] : [];
  const browser = await browserType.launch({ headless: true, args });
  t.after(() => browser.close());
  return browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

async function installInventoryApi(context, baseUrl, { manager = true, established = false, surplus = false, malformedGuidance = false } = {}) {
  const warehouses = [];
  const counts = new Map();
  const requests = new Map();
  const commandResults = new Map();
  const inventoryRequests = [];
  const writes = [];
  const stock = new Map();
  const targetStock = new Map();
  const movements = [];
  const targetMovements = [];
  const stockByWarehouse = new Map([[WAREHOUSE_ID, stock], [TARGET_WAREHOUSE_ID, targetStock]]);
  const movementsByWarehouse = new Map([[WAREHOUSE_ID, movements], [TARGET_WAREHOUSE_ID, targetMovements]]);
  const guidance = {
    factoryDate: "2026-11-21",
    cycleCounts: [{ section: "Dry storage", cadenceDays: 7, enabled: true, lastCountedOn: null, revision: 1, due: true, overdueDays: null }],
    freezerPull: { groups: [{ productionDate: "2026-11-23", runId: "76000000-0000-4000-8000-000000000051", productCode: "PIZZA-A", targetCases: 10, effectiveTargetCases: 6, items: [
      { code: "FREEZER-FLOUR", ingredientName: "Browser Dough", productCode: "DOUGH-A", quantity: "20", unit: "lb", resolved: true, warning: null },
      { code: "FREEZER-SAUCE", ingredientName: "Browser Sauce", productCode: "SAUCE-A", quantity: null, unit: "lb", resolved: false, warning: "Scheduled quantity is unresolved; check station capacity." },
    ] }] },
    settings: { expirySoonDays: 7, revision: 2, reorderPoints: [
      { productId: PRODUCT_IDS[0], productCode: "DOUGH-A", productName: "Browser Dough", unit: "lb", threshold: "10" },
    ] },
    reorder: [{ productId: PRODUCT_IDS[0], productCode: "DOUGH-A", productName: "Browser Dough", unit: "lb", onHand: "55", scheduledDemand: "50", projectedOnHand: "5", threshold: "10", suggestedQuantity: "5" }],
    useFirst: [{ lotId: "76000000-0000-4000-8000-000000000071", productId: PRODUCT_IDS[0], productCode: "DOUGH-A", productName: "Browser Dough", unit: "lb", warehouseId: WAREHOUSE_ID, warehouseName: "Browser Source", lotNumber: "LOT-EXPIRING", quantity: "5", expiresOn: "2026-11-22", daysLeft: 1, expired: false, demandedToday: true }],
    warehouseNeeds: { warnings: ["Run 2: Browser Cheese has no resolved recipe quantity."], groups: [{ area: "Dough", items: [
      { productId: PRODUCT_IDS[0], productCode: "DOUGH-A", productName: "Browser Dough", unit: "lb", quantity: "50", resolved: true, runs: [{ scheduleRunId: "76000000-0000-4000-8000-000000000051", productionDate: "2026-11-23", runLabel: "Run 1 — Pizza", quantity: "30", resolved: true, warning: null }] },
      { productId: PRODUCT_IDS[1], productCode: "CHEESE-A", productName: "Browser Cheese", unit: null, quantity: null, resolved: false, runs: [{ scheduleRunId: "76000000-0000-4000-8000-000000000051", productionDate: "2026-11-23", runLabel: "Run 2 — Pizza", quantity: null, resolved: false, warning: "Browser Cheese has no resolved recipe quantity." }] },
    ] }] },
    transferGuidance: [{ warehouseId: WAREHOUSE_ID, warehouseName: "Browser Source", productId: PRODUCT_IDS[0], productCode: "DOUGH-A", productName: "Browser Dough", unit: "lb", needed: "30", onSite: "5", offSite: "50", shortfall: "25", suggestedQuantity: "25", sources: [{ warehouseId: TARGET_WAREHOUSE_ID, warehouseName: "Browser Target", quantity: "50" }] }],
    switchovers: [{ runId: "76000000-0000-4000-8000-000000000072", runLabel: "Running Pizza", pressCasesLeft: "2", skidsLeft: 0.4, packagingStage: true, shortRun: false, pressStopAt: "2026-11-21T15:00:00.000Z", lineClearAt: "2026-11-21T15:20:00.000Z", nextRunLabels: ["Run 2 — Next Pizza"] }],
  };
  const surplusLedger = {
    lots: [],
    runs: surplus ? [
      { runId: SURPLUS_RUN_ZERO, label: "No-surplus completed run", productCode: "PIZZA-A", completedAt: "2026-11-21T13:00:00.000Z", decision: null, lotId: null },
      { runId: SURPLUS_RUN_STORE, label: "Stored-surplus completed run", productCode: "PIZZA-A", completedAt: "2026-11-21T14:00:00.000Z", decision: null, lotId: null },
    ] : [],
    scheduleRuns: surplus ? [{ productionDate: "2026-11-23", runId: SURPLUS_SCHEDULE_RUN_ID, productCode: "PIZZA-A", targetCases: 10, carriedInCases: 0, effectiveTargetCases: 10 }] : [],
    allocations: [],
    events: [],
  };
  let loseNextStageResponse = false;
  let loseNextMovementResponse = false;
  let loseNextCountResponse = false;
  let loseNextSurplusResponse = false;
  let loseNextSettingsResponse = false;
  let nextMovementId = 40;
  const newMovementId = () => `76000000-0000-4000-8000-${String(nextMovementId++).padStart(12, "0")}`;
  const changeStock = (warehouseId, code, delta) => {
    const warehouseStock = stockByWarehouse.get(warehouseId);
    const product = PRODUCTS.find((item) => item.code === code);
    const current = warehouseStock.get(code) ?? {
      productId: product.id, code: product.code, name: product.name, unit: product.unit, quantity: "0", revision: 0,
    };
    const next = { ...current, quantity: String(Number(current.quantity) + Number(delta)), revision: current.revision + 1 };
    warehouseStock.set(code, next);
    return next;
  };
  const addMovement = (warehouseId, code, type, quantityDelta, reason, movementGroupId) => {
    const product = PRODUCTS.find((item) => item.code === code);
    movementsByWarehouse.get(warehouseId).unshift({
      id: newMovementId(), movementGroupId, productCode: code, productName: product.name, unit: product.unit,
      type, quantityDelta, reason, actorId: STAFF_ID, occurredAt: "2026-11-21T13:00:00.000Z",
    });
  };
  if (established) {
    warehouses.push(
      { id: WAREHOUSE_ID, name: "Browser Source", active: true, isProduction: true, createdAt: "2026-11-21T11:00:00.000Z", openingCountApplied: true },
      { id: TARGET_WAREHOUSE_ID, name: "Browser Target", active: true, isProduction: false, createdAt: "2026-11-21T11:01:00.000Z", openingCountApplied: true },
    );
    PRODUCTS.forEach((product) => {
      stock.set(product.code, { productId: product.id, code: product.code, name: product.name, unit: product.unit, quantity: "20", revision: 1 });
      targetStock.set(product.code, { productId: product.id, code: product.code, name: product.name, unit: product.unit, quantity: "0", revision: 1 });
    });
  }

  const countSummary = (count) => ({
    id: count.id,
    warehouseId: count.warehouseId,
    warehouseName: warehouses.find((warehouse) => warehouse.id === count.warehouseId).name,
    status: count.status,
    rowCount: count.rows.length,
    createdBy: count.createdBy,
    reviewedBy: count.reviewedBy,
    appliedBy: count.appliedBy,
    createdAt: count.createdAt,
    reviewedAt: count.reviewedAt,
    appliedAt: count.appliedAt,
  });
  const applyCount = (count) => {
    const warehouse = warehouses.find((item) => item.id === count.warehouseId);
    warehouse.openingCountApplied = true;
    count.rows.forEach((row, index) => {
      const product = PRODUCTS.find((item) => item.code === row.productCode);
      stock.set(row.productCode, {
        productId: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        quantity: row.quantity,
        revision: 1,
      });
      movements.unshift({
        id: MOVEMENT_IDS[index],
        movementGroupId: GROUP_ID,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        type: "opening_count",
        quantityDelta: row.quantity,
        reason: `Browser opening count ${row.productCode}`,
        actorId: STAFF_ID,
        occurredAt: `2026-11-21T12:0${3 - index}:00.000Z`,
      });
    });
  };

  await context.addCookies([{ name: "v3_csrf", value: CSRF_TOKEN, url: baseUrl }]);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") {
      return json(route, {
        staff: { userId: STAFF_ID, username: "manager", role: "manager", capabilities: manager ? ["manage-inventory"] : [] },
        expiresAt: "2026-11-22T12:00:00.000Z",
      });
    }
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path.startsWith("/api/v3/inventory/")) inventoryRequests.push(`${method} ${path}`);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) writes.push(`${method} ${path}`);
    if (path === "/api/v3/inventory/warehouse-guidance" && method === "GET") return json(route, malformedGuidance ? { factoryDate: guidance.factoryDate, cycleCounts: [], freezerPull: { groups: [] } } : guidance);
    if (path === "/api/v3/inventory/warehouse-guidance" && method === "POST") {
      if (!manager) return json(route, { error: "Forbidden" }, 403);
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["expectedRevision", "expirySoonDays", "reorderPoints", "requestId"]);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "settings retry must preserve the exact payload and request identity");
        return json(route, { ...commandResults.get(body.requestId), replayed: true });
      }
      requests.set(body.requestId, body);
      assert.equal(body.expectedRevision, guidance.settings.revision);
      guidance.settings = {
        expirySoonDays: body.expirySoonDays, revision: guidance.settings.revision + 1,
        reorderPoints: body.reorderPoints.filter((point) => Number(point.threshold) > 0).map((point) => {
          const product = PRODUCTS.find((item) => item.id === point.productId);
          return { productId: point.productId, productCode: product.code, productName: product.name, unit: product.unit, threshold: point.threshold };
        }),
      };
      const result = { outcome: "saved", replayed: false, revision: guidance.settings.revision };
      commandResults.set(body.requestId, result);
      if (loseNextSettingsResponse) {
        loseNextSettingsResponse = false;
        return json(route, { error: "Synthetic response loss after settings commit." }, 500);
      }
      return json(route, result);
    }
    if (path === "/api/v3/inventory/cycle-counts/mark" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["requestId", "section"]);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "cycle-count retry must preserve exact request bytes");
        return json(route, { ...commandResults.get(body.requestId), replayed: true });
      }
      requests.set(body.requestId, body);
      const schedule = guidance.cycleCounts.find((item) => item.section === body.section && item.enabled);
      assert.ok(schedule);
      schedule.lastCountedOn = guidance.factoryDate;
      schedule.due = false;
      schedule.revision += 1;
      const result = { outcome: "accepted", replayed: false, confirmationId: "76000000-0000-4000-8000-000000000052", section: body.section, countedOn: guidance.factoryDate };
      commandResults.set(body.requestId, result);
      if (loseNextCountResponse) {
        loseNextCountResponse = false;
        return json(route, { error: "Synthetic response loss after count commit." }, 500);
      }
      return json(route, result);
    }
    if (!manager) return json(route, { error: "Forbidden" }, 403);
    if (path === "/api/v3/inventory/cycle-counts/schedules" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior);
        return json(route, { ...commandResults.get(body.requestId), replayed: true });
      }
      requests.set(body.requestId, body);
      const existing = guidance.cycleCounts.find((item) => item.section === body.section);
      assert.equal(body.expectedRevision, existing?.revision ?? 0);
      const schedule = existing ?? { section: body.section, lastCountedOn: null, due: true, overdueDays: null, revision: 0 };
      Object.assign(schedule, { cadenceDays: body.cadenceDays, enabled: body.enabled, revision: schedule.revision + 1, due: body.enabled && schedule.lastCountedOn === null });
      if (!existing) guidance.cycleCounts.push(schedule);
      const result = { outcome: existing ? body.enabled ? "updated" : "retired" : "created", replayed: false, schedule };
      commandResults.set(body.requestId, result);
      return json(route, result);
    }
    if (path === "/api/v3/inventory/freezer-surplus" && method === "GET") return json(route, surplusLedger);
    if (path === "/api/v3/inventory/freezer-surplus/confirm" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "surplus confirmation retry must preserve exact request bytes");
        return json(route, { ...commandResults.get(body.requestId), replayed: true });
      }
      requests.set(body.requestId, body);
      const run = surplusLedger.runs.find((item) => item.runId === body.runId);
      assert.ok(run);
      assert.equal(run.decision, null, "a new request cannot replace an immutable decision");
      let result;
      if (body.cases === 0) {
        Object.assign(run, { decision: "none", lotId: null });
        result = { outcome: "accepted", replayed: false, runId: run.runId, decision: "none", lotId: null, cases: 0 };
      } else {
        assert.equal(run.runId, SURPLUS_RUN_STORE);
        const lot = { id: SURPLUS_LOT_ID, productCode: run.productCode, productionDate: "2026-11-21", totalCases: body.cases, remainingCases: body.cases, revision: 1, createdAt: "2026-11-21T14:01:00.000Z" };
        surplusLedger.lots.push(lot);
        surplusLedger.events.unshift({ id: SURPLUS_RECEIPT_EVENT_ID, lotId: lot.id, eventType: "receipt", quantityDelta: body.cases, reason: "Completed run surplus receipt", correctsEventId: null, createdAt: "2026-11-21T14:01:00.000Z" });
        Object.assign(run, { decision: "stored", lotId: lot.id });
        result = { outcome: "accepted", replayed: false, runId: run.runId, decision: "stored", lotId: lot.id, cases: body.cases, remainingCases: lot.remainingCases, revision: lot.revision };
      }
      commandResults.set(body.requestId, result);
      if (loseNextSurplusResponse) {
        loseNextSurplusResponse = false;
        return json(route, { error: "Synthetic surplus response loss after commit." }, 500);
      }
      return json(route, result);
    }
    if (path === "/api/v3/inventory/freezer-surplus/allocations" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "surplus allocation retry must preserve exact request bytes");
        return json(route, { ...commandResults.get(body.requestId), replayed: true });
      }
      requests.set(body.requestId, body);
      const lot = surplusLedger.lots.find((item) => item.id === body.lotId);
      const scheduled = surplusLedger.scheduleRuns.find((item) => item.runId === body.scheduleRunId && item.productionDate === body.productionDate);
      assert.ok(lot && scheduled);
      assert.equal(lot.revision, body.expectedRevision);
      assert.equal(lot.productCode, scheduled.productCode);
      assert.ok(body.cases <= lot.remainingCases && body.cases <= scheduled.effectiveTargetCases);
      lot.remainingCases -= body.cases;
      lot.revision += 1;
      scheduled.carriedInCases += body.cases;
      scheduled.effectiveTargetCases = scheduled.targetCases - scheduled.carriedInCases;
      surplusLedger.allocations.unshift({ id: SURPLUS_ALLOCATION_ID, lotId: lot.id, productionDate: scheduled.productionDate, scheduleRunId: scheduled.runId, cases: body.cases, createdAt: "2026-11-21T14:02:00.000Z" });
      surplusLedger.events.unshift({ id: SURPLUS_ALLOCATION_EVENT_ID, lotId: lot.id, eventType: "allocation", quantityDelta: -body.cases, reason: "Scheduled run carry-in allocation", correctsEventId: null, createdAt: "2026-11-21T14:02:00.000Z" });
      const result = { outcome: "accepted", replayed: false, allocationId: SURPLUS_ALLOCATION_ID, lotId: lot.id, remainingCases: lot.remainingCases, revision: lot.revision, carriedInCases: scheduled.carriedInCases, effectiveTargetCases: scheduled.effectiveTargetCases };
      commandResults.set(body.requestId, result);
      return json(route, result);
    }
    if (path === "/api/v3/inventory/freezer-surplus/adjustments" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "surplus adjustment retry must preserve exact request bytes");
        return json(route, { ...commandResults.get(body.requestId), replayed: true });
      }
      requests.set(body.requestId, body);
      const lot = surplusLedger.lots.find((item) => item.id === body.lotId);
      assert.ok(lot);
      assert.equal(lot.revision, body.expectedRevision);
      if (body.eventType === "correction") assert.ok(surplusLedger.events.some((event) => event.id === body.correctsEventId && event.lotId === lot.id));
      const delta = body.eventType === "damage" ? -body.cases : body.cases;
      assert.ok(lot.remainingCases + delta >= 0 && lot.remainingCases + delta <= lot.totalCases);
      lot.remainingCases += delta;
      lot.revision += 1;
      const eventId = body.eventType === "damage" ? SURPLUS_DAMAGE_EVENT_ID : SURPLUS_CORRECTION_EVENT_ID;
      surplusLedger.events.unshift({ id: eventId, lotId: lot.id, eventType: body.eventType, quantityDelta: delta, reason: body.reason, correctsEventId: body.correctsEventId ?? null, createdAt: body.eventType === "damage" ? "2026-11-21T14:03:00.000Z" : "2026-11-21T14:04:00.000Z" });
      const result = { outcome: "accepted", replayed: false, eventId, lotId: lot.id, remainingCases: lot.remainingCases, revision: lot.revision };
      commandResults.set(body.requestId, result);
      return json(route, result);
    }
    if (path === "/api/v3/inventory/warehouses" && method === "GET") return json(route, { warehouses });
    if (path === "/api/v3/inventory/warehouses" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["name", "requestId"]);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior);
        return json(route, { outcome: "created", replayed: true, warehouse: warehouses[0] });
      }
      requests.set(body.requestId, body);
      const warehouse = {
        id: WAREHOUSE_ID,
        name: body.name,
        active: true,
        isProduction: false,
        createdAt: "2026-11-21T12:00:00.000Z",
        openingCountApplied: false,
      };
      warehouses.push(warehouse);
      return json(route, { outcome: "created", replayed: false, warehouse }, 201);
    }
    if (path === "/api/v3/inventory/production-warehouse" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.equal(body.warehouseId, WAREHOUSE_ID);
      const warehouse = warehouses.find((item) => item.id === body.warehouseId);
      assert.equal(warehouse.openingCountApplied, true);
      warehouse.isProduction = true;
      return json(route, { outcome: "accepted", replayed: false, warehouse });
    }
    if (path === "/api/v3/inventory/products" && method === "GET") return json(route, { products: PRODUCTS });
    if (path === "/api/v3/inventory/stock" && method === "GET") {
      const warehouseId = url.searchParams.get("warehouseId");
      const warehouseStock = stockByWarehouse.get(warehouseId);
      assert.ok(warehouseStock, "stock reads must address a known warehouse");
      return json(route, { stock: PRODUCTS.map((product) => warehouseStock.get(product.code)).filter(Boolean) });
    }
    if (path === "/api/v3/inventory/movements" && method === "GET") {
      const warehouseId = url.searchParams.get("warehouseId");
      const warehouseMovements = movementsByWarehouse.get(warehouseId);
      assert.ok(warehouseMovements, "movement reads must address a known warehouse");
      assert.equal(url.searchParams.get("limit"), "50");
      const beforeId = url.searchParams.get("beforeId");
      if (beforeId) {
        assert.equal(beforeId, warehouseMovements[0].id);
        assert.equal(url.searchParams.get("beforeAt"), warehouseMovements[0].occurredAt);
        return json(route, { movements: warehouseMovements.slice(1), nextCursor: null });
      }
      return json(route, {
        movements: warehouseMovements.slice(0, 1),
        nextCursor: warehouseMovements.length > 1 ? { occurredAt: warehouseMovements[0].occurredAt, id: warehouseMovements[0].id } : null,
      });
    }
    if (path === "/api/v3/inventory/movements" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const prior = requests.get(body.commandId);
      if (prior) {
        assert.deepEqual(body, prior, "movement retry must preserve the exact request bytes");
        return json(route, { ...commandResults.get(body.commandId), replayed: true });
      }
      requests.set(body.commandId, body);
      const next = changeStock(body.warehouseId, body.productCode, body.quantity);
      const movementGroupId = newMovementId();
      addMovement(body.warehouseId, body.productCode, body.type, body.quantity, body.reason, movementGroupId);
      const result = {
        outcome: "accepted", replayed: false, movementId: movementGroupId, warehouseId: body.warehouseId,
        productCode: body.productCode, quantity: next.quantity, revision: next.revision,
      };
      commandResults.set(body.commandId, result);
      if (loseNextMovementResponse) {
        loseNextMovementResponse = false;
        return json(route, { error: "Synthetic response loss after movement commit." }, 500);
      }
      return json(route, result);
    }
    if (path === "/api/v3/inventory/transfers" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["commandId", "productCode", "quantity", "reason", "sourceWarehouseId", "targetWarehouseId"]);
      const prior = requests.get(body.commandId);
      if (prior) {
        assert.deepEqual(body, prior, "transfer retry must preserve the exact request bytes");
        return json(route, { ...commandResults.get(body.commandId), replayed: true });
      }
      requests.set(body.commandId, body);
      const source = changeStock(body.sourceWarehouseId, body.productCode, `-${body.quantity}`);
      const target = changeStock(body.targetWarehouseId, body.productCode, body.quantity);
      const transferId = newMovementId();
      addMovement(body.sourceWarehouseId, body.productCode, "transfer_out", `-${body.quantity}`, body.reason, transferId);
      addMovement(body.targetWarehouseId, body.productCode, "transfer_in", body.quantity, body.reason, transferId);
      const result = {
        outcome: "accepted", replayed: false, transferId, productCode: body.productCode, quantity: body.quantity,
        sourceWarehouseId: body.sourceWarehouseId, sourceQuantity: source.quantity, sourceRevision: source.revision,
        targetWarehouseId: body.targetWarehouseId, targetQuantity: target.quantity, targetRevision: target.revision,
      };
      commandResults.set(body.commandId, result);
      return json(route, result);
    }
    if (path === "/api/v3/inventory/opening-counts" && method === "GET") {
      assert.equal(url.searchParams.get("limit"), "50");
      return json(route, { counts: [...counts.values()].map(countSummary) });
    }
    if (path === "/api/v3/inventory/opening-counts" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["csv", "requestId", "warehouseId"]);
      const rows = parseOpeningCountCsv(body.csv, PRODUCTS.map((product) => product.code));
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "exact retry must preserve request ID, warehouse, and CSV bytes");
        const count = counts.get(COUNT_ID);
        return json(route, { outcome: "staged", countId: COUNT_ID, warehouseId: count.warehouseId, rowCount: rows.length, replayed: true, rows: count.rows });
      }
      requests.set(body.requestId, body);
      const count = {
        id: COUNT_ID,
        warehouseId: body.warehouseId,
        status: "staged",
        rows,
        createdBy: STAFF_ID,
        reviewedBy: null,
        appliedBy: null,
        createdAt: "2026-11-21T12:01:00.000Z",
        reviewedAt: null,
        appliedAt: null,
        result: null,
      };
      counts.set(COUNT_ID, count);
      if (loseNextStageResponse) {
        loseNextStageResponse = false;
        return json(route, { error: "Synthetic response loss after opening-count commit." }, 500);
      }
      return json(route, { outcome: "staged", countId: COUNT_ID, warehouseId: count.warehouseId, rowCount: rows.length, replayed: false, rows }, 201);
    }
    const detailMatch = path.match(/^\/api\/v3\/inventory\/opening-counts\/([0-9a-f-]+)$/);
    if (detailMatch && method === "GET") {
      const count = counts.get(detailMatch[1]);
      return count ? json(route, { count }) : json(route, { error: "Not found" }, 404);
    }
    const actionMatch = path.match(/^\/api\/v3\/inventory\/opening-counts\/([0-9a-f-]+)\/(review|apply)$/);
    if (actionMatch && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(request.postDataJSON(), {});
      const count = counts.get(actionMatch[1]);
      const action = actionMatch[2];
      const replayed = action === "review" ? count.status !== "staged" : count.status === "applied";
      if (action === "review" && !replayed) {
        count.status = "reviewed";
        count.reviewedBy = STAFF_ID;
        count.reviewedAt = "2026-11-21T12:02:00.000Z";
      }
      if (action === "apply" && !replayed) {
        assert.equal(count.status, "reviewed", "only a reviewed opening count can be applied");
        count.status = "applied";
        count.appliedBy = STAFF_ID;
        count.appliedAt = "2026-11-21T12:03:00.000Z";
        count.result = { revision: 1 };
        applyCount(count);
      }
      return json(route, { outcome: action === "review" ? "reviewed" : "applied", countId: count.id, warehouseId: count.warehouseId, rowCount: count.rows.length, replayed });
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return {
    counts,
    requests,
    inventoryRequests,
    writes,
    stock,
    targetStock,
    movements,
    targetMovements,
    surplusLedger,
    loseNextStageResponse: () => { loseNextStageResponse = true; },
    loseNextMovementResponse: () => { loseNextMovementResponse = true; },
    loseNextCountResponse: () => { loseNextCountResponse = true; },
    loseNextSurplusResponse: () => { loseNextSurplusResponse = true; },
    loseNextSettingsResponse: () => { loseNextSettingsResponse = true; },
  };
}

test("React inventory creates a warehouse, retries opening counts exactly, applies canonical stock, and locks offline", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installInventoryApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
  await page.getByText("Create a warehouse to begin physical inventory.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Download opening-count template", exact: true }).getAttribute("download"), "opening-count-template.csv");

  await page.getByLabel("New warehouse name", { exact: true }).fill("Browser Cold Storage");
  await page.getByRole("button", { name: "Create warehouse", exact: true }).click();
  await page.getByText(/Warehouse created and available for inventory review\./).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Warehouse", exact: true }).inputValue(), WAREHOUSE_ID);

  await page.getByLabel("Opening count CSV", { exact: true }).setInputFiles({ name: "opening.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  api.loseNextStageResponse();
  await page.getByRole("button", { name: "Stage opening count", exact: true }).click();
  await page.getByText(/Retry the same request; its identity prevents duplicate writes/).waitFor();
  assert.equal(api.counts.size, 1, "the opening-count commit occurred before synthetic response loss");
  assert.equal(api.stock.size, 0, "staging must not change stock");
  assert.equal(await page.getByLabel("New warehouse name", { exact: true }).isDisabled(), true, "one unresolved write pauses other inventory writes");
  const originalRequest = [...api.requests.values()].at(-1);

  await page.reload();
  await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).click();
  await page.getByText(/Previous request confirmed\. Opening count staged/).waitFor();
  assert.equal(api.counts.size, 1, "exact retry must not create a second opening count");
  assert.equal([...api.requests.values()].filter((request) => request.csv).length, 1);
  assert.deepEqual([...api.requests.values()].find((request) => request.csv), originalRequest);
  const review = page.getByRole("region", { name: "Opening count review", exact: true });
  await review.getByText("staged", { exact: true }).waitFor();
  await review.getByRole("cell", { name: "12.5", exact: true }).waitFor();
  await review.getByRole("cell", { name: "0", exact: true }).waitFor();
  assert.equal(api.stock.size, 0, "stored review remains unapplied");

  await page.getByRole("button", { name: "Mark opening count reviewed", exact: true }).click();
  await page.getByText(/Opening count marked reviewed\. It is ready for explicit Apply\./).waitFor();
  await review.getByText("reviewed", { exact: true }).waitFor();
  assert.equal(api.stock.size, 0, "Review must not apply stock");
  await page.getByRole("button", { name: "Apply opening count", exact: true }).click();
  await page.getByText(/Opening count applied to warehouse stock\. Canonical history and quantities were reloaded\./).waitFor();
  await review.getByText("applied", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Confirmed quantities", exact: true }).getByRole("cell", { name: "12.5", exact: true }).waitFor();
  assert.equal(api.stock.get("DOUGH-A").quantity, "12.5");
  assert.equal(api.stock.get("CHEESE-A").quantity, "0");
  assert.equal(api.movements.length, 2, "Apply must create the append-only opening movements");

  await page.getByRole("button", { name: "Load older movements", exact: true }).click();
  await page.getByText("Browser opening count DOUGH-A", { exact: true }).waitFor();
  await page.getByText("Browser opening count CHEESE-A", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Load older movements", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Use selected warehouse for new runs", exact: true }).click();
  await page.getByText(/Production warehouse selected for new runs\. Existing runs retain their frozen warehouse\./).waitFor();
  await page.getByText("Used for new production runs. Existing runs keep their original warehouse snapshot.", { exact: true }).waitFor();

  await page.getByLabel("Opening count CSV", { exact: true }).setInputFiles({ name: "offline-not-retained.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Opening count CSV", { exact: true }).evaluate((input) => input.files.length), 0);
  assert.equal(await page.getByRole("button", { name: "Stage opening count", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Create warehouse", exact: true }).isDisabled(), true);
  assert.equal(api.writes.length, writesBeforeOffline, "offline inventory mode must not issue writes");
  await context.setOffline(false);
  await page.getByText("Canonical facility inventory · manage-inventory", { exact: true }).waitFor();

  await page.reload();
  await page.getByRole("region", { name: "Confirmed quantities", exact: true }).getByRole("cell", { name: "12.5", exact: true }).waitFor();
  await page.getByRole("button", { name: "Reopen count 1", exact: true }).click();
  await page.getByRole("region", { name: "Opening count review", exact: true }).getByText("applied", { exact: true }).waitFor();
  assert.equal(api.counts.get(COUNT_ID).status, "applied");

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `the React inventory page must fit ${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("React inventory records lot receipts, retries adjustments exactly, and transfers between canonical warehouses", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installInventoryApi(context, baseUrl, { established: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
  const confirmedStock = page.getByRole("region", { name: "Confirmed quantities", exact: true });
  const movementPanel = page.getByRole("region", { name: "Receipts, adjustments, and transfers", exact: true });
  await confirmedStock.getByRole("cell", { name: "20", exact: true }).first().waitFor();

  await page.getByRole("combobox", { name: "Product", exact: true }).selectOption("DOUGH-A");
  await page.getByLabel("Quantity", { exact: true }).fill("5");
  await movementPanel.getByLabel("Reason", { exact: true }).fill("Browser lot receipt");
  await page.getByLabel(/Lot number/u).fill("LOT-BROWSER-A");
  await page.getByLabel(/Received date/u).fill("2026-11-01");
  await page.getByLabel(/Expiration date/u).fill("2026-12-01");
  await page.getByRole("button", { name: "Record receipt", exact: true }).click();
  await page.getByText(/Receipt recorded\. Stock, lot balance, and movement history were reloaded\./u).waitFor();
  await confirmedStock.getByRole("cell", { name: "25", exact: true }).waitFor();
  const receipt = [...api.requests.values()].find((request) => request.type === "receipt");
  assert.deepEqual(receipt, {
    commandId: receipt.commandId, warehouseId: WAREHOUSE_ID, productCode: "DOUGH-A", type: "receipt",
    quantity: "5", reason: "Browser lot receipt", lotNumber: "LOT-BROWSER-A",
    receivedOn: "2026-11-01", expiresOn: "2026-12-01",
  });
  assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "", "confirmed receipt fields must clear");

  await page.getByRole("button", { name: "Adjustment", exact: true }).click();
  await page.getByRole("combobox", { name: "Product", exact: true }).selectOption("DOUGH-A");
  await page.getByLabel("Quantity (+/-)", { exact: true }).fill("-2");
  await movementPanel.getByLabel("Reason", { exact: true }).fill("Browser damage adjustment");
  assert.equal(await page.getByLabel(/Lot number/u).count(), 0, "negative adjustments cannot supply lot metadata");
  const originalAdjustment = {
    commandId: "", warehouseId: WAREHOUSE_ID, productCode: "DOUGH-A", type: "adjustment",
    quantity: "-2", reason: "Browser damage adjustment",
  };
  api.loseNextMovementResponse();
  await page.getByRole("button", { name: "Record adjustment", exact: true }).click();
  await page.getByText(/Retry the same request; its identity prevents duplicate writes/u).waitFor();
  assert.equal(api.stock.get("DOUGH-A").quantity, "23", "the adjustment committed before response loss");
  assert.equal(api.movements.length, 2);
  Object.assign(originalAdjustment, { commandId: [...api.requests.values()].find((request) => request.type === "adjustment").commandId });
  assert.equal(await page.getByRole("button", { name: "Transfer", exact: true }).isDisabled(), true, "an unresolved movement pauses transfers");

  await page.reload();
  await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).click();
  await page.getByText(/Previous request confirmed\. Adjustment recorded\./u).waitFor();
  await confirmedStock.getByRole("cell", { name: "23", exact: true }).waitFor();
  assert.deepEqual([...api.requests.values()].find((request) => request.type === "adjustment"), originalAdjustment);
  assert.equal(api.movements.length, 2, "exact adjustment retry must not append another movement");

  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page.getByRole("combobox", { name: "Product", exact: true }).selectOption("DOUGH-A");
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await movementPanel.getByLabel("Reason", { exact: true }).fill("Browser warehouse transfer");
  assert.equal(await page.getByRole("combobox", { name: "Target warehouse", exact: true }).inputValue(), TARGET_WAREHOUSE_ID);
  await page.getByRole("button", { name: "Transfer stock", exact: true }).click();
  await page.getByText(/Transfer recorded\. Source stock, destination lots, and movement history were confirmed\./u).waitFor();
  await confirmedStock.getByRole("cell", { name: "20", exact: true }).first().waitFor();
  assert.equal(api.stock.get("DOUGH-A").quantity, "20");
  assert.equal(api.targetStock.get("DOUGH-A").quantity, "3");
  assert.equal(api.movements.length, 3);
  assert.equal(api.targetMovements.length, 1);

  await page.getByRole("combobox", { name: "Warehouse", exact: true }).selectOption(TARGET_WAREHOUSE_ID);
  await confirmedStock.getByRole("cell", { name: "3", exact: true }).waitFor();
  await page.getByText("Browser warehouse transfer", { exact: true }).waitFor();
  assert.equal(api.targetMovements[0].type, "transfer_in");

  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Transfer stock", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Receipt", exact: true }).isDisabled(), true);
  assert.equal(api.writes.length, writesBeforeOffline);
  await context.setOffline(false);
  await page.getByText("Canonical facility inventory · manage-inventory", { exact: true }).waitFor();

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `the movement workflow must fit ${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("React freezer surplus retries exact decisions and separates carry-in history from ingredient stock", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installInventoryApi(context, baseUrl, { established: true, surplus: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  const panel = page.getByRole("region", { name: "Freezer surplus", exact: true });
  await panel.waitFor();

  await panel.getByRole("button", { name: "Confirm no surplus", exact: true }).click();
  await page.getByText(/No-surplus decision saved permanently for the completed run/u).waitFor();
  assert.equal(api.surplusLedger.lots.length, 0);
  assert.equal(api.surplusLedger.runs.find((run) => run.runId === SURPLUS_RUN_ZERO).decision, "none");

  await panel.getByLabel("Completed run", { exact: true }).selectOption(SURPLUS_RUN_STORE);
  await panel.getByLabel("Surplus cases", { exact: true }).fill("4");
  api.loseNextSurplusResponse();
  await panel.getByRole("button", { name: "Store surplus", exact: true }).click();
  await page.getByText(/Retry the same request; its identity prevents duplicate writes/u).waitFor();
  assert.equal(api.surplusLedger.lots.length, 1, "the positive decision committed before response loss");
  assert.equal(api.surplusLedger.events.length, 1);
  const originalConfirmation = [...api.requests.values()].find((request) => request.runId === SURPLUS_RUN_STORE);

  await page.reload();
  await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).click();
  await page.getByText(/Previous request confirmed\. 4 finished cases stored/u).waitFor();
  assert.equal(api.surplusLedger.lots.length, 1, "exact retry must not create a second lot");
  assert.equal(api.surplusLedger.events.filter((event) => event.eventType === "receipt").length, 1);
  assert.deepEqual([...api.requests.values()].find((request) => request.runId === SURPLUS_RUN_STORE), originalConfirmation);
  await panel.getByText("4 / 4 cases", { exact: true }).waitFor();

  await panel.getByLabel("Scheduled run", { exact: true }).selectOption(SURPLUS_SCHEDULE_RUN_ID);
  await panel.getByLabel("Carry-in cases", { exact: true }).fill("2");
  await panel.getByRole("button", { name: "Allocate carry-in", exact: true }).click();
  await page.getByText(/Carry-in allocated\. 2 carried-in cases leave an effective production target of 8; ingredients were not deducted again/u).waitFor();
  assert.equal(api.surplusLedger.lots[0].remainingCases, 2);
  assert.equal(api.surplusLedger.scheduleRuns[0].effectiveTargetCases, 8);
  assert.equal(api.movements.length, 0, "carry-in must not deduct ingredient stock");

  await panel.getByLabel("Event type", { exact: true }).selectOption("damage");
  await panel.getByLabel("Cases", { exact: true }).fill("1");
  await panel.getByLabel("Reason", { exact: true }).fill("Synthetic freezer damage");
  await panel.getByRole("button", { name: "Append damage", exact: true }).click();
  await page.getByText(/Surplus damage appended\. 1 physically remaining cases/u).waitFor();
  assert.equal(api.surplusLedger.events.length, 3);

  await panel.getByLabel("Event type", { exact: true }).selectOption("correction");
  await panel.getByLabel("Signed correction cases", { exact: true }).fill("1");
  await panel.getByLabel("Corrected event", { exact: true }).selectOption(SURPLUS_DAMAGE_EVENT_ID);
  await panel.getByLabel("Reason", { exact: true }).fill("Damage review found one intact case");
  await panel.getByRole("button", { name: "Append correction", exact: true }).click();
  await page.getByText(/Surplus correction appended\. 2 physically remaining cases/u).waitFor();
  assert.equal(api.surplusLedger.events.length, 4);
  assert.equal(api.surplusLedger.events[0].correctsEventId, SURPLUS_DAMAGE_EVENT_ID);
  assert.equal(api.movements.length, 0, "physical surplus corrections must not append ingredient movements");

  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Allocate carry-in", exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole("button", { name: "Append correction", exact: true }).isDisabled(), true);
  assert.equal(api.writes.length, writesBeforeOffline);
  await context.setOffline(false);
  await page.getByText("Canonical facility inventory · manage-inventory", { exact: true }).waitFor();

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `the freezer surplus workflow must fit ${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("React rejects incomplete warehouse guidance instead of adopting empty operations", { timeout: 45_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  await installInventoryApi(context, baseUrl, { malformedGuidance: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  await page.getByText("Warehouse guidance was incomplete. Refresh and retry.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Reorder review", exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Confirmed quantities", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test("React warehouse operations stay read-only and settings retry exactly after response loss", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installInventoryApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  await page.getByRole("heading", { name: "Switchover warning", exact: true }).waitFor();
  await page.getByText("Running Pizza", { exact: true }).waitFor();
  await page.getByText("0.4 skids left", { exact: true }).waitFor();
  await page.getByText("6 new cases after carry-in", { exact: false }).waitFor();

  const reorder = page.getByRole("region", { name: "Reorder review", exact: true });
  await reorder.getByText("5 lb", { exact: true }).last().waitFor();
  await reorder.getByText("55 on hand · 50 scheduled", { exact: false }).waitFor();
  const useFirst = page.getByRole("region", { name: "Use first", exact: true });
  await useFirst.getByText("LOT-EXPIRING · Needed today", { exact: true }).waitFor();
  const needs = page.getByRole("region", { name: "Warehouse needs", exact: true });
  await needs.getByText("Some scheduled demand is unresolved.", { exact: true }).waitFor();
  await needs.getByText("50 lb", { exact: true }).waitFor();
  await needs.getByText("Scheduled runs (1)", { exact: true }).first().click();
  await needs.getByText(/Run 1 — Pizza: 30 lb/u).waitFor();
  const transfer = page.getByRole("region", { name: "Transfer guidance", exact: true });
  await transfer.getByText("25 lb", { exact: true }).waitFor();
  await transfer.getByText("Sources: Browser Target (50)", { exact: true }).waitFor();
  assert.equal(await transfer.getByRole("button").count(), 0, "transfer advice must not create a physical write");

  await page.getByLabel("Use-first expiry window (days)", { exact: true }).fill("14");
  await page.getByLabel("Reorder threshold for Browser Dough", { exact: true }).fill("12.5");
  api.loseNextSettingsResponse();
  await page.getByRole("button", { name: "Save guidance settings", exact: true }).click();
  await page.getByText(/Retry the same request; its identity prevents duplicate writes/u).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add schedule", exact: true }).isDisabled(), true);
  const original = [...api.requests.values()].find((request) => Array.isArray(request.reorderPoints));
  await page.reload();
  await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).click();
  await page.getByText(/Previous request confirmed\. Reorder points and the 14-day use-first window were saved and reloaded/u).waitFor();
  assert.equal(await page.getByLabel("Use-first expiry window (days)", { exact: true }).inputValue(), "14");
  assert.equal(await page.getByLabel("Reorder threshold for Browser Dough", { exact: true }).inputValue(), "12.5");
  assert.deepEqual([...api.requests.values()].find((request) => Array.isArray(request.reorderPoints)), original);
  assert.equal(api.writes.filter((path) => path === "POST /api/v3/inventory/warehouse-guidance").length, 2);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("React managers configure cycle-count cadence and availability from canonical guidance", { timeout: 45_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installInventoryApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  await page.getByRole("heading", { name: "Cycle counts", exact: true }).waitFor();
  await page.getByLabel("Section", { exact: true }).fill("Freezer");
  await page.getByLabel("Cadence (days)", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  await page.getByText(/Freezer cycle-count schedule saved and reloaded/u).waitFor();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Freezer", exact: true }) });
  await card.getByText("Every 3 days", { exact: false }).waitFor();
  await card.getByRole("button", { name: "Configure", exact: true }).click();
  assert.equal(await page.getByLabel("Section", { exact: true }).isDisabled(), true);
  await page.getByLabel("Enabled for reminders and staff confirmation").uncheck();
  await page.getByRole("button", { name: "Save schedule", exact: true }).click();
  await page.getByText(/Previous request confirmed|Freezer cycle-count schedule saved/u).first().waitFor();
  await card.getByText("Disabled", { exact: true }).first().waitFor();
  assert.equal(api.writes.filter((path) => path.includes("cycle-counts/schedules")).length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test("React staff guidance marks counts with exact retry while stock and configuration stay manager-only", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installInventoryApi(context, baseUrl, { manager: false });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#inventory`);
  await page.getByRole("heading", { name: "Cycle counts", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Freezer pull", exact: true }).waitFor();
  await page.getByText("20 lb", { exact: true }).waitFor();
  await page.getByText(/Scheduled quantity is unresolved; check station capacity/u).waitFor();
  await page.getByRole("heading", { name: "Reorder review", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Use first", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Warehouse needs", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Transfer guidance", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Switchover warning", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Reorder and expiry settings", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Configure", exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Confirmed quantities", exact: true }).count(), 0);

  api.loseNextCountResponse();
  await page.getByRole("button", { name: "Mark counted", exact: true }).click();
  await page.getByText(/Retry the same request; its identity prevents duplicate writes/u).waitFor();
  const original = [...api.requests.values()].find((request) => request.section === "Dry storage");
  await page.reload();
  await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
  await page.getByText(/Previous request confirmed\. Dry storage confirmed counted on 2026-11-21/u).waitFor();
  assert.deepEqual([...api.requests.values()].find((request) => request.section === "Dry storage"), original);
  assert.equal(api.writes.filter((path) => path.includes("cycle-counts/mark")).length, 2);
  assert.equal(api.inventoryRequests.some((path) => /warehouses|stock|movements|opening-counts/u.test(path)), false);

  const writes = api.writes.length;
  await context.setOffline(true);
  assert.equal(await page.getByRole("button", { name: "Confirm count", exact: true }).isDisabled(), true);
  assert.equal(api.writes.length, writes);
  await context.setOffline(false);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  assert.deepEqual(errors, []);
  await context.close();
});
