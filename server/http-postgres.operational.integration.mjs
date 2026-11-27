// End-to-end operational read check over a real HTTP server and throwaway
// Postgres. Runs after http-postgres.integration.mjs on the shared database:
// staff fixtures (V3IntegrationManager) and the DOUGH-A / LINE-A catalog from
// its rehearsal import are already present; its later account-lifecycle checks
// disable the operator fixture, so this suite signs in as the manager only.
//
// Covers: station inputs -> GET /api/v3/runs/:id/operational (schedule,
// projection, view computed server-side), revision ETag discipline under
// real lifecycle writes, gzip on the wire, and a bounded concurrent poll +
// command burst to confirm the calculator chain stays cheap when many
// clients render from it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startV3Server } from "./main.mjs";

const MANAGER_PASSWORD = "v3-test-manager-password";
const BOOTSTRAP_CODE = "v3-operational-read-bootstrap-code"; // >= 32 chars

function jsonResponse(response) {
  return response.json();
}

function readSetCookie(response) {
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]);
  return {
    cookieHeader: cookies.join("; "),
    csrfToken: cookies.find((cookie) => cookie.startsWith("v3_csrf="))?.slice("v3_csrf=".length),
  };
}

async function signIn(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/v3/auth/sign-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `sign-in for ${username}`);
  return { ...(await jsonResponse(response)), ...readSetCookie(response) };
}

async function main() {
  if (!process.env.V3_TEST_ADMIN_URL || !process.env.V3_DATABASE_URL) {
    throw new Error("The disposable V3 PostgreSQL URLs are required for this integration check.");
  }

  const logs = [];
  const serverInstance = await startV3Server({
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "0",
      V3_DATABASE_URL: process.env.V3_DATABASE_URL,
      V3_INITIAL_MANAGER_BOOTSTRAP_CODE: BOOTSTRAP_CODE,
    },
    logger: (entry) => logs.push(entry),
  });
  try {
    const address = serverInstance.server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const manager = await signIn(baseUrl, "V3IntegrationManager", MANAGER_PASSWORD);
    const operator = manager;

    const post = async (session, path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookieHeader,
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify(body),
      });
      return response;
    };
    const get = (session, path, headers = {}) => fetch(`${baseUrl}${path}`, {
      headers: { Cookie: session.cookieHeader, Accept: "application/json", ...headers },
    });

    // A planned run on the catalog staged by the earlier suite.
    const createdResponse = await post(manager, "/api/v3/runs", {
      requestId: randomUUID(),
      productionDate: "2026-11-18",
      setupSnapshot: {
        label: "Operational read check", targetCases: 12, productCode: "DOUGH-A", productionSetupCode: "LINE-A",
      },
    });
    assert.equal(createdResponse.status, 201, `run creation -> ${createdResponse.status}: ${(await createdResponse.clone().text()).slice(0, 300)}`);
    const { run: created } = await jsonResponse(createdResponse);
    const runId = created.id;
    let revision = created.revision;

    const startResponse = await post(operator, `/api/v3/runs/${runId}/commands`, {
      commandId: randomUUID(), commandType: "start", expectedRevision: revision,
    });
    assert.equal(startResponse.status, 200);
    const started = await jsonResponse(startResponse);
    revision = started.run.revision;
    const startedAtMs = Date.parse(started.run.startedAt);

    // Station inputs make the run legible to the v1 calculator port.
    const stationInputs = [
      ["line", { autoTrackRatePerMinute: 20, casesPerSkid: 10 }],
      ["dough", { traysPerBatch: 4 }],
      ["cheese", { pizzasPerCase: 8, ozPerPizza: 6, batchLbs: 20 }],
      ["pepperoni", { pizzasPerCase: 8, ozPerPizza: 10, batchLbs: 25 }],
      ["sauce", { pizzasPerCase: 8, ozPerPizza: 1.5, barrelLbs: 450 }],
      ["frontline", { pizzasPerCase: 8, ozPerPizza: 2, batchLbs: 30 }],
      ["packaging", { casesPerSkid: 10 }],
    ];
    for (const [stationKey, changes] of stationInputs) {
      const response = await post(operator, `/api/v3/runs/${runId}/stations/${stationKey}/commands`, {
        commandId: randomUUID(), mode: "manual", expectedRevision: revision, changes,
      });
      assert.equal(response.status, 200, `station ${stationKey} -> ${response.status}: ${(await response.clone().text()).slice(0, 300)}`);
      const body = await jsonResponse(response);
      assert.equal(body.outcome, "accepted");
      revision = body.run.revision;
    }

    // Full read: server-computed schedule + projection + view.
    const first = await get(operator, `/api/v3/runs/${runId}/operational`);
    assert.equal(first.status, 200, `operational read -> ${first.status}: ${(await first.clone().text()).slice(0, 300)}`);
    const etag = first.headers.get("etag");
    assert.equal(etag, `"${revision}"`);
    if ((await first.clone().arrayBuffer()).byteLength >= 1024) {
      assert.equal(first.headers.get("content-encoding"), "gzip");
    }
    const operational = await jsonResponse(first);
    assert.equal(operational.revision, revision);
    assert.equal(operational.projection.runId, runId);
    assert.equal(operational.projection.lifecycleGeneration, `${runId}:${startedAtMs}`);
    assert.equal(operational.projection.calc.ppm, 20);
    assert.equal(operational.projection.calculationRevision, revision);
    assert.equal(operational.schedule.runId, runId);
    assert.equal(operational.schedule.generation, operational.projection.lifecycleGeneration);
    assert.equal(operational.view.runId, runId);
    assert.equal(operational.view.recap.casesNeeded, 12);
    assert.equal(operational.view.freshness.status, "fresh");
    assert.equal(operational.view.freshness.snapshotId, `operational:${runId}:${revision}`);

    // Conditional poll: matching tag short-circuits before the math.
    const fresh = await get(operator, `/api/v3/runs/${runId}/operational`, { "If-None-Match": etag });
    assert.equal(fresh.status, 304);
    assert.equal(fresh.headers.get("etag"), etag);

    // A lifecycle write moves the revision; the same tag must now rebuild.
    const pauseResponse = await post(operator, `/api/v3/runs/${runId}/commands`, {
      commandId: randomUUID(), commandType: "pause", expectedRevision: revision,
    });
    assert.equal(pauseResponse.status, 200);
    revision = (await jsonResponse(pauseResponse)).run.revision;
    const rebuilt = await get(operator, `/api/v3/runs/${runId}/operational`, { "If-None-Match": etag });
    assert.equal(rebuilt.status, 200);
    assert.equal(rebuilt.headers.get("etag"), `"${revision}"`);
    const rebuiltBody = await jsonResponse(rebuilt);
    assert.equal(rebuiltBody.view.observed.status, "paused");
    assert.equal(rebuiltBody.projection.calc.ppm, 20);

    // Concurrent render burst: eight clients poll while lifecycle and station
    // writes land; every poll must stay 2xx/304 and the ETag discipline must
    // hold (no 5xx, no stale-tag rebuilds, no math on matching polls).
    const resume = await post(operator, `/api/v3/runs/${runId}/commands`, {
      commandId: randomUUID(), commandType: "resume", expectedRevision: revision,
    });
    assert.equal(resume.status, 200);
    revision = (await jsonResponse(resume)).run.revision;

    const CLIENTS = 8;
    const POLLS = 30;
    const latencies = [];
    let pollCount = 0;
    let notModified = 0;
    let full = 0;
    let failures = 0;
    let currentRevision = revision;
    const burstWrites = (async () => {
      for (let index = 0; index < 3; index += 1) {
        const response = await post(operator, `/api/v3/runs/${runId}/stations/line/commands`, {
          commandId: randomUUID(), mode: "manual", expectedRevision: currentRevision,
          changes: { casesProduced: 1 + index },
        });
        const body = await jsonResponse(response);
        if (body.outcome === "accepted") currentRevision = body.run.revision;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    })();

    await Promise.all(Array.from({ length: CLIENTS }, async (_, clientIndex) => {
      let tag = clientIndex % 2 === 0 ? null : `"${revision}"`;
      for (let poll = 0; poll < POLLS; poll += 1) {
        const started = performance.now();
        const response = await get(operator, `/api/v3/runs/${runId}/operational`, tag ? { "If-None-Match": tag } : {});
        const elapsed = performance.now() - started;
        latencies.push(elapsed);
        pollCount += 1;
        if (response.status === 304) {
          notModified += 1;
        } else if (response.status === 200) {
          full += 1;
          tag = response.headers.get("etag");
        } else {
          failures += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }));
    await burstWrites;
    revision = currentRevision;

    assert.equal(failures, 0, `operational polls failed: ${failures}`);
    assert.equal(pollCount, CLIENTS * POLLS);
    assert.ok(full >= CLIENTS, "every client should take at least one full read");
    assert.ok(notModified > 0, "matching-tag polls should short-circuit with 304");
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    console.log(`operational burst: ${pollCount} polls (${full} full, ${notModified} 304) p50 ${p50.toFixed(1)} ms p95 ${p95.toFixed(1)} ms`);
    assert.ok(p95 < 750, `operational poll p95 ${p95.toFixed(1)} ms exceeded the sync-round bar (2-core rig)`);

    const serverErrors = logs.filter((entry) => entry.event === "v3.run_api.error" && entry.status >= 500);
    assert.deepEqual(serverErrors, [], `unexpected 5xx during burst: ${JSON.stringify(serverErrors).slice(0, 300)}`);

    const finalRead = await get(operator, `/api/v3/runs/${runId}/operational`);
    assert.equal(finalRead.status, 200);
    const finalBody = await jsonResponse(finalRead);
    assert.equal(finalBody.revision, revision);
    assert.equal(finalBody.projection.calc.ppm, 20);
    assert.equal(finalBody.view.freshness.status, "fresh");

    console.log("Operational read integration checks passed.");
  } finally {
    await serverInstance.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
