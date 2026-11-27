import test from "node:test";
import assert from "node:assert/strict";
import { deriveOperationalRunView, OperationalRunViewError } from "./station-operational-view.mjs";

const NOW = 1_800_000_000_000;

function snapshot(overrides = {}) {
  const runId = "run-1";
  return {
    snapshot: {
      syncVersion: 1,
      completeness: "complete",
      dayState: {
        runs: [{
          id: runId, brand: "Acme", flavor: "Pep", startedAt: NOW - 900_000,
          stoppages: [
            { type: "pause", startedAt: NOW - 600_000, endedAt: NOW - 540_000, stopTunnel: true },
            { type: "breakdown", startedAt: NOW - 300_000, endedAt: NOW - 240_000 },
          ],
        }],
        date: "2026-11-27",
        resetAt: 42,
        substitutions: [{ from: "a", to: "b" }],
      },
      runValues: {
        [runId]: {
          casesNeeded: 200, pizzasPerCase: 10, casesPerSkid: 100, casesPerLayer: 0,
          skidsCompleted: 0, casesOnCurrentSkid: 0,
          crustsPerCycle: 5, cycleSpeed: 10, speedAdjustment: 1,
          freezerTime: 10, pressOvenMin: 3, frontlineMin: 5, postTunnelMin: 2,
          doughballsPerTray: 25, doughBatchYield: 50, doughRecipe: [], targetDoughballWeight: 0,
          traysOnLine: 12, batchesReady: 1, tempFreezerTime: 12,
        },
      },
      packagingProgress: { [runId]: { skidsCompleted: 1, casesOnCurrentSkid: 40 } },
    },
    date: "2026-11-27",
    runId,
    nowMs: NOW,
    snapshotMetadata: { snapshotId: "snap-1", capturedAt: NOW - 5_000, date: "2026-11-27", resetAt: 42 },
  };
}

test("view: rejects an incomplete or malformed snapshot", () => {
  const bad = snapshot();
  bad.snapshot.syncVersion = 2;
  assert.throws(() => deriveOperationalRunView(bad), (e) => e instanceof OperationalRunViewError && e.code === "invalid-snapshot");
  const noMeta = snapshot();
  noMeta.snapshotMetadata = null;
  assert.throws(() => deriveOperationalRunView(noMeta), (e) => e.code === "invalid-snapshot");
});

test("view: date or reset generation mismatch throws reset-mismatch", () => {
  const wrongDate = snapshot({ date: "2026-11-28" });
  wrongDate.snapshotMetadata.date = "2026-11-28";
  assert.throws(() => deriveOperationalRunView(wrongDate), (e) => e.code === "reset-mismatch");
  const wrongReset = snapshot();
  wrongReset.snapshotMetadata.resetAt = 43;
  assert.throws(() => deriveOperationalRunView(wrongReset), (e) => e.code === "reset-mismatch");
});

test("view: missing and duplicate runs throw", () => {
  const missing = snapshot();
  missing.runId = "nope";
  assert.throws(() => deriveOperationalRunView(missing), (e) => e.code === "missing-run");
  const dup = snapshot();
  dup.snapshot.dayState.runs.push({ id: "run-1", startedAt: 1 });
  assert.throws(() => deriveOperationalRunView(dup), (e) => e.code === "duplicate-run");
});

test("view: running run reports observed facts, recap, pace, freshness", () => {
  const v = deriveOperationalRunView(snapshot());
  assert.equal(v.version, 1);
  assert.equal(v.observed.brand, "Acme");
  assert.equal(v.observed.status, "running");
  // elapsed = 900 s wall − 60 s non-pause breakdown (pause excluded from elapsed).
  assert.equal(v.observed.elapsedBatchSec, 840);
  assert.equal(v.observed.substitutionsApplied, 1);
  assert.deepEqual(v.observed.packagingProgress, { skidsCompleted: 1, casesOnCurrentSkid: 40 });
  assert.deepEqual(v.observed.temporaryOverrides, { freezerTime: true, crustsPerCycle: false, cycleSpeed: false });
  // downtime counts ONLY closed non-pause stoppages; v1 reports it in ms
  // despite the field name (port is verbatim).
  assert.deepEqual(v.observed.stoppages, { count: 2, downtimeSeconds: 60_000 });
  assert.equal(v.recap.casesNeeded, 200);
  assert.equal(v.recap.casesCompleted, 140);
  assert.equal(v.pace.ppm, 50);
  assert.equal(v.freshness.status, "fresh");
  assert.equal(v.freshness.ageMs, 5_000);
  assert.equal(v.formulaProvenance.policy, "operational-run-view");
  assert.equal(v.formulaProvenance.linePhasesVersion, 2);
});

test("view: stale when snapshot age exceeds maxAgeMs", () => {
  const args = snapshot();
  args.snapshotMetadata.maxAgeMs = 1_000;
  const v = deriveOperationalRunView(args);
  assert.equal(v.freshness.status, "stale");
  assert.equal(v.freshness.maxAgeMs, 1_000);
});

test("view: ended run uses ended elapsed and post-end drain semantics", () => {
  const args = snapshot();
  const run = args.snapshot.dayState.runs[0];
  run.endedAt = NOW - 60_000;
  const v = deriveOperationalRunView(args);
  assert.equal(v.observed.status, "ended");
  // v1 ended elapsed is wall minus only pauses open at end: 840 s here.
  assert.equal(v.observed.elapsedBatchSec, 840);
  // 60 s since end is inside the press/oven drain path, so it drains.
  assert.equal(v.elapsed.phase.stage1.state, "draining");
});
