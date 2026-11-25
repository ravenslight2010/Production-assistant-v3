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
    console.log("V3 authenticated Chromium/PostgreSQL QC journey passed: run context; revision-fenced target creation; post-commit response-loss exact retry with one persisted lot; pre-run/30-minute weight and Brix evidence; reload and two-session canonical readback; stale-target review with immutable snapshots; offline write lockout; operator denial without QC reads; desktop/phone/tablet overflow checks.");
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
