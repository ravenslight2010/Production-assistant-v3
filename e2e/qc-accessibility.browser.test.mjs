import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { chromium, webkit, firefox } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const STAFF_ID = "77000000-0000-4000-8000-000000000001";
const RUN_ID = "77000000-0000-4000-8000-000000000002";
const DIST = new URL("../dist/", import.meta.url);
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
  setupSnapshot: { label: "QC Accessibility Pizza", targetCases: 20, productCode: "PIZZA-A", productionSetupCode: "LINE-A" },
  effectiveProductionPlan: null, substitutionOverlay: null,
  doughCapacity: { source: "reviewed", doughballYield: 600, pizzasPerCase: 12 },
  inventoryConsumption: null, pauseIntervals: [], stationProgress: {},
};
const initialTarget = {
  targetKey: "browser-dough-weight", kind: "weight", unit: "g", minimum: "400", maximum: "500",
  active: true, revision: 1, updatedBy: STAFF_ID, updatedAt: "2035-05-01T12:00:00.000Z",
};
let browser;

before(async () => {
  const engineName = process.env.BROWSER ?? process.env.BROWSER_ENGINE ?? "chromium";
  const browserType = { chromium, webkit, firefox }[engineName];
  assert.ok(browserType, `Unsupported browser engine: ${engineName}`);
  browser = await browserType.launch({ headless: true, args: engineName === "chromium" ? ["--no-sandbox"] : [] });
});

after(async () => {
  await browser?.close();
});

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

async function installQcApi(context, access) {
  const records = [];
  const receipts = new Map();
  const reads = [];
  let targets = [structuredClone(initialTarget)];
  let nextRecord = 1;
  const capabilities = access === "manager" ? ["record-qc", "manage-qc"] : access === "recorder" ? ["record-qc"] : [];
  const dashboard = () => ({
    run, highWaterMark: records.length ? records.at(-1).sequence : "0", records: structuredClone(records),
  });
  const evaluation = (details) => {
    const target = targets.find((item) => item.targetKey === details.targetKey) ?? null;
    if (!target) return { target: null, outcome: "not-evaluated", notEvaluatedReason: details.targetKey ? "target-unavailable" : "no-reviewed-target" };
    if (!target.active) return { target: structuredClone(target), outcome: "not-evaluated", notEvaluatedReason: "target-inactive" };
    if (target.unit !== details.unit) return { target: structuredClone(target), outcome: "not-evaluated", notEvaluatedReason: "unit-mismatch" };
    const value = Number(details.value);
    const pass = (target.minimum === null || value >= Number(target.minimum))
      && (target.maximum === null || value <= Number(target.maximum));
    return { target: structuredClone(target), outcome: pass ? "pass" : "fail", notEvaluatedReason: null };
  };
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v3/auth/session") {
      return json(route, { staff: { userId: STAFF_ID, username: access, role: access, capabilities } });
    }
    if (pathname === "/api/v3/auth/bootstrap-status") return json(route, { available: false });
    if (access === "denied") return json(route, { error: "Forbidden" }, 403);
    if (pathname === "/api/v3/runs" && request.method() === "GET") {
      reads.push(pathname);
      return json(route, { runs: [run] });
    }
    if (pathname === "/api/v3/qc/targets" && request.method() === "GET") {
      reads.push(pathname);
      return json(route, { targets });
    }
    if (pathname === `/api/v3/qc/runs/${RUN_ID}` && request.method() === "GET") {
      reads.push(pathname);
      return json(route, dashboard());
    }
    if (["/api/v3/qc/lots", "/api/v3/qc/weight-checks", "/api/v3/qc/brix-checks"].includes(pathname) && request.method() === "POST") {
      const body = request.postDataJSON();
      const prior = receipts.get(body.requestId);
      if (prior) return json(route, { ...prior, replayed: true });
      const kind = pathname.endsWith("lots") ? "lot" : pathname.endsWith("weight-checks") ? "weight-check" : "brix-check";
      const details = kind === "lot" ? body.details : { ...body.details, ...evaluation(body.details) };
      const record = {
        recordId: `77000000-0000-4000-8000-${String(1000 + nextRecord).padStart(12, "0")}`,
        sequence: String(100 + nextRecord), runId: RUN_ID, actorId: STAFF_ID, relatedRecordId: null,
        recordedAt: `2035-05-01T12:${String(nextRecord).padStart(2, "0")}:00.000Z`, kind, details,
      };
      nextRecord += 1;
      records.push(record);
      const response = { outcome: "accepted", replayed: false, record, ...dashboard() };
      receipts.set(body.requestId, response);
      return json(route, response, 201);
    }
    if (pathname === "/api/v3/qc/targets" && request.method() === "POST") {
      const body = request.postDataJSON();
      const existing = targets.find((target) => target.targetKey === body.targetKey);
      if ((existing?.revision ?? 0) !== body.expectedRevision) {
        return json(route, { outcome: "conflict", replayed: false, targets }, 409);
      }
      return json(route, { error: "The accessibility fixture only supports stale-target review." }, 400);
    }
    return json(route, { error: `Unexpected ${request.method()} ${pathname}` }, 404);
  });
  return {
    reads,
    reviseTarget: () => {
      targets = targets.map((target) => target.targetKey === initialTarget.targetKey
        ? { ...target, minimum: "420", maximum: "530", revision: 2 }
        : target);
    },
  };
}

async function openPage(t, { access = "manager", viewport = { width: 1440, height: 1000 } } = {}) {
  const baseUrl = await serveDist(t);
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  t.after(() => context.close());
  const api = await installQcApi(context, access);
  const page = await context.newPage();
  return { api, baseUrl, page };
}

async function openQc(page, baseUrl) {
  await page.goto(`${baseUrl}/#qc`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
  await page.getByRole("heading", { name: "QC Accessibility Pizza", exact: true }).waitFor();
}

async function showRecords(page) {
  await page.getByRole("tab", { name: /^Records/ }).click();
  await page.getByRole("heading", { name: "Ordered records", exact: true }).waitFor();
}

async function recordWeight(page, phase, value) {
  await page.getByRole("tab", { name: "Weight", exact: true }).click();
  const form = page.locator('form[aria-label="Record QC weight check"]');
  await form.getByLabel(/^Check phase/).selectOption(phase);
  await form.getByLabel("Observed weight", { exact: true }).fill(value);
  await form.getByLabel(/^Weight target/).selectOption("browser-dough-weight");
  await form.getByRole("button", { name: "Record weight check", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Weight check recorded with outcome" }).waitFor();
}

async function populateEvidence(page) {
  await page.getByLabel("Product code", { exact: true }).fill("FLOUR-01");
  await page.getByLabel("Lot number", { exact: true }).fill("LOT-ONE");
  await page.getByRole("button", { name: "Record lot", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lot evidence recorded." }).waitFor();
  await recordWeight(page, "pre-run", "450");
  await recordWeight(page, "30-minute", "550");
  await page.getByRole("tab", { name: "Brix", exact: true }).click();
  await page.getByLabel("Observed Brix", { exact: true }).fill("12.5");
  await page.getByRole("button", { name: "Record Brix check", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "No reviewed target selected" }).waitFor();
  await page.getByText("Not evaluated", { exact: true }).waitFor();
}

// Automated axe coverage supplements, but does not replace, manual screen-reader
// and visual contrast review. Scans use static copies of the rendered synthetic DOM.
async function scanSnapshot(page, configure) {
  const html = await page.evaluate(() => {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll("script").forEach((script) => script.remove());
    return `<!doctype html>${root.outerHTML}`;
  });
  const snapshot = await page.context().newPage();
  try {
    await snapshot.route("**/__qc_accessibility__", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await snapshot.goto(`${new URL(page.url()).origin}/__qc_accessibility__`, { waitUntil: "domcontentloaded" });
    await snapshot.evaluate(() => document.fonts.ready.then(() => undefined));
    const builder = new AxeBuilder({ page: snapshot });
    await configure(snapshot, builder);
    return (await builder.analyze()).violations;
  } finally {
    await snapshot.close();
  }
}

async function expectNoSeriousAccessibilityViolations(page, state) {
  // Firefox 1572 crashes during subsequent evaluation after these five rules
  // inspect the complete recording pages. Each partition gets a fresh static
  // snapshot; all other rules retain the full page, including cross-region IDs.
  const regionalRules = ["aria-allowed-attr", "aria-conditional-attr", "aria-prohibited-attr", "label-content-name-mismatch", "nested-interactive"];
  const violations = [];
  violations.push(...await scanSnapshot(page, (_snapshot, builder) => {
    builder.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(regionalRules);
  }));
  const formLabels = await page.locator("form[aria-label]:visible").evaluateAll((forms) => forms.map((form) => form.getAttribute("aria-label")));
  for (const label of formLabels) {
    violations.push(...await scanSnapshot(page, (_snapshot, builder) => {
      builder.withRules(regionalRules).include(`form[aria-label=${JSON.stringify(label)}]`);
    }));
  }
  violations.push(...await scanSnapshot(page, async (snapshot, builder) => {
    await snapshot.addStyleTag({ content: "form { display: none !important; }" });
    builder.withRules(regionalRules);
  }));
  const blocking = violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })),
    }));
  assert.deepEqual(blocking, [], `${state} must have no serious or critical accessibility violations`);
}

test("QC manager desktop empty evidence and lot form have no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t);
  await openQc(page, baseUrl);
  await showRecords(page);
  await page.getByText("No QC checks recorded for this run.", { exact: true }).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "manager desktop empty evidence and lot form");
});

test("QC manager desktop weight form has no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t);
  await openQc(page, baseUrl);
  await showRecords(page);
  await page.getByRole("tab", { name: "Weight", exact: true }).click();
  await page.getByLabel("Observed weight", { exact: true }).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "manager desktop weight form");
});

test("QC manager desktop Brix form has no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t);
  await openQc(page, baseUrl);
  await showRecords(page);
  await page.getByRole("tab", { name: "Brix", exact: true }).click();
  await page.getByLabel("Observed Brix", { exact: true }).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "manager desktop Brix form");
});

test("QC manager desktop populated evidence has no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t);
  await openQc(page, baseUrl);
  await showRecords(page);
  await populateEvidence(page);
  await showRecords(page);
  await page.getByRole("cell", { name: "FLOUR-01 · LOT-ONE", exact: true }).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "manager desktop populated evidence");
});

test("QC manager phone populated evidence has no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t, { viewport: { width: 390, height: 844 } });
  await openQc(page, baseUrl);
  await showRecords(page);
  await populateEvidence(page);
  await showRecords(page);
  await page.getByRole("cell", { name: "FLOUR-01 · LOT-ONE", exact: true }).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "manager phone populated evidence");
});

test("QC stale-target conflict review has no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { api, page, baseUrl } = await openPage(t);
  await openQc(page, baseUrl);
  await page.getByRole("tab", { name: /^Targets/ }).click();
  await page.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).click();
  await page.getByLabel("Minimum (optional)", { exact: true }).fill("430");
  api.reviseTarget();
  await page.getByRole("button", { name: "Save target", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Target changed before this save" }).waitFor();
  await page.getByText(/Current is revision 2: 420 to 530 g/).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "manager stale-target conflict review");
});

test("QC denied access has no serious accessibility violations and requests no private data", { timeout: 60_000 }, async (t) => {
  const { api, page, baseUrl } = await openPage(t, { access: "denied", viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/#qc`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "QC access required", exact: true }).waitFor();
  assert.equal(api.reads.length, 0, "denied users must not request QC or run data");
  await expectNoSeriousAccessibilityViolations(page, "denied QC access");
});

test("QC recorder read-only targets have no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t, { access: "recorder", viewport: { width: 1024, height: 768 } });
  await openQc(page, baseUrl);
  await page.getByRole("tab", { name: /^Targets/ }).click();
  await page.getByText("Read only", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "New target", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).count(), 0);
  await expectNoSeriousAccessibilityViolations(page, "recorder read-only targets");
});

test("QC recorder phone empty evidence and weight form have no serious accessibility violations", { timeout: 60_000 }, async (t) => {
  const { page, baseUrl } = await openPage(t, { access: "recorder", viewport: { width: 390, height: 844 } });
  await openQc(page, baseUrl);
  await showRecords(page);
  await page.getByText("No QC checks recorded for this run.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Weight", exact: true }).click();
  await page.getByLabel("Observed weight", { exact: true }).waitFor();
  await expectNoSeriousAccessibilityViolations(page, "recorder phone empty evidence and weight form");
});
