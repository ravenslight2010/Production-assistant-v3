import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTemporaryOverrides,
  caseBasedProductionNeedsAvailable,
  computeCalc,
  computeCasesInFreezer,
  computeCasesOnLine,
  computeEffectiveLineSpeed,
  computeServerCalc,
  computeSharedServerCalc,
  FACTORY_SPEED_ADJUSTMENT_BASELINE,
  SAUCE_MARGIN_LBS,
  APPLICATOR_MARGIN_LBS,
  selectCanonicalLiveRun,
  TWO_WIDE_PRESS_TO_OVEN_MIN,
} from "./station-live-calc.mjs";

const NOW = 1_800_000_000_000;

test("computeEffectiveLineSpeed: dough mode multiplies by adjustment, defaulting to factory baseline", () => {
  assert.equal(
    computeEffectiveLineSpeed({ mode: "dough", crustsPerCycle: 5, cycleSpeed: 10 }),
    Math.round(5 * 10 * FACTORY_SPEED_ADJUSTMENT_BASELINE * 100) / 100
  );
  assert.equal(
    computeEffectiveLineSpeed({ mode: "dough", crustsPerCycle: 5, cycleSpeed: 10, speedAdjustment: 1 }),
    50
  );
  assert.equal(computeEffectiveLineSpeed({ mode: "dough", crustsPerCycle: 0, cycleSpeed: 10 }), 0);
});

test("computeEffectiveLineSpeed: crusts mode passes approxLineSpeed through", () => {
  assert.equal(computeEffectiveLineSpeed({ mode: "crusts", approxLineSpeed: 123.456 }), 123.46);
  assert.equal(computeEffectiveLineSpeed({ mode: "crusts", approxLineSpeed: 0 }), 0);
});

test("applyTemporaryOverrides: positive temps win, non-positive ignored", () => {
  const base = { freezerTime: 30, crustsPerCycle: 5, cycleSpeed: 10 };
  assert.deepEqual(applyTemporaryOverrides({ ...base, tempFreezerTime: 45 }), {
    ...base,
    tempFreezerTime: 45,
    freezerTime: 45,
  });
  assert.deepEqual(applyTemporaryOverrides({ ...base, tempFreezerTime: 0, tempCycleSpeed: 12 }), {
    ...base,
    tempFreezerTime: 0,
    tempCycleSpeed: 12,
    cycleSpeed: 12,
  });
  assert.deepEqual(applyTemporaryOverrides(base), base);
});

test("caseBasedProductionNeedsAvailable: cases without package count hide production needs", () => {
  assert.equal(caseBasedProductionNeedsAvailable({ casesNeeded: 10, pizzasPerCase: 12 }), true);
  assert.equal(caseBasedProductionNeedsAvailable({ casesNeeded: 10, pizzasPerCase: 0 }), false);
  assert.equal(caseBasedProductionNeedsAvailable({ casesNeeded: 0, pizzasPerCase: 0 }), true);
});

test("computeCasesInFreezer: fills while running, drains after end, excludes closed pauses via shifted start", () => {
  const base = { ppm: 50, pizzasPerCase: 10, freezerTimeMin: 10 };
  const startedAt = NOW - 20 * 60000;
  assert.equal(
    computeCasesInFreezer({ ...base, startedAt, now: NOW }),
    Math.floor((50 * 10) / 10)
  );
  // Paused run freezes at the pause point.
  const pausedAt = NOW - 15 * 60000;
  assert.equal(
    computeCasesInFreezer({ ...base, startedAt, pausedAt, now: NOW }),
    Math.floor((50 * Math.min(5, 10)) / 10)
  );
  // Ended 30 min ago: freezer WIP (10 min worth) fully drained.
  const endedAt = NOW - 30 * 60000;
  assert.equal(computeCasesInFreezer({ ...base, startedAt, endedAt, now: NOW }), 0);
  // Ended just now: full freezer WIP remains.
  assert.equal(
    computeCasesInFreezer({ ...base, startedAt, endedAt: NOW, now: NOW }),
    Math.floor((50 * 10) / 10)
  );
});

test("computeCasesOnLine: configured window and two-wide segment fill in parallel", () => {
  const base = { ppm: 50, pizzasPerCase: 10, freezerTimeMin: 10 };
  const startedAt = NOW - 20 * 60000;
  assert.equal(
    computeCasesOnLine({ ...base, startedAt, now: NOW }),
    Math.floor((50 * (10 + TWO_WIDE_PRESS_TO_OVEN_MIN)) / 10)
  );
  // Long-running: both windows saturated, capped at freezerTime + two-wide.
  assert.equal(
    computeCasesOnLine({ ...base, startedAt: NOW - 60 * 60000, now: NOW }),
    Math.floor((50 * (10 + TWO_WIDE_PRESS_TO_OVEN_MIN)) / 10)
  );
  assert.equal(computeCasesOnLine({ ...base, startedAt: null, now: NOW }), 0);
});

function formValues(overrides = {}) {
  return {
    approxLineSpeed: 0,
    speedAdjustment: 1,
    freezerTime: 10,
    crustsPerCycle: 5,
    cycleSpeed: 10,
    pizzasPerCase: 10,
    casesPerSkid: 100,
    casesPerLayer: 10,
    doughballsPerTray: 20,
    crustsPerStack: 0,
    doughBatchYield: 40,
    crustsPerCase: 0,
    casesNeeded: 100,
    skidsCompleted: 0,
    casesOnCurrentSkid: 0,
    traysOnLine: 0,
    batchesReady: 0,
    targetDoughballWeight: 20,
    doughRecipe: [
      { ingredient: "Flour", lbs: 40 },
      { ingredient: "Water", lbs: 10 },
    ],
    sauceBarrelLbs: 0,
    sauceOzPerPizza: 4,
    frontlineRecipe: [{ ingredient: "Sauce", lbs: 40 }],
    app1OzPerPizza: 2, app1BatchLbs: 25, app1Type: "Cheese", app1CheeseRecipe: [],
    app2OzPerPizza: 0, app2BatchLbs: 0, app2Type: "", app2CheeseRecipe: [],
    app3OzPerPizza: 0, app3BatchLbs: 0, app3Type: "", app3CheeseRecipe: [],
    app4OzPerPizza: 0, app4BatchLbs: 0, app4Type: "", app4CheeseRecipe: [],
    pep1OzPerPizza: 1.5, pep1Sticks: 3, pep1BatchLbs: 50, pep1Type: "Cup",
    pep2OzPerPizza: 1, pep2Sticks: 2, pep2BatchLbs: 50, pep2Type: "Diced",
    pep1Combined: false,
    pep1TypeB: "", pep1OzPerPizzaB: 0, pep1SticksB: 0, pep1BatchLbsB: 0,
    pep2TypeB: "", pep2OzPerPizzaB: 0, pep2SticksB: 0, pep2BatchLbsB: 0,
    ...overrides,
  };
}

const DEFAULT_PEP_TYPES = ["Cup", "Sliced"];

function liveRun(overrides = {}) {
  return {
    id: "run-1",
    startedAt: NOW - 20 * 60000,
    endedAt: undefined,
    pausedAt: undefined,
    stoppages: [],
    ...overrides,
  };
}

test("computeCalc: full dough-mode chain with hand-computed expectations", () => {
  // ppm = 5 * 10 * 1 = 50; 20 min elapsed, freezerTime 10, casesPerLayer 10.
  const calc = computeCalc({
    v: formValues(),
    ve: formValues(),
    currentRun: liveRun(),
    nowTimeMs: NOW,
    doughSubTab: "dough",
    defaultPepTypes: DEFAULT_PEP_TYPES,
  });
  assert.equal(calc.ppm, 50);
  assert.equal(calc.casesInFreezer, 50);
  assert.equal(calc.casesOnLine, 56);
  // casesLeftToRun = 100 - 56 + 10 = 54; totalPizzasForSauce = 64 * 10 = 640.
  assert.equal(calc.casesLeftToRun, 54);
  assert.equal(calc.casesForTiming, 44);
  // Dough: 50 lb recipe / 20 oz ball => yield 40 balls; deficit 540 pizzas.
  assert.equal(calc.perTray, 20);
  assert.equal(calc.perBatch, 40);
  assert.equal(calc.batchesNeeded, 13.5);
  assert.equal(calc.traysNeeded, 27);
  assert.equal(calc.doughShortCases, 54);
  // Sauce carries the factory +30 lb margin: 640*4/16 + 30 = 190.
  assert.equal(calc.sauceEffBarrel, 40);
  assert.equal(calc.sauceBatches, 190 / 40);
  assert.equal(calc.sauceDepletionSec, ((40 * 16) / 4 / 50) * 60);
  // Applicator carries the factory +20 lb margin: 640*2/16 + 20 = 100.
  assert.equal(calc.app1Lbs, 100);
  assert.equal(calc.app1Batches, 4);
  // Empty applicator slots still show the fixed margin, but no batches.
  assert.equal(calc.app2Lbs, APPLICATOR_MARGIN_LBS);
  assert.equal(calc.app2Batches, 0);
  // Pepperoni sticks add whole-lb stick weight; default types make no batches.
  assert.equal(calc.pep1Lbs, 63);
  assert.equal(calc.pep1Batches, 0);
  assert.equal(calc.pep2Lbs, 42);
  assert.equal(calc.pep2Batches, 0.84);
  // Timing: press path uses freezer WIP, so pressCasesLeft = 100 - 0 - 50 = 50.
  assert.equal(calc.pressCasesLeft, 50);
  assert.equal(calc.pressDone, false);
  assert.equal(calc.adjustedTimeSec, (50 * 10 * 60) / 50);
  assert.equal(calc.totalTimeSec, (44 * 10 * 60) / 50);
  // Pace: 20 min elapsed minus 10 min freezer lag => 50 expected cases, 0 done.
  assert.equal(calc.paceStatus, "behind");
  assert.equal(calc.paceDelta, -50);
  assert.equal(calc.catchUpPpm, 1000);
});

test("computeCalc: pace reports on-pace within the two-case band", () => {
  const v = formValues({ skidsCompleted: 0, casesOnCurrentSkid: 46 });
  const calc = computeCalc({
    v,
    ve: v,
    currentRun: liveRun(),
    nowTimeMs: NOW,
    doughSubTab: "dough",
    defaultPepTypes: DEFAULT_PEP_TYPES,
  });
  assert.equal(calc.casesCompleted, 46);
  assert.equal(calc.paceDelta, -4);
  assert.equal(calc.paceStatus, "behind");
  const v2 = formValues({ casesOnCurrentSkid: 49 });
  const calc2 = computeCalc({
    v: v2,
    ve: v2,
    currentRun: liveRun(),
    nowTimeMs: NOW,
    doughSubTab: "dough",
    defaultPepTypes: DEFAULT_PEP_TYPES,
  });
  assert.equal(calc2.paceDelta, -1);
  assert.equal(calc2.paceStatus, "on-pace");
  assert.equal(calc2.catchUpPpm, null);
});

test("computeCalc: production needs hidden when cases requested with no package count", () => {
  const v = formValues({ casesNeeded: 10, pizzasPerCase: 0 });
  const calc = computeCalc({
    v,
    ve: v,
    currentRun: liveRun(),
    nowTimeMs: NOW,
    doughSubTab: "dough",
    defaultPepTypes: DEFAULT_PEP_TYPES,
  });
  assert.equal(calc.app1Lbs, 0);
  assert.equal(calc.pep1Lbs, 0);
  assert.equal(calc.sauceBatches, 0);
});

test("computeCalc: temporary overrides steer the effective values", () => {
  const v = formValues({ tempCycleSpeed: 20 });
  const calc = computeCalc({
    v,
    ve: applyTemporaryOverrides(v),
    currentRun: liveRun(),
    nowTimeMs: NOW,
    doughSubTab: "dough",
    defaultPepTypes: DEFAULT_PEP_TYPES,
  });
  assert.equal(calc.ppm, 100);
});

test("selectCanonicalLiveRun: active beats ended beats pending, latest start wins", () => {
  const active = { id: "a", startedAt: 100, endedAt: null };
  const olderActive = { id: "b", startedAt: 50, endedAt: null };
  const ended = { id: "c", startedAt: 10, endedAt: 200 };
  const pending = { id: "d" };
  assert.equal(selectCanonicalLiveRun([pending, ended, olderActive, active])?.id, "a");
  assert.equal(selectCanonicalLiveRun([pending, ended])?.id, "c");
  assert.equal(selectCanonicalLiveRun([pending])?.id, "d");
  assert.equal(selectCanonicalLiveRun([]), undefined);
  assert.equal(selectCanonicalLiveRun(undefined), undefined);
});

test("computeServerCalc: null without run values, merges packaging progress", () => {
  const payload = {
    dayState: { runs: [liveRun()], currentIndex: 0 },
    runValues: {},
  };
  assert.equal(computeServerCalc(payload, DEFAULT_PEP_TYPES, NOW), null);

  const withValues = {
    ...payload,
    runValues: {
      "run-1": { ...formValues(), casesOnCurrentSkid: 5 },
    },
    packagingProgress: { "run-1": { casesOnCurrentSkid: 7 } },
  };
  const result = computeServerCalc(withValues, DEFAULT_PEP_TYPES, NOW);
  assert.equal(result.runId, "run-1");
  assert.equal(result.calc.casesCompleted, 7);
});

test("computeSharedServerCalc: follows lifecycle, ignores screen selection", () => {
  const payload = {
    dayState: {
      runs: [
        { id: "pending" },
        { id: "ended", startedAt: 10, endedAt: 200 },
        { id: "active", startedAt: 100, endedAt: null },
      ],
    },
    runValues: {
      pending: formValues(),
      ended: formValues(),
      active: formValues(),
    },
  };
  const result = computeSharedServerCalc(payload, DEFAULT_PEP_TYPES, NOW);
  assert.equal(result.runId, "active");
});
