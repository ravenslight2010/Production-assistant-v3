// Ported from v1 lib/live-calc/src/stagedSupply.ts. Round 2 carries the
// batch-weight helpers applicatorStock depends on; the full staged-supply
// ledger port appends to this module in a later round.

export const FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT = 50;

export function computeFrontlineEffectiveBatchWeight(configuredEffectiveWeight) {
  return Number.isFinite(configuredEffectiveWeight) &&
    Number(configuredEffectiveWeight) > 0 &&
    Number(configuredEffectiveWeight) <= FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT
    ? Number(configuredEffectiveWeight)
    : FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT;
}

/** Return a configured Frontline weight only when the source provides a valid value. */
export function knownFrontlineBatchWeight(configuredEffectiveWeight) {
  return Number.isFinite(configuredEffectiveWeight) &&
    Number(configuredEffectiveWeight) > 0 &&
    Number(configuredEffectiveWeight) <= FRONTLINE_DEFAULT_OPERATIONAL_BATCH_WEIGHT
    ? Number(configuredEffectiveWeight)
    : null;
}
