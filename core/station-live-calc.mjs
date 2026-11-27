// Station live calculation — ported from v1 (ravenslight2010/Production-run-calculator
// lib/live-calc/src/index.ts + lib/inventory-math occupancy functions) so v3's
// station tabs display the same numbers v1 did. The math is intentionally
// identical, constants included: 0.92 speed baseline, +30 lb sauce / +20 lb
// applicator margins, 1.25 min two-wide press-to-oven occupancy.
//
// Pure module: no I/O, no clock except the caller-supplied nowTimeMs. The
// server-shaped entry (computeServerCalc) mirrors v1's sync payload so a v3
// run snapshot can feed it directly.

export const FACTORY_SPEED_ADJUSTMENT_BASELINE = 0.92;
export const SAUCE_MARGIN_LBS = 30;
export const APPLICATOR_MARGIN_LBS = 20;
export const TWO_WIDE_PRESS_TO_OVEN_MIN = 1.25;

export function computeEffectiveLineSpeed(input) {
  const mode = input.mode;
  const finiteOrZero = (value) => (Number.isFinite(value) ? Number(value) : 0);
  if (mode === "crusts") {
    const ppm = finiteOrZero(input.approxLineSpeed);
    return ppm > 0 ? Math.round(ppm * 100) / 100 : 0;
  }
  const adjustment =
    input.speedAdjustment == null || !Number.isFinite(input.speedAdjustment)
      ? FACTORY_SPEED_ADJUSTMENT_BASELINE
      : Number(input.speedAdjustment);
  const ppm = finiteOrZero(input.crustsPerCycle) * finiteOrZero(input.cycleSpeed) * adjustment;
  return ppm > 0 ? Math.round(ppm * 100) / 100 : 0;
}

export function applyTemporaryOverrides(v) {
  const freezerTime = Number(v.tempFreezerTime) || 0;
  const crustsPerCycle = Number(v.tempCrustsPerCycle) || 0;
  const cycleSpeed = Number(v.tempCycleSpeed) || 0;
  if (freezerTime <= 0 && crustsPerCycle <= 0 && cycleSpeed <= 0) return v;
  return {
    ...v,
    ...(freezerTime > 0 ? { freezerTime } : {}),
    ...(crustsPerCycle > 0 ? { crustsPerCycle } : {}),
    ...(cycleSpeed > 0 ? { cycleSpeed } : {}),
  };
}

function recipeLbs(rows) {
  return (rows ?? []).reduce((sum, row) => sum + Number(row.lbs ?? 0), 0);
}

/** Fixed buffers must never appear by themselves as plausible production totals. */
export function caseBasedProductionNeedsAvailable(vals) {
  return !(Number(vals.casesNeeded) > 0 && !(Number(vals.pizzasPerCase) > 0));
}

function openPauseMsAtEnd(stoppages, endedAt) {
  return (stoppages ?? [])
    .filter((s) => s.type === "pause" && s.startedAt < endedAt && (s.endedAt == null || s.endedAt >= endedAt))
    .reduce((acc, s) => acc + (endedAt - s.startedAt), 0);
}

/** Freezer WIP: fills at ppm for freezerTimeMin while running, pauses freeze it,
 *  after end it drains at the same rate. */
export function computeCasesInFreezer(input) {
  const { startedAt, endedAt, pausedAt, now, ppm, pizzasPerCase, freezerTimeMin } = input;
  if (!startedAt || ppm <= 0 || pizzasPerCase <= 0 || freezerTimeMin <= 0) return 0;
  if (!endedAt) {
    const refTime = pausedAt ?? now;
    const elapsedMin = Math.max(0, (refTime - startedAt) / 60000);
    return Math.floor((ppm * Math.min(elapsedMin, freezerTimeMin)) / pizzasPerCase);
  }
  const openPauseMs = openPauseMsAtEnd(input.stoppages, endedAt);
  const atEndMin = Math.min(Math.max(0, endedAt - startedAt - openPauseMs) / 60000, freezerTimeMin);
  const sinceEndMin = Math.max(0, (now - endedAt) / 60000);
  const remainMin = Math.max(0, Math.min(atEndMin, freezerTimeMin - sinceEndMin));
  return Math.floor((ppm * remainMin) / pizzasPerCase);
}

/** Line WIP: the configured freezer window plus the two-wide press-to-oven
 *  segment fill in parallel while running; after end it drains. */
export function computeCasesOnLine(input) {
  const {
    startedAt,
    endedAt,
    pausedAt,
    now,
    ppm,
    pizzasPerCase,
    freezerTimeMin,
    twoWidePressToOvenMin = TWO_WIDE_PRESS_TO_OVEN_MIN,
  } = input;
  const parallelMin = Number(twoWidePressToOvenMin);
  const configuredMin = Number(freezerTimeMin);
  const twoWideMin = Number.isFinite(parallelMin) ? Math.max(0, parallelMin) : 0;
  if (!startedAt || ppm <= 0 || pizzasPerCase <= 0 || configuredMin + twoWideMin <= 0) return 0;
  const occupancyMinutesAt = (ref) => {
    const elapsed = Math.max(0, (ref - startedAt) / 60000);
    return Math.min(elapsed, configuredMin) + Math.min(elapsed, twoWideMin);
  };
  if (!endedAt) {
    return Math.floor((ppm * occupancyMinutesAt(pausedAt ?? now)) / pizzasPerCase);
  }
  const openPauseMs = openPauseMsAtEnd(input.stoppages, endedAt);
  const atEndMin = occupancyMinutesAt(endedAt - openPauseMs);
  const sinceEndMin = Math.max(0, (now - endedAt) / 60000);
  const remainMin = Math.max(0, atEndMin - sinceEndMin);
  return Math.floor((ppm * remainMin) / pizzasPerCase);
}

/** Shared displays follow lifecycle, never a device screen selection:
 *  latest started-unended run, else latest ended (drain displays), else first pending. */
export function selectCanonicalLiveRun(runs) {
  let active;
  let ended;
  let pending;
  const positiveTime = (value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  for (const run of runs ?? []) {
    if (typeof run.id !== "string" || !run.id) continue;
    if (positiveTime(run.startedAt) && run.endedAt == null) {
      if (!active || positiveTime(run.startedAt) >= positiveTime(active.startedAt)) active = run;
    } else if (positiveTime(run.endedAt)) {
      if (!ended || positiveTime(run.endedAt) >= positiveTime(ended.endedAt)) ended = run;
    } else if (run.startedAt == null && run.endedAt == null) {
      pending ??= run;
    }
  }
  return active ?? ended ?? pending;
}

export function computeCalc({ v, ve, currentRun, nowTimeMs, doughSubTab, defaultPepTypes }) {
  const ppm = computeEffectiveLineSpeed({
    mode: doughSubTab === "crusts" ? "crusts" : "dough",
    approxLineSpeed: v.approxLineSpeed,
    crustsPerCycle: ve.crustsPerCycle,
    cycleSpeed: ve.cycleSpeed,
    speedAdjustment: v.speedAdjustment,
  });
  const perTray = doughSubTab === "crusts" ? v.crustsPerStack : v.doughballsPerTray;
  const doughLbs = recipeLbs(v.doughRecipe);
  const effectiveDoughBatchYield =
    doughLbs > 0 && v.targetDoughballWeight > 0
      ? (doughLbs * 16) / v.targetDoughballWeight
      : v.doughBatchYield;
  const traysPerSkid = (v.casesPerSkid * v.pizzasPerCase) / perTray;
  const perBatch = doughSubTab === "crusts" ? v.crustsPerCase : effectiveDoughBatchYield;
  const traysPerBatch = effectiveDoughBatchYield / perTray;
  const batchesPerSkid = traysPerSkid / traysPerBatch;
  const occupancy = {
    startedAt: currentRun?.startedAt,
    endedAt: currentRun?.endedAt,
    pausedAt: currentRun?.pausedAt,
    stoppages: currentRun?.stoppages,
    now: nowTimeMs,
    ppm,
    pizzasPerCase: v.pizzasPerCase,
    freezerTimeMin: Number(ve.freezerTime),
  };
  const casesOnLine = computeCasesOnLine(occupancy);
  const casesInFreezer = computeCasesInFreezer(occupancy);
  const casesLeftToRun =
    v.casesNeeded - v.skidsCompleted * v.casesPerSkid - v.casesOnCurrentSkid - casesOnLine + v.casesPerLayer;
  const casesForTiming = casesLeftToRun - v.casesPerLayer;
  const totalPizzasLeft = casesLeftToRun * v.pizzasPerCase;
  const doughOnHand = v.traysOnLine * perTray + v.batchesReady * effectiveDoughBatchYield;
  const doughDeficit = Math.max(0, totalPizzasLeft - doughOnHand);
  const batchesNeeded = doughDeficit / effectiveDoughBatchYield;
  const traysNeeded = doughDeficit / perTray;
  const pizzasNetOfStaged = Math.max(0, totalPizzasLeft - v.traysOnLine * perTray);
  const casesLeftToOpen = v.crustsPerCase > 0 ? Math.ceil(pizzasNetOfStaged / v.crustsPerCase) : 0;
  const stacksNeededTotal = perTray > 0 ? Math.ceil(pizzasNetOfStaged / perTray) : 0;
  const buffer = Math.max(0, doughOnHand - totalPizzasLeft) / v.pizzasPerCase;
  const doughShortCases = doughDeficit / v.pizzasPerCase;
  const doughDepletionSec = ppm > 0 ? (doughOnHand / ppm) * 60 : 0;
  const casesOnLastSkid = Math.ceil(Math.max(0, v.casesPerSkid - casesOnLine));
  const timePressHzSec =
    doughSubTab !== "crusts" && ppm > 0 && ve.crustsPerCycle > 0 ? (ve.crustsPerCycle / ppm) * 60 : 0;
  const timePerTraySec = ppm > 0 ? (perTray / ppm) * 60 : 0;
  const timePerBatchSec = ppm > 0 ? (perBatch / ppm) * 60 : 0;
  const timePerSkidSec = ppm > 0 ? (v.casesPerSkid * v.pizzasPerCase * 60) / ppm : 0;
  const timePerCaseSec = ppm > 0 ? (v.pizzasPerCase / ppm) * 60 : 0;
  const totalTimeSec = ppm > 0 ? (casesForTiming * v.pizzasPerCase * 60) / ppm : 0;
  const doughMadeTimeSec = ppm > 0 ? (doughOnHand / ppm) * 60 : 0;
  const rackTimes = [10, 12, 16, 18, 20, 22].map((trays) => ({
    trays,
    sec: ppm > 0 ? (trays * perTray * 60) / ppm : 0,
  }));
  const productionNeedsAvailable = caseBasedProductionNeedsAvailable(v);
  const totalPizzasForSauce = casesLeftToRun * v.pizzasPerCase + v.casesPerLayer * v.pizzasPerCase;
  const sauceEffBarrel = recipeLbs(v.frontlineRecipe) || v.sauceBarrelLbs;
  const sauceLbs = productionNeedsAvailable ? (totalPizzasForSauce * v.sauceOzPerPizza) / 16 + SAUCE_MARGIN_LBS : 0;
  const sauceBatches = sauceEffBarrel > 0 ? sauceLbs / sauceEffBarrel : 0;
  const sauceDepletionSec =
    productionNeedsAvailable && ppm > 0 && sauceEffBarrel > 0 && v.sauceOzPerPizza > 0
      ? ((sauceEffBarrel * 16) / v.sauceOzPerPizza / ppm) * 60
      : 0;
  const app = [1, 2, 3, 4].map((slot) => {
    const oz = v[`app${slot}OzPerPizza`];
    const batchLbs = v[`app${slot}BatchLbs`];
    const type = v[`app${slot}Type`];
    const recipe = v[`app${slot}CheeseRecipe`];
    const lbs = productionNeedsAvailable ? (totalPizzasForSauce * oz) / 16 + APPLICATOR_MARGIN_LBS : 0;
    const effectiveBatch = recipeLbs(recipe) || batchLbs;
    const batches = !String(type ?? "").trim().toLowerCase().includes("mix") && effectiveBatch > 0
      ? lbs / effectiveBatch
      : 0;
    return { lbs, batches };
  });
  const pepCombined = v.pep1Combined === true;
  const pepStickMult = pepCombined ? 2 : 1;
  const pep1Lbs = productionNeedsAvailable
    ? (totalPizzasForSauce * v.pep1OzPerPizza) / 16 + v.pep1Sticks * pepStickMult
    : 0;
  const pep1Batches =
    !defaultPepTypes.includes(v.pep1Type ?? "") && v.pep1BatchLbs > 0 ? pep1Lbs / v.pep1BatchLbs : 0;
  const pep1TypeB = (v.pep1TypeB ?? "").trim();
  const pep1LbsB =
    productionNeedsAvailable && pep1TypeB
      ? (totalPizzasForSauce * (v.pep1OzPerPizzaB ?? 0)) / 16 + (v.pep1SticksB ?? 0) * pepStickMult
      : 0;
  const pep1BatchesB =
    pep1TypeB && !defaultPepTypes.includes(pep1TypeB) && (v.pep1BatchLbsB ?? 0) > 0
      ? pep1LbsB / (v.pep1BatchLbsB || 1)
      : 0;
  const pep2Lbs =
    !productionNeedsAvailable || pepCombined
      ? 0
      : (totalPizzasForSauce * v.pep2OzPerPizza) / 16 + v.pep2Sticks;
  const pep2Batches =
    !pepCombined && !defaultPepTypes.includes(v.pep2Type ?? "") && v.pep2BatchLbs > 0
      ? pep2Lbs / v.pep2BatchLbs
      : 0;
  const pep2TypeB = (v.pep2TypeB ?? "").trim();
  const pep2LbsB =
    productionNeedsAvailable && !pepCombined && pep2TypeB
      ? (totalPizzasForSauce * (v.pep2OzPerPizzaB ?? 0)) / 16 + (v.pep2SticksB ?? 0)
      : 0;
  const pep2BatchesB =
    !pepCombined && pep2TypeB && !defaultPepTypes.includes(pep2TypeB) && (v.pep2BatchLbsB ?? 0) > 0
      ? pep2LbsB / (v.pep2BatchLbsB || 1)
      : 0;
  const casesCompleted = v.skidsCompleted * v.casesPerSkid + v.casesOnCurrentSkid;
  const extraCases = Math.max(0, casesCompleted - v.casesNeeded);
  const pressCasesLeft = v.casesNeeded > 0 ? Math.max(0, v.casesNeeded - casesCompleted - casesInFreezer) : 0;
  const pressDone = v.casesNeeded > 0 && casesCompleted + casesInFreezer >= v.casesNeeded;
  const isLiveRun = !!currentRun?.startedAt && !currentRun?.endedAt;
  const adjustedTimeSec =
    ppm > 0
      ? ((isLiveRun && v.casesNeeded > 0 ? pressCasesLeft : casesForTiming) * v.pizzasPerCase * 60) / ppm
      : totalTimeSec;
  let paceStatus = null;
  let paceDelta = 0;
  let elapsedSec = 0;
  if (currentRun?.startedAt && !currentRun.endedAt && ppm > 0 && v.pizzasPerCase > 0) {
    const refTime = currentRun.pausedAt ?? nowTimeMs;
    const downtimeMs = (currentRun.stoppages ?? [])
      .filter((s) => s.endedAt && s.type !== "pause")
      .reduce((sum, s) => sum + (s.endedAt - s.startedAt), 0);
    elapsedSec = Math.max(0, refTime - currentRun.startedAt - downtimeMs) / 1000;
    const elapsedMin = elapsedSec / 60;
    const expectedCases = Math.floor(
      (ppm * Math.max(0, elapsedMin - Number(ve.freezerTime))) / v.pizzasPerCase
    );
    paceDelta = casesCompleted - expectedCases;
    if (elapsedMin >= Number(ve.freezerTime)) {
      paceStatus = Math.abs(paceDelta) <= 2 ? "on-pace" : paceDelta > 0 ? "ahead" : "behind";
    }
  }
  let catchUpPpm = null;
  if (paceStatus === "behind" && ppm > 0 && v.casesNeeded > 0) {
    const remainingCases = v.casesNeeded - casesCompleted;
    const remainingSec = Math.max(60, (v.casesNeeded * v.pizzasPerCase * 60) / ppm - elapsedSec);
    if (remainingCases > 0) catchUpPpm = Math.round((remainingCases * v.pizzasPerCase * 60) / remainingSec);
  }
  return {
    ppm,
    traysPerSkid,
    traysPerBatch,
    batchesPerSkid,
    casesOnLine,
    casesInFreezer,
    casesLeftToRun,
    casesLeftToOpen,
    stacksNeededTotal,
    casesForTiming,
    batchesNeeded,
    traysNeeded,
    buffer,
    doughShortCases,
    doughDepletionSec,
    casesOnLastSkid,
    timePressHzSec,
    timePerTraySec,
    timePerBatchSec,
    timePerSkidSec,
    timePerCaseSec,
    totalTimeSec,
    adjustedTimeSec,
    pressCasesLeft,
    pressDone,
    extraCases,
    doughMadeTimeSec,
    rackTimes,
    sauceBatches,
    sauceDepletionSec,
    app1Lbs: app[0].lbs,
    app1Batches: app[0].batches,
    app2Lbs: app[1].lbs,
    app2Batches: app[1].batches,
    app3Lbs: app[2].lbs,
    app3Batches: app[2].batches,
    app4Lbs: app[3].lbs,
    app4Batches: app[3].batches,
    pep1Lbs,
    pep1Batches,
    pep2Lbs,
    pep2Batches,
    pep1LbsB,
    pep1BatchesB,
    pep2LbsB,
    pep2BatchesB,
    casesCompleted,
    paceStatus,
    paceDelta,
    catchUpPpm,
    perTray,
    perBatch,
    sauceEffBarrel,
  };
}

const SERVER_CALC_BASE = {
  approxLineSpeed: 0,
  speedAdjustment: FACTORY_SPEED_ADJUSTMENT_BASELINE,
  freezerTime: 0,
  crustsPerCycle: 0,
  cycleSpeed: 0,
  pizzasPerCase: 0,
  casesPerSkid: 0,
  casesPerLayer: 0,
  doughballsPerTray: 0,
  crustsPerStack: 0,
  doughBatchYield: 0,
  crustsPerCase: 0,
  casesNeeded: 0,
  skidsCompleted: 0,
  casesOnCurrentSkid: 0,
  traysOnLine: 0,
  batchesReady: 0,
  targetDoughballWeight: 0,
  doughRecipe: [],
  sauceBarrelLbs: 0,
  sauceOzPerPizza: 0,
  frontlineRecipe: [],
  app1OzPerPizza: 0, app1BatchLbs: 0, app1Type: "", app1CheeseRecipe: [],
  app2OzPerPizza: 0, app2BatchLbs: 0, app2Type: "", app2CheeseRecipe: [],
  app3OzPerPizza: 0, app3BatchLbs: 0, app3Type: "", app3CheeseRecipe: [],
  app4OzPerPizza: 0, app4BatchLbs: 0, app4Type: "", app4CheeseRecipe: [],
  pep1OzPerPizza: 0, pep1Sticks: 0, pep1BatchLbs: 0, pep1Type: "",
  pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 0, pep2Type: "",
  pep1Combined: false,
  pep1TypeB: "", pep1OzPerPizzaB: 0, pep1SticksB: 0, pep1BatchLbsB: 0,
  pep2TypeB: "", pep2OzPerPizzaB: 0, pep2SticksB: 0, pep2BatchLbsB: 0,
};

/** v1-shaped server payload: dayState runs + per-run form snapshots + packaging
 *  progress. v3's run snapshot can be adapted onto this shape. */
export function computeServerCalc(payload, defaultPepTypes, nowTimeMs = Date.now()) {
  const run = payload.dayState?.runs?.[payload.dayState.currentIndex ?? 0];
  if (!run?.id) return null;
  const raw = payload.runValues?.[run.id];
  if (!raw || typeof raw !== "object") return null;
  const base = { ...SERVER_CALC_BASE, ...raw };
  const progress = payload.packagingProgress?.[run.id];
  const v = { ...base, ...(progress ?? {}) };
  const ve = applyTemporaryOverrides(v);
  return {
    runId: run.id,
    calc: computeCalc({
      v,
      ve,
      currentRun: run,
      nowTimeMs,
      doughSubTab: run.subTab ?? "dough",
      defaultPepTypes,
    }),
  };
}

export function computeSharedServerCalc(payload, defaultPepTypes, nowTimeMs = Date.now()) {
  const run = selectCanonicalLiveRun(payload.dayState?.runs);
  if (!run) return null;
  return computeServerCalc(
    { ...payload, dayState: { ...payload.dayState, runs: [run], currentIndex: 0 } },
    defaultPepTypes,
    nowTimeMs
  );
}
