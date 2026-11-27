// Ported verbatim from v1 lib/live-calc/src/linePhases.ts — the 3-phase line
// fill/drain timer. Models the three physically distinct segments and their
// stop/start propagation delays. Total Freeze tunnel line time (freezerTime)
// is unchanged; this overlays the phase display without altering case counts.
//
// Pause/resume propagation: the pause record stores the operator's stop-tunnel
// decision. Safe policy: frontline drains, tunnel stops, packaging drains.
// Keep-tunnel-running: all three stages drain in normal sequence.

import { resolveLineTiming } from "./station-line-timing.mjs";
import { computeLineSections } from "./station-line-sections.mjs";

export function linePhaseRows(phases) {
  return phases.sections ? Object.values(phases.sections) : [phases.stage1, phases.stage2, phases.stage3];
}

/** True while any modeled line segment still contains product. */
export function lineHasProduct(phases) {
  return linePhaseRows(phases).some((phase) => phase.state !== "empty");
}

/** True only while product is actively leaving one of the modeled stages. */
export function lineHasPackagingDrain(phases) {
  return linePhaseRows(phases).some((phase) => phase.state === "draining");
}

function isEndedRunWithProduct({ runStatus, endedAt, elapsedBatchSec }) {
  return runStatus === "ended" && endedAt != null && Number.isFinite(endedAt) && elapsedBatchSec > 0;
}

/** True once an ended run's Press/Oven/Frontline segment has drained.
 *  Rejects runs ended before any production occurred. */
export function isFrontlineDrainComplete(args) {
  return (
    isEndedRunWithProduct(args) &&
    (args.phases.sections
      ? args.phases.sections.pressOven.state === "empty" &&
        args.phases.sections.frontline.state === "empty"
      : args.phases.stage1.state === "empty")
  );
}

export function isPressOvenDrainComplete(args) {
  return (
    isEndedRunWithProduct(args) &&
    (args.phases.sections?.pressOven ?? args.phases.stage1).state === "empty"
  );
}

/** True only after an ended run's complete line has drained through Wrapper /
 *  Packaging. Every phase must be empty so Packaging can't advance early. */
export function isPackagingDrainComplete(args) {
  return (
    isEndedRunWithProduct(args) &&
    linePhaseRows(args.phases).every((phase) => phase.state === "empty")
  );
}

export function computeLinePhases(args) {
  const timing = resolveLineTiming(args);
  return {
    ...computeLegacyLinePhases({
      ...args,
      preTunnelMin: timing.preTunnelMin,
      postTunnelMin: timing.postTunnelMin,
      freezerTime: timing.totalMin,
    }),
    sections: computeLineSections(args),
  };
}

function computeLegacyLinePhases(args) {
  const {
    elapsedBatchSec,
    pausedAt,
    lastResumeWallMs,
    lastPauseStartWallMs,
    pauseStopsTunnel = true,
    lastPauseStopsTunnel = true,
    runStatus,
    freezerTime,
    nowMs,
    endedAt,
  } = args;

  // Safe normalization: if the two outer stages claim more time than the total
  // line, scale them proportionally so they fit — the tunnel gets what remains
  // (possibly zero).
  let preTunnelMin = args.preTunnelMin;
  let postTunnelMin = args.postTunnelMin;
  if (freezerTime > 0 && preTunnelMin + postTunnelMin > freezerTime) {
    const total = preTunnelMin + postTunnelMin;
    preTunnelMin = (preTunnelMin / total) * freezerTime;
    postTunnelMin = (postTunnelMin / total) * freezerTime;
  }

  const tunnelMin = Math.max(0, freezerTime - preTunnelMin - postTunnelMin);
  const elapsedMin = elapsedBatchSec / 60;

  const S1 = "Press · Oven · Frontline";
  const S2 = "Freeze tunnel";
  const S3 = "Wrapper · Packaging";

  const mk = (label, state, remainMs = 0) => ({ label, state, remainMs });
  const emptyPhases = () => ({
    stage1: mk(S1, "empty"),
    stage2: mk(S2, "empty"),
    stage3: mk(S3, "empty"),
  });

  // The line physically contains product in more than one stage during a drain,
  // but the operator-facing countdown is intentionally sequential: frontline,
  // then tunnel, then packaging. Keep the same total drain duration and only
  // expose the stage whose own window is currently active.
  const sequentialDrain = (totalRemainingMin) => {
    const remaining = Math.max(0, totalRemainingMin);
    const stage1Remaining = Math.max(0, remaining - tunnelMin - postTunnelMin);
    if (preTunnelMin > 0 && stage1Remaining > 0) {
      return {
        stage1: mk(S1, "draining", stage1Remaining * 60000),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "empty"),
      };
    }
    const stage2Remaining = Math.max(0, remaining - postTunnelMin);
    if (tunnelMin > 0 && stage2Remaining > 0) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "draining", stage2Remaining * 60000),
        stage3: mk(S3, "empty"),
      };
    }
    if (postTunnelMin > 0 && remaining > 0) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "draining", remaining * 60000),
      };
    }
    return emptyPhases();
  };

  // ── Ended run: wall-clock drain from endedAt ─────────────────────────────
  if (runStatus === "ended" && endedAt && freezerTime > 0) {
    // Product in Stage 1 always propagates through ALL downstream stages. The
    // line is not clear until the configured Freeze tunnel time has elapsed
    // from the press stopping. Only exception: no product was ever pressed.
    if (elapsedMin <= 0) {
      return emptyPhases();
    }
    const elapsed = nowMs - endedAt;
    return sequentialDrain(freezerTime - elapsed / 60000);
  }

  // ── Paused run: persisted-policy staged drain ─────────────────────────────
  if (runStatus === "paused" && pausedAt != null) {
    if (elapsedMin <= 0) {
      return emptyPhases();
    }
    const pauseElapsedMin = Math.max(0, nowMs - pausedAt) / 60000;
    if (!pauseStopsTunnel) {
      // Tunnel remains powered: the whole line clears in its normal order.
      return sequentialDrain(freezerTime - pauseElapsedMin);
    }
    // Safe policy: frontline drains before the tunnel is stopped.
    if (preTunnelMin > 0 && pauseElapsedMin < preTunnelMin) {
      return {
        stage1: mk(S1, "draining", (preTunnelMin - pauseElapsedMin) * 60000),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "empty"),
      };
    }
    const wrapperElapsedMin = Math.max(0, pauseElapsedMin - preTunnelMin);
    if (postTunnelMin > 0 && wrapperElapsedMin < postTunnelMin) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "paused"),
        stage3: mk(S3, "draining", (postTunnelMin - wrapperElapsedMin) * 60000),
      };
    }
    return {
      stage1: mk(S1, "empty"),
      stage2: mk(S2, "paused"),
      stage3: mk(S3, "empty"),
    };
  }

  // ── Running, filling / steady state ──────────────────────────────────────
  if (runStatus === "running") {
    if (elapsedMin === 0) {
      return {
        stage1: mk(S1, "empty"),
        stage2: mk(S2, "empty"),
        stage3: mk(S3, "empty"),
      };
    }

    const lastPauseDurationMs =
      lastResumeWallMs > 0 && lastPauseStartWallMs > 0
        ? Math.max(0, lastResumeWallMs - lastPauseStartWallMs)
        : 0;

    const tunnelWasStopped =
      lastPauseStopsTunnel && lastPauseDurationMs >= preTunnelMin * 60000;
    const refillDrainedLine = !lastPauseStopsTunnel && lastResumeWallMs > 0;
    const resumedElapsedMin =
      lastResumeWallMs > 0 ? Math.max(0, nowMs - lastResumeWallMs) / 60000 : 0;

    if (refillDrainedLine && resumedElapsedMin < freezerTime) {
      if (resumedElapsedMin < preTunnelMin) {
        return {
          stage1: mk(S1, "resuming", (preTunnelMin - resumedElapsedMin) * 60000),
          stage2: mk(S2, "empty"),
          stage3: mk(S3, "empty"),
        };
      }
      if (resumedElapsedMin < preTunnelMin + tunnelMin) {
        return {
          stage1: mk(S1, "active"),
          stage2: mk(S2, "resuming", (preTunnelMin + tunnelMin - resumedElapsedMin) * 60000),
          stage3: mk(S3, "empty"),
        };
      }
      return {
        stage1: mk(S1, "active"),
        stage2: mk(S2, "active"),
        stage3: mk(S3, "resuming", (freezerTime - resumedElapsedMin) * 60000),
      };
    }

    if (tunnelWasStopped && lastResumeWallMs > 0) {
      const packagingResumeMin = preTunnelMin + postTunnelMin;
      if (resumedElapsedMin < preTunnelMin) {
        return {
          stage1: mk(S1, "resuming", (preTunnelMin - resumedElapsedMin) * 60000),
          stage2: mk(S2, "paused"),
          stage3: mk(S3, "empty"),
        };
      }
      if (resumedElapsedMin < packagingResumeMin) {
        return {
          stage1: mk(S1, "active"),
          stage2: mk(S2, "active"),
          stage3: mk(S3, "resuming", (packagingResumeMin - resumedElapsedMin) * 60000),
        };
      }
    }

    // Stage 1: fills over the first preTunnelMin of virtual (pause-excluded) time.
    let s1;
    if (elapsedMin < preTunnelMin) {
      s1 = mk(S1, "filling", (preTunnelMin - elapsedMin) * 60000);
    } else {
      s1 = mk(S1, "active");
    }

    // Stage 2: fills over the next tunnelMin of virtual time.
    let s2;
    if (elapsedMin < preTunnelMin) {
      s2 = mk(S2, "empty");
    } else if (elapsedMin < preTunnelMin + tunnelMin) {
      s2 = mk(S2, "filling", (preTunnelMin + tunnelMin - elapsedMin) * 60000);
    } else {
      s2 = mk(S2, "active");
    }

    // Stage 3: fills over the final postTunnelMin of virtual time.
    let s3;
    if (elapsedMin < preTunnelMin + tunnelMin) {
      s3 = mk(S3, "empty");
    } else if (elapsedMin < freezerTime) {
      s3 = mk(S3, "filling", (freezerTime - elapsedMin) * 60000);
    } else {
      s3 = mk(S3, "active");
    }

    return { stage1: s1, stage2: s2, stage3: s3 };
  }

  // Fallback (not-started, unknown status): all empty.
  return {
    stage1: mk(S1, "empty"),
    stage2: mk(S2, "empty"),
    stage3: mk(S3, "empty"),
  };
}

/** Wall-clock seconds during which product has been eligible to exit the line
 *  after a pause. Deliberately not the raw pause duration: with a powered
 *  tunnel product drains continuously; with safe stop-tunnel the stopped
 *  interval must not become packaging output when Stage 3 resumes. */
export function computePackagingDrainElapsedSec(args) {
  if (args.runStatus !== "paused" || args.pausedAt == null || args.elapsedBatchSec <= 0) {
    return 0;
  }
  let { preTunnelMin, postTunnelMin, totalMin: freezerTime } = resolveLineTiming(args);
  if (!Number.isFinite(preTunnelMin) || !Number.isFinite(postTunnelMin) || !Number.isFinite(freezerTime)) {
    return 0;
  }
  preTunnelMin = Math.max(0, preTunnelMin);
  postTunnelMin = Math.max(0, postTunnelMin);
  if (freezerTime > 0 && preTunnelMin + postTunnelMin > freezerTime) {
    const total = preTunnelMin + postTunnelMin;
    preTunnelMin = (preTunnelMin / total) * freezerTime;
    postTunnelMin = (postTunnelMin / total) * freezerTime;
  }
  const elapsedMin = Math.max(0, (args.nowMs - args.pausedAt) / 60000);
  if (args.pauseStopsTunnel === false) {
    return Math.min(elapsedMin, Math.max(0, freezerTime)) * 60;
  }
  const stage1DrainMin = Math.min(elapsedMin, preTunnelMin);
  const stage3DrainMin = Math.min(Math.max(0, elapsedMin - preTunnelMin), postTunnelMin);
  return (stage1DrainMin + stage3DrainMin) * 60;
}

/** Pause-excluded virtual elapsed seconds for an ended run. Closed pauses are
 *  already excluded by the resume lifecycle shifting startedAt; only an
 *  auto-end-while-paused open pause (capped at endedAt) is subtracted. */
export function computeEndedRunElapsedSec(run) {
  if (!run.startedAt) return 0;
  const totalMs = run.endedAt - run.startedAt;
  const openPausedMs = (run.stoppages ?? [])
    .filter((s) => s.type === "pause" && s.startedAt != null && s.endedAt == null)
    .reduce((sum, s) => {
      const pauseStart = Math.min(s.startedAt, run.endedAt);
      return sum + Math.max(0, run.endedAt - pauseStart);
    }, 0);
  return Math.max(0, totalMs - openPausedMs) / 1000;
}

/** Single most-informative phase for the compact strip badge: active
 *  transitions with the nearest deadline first, then transitions, then paused. */
export function pickMostActivePhase(phases) {
  const rows = linePhaseRows(phases);
  const withCountdown = rows.filter(
    (r) =>
      (r.state === "filling" || r.state === "draining" || r.state === "resuming") &&
      r.remainMs > 0
  );
  if (withCountdown.length > 0) {
    return withCountdown.reduce((best, r) => (r.remainMs < best.remainMs ? r : best));
  }
  const anyTransition = rows.find(
    (r) => r.state === "filling" || r.state === "draining" || r.state === "resuming"
  );
  if (anyTransition) return anyTransition;
  return rows.find((r) => r.state === "paused");
}
