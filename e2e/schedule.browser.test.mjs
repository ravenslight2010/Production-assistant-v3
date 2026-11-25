import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, firefox } from "playwright";
import { applyScheduleCommand, emptySchedule } from "../core/schedule-planning.mjs";

const CSRF_TOKEN = "b".repeat(43);
const STAFF_ID = "74000000-0000-4000-8000-000000000001";
const IMPORT_RUN_ID = "74000000-0000-4000-8000-000000000099";
const DATE = "2026-11-18";
const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);
const CATALOG = {
  products: [{ code: "PIZZA-A", name: "Reviewed Pizza", productionSetups: [{ code: "LINE-A", name: "Main line" }] }],
  templates: [
    { code: "TEMPLATE-A", name: "Standard run", brand: "Reviewed", flavor: "Pizza", values: { pizzasPerCase: 12, crustsPerCycle: 10, cycleSpeed: 10, speedAdjustment: 1, freezerTime: 1 } },
    { code: "TEMPLATE-B", name: "Incomplete estimate", brand: "Other", flavor: "Pizza", values: {} },
  ],
  productionStartTime: "06:00",
  timeZone: "America/Chicago",
};

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
  const browserType = { webkit, firefox }[process.env.BROWSER] || chromium;
  const args = browserType === chromium ? ["--no-sandbox"] : [];
  const browser = await browserType.launch({ headless: true, args });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  return { browser, context };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

async function installScheduleApi(context, baseUrl, { manager = true } = {}) {
  const schedules = new Map();
  const receipts = new Map();
  const commands = [];
  const scheduleRequests = [];
  const imports = new Map();
  const importReceipts = new Map();
  const importRequests = [];
  let loseNextResponse = false;
  let loseNextImportResponse = false;
  const getSchedule = (date) => {
    if (!schedules.has(date)) schedules.set(date, emptySchedule(date));
    return schedules.get(date);
  };
  const projectSurplus = (schedule) => ({
    ...schedule,
    runs: schedule.runs.map((run) => ({
      ...run,
      carriedInCases: 0,
      effectiveTargetCases: run.targetCases,
      readinessWarnings: run.targetCases >= 20 ? [{
        code: "recipe_rows_missing",
        message: "Recipe rows are missing for this product.",
        setupSection: "recipes",
      }] : [],
    })),
  });

  await context.addCookies([{ name: "v3_csrf", value: CSRF_TOKEN, url: baseUrl }]);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") {
      return json(route, {
        staff: { userId: STAFF_ID, username: "manager", role: "manager", capabilities: manager ? ["manage-factory-settings"] : [] },
        expiresAt: "2026-11-22T12:00:00.000Z",
      });
    }
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/runs" && method === "GET") return json(route, { runs: [] });
    if (path === "/api/v3/schedules/substitution-products" && method === "GET") return json(route, { products: [] });
    if (path === "/api/v3/schedules/catalog" && method === "GET") {
      scheduleRequests.push(path);
      return json(route, CATALOG);
    }
    if (path === "/api/v3/schedules" && method === "GET") {
      scheduleRequests.push(path);
      return json(route, { schedule: projectSurplus(getSchedule(url.searchParams.get("date"))) });
    }
    if (path === "/api/v3/schedules/import-preview" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.equal(body.fileName, "synthetic-schedule.xlsx");
      assert.ok(body.workbookBase64.length > 0);
      return json(route, {
        preview: {
          fileName: body.fileName,
          source: { fileName: body.fileName, sha256: "c".repeat(64), parserVersion: "v1-schedule-import/1" },
          multiDay: false,
          rows: [{
            rowNumber: 2,
            sheet: "Plan",
            date: null,
            brand: "Reviewed",
            flavor: "Pizza",
            targetCases: 8,
            notes: "Synthetic PO",
            sourceCells: { brand: "A2", flavor: "B2", targetCases: "C2" },
            sourceRow: 2,
            importRunId: IMPORT_RUN_ID,
          }],
          errors: [],
          skipped: [],
        },
      });
    }
    if (path === "/api/v3/schedules/imports" && method === "GET") {
      return json(route, { imports: [...imports.values()].map(({ runs, createdRuns, ...summary }) => summary) });
    }
    if (path === "/api/v3/schedules/imports" && method === "POST") {
      const body = request.postDataJSON();
      importRequests.push({ kind: "stage", body });
      const previous = importReceipts.get(body.requestId);
      if (previous) return json(route, { outcome: "staged", replayed: true, import: previous.import });
      const dates = [...new Set(body.runs.map((run) => run.date))].sort().map((productionDate) => ({
        productionDate, status: "staged", createdRunCount: 0, updatedRunCount: 0,
        appliedAt: null, undoneAt: null, undoAvailable: false,
      }));
      const detail = {
        importId: body.importId, createdAt: "2026-11-18T12:00:00.000Z", source: body.source,
        rowCount: body.runs.length, dates, runs: body.runs, createdRuns: [],
      };
      imports.set(body.importId, detail);
      importReceipts.set(body.requestId, { import: detail });
      if (loseNextImportResponse) {
        loseNextImportResponse = false;
        return json(route, { error: "Synthetic response loss after staging commit." }, 500);
      }
      return json(route, { outcome: "staged", replayed: false, import: detail });
    }
    const importDetail = /^\/api\/v3\/schedules\/imports\/([0-9a-f-]+)$/u.exec(path);
    if (importDetail && method === "GET") return json(route, { import: imports.get(importDetail[1]) });
    const importAction = /^\/api\/v3\/schedules\/imports\/([0-9a-f-]+)\/(apply|undo)$/u.exec(path);
    if (importAction && method === "POST") {
      const body = request.postDataJSON();
      const action = importAction[2];
      importRequests.push({ kind: action, body });
      const previous = importReceipts.get(body.requestId);
      if (previous) return json(route, { ...previous.response, replayed: true, schedule: projectSurplus(getSchedule(body.date)), import: imports.get(importAction[1]) });
      const detail = imports.get(importAction[1]);
      const current = getSchedule(body.date);
      if (body.expectedRevision !== current.revision) {
        return json(route, { outcome: "conflict", reason: "stale-schedule", replayed: false, productionDate: body.date, schedule: projectSurplus(current), import: detail }, 409);
      }
      const rows = detail.runs.filter((run) => run.date === body.date);
      const dateState = detail.dates.find((item) => item.productionDate === body.date);
      let next;
      if (action === "apply") {
        const before = new Set(current.runs.map((run) => run.id));
        const canonicalRuns = rows.map(({ date, source, ...run }) => run);
        next = { ...applyScheduleCommand(current, { type: "merge-import", runs: canonicalRuns }), revision: current.revision + 1 };
        detail.createdRuns = canonicalRuns.filter((run) => !before.has(run.id));
        dateState.createdRunCount = detail.createdRuns.length;
        dateState.updatedRunCount = rows.length - detail.createdRuns.length;
        dateState.status = "applied";
        dateState.undoAvailable = detail.createdRuns.length > 0;
      } else {
        const ids = new Set(detail.createdRuns.map((run) => run.id));
        next = {
          ...current, revision: current.revision + 1,
          runs: current.runs.filter((run) => !ids.has(run.id)),
          breaks: current.breaks.map((item) => ids.has(item.runId) ? { ...item, runId: null } : item),
        };
        dateState.status = "undone";
        dateState.undoAvailable = false;
      }
      schedules.set(body.date, next);
      const response = {
        outcome: "accepted", replayed: false, productionDate: body.date,
        schedule: projectSurplus(next), import: detail,
        createdRunCount: dateState.createdRunCount, updatedRunCount: dateState.updatedRunCount,
      };
      importReceipts.set(body.requestId, { response });
      if (loseNextImportResponse) {
        loseNextImportResponse = false;
        return json(route, { error: "Synthetic response loss after import action commit." }, 500);
      }
      return json(route, response);
    }
    if (path === "/api/v3/schedules/commands" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      commands.push(body);
      const receipt = receipts.get(body.requestId);
      if (receipt) return json(route, { outcome: "accepted", replayed: true, schedule: projectSurplus(receipt.schedule) });
      const current = getSchedule(body.date);
      if (body.expectedRevision !== current.revision) return json(route, { outcome: "conflict", replayed: false, schedule: projectSurplus(current) }, 409);
      const next = {
        ...applyScheduleCommand(current, body.command),
        revision: current.revision + 1,
        updatedAt: "2026-11-18T12:00:00.000Z",
      };
      schedules.set(body.date, next);
      receipts.set(body.requestId, { schedule: projectSurplus(next) });
      if (loseNextResponse) {
        loseNextResponse = false;
        return json(route, { error: "Synthetic response loss after commit." }, 500);
      }
      return json(route, { outcome: "accepted", replayed: false, schedule: projectSurplus(next) });
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return {
    commands,
    importRequests,
    scheduleRequests,
    loseNextResponse: () => { loseNextResponse = true; },
    loseNextImportResponse: () => { loseNextImportResponse = true; },
    getSchedule,
  };
}

async function fillRun(card, { targetCases = "20", template = "TEMPLATE-A", notes = "Synthetic note" } = {}) {
  await card.getByLabel(/^Product for /).selectOption("PIZZA-A");
  await card.getByLabel(/^Production setup for /).selectOption("LINE-A");
  await card.getByLabel(/^Run template for /).selectOption(template);
  await card.getByLabel(/^Target cases for /).fill(targetCases);
  await card.getByLabel(/^Notes for /).fill(notes);
}

test("React schedule confirms commands, exact retry, conflicts, import review, and offline boundaries", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t);
  const api = await installScheduleApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#schedule`);
  await page.getByRole("heading", { name: "Production schedule", exact: true }).waitFor();
  await page.getByLabel("Production date", { exact: true }).fill(DATE);
  await page.getByRole("heading", { name: "No runs planned for this date" }).waitFor();

  await page.getByRole("button", { name: "Add planned run" }).click();
  const newRun = page.getByRole("article", { name: "New planned run", exact: true });
  await fillRun(newRun);
  await newRun.getByRole("button", { name: "Add to plan" }).click();
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
  assert.equal(api.commands[0].command.type, "add");
  assert.equal(api.commands[0].expectedRevision, 0);

  const firstRun = page.getByRole("article", { name: "Planned run 1", exact: true });
  await firstRun.getByText("Freezer carry-in: 0 cases", { exact: false }).waitFor();
  await firstRun.getByText("Effective production target: 20 of 20 planned cases", { exact: false }).waitFor();
  await firstRun.getByText("Setup review recommended", { exact: true }).waitFor();
  await firstRun.getByText("Recipe rows are missing for this product.", { exact: true }).waitFor();
  assert.equal(await firstRun.getByRole("link", { name: "Open Setup", exact: true }).getAttribute("href"), "#setup");
  await firstRun.getByText("Advisory only. These warnings do not block scheduling or production.", { exact: true }).waitFor();
  await page.getByText("20 effective / 20 planned cases", { exact: false }).first().waitFor();
  await firstRun.getByLabel(/^Target cases for /).fill("25");
  assert.equal(await firstRun.getByText("Setup review recommended", { exact: true }).count(), 0);
  api.loseNextResponse();
  await firstRun.getByRole("button", { name: "Save run 1" }).click();
  await page.getByText(/Retry the same request; its request ID prevents duplicate changes/).waitFor();
  const updateRequest = api.commands.at(-1);
  await page.getByRole("button", { name: "Retry the same save" }).click();
  await page.getByRole("status").filter({ hasText: "The previous save was confirmed. The current server plan has been reloaded." }).waitFor();
  await firstRun.getByText("Setup review recommended", { exact: true }).waitFor();
  assert.equal(api.commands.at(-1).requestId, updateRequest.requestId);
  assert.equal(api.getSchedule(DATE).runs.length, 1);
  assert.equal(api.getSchedule(DATE).runs[0].targetCases, 25);

  await page.getByRole("button", { name: "Add planned run" }).click();
  await fillRun(page.getByRole("article", { name: "New planned run", exact: true }), { targetCases: "10", template: "TEMPLATE-B", notes: "" });
  await page.getByRole("article", { name: "New planned run", exact: true }).getByRole("button", { name: "Add to plan" }).click();
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
  await page.getByRole("button", { name: "Move planned run 2 up" }).click();
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
  assert.equal(api.commands.at(-1).command.type, "move");

  await page.getByLabel("First run", { exact: true }).selectOption(api.getSchedule(DATE).runs[0].id);
  await page.getByLabel("Second run", { exact: true }).selectOption(api.getSchedule(DATE).runs[1].id);
  await page.getByRole("button", { name: "Swap selected runs" }).click();
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
  assert.equal(api.commands.at(-1).command.type, "swap");

  await page.getByLabel("Break 1 · 30 minutes", { exact: true }).check();
  await page.getByLabel("Run after break 1", { exact: true }).selectOption(api.getSchedule(DATE).runs[0].id);
  await page.getByRole("button", { name: "Save breaks" }).click();
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
  await page.getByText(/Break 1 · 30 minutes · .*CST/).first().waitFor();
  await page.getByText(/Planned finish is unknown/).waitFor();

  const second = await context.newPage();
  await second.goto(`${baseUrl}/#schedule`);
  await second.getByLabel("Production date", { exact: true }).fill(DATE);
  await second.getByRole("article", { name: "Planned run 1", exact: true }).waitFor();
  const currentFirst = page.getByRole("article", { name: "Planned run 1", exact: true });
  await currentFirst.getByLabel(/^Target cases for /).fill("30");
  await currentFirst.getByRole("button", { name: "Save run 1" }).click();
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
  const staleFirst = second.getByRole("article", { name: "Planned run 1", exact: true });
  await staleFirst.getByLabel(/^Target cases for /).fill("99");
  await staleFirst.getByRole("button", { name: "Save run 1" }).click();
  await second.getByText(/this change was not saved/).waitFor();
  assert.equal(api.getSchedule(DATE).runs[0].targetCases, 30);
  assert.equal(await staleFirst.getByLabel(/^Target cases for /).inputValue(), "99");
  await second.close();

  await page.getByLabel("Schedule workbook", { exact: true }).setInputFiles({
    name: "synthetic-schedule.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("synthetic workbook bytes"),
  });
  await page.getByRole("button", { name: "Review workbook" }).click();
  await page.getByText(/Workbook reviewed\. Nothing has been staged or applied/).waitFor();
  const importRow = page.getByRole("article", { name: "Import review row 2", exact: true });
  assert.equal(await importRow.getByLabel(/Product ·/).inputValue(), "PIZZA-A");
  assert.equal(await importRow.getByLabel(/Run template ·/).inputValue(), "TEMPLATE-A");
  await importRow.getByLabel("Production setup for import row 2", { exact: true }).selectOption("LINE-A");
  api.loseNextImportResponse();
  await page.getByRole("button", { name: "Stage 1 reviewed row(s) without changing schedules" }).click();
  await page.getByText(/The exact request remains pending/).waitFor();
  assert.equal(api.getSchedule(DATE).runs.length, 2);
  const stageRequest = api.importRequests.at(-1);
  await page.reload();
  await page.getByTestId("canonical-schedule-import").waitFor();
  await page.getByLabel("Production date", { exact: true }).fill(DATE);
  assert.equal(api.importRequests[0].body.requestId, stageRequest.body.requestId);
  assert.equal(api.importRequests[1].body.importId, stageRequest.body.importId);
  assert.equal(api.getSchedule(DATE).runs.length, 2);

  api.loseNextImportResponse();
  await page.getByRole("button", { name: `Apply canonical rows to ${DATE}` }).click();
  await page.getByRole("button", { name: "Retry the same import apply" }).waitFor();
  const applyRequest = api.importRequests.at(-1);
  await page.getByRole("button", { name: "Retry the same import apply" }).click();
  await page.getByTestId("canonical-schedule-import").getByText("applied", { exact: true }).waitFor();
  assert.equal(api.importRequests.at(-1).body.requestId, applyRequest.body.requestId);
  assert.equal(api.getSchedule(DATE).runs.length, 3);
  const canonicalPanel = page.getByTestId("canonical-schedule-import");
  await canonicalPanel.screenshot({ path: "/tmp/v3-schedule-canonical-desktop.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await canonicalPanel.screenshot({ path: "/tmp/v3-schedule-canonical-phone.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.reload();
  await page.getByRole("heading", { name: "Production schedule", exact: true }).waitFor();
  await page.getByLabel("Production date", { exact: true }).fill(DATE);
  await page.getByRole("article", { name: "Planned run 3", exact: true }).waitFor();
  await page.getByRole("button", { name: /Open schedule import synthetic-schedule\.xlsx/ }).click();
  await page.getByTestId("canonical-schedule-import").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Undo unchanged created runs for ${DATE}` }).click();
  await page.getByText(`Undo confirmed for ${DATE}. Only unchanged created runs were removed.`, { exact: true }).waitFor();
  assert.equal(api.getSchedule(DATE).runs.length, 2);
  await page.getByRole("article", { name: "Planned run 1", exact: true })
    .getByText("Setup review recommended", { exact: true }).waitFor();

  await context.setOffline(true);
  await page.getByText("Read-only offline", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Add planned run" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add planned run" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Review workbook" }).isDisabled(), true);
  assert.equal(await page.getByRole("article", { name: "Planned run 1", exact: true }).getByLabel(/^Notes for /).inputValue(), "");
  await context.setOffline(false);
  await page.getByText(/Server schedule loaded · America\/Chicago/).waitFor();
  assert.equal(await page.getByRole("article", { name: "Planned run 1", exact: true }).getByLabel(/^Notes for /).inputValue(), "Synthetic note");

  await page.screenshot({ path: "/tmp/v3-schedule-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "/tmp/v3-schedule-phone.png", fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test("schedule surface denies non-managers without requesting schedule data", { timeout: 30_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t);
  const api = await installScheduleApi(context, baseUrl, { manager: false });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#schedule`);
  await page.getByRole("heading", { name: "Manager access required" }).waitFor();
  assert.deepEqual(api.scheduleRequests, []);
  await context.close();
});
