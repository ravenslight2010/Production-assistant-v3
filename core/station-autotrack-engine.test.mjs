import test from "node:test";
import assert from "node:assert/strict";
import {
  clampWebPeriodMs,
  computeAppSlotInfo,
  computeAutoTrackSuggestion,
  computeBatchTick,
  computeCaseTickWrite,
  computeTrayTick,
  getAutoTrackTiming,
  suggestedDoughStaging,
} from "./station-autotrack-engine.mjs";
import {
  buildRunningSegments,
  computeWallClockDueRefs,
  createWallClockBookkeeping,
  rearmWallClockTimers,
  tickWallClock,
} from "./station-wallclock.mjs";

test("timing: case/tray/batch periods clamp to the 1s..1h web window", () => {
  const t = getAutoTrackTiming(50, 10, 20, 3, { hopperSec: 0.5, spinSec: 30 });
  assert.equal(t.caseMs, 12_000);
  assert.equal(t.trayMs, 24_000);
  assert.equal(t.trayProductionMs, 12_000);
  // hopper 0.5 s clamps to the 1 s web floor; line batch 3_600 ms is the larger drain.
  assert.equal(t.batchConsumptionMs, 1_000); // clamp(3600/4 = 900) floors at 1 s
  assert.equal(t.batchProductionMs, 30_000); // spin wins over line batch
  assert.equal(t.hopperMs, 1_000);
  assert.equal(clampWebPeriodMs(0), 3_600_000);
  assert.equal(clampWebPeriodMs(500), 1_000);
  assert.equal(clampWebPeriodMs(7_200_000), 3_600_000);
  const noMachine = getAutoTrackTiming(50, 10, 20, 3);
  assert.equal(noMachine.hopperMs, 0);
  assert.equal(noMachine.batchConsumptionMs, 1_000);
  assert.equal(noMachine.batchProductionMs, 3_600);
});

test("suggested dough staging caps trays at 40 and batches at 3", () => {
  assert.deepEqual(suggestedDoughStaging(100, 10), { trays: 40, batches: 3 });
  assert.deepEqual(suggestedDoughStaging(0, 0), { trays: null, batches: null });
  assert.deepEqual(suggestedDoughStaging(5.4, 1.2), { trays: 5, batches: 2 });
});

test("app slot info: lifetime requirement with +20 lb buffer, mix types never claim", () => {
  const info = computeAppSlotInfo({
    type: "Cheese Blend", recipe: [{ lbs: 20 }], batchLbs: 0,
    ozPerPizza: 2, casesNeeded: 10, pizzasPerCase: 10, ppm: 50,
  });
  assert.equal(info.recipeLbs, 20);
  assert.equal(info.effectiveBatchLbs, 20);
  assert.equal(info.required, (100 * 2 / 16 + 20) / 20);
  assert.equal(info.cadence, 20 * 16 / 2 / 50 * 60);
  assert.equal(info.validForClaim, true);
  const mix = computeAppSlotInfo({
    type: "Mix", recipe: [], batchLbs: 20,
    ozPerPizza: 2, casesNeeded: 10, pizzasPerCase: 10, ppm: 50,
  });
  assert.equal(mix.validForClaim, false);
  const unknown = computeAppSlotInfo({
    type: "Cheese", recipe: [], batchLbs: 0,
    ozPerPizza: 2, casesNeeded: 10, pizzasPerCase: 10, ppm: 50,
  });
  assert.equal(unknown.effectiveBatchLbs, 0);
  assert.equal(unknown.required, 0);
});

test("auto-track suggestion: packaging-drain expectation uses drain seconds only", () => {
  const suggestion = computeAutoTrackSuggestion({
    runStatus: "paused", drainActive: false, packagingDrainActive: true,
    packagingDrainElapsedSec: 600, ppm: 50, casesPerSkid: 100,
    pizzasPerCase: 10, casesNeeded: 300, freezerTime: 10, elapsedBatchSec: 30 * 60,
  });
  // 600 s * 50 ppm / (10 ppc * 60) = 50 expected cases.
  assert.equal(suggestion.expectedCasesRaw, 50);
  assert.equal(suggestion.expectedCases, 50);
  assert.equal(suggestion.skids, 0);
  assert.equal(suggestion.casesOnSkid, 50);
  assert.equal(computeAutoTrackSuggestion({ runStatus: "ended", drainActive: false, packagingDrainActive: false, packagingDrainElapsedSec: 0, ppm: 0, casesPerSkid: 100, pizzasPerCase: 10, casesNeeded: 300, freezerTime: 10, elapsedBatchSec: 0 }), null);
});

test("case tick write: normal delta, form-reset skip, seed, and need cap", () => {
  const base = { expectedRaw: 10, expectedCases: 10, prevFreezer: -1, nextFreezer: -1, curTotal: 0, casesPerSkid: 100, casesNeeded: 300, drainActive: false, packagingDrainActive: false, caseClaimRetry: false, formResetSkipped: false };
  assert.deepEqual(computeCaseTickWrite({ ...base, prevExpected: 0 }), { action: "write", newTotal: 10, caseClaimRetryReset: false, formResetSkippedNew: false });
  assert.deepEqual(computeCaseTickWrite({ ...base, expectedRaw: 160, prevExpected: 150 }), { action: "reset-skip", newTotal: 0, caseClaimRetryReset: false, formResetSkippedNew: true });
  assert.deepEqual(computeCaseTickWrite({ ...base, prevExpected: -1 }), { action: "seed", newTotal: 10, caseClaimRetryReset: true, formResetSkippedNew: false });
  assert.deepEqual(computeCaseTickWrite({ ...base, expectedRaw: 300, expectedCases: 300, curTotal: 295, prevExpected: 290 }), { action: "write", newTotal: 300, caseClaimRetryReset: false, formResetSkippedNew: false });
  // Drain path counts freezer exits.
  const drain = computeCaseTickWrite({ ...base, drainActive: true, prevExpected: -1, prevFreezer: 20, nextFreezer: 15, curTotal: 7 });
  assert.deepEqual(drain, { action: "write", newTotal: 12, caseClaimRetryReset: false, formResetSkippedNew: false });
});

test("tray tick: first consume seeds, then exact consumption carries remainder", () => {
  const first = computeTrayTick({
    nowMs: 0, prodDueMs: 0, consDueMs: 0, lastMs: 0, periodMs: 24_000,
    suppressed: false, feedComplete: false, deficitOpen: true, seeded: false,
    current: 0, seed: 5, ppm: 50, perTray: 20, remainder: 0,
  });
  assert.deepEqual(first.seed, { from: 0, to: 5 });
  assert.equal(first.delta, 0);
  assert.equal(first.seededNew, true);
  assert.equal(first.prodDueMsNew, 12_000);
  assert.equal(first.consDueMsNew, 24_000);
  const second = computeTrayTick({
    nowMs: 24_000, prodDueMs: 36_000, consDueMs: 24_000, lastMs: 0, periodMs: 24_000,
    suppressed: false, feedComplete: false, deficitOpen: true, seeded: true,
    current: 5, seed: 5, ppm: 50, perTray: 20, remainder: 0,
  });
  // durationMin 0.4 * 50 / 20 = exactly 1 tray consumed.
  assert.equal(second.delta, -1);
  assert.equal(second.remainderNew, 0);
  assert.equal(second.seed, null);
});

test("batch tick: seed scales by remaining trays, consumption drains by effective rate", () => {
  const first = computeBatchTick({
    nowMs: 0, prodDueMs: 0, consDueMs: 0, lastMs: 0, periodMs: 900,
    fullBatchMs: 3_600, effDrainMs: 3_600, suppressed: false, feedComplete: false,
    deficitOpen: true, seeded: false, current: 0, traysSeededAmount: 20,
    traysNeeded: 40, batchesNeeded: 4,
  });
  // remaining = 4 * (40-20)/40 = 2 → seed 2.
  assert.deepEqual(first.seed, { from: 0, to: 2 });
  assert.equal(first.delta, 0);
  const second = computeBatchTick({
    nowMs: 900, prodDueMs: 3_600, consDueMs: 900, lastMs: 0, periodMs: 900,
    fullBatchMs: 3_600, effDrainMs: 3_600, suppressed: false, feedComplete: false,
    deficitOpen: true, seeded: true, current: 2, traysSeededAmount: 20,
    traysNeeded: 40, batchesNeeded: 4,
  });
  // 0.9 min wait → lastMs 0 → durationMin = period/60000 = 0.015... wait: lastMs>0? no → 900/60000=0.015 min → 0.015*60000/3600 = 0.25.
  assert.equal(second.delta, -0.25);
});

test("wall clock: running segments exclude closed pauses and cut at an open one", () => {
  assert.deepEqual(buildRunningSegments({ startedAt: 0, nowMs: 100 }), [{ start: 0, end: 100 }]);
  assert.deepEqual(
    buildRunningSegments({ startedAt: 0, nowMs: 100, stoppages: [{ type: "pause", startedAt: 30, endedAt: 60 }] }),
    [{ start: 0, end: 30 }, { start: 60, end: 100 }]
  );
  assert.deepEqual(
    buildRunningSegments({ startedAt: 0, nowMs: 100, stoppages: [{ type: "pause", startedAt: 30 }] }),
    [{ start: 0, end: 30 }]
  );
  assert.deepEqual(buildRunningSegments({ startedAt: Number.NaN, nowMs: 100 }), []);
});

test("wall clock: due refs advance past the last segment end", () => {
  const refs = computeWallClockDueRefs({
    startedAt: 0, nowMs: 100_000, timing: getAutoTrackTiming(50, 10, 20, 3),
  });
  assert.equal(refs.caseDueMs, 108_000);
  // batch-consumption clamps to the 1 s web floor: (floor(100000/1000)+1)*1000.
  assert.equal(refs.batchConsDueMs, 101_000);
  assert.equal(computeWallClockDueRefs({ startedAt: undefined, nowMs: 100_000, timing: getAutoTrackTiming(50, 10, 20, 3) }), null);
});

test("wall clock: first case tick seeds from a live expected count", () => {
  const b = createWallClockBookkeeping();
  const timing = getAutoTrackTiming(50, 10, 20, 3);
  const rearmed = rearmWallClockTimers(b, 0, timing);
  assert.equal(rearmed.caseNextDueMs, 12_000);
  const { next, events } = tickWallClock({
    bookkeeping: { ...rearmed, caseNextDueMs: 0 },
    nowMs: 0,
    timing,
    runStatus: "running",
    drainActive: false,
    packagingDrainActive: false,
    packagingAutoTrackActive: true,
    caseSuppressed: false,
    doughSuppressed: false,
    calc: { ppm: 50, perTray: 20, perBatch: 3, pressDone: false, casesInFreezer: 0, traysNeeded: 40, batchesNeeded: 4 },
    v: { pizzasPerCase: 10, casesPerSkid: 100, casesNeeded: 300, traysOnLine: 0, batchesReady: 0 },
    form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 },
    expectedCasesRaw: 10,
    expectedCases: 10,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, "case");
  assert.deepEqual(events[0].mutations, [
    { field: "skidsCompleted", from: 0, to: 0 },
    { field: "casesOnCurrentSkid", from: 0, to: 10 },
  ]);
  assert.equal(next.lastExpectedCases, 10);
  assert.equal(next.caseClaimRetry, false);
  assert.equal(next.caseNextDueMs, 12_000);
});

test("wall clock: dough pause freezes dough channels but case bookkeeping stays live", () => {
  const b = { ...createWallClockBookkeeping(), doughPausedAtMs: 5_000 };
  const timing = getAutoTrackTiming(50, 10, 20, 3);
  const { next, events } = tickWallClock({
    bookkeeping: { ...b, caseNextDueMs: 0 },
    nowMs: 6_000,
    timing,
    runStatus: "running",
    drainActive: false,
    packagingDrainActive: false,
    packagingAutoTrackActive: true,
    caseSuppressed: false,
    doughSuppressed: false,
    calc: { ppm: 50, perTray: 20, perBatch: 3, pressDone: false, casesInFreezer: 0, traysNeeded: 40, batchesNeeded: 4 },
    v: { pizzasPerCase: 10, casesPerSkid: 100, casesNeeded: 300, traysOnLine: 0, batchesReady: 0 },
    form: { skidsCompleted: 0, casesOnCurrentSkid: 0, traysOnLine: 0, batchesReady: 0 },
    expectedCasesRaw: 10,
    expectedCases: 10,
  });
  assert.equal(events.filter((e) => e.channel === "case").length, 1);
  assert.equal(events.some((e) => e.channel.startsWith("tray") || e.channel.startsWith("batch") || e.channel === "hopper"), false);
  assert.equal(next.trayConsNextDueMs, 0);
});
