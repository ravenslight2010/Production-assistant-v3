import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptStationRun,
  createOperationalReadService,
} from "./station-operational-read.mjs";
import { RunServiceError } from "./run-service.mjs";

const RUN_ID = "00000000-0000-4000-8000-000000000004";
const AUTH = { facilityId: "fac-1" };
const BASE_MS = 1_800_000_000_000;
const NOW_MS = BASE_MS + 3_600_000;

function runFixture(overrides = {}) {
  return {
    id: RUN_ID,
    status: "running",
    productionDate: "2026-11-28",
    revision: 7,
    startedAt: new Date(BASE_MS).toISOString(),
    pausedAt: null,
    completedAt: null,
    updatedAt: new Date(NOW_MS).toISOString(),
    setupSnapshot: {
      label: "Run A", targetCases: 12, productCode: "PEP-16",
      dieSetup: overrides.dieSetup,
    },
    stoppages: [
      {
        id: "pause-1", type: "pause", reason: "lunch",
        startedAt: new Date(BASE_MS + 600_000).toISOString(),
        endedAt: new Date(BASE_MS + 720_000).toISOString(),
        stopTunnel: true,
      },
      {
        id: "stop-1", type: "stop", reason: "belt_jam",
        startedAt: new Date(BASE_MS + 1_200_000).toISOString(),
        endedAt: null,
      },
    ],
    stationProgress: {
      line: {
        inputs: { autoTrackRatePerMinute: 20, timerDurationSeconds: 0, casesPerSkid: 10 },
        progress: { casesProduced: 5, casesOnLine: 2, casesInFreezer: 1 },
      },
      dough: {
        inputs: { autoTrackRatePerMinute: 0, timerDurationSeconds: 0, casesPerBatch: 4, traysPerBatch: 4 },
        progress: { casesProduced: 5, traysOnLine: 3, batchesReady: 1, batchesMade: 2 },
      },
      cheese: {
        inputs: { pizzasPerCase: 8, ozPerPizza: 6, batchLbs: 20 },
        progress: { casesCompleted: 5, batchesMade: 1, stockOnLineLbs: 10 },
      },
      pepperoni: {
        inputs: { pizzasPerCase: 8, ozPerPizza: 10, batchLbs: 25 },
        progress: { casesCompleted: 5, batchesMade: 2, stockOnLineLbs: 5 },
      },
      sauce: {
        inputs: { pizzasPerCase: 8, ozPerPizza: 1.5, barrelLbs: 450 },
        progress: { barrelsMade: 1, stockBarrels: 2 },
      },
      frontline: {
        inputs: { pizzasPerCase: 8, ozPerPizza: 2, batchLbs: 30 },
        progress: { batchesMade: 1, stockOnLineLbs: 15, stockConsumedLbs: 5 },
      },
      packaging: {
        inputs: { autoTrackRatePerMinute: 0, timerDurationSeconds: 0, casesPerSkid: 10 },
        progress: { casesPacked: 23 },
      },
    },
    ...overrides,
  };
}

test("adaptStationRun maps pa3 station state onto the v1 crusts calculator input", () => {
  const TIMED_RUN = runFixture({
    dieSetup: {
      lineSettings: {
        crustsPerCycle: 1, cycleSpeed: 1, speedAdjustment: 1,
        freezerTime: 40, casesPerLayer: 6,
        preTunnelMin: 5, postTunnelMin: 2.5, pressOvenMin: 2.5, frontlineMin: 2.5,
      },
    },
  });
  const { runMeta, runValues, packagingEntry, startedAt, date } = adaptStationRun({ run: TIMED_RUN });

  assert.equal(startedAt, BASE_MS);
  assert.equal(date, "2026-11-28");
  assert.equal(runMeta.id, RUN_ID);
  assert.equal(runMeta.brand, "Run A");
  assert.equal(runMeta.flavor, "PEP-16");
  assert.equal(runMeta.startedAt, BASE_MS);
  assert.equal(runMeta.subTab, "crusts");
  assert.equal(runMeta.stoppages.length, 2);
  assert.equal(runMeta.stoppages[0].type, "pause");
  assert.equal(runMeta.stoppages[0].startedAt, BASE_MS + 600_000);
  assert.equal(runMeta.stoppages[0].endedAt, BASE_MS + 720_000);
  assert.equal(runMeta.stoppages[0].stopTunnel, true);
  assert.equal(runMeta.stoppages[1].type, "stop");
  assert.equal(runMeta.stoppages[1].endedAt, undefined);

  // Line rate is the crusts-mode ppm with an effective-rate adjustment of 1.
  assert.equal(runValues.approxLineSpeed, 20);
  assert.equal(runValues.speedAdjustment, 1);
  assert.equal(runValues.casesNeeded, 12);
  assert.equal(runValues.pizzasPerCase, 8);
  assert.equal(runValues.casesPerSkid, 10);
  assert.equal(runValues.crustsPerStack, 4);
  assert.equal(runValues.crustsPerCase, 8);
  // Reviewed die-line timing flows from the snapshot into the calculator input.
  assert.equal(runValues.freezerTime, 40);
  assert.equal(runValues.preTunnelMin, 5);
  assert.equal(runValues.postTunnelMin, 2.5);
  assert.equal(runValues.pressOvenMin, 2.5);
  assert.equal(runValues.frontlineMin, 2.5);

  // Station state flows into the v1 progress slots.
  assert.equal(runValues.traysOnLine, 3);
  assert.equal(runValues.batchesReady, 1);
  assert.equal(runValues.batchesMade, 2);
  assert.equal(runValues.sauceBarrelLbs, 450);
  assert.equal(runValues.sauceOzPerPizza, 1.5);
  assert.deepEqual(runValues.frontlineRecipe, [{ lbs: 30 }]);
  assert.equal(runValues.app1OzPerPizza, 6);
  assert.equal(runValues.app1BatchLbs, 20);
  assert.equal(runValues.pep1OzPerPizza, 10);
  assert.equal(runValues.pep1BatchLbs, 25);
  assert.equal(runValues.sauceBarrelsMade, 1);
  assert.equal(runValues.sauceStockInitialized, true);
  assert.equal(runValues.sauceStockBarrels, 2);
  assert.equal(runValues.app1BatchesMade, 1);
  assert.equal(runValues.pep1BatchesMade, 2);
  assert.equal(runValues.frontlineBatchesMade, 1);

  // 23 packed into skids of 10: two full skids, three cases on the current one.
  assert.deepEqual(packagingEntry, { skidsCompleted: 2, casesOnCurrentSkid: 3 });
});

test("adaptStationRun tolerates missing station progress and zero-filled inputs", () => {
  const run = runFixture({ stationProgress: undefined });
  const { runValues, packagingEntry } = adaptStationRun({ run });
  assert.equal(runValues.casesNeeded, 12);
  assert.equal(runValues.approxLineSpeed, 0);
  assert.equal(runValues.crustsPerStack, 1);
  assert.equal(runValues.sauceStockInitialized, false);
  assert.deepEqual(packagingEntry, { skidsCompleted: 0, casesOnCurrentSkid: 0 });
  assert.throws(() => adaptStationRun({ run: null }), TypeError);
});

test("build answers a matching If-None-Match with a 304-style probe and skips the math", async () => {
  let getCalls = 0;
  const runs = {
    get: async ({ runId }) => {
      getCalls += 1;
      assert.equal(runId, RUN_ID);
      return runFixture();
    },
  };
  const service = createOperationalReadService({ runs, now: () => NOW_MS });
  const result = await service.build({ auth: AUTH, runId: RUN_ID, ifNoneMatch: '"7"' });
  assert.deepEqual(result, { matched: true, etag: '"7"', revision: 7 });
  assert.equal(getCalls, 1);
});

test("build throws a 404-shaped service error for a missing run", async () => {
  const runs = { get: async () => null };
  const service = createOperationalReadService({ runs, now: () => NOW_MS });
  await assert.rejects(
    () => service.build({ auth: AUTH, runId: RUN_ID }),
    (error) => error instanceof RunServiceError
      && error.code === "RUN_NOT_FOUND" && error.status === 404,
  );
});

test("build derives the schedule, projection, and view from one run snapshot", async () => {
  const runs = { get: async () => runFixture() };
  const service = createOperationalReadService({ runs, now: () => NOW_MS });
  const result = await service.build({ auth: AUTH, runId: RUN_ID });

  assert.equal(result.matched, false);
  assert.equal(result.etag, '"7"');
  assert.equal(result.revision, 7);
  assert.equal(result.body.revision, 7);
  assert.equal(result.body.serverTimeMs, NOW_MS);

  const { view, projection, schedule } = result.body;
  // Hand-computed anchors from the fixture: ppm 20 (crusts, adjustment 1).
  // casesLeftToRun is v1-verbatim: needed - completed skids*perSkid - onSkid
  // - pipeline occupancy + perLayer; occupancy (3 cases) comes from the
  // default press/oven/tunnel timing over the 60 min elapsed at 20 ppm.
  assert.equal(projection.calc.ppm, 20);
  assert.equal(projection.calc.casesOnLine, 3);
  assert.equal(projection.calc.casesLeftToRun, 12 - 2 * 10 - 3 - 3 + 0);
  assert.equal(projection.calc.timePerBatchSec, 24);
  assert.equal(projection.calculationRevision, 7);
  assert.equal(projection.serverTimeMs, NOW_MS);
  assert.equal(projection.runId, RUN_ID);
  assert.equal(projection.lifecycleGeneration, `${RUN_ID}:${BASE_MS}`);

  // The schedule and projection agree on identity by construction.
  assert.equal(schedule.runId, RUN_ID);
  assert.equal(schedule.generation, projection.lifecycleGeneration);

  // The audit view carries the snapshot contract and the same lifecycle.
  assert.equal(view.runId, RUN_ID);
  assert.equal(view.observed.brand, "Run A");
  assert.equal(view.recap.casesNeeded, 12);
  assert.equal(view.freshness.snapshotId, `operational:${RUN_ID}:7`);
  assert.equal(view.freshness.capturedAt, NOW_MS);
  assert.equal(view.freshness.maxAgeMs, 60_000);
  assert.equal(view.freshness.status, "fresh");
});
