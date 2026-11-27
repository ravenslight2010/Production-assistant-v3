import test from "node:test";
import assert from "node:assert/strict";
import { lineThroughput, resolveLineTiming } from "./station-line-timing.mjs";
import {
  computeEndedRunElapsedSec,
  computeLinePhases,
  computePackagingDrainElapsedSec,
  isPackagingDrainComplete,
  lineHasProduct,
  pickMostActivePhase,
} from "./station-line-phases.mjs";

const NOW = 1_800_000_000_000;

test("resolveLineTiming: zero/unknown freezer keeps factory pre/post defaults", () => {
  const timing = resolveLineTiming({});
  assert.equal(timing.totalMin, 0);
  assert.equal(timing.pressOvenMin, 1.25);
  assert.equal(timing.frontlineMin, 1.25);
  assert.equal(timing.postTunnelMin, 2.5);
  assert.equal(timing.preTunnelMin, 2.5);
  assert.equal(timing.tunnelMin, 0);
  assert.equal(timing.compatibilityAllocation, true);
});

test("resolveLineTiming: outer sections scale down to fit the measured total", () => {
  const timing = resolveLineTiming({ freezerTime: 4 });
  assert.equal(timing.totalMin, 4);
  assert.equal(timing.pressOvenMin, 1);
  assert.equal(timing.frontlineMin, 1);
  assert.equal(timing.postTunnelMin, 2);
  assert.equal(timing.tunnelMin, 0);
});

test("resolveLineTiming: explicit split controls the window, tunnel gets the remainder", () => {
  const timing = resolveLineTiming({ freezerTime: 20, pressOvenMin: 3, frontlineMin: 5, postTunnelMin: 2 });
  assert.equal(timing.preTunnelMin, 8);
  assert.equal(timing.tunnelMin, 10);
  assert.equal(timing.compatibilityAllocation, false);
});

test("resolveLineTiming: partial split allocates the unassigned legacy half", () => {
  const timing = resolveLineTiming({ freezerTime: 20, frontlineMin: 6 });
  assert.equal(timing.pressOvenMin, 0);
  assert.equal(timing.frontlineMin, 6);
  assert.equal(timing.tunnelMin, 11.5);
  assert.equal(timing.compatibilityAllocation, true);
});

test("lineThroughput: ppm counts whole pizzas, pairs are half", () => {
  assert.deepEqual(lineThroughput(120), { pizzasPerMinute: 120, pairsPerMinute: 60 });
  assert.deepEqual(lineThroughput(-5), { pizzasPerMinute: 0, pairsPerMinute: 0 });
});

function phaseArgs(overrides = {}) {
  // Explicit 20-minute line: press 3 + frontline 5 + tunnel 10 + wrapper 2.
  return {
    pressOvenMin: 3,
    frontlineMin: 5,
    postTunnelMin: 2,
    freezerTime: 20,
    elapsedBatchSec: 0,
    pausedAt: null,
    lastResumeWallMs: 0,
    lastPauseStartWallMs: 0,
    pauseStopsTunnel: true,
    lastPauseStopsTunnel: true,
    runStatus: "running",
    nowMs: NOW,
    endedAt: null,
    ...overrides,
  };
}

test("computeLinePhases: running fill walks press/oven → tunnel → wrapper", () => {
  const early = computeLinePhases(phaseArgs({ elapsedBatchSec: 4 * 60 }));
  assert.equal(early.stage1.state, "filling");
  assert.equal(early.stage1.remainMs, (8 - 4) * 60000);
  assert.equal(early.stage2.state, "empty");
  assert.equal(early.stage3.state, "empty");

  const mid = computeLinePhases(phaseArgs({ elapsedBatchSec: 9 * 60 }));
  assert.equal(mid.stage1.state, "active");
  assert.equal(mid.stage2.state, "filling");
  assert.equal(mid.stage2.remainMs, (18 - 9) * 60000);
  assert.equal(mid.stage3.state, "empty");

  const late = computeLinePhases(phaseArgs({ elapsedBatchSec: 19 * 60 }));
  assert.equal(late.stage1.state, "active");
  assert.equal(late.stage2.state, "active");
  assert.equal(late.stage3.state, "filling");
  assert.equal(late.stage3.remainMs, 60000);
});

test("computeLinePhases: sections view matches the legacy stages during fill", () => {
  const phases = computeLinePhases(phaseArgs({ elapsedBatchSec: 4 * 60 }));
  assert.equal(phases.sections.pressOven.state, "active");
  assert.equal(phases.sections.frontline.state, "filling");
  assert.equal(phases.sections.frontline.remainMs, (8 - 4) * 60000);
  assert.equal(phases.sections.freezeTunnel.state, "empty");
  assert.equal(phases.sections.packaging.state, "empty");
  assert.equal(lineHasProduct(phases), true);
});

test("computeLinePhases: safe pause policy drains frontline, holds tunnel, drains wrapper", () => {
  const drainingFront = computeLinePhases(
    phaseArgs({ runStatus: "paused", pausedAt: NOW - 5 * 60000, elapsedBatchSec: 10 * 60 })
  );
  assert.equal(drainingFront.stage1.state, "draining");
  assert.equal(drainingFront.stage1.remainMs, (8 - 5) * 60000);
  assert.equal(drainingFront.stage2.state, "empty");

  const heldTunnel = computeLinePhases(
    phaseArgs({ runStatus: "paused", pausedAt: NOW - 9 * 60000, elapsedBatchSec: 10 * 60 })
  );
  assert.equal(heldTunnel.stage1.state, "empty");
  assert.equal(heldTunnel.stage2.state, "paused");
  assert.equal(heldTunnel.stage3.state, "draining");
  assert.equal(heldTunnel.stage3.remainMs, 60000);

  const drained = computeLinePhases(
    phaseArgs({ runStatus: "paused", pausedAt: NOW - 12 * 60000, elapsedBatchSec: 10 * 60 })
  );
  assert.equal(drained.stage2.state, "paused");
  assert.equal(drained.stage3.state, "empty");
});

test("computeLinePhases: keep-tunnel pause drains the whole line in sequence", () => {
  const phases = computeLinePhases(
    phaseArgs({
      runStatus: "paused",
      pausedAt: NOW - 12 * 60000,
      elapsedBatchSec: 10 * 60,
      pauseStopsTunnel: false,
    })
  );
  // remaining = 20 - 12 = 8; stage1 window spent (8 ≤ tunnel+post), tunnel draining 8-2=6.
  assert.equal(phases.stage1.state, "empty");
  assert.equal(phases.stage2.state, "draining");
  assert.equal(phases.stage2.remainMs, 6 * 60000);
  assert.equal(phases.stage3.state, "empty");
});

test("computeLinePhases: ended run drains from endedAt over the full line time", () => {
  const phases = computeLinePhases(
    phaseArgs({ runStatus: "ended", endedAt: NOW - 3 * 60000, elapsedBatchSec: 10 * 60 })
  );
  assert.equal(phases.stage1.state, "draining");
  assert.equal(phases.stage1.remainMs, 5 * 60000);
  assert.equal(isPackagingDrainComplete({ runStatus: "ended", endedAt: NOW - 3 * 60000, elapsedBatchSec: 600, phases }), false);
  const drained = computeLinePhases(
    phaseArgs({ runStatus: "ended", endedAt: NOW - 25 * 60000, elapsedBatchSec: 10 * 60 })
  );
  assert.equal(drained.stage1.state, "empty");
  assert.equal(drained.stage2.state, "empty");
  assert.equal(drained.stage3.state, "empty");
  assert.equal(
    isPackagingDrainComplete({ runStatus: "ended", endedAt: NOW - 25 * 60000, elapsedBatchSec: 600, phases: drained }),
    true
  );
});

test("computeLinePhases: run ended before any production shows empty", () => {
  const phases = computeLinePhases(
    phaseArgs({ runStatus: "ended", endedAt: NOW - 3 * 60000, elapsedBatchSec: 0 })
  );
  assert.equal(phases.stage1.state, "empty");
  assert.equal(lineHasProduct(phases), false);
});

test("computePackagingDrainElapsedSec: stopped tunnel time never becomes packaging output", () => {
  assert.equal(
    computePackagingDrainElapsedSec(
      phaseArgs({ runStatus: "paused", pausedAt: NOW - 6 * 60000, elapsedBatchSec: 10 * 60 })
    ),
    6 * 60
  );
  assert.equal(
    computePackagingDrainElapsedSec(
      phaseArgs({ runStatus: "paused", pausedAt: NOW - 9 * 60000, elapsedBatchSec: 10 * 60 })
    ),
    9 * 60
  );
  assert.equal(
    computePackagingDrainElapsedSec(
      phaseArgs({
        runStatus: "paused",
        pausedAt: NOW - 9 * 60000,
        elapsedBatchSec: 10 * 60,
        pauseStopsTunnel: false,
      })
    ),
    9 * 60
  );
  assert.equal(
    computePackagingDrainElapsedSec(phaseArgs({ runStatus: "running" })),
    0
  );
});

test("computeEndedRunElapsedSec: open auto-end pause is capped at endedAt", () => {
  // startedAt 0 is falsy and means "not started" in the v1 lifecycle.
  assert.equal(computeEndedRunElapsedSec({ startedAt: 1_000, endedAt: 101_000 }), 100);
  assert.equal(
    computeEndedRunElapsedSec({
      startedAt: 1_000,
      endedAt: 101_000,
      stoppages: [{ type: "pause", startedAt: 51_000, endedAt: null }],
    }),
    50
  );
  assert.equal(computeEndedRunElapsedSec({ startedAt: null, endedAt: 100_000 }), 0);
});

test("pickMostActivePhase: nearest live countdown wins, paused is the fallback", () => {
  const phases = computeLinePhases(phaseArgs({ elapsedBatchSec: 4 * 60 }));
  assert.equal(pickMostActivePhase(phases).state, "filling");
  const paused = computeLinePhases(
    phaseArgs({ runStatus: "paused", pausedAt: NOW - 12 * 60000, elapsedBatchSec: 10 * 60 })
  );
  assert.equal(pickMostActivePhase(paused).state, "paused");
});
