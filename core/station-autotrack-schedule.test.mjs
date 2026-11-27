import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAutoTrackElapsedMs,
  computeAutoTrackSchedule,
} from "./station-autotrack-schedule.mjs";
import {
  computeAutomaticFrontlineSupply,
  computeAutomaticSauceSupply,
  computeFrontlineRunRequirement,
  computeFrontlineSupplyFromLbs,
  computeSauceRunRequirement,
  computeStagedSupply,
  legacyFrontlineConsumption,
} from "./station-staged-supply.mjs";

test("elapsed ms: non-pause downtime subtracts, pause does not", () => {
  assert.equal(computeAutoTrackElapsedMs({ startedAt: 1_000, nowMs: 61_000 }), 60_000);
  assert.equal(
    computeAutoTrackElapsedMs({ startedAt: 1_000, nowMs: 61_000, stoppages: [{ type: "jam", startedAt: 2_000, endedAt: 5_000 }] }),
    57_000
  );
  assert.equal(computeAutoTrackElapsedMs({ startedAt: undefined, nowMs: 61_000 }), 0);
});

function scheduleInput(overrides = {}) {
  const startedAt = 1_800_000_000_000;
  return {
    input: {
      runId: "run-1",
      startedAt,
      nowMs: startedAt + 61_000,
      v: { casesNeeded: 10, pizzasPerCase: 10, freezerTime: 10, sauceOzPerPizza: 4 },
      calc: {
        ppm: 50, perTray: 20, perBatch: 3, pressDone: false,
        sauceDepletionSec: 19.2, sauceEffBarrel: 40,
      },
      progress: { sauceStockInitialized: true, sauceStockBarrels: 2, sauceBarrelsMade: 0 },
      ...overrides,
    },
    startedAt,
  };
}

test("schedule: live run replays wall-clock dues and publishes sauce claims", () => {
  const { input, startedAt } = scheduleInput();
  const schedule = computeAutoTrackSchedule(input);
  assert.equal(schedule.runId, "run-1");
  assert.equal(schedule.generation, `run-1:${startedAt}`);
  const byChannel = Object.fromEntries(schedule.entries.map((e) => [e.channel, e]));
  // case: 61 s elapsed, 12 s period → next due at 7 boundaries = startedAt + 72_000.
  assert.equal(byChannel["case"].dueAt, startedAt + 72_000);
  assert.equal(byChannel["case"].canonical, false);
  assert.equal(byChannel["case"].dueNow, false);
  // tray-consume (24 s) and tray-produce (12 s) both land on 72_000.
  assert.equal(byChannel["tray-consume"].dueAt, startedAt + 72_000);
  assert.equal(byChannel["tray-produce"].dueAt, startedAt + 72_000);
  // batch channels: consumption clamps to the 1 s floor, production 3_600 ms.
  assert.equal(byChannel["batch-consume"].dueAt, startedAt + 62_000);
  assert.equal(byChannel["batch-produce"].dueAt, startedAt + 61_200);
  // sauce-barrel: anchor 0 + 19.2 depletion; 61 s elapsed → due now.
  assert.equal(byChannel["sauce-barrel"].dueAt, 19.2);
  assert.equal(byChannel["sauce-barrel"].dueNow, true);
  assert.equal(byChannel["sauce-barrel"].nextDueAt, 38.4);
  // sauce-stock: cadence 19.2 from a full barrel.
  assert.equal(byChannel["sauce-stock"].dueAt, 19.2);
  assert.equal(byChannel["sauce-stock"].dueNow, true);
  // No app types configured → no app-batch entries; no initialized applicator stock.
  const channels = schedule.entries.map((e) => e.channel);
  assert.ok(!channels.some((c) => c.endsWith("-batch") && c.startsWith("app")));
  assert.ok(!channels.some((c) => c.endsWith("-stock") && (c.startsWith("app") || c.startsWith("pep"))));
  // Channel order follows AUTO_TRACK_SCHEDULE_CHANNELS.
  const order = ["case", "tray-consume", "tray-produce", "batch-consume", "batch-produce", "sauce-barrel", "sauce-stock"];
  assert.deepEqual(channels, order);
});

test("schedule: canonical wall ownership suppresses replay bootstrap", () => {
  const startedAt = 1_800_000_000_000;
  const { input } = scheduleInput({
    coordination: {
      case: { generation: `run-1:${startedAt}`, sequence: 5, nextDueAt: startedAt + 84_000 },
    },
    serverWallOwnership: { case: 5 },
  });
  const schedule = computeAutoTrackSchedule(input);
  const entry = schedule.entries.find((e) => e.channel === "case");
  assert.equal(entry.canonical, true);
  assert.equal(entry.sequence, 5);
  assert.equal(entry.dueAt, startedAt + 84_000);
  assert.equal(schedule.entries.filter((e) => e.channel === "case").length, 1);
});

test("schedule: paused run publishes no live or replay entries", () => {
  const { input } = scheduleInput({ pausedAt: scheduleInput().startedAt + 30_000 });
  const schedule = computeAutoTrackSchedule(input);
  assert.equal(schedule.entries.length, 0);
});

test("staged supply: fractional units preserved, dust suppressed", () => {
  const supply = computeStagedSupply({ total: 5, consumed: 1, onLine: 1, ready: 1, inProduction: 0.5, cap: 3 });
  assert.equal(supply.remaining, 4);
  assert.equal(supply.stillToMake, 1.5);
  assert.equal(supply.stagingRoom, 0.5);
  assert.equal(computeStagedSupply({ total: 5, consumed: 5 + 1e-12 }).stillToMake, 0);
});

test("automatic staged supply: stateless refill from lifetime consumption", () => {
  const sauce = computeAutomaticSauceSupply({ total: 5, consumed: 1 });
  assert.equal(sauce.onLine, 1);
  assert.equal(sauce.ready, 1);
  assert.equal(sauce.inProduction, 1);
  assert.equal(sauce.stillToMake, 1);
  assert.equal(sauce.stagingRoom, 0);
  const frontline = computeAutomaticFrontlineSupply({ total: 5, consumed: 1 });
  assert.equal(frontline.onLine, 1);
  assert.equal(frontline.ready, 1);
  assert.equal(frontline.inProduction, 0);
  assert.equal(frontline.stillToMake, 2);
});

test("legacy frontline consumption converts historical BatchesMade once a pounds ledger is absent", () => {
  assert.deepEqual(legacyFrontlineConsumption({ app1BatchesMade: 3, app1BatchLbs: 20 }), { app1StockConsumedLbs: 60 });
  assert.deepEqual(legacyFrontlineConsumption({ app1BatchesMade: 3, app1StockConsumedLbs: 45 }), {});
  assert.deepEqual(legacyFrontlineConsumption({ app1BatchesMade: 3, app1BatchLbs: 500 }), {});
});

test("run requirements: fixed buffers never appear alone (sauce +30 lb, frontline +20 lb)", () => {
  const sauce = computeSauceRunRequirement({ casesNeeded: 10, pizzasPerCase: 10, ozPerPizza: 4, barrelLbs: 40 });
  assert.equal(sauce.totalLbs, 55);
  assert.equal(sauce.totalUnits, 1.375);
  const frontline = computeFrontlineRunRequirement({ casesNeeded: 10, pizzasPerCase: 10, ozPerPizza: 4, configuredEffectiveWeight: 20 });
  assert.equal(frontline.totalLbs, 45);
  assert.equal(frontline.totalUnits, 2.25);
  assert.equal(frontline.effectiveBatchWeight, 20);
  assert.equal(computeSauceRunRequirement({ casesNeeded: 10, pizzasPerCase: 10, ozPerPizza: 0, barrelLbs: 40 }).totalLbs, 0);
});

test("frontline supply from lbs: demand converts to partial batch units", () => {
  const supply = computeFrontlineSupplyFromLbs({ demandLbs: 45, configuredEffectiveWeight: 20 });
  assert.equal(supply.total, 2.25);
  assert.equal(supply.remaining, 2.25);
  assert.equal(supply.stillToMake, 2.25);
  assert.equal(supply.effectiveBatchWeight, 20);
});
