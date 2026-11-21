import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createStationAutoTrackWorker } from "../core/station-auto-track-worker.mjs";
import {
  boundedInteger,
  readRuntimeDatabaseRole,
  requiredV3DatabaseUrl,
  V3StartupError,
} from "./main.mjs";

const { Pool } = pg;

function logStructured(record) {
  console.log(JSON.stringify(record));
}

function safeHealthSnapshot(health) {
  return {
    status: health.status,
    lastCycleAt: health.lastCycleAt,
    lastSuccessAt: health.lastSuccessAt,
    consecutiveFailures: health.consecutiveFailures,
    lastErrorName: health.lastErrorName,
    processedLastCycle: health.processedLastCycle,
  };
}

export function createHealthHandler(getHealth) {
  return (request, response) => {
    if (request.method !== "GET" || request.url !== "/healthz") {
      response.writeHead(404, {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end();
      return;
    }

    const body = JSON.stringify(safeHealthSnapshot(getHealth()));
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startStationWorkerProcess({ env = process.env, logger = logStructured } = {}) {
  const connectionString = requiredV3DatabaseUrl(env);
  const poolMax = boundedInteger(
    env.V3_WORKER_DB_POOL_MAX,
    2,
    1,
    10,
    "V3_WORKER_DB_POOL_MAX",
    "V3_INVALID_POOL_SIZE",
  );
  const healthPort = boundedInteger(
    env.V3_WORKER_HEALTH_PORT,
    3001,
    1,
    65535,
    "V3_WORKER_HEALTH_PORT",
    "V3_INVALID_WORKER_HEALTH_PORT",
  );
  const workerOptions = {
    pollIntervalMs: boundedInteger(
      env.V3_STATION_WORKER_POLL_MS,
      1000,
      100,
      30_000,
      "V3_STATION_WORKER_POLL_MS",
      "V3_INVALID_STATION_WORKER_POLL",
    ),
    leaseSeconds: boundedInteger(
      env.V3_STATION_WORKER_LEASE_SECONDS,
      30,
      10,
      300,
      "V3_STATION_WORKER_LEASE_SECONDS",
      "V3_INVALID_STATION_WORKER_LEASE",
    ),
    batchSize: boundedInteger(
      env.V3_STATION_WORKER_BATCH_SIZE,
      50,
      1,
      500,
      "V3_STATION_WORKER_BATCH_SIZE",
      "V3_INVALID_STATION_WORKER_BATCH",
    ),
  };
  const pool = new Pool({
    connectionString,
    application_name: "production-assistant-production-assistant-v3-worker",
    max: poolMax,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
    query_timeout: 7000,
    idle_in_transaction_session_timeout: 10_000,
  });

  let healthServer;
  let worker;
  try {
    const runtimeRole = await readRuntimeDatabaseRole(pool);
    logger({
      event: "v3.worker.database_identity",
      role: runtimeRole,
    });
    worker = createStationAutoTrackWorker({
      query: (text, values) => pool.query(text, values),
      logger,
      ...workerOptions,
    });
    healthServer = createServer(createHealthHandler(() => worker.getHealth()));
    healthServer.requestTimeout = 2000;
    healthServer.headersTimeout = 1500;
    healthServer.keepAliveTimeout = 1000;
    await listen(healthServer, healthPort);
    worker.start();
  } catch (error) {
    if (healthServer?.listening) {
      await new Promise((resolve) => healthServer.close(resolve));
    }
    await pool.end();
    if (error instanceof V3StartupError) throw error;
    logger({
      event: "v3.worker.startup_failed",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    throw new V3StartupError("V3_WORKER_STARTUP_FAILED", "V3 station worker could not start.");
  }

  logger({
    event: "v3.worker.started",
    healthPort,
    poolMax,
    pollIntervalMs: workerOptions.pollIntervalMs,
    leaseSeconds: workerOptions.leaseSeconds,
    batchSize: workerOptions.batchSize,
    nodeVersion: process.versions.node,
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (healthServer?.listening) {
      const closed = new Promise((resolve, reject) => {
        healthServer.close((error) => error ? reject(error) : resolve());
      });
      const forceClose = setTimeout(() => healthServer.closeAllConnections(), 1000);
      forceClose.unref();
      try {
        await closed;
      } finally {
        clearTimeout(forceClose);
      }
    }
    await worker.stop();
    await pool.end();
    logger({ event: "v3.worker.stopped" });
  };

  return { worker, pool, healthServer, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStationWorkerProcess().then(({ close }) => {
    let shutdownPromise;
    const shutdown = () => {
      if (shutdownPromise) return;
      shutdownPromise = close().catch((error) => {
        logStructured({
          event: "v3.worker.shutdown_failed",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
        });
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch((error) => {
    logStructured({
      event: "v3.worker.startup_failed",
      failureCode: typeof error?.code === "string" && /^V3_[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : "V3_WORKER_STARTUP_FAILED",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    process.exitCode = 1;
  });
}
