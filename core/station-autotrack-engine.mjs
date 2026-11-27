// Ported verbatim from v1 lib/live-calc/src/autoTrackEngine.ts — auto-track
// timing, suggestions, slot info, and the deterministic tick/write-decision
// functions the wall-clock engine and claim executors share.

import { knownFrontlineBatchWeight } from "./station-staged-supply.mjs";

export function suggestedDoughStaging(traysNeeded, batchesNeeded) {
  return {
    trays: traysNeeded > 0 ? Math.max(1, Math.round(Math.min(40, traysNeeded))) : null,
    batches: batchesNeeded > 0 ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, batchesNeeded)))) : null,
  };
}

export function clampWebPeriodMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 60 * 60 * 1000;
  return Math.min(60 * 60 * 1000, Math.max(1000, ms));
}

export function getAutoTrackTiming(ppm, pizzasPerCase, perTray, perBatch, machine) {
  const caseMs = ppm > 0 && pizzasPerCase > 0 ? clampWebPeriodMs(pizzasPerCase / ppm * 60000) : 0;
  const trayMs = ppm > 0 && perTray > 0 ? clampWebPeriodMs(perTray / ppm * 60000) : 0;
  const lineBatchMs = ppm > 0 && perBatch > 0 ? perBatch / ppm * 60000 : 0;
  const hopperMs = machine && Number.isFinite(machine.hopperSec) && machine.hopperSec > 0
    ? clampWebPeriodMs(machine.hopperSec * 1000) : 0;
  const effectiveDrainMs = Math.max(hopperMs, lineBatchMs);
  const spinMs = machine && Number.isFinite(machine.spinSec) && machine.spinSec > 0
    ? machine.spinSec * 1000 : 0;
  return {
    caseMs,
    trayMs,
    trayProductionMs: trayMs > 0 ? trayMs / 2 : 0,
    batchConsumptionMs: effectiveDrainMs > 0 ? clampWebPeriodMs(effectiveDrainMs / 4) : 0,
    batchProductionMs: spinMs > 0 ? clampWebPeriodMs(spinMs) :
      lineBatchMs > 0 ? clampWebPeriodMs(lineBatchMs) : 0,
    hopperMs,
  };
}

export function computeAutoTrackSuggestion(input) {
  if (
    !["running", "paused"].includes(input.runStatus) && !input.drainActive ||
    input.ppm <= 0 || input.casesPerSkid <= 0 || input.pizzasPerCase <= 0
  ) return null;
  const elapsedAfterTunnelMin = Math.max(0, input.elapsedBatchSec / 60 - input.freezerTime);
  const expectedCasesRaw = input.packagingDrainActive
    ? Math.floor(Math.max(0, input.packagingDrainElapsedSec) * input.ppm / (input.pizzasPerCase * 60))
    : Math.floor(elapsedAfterTunnelMin * input.ppm / input.pizzasPerCase);
  const expectedCases = input.casesNeeded > 0
    ? Math.min(input.casesNeeded, expectedCasesRaw) : expectedCasesRaw;
  return {
    skids: Math.min(Math.floor(input.casesNeeded / input.casesPerSkid), Math.floor(expectedCases / input.casesPerSkid)),
    casesOnSkid: Math.min(input.casesPerSkid, expectedCases % input.casesPerSkid),
    expectedCases, expectedCasesRaw, trays: null, batches: null,
  };
}

export function computeAppSlotInfo(input) {
  const recipeLbs = (input.recipe ?? []).reduce((sum, row) => sum + (Number(row.lbs) || 0), 0);
  const configuredBatchLbs = recipeLbs > 0 ? recipeLbs : input.batchLbs;
  // A missing or invalid weight cannot support a truthful batch count.
  const effectiveBatchLbs = knownFrontlineBatchWeight(configuredBatchLbs) ?? 0;
  const type = String(input.type).trim();
  const productionPizzas = input.casesNeeded > 0 && input.pizzasPerCase > 0
    ? input.casesNeeded * input.pizzasPerCase
    : 0;
  // Auto-track completion is a lifetime run cap. The normal calculator's
  // applicator requirement is intentionally a remaining-work value and shrinks
  // as Packaging advances, so it cannot safely cap a cumulative "made" count.
  const required = effectiveBatchLbs > 0 && input.ozPerPizza > 0 && productionPizzas > 0
    ? (productionPizzas * input.ozPerPizza / 16 + 20) / effectiveBatchLbs
    : 0;
  return {
    recipeLbs,
    effectiveBatchLbs,
    required,
    cadence: effectiveBatchLbs > 0 && input.ozPerPizza > 0 && input.ppm > 0
      ? effectiveBatchLbs * 16 / input.ozPerPizza / input.ppm * 60 : 0,
    validForClaim: !!type && !type.toLowerCase().includes("mix") &&
      input.ozPerPizza > 0 && required > 0 && input.ppm > 0,
  };
}

export function computeNetSecondDue(input) {
  return input.currentDue > 0 ? input.currentDue : input.anchor + input.cadence;
}

export function buildCaseClaimMutations(input) {
  return [
    { field: "skidsCompleted", from: input.skidsFrom, to: input.skidsTo },
    { field: "casesOnCurrentSkid", from: input.casesFrom, to: input.casesTo },
  ];
}

export function buildSauceClaimMutations(input) {
  return [
    { field: "sauceBarrelsMade", from: input.countFrom, to: input.countTo },
    { field: "sauceBarrelAnchorNetSec", from: input.anchorFrom, to: input.anchorTo },
    {
      field: "sauceBarrelCorrectionGeneration",
      from: input.correctionGeneration,
      to: input.correctionGeneration,
    },
  ];
}

export function buildAppSlotClaimMutations(input) {
  return [
    { field: `${input.slot}BatchesMade`, from: input.madeFrom, to: input.madeTo },
    { field: `${input.slot}BatchAnchorNetSec`, from: input.anchorFrom, to: input.anchorTo },
    {
      field: `${input.slot}BatchCorrectionGeneration`,
      from: input.correctionGeneration,
      to: input.correctionGeneration,
    },
  ];
}

export function computeCaseTickWrite(input) {
  const cps = input.casesPerSkid;
  if (input.drainActive || input.packagingDrainActive) {
    const exited = input.packagingDrainActive
      ? (input.prevExpected >= 0 ? Math.max(0, input.expectedRaw - input.prevExpected) : 0)
      : (input.prevFreezer >= 0 ? Math.max(0, input.prevFreezer - input.nextFreezer) : 0);
    const target = input.curTotal + exited;
    const newTotal = input.casesNeeded > 0
      ? Math.min(target, Math.max(input.curTotal, input.casesNeeded)) : target;
    return {
      action: newTotal !== input.curTotal ? "write" : "none",
      newTotal,
      caseClaimRetryReset: false,
      formResetSkippedNew: input.formResetSkipped,
    };
  }
  if (input.prevExpected < 0) {
    if ((input.curTotal === 0 || input.caseClaimRetry) && input.expectedCases > input.curTotal) {
      return {
        action: "seed",
        newTotal: input.casesNeeded > 0 ? Math.min(input.casesNeeded, input.expectedCases) : input.expectedCases,
        caseClaimRetryReset: true,
        formResetSkippedNew: input.formResetSkipped,
      };
    }
    return {
      action: "none", newTotal: input.curTotal, caseClaimRetryReset: false,
      formResetSkippedNew: input.formResetSkipped,
    };
  }
  const deltaCases = Math.floor(Math.max(0, input.expectedRaw - input.prevExpected));
  if (deltaCases > 0) {
    if (!input.formResetSkipped && input.curTotal === 0 && input.prevExpected > cps) {
      return {
        action: "reset-skip", newTotal: input.curTotal,
        caseClaimRetryReset: false, formResetSkippedNew: true,
      };
    }
    const target = input.curTotal + deltaCases;
    const newTotal = input.casesNeeded > 0
      ? Math.min(target, Math.max(input.curTotal, input.casesNeeded)) : target;
    return {
      action: newTotal !== input.curTotal ? "write" : "none",
      newTotal, caseClaimRetryReset: false, formResetSkippedNew: false,
    };
  }
  return {
    action: "none", newTotal: input.curTotal,
    caseClaimRetryReset: false, formResetSkippedNew: false,
  };
}

export function computeTrayTick(input) {
  let prodDueMsNew = input.prodDueMs;
  let consDueMsNew = input.consDueMs;
  let lastMsNew = input.lastMs;
  let delta = 0;
  let remainderNew = input.remainder;
  let seededNew = input.seeded;
  let seed = null;
  if (prodDueMsNew === 0) {
    prodDueMsNew = input.nowMs + input.periodMs / 2;
  } else if (input.nowMs >= prodDueMsNew) {
    prodDueMsNew = input.nowMs + input.periodMs;
    if (!input.suppressed && !input.productionSuppressed && !input.feedComplete && input.deficitOpen) delta += 1;
  }
  if (input.nowMs >= consDueMsNew) {
    const durationMin = lastMsNew > 0
      ? Math.min((input.periodMs * 2) / 60000, (input.nowMs - lastMsNew) / 60000)
      : input.periodMs / 60000;
    consDueMsNew = input.nowMs + input.periodMs;
    lastMsNew = input.nowMs;
    if (!input.suppressed && !input.consumptionSuppressed && !input.feedComplete) {
      if (!seededNew) {
        seededNew = true;
        if (input.current === 0 && input.seed !== null) seed = { from: input.current, to: input.seed };
      }
      if (seed === null) {
        const traysExact = durationMin * input.ppm / input.perTray + remainderNew;
        const traysConsumed = Math.floor(traysExact);
        remainderNew = traysExact - traysConsumed;
        delta -= traysConsumed;
      }
    }
  }
  return { prodDueMsNew, consDueMsNew, lastMsNew, delta, remainderNew, seededNew, seed };
}

export function computeBatchTick(input) {
  let prodDueMsNew = input.prodDueMs;
  let consDueMsNew = input.consDueMs;
  let lastMsNew = input.lastMs;
  let delta = 0;
  let seededNew = input.seeded;
  let seed = null;
  if (prodDueMsNew === 0) {
    prodDueMsNew = input.nowMs + input.fullBatchMs;
  } else if (input.nowMs >= prodDueMsNew) {
    prodDueMsNew = input.nowMs + input.fullBatchMs;
    if (!input.suppressed && !input.productionSuppressed && !input.feedComplete && input.deficitOpen) delta += 1;
  }
  if (input.nowMs >= consDueMsNew) {
    const durationMin = lastMsNew > 0
      ? Math.min((input.periodMs * 2) / 60000, (input.nowMs - lastMsNew) / 60000)
      : input.periodMs / 60000;
    consDueMsNew = input.nowMs + input.periodMs;
    lastMsNew = input.nowMs;
    if (!input.suppressed && !input.consumptionSuppressed && !input.feedComplete) {
      if (!seededNew) {
        seededNew = true;
        const remainingBatchesNeeded = input.traysSeededAmount > 0 && input.traysNeeded > 0
          ? Math.max(0, input.batchesNeeded * (input.traysNeeded - input.traysSeededAmount) / input.traysNeeded)
          : input.batchesNeeded;
        const seedValue = remainingBatchesNeeded > 0
          ? Math.min(3, Math.max(1, Math.ceil(Math.min(3, remainingBatchesNeeded)))) : null;
        if (input.current === 0 && seedValue !== null) seed = { from: input.current, to: seedValue };
      }
      if (seed === null) delta -= durationMin * 60000 / input.effDrainMs;
    }
  }
  return { prodDueMsNew, consDueMsNew, lastMsNew, delta, seededNew, seed };
}
