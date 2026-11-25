import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createQcApi } from "./qc-api.mjs";

const FACILITY_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000002";
const RUN_ID = "10000000-0000-4000-8000-000000000003";
const RECORD_ID = "10000000-0000-4000-8000-000000000004";
const REQUEST_ID = "10000000-0000-4000-8000-000000000005";
const RECORDER = {
  verified: true,
  facilityId: FACILITY_ID,
  actorId: ACTOR_ID,
  capabilities: ["record-qc"],
};
const MANAGER = { ...RECORDER, capabilities: ["record-qc", "manage-qc"] };
const TARGET = {
  targetKey: "dough-ball",
  kind: "weight",
  unit: "g",
  minimum: "250",
  maximum: "260",
  active: true,
  revision: 1,
  updatedBy: ACTOR_ID,
  updatedAt: "2026-11-25T12:00:00.000Z",
};
const LOT = {
  recordId: RECORD_ID,
  sequence: "1",
  runId: RUN_ID,
  kind: "lot",
  actorId: ACTOR_ID,
  relatedRecordId: null,
  recordedAt: "2026-11-25T12:00:00.000Z",
  details: { productCode: "FLOUR", lotNumber: "LOT-A", notes: "" },
};

function dashboard(record = null) {
  return {
    run: { id: RUN_ID },
    highWaterMark: record ? record.sequence : "0",
    records: record ? [record] : [],
  };
}

function accepted(record = LOT, replayed = false) {
  return { outcome: "accepted", replayed, record, ...dashboard(record) };
}

async function withApi(t, {
  auth = MANAGER,
  csrf = true,
  query = async () => ({ rows: [{ result: dashboard() }] }),
  logger = () => {},
} = {}) {
  const calls = [];
  const pool = {
    async query(config) {
      calls.push(config);
      return query(config.text, config.values);
    },
  };
  const handler = createQcApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger,
  });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found." }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls };
}

function send(baseUrl, path, { method = "GET", body, rawBody, contentType = "application/json", csrf = true } = {}) {
  const hasBody = body !== undefined || rawBody !== undefined;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: hasBody || contentType !== null ? {
      ...(contentType === null ? {} : { "content-type": contentType }),
      ...(method === "POST" && csrf ? { "x-csrf-token": "ok" } : {}),
    } : {},
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

function lotBody(requestId = REQUEST_ID) {
  return {
    requestId,
    runId: RUN_ID,
    details: { productCode: "FLOUR", lotNumber: "LOT-A", notes: "" },
  };
}

test("QC reads and writes require verified capability-holding staff before database work", async (t) => {
  const anonymous = await withApi(t, { auth: null });
  assert.equal((await send(anonymous.baseUrl, "/api/v3/qc/targets")).status, 401);
  assert.equal(anonymous.calls.length, 0);

  const operator = await withApi(t, { auth: { ...RECORDER, capabilities: [] } });
  const read = await send(operator.baseUrl, `/api/v3/qc/runs/${RUN_ID}`);
  assert.equal(read.status, 403);
  const write = await send(operator.baseUrl, "/api/v3/qc/lots", { method: "POST", body: lotBody() });
  assert.equal(write.status, 403);
  assert.equal(operator.calls.length, 0);

  const recorder = await withApi(t, { auth: RECORDER });
  const target = await send(recorder.baseUrl, "/api/v3/qc/targets", {
    method: "POST",
    body: {
      requestId: REQUEST_ID,
      targetKey: "dough-ball",
      expectedRevision: 0,
      details: { kind: "weight", unit: "g", minimum: "250", maximum: "260", active: true },
    },
  });
  assert.equal(target.status, 403);
  assert.equal(recorder.calls.length, 0);
});

test("QC mutations require CSRF and all QC routes reject query parameters", async (t) => {
  const denied = await withApi(t, { csrf: false });
  const response = await send(denied.baseUrl, "/api/v3/qc/lots", { method: "POST", body: lotBody(), csrf: false });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Refresh your session before changing QC state." });
  assert.equal(denied.calls.length, 0);

  const queried = await send(denied.baseUrl, "/api/v3/qc/targets?facility=other");
  assert.equal(queried.status, 400);
  assert.equal(denied.calls.length, 0);
});

test("QC request envelopes and JSON bodies are strict and bounded", async (t) => {
  const api = await withApi(t);
  const cases = [
    ["/api/v3/qc/lots", { ...lotBody(), extra: true }, 400],
    ["/api/v3/qc/lots", { ...lotBody(), details: { productCode: "FLOUR" } }, 400],
    ["/api/v3/qc/targets", { requestId: REQUEST_ID }, 400],
  ];
  for (const [path, body, status] of cases) {
    assert.equal((await send(api.baseUrl, path, { method: "POST", body })).status, status);
  }
  assert.equal((await send(api.baseUrl, "/api/v3/qc/lots", {
    method: "POST", rawBody: "{", contentType: "application/json",
  })).status, 400);
  assert.equal((await send(api.baseUrl, "/api/v3/qc/lots", {
    method: "POST", rawBody: "[]", contentType: "application/json",
  })).status, 400);
  assert.equal((await send(api.baseUrl, "/api/v3/qc/lots", {
    method: "POST", rawBody: JSON.stringify(lotBody()), contentType: "text/plain",
  })).status, 415);
  assert.equal((await send(api.baseUrl, "/api/v3/qc/lots", {
    method: "POST", rawBody: "", contentType: "application/json",
  })).status, 400);
  assert.equal((await send(api.baseUrl, "/api/v3/qc/lots", {
    method: "POST", rawBody: JSON.stringify({ padding: "x".repeat(33 * 1024) }), contentType: "application/json",
  })).status, 413);
  assert.equal(api.calls.length, 0);
});

test("QC route methods return explicit 405 responses with Allow headers", async (t) => {
  const api = await withApi(t);
  const recordRead = await send(api.baseUrl, "/api/v3/qc/lots");
  assert.equal(recordRead.status, 405);
  assert.equal(recordRead.headers.get("allow"), "POST");
  const dashboardWrite = await send(api.baseUrl, `/api/v3/qc/runs/${RUN_ID}`, {
    method: "POST", body: {},
  });
  assert.equal(dashboardWrite.status, 405);
  assert.equal(dashboardWrite.headers.get("allow"), "GET");
  const targetDelete = await send(api.baseUrl, "/api/v3/qc/targets", { method: "DELETE" });
  assert.equal(targetDelete.status, 405);
  assert.equal(targetDelete.headers.get("allow"), "GET, POST");
  assert.equal(api.calls.length, 0);
});

test("QC dashboard, target, and lot routes return validated canonical responses", async (t) => {
  const api = await withApi(t, {
    query: async (sql) => ({ rows: [{ result: sql.includes("get_qc_targets") ? { targets: [TARGET] }
      : sql.includes("save_qc_target") ? { outcome: "accepted", replayed: false, target: TARGET, targets: [TARGET] }
        : sql.includes("record_qc_lot") ? accepted() : dashboard() }] }),
  });
  const empty = await send(api.baseUrl, `/api/v3/qc/runs/${RUN_ID}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), dashboard());
  const targets = await send(api.baseUrl, "/api/v3/qc/targets");
  assert.equal(targets.status, 200);
  assert.deepEqual(await targets.json(), { targets: [TARGET] });
  const savedTarget = await send(api.baseUrl, "/api/v3/qc/targets", {
    method: "POST",
    body: {
      requestId: REQUEST_ID,
      targetKey: "dough-ball",
      expectedRevision: 0,
      details: { kind: "weight", unit: "g", minimum: "250", maximum: "260", active: true },
    },
  });
  assert.equal(savedTarget.status, 200);
  assert.deepEqual(await savedTarget.json(), { outcome: "accepted", replayed: false, target: TARGET, targets: [TARGET] });
  const created = await send(api.baseUrl, "/api/v3/qc/lots", { method: "POST", body: lotBody() });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), accepted());
  assert.match(api.calls[3].text, /record_qc_lot/u);
  assert.equal(api.calls[3].query_timeout, 5_000);
});

test("QC exact record replay returns 200 and stale target review returns canonical 409", async (t) => {
  const api = await withApi(t, {
    query: async (sql) => ({ rows: [{ result: sql.includes("record_qc_lot") ? accepted(LOT, true)
      : { outcome: "conflict", replayed: false, targets: [{ ...TARGET, revision: 2 }] } }] }),
  });
  const replay = await send(api.baseUrl, "/api/v3/qc/lots", { method: "POST", body: lotBody() });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  const conflict = await send(api.baseUrl, "/api/v3/qc/targets", {
    method: "POST",
    body: {
      requestId: REQUEST_ID,
      targetKey: "dough-ball",
      expectedRevision: 1,
      details: { kind: "weight", unit: "g", minimum: "251", maximum: "260", active: true },
    },
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    outcome: "conflict", replayed: false, targets: [{ ...TARGET, revision: 2 }],
  });
});

test("weight and Brix endpoints preserve their distinct command contracts", async (t) => {
  const weight = {
    ...LOT,
    kind: "weight-check",
    details: {
      phase: "pre-run", value: "255", unit: "g", targetKey: "dough-ball", notes: "",
      target: TARGET, outcome: "pass", notEvaluatedReason: null,
    },
  };
  const brix = {
    ...LOT,
    kind: "brix-check",
    details: {
      phase: null, value: "5.5", unit: "brix", targetKey: null, notes: "",
      target: null, outcome: "not-evaluated", notEvaluatedReason: "no-reviewed-target",
    },
  };
  const api = await withApi(t, {
    query: async (sql) => ({ rows: [{ result: accepted(sql.includes("weight") ? weight : brix) }] }),
  });
  const weightResponse = await send(api.baseUrl, "/api/v3/qc/weight-checks", {
    method: "POST",
    body: {
      requestId: REQUEST_ID, runId: RUN_ID,
      details: { phase: "pre-run", value: "255", unit: "g", targetKey: "dough-ball", notes: "" },
    },
  });
  assert.equal(weightResponse.status, 201);
  const brixResponse = await send(api.baseUrl, "/api/v3/qc/brix-checks", {
    method: "POST",
    body: {
      requestId: "10000000-0000-4000-8000-000000000006", runId: RUN_ID,
      details: { phase: null, value: "5.5", unit: "brix", targetKey: null, notes: "" },
    },
  });
  assert.equal(brixResponse.status, 201);
  assert.match(api.calls[0].text, /record_qc_weight_check/u);
  assert.match(api.calls[1].text, /record_qc_brix_check/u);
});

test("unexpected QC failures return safe JSON and logs exclude request and operational details", async (t) => {
  const logs = [];
  const api = await withApi(t, {
    query: async () => { throw new Error("private SQL and LOT-A must not escape"); },
    logger: (entry) => logs.push(entry),
  });
  const response = await send(api.baseUrl, "/api/v3/qc/lots", { method: "POST", body: lotBody() });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "The QC request could not be completed. Refresh and try again." });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "v3.qc.request_failed");
  assert.equal(logs[0].route, "qc.record");
  assert.equal(logs[0].errorName, "Error");
  assert.deepEqual(Object.keys(logs[0]).sort(), ["errorName", "event", "method", "requestId", "route"]);
  assert.ok(!JSON.stringify(logs).includes("LOT-A"));
  assert.ok(!JSON.stringify(logs).includes("private SQL"));
});

test("malformed QC storage responses fail closed with a safe 502", async (t) => {
  const api = await withApi(t, { query: async () => ({ rows: [{ result: { targets: [{ unexpected: true }] } }] }) });
  const response = await send(api.baseUrl, "/api/v3/qc/targets");
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "QC storage returned an invalid response." });
});
