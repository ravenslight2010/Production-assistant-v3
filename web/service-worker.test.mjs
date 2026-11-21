import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceWorkerPath = fileURLToPath(new URL("./service-worker.js", import.meta.url));

test("offline shell caches the schedule planner and setup-import modules", async () => {
  const source = await readFile(serviceWorkerPath, "utf8");
  for (const path of [
    "/v3/web/setup-catalog.js",
    "/v3/web/schedule.js",
    "/v3/core/setup-catalog-csv.mjs",
    "/v3/core/import-csv.mjs",
    "/v3/core/schedule-planning.mjs",
  ]) {
    assert.match(source, new RegExp(`["']${path.replaceAll(".", "\\.")}["']`, "u"), path);
  }
  assert.match(source, /fieldline-v3-shell-7/u);
  assert.match(source, /\/v3\/core\/die-defaults\.mjs/u);
});
