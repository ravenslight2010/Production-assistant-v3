import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRunApi, createRunApiForDatabase } from "./run-api.mjs";
import { RunCommandServiceError } from "../core/run-command-service.mjs";
import { RunServiceError } from "../core/run-service.mjs";

const RUN_ID = "00000000-0000-4000-8000-000000000004";
const PRODUCTION_DATE = "2026-11-10";
const RUN = {
  id: RUN_ID,
  status: "planned",
  productionDate: PRODUCTION_DATE,
  revision: 0,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  startedAt: null,
  pausedAt: null,
  resumedAt: null,
  completedAt: null,
  runToTime: "19:15",
  operationalNotes: "",
  setupSnapshot: { label: "Run A", targetCases: 12 },
  effectiveProductionPlan: null,
  substitutionOverlay: null,
  stoppages: [],
  pauseIntervals: [],
};
const PRODUCTION_PLAN = {
  code: "LINE-A",
  name: "Main line",
  warehouse: { id: "00000000-0000-4000-8000-000000000005", name: "Main warehouse" },
  recipes: [{
    code: "DOUGH-RECIPE",
    name: "Dough recipe",
    stationKey: "dough",
    ingredients: [{
      productId: "00000000-0000-4000-8000-000000000006",
      productCode: "FLOUR",
      productName: "Flour",
      quantity: "10",
      unit: "lb",
    }],
  }],
  packagingPerCase: [{
    productId: "00000000-0000-4000-8000-000000000007",
    productCode: "CARTON",
    productName: "Carton",
    quantity: "1",
    unit: "each",
  }],
};
const AUTH = { verified: true, facilityId: "00000000-0000-4000-8000-000000000001", actorId: "00000000-0000-4000-8000-000000000002" };

async function listenHandler(t, handler, calls = []) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

async function withApi(t, overrides = {}, options = {}) {
  const calls = [];
  const runs = {
    listProducts: async (input) => {
      calls.push(["listProducts", input]);
      return { products: [], productionWarehouse: null, dieTypes: [] };
    },
    list: async (input) => {
      calls.push(["list", input]);
      return [RUN];
    },
    listWithVersion: async (input) => {
      calls.push(["listWithVersion", input]);
      return { version: "7", runs: [RUN] };
    },
    listActiveWithVersion: async (input) => {
      calls.push(["listActiveWithVersion", input]);
      return { version: "7", runs: [RUN] };
    },
    listVersion: async (input) => {
      calls.push(["listVersion", input]);
      return "7";
    },
    get: async (input) => {
      calls.push(["get", input]);
      return input.runId === RUN_ID ? RUN : null;
    },
    create: async (input) => {
      calls.push(["create", input]);
      const replayed = input.requestId === "00000000-0000-4000-8000-000000000099";
      return { outcome: "created", replayed, run: { ...RUN, setupSnapshot: input.setupSnapshot } };
    },
  };
  const commands = {
    execute: async (input) => {
      calls.push(["command", input]);
      return input.command.commandType === "start"
        ? { outcome: "accepted", replayed: false, commandId: input.command.commandId, run: { ...RUN, status: "running", revision: 1 } }
        : { outcome: "conflict", expectedRevision: 0, currentRun: { ...RUN, status: "running", revision: 1 } };
    },
  };
  const lineTiming = {
    execute: async (input) => {
      calls.push(["lineTiming", input]);
      return { outcome: "accepted", replayed: false, commandId: input.command.commandId, run: { ...RUN, revision: 1 } };
    },
  };
  const outcomes = {
    execute: async (input) => {
      calls.push(["outcome", input]);
      return input.command.expectedRevision === 0
        ? {
            outcome: "accepted",
            replayed: false,
            commandId: input.command.commandId,
            run: { ...RUN, revision: 1, actualCases: input.command.actualCases, wasteLbs: input.command.wasteLbs },
          }
        : { outcome: "conflict", expectedRevision: input.command.expectedRevision, currentRun: { ...RUN, revision: 1 } };
    },
  };
  const runToTimes = {
    execute: async (input) => {
      calls.push(["runToTime", input]);
      return input.command.expectedRevision === 0
        ? { outcome: "accepted", replayed: false, commandId: input.command.commandId, run: { ...RUN, runToTime: "18:45", revision: 1 } }
        : { outcome: "conflict", expectedRevision: input.command.expectedRevision, currentRun: { ...RUN, runToTime: "18:45", revision: 1 } };
    },
  };
  const operations = {
    execute: async (input) => {
      calls.push(["operation", input]);
      return { outcome: "accepted", replayed: false, commandId: input.command.commandId, run: { ...RUN, revision: 1 } };
    },
    getStopReasons: async (input) => {
      calls.push(["getStopReasons", input]);
      return { revision: 0, reasons: ["Break"], updatedAt: null };
    },
    saveStopReasons: async (input) => {
      calls.push(["saveStopReasons", input]);
      return { outcome: "accepted", replayed: false, settings: { revision: 1, reasons: input.command.reasons, updatedAt: RUN.updatedAt } };
    },
  };
  const stations = {
    execute: async (input) => {
      calls.push(["station", input]);
      return {
        outcome: "accepted",
        replayed: false,
        commandId: input.command.commandId,
        stationKey: input.command.stationKey,
        run: { ...RUN, revision: 1, stationProgress: { [input.command.stationKey]: { progress: input.command.changes } } },
      };
    },
  };
  const operationalReads = {
    build: async (input) => {
      calls.push(["operational", input]);
      if (input.ifNoneMatch === '"3"') return { matched: true, etag: '"3"', revision: 3 };
      return {
        matched: false,
        etag: '"3"',
        revision: 3,
        body: { view: { snapshotId: "operational" }, projection: { runId: input.runId }, schedule: { runId: input.runId }, revision: 3, serverTimeMs: 1 },
      };
    },
  };
  const fillMissingScans = {
    build: async (input) => {
      calls.push(["fillMissingScan", input]);
      if (input.runId !== RUN_ID) return null;
      return {
        runId: input.runId,
        productCode: "CHEESE-16",
        gaps: [{
          key: "sauce.barrelLbs",
          runId: input.runId,
          label: "Sauce barrel (lbs)",
          category: "sauce",
          currentValue: null,
          proposedValue: 450,
          source: "learned",
          fillable: true,
          apply: { kind: "station_command", station: "sauce", field: "barrelLbs" },
        }],
      };
    },
  };
  const services = {
    runs: { ...runs, ...overrides.runs },
    commands: { ...commands, ...overrides.commands },
    runToTimes: { ...runToTimes, ...overrides.runToTimes },
    lineTiming: { ...lineTiming, ...overrides.lineTiming },
    outcomes: { ...outcomes, ...overrides.outcomes },
    operations: { ...operations, ...overrides.operations },
    stations: { ...stations, ...overrides.stations },
    operationalReads: { ...operationalReads, ...overrides.operationalReads },
    fillMissingScans: { ...fillMissingScans, ...overrides.fillMissingScans },
    authenticate: overrides.authenticate ?? (async () => AUTH),
    verifyCsrf: overrides.verifyCsrf ?? (async (request, auth) => auth === AUTH && request.headers["x-csrf-token"] === "ok"),
    maxBodyBytes: options.maxBodyBytes ?? 16 * 1024,
  };
  if (overrides.operationalReads === false) delete services.operationalReads;
  if (overrides.fillMissingScans === false) delete services.fillMissingScans;
  const handler = createRunApi(services);
  return listenHandler(t, handler, calls);
}

function withApiArgs(overrides = {}) {
  // Build the same service bag as withApi without listening, for construction-time guards.
  const noop = async () => ({});
  const base = {
    runs: { list: noop, listProducts: noop, get: noop, create: noop },
    commands: { execute: noop },
    runToTimes: { execute: noop },
    lineTiming: { execute: noop },
    outcomes: { execute: noop },
    operations: { execute: noop, getStopReasons: noop, saveStopReasons: noop },
    stations: { execute: noop },
    operationalReads: { build: noop },
    fillMissingScans: { build: noop },
    authenticate: noop,
    verifyCsrf: noop,
    maxBodyBytes: 16 * 1024,
    logger: () => {},
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === false) delete base[key];
    else base[key] = value;
  }
  return () => createRunApi(base);
}

async function send(baseUrl, path, { method = "GET", body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", "x-csrf-token": "ok", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("production rule blocks are definitive 422 responses and client bypasses are rejected", async (t) => {
  const { baseUrl, calls } = await withApi(t, {
    runs: { create: async () => {
      throw new RunServiceError("PRODUCTION_RULES_BLOCKED", "Production rules require review.", 422);
    } },
    commands: { execute: async () => {
      throw new RunCommandServiceError("PRODUCTION_RULES_BLOCKED", "Production rules require review.", 422);
    } },
  });
  const start = { commandId: "blocked-start", commandType: "start", expectedRevision: 0 };
  const command = await send(baseUrl, `/api/v3/runs/${RUN_ID}/commands`, { method: "POST", body: start });
  assert.equal(command.status, 422);
  assert.match((await command.json()).error, /Production rules require review/);
  const prepare = await send(baseUrl, "/api/v3/runs", {
    method: "POST", body: { requestId: RUN_ID, productionDate: PRODUCTION_DATE, setupSnapshot: { label: "Synthetic", targetCases: 10 } },
  });
  assert.equal(prepare.status, 422);
  const bypass = await send(baseUrl, `/api/v3/runs/${RUN_ID}/commands`, {
    method: "POST", body: { ...start, bypass: true },
  });
  assert.equal(bypass.status, 400);
  assert.equal(calls.length, 0);
});

test("serves facility-scoped list and detail reads with no-store JSON responses", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const listResponse = await send(baseUrl, "/api/v3/runs?limit=25");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "no-store");
  assert.match(listResponse.headers.get("content-type"), /application\/json/);
  assert.deepEqual((await listResponse.json()).runs, [RUN]);
  assert.equal(listResponse.headers.get("etag"), '"7-25-all"');
  // Version-first: the cheap outbox probe runs before the snapshot build.
  assert.deepEqual(calls.map(([name]) => name), ["listVersion", "listWithVersion"]);
  assert.deepEqual(calls[1], ["listWithVersion", { auth: AUTH, limit: 25 }]);

  const detailResponse = await send(baseUrl, `/api/v3/runs/${RUN_ID}`);
  assert.equal(detailResponse.status, 200);
  assert.deepEqual((await detailResponse.json()).run, RUN);
  assert.deepEqual(calls[2], ["get", { auth: AUTH, runId: RUN_ID }]);
});

test("answers conditional run-list polls with 304 while the outbox position is unchanged", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const first = await send(baseUrl, "/api/v3/runs?limit=25");
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.equal(etag, '"7-25-all"');
  assert.deepEqual(calls.map(([name]) => name), ["listVersion", "listWithVersion"]);

  const fresh = await send(baseUrl, "/api/v3/runs?limit=25", { headers: { "If-None-Match": etag } });
  assert.equal(fresh.status, 304);
  assert.equal(fresh.headers.get("etag"), etag);
  assert.equal(await fresh.text(), "");
  // A matching poll stops at the cheap probe and never builds the snapshot.
  assert.deepEqual(calls.map(([name]) => name), ["listVersion", "listWithVersion", "listVersion"]);

  const stale = await send(baseUrl, "/api/v3/runs?limit=25", { headers: { "If-None-Match": '"6-25-all"' } });
  assert.equal(stale.status, 200);
  assert.deepEqual((await stale.json()).runs, [RUN]);

  const otherLimit = await send(baseUrl, "/api/v3/runs?limit=10", { headers: { "If-None-Match": etag } });
  assert.equal(otherLimit.status, 200);
  assert.equal(otherLimit.headers.get("etag"), '"7-10-all"');

  const star = await send(baseUrl, "/api/v3/runs?limit=25", { headers: { "If-None-Match": "*" } });
  assert.equal(star.status, 200);
});

test("compresses large run-list bodies with gzip when the client accepts it", async (t) => {
  // Real floor payloads run ~3.4 KB per run; pad the mocked run past the
  // 1 KB compression floor so the test exercises the actual gzip branch.
  const bigRun = {
    ...RUN,
    stoppages: Array.from({ length: 24 }, (_, index) => ({
      id: `stop-${index}`,
      reason: "belt_jam",
      startedAt: "2026-11-10T12:00:00.000Z",
      endedAt: null,
    })),
  };
  const { baseUrl } = await withApi(t, {
    runs: { listWithVersion: async () => ({ version: "7", runs: [bigRun] }) },
  });
  // undici advertises gzip by default; identity keeps the plain branch honest.
  const plain = await send(baseUrl, "/api/v3/runs?limit=25", { headers: { "Accept-Encoding": "identity" } });
  assert.equal(plain.headers.get("content-encoding"), null);

  const zipped = await send(baseUrl, "/api/v3/runs?limit=25", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers.get("content-encoding"), "gzip");
  assert.match(zipped.headers.get("vary") ?? "", /Accept-Encoding/);
  assert.deepEqual((await zipped.json()).runs, [bigRun]);
  const compressedBytes = Number(zipped.headers.get("content-length"));
  assert.ok(compressedBytes < 1500, `gzip should shrink the padded body (got ${compressedBytes} bytes)`);
});

test("routes active-scope run-list polls to the active-only list with scope-scoped etags", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const active = await send(baseUrl, "/api/v3/runs?limit=25&scope=active");
  assert.equal(active.status, 200);
  assert.deepEqual((await active.json()).runs, [RUN]);
  assert.equal(active.headers.get("etag"), '"7-25-active"');
  assert.deepEqual(calls.map(([name]) => name), ["listVersion", "listActiveWithVersion"]);

  const fresh = await send(baseUrl, "/api/v3/runs?limit=25&scope=active", { headers: { "If-None-Match": '"7-25-active"' } });
  assert.equal(fresh.status, 304);

  const crossScope = await send(baseUrl, "/api/v3/runs?limit=25&scope=active", { headers: { "If-None-Match": '"7-25-all"' } });
  assert.equal(crossScope.status, 200, "an all-scope tag must not satisfy an active-scope poll");

  const badScope = await send(baseUrl, "/api/v3/runs?scope=recent");
  assert.equal(badScope.status, 400);

  const duplicateScope = await send(baseUrl, "/api/v3/runs?scope=all&scope=active");
  assert.equal(duplicateScope.status, 400);
});

test("surfaces run-list storage failures as safe 5xx responses", async (t) => {
  const { baseUrl } = await withApi(t, {
    runs: {
      listWithVersion: async () => {
        throw Object.assign(new Error("private storage details"), { code: "P2001" });
      },
    },
  });
  const response = await send(baseUrl, "/api/v3/runs?limit=25");
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /could not be completed/i);
  assert.ok(!JSON.stringify(body).includes("private storage details"));
});

test("accepts validated station commands and returns canonical run state", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const response = await send(baseUrl, `/api/v3/runs/${RUN_ID}/stations/packaging/commands`, {
    method: "POST",
    body: {
      commandId: "00000000-0000-4000-8000-000000000020",
      mode: "manual",
      expectedRevision: 0,
      changes: { casesPacked: 5 },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.outcome, "accepted");
  assert.equal(body.run.stationProgress.packaging.progress.casesPacked, 5);
  assert.deepEqual(calls[0], ["station", {
    auth: AUTH,
    command: {
      commandId: "00000000-0000-4000-8000-000000000020",
      mode: "manual",
      expectedRevision: 0,
      changes: { casesPacked: 5 },
      runId: RUN_ID,
      stationKey: "packaging",
    },
  }]);
});

test("rejects station mutations without CSRF and keeps stale station edits as conflicts", async (t) => {
  const denied = await withApi(t, { verifyCsrf: async () => false });
  const path = `/api/v3/runs/${RUN_ID}/stations/dough/commands`;
  const body = {
    commandId: "00000000-0000-4000-8000-000000000021",
    mode: "manual",
    expectedRevision: 0,
    changes: { casesProduced: 3 },
  };
  const deniedResponse = await send(denied.baseUrl, path, { method: "POST", body });
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.calls.length, 0);

  const conflict = await withApi(t, {
    stations: {
      execute: async () => ({ outcome: "conflict", currentRun: { ...RUN, revision: 2 } }),
    },
  });
  const conflictResponse = await send(conflict.baseUrl, path, { method: "POST", body });
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).currentRun.revision, 2);
});

test("creates runs with server authorization and returns replay status", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const input = {
    requestId: "00000000-0000-4000-8000-000000000005",
    productionDate: PRODUCTION_DATE,
    setupSnapshot: { label: "Night shift", targetCases: 48 },
  };
  const created = await send(baseUrl, "/api/v3/runs", { method: "POST", body: input });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { outcome: "created", replayed: false, run: { ...RUN, setupSnapshot: input.setupSnapshot } });
  assert.equal(calls[0][0], "create");
  assert.deepEqual(calls[0][1], { auth: AUTH, ...input });

  const replay = await send(baseUrl, "/api/v3/runs", {
    method: "POST",
    body: { ...input, requestId: "00000000-0000-4000-8000-000000000099" },
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
});

test("returns accepted lifecycle commands and preserves conflicts as 409 outcomes", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const accepted = await send(baseUrl, `/api/v3/runs/${RUN_ID}/commands`, {
    method: "POST",
    body: { commandId: "start-once", commandType: "start", expectedRevision: 0 },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).outcome, "accepted");
  assert.deepEqual(calls[0][1].command, {
    commandId: "start-once",
    commandType: "start",
    expectedRevision: 0,
    runId: RUN_ID,
  });

  const conflict = await send(baseUrl, `/api/v3/runs/${RUN_ID}/commands`, {
    method: "POST",
    body: { commandId: "pause-once", commandType: "pause", expectedRevision: 0 },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).outcome, "conflict");
});

test("accepts exact Run to Time requests and preserves canonical conflicts", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const path = `/api/v3/runs/${RUN_ID}/run-to-time`;
  const body = { commandId: "run-to-time-once", expectedRevision: 0, runToTime: "6:45 PM" };
  const accepted = await send(baseUrl, path, { method: "POST", body });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).run.runToTime, "18:45");
  assert.deepEqual(calls[0], ["runToTime", { auth: AUTH, command: { ...body, runId: RUN_ID } }]);

  const conflict = await send(baseUrl, path, {
    method: "POST", body: { ...body, commandId: "run-to-time-stale", expectedRevision: 1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).currentRun.runToTime, "18:45");

  const unsupported = await send(baseUrl, path, { method: "POST", body: { ...body, actorId: AUTH.actorId } });
  assert.equal(unsupported.status, 400);
});

test("accepts exact run outcome requests and preserves canonical conflicts", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const path = `/api/v3/runs/${RUN_ID}/outcome`;
  const body = { commandId: "outcome-once", expectedRevision: 0, actualCases: 104, wasteLbs: 3.25 };
  const accepted = await send(baseUrl, path, { method: "POST", body });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).run.actualCases, 104);
  assert.deepEqual(calls[0], ["outcome", { auth: AUTH, command: { ...body, runId: RUN_ID } }]);

  const conflict = await send(baseUrl, path, {
    method: "POST", body: { ...body, commandId: "outcome-stale", expectedRevision: 1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).currentRun.revision, 1);

  const unsupported = await send(baseUrl, path, {
    method: "POST", body: { ...body, commandId: "outcome-extra", wasteLbs: undefined },
  });
  assert.equal(unsupported.status, 400);

  const query = await send(baseUrl, `${path}?x=1`, { method: "POST", body });
  assert.equal(query.status, 400);

  const malformed = await send(baseUrl, "/api/v3/runs/not-a-uuid/outcome", { method: "POST", body });
  assert.equal(malformed.status, 400);
  assert.equal(calls.length, 2);
});

test("rejects unauthenticated requests and mutations without CSRF verification", async (t) => {
  const noAuth = await withApi(t, { authenticate: async () => null });
  const unauthenticated = await send(noAuth.baseUrl, "/api/v3/runs");
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Sign in to access runs." });

  const csrfDenied = await withApi(t, { verifyCsrf: async () => false });
  const response = await send(csrfDenied.baseUrl, "/api/v3/runs", {
    method: "POST",
    body: { requestId: "00000000-0000-4000-8000-000000000005", productionDate: PRODUCTION_DATE, setupSnapshot: { label: "Run", targetCases: 1 } },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Refresh your session before changing run state." });
});

test("bounds request bodies and validates query, content type, and JSON shape", async (t) => {
  const smallLimit = await withApi(t, {}, { maxBodyBytes: 8 });
  const tooLarge = await send(smallLimit.baseUrl, "/api/v3/runs", {
    method: "POST",
    body: { requestId: "1234567890" },
  });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: "The request is too large." });

  const { baseUrl } = await withApi(t);
  assert.equal((await send(baseUrl, "/api/v3/runs?limit=101")).status, 400);
  assert.equal((await send(baseUrl, "/api/v3/runs?unexpected=x")).status, 400);
  const noContentType = await fetch(`${baseUrl}/api/v3/runs`, {
    method: "POST",
    headers: { "x-csrf-token": "ok" },
    body: "{}",
  });
  assert.equal(noContentType.status, 415);
  const malformed = await fetch(`${baseUrl}/api/v3/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "ok" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("uses safe JSON errors for missing runs and unexpected service failures", async (t) => {
  const missing = await withApi(t, { runs: { get: async () => null } });
  const missingResponse = await send(missing.baseUrl, `/api/v3/runs/${RUN_ID}`);
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "Run not found." });

  const failing = await withApi(t, { runs: { listWithVersion: async () => { throw new Error("database password leaked"); } } });
  const failureResponse = await send(failing.baseUrl, "/api/v3/runs");
  assert.equal(failureResponse.status, 500);
  assert.deepEqual(await failureResponse.json(), { error: "The run request could not be completed. Refresh and try again." });
});

test("composes the HTTP API with server services and a parameterized PostgreSQL pool", async (t) => {
  const queries = [];
  const authorizations = [];
  const handler = createRunApiForDatabase({
    pool: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("v3.run_list_version")) return { rows: [{ result: "7" }] };
        if (sql.includes("v3.list_runs")) return { rows: [{ version: "7", result: [RUN] }] };
        if (sql.includes("v3.list_run_products")) return { rows: [{ result: {
          productionWarehouse: null,
          products: [{
            code: "DOUGH-A",
            name: "Dough A",
            doughCapacity: { status: "unavailable", reasons: ["dough_source_missing"] },
            productionSetups: [],
          }],
          dieTypes: [],
        } }] };
        if (sql.includes("v3.create_planned_run")) {
          const setupSnapshot = JSON.parse(params[5]);
          return {
            rows: [{
              result: {
                outcome: "created",
                replayed: false,
                run: {
                  ...RUN,
                  setupSnapshot: { ...setupSnapshot, productionPlan: PRODUCTION_PLAN },
                  effectiveProductionPlan: PRODUCTION_PLAN,
                },
              },
            }],
          };
        }
        if (sql.includes("v3.apply_run_to_time_command")) {
          return {
            rows: [{
              result: {
                outcome: "accepted",
                replayed: false,
                commandId: "run-to-time-integrated",
                run: { ...RUN, runToTime: params[5], revision: 1 },
              },
            }],
          };
        }
        if (sql.includes("v3.apply_run_lifecycle_command")) {
          return {
            rows: [{
              result: {
                outcome: "accepted",
                replayed: false,
                commandId: "start-from-db",
                run: { ...RUN, status: "running", revision: 1 },
              },
            }],
          };
        }
        throw new Error("Unexpected query");
      },
    },
    authorize: async ({ auth, action, commandType }) => {
      authorizations.push({ auth, action, commandType });
      return true;
    },
    authenticate: async () => AUTH,
    verifyCsrf: async (request, auth) => auth === AUTH && request.headers["x-csrf-token"] === "ok",
  });
  const { baseUrl } = await listenHandler(t, handler);

  const listResponse = await send(baseUrl, "/api/v3/runs");
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).runs, [RUN]);

  const productsResponse = await send(baseUrl, "/api/v3/runs/products");
  assert.equal(productsResponse.status, 200);
  assert.equal((await productsResponse.json()).products[0].code, "DOUGH-A");

  const createResponse = await send(baseUrl, "/api/v3/runs", {
    method: "POST",
    body: {
      requestId: "00000000-0000-4000-8000-000000000005",
      productionDate: PRODUCTION_DATE,
      setupSnapshot: {
        label: "Integrated run", targetCases: 24, productCode: "DOUGH-A", productionSetupCode: "LINE-A",
      },
    },
  });
  assert.equal(createResponse.status, 201);

  const commandResponse = await send(baseUrl, `/api/v3/runs/${RUN_ID}/commands`, {
    method: "POST",
    body: { commandId: "start-integrated", commandType: "start", expectedRevision: 0 },
  });
  assert.equal(commandResponse.status, 200);
  assert.equal((await commandResponse.json()).run.status, "running");

  const runToTimeResponse = await send(baseUrl, `/api/v3/runs/${RUN_ID}/run-to-time`, {
    method: "POST",
    body: { commandId: "run-to-time-integrated", expectedRevision: 0, runToTime: "6:45 PM" },
  });
  assert.equal(runToTimeResponse.status, 200);
  assert.equal((await runToTimeResponse.json()).run.runToTime, "18:45");

  // The list read now costs two queries: the cheap version probe plus the
  // snapshot build that only runs when the position moved.
  assert.equal(queries.length, 6);
  assert.ok(queries.every(({ sql, params }) => sql.includes("$1") && Array.isArray(params)));
  assert.deepEqual(authorizations.map(({ action }) => action), ["run.read", "run.read", "run.read", "run.create", "run.lifecycle.command", "run.lifecycle.command"]);
  assert.equal(authorizations[4].commandType, "start");
  assert.equal(authorizations[5].commandType, "run_to_time");
  assert.ok(authorizations.every(({ auth }) => auth === AUTH));
});


test("serves stop reasons and forwards exact operational commands", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const reasons = await send(baseUrl, "/api/v3/operations/stop-reasons");
  assert.equal(reasons.status, 200);
  assert.deepEqual((await reasons.json()).settings.reasons, ["Break"]);

  const saved = await send(baseUrl, "/api/v3/operations/stop-reasons", {
    method: "POST",
    body: { commandId: "reasons-1", expectedRevision: 0, reasons: ["Break", "Quality hold"] },
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).settings.revision, 1);

  const response = await send(baseUrl, `/api/v3/runs/${RUN_ID}/operations/commands`, {
    method: "POST",
    body: {
      commandId: "notes-1", commandType: "set_notes", expectedRevision: 0,
      details: { operationalNotes: "Watch the freezer infeed." },
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), ["operation", {
    auth: AUTH,
    command: {
      runId: RUN_ID, commandId: "notes-1", commandType: "set_notes", expectedRevision: 0,
      details: { operationalNotes: "Watch the freezer infeed." },
    },
  }]);

  const bypass = await send(baseUrl, `/api/v3/runs/${RUN_ID}/operations/commands`, {
    method: "POST",
    body: {
      commandId: "notes-2", commandType: "set_notes", expectedRevision: 0,
      details: { operationalNotes: "No" }, bypass: true,
    },
  });
  assert.equal(bypass.status, 400);
});

test("serves the server-owned operational read with a revision ETag and answers matching polls with 304", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const first = await send(baseUrl, `/api/v3/runs/${RUN_ID}/operational`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("etag"), '"3"');
  const body = await first.json();
  assert.equal(body.revision, 3);
  assert.equal(body.projection.runId, RUN_ID);
  assert.deepEqual(calls.map(([name]) => name), ["operational"]);

  const fresh = await send(baseUrl, `/api/v3/runs/${RUN_ID}/operational`, { headers: { "If-None-Match": '"3"' } });
  assert.equal(fresh.status, 304);
  assert.equal(fresh.headers.get("etag"), '"3"');
  assert.equal(await fresh.text(), "");
  assert.deepEqual(calls.map(([name]) => name), ["operational", "operational"]);
  assert.equal(calls[1][1].ifNoneMatch, '"3"');
});

test("serves the fill-missing scan with proposals and routing metadata", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const response = await send(baseUrl, `/api/v3/runs/${RUN_ID}/fill-missing`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.runId, RUN_ID);
  assert.equal(body.productCode, "CHEESE-16");
  assert.equal(body.gaps.length, 1);
  assert.equal(body.gaps[0].key, "sauce.barrelLbs");
  assert.equal(body.gaps[0].source, "learned");
  assert.deepEqual(body.gaps[0].apply, { kind: "station_command", station: "sauce", field: "barrelLbs" });
  assert.deepEqual(calls.map(([name]) => name), ["fillMissingScan"]);
  assert.equal(calls[0][1].runId, RUN_ID);
  assert.equal(calls[0][1].auth, AUTH);
});

test("answers 404 when the fill-missing scan finds no run and 400 for malformed ids", async (t) => {
  const { baseUrl } = await withApi(t);
  const missing = await send(baseUrl, "/api/v3/runs/00000000-0000-4000-8000-000000000099/fill-missing");
  assert.equal(missing.status, 404);
  const malformed = await send(baseUrl, "/api/v3/runs/not-a-uuid/fill-missing");
  assert.equal(malformed.status, 400);
  const query = await send(baseUrl, `/api/v3/runs/${RUN_ID}/fill-missing?x=1`);
  assert.equal(query.status, 400);
});

test("requires the fill-missing scan service at construction time", () => {
  assert.throws(
    withApiArgs({ fillMissingScans: false }),
    /fill-missing scan service must provide build/,
  );
});

test("rejects operational query parameters and malformed run ids", async (t) => {
  const { baseUrl, calls } = await withApi(t);
  const query = await send(baseUrl, `/api/v3/runs/${RUN_ID}/operational?x=1`);
  assert.equal(query.status, 400);

  const malformed = await send(baseUrl, "/api/v3/runs/not-a-uuid/operational");
  assert.equal(malformed.status, 400);
  assert.deepEqual(calls, []);
});

test("returns 404 for the operational route when the read service is not configured", async (t) => {
  const { baseUrl } = await withApi(t, { operationalReads: false });
  const response = await send(baseUrl, `/api/v3/runs/${RUN_ID}/operational`);
  assert.equal(response.status, 404);
});
