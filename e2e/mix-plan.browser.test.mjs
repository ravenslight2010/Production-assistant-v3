import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, expect, webkit } from "playwright/test";
import { buildMixPlan } from "../core/mix-planning.mjs";

const CSRF_TOKEN = "d".repeat(43);
const STAFF_ID = "76000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "76000000-0000-4000-8000-000000000010";
const MOZZARELLA_ID = "76000000-0000-4000-8000-000000000011";
const PROVOLONE_ID = "76000000-0000-4000-8000-000000000012";
const PRODUCT_MIX_ID = "76000000-0000-4000-8000-000000000020";
const PREP_MIX_ID = "76000000-0000-4000-8000-000000000021";
const SCHEDULE_RUN_ID = "76000000-0000-4000-8000-000000000030";
const LIVE_RUN_ID = "76000000-0000-4000-8000-000000000031";
const MAKE_DATE = "2026-11-18";
const PRODUCTION_DATE = "2026-11-19";
const SURPLUS_SOURCE_DATE = "2026-11-17";
const NOW = "2026-11-18T12:00:00.000Z";
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
  { productId: PRODUCT_ID, productCode: "PIZZA-A", productName: "Synthetic Pizza", baseUnit: "each" },
  { productId: MOZZARELLA_ID, productCode: "MOZZ", productName: "Mozzarella", baseUnit: "lb" },
  { productId: PROVOLONE_ID, productCode: "PROV", productName: "Provolone", baseUnit: "lb" },
];

function recipe(overrides = {}) {
  return {
    id: PRODUCT_MIX_ID,
    kind: "product",
    productId: PRODUCT_ID,
    productName: "Synthetic Pizza",
    name: "Cheese Mix",
    notes: "Synthetic product calculation",
    batchSizeLbs: "20",
    daysEarly: 2,
    enabled: true,
    revision: 0,
    updatedAt: NOW,
    components: [
      { ingredientProductId: MOZZARELLA_ID, ingredientName: "Mozzarella", ouncesPerPizza: "2", referencePoundsPerBatch: null },
      { ingredientProductId: PROVOLONE_ID, ingredientName: "Provolone", ouncesPerPizza: "1", referencePoundsPerBatch: null },
    ],
    ...overrides,
  };
}

function prepRecipe(overrides = {}) {
  return recipe({
    id: PREP_MIX_ID,
    kind: "prep",
    productId: null,
    productName: null,
    name: "Provolone Prep",
    notes: "Substitution-aware prep calculation",
    components: [{ ingredientProductId: PROVOLONE_ID, ingredientName: "Provolone", ouncesPerPizza: "1", referencePoundsPerBatch: null }],
    ...overrides,
  });
}

function demandRun(overrides = {}) {
  return {
    key: "schedule:substitution",
    runId: null,
    scheduleRunId: SCHEDULE_RUN_ID,
    source: "schedule",
    label: "Substitution-resolved scheduled run",
    productionDate: PRODUCTION_DATE,
    productId: PRODUCT_ID,
    productName: "Synthetic Pizza",
    cases: 10,
    pizzas: 144,
    ingredients: [
      { productId: MOZZARELLA_ID, name: "Mozzarella", ouncesPerPizza: 2 },
      { productId: PROVOLONE_ID, name: "Provolone", ouncesPerPizza: 4 },
    ],
    warnings: [],
    ...overrides,
  };
}

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
  const engineName = process.env.BROWSER_ENGINE ?? "chromium";
  assert.ok(["chromium", "webkit"].includes(engineName), `Unsupported browser engine: ${engineName}`);
  const engine = engineName === "webkit" ? webkit : chromium;
  const executablePath = engineName === "chromium"
    ? process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim()
    : undefined;
  const browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(engineName === "chromium" ? { args: ["--no-sandbox"] } : {}) });
  t.after(() => browser.close());
  return browser;
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

async function installMixApi(context, baseUrl, { manager = true, missingPrepAmount = false } = {}) {
  let recipes = [recipe(), prepRecipe()];
  let operations = [];
  let lots = [];
  let finalizations = [];
  let surplusRevision = 0;
  let loseNextResponse = false;
  const receipts = new Map();
  const commands = [];
  const planReads = [];
  const runs = [demandRun(missingPrepAmount ? {
    ingredients: [{ productId: PROVOLONE_ID, name: "Provolone", ouncesPerPizza: null }],
    warnings: ["Run setup is missing a provolone amount."],
  } : {})];

  const catalog = () => ({ recipes: structuredClone(recipes), products: PRODUCTS });
  const surplus = () => ({ revision: surplusRevision, lots: structuredClone(lots) });
  const allocated = () => lots.filter((lot) => !lot.voided).flatMap((lot) => lot.allocations.map((allocation) => ({
    ...allocation, mixId: lot.mixId, productId: lot.productId, voided: lot.voided,
  })));

  function getPlan(makeDate) {
    const groups = buildMixPlan({
      makeDate,
      runs,
      mixes: recipes,
      operations,
      surplusAllocations: allocated(),
      finalizations,
    });
    return {
      makeDate,
      derivedAt: NOW,
      groups: groups.map((group) => ({
        ...group,
        entries: group.entries.map((entry) => {
          const operation = operations.find((candidate) => candidate.productionDate === entry.productionDate
            && candidate.mixId === entry.mixId && (candidate.productId ?? null) === (entry.productId ?? null));
          const decorateContributions = (contributions) => contributions.map((contribution) => {
            const source = runs.find((run) => run.key === contribution.key);
            return {
              ...contribution,
              ingredients: contribution.ingredients ?? structuredClone(source?.ingredients ?? []),
              warnings: contribution.warnings ?? structuredClone(source?.warnings ?? []),
            };
          });
          return {
            ...entry,
            revision: operation?.revision ?? 0,
            contributions: decorateContributions(entry.contributions),
            finalization: entry.finalization ? {
              ...entry.finalization,
              contributions: decorateContributions(entry.finalization.contributions),
            } : null,
          };
        }),
      })),
    };
  }

  function receiptResponse(requestId, replayed) {
    const stored = receipts.get(requestId);
    return stored ? { ...structuredClone(stored), replayed } : null;
  }

  await context.addCookies([{ name: "v3_csrf", value: CSRF_TOKEN, url: baseUrl }]);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") {
      return json(route, {
        staff: { userId: STAFF_ID, username: manager ? "inventory-manager" : "operator", role: manager ? "manager" : "operator", capabilities: manager ? ["manage-inventory"] : [] },
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
    }
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/mix-recipes" && method === "GET") return json(route, { catalog: catalog() });
    if (path === "/api/v3/mix-surplus" && method === "GET") return json(route, { surplus: surplus() });
    if (path === "/api/v3/mix-plan" && method === "GET") {
      const makeDate = url.searchParams.get("makeDate");
      planReads.push(makeDate);
      return json(route, { plan: getPlan(makeDate) });
    }
    if (path === "/api/v3/mix-recipes/commands" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      commands.push({ channel: "recipes", body });
      const replay = receiptResponse(body.requestId, true);
      if (replay) return json(route, replay);
      if (body.command.type === "upsert" && body.command.recipe.id === null && body.expectedRevision !== 0) {
        return json(route, { outcome: "conflict", replayed: false, catalog: catalog() }, 409);
      }
      let saved;
      if (body.command.type === "disable") {
        const index = recipes.findIndex((item) => item.id === body.command.mixId);
        if (index < 0 || recipes[index].revision !== body.expectedRevision) return json(route, { outcome: "conflict", replayed: false, catalog: catalog() }, 409);
        saved = { ...recipes[index], enabled: false, revision: recipes[index].revision + 1, updatedAt: NOW };
        recipes[index] = saved;
      } else {
        const input = body.command.recipe;
        const index = input.id === null ? -1 : recipes.findIndex((item) => item.id === input.id);
        if (index >= 0 && recipes[index].revision !== body.expectedRevision) return json(route, { outcome: "conflict", replayed: false, catalog: catalog() }, 409);
        const product = PRODUCTS.find((item) => item.productId === input.productId);
        saved = {
          ...input,
          id: input.id ?? randomUUID(),
          productName: input.kind === "product" ? product?.productName ?? "Unknown" : null,
          revision: index >= 0 ? recipes[index].revision + 1 : 1,
          updatedAt: NOW,
          components: input.components.map((component) => ({
            ...component,
            ingredientName: PRODUCTS.find((item) => item.productId === component.ingredientProductId)?.productName ?? "Unknown",
          })),
        };
        if (index >= 0) recipes[index] = saved;
        else recipes = [...recipes, saved];
      }
      const response = { outcome: "accepted", replayed: false, requestId: body.requestId, recipe: saved, catalog: catalog() };
      receipts.set(body.requestId, response);
      if (loseNextResponse) { loseNextResponse = false; return json(route, { error: "Synthetic response loss after commit." }, 500); }
      return json(route, response);
    }
    if (path === "/api/v3/mix-plan/commands" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      commands.push({ channel: "plan", body });
      const replay = receiptResponse(body.requestId, true);
      if (replay) return json(route, replay);
      const command = body.command;
      const index = operations.findIndex((item) => item.productionDate === command.productionDate
        && item.mixId === command.mixId && (item.productId ?? null) === (command.productId ?? null));
      const currentRevision = index >= 0 ? operations[index].revision : 0;
      const currentPlan = getPlan(command.productionDate);
      const finalized = currentPlan.groups.some((group) => group.entries.some((entry) => entry.key === `${command.productionDate}:${command.mixId}:${command.productId ?? "prep"}` && entry.finalized));
      if (finalized) return json(route, { outcome: "conflict", replayed: false, reason: "finalized", plan: currentPlan }, 409);
      if (currentRevision !== body.expectedRevision) return json(route, { outcome: "conflict", replayed: false, plan: currentPlan }, 409);
      const next = {
        productionDate: command.productionDate,
        mixId: command.mixId,
        productId: command.productId,
        alreadyMadeLbs: Number(command.alreadyMadeLbs),
        actualMadeLbs: Number(command.actualMadeLbs),
        revision: currentRevision + 1,
      };
      if (index >= 0) operations[index] = next;
      else operations.push(next);
      const response = { outcome: "accepted", replayed: false, requestId: body.requestId, plan: getPlan(command.productionDate) };
      receipts.set(body.requestId, response);
      if (loseNextResponse) { loseNextResponse = false; return json(route, { error: "Synthetic response loss after commit." }, 500); }
      return json(route, response);
    }
    if (path === "/api/v3/mix-surplus/commands" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      commands.push({ channel: "surplus", body });
      const replay = receiptResponse(body.requestId, true);
      if (replay) return json(route, replay);
      if (body.expectedRevision !== surplusRevision) return json(route, { outcome: "conflict", replayed: false, surplus: surplus() }, 409);
      const command = body.command;
      if (command.type === "allocate") {
        const lot = lots.find((item) => item.id === command.lotId);
        if (!lot || lot.voided) return json(route, { outcome: "conflict", replayed: false, surplus: surplus() }, 409);
        const existing = lot.allocations.find((item) => item.targetDate === command.targetDate);
        const otherAllocated = lot.allocations.filter((item) => item.targetDate !== command.targetDate).reduce((sum, item) => sum + Number(item.quantityLbs), 0);
        if (otherAllocated + Number(command.quantityLbs) > Number(lot.surplusLbs)) {
          return json(route, { outcome: "conflict", replayed: false, reason: "over_allocation", surplus: surplus() }, 409);
        }
        lot.allocations = lot.allocations.filter((item) => item.targetDate !== command.targetDate);
        if (Number(command.quantityLbs) > 0) lot.allocations.push({ id: existing?.id ?? randomUUID(), targetDate: command.targetDate, quantityLbs: command.quantityLbs, createdAt: NOW });
        lot.allocatedLbs = String(otherAllocated + Number(command.quantityLbs));
        lot.remainingLbs = String(Number(lot.surplusLbs) - Number(lot.allocatedLbs));
      } else if (command.type === "record") {
        const selected = recipes.find((item) => item.id === command.mixId);
        lots.push({
          id: randomUUID(), mixId: command.mixId, productId: command.productId,
          mixName: selected?.name ?? "Unknown", productName: selected?.productName ?? null,
          productionDate: command.productionDate, source: "manual", amountMadeLbs: command.quantityLbs,
          surplusLbs: command.quantityLbs, allocatedLbs: "0", remainingLbs: command.quantityLbs,
          location: command.location, sourceFinalizationRunId: null, voided: false, createdAt: NOW, allocations: [],
        });
      } else {
        const lot = lots.find((item) => item.id === command.lotId);
        if (!lot || lot.voided) return json(route, { outcome: "conflict", replayed: false, surplus: surplus() }, 409);
        lot.voided = true;
        lot.allocations = [];
        lot.allocatedLbs = "0";
        lot.remainingLbs = "0";
      }
      surplusRevision += 1;
      const response = { outcome: "accepted", replayed: false, requestId: body.requestId, surplus: surplus() };
      receipts.set(body.requestId, response);
      if (loseNextResponse) { loseNextResponse = false; return json(route, { error: "Synthetic response loss after commit." }, 500); }
      return json(route, response);
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });

  return {
    commands,
    planReads,
    loseNextResponse: () => { loseNextResponse = true; },
    bumpPlanRevision: () => {
      if (operations.length === 0) throw new Error("No dated operation to bump.");
      operations[0].revision += 1;
    },
    finalizeProduct: () => {
      const current = getPlan(MAKE_DATE);
      const entry = current.groups.flatMap((group) => group.entries).find((candidate) => candidate.mixId === PRODUCT_MIX_ID);
      assert.ok(entry, "Product entry exists before finalization.");
      finalizations = [{
        productionDate: PRODUCTION_DATE,
        mixId: PRODUCT_MIX_ID,
        productId: PRODUCT_ID,
        contributions: entry.contributions,
        entry,
        firstRunId: LIVE_RUN_ID,
        actualMadeLbs: 50,
        freshLbs: 50,
        surplusLbs: 10,
        createdAt: NOW,
      }];
    },
    getLots: () => structuredClone(lots),
  };
}

function productCard(page) {
  return page.getByRole("article", { name: `Synthetic Pizza · Cheese Mix for ${PRODUCTION_DATE}`, exact: true });
}

function prepCard(page) {
  return page.getByRole("article", { name: `Provolone Prep for ${PRODUCTION_DATE}`, exact: true });
}

test("desktop Mix Plan covers staff reads, manager writes, calculations, replay, and stale recovery", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const browser = await openBrowser(t);

  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await installMixApi(operatorContext, baseUrl, { manager: false });
  const operatorPage = await operatorContext.newPage();
  await operatorPage.goto(`${baseUrl}/#mix`);
  await operatorPage.getByRole("heading", { name: "Mix Plan", exact: true }).waitFor();
  await operatorPage.getByLabel("Make date", { exact: true }).fill(MAKE_DATE);
  await expect(productCard(operatorPage)).toBeVisible();
  await expect(operatorPage.getByText("Staff read-only view", { exact: true })).toBeVisible();
  await expect(operatorPage.getByRole("button", { name: "Save dated amounts" })).toHaveCount(0);
  await operatorPage.getByRole("tab", { name: "Mix recipes", exact: true }).click();
  await expect(operatorPage.getByRole("button", { name: "New mix recipe" })).toHaveCount(0);
  await operatorContext.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const api = await installMixApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#mix`);
  await page.getByLabel("Make date", { exact: true }).fill(MAKE_DATE);
  await expect(productCard(page)).toBeVisible();
  await expect(productCard(page).getByText("27 lb", { exact: true }).first()).toBeVisible();
  await expect(productCard(page).getByText("51.05 lb", { exact: true }).first()).toBeVisible();
  await expect(prepCard(page).getByText("36 lb", { exact: true }).first()).toBeVisible();
  await expect(prepCard(page).getByText("61.4 lb", { exact: true }).first()).toBeVisible();
  await prepCard(page).getByRole("button", { name: "Show ingredients and contributions" }).click();
  await expect(prepCard(page).getByText("Provolone: 4 oz/pizza", { exact: false })).toBeVisible();
  await expect(prepCard(page).getByText("Substitution-resolved scheduled run", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Mix recipes", exact: true }).click();
  await page.getByRole("button", { name: "New mix recipe" }).click();
  const form = page.locator('form[aria-label="New mix recipe"]');
  await form.getByRole("combobox", { name: "Mix kind", exact: true }).selectOption("prep");
  await form.getByLabel("Recipe name", { exact: true }).fill("Browser Prep");
  await form.getByLabel("Batch size (lb)", { exact: true }).fill("25");
  await form.getByLabel("Days early", { exact: true }).fill("3");
  await form.getByRole("combobox", { name: "Ingredient product", exact: true }).selectOption(MOZZARELLA_ID);
  await form.getByLabel("Ounces/pizza", { exact: true }).fill("1.5");
  await form.getByRole("button", { name: "Create recipe", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Mix recipe saved." }).waitFor();
  assert.equal(api.commands.at(-1).body.command.type, "upsert");
  await expect(page.getByRole("article", { name: "Recipe Browser Prep", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Daily Mix Plan", exact: true }).click();
  await productCard(page).getByLabel("Already made (lb)", { exact: true }).fill("5");
  await productCard(page).getByLabel("Actual made (lb)", { exact: true }).fill("50");
  api.loseNextResponse();
  await productCard(page).getByRole("button", { name: "Save dated amounts", exact: true }).click();
  await page.getByText(/Retry the same request; its request ID prevents duplicate changes/).waitFor();
  const savedRequest = api.commands.at(-1).body;
  await page.getByRole("button", { name: "Retry the same request", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Previous request confirmed by exact retry. Dated Mix Plan amounts saved." }).waitFor();
  assert.equal(api.commands.at(-1).body.requestId, savedRequest.requestId);
  assert.equal(api.commands.filter((item) => item.body.requestId === savedRequest.requestId).length, 2);
  assert.equal(api.planReads.at(-1), MAKE_DATE, "The viewed make date is reloaded instead of adopting the command's production-date plan.");
  await expect(page.getByLabel("Make date", { exact: true })).toHaveValue(MAKE_DATE);
  await expect(productCard(page).getByLabel("Already made (lb)", { exact: true })).toHaveValue("5");
  await expect(productCard(page).getByLabel("Actual made (lb)", { exact: true })).toHaveValue("50");

  api.bumpPlanRevision();
  await productCard(page).getByLabel("Already made (lb)", { exact: true }).fill("6");
  await productCard(page).getByRole("button", { name: "Save dated amounts", exact: true }).click();
  await page.getByText(/The dated amounts changed before this save/).waitFor();
  await expect(productCard(page).getByLabel("Already made (lb)", { exact: true })).toHaveValue("5");
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("desktop surplus supports recording, replacement, conflicts, voiding, and finalized history", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const browser = await openBrowser(t);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const api = await installMixApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${baseUrl}/#mix`);
  await page.getByLabel("Make date", { exact: true }).fill(MAKE_DATE);
  await expect(productCard(page)).toBeVisible();
  await page.getByRole("tab", { name: "Surplus ledger", exact: true }).click();
  const record = page.locator('form[aria-label="Record manual mix surplus"]');
  await record.getByRole("combobox", { name: "Mix recipe", exact: true }).selectOption(PRODUCT_MIX_ID);
  await record.getByLabel("Source production date", { exact: true }).fill(SURPLUS_SOURCE_DATE);
  await record.getByLabel("Surplus (lb)", { exact: true }).fill("8");
  await record.getByLabel("Location", { exact: true }).fill("Rack A");
  await record.getByRole("button", { name: "Record surplus lot", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Manual surplus lot recorded." }).waitFor();
  const lot = page.getByRole("article", { name: `Surplus Synthetic Pizza · Cheese Mix ${SURPLUS_SOURCE_DATE}`, exact: true });
  await expect(lot).toBeVisible();

  await lot.getByLabel("Target production date", { exact: true }).fill(PRODUCTION_DATE);
  await lot.getByLabel("Allocation (lb)", { exact: true }).fill("3");
  await lot.getByRole("button", { name: "Save allocation", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Dated surplus allocation saved." }).waitFor();
  await expect(lot.getByText("Allocated 3 lb to 2026-11-19", { exact: false })).toBeVisible();
  await lot.getByLabel("Target production date", { exact: true }).fill(PRODUCTION_DATE);
  await lot.getByLabel("Allocation (lb)", { exact: true }).fill("4");
  await lot.getByRole("button", { name: "Save allocation", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Dated surplus allocation saved." }).waitFor();
  assert.equal(api.getLots()[0].allocations.length, 1);
  assert.equal(api.getLots()[0].allocatedLbs, "4");

  await lot.getByLabel("Target production date", { exact: true }).fill(PRODUCTION_DATE);
  await lot.getByLabel("Allocation (lb)", { exact: true }).fill("999");
  await lot.getByRole("button", { name: "Save allocation", exact: true }).click();
  await page.getByText(/The allocation exceeds the available dated-lot balance/).waitFor();
  assert.equal(api.getLots()[0].allocatedLbs, "4");
  await lot.getByRole("button", { name: "Void lot", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Surplus lot voided and allocations released." }).waitFor();
  await expect(lot.getByText("Voided", { exact: true })).toBeVisible();
  assert.equal(api.getLots()[0].allocations.length, 0);

  api.finalizeProduct();
  await page.getByRole("tab", { name: "Daily Mix Plan", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(productCard(page).getByText("Finalized · read only", { exact: true })).toBeVisible();
  await expect(productCard(page).getByText(/Completion basis retained/)).toBeVisible();
  await expect(productCard(page).getByLabel("Already made (lb)", { exact: true })).toBeDisabled();
  await expect(productCard(page).getByRole("button", { name: "Finalized", exact: true })).toBeDisabled();
  await expect(productCard(page).getByText("51.05 lb", { exact: true }).first()).toBeVisible();
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("mobile Mix Plan retains warnings, contribution detail, and offline confirmed reads", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const browser = await openBrowser(t);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await installMixApi(context, baseUrl, { missingPrepAmount: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#mix`);
  await page.getByLabel("Make date", { exact: true }).fill(MAKE_DATE);
  await expect(prepCard(page)).toBeVisible();
  await expect(prepCard(page).getByText(/Provolone: missing or zero ounces per pizza/)).toBeVisible();
  await prepCard(page).getByRole("button", { name: "Show ingredients and contributions" }).click();
  await expect(prepCard(page).getByText("Provolone: amount missing", { exact: true })).toBeVisible();
  await expect(prepCard(page).getByText(/Run setup is missing a provolone amount/).first()).toBeVisible();

  await context.setOffline(true);
  await page.getByText(/Offline read-only view. Showing confirmed values retained on this device/).waitFor();
  await expect(productCard(page)).toBeVisible();
  await expect(productCard(page).getByLabel("Already made (lb)", { exact: true })).toBeDisabled();
  await expect(productCard(page).getByRole("button", { name: "Save dated amounts", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Surplus ledger", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record surplus lot", exact: true })).toBeDisabled();
  assert.equal(errors.length, 0, errors.join("\n"));
});
