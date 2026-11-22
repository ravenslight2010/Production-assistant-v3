import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuthApi } from "./auth-api.mjs";
import { createInventoryApi } from "./inventory-api.mjs";
import { createRunApiForDatabase } from "./run-api.mjs";
import { createScheduleApi } from "./schedule-api.mjs";

const RESPONSE_SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; worker-src 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const PUBLIC_WEB_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
]);

const ASSET_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

function resolveWebAsset(pathname, webRoot) {
  const publicFile = PUBLIC_WEB_FILES.get(pathname);
  if (publicFile) {
    return { file: new URL(publicFile[0], webRoot), type: publicFile[1], immutable: false };
  }
  const match = /^\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname);
  if (!match) return null;
  const extension = match[1].slice(match[1].lastIndexOf("."));
  const type = ASSET_TYPES.get(extension);
  if (!type) return null;
  return { file: new URL(`assets/${match[1]}`, webRoot), type, immutable: true };
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...RESPONSE_SECURITY_HEADERS,
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function serveWebAsset(request, response, pathname, webRoot) {
  const asset = resolveWebAsset(pathname, webRoot);
  if (!asset) return false;
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "This method is not allowed for the web page." }, { Allow: "GET, HEAD" });
    return true;
  }
  let contents;
  try {
    contents = await readFile(asset.file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found." });
      return true;
    }
    throw error;
  }
  response.writeHead(200, {
    ...RESPONSE_SECURITY_HEADERS,
    "Cache-Control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "Content-Type": asset.type,
    "Content-Length": contents.byteLength,
  });
  response.end(request.method === "HEAD" ? undefined : contents);
  return true;
}

function safeRouteName(url) {
  if (!url) return "invalid";
  if (url.pathname === "/" || url.pathname === "/index.html") return "web.index";
  if (url.pathname === "/favicon.ico" || url.pathname === "/logo.svg") return "web.icon";
  if (url.pathname === "/manifest.webmanifest") return "web.manifest";
  if (url.pathname === "/sw.js") return "web.service_worker";
  if (url.pathname.startsWith("/assets/")) return "web.asset";
  if (url.pathname === "/healthz") return "health";
  if (url.pathname === "/api/v3/auth/sign-in") return "auth.sign_in";
  if (url.pathname === "/api/v3/auth/session") return "auth.session";
  if (url.pathname === "/api/v3/auth/sign-out") return "auth.sign_out";
  if (url.pathname === "/api/v3/auth/bootstrap-status") return "auth.bootstrap_status";
  if (url.pathname === "/api/v3/auth/bootstrap") return "auth.bootstrap";
  if (url.pathname === "/api/v3/auth/staff") return "auth.staff";
  if (/^\/api\/v3\/auth\/staff\/[0-9a-f-]{36}$/i.test(url.pathname)) return "auth.staff_item";
  if (url.pathname === "/api/v3/runs") return "runs.collection";
  if (url.pathname === "/api/v3/runs/products") return "runs.products";
  if (/^\/api\/v3\/runs\/[^/]+\/commands$/.test(url.pathname)) return "runs.command";
  if (/^\/api\/v3\/runs\/[^/]+\/stations\/[^/]+\/commands$/.test(url.pathname)) return "runs.station_command";
  if (/^\/api\/v3\/runs\/[^/]+$/.test(url.pathname)) return "runs.detail";
  if (url.pathname === "/api/v3/schedules") return "schedules.date";
  if (url.pathname === "/api/v3/schedules/catalog") return "schedules.catalog";
  if (url.pathname === "/api/v3/schedules/commands") return "schedules.command";
  if (url.pathname === "/api/v3/schedules/import-preview") return "schedules.import_preview";
  if (url.pathname === "/api/v3/imports") return "imports.collection";
  if (url.pathname === "/api/v3/imports/records") return "imports.records";
  if (url.pathname === "/api/v3/imports/edits") return "imports.edits";
  if (url.pathname === "/api/v3/setup-catalog/records") return "setup_catalog_records.collection";
  if (url.pathname === "/api/v3/setup-catalog/edits") return "setup_catalog_edits.collection";
  if (url.pathname === "/api/v3/setup-catalog/imports") return "setup_catalog_imports.collection";
  if (/^\/api\/v3\/setup-catalog\/imports\/[^/]+$/.test(url.pathname)) return "setup_catalog_imports.detail";
  if (/^\/api\/v3\/setup-catalog\/imports\/[^/]+\/(apply|undo)$/.test(url.pathname)) return "setup_catalog_imports.action";
  if (url.pathname === "/api/v3/imports/workbooks") return "imports.workbooks";
  if (url.pathname === "/api/v3/imports/workbooks/preview") return "imports.workbooks_preview";
  if (/^\/api\/v3\/imports\/[^/]+$/.test(url.pathname)) return "imports.detail";
  if (/^\/api\/v3\/imports\/[^/]+\/(apply|undo)$/.test(url.pathname)) return "imports.action";
  if (url.pathname.startsWith("/api/v3/inventory/")) return "inventory.operation";
  return "unmatched";
}

export function createV3Api({
  pool,
  authAdapter,
  getClientKey,
  secureCookies = process.env.NODE_ENV === "production",
  logger = (record) => console.log(JSON.stringify(record)),
  healthTimeoutMs = 2000,
  workerHealth,
  webRoot = new URL("../dist/", import.meta.url),
}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V3 PostgreSQL pool is required.");
  for (const method of ["authenticate", "verifyCsrf", "authorizeRun", "signIn", "signOut", "sessionCookie", "csrfCookie"]) {
    if (typeof authAdapter?.[method] !== "function") {
      throw new TypeError(`A V3 authentication adapter with ${method}() is required.`);
    }
  }
  if (typeof getClientKey !== "function") throw new TypeError("A trusted client-key resolver is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  if (workerHealth !== undefined && typeof workerHealth !== "function") {
    throw new TypeError("workerHealth must be a function when provided.");
  }
  if (!Number.isSafeInteger(healthTimeoutMs) || healthTimeoutMs < 100 || healthTimeoutMs > 10_000) {
    throw new TypeError("healthTimeoutMs must be between 100 and 10000.");
  }

  const runApi = createRunApiForDatabase({
    pool,
    authorize: (input) => authAdapter.authorizeRun(input),
    authenticate: (request) => authAdapter.authenticate(request),
    verifyCsrf: (request, auth) => authAdapter.verifyCsrf(request, auth),
    logger,
  });
  const authApi = createAuthApi({
    auth: authAdapter,
    getClientKey,
    secureCookies,
    logger,
  });
  const inventoryApi = createInventoryApi({
    pool,
    authenticate: (request) => authAdapter.authenticate(request),
    verifyCsrf: (request, auth) => authAdapter.verifyCsrf(request, auth),
    logger,
  });
  const scheduleApi = createScheduleApi({
    pool,
    authenticate: (request) => authAdapter.authenticate(request),
    verifyCsrf: (request, auth) => authAdapter.verifyCsrf(request, auth),
    logger,
  });

  return async function handleV3Api(request, response) {
    const requestId = randomUUID();
    request.v3RequestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    const startedAt = performance.now();
    for (const [header, value] of Object.entries(RESPONSE_SECURITY_HEADERS)) response.setHeader(header, value);
    let parsedUrl = null;
    try {
      parsedUrl = new URL(request.url || "/", "http://v3.local");
    } catch {
      sendJson(response, 400, { error: "The request URL is invalid." });
      return;
    }

    const route = safeRouteName(parsedUrl);
    response.once("finish", () => {
      logger({
        event: "v3.http.request",
        requestId,
        method: request.method,
        route,
        status: response.statusCode,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    });

    try {
      if (await serveWebAsset(request, response, parsedUrl.pathname, webRoot)) return;
      if (parsedUrl.pathname === "/healthz") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "This method is not allowed for health checks." }, { Allow: "GET" });
          return;
        }
        try {
          await pool.query({ text: "SELECT 1", query_timeout: healthTimeoutMs });
          const body = { status: "ok" };
          if (workerHealth) {
            const stationWorker = await workerHealth();
            body.stationWorker = stationWorker;
            if (!stationWorker || ["starting", "degraded", "stopped"].includes(stationWorker.status)) {
              logger({
                event: "v3.health.worker_unavailable",
                requestId,
                workerStatus: stationWorker?.status ?? "unknown",
              });
              sendJson(response, 503, { error: "The service is temporarily unavailable." });
              return;
            }
          }
          sendJson(response, 200, body);
        } catch (error) {
          logger({
            event: "v3.health.unavailable",
            requestId,
            errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          });
          sendJson(response, 503, { error: "The service is temporarily unavailable." });
        }
        return;
      }

      if (await authApi(request, response)) return;
      if (await inventoryApi(request, response)) return;
      if (await scheduleApi(request, response)) return;
      await runApi(request, response);
    } catch (error) {
      logger({
        event: "v3.http.unhandled",
        requestId,
        route,
        errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
      });
      if (!response.headersSent) {
        sendJson(response, 500, { error: "The request could not be completed. Try again." });
      } else {
        response.destroy();
      }
    }
  };
}
