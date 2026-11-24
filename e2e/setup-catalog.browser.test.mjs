import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { parseSetupCatalogCsv, parseSetupCatalogRecord } from "../core/setup-catalog-csv.mjs";
import { parseSetupMasterRecord } from "../core/setup-master-records.mjs";

const CSRF_TOKEN = "b".repeat(43);
const STAFF_ID = "75000000-0000-4000-8000-000000000001";
const IMPORT_ID = "75000000-0000-4000-8000-000000000002";
const MASTER_IMPORT_ID = "75000000-0000-4000-8000-000000000003";
const SECOND_IMPORT_ID = "75000000-0000-4000-8000-000000000004";
const COMBINED_REVIEW_ID = "75000000-0000-4000-8000-000000000005";
const MASTER_FINGERPRINT = "e".repeat(64);
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
    revision: 1,
    sourceRecords: [],
    ...importItem,
    createdBy: STAFF_ID,
    createdAt: "2026-11-21T12:00:00.000Z",
    appliedAt: importItem.appliedAt ?? null,
    undoneAt: importItem.undoneAt ?? null,
    sourceSummary: importItem.sourceSummary ?? null,
    createdCount: importItem.createdCount ?? null,
    updatedCount: importItem.updatedCount ?? null,
    editorBefore: importItem.editorBefore ?? null,
    before: importItem.before ?? null,
    after: importItem.after ?? null,
  };
}

function masterDetail(importItem) {
  return {
    ...importItem,
    createdBy: STAFF_ID,
    appliedBy: importItem.appliedBy ?? null,
    undoneBy: importItem.undoneBy ?? null,
    createdAt: "2026-11-21T12:00:00.000Z",
    appliedAt: importItem.appliedAt ?? null,
    undoneAt: importItem.undoneAt ?? null,
    editorBefore: importItem.editorBefore ?? null,
    before: importItem.before ?? null,
    after: importItem.after ?? null,
  };
}

function combinedProjection(importIds, imports, replayed = false) {
  const order = ["spec-sheets", "dough-guides", "sauce-guides", "premix-sheets", "cheese-mix-specs", "shipping-guides"];
  const pinned = importIds.map((id) => detail(imports.get(id)))
    .sort((left, right) => order.indexOf(left.sourceSummary.sourceFamily) - order.indexOf(right.sourceSummary.sourceFamily));
  const proposal = (item, value) => ({
    code: item.records[0].code,
    source: item.sourceRecords[0]?.source ?? null,
    sourceDetails: item.sourceRecords[0]?.sourceDetails ?? null,
    value,
    importId: item.id,
    revision: 1,
    importStatus: item.status,
    targetFamily: item.family,
    sourceFamily: item.sourceSummary.sourceFamily,
    sourceSha256: item.sourceSummary.sourceSha256,
    parserVersion: item.sourceSummary.parserVersion,
  });
  const first = pinned[0];
  const second = pinned[1] ?? first;
  const entry = (field, disposition, currentRecordPresent, currentValue, proposedValues, proposals) => ({
    targetFamily: "run-templates", code: first.records[0].code, field, currentRecordPresent, currentValue,
    proposedValues, disposition, requiresDecision: disposition === "mismatch" || disposition === "conflict", proposals,
  });
  return {
    id: COMBINED_REVIEW_ID,
    createdBy: STAFF_ID,
    createdAt: "2026-11-21T12:03:00.000Z",
    replayed,
    dependencyOrder: order,
    imports: pinned.map((item) => ({
      importId: item.id, revision: 1, family: item.family, status: item.status,
      rowCount: item.rowCount, sourceSummary: item.sourceSummary,
    })),
    entries: [
      entry("values.fill", "fill", false, null, ["synthetic"], [proposal(first, "synthetic")]),
      entry("values.match", "match", true, 4, [4], [proposal(first, 4)]),
      entry("values.mismatch", "mismatch", true, 4, [5], [proposal(first, 5)]),
      entry("values.conflict", "conflict", true, 4, [5, 6], [proposal(first, 5), proposal(second, 6)]),
    ],
    missingDependencies: [{
      targetFamily: "run-templates", code: first.records[0].code, field: "values.doughRecipeName",
      reference: "Synthetic missing dough", importId: first.id, revision: 1, importStatus: first.status,
      sourceFamily: first.sourceSummary.sourceFamily, sourceSha256: first.sourceSummary.sourceSha256,
      parserVersion: first.sourceSummary.parserVersion, source: first.sourceRecords[0]?.source ?? null,
      sourceDetails: first.sourceRecords[0]?.sourceDetails ?? null, reason: "no-unique-exact-or-normalized-match",
      suggestions: [{ code: "SYNTHETIC-DOUGH", name: "Synthetic dough suggestion" }], suggestionOnly: true,
    }],
    unresolvedIdentities: [{
      type: "ambiguous-name", targetFamily: "run-templates", normalizedName: "synthetic ambiguous",
      reference: null, candidates: [{ code: "SYNTHETIC-A" }, { code: "SYNTHETIC-B" }], suggestions: [],
    }],
    summary: {
      imports: pinned.length, records: pinned.reduce((sum, item) => sum + item.rowCount, 0),
      fills: 1, matches: 1, mismatches: 1, conflicts: 1, missingDependencies: 1, unresolvedIdentities: 1,
    },
  };
}

async function installSetupApi(context, baseUrl, { manager = true, seedSetup2 = false } = {}) {
  const imports = new Map();
  const requests = new Map();
  const setupRequests = [];
  const writes = [];
  const appliedRecords = new Map();
  const masterImports = new Map();
  const masterRequests = new Map();
  const masterRecords = new Map([["DOUGH-BROWSER", {
    code: "DOUGH-BROWSER", name: "Browser dough procedure", productCode: "PIZZA",
    data: {
      sourceFamily: "dough-procedure", sourceKey: null, fileName: null, fileSha256: null, source: null,
      doughballYield: 100, doughballWeightOz: 8, doughballsPerTray: 24,
    },
  }]]);
  const combinedReviews = new Map();
  const combinedRequests = new Map();
  let loseNextStageResponse = false;
  let rejectNextStageResponse = false;
  let loseNextMasterStageResponse = false;
  let loseNextCombinedResponse = false;
  if (seedSetup2) {
    appliedRecords.set("LEGACY-ING", {
      code: "LEGACY-ING", name: "Legacy allergen ingredient",
      data: { categories: ["dough"], allergens: ["milk", "Legacy: unspecified oil"], allergensReviewed: false, mergedIntoCode: null, enabled: true },
    });
    appliedRecords.set("run-calc-dough-recipe-presets", {
      code: "run-calc-dough-recipe-presets", name: "run-calc-dough-recipe-presets",
      data: {
        key: "run-calc-dough-recipe-presets",
        value: {
          "House Dough": {
            rows: [{ ingredient: "Bread flour", lbs: 50 }], brand: "Browser Brand", flavors: ["Plain"], notes: "Base recipe",
            enabled: true, isPremadeCrust: false, doughballWeightOz: 8, doughballsPerTray: 24,
            doughballVariants: [{ label: "Regular", weightOz: 8, perTray: 24, customers: [{ brand: "Browser Brand", flavor: "Plain" }] }],
          },
        },
      },
    });
  }

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
    if (path === "/api/v3/imports" && method === "GET") {
      assert.equal(url.searchParams.get("limit"), "50");
      return json(route, { imports: [...masterImports.values()].map((item) => {
        const { records: _records, editorBefore: _editorBefore, before: _before, after: _after, ...historyItem } = masterDetail(item);
        return historyItem;
      }) });
    }
    if (path === "/api/v3/inventory/products" && method === "GET") {
      return json(route, { products: [{ id: "75000000-0000-4000-8000-000000000010", code: "PIZZA", name: "Browser Pizza", unit: "case", active: true }] });
    }
    if (path === "/api/v3/imports/records" && method === "GET") {
      const kind = url.searchParams.get("kind");
      assert.equal(url.searchParams.get("limit"), "100");
      return json(route, {
        kind,
        records: kind === "recipes" ? [...masterRecords.values()].map((record) => ({ ...record, fingerprint: MASTER_FINGERPRINT })) : [],
        nextCursor: null,
      });
    }
    if (path === "/api/v3/imports/edits" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["expectedFingerprint", "kind", "record", "requestId"]);
      const record = parseSetupMasterRecord(body.kind, body.record);
      const prior = masterRequests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "exact product retry must preserve the request and canonical record");
        const item = masterImports.get(MASTER_IMPORT_ID);
        return json(route, { outcome: "staged", importId: MASTER_IMPORT_ID, kind: item.kind, rowCount: 1, replayed: true, records: item.records });
      }
      const item = {
        id: MASTER_IMPORT_ID, kind: body.kind, status: "staged", rowCount: 1, records: [record],
        editorBefore: body.expectedFingerprint === null ? null : masterRecords.get(record.code) ?? null,
      };
      masterRequests.set(body.requestId, body);
      masterImports.set(MASTER_IMPORT_ID, item);
      if (loseNextMasterStageResponse) {
        loseNextMasterStageResponse = false;
        return json(route, { error: "Synthetic product staging response loss after commit." }, 500);
      }
      return json(route, { outcome: "staged", importId: MASTER_IMPORT_ID, kind: item.kind, rowCount: 1, replayed: false, records: item.records }, 201);
    }
    const masterDetailMatch = path.match(/^\/api\/v3\/imports\/([0-9a-f-]+)$/);
    if (masterDetailMatch && method === "GET") {
      const item = masterImports.get(masterDetailMatch[1]);
      return item ? json(route, { import: masterDetail(item) }) : json(route, { error: "Not found" }, 404);
    }
    const masterActionMatch = path.match(/^\/api\/v3\/imports\/([0-9a-f-]+)\/(apply|undo)$/);
    if (masterActionMatch && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(request.postDataJSON(), {});
      const item = masterImports.get(masterActionMatch[1]);
      const action = masterActionMatch[2];
      if (action === "apply") {
        const replayed = item.status === "applied";
        if (!replayed) {
          item.status = "applied";
          item.appliedAt = "2026-11-21T12:01:00.000Z";
          item.appliedBy = STAFF_ID;
          item.before = item.records.map((record) => ({ code: record.code, data: item.editorBefore }));
          item.after = item.records.map((record) => ({ code: record.code, data: record }));
          for (const record of item.records) masterRecords.set(record.code, record);
        }
        return json(route, { outcome: "applied", importId: item.id, kind: item.kind, replayed });
      }
      const replayed = item.status === "undone";
      if (!replayed) {
        item.status = "undone";
        item.undoneAt = "2026-11-21T12:02:00.000Z";
        item.undoneBy = STAFF_ID;
        for (const record of item.records) {
          if (item.editorBefore) masterRecords.set(record.code, item.editorBefore);
          else masterRecords.delete(record.code);
        }
      }
      return json(route, { outcome: "undone", importId: item.id, kind: item.kind, replayed });
    }
    if (path.startsWith("/api/v3/setup-catalog/")) setupRequests.push(`${method} ${path}`);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) writes.push(`${method} ${path}`);
    if (path === "/api/v3/setup-catalog/imports" && method === "GET") {
      assert.equal(url.searchParams.get("limit"), "50");
      return json(route, { imports: [...imports.values()].map((item) => {
        const { records: _records, editorBefore: _editorBefore, before: _before, after: _after, ...historyItem } = detail(item);
        return historyItem;
      }) });
    }
    if (path === "/api/v3/setup-catalog/combined-reviews" && method === "GET") {
      assert.equal(url.searchParams.get("limit"), "50");
      return json(route, { reviews: [...combinedReviews.values()].map((review) => ({
        id: review.id, createdBy: review.createdBy, createdAt: review.createdAt,
        importCount: review.summary.imports, recordCount: review.summary.records,
      })) });
    }
    if (path === "/api/v3/setup-catalog/combined-reviews" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["importIds", "requestId"]);
      const prior = combinedRequests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "exact combined retry must preserve its request and source pins");
        return json(route, combinedProjection(body.importIds, imports, true));
      }
      assert.ok(body.importIds.every((id) => imports.has(id)));
      const review = combinedProjection(body.importIds, imports);
      combinedRequests.set(body.requestId, body);
      combinedReviews.set(COMBINED_REVIEW_ID, review);
      if (loseNextCombinedResponse) {
        loseNextCombinedResponse = false;
        return json(route, { error: "Synthetic combined-review response loss after commit." }, 500);
      }
      return json(route, review, 201);
    }
    const combinedDetailMatch = path.match(/^\/api\/v3\/setup-catalog\/combined-reviews\/([0-9a-f-]+)$/);
    if (combinedDetailMatch && method === "GET") {
      const review = combinedReviews.get(combinedDetailMatch[1]);
      return review ? json(route, combinedProjection(review.summary ? review.imports.map((item) => item.importId) : [], imports))
        : json(route, { error: "Not found" }, 404);
    }
    if (path === "/api/v3/setup-catalog/records" && method === "GET") {
      const family = url.searchParams.get("family");
      return json(route, {
        family,
        records: ["ingredients", "manager-lists"].includes(family) ? [...appliedRecords.values()].filter((record) =>
          family === "ingredients" ? !record.code.startsWith("run-calc-") : record.code.startsWith("run-calc-")).map((record) => ({
          ...record, fingerprint: "d".repeat(64),
        })) : [],
        nextCursor: null,
      });
    }
    if (path === "/api/v3/inventory/die-defaults" && method === "GET") {
      return json(route, { defaults: [], history: [] });
    }
    if (path === "/api/v3/setup-catalog/imports/workbooks/preview" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["family", "fileName", "workbookBase64"]);
      assert.equal(Buffer.from(body.workbookBase64, "base64").toString(), "synthetic workbook bytes");
      if (body.family === "cheese-mix-specs") {
        return json(route, {
          family: body.family, targetFamily: "run-templates", parserVersion: "v1-source-import/2",
          fileSha256: "c".repeat(64), sourceRows: 1, proposedRows: 1, skippedRows: 0, unresolvedRows: [],
          records: [{ source: "cheese.xlsx / Sheet1 / row 2", targetFamily: "run-templates", record: {
            code: "CHEESE-SOURCE", name: "Cheese Source", data: { brand: "Brand", flavor: "Original", values: {} },
          }, sourceDetails: { recipe: "Mozzarella" } }],
        });
      }
      return json(route, {
        family: body.family, targetFamily: "run-templates", parserVersion: "v1-source-import/2",
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
      assert.deepEqual(Object.keys(body).sort(), body.sourceSummary ? ["csv", "family", "requestId", "sourceRecords", "sourceSummary"] : ["csv", "family", "requestId"]);
      const records = parseSetupCatalogCsv(body.family, body.csv);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "exact retry must preserve request ID, family, and CSV bytes");
        const item = imports.get(IMPORT_ID);
        return json(route, { outcome: "staged", importId: IMPORT_ID, revision: 1, family: item.family, rowCount: item.rowCount, replayed: true, records, sourceSummary: item.sourceSummary ?? null });
      }
      if (rejectNextStageResponse) {
        rejectNextStageResponse = false;
        return json(route, { error: "Synthetic staging rejection before commit." }, 400);
      }
      const importId = imports.size === 0 ? IMPORT_ID : SECOND_IMPORT_ID;
      assert.ok(!imports.has(importId), "synthetic browser harness supports two independent imports");
      const item = {
        id: importId,
        family: body.family,
        status: "staged",
        rowCount: records.length,
        records,
        sourceSummary: body.sourceSummary ?? null,
        sourceRecords: body.sourceRecords ?? [],
      };
      requests.set(body.requestId, body);
      imports.set(importId, item);
      if (loseNextStageResponse) {
        loseNextStageResponse = false;
        return json(route, { error: "Synthetic response loss after staging commit." }, 500);
      }
      return json(route, { outcome: "staged", importId, revision: 1, family: item.family, rowCount: item.rowCount, replayed: false, records, sourceSummary: item.sourceSummary }, 201);
    }
    if (path === "/api/v3/setup-catalog/edits" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.deepEqual(Object.keys(body).sort(), ["expectedFingerprint", "family", "record", "requestId"]);
      const record = parseSetupCatalogRecord(body.family, body.record);
      const prior = requests.get(body.requestId);
      if (prior) {
        assert.deepEqual(body, prior, "exact typed retry must preserve request ID and record");
        const item = imports.get(IMPORT_ID);
        return json(route, { outcome: "staged", importId: IMPORT_ID, revision: 1, family: item.family, rowCount: 1, replayed: true, records: item.records, sourceSummary: null });
      }
      const item = {
        id: IMPORT_ID, family: body.family, status: "staged", rowCount: 1, records: [record],
        editorBefore: body.expectedFingerprint === null ? null : appliedRecords.get(record.code) ?? null,
        sourceSummary: null,
      };
      requests.set(body.requestId, body);
      imports.set(IMPORT_ID, item);
      return json(route, { outcome: "staged", importId: IMPORT_ID, revision: 1, family: item.family, rowCount: 1, replayed: false, records: item.records, sourceSummary: null }, 201);
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
          item.before = item.records.map((record) => ({ code: record.code, data: null }));
          item.after = item.records.map((record) => ({ code: record.code, data: record }));
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
    masterImports,
    masterRequests,
    masterRecords,
    combinedReviews,
    combinedRequests,
    loseNextStageResponse: () => { loseNextStageResponse = true; },
    rejectNextStageResponse: () => { rejectNextStageResponse = true; },
    loseNextMasterStageResponse: () => { loseNextMasterStageResponse = true; },
    loseNextCombinedResponse: () => { loseNextCombinedResponse = true; },
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
  assert.equal(await page.getByLabel("Source workbook file", { exact: true }).getAttribute("multiple"), "");
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
  assert.equal(await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).count(), 0);
  await page.getByText(/No workbooks queued\. Raw files are held only in this online queue/).waitFor();
  assert.equal(api.writes.length, writesBeforeOffline, "offline source review must not issue writes");
  await context.setOffline(false);
  await page.getByText("Server-owned import lifecycle · manage-inventory", { exact: true }).waitFor();
  await page.getByLabel("Source workbook file", { exact: true }).setInputFiles({ name: "source.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("synthetic workbook bytes") });
  await page.getByRole("button", { name: "Preview workbook", exact: true }).click();
  await page.getByText(/Deterministic preview loaded\. Nothing has been staged or applied/).waitFor();
  await second.getByLabel("Include", { exact: true }).uncheck();
  await first.getByLabel("V3 code", { exact: true }).fill("SOURCE-EDITED");
  await first.getByLabel("Mapped V3 JSON", { exact: true }).fill(mappedJson);
  await first.getByLabel("Reviewed and confirmed", { exact: true }).check();
  await page.getByRole("button", { name: "Acknowledge review-only", exact: true }).click();

  api.loseNextStageResponse();
  await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
  await page.getByText(/Retry the same request; its request ID prevents duplicate imports/).waitFor();
  assert.equal(api.imports.size, 1);
  const originalRequest = [...api.requests.values()][0];
  assert.deepEqual(originalRequest.sourceSummary, {
    sourceFamily: "spec-sheets", sourceSha256: "a".repeat(64), parserVersion: "v1-source-import/2",
    sourceRows: 4, importedRows: 1, skippedRows: 2, unresolvedRows: 1,
  });
  assert.equal(parseSetupCatalogCsv(originalRequest.family, originalRequest.csv)[0].code, "SOURCE-EDITED");
  assert.deepEqual(originalRequest.sourceRecords, [{
    code: "SOURCE-EDITED",
    source: { workbook: "source.xlsx", cell: "source.xlsx / Sheet1 / row 2" },
    sourceDetails: { cells: { A2: "SOURCE-A", B2: "Source A" } },
  }]);
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

test("mixed workbooks queue independently and leave only after confirmed staging", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
  await page.getByLabel("Source workbook file", { exact: true }).setInputFiles([
    { name: "first.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("synthetic workbook bytes") },
    { name: "second.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("synthetic workbook bytes") },
  ]);
  await page.getByRole("article", { name: "Queued workbook 2", exact: true }).waitFor();
  await page.getByLabel("Source family for second.docx", { exact: true }).selectOption("sauce-guides");
  assert.equal(await page.getByLabel("Source workbook file", { exact: true }).evaluate((input) => input.files.length), 0);

  async function previewAndStage(rejectFirst = false) {
    await page.getByRole("button", { name: "Preview workbook", exact: true }).click();
    await page.getByText(/Deterministic preview loaded\. Nothing has been staged or applied/).waitFor();
    for (const index of [1, 2]) {
      await page.getByRole("article", { name: `Source record ${index}`, exact: true })
        .getByLabel("Reviewed and confirmed", { exact: true }).check();
    }
    await page.getByRole("button", { name: "Acknowledge review-only", exact: true }).click();
    if (rejectFirst) api.rejectNextStageResponse();
    await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
    if (rejectFirst) {
      await page.getByText("Synthetic staging rejection before commit.", { exact: true }).waitFor();
      assert.equal(api.imports.size, 0);
      await page.getByRole("article", { name: "Source record 1", exact: true }).waitFor();
      await page.getByRole("article", { name: "Queued workbook 2", exact: true }).waitFor();
      await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
    }
    await page.getByText(/Reviewed source records staged\. Review the stored records/).waitFor();
  }

  await page.getByRole("button", { name: "Preview workbook", exact: true }).click();
  await page.getByText(/Deterministic preview loaded/).waitFor();
  await page.getByRole("button", { name: "Close workbook preview", exact: true }).click();
  await page.getByText(/Preview closed\. The file remains queued/).waitFor();
  assert.equal(await page.getByRole("article", { name: "Queued workbook 2", exact: true }).count(), 1);
  assert.equal(api.imports.size, 0);

  await previewAndStage(true);
  assert.equal(api.imports.size, 1);
  assert.equal(await page.getByRole("article", { name: "Queued workbook 2", exact: true }).count(), 0);
  await page.getByRole("article", { name: "Queued workbook 1", exact: true }).getByText("second.docx", { exact: true }).waitFor();
  assert.equal([...api.requests.values()][0].sourceSummary.sourceFamily, "spec-sheets");

  await previewAndStage();
  assert.equal(api.imports.size, 2);
  assert.equal([...api.requests.values()][1].sourceSummary.sourceFamily, "sauce-guides");
  await page.getByText(/No workbooks queued\. Raw files are held only in this online queue/).waitFor();
  assert.equal(api.appliedRecords.size, 0, "mixed queue staging must never apply setup values");
  assert.deepEqual(errors, []);
  await context.close();
});

test("combined review retries exactly, reopens canonical history, and links decisions to individual Apply", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl);
  const sourceSummary = (sourceFamily, sourceSha256) => ({
    sourceFamily, sourceSha256, parserVersion: "v1-source-import/2",
    sourceRows: 1, importedRows: 1, skippedRows: 0, unresolvedRows: 0,
  });
  for (const [id, family, sha] of [[IMPORT_ID, "spec-sheets", "a"], [SECOND_IMPORT_ID, "dough-guides", "b"]]) {
    api.imports.set(id, {
      id, family: "run-templates", status: "staged", rowCount: 1,
      records: [{ code: `RECORD-${id.slice(-1)}`, name: "Synthetic combined record", data: { brand: "Brand", flavor: "Original", values: {} } }],
      sourceSummary: sourceSummary(family, sha.repeat(64)),
      sourceRecords: [{ code: `RECORD-${id.slice(-1)}`, source: { workbook: `${family}.xlsx`, cell: `${family}.xlsx / Sheet1 / row 2` }, sourceDetails: { synthetic: true } }],
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  const combined = page.getByRole("region", { name: "Combined setup review", exact: true });
  await combined.getByRole("checkbox").nth(0).check();
  await combined.getByRole("checkbox").nth(1).check();
  api.loseNextCombinedResponse();
  await combined.getByRole("button", { name: "Create combined review", exact: true }).click();
  await page.getByRole("button", { name: "Retry the same combined review request", exact: true }).waitFor();
  assert.equal(api.combinedReviews.size, 1);
  assert.equal(api.appliedRecords.size, 0);
  const originalRequest = [...api.combinedRequests.values()][0];

  await page.reload();
  await page.getByRole("button", { name: "Retry the same combined review request", exact: true }).click();
  await page.getByText(/Previous combined-review request confirmed\. Canonical projection reloaded; no setup values were written\./).waitFor();
  assert.equal(api.combinedReviews.size, 1);
  assert.deepEqual([...api.combinedRequests.values()], [originalRequest]);
  const projection = page.getByLabel("Combined setup projection", { exact: true });
  await projection.getByText("Canonical review", { exact: true }).waitFor();
  await projection.getByText("spec-sheets.xlsx · spec-sheets.xlsx / Sheet1 / row 2", { exact: true }).first().waitFor();
  await projection.getByText("Synthetic missing dough", { exact: true }).waitFor();
  await projection.getByText("SYNTHETIC-DOUGH — Synthetic dough suggestion", { exact: true }).waitFor();
  await projection.getByText(/Ambiguous normalized name: synthetic ambiguous/).waitFor();
  assert.equal(await projection.getByRole("article", { name: "mismatch RECORD-2 values.mismatch", exact: true }).count(), 1);
  assert.equal(await projection.getByRole("article", { name: "conflict RECORD-2 values.conflict", exact: true }).count(), 1);
  assert.equal(await projection.getByRole("article", { name: "fill RECORD-2 values.fill", exact: true }).count(), 0);
  await projection.getByLabel("Combined review filter", { exact: true }).selectOption("fills");
  await projection.getByRole("article", { name: "fill RECORD-2 values.fill", exact: true }).waitFor();
  await projection.getByLabel("Combined review filter", { exact: true }).selectOption("matches");
  await projection.getByRole("article", { name: "match RECORD-2 values.match", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Apply combined|combined Apply/iu }).count(), 0);

  await projection.getByRole("button", { name: "Open referring import", exact: true }).click();
  const individual = page.getByRole("region", { name: "Setup import review", exact: true });
  await individual.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
  await page.getByText(/1 setup rows created and 0 updated\./).waitFor();
  assert.equal(api.imports.get(IMPORT_ID).status, "applied");
  assert.equal(api.imports.get(SECOND_IMPORT_ID).status, "staged", "individual Apply must not apply other corpus imports");
  await projection.getByText("applied", { exact: true }).first().waitFor();

  await page.reload();
  await page.getByRole("button", { name: "Reopen combined review 1", exact: true }).click();
  await page.getByLabel("Combined setup projection", { exact: true }).waitFor();
  await page.getByLabel("Combined setup projection", { exact: true }).getByText("applied", { exact: true }).first().waitFor();
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
    sourceFamily: "cheese-mix-specs", sourceSha256: "c".repeat(64), parserVersion: "v1-source-import/2",
    sourceRows: 1, importedRows: 1, skippedRows: 0, unresolvedRows: 0,
  });
  await context.close();
});

test("typed product capacity retries exactly and applies and undoes independently of catalogs", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  const editor = page.getByRole("region", { name: "Dough yield and shipping capacity", exact: true });
  await editor.getByText("Browser dough procedure", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Doughball yield", { exact: true }).fill("125");
  api.loseNextMasterStageResponse();
  await page.getByRole("button", { name: "Stage capacity edit", exact: true }).click();
  await page.getByText(/Retry the same request; its request ID prevents duplicate imports/).waitFor();
  assert.equal(api.masterImports.size, 1);
  assert.equal(api.masterRecords.get("DOUGH-BROWSER").data.doughballYield, 100, "staging must not mutate canonical product setup");
  assert.equal(api.appliedRecords.size, 0, "product staging must not touch catalog records");
  assert.equal(await editor.getByRole("button", { name: "Create capacity record", exact: true }).isDisabled(), true, "an unresolved write pauses other setup writes");
  const originalRequest = [...api.masterRequests.values()][0];

  await page.reload();
  await page.getByRole("button", { name: "Retry the same staging request", exact: true }).click();
  await page.getByText(/The previous staging request was confirmed\. The canonical setup review has been reloaded\./).waitFor();
  assert.equal(api.masterImports.size, 1);
  assert.deepEqual([...api.masterRequests.values()], [originalRequest]);
  const review = page.getByRole("region", { name: "Product setup review", exact: true });
  await review.getByLabel("Before product values for DOUGH-BROWSER", { exact: true }).waitFor();
  assert.match(await review.getByLabel("Product values for DOUGH-BROWSER", { exact: true }).textContent(), /125/u);
  await review.getByRole("button", { name: "Apply reviewed product setup", exact: true }).click();
  await page.getByText(/Product setup import applied\. Catalog records were not changed by this action\. Canonical history reloaded\./).waitFor();
  assert.equal(api.masterRecords.get("DOUGH-BROWSER").data.doughballYield, 125);
  assert.equal(api.appliedRecords.size, 0, "product Apply must not apply a catalog record");

  page.once("dialog", (dialog) => dialog.accept());
  await review.getByRole("button", { name: "Undo applied product setup", exact: true }).click();
  await page.getByText(/Product setup import undone\. Server dependency and later-edit rules were enforced\. Canonical history reloaded\./).waitFor();
  assert.equal(api.masterRecords.get("DOUGH-BROWSER").data.doughballYield, 100);
  assert.equal(api.appliedRecords.size, 0);
  await page.getByRole("button", { name: "Reload canonical product review", exact: true }).click();
  await page.getByText(/Canonical product setup details reloaded\. Review the preserved values before acting\./u).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("named recipe variants stage canonically and legacy allergens require explicit resolution", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl, { seedSetup2: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  await page.locator("#setup-catalog-family").selectOption("manager-lists");
  const catalog = page.getByRole("region", { name: "Named recipes and directories", exact: true });
  await catalog.getByText("run-calc-dough-recipe-presets", { exact: true }).first().waitFor();
  await catalog.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Search named recipes", { exact: true }).fill("missing recipe");
  await page.getByText("No named recipes match this search.", { exact: true }).waitFor();
  await page.getByLabel("Search named recipes", { exact: true }).fill("House");
  const recipe = page.getByRole("article", { name: "Named recipe 1", exact: true });
  await recipe.getByLabel("Premade crust", { exact: true }).check();
  await recipe.getByRole("button", { name: "Add doughball variant", exact: true }).click();
  await recipe.getByLabel("Variant label", { exact: true }).nth(1).fill("Large 16");
  await recipe.getByLabel("Weight oz (optional)", { exact: true }).nth(1).fill("16");
  await recipe.getByLabel("Per tray (optional)", { exact: true }).nth(1).fill("12");
  await recipe.getByRole("button", { name: "Add customer pairing", exact: true }).nth(1).click();
  await recipe.getByLabel("Brand", { exact: true }).last().fill("Second Brand");
  await recipe.getByLabel("Flavor", { exact: true }).last().fill("Supreme");
  await page.getByRole("button", { name: "Stage typed edit", exact: true }).click();
  const review = page.getByRole("region", { name: "Setup import review", exact: true });
  await review.getByLabel("Values for run-calc-dough-recipe-presets", { exact: true }).waitFor();
  assert.match(await review.getByLabel("Values for run-calc-dough-recipe-presets", { exact: true }).textContent(), /Large 16/u);
  await review.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
  await page.getByText(/1 setup rows created and 0 updated\. Canonical history reloaded\./).waitFor();
  const appliedRecipe = api.appliedRecords.get("run-calc-dough-recipe-presets").data.value["House Dough"];
  assert.equal(appliedRecipe.isPremadeCrust, true);
  assert.deepEqual(appliedRecipe.doughballVariants[1], {
    label: "Large 16", weightOz: 16, perTray: 12, customers: [{ brand: "Second Brand", flavor: "Supreme" }],
  });
  assert.equal(api.masterRecords.get("DOUGH-BROWSER").data.doughballYield, 100, "catalog Apply must not change product setup");

  await page.locator("#setup-catalog-family").selectOption("ingredients");
  const ingredients = page.getByRole("region", { name: "Ingredients and allergens", exact: true });
  await ingredients.getByText("Legacy allergen ingredient", { exact: true }).waitFor();
  await ingredients.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await page.getByLabel("Allergen mapping reviewed", { exact: true }).isDisabled(), true);
  await page.getByText("Unrecognized legacy allergen text", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Remove legacy allergen text 1", exact: true }).click();
  assert.equal(await page.getByLabel("Allergen mapping reviewed", { exact: true }).isEnabled(), true);
  await page.getByLabel("wheat", { exact: true }).check();
  await page.getByLabel("Allergen mapping reviewed", { exact: true }).check();
  await ingredients.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(errors, []);
  await context.close();
});

test("named recipe renames cannot silently replace an existing recipe", { timeout: 30_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const context = await openBrowser(t);
  const api = await installSetupApi(context, baseUrl, { seedSetup2: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#setup`);
  await page.locator("#setup-catalog-family").selectOption("manager-lists");
  const catalog = page.getByRole("region", { name: "Named recipes and directories", exact: true });
  await catalog.getByText("run-calc-dough-recipe-presets", { exact: true }).first().waitFor();
  await catalog.getByRole("button", { name: "Edit", exact: true }).click();
  await catalog.getByRole("button", { name: "Add named recipe", exact: true }).click();
  const first = catalog.getByRole("article", { name: "Named recipe 1", exact: true });
  const second = catalog.getByRole("article", { name: "Named recipe 2", exact: true });
  assert.equal(await second.getByLabel("Recipe name", { exact: true }).inputValue(), "Recipe 2");
  await first.getByLabel("Recipe name", { exact: true }).fill("Recipe 2");
  await catalog.getByText("Recipe names must be unique. The existing recipes were not changed.", { exact: true }).waitFor();
  assert.equal(await first.getByLabel("Recipe name", { exact: true }).inputValue(), "House Dough");
  assert.equal(await second.getByLabel("Recipe name", { exact: true }).inputValue(), "Recipe 2");
  await catalog.getByRole("button", { name: "Add named recipe", exact: true }).click();
  const third = catalog.getByRole("article", { name: "Named recipe 3", exact: true });
  assert.equal(await third.getByLabel("Recipe name", { exact: true }).inputValue(), "Recipe 3");
  await catalog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(api.writes, []);
  assert.deepEqual(errors, []);
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
