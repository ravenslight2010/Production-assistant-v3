// End-to-end importer gauntlet over a real HTTP server and throwaway Postgres.
//
// Every V3 import surface in one ordered run: masters CSV, setup-catalog CSV
// (stage/replay/apply/undo terminal state), spec-sheet + premix workbooks with
// provenance, dough-capacity workbooks (formula-backed yields stay unresolved),
// schedule workbooks (per-date apply/undo with revision fences), and combined
// setup reviews that keep source hashes pinned while live state moves on.
//
// The disposable database still holds staff fixtures from the earlier suites, so
// data tables are truncated first (staff/session/bootstrap tables survive) and
// the run stays order-independent. Three dedicated manager fixtures split the
// importer burst so each actor stays inside the real 10-per-minute upload limiter
// budget (same pattern as the setup-manager fixture in http-postgres.integration).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import PG from "pg";
import * as XLSX from "xlsx";
import { startV3Server } from "./main.mjs";
import { buildAllowlistedCutoverBatch } from "../core/cutover-transform.mjs";
import { parseSetupCatalogCsv, setupCatalogCsvTemplates } from "../core/setup-catalog-csv.mjs";

const BOOTSTRAP_CODE = "v3-importer-gauntlet-bootstrap-code"; // >=32 chars, adapter requirement
const PRIMARY_MANAGER_USERNAME = "V3IntegrationManager";
const PRIMARY_MANAGER_PASSWORD = "v3-test-manager-password";
const FIXTURE_MANAGERS = [
  { username: "V3ImporterManagerMasters", password: "v3-importer-masters-password" },
  { username: "V3ImporterManagerWorkbooks", password: "v3-importer-workbooks-password" },
  { username: "V3ImporterManagerSchedules", password: "v3-importer-schedules-password" },
];

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csvRow = (values) => values.map(csvCell).join(",");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const requestLog = [];

function jsonResponse(response) {
  return response.json();
}

function readSetCookie(response) {
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
  return {
    cookieHeader: cookies.join("; "),
    csrfToken: cookies.find((cookie) => cookie.startsWith("v3_csrf="))?.slice("v3_csrf=".length),
  };
}

async function signIn(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/v3/auth/sign-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `sign-in for ${username} -> ${response.status}`);
  return { ...(await jsonResponse(response)), ...readSetCookie(response) };
}

async function sessionFetch(baseUrl, session, method, path, body) {
  const headers = {
    Cookie: session.cookieHeader,
    Origin: baseUrl,
    "Sec-Fetch-Site": "same-origin",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = session.csrfToken;
  const started = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  requestLog.push({ method, path: path.split("?")[0], status: response.status, latencyMs: Date.now() - started });
  return response;
}

// Guarded importer POST: the limiter paths (imports, setup-catalog edits/imports,
// source-workbook preview) count against a 10-per-minute per-actor budget. A 429
// here means the fixture split is wrong, so it fails loudly instead of retrying.
async function importerPost(baseUrl, session, path, body) {
  const response = await sessionFetch(baseUrl, session, "POST", path, body);
  assert.notEqual(response.status, 429, `importer journey exceeded the upload-rate budget at ${path}`);
  return response;
}

async function api(baseUrl, session, method, path, body, expectStatus = null) {
  const response = await sessionFetch(baseUrl, session, method, path, body);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw body for diagnostics */ }
  if (expectStatus !== null) {
    assert.equal(response.status, expectStatus, `${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return { status: response.status, json, text };
}

function workbookBase64(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

async function resetData(adminPool) {
  // Wipe every data table but keep staff/session/bootstrap state so the run is
  // order-independent on a shared disposable database.
  const keep = /^(staff_|account_|password_reset|user_roles|roles$|facility_scope$)/;
  const { rows } = await adminPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'v3' AND table_type = 'BASE TABLE'",
  );
  const tables = rows.map((row) => row.table_name).filter((name) => name && !keep.test(name));
  assert.ok(tables.length > 0, "expected data tables to truncate");
  await adminPool.query(`TRUNCATE TABLE ${tables.map((name) => `v3."${name}"`).join(", ")}`);
  return tables.length;
}

async function phase(name, fn) {
  const detail = await fn();
  console.log(`PASS  ${name}  ${detail}`);
  await sleep(6_500); // keep each fixture inside the sliding upload-limit window
}

async function main() {
  const adminUrl = process.env.V3_TEST_ADMIN_URL;
  const apiUrl = process.env.V3_DATABASE_URL;
  if (!adminUrl || !apiUrl) {
    throw new Error("V3_TEST_ADMIN_URL and V3_DATABASE_URL are required (db/run-local-tests.sh sets both).");
  }
  const adminPool = new PG.Pool({ connectionString: adminUrl });

  const started = await startV3Server({
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "0",
      V3_INITIAL_MANAGER_BOOTSTRAP_CODE: BOOTSTRAP_CODE,
    },
  });
  try {
    const baseUrl = `http://127.0.0.1:${started.server.address().port}`;
    const wiped = await resetData(adminPool);
    console.log(`(truncated ${wiped} data tables; staff/session/bootstrap fixtures preserved)`);

    // ---- P0: auth (bootstrap is closed by the earlier suites; fall back cleanly) --
    let primaryManager;
    await phase("P0 auth", async () => {
      const attempt = await fetch(`${baseUrl}/api/v3/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({
          bootstrapCode: BOOTSTRAP_CODE,
          username: PRIMARY_MANAGER_USERNAME,
          password: PRIMARY_MANAGER_PASSWORD,
        }),
      });
      if (attempt.status === 409) {
        primaryManager = await signIn(baseUrl, PRIMARY_MANAGER_USERNAME, PRIMARY_MANAGER_PASSWORD);
        return "bootstrap closed by earlier suites; signed in as the primary manager";
      }
      assert.equal(attempt.status, 201, `bootstrap -> ${attempt.status}: ${(await attempt.text()).slice(0, 200)}`);
      primaryManager = { ...(await jsonResponse(attempt)), ...readSetCookie(attempt) };
      assert.match(primaryManager.cookieHeader, /v3_session=/);
      const duplicate = await fetch(`${baseUrl}/api/v3/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ bootstrapCode: BOOTSTRAP_CODE, username: "X", password: "Y" }),
      });
      assert.equal(duplicate.status, 409, "second bootstrap must 409");
      return "fresh bootstrap; endpoint locked on retry";
    });

    // Dedicated managers keep each burst inside the upload limiter budget.
    const [managerA, managerB, managerC] = FIXTURE_MANAGERS;
    await phase("P0 importer fixtures", async () => {
      for (const fixture of FIXTURE_MANAGERS) {
        const response = await sessionFetch(baseUrl, primaryManager, "POST", "/api/v3/auth/staff", {
          username: fixture.username,
          password: fixture.password,
          roleName: "manager",
          requestId: `importer-fixture-${fixture.username}`,
        });
        assert.equal(response.status, 201, `create ${fixture.username} -> ${response.status}`);
      }
      const replay = await sessionFetch(baseUrl, primaryManager, "POST", "/api/v3/auth/staff", {
        username: managerA.username,
        password: managerA.password,
        roleName: "manager",
        requestId: `importer-fixture-${managerA.username}`,
      });
      assert.equal(replay.status, 200, `fixture create replay -> ${replay.status}`);
      managerA.session = await signIn(baseUrl, managerA.username, managerA.password);
      managerB.session = await signIn(baseUrl, managerB.username, managerB.password);
      managerC.session = await signIn(baseUrl, managerC.username, managerC.password);
      return "3 fixture managers created (masters / workbooks / schedules); create replay idempotent";
    });

    // ---- P1: masters CSV (products / recipes / production-setups) ----------
    await phase("P1 masters stage+apply", async () => {
      const batch = buildAllowlistedCutoverBatch({
        products: [
          { code: "CORN", name: "Test Flour", unit: "lb" },
          { code: "DOUGH-A", name: "North Shop", unit: "case" },
          { code: "CARTON", name: "Shipping Carton", unit: "each" },
        ],
        recipes: [{
          code: "DOUGH-A-RECIPE", name: "North Shop dough", productCode: "DOUGH-A",
          data: { station_key: "dough", ingredients: [{ product_code: "CORN", quantity: 10, unit: "lb" }] },
        }],
        productionSetups: [{
          code: "LINE-A", name: "North Shop line", productCode: "DOUGH-A",
          data: {
            recipe_codes: ["DOUGH-A-RECIPE"],
            packaging_per_case: [{ product_code: "CARTON", quantity: 1, unit: "each" }],
          },
        }],
        staff: [],
      });
      const csvs = {
        products: ["code,name,unit", ...batch.products.map((p) => csvRow([p.code, p.name, p.unit]))].join("\n") + "\n",
        recipes: ["code,name,product_code,definition_json",
          ...batch.recipes.map((r) => csvRow([r.code, r.name, r.productCode, JSON.stringify(r.data)]))].join("\n") + "\n",
        "production-setups": ["code,name,product_code,config_json",
          ...batch.productionSetups.map((s) => csvRow([s.code, s.name, s.productCode, JSON.stringify(s.data)]))].join("\n") + "\n",
      };
      const counts = {};
      for (const [kind, csv] of Object.entries(csvs)) {
        const requestId = randomUUID();
        const staged = await importerPost(baseUrl, managerA.session, "/api/v3/imports", { requestId, kind, csv });
        assert.equal(staged.status, 201, await staged.clone().text());
        const stagedBody = await jsonResponse(staged);
        assert.equal(stagedBody.outcome, "staged");
        assert.ok(stagedBody.records.length >= 1);
        const importId = stagedBody.importId;
        const replay = await importerPost(baseUrl, managerA.session, "/api/v3/imports", { requestId, kind, csv });
        const replayBody = await jsonResponse(replay);
        assert.equal(replayBody.replayed, true, "same requestId must replay");
        assert.equal(replayBody.importId, importId);
        const applied = await api(baseUrl, managerA.session, "POST", `/api/v3/imports/${importId}/apply`, {}, 200);
        assert.equal(applied.json.outcome, "applied");
        counts[kind] = applied.json.rowCount;
      }
      // Truth check at the storage layer: rows really landed.
      const { rows } = await adminPool.query(
        "SELECT 'product:' || code AS row FROM v3.products "
        + "UNION ALL SELECT kind || ':' || code FROM v3.master_records",
      );
      const landed = rows.map((row) => row.row);
      for (const code of ["CORN", "DOUGH-A", "DOUGH-A-RECIPE", "LINE-A"]) {
        assert.ok(landed.some((row) => row.endsWith(`:${code}`)), `${code} missing from products/master_records`);
      }
      // Documented behavior: the typed capacity editor only lists provenance-carrying
      // records (sourceFamily dough-procedure/shipping-guide) — plain CSV masters are
      // visible to downstream consumers (schedule catalog etc.) but not to that list.
      const editor = await api(baseUrl, managerA.session, "GET", "/api/v3/imports/records?kind=recipes&limit=100", undefined, 200);
      assert.ok(!editor.json.records.some((r) => r.code === "DOUGH-A-RECIPE"),
        "CSV masters must not appear in the provenance-filtered capacity editor list");
      return `3 kinds staged+applied (rows ${JSON.stringify(counts)}), DB-verified; replay idempotent`;
    });

    // ---- P2: setup-catalog CSV (ingredients) --------------------------------
    await phase("P2 setup-catalog CSV", async () => {
      const headers = setupCatalogCsvTemplates.ingredients.headers;
      const csv = [headers, ["FLOUR-IMP-E2E", "Imported Flour", "[]", "[]", "true", "", "true"]]
        .map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
      parseSetupCatalogCsv("ingredients", csv);
      const requestId = randomUUID();
      const staged = await importerPost(baseUrl, managerA.session, "/api/v3/setup-catalog/imports", {
        requestId, family: "ingredients", csv,
      });
      const stagedBody = await jsonResponse(staged);
      assert.equal(staged.status, 201, stagedBody && JSON.stringify(stagedBody).slice(0, 300));
      assert.equal(stagedBody.outcome, "staged");
      const importId = stagedBody.importId;
      assert.ok(/^[0-9a-f-]{36}$/u.test(importId ?? ""), `setup-catalog importId? ${JSON.stringify(stagedBody).slice(0, 200)}`);
      const replay = await importerPost(baseUrl, managerA.session, "/api/v3/setup-catalog/imports", {
        requestId, family: "ingredients", csv,
      });
      assert.equal((await jsonResponse(replay)).replayed, true);
      const applied = await api(baseUrl, managerA.session, "POST", `/api/v3/setup-catalog/imports/${importId}/apply`, {}, 200);
      assert.equal(applied.json.outcome, "applied");
      const applyReplay = await api(baseUrl, managerA.session, "POST", `/api/v3/setup-catalog/imports/${importId}/apply`, {}, 200);
      assert.equal(applyReplay.json.replayed, true, "apply retry must replay");
      const records = await api(baseUrl, managerA.session, "GET", "/api/v3/setup-catalog/records?family=ingredients&limit=100", undefined, 200);
      assert.ok(records.json.records.some((r) => r.code === "FLOUR-IMP-E2E"), "record live after apply");
      const undone = await api(baseUrl, managerA.session, "POST", `/api/v3/setup-catalog/imports/${importId}/undo`, {}, 200);
      assert.equal(undone.json.outcome, "undone");
      const afterUndo = await api(baseUrl, managerA.session, "GET", "/api/v3/setup-catalog/records?family=ingredients&limit=100", undefined, 200);
      assert.ok(!afterUndo.json.records.some((r) => r.code === "FLOUR-IMP-E2E"), "undo must remove the record");
      const reapply = await api(baseUrl, managerA.session, "POST", `/api/v3/setup-catalog/imports/${importId}/apply`, {});
      assert.equal(reapply.status, 409, `re-apply after undo must 409 (terminal state), got ${reapply.status}`);
      return "stage→apply→replays→undo→verify-empty; re-apply 409 by design (staged→applied→undone terminal)";
    });

    // ---- P3: source workbook (spec-sheets → run-templates) ------------------
    let templateCode;
    let templateSha;
    await phase("P3 spec-sheet workbook", async () => {
      const rows = [
        ["Brand", "Flavor", "Dough Recipe", "Sauce oz/pizza", "Applicator 1 Type", "Applicator 1 oz/pizza", "Applicator 1 Recipe", "Pepperoni 1 Type", "Pepperoni 1 Sticks"],
        ["ImpE2E", "Classic", "House Dough", 3.5, "Cheese", 2, "Cheddar Blend", "Cup", 4],
      ];
      const preview = await importerPost(baseUrl, managerB.session, "/api/v3/setup-catalog/imports/workbooks/preview", {
        family: "spec-sheets", fileName: "imp-e2e-profiles.xlsx",
        workbookBase64: workbookBase64([["Profiles", rows]]),
      });
      assert.equal(preview.status, 200, await preview.clone().text());
      const review = await jsonResponse(preview);
      assert.equal(review.targetFamily, "run-templates");
      assert.equal(review.records.length, 1);
      const candidate = review.records[0];
      const record = candidate.record;
      templateCode = record.code;
      templateSha = review.fileSha256;
      const headers = setupCatalogCsvTemplates["run-templates"].headers;
      const csv = [headers, [record.code, record.name, record.data.brand, record.data.flavor, JSON.stringify(record.data.values ?? {})]]
        .map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
      parseSetupCatalogCsv("run-templates", csv);
      const sourceSummary = {
        sourceFamily: review.family,
        sourceSha256: review.fileSha256,
        parserVersion: review.parserVersion,
        sourceRows: review.sourceRows,
        importedRows: 1,
        skippedRows: typeof review.skippedRows === "number" ? review.skippedRows : 0,
        unresolvedRows: Array.isArray(review.unresolvedRows) ? review.unresolvedRows.length : 0,
      };
      const staged = await importerPost(baseUrl, managerB.session, "/api/v3/setup-catalog/imports", {
        requestId: randomUUID(), family: "run-templates", csv,
        sourceSummary,
        sourceRecords: [{
          code: record.code,
          source: { workbook: "imp-e2e-profiles.xlsx", cell: candidate.source },
          sourceDetails: candidate.sourceDetails ?? null,
        }],
      });
      assert.equal(staged.status, 201, await staged.clone().text());
      const stagedBody = await jsonResponse(staged);
      assert.equal(stagedBody.outcome, "staged");
      const specId = stagedBody.importId;
      const applied = await api(baseUrl, managerB.session, "POST", `/api/v3/setup-catalog/imports/${specId}/apply`, {}, 200);
      assert.equal(applied.json.outcome, "applied");
      const records = await api(baseUrl, managerB.session, "GET", "/api/v3/setup-catalog/records?family=run-templates&limit=100", undefined, 200);
      assert.ok(records.json.records.some((r) => r.code === templateCode));
      return `preview→stage→apply; ${templateCode} live (sha ${templateSha.slice(0, 12)}…); import ${specId.slice(0, 8)}`;
    });

    // ---- P4: dough capacity workbook (formula vs literal yield) -------------
    await phase("P4 dough capacity workbook", async () => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
        ["North Shop", 7.7, 310.5, "", 84],
        ["North Shop", 7.7, 310.5, 645.19, 84],
      ]);
      sheet.D2 = { t: "n", f: "600+45.19", v: 645.19 }; // formula-backed yield
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Procedure");
      const staged = await importerPost(baseUrl, managerB.session, "/api/v3/imports/workbooks", {
        requestId: randomUUID(), family: "dough-procedure", fileName: "imp-e2e-procedure.xlsx",
        workbookBase64: XLSX.write(workbook, { type: "base64", bookType: "xlsx" }),
      });
      assert.equal(staged.status, 201, await staged.clone().text());
      const detail = await jsonResponse(staged);
      assert.equal(detail.linkedCount, 2);
      const [formulaRow, literalRow] = detail.records;
      assert.equal(formulaRow.name, "North Shop");
      assert.equal(formulaRow.data.source.yieldIsFormula, true, "formula-backed row must carry formula evidence");
      assert.equal(formulaRow.data.source.displayedYield, null);
      assert.equal(formulaRow.data.doughballYield, null, "formula yield must be withheld (unresolved)");
      assert.equal(literalRow.name, "North Shop");
      assert.ok(Math.abs(literalRow.data.doughballYield - 645.19) < 1e-6);
      assert.equal(detail.invalidValueCount, 1, "exactly the formula row is unresolved");
      assert.match(detail.fileSha256, /^[0-9a-f]{64}$/);
      const importId = detail.importId ?? detail.import?.importId;
      assert.ok(/^[0-9a-f-]{36}$/u.test(importId ?? ""), `importId? keys=${JSON.stringify(Object.keys(detail))}`);
      return `staged ${importId.slice(0, 8)}…; formula row unresolved + literal row resolved`;
    });

    // ---- P5: schedule workbook import (stage → per-date apply → undo) -------
    await phase("P5 schedule import lifecycle", async () => {
      const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000 + 25_569;
      const rows = [
        ["Monday - Day", serial(2026, 12, 7), "Brand", "Flavor", "Units", "Customer", "Ship", "PO"],
        ["", "", "North Shop", "Cheese", 20, "Cafe", "Dec 8", "PO-1"],
        ["", "", "North Shop", "Pep", 5, "", "", "PO-2"],
        ["Tuesday - Day", serial(2026, 12, 8), "Brand", "Flavor", "Units", "Customer", "Ship", "PO"],
        ["", "", "North Shop", "Cheese", 12, "", "", "PO-3"],
        ["Previous - Day", serial(2026, 11, 20), "Brand", "Flavor", "Units", "Customer"],
        ["", "", "Old", "Gone", 9, ""],
      ];
      const preview = await api(baseUrl, managerC.session, "POST", "/api/v3/schedules/import-preview", {
        fileName: "imp-e2e-plan.xlsx", workbookBase64: workbookBase64([["Plan", rows]]),
      }, 200);
      const p = preview.json.preview;
      assert.equal(p.multiDay, true);
      assert.equal(p.rows.length, 3, `expected 3 importable rows, got ${p.rows.length}: ${preview.text.slice(0, 400)}`);
      assert.ok(p.skipped.some((s) => /Past/iu.test(s.reason)), "past-day row must skip with Past reason");
      assert.deepEqual([...new Set(p.rows.map((r) => r.date))].sort(), ["2026-12-07", "2026-12-08"]);

      const catalog = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules/catalog", undefined, 200)).json;
      const product = catalog.products.find((item) => item.code === "DOUGH-A");
      assert.ok(product, "CSV-imported product must be in the schedule catalog");
      assert.ok(product.productionSetups.some((s) => s.code === "LINE-A"));
      assert.ok(catalog.templates.some((t) => t.code === templateCode), "spec-sheet template must be in catalog");

      const importId = randomUUID();
      const runs = p.rows.map((row) => ({
        id: randomUUID(), date: row.date, productCode: "DOUGH-A", productionSetupCode: "LINE-A",
        runTemplateCode: templateCode, targetCases: row.targetCases, notes: row.notes ?? "",
        source: { workbook: "imp-e2e-plan.xlsx", sheet: row.sheet, row: row.sourceRow, cells: row.sourceCells },
      }));
      const stageRequest = { importId, requestId: randomUUID(), source: p.source, runs };
      const staged = await api(baseUrl, managerC.session, "POST", "/api/v3/schedules/imports", stageRequest, 200);
      assert.equal(staged.json.outcome, "staged");
      assert.equal(staged.json.import.dates.filter((d) => d.status === "staged").length, 2);
      const stageReplay = await api(baseUrl, managerC.session, "POST", "/api/v3/schedules/imports", stageRequest, 200);
      assert.equal(stageReplay.json.replayed, true, "schedule stage replay must confirm");

      const monday = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules?date=2026-12-07", undefined, 200)).json.schedule;
      const applyMon = await api(baseUrl, managerC.session, "POST", `/api/v3/schedules/imports/${importId}/apply`, {
        requestId: randomUUID(), date: "2026-12-07", expectedRevision: monday.revision,
      }, 200);
      assert.equal(applyMon.json.outcome, "accepted");
      assert.equal(applyMon.json.import.dates.find((d) => d.productionDate === "2026-12-07").status, "applied");
      assert.equal(applyMon.json.import.dates.find((d) => d.productionDate === "2026-12-08").status, "staged");

      const stale = await api(baseUrl, managerC.session, "POST", `/api/v3/schedules/imports/${importId}/undo`, {
        requestId: randomUUID(), date: "2026-12-07", expectedRevision: monday.revision,
      });
      assert.equal(stale.status, 409, `stale undo must 409, got ${stale.status}: ${stale.text.slice(0, 160)}`);

      const fresh = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules?date=2026-12-07", undefined, 200)).json.schedule;
      const undo = await api(baseUrl, managerC.session, "POST", `/api/v3/schedules/imports/${importId}/undo`, {
        requestId: randomUUID(), date: "2026-12-07", expectedRevision: fresh.revision,
      }, 200);
      assert.equal(undo.json.outcome, "accepted");
      assert.equal(undo.json.import.dates.find((d) => d.productionDate === "2026-12-07").status, "undone");
      const afterUndo = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules?date=2026-12-07", undefined, 200)).json.schedule;
      assert.equal(afterUndo.runs.length, 0, "undo must remove the created runs");

      const tue = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules?date=2026-12-08", undefined, 200)).json.schedule;
      const applyTue = await api(baseUrl, managerC.session, "POST", `/api/v3/schedules/imports/${importId}/apply`, {
        requestId: randomUUID(), date: "2026-12-08", expectedRevision: tue.revision,
      }, 200);
      assert.equal(applyTue.json.outcome, "accepted");
      const tueNow = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules?date=2026-12-08", undefined, 200)).json.schedule;
      assert.equal(tueNow.runs.length, 1);
      assert.equal(tueNow.revision, tue.revision + 1, "apply must advance schedule revision by 1");
      // Leave no residue for a rerun: undo Tuesday as final teardown.
      const undoTue = await api(baseUrl, managerC.session, "POST", `/api/v3/schedules/imports/${importId}/undo`, {
        requestId: randomUUID(), date: "2026-12-08", expectedRevision: tueNow.revision,
      }, 200);
      assert.equal(undoTue.json.outcome, "accepted");
      const tueClean = (await api(baseUrl, managerC.session, "GET", "/api/v3/schedules?date=2026-12-08", undefined, 200)).json.schedule;
      assert.equal(tueClean.runs.length, 0, "teardown must leave Tuesday empty");
      return "preview→stage→replay→apply Mon→stale-undo 409→undo→apply Tue (+revision bump)→teardown undo";
    });

    // ---- P6: combined review pins source hashes -----------------------------
    await phase("P6 combined review hash pinning", async () => {
      // Second source import so the review genuinely combines two workbooks.
      const premixPreview = await importerPost(baseUrl, managerC.session, "/api/v3/setup-catalog/imports/workbooks/preview", {
        family: "premix-sheets", fileName: "imp-e2e-premix.xlsx",
        workbookBase64: workbookBase64([["Mixes", [
          ["Mix Alpha", "", "", ""],
          ["", "Per Pizza", "Per Batch"],
          ["Flour", 0.5, 10],
          ["Total", 0.5, 10],
        ]]]),
      });
      assert.equal(premixPreview.status, 200, await premixPreview.clone().text());
      const pm = await jsonResponse(premixPreview);
      assert.equal(pm.targetFamily, "mixes");
      assert.equal(pm.records.length, 1);
      const pmRecord = pm.records[0].record;
      const mixData = { ...pmRecord.data, isPrep: pmRecord.data.isPrep === true, enabled: pmRecord.data.enabled === true };
      const mixHeaders = setupCatalogCsvTemplates.mixes.headers;
      const mixCsv = [mixHeaders, [pmRecord.code, pmRecord.name, mixData.brand, mixData.flavor,
        mixData.batchSizeLbs, mixData.daysEarly, mixData.notes, mixData.isPrep,
        mixData.enabled, JSON.stringify(mixData.components ?? [])]]
        .map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
      parseSetupCatalogCsv("mixes", mixCsv);
      const mixStaged = await importerPost(baseUrl, managerC.session, "/api/v3/setup-catalog/imports", {
        requestId: randomUUID(), family: "mixes", csv: mixCsv,
        sourceSummary: {
          sourceFamily: pm.family, sourceSha256: pm.fileSha256, parserVersion: pm.parserVersion,
          sourceRows: pm.sourceRows, importedRows: 1,
          skippedRows: typeof pm.skippedRows === "number" ? pm.skippedRows : 0,
          unresolvedRows: Array.isArray(pm.unresolvedRows) ? pm.unresolvedRows.length : 0,
        },
        sourceRecords: [{
          code: pmRecord.code,
          source: { workbook: "imp-e2e-premix.xlsx", cell: pm.records[0].source },
          sourceDetails: pm.records[0].sourceDetails ?? null,
        }],
      });
      assert.equal(mixStaged.status, 201, await mixStaged.clone().text());
      const mixImportId = (await jsonResponse(mixStaged)).importId;
      const mixApplied = await api(baseUrl, managerC.session, "POST", `/api/v3/setup-catalog/imports/${mixImportId}/apply`, {}, 200);
      assert.equal(mixApplied.json.outcome, "applied");

      const specImports = await api(baseUrl, managerC.session, "GET", "/api/v3/setup-catalog/imports?limit=100", undefined, 200);
      const specImport = specImports.json.imports.find((item) =>
        item.sourceSummary?.sourceSha256 === templateSha);
      assert.ok(specImport, "must find the P3 spec import by its source sha");
      assert.equal(typeof specImport.id, "string");

      const created = await api(baseUrl, managerC.session, "POST", "/api/v3/setup-catalog/combined-reviews", {
        requestId: randomUUID(), importIds: [specImport.id, mixImportId],
      }, 201);
      const reviewId = created.json.id;
      const fetched = await api(baseUrl, managerC.session, "GET", `/api/v3/setup-catalog/combined-reviews/${reviewId}`, undefined, 200);
      const pins = fetched.json.imports.map((item) => `${item.importId.slice(0, 8)}:${item.sourceSummary.sourceSha256.slice(0, 12)}`);
      assert.equal(fetched.json.imports.length, 2);
      assert.ok(pins.every((pin) => /^[0-9a-f-]{8}:[0-9a-f]{12}$/u.test(pin)), `pin shape: ${JSON.stringify(pins)}`);

      // Mutate underlying state: new import for the SAME template code with different values.
      const headers = setupCatalogCsvTemplates["run-templates"].headers;
      const csv = [headers, [templateCode, "Changed Name", "ImpE2E", "Classic", JSON.stringify({ sauceOzPerPizza: 9 })]]
        .map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
      const staged = await importerPost(baseUrl, managerC.session, "/api/v3/setup-catalog/imports", {
        requestId: randomUUID(), family: "run-templates", csv,
      });
      assert.equal(staged.status, 201, await staged.clone().text());
      await api(baseUrl, managerC.session, "POST", `/api/v3/setup-catalog/imports/${(await jsonResponse(staged)).importId}/apply`, {}, 200);

      const refetched = await api(baseUrl, managerC.session, "GET", `/api/v3/setup-catalog/combined-reviews/${reviewId}`, undefined, 200);
      const pinsAfter = refetched.json.imports.map((item) => `${item.importId.slice(0, 8)}:${item.sourceSummary.sourceSha256.slice(0, 12)}`);
      assert.deepEqual(pinsAfter, pins, "review must keep its ORIGINAL pinned hashes after later applies");
      // The projection exposes live state per-field in `entries` (currentValue) —
      // currentRecords is an internal input, not part of the wire shape.
      assert.ok(Array.isArray(refetched.json.entries), `entries: ${JSON.stringify(Object.keys(refetched.json))}`);
      const nameEntry = refetched.json.entries.find((entry) => entry.targetFamily === "run-templates"
        && entry.code === templateCode && entry.field === "name");
      assert.equal(nameEntry?.currentValue, "Changed Name", "entries.currentValue tracks the live record (new apply visible)");
      const sauceEntry = refetched.json.entries.find((entry) => entry.targetFamily === "run-templates"
        && entry.code === templateCode && entry.field === "values.sauceOzPerPizza");
      assert.equal(sauceEntry?.currentValue, 9, "live values visible in entries");
      assert.equal(nameEntry?.disposition, "mismatch", "original pinned name vs changed live name = mismatch");
      return `2-import review pinned (${pins.join(" | ")}); pins frozen while entries track live state`;
    });

    const latencies = requestLog.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const errors = requestLog.filter((r) => r.status >= 400 && r.status !== 409).length;
    console.log(`\nImporter gauntlet passed: ${requestLog.length} HTTP calls, ` +
      `p50 ${p50}ms p95 ${p95}ms, non-409 4xx/5xx: ${errors}`);
  } finally {
    await started.close();
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error("Importer gauntlet failed:", error);
  process.exit(1);
});
