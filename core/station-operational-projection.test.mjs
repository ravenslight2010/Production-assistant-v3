import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalProjection } from "./station-operational-projection.mjs";

const NOW = 1_800_000_000_000;

function fixture(overrides = {}) {
  const runId = "run-1";
  const startedAt = NOW - 15 * 60_000;
  const run = {
    id: runId, startedAt,
    stoppages: [],
    ...overrides.run,
  };
  const values = {
    casesNeeded: 100, pizzasPerCase: 10, casesPerSkid: 100, casesPerLayer: 0,
    skidsCompleted: 0, casesOnCurrentSkid: 0,
    crustsPerCycle: 5, cycleSpeed: 10, speedAdjustment: 1,
    freezerTime: 10, pressOvenMin: 3, frontlineMin: 5, postTunnelMin: 2,
    doughballsPerTray: 25, doughBatchYield: 50, doughRecipe: [], targetDoughballWeight: 0,
    traysOnLine: 12, batchesReady: 1, sauceBarrelsMade: 1,
    ...overrides.values,
  };
  const generation = `${runId}:${run.metaUpdatedAt ?? run.startedAt ?? 0}`;
  const schedule = {
    runId, generation, atMs: NOW, entries: [],
    ...overrides.schedule,
  };
  return { runs: [run], runId, runValues: { [runId]: values }, progress: {}, schedule, nowMs: NOW };
}

test("projection: identity mismatch between run and schedule throws", () => {
  const args = fixture({ schedule: { generation: "run-1:0" } });
  assert.throws(() => buildOperationalProjection(args), /matching run, calculation, and schedule identities/);
});

test("projection: live run exposes server-owned timers, counters, phases, and calc", () => {
  const p = buildOperationalProjection(fixture());
  // elapsed 15 min = 900 s; timePerBatch = 50/50*60 = 60 s.
  assert.equal(p.version, 1);
  assert.equal(p.facts.runStatus, "running");
  assert.equal(p.calc.ppm, 50);
  assert.equal(p.effectiveElapsedSec, 900);
  assert.equal(p.timers.currentBatchNum, 15);
  assert.equal(p.timers.secUntilNextBatch, 60);
  assert.equal(p.timers.freezerElapsedSec, 600);
  assert.equal(p.timers.freezerRemainingSec, 0);
  assert.equal(p.counters.traysOnLine, 12);
  assert.equal(p.counters.sauceBarrelsMade, 1);
  assert.equal(p.counters.casesCompleted, 0); // progress {} → no packaging counters
  // phases derived from the same effective elapsed: press/oven 8 min then tunnel.
  assert.equal(p.linePhases.stage1.state, "active");
  assert.equal(p.linePhases.stage2.state, "active");
  assert.equal(p.linePhases.stage3.state, "active");
  assert.equal(p.linePhases.sections.pressOven.state, "active");
});

test("projection: paused run freezes elapsed at pausedAt and keeps tunnel held", () => {
  const args = fixture({
    run: { pausedAt: NOW - 5 * 60_000, metaUpdatedAt: NOW - 5 * 60_000 },
    schedule: {},
  });
  // metaUpdatedAt changes → regenerate schedule generation to match.
  args.schedule = {
    runId: args.runId,
    generation: `${args.runId}:${NOW - 5 * 60_000}`,
    atMs: NOW,
    entries: [],
  };
  const p = buildOperationalProjection(args);
  assert.equal(p.facts.runStatus, "paused");
  assert.equal(p.effectiveElapsedSec, 10 * 60);
  // pauseStopsTunnel default true: 5 min pause elapsed ≥ pre-tunnel 8? no → frontline draining.
  assert.equal(p.linePhases.stage1.state, "draining");
  assert.equal(p.linePhases.stage1.remainMs, (8 - 5) * 60000);
});

test("projection: progress fields feed the counters (server-owned stock ledger)", () => {
  const args = fixture();
  args.progress = { skidsCompleted: 1, casesOnCurrentSkid: 40, traysOnLine: 3 };
  const p = buildOperationalProjection(args);
  // progress overrides the values-level traysOnLine in the merged view.
  assert.equal(p.counters.traysOnLine, 3);
  assert.equal(p.counters.casesCompleted, 140);
  // v1 math does not clamp casesLeftToRun below zero: over-produced runs read negative.
  assert.equal(p.counters.casesLeftToRun, -96);
  assert.equal(p.facts.pressDone, true);
});
