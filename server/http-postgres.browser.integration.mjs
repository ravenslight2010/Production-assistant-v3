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
  let loseRunToTimeResponse = false;
  const runToTimeRequests = [];
  let loseOperationResponse = false;
  const operationRequests = [];
  let loseScheduleUpdateResponse = false;
  let loseSetupStageResponse = false;
  let setupImportId;
  let setupStageRequestBody;
  let loseOpeningStageResponse = false;
  let openingCountId;
  let openingStageRequestBody;
  let loseSurplusConfirmResponse = false;
  let surplusLotId;
  let surplusConfirmRequestBody;
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
    await context.route("**/api/v3/runs/*/run-to-time", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        runToTimeRequests.push(body);
        assert.deepEqual(Object.keys(body).sort(), ["commandId", "expectedRevision", "runToTime"]);
        if (loseRunToTimeResponse) {
          loseRunToTimeResponse = false;
          const committed = await route.fetch();
          assert.equal(committed.status(), 200, await committed.text());
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic Run to Time response loss after the disposable database commit." }),
          });
          return;
        }
      }
      await route.continue();
    });
    await context.route("**/api/v3/runs/*/operations/commands", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        operationRequests.push(body);
        assert.deepEqual(Object.keys(body).sort(), ["commandId", "commandType", "details", "expectedRevision"]);
        if (loseOperationResponse && body.commandType === "start_stop") {
          loseOperationResponse = false;
          const committed = await route.fetch();
          assert.equal(committed.status(), 200, await committed.text());
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic operational response loss after the disposable database commit." }),
          });
          return;
        }
      }
      await route.continue();
    });
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

    await page.route("**/api/v3/inventory/opening-counts", async (route) => {
      if (loseOpeningStageResponse && route.request().method() === "POST") {
        loseOpeningStageResponse = false;
        openingStageRequestBody = route.request().postDataJSON();
        const committed = await route.fetch();
        assert.equal(committed.status(), 201, await committed.text());
        openingCountId = (await committed.json()).countId;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic opening-count response loss after the disposable database commit." }),
        });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/v3/inventory/freezer-surplus/confirm", async (route) => {
      if (loseSurplusConfirmResponse && route.request().method() === "POST") {
        loseSurplusConfirmResponse = false;
        surplusConfirmRequestBody = route.request().postDataJSON();
        const committed = await route.fetch();
        assert.equal(committed.status(), 200, await committed.text());
        surplusLotId = (await committed.json()).lotId;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic surplus response loss after the disposable database commit." }),
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

    const runToTimePath = `/api/v3/runs/${createdRun.id}/run-to-time`;
    const runToTime = page.locator('section[aria-labelledby="run-to-time-heading"]');
    const targetInput = runToTime.getByLabel("Target time (Central)", { exact: true });
    await targetInput.waitFor();
    assert.equal(await targetInput.inputValue(), "19:15");
    await runToTime.getByText("Informational only; it never starts runs or advances worker progress.", { exact: false }).waitFor();
    loseRunToTimeResponse = true;
    await targetInput.fill("6:45 PM");
    const lostTargetResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === runToTimePath && response.request().method() === "POST");
    await runToTime.getByRole("button", { name: "Save target", exact: true }).click();
    const lostTargetResponse = await lostTargetResponsePromise;
    assert.equal(lostTargetResponse.status(), 500);
    await runToTime.getByRole("alert").filter({ hasText: "Synthetic Run to Time response loss" }).waitFor();
    const retryTargetResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === runToTimePath && response.request().method() === "POST");
    await runToTime.getByRole("button", { name: "Save target", exact: true }).click();
    const retryTargetResponse = await retryTargetResponsePromise;
    assert.equal(retryTargetResponse.status(), 200);
    const retryTargetBody = await retryTargetResponse.json();
    assert.equal(retryTargetBody.replayed, true);
    assert.equal(retryTargetBody.run.runToTime, "18:45");
    await page.getByRole("status").filter({ hasText: "Run to Time confirmed for 6:45 PM Central." }).waitFor();
    assert.equal(runToTimeRequests.length, 2);
    assert.equal(runToTimeRequests[0].commandId, runToTimeRequests[1].commandId);
    assert.equal(runToTimeRequests[0].expectedRevision, 0);
    assert.equal(runToTimeRequests[1].expectedRevision, 0);

    await page.reload();
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await selectRun(page, createdRun.id, runLabel);
    await targetInput.waitFor();
    assert.equal(await targetInput.inputValue(), "18:45");
    const writesBeforeRunToTimeOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await runToTime.getByText("Reconnect to change the server-owned target.", { exact: true }).waitFor();
    assert.equal(await targetInput.isDisabled(), true);
    assert.equal(await runToTime.getByRole("button", { name: "Save target", exact: true }).isDisabled(), true);
    assert.equal(await runToTime.getByRole("button", { name: "Reset to 7:15 PM", exact: true }).isDisabled(), true);
    assert.equal(browserWrites.length, writesBeforeRunToTimeOffline, "offline Run to Time mode must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await runToTime.getByText("Reconnect to change the server-owned target.", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await targetInput.isDisabled(), false);
    assert.equal(await targetInput.inputValue(), "18:45");

    const startResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/runs/${createdRun.id}/commands`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "start", exact: true }).click();
    const startResponse = await startResponsePromise;
    assert.equal(startResponse.status(), 200);
    const startedRun = (await startResponse.json()).run;
    assert.equal(startedRun.status, "running");
    assert.equal(startedRun.revision, 2);
    await page.getByText("start confirmed by the server.").waitFor();

    await page.getByLabel("Cases Produced", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Save station update", exact: true }).click();
    await page.getByText("Station change confirmed by the server.").waitFor();

    const secondPage = await context.newPage();
    observePage(secondPage);
    await secondPage.goto(baseUrl);
    await selectRun(secondPage, createdRun.id, runLabel);
    assert.equal(await secondPage.getByLabel("Cases Produced", { exact: true }).inputValue(), "2");
    const targetStalePage = await context.newPage();
    observePage(targetStalePage);
    await targetStalePage.goto(baseUrl);
    await selectRun(targetStalePage, createdRun.id, runLabel);

    await page.getByLabel("Cases Produced", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Save station update", exact: true }).click();
    await page.getByText("Station change confirmed by the server.").waitFor();
    await secondPage.getByLabel("Cases Produced", { exact: true }).fill("1");
    await secondPage.getByRole("button", { name: "Save station update", exact: true }).click();
    await secondPage.getByText("Stale station change discarded; the latest server state is now displayed.").waitFor();
    assert.equal(await secondPage.getByLabel("Cases Produced", { exact: true }).inputValue(), "3");

    const staleRunToTime = targetStalePage.locator('section[aria-labelledby="run-to-time-heading"]');
    const staleTargetInput = staleRunToTime.getByLabel("Target time (Central)", { exact: true });
    await staleTargetInput.fill("8:00 PM");
    const staleTargetResponsePromise = targetStalePage.waitForResponse((response) =>
      new URL(response.url()).pathname === runToTimePath && response.request().method() === "POST");
    await staleRunToTime.getByRole("button", { name: "Save target", exact: true }).click();
    const staleTargetResponse = await staleTargetResponsePromise;
    assert.equal(staleTargetResponse.status(), 409);
    await targetStalePage.getByRole("status").filter({ hasText: "Run to Time changed elsewhere; the latest server state is now displayed." }).waitFor();
    assert.equal(await staleTargetInput.inputValue(), "18:45");
    await targetStalePage.close();

    const resetTargetResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === runToTimePath && response.request().method() === "POST");
    await runToTime.getByRole("button", { name: "Reset to 7:15 PM", exact: true }).click();
    const resetTargetResponse = await resetTargetResponsePromise;
    assert.equal(resetTargetResponse.status(), 200);
    assert.equal((await resetTargetResponse.json()).run.runToTime, "19:15");
    await page.getByRole("status").filter({ hasText: "Run to Time confirmed for 7:15 PM Central." }).waitFor();
    assert.equal(runToTimeRequests.length, 4);
    assert.notEqual(runToTimeRequests[3].commandId, runToTimeRequests[0].commandId);

    const operations = page.locator('section[aria-labelledby="operations-heading"]');
    const operationPath = `/api/v3/runs/${createdRun.id}/operations/commands`;
    const submitOperation = async (targetPage, commandType, action) => {
      const responsePromise = targetPage.waitForResponse((response) =>
        new URL(response.url()).pathname === operationPath
        && response.request().method() === "POST"
        && response.request().postDataJSON().commandType === commandType);
      await action();
      const response = await responsePromise;
      const body = await response.json();
      assert.notEqual(response.status(), 400, `${commandType} was rejected: ${JSON.stringify(body)}; request=${JSON.stringify(response.request().postDataJSON())}; runStartedAt=${startedRun.startedAt}`);
      return { response, body };
    };

    await operations.getByLabel(/^Reason/).selectOption("Equipment jam");
    await operations.getByLabel("Notes", { exact: true }).fill("Real database infeed stop");
    loseOperationResponse = true;
    const lostStop = await submitOperation(page, "start_stop", () =>
      operations.getByRole("button", { name: "Start line stop", exact: true }).click());
    assert.equal(lostStop.response.status(), 500);
    await operations.getByRole("alert").filter({ hasText: "Synthetic operational response loss" }).waitFor();
    const retryStop = await submitOperation(page, "start_stop", () =>
      operations.getByRole("button", { name: "Start line stop", exact: true }).click());
    assert.equal(retryStop.response.status(), 200, JSON.stringify(retryStop.body));
    assert.equal(retryStop.body.replayed, true);
    assert.equal(retryStop.body.run.stoppages.length, 1);
    assert.equal(operationRequests.length, 2);
    assert.equal(operationRequests[0].commandId, operationRequests[1].commandId);
    assert.equal(operationRequests[0].expectedRevision, operationRequests[1].expectedRevision);
    const activeStop = operations.locator('article[data-stoppage-type="stop"]');
    await activeStop.getByText("Real database infeed stop", { exact: true }).waitFor();
    const endedStop = await submitOperation(page, "end_stop", () =>
      activeStop.getByRole("button", { name: "End stop", exact: true }).click());
    assert.equal(endedStop.response.status(), 200);
    assert.ok(endedStop.body.run.stoppages[0].endedAt);

    await operations.getByRole("button", { name: "Add past event", exact: true }).click();
    const pastForm = operations.getByRole("form", { name: "Past stoppage", exact: true });
    const localDateTime = async (iso) => page.evaluate((value) => {
      const date = new Date(value);
      return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    }, iso);
    const pastStart = await localDateTime(new Date(Date.parse(startedRun.startedAt) + 1000).toISOString());
    const pastEnd = await localDateTime(new Date(Date.parse(startedRun.startedAt) + 2000).toISOString());
    await pastForm.getByLabel(/^Reason/).selectOption("Break");
    await pastForm.getByLabel("Notes", { exact: true }).fill("Real database crew rotation");
    await pastForm.getByLabel("Started", { exact: true }).fill(pastStart);
    await pastForm.getByLabel("Ended", { exact: true }).fill(pastEnd);
    const pastStop = await submitOperation(page, "add_past_stop", () =>
      pastForm.getByRole("button", { name: "Record past event", exact: true }).click());
    assert.equal(pastStop.response.status(), 200, JSON.stringify(pastStop.body));
    const manual = operations.locator('article[data-stoppage-type="manual"]');
    await manual.getByText("Real database crew rotation", { exact: true }).waitFor();
    await manual.getByRole("button", { name: "Edit", exact: true }).click();
    const editStoppage = operations.getByRole("form", { name: "Edit stoppage", exact: true });
    await editStoppage.getByLabel("Notes", { exact: true }).fill("Corrected real database crew rotation");
    const editedStop = await submitOperation(page, "update_stoppage", () =>
      editStoppage.getByRole("button", { name: "Save stoppage", exact: true }).click());
    assert.equal(editedStop.response.status(), 200, JSON.stringify(editedStop.body));
    await manual.getByText("Corrected real database crew rotation", { exact: true }).waitFor();
    const deletedStop = await submitOperation(page, "delete_stoppage", () =>
      manual.getByRole("button", { name: "Delete", exact: true }).click());
    assert.equal(deletedStop.response.status(), 200);
    await manual.waitFor({ state: "detached" });
    const persistedManual = await adminPool.query(
      "SELECT voided_at IS NOT NULL AS voided FROM v3.run_stoppages WHERE id = $1",
      [pastStop.body.run.stoppages.find((item) => item.type === "manual").id],
    );
    assert.equal(persistedManual.rows[0].voided, true, "manual deletion must retain its audited row");

    const operationsStalePage = await context.newPage();
    observePage(operationsStalePage);
    await operationsStalePage.goto(baseUrl);
    await selectRun(operationsStalePage, createdRun.id, runLabel);
    const staleOperations = operationsStalePage.locator('section[aria-labelledby="operations-heading"]');
    const operationalHandoff = `Real database operational handoff ${suffix}`;
    await operations.getByLabel("Run notes", { exact: true }).fill(operationalHandoff);
    const savedNotes = await submitOperation(page, "set_notes", () =>
      operations.getByRole("button", { name: "Save run notes", exact: true }).click());
    assert.equal(savedNotes.response.status(), 200);
    await staleOperations.getByLabel("Run notes", { exact: true }).fill("Stale operational overwrite");
    const staleNotes = await submitOperation(operationsStalePage, "set_notes", () =>
      staleOperations.getByRole("button", { name: "Save run notes", exact: true }).click());
    assert.equal(staleNotes.response.status(), 409);
    await operationsStalePage.getByRole("status").filter({ hasText: "Stale operational change discarded; the latest server state is now displayed." }).waitFor();
    assert.equal(await staleOperations.getByLabel("Run notes", { exact: true }).inputValue(), operationalHandoff);
    await operationsStalePage.close();

    const customReason = `Custom hold ${suffix}`;
    await operations.getByRole("button", { name: "Edit stop reasons", exact: true }).click();
    const stopReasonEditor = operations.getByLabel("Stop reasons, one per line", { exact: true });
    const existingReasons = (await stopReasonEditor.inputValue()).split("\n");
    await stopReasonEditor.fill([...existingReasons, customReason].join("\n"));
    const reasonResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/operations/stop-reasons" && response.request().method() === "POST");
    await operations.getByRole("button", { name: "Save stop reasons", exact: true }).click();
    const reasonResponse = await reasonResponsePromise;
    assert.equal(reasonResponse.status(), 200, await reasonResponse.text());
    const savedReasons = (await reasonResponse.json()).settings;
    assert.ok(savedReasons.reasons.includes(customReason));

    await page.reload();
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await selectRun(page, createdRun.id, runLabel);
    assert.equal(await operations.getByLabel("Run notes", { exact: true }).inputValue(), operationalHandoff);
    await operations.locator('article[data-stoppage-type="stop"]').getByText("Real database infeed stop", { exact: true }).waitFor();
    assert.equal(await operations.locator('article[data-stoppage-type="manual"]').count(), 0);
    const writesBeforeOperationsOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.getByText("Read-only offline", { exact: true }).first().waitFor();
    assert.equal(await operations.getByRole("button", { name: "Start line stop", exact: true }).isDisabled(), true);
    assert.equal(await operations.getByRole("button", { name: "Add past event", exact: true }).isDisabled(), true);
    assert.equal(await operations.getByLabel("Run notes", { exact: true }).isDisabled(), true);
    assert.equal(browserWrites.length, writesBeforeOperationsOffline, "offline operations must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await page.getByText("Connected", { exact: true }).first().waitFor();

    const lifecycle = async (command, expectedStatus) => {
      const commandResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v3/runs/${createdRun.id}/commands`
        && response.request().method() === "POST"
        && response.request().postDataJSON().commandType === command);
      await page.getByRole("button", { name: command, exact: true }).click();
      const commandResponse = await commandResponsePromise;
      assert.equal(commandResponse.status(), 200, `${command} should be accepted by PostgreSQL`);
      const body = await commandResponse.json();
      assert.equal(body.run.status, expectedStatus);
      return body;
    };

    await lifecycle("pause", "paused");
    await operations.getByText("Tunnel stopped by default", { exact: true }).waitFor();
    const tunnelOverride = await submitOperation(page, "set_pause_tunnel", () =>
      operations.getByRole("button", { name: "Keep tunnel running", exact: true }).click());
    assert.equal(tunnelOverride.response.status(), 200, JSON.stringify(tunnelOverride.body));
    assert.equal(tunnelOverride.body.run.stoppages.find((item) => item.type === "pause" && item.endedAt === null).stopTunnel, false);
    await operations.getByText(/Operator override confirmed: line and packaging automatic progress continue/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Start run to edit stations", exact: true }).isDisabled(), true);

    for (const stationKey of ["line", "packaging", "dough"]) {
      await adminPool.query(`
        INSERT INTO v3.run_station_progress (
          facility_id, run_id, station_key, status, revision, inputs, progress, next_due_at, updated_at
        )
        SELECT facility_id, id, $2, 'not_started', 0,
          jsonb_build_object('autoTrackRatePerMinute', 60),
          jsonb_build_object(
            'autoTrackLastAt', to_char((clock_timestamp() - interval '30 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'autoTrackRemainder', 0
          ),
          clock_timestamp() - interval '1 second', clock_timestamp()
        FROM v3.runs WHERE id = $1
        ON CONFLICT (facility_id, run_id, station_key) DO UPDATE SET
          inputs = EXCLUDED.inputs,
          progress = run_station_progress.progress || EXCLUDED.progress,
          next_due_at = EXCLUDED.next_due_at,
          updated_at = EXCLUDED.updated_at
      `, [createdRun.id, stationKey]);
    }
    const dueDuringOverride = await adminPool.query(
      "SELECT station_key FROM v3.list_due_station_auto_track(20) WHERE run_id = $1 ORDER BY station_key",
      [createdRun.id],
    );
    assert.deepEqual(dueDuringOverride.rows.map((row) => row.station_key), ["line", "packaging"]);
    await lifecycle("resume", "running");

    const latePaused = await lifecycle("pause", "paused");
    const latePause = latePaused.run.stoppages.find((item) => item.type === "pause" && item.endedAt === null);
    await adminPool.query(
      "UPDATE v3.run_pause_intervals SET paused_at = clock_timestamp() - interval '11 seconds' WHERE id = $1",
      [latePause.id],
    );
    await page.reload();
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await selectRun(page, createdRun.id, runLabel);
    await operations.getByText("The 10-second tunnel decision window has closed.", { exact: true }).waitFor();
    assert.equal(await operations.getByRole("button", { name: "Keep tunnel running", exact: true }).isDisabled(), true);
    const lateOverride = await page.evaluate(async ({ path, expectedRevision, stoppageId }) => {
      const csrf = document.cookie.split("; ").find((value) => value.startsWith("v3_csrf="))?.slice("v3_csrf=".length) ?? "";
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
        body: JSON.stringify({
          commandId: crypto.randomUUID(), commandType: "set_pause_tunnel", expectedRevision,
          details: { stoppageId, stopTunnel: false },
        }),
      });
      return { status: response.status, body: await response.json() };
    }, { path: operationPath, expectedRevision: latePaused.run.revision, stoppageId: latePause.id });
    assert.equal(lateOverride.status, 409);
    assert.equal(lateOverride.body.outcome, "invalid_transition");
    await lifecycle("resume", "running");

    await operations.getByLabel(/^Reason/).selectOption(customReason);
    await operations.getByLabel("Notes", { exact: true }).fill("Close this stop with run completion");
    const completionStop = await submitOperation(page, "start_stop", () =>
      operations.getByRole("button", { name: "Start line stop", exact: true }).click());
    assert.equal(completionStop.response.status(), 200);
    const completed = await lifecycle("complete", "completed");
    assert.ok(completed.run.inventoryConsumption, "completion should return its exact-once inventory receipt");
    assert.ok(["completed", "shortage"].includes(completed.run.inventoryConsumption.status));
    assert.ok(completed.run.stoppages.every((item) => item.endedAt !== null), "completion must close every open operational record");
    await page.getByText("Completion inventory receipt recorded; consumption is exact-once.").waitFor();

    await page.reload();
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await selectRun(page, createdRun.id, runLabel);
    const currentRun = page.locator('section[aria-labelledby="current-run-heading"]');
    await currentRun.getByText("completed", { exact: true }).waitFor();
    await currentRun.getByText("Revision", { exact: true }).waitFor();
    await runToTime.getByText("Completed runs are read-only.", { exact: true }).waitFor();
    assert.equal(await targetInput.inputValue(), "19:15");
    assert.equal(await targetInput.isDisabled(), true);
    assert.equal(await runToTime.getByRole("button", { name: "Save target", exact: true }).isDisabled(), true);
    assert.equal(await runToTime.getByRole("button", { name: "Reset to 7:15 PM", exact: true }).isDisabled(), true);
    assert.equal(await operations.getByLabel("Run notes", { exact: true }).inputValue(), operationalHandoff);
    assert.equal(await operations.getByLabel("Run notes", { exact: true }).isDisabled(), true);
    assert.equal(await operations.getByRole("button", { name: "Start line stop", exact: true }).isDisabled(), true);
    assert.equal(await operations.getByRole("button", { name: "Add past event", exact: true }).isDisabled(), true);
    assert.equal(await operations.getByRole("button", { name: "End stop", exact: true }).count(), 0);
    await operations.getByText("Close this stop with run completion", { exact: true }).waitFor();

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
    await page.getByText(/Workbook reviewed\. Nothing has been staged or applied/).waitFor();
    const importRow = page.getByRole("article", { name: "Import review row 2", exact: true });
    await importRow.getByLabel(/Product ·/).selectOption("DOUGH-A");
    await importRow.getByLabel("Production setup for import row 2", { exact: true }).selectOption("LINE-A");
    await importRow.getByLabel(/Run template ·/).selectOption("SCHEDULE-TEMPLATE");
    const stageScheduleResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/schedules/imports"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Stage 1 reviewed row(s) without changing schedules", exact: true }).click();
    const stageScheduleResponse = await stageScheduleResponsePromise;
    const stageScheduleBody = await stageScheduleResponse.json();
    assert.equal(stageScheduleResponse.status(), 200, JSON.stringify({ body: stageScheduleBody, request: stageScheduleResponse.request().postDataJSON() }));
    const stagedScheduleImport = stageScheduleBody.import;
    assert.equal(stagedScheduleImport.source.fileName, "schedule-browser-integration.xlsx");
    assert.match(stagedScheduleImport.source.sha256, /^[0-9a-f]{64}$/);
    assert.equal(stagedScheduleImport.source.parserVersion, "v1-schedule-import/1");
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 2, "canonical staging must not change the schedule");

    const applyScheduleImport = async () => {
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v3/schedules/imports/${stagedScheduleImport.importId}/apply`
        && response.request().method() === "POST");
      await page.getByRole("button", { name: `Apply canonical rows to ${SCHEDULE_DATE}`, exact: true }).click();
      const response = await responsePromise;
      const body = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(body));
      assert.equal(body.outcome, "accepted");
    };
    await applyScheduleImport();
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 3);
    assert.equal(confirmedSchedule.runs[2].targetCases, 6);
    assert.equal(confirmedSchedule.runs[2].notes, "Real database import");

    const undoScheduleResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/schedules/imports/${stagedScheduleImport.importId}/undo`
      && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `Undo unchanged created runs for ${SCHEDULE_DATE}`, exact: true }).click();
    const undoScheduleResponse = await undoScheduleResponsePromise;
    const undoScheduleBody = await undoScheduleResponse.json();
    assert.equal(undoScheduleResponse.status(), 200, JSON.stringify(undoScheduleBody));
    assert.equal(undoScheduleBody.outcome, "accepted");
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 2, "guarded Undo removes only the created run");
    await applyScheduleImport();
    confirmedSchedule = await scheduleRead();
    assert.equal(confirmedSchedule.runs.length, 3, "canonical rows support reapply after Undo");

    await page.reload();
    await page.getByRole("heading", { name: "Production schedule", exact: true }).waitFor();
    await page.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
    await page.getByRole("article", { name: "Planned run 3", exact: true }).waitFor();
    assert.equal(await page.getByRole("article", { name: /^Planned run / }).count(), 3);
    await page.getByRole("button", { name: new RegExp(`Open schedule import schedule-browser-integration\\.xlsx ${stagedScheduleImport.importId}`) }).click();
    const reopenedScheduleImport = page.getByTestId("canonical-schedule-import");
    await reopenedScheduleImport.waitFor();
    await reopenedScheduleImport.getByText(stagedScheduleImport.source.sha256, { exact: false }).waitFor();
    await reopenedScheduleImport.getByText("Real database import", { exact: false }).waitFor();
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

    const masterRecordsRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/imports/records?kind=recipes&limit=100`);
      assert.equal(response.status(), 200);
      return (await response.json()).records;
    };
    const eligibleMasterRecords = await masterRecordsRead();
    assert.equal(eligibleMasterRecords.some((record) => record.code === "DOUGH-A-RECIPE"), false,
      "legacy ingredient recipes must not open in the dough-capacity editor");
    assert.ok(eligibleMasterRecords.every((record) => record.data.sourceFamily === "dough-procedure"));
    const initialMasterRecord = eligibleMasterRecords.find((record) => record.data.doughballYield === 645.19);
    assert.ok(initialMasterRecord, "the imported dough-capacity record must be available to the browser editor");
    const masterCode = initialMasterRecord.code;
    const masterEditor = page.getByRole("region", { name: "Dough yield and shipping capacity", exact: true });
    const masterCard = masterEditor.getByRole("article").filter({ hasText: masterCode });
    await masterCard.getByRole("heading", { name: initialMasterRecord.name, exact: true }).waitFor();
    await masterCard.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await masterEditor.getByLabel("Doughball yield", { exact: true }).inputValue(), "645.19");
    await masterEditor.getByLabel("Doughball yield", { exact: true }).fill("650");
    const stageMasterResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/imports/edits" && response.request().method() === "POST");
    await masterEditor.getByRole("button", { name: "Stage capacity edit", exact: true }).click();
    const stageMasterResponse = await stageMasterResponsePromise;
    assert.equal(stageMasterResponse.status(), 201, await stageMasterResponse.text());
    const masterImportId = (await stageMasterResponse.json()).importId;
    const productReview = page.getByRole("region", { name: "Product setup review", exact: true });
    await productReview.getByLabel(`Before product values for ${masterCode}`, { exact: true }).waitFor();
    assert.match(await productReview.getByLabel(`Product values for ${masterCode}`, { exact: true }).textContent(), /650/u);
    assert.equal((await masterRecordsRead()).find((record) => record.code === masterCode).data.doughballYield, 645.19,
      "typed product staging must not mutate the canonical master record");
    const applyMasterResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/imports/${masterImportId}/apply` && response.request().method() === "POST");
    await productReview.getByRole("button", { name: "Apply reviewed product setup", exact: true }).click();
    assert.equal((await applyMasterResponsePromise).status(), 200);
    await page.getByText(/Product setup import applied\. Catalog records were not changed by this action\./).waitFor();
    assert.equal((await masterRecordsRead()).find((record) => record.code === masterCode).data.doughballYield, 650);
    page.once("dialog", (dialog) => dialog.accept());
    const undoMasterResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/imports/${masterImportId}/undo` && response.request().method() === "POST");
    await productReview.getByRole("button", { name: "Undo applied product setup", exact: true }).click();
    assert.equal((await undoMasterResponsePromise).status(), 200);
    await page.getByText(/Product setup import undone\./).waitFor();
    assert.equal((await masterRecordsRead()).find((record) => record.code === masterCode).data.doughballYield, 645.19);

    const recipeName = `Browser PostgreSQL Dough ${suffix}`;
    const variantLabel = `Browser 16 ${suffix}`;
    await page.locator("#setup-catalog-family").selectOption("manager-lists");
    const setup2Catalog = page.getByRole("region", { name: "Named recipes and directories", exact: true });
    await setup2Catalog.getByRole("button", { name: "Create record", exact: true }).click();
    await setup2Catalog.locator("form select").first().selectOption("run-calc-dough-recipe-presets");
    await setup2Catalog.getByRole("button", { name: "Add named recipe", exact: true }).click();
    const recipeEditor = setup2Catalog.getByRole("article", { name: "Named recipe 1", exact: true });
    await recipeEditor.getByLabel("Recipe name", { exact: true }).fill(recipeName);
    await recipeEditor.getByLabel("Premade crust", { exact: true }).check();
    await recipeEditor.getByRole("button", { name: "Add recipe ingredient", exact: true }).click();
    await recipeEditor.getByLabel("Ingredient", { exact: true }).fill("Browser recipe flour");
    await recipeEditor.getByLabel("Pounds", { exact: true }).fill("25");
    await recipeEditor.getByRole("button", { name: "Add doughball variant", exact: true }).click();
    await recipeEditor.getByLabel("Variant label", { exact: true }).fill(variantLabel);
    await recipeEditor.getByLabel("Weight oz (optional)", { exact: true }).fill("16");
    await recipeEditor.getByLabel("Per tray (optional)", { exact: true }).fill("12");
    await recipeEditor.getByRole("button", { name: "Add customer pairing", exact: true }).click();
    await recipeEditor.getByLabel("Brand", { exact: true }).fill("Integration Brand");
    await recipeEditor.getByLabel("Flavor", { exact: true }).fill(sourceFlavor);
    const stageRecipeResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/setup-catalog/edits" && response.request().method() === "POST");
    await setup2Catalog.getByRole("button", { name: "Stage typed edit", exact: true }).click();
    const stageRecipeResponse = await stageRecipeResponsePromise;
    assert.equal(stageRecipeResponse.status(), 201, await stageRecipeResponse.text());
    const recipeImportId = (await stageRecipeResponse.json()).importId;
    await setupReview.getByLabel("Values for run-calc-dough-recipe-presets", { exact: true }).waitFor();
    assert.match(await setupReview.getByLabel("Values for run-calc-dough-recipe-presets", { exact: true }).textContent(), new RegExp(variantLabel));
    const applyRecipeResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${recipeImportId}/apply` && response.request().method() === "POST");
    await setupReview.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    assert.equal((await applyRecipeResponsePromise).status(), 200);
    const recipeRecordsResponse = await page.request.get(`${baseUrl}/api/v3/setup-catalog/records?family=manager-lists&limit=100`);
    assert.equal(recipeRecordsResponse.status(), 200);
    const appliedRecipe = (await recipeRecordsResponse.json()).records
      .find((record) => record.code === "run-calc-dough-recipe-presets").data.value[recipeName];
    assert.equal(appliedRecipe.isPremadeCrust, true);
    assert.deepEqual(appliedRecipe.rows, [{ ingredient: "Browser recipe flour", lbs: 25 }]);
    assert.deepEqual(appliedRecipe.doughballVariants, [{
      label: variantLabel, weightOz: 16, perTray: 12,
      customers: [{ brand: "Integration Brand", flavor: sourceFlavor }],
    }]);
    assert.equal((await masterRecordsRead()).find((record) => record.code === masterCode).data.doughballYield, 645.19,
      "catalog Apply must not change product setup");

    const allergenCode = `ALLERGEN-${suffix}`;
    const allergenName = `Browser fixed-nine ingredient ${suffix}`;
    await page.locator("#setup-catalog-family").selectOption("ingredients");
    const allergenCatalog = page.getByRole("region", { name: "Ingredients and allergens", exact: true });
    await allergenCatalog.getByRole("button", { name: "Create record", exact: true }).click();
    await allergenCatalog.getByLabel("Code", { exact: true }).fill(allergenCode);
    await allergenCatalog.getByLabel("Name", { exact: true }).fill(allergenName);
    await allergenCatalog.getByLabel("wheat", { exact: true }).check();
    await allergenCatalog.getByLabel("Allergen mapping reviewed", { exact: true }).check();
    const stageAllergenResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/setup-catalog/edits" && response.request().method() === "POST");
    await allergenCatalog.getByRole("button", { name: "Stage typed edit", exact: true }).click();
    const stageAllergenResponse = await stageAllergenResponsePromise;
    assert.equal(stageAllergenResponse.status(), 201, await stageAllergenResponse.text());
    const allergenImportId = (await stageAllergenResponse.json()).importId;
    const applyAllergenResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${allergenImportId}/apply` && response.request().method() === "POST");
    await setupReview.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    assert.equal((await applyAllergenResponsePromise).status(), 200);
    const allergenRecord = await setupRecordRead();
    assert.equal(allergenRecord.length, 0, "the prior undone ingredient must remain absent");
    const allergenRecordsResponse = await page.request.get(`${baseUrl}/api/v3/setup-catalog/records?family=ingredients&limit=100`);
    const appliedAllergen = (await allergenRecordsResponse.json()).records.find((record) => record.code === allergenCode);
    assert.deepEqual(appliedAllergen.data.allergens, ["wheat"]);
    assert.equal(appliedAllergen.data.allergensReviewed, true);

    const typedCode = `TYPED-${suffix}`;
    const typedOriginalName = `Typed browser die ${suffix}`;
    const typedRevisedName = `${typedOriginalName} revised`;
    const typedStaleName = `${typedOriginalName} stale overwrite`;
    const typedCatalog = page.locator('section[aria-labelledby="typed-catalog-heading"]');
    const reviewedDefaultsPanel = page.locator('section[aria-labelledby="reviewed-die-defaults-heading"]');
    const typedRecordsRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/setup-catalog/records?family=die-types&limit=100`);
      assert.equal(response.status(), 200);
      return (await response.json()).records;
    };
    const reopenSetupImport = async (importId) => {
      const imports = await setupHistoryRead();
      const index = imports.findIndex((item) => item.id === importId);
      assert.ok(index >= 0, "the typed edit must be discoverable in canonical setup history");
      await page.getByRole("article", { name: `Setup import history ${index + 1}`, exact: true })
        .getByRole("button").click();
      await page.getByText("Canonical import details reloaded. Review the preserved values before acting.").waitFor();
    };

    await page.locator("#setup-catalog-family").selectOption("die-types");
    await typedCatalog.getByRole("button", { name: "Create record", exact: true }).click();
    await typedCatalog.getByLabel("Code", { exact: true }).fill(typedCode);
    await typedCatalog.getByLabel("Name", { exact: true }).fill(typedOriginalName);
    const typedCreateResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/setup-catalog/edits" && response.request().method() === "POST");
    await typedCatalog.getByRole("button", { name: "Stage typed edit", exact: true }).click();
    const typedCreateResponse = await typedCreateResponsePromise;
    assert.equal(typedCreateResponse.status(), 201, await typedCreateResponse.text());
    const typedCreateId = (await typedCreateResponse.json()).importId;
    await page.getByText(/Typed edit staged\. Review the stored records; no setup values have been applied\./).waitFor();
    await setupReview.getByText(typedOriginalName, { exact: true }).waitFor();
    await setupReview.getByLabel(`Values for ${typedCode}`, { exact: true }).waitFor();
    assert.equal(await setupReview.getByLabel(`Before values for ${typedCode}`, { exact: true }).count(), 0,
      "a typed creation has no canonical before record");
    assert.equal((await typedRecordsRead()).some((record) => record.code === typedCode), false,
      "typed staging must not mutate the canonical catalog");
    const applyTypedCreatePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${typedCreateId}/apply`
      && response.request().method() === "POST");
    await setupReview.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    assert.equal((await applyTypedCreatePromise).status(), 200);
    await page.getByText(/1 setup rows created and 0 updated\. Canonical history reloaded\./).waitFor();
    await typedCatalog.getByRole("heading", { name: typedOriginalName, exact: true }).waitFor();
    const typedCreatedRecord = (await typedRecordsRead()).find((record) => record.code === typedCode);
    assert.match(typedCreatedRecord?.fingerprint ?? "", /^[0-9a-f]{64}$/);

    const stageTypedUpdate = async (name) => {
      const card = typedCatalog.getByRole("article").filter({ hasText: typedCode });
      await card.getByRole("button", { name: "Edit", exact: true }).click();
      await typedCatalog.getByLabel("Name", { exact: true }).fill(name);
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/v3/setup-catalog/edits" && response.request().method() === "POST");
      await typedCatalog.getByRole("button", { name: "Stage typed edit", exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 201, await response.text());
      return (await response.json()).importId;
    };
    const typedCurrentId = await stageTypedUpdate(typedRevisedName);
    await setupReview.getByText(typedRevisedName, { exact: true }).waitFor();
    await setupReview.getByText("Typed edit · canonical before", { exact: true }).waitFor();
    await setupReview.getByRole("heading", { name: typedOriginalName, exact: true }).waitFor();
    await setupReview.getByLabel(`Before values for ${typedCode}`, { exact: true }).waitFor();
    await setupReview.getByLabel(`Values for ${typedCode}`, { exact: true }).waitFor();
    await page.screenshot({ path: "/tmp/v3-setup-typed-review.png", fullPage: true });
    const typedStaleId = await stageTypedUpdate(typedStaleName);
    assert.notEqual(typedCurrentId, typedStaleId, "each typed edit needs its own staged review");
    await setupReview.getByText(typedStaleName, { exact: true }).waitFor();

    await reopenSetupImport(typedCurrentId);
    await setupReview.getByText(typedRevisedName, { exact: true }).waitFor();
    const applyTypedCurrentPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${typedCurrentId}/apply`
      && response.request().method() === "POST");
    await setupReview.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    assert.equal((await applyTypedCurrentPromise).status(), 200);
    await page.getByText(/0 setup rows created and 1 updated\. Canonical history reloaded\./).waitFor();
    assert.equal((await typedRecordsRead()).find((record) => record.code === typedCode)?.name, typedRevisedName);

    await reopenSetupImport(typedStaleId);
    await setupReview.getByText(typedStaleName, { exact: true }).waitFor();
    const applyTypedStalePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/setup-catalog/imports/${typedStaleId}/apply`
      && response.request().method() === "POST");
    await setupReview.getByRole("button", { name: "Apply reviewed import", exact: true }).click();
    assert.equal((await applyTypedStalePromise).status(), 409);
    await page.getByText(/Canonical details were reloaded; review them before retrying\./).waitFor();
    await setupReview.getByText("staged", { exact: true }).waitFor();
    await typedCatalog.getByRole("button", { name: "Refresh records", exact: true }).click();
    await typedCatalog.getByRole("heading", { name: typedRevisedName, exact: true }).waitFor();
    assert.equal(await typedCatalog.getByText(typedStaleName, { exact: true }).count(), 0,
      "a stale typed Apply must not overwrite the newer catalog value");

    await reviewedDefaultsPanel.getByRole("button", { name: "Refresh", exact: true }).click();
    const typedDieCard = reviewedDefaultsPanel.getByRole("article").filter({ hasText: `${typedCode} · revision` });
    await typedDieCard.getByText("unreviewed", { exact: true }).waitFor();
    await typedDieCard.getByRole("button", { name: "Review suggestion", exact: true }).click();
    const reviewedValues = {
      "Crusts per cycle": "2",
      "Cycle speed": "10",
      "Speed adjustment": "1",
      "Freezer time": "20",
      "Cases per layer": "4",
      "Pre-tunnel minutes": "1.5",
      "Post-tunnel minutes": "2.5",
      "Press oven minutes": "3.5",
      "Frontline minutes": "4.5",
    };
    for (const [label, value] of Object.entries(reviewedValues)) {
      await typedDieCard.getByLabel(label, { exact: true }).fill(value);
    }
    const saveReviewedDefaultsPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/die-defaults" && response.request().method() === "POST");
    await typedDieCard.getByRole("button", { name: "Save reviewed defaults", exact: true }).click();
    const saveReviewedDefaultsResponse = await saveReviewedDefaultsPromise;
    assert.equal(saveReviewedDefaultsResponse.status(), 201, await saveReviewedDefaultsResponse.text());
    await page.getByText(new RegExp(`Reviewed defaults for ${typedCode} are now active at revision 1\\.`)).waitFor();
    await typedDieCard.getByText(`${typedCode} · revision 1`, { exact: true }).waitFor();
    await typedDieCard.getByText("active", { exact: true }).waitFor();
    await reviewedDefaultsPanel.getByText(`${typedCode} · created · revision 1`, { exact: true }).waitFor();
    await page.screenshot({ path: "/tmp/v3-setup-reviewed-defaults.png", fullPage: true });

    const writesBeforeTypedOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
    assert.equal(await typedCatalog.getByRole("button", { name: "Create record", exact: true }).isDisabled(), true);
    assert.equal(await typedCatalog.getByRole("button", { name: "Refresh records", exact: true }).isDisabled(), true);
    assert.equal(await typedCatalog.getByRole("article").filter({ hasText: typedCode })
      .getByRole("button", { name: "Edit", exact: true }).isDisabled(), true);
    assert.equal(await reviewedDefaultsPanel.getByRole("button", { name: "Refresh", exact: true }).isDisabled(), true);
    assert.equal(await typedDieCard.getByRole("button", { name: "Edit reviewed defaults", exact: true }).isDisabled(), true);
    assert.equal(browserWrites.length, writesBeforeTypedOffline, "offline typed setup and reviewed defaults must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await page.getByText("Server-owned import lifecycle · manage-inventory", { exact: true }).waitFor();

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

    await page.getByRole("button", { name: "Inventory", exact: true }).click();
    await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
    const inventoryProductsResponse = await page.request.get(`${baseUrl}/api/v3/inventory/products`);
    assert.equal(inventoryProductsResponse.status(), 200);
    const inventoryProducts = (await inventoryProductsResponse.json()).products;
    assert.ok(inventoryProducts.length > 0);
    const countedProduct = inventoryProducts.find((product) => product.code === "CORN");
    assert.ok(countedProduct, "the run recipe's real inventory ingredient must be active");
    for (const heading of ["Reorder review", "Use first", "Warehouse needs", "Transfer guidance", "Reorder and expiry settings"]) {
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    }
    const guidanceBeforeSettings = await (await page.request.get(`${baseUrl}/api/v3/inventory/warehouse-guidance`)).json();
    const previousSettingsRevision = guidanceBeforeSettings.settings.revision;
    await page.getByLabel("Use-first expiry window (days)", { exact: true }).fill("9");
    await page.getByLabel(`Reorder threshold for ${countedProduct.name}`, { exact: true }).fill("2.5");
    const guidanceSettingsResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/warehouse-guidance" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save guidance settings", exact: true }).click();
    const guidanceSettingsResponse = await guidanceSettingsResponsePromise;
    assert.equal(guidanceSettingsResponse.status(), 200, await guidanceSettingsResponse.text());
    await page.getByText(/Reorder points and the 9-day use-first window were saved and reloaded/u).waitFor();
    const configuredGuidanceResponse = await page.request.get(`${baseUrl}/api/v3/inventory/warehouse-guidance`);
    const configuredGuidance = await configuredGuidanceResponse.json();
    assert.equal(configuredGuidance.settings.expirySoonDays, 9);
    assert.equal(configuredGuidance.settings.revision, previousSettingsRevision + 1);
    assert.equal(configuredGuidance.settings.reorderPoints[0].productId, countedProduct.id);
    assert.equal(configuredGuidance.settings.reorderPoints[0].threshold, "2.5");
    const openingCsv = [
      "product_code,quantity",
      ...inventoryProducts.map((product) => `${product.code},${product.code === countedProduct.code ? "12.5" : "0"}`),
    ].join("\n") + "\n";
    const warehouseName = `Browser PostgreSQL Warehouse ${suffix}`;
    await page.getByLabel("New warehouse name", { exact: true }).fill(warehouseName);
    const createWarehouseResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/warehouses" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create warehouse", exact: true }).click();
    const createWarehouseResponse = await createWarehouseResponsePromise;
    assert.equal(createWarehouseResponse.status(), 201, await createWarehouseResponse.text());
    const warehouseId = (await createWarehouseResponse.json()).warehouse.id;
    await page.getByText(/Warehouse created and available for inventory review\./).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "Warehouse", exact: true }).inputValue(), warehouseId);

    const openingDetailRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/inventory/opening-counts/${openingCountId}`);
      assert.equal(response.status(), 200);
      return (await response.json()).count;
    };
    const openingHistoryRead = async () => {
      const response = await page.request.get(`${baseUrl}/api/v3/inventory/opening-counts?limit=50`);
      assert.equal(response.status(), 200);
      return (await response.json()).counts;
    };
    await page.getByLabel("Opening count CSV", { exact: true }).setInputFiles({
      name: "opening-browser-integration.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(openingCsv),
    });
    loseOpeningStageResponse = true;
    await page.getByRole("button", { name: "Stage opening count", exact: true }).click();
    await page.getByText(/Retry the same request; its identity prevents duplicate writes/).waitFor();
    assert.match(openingCountId ?? "", /^[0-9a-f-]{36}$/);
    let openingDetail = await openingDetailRead();
    assert.equal(openingDetail.status, "staged");
    assert.equal(openingDetail.warehouseId, warehouseId);
    assert.equal(openingDetail.rows.find((row) => row.productCode === countedProduct.code).quantity, "12.5");
    assert.equal((await openingHistoryRead()).filter((item) => item.id === openingCountId).length, 1);
    const stagedBalances = await adminPool.query(
      "SELECT quantity FROM v3.inventory_balances WHERE warehouse_id = $1",
      [warehouseId],
    );
    assert.deepEqual(stagedBalances.rows, [], "opening-count staging must not mutate real stock");

    const retryOpeningResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/opening-counts"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).click();
    const retryOpeningResponse = await retryOpeningResponsePromise;
    assert.equal(retryOpeningResponse.status(), 200);
    assert.deepEqual(retryOpeningResponse.request().postDataJSON(), openingStageRequestBody,
      "the real opening-count retry must preserve request ID, warehouse, and CSV bytes");
    const retryOpeningBody = await retryOpeningResponse.json();
    assert.equal(retryOpeningBody.replayed, true);
    assert.equal(retryOpeningBody.countId, openingCountId);
    await page.getByText(/Previous request confirmed\. Opening count staged/).waitFor();
    assert.equal((await openingHistoryRead()).filter((item) => item.id === openingCountId).length, 1,
      "opening-count exact retry must not create a duplicate PostgreSQL row");
    const openingReview = page.getByRole("region", { name: "Opening count review", exact: true });
    await openingReview.getByText("staged", { exact: true }).waitFor();
    await openingReview.getByRole("cell", { name: "12.5", exact: true }).waitFor();

    const reviewOpeningResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/inventory/opening-counts/${openingCountId}/review`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Mark opening count reviewed", exact: true }).click();
    assert.equal((await reviewOpeningResponsePromise).status(), 200);
    await page.getByText(/Opening count marked reviewed\. It is ready for explicit Apply\./).waitFor();
    openingDetail = await openingDetailRead();
    assert.equal(openingDetail.status, "reviewed");
    const reviewedBalances = await adminPool.query(
      "SELECT quantity FROM v3.inventory_balances WHERE warehouse_id = $1",
      [warehouseId],
    );
    assert.deepEqual(reviewedBalances.rows, [], "Review must not apply real stock");

    const applyOpeningResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/inventory/opening-counts/${openingCountId}/apply`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Apply opening count", exact: true }).click();
    const applyOpeningResponse = await applyOpeningResponsePromise;
    assert.equal(applyOpeningResponse.status(), 200, await applyOpeningResponse.text());
    assert.equal((await applyOpeningResponse.json()).outcome, "applied");
    await page.getByText(/Opening count applied to warehouse stock\. Canonical history and quantities were reloaded\./).waitFor();
    openingDetail = await openingDetailRead();
    assert.equal(openingDetail.status, "applied");
    const appliedBalance = await adminPool.query(
      `SELECT balance.quantity::text AS quantity
       FROM v3.inventory_balances AS balance
       JOIN v3.products AS product
         ON product.facility_id = balance.facility_id AND product.id = balance.product_id
       WHERE balance.warehouse_id = $1 AND product.code = $2`,
      [warehouseId, countedProduct.code],
    );
    assert.equal(Number(appliedBalance.rows[0].quantity), 12.5);
    const stockResponse = await page.request.get(`${baseUrl}/api/v3/inventory/stock?warehouseId=${warehouseId}`);
    assert.equal(stockResponse.status(), 200);
    let stockItem = (await stockResponse.json()).stock.find((item) => item.code === countedProduct.code);
    assert.equal(Number(stockItem.quantity), 12.5);
    await page.getByRole("region", { name: "Confirmed quantities", exact: true })
      .getByRole("cell", { name: stockItem.quantity, exact: true }).waitFor();
    const movementResponse = await page.request.get(`${baseUrl}/api/v3/inventory/movements?warehouseId=${warehouseId}&limit=50`);
    assert.equal(movementResponse.status(), 200);
    const movementBody = await movementResponse.json();
    assert.equal(movementBody.movements.length, 1, "only the nonzero opening quantity creates a movement");
    assert.equal(movementBody.movements[0].type, "opening_count");
    await page.getByText(movementBody.movements[0].reason, { exact: true }).waitFor();

    const productionWarehouseResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/production-warehouse" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Use selected warehouse for new runs", exact: true }).click();
    const productionWarehouseResponse = await productionWarehouseResponsePromise;
    assert.equal(productionWarehouseResponse.status(), 201, await productionWarehouseResponse.text());
    assert.equal((await productionWarehouseResponse.json()).warehouse.id, warehouseId);
    await page.getByText(/Production warehouse selected for new runs\. Existing runs retain their frozen warehouse\./).waitFor();

    await page.getByRole("button", { name: "Live run", exact: true }).click();
    const inventoryRunLabel = `Browser Inventory Consumption ${suffix}`;
    await page.getByLabel("Imported product").selectOption("DOUGH-A");
    await page.getByLabel("Run label").fill(inventoryRunLabel);
    await page.getByLabel("Target cases").fill("1");
    await page.locator("#run-setup").selectOption("LINE-A");
    const createInventoryRunResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/runs" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Prepare run", exact: true }).click();
    const createInventoryRunResponse = await createInventoryRunResponsePromise;
    assert.equal(createInventoryRunResponse.status(), 201, await createInventoryRunResponse.text());
    const inventoryRun = (await createInventoryRunResponse.json()).run;
    assert.equal(inventoryRun.setupSnapshot.productionPlan.warehouse.id, warehouseId);
    const startInventoryRunResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/runs/${inventoryRun.id}/commands`
      && response.request().method() === "POST"
      && response.request().postDataJSON().commandType === "start");
    await page.getByRole("button", { name: "start", exact: true }).click();
    assert.equal((await startInventoryRunResponsePromise).status(), 200);
    await page.getByRole("tab", { name: "dough", exact: true }).click();
    await page.getByLabel("Batches Made", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Save station update", exact: true }).click();
    await page.getByText("Station change confirmed by the server.").waitFor();
    const completeInventoryRunResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v3/runs/${inventoryRun.id}/commands`
      && response.request().method() === "POST"
      && response.request().postDataJSON().commandType === "complete");
    await page.getByRole("button", { name: "complete", exact: true }).click();
    const completeInventoryRunResponse = await completeInventoryRunResponsePromise;
    assert.equal(completeInventoryRunResponse.status(), 200, await completeInventoryRunResponse.text());
    const inventoryCompletion = (await completeInventoryRunResponse.json()).run;
    assert.equal(inventoryCompletion.status, "completed");
    const consumptionLine = inventoryCompletion.inventoryConsumption.lines
      .find((line) => line.productCode === countedProduct.code);
    assert.equal(Number(consumptionLine.required), 10);
    assert.equal(Number(consumptionLine.deducted), 10);
    assert.equal(Number(consumptionLine.shortfall), 0);

    await page.getByRole("button", { name: "Inventory", exact: true }).click();
    await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
    const postRunStockResponse = await page.request.get(`${baseUrl}/api/v3/inventory/stock?warehouseId=${warehouseId}`);
    assert.equal(postRunStockResponse.status(), 200);
    stockItem = (await postRunStockResponse.json()).stock.find((item) => item.code === countedProduct.code);
    assert.equal(Number(stockItem.quantity), 2.5);
    await page.getByRole("region", { name: "Confirmed quantities", exact: true })
      .getByRole("cell", { name: stockItem.quantity, exact: true }).waitFor();
    const postRunMovementResponse = await page.request.get(`${baseUrl}/api/v3/inventory/movements?warehouseId=${warehouseId}&limit=50`);
    assert.equal(postRunMovementResponse.status(), 200);
    const postRunMovementBody = await postRunMovementResponse.json();
    const runConsumption = postRunMovementBody.movements.find((movement) =>
      movement.type === "run_consumption" && movement.productCode === countedProduct.code);
    assert.ok(runConsumption, "completed-run consumption must remain readable by the Inventory client");
    assert.equal(Number(runConsumption.quantityDelta), -10);
    assert.equal(runConsumption.reason, "Run completion inventory use");
    await page.getByText(runConsumption.reason, { exact: true }).waitFor();
    const consumptionRows = await adminPool.query(
      `SELECT quantity_delta::text AS quantity_delta
       FROM v3.inventory_movements
       WHERE warehouse_id = $1 AND run_id = $2 AND movement_type = 'run_consumption'`,
      [warehouseId, inventoryRun.id],
    );
    assert.equal(consumptionRows.rows.length, 1);
    assert.equal(Number(consumptionRows.rows[0].quantity_delta), -10);

    const surplusPanel = page.getByRole("region", { name: "Freezer surplus", exact: true });
    await surplusPanel.getByLabel("Completed run", { exact: true }).selectOption(inventoryRun.id);
    await surplusPanel.getByLabel("Surplus cases", { exact: true }).fill("2");
    const ingredientMovementsBeforeSurplus = await adminPool.query("SELECT count(*)::integer AS count FROM v3.inventory_movements");
    const surplusLotBaseline = await adminPool.query("SELECT count(*)::integer AS count FROM v3.freezer_surplus_lots");
    loseSurplusConfirmResponse = true;
    await surplusPanel.getByRole("button", { name: "Store surplus", exact: true }).click();
    await page.getByText(/Retry the same request; its identity prevents duplicate writes/).waitFor();
    assert.match(surplusLotId ?? "", /^[0-9a-f-]{36}$/);
    let surplusLots = await adminPool.query(
      "SELECT id::text AS id, total_cases, remaining_cases, revision FROM v3.freezer_surplus_lots ORDER BY created_at, id",
    );
    assert.equal(surplusLots.rows.length, surplusLotBaseline.rows[0].count + 1,
      "the shared disposable database must gain exactly one committed surplus lot");
    const confirmedLot = surplusLots.rows.find((lot) => lot.id === surplusLotId);
    assert.ok(confirmedLot, "the captured confirmation lot must be present in PostgreSQL");
    assert.equal(confirmedLot.remaining_cases, 2);

    await page.reload();
    const retrySurplusResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/freezer-surplus/confirm"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Retry the same inventory request", exact: true }).click();
    const retrySurplusResponse = await retrySurplusResponsePromise;
    assert.equal(retrySurplusResponse.status(), 200, await retrySurplusResponse.text());
    assert.deepEqual(retrySurplusResponse.request().postDataJSON(), surplusConfirmRequestBody,
      "the real surplus retry must preserve the exact confirmation request bytes");
    const retrySurplusBody = await retrySurplusResponse.json();
    assert.equal(retrySurplusBody.replayed, true);
    assert.equal(retrySurplusBody.lotId, surplusLotId, "exact replay must return the originally committed lot");
    await page.getByText(/Previous request confirmed\. 2 finished cases stored/).waitFor();
    surplusLots = await adminPool.query(
      "SELECT id::text AS id, total_cases, remaining_cases, revision FROM v3.freezer_surplus_lots ORDER BY created_at, id",
    );
    assert.equal(surplusLots.rows.length, surplusLotBaseline.rows[0].count + 1, "exact replay must not create another lot");
    assert.equal(surplusLots.rows.filter((lot) => lot.id === surplusLotId).length, 1);
    await surplusPanel.getByRole("button", { name: `Select surplus lot ${surplusLotId}`, exact: true }).click();

    await surplusPanel.getByLabel("Scheduled run", { exact: true }).selectOption(plannedRunId);
    await surplusPanel.getByLabel("Carry-in cases", { exact: true }).fill("1");
    const surplusAllocationResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v3/inventory/freezer-surplus/allocations"
      && response.request().method() === "POST");
    await surplusPanel.getByRole("button", { name: "Allocate carry-in", exact: true }).click();
    const surplusAllocationResponse = await surplusAllocationResponsePromise;
    assert.equal(surplusAllocationResponse.status(), 200, await surplusAllocationResponse.text());
    const surplusAllocationRequestBody = surplusAllocationResponse.request().postDataJSON();
    const surplusAllocationBody = await surplusAllocationResponse.json();
    assert.equal(surplusAllocationRequestBody.lotId, surplusLotId, "the browser must allocate the confirmed lot");
    assert.equal(surplusAllocationRequestBody.scheduleRunId, plannedRunId);
    assert.equal(surplusAllocationBody.lotId, surplusLotId, "the server must allocate the same confirmed lot");
    assert.equal(surplusAllocationBody.remainingCases, 1);
    assert.equal(surplusAllocationBody.carriedInCases, 1);
    assert.equal(surplusAllocationBody.effectiveTargetCases, 4);
    await page.getByText(/Carry-in allocated\. 1 carried-in cases leave an effective production target of 4/).waitFor();
    surplusLots = await adminPool.query(
      "SELECT id::text AS id, total_cases, remaining_cases, revision FROM v3.freezer_surplus_lots ORDER BY created_at, id",
    );
    assert.equal(surplusLots.rows.length, surplusLotBaseline.rows[0].count + 1);
    const allocatedLot = surplusLots.rows.find((lot) => lot.id === surplusLotId);
    assert.ok(allocatedLot);
    assert.equal(allocatedLot.remaining_cases, 1);

    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
    const carriedInCard = page.getByRole("article", { name: "Planned run 1", exact: true });
    await carriedInCard.getByText("Freezer carry-in: 1 cases", { exact: false }).waitFor();
    await carriedInCard.getByText("Effective production target: 4 of 5 planned cases", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Inventory", exact: true }).click();
    await surplusPanel.getByRole("button", { name: `Select surplus lot ${surplusLotId}`, exact: true }).click();
    await surplusPanel.getByLabel("Event type", { exact: true }).selectOption("damage");
    await surplusPanel.getByLabel("Cases", { exact: true }).fill("1");
    await surplusPanel.getByLabel(/^Reason/).fill("Real browser freezer damage");
    await surplusPanel.getByRole("button", { name: "Append damage", exact: true }).click();
    await page.getByText(/Surplus damage appended\. 0 physically remaining cases/).waitFor();
    const finalSurplusLot = await adminPool.query(
      "SELECT remaining_cases, revision FROM v3.freezer_surplus_lots WHERE id = $1",
      [surplusLotId],
    );
    assert.equal(finalSurplusLot.rows[0].remaining_cases, 0);
    const surplusEventCount = await adminPool.query(
      "SELECT count(*)::integer AS count FROM v3.freezer_surplus_events WHERE lot_id = $1",
      [surplusLotId],
    );
    assert.equal(surplusEventCount.rows[0].count, 3);
    const ingredientMovementsAfterSurplus = await adminPool.query("SELECT count(*)::integer AS count FROM v3.inventory_movements");
    assert.equal(ingredientMovementsAfterSurplus.rows[0].count, ingredientMovementsBeforeSurplus.rows[0].count,
      "the real surplus workflow must not append ingredient movements");

    await page.getByLabel("Opening count CSV", { exact: true }).setInputFiles({
      name: "offline-inventory-not-retained.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(openingCsv),
    });
    const writesBeforeInventoryOffline = browserWrites.length;
    offlineCheckActive = true;
    await context.setOffline(true);
    await page.getByText("Loaded values only · no file retained or writes queued", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Opening count CSV", { exact: true }).evaluate((input) => input.files.length), 0);
    assert.equal(await page.getByRole("button", { name: "Stage opening count", exact: true }).isDisabled(), true);
    assert.equal(await surplusPanel.getByRole("button", { name: "Allocate carry-in", exact: true }).isDisabled(), true);
    assert.equal(await surplusPanel.getByRole("button", { name: "Append damage", exact: true }).isDisabled(), true);
    assert.equal(browserWrites.length, writesBeforeInventoryOffline, "offline inventory mode must not issue writes");
    await context.setOffline(false);
    offlineCheckActive = false;
    await page.getByText("Canonical facility inventory · manage-inventory", { exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Reopen count 1", exact: true }).click();
    await page.getByRole("region", { name: "Opening count review", exact: true }).getByText("applied", { exact: true }).waitFor();
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
    assert.equal(browserWrites.filter((entry) => entry === `POST /api/v3/runs/${createdRun.id}/commands`).length, 6,
      "operations must not add lifecycle writes");
    assert.equal(browserWrites.filter((entry) => entry === `POST ${conflictPath}`).length, 3,
      "Run to Time must not add station writes");
    assert.deepEqual(failedResponses, [
      `500 ${runToTimePath}`,
      `409 ${conflictPath}`,
      `409 ${runToTimePath}`,
      `500 ${operationPath}`,
      `409 ${operationPath}`,
      `409 ${operationPath}`,
      "500 /api/v3/schedules/commands",
      "409 /api/v3/schedules/commands",
      "500 /api/v3/setup-catalog/imports",
      `409 /api/v3/setup-catalog/imports/${typedStaleId}/apply`,
      "500 /api/v3/inventory/opening-counts",
      "500 /api/v3/inventory/freezer-surplus/confirm",
    ], "only deliberate stale conflicts and injected post-commit response loss should be rejected");
    console.log("V3 authenticated Chromium/PostgreSQL journey passed: run control; React schedule commands, exact retry, stale conflict, canonical workbook stage/Apply/guarded Undo/reapply/reopen; setup CSV/source-workbook lifecycle, typed create/edit/before-review/Apply, stale-Apply recovery, product-capacity Apply/Undo, named-recipe variants/customer pairings, fixed-nine allergen review, reviewed die defaults/history, and offline lockout with real catalog readback; inventory warehouse/opening-count exact retry/Review/Apply, stock/movement and production-warehouse readback; freezer-surplus exact replay, single-lot carry-in, schedule projection, physical damage, and no repeat ingredient deduction; reload persistence, staff creation, and desktop/phone/tablet layouts.");

    let webkitBrowser;
    try {
      webkitBrowser = await webkit.launch({ headless: true });
      const webkitContext = await webkitBrowser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
      await authenticateBrowserContext(baseUrl, webkitContext);
      const webkitPage = await webkitContext.newPage();
      observePage(webkitPage);
      await webkitPage.goto(baseUrl);
      await webkitPage.getByRole("heading", { name: "Run control", exact: true }).waitFor();
      await selectRun(webkitPage, createdRun.id, runLabel);
      await webkitPage.locator('section[aria-labelledby="current-run-heading"]')
        .getByText("completed", { exact: true }).waitFor();
      const webkitRunToTime = webkitPage.locator('section[aria-labelledby="run-to-time-heading"]');
      const webkitTargetInput = webkitRunToTime.getByLabel("Target time (Central)", { exact: true });
      await webkitRunToTime.getByText("Completed runs are read-only.", { exact: true }).waitFor();
      assert.equal(await webkitTargetInput.inputValue(), "19:15");
      assert.equal(await webkitTargetInput.isDisabled(), true);
      assert.equal(await webkitRunToTime.getByRole("button", { name: "Save target", exact: true }).isDisabled(), true);
      assert.equal(await webkitRunToTime.getByRole("button", { name: "Reset to 7:15 PM", exact: true }).isDisabled(), true);
      const webkitOperations = webkitPage.locator('section[aria-labelledby="operations-heading"]');
      assert.equal(await webkitOperations.getByLabel("Run notes", { exact: true }).inputValue(), operationalHandoff);
      assert.equal(await webkitOperations.getByLabel("Run notes", { exact: true }).isDisabled(), true);
      await webkitOperations.getByText("Real database infeed stop", { exact: true }).waitFor();
      await webkitOperations.getByText("Close this stop with run completion", { exact: true }).waitFor();
      assert.equal(await webkitOperations.getByRole("button", { name: "End stop", exact: true }).count(), 0);
      assert.equal(await webkitOperations.getByRole("button", { name: "Start line stop", exact: true }).isDisabled(), true);
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await webkitPage.getByRole("button", { name: "Schedule", exact: true }).click();
      await webkitPage.getByLabel("Production date", { exact: true }).fill(SCHEDULE_DATE);
      await webkitPage.getByRole("article", { name: "Planned run 3", exact: true }).waitFor();
      assert.equal(await webkitPage.getByRole("article", { name: /^Planned run / }).count(), 3);
      const webkitCarryIn = webkitPage.getByRole("article", { name: "Planned run 1", exact: true });
      await webkitCarryIn.getByText("Freezer carry-in: 1 cases", { exact: false }).waitFor();
      await webkitCarryIn.getByText("Effective production target: 4 of 5 planned cases", { exact: false }).waitFor();
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await webkitPage.getByRole("button", { name: "Setup", exact: true }).click();
      await webkitPage.getByRole("heading", { name: "Setup and master data", exact: true }).waitFor();
      await webkitPage.locator("#setup-catalog-family").selectOption("die-types");
      const webkitTypedCatalog = webkitPage.locator('section[aria-labelledby="typed-catalog-heading"]');
      const webkitTypedCard = webkitTypedCatalog.getByRole("article").filter({ hasText: typedCode });
      await webkitTypedCard.getByRole("heading", { name: typedRevisedName, exact: true }).waitFor();
      await webkitTypedCard.getByRole("button", { name: "Edit", exact: true }).click();
      const webkitTypedForm = webkitTypedCatalog.locator("form");
      await webkitTypedForm.waitFor();
      assert.equal(await webkitTypedForm.locator("input").first().isDisabled(), true);
      assert.equal(await webkitTypedForm.locator("input").nth(1).inputValue(), typedRevisedName);
      await webkitTypedForm.getByRole("button", { name: "Cancel", exact: true }).click();
      const webkitReviewedPanel = webkitPage.locator('section[aria-labelledby="reviewed-die-defaults-heading"]');
      const webkitTypedDie = webkitReviewedPanel.getByRole("article").filter({ hasText: `${typedCode} · revision 1` });
      await webkitTypedDie.getByText("active", { exact: true }).waitFor();
      await webkitTypedDie.getByRole("button", { name: "Edit reviewed defaults", exact: true }).click();
      for (const [label, expected] of Object.entries(reviewedValues)) {
        assert.equal(await webkitTypedDie.getByLabel(label, { exact: true }).inputValue(), expected);
      }
      assert.equal(await webkitTypedDie.getByLabel("Enabled for future run defaults", { exact: true }).isChecked(), true);
      await webkitTypedDie.getByRole("button", { name: "Cancel", exact: true }).click();
      await webkitReviewedPanel.getByText(`${typedCode} · created · revision 1`, { exact: true }).waitFor();
      const webkitMaster = webkitPage.getByRole("region", { name: "Dough yield and shipping capacity", exact: true });
      const webkitMasterCard = webkitMaster.getByRole("article").filter({ hasText: masterCode });
      await webkitMasterCard.getByRole("button", { name: "Edit", exact: true }).click();
      assert.equal(await webkitMaster.getByLabel("Doughball yield", { exact: true }).inputValue(), "645.19");
      await webkitMaster.getByText(/dough-procedure/).waitFor();
      await webkitMaster.getByRole("button", { name: "Cancel", exact: true }).click();
      await webkitPage.locator("#setup-catalog-family").selectOption("manager-lists");
      const webkitRecipes = webkitPage.getByRole("region", { name: "Named recipes and directories", exact: true });
      await webkitRecipes.getByRole("article").filter({ hasText: "run-calc-dough-recipe-presets" })
        .getByRole("button", { name: "Edit", exact: true }).click();
      await webkitRecipes.getByLabel("Search named recipes", { exact: true }).fill(recipeName);
      const webkitRecipe = webkitRecipes.getByRole("article", { name: "Named recipe 1", exact: true });
      assert.equal(await webkitRecipe.getByLabel("Recipe name", { exact: true }).inputValue(), recipeName);
      assert.equal(await webkitRecipe.getByLabel("Premade crust", { exact: true }).isChecked(), true);
      assert.equal(await webkitRecipe.getByLabel("Variant label", { exact: true }).inputValue(), variantLabel);
      assert.equal(await webkitRecipe.getByLabel("Weight oz (optional)", { exact: true }).inputValue(), "16");
      assert.equal(await webkitRecipe.getByLabel("Per tray (optional)", { exact: true }).inputValue(), "12");
      assert.equal(await webkitRecipe.getByLabel("Brand", { exact: true }).inputValue(), "Integration Brand");
      assert.equal(await webkitRecipe.getByLabel("Flavor", { exact: true }).inputValue(), sourceFlavor);
      await webkitRecipes.getByRole("button", { name: "Cancel", exact: true }).click();
      await webkitPage.locator("#setup-catalog-family").selectOption("ingredients");
      const webkitIngredients = webkitPage.getByRole("region", { name: "Ingredients and allergens", exact: true });
      await webkitIngredients.getByRole("article").filter({ hasText: allergenCode })
        .getByRole("button", { name: "Edit", exact: true }).click();
      assert.equal(await webkitIngredients.getByLabel("wheat", { exact: true }).isChecked(), true);
      assert.equal(await webkitIngredients.getByLabel("Allergen mapping reviewed", { exact: true }).isChecked(), true);
      await webkitIngredients.getByRole("button", { name: "Cancel", exact: true }).click();
      await webkitPage.getByRole("article").filter({ hasText: "Source spec-sheets" })
        .getByRole("button", { name: /^Reopen import / }).click();
      await webkitPage.getByText("Canonical import details reloaded. Review the preserved values before acting.").waitFor();
      const webkitSetupReview = webkitPage.getByRole("region", { name: "Setup import review" });
      await webkitSetupReview.getByText("applied", { exact: true }).waitFor();
      await webkitSetupReview.getByText(`Integration Brand · ${sourceFlavor}`, { exact: true }).waitFor();
      await webkitSetupReview.getByLabel(`Values for ${sourceCode}`, { exact: true }).waitFor();
      await webkitSetupReview.getByText(/Source spec-sheets · 1 source row\(s\) · 1 imported · 0 skipped · 0 still unresolved/).waitFor();
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await webkitPage.getByRole("button", { name: "Inventory", exact: true }).click();
      await webkitPage.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
      for (const heading of ["Reorder review", "Use first", "Warehouse needs", "Transfer guidance", "Reorder and expiry settings"]) {
        await webkitPage.getByRole("heading", { name: heading, exact: true }).waitFor();
      }
      await webkitPage.getByLabel("Use-first expiry window (days)", { exact: true }).waitFor();
      assert.equal(await webkitPage.getByLabel("Use-first expiry window (days)", { exact: true }).inputValue(), "9");
      await webkitPage.getByRole("region", { name: "Confirmed quantities", exact: true })
        .getByRole("cell", { name: stockItem.quantity, exact: true }).waitFor();
      await webkitPage.getByText("Run completion inventory use", { exact: true }).waitFor();
      await webkitPage.getByRole("button", { name: "Reopen count 1", exact: true }).click();
      await webkitPage.getByRole("region", { name: "Opening count review", exact: true }).getByText("applied", { exact: true }).waitFor();
      await webkitPage.getByText("Used for new production runs. Existing runs keep their original warehouse snapshot.", { exact: true }).waitFor();
      const webkitSurplus = webkitPage.getByRole("region", { name: "Freezer surplus", exact: true });
      await webkitSurplus.getByText("0 / 2 cases", { exact: true }).waitFor();
      await webkitSurplus.getByText("Real browser freezer damage", { exact: true }).waitFor();
      assert.ok(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      console.log("V3 WebKit/Safari-engine React/PostgreSQL run, schedule carry-in, typed setup edit/readback, product-capacity provenance, named-recipe variants/customer pairings, fixed-nine allergen review, reviewed die defaults/history, setup history, inventory stock, opening-count, production-warehouse, and freezer-surplus readback passed.");
      await webkitBrowser.close();
    } catch (error) {
      if (webkitBrowser) {
        await webkitBrowser.close();
        throw error;
      }
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
