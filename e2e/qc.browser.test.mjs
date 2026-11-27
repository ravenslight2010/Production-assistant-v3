import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, firefox } from "playwright";

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
  setupSnapshot: { label: "QC Browser Pizza", targetCases: 20, productCode: "PIZZA-A", productionSetupCode: "LINE-A" },
  effectiveProductionPlan: null, substitutionOverlay: null,
  doughCapacity: { source: "reviewed", doughballYield: 600, pizzasPerCase: 12 },
  inventoryConsumption: null, pauseIntervals: [], stationProgress: {},
};
const REVIEWER_ID = "77000000-0000-4000-8000-000000000003";
const initialTarget = {
  targetKey: "browser-dough-weight", kind: "weight", unit: "g", minimum: "400", maximum: "500",
  active: true, revision: 1, updatedBy: STAFF_ID, updatedAt: "2035-05-01T12:00:00.000Z",
};
const componentSnapshot = {
  productionDate: "2035-05-01", source: "effective-plan", overlayRevision: 0,
  planCode: "PLAN-QC", planName: "QC Browser Plan",
};
const components = [
  ["recipe:0:ingredient:0", "FLOUR-01", "Flour", "reviewed", ["wheat"]],
  ["recipe:0:ingredient:1", "CHEESE-01", "Cheese", "reviewed-empty", []],
  ["recipe:0:ingredient:2", "SAUCE-01", "Sauce", "unreviewed", []],
  ["recipe:0:ingredient:3", "HERB-01", "Herbs", "unavailable", []],
  ["recipe:0:ingredient:4", "OIL-01", "Oil", "invalid-mapping", []],
  ["packaging:0", "BOX-01", "Pizza box", "unavailable", []],
].map(([componentKey, productCode, productName, status, allergens]) => ({
  component: {
    componentKey, componentType: componentKey.startsWith("packaging:") ? "packaging" : "ingredient",
    recipeCode: componentKey.startsWith("packaging:") ? null : "PIZZA",
    recipeName: componentKey.startsWith("packaging:") ? null : "QC Browser Pizza",
    stationKey: componentKey.startsWith("packaging:") ? "packaging" : "frontline",
    productId: null, productCode, productName, quantity: "1", unit: "kg",
  },
  mapping: { componentKey, productCode: status === "unavailable" || status === "invalid-mapping" ? null : productCode, status, allergens },
}));

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

async function openBrowser(t) {
  const browserType = { webkit, firefox }[process.env.BROWSER] || chromium;
  const args = browserType === chromium ? ["--no-sandbox"] : [];
  const browser = await browserType.launch({ headless: true, args });
  t.after(() => browser.close());
  return browser;
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

async function installQcApi(context, baseUrl, { access = "manager" } = {}) {
  const records = [];
  const receipts = new Map();
  const writes = [];
  const reads = [];
  let targets = [structuredClone(initialTarget)];
  let loseNextLot = false;
  let loseNextComponent = false;
  let denyNextSelfVerification = false;
  let actorId = STAFF_ID;
  let nextRecord = 1;
  const capabilities = access === "manager" ? ["record-qc", "manage-qc"] : access === "recorder" ? ["record-qc"] : [];
  const latestSignOff = () => [...records].reverse().find((record) => record.kind === "sign-off");
  const dashboard = () => {
    const signOff = latestSignOff();
    return {
      run, highWaterMark: records.length ? records.at(-1).sequence : "0", records: structuredClone(records),
      components: components.map((item) => structuredClone(item.component)), componentSnapshot: structuredClone(componentSnapshot),
      allergenMappings: components.map((item) => structuredClone(item.mapping)),
      signOff: signOff ? {
        recordId: signOff.recordId, actorId: signOff.actorId,
        highWaterMark: signOff.details.highWaterMark, signedAt: signOff.recordedAt,
      } : null,
      newEvidenceSinceSignOff: signOff ? records.some((record) => record.kind !== "sign-off"
        && BigInt(record.sequence) > BigInt(signOff.details.highWaterMark)) : false,
    };
  };
  const appendRecord = (kind, details, { actorId: recordActorId = actorId, relatedRecordId = null } = {}) => {
    const record = {
      recordId: `77000000-0000-4000-8000-${String(1000 + nextRecord).padStart(12, "0")}`,
      sequence: String(100 + nextRecord), runId: RUN_ID, actorId: recordActorId, relatedRecordId,
      recordedAt: `2035-05-01T12:${String(nextRecord).padStart(2, "0")}:00.000Z`, kind, details,
    };
    nextRecord += 1;
    records.push(record);
    return record;
  };
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
      return json(route, { staff: { userId: actorId, username: actorId === REVIEWER_ID ? "reviewer" : access, role: access, capabilities } });
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
      writes.push({ pathname, body });
      const prior = receipts.get(body.requestId);
      if (prior) return json(route, { ...prior, replayed: true });
      const kind = pathname.endsWith("lots") ? "lot" : pathname.endsWith("weight-checks") ? "weight-check" : "brix-check";
      const details = kind === "lot" ? body.details : { ...body.details, ...evaluation(body.details) };
      const record = appendRecord(kind, details);
      const response = { outcome: "accepted", replayed: false, record, ...dashboard() };
      receipts.set(body.requestId, response);
      if (loseNextLot && kind === "lot") {
        loseNextLot = false;
        return json(route, { error: "Synthetic QC response loss after commit." }, 500);
      }
      return json(route, response, 201);
    }
    if (["/api/v3/qc/component-checks", "/api/v3/qc/allergen-reviews", "/api/v3/qc/cleaning-records"].includes(pathname) && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ pathname, body });
      const prior = receipts.get(body.requestId);
      if (prior) return json(route, { ...prior, replayed: true });
      const kind = pathname.endsWith("component-checks") ? "component-check"
        : pathname.endsWith("allergen-reviews") ? "allergen-review" : "cleaning";
      const fixture = kind === "cleaning" ? null : components.find((item) => item.component.componentKey === body.details.componentKey);
      if (kind !== "cleaning" && !fixture) return json(route, { error: "Unknown effective component." }, 400);
      const details = kind === "component-check"
        ? { ...body.details, component: structuredClone(fixture.component), componentSnapshot: structuredClone(componentSnapshot) }
        : kind === "allergen-review" ? {
          ...body.details, component: structuredClone(fixture.component), componentSnapshot: structuredClone(componentSnapshot),
          allergenMapping: structuredClone(fixture.mapping),
        } : body.details;
      const record = appendRecord(kind, details);
      const response = { outcome: "accepted", replayed: false, record, ...dashboard() };
      receipts.set(body.requestId, response);
      if (loseNextComponent && kind === "component-check") {
        loseNextComponent = false;
        return json(route, { error: "Synthetic component response loss after commit." }, 500);
      }
      return json(route, response, 201);
    }
    const verificationMatch = pathname.match(/^\/api\/v3\/qc\/cleaning-records\/([0-9a-f-]{36})\/verification$/u);
    if (verificationMatch && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ pathname, body });
      const prior = receipts.get(body.requestId);
      if (prior) return json(route, { ...prior, replayed: true });
      if (denyNextSelfVerification) {
        denyNextSelfVerification = false;
        return json(route, { error: "A different authorized QC manager must verify this cleaning evidence." }, 403);
      }
      const cleaning = records.find((record) => record.recordId === verificationMatch[1] && record.kind === "cleaning");
      if (!cleaning) return json(route, { error: "Cleaning evidence was not found." }, 404);
      const record = appendRecord("cleaning-verification", body.details, { relatedRecordId: cleaning.recordId });
      const response = { outcome: "accepted", replayed: false, record, ...dashboard() };
      receipts.set(body.requestId, response);
      return json(route, response, 201);
    }
    if (pathname === `/api/v3/qc/runs/${RUN_ID}/sign-off` && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ pathname, body });
      const prior = receipts.get(body.requestId);
      if (prior) return json(route, { ...prior, replayed: true });
      if (body.expectedHighWaterMark !== dashboard().highWaterMark) {
        return json(route, {
          outcome: "conflict", replayed: false, expectedHighWaterMark: body.expectedHighWaterMark, ...dashboard(),
        }, 409);
      }
      const record = appendRecord("sign-off", { highWaterMark: body.expectedHighWaterMark });
      const response = { outcome: "accepted", replayed: false, record, ...dashboard() };
      receipts.set(body.requestId, response);
      return json(route, response, 201);
    }
    if (pathname === "/api/v3/qc/targets" && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ pathname, body });
      const prior = receipts.get(body.requestId);
      if (prior) return json(route, { ...prior, replayed: true });
      const existing = targets.find((target) => target.targetKey === body.targetKey);
      if ((existing?.revision ?? 0) !== body.expectedRevision) {
        return json(route, { outcome: "conflict", replayed: false, targets }, 409);
      }
      const target = {
        targetKey: body.targetKey, ...body.details, revision: body.expectedRevision + 1,
        updatedBy: STAFF_ID, updatedAt: "2035-05-01T13:00:00.000Z",
      };
      targets = existing ? targets.map((item) => item.targetKey === target.targetKey ? target : item) : [...targets, target];
      const response = { outcome: "accepted", replayed: false, target, targets };
      receipts.set(body.requestId, response);
      return json(route, response);
    }
    return json(route, { error: `Unexpected ${request.method()} ${pathname}` }, 404);
  });
  return {
    writes, reads,
    loseNextLot: () => { loseNextLot = true; },
    loseNextComponent: () => { loseNextComponent = true; },
    denyNextSelfVerification: () => { denyNextSelfVerification = true; },
    actAsReviewer: () => { actorId = REVIEWER_ID; },
    addLotEvidence: () => appendRecord("lot", { productCode: "FLOUR-01", lotNumber: "LATER-EVIDENCE", notes: "" }),
    records: () => records,
    targets: () => targets,
  };
}

async function openQc(page, baseUrl) {
  await page.goto(`${baseUrl}/#qc`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
  await page.getByRole("heading", { name: "QC Browser Pizza", exact: true }).waitFor();
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
  await page.getByRole("status").filter({ hasText: `Weight check recorded with outcome` }).waitFor();
}

test("QC evidence supports exact retry, canonical readback, target history, and stale review", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const browser = await openBrowser(t);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const api = await installQcApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openQc(page, baseUrl);
  await page.getByText("0", { exact: true }).first().waitFor();
  await showRecords(page);
  await page.getByText("No QC checks recorded for this run.", { exact: true }).waitFor();

  await page.getByLabel("Product code", { exact: true }).fill("FLOUR-01");
  await page.getByLabel("Lot number", { exact: true }).fill("LOT-ONE");
  await page.getByLabel("Lot notes (optional)", { exact: true }).fill("Seal intact");
  await page.getByRole("button", { name: "Record lot", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Lot evidence recorded." }).waitFor();
  await page.getByRole("cell").filter({ hasText: "FLOUR-01 · LOT-ONE" }).waitFor();

  await recordWeight(page, "pre-run", "450");
  await page.getByText("pass", { exact: true }).first().waitFor();
  await recordWeight(page, "30-minute", "550");
  await page.getByText("fail", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Brix", exact: true }).click();
  await page.getByLabel("Observed Brix", { exact: true }).fill("12.5");
  await page.getByRole("button", { name: "Record Brix check", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "No reviewed target selected" }).waitFor();
  await page.getByText("Not evaluated", { exact: true }).waitFor();

  api.loseNextLot();
  await page.getByRole("tab", { name: "Lot", exact: true }).click();
  await page.getByLabel("Product code", { exact: true }).fill("FLOUR-01");
  await page.getByLabel("Lot number", { exact: true }).fill("LOT-RETRY");
  await page.getByRole("button", { name: "Record lot", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic QC response loss after commit." }).waitFor();
  const retained = api.writes.at(-1).body;
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Previous request confirmed by exact retry. Lot evidence recorded." }).waitFor();
  const attempts = api.writes.filter((entry) => entry.body.requestId === retained.requestId);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(api.records().filter((record) => record.details.lotNumber === "LOT-RETRY").length, 1);

  await page.reload();
  await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
  await showRecords(page);
  await page.getByRole("cell", { name: "FLOUR-01 · LOT-RETRY", exact: true }).waitFor();
  assert.equal(api.records().length, 5);

  const secondPage = await context.newPage();
  await openQc(secondPage, baseUrl);
  await showRecords(secondPage);
  await secondPage.getByRole("cell", { name: "FLOUR-01 · LOT-RETRY", exact: true }).waitFor();

  await page.getByRole("tab", { name: /^Targets/ }).click();
  await page.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).click();
  await page.getByLabel("Minimum (optional)", { exact: true }).fill("410");
  await page.getByLabel("Maximum (optional)", { exact: true }).fill("520");
  await page.getByRole("button", { name: "Save target", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "saved at revision 2" }).waitFor();
  await showRecords(page);
  await page.getByText("browser-dough-weight · revision 1", { exact: true }).first().waitFor();
  await secondPage.getByRole("button", { name: "Refresh QC server state", exact: true }).click();
  await secondPage.getByRole("status").filter({ hasText: "QC server state confirmed." }).waitFor();

  await page.getByRole("tab", { name: /^Targets/ }).click();
  await page.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).click();
  await page.getByLabel("Minimum (optional)", { exact: true }).fill("430");
  await secondPage.getByRole("tab", { name: /^Targets/ }).click();
  await secondPage.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).click();
  await secondPage.getByLabel("Minimum (optional)", { exact: true }).fill("420");
  await secondPage.getByLabel("Maximum (optional)", { exact: true }).fill("530");
  await secondPage.getByRole("button", { name: "Save target", exact: true }).click();
  await secondPage.getByRole("status").filter({ hasText: "saved at revision 3" }).waitFor();
  await page.getByRole("button", { name: "Save target", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Target changed before this save" }).waitFor();
  await page.getByText(/Current is revision 3: 420 to 530 g/).waitFor();
  await page.getByText(/Your unapplied values: 430 to 520 g/).waitFor();
  await page.getByRole("button", { name: "Load current values for review", exact: true }).click();
  assert.equal(await page.getByLabel("Minimum (optional)", { exact: true }).inputValue(), "420");
  assert.equal(await page.getByLabel("Maximum (optional)", { exact: true }).inputValue(), "530");
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const scroller = document.querySelector("nav > div");
      const style = scroller ? getComputedStyle(scroller) : null;
      return {
        fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
        documentWidth: document.documentElement.scrollWidth,
        scroller: scroller ? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, overflowX: style?.overflowX, width: style?.width, minWidth: style?.minWidth } : null,
        offenders: [...document.querySelectorAll("main *")].flatMap((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || (rect.right <= window.innerWidth + 1 && rect.left >= -1)) return [];
          return [{ tag: element.tagName, id: element.id, class: typeof element.className === "string" ? element.className.slice(0, 160) : "", left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }];
        }).slice(0, 20),
      };
    });
    assert.ok(layout.fits, `manager QC must not overflow at ${viewport.width}px: ${JSON.stringify(layout)}`);
  }
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("QC roles, keyboard forms, offline reads, and phone/tablet layout stay bounded", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const browser = await openBrowser(t);

  const deniedContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const deniedApi = await installQcApi(deniedContext, baseUrl, { access: "denied" });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(`${baseUrl}/#qc`);
  await deniedPage.getByRole("heading", { name: "QC access required", exact: true }).waitFor();
  assert.equal(deniedApi.reads.length, 0, "denied users must not request QC or run data");
  await deniedContext.close();

  const recorderContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
  await installQcApi(recorderContext, baseUrl, { access: "recorder" });
  const recorderPage = await recorderContext.newPage();
  await openQc(recorderPage, baseUrl);
  await recorderPage.getByRole("tab", { name: /^Targets/ }).click();
  await recorderPage.getByText("Read only", { exact: true }).waitFor();
  assert.equal(await recorderPage.getByRole("button", { name: "New target", exact: true }).count(), 0);
  assert.equal(await recorderPage.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).count(), 0);
  await recorderContext.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const api = await installQcApi(context, baseUrl);
  const page = await context.newPage();
  await openQc(page, baseUrl);
  await showRecords(page);
  await page.getByRole("tab", { name: "Lot", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Weight", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Weight");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 768, height: 1024 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText(/Offline read-only view. Showing QC values confirmed/).waitFor();
  assert.equal(await page.getByLabel("Observed weight", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Record weight check", exact: true }).isDisabled(), true);
  await page.getByRole("tab", { name: /^Targets/ }).click();
  assert.equal(await page.getByRole("button", { name: "New target", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Edit target browser-dough-weight", exact: true }).isDisabled(), true);
  assert.equal(api.writes.length, writesBeforeOffline, "offline QC mode must not issue writes");
});


test("QC run verification preserves effective evidence, independent review, exact retry, and sign-off boundaries", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const browser = await openBrowser(t);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const api = await installQcApi(context, baseUrl);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openQc(page, baseUrl);
  await page.getByRole("tab", { name: "Run verification", exact: true }).click();
  await page.getByRole("heading", { name: "Component identity and presence", exact: true }).waitFor();
  await page.getByText("Pizza box", { exact: true }).waitFor();
  assert.equal(await page.getByText("Not recorded", { exact: true }).count(), 6);

  const allergenPanel = page.locator('section[aria-labelledby="qc-allergens-heading"]');
  await allergenPanel.getByText(/Reviewed: wheat/).first().waitFor();
  await allergenPanel.getByText(/Reviewed: no fixed allergens listed/).waitFor();
  await allergenPanel.getByText(/Unreviewed: allergen status is unknown, not allergen-free/).waitFor();
  await allergenPanel.getByText(/Unavailable: no canonical allergen mapping is available/).waitFor();
  await allergenPanel.getByText(/Invalid mapping: review the canonical setup record; this is not allergen-free/).waitFor();

  const componentForm = page.locator('form[aria-label="Record QC component check"]');
  await componentForm.getByLabel(/^Presence/).selectOption("present");
  await componentForm.getByLabel("Component notes (optional)", { exact: true }).fill("Identity matched");
  await componentForm.getByRole("button", { name: "Record component check", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Component check recorded." }).waitFor();
  await page.locator('section[aria-labelledby="qc-components-heading"]').getByRole("list").getByText("Present", { exact: true }).waitFor();

  const allergenForm = page.locator('form[aria-label="Record QC allergen review"]');
  await allergenForm.getByLabel(/^Ingredient to review/).selectOption("recipe:0:ingredient:1");
  await allergenForm.getByLabel(/^Staging status/).selectOption("staged");
  await allergenForm.getByLabel("Allergen review notes (optional)", { exact: true }).fill("Separated staging confirmed");
  await allergenForm.getByRole("button", { name: "Record allergen review", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Allergen review recorded." }).waitFor();
  await allergenPanel.getByText("Staging: Staged", { exact: true }).waitFor();

  const cleaningForm = page.locator('form[aria-label="Record QC cleaning"]');
  await cleaningForm.getByLabel("Area or equipment", { exact: true }).fill("Mixer 1");
  await cleaningForm.getByLabel(/^Cleaning status/).selectOption("cleaned");
  await cleaningForm.getByLabel("Cleaning notes (optional)", { exact: true }).fill("Food-contact surfaces cleaned");
  await cleaningForm.getByRole("button", { name: "Record cleaning", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Cleaning recorded." }).waitFor();

  api.denyNextSelfVerification();
  await page.getByRole("button", { name: "Record verification for Mixer 1", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Your session no longer authorizes this QC record." }).waitFor();
  assert.equal(api.records().filter((record) => record.kind === "cleaning-verification").length, 0);
  api.actAsReviewer();
  await page.reload();
  await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Run verification", exact: true }).click();
  await page.getByRole("button", { name: "Record verification for Mixer 1", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Cleaning verification recorded." }).waitFor();
  await page.getByText(new RegExp(`Verified by\\s*${REVIEWER_ID}`)).waitFor();

  await page.getByRole("button", { name: "Sign off current QC evidence", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "QC evidence signed off through high-water mark 104." }).waitFor();
  const signOffPanel = page.locator('section[aria-labelledby="qc-signoff-heading"]');
  await signOffPanel.getByText(REVIEWER_ID, { exact: true }).waitFor();
  await signOffPanel.getByText("104", { exact: true }).waitFor();
  assert.equal(await signOffPanel.getByText(/New evidence recorded since sign-off/).count(), 0);

  api.addLotEvidence();
  await page.getByRole("button", { name: "Sign off current QC evidence", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "No sign-off was written." }).waitFor();
  await signOffPanel.getByText(/New evidence recorded since sign-off/).waitFor();
  await signOffPanel.getByText(/existing sign-off is historical/).waitFor();
  assert.equal(api.records().filter((record) => record.kind === "sign-off").length, 1);

  api.loseNextComponent();
  await componentForm.getByLabel(/^Presence/).selectOption("absent");
  await componentForm.getByLabel("Component notes (optional)", { exact: true }).fill("Retry component evidence");
  await componentForm.getByRole("button", { name: "Record component check", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic component response loss after commit." }).waitFor();
  const retained = api.writes.at(-1).body;
  await page.reload();
  await page.getByRole("heading", { name: "Quality control", exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "One component-check record has not been confirmed." }).waitFor();
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Previous request confirmed by exact retry. Component check recorded." }).waitFor();
  const attempts = api.writes.filter((entry) => entry.body.requestId === retained.requestId);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(api.records().filter((record) => record.kind === "component-check"
    && record.details.notes === "Retry component evidence").length, 1);

  await page.getByRole("tab", { name: "Run verification", exact: true }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `run verification must not overflow at ${viewport.width}px`);
  }
  const writesBeforeOffline = api.writes.length;
  await context.setOffline(true);
  await page.getByText(/Offline read-only view. Showing QC values confirmed/).waitFor();
  for (const name of ["Record component check", "Record allergen review", "Record cleaning", "Record verification for Mixer 1", "Sign off current QC evidence"]) {
    assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true, `${name} must be disabled offline`);
  }
  assert.equal(api.writes.length, writesBeforeOffline, "offline run verification must not issue writes");
  assert.equal(errors.length, 0, errors.join("\n"));
});
