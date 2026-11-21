import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const CSRF_TOKEN = "a".repeat(43);
const STAFF_ID = "72000000-0000-4000-8000-000000000001";
const RUN_ID = "73000000-0000-4000-8000-000000000001";
const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);

function station(revision = 1) {
  return {
    status: "running",
    revision,
    inputs: { autoTrackRatePerMinute: 0, timerDurationSeconds: 0, casesPerSkid: 0 },
    progress: { casesProduced: 0, casesOnLine: 0, casesInFreezer: 0 },
    startedAt: "2026-11-21T12:00:00.000Z",
    pausedAt: null,
    completedAt: null,
    nextDueAt: null,
    updatedAt: "2026-11-21T12:00:00.000Z",
  };
}

function productionRun(status = "planned", revision = 1) {
  const now = "2026-11-21T12:00:00.000Z";
  return {
    id: RUN_ID,
    status,
    revision,
    createdAt: now,
    updatedAt: now,
    serverNow: now,
    startedAt: status === "planned" ? null : now,
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    setupSnapshot: {
      label: "Browser qualification run",
      targetCases: 25,
      productCode: "PIZZA-A",
      productionSetupCode: "LINE-A",
    },
    doughCapacity: { status: "available", reasons: [], doughballYield: 645.19, pizzasPerCase: 12 },
    pauseIntervals: [],
    stationProgress: status === "planned" ? {} : { line: station(revision) },
  };
}

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

async function openBrowser(t, viewport = { width: 1440, height: 900 }) {
  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  return { browser, context };
}

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store", ...headers }, body: JSON.stringify(body) });
}

async function installManagerApi(context, baseUrl, initialRun = null) {
  let run = initialRun;
  const commands = [];
  const staffChanges = [];
  let directory = {
    staff: [{ userId: STAFF_ID, username: "manager", role: "manager", disabled: false }],
    roles: [{ name: "manager", capabilities: ["manage-staff"] }, { name: "operator", capabilities: [] }],
  };
  await context.addCookies([{ name: "v3_csrf", value: CSRF_TOKEN, url: baseUrl }]);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") {
      return json(route, {
        staff: { userId: STAFF_ID, username: "manager", role: "manager", capabilities: ["manage-staff", "manage-inventory"] },
        expiresAt: "2026-11-22T12:00:00.000Z",
      });
    }
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/runs/products" && method === "GET") {
      return json(route, { products: [{ code: "PIZZA-A", name: "Reviewed pizza", productionSetups: [{ code: "LINE-A", name: "Main line" }] }] });
    }
    if (path === "/api/v3/runs" && method === "GET") return json(route, { runs: run ? [run] : [] });
    if (path === "/api/v3/runs" && method === "POST") {
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      const body = request.postDataJSON();
      assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(body.setupSnapshot, {
        label: "Browser qualification run", targetCases: 25, productCode: "PIZZA-A", productionSetupCode: "LINE-A",
      });
      run = productionRun();
      return json(route, { run }, 201);
    }
    if (path === `/api/v3/runs/${RUN_ID}/commands` && method === "POST") {
      const body = request.postDataJSON();
      commands.push(body);
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      assert.equal(body.expectedRevision, run.revision);
      assert.equal(body.commandType, "start");
      run = productionRun("running", run.revision + 1);
      return json(route, { outcome: "accepted", replayed: false, commandId: body.commandId, run });
    }
    if (path === `/api/v3/runs/${RUN_ID}/stations/line/commands` && method === "POST") {
      const body = request.postDataJSON();
      commands.push(body);
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      if (body.expectedRevision !== run.revision) return json(route, { outcome: "conflict", currentRun: run }, 409);
      run = structuredClone(run);
      run.revision += 1;
      run.stationProgress.line = station(run.revision);
      run.stationProgress.line.inputs.autoTrackRatePerMinute = body.changes.autoTrackRatePerMinute;
      run.stationProgress.line.progress.casesProduced = body.changes.casesProduced;
      return json(route, { outcome: "accepted", replayed: false, commandId: body.commandId, stationKey: "line", run });
    }
    if (path === "/api/v3/auth/staff" && method === "GET") return json(route, directory);
    if (path === "/api/v3/auth/staff" && method === "POST") {
      const body = request.postDataJSON();
      staffChanges.push(body);
      assert.equal(request.headers()["x-csrf-token"], CSRF_TOKEN);
      directory = { ...directory, staff: [...directory.staff, { userId: crypto.randomUUID(), username: body.username, role: body.roleName, disabled: false }] };
      return json(route, directory, 201);
    }
    if (path === "/api/v3/auth/sign-out" && method === "POST") return route.fulfill({ status: 204 });
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return { commands, staffChanges, getRun: () => run };
}

test("React run cockpit confirms creation, lifecycle, manual edits, and stale conflicts", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t);
  const api = await installManagerApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Run control" }).waitFor();
  await page.getByLabel("Run label").fill("Browser qualification run");
  await page.getByLabel("Target cases").fill("25");
  await page.getByLabel("Imported product").selectOption("PIZZA-A");
  await page.getByRole("button", { name: "Prepare run" }).click();
  await page.getByRole("heading", { name: "Browser qualification run" }).waitFor();
  await page.getByRole("button", { name: "start", exact: true }).click();
  await page.getByText("start confirmed by the server.").waitFor();

  await page.getByLabel("Auto Track Rate Per Minute").fill("4");
  await page.getByLabel("Cases Produced", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save station update" }).click();
  await page.getByText("Station change confirmed by the server.").waitFor();
  assert.deepEqual(api.commands.map((command) => command.mode ?? "lifecycle"), ["lifecycle", "manual"]);

  await page.getByLabel("Cases Produced", { exact: true }).fill("3");
  // The second page retains its prior revision when the first page advances
  // the canonical run, so its next manual edit must be rejected as stale.
  const second = await context.newPage();
  await second.goto(baseUrl);
  await second.getByRole("heading", { name: "Browser qualification run" }).waitFor();
  await page.getByRole("button", { name: "Save station update" }).click();
  await page.getByText("Station change confirmed by the server.").waitFor();
  await second.getByLabel("Cases Produced", { exact: true }).fill("1");
  await second.getByRole("button", { name: "Save station update" }).click();
  await second.getByText("Stale station change discarded; the latest server state is now displayed.").waitFor();
  assert.equal(api.commands.filter((command) => command.mode === "auto_track").length, 0);

  await context.setOffline(true);
  await second.getByText("Read-only offline", { exact: true }).first().waitFor();
  await second.getByRole("button", { name: "Prepare run" }).waitFor({ state: "visible" });
  assert.equal(await second.getByRole("button", { name: "Prepare run" }).isDisabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("all V1-style sections and staff workflows are reachable without dead navigation", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t, { width: 375, height: 812 });
  const api = await installManagerApi(context, baseUrl, productionRun("running", 1));
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Run control" }).waitFor();
  for (const [section, heading] of [
    ["Schedule", "Production schedule"],
    ["Setup", "Setup and master data"],
    ["Inventory", "Inventory"],
    ["Warehouse", "Warehouse"],
    ["QC", "Quality control"],
    ["Reports", "Reports and history"],
  ]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, section);
  }
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByRole("heading", { name: "Staff accounts" }).waitFor();
  await page.getByLabel("Username", { exact: true }).fill("operator.two");
  await page.getByLabel("Initial password").fill("synthetic-only");
  await page.locator("#new-staff-role").selectOption("operator");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Staff account created. The password was not stored in the browser.").waitFor();
  assert.deepEqual(api.staffChanges, [{ username: "operator.two", password: "synthetic-only", roleName: "operator" }]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Staff sign in" }).waitFor();
  await context.close();
});
