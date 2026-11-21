import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createV3Api } from "./api.mjs";

function fakeAuthAdapter({ session = null } = {}) {
  return {
    async authenticate() {
      return session;
    },
    async verifyCsrf() {
      return false;
    },
    async authorizeRun() {
      return false;
    },
    async signIn() {
      throw new Error("not used");
    },
    async signOut() {},
    async bootstrapAvailable() {
      return false;
    },
    async bootstrapManager() {
      throw new Error("not used");
    },
    async listStaff() {
      return { staff: [], roles: [] };
    },
    async createStaffAccount() {
      throw new Error("not used");
    },
    async updateStaffAccount() {
      throw new Error("not used");
    },
    sessionCookie() {
      return "v3_session=test";
    },
    csrfCookie() {
      return "v3_csrf=test";
    },
    clearSessionCookie() {
      return "v3_session=; Max-Age=0";
    },
    clearCsrfCookie() {
      return "v3_csrf=; Max-Age=0";
    },
  };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint performs a bounded database probe and emits request identity", async () => {
  const queries = [];
  const logs = [];
  const handler = createV3Api({
    pool: { async query(query) { queries.push(query); return { rows: [{ "?column?": 1 }] }; } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: (entry) => logs.push(entry),
    healthTimeoutMs: 1200,
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.deepEqual(queries, [{ text: "SELECT 1", query_timeout: 1200 }]);
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "v3.http.request");
  assert.equal(logs[0].route, "health");
  assert.equal(logs[0].status, 200);
  assert.equal("url" in logs[0], false);
});

test("health endpoint reports a healthy station worker without leaking worker identifiers", async () => {
  const workerHealth = {
    status: "active",
    lastCycleAt: "2026-11-16T12:00:00.000Z",
    lastSuccessAt: "2026-11-16T11:59:00.000Z",
    consecutiveFailures: 0,
    lastErrorName: null,
    processedLastCycle: 2,
  };
  const handler = createV3Api({
    pool: { async query() { return { rows: [{ "?column?": 1 }] }; } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: () => {},
    workerHealth: () => workerHealth,
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", stationWorker: workerHealth });
    assert.doesNotMatch(response.headers.get("cache-control"), /public/i);
  });
});

test("health endpoint is not ready when the external worker is degraded or unreachable", async () => {
  for (const workerHealth of [
    { status: "degraded" },
    null,
  ]) {
    const handler = createV3Api({
      pool: { async query() { return { rows: [{ "?column?": 1 }] }; } },
      authAdapter: fakeAuthAdapter(),
      getClientKey: () => "test-client",
      logger: () => {},
      workerHealth: async () => workerHealth,
    });

    await withServer(handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/healthz`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "The service is temporarily unavailable." });
    });
  }
});

test("serves the built React shell and bounded static assets with restrictive headers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "v3-static-assets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await Promise.all([
    writeFile(join(directory, "index.html"), '<!doctype html><title>Production Assistant</title><div id="root"></div><script type="module" src="/assets/index-test.js"></script>'),
    writeFile(join(directory, "manifest.webmanifest"), '{"name":"Production Assistant"}'),
    writeFile(join(directory, "sw.js"), "self.addEventListener('fetch', () => {});"),
    writeFile(join(directory, "logo.svg"), '<svg><title>Production Assistant</title></svg>'),
    writeFile(join(directory, "assets", "index-test.js"), 'fetch("/api/v3/auth/session");'),
    writeFile(join(directory, "assets", "index-test.css"), "body{color:#fff}"),
  ]);
  const handler = createV3Api({
    pool: { async query() { throw new Error("static requests should not query the database"); } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: () => {},
    webRoot: pathToFileURL(`${directory}/`),
  });

  await withServer(handler, async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.match(await page.text(), /\/assets\/index-test\.js/);

    for (const path of ["/favicon.ico", "/logo.svg"]) {
      const icon = await fetch(`${baseUrl}${path}`);
      assert.equal(icon.status, 200);
      assert.match(icon.headers.get("content-type"), /image\/svg\+xml/);
    }
    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.match(await manifest.text(), /Production Assistant/);

    const serviceWorker = await fetch(`${baseUrl}/sw.js`);
    assert.equal(serviceWorker.status, 200);
    assert.match(serviceWorker.headers.get("content-type"), /javascript/);

    const appScript = await fetch(`${baseUrl}/assets/index-test.js`);
    assert.equal(appScript.status, 200);
    assert.match(appScript.headers.get("content-type"), /javascript/);
    assert.equal(appScript.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.match(await appScript.text(), /\/api\/v3\/auth\/session/);

    const head = await fetch(`${baseUrl}/assets/index-test.css`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("content-type"), /text\/css/);
    assert.equal(await head.text(), "");

    const missing = await fetch(`${baseUrl}/assets/missing.js`);
    assert.equal(missing.status, 404);
    const traversal = await fetch(`${baseUrl}/assets/..%2Findex.html`);
    assert.equal(traversal.status, 404);
    const post = await fetch(baseUrl, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
  });
});

test("database outage fails health checks without leaking database errors", async () => {
  const logs = [];
  const handler = createV3Api({
    pool: { async query() { throw Object.assign(new Error("secret connection detail"), { name: "ConnectionError" }); } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: (entry) => logs.push(entry),
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "The service is temporarily unavailable." });
    assert.doesNotMatch(JSON.stringify(logs), /secret connection detail/);
  });
});

test("session route is composed before run routes and returns authorization state", async () => {
  const session = {
    verified: true,
    actorId: "10000000-0000-4000-8000-000000000001",
    username: "manager",
    role: "manager",
    capabilities: ["run.read"],
    sessionExpiresAt: "2026-11-17T00:00:00.000Z",
  };
  const handler = createV3Api({
    pool: { async query() { throw new Error("run SQL should not be called"); } },
    authAdapter: fakeAuthAdapter({ session }),
    getClientKey: () => "test-client",
    logger: () => {},
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v3/auth/session`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      staff: {
        userId: session.actorId,
        username: "manager",
        role: "manager",
        capabilities: ["run.read"],
      },
      expiresAt: session.sessionExpiresAt,
    });
  });
});

test("run routes reject unauthenticated requests before accessing run data", async () => {
  let queryCount = 0;
  const handler = createV3Api({
    pool: { async query() { queryCount += 1; return { rows: [] }; } },
    authAdapter: fakeAuthAdapter(),
    getClientKey: () => "test-client",
    logger: () => {},
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v3/runs`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Sign in to access runs." });
    assert.equal(queryCount, 0);
  });
});
