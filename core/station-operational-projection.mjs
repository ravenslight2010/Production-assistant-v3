// Adapted from v1 lib/live-calc/src/operationalProjection.ts. The live
// station read model, built server-side from one run's values + progress +
// schedule. Deliberately includes both immutable facts and display
// derivations: clients may animate from serverTimeMs, but only this model
// is allowed to authorize automatic writes.
//
// Adaptation from v1: v1 received a precomputed computeServerCalc result;
// here the projection computes the calc itself via the ported computeCalc,
// keeping one calculator as the source of truth.

import { computeAutoTrackElapsedMs } from "./station-autotrack-schedule.mjs";
import { applyTemporaryOverrides, computeCalc } from "./station-live-calc.mjs";
import { computeLinePhases } from "./station-line-phases.mjs";

export const OPERATIONAL_PROJECTION_VERSION = 1;
export const PRE_POST_TUNNEL_DEFAULT_MIN = 2.5;

export const STATION_ACTIVITY_IDS = [
  "dough", "sauce", "press", "frontline", "freezeTunnel", "packaging", "warehouse",
];

function runStatus(run) {
  if (run.endedAt) return "ended";
  if (run.pausedAt) return "paused";
  if (run.startedAt) return "running";
  return "pending";
}

function number(value) {
  return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * Build the live station projection. Identity check: the run, its calc, and
 * the schedule must all share the same lifecycle generation.
 */
export function buildOperationalProjection(args) {
  const run = args.runs.find((entry) => entry.id === args.runId);
  const generation = `${args.runId}:${run?.metaUpdatedAt ?? run?.startedAt ?? 0}`;
  if (!run || args.schedule.runId !== run.id || args.schedule.generation !== generation) {
    throw new Error("Operational projection requires matching run, calculation, and schedule identities");
  }
  const raw = args.runValues?.[args.runId] ?? {};
  const progress = args.progress ?? {};
  const merged = { ...raw, ...progress };
  const v = applyTemporaryOverrides(merged);
  const calc = computeCalc({
    v: merged,
    ve: v,
    currentRun: run,
    nowTimeMs: args.nowMs,
    doughSubTab: run.subTab ?? "dough",
    defaultPepTypes: args.defaultPepTypes ?? [],
  });
  const effectiveNowMs = run.pausedAt ?? run.endedAt ?? args.nowMs;
  const effectiveElapsedSec = computeAutoTrackElapsedMs({
    startedAt: run.startedAt,
    pausedAt: effectiveNowMs,
    nowMs: effectiveNowMs,
    stoppages: run.stoppages,
  }) / 1000;
  const freezerTotalSec = Math.max(0, number(v.freezerTime) * 60);
  const calcTimePerBatch = calc.timePerBatchSec;
  const nextBatchInSec = calcTimePerBatch > 0
    ? Math.max(0, calcTimePerBatch - (effectiveElapsedSec % calcTimePerBatch))
    : 0;
  const currentBatchNum = calcTimePerBatch > 0
    ? Math.floor(effectiveElapsedSec / calcTimePerBatch)
    : 0;
  const secUntilNextBatch = calcTimePerBatch > 0
    ? calcTimePerBatch - (effectiveElapsedSec % calcTimePerBatch)
    : 0;
  const totalBatchesNeeded = calcTimePerBatch > 0 && calc.totalTimeSec > 0
    ? Math.ceil(calc.totalTimeSec / calcTimePerBatch)
    : 0;
  const pauseRecords = (run.stoppages ?? []).filter((s) => s.type === "pause");
  const openPause = pauseRecords
    .filter((s) => !s.endedAt)
    .reduce((latest, s) => (!latest || s.startedAt > latest.startedAt ? s : latest), undefined);
  const lastClosedPause = pauseRecords
    .filter((s) => !!s.endedAt)
    .reduce((latest, s) => (!latest || (s.endedAt ?? 0) > (latest.endedAt ?? 0) ? s : latest), undefined);
  const linePhases = computeLinePhases({
    elapsedBatchSec: effectiveElapsedSec,
    pausedAt: run.pausedAt,
    lastResumeWallMs: lastClosedPause?.endedAt ?? 0,
    lastPauseStartWallMs: lastClosedPause?.startedAt ?? 0,
    pauseStopsTunnel: openPause?.stopTunnel !== false,
    lastPauseStopsTunnel: lastClosedPause?.stopTunnel !== false,
    runStatus: runStatus(run),
    pressOvenMin: typeof v.pressOvenMin === "number" ? v.pressOvenMin : undefined,
    frontlineMin: typeof v.frontlineMin === "number" ? v.frontlineMin : undefined,
    preTunnelMin: typeof v.preTunnelMin === "number" ? v.preTunnelMin : PRE_POST_TUNNEL_DEFAULT_MIN,
    postTunnelMin: typeof v.postTunnelMin === "number" ? v.postTunnelMin : PRE_POST_TUNNEL_DEFAULT_MIN,
    freezerTime: Math.max(0, number(v.freezerTime)),
    nowMs: args.nowMs,
    endedAt: run.endedAt,
  });

  return {
    version: OPERATIONAL_PROJECTION_VERSION,
    runId: args.runId,
    lifecycleGeneration: generation,
    serverTimeMs: args.nowMs,
    capturedAtServerMs: args.nowMs,
    calculationRevision: args.calculationRevision ?? 0,
    effectiveElapsedSec,
    stationActivity: args.stationActivity ?? null,
    linePhases,
    timers: {
      nextBatchInSec,
      pressRemainingSec: Math.max(0, calc.adjustedTimeSec - effectiveElapsedSec),
      freezerElapsedSec: Math.min(effectiveElapsedSec, freezerTotalSec),
      freezerRemainingSec: Math.max(0, freezerTotalSec - effectiveElapsedSec),
      currentBatchNum,
      secUntilNextBatch,
      totalBatchesNeeded,
    },
    counters: {
      casesCompleted: calc.casesCompleted,
      casesInFreezer: calc.casesInFreezer,
      casesOnLine: calc.casesOnLine,
      casesLeftToRun: calc.casesLeftToRun,
      pressCasesLeft: calc.pressCasesLeft,
      traysOnLine: number(v.traysOnLine),
      batchesReady: number(v.batchesReady),
      sauceBarrelsMade: number(v.sauceBarrelsMade),
      app1BatchesMade: number(v.app1BatchesMade),
      app2BatchesMade: number(v.app2BatchesMade),
      app3BatchesMade: number(v.app3BatchesMade),
      app4BatchesMade: number(v.app4BatchesMade),
    },
    facts: {
      runStatus: runStatus(run),
      pressDone: calc.pressDone,
      paceStatus: calc.paceStatus,
      paceDelta: calc.paceDelta,
    },
    calc,
    due: args.schedule,
  };
}
