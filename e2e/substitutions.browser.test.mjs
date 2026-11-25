import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, expect, firefox, webkit } from "playwright/test";
import { emptySchedule } from "../core/schedule-planning.mjs";

const CSRF_TOKEN = "c".repeat(43);
const STAFF_ID = "75000000-0000-4000-8000-000000000001";
const RUN_ID = "75000000-0000-4000-8000-000000000002";
const DATE = "2026-11-18";
const OTHER_DATE = "2026-11-19";
const NOW = "2026-11-18T12:00:00.000Z";
const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);
const PRODUCTS = [
  { productId: "75000000-0000-4000-8000-000000000010", productCode: "BREAD-FLOUR", productName: "Bread Flour", baseUnit: "lb" },
  { productId: "75000000-0000-4000-8000-000000000011", productCode: "INSTANT-YEAST", productName: "Instant Yeast", baseUnit: "lb" },
  { productId: "75000000-0000-4000-8000-000000000012", productCode: "FINE-SUGAR", productName: "Fine Sugar", baseUnit: "lb" },
  { productId: "75000000-0000-4000-8000-000000000013", productCode: "OAT-MILK", productName: "Oat Milk", baseUnit: "lb" },
  { productId: "75000000-0000-4000-8000-000000000014", productCode: "DRIED-HERBS", productName: "Dried Herbs", baseUnit: "lb" },
  { productId: "75000000-0000-4000-8000-000000000015", productCode: "WHOLE-WHEAT", productName: "Whole Wheat Flour", baseUnit: "lb" },
];
const CATALOG = {
  products: [{ code: "PIZZA-A", name: "Synthetic Pizza", productionSetups: [{ code: "LINE-A", name: "Main line" }] }],
  templates: [],
  productionStartTime: "06:00",
  timeZone: "America/Chicago",
};
const BASE_PLAN = {
  code: "LINE-A",
  name: "Main line",
  warehouse: { id: "75000000-0000-4000-8000-000000000020", name: "Synthetic warehouse" },
  recipes: [{
    code: "DOUGH",
    name: "Dough recipe",
    stationKey: "dough",
    ingredients: [
      { productId: "75000000-0000-4000-8000-000000000021", productCode: "FLOUR", productName: "Flour", quantity: "10", unit: "lb" },
      { productId: "75000000-0000-4000-8000-000000000022", productCode: "YEAST", productName: "Yeast", quantity: "1", unit: "lb" },
      { productId: "75000000-0000-4000-8000-000000000023", productCode: "SALT", productName: "Salt", quantity: "0.5", unit: "lb" },
    ],
  }],
  packagingPerCase: [{ productId: "75000000-0000-4000-8000-000000000024", productCode: "CARTON", productName: "Carton", quantity: "1", unit: "each" }],
};

function emptyOverlay(productionDate) {
  return { productionDate, revision: 0, rules: [], updatedAt: null };
}

function initialRunOverlay() {
  return {
    productionDate: DATE,
    revision: 3,
    updatedAt: NOW,
    rules: [
      { id: "75000000-0000-4000-8000-000000000030", ingredient: "Flour", action: "swap", substituteProductId: PRODUCTS[0].productId, substituteProductCode: PRODUCTS[0].productCode, substituteProductName: PRODUCTS[0].productName, quantity: null },
      { id: "75000000-0000-4000-8000-000000000031", ingredient: "Yeast", action: "add", substituteProductId: PRODUCTS[1].productId, substituteProductCode: PRODUCTS[1].productCode, substituteProductName: PRODUCTS[1].productName, quantity: "2" },
      { id: "75000000-0000-4000-8000-000000000032", ingredient: "Salt", action: "remove" },
    ],
  };
}

function effectivePlan(overlay) {
  const plan = structuredClone(BASE_PLAN);
  for (const recipe of plan.recipes) {
    const rows = [];
    for (const line of recipe.ingredients) {
      const rule = overlay.rules.find((candidate) => candidate.ingredient.toLowerCase() === line.productName.toLowerCase());
      if (!rule) {
        rows.push(line);
        continue;
      }
      if (rule.action === "remove") continue;
      const substitute = {
        ...line,
        productId: rule.substituteProductId,
        productCode: rule.substituteProductCode,
        productName: rule.substituteProductName,
        quantity: rule.quantity ?? line.quantity,
      };
      if (rule.action === "add") rows.push(line);
      rows.push(substitute);
    }
    recipe.ingredients = rows;
  }
  return plan;
}

function productionRun(status, revision, overlay) {
  return {
    id: RUN_ID,
    status,
    productionDate: DATE,
    revision,
    createdAt: NOW,
    updatedAt: NOW,
    serverNow: NOW,
    startedAt: status === "planned" ? null : NOW,
    pausedAt: null,
    resumedAt: null,
    completedAt: status === "completed" ? NOW : null,
    runToTime: "19:15",
    operationalNotes: "",
    stoppages: [],
    setupSnapshot: {
      label: "Dated overlay browser run",
      targetCases: 25,
      productCode: "PIZZA-A",
      productionSetupCode: "LINE-A",
      productionPlan: structuredClone(BASE_PLAN),
    },
    effectiveProductionPlan: effectivePlan(overlay),
    substitutionOverlay: structuredClone(overlay),
    doughCapacity: null,
    inventoryConsumption: null,
    pauseIntervals: [],
    stationProgress: {},
  };
}

async function serveDist(t) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    let asset = PUBLIC_FILES.get(pathname);
    if (!asset && /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pathname)) {
      asset = [pathname.slice(1), pathname.endsWith(".css") ? "text/css" : "text/javascript"];
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
  const engineName = process.env.BROWSER_ENGINE ?? "chromium";
  assert.ok(["chromium", "webkit", "firefox"].includes(engineName), `Unsupported browser engine: ${engineName}`);
  const engine = { chromium, webkit, firefox }[engineName];
  const executablePath = engineName === "chromium"
    ? process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim()
    : undefined;
  const browser = await engine.launch({
    headless: true,
    executablePath,
    args: engineName === "chromium" ? ["--no-sandbox"] : [],
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  return { context, engineName };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

async function installSession(context, baseUrl) {
  await context.addCookies([{ name: "v3_csrf", value: CSRF_TOKEN, url: baseUrl }]);
}

function sessionResponse() {
  return {
    staff: { userId: STAFF_ID, username: "manager", role: "manager", capabilities: ["manage-factory-settings"] },
    expiresAt: "2026-11-22T12:00:00.000Z",
  };
}

async function fillRule(page, { ingredient, action = "Swap", product, quantity }) {
  await page.getByLabel("Original ingredient name", { exact: true }).fill(ingredient);
  await page.getByLabel(/^Action/u).selectOption({ label: action });
  if (product) await page.getByLabel(/^Substitute product/u).selectOption({ label: product });
  if (quantity !== undefined) await page.getByLabel(/^Quantity /).fill(quantity);
}

async function installScheduleApi(context, baseUrl) {
  const overlays = new Map([[DATE, emptyOverlay(DATE)], [OTHER_DATE, emptyOverlay(OTHER_DATE)]]);
  const receipts = new Map();
  const commands = [];
  let loseNextResponse = false;
  const schedule = (date) => ({ ...emptySchedule(date), substitutionOverlay: overlays.get(date) ?? emptyOverlay(date) });

  await installSession(context, baseUrl);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") return json(route, sessionResponse());
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/runs" && method === "GET") return json(route, { runs: [] });
    if (path === "/api/v3/schedules/catalog" && method === "GET") return json(route, CATALOG);
    if (path === "/api/v3/schedules" && method === "GET") return json(route, { schedule: schedule(url.searchParams.get("date")) });
    if (path === "/api/v3/schedules/substitution-products" && method === "GET") return json(route, { products: PRODUCTS });
    if (path === "/api/v3/schedules/substitutions" && method === "GET") {
      return json(route, { overlay: overlays.get(url.searchParams.get("date")) ?? emptyOverlay(url.searchParams.get("date")) });
    }
    if (path === "/api/v3/schedules/substitutions/commands" && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const body = request.postDataJSON();
      commands.push(body);
      const replay = receipts.get(body.requestId);
      if (replay) return json(route, { ...replay, replayed: true });
      const current = overlays.get(body.date);
      if (!current || body.expectedRevision !== current.revision) {
        return json(route, { outcome: "conflict", currentOverlay: current }, 409);
      }
      const next = structuredClone(current);
      if (body.command.type === "clear") {
        next.rules = [];
      } else if (body.command.type === "remove") {
        next.rules = next.rules.filter((rule) => rule.id !== body.command.ruleId);
      } else {
        const input = body.command.rule;
        const existing = next.rules.find((rule) => rule.id === input.id
          || rule.ingredient.toLowerCase() === input.ingredient.trim().toLowerCase());
        const product = PRODUCTS.find((candidate) => candidate.productId === input.substituteProductId);
        const rule = input.action === "remove" ? {
          id: existing?.id ?? input.id ?? crypto.randomUUID(),
          ingredient: input.ingredient.trim(),
          action: input.action,
        } : {
          id: existing?.id ?? input.id ?? crypto.randomUUID(),
          ingredient: input.ingredient.trim(),
          action: input.action,
          substituteProductId: product.productId,
          substituteProductCode: product.productCode,
          substituteProductName: product.productName,
          quantity: input.quantity,
        };
        next.rules = existing
          ? next.rules.map((candidate) => candidate.id === existing.id ? rule : candidate)
          : [...next.rules, rule];
      }
      next.revision += 1;
      next.updatedAt = NOW;
      overlays.set(body.date, next);
      const response = { outcome: "accepted", commandId: body.requestId, overlay: next, replayed: false };
      receipts.set(body.requestId, response);
      if (loseNextResponse) {
        loseNextResponse = false;
        return json(route, { error: "Synthetic response loss after commit." }, 500);
      }
      return json(route, response);
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });

  return {
    commands,
    receipts,
    overlays,
    loseNextResponse: () => { loseNextResponse = true; },
    externallyReplace: (date, rules) => {
      const current = overlays.get(date);
      overlays.set(date, { productionDate: date, revision: current.revision + 1, rules, updatedAt: NOW });
    },
  };
}

test("manager edits dated substitutions with replay, conflicts, offline reads, and mobile workflows", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context, engineName } = await openBrowser(t);
  const api = await installScheduleApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#schedule`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Production schedule", exact: true })).toBeVisible();
  await page.getByLabel("Production date", { exact: true }).fill(DATE);
  const panel = page.getByRole("region", { name: "Dated ingredient overlay", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("No temporary substitutions for this date.", { exact: true })).toBeVisible();

  await fillRule(page, { ingredient: "Flour", product: "Bread Flour · BREAD-FLOUR · lb" });
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Temporary substitution change saved to the server." })).toBeVisible();
  assert.equal(api.commands[0].command.rule.quantity, null);
  assert.equal(api.commands[0].expectedRevision, 0);
  const flour = panel.getByRole("listitem").filter({ hasText: "Flour" });
  await expect(flour.getByText(/original quantities/)).toBeVisible();

  await flour.getByRole("button", { name: "Edit", exact: true }).click();
  const flourId = api.commands[0].command.rule.id ?? api.overlays.get(DATE).rules[0].id;
  await page.getByLabel(/^Quantity /).fill("12.5");
  await page.getByRole("button", { name: "Update rule", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Temporary substitution change saved to the server." })).toBeVisible();
  assert.equal(api.commands.at(-1).command.rule.id, flourId);
  await expect(panel.getByRole("listitem").filter({ hasText: "Flour" }).getByText(/12\.5/)).toBeVisible();

  await fillRule(page, { ingredient: "Yeast", action: "Add", product: "Instant Yeast · INSTANT-YEAST · lb", quantity: "2.5" });
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(panel.getByText("Active rules (2/100)", { exact: true })).toBeVisible();
  assert.equal(api.commands.at(-1).command.rule.action, "add");

  await fillRule(page, { ingredient: "Salt", action: "Remove" });
  await expect(page.getByLabel(/^Substitute product/u)).toBeDisabled();
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(panel.getByText("Active rules (3/100)", { exact: true })).toBeVisible();
  const salt = panel.getByRole("listitem").filter({ hasText: "Salt" });
  await salt.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(panel.getByText("Active rules (2/100)", { exact: true })).toBeVisible();
  assert.equal(api.commands.at(-1).command.type, "remove");

  api.loseNextResponse();
  await fillRule(page, { ingredient: "Sugar", product: "Fine Sugar · FINE-SUGAR · lb" });
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic response loss after commit." })).toBeVisible();
  const unresolved = api.commands.at(-1);
  await page.getByRole("status").filter({ hasText: "A substitution save is unresolved." })
    .getByRole("button", { name: "Retry same request", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "The previous substitution save was confirmed by exact retry." })).toBeVisible();
  assert.equal(api.commands.at(-1).requestId, unresolved.requestId);
  assert.equal(api.receipts.size, 6);
  await expect(panel.getByText("Active rules (3/100)", { exact: true })).toBeVisible();

  await fillRule(page, { ingredient: "Milk", product: "Oat Milk · OAT-MILK · lb" });
  api.externallyReplace(DATE, [{ id: "75000000-0000-4000-8000-000000000040", ingredient: "Canonical manager rule", action: "remove" }]);
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Another manager changed this date." })).toBeVisible();
  await expect(panel.getByText("Canonical manager rule", { exact: true })).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "Milk" })).toHaveCount(0);

  await page.getByLabel("Production date", { exact: true }).fill(OTHER_DATE);
  await expect(panel.getByText(`Temporary substitutions · ${OTHER_DATE}`, { exact: true })).toBeVisible();
  await expect(panel.getByText("No temporary substitutions for this date.", { exact: true })).toBeVisible();
  await page.getByLabel("Production date", { exact: true }).fill(DATE);
  await expect(panel.getByText("Canonical manager rule", { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/v3-substitutions-${engineName}-desktop.png`, fullPage: true });

  const commandCount = api.commands.length;
  await context.setOffline(true);
  await expect(page.getByRole("main").getByText("Read-only offline", { exact: true })).toBeVisible();
  await expect(panel.getByText("Canonical manager rule", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Original ingredient name", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save rule", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Clear all", exact: true })).toBeDisabled();
  assert.equal(api.commands.length, commandCount);
  const pendingKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => /pending.*substitution|substitution.*pending/iu.test(key)));
  assert.deepEqual(pendingKeys, []);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.setOffline(false);
  await expect(page.getByLabel("Original ingredient name", { exact: true })).toBeEnabled();
  await fillRule(page, { ingredient: "Herbs", product: "Dried Herbs · DRIED-HERBS · lb" });
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "Herbs" })).toBeVisible();
  await page.screenshot({ path: `/tmp/v3-substitutions-${engineName}-mobile.png`, fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(panel.getByText("No temporary substitutions for this date.", { exact: true })).toBeVisible();
  assert.equal(api.commands.at(-1).command.type, "clear");
  assert.deepEqual(errors, []);
  await context.close();
});

async function installRunApi(context, baseUrl) {
  let currentOverlay = initialRunOverlay();
  let run = null;
  const createRequests = [];
  const lifecycleRequests = [];
  await installSession(context, baseUrl);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") return json(route, sessionResponse());
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/operations/stop-reasons" && method === "GET") {
      return json(route, { settings: { revision: 0, reasons: ["Synthetic hold"], updatedAt: null } });
    }
    if (path === "/api/v3/runs/products" && method === "GET") return json(route, { products: CATALOG.products });
    if (path === "/api/v3/runs" && method === "GET") return json(route, { runs: run ? [run] : [] });
    if (path === "/api/v3/runs" && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const body = request.postDataJSON();
      createRequests.push(body);
      assert.equal(body.productionDate, DATE);
      assert.deepEqual(body.setupSnapshot, {
        label: "Dated overlay browser run",
        targetCases: 25,
        productCode: "PIZZA-A",
        productionSetupCode: "LINE-A",
      });
      run = productionRun("planned", 0, currentOverlay);
      return json(route, { run }, 201);
    }
    if (path === `/api/v3/runs/${RUN_ID}/commands` && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const body = request.postDataJSON();
      lifecycleRequests.push(body);
      assert.equal(body.expectedRevision, run.revision);
      if (body.commandType === "start") {
        run = { ...run, status: "running", revision: run.revision + 1, startedAt: NOW };
      } else if (body.commandType === "complete") {
        run = { ...run, status: "completed", revision: run.revision + 1, completedAt: NOW };
      } else {
        return json(route, { error: "Unexpected lifecycle command." }, 400);
      }
      return json(route, { outcome: "accepted", replayed: false, commandId: body.commandId, run });
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return {
    createRequests,
    lifecycleRequests,
    getRun: () => run,
    getCurrentOverlay: () => currentOverlay,
    replaceCurrentOverlay: () => {
      currentOverlay = {
        productionDate: DATE,
        revision: currentOverlay.revision + 1,
        updatedAt: "2026-11-18T13:00:00.000Z",
        rules: [{
          id: "75000000-0000-4000-8000-000000000041",
          ingredient: "Flour",
          action: "swap",
          substituteProductId: PRODUCTS[5].productId,
          substituteProductCode: PRODUCTS[5].productCode,
          substituteProductName: PRODUCTS[5].productName,
          quantity: "25",
        }],
      };
    },
  };
}

test("explicit-date run creation reads effective rows and completion retains its overlay", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context, engineName } = await openBrowser(t);
  const api = await installRunApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#run`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Run control", exact: true })).toBeVisible();
  await page.getByLabel("Run label", { exact: true }).fill("Dated overlay browser run");
  await page.getByLabel("Production date", { exact: true }).fill(DATE);
  await page.getByLabel("Target cases", { exact: true }).fill("25");
  await page.getByLabel(/^Imported product/u).selectOption("PIZZA-A");
  await expect(page.getByLabel(/^Production setup/u)).toHaveValue("LINE-A");
  await page.getByRole("button", { name: "Prepare run", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Dated overlay browser run", exact: true })).toBeVisible();
  assert.equal(api.createRequests.length, 1);
  assert.equal(api.createRequests[0].productionDate, DATE);
  const plan = page.getByRole("region", { name: "Effective production plan", exact: true });
  const recipe = plan.getByRole("region", { name: "Dough recipe effective ingredients", exact: true });
  await expect(plan).toBeVisible();
  await expect(plan.getByText("Current server derivation", { exact: true })).toBeVisible();
  await expect(plan.getByText(/overlay revision 3\./)).toBeVisible();
  await expect(recipe.getByText("Bread Flour", { exact: false })).toBeVisible();
  await expect(recipe.getByText("10 lb", { exact: true })).toBeVisible();
  await expect(recipe.getByRole("listitem").filter({ hasText: /^Yeast\s+YEAST/u })).toContainText("1 lb");
  await expect(recipe.getByText("Instant Yeast", { exact: false })).toBeVisible();
  await expect(recipe.getByText("2 lb", { exact: true })).toBeVisible();
  await expect(recipe.getByText("Salt", { exact: true })).toHaveCount(0);
  await expect(plan.getByText(/The base recipe, setup snapshot, and packaging remain unchanged\./)).toBeVisible();
  await page.screenshot({ path: `/tmp/v3-run-substitutions-${engineName}-desktop.png`, fullPage: true });

  await page.getByRole("button", { name: "start", exact: true }).click();
  await expect(page.getByRole("button", { name: "complete", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "complete", exact: true }).click();
  await expect(plan.getByText("Retained at completion", { exact: true })).toBeVisible();
  assert.deepEqual(api.lifecycleRequests.map((request) => request.commandType), ["start", "complete"]);
  assert.equal(api.getRun().effectiveProductionPlan.recipes[0].ingredients.length, 3);
  assert.equal(api.getRun().setupSnapshot.productionPlan.recipes[0].ingredients[0].productName, "Flour");
  assert.deepEqual(api.getRun().setupSnapshot.productionPlan.packagingPerCase, BASE_PLAN.packagingPerCase);

  const retainedPlan = structuredClone(api.getRun().effectiveProductionPlan);
  const retainedOverlay = structuredClone(api.getRun().substitutionOverlay);
  api.replaceCurrentOverlay();
  assert.equal(api.getCurrentOverlay().revision, 4);
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v3/runs" && response.request().method() === "GET" && response.status() === 200);
  await page.getByRole("button", { name: "Refresh server state", exact: true }).click();
  await refreshed;
  await expect(plan.getByText("Retained at completion", { exact: true })).toBeVisible();
  await expect(plan.getByText(/overlay revision 3\./)).toBeVisible();
  await expect(recipe.getByText("Bread Flour", { exact: false })).toBeVisible();
  await expect(recipe.getByText("Whole Wheat Flour", { exact: false })).toHaveCount(0);
  assert.deepEqual(api.getRun().effectiveProductionPlan, retainedPlan);
  assert.deepEqual(api.getRun().substitutionOverlay, retainedOverlay);
  assert.deepEqual(errors, []);
  await context.close();
});
