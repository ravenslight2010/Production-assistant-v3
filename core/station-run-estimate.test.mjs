import test from "node:test";
import assert from "node:assert/strict";
import { estimateRun } from "./station-run-estimate.mjs";

const NOW = 1_800_000_000_000;

function values(overrides = {}) {
  return {
    casesNeeded: 10,
    pizzasPerCase: 10,
    crustsPerCycle: 5,
    cycleSpeed: 10,
    speedAdjustment: 1,
    freezerTime: 10,
    ...overrides,
  };
}

test("estimateRun: planned run reports packaging-clear duration incl. freezer lead", () => {
  // ppm 50; 10 cases * 10 pizzas / 50 * 60 = 120 s + 10 min freezer = 720 s.
  const result = estimateRun(values(), {}, NOW);
  assert.equal(result.basis, "planned");
  assert.equal(result.mode, "dough");
  assert.equal(result.ppm, 50);
  assert.equal(result.durationSec, 720);
  assert.deepEqual(result.missing, []);
  assert.equal(result.remainingSec, undefined);
});

test("estimateRun: live run subtracts accepted packaging progress and freezer lead-in", () => {
  const result = estimateRun(
    values({ casesNeeded: 300, casesPerSkid: 100, skidsCompleted: 1, casesOnCurrentSkid: 20 }),
    { startedAt: NOW - 15 * 60000 },
    NOW
  );
  assert.equal(result.basis, "live");
  assert.equal(result.completedCases, 120);
  // 15 min elapsed already covers the 10 min freezer lead.
  assert.equal(result.leadInSec, 0);
  // 180 cases left * 10 pizzas / 50 ppm * 60 = 2160 s.
  assert.equal(result.remainingSec, 2160);
});

test("estimateRun: paused run freezes the clock at pausedAt", () => {
  const result = estimateRun(
    values({ casesNeeded: 300, casesPerSkid: 100, skidsCompleted: 1, casesOnCurrentSkid: 20 }),
    { startedAt: NOW - 30 * 60000, pausedAt: NOW - 15 * 60000 },
    NOW
  );
  assert.equal(result.basis, "paused");
  assert.equal(result.leadInSec, 0);
  assert.equal(result.remainingSec, 2160);
});

test("estimateRun: ended run reports actual duration only", () => {
  const result = estimateRun(values(), { startedAt: NOW - 30 * 60000, endedAt: NOW }, NOW);
  assert.equal(result.basis, "actual");
  assert.equal(result.durationSec, 720);
  assert.equal(result.remainingSec, undefined);
});

test("estimateRun: missing inputs are listed, never guessed", () => {
  const result = estimateRun({}, {}, NOW);
  assert.deepEqual(result.missing, [
    "cases needed (> 0)",
    "pizzas per case (> 0)",
    "crusts per cycle (> 0)",
    "cycles per minute (> 0)",
    "freezer transit (minutes, 0 allowed)",
  ]);
  const noFreezer = estimateRun(values({ freezerTime: undefined }), {}, NOW);
  assert.ok(noFreezer.missing.includes("freezer transit (minutes, 0 allowed)"));
  const badAdjustment = estimateRun(values({ speedAdjustment: 0 }), {}, NOW);
  assert.ok(badAdjustment.missing.includes("speed adjustment (> 0)"));
});

test("estimateRun: crusts mode uses approxLineSpeed directly", () => {
  const result = estimateRun(
    { ...values({ approxLineSpeed: 100, crustsPerCycle: 0, cycleSpeed: 0 }), freezerTime: 5 },
    { subTab: "crusts" },
    NOW
  );
  assert.equal(result.mode, "crusts");
  assert.equal(result.ppm, 100);
  assert.equal(result.durationSec, (100 / 100) * 60 + 300);
});

test("estimateRun: temporary overrides steer the effective rate", () => {
  const result = estimateRun(values({ tempCycleSpeed: 20 }), {}, NOW);
  assert.equal(result.ppm, 100);
  assert.equal(result.durationSec, (10 * 10) / 100 * 60 + 600);
});
