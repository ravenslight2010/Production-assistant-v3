import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, firefox } from "playwright";

const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);

test("V3 React shell installs for offline reading without clearing unrelated browser data", { timeout: 60_000 }, async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    requests.push({ method: request.method, pathname });
    if (pathname === "/api/v3/auth/session") {
      response.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "NOT_SIGNED_IN" }));
      return;
    }
    if (pathname === "/api/v3/auth/bootstrap-status") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ available: false }));
      return;
    }
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
      response.writeHead(200, {
        "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        "Content-Length": contents.byteLength,
        "Content-Type": asset[1],
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const browserPath = process.env.CHROMIUM_PATH
    || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const browserType = { webkit, firefox }[process.env.BROWSER] || chromium;
  const browser = await browserType.launch({ headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;

  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Staff sign in" }).waitFor();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async () => {
    localStorage.setItem("v3-cache-test", "preserve");
    const cache = await caches.open("unrelated-app-shell");
    await cache.put("/unrelated", new Response("preserve"));
  });

  const cached = await page.evaluate(async () => {
    const cache = await caches.open("production-assistant-v3-shell-v1");
    return {
      shell: await (await cache.match("/"))?.text(),
      manifest: await (await cache.match("/manifest.webmanifest"))?.text(),
      logo: await (await cache.match("/logo.svg"))?.text(),
    };
  });
  assert.match(cached.shell ?? "", /<title>Production Assistant<\/title>/);
  assert.match(cached.manifest ?? "", /Production Assistant/);
  assert.match(cached.logo ?? "", /svg/i);

  await page.reload();
  await page.getByRole("heading", { name: "Staff sign in" }).waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "Production Assistant", exact: true }).waitFor();
  await page.getByText("The server could not be reached. Check the connection and retry.").waitFor();

  const preserved = await page.evaluate(async () => ({
    localStorage: localStorage.getItem("v3-cache-test"),
    unrelated: await (await (await caches.open("unrelated-app-shell")).match("/unrelated"))?.text(),
  }));
  assert.deepEqual(preserved, { localStorage: "preserve", unrelated: "preserve" });
  assert.equal(requests.some((entry) => entry.method !== "GET" && entry.method !== "HEAD"), false);
  assert.deepEqual(consoleErrors.filter((message) => !message.includes("Failed to load resource")), []);
  await context.close();
});
