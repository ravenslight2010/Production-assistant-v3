// Ported from v1 lib/live-calc/src/operationalRunView.ts. The server-safe
// operational view for ONE run, derived from a complete versioned sync
// snapshot without mutating it. The view is the audit surface: observed
// facts, recap, elapsed/phase, pace, advisory, freshness, and formula
// provenance — everything a station tab renders, nothing it recomputes.
//
// Adaptation from v1: instead of computeServerCalc over a dayState-indexed
// payload, the view computes calc directly via the ported computeCalc for
// the selected run. The snapshot shape (dayState/runs + runValues +
// packagingProgress + syncVersion/completeness) is kept verbatim so the
// v3 snapshot transport can feed it unchanged.

import { applyTemporaryOverrides, computeCalc } from "./station-live-calc.mjs";
import { computeEndedRunElapsedSec, computeLinePhases } from "./station-line-phases.mjs";
import { FACTORY_TIMING_DEFAULTS } from "./station-line-timing.mjs";

export class OperationalRunViewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OperationalRunViewError";
    this.code = code;
  }
}

function finiteTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function runStatus(run) {
  if (finiteTimestamp(run.endedAt)) return "ended";
  if (finiteTimestamp(run.pausedAt)) return "paused";
  if (finiteTimestamp(run.startedAt)) return "running";
  return "not-started";
}

function elapsedBatchSec(run, nowMs) {
  if (!finiteTimestamp(run.startedAt)) return 0;
  if (finiteTimestamp(run.endedAt)) {
    return computeEndedRunElapsedSec({
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      stoppages: run.stoppages ?? [],
    });
  }
  const reference = finiteTimestamp(run.pausedAt) ? run.pausedAt : nowMs;
  const nonPauseDowntime = (run.stoppages ?? [])
    .filter((item) => item.type !== "pause" && finiteTimestamp(item.endedAt))
    .reduce((sum, item) => sum + Math.max(0, item.endedAt - item.startedAt), 0);
  return Math.max(0, reference - run.startedAt - nonPauseDowntime) / 1000;
}

/** Derives a server-safe operational view without mutating the sync snapshot. */
export function deriveOperationalRunView(args) {
  const { snapshot, date, runId, nowMs, snapshotMetadata } = args;
  if (!snapshot || snapshot.syncVersion !== 1 || snapshot.completeness !== "complete"
    || !snapshot.dayState || !Array.isArray(snapshot.dayState.runs)) {
    throw new OperationalRunViewError("invalid-snapshot", "A complete v1 sync snapshot is required.");
  }
  if (!date || !runId || !finiteTimestamp(nowMs) || !snapshotMetadata?.snapshotId
    || !finiteTimestamp(snapshotMetadata.capturedAt)) {
    throw new OperationalRunViewError("invalid-snapshot", "date, runId, nowMs, and snapshot metadata are required.");
  }
  const state = snapshot.dayState;
  if ((state.date && state.date !== date) || (snapshotMetadata.date && snapshotMetadata.date !== date)
    || (finiteTimestamp(state.resetAt) && finiteTimestamp(snapshotMetadata.resetAt)
      && state.resetAt !== snapshotMetadata.resetAt)) {
    throw new OperationalRunViewError("reset-mismatch", "Snapshot date or reset generation does not match the request.");
  }
  const matches = state.runs.filter((run) => run.id === runId);
  if (matches.length === 0) throw new OperationalRunViewError("missing-run", `Run "${runId}" is absent from the snapshot.`);
  if (matches.length > 1) throw new OperationalRunViewError("duplicate-run", `Run "${runId}" occurs more than once.`);
  const run = matches[0];
  if (!run.id || (run.startedAt !== undefined && !finiteTimestamp(run.startedAt))
    || (run.pausedAt !== undefined && !finiteTimestamp(run.pausedAt))
    || (run.endedAt !== undefined && !finiteTimestamp(run.endedAt))
    || (finiteTimestamp(run.startedAt) && finiteTimestamp(run.endedAt) && run.endedAt < run.startedAt)
    || !snapshot.runValues?.[runId] || typeof snapshot.runValues[runId] !== "object") {
    throw new OperationalRunViewError("invalid-run", `Run "${runId}" has invalid lifecycle or values.`);
  }

  const raw = snapshot.runValues[runId];
  const progress = snapshot.packagingProgress?.[runId];
  const merged = { ...raw, ...(progress ?? {}) };
  const effective = applyTemporaryOverrides(merged);
  const calc = computeCalc({
    v: merged,
    ve: effective,
    currentRun: run,
    nowTimeMs: nowMs,
    doughSubTab: run.subTab ?? "dough",
    defaultPepTypes: args.defaultPepTypes ?? [],
  });
  const latestPause = [...(run.stoppages ?? [])].filter((s) => s.type === "pause")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const latestClosedPause = [...(run.stoppages ?? [])].filter((s) => s.type === "pause" && finiteTimestamp(s.endedAt))
    .sort((a, b) => b.endedAt - a.endedAt)[0];
  const status = runStatus(run);
  const elapsed = elapsedBatchSec(run, nowMs);
  const stoppages = run.stoppages ?? [];
  const downtimeSeconds = stoppages.reduce((sum, item) =>
    item.type === "pause" || !finiteTimestamp(item.endedAt)
      ? sum
      : sum + Math.max(0, item.endedAt - item.startedAt), 0);
  const phase = computeLinePhases({
    elapsedBatchSec: elapsed,
    pausedAt: run.pausedAt,
    lastResumeWallMs: latestClosedPause?.endedAt ?? 0,
    lastPauseStartWallMs: latestClosedPause?.startedAt ?? 0,
    pauseStopsTunnel: latestPause?.stopTunnel,
    lastPauseStopsTunnel: latestClosedPause?.stopTunnel,
    pressOvenMin: typeof effective.pressOvenMin === "number" ? effective.pressOvenMin : undefined,
    frontlineMin: typeof effective.frontlineMin === "number" ? effective.frontlineMin : undefined,
    preTunnelMin: typeof effective.preTunnelMin === "number" ? effective.preTunnelMin : FACTORY_TIMING_DEFAULTS.preTunnelMin,
    postTunnelMin: typeof effective.postTunnelMin === "number" ? effective.postTunnelMin : FACTORY_TIMING_DEFAULTS.postTunnelMin,
    freezerTime: Number(effective.freezerTime) || 0,
    nowMs,
    endedAt: run.endedAt,
    runStatus: status,
  });
  const ageMs = Math.max(0, nowMs - snapshotMetadata.capturedAt);
  const maxAgeMs = snapshotMetadata.maxAgeMs ?? 60_000;
  const usedOverride = (name) => Number(raw[`temp${name}`]) > 0;
  return {
    version: 1,
    date,
    runId,
    observed: {
      brand: typeof run.brand === "string" ? run.brand : "",
      flavor: typeof run.flavor === "string" ? run.flavor : "",
      status,
      startedAt: run.startedAt,
      pausedAt: run.pausedAt,
      endedAt: run.endedAt,
      elapsedBatchSec: elapsed,
      substitutionsApplied: Array.isArray(state.substitutions) ? state.substitutions.length : 0,
      packagingProgress: progress
        ? { skidsCompleted: progress.skidsCompleted, casesOnCurrentSkid: progress.casesOnCurrentSkid }
        : null,
      temporaryOverrides: {
        freezerTime: usedOverride("FreezerTime"),
        crustsPerCycle: usedOverride("CrustsPerCycle"),
        cycleSpeed: usedOverride("CycleSpeed"),
      },
      stoppages: { count: stoppages.length, downtimeSeconds },
    },
    recap: {
      casesNeeded: Number(raw.casesNeeded) || 0,
      casesCompleted: calc.casesCompleted,
      casesLeftToRun: calc.casesLeftToRun,
      pressDone: calc.pressDone,
      extraCases: calc.extraCases,
    },
    elapsed: { batchSec: elapsed, phase },
    pace: {
      ppm: calc.ppm,
      paceStatus: calc.paceStatus,
      paceDelta: calc.paceDelta,
      catchUpPpm: calc.catchUpPpm,
    },
    advisory: {
      freezer: { cases: calc.casesInFreezer, configuredMinutes: Number(effective.freezerTime) || 0 },
      line: { cases: calc.casesOnLine },
    },
    calculatedAt: nowMs,
    freshness: {
      status: ageMs > maxAgeMs ? "stale" : "fresh",
      snapshotId: snapshotMetadata.snapshotId,
      capturedAt: snapshotMetadata.capturedAt,
      ageMs,
      maxAgeMs,
    },
    formulaProvenance: {
      policy: "operational-run-view",
      policyVersion: 1,
      calculator: "computeCalc",
      calculatorVersion: 1,
      temporaryOverrides: "applyTemporaryOverrides",
      inventory: ["computeCasesOnLine", "computeCasesInFreezer"],
      linePhases: "computeLinePhases",
      linePhasesVersion: 2,
    },
  };
}
