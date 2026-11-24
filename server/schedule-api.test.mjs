import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as XLSX from "xlsx";
import { applyScheduleCommand, emptySchedule } from "../core/schedule-planning.mjs";
import { createScheduleApi } from "./schedule-api.mjs";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const RUN_A = "00000000-0000-4000-8000-000000000003";
const RUN_B = "00000000-0000-4000-8000-000000000004";
const RUN_C = "00000000-0000-4000-8000-000000000005";
const AUTH = { verified: true, facilityId: FACILITY_ID, actorId: ACTOR_ID, capabilities: ["manage-factory-settings"] };
const RUN = {
  id: RUN_A,
  productCode: "PRODUCT",
  productionSetupCode: "SETUP",
  runTemplateCode: "TEMPLATE",
  targetCases: 20,
  notes: "",
};
const CATALOG = {
  products: [{ code: "PRODUCT", name: "Product", productionSetups: [{ code: "SETUP", name: "Setup" }] }],
  templates: [{ code: "TEMPLATE", name: "Template", brand: "Brand", flavor: "Flavor", values: {} }],
  productionStartTime: "06:00",
  timeZone: "America/Chicago",
};
const SUBSTITUTE_PRODUCTS = [{
  productId: "00000000-0000-4000-8000-000000000006",
  productCode: "FLOUR-B",
  productName: "Flour B",
  baseUnit: "lb",
}];

async function withApi(t, { auth = AUTH, csrf = true, substitutionError = null } = {}) {
  const calls = [];
  let schedule = emptySchedule("2026-11-18");
  const receipts = new Map();
  const substitutionReceipts = new Map();
  const imports = new Map();
  const importReceipts = new Map();
  const pool = {
    async query(config) {
      assert.equal(config.query_timeout, 5_000);
      calls.push(config.text);
      if (config.text.includes("list_run_products")) return { rows: [{ result: { products: CATALOG.products } }] };
      if (config.text.includes("list_schedule_run_templates")) return { rows: [{ result: CATALOG.templates }] };
      if (config.text.includes("schedule_default_start_time")) return { rows: [{ result: "06:00" }] };
      if (config.text.includes("get_substitution_overlay")) {
        if (substitutionError) throw substitutionError;
        const date = config.values[1];
        return { rows: [{ result: date === schedule.date
          ? schedule.substitutionOverlay
          : emptySchedule(date).substitutionOverlay }] };
      }
      if (config.text.includes("list_substitution_products")) {
        if (substitutionError) throw substitutionError;
        return { rows: [{ result: SUBSTITUTE_PRODUCTS }] };
      }
      if (config.text.includes("apply_substitution_command")) {
        if (substitutionError) throw substitutionError;
        const [facility, actor, date, requestId, requestHash, expectedRevision, jsonCommand] = config.values;
        assert.equal(facility, FACILITY_ID);
        assert.equal(actor, ACTOR_ID);
        const current = date === schedule.date ? schedule.substitutionOverlay : emptySchedule(date).substitutionOverlay;
        const previous = substitutionReceipts.get(requestId);
        if (previous) {
          assert.equal(previous.hash, requestHash);
          return { rows: [{ result: { ...previous.response, replayed: true } }] };
        }
        if (Number(expectedRevision) !== current.revision) {
          return { rows: [{ result: { outcome: "conflict", replayed: false, expectedRevision: Number(expectedRevision), currentOverlay: current } }] };
        }
        const command = JSON.parse(jsonCommand);
        let rules = [...current.rules];
        if (command.type === "clear") rules = [];
        if (command.type === "remove") rules = rules.filter((rule) => rule.id !== command.ruleId);
        if (command.type === "upsert") {
          const product = SUBSTITUTE_PRODUCTS.find((item) => item.productId === command.rule.substituteProductId);
          const rule = {
            id: command.rule.id ?? RUN_C,
            ingredient: command.rule.ingredient,
            action: command.rule.action,
            ...(command.rule.action === "remove" ? {} : {
              substituteProductId: product.productId,
              substituteProductCode: product.productCode,
              substituteProductName: product.productName,
              ...(command.rule.quantity === null ? {} : { quantity: command.rule.quantity }),
            }),
          };
          rules = [...rules.filter((item) => item.id !== rule.id), rule];
        }
        const overlay = {
          productionDate: date,
          revision: current.revision + 1,
          rules,
          updatedAt: "2026-11-18T12:00:00.000Z",
        };
        if (date === schedule.date) schedule = { ...schedule, substitutionOverlay: overlay };
        const response = { outcome: "accepted", replayed: false, commandId: requestId, overlay };
        substitutionReceipts.set(requestId, { hash: requestHash, response });
        return { rows: [{ result: response }] };
      }
      if (config.text.includes("stage_schedule_import")) {
        const [, , importId, requestId, requestHash, sourceJson, runsJson] = config.values;
        const previous = importReceipts.get(requestId);
        if (previous) {
          assert.equal(previous.hash, requestHash);
          return { rows: [{ result: { outcome: "staged", replayed: true, import: imports.get(importId) } }] };
        }
        const runs = JSON.parse(runsJson);
        const dates = [...new Set(runs.map((run) => run.date))].sort().map((productionDate) => ({
          productionDate, status: "staged", createdRunCount: 0, updatedRunCount: 0,
          appliedAt: null, undoneAt: null, undoAvailable: false,
        }));
        const detail = {
          importId, createdAt: "2026-11-18T12:00:00.000Z", source: JSON.parse(sourceJson),
          rowCount: runs.length, dates, runs,
        };
        imports.set(importId, detail);
        importReceipts.set(requestId, { hash: requestHash, action: "stage" });
        return { rows: [{ result: { outcome: "staged", replayed: false, import: detail } }] };
      }
      if (config.text.includes("list_schedule_imports")) {
        return { rows: [{ result: { imports: [...imports.values()].map(({ runs, ...summary }) => summary) } }] };
      }
      if (config.text.includes("get_schedule_import")) {
        return { rows: [{ result: { import: imports.get(config.values[1]) } }] };
      }
      if (config.text.includes("apply_schedule_import") || config.text.includes("undo_schedule_import")) {
        const action = config.text.includes("apply_schedule_import") ? "apply" : "undo";
        const [, , importId, date, requestId, requestHash, expectedRevision] = config.values;
        const previous = importReceipts.get(requestId);
        if (previous) {
          assert.equal(previous.hash, requestHash);
          assert.equal(previous.action, action);
          return { rows: [{ result: { ...previous.response, replayed: true, schedule, import: imports.get(importId) } }] };
        }
        const detail = imports.get(importId);
        if (Number(expectedRevision) !== schedule.revision) {
          return { rows: [{ result: { outcome: "conflict", reason: "stale-schedule", replayed: false, productionDate: date, schedule, import: detail } }] };
        }
        const dateState = detail.dates.find((item) => item.productionDate === date);
        const rows = detail.runs.filter((run) => run.date === date);
        if (action === "apply") {
          const beforeIds = new Set(schedule.runs.map((run) => run.id));
          schedule = {
            ...applyScheduleCommand(schedule, { type: "merge-import", runs: rows.map(({ date: _date, source: _source, ...run }) => run) }),
            revision: schedule.revision + 1,
          };
          dateState.status = "applied";
          dateState.createdRunCount = rows.filter((run) => !beforeIds.has(run.id)).length;
          dateState.updatedRunCount = rows.length - dateState.createdRunCount;
          dateState.undoAvailable = dateState.createdRunCount > 0;
          detail.createdRuns = rows.map(({ date: _date, source: _source, ...run }) => run);
        } else {
          schedule = { ...schedule, revision: schedule.revision + 1, runs: schedule.runs.filter((run) => !detail.createdRuns.some((created) => created.id === run.id)) };
          dateState.status = "undone";
          dateState.undoAvailable = false;
        }
        const response = {
          outcome: "accepted", replayed: false, productionDate: date, schedule, import: detail,
          createdRunCount: dateState.createdRunCount, updatedRunCount: dateState.updatedRunCount,
        };
        importReceipts.set(requestId, { hash: requestHash, action, response });
        return { rows: [{ result: response }] };
      }
      if (config.text.includes("get_production_schedule")) {
        const date = config.values[1];
        if (date !== schedule.date) schedule = emptySchedule(date);
        return { rows: [{ result: schedule }] };
      }
      if (config.text.includes("apply_production_schedule_command")) {
        const [facility, actor, date, requestId, requestHash, expectedRevision, jsonCommand] = config.values;
        assert.equal(facility, FACILITY_ID);
        assert.equal(actor, ACTOR_ID);
        assert.equal(date, schedule.date);
        const previous = receipts.get(requestId);
        if (previous) {
          if (previous.hash !== requestHash) {
            const error = new Error("request id reused");
            error.code = "22023";
            throw error;
          }
          return { rows: [{ result: { ...previous.response, replayed: true, schedule } }] };
        }
        if (Number(expectedRevision) !== schedule.revision) {
          return { rows: [{ result: { outcome: "conflict", replayed: false, schedule } }] };
        }
        const command = JSON.parse(jsonCommand);
        const next = applyScheduleCommand(schedule, command);
        schedule = { ...next, revision: schedule.revision + 1, updatedAt: "2026-11-18T12:00:00.000Z" };
        const response = { outcome: "accepted", replayed: false, schedule };
        receipts.set(requestId, { hash: requestHash, response: { outcome: "accepted" } });
        return { rows: [{ result: response }] };
      }
      throw new Error(`Unexpected database query: ${config.text}`);
    },
  };
  const handler = createScheduleApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger: () => {},
  });
  const server = createServer(async (request, response) => {
    await handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

function send(baseUrl, path, { method = "GET", body, csrf = true } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(csrf ? { "x-csrf-token": "ok" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("schedule catalog and date reads require a manager and return scoped server state", async (t) => {
  const fixture = await withApi(t);
  const catalogResponse = await send(fixture.baseUrl, "/api/v3/schedules/catalog");
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await catalogResponse.json(), CATALOG);

  const dateResponse = await send(fixture.baseUrl, "/api/v3/schedules?date=2026-11-18");
  assert.equal(dateResponse.status, 200);
  assert.equal((await dateResponse.json()).schedule.timeZone, "America/Chicago");

  const denied = await withApi(t, { auth: { ...AUTH, capabilities: [] } });
  const forbidden = await send(denied.baseUrl, "/api/v3/schedules?date=2026-11-18");
  assert.equal(forbidden.status, 403);
  assert.equal(denied.calls.length, 0);
});

test("schedule commands are revision-fenced and exact retries do not duplicate runs", async (t) => {
  const { baseUrl } = await withApi(t);
  const firstRequest = {
    requestId: "00000000-0000-4000-8000-000000000011",
    date: "2026-11-18",
    expectedRevision: 0,
    command: { type: "add", run: RUN },
  };
  const first = await send(baseUrl, "/api/v3/schedules/commands", { method: "POST", body: firstRequest });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).schedule.revision, 1);
  const retry = await send(baseUrl, "/api/v3/schedules/commands", { method: "POST", body: firstRequest });
  assert.equal(retry.status, 200);
  const replay = await retry.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.schedule.runs.length, 1);

  const second = await send(baseUrl, "/api/v3/schedules/commands", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000012",
      date: "2026-11-18",
      expectedRevision: 1,
      command: { type: "add", run: { ...RUN, id: RUN_B, targetCases: 5 } },
    },
  });
  assert.equal(second.status, 200);
  const stale = await send(baseUrl, "/api/v3/schedules/commands", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000013",
      date: "2026-11-18",
      expectedRevision: 1,
      command: { type: "add", run: { ...RUN, id: RUN_C, targetCases: 4 } },
    },
  });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.schedule.revision, 2);
  assert.deepEqual(conflict.schedule.runs.map((run) => run.id), [RUN_A, RUN_B]);
});

test("schedule workbook preview is manager-only, CSRF-protected, and never applies data", async (t) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Brand", "Flavor", 12, "PO 123"],
  ]), "Plan");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const fixture = await withApi(t);
  const denied = await send(fixture.baseUrl, "/api/v3/schedules/import-preview", {
    method: "POST",
    body: { fileName: "plan.xlsx", workbookBase64: bytes.toString("base64") },
    csrf: false,
  });
  assert.equal(denied.status, 403);
  assert.equal(fixture.calls.length, 0);

  const preview = await send(fixture.baseUrl, "/api/v3/schedules/import-preview", {
    method: "POST",
    body: { fileName: "plan.xlsx", workbookBase64: bytes.toString("base64") },
  });
  assert.equal(preview.status, 200);
  const result = await preview.json();
  assert.equal(result.preview.rows.length, 1);
  assert.match(result.preview.rows[0].importRunId, /^[0-9a-f-]{36}$/u);
  assert.equal(result.preview.rows[0].date, null);
  assert.equal(result.preview.source.parserVersion, "v1-schedule-import/1");
  assert.match(result.preview.source.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.preview.source.fileName, "plan.xlsx");
  assert.equal(fixture.calls.length, 0);

  const updatedWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(updatedWorkbook, XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Brand", "Flavor", 13, "PO 124"],
  ]), "Plan");
  const updatedBytes = XLSX.write(updatedWorkbook, { type: "buffer", bookType: "xlsx" });
  const updated = await send(fixture.baseUrl, "/api/v3/schedules/import-preview", {
    method: "POST",
    body: { fileName: "plan.xlsx", workbookBase64: updatedBytes.toString("base64") },
  });
  const updatedPreview = await updated.json();
  assert.equal(updatedPreview.preview.rows[0].targetCases, 13);
  assert.equal(updatedPreview.preview.rows[0].importRunId, result.preview.rows[0].importRunId);
  assert.notEqual(updatedPreview.preview.source.sha256, result.preview.source.sha256);
  assert.equal(fixture.calls.length, 0);
});


test("canonical schedule imports stage, reopen, apply, and undo with exact retries", async (t) => {
  const fixture = await withApi(t);
  const importId = "00000000-0000-4000-8000-000000000041";
  const requestId = "00000000-0000-4000-8000-000000000042";
  const source = { fileName: "plan.xlsx", sha256: "a".repeat(64), parserVersion: "v1-schedule-import/1" };
  const runs = [{
    ...RUN, date: "2026-11-18",
    source: { workbook: "plan.xlsx", sheet: "Plan", row: 2, cells: { brand: "A2", flavor: "B2", targetCases: "C2" } },
  }];
  const stageRequest = { importId, requestId, source, runs };
  const denied = await send(fixture.baseUrl, "/api/v3/schedules/imports", { method: "POST", body: stageRequest, csrf: false });
  assert.equal(denied.status, 403);
  const staged = await send(fixture.baseUrl, "/api/v3/schedules/imports", { method: "POST", body: stageRequest });
  assert.equal(staged.status, 200, await staged.clone().text());
  const stagedBody = await staged.json();
  assert.equal(stagedBody.import.source.sha256, source.sha256);
  assert.equal(stagedBody.import.dates[0].status, "staged");
  assert.equal(scheduleRevision(stagedBody), undefined);
  const stageRetry = await send(fixture.baseUrl, "/api/v3/schedules/imports", { method: "POST", body: stageRequest });
  assert.equal((await stageRetry.json()).replayed, true);
  const history = await send(fixture.baseUrl, "/api/v3/schedules/imports?limit=50");
  assert.equal((await history.json()).imports.length, 1);
  const reopened = await send(fixture.baseUrl, `/api/v3/schedules/imports/${importId}`);
  assert.equal((await reopened.json()).import.runs[0].source.cells.targetCases, "C2");

  const applyRequest = { requestId: "00000000-0000-4000-8000-000000000043", date: "2026-11-18", expectedRevision: 0 };
  const applied = await send(fixture.baseUrl, `/api/v3/schedules/imports/${importId}/apply`, { method: "POST", body: applyRequest });
  assert.equal(applied.status, 200, await applied.clone().text());
  const appliedBody = await applied.json();
  assert.equal(appliedBody.schedule.revision, 1);
  assert.equal(appliedBody.import.dates[0].status, "applied");
  const applyRetry = await send(fixture.baseUrl, `/api/v3/schedules/imports/${importId}/apply`, { method: "POST", body: applyRequest });
  assert.equal((await applyRetry.json()).replayed, true);

  const undoRequest = { requestId: "00000000-0000-4000-8000-000000000044", date: "2026-11-18", expectedRevision: 1 };
  const undone = await send(fixture.baseUrl, `/api/v3/schedules/imports/${importId}/undo`, { method: "POST", body: undoRequest });
  assert.equal(undone.status, 200, await undone.clone().text());
  assert.equal((await undone.json()).import.dates[0].status, "undone");
  const undoRetry = await send(fixture.baseUrl, `/api/v3/schedules/imports/${importId}/undo`, { method: "POST", body: undoRequest });
  assert.equal((await undoRetry.json()).replayed, true);
});

function scheduleRevision(value) {
  return value.schedule?.revision;
}

test("substitution reads and commands are dated, replayable, revision-fenced, and clearable", async (t) => {
  const { baseUrl } = await withApi(t);
  const empty = await send(baseUrl, "/api/v3/schedules/substitutions?date=2026-11-18");
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).overlay.rules, []);
  const products = await send(baseUrl, "/api/v3/schedules/substitution-products");
  assert.equal(products.status, 200);
  assert.deepEqual((await products.json()).products, SUBSTITUTE_PRODUCTS);

  const request = {
    requestId: "00000000-0000-4000-8000-000000000031",
    date: "2026-11-18",
    expectedRevision: 0,
    command: {
      type: "upsert",
      rule: {
        id: null,
        ingredient: " Flour ",
        action: "swap",
        substituteProductId: SUBSTITUTE_PRODUCTS[0].productId,
        quantity: null,
      },
    },
  };
  const accepted = await send(baseUrl, "/api/v3/schedules/substitutions/commands", { method: "POST", body: request });
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.overlay.revision, 1);
  assert.equal(acceptedBody.overlay.rules[0].ingredient, "Flour");
  assert.equal(acceptedBody.overlay.rules[0].substituteProductCode, "FLOUR-B");
  const retry = await send(baseUrl, "/api/v3/schedules/substitutions/commands", { method: "POST", body: request });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).replayed, true);

  const stale = await send(baseUrl, "/api/v3/schedules/substitutions/commands", {
    method: "POST",
    body: { ...request, requestId: "00000000-0000-4000-8000-000000000032" },
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentOverlay.revision, 1);

  const cleared = await send(baseUrl, "/api/v3/schedules/substitutions/commands", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000033",
      date: "2026-11-18",
      expectedRevision: 1,
      command: { type: "clear" },
    },
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).overlay.rules, []);
});

test("substitution mutations require manager permission and CSRF; storage errors stay safe", async (t) => {
  const deniedManager = await withApi(t, { auth: { ...AUTH, capabilities: [] } });
  const managerResponse = await send(deniedManager.baseUrl, "/api/v3/schedules/substitution-products");
  assert.equal(managerResponse.status, 403);
  assert.equal(deniedManager.calls.length, 0);

  const deniedCsrf = await withApi(t, { csrf: false });
  const csrfResponse = await send(deniedCsrf.baseUrl, "/api/v3/schedules/substitutions/commands", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000034",
      date: "2026-11-18",
      expectedRevision: 0,
      command: { type: "clear" },
    },
  });
  assert.equal(csrfResponse.status, 403);
  assert.equal(deniedCsrf.calls.length, 0);

  const failing = await withApi(t, { substitutionError: new Error("private storage detail") });
  const failure = await send(failing.baseUrl, "/api/v3/schedules/substitution-products");
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "The schedule request could not be completed. Refresh and try again." });
});
