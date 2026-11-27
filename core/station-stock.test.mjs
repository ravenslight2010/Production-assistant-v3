import test from "node:test";
import assert from "node:assert/strict";
import {
  applicatorStockFields,
  applicatorStockRegisterForChannel,
  capApplicatorStock,
  capSauceStock,
  computeApplicatorStockCadenceSeconds,
  computeApplicatorStockCapacityLbs,
  computeApplicatorStockRateLbsPerSecond,
  computeSauceStockStepSeconds,
  depleteApplicatorStock,
  depleteSauceStock,
  initializeApplicatorStockOnRunStart,
  initializeSauceStockOnRunStart,
  MIX_APPLICATOR_STOCK_CAP_LBS,
  PEPPERONI_STOCK_CAP_LBS,
  SAUCE_STOCK_CAP_BARRELS,
} from "./station-stock.mjs";
import {
  computeFrontlineEffectiveBatchWeight,
  FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT,
} from "./station-staged-supply.mjs";

test("sauce stock: seeded exactly once at two full barrels", () => {
  const seeded = initializeSauceStockOnRunStart({});
  assert.equal(seeded.sauceStockBarrels, SAUCE_STOCK_CAP_BARRELS);
  assert.equal(seeded.sauceStockInitialized, true);
  assert.deepEqual(initializeSauceStockOnRunStart(seeded), {});
});

test("sauce stock: tenth-barrel step time and residue-free depletion", () => {
  // rate = 4 oz * 50 ppm / 960 = 5/24 lb/s; 4 lb step / (5/24) = 19.2 s.
  assert.equal(computeSauceStockStepSeconds(4, 50, 40), 19.2);
  assert.equal(computeSauceStockStepSeconds(0, 50, 40), 0);
  assert.equal(depleteSauceStock(2), 1.9);
  assert.equal(depleteSauceStock(0.05), 0);
  assert.equal(capSauceStock(2.6), 2);
  assert.equal(capSauceStock(-1), 0);
  assert.equal(capSauceStock(1.26), 1.3);
});

test("applicator stock: field names and channel mapping round-trip", () => {
  assert.deepEqual(applicatorStockFields("pep1b"), {
    stock: "pep1bStockLbs",
    anchor: "pep1bStockAnchorNetSec",
    correctionGeneration: "pep1bStockCorrectionGeneration",
  });
  assert.equal(applicatorStockRegisterForChannel("app3-stock"), "app3");
  assert.equal(applicatorStockRegisterForChannel("pep2b-stock"), "pep2b");
  assert.equal(applicatorStockRegisterForChannel("case"), undefined);
});

test("applicator stock: capacity is physical, mix caps at 100 lb, cheese doubles the effective batch", () => {
  const values = {
    app1Type: "Cheese", app1BatchLbs: 20,
    app2Type: "Blend Mix",
    app3Type: "",
    app4Type: "Cheese", app4CheeseRecipe: [{ lbs: 15 }],
    pep1Type: "Cup",
    pep1TypeB: "Sliced",
    pep2Type: "Diced", pep1Combined: false,
  };
  assert.equal(computeApplicatorStockCapacityLbs(values, "app1"), 40);
  assert.equal(computeApplicatorStockCapacityLbs(values, "app2"), MIX_APPLICATOR_STOCK_CAP_LBS);
  assert.equal(computeApplicatorStockCapacityLbs(values, "app3"), 0);
  assert.equal(computeApplicatorStockCapacityLbs(values, "app4"), 30);
  assert.equal(computeApplicatorStockCapacityLbs(values, "pep1"), PEPPERONI_STOCK_CAP_LBS);
  assert.equal(computeApplicatorStockCapacityLbs(values, "pep1b"), PEPPERONI_STOCK_CAP_LBS);
  assert.equal(computeApplicatorStockCapacityLbs({ ...values, pep1Combined: true }, "pep2"), 0);
});

test("frontline effective batch weight falls back to the factory 50 lb standard", () => {
  assert.equal(computeFrontlineEffectiveBatchWeight(20), 20);
  assert.equal(computeFrontlineEffectiveBatchWeight(80), FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT);
  assert.equal(computeFrontlineEffectiveBatchWeight(0), FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT);
});

test("applicator stock: run start seeds every register from capacity", () => {
  const seeded = initializeApplicatorStockOnRunStart({ app1Type: "Cheese", app1BatchLbs: 20, pep1Type: "Cup" });
  assert.equal(seeded.app1StockLbs, 40);
  assert.equal(seeded.app1StockConsumedLbs, 0);
  assert.equal(seeded.pep1StockLbs, 50);
  assert.equal(seeded.app1StockAnchorNetSec, 0);
  assert.equal(seeded.applicatorStockInitialized, true);
  assert.deepEqual(initializeApplicatorStockOnRunStart(seeded), {});
});

test("applicator stock: quarter-batch cadence and linear depletion", () => {
  const values = { app1Type: "Cheese", app1BatchLbs: 20, app1OzPerPizza: 2, pep1Type: "Cup", pep1OzPerPizza: 1.5 };
  // app1: batch 20 lb, rate 2 oz * 50 ppm / 960 => 20/rate/4 = 48 s.
  assert.equal(computeApplicatorStockCadenceSeconds(values, "app1", 50), 48);
  // pep1: batch 50 lb, rate 1.5*50/960 => 50/rate/4 = 160 s.
  assert.equal(computeApplicatorStockCadenceSeconds(values, "pep1", 50), 160);
  assert.equal(
    computeApplicatorStockRateLbsPerSecond(2, 50),
    (2 * 50) / 960
  );
  // 40 lb on hand, 60 s at 2 oz/50 ppm: 40 - 6.25 = 33.75.
  assert.equal(depleteApplicatorStock({ onHandLbs: 40, elapsedSeconds: 60, ozPerPizza: 2, ppm: 50 }), 33.75);
  assert.equal(capApplicatorStock(45, 40), 40);
  assert.equal(capApplicatorStock(-3, 40), 0);
});
