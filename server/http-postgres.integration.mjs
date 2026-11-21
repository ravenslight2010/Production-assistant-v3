import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { Pool } from "pg";
import { buildAllowlistedCutoverBatch } from "../core/cutover-transform.mjs";
import { startV3Server } from "./main.mjs";

const MANAGER_PASSWORD = "v3-test-manager-password";
const OPERATOR_PASSWORD = "v3-test-operator-password";
const BOOTSTRAP_CODE = "v3-test-initial-manager-bootstrap-code";

async function jsonResponse(response) {
  return response.json();
}

function workbookBase64(sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function allowlistedRehearsalBatch() {
  return buildAllowlistedCutoverBatch({
    products: [
      { code: "CORN", name: "Test Flour", unit: "lb" },
      { code: "DOUGH-A", name: "North Shop", unit: "case" },
      { code: "CARTON", name: "Shipping Carton", unit: "each" },
    ],
    recipes: [{
      code: "DOUGH-A-RECIPE",
      name: "North Shop dough",
      productCode: "DOUGH-A",
      data: {
        station_key: "dough",
        ingredients: [{ product_code: "CORN", quantity: 10, unit: "lb" }],
      },
    }],
    productionSetups: [{
      code: "LINE-A",
      name: "North Shop line",
      productCode: "DOUGH-A",
      data: {
        recipe_codes: ["DOUGH-A-RECIPE"],
        packaging_per_case: [{ product_code: "CARTON", quantity: 1, unit: "each" }],
      },
    }],
    staff: [{ username: "V3IntegrationOperator", disabled: false, roleName: "operator" }],
  });
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
  assert.equal(response.status, 200, "staff sign-in should return success");
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
  const cookieHeader = cookies.join("; ");
  const csrfToken = cookies
    .find((cookie) => cookie.startsWith("v3_csrf="))
    ?.slice("v3_csrf=".length);
  assert.match(cookieHeader, /v3_session=/);
  assert.match(csrfToken ?? "", /^[A-Za-z0-9_-]{43}$/);
  return { cookieHeader, csrfToken };
}

async function bootstrap(baseUrl, bootstrapCode) {
  const response = await fetch(`${baseUrl}/api/v3/auth/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({
      bootstrapCode,
      username: "V3IntegrationManager",
      password: MANAGER_PASSWORD,
    }),
  });
  return response;
}

async function main() {
  const adminConnectionString = process.env.V3_TEST_ADMIN_URL;
  const apiConnectionString = process.env.V3_DATABASE_URL;
  if (!adminConnectionString || !apiConnectionString) {
    throw new Error("The disposable V3 PostgreSQL URLs are required for this integration check.");
  }

  let serverInstance;
  const adminPool = new Pool({ connectionString: adminConnectionString });
  try {
    const logs = [];
    serverInstance = await startV3Server({
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        V3_DATABASE_URL: apiConnectionString,
        V3_INITIAL_MANAGER_BOOTSTRAP_CODE: BOOTSTRAP_CODE,
      },
      logger: (entry) => logs.push(entry),
    });
    const address = serverInstance.server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const builtDocument = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
    const scriptPath = builtDocument.match(/<script[^>]+src="(\/assets\/[^"]+)"/)?.[1];
    const stylesheetPath = builtDocument.match(/<link[^>]+href="(\/assets\/[^"]+\.css)"/)?.[1];
    assert.ok(scriptPath, "the built React document should reference its hashed script");
    assert.ok(stylesheetPath, "the built React document should reference its hashed stylesheet");

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    const servedDocument = await page.text();
    assert.match(servedDocument, /<title>Production Assistant<\/title>/);
    assert.match(servedDocument, /<div id="root"><\/div>/);
    for (const assetPath of [scriptPath, stylesheetPath]) {
      const asset = await fetch(`${baseUrl}${assetPath}`);
      assert.equal(asset.status, 200, `${assetPath} should be served from the React build`);
      assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.ok((await asset.arrayBuffer()).byteLength > 0);
    }

    const unauthenticated = await fetch(`${baseUrl}/api/v3/auth/session`);
    assert.equal(unauthenticated.status, 401);

    const bootstrapStatus = await fetch(`${baseUrl}/api/v3/auth/bootstrap-status`);
    assert.equal(bootstrapStatus.status, 200);
    assert.deepEqual(await jsonResponse(bootstrapStatus), { available: true });

    const rejectedBootstrap = await bootstrap(baseUrl, "incorrect-v3-bootstrap-code");
    assert.equal(rejectedBootstrap.status, 401);
    assert.equal((await jsonResponse(rejectedBootstrap)).error, "First-manager setup could not be completed.");

    const bootstrapResponse = await bootstrap(baseUrl, BOOTSTRAP_CODE);
    assert.equal(bootstrapResponse.status, 201);
    const bootstrapBody = await jsonResponse(bootstrapResponse);
    assert.equal(bootstrapBody.staff.role, "manager");
    const MANAGER_ID = bootstrapBody.staff.userId;
    const cutoverBatch = allowlistedRehearsalBatch();
    assert.doesNotMatch(JSON.stringify(bootstrapBody), /v3-test-initial-manager-bootstrap-code|v3-test-manager-password|argon2id|v3_session/);
    const managerCookies = bootstrapResponse.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
    const manager = {
      cookieHeader: managerCookies.join("; "),
      csrfToken: managerCookies.find((cookie) => cookie.startsWith("v3_csrf="))?.slice("v3_csrf=".length),
    };
    assert.match(manager.csrfToken ?? "", /^[A-Za-z0-9_-]{43}$/);

    const bootstrapClosed = await fetch(`${baseUrl}/api/v3/auth/bootstrap-status`);
    assert.deepEqual(await jsonResponse(bootstrapClosed), { available: false });
    const duplicateBootstrap = await bootstrap(baseUrl, BOOTSTRAP_CODE);
    assert.equal(duplicateBootstrap.status, 409);

    const createStaff = await fetch(`${baseUrl}/api/v3/auth/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        username: cutoverBatch.staff[0].username,
        password: OPERATOR_PASSWORD,
        roleName: "operator",
      }),
    });
    assert.equal(createStaff.status, 201);
    const directory = await jsonResponse(createStaff);
    assert.ok(directory.staff.some((staff) => staff.username.toLowerCase() === "v3integrationmanager"));
    assert.ok(directory.staff.some((staff) => staff.username.toLowerCase() === "v3integrationoperator"));
    assert.ok(directory.roles.some((role) => role.name === "manager"));
    assert.ok(directory.roles.some((role) => role.name === "operator"));
    assert.doesNotMatch(JSON.stringify(directory), /v3-test-operator-password|argon2id|v3_session/);

    const operatorDeniedRead = await fetch(`${baseUrl}/api/v3/auth/staff`);
    assert.equal(operatorDeniedRead.status, 401);

    const operator = await signIn(baseUrl, "V3IntegrationOperator", OPERATOR_PASSWORD);
    const managerRoster = await fetch(`${baseUrl}/api/v3/auth/staff`, {
      headers: { Cookie: manager.cookieHeader },
    });
    assert.equal(managerRoster.status, 200);
    const managerRosterBody = await jsonResponse(managerRoster);
    assert.ok(managerRosterBody.staff.some((staff) => staff.username.toLowerCase() === "v3integrationoperator"));
    const operatorRoster = await fetch(`${baseUrl}/api/v3/auth/staff`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(operatorRoster.status, 403);

    const operatorInventory = await fetch(`${baseUrl}/api/v3/inventory/warehouses`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorInventory.status, 403, "operators must not read manager inventory data");

    async function managerPost(path, body) {
      const response = await sessionPost(manager, path, body);
      if (response.status === 429) {
        throw new Error(`The disposable manager journey exceeded its import-rate budget at ${path}.`);
      }
      return response;
    }
    async function sessionPost(session, path, body) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookieHeader,
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify(body),
      });
    }
    const cycleScheduleResponse = await managerPost("/api/v3/inventory/cycle-counts/schedules", {
      requestId: "73000000-0000-4000-8000-0000000001f1", section: "Integration dry storage",
      cadenceDays: 7, enabled: true, expectedRevision: 0,
    });
    assert.equal(cycleScheduleResponse.status, 200, await cycleScheduleResponse.clone().text());
    const staffGuidanceResponse = await fetch(`${baseUrl}/api/v3/inventory/warehouse-guidance`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(staffGuidanceResponse.status, 200);
    const staffGuidance = await jsonResponse(staffGuidanceResponse);
    assert.equal(staffGuidance.cycleCounts[0].due, true);
    assert.ok(staffGuidance.freezerPull && Array.isArray(staffGuidance.freezerPull.groups));
    const markRequest = { requestId: "73000000-0000-4000-8000-0000000001f2", section: "Integration dry storage" };
    const firstMark = await sessionPost(operator, "/api/v3/inventory/cycle-counts/mark", markRequest);
    assert.equal(firstMark.status, 200, await firstMark.clone().text());
    const replayedMark = await sessionPost(operator, "/api/v3/inventory/cycle-counts/mark", markRequest);
    assert.equal((await jsonResponse(replayedMark)).replayed, true);
    const staffConfig = await sessionPost(operator, "/api/v3/inventory/cycle-counts/schedules", {
      ...markRequest, requestId: "73000000-0000-4000-8000-0000000001f3", cadenceDays: 7, enabled: true, expectedRevision: 2,
    });
    assert.equal(staffConfig.status, 403, "staff must not configure cycle-count schedules");
    const countedGuidance = await jsonResponse(await fetch(`${baseUrl}/api/v3/inventory/warehouse-guidance`, {
      headers: { Cookie: operator.cookieHeader },
    }));
    assert.equal(countedGuidance.cycleCounts[0].due, false);

    const initialWarehouseResponse = await fetch(`${baseUrl}/api/v3/inventory/warehouses`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(initialWarehouseResponse.status, 200);
    const initialWarehouseCount = (await jsonResponse(initialWarehouseResponse)).warehouses.length;

    const mainWarehouseResponse = await managerPost("/api/v3/inventory/warehouses", {
      requestId: "73000000-0000-4000-8000-000000000201",
      name: "Integration Main",
    });
    assert.equal(mainWarehouseResponse.status, 201, await mainWarehouseResponse.clone().text());
    const mainWarehouse = (await jsonResponse(mainWarehouseResponse)).warehouse;
    assert.equal(mainWarehouse.name, "Integration Main");
    const targetWarehouseResponse = await managerPost("/api/v3/inventory/warehouses", {
      requestId: "73000000-0000-4000-8000-000000000202",
      name: "Integration Prep",
    });
    assert.equal(targetWarehouseResponse.status, 201, await targetWarehouseResponse.clone().text());
    const targetWarehouse = (await jsonResponse(targetWarehouseResponse)).warehouse;
    const productImportRequest = {
      requestId: "73000000-0000-4000-8000-000000000204",
      kind: "products",
      csv: [
        "code,name,unit",
        ...cutoverBatch.products.map((product) =>
          [product.code, product.name, product.unit].map(csvCell).join(",")),
      ].join("\n") + "\n",
    };
    const stagedImportResponse = await managerPost("/api/v3/imports", productImportRequest);
    assert.equal(stagedImportResponse.status, 201, await stagedImportResponse.clone().text());
    const stagedImport = await jsonResponse(stagedImportResponse);
    assert.equal(stagedImport.outcome, "staged");
    assert.ok(stagedImport.records.some((record) => record.code === "CORN"));
    const reopenedImportResponse = await fetch(`${baseUrl}/api/v3/imports/${stagedImport.importId}`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(reopenedImportResponse.status, 200);
    const reopenedImport = await jsonResponse(reopenedImportResponse);
    assert.equal(reopenedImport.import.status, "staged");
    assert.equal(reopenedImport.import.records.find((record) => record.code === "CORN").name, "Test Flour");
    const importRetryResponse = await managerPost("/api/v3/imports", productImportRequest);
    assert.equal(importRetryResponse.status, 200);
    assert.equal((await jsonResponse(importRetryResponse)).importId, stagedImport.importId);
    const applyImportResponse = await sessionPost(manager, `/api/v3/imports/${stagedImport.importId}/apply`, {});
    assert.equal(applyImportResponse.status, 200);
    assert.equal((await jsonResponse(applyImportResponse)).outcome, "applied");
    const applyImportRetry = await managerPost(`/api/v3/imports/${stagedImport.importId}/apply`, {});
    assert.equal((await jsonResponse(applyImportRetry)).replayed, true);

    const operatorCatalog = await fetch(`${baseUrl}/api/v3/setup-catalog/imports`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorCatalog.status, 403, "operators must not read setup catalog history");
    const ingredientCsv = [
      "code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled",
      ["CAT-ING", "Catalog Fixture Flour", '["dough"]', "[]", "true", "", "true"].map(csvCell).join(","),
      "",
    ].join("\n");
    const ingredientRequest = {
      requestId: "73000000-0000-4000-8000-000000000215",
      family: "ingredients",
      csv: ingredientCsv,
    };
    const stagedIngredientResponse = await managerPost("/api/v3/setup-catalog/imports", ingredientRequest);
    assert.equal(stagedIngredientResponse.status, 201, await stagedIngredientResponse.clone().text());
    const stagedIngredient = await jsonResponse(stagedIngredientResponse);
    assert.equal(stagedIngredient.records[0].data.allergensReviewed, true);
    assert.deepEqual(stagedIngredient.records[0].data.allergens, []);
    const ingredientDetailResponse = await fetch(
      `${baseUrl}/api/v3/setup-catalog/imports/${stagedIngredient.importId}`,
      { headers: { Cookie: manager.cookieHeader, Accept: "application/json" } },
    );
    assert.equal(ingredientDetailResponse.status, 200);
    assert.equal((await jsonResponse(ingredientDetailResponse)).status, "staged");
    const appliedIngredientResponse = await managerPost(
      `/api/v3/setup-catalog/imports/${stagedIngredient.importId}/apply`, {},
    );
    assert.equal(appliedIngredientResponse.status, 200, await appliedIngredientResponse.clone().text());
    const appliedIngredient = await jsonResponse(appliedIngredientResponse);
    assert.equal(appliedIngredient.outcome, "applied");
    assert.equal((await jsonResponse(await managerPost(
      `/api/v3/setup-catalog/imports/${stagedIngredient.importId}/apply`, {},
    ))).replayed, true);

    const mixComponents = JSON.stringify([{
      ingredientName: "Catalog Fixture Flour",
      ingredientCode: "CAT-ING",
      perPizzaOz: 0.5,
      perBatchLbs: 25,
    }]);
    const mixCsv = [
      "code,name,brand,flavor,batch_size_lbs,days_early,notes,is_prep,enabled,components_json",
      ["CAT-MIX", "Catalog Fixture Mix", "Example", "Plain", "25", "2", "", "false", "true", mixComponents]
        .map(csvCell).join(","),
      "",
    ].join("\n");
    const stagedMixResponse = await managerPost("/api/v3/setup-catalog/imports", {
      requestId: "73000000-0000-4000-8000-000000000216",
      family: "mixes",
      csv: mixCsv,
    });
    assert.equal(stagedMixResponse.status, 201, await stagedMixResponse.clone().text());
    const stagedMix = await jsonResponse(stagedMixResponse);
    assert.equal(stagedMix.records[0].data.components[0].perPizzaOz, 0.5);
    assert.equal(stagedMix.records[0].data.components[0].perBatchLbs, 25);
    const appliedMixResponse = await managerPost(
      `/api/v3/setup-catalog/imports/${stagedMix.importId}/apply`, {},
    );
    assert.equal(appliedMixResponse.status, 200, await appliedMixResponse.clone().text());
    const undoneMixResponse = await managerPost(
      `/api/v3/setup-catalog/imports/${stagedMix.importId}/undo`, {},
    );
    assert.equal(undoneMixResponse.status, 200);
    assert.equal((await jsonResponse(undoneMixResponse)).outcome, "undone");
    assert.equal((await jsonResponse(await managerPost(
      `/api/v3/setup-catalog/imports/${stagedMix.importId}/undo`, {},
    ))).replayed, true);
    const undoneIngredientResponse = await managerPost(
      `/api/v3/setup-catalog/imports/${stagedIngredient.importId}/undo`, {},
    );
    assert.equal(undoneIngredientResponse.status, 200, await undoneIngredientResponse.clone().text());
    assert.equal((await jsonResponse(undoneIngredientResponse)).outcome, "undone");

    const doughWorkbook = await managerPost("/api/v3/imports/workbooks", {
      requestId: "73000000-0000-4000-8000-000000000210",
      family: "dough-procedure",
      fileName: "north-shop-dough.xlsx",
      workbookBase64: workbookBase64("Procedure", [
        ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
        ["North Shop", 7.7, 310.5, 645.19, 84],
      ]),
    });
    assert.equal(doughWorkbook.status, 201, await doughWorkbook.clone().text());
    const stagedDough = await jsonResponse(doughWorkbook);
    assert.equal(stagedDough.records[0].productCode, "DOUGH-A");
    assert.equal(stagedDough.records[0].data.doughballYield, 645.19);
    const appliedDough = await managerPost(`/api/v3/imports/${stagedDough.importId}/apply`, {});
    assert.equal(appliedDough.status, 200);

    const shippingWorkbook = await managerPost("/api/v3/imports/workbooks", {
      requestId: "73000000-0000-4000-8000-000000000211",
      family: "shipping-guide",
      fileName: "north-shop-shipping.xlsx",
      workbookBase64: workbookBase64("Shipping", [
        ["Pizza", "Notes", "Pizzas/CS"],
        ["North Shop", "", 12],
      ]),
    });
    assert.equal(shippingWorkbook.status, 201, await shippingWorkbook.clone().text());
    const stagedShipping = await jsonResponse(shippingWorkbook);
    assert.equal(stagedShipping.records[0].productCode, "DOUGH-A");
    assert.equal(stagedShipping.records[0].data.pizzasPerCase, 12);
    const appliedShipping = await managerPost(`/api/v3/imports/${stagedShipping.importId}/apply`, {});
    assert.equal(appliedShipping.status, 200);

    const rehearsalRecipe = cutoverBatch.recipes[0];
    const recipeImport = await managerPost("/api/v3/imports", {
      requestId: "73000000-0000-4000-8000-000000000212",
      kind: "recipes",
      csv: [
        "code,name,product_code,definition_json",
        [rehearsalRecipe.code, rehearsalRecipe.name, rehearsalRecipe.productCode, JSON.stringify(rehearsalRecipe.data)]
          .map(csvCell)
          .join(","),
      ].join("\n") + "\n",
    });
    assert.equal(recipeImport.status, 201, await recipeImport.clone().text());
    const stagedRecipe = await jsonResponse(recipeImport);
    const appliedRecipe = await managerPost(`/api/v3/imports/${stagedRecipe.importId}/apply`, {});
    assert.equal(appliedRecipe.status, 200, await appliedRecipe.clone().text());
    const rehearsalSetup = cutoverBatch.productionSetups[0];
    const setupImport = await managerPost("/api/v3/imports", {
      requestId: "73000000-0000-4000-8000-000000000213",
      kind: "production-setups",
      csv: [
        "code,name,product_code,config_json",
        [rehearsalSetup.code, rehearsalSetup.name, rehearsalSetup.productCode, JSON.stringify(rehearsalSetup.data)]
          .map(csvCell)
          .join(","),
      ].join("\n") + "\n",
    });
    assert.equal(setupImport.status, 201, await setupImport.clone().text());
    const stagedSetup = await jsonResponse(setupImport);
    const appliedSetup = await managerPost(`/api/v3/imports/${stagedSetup.importId}/apply`, {});
    assert.equal(appliedSetup.status, 200, await appliedSetup.clone().text());

    const scheduleTemplateData = {
      brand: "North Shop",
      flavor: "Plain",
      values: { pizzasPerCase: 12, crustsPerCycle: 4, cycleSpeed: 2, freezerTime: 0 },
    };
    await adminPool.query("BEGIN");
    const fixtureImport = await adminPool.query({
      text: `INSERT INTO v3.setup_catalog_imports(
        facility_id, actor_id, request_id, request_hash, family, records, status, applied_at
      )
      SELECT facility_id, $1::uuid, 'schedule-template-fixture', $2::text, 'run-templates', $3::jsonb,
        'applied', clock_timestamp()
      FROM v3.facility_scope WHERE singleton
      RETURNING facility_id, id`,
      values: [
        MANAGER_ID,
        "d".repeat(64),
        JSON.stringify([{ code: "SCHEDULE-TEMPLATE", name: "Schedule Integration Template", data: scheduleTemplateData }]),
      ],
    });
    assert.equal(fixtureImport.rowCount, 1, "the disposable facility should accept one schedule template fixture");
    await adminPool.query({
      text: `INSERT INTO v3.setup_run_template_records(facility_id, code, name, data, source_import_id)
        VALUES ($1::uuid, 'SCHEDULE-TEMPLATE', 'Schedule Integration Template', $2::jsonb, $3::uuid)`,
      values: [fixtureImport.rows[0].facility_id, JSON.stringify(scheduleTemplateData), fixtureImport.rows[0].id],
    });
    await adminPool.query("COMMIT");

    const secondManager = await signIn(baseUrl, "V3IntegrationManager", MANAGER_PASSWORD);
    const operatorSchedule = await fetch(`${baseUrl}/api/v3/schedules?date=2035-04-15`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorSchedule.status, 403, "operators must not read manager schedules");
    const scheduleCatalogResponse = await fetch(`${baseUrl}/api/v3/schedules/catalog`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(scheduleCatalogResponse.status, 200);
    const scheduleCatalog = await jsonResponse(scheduleCatalogResponse);
    assert.ok(scheduleCatalog.products.some((product) =>
      product.code === "DOUGH-A" && product.productionSetups.some((setup) => setup.code === "LINE-A")));
    assert.ok(scheduleCatalog.templates.some((template) => template.code === "SCHEDULE-TEMPLATE"));
    assert.doesNotMatch(JSON.stringify(scheduleCatalog.templates), /doughRecipe|app1CheeseRecipe|ingredients/u);

    const schedulePath = "/api/v3/schedules?date=2035-04-15";
    const emptyScheduleResponse = await fetch(`${baseUrl}${schedulePath}`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(emptyScheduleResponse.status, 200);
    const emptyScheduleBody = await jsonResponse(emptyScheduleResponse);
    assert.equal(emptyScheduleBody.schedule.revision, 0);
    assert.equal(emptyScheduleBody.schedule.timeZone, "America/Chicago");
    const plannedRunA = {
      id: "73000000-0000-4000-8000-000000000220",
      productCode: "DOUGH-A",
      productionSetupCode: "LINE-A",
      runTemplateCode: "SCHEDULE-TEMPLATE",
      targetCases: 20,
      notes: "Synthetic schedule note",
    };
    const addScheduleA = {
      requestId: "73000000-0000-4000-8000-000000000221",
      date: "2035-04-15",
      expectedRevision: 0,
      command: { type: "add", run: plannedRunA },
    };
    const acceptedScheduleA = await sessionPost(manager, "/api/v3/schedules/commands", addScheduleA);
    assert.equal(acceptedScheduleA.status, 200, await acceptedScheduleA.clone().text());
    assert.equal((await jsonResponse(acceptedScheduleA)).schedule.revision, 1);
    const replayedScheduleA = await sessionPost(manager, "/api/v3/schedules/commands", addScheduleA);
    assert.equal(replayedScheduleA.status, 200);
    const replayedScheduleBody = await jsonResponse(replayedScheduleA);
    assert.equal(replayedScheduleBody.replayed, true);
    assert.equal(replayedScheduleBody.schedule.runs.length, 1);

    const secondDeviceRead = await fetch(`${baseUrl}${schedulePath}`, {
      headers: { Cookie: secondManager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(secondDeviceRead.status, 200);
    assert.equal((await jsonResponse(secondDeviceRead)).schedule.runs[0].id, plannedRunA.id);
    const plannedRunB = { ...plannedRunA, id: "73000000-0000-4000-8000-000000000222", targetCases: 10, notes: "" };
    const addScheduleB = {
      requestId: "73000000-0000-4000-8000-000000000223",
      date: "2035-04-15",
      expectedRevision: 1,
      command: { type: "add", run: plannedRunB },
    };
    const acceptedScheduleB = await sessionPost(manager, "/api/v3/schedules/commands", addScheduleB);
    assert.equal(acceptedScheduleB.status, 200, await acceptedScheduleB.clone().text());
    const staleScheduleB = await sessionPost(secondManager, "/api/v3/schedules/commands", {
      ...addScheduleB,
      requestId: "73000000-0000-4000-8000-000000000224",
      expectedRevision: 1,
      command: { type: "add", run: { ...plannedRunB, id: "73000000-0000-4000-8000-000000000225" } },
    });
    assert.equal(staleScheduleB.status, 409);
    const staleScheduleBody = await jsonResponse(staleScheduleB);
    assert.equal(staleScheduleBody.schedule.revision, 2);
    assert.deepEqual(staleScheduleBody.schedule.runs.map((run) => run.id), [plannedRunA.id, plannedRunB.id]);

    const scheduleWorkbook = workbookBase64("Plan", [
      ["Brand", "Flavor", "Cases Planned"],
      ["North Shop", "Plain", 12],
      ["", "Plain", 8],
      [99, "", 20],
    ]);
    const scheduleImportPreview = await sessionPost(manager, "/api/v3/schedules/import-preview", {
      fileName: "schedule-integration.xlsx",
      workbookBase64: scheduleWorkbook,
    });
    assert.equal(scheduleImportPreview.status, 200, await scheduleImportPreview.clone().text());
    const scheduleImportBody = await jsonResponse(scheduleImportPreview);
    assert.equal(scheduleImportBody.preview.rows.length, 1);
    assert.equal(scheduleImportBody.preview.errors.length, 1);
    assert.equal(scheduleImportBody.preview.skipped.length, 1);
    const scheduleAfterPreview = await fetch(`${baseUrl}${schedulePath}`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal((await jsonResponse(scheduleAfterPreview)).schedule.revision, 2,
      "workbook preview must never apply or activate production runs");

    const runProductsResponse = await fetch(`${baseUrl}/api/v3/runs/products`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(runProductsResponse.status, 200);
    const runProducts = await jsonResponse(runProductsResponse);
    assert.equal(runProducts.products.find((product) => product.code === "DOUGH-A").doughCapacity.status, "available");
    assert.equal(runProducts.productionWarehouse, null);
    assert.equal(runProducts.products.find((product) => product.code === "DOUGH-A").productionSetups[0].code, "LINE-A");

    async function establishOpeningCount(warehouse, requestId, quantity) {
      const productsResponse = await fetch(`${baseUrl}/api/v3/inventory/products`, {
        headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
      });
      assert.equal(productsResponse.status, 200);
      const products = (await jsonResponse(productsResponse)).products;
      const csv = [
        "product_code,quantity",
        ...products.map((product) => `${product.code},${product.code === "CORN" ? quantity : "0"}`),
      ].join("\n") + "\n";
      const staged = await managerPost("/api/v3/inventory/opening-counts", {
        requestId,
        warehouseId: warehouse.id,
        csv,
      });
      assert.equal(staged.status, 201, await staged.clone().text());
      const count = await jsonResponse(staged);
      const historyResponse = await fetch(`${baseUrl}/api/v3/inventory/opening-counts?limit=50`, {
        headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
      });
      assert.equal(historyResponse.status, 200);
      const history = await jsonResponse(historyResponse);
      const historyItem = history.counts.find((item) => item.id === count.countId);
      assert.equal(historyItem.status, "staged", "staged physical counts must be discoverable after reload");
      assert.equal(historyItem.warehouseId, warehouse.id);
      const detailResponse = await fetch(`${baseUrl}/api/v3/inventory/opening-counts/${count.countId}`, {
        headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
      });
      assert.equal(detailResponse.status, 200);
      const detail = await jsonResponse(detailResponse);
      assert.equal(detail.count.rows.find((row) => row.productCode === "CORN")?.quantity, quantity);
      const reviewed = await sessionPost(manager, `/api/v3/inventory/opening-counts/${count.countId}/review`, {});
      assert.equal(reviewed.status, 200);
      const applied = await sessionPost(manager, `/api/v3/inventory/opening-counts/${count.countId}/apply`, {});
      assert.equal(applied.status, 200);
      assert.equal((await jsonResponse(applied)).outcome, "applied");
      return count;
    }
    await establishOpeningCount(mainWarehouse, "73000000-0000-4000-8000-000000000208", "0");
    await establishOpeningCount(targetWarehouse, "73000000-0000-4000-8000-000000000209", "0");
    const productionWarehouseResponse = await managerPost("/api/v3/inventory/production-warehouse", {
      requestId: "73000000-0000-4000-8000-000000000214",
      warehouseId: mainWarehouse.id,
    });
    assert.equal(productionWarehouseResponse.status, 201, await productionWarehouseResponse.clone().text());
    assert.equal((await jsonResponse(productionWarehouseResponse)).warehouse.isProduction, true);
    const productionCatalogResponse = await fetch(`${baseUrl}/api/v3/runs/products`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(productionCatalogResponse.status, 200);
    assert.equal((await jsonResponse(productionCatalogResponse)).productionWarehouse.id, mainWarehouse.id);

    const receiptRequest = {
      commandId: "73000000-0000-4000-8000-000000000205",
      warehouseId: mainWarehouse.id,
      productCode: "CORN",
      type: "receipt",
      quantity: "5.5",
      reason: "Integration receipt",
    };
    const receiptResponse = await managerPost("/api/v3/inventory/movements", receiptRequest);
    assert.equal(receiptResponse.status, 200);
    assert.equal((await jsonResponse(receiptResponse)).quantity, "5.500000");
    const receiptRetry = await managerPost("/api/v3/inventory/movements", receiptRequest);
    assert.equal((await jsonResponse(receiptRetry)).replayed, true);
    const transferResponse = await managerPost("/api/v3/inventory/transfers", {
      commandId: "73000000-0000-4000-8000-000000000206",
      sourceWarehouseId: mainWarehouse.id,
      targetWarehouseId: targetWarehouse.id,
      productCode: "CORN",
      quantity: "1",
      reason: "Integration warehouse transfer",
    });
    assert.equal(transferResponse.status, 200);
    assert.equal((await jsonResponse(transferResponse)).sourceQuantity, "4.500000");
    const movementPageUrl = new URL(`${baseUrl}/api/v3/inventory/movements`);
    movementPageUrl.searchParams.set("warehouseId", mainWarehouse.id);
    movementPageUrl.searchParams.set("limit", "1");
    const firstMovementPage = await fetch(movementPageUrl, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(firstMovementPage.status, 200);
    const firstPage = await jsonResponse(firstMovementPage);
    assert.equal(firstPage.movements.length, 1);
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.movements[0].actorId, MANAGER_ID);
    movementPageUrl.searchParams.set("beforeAt", firstPage.nextCursor.occurredAt);
    movementPageUrl.searchParams.set("beforeId", firstPage.nextCursor.id);
    const secondMovementPage = await fetch(movementPageUrl, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(secondMovementPage.status, 200);
    const secondPage = await jsonResponse(secondMovementPage);
    assert.equal(secondPage.movements.length, 1);
    assert.equal(secondPage.movements[0].id === firstPage.movements[0].id, false);
    assert.equal(secondPage.nextCursor, null);

    const openingStockResponse = await fetch(
      `${baseUrl}/api/v3/inventory/stock?warehouseId=${mainWarehouse.id}`,
      { headers: { Cookie: manager.cookieHeader, Accept: "application/json" } },
    );
    assert.equal(openingStockResponse.status, 200);
    assert.equal((await jsonResponse(openingStockResponse)).stock.find((item) => item.code === "CORN").quantity, "4.500000");
    const managerWarehouses = await fetch(`${baseUrl}/api/v3/inventory/warehouses`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(managerWarehouses.status, 200);
    assert.equal((await jsonResponse(managerWarehouses)).warehouses.length, initialWarehouseCount + 2);
    const appliedImportHistory = await fetch(`${baseUrl}/api/v3/imports?limit=50`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal((await jsonResponse(appliedImportHistory)).imports[0].appliedBy, MANAGER_ID);
    const undoImportedProduct = await managerPost(`/api/v3/imports/${stagedImport.importId}/undo`, {});
    assert.equal(undoImportedProduct.status, 409, "undo must not remove a product referenced by stock");

    const createdResponse = await fetch(`${baseUrl}/api/v3/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
      },
      body: JSON.stringify({
        requestId: "73000000-0000-4000-8000-000000000101",
        setupSnapshot: {
          label: "Two-session check", targetCases: 5, productCode: "DOUGH-A", productionSetupCode: "LINE-A",
        },
      }),
    });
    if (createdResponse.status !== 201) {
      const failureEvents = logs.filter((entry) => entry.event === "v3.run_api.error")
        .map((entry) => `${entry.event}:${entry.errorName}:${entry.errorCode ?? "no-code"}`);
      throw new Error(`run creation failed (${createdResponse.status}): ${(await createdResponse.text()).slice(0, 500)} ${failureEvents.join(",")}`);
    }
    const created = await jsonResponse(createdResponse);
    assert.equal(created.run.status, "planned");
    assert.equal(created.run.revision, 0);
    assert.equal(created.run.doughCapacity.doughballYield, 645.19);
    assert.equal(created.run.doughCapacity.pizzasPerCase, 12);

    const operatorList = await fetch(`${baseUrl}/api/v3/runs`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorList.status, 200);
    const listed = await jsonResponse(operatorList);
    assert.ok(listed.runs.some((run) => run.id === created.run.id));

    const startResponse = await fetch(`${baseUrl}/api/v3/runs/${created.run.id}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: operator.cookieHeader,
        "X-CSRF-Token": operator.csrfToken,
      },
      body: JSON.stringify({
        commandId: "73000000-0000-4000-8000-000000000102",
        commandType: "start",
        expectedRevision: 0,
      }),
    });
    assert.equal(startResponse.status, 200);
    const started = await jsonResponse(startResponse);
    assert.equal(started.run.status, "running");
    assert.equal(started.run.revision, 1);

    const managerRead = await fetch(`${baseUrl}/api/v3/runs/${created.run.id}`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(managerRead.status, 200);
    assert.equal((await jsonResponse(managerRead)).run.revision, 1);

    const staleCommand = await fetch(`${baseUrl}/api/v3/runs/${created.run.id}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
      },
      body: JSON.stringify({
        commandId: "73000000-0000-4000-8000-000000000103",
        commandType: "pause",
        expectedRevision: 0,
      }),
    });
    assert.equal(staleCommand.status, 409);
    const conflict = await jsonResponse(staleCommand);
    assert.equal(conflict.outcome, "conflict");
    assert.equal(conflict.currentRun.revision, 1);

    const stationCommands = await Promise.all([
      fetch(`${baseUrl}/api/v3/runs/${created.run.id}/stations/line/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookieHeader,
          "X-CSRF-Token": manager.csrfToken,
        },
        body: JSON.stringify({
          commandId: "73000000-0000-4000-8000-000000000104",
          expectedRevision: 1,
          mode: "manual",
          changes: { casesProduced: 2 },
        }),
      }),
      fetch(`${baseUrl}/api/v3/runs/${created.run.id}/stations/line/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: operator.cookieHeader,
          "X-CSRF-Token": operator.csrfToken,
        },
        body: JSON.stringify({
          commandId: "73000000-0000-4000-8000-000000000105",
          expectedRevision: 1,
          mode: "manual",
          changes: { casesProduced: 3 },
        }),
      }),
    ]);
    assert.deepEqual(stationCommands.map((response) => response.status).sort(), [200, 409]);
    const stationBodies = await Promise.all(stationCommands.map(jsonResponse));
    const acceptedStation = stationBodies.find((body) => body.outcome === "accepted");
    const conflictedStation = stationBodies.find((body) => body.outcome === "conflict");
    assert.ok(acceptedStation);
    assert.ok(conflictedStation);
    assert.equal(acceptedStation.run.revision, 2, "one concurrent station write should advance the run once");
    assert.equal(conflictedStation.currentRun.revision, 2, "the stale station writer should receive the new revision");
    assert.equal(
      conflictedStation.currentRun.stationProgress.line.progress.casesProduced,
      acceptedStation.run.stationProgress.line.progress.casesProduced,
    );

    const completeResponse = await fetch(`${baseUrl}/api/v3/runs/${created.run.id}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
      },
      body: JSON.stringify({
        commandId: "73000000-0000-4000-8000-000000000215",
        commandType: "complete",
        expectedRevision: 2,
      }),
    });
    assert.equal(completeResponse.status, 200, await completeResponse.clone().text());
    const completed = await jsonResponse(completeResponse);
    assert.equal(completed.run.status, "completed");
    assert.equal(completed.run.inventoryConsumption.status, "completed");
    assert.equal(completed.run.inventoryConsumption.lines.length, 0);
    const completeRetry = await sessionPost(manager, `/api/v3/runs/${created.run.id}/commands`, {
      commandId: "73000000-0000-4000-8000-000000000215",
      commandType: "complete",
      expectedRevision: 2,
    });
    assert.equal(completeRetry.status, 200);
    assert.equal((await jsonResponse(completeRetry)).replayed, true);

    const movementsBeforeSurplus = await adminPool.query("SELECT count(*)::integer AS count FROM v3.inventory_movements");
    const operatorSurplusRead = await fetch(`${baseUrl}/api/v3/inventory/freezer-surplus`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorSurplusRead.status, 403, "staff must not read the manager-only surplus ledger");
    const surplusConfirmationRequest = {
      requestId: "73000000-0000-4000-8000-000000000230",
      runId: created.run.id,
      cases: 4,
    };
    const surplusConfirmation = await managerPost("/api/v3/inventory/freezer-surplus/confirm", surplusConfirmationRequest);
    assert.equal(surplusConfirmation.status, 200, await surplusConfirmation.clone().text());
    const surplusConfirmationBody = await jsonResponse(surplusConfirmation);
    assert.equal(surplusConfirmationBody.decision, "stored");
    assert.equal(surplusConfirmationBody.cases, 4);
    assert.match(surplusConfirmationBody.lotId, /^[0-9a-f-]{36}$/);
    const surplusConfirmationReplay = await managerPost("/api/v3/inventory/freezer-surplus/confirm", surplusConfirmationRequest);
    assert.equal(surplusConfirmationReplay.status, 200);
    const surplusConfirmationReplayBody = await jsonResponse(surplusConfirmationReplay);
    assert.equal(surplusConfirmationReplayBody.replayed, true);
    assert.equal(surplusConfirmationReplayBody.lotId, surplusConfirmationBody.lotId);
    const replacementDecision = await managerPost("/api/v3/inventory/freezer-surplus/confirm", {
      requestId: "73000000-0000-4000-8000-000000000231", runId: created.run.id, cases: 1,
    });
    assert.equal(replacementDecision.status, 409, "a new request cannot replace the immutable completed-run decision");

    const surplusAllocation = await managerPost("/api/v3/inventory/freezer-surplus/allocations", {
      requestId: "73000000-0000-4000-8000-000000000232",
      lotId: surplusConfirmationBody.lotId,
      productionDate: "2035-04-15",
      scheduleRunId: plannedRunA.id,
      cases: 3,
      expectedRevision: 1,
    });
    assert.equal(surplusAllocation.status, 200, await surplusAllocation.clone().text());
    const surplusAllocationBody = await jsonResponse(surplusAllocation);
    assert.equal(surplusAllocationBody.lotId, surplusConfirmationBody.lotId);
    assert.equal(surplusAllocationBody.remainingCases, 1);
    assert.equal(surplusAllocationBody.carriedInCases, 3);
    assert.equal(surplusAllocationBody.effectiveTargetCases, 17);
    const carriedInSchedule = await jsonResponse(await fetch(`${baseUrl}${schedulePath}`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    }));
    const carriedInRun = carriedInSchedule.schedule.runs.find((run) => run.id === plannedRunA.id);
    assert.equal(carriedInRun.targetCases, 20);
    assert.equal(carriedInRun.carriedInCases, 3);
    assert.equal(carriedInRun.effectiveTargetCases, 17);

    const surplusDamage = await managerPost("/api/v3/inventory/freezer-surplus/adjustments", {
      requestId: "73000000-0000-4000-8000-000000000233",
      lotId: surplusConfirmationBody.lotId,
      eventType: "damage",
      cases: 1,
      reason: "Integration freezer damage",
      expectedRevision: 2,
    });
    assert.equal(surplusDamage.status, 200, await surplusDamage.clone().text());
    const surplusDamageBody = await jsonResponse(surplusDamage);
    assert.equal(surplusDamageBody.remainingCases, 0);
    const surplusCorrection = await managerPost("/api/v3/inventory/freezer-surplus/adjustments", {
      requestId: "73000000-0000-4000-8000-000000000234",
      lotId: surplusConfirmationBody.lotId,
      eventType: "correction",
      cases: 1,
      reason: "Integration damage review correction",
      expectedRevision: 3,
      correctsEventId: surplusDamageBody.eventId,
    });
    assert.equal(surplusCorrection.status, 200, await surplusCorrection.clone().text());
    assert.equal((await jsonResponse(surplusCorrection)).remainingCases, 1);
    const finalSurplusResponse = await fetch(`${baseUrl}/api/v3/inventory/freezer-surplus`, {
      headers: { Cookie: manager.cookieHeader, Accept: "application/json" },
    });
    assert.equal(finalSurplusResponse.status, 200);
    const finalSurplus = await jsonResponse(finalSurplusResponse);
    assert.equal(finalSurplus.lots.length, 1);
    assert.equal(finalSurplus.lots[0].remainingCases, 1);
    assert.equal(finalSurplus.allocations.length, 1);
    assert.equal(finalSurplus.events.length, 4);
    assert.equal(finalSurplus.events.find((event) => event.eventType === "correction").correctsEventId, surplusDamageBody.eventId);
    const movementsAfterSurplus = await adminPool.query("SELECT count(*)::integer AS count FROM v3.inventory_movements");
    assert.equal(movementsAfterSurplus.rows[0].count, movementsBeforeSurplus.rows[0].count,
      "surplus receipts, carry-in, and corrections must not append ingredient movements");

    const operatorStationRead = await fetch(`${baseUrl}/api/v3/runs/${created.run.id}`, {
      headers: { Cookie: operator.cookieHeader, Accept: "application/json" },
    });
    assert.equal(operatorStationRead.status, 200);
    const sharedStationRun = (await jsonResponse(operatorStationRead)).run;
    assert.equal(sharedStationRun.revision, completed.run.revision, "the completed revision should persist across sessions");
    assert.equal(sharedStationRun.stationProgress.line.progress.casesProduced, acceptedStation.run.stationProgress.line.progress.casesProduced);

    const roleChange = await fetch(`${baseUrl}/api/v3/auth/staff/${directory.staff.find((staff) => staff.username === "v3integrationoperator").userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ roleName: "manager" }),
    });
    assert.equal(roleChange.status, 200);
    const changedDirectory = await jsonResponse(roleChange);
    assert.equal(changedDirectory.staff.find((staff) => staff.username === "v3integrationoperator").role, "manager");

    const oldOperatorSession = await fetch(`${baseUrl}/api/v3/auth/session`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(oldOperatorSession.status, 401);
    const promotedOperator = await signIn(baseUrl, "V3IntegrationOperator", OPERATOR_PASSWORD);
    assert.equal((await fetch(`${baseUrl}/api/v3/auth/session`, {
      headers: { Cookie: promotedOperator.cookieHeader },
    })).status, 200);

    const demoteOperator = await fetch(`${baseUrl}/api/v3/auth/staff/${directory.staff.find((staff) => staff.username === "v3integrationoperator").userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ roleName: "operator" }),
    });
    assert.equal(demoteOperator.status, 200);
    const demotedOperator = await signIn(baseUrl, "V3IntegrationOperator", OPERATOR_PASSWORD);

    const disableOperator = await fetch(`${baseUrl}/api/v3/auth/staff/${directory.staff.find((staff) => staff.username === "v3integrationoperator").userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(disableOperator.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/v3/auth/session`, {
      headers: { Cookie: demotedOperator.cookieHeader },
    })).status, 401);
    const disabledSignIn = await fetch(`${baseUrl}/api/v3/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ username: "V3IntegrationOperator", password: OPERATOR_PASSWORD }),
    });
    assert.equal(disabledSignIn.status, 401);

    const lastManagerChange = await fetch(`${baseUrl}/api/v3/auth/staff/${bootstrapBody.staff.userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(lastManagerChange.status, 409);

    const signOut = await fetch(`${baseUrl}/api/v3/auth/sign-out`, {
      method: "POST",
      headers: {
        Cookie: manager.cookieHeader,
        "X-CSRF-Token": manager.csrfToken,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    assert.equal(signOut.status, 204);

    const disabledOperatorSession = await fetch(`${baseUrl}/api/v3/auth/session`, {
      headers: { Cookie: operator.cookieHeader },
    });
    assert.equal(disabledOperatorSession.status, 401);
    assert.equal(JSON.stringify(logs).includes(MANAGER_PASSWORD), false);
    assert.equal(JSON.stringify(logs).includes(OPERATOR_PASSWORD), false);
    assert.equal(JSON.stringify(logs).includes(BOOTSTRAP_CODE), false);
    assert.equal(JSON.stringify(logs).includes("Synthetic schedule note"), false);
    for (const cookie of [manager.cookieHeader, operator.cookieHeader, secondManager.cookieHeader, promotedOperator.cookieHeader, demotedOperator.cookieHeader]) {
      assert.equal(JSON.stringify(logs).includes(cookie), false);
    }
    console.log("V3 HTTP/PostgreSQL check passed: manager schedules, reviewed import, idempotent retries, conflicts, and role restrictions are persistent.");
  } finally {
    await adminPool.end();
    if (serverInstance) await serverInstance.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "v3.http_postgres_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Integration assertion failed.",
  }));
  process.exitCode = 1;
});
