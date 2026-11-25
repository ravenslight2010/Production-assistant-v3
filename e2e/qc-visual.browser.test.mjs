import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium, expect } from "playwright/test";

const STAFF_ID = "77000000-0000-4000-8000-000000000001";
const RUN_ID = "77000000-0000-4000-8000-000000000002";
const DIST = new URL("../dist/", import.meta.url);
const OUTPUT = resolve("test-results/qc-visual");
// Recreate only after reviewing an intentional UI change:
// UPDATE_QC_VISUAL_BASELINES=1 node --test e2e/qc-visual.browser.test.mjs
const UPDATE_BASELINES = process.env.UPDATE_QC_VISUAL_BASELINES === "1";
const CHROMIUM_ONLY = (process.env.BROWSER ?? "chromium") === "chromium";
const VISUAL_FONT = await readFile(new URL("./qc-visual-inter-latin.woff2", import.meta.url));
// Chromium can round native-select text one CSS pixel vertically between fresh
// launches. Cap the allowance at one-tenth of one percent of the full image.
const MAX_MISMATCH_RATIO = 0.001;
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);
const run = {
  id: RUN_ID, status: "running", productionDate: "2035-05-01", revision: 4,
  createdAt: "2035-05-01T12:00:00.000Z", updatedAt: "2035-05-01T12:00:00.000Z",
  startedAt: "2035-05-01T12:00:00.000Z", pausedAt: null, resumedAt: null, completedAt: null,
  serverNow: "2035-05-01T12:00:00.000Z", runToTime: "19:15", operationalNotes: "", stoppages: [],
  setupSnapshot: { label: "QC Visual Pizza", targetCases: 20, productCode: "PIZZA-A", productionSetupCode: "LINE-A" },
  effectiveProductionPlan: null, substitutionOverlay: null,
  doughCapacity: { source: "reviewed", doughballYield: 600, pizzasPerCase: 12 },
  inventoryConsumption: null, pauseIntervals: [], stationProgress: {},
};
const targets = [
  {
    targetKey: "visual-dough-weight", kind: "weight", unit: "g", minimum: "400.00", maximum: "500.00",
    active: true, revision: 2, updatedBy: STAFF_ID, updatedAt: "2035-05-01T12:00:00.000Z",
  },
  {
    targetKey: "visual-sauce-brix", kind: "brix", unit: "brix", minimum: "7.50", maximum: "9.50",
    active: true, revision: 1, updatedBy: STAFF_ID, updatedAt: "2035-05-01T12:00:00.000Z",
  },
];
const records = [
  {
    recordId: "77000000-0000-4000-8000-000000000101", sequence: "101", runId: RUN_ID,
    actorId: STAFF_ID, relatedRecordId: null, recordedAt: "2035-05-01T12:01:00.000Z", kind: "lot",
    details: { productCode: "FLOUR-01", lotNumber: "VISUAL-LOT", notes: "Seal intact" },
  },
  {
    recordId: "77000000-0000-4000-8000-000000000102", sequence: "102", runId: RUN_ID,
    actorId: STAFF_ID, relatedRecordId: null, recordedAt: "2035-05-01T12:02:00.000Z", kind: "weight-check",
    details: {
      phase: "pre-run", value: "450", unit: "g", targetKey: "visual-dough-weight", notes: "First tray",
      target: targets[0], outcome: "pass", notEvaluatedReason: null,
    },
  },
  {
    recordId: "77000000-0000-4000-8000-000000000103", sequence: "103", runId: RUN_ID,
    actorId: STAFF_ID, relatedRecordId: null, recordedAt: "2035-05-01T12:03:00.000Z", kind: "brix-check",
    details: {
      phase: null, value: "8.25", unit: "brix", targetKey: null, notes: "Room temperature",
      target: null, outcome: "not-evaluated", notEvaluatedReason: "no-reviewed-target",
    },
  },
];

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
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(async () => new Promise((resolveClose) => server.close(resolveClose)));
  return `http://127.0.0.1:${server.address().port}`;
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

async function installVisualApi(context) {
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v3/auth/session") {
      return json(route, { staff: { userId: STAFF_ID, username: "visual-manager", role: "manager", capabilities: ["record-qc", "manage-qc"] } });
    }
    if (pathname === "/api/v3/auth/bootstrap-status") return json(route, { available: false });
    if (pathname === "/api/v3/runs" && request.method() === "GET") return json(route, { runs: [run] });
    if (pathname === "/api/v3/qc/targets" && request.method() === "GET") return json(route, { targets });
    if (pathname === `/api/v3/qc/runs/${RUN_ID}` && request.method() === "GET") {
      return json(route, { run, highWaterMark: "103", records });
    }
    return json(route, { error: `Unexpected visual-fixture request: ${request.method()} ${pathname}` }, 404);
  });
}

async function compareSnapshot(name, actual) {
  const baselinePath = fileURLToPath(new URL(`./qc-visual.browser.test.mjs-snapshots/${name}.png`, import.meta.url));
  if (UPDATE_BASELINES) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, actual);
    return;
  }
  assert.ok(existsSync(baselinePath), `Missing reviewed Chromium baseline: ${baselinePath}`);
  const expected = PNG.sync.read(await readFile(baselinePath));
  const observed = PNG.sync.read(actual);
  assert.equal(observed.width, expected.width, `${name}: viewport width changed`);
  assert.equal(observed.height, expected.height, `${name}: full-page height changed`);
  const diff = new PNG({ width: expected.width, height: expected.height });
  const mismatchedPixels = pixelmatch(expected.data, observed.data, diff.data, expected.width, expected.height, { threshold: 0.1 });
  const mismatchRatio = mismatchedPixels / (expected.width * expected.height);
  if (mismatchRatio > MAX_MISMATCH_RATIO) {
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(resolve(OUTPUT, `${name}-actual.png`), actual);
    await writeFile(resolve(OUTPUT, `${name}-diff.png`), PNG.sync.write(diff));
  }
  assert.ok(
    mismatchRatio <= MAX_MISMATCH_RATIO,
    `${name}: ${mismatchedPixels} pixels differ (${(mismatchRatio * 100).toFixed(4)}%, limit ${(MAX_MISMATCH_RATIO * 100).toFixed(4)}%); inspect ignored artifacts in ${OUTPUT}`,
  );
}

async function captureQc(t, { name, workspace, viewport }) {
  const baseUrl = await serveDist(t);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce", serviceWorkers: "block",
  });
  await installVisualApi(context);
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2035-05-01T12:05:00.000Z") });
  await page.goto(`${baseUrl}/#qc`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
  await page.getByRole("heading", { name: "QC Visual Pizza", exact: true }).waitFor();
  await expect(page.getByRole("button", { name: "Refresh QC server state", exact: true })).toBeEnabled();
  if (workspace === "targets") {
    await page.getByRole("tab", { name: "Targets (2)", exact: true }).click();
    await page.getByRole("heading", { name: "Current targets", exact: true }).waitFor();
    await page.getByRole("cell", { name: "400 to 500 g", exact: true }).waitFor();
  } else {
    await page.getByText("103", { exact: true }).waitFor();
    await page.getByText("separate lots", { exact: true }).waitFor();
  }
  // The app requests Inter without bundling it. Pin the same licensed font in
  // visual fixtures so host system-font resolution cannot change every baseline.
  await page.addStyleTag({ content: `
    @font-face {
      font-family: "QC Visual Inter";
      src: url("data:font/woff2;base64,${VISUAL_FONT.toString("base64")}") format("woff2");
      font-style: normal;
      font-weight: 100 900;
      font-display: block;
    }
    body, body * { font-family: "QC Visual Inter" !important; }
  ` });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  assert.ok(await page.evaluate(() => document.fonts.check('16px "QC Visual Inter"')), "Visual fixture font must load");
  const actual = await page.screenshot({ fullPage: true, animations: "disabled" });
  await compareSnapshot(name, actual);
}

const skip = CHROMIUM_ONLY ? false : "QC image baselines are Chromium-specific; WebKit and Firefox retain behavioral coverage";

test("QC dashboard matches its reviewed desktop Chromium baseline", { skip, timeout: 60_000 }, async (t) => {
  await captureQc(t, { name: "dashboard-desktop-chromium", workspace: "run", viewport: { width: 1440, height: 1000 } });
});

test("QC dashboard matches its reviewed phone Chromium baseline", { skip, timeout: 60_000 }, async (t) => {
  await captureQc(t, { name: "dashboard-phone-chromium", workspace: "run", viewport: { width: 390, height: 844 } });
});

test("QC target manager matches its reviewed desktop Chromium baseline", { skip, timeout: 60_000 }, async (t) => {
  await captureQc(t, { name: "targets-desktop-chromium", workspace: "targets", viewport: { width: 1440, height: 1000 } });
});

test("QC target manager matches its reviewed phone Chromium baseline", { skip, timeout: 60_000 }, async (t) => {
  await captureQc(t, { name: "targets-phone-chromium", workspace: "targets", viewport: { width: 390, height: 844 } });
});
