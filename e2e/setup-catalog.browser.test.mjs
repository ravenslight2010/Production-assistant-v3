import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { parseSetupCatalogCsv } from "../core/setup-catalog-csv.mjs";

const CSRF_TOKEN = "b".repeat(43);
const STAFF_ID = "75000000-0000-4000-8000-000000000001";
const IMPORT_ID = "75000000-0000-4000-8000-000000000002";
const CSV = 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n'
  + 'BROWSER-ING,Browser Reviewed Flour,"[""dough""]","[]",true,,true\n';
const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);

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
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  return browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

function detail(importItem) {
  return {
    ...importItem,
    createdBy: STAFF_ID,
    createdAt: "2026-11-21T12:00:00.000Z",
    appliedAt: importItem.appliedAt ?? null,
    undoneAt: importItem.undoneAt ?? null,
    sourceSummary: importItem.sourceSummary ?? null,
    createdCount: importItem.createdCount ?? null,
    updatedCount: importItem.updatedCount ?? null,
  };
}

async function installSetupApi(context, baseUrl, { manager = true } = {}) {
  const imports = new Map();
  const requests = new Map();
  const setupRequests = [];
  const writes = [];
  const appliedRecords = new Map();
  let loseNextStageResponse = false;

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
    if (path.startsWith("/api/v3/setup-catalog/")) setupRequests.push(`${method} ${path}`);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) writes.push(`${method} ${path}`);
    if (path === "/api/v3/setup-catalog/imports" && method === "GET") {
      assert.equal(url.searchParams.get("limit"), "50");
      return json(route, { imports: [...imports.values()].map((item) => {
        const { records: _records, ...historyItem } = detail(item);
        return historyItem;
      }) });
    }
    if (path === "/api/v3/setup-catalog/imports/workbooks/preview" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["family", "fileName", "workbookBase64"]);
      assert.equal(Buffer.from(body.workbookBase64, "base64").toString(), "synthetic workbook bytes");
      if (body.family === "cheese-mix-specs") {
        return json(route, {
          family: body.family, targetFamily: "run-templates", parserVersion: "v1-source-import/1",
          fileSha256: "c".repeat(64), sourceRows: 1, proposedRows: 1, skippedRows: 0, unresolvedRows: [],
          records: [{ source: "cheese.xlsx / Sheet1 / row 2", targetFamily: "run-templates", record: {
            code: "CHEESE-SOURCE", name: "Cheese Source", data: { brand: "Brand", flavor: "Original", values: {} },
          }, sourceDetails: { recipe: "Mozzarella" } }],
        });
      }
      return json(route, {
        family: body.family, targetFamily: "run-templates", parserVersion: "v1-source-import/1",
        fileSha256: "a".repeat(64), sourceRows: 4, proposedRows: 2, skippedRows: 1,
        unresolvedRows: [{ source: "source.xlsx / Sheet1 / row 5", reason: "Unsupported source row requires manager review." }],
        records: [
          { source: "source.xlsx / Sheet1 / row 2", targetFamily: "run-templates", record: {
            code: "SOURCE-A", name: "Source A", data: { brand: "Brand", flavor: "Original", values: { targetDoughballWeight: 4 } },
          }, sourceDetails: { cells: { A2: "SOURCE-A", B2: "Source A" } } },
          { source: "source.xlsx / Sheet1 / row 3", targetFamily: "run-templates", record: {
            code: "SOURCE-B", name: "Source B", data: { brand: "Brand", flavor: "Original", values: { targetDoughballWeight: 6 } },
          }, sourceDetails: { cells: { A3: "SOURCE-B", B3: "Source B" } } },
        ],
      });
    }
    if (path === "/api/v3/setup-catalog/imports" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), body.sourceSummary ? ["csv", "family", "requestId", "sourceSummary"] : ["csv", "family", "requestId"]);
      const records = parseSetupCatalogCsv(body.family, body.csv);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "exact retry must preserve request ID, family, and CSV bytes");
        const item = imports.get(IMPORT_ID);
        return json(route, { outcome: "staged", importId: IMPORT_ID, family: item.family, rowCount: item.rowCount, replayed: true, records, sourceSummary: item.sourceSummary ?? null });
      }
      const item = {
        id: IMPORT_ID,
        family: body.family,
        status: "staged",
        rowCount: records.length,
        records,
        sourceSummary: body.sourceSummary ?? null,
      };
      requests.set(body.requestId, body);
      imports.set(IMPORT_ID, item);
      if (loseNextStageResponse) {
        loseNextStageResponse = false;
        return json(route, { error: "Synthetic response loss after staging commit." }, 500);
      }
      return json(route, { outcome: "staged", importId: IMPORT_ID, family: item.family, rowCount: item.rowCount, replayed: false, records, sourceSummary: item.sourceSummary }, 201);
    }
    const detailMatch = path.match(/^\/api\/v3\/setup-catalog\/imports\/([0-9a-f-]+)$/);
    if (detailMatch && method === "GET") {
      const item = imports.get(detailMatch[1]);
      return item ? json(route, detail(item)) : json(route, { error: "Not found" }, 404);
    }
    const actionMatch = path.match(/^\/api\/v3\/setup-catalog\/imports\/([0-9a-f-]+)\/(apply|undo)$/);
    if (actionMatch && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(request.postDataJSON(), {});
      const item = imports.get(actionMatch[1]);
      const action = actionMatch[2];
      if (action === "apply") {
        const replayed = item.status === "applied";
        if (!replayed) {
          item.status = "applied";
          item.appliedAt = "2026-11-21T12:01:00.000Z";
          item.createdCount = 1;
          item.updatedCount = 0;
          for (const record of item.records) appliedRecords.set(record.code, record);
        }
        return json(route, { outcome: "applied", importId: item.id, family: item.family, rowCount: 1, createdCount: 1, updatedCount: 0, appliedAt: item.appliedAt, replayed });
      }
      const replayed = item.status === "undone";
      if (!replayed) {
        item.status = "undone";
        item.undoneAt = "2026-11-21T12:02:00.000Z";
        appliedRecords.clear();
      }
      return json(route, { outcome: "undone", importId: item.id, family: item.family, rowCount: 1, createdCount: 1, updatedCount: 0, undoneAt: item.undoneAt, replayed });
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return {
    setupRequests,
    writes,
    requests,
    imports,
    appliedRecords,
    loseNextStageResponse: () => { loseNextStageResponse = true; },
  };
}

test("React setup catalog stages without applying, retries exactly, applies, undoes, reopens, and locks offline", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
  await page.getByText("No setup catalog imports have been staged.").waitFor();
  assert.equal(await page.getByRole("link", { name: "Download CSV template" }).getAttribute("download"), "ingredients-template.csv");

  await page.getByLabel("Setup CSV file", { exact: true }).setInputFiles({ name: "ingredients.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  api.loseNextStageResponse();
  await page.getByRole("button", { name: "Review and stage CSV", exact: true }).click();
  await page.getByText(/Retry the same request; its request ID prevents duplicate imports/).waitFor();
  assert.equal(api.imports.size, 1, "the staging commit occurred before the synthetic response loss");
  assert.equal(api.appliedRecords.size, 0, "staging must not apply setup values");
  const originalRequest = [...api.requests.values()][0];
  await page.getByRole("button", { name: "Retry the same staging request", exact: true }).click();
  await page.getByText(/The previous staging request was confirmed\. The canonical setup review has been reloaded\./).waitFor();
  assert.equal(api.imports.size, 1, "exact retry must not create a second import");
  assert.deepEqual([...api.requests.values()], [originalRequest]);
  const review = page.getByRole("region", { name: "Setup import review" });
  await review.getByText("Browser Reviewed Flour", { exact: true }).waitFor();
  await review.getByLabel("Values for BROWSER-ING", { exact: true }).waitFor();
  assert.equal(api.appliedRecords.size, 0, "record review remains unapplied");

  await page.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
  await page.getByText(/1 setup rows created and 0 updated\. Canonical history reloaded\./).waitFor();
  assert.equal(api.appliedRecords.get("BROWSER-ING").name, "Browser Reviewed Flour");
  await review.getByText("applied", { exact: true }).waitFor();

  await page.getByLabel("Setup CSV file", { exact: true }).setInputFiles({ name: "offline-not-retained.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Review and stage CSV", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Undo applied import", exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Setup CSV file", { exact: true }).evaluate((input) => input.files.length), 0);
  assert.equal(api.writes.length, writesBeforeOffline, "offline setup mode must not issue writes");
  await context.setOffline(false);
  await page.getByText("Server-owned import lifecycle · manage-inventory", { exact: true }).waitFor();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo applied import", exact: true }).click();
  await page.getByText(/Setup import undone\. Server dependency and later-edit rules were enforced\. Canonical history reloaded\./).waitFor();
  assert.equal(api.appliedRecords.size, 0);
  await review.getByText("undone", { exact: true }).waitFor();

  await page.reload();
  await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
  await page.getByRole("button", { name: "Reopen import 1", exact: true }).click();
  await page.getByText("Canonical import details reloaded. Review the preserved values before acting.").waitFor();
  await page.getByRole("region", { name: "Setup import review" }).getByText("Browser Reviewed Flour", { exact: true }).waitFor();
  assert.equal(api.imports.get(IMPORT_ID).status, "undone");

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `the React setup page must fit ${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test("source workbook review gates edits, preserves source summaries on exact retry, and stays read-only offline", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
  const family = page.getByLabel("Source workbook family", { exact: true });
  assert.deepEqual(await family.locator("option").allTextContents(), ["Spec sheets", "Premix sheets", "Cheese mix specs", "Shipping guides", "Sauce guides", "Dough guides"]);
  await family.selectOption("sauce-guides");
  assert.equal(await page.getByLabel("Source workbook file", { exact: true }).getAttribute("accept"), ".xlsx,.docx");
  await family.selectOption("spec-sheets");
  await page.getByLabel("Source workbook file", { exact: true }).setInputFiles({ name: "source.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("synthetic workbook bytes") });
  await page.getByRole("button", { name: "Preview workbook", exact: true }).click();
  await page.getByText(/Deterministic preview loaded\. Nothing has been staged or applied/).waitFor();
  const first = page.getByRole("article", { name: "Source record 1", exact: true });
  const second = page.getByRole("article", { name: "Source record 2", exact: true });
  await first.getByText("SOURCE-A — Source A", { exact: true }).waitFor();
  assert.equal(api.imports.size, 0, "preview must not stage or apply setup records");

  await second.getByLabel("Include", { exact: true }).uncheck();
  await first.getByLabel("V3 code", { exact: true }).fill("SOURCE-EDITED");
  await first.getByLabel("Mapped V3 JSON", { exact: true }).fill("{invalid");
  await first.getByLabel("Reviewed and confirmed", { exact: true }).check();
  await page.getByRole("button", { name: "Acknowledge review-only", exact: true }).click();
  await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
  await page.getByText("Review every included source record and correct invalid mapped JSON before staging.", { exact: true }).waitFor();
  assert.equal(api.imports.size, 0, "invalid mapped JSON must not reach staging");
  const mappedJson = JSON.stringify({ brand: "Brand", flavor: "Original", values: { targetDoughballWeight: 5 } }, null, 2);
  await first.getByLabel("Mapped V3 JSON", { exact: true }).fill(mappedJson);
  await first.getByLabel("Reviewed and confirmed", { exact: true }).check();

  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Source workbook file", { exact: true }).evaluate((input) => input.files.length), 0);
  assert.equal(await page.getByRole("button", { name: "Preview workbook", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).isDisabled(), true);
  assert.equal(await first.getByLabel("V3 code", { exact: true }).inputValue(), "SOURCE-EDITED");
  assert.equal(api.writes.length, writesBeforeOffline, "offline source review must not issue writes");
  await context.setOffline(false);
  await page.getByText("Server-owned import lifecycle · manage-inventory", { exact: true }).waitFor();

  api.loseNextStageResponse();
  await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
  await page.getByText(/Retry the same request; its request ID prevents duplicate imports/).waitFor();
  assert.equal(api.imports.size, 1);
  const originalRequest = [...api.requests.values()][0];
  assert.deepEqual(originalRequest.sourceSummary, {
    sourceFamily: "spec-sheets", sourceSha256: "a".repeat(64), parserVersion: "v1-source-import/1",
    sourceRows: 4, importedRows: 1, skippedRows: 2, unresolvedRows: 1,
  });
  assert.equal(parseSetupCatalogCsv(originalRequest.family, originalRequest.csv)[0].code, "SOURCE-EDITED");
  await page.reload();
  await page.getByRole("button", { name: "Retry the same staging request", exact: true }).click();
  await page.getByText(/The previous staging request was confirmed\. The canonical setup review has been reloaded\./).waitFor();
  assert.equal(api.imports.size, 1, "source exact retry must not duplicate the import");
  assert.deepEqual([...api.requests.values()], [originalRequest]);
  const review = page.getByRole("region", { name: "Setup import review" });
  await review.getByText("SOURCE-EDITED", { exact: true }).waitFor();
  await review.getByText(/Source spec-sheets · 4 source row\(s\) · 1 imported · 2 skipped · 1 still unresolved/).waitFor();
  assert.equal(api.appliedRecords.size, 0, "source staging remains review-only until Apply");
  assert.deepEqual(errors, []);
  await context.close();
});

test("cheese source review requires an explicit applicator slot before staging", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#setup`);
  await page.getByLabel("Source workbook family", { exact: true }).selectOption("cheese-mix-specs");
  await page.getByLabel("Source workbook file", { exact: true }).setInputFiles({ name: "cheese.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("synthetic workbook bytes") });
  await page.getByRole("button", { name: "Preview workbook", exact: true }).click();
  const candidate = page.getByRole("article", { name: "Source record 1", exact: true });
  await candidate.getByLabel("Reviewed and confirmed", { exact: true }).check();
  await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
  await page.getByText("Choose an explicit V3 cheese applicator slot for every included cheese recipe.", { exact: true }).waitFor();
  assert.equal(api.imports.size, 0);
  await candidate.getByLabel("Mapped V3 JSON", { exact: true }).fill(JSON.stringify({
    brand: "Brand", flavor: "Original", values: { app1CheeseRecipe: [{ ingredient: "MOZZARELLA", lbs: 1 }], app1CheeseRecipeName: "Mozzarella" },
  }, null, 2));
  await candidate.getByLabel("Reviewed and confirmed", { exact: true }).check();
  await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
  await page.getByText(/Reviewed source records staged\. Review the stored records/).waitFor();
  assert.equal(api.imports.size, 1);
  assert.deepEqual([...api.requests.values()][0].sourceSummary, {
    sourceFamily: "cheese-mix-specs", sourceSha256: "c".repeat(64), parserVersion: "v1-source-import/1",
    sourceRows: 1, importedRows: 1, skippedRows: 0, unresolvedRows: 0,
  });
  await context.close();
});

test("setup surface denies non-managers without requesting setup history", { timeout: 30_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl, { manager: false });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#setup`);
  await page.getByRole("heading", { name: "Manager access required" }).waitFor();
  assert.deepEqual(api.setupRequests, []);
  assert.deepEqual(api.writes, []);
  await context.close();
});
