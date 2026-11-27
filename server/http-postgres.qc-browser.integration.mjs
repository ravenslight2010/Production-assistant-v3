import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { Pool } from "pg";
import { startV3Server } from "./main.mjs";

const MANAGER_USERNAME = "V3IntegrationManager";
const MANAGER_PASSWORD = "v3-test-manager-password";

async function authenticateBrowserContext(baseUrl, context, username = MANAGER_USERNAME, password = MANAGER_PASSWORD) {
  const response = await fetch(`${baseUrl}/api/v3/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, "the disposable staff account must authenticate");
  const cookies = response.headers.getSetCookie().map((cookie) => {
    const [pair, ...attributes] = cookie.split(";");
    const separator = pair.indexOf("=");
    const flags = attributes.map((attribute) => attribute.trim().toLowerCase());
    return {
      name: pair.slice(0, separator), value: pair.slice(separator + 1), url: baseUrl,
      httpOnly: flags.includes("httponly"), secure: flags.includes("secure"), sameSite: "Lax",
    };
  });
  await context.addCookies(cookies);
}

async function selectQcRun(page, runId, label) {
  await page.locator("#qc-run-selector").selectOption(runId);
  await page.getByRole("heading", { name: label, exact: true }).waitFor();
}

async function showRecords(page) {
  await page.getByRole("tab", { name: /^Records/ }).click();
  await page.getByRole("heading", { name: "Ordered records", exact: true }).waitFor();
}

async function recordWeight(page, phase, value, targetKey) {
  await page.getByRole("tab", { name: "Weight", exact: true }).click();
  const form = page.locator('form[aria-label="Record QC weight check"]');
  await form.getByLabel(/^Check phase/).selectOption(phase);
  await form.getByLabel("Observed weight", { exact: true }).fill(value);
  await form.getByLabel(/^Weight target/).selectOption(targetKey);
  await form.getByRole("button", { name: "Record weight check", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Weight check recorded with outcome" }).waitFor();
}

async function main() {
  const databaseUrl = process.env.V3_DATABASE_URL;
  const adminDatabaseUrl = process.env.V3_TEST_ADMIN_URL;
  if (!databaseUrl || !adminDatabaseUrl) throw new Error("Disposable V3 PostgreSQL API and admin URLs are required.");
  const adminPool = new Pool({ connectionString: adminDatabaseUrl });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const runLabel = `QC Browser PostgreSQL ${suffix}`;
  const targetKey = `browser-qc-${suffix.toLowerCase()}`;
  const retryLot = `LOT-${suffix}-RETRY`;
  const operatorUsername = `QcOperator${suffix}`;
  const operatorPassword = "v3-qc-browser-operator-password";
  const reviewerUsername = `QcReviewer${suffix}`;
  const reviewerPassword = "v3-qc-browser-reviewer-password";
  const laterLot = `LOT-${suffix}-LATER`;
  const errors = [];
  const writes = [];
  const lotRequests = [];
  let loseLotResponse = false;
  let offline = false;
  let serverInstance;
  let browser;
  try {
    serverInstance = await startV3Server({
      env: { ...process.env, NODE_ENV: "development", PORT: "0", V3_DATABASE_URL: databaseUrl },
      logger: (entry) => { if (entry?.level === "error") errors.push("server emitted an error"); },
    });
    const address = serverInstance.server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browserPath = process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const page = await context.newPage();
    const observe = (observedPage) => {
      observedPage.on("pageerror", (error) => errors.push(error.message));
      observedPage.on("console", (entry) => {
        if (entry.type() !== "error" || entry.text().includes("Failed to load resource")) return;
        if (offline && entry.text().includes("net::ERR_INTERNET_DISCONNECTED")) return;
        errors.push(entry.text());
      });
      observedPage.on("request", (request) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
    };
    observe(page);
    await context.route("**/api/v3/qc/lots", async (route) => {
      const body = route.request().postDataJSON();
      lotRequests.push(body);
      if (loseLotResponse) {
        loseLotResponse = false;
        const committed = await route.fetch();
        assert.equal(committed.status(), 201, await committed.text());
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic QC browser response loss after the PostgreSQL commit." }) });
        return;
      }
      await route.continue();
    });

    await authenticateBrowserContext(baseUrl, context);
    await page.goto(baseUrl);
    await page.getByRole("heading", { name: "Run control", exact: true }).waitFor();
    await page.locator("#run-product").selectOption("DOUGH-A");
    await page.getByLabel("Run label", { exact: true }).fill(runLabel);
    await page.getByLabel("Target cases", { exact: true }).fill("4");
    await page.locator("#run-setup").selectOption("LINE-A");
    const createResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v3/runs" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Prepare run", exact: true }).click();
    const createResponse = await createResponsePromise;
    assert.equal(createResponse.status(), 201);
    const createdRun = (await createResponse.json()).run;

    await page.getByRole("button", { name: "QC", exact: true }).click();
    await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
    await selectQcRun(page, createdRun.id, runLabel);
    await page.getByText("0", { exact: true }).first().waitFor();

    await page.getByRole("tab", { name: /^Targets/ }).click();
    await page.getByRole("button", { name: "New target", exact: true }).click();
    await page.getByLabel("Target key", { exact: true }).fill(targetKey);
    await page.getByLabel("Minimum (optional)", { exact: true }).fill("400");
    await page.getByLabel("Maximum (optional)", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Save target", exact: true }).click();
    await page.getByRole("status").filter({ hasText: `Target ${targetKey} saved at revision 1` }).waitFor();

    await showRecords(page);
    await page.getByText("No QC checks recorded for this run.", { exact: true }).waitFor();
    loseLotResponse = true;
    await page.getByLabel("Product code", { exact: true }).fill("FLOUR-01");
    await page.getByLabel("Lot number", { exact: true }).fill(retryLot);
    await page.getByLabel("Lot notes (optional)", { exact: true }).fill("Synthetic intact seal");
    await page.getByRole("button", { name: "Record lot", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Synthetic QC browser response loss after the PostgreSQL commit." }).waitFor();
    await page.getByRole("button", { name: "Retry same request", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Previous request confirmed by exact retry. Lot evidence recorded." }).waitFor();
    assert.equal(lotRequests.length, 2);
    assert.equal(lotRequests[0].requestId, lotRequests[1].requestId);
    assert.deepEqual(lotRequests[0], lotRequests[1]);
    const persistedLots = await adminPool.query("SELECT record_id FROM v3.qc_records WHERE run_id = $1 AND kind = 'lot' AND details->>'lotNumber' = $2", [createdRun.id, retryLot]);
    assert.equal(persistedLots.rowCount, 1, "the post-commit retry must create exactly one lot");

    await recordWeight(page, "pre-run", "450", targetKey);
    await page.getByText("pass", { exact: true }).first().waitFor();
    await recordWeight(page, "30-minute", "550", targetKey);
    await page.getByText("fail", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Brix", exact: true }).click();
    await page.getByLabel("Observed Brix", { exact: true }).fill("12.5");
    await page.getByRole("button", { name: "Record Brix check", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "No reviewed target selected" }).waitFor();
    await page.getByText("Not evaluated", { exact: true }).waitFor();

    await page.reload();
    await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
    await selectQcRun(page, createdRun.id, runLabel);
    await showRecords(page);
    await page.getByRole("cell").filter({ hasText: retryLot }).waitFor();
    await page.getByText("30-minute · 550 g", { exact: true }).waitFor();

    const secondPage = await context.newPage();
    observe(secondPage);
    await secondPage.goto(`${baseUrl}/#qc`);
    await secondPage.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
    await selectQcRun(secondPage, createdRun.id, runLabel);
    await showRecords(secondPage);
    await secondPage.getByRole("cell").filter({ hasText: retryLot }).waitFor();

    await page.getByRole("tab", { name: /^Targets/ }).click();
    await page.getByRole("button", { name: `Edit target ${targetKey}`, exact: true }).click();
    await page.getByLabel("Minimum (optional)", { exact: true }).fill("410");
    await page.getByLabel("Maximum (optional)", { exact: true }).fill("520");
    await secondPage.getByRole("tab", { name: /^Targets/ }).click();
    await secondPage.getByRole("button", { name: `Edit target ${targetKey}`, exact: true }).click();
    await secondPage.getByLabel("Minimum (optional)", { exact: true }).fill("420");
    await secondPage.getByLabel("Maximum (optional)", { exact: true }).fill("530");
    await secondPage.getByRole("button", { name: "Save target", exact: true }).click();
    await secondPage.getByRole("status").filter({ hasText: `Target ${targetKey} saved at revision 2` }).waitFor();
    await page.getByRole("button", { name: "Save target", exact: true }).click();
    const conflictReview = page.getByRole("alert").filter({ hasText: "Target changed before this save" });
    await conflictReview.waitFor();
    assert.match(await conflictReview.innerText(), /Current is revision 2: 420 to 530 g/);
    assert.match(await conflictReview.innerText(), /Your unapplied values: 410 to 520 g/);
    await page.getByRole("button", { name: "Load current values for review", exact: true }).click();
    assert.equal(await page.getByLabel("Minimum (optional)", { exact: true }).inputValue(), "420");

    await showRecords(page);
    const snapshots = await page.getByText(`${targetKey} · revision 1`, { exact: true }).count();
    assert.equal(snapshots, 2, "both historical weights retain revision 1 after the target edit");
    const storedRecords = await adminPool.query("SELECT kind, details FROM v3.qc_records WHERE run_id = $1 ORDER BY sequence", [createdRun.id]);
    assert.equal(storedRecords.rowCount, 4);
    assert.deepEqual(storedRecords.rows.map((row) => row.kind), ["lot", "weight-check", "weight-check", "brix-check"]);
    assert.ok(storedRecords.rows.slice(1, 3).every((row) => row.details.target.revision === 1));
    assert.equal(storedRecords.rows[3].details.outcome, "not-evaluated");
    const currentTarget = await adminPool.query("SELECT revision, minimum::text, maximum::text FROM v3.qc_targets WHERE target_key = $1", [targetKey]);
    assert.equal(Number(currentTarget.rows[0].revision), 2);
    assert.equal(Number(currentTarget.rows[0].minimum), 420);
    assert.equal(Number(currentTarget.rows[0].maximum), 530);

    await page.getByRole("button", { name: "Staff", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill(reviewerUsername);
    await page.getByLabel("Initial password", { exact: true }).fill(reviewerPassword);
    await page.locator("#new-staff-role").selectOption("manager");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByText("Staff account created. The password was not stored in the browser.", { exact: true }).waitFor();
    const reviewerIdentity = await adminPool.query("SELECT id AS staff_id FROM v3.staff_accounts WHERE lower(username) = lower($1)", [reviewerUsername]);
    assert.equal(reviewerIdentity.rowCount, 1, "the reviewer staff account must exist after the Staff UI confirms creation");
    const reviewerId = reviewerIdentity.rows[0].staff_id;

    await page.getByRole("button", { name: "QC", exact: true }).click();
    await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
    await selectQcRun(page, createdRun.id, runLabel);
    await page.getByRole("tab", { name: "Run verification", exact: true }).click();
    const componentForm = page.locator('form[aria-label="Record QC component check"]');
    await componentForm.getByLabel(/^Effective ingredient/).selectOption({ index: 0 });
    await componentForm.getByLabel(/^Presence/).selectOption("present");
    await componentForm.getByLabel("Component notes (optional)", { exact: true }).fill("Authenticated component identity");
    await componentForm.getByRole("button", { name: "Record component check", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Component check recorded." }).waitFor();

    const allergenForm = page.locator('form[aria-label="Record QC allergen review"]');
    await allergenForm.getByLabel(/^Ingredient to review/).selectOption({ index: 0 });
    await allergenForm.getByLabel(/^Staging status/).selectOption("staged");
    await allergenForm.getByLabel("Allergen review notes (optional)", { exact: true }).fill("Authenticated staging review");
    await allergenForm.getByRole("button", { name: "Record allergen review", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Allergen review recorded." }).waitFor();

    const cleaningForm = page.locator('form[aria-label="Record QC cleaning"]');
    const cleaningArea = `Mixer ${suffix}`;
    await cleaningForm.getByLabel("Area or equipment", { exact: true }).fill(cleaningArea);
    await cleaningForm.getByLabel(/^Cleaning status/).selectOption("cleaned");
    await cleaningForm.getByLabel("Cleaning notes (optional)", { exact: true }).fill("Authenticated cleaning evidence");
    await cleaningForm.getByRole("button", { name: "Record cleaning", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Cleaning recorded." }).waitFor();
    await page.getByRole("button", { name: `Record verification for ${cleaningArea}`, exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Your session no longer authorizes this QC record." }).waitFor();
    const selfVerifications = await adminPool.query("SELECT record_id FROM v3.qc_records WHERE run_id = $1 AND kind = 'cleaning-verification'", [createdRun.id]);
    assert.equal(selfVerifications.rowCount, 0, "self-verification must not persist evidence");

    const reviewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const reviewerPage = await reviewerContext.newPage();
    observe(reviewerPage);
    await authenticateBrowserContext(baseUrl, reviewerContext, reviewerUsername, reviewerPassword);
    await reviewerPage.goto(`${baseUrl}/#qc`);
    await reviewerPage.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
    await selectQcRun(reviewerPage, createdRun.id, runLabel);
    await reviewerPage.getByRole("tab", { name: "Run verification", exact: true }).click();
    await reviewerPage.getByRole("button", { name: `Record verification for ${cleaningArea}`, exact: true }).click();
    await reviewerPage.getByRole("status").filter({ hasText: "Cleaning verification recorded." }).waitFor();
    await reviewerPage.getByText(new RegExp(`Verified by\\s*${reviewerId}`)).waitFor();
    const runStateBeforeSignOff = await adminPool.query("SELECT status, revision FROM v3.runs WHERE id = $1", [createdRun.id]);
    const runEventsBeforeSignOff = await adminPool.query("SELECT count(*)::integer AS count FROM v3.run_events WHERE run_id = $1", [createdRun.id]);
    assert.equal(runStateBeforeSignOff.rowCount, 1);

    const signOffResponsePromise = reviewerPage.waitForResponse((response) => new URL(response.url()).pathname === `/api/v3/qc/runs/${createdRun.id}/sign-off` && response.request().method() === "POST");
    await reviewerPage.getByRole("button", { name: "Sign off current QC evidence", exact: true }).click();
    const signOffResponse = await signOffResponsePromise;
    const signOffResponseText = await signOffResponse.text();
    assert.equal(signOffResponse.status(), 201, signOffResponseText);
    const signOffBody = JSON.parse(signOffResponseText);
    const signedHighWaterMark = signOffResponse.request().postDataJSON().expectedHighWaterMark;
    assert.match(signedHighWaterMark, /^(0|[1-9][0-9]*)$/);
    assert.equal(signOffBody.record.kind, "sign-off");
    assert.equal(signOffBody.record.details.highWaterMark, signedHighWaterMark);
    await reviewerPage.getByRole("status").filter({ hasText: `QC evidence signed off through high-water mark ${signedHighWaterMark}.` }).waitFor();
    const signOffPanel = reviewerPage.locator('section[aria-labelledby="qc-signoff-heading"]');
    await signOffPanel.getByText(reviewerId, { exact: true }).waitFor();
    await signOffPanel.getByText(signedHighWaterMark, { exact: true }).waitFor();
    assert.equal(await signOffPanel.locator("time").count(), 1, "sign-off must show its recorded timestamp");
    assert.equal(await signOffPanel.getByText(/New evidence recorded since sign-off/).count(), 0);

    const laterContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const laterPage = await laterContext.newPage();
    observe(laterPage);
    await authenticateBrowserContext(baseUrl, laterContext);
    await laterPage.goto(`${baseUrl}/#qc`);
    await laterPage.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
    await selectQcRun(laterPage, createdRun.id, runLabel);
    await showRecords(laterPage);
    await laterPage.getByRole("tab", { name: "Lot", exact: true }).click();
    await laterPage.getByLabel("Product code", { exact: true }).fill("FLOUR-01");
    await laterPage.getByLabel("Lot number", { exact: true }).fill(laterLot);
    await laterPage.getByRole("button", { name: "Record lot", exact: true }).click();
    await laterPage.getByRole("status").filter({ hasText: "Lot evidence recorded." }).waitFor();

    const staleSignOffResponsePromise = reviewerPage.waitForResponse((response) => new URL(response.url()).pathname === `/api/v3/qc/runs/${createdRun.id}/sign-off` && response.request().method() === "POST");
    await reviewerPage.getByRole("button", { name: "Sign off current QC evidence", exact: true }).click();
    const staleSignOffResponse = await staleSignOffResponsePromise;
    assert.equal(staleSignOffResponse.status(), 409, await staleSignOffResponse.text());
    await reviewerPage.getByRole("alert").filter({ hasText: "No sign-off was written." }).waitFor();
    await signOffPanel.getByText(/New evidence recorded since sign-off/).waitFor();
    await signOffPanel.getByText(/existing sign-off is historical/).waitFor();
    const signOffs = await adminPool.query("SELECT record_id, actor_id, details FROM v3.qc_records WHERE run_id = $1 AND kind = 'sign-off'", [createdRun.id]);
    assert.equal(signOffs.rowCount, 1, "a stale sign-off attempt must not append evidence");
    assert.equal(signOffs.rows[0].actor_id, reviewerId);
    assert.equal(signOffs.rows[0].details.highWaterMark, signedHighWaterMark);
    const finalRecords = await adminPool.query("SELECT kind FROM v3.qc_records WHERE run_id = $1 ORDER BY sequence", [createdRun.id]);
    assert.deepEqual(finalRecords.rows.map((row) => row.kind), [
      "lot", "weight-check", "weight-check", "brix-check", "component-check",
      "allergen-review", "cleaning", "cleaning-verification", "sign-off", "lot",
    ]);
    const runStateAfterSignOff = await adminPool.query("SELECT status, revision FROM v3.runs WHERE id = $1", [createdRun.id]);
    const runEventsAfterSignOff = await adminPool.query("SELECT count(*)::integer AS count FROM v3.run_events WHERE run_id = $1", [createdRun.id]);
    assert.deepEqual(runStateAfterSignOff.rows, runStateBeforeSignOff.rows, "QC sign-off must not change run status or revision");
    assert.deepEqual(runEventsAfterSignOff.rows, runEventsBeforeSignOff.rows, "QC sign-off must not append run events");
    await laterContext.close();

    const verificationWritesBeforeOffline = writes.length;
    await reviewerContext.setOffline(true);
    await reviewerPage.getByText(/Offline read-only view. Showing QC values confirmed/).waitFor();
    for (const name of ["Record component check", "Record allergen review", "Record cleaning", `Record verification for ${cleaningArea}`, "Sign off current QC evidence"]) {
      assert.equal(await reviewerPage.getByRole("button", { name, exact: true }).isDisabled(), true, `${name} must be disabled offline`);
    }
    assert.equal(writes.length, verificationWritesBeforeOffline, "offline run verification must not issue writes");
    await reviewerContext.setOffline(false);
    await reviewerPage.getByText("Connected", { exact: true }).first().waitFor();
    await reviewerContext.close();

    await showRecords(page);
    const writesBeforeOffline = writes.length;
    offline = true;
    await context.setOffline(true);
    await page.getByText(/Offline read-only view. Showing QC values confirmed/).waitFor();
    await page.getByRole("tab", { name: "Weight", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Record weight check", exact: true }).isDisabled(), true);
    await page.getByRole("tab", { name: /^Targets/ }).click();
    assert.equal(await page.getByRole("button", { name: "New target", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: `Edit target ${targetKey}`, exact: true }).isDisabled(), true);
    assert.equal(writes.length, writesBeforeOffline, "offline QC must not issue writes");
    await context.setOffline(false);
    offline = false;
    await page.getByText("Connected", { exact: true }).first().waitFor();

    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => ({
        fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
        documentWidth: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll("body *")].flatMap((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || (rect.right <= window.innerWidth + 1 && rect.left >= -1)) return [];
          return [{ tag: element.tagName, id: element.id, class: typeof element.className === "string" ? element.className.slice(0, 160) : "", left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }];
        }).slice(0, 12),
      }));
      assert.ok(layout.fits, `QC must not overflow at ${viewport.width}px: ${JSON.stringify(layout)}`);
    }

    await page.getByRole("button", { name: "Staff", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill(operatorUsername);
    await page.getByLabel("Initial password", { exact: true }).fill(operatorPassword);
    await page.locator("#new-staff-role").selectOption("operator");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByText("Staff account created. The password was not stored in the browser.", { exact: true }).waitFor();
    const operatorContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const operatorPage = await operatorContext.newPage();
    observe(operatorPage);
    const forbiddenReads = [];
    operatorPage.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/v3/runs" || pathname.startsWith("/api/v3/qc/")) forbiddenReads.push(pathname);
    });
    await authenticateBrowserContext(baseUrl, operatorContext, operatorUsername, operatorPassword);
    await operatorPage.goto(`${baseUrl}/#qc`);
    await operatorPage.getByRole("heading", { name: "QC access required", exact: true }).waitFor();
    assert.deepEqual(forbiddenReads, [], "an operator must not request QC or run data");
    await operatorContext.close();

    assert.deepEqual(errors, [], "the real QC browser journey must have no unexpected browser or server errors");
    console.log("V3 authenticated Chromium/PostgreSQL QC journey passed: run context; revision-fenced target creation; post-commit response-loss exact retry with one persisted lot; pre-run/30-minute weight and Brix evidence; reload and two-session canonical readback; stale-target review with immutable snapshots; effective-component, allergen/staging, and cleaning evidence; denied self-verification and independent manager verification; exact sign-off with later-evidence 409 and no duplicate sign-off; run-state invariance; offline write lockout for every QC control; operator denial without QC reads; desktop/phone/tablet overflow checks.");
    await secondPage.close();
  } finally {
    if (browser) await browser.close();
    if (serverInstance) await serverInstance.close();
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "v3.http_postgres_qc_browser_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "QC browser integration assertion failed.",
  }));
  process.exitCode = 1;
});
