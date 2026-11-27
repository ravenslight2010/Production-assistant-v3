// Ported verbatim from v1 lib/live-calc/src/sauceStock.ts and
// applicatorStock.ts. Physical on-line stock model: sauce barrels (cap 2,
// 0.1-barrel ticks) and applicator bins (100 lb mix / 50 lb pepperoni caps).
// Capacity is physical stock, not a projection of calculated run demand.

import { computeFrontlineEffectiveBatchWeight } from "./station-staged-supply.mjs";

export const SAUCE_STOCK_CAP_BARRELS = 2;
export const SAUCE_STOCK_STEP_BARRELS = 0.1;

export const APPLICATOR_STOCK_REGISTERS = [
  "app1", "app2", "app3", "app4", "pep1", "pep1b", "pep2", "pep2b",
];

export const APPLICATOR_STOCK_CHANNELS = [
  "app1-stock", "app2-stock", "app3-stock", "app4-stock",
  "pep1-stock", "pep1b-stock", "pep2-stock", "pep2b-stock",
];

export const MIX_APPLICATOR_STOCK_CAP_LBS = 100;
export const PEPPERONI_STOCK_CAP_LBS = 50;

export function applicatorStockFields(register) {
  return {
    stock: `${register}StockLbs`,
    anchor: `${register}StockAnchorNetSec`,
    correctionGeneration: `${register}StockCorrectionGeneration`,
  };
}

export function applicatorStockRegisterForChannel(channel) {
  const match = /^(app[1-4]|pep[12]b?)-stock$/.exec(channel);
  return match?.[1];
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readRecipeLbs(value) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum;
    return sum + finitePositive(row.lbs);
  }, 0);
}

/** Capacity is physical stock, not a projection of calculated run demand. */
export function computeApplicatorStockCapacityLbs(values, register) {
  if (register.startsWith("app")) {
    const type = String(values[`${register}Type`] ?? "").trim();
    if (!type) return 0;
    if (type.toLowerCase().includes("mix")) return MIX_APPLICATOR_STOCK_CAP_LBS;
    const configuredWeight =
      readRecipeLbs(values[`${register}CheeseRecipe`]) ||
      finitePositive(values[`${register}BatchLbs`]);
    return computeFrontlineEffectiveBatchWeight(configuredWeight) * 2;
  }
  const typeField = register.endsWith("b") ? `${register.slice(0, -1)}TypeB` : `${register}Type`;
  if (!String(values[typeField] ?? "").trim()) return 0;
  if (register.startsWith("pep2") && values.pep1Combined === true) return 0;
  return PEPPERONI_STOCK_CAP_LBS;
}

/** Seed a new run's physical bins once; prior made-count registers are untouched. */
export function initializeApplicatorStockOnRunStart(values) {
  if (values.applicatorStockInitialized === true) return {};
  const initialized = { applicatorStockInitialized: true };
  for (const register of APPLICATOR_STOCK_REGISTERS) {
    const fields = applicatorStockFields(register);
    initialized[fields.stock] = computeApplicatorStockCapacityLbs(values, register);
    initialized[fields.anchor] = 0;
    initialized[fields.correctionGeneration] = 0;
    if (register.startsWith("app")) initialized[`${register}StockConsumedLbs`] = 0;
  }
  return initialized;
}

export function computeApplicatorStockRateLbsPerSecond(ozPerPizza, ppm) {
  return (finitePositive(ozPerPizza) * finitePositive(ppm)) / (16 * 60);
}

export function computeApplicatorStockCadenceSeconds(values, register, ppm) {
  const capacityLbs = computeApplicatorStockCapacityLbs(values, register);
  const batchLbs = register.startsWith("pep") ? PEPPERONI_STOCK_CAP_LBS : capacityLbs / 2;
  const ozField = register.endsWith("b") ? `${register.slice(0, -1)}OzPerPizzaB` : `${register}OzPerPizza`;
  const rate = computeApplicatorStockRateLbsPerSecond(values[ozField], ppm);
  return batchLbs > 0 && rate > 0 ? batchLbs / rate / 4 : 0;
}

export function depleteApplicatorStock(input) {
  const onHand = finitePositive(input.onHandLbs);
  const elapsed = finitePositive(input.elapsedSeconds);
  const rate = computeApplicatorStockRateLbsPerSecond(input.ozPerPizza, input.ppm);
  return Math.max(0, onHand - elapsed * rate);
}

export function capApplicatorStock(value, capacityLbs) {
  const capacity = finitePositive(capacityLbs);
  const stock = Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(capacity, Math.max(0, stock)) * 100) / 100;
}

const positive = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Start a run with two barrels on line exactly once; initialized zero is valid. */
export function initializeSauceStockOnRunStart(values) {
  if (values.sauceStockInitialized === true) return {};
  return {
    sauceStockBarrels: SAUCE_STOCK_CAP_BARRELS,
    sauceStockAnchorNetSec: 0,
    sauceStockCorrectionGeneration: 0,
    sauceStockInitialized: true,
  };
}

/** Each automatic claim consumes one tenth of a barrel. */
export function computeSauceStockStepSeconds(sauceOzPerPizza, ppm, barrelLbs) {
  const rate = (positive(sauceOzPerPizza) * positive(ppm)) / (16 * 60);
  const barrel = positive(barrelLbs);
  return rate > 0 && barrel > 0 ? (barrel * SAUCE_STOCK_STEP_BARRELS) / rate : 0;
}

export function capSauceStock(value) {
  const finite = Number.isFinite(value) ? value : 0;
  const capped = Math.min(SAUCE_STOCK_CAP_BARRELS, Math.max(0, finite));
  return Math.round(capped * 10) / 10;
}

/** Apply one due tenth-barrel tick without floating-point residue. */
export function depleteSauceStock(onHandBarrels) {
  return capSauceStock(capSauceStock(onHandBarrels) - SAUCE_STOCK_STEP_BARRELS);
}
