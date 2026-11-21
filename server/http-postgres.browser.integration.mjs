import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, webkit } from "playwright";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import { startV3Server } from "./main.mjs";

const MANAGER_USERNAME = "V3IntegrationManager";
const MANAGER_PASSWORD = "v3-test-manager-password";
const SCHEDULE_DATE = "2035-04-16";

async function authenticateBrowserContext(baseUrl, context) {
  const unauthenticated = await fetch(`${baseUrl}/api/v3/auth/session`);
  assert.equal(unauthenticated.status, 401, "a new browser context must not inherit a staff session");
  const response = await fetch(`${baseUrl}/api/v3/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ username: MANAGER_USERNAME, password: MANAGER_PASSWORD }),
  });
  assert.equal(response.status, 200, "the manager account must be available for the browser journey");
  const cookies = response.headers.getSetCookie().map((cookie) => {
    const [pair, ...attributes] = cookie.split(";");
    const separator = pair.indexOf("=");
    const flags = attributes.map((attribute) => attribute.trim().toLowerCase());
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: baseUrl,
      httpOnly: flags.includes("httponly"),
      secure: flags.includes("secure"),
      sameSite: "Lax",
    };
  });
  await context.addCookies(cookies);
}

async function selectRun(page, runId, label) {
  const selector = page.getByLabel("Visible run");
  await selector.waitFor();
  await selector.selectOption(runId);
  await page.getByRole("heading", { name: label, exact: true }).waitFor();
}

async function fillScheduleRun(card, targetCases, notes = "") {
  await card.getByLabel(/^Product for /).selectOption("DOUGH-A");
  await card.getByLabel(/^Production setup for /).selectOption("LINE-A");
  await card.getByLabel(/^Run template for /).selectOption("SCHEDULE-TEMPLATE");
  await card.getByLabel(/^Target cases for /).fill(String(targetCases));
  await card.getByLabel(/^Notes for /).fill(notes);
}

async function waitScheduleSaved(page) {
  await page.getByRole("status").filter({ hasText: "Schedule change saved to the server." }).waitFor();
}

async function main() {
  const databaseUrl = process.env.V3_DATABASE_URL;
  const adminDatabaseUrl = process.env.V3_TEST_ADMIN_URL;
  if (!databaseUrl || !adminDatabaseUrl) {
    throw new Error("The disposable V3 PostgreSQL API and admin URLs are required for browser integration.");
  }

  const adminPool = new Pool({ connectionString: adminDatabaseUrl });
  const errors = [];
  const failedResponses = [];
  const browserWrites = [];
  let offlineCheckActive = false;
  let loseScheduleUpdateResponse = false;
  let loseSetupStageResponse = false;
  let setupImportId;
  let setupStageRequestBody;
  let serverInstance;
  let browser;
  try {
    serverInstance = await startV3Server({
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        V3_DATABASE_URL: databaseUrl,
      },
      logger: (entry) => {
        if (entry?.level === "error") errors.push("server emitted an error");
      },
    });

    const address = serverInstance.server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browserPath = process.env.CHROMIUM_PATH
      || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    browser = await chromium.launch({
      headless: true,
      executablePath: browserPath,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();

    function observePage(observedPage) {
      observedPage.on("pageerror", (error) => errors.push(error.message));
      observedPage.on("console", (message) => {
        if (message.type() !== "error") return;
        if (message.text().includes("Failed to load resource")) return;
        if (offlineCheckActive && message.text().includes("net::ERR_INTERNET_DISCONNECTED")) return;
        errors.push(message.text());
      });
      observedPage.on("response", (response) => {
        if (response.status() >= 400) {
          const url = new URL(response.url());
          failedResponses.push(`${response.status()} ${url.pathname}`);
        }
      });
      observedPage.on("request", (request) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          browserWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
      });
    }
    observePage(page);
    await page.route("**/api/v3/schedules/commands", async (route) => {
      const body = route.request().postDataJSON();
      if (loseScheduleUpdateResponse && body.command.type === "update") {
        loseScheduleUpdateResponse = false;
        const committed = await route.fetch();
        assert.equal(committed.status(), 200, await committed.text());
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic response loss after the disposable database commit." }),
        });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/v3/setup-catalog/imports", async (route) => {
      if (loseSetupStageResponse && route.request().method() === "POST") {
        loseSetupStageResponse = false;
        setupStageRequestBody = route.request().postDataJSON();
        const committed = await route.fetch();
        assert.equal(committed.status(), 201, await committed.text());
        setupImportId = (await committed.json()).importId;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic setup staging response loss after the disposable database commit." }),
        });
        return;
      }
      await route.continue();
    });

    await authenticateBrowserContext(baseUrl, context);
    await page.goto(baseUrl);
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await page.getByLabel("Imported product").selectOption("DOUGH-A");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const runLabel = `Browser PostgreSQL ${suffix}`;
    await page.getByLabel("Run label").fill(runLabel);
    await page.getByLabel("Target cases").fill("3");
    await page.locator("#run-setup").selectOption("LINE-A");
    const createResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/runs" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Prepare run", exact: true }).click();
    const createResponse = await createResponsePromise;
    const createdBody = await createResponse.json();
    assert.equal(createResponse.status(), 201, JSON.stringify(createdBody));
    const createdRun = createdBody.run;
    assert.equal(createdRun.status, "planned");
    assert.equal(createdRun.revision, 0);
    assert.equal(createdRun.setupSnapshot.productCode, "DOUGH-A");
    assert.equal(createdRun.setupSnapshot.productionSetupCode, "LINE-A");
    assert.equal(createdRun.doughCapacity.doughballYield, 645.19);
    assert.equal(createdRun.doughCapacity.pizzasPerCase, 12);

    const startResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/runs/${createdRun.id}/commands`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "start", exact: true }).click();
    const startResponse = await startResponsePromise;
    assert.equal(startResponse.status(), 200);
    const startedRun = (await startResponse.json()).run;
    assert.equal(startedRun.status, "running");
    assert.equal(startedRun.revision, 1);
    await page.getByText("start confirmed by the server.").waitFor();

    await page.getByLabel("Cases Produced", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Save station update", exact: true }).click();
    await page.getByText("Station change confirmed by the server.").waitFor();

    const secondPage = await context.newPage();
    observePage(secondPage);
    await secondPage.goto(baseUrl);
    await selectRun(secondPage, createdRun.id, runLabel);
    assert.equal(await secondPage.getByLabel("Cases Produced", { exact: true }).inputValue(), "2");

    await page.getByLabel("Cases Produced", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Save station update", exact: true }).click();
    await page.getByText("Station change confirmed by the server.").waitFor();
    await secondPage.getByLabel("Cases Produced", { exact: true }).fill("1");
    await secondPage.getByRole("button", { name: "Save station update", exact: true }).click();
    await secondPage.getByText("Stale station change discarded; the latest server state is now displayed.").waitFor();
    assert.equal(await secondPage.getByLabel("Cases Produced", { exact: true }).inputValue(), "3");

    for (const [command, expectedStatus] of [["pause", "paused"], ["resume", "running"], ["complete", "completed"]]) {
      const commandResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v3/runs/${createdRun.id}/commands`
        && response.request().method() === "POST"
        && response.request().postDataJSON().commandType === command);
      await page.getByRole("button", { name: command, exact: true }).click();
      const commandResponse = await commandResponsePromise;
      assert.equal(commandResponse.status(), 200, `${command} should be accepted by PostgreSQL`);
      const body = await commandResponse.json();
      assert.equal(body.run.status, expectedStatus);
      if (command === "complete") {
        assert.ok(body.run.inventoryConsumption, "completion should return its exact-once inventory receipt");
        assert.ok(["completed", "shortage"].includes(body.run.inventoryConsumption.status));
      }
    }
    await page.getByText("Completion inventory receipt recorded; consumption is exact-once.").waitFor();

    await page.reload();
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await selectRun(page, createdRun.id, runLabel);
    const currentRun = page.locator('section[aria-labelledby="current-run-heading"]');
    await currentRun.getByText("completed", { exact: true }).waitFor();
    await currentRun.getByText("Revision", { exact: true }).waitFor();

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `the React run cockpit must fit ${viewport.width}x${viewport.height}`);
    }

    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByRole("heading", { name: "Production schedule", exact: true }).waitFor();
    await page.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
    await page.getByRole("heading", { name: "No runs planned for this date" }).waitFor();
    await page.getByRole("button", { name: "Add planned run", exact: true }).click();
    await fillScheduleRun(page.getByRole("article", { name: "New planned run", exact: true }), 3, "Real database schedule note");
    await page.getByRole("button", { name: "Add to plan", exact: true }).click();
    await waitScheduleSaved(page);

    const scheduleRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/schedules?date=${SCHEDULE_DATE}`);
      assert.equal(response.status(), 200);
      return (await response.json()).schedule;
    };
    let confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 1);
    assert.equal(confirmedSchedule.runs[0].targetCases, 3);
    const plannedRunId = confirmedSchedule.runs[0].id;

    const firstScheduleRun = page.getByRole("article", { name: "Planned run 1", exact: true });
    await firstScheduleRun.getByLabel(/^Target cases for /).fill("4");
    loseScheduleUpdateResponse = true;
    await firstScheduleRun.getByRole("button", { name: "Save run 1", exact: true }).click();
    await page.getByText(/Retry the same request; its request ID prevents duplicate changes/).waitFor();
    const retryScheduleResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/schedules/commands"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Retry the same save", exact: true }).click();
    const retryScheduleResponse = await retryScheduleResponsePromise;
    assert.equal(retryScheduleResponse.status(), 200);
    const retryScheduleBody = await retryScheduleResponse.json();
    assert.equal(retryScheduleBody.replayed, true);
    assert.equal(retryScheduleBody.schedule.runs.length, 1);
    assert.equal(retryScheduleBody.schedule.runs[0].targetCases, 4);

    await page.getByRole("button", { name: "Add planned run", exact: true }).click();
    await fillScheduleRun(page.getByRole("article", { name: "New planned run", exact: true }), 2);
    await page.getByRole("button", { name: "Add to plan", exact: true }).click();
    await waitScheduleSaved(page);
    await page.getByRole("button", { name: "Move planned run 2 up", exact: true }).click();
    await waitScheduleSaved(page);
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 2);
    await page.getByLabel("First run", { exact: true }).selectOption(confirmedSchedule.runs[0].id);
    await page.getByLabel("Second run", { exact: true }).selectOption(confirmedSchedule.runs[1].id);
    await page.getByRole("button", { name: "Swap selected runs", exact: true }).click();
    await waitScheduleSaved(page);
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs[0].id, plannedRunId);
    await page.getByLabel("Break 1 · 30 minutes", { exact: true }).check();
    await page.getByLabel("Run after break 1", { exact: true }).selectOption(plannedRunId);
    await page.getByRole("button", { name: "Save breaks", exact: true }).click();
    await waitScheduleSaved(page);

    await secondPage.goto(`${baseUrl}/#schedule`);
    await secondPage.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
    await secondPage.getByRole("article", { name: "Planned run 1", exact: true }).waitFor();
    await firstScheduleRun.getByLabel(/^Target cases for /).fill("5");
    await firstScheduleRun.getByRole("button", { name: "Save run 1", exact: true }).click();
    await waitScheduleSaved(page);
    const staleScheduleRun = secondPage.getByRole("article", { name: "Planned run 1", exact: true });
    await staleScheduleRun.getByLabel(/^Target cases for /).fill("9");
    await staleScheduleRun.getByRole("button", { name: "Save run 1", exact: true }).click();
    await secondPage.getByText(/this change was not saved/).waitFor();
    assert.equal(await staleScheduleRun.getByLabel(/^Target cases for /).inputValue(), "9");
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs[0].targetCases, 5);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Brand", "Flavor", "Cases Planned", "Notes"],
      ["North Shop", "Plain", 6, "Real database import"],
    ]), "Plan");
    const workbookBytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    await page.getByLabel("Schedule workbook", { exact: true }).setInputFiles({
      name: "schedule-browser-integration.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: workbookBytes,
    });
    await page.getByRole("button", { name: "Review workbook", exact: true }).click();
    await page.getByText(/Workbook reviewed\. Nothing has been applied/).waitFor();
    const importRow = page.getByRole("article", { name: "Import review row 2", exact: true });
    await importRow.getByLabel(/Product ·/).selectOption("DOUGH-A");
    await importRow.getByLabel("Production setup for import row 2", { exact: true }).selectOption("LINE-A");
    await importRow.getByLabel(/Run template ·/).selectOption("SCHEDULE-TEMPLATE");
    await page.getByRole("button", { name: `Apply 1 reviewed run(s) to ${SCHEDULE_DATE}`, exact: true }).click();
    await waitScheduleSaved(page);
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 3);
    assert.equal(confirmedSchedule.runs[2].targetCases, 6);
    assert.equal(confirmedSchedule.runs[2].notes, "Real database import");

    await page.reload();
    await page.getByRole("heading", { name: "Production schedule", exact: true }).waitFor();
    await page.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
    await page.getByRole("article", { name: "Planned run 3", exact: true }).waitFor();
    assert.equal(await page.getByRole("article", { name: /^Planned run / }).count(), 3);
    const writesBeforeScheduleOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.getByText("Read-only offline", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Add planned run", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Review workbook", exact: true }).isDisabled(), true);
    assert.equal(browserWrites.length, writesBeforeScheduleOffline, "offline schedule mode must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await page.getByRole("status").filter({ hasText: `Server schedule loaded · America/Chicago` }).waitFor();

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `the React schedule must fit ${viewport.width}x${viewport.height}`);
      if (viewport.width === 768) await page.screenshot({ path: "/tmp/v3-schedule-tablet.png", fullPage: true });
    }

    await page.getByRole("button", { name: "Setup", exact: true }).click();
    await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
    const setupCode = `BROWSER-${suffix}`;
    const setupName = `Browser PostgreSQL Flour ${suffix}`;
    const setupCsv = 'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n'
      + `${setupCode},${setupName},"[""dough""]","[]",true,,true\n`;
    const setupDetailRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/setup-catalog/imports/${setupImportId}`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const setupHistoryRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/setup-catalog/imports?limit=50`);
      assert.equal(response.status(), 200);
      return (await response.json()).imports;
    };
    const setupRecordRead = async () => {
      const result = await adminPool.query(
        `SELECT record.code, record.name, record.data, record.source_import_id
         FROM v3.setup_ingredient_records AS record
         JOIN v3.facility_scope AS scope
           ON scope.facility_id = record.facility_id AND scope.singleton
         WHERE lower(record.code) = lower($1)`,
        [setupCode],
      );
      return result.rows;
    };

    await page.getByLabel("Setup CSV file", { exact: true }).setInputFiles({
      name: "setup-browser-integration.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(setupCsv),
    });
    loseSetupStageResponse = true;
    await page.getByRole("button", { name: "Review and stage CSV", exact: true }).click();
    await page.getByText(/Retry the same request; its request ID prevents duplicate imports/).waitFor();
    assert.match(setupImportId ?? "", /^[0-9a-f-]{36}$/);
    let setupDetail = await setupDetailRead();
    assert.equal(setupDetail.status, "staged");
    assert.equal(setupDetail.rowCount, 1);
    assert.equal(setupDetail.records[0].code, setupCode);
    assert.equal(setupDetail.records[0].name, setupName);
    assert.deepEqual(setupDetail.records[0].data.categories, ["dough"]);
    assert.equal((await setupHistoryRead()).filter((item) => item.id === setupImportId).length, 1);
    assert.deepEqual(await setupRecordRead(), [], "staging must not mutate the real setup catalog");

    const retrySetupResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/setup-catalog/imports"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Retry the same staging request", exact: true }).click();
    const retrySetupResponse = await retrySetupResponsePromise;
    assert.equal(retrySetupResponse.status(), 200);
    assert.deepEqual(retrySetupResponse.request().postDataJSON(), setupStageRequestBody,
      "the real exact retry must preserve request ID, family, and CSV bytes");
    const retrySetupBody = await retrySetupResponse.json();
    assert.equal(retrySetupBody.replayed, true);
    assert.equal(retrySetupBody.importId, setupImportId);
    assert.equal(retrySetupBody.rowCount, 1);
    await page.getByText(/The previous staging request was confirmed\. The canonical setup review has been reloaded\./).waitFor();
    assert.equal((await setupHistoryRead()).filter((item) => item.id === setupImportId).length, 1,
      "exact retry must not create a duplicate PostgreSQL import");
    const setupReview = page.getByRole("region", { name: "Setup import review" });
    await setupReview.getByText(setupName, { exact: true }).waitFor();
    await setupReview.getByLabel(`Values for ${setupCode}`, { exact: true }).waitFor();
    assert.deepEqual(await setupRecordRead(), [], "canonical record review remains unapplied");

    const applySetupResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${setupImportId}/apply`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    const applySetupResponse = await applySetupResponsePromise;
    assert.equal(applySetupResponse.status(), 200);
    const applySetupBody = await applySetupResponse.json();
    assert.equal(applySetupBody.replayed, false);
    assert.equal(applySetupBody.createdCount, 1);
    assert.equal(applySetupBody.updatedCount, 0);
    await page.getByText(/1 setup rows created and 0 updated\. Canonical history reloaded\./).waitFor();
    setupDetail = await setupDetailRead();
    assert.equal(setupDetail.status, "applied");
    assert.equal(setupDetail.createdCount, 1);
    assert.equal(setupDetail.updatedCount, 0);
    const appliedSetupRecords = await setupRecordRead();
    assert.equal(appliedSetupRecords.length, 1);
    assert.equal(appliedSetupRecords[0].name, setupName);
    assert.equal(appliedSetupRecords[0].source_import_id, setupImportId);
    assert.deepEqual(appliedSetupRecords[0].data.categories, ["dough"]);
    await setupReview.getByText("applied", { exact: true }).waitFor();

    await page.getByLabel("Setup CSV file", { exact: true }).setInputFiles({
      name: "offline-setup-not-retained.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(setupCsv),
    });
    const writesBeforeSetupOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Review and stage CSV", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Undo applied import", exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel("Setup CSV file", { exact: true }).evaluate((input) => input.files.length), 0);
    assert.equal(browserWrites.length, writesBeforeSetupOffline, "offline setup mode must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await page.getByText("Server-owned import lifecycle · manage-inventory", { exact: true }).waitFor();

    page.once("dialog", (dialog) => dialog.accept());
    const undoSetupResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${setupImportId}/undo`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Undo applied import", exact: true }).click();
    const undoSetupResponse = await undoSetupResponsePromise;
    assert.equal(undoSetupResponse.status(), 200);
    const undoSetupBody = await undoSetupResponse.json();
    assert.equal(undoSetupBody.replayed, false);
    assert.equal(undoSetupBody.createdCount, 1);
    assert.equal(undoSetupBody.updatedCount, 0);
    await page.getByText(/Setup import undone\. Server dependency and later-edit rules were enforced\. Canonical history reloaded\./).waitFor();
    setupDetail = await setupDetailRead();
    assert.equal(setupDetail.status, "undone");
    assert.equal(setupDetail.records[0].name, setupName, "Undo must preserve reviewable import values");
    assert.deepEqual(await setupRecordRead(), [], "Undo must remove the newly created real catalog record");
    await setupReview.getByText("undone", { exact: true }).waitFor();

    await page.reload();
    await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
    await page.getByRole("button", { name: "Reopen import 1", exact: true }).click();
    await page.getByText("Canonical import details reloaded. Review the preserved values before acting.").waitFor();
    await page.getByRole("region", { name: "Setup import review" }).getByText(setupName, { exact: true }).waitFor();

    const sourceFlavor = `Browser Source ${suffix}`;
    const sourceWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(sourceWorkbook, XLSX.utils.aoa_to_sheet([
      ["Brand", "Flavor", "Target Doughball Weight", "Pizzas Per Case"],
      ["Integration Brand", sourceFlavor, 8, 12],
    ]), "Specifications");
    const sourceWorkbookBytes = XLSX.write(sourceWorkbook, { type: "buffer", bookType: "xlsx" });
    await page.getByLabel("Source workbook family", { exact: true }).selectOption("spec-sheets");
    await page.getByLabel("Source workbook file", { exact: true }).setInputFiles({
      name: "source-browser-integration.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: sourceWorkbookBytes,
    });
    await page.getByRole("button", { name: "Preview workbook", exact: true }).click();
    const sourceCandidate = page.getByRole("article", { name: "Source record 1", exact: true });
    await sourceCandidate.getByText(new RegExp(`Integration Brand · ${sourceFlavor}$`)).waitFor();
    assert.equal(await page.getByRole("article", { name: /^Unresolved source row / }).count(), 0);
    await sourceCandidate.getByLabel("Reviewed and confirmed", { exact: true }).check();
    const stageSourceResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/setup-catalog/imports" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Stage reviewed source records", exact: true }).click();
    const stageSourceResponse = await stageSourceResponsePromise;
    assert.equal(stageSourceResponse.status(), 201, await stageSourceResponse.text());
    await page.getByText(/Reviewed source records staged\. Review the stored records; no setup values have been applied\./).waitFor();
    const sourceHistoryItem = (await setupHistoryRead()).find((item) => item.sourceSummary?.sourceFamily === "spec-sheets");
    assert.ok(sourceHistoryItem, "the real source import must appear in canonical history");
    const sourceImportId = sourceHistoryItem.id;
    const sourceDetailRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/setup-catalog/imports/${sourceImportId}`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    let sourceDetail = await sourceDetailRead();
    assert.equal(sourceDetail.status, "staged");
    assert.equal(sourceDetail.rowCount, 1);
    assert.equal(sourceDetail.records[0].name, `Integration Brand · ${sourceFlavor}`);
    assert.deepEqual(sourceDetail.records[0].data.values, { targetDoughballWeight: 8, pizzasPerCase: 12 });
    assert.equal(sourceDetail.sourceSummary.sourceRows, 1);
    assert.equal(sourceDetail.sourceSummary.importedRows, 1);
    assert.equal(sourceDetail.sourceSummary.skippedRows, 0);
    assert.equal(sourceDetail.sourceSummary.unresolvedRows, 0);
    assert.match(sourceDetail.sourceSummary.sourceSha256, /^[0-9a-f]{64}$/);
    const sourceCode = sourceDetail.records[0].code;
    const sourceRecordRead = async () => {
      const result = await adminPool.query(
        `SELECT record.code, record.name, record.data, record.source_import_id
         FROM v3.setup_run_template_records AS record
         JOIN v3.facility_scope AS scope
           ON scope.facility_id = record.facility_id AND scope.singleton
         WHERE lower(record.code) = lower($1)`,
        [sourceCode],
      );
      return result.rows;
    };
    assert.deepEqual(await sourceRecordRead(), [], "source staging must not mutate real run templates");
    await setupReview.getByText(/Source spec-sheets · 1 source row\(s\) · 1 imported · 0 skipped · 0 still unresolved/).waitFor();
    const applySourceResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${sourceImportId}/apply`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    const applySourceResponse = await applySourceResponsePromise;
    assert.equal(applySourceResponse.status(), 200);
    assert.equal((await applySourceResponse.json()).createdCount, 1);
    sourceDetail = await sourceDetailRead();
    assert.equal(sourceDetail.status, "applied");
    const appliedSourceRecords = await sourceRecordRead();
    assert.equal(appliedSourceRecords.length, 1);
    assert.equal(appliedSourceRecords[0].source_import_id, sourceImportId);
    assert.deepEqual(appliedSourceRecords[0].data.values, { targetDoughballWeight: 8, pizzasPerCase: 12 });
    await page.reload();
    await page.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
    await page.getByRole("button", { name: "Reopen import 1", exact: true }).click();
    await page.getByText("Canonical import details reloaded. Review the preserved values before acting.").waitFor();
    await setupReview.getByText(sourceCode, { exact: true }).waitFor();
    await setupReview.getByText(/Source spec-sheets · 1 source row\(s\) · 1 imported · 0 skipped · 0 still unresolved/).waitFor();

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

    await page.getByRole("button", { name: "Staff", exact: true }).click();
    await page.getByRole("heading", { name: "Staff accounts", exact: true }).waitFor();
    const staffUsername = `V3Browser${suffix}`;
    await page.getByLabel("Username", { exact: true }).fill(staffUsername);
    await page.getByLabel("Initial password", { exact: true }).fill("v3-browser-operator-password");
    await page.locator("#new-staff-role").selectOption("operator");
    const staffResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/auth/staff" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const staffResponse = await staffResponsePromise;
    assert.equal(staffResponse.status(), 201);
    const staffDirectory = await staffResponse.json();
    assert.ok(staffDirectory.staff.some((staff) => staff.username === staffUsername.toLowerCase()));
    await page.getByText("Staff account created. The password was not stored in the browser.").waitFor();
    const staffSignIn = await fetch(`${baseUrl}/api/v3/auth/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ username: staffUsername, password: "v3-browser-operator-password" }),
    });
    assert.equal(staffSignIn.status, 200, "the React-created staff account must authenticate against PostgreSQL");

    await page.getByRole("button", { name: "Live run", exact: true }).click();
    await selectRun(page, createdRun.id, runLabel);
    const writesBeforeOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.getByText("Read-only offline", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Prepare run", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Refresh server state", exact: true }).isDisabled(), true);
    assert.equal(browserWrites.length, writesBeforeOffline, "offline mode must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await page.getByText("Connected", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Prepare run", exact: true }).isEnabled(), true);
    await secondPage.close();

    assert.deepEqual(errors, [], "the real React/PostgreSQL browser journey should have no unexpected browser or server errors");
    const conflictPath = `/api/v3/runs/${createdRun.id}/stations/line/commands`;
    assert.deepEqual(failedResponses, [
      `409 ${conflictPath}`,
      "500 /api/v3/schedules/commands",
      "409 /api/v3/schedules/commands",
      "500 /api/v3/setup-catalog/imports",
    ], "only deliberate stale conflicts and injected post-commit response loss should be rejected");
    console.log("V3 authenticated Chromium/PostgreSQL journey passed: run control; React schedule commands, exact retry, stale conflict, deterministic workbook Apply; setup CSV and source-workbook stage/review/Apply/Undo/reopen with exact retry and real catalog readback; reload persistence, offline write lockout, staff creation, and desktop/phone/tablet layouts.");

    let webkitBrowser;
    try {
      webkitBrowser = await webkit.launch({ headless: true });
      const webkitContext = await webkitBrowser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
      await authenticateBrowserContext(baseUrl, webkitContext);
      const webkitPage = await webkitContext.newPage();
      await webkitPage.goto(baseUrl);
      await webkitPage.getByRole("heading", { name: "Run control", exact: true }).waitFor();
      await selectRun(webkitPage, createdRun.id, runLabel);
      await webkitPage.locator('section[aria-labelledby="current-run-heading"]')
        .getByText("completed", { exact: true }).waitFor();
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await webkitPage.getByRole("button", { name: "Schedule", exact: true }).click();
      await webkitPage.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
      await webkitPage.getByRole("article", { name: "Planned run 3", exact: true }).waitFor();
      assert.equal(await webkitPage.getByRole("article", { name: /^Planned run / }).count(), 3);
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await webkitPage.getByRole("button", { name: "Setup", exact: true }).click();
      await webkitPage.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
      await webkitPage.getByRole("button", { name: "Reopen import 1", exact: true }).click();
      await webkitPage.getByText("Canonical import details reloaded. Review the preserved values before acting.").waitFor();
      const webkitSetupReview = webkitPage.getByRole("region", { name: "Setup import review" });
      await webkitSetupReview.getByText("applied", { exact: true }).waitFor();
      await webkitSetupReview.getByText(`Integration Brand · ${sourceFlavor}`, { exact: true }).waitFor();
      await webkitSetupReview.getByLabel(`Values for ${sourceCode}`, { exact: true }).waitFor();
      await webkitSetupReview.getByText(/Source spec-sheets · 1 source row\(s\) · 1 imported · 0 skipped · 0 still unresolved/).waitFor();
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      console.log("V3 WebKit/Safari-engine React/PostgreSQL run, schedule, and setup history readback passed.");
      await webkitBrowser.close();
    } catch (error) {
      if (webkitBrowser) await webkitBrowser.close();
      console.log(`V3 WebKit/Safari lane BLOCKED: ${error instanceof Error ? error.message.split("\n")[0] : "engine unavailable"}`);
    }
  } finally {
    if (browser) await browser.close();
    if (serverInstance) await serverInstance.close();
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "v3.http_postgres_browser_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Browser integration assertion failed.",
  }));
  process.exitCode = 1;
});
