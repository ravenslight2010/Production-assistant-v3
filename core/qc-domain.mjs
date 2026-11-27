export const QC_WEIGHT_UNITS = Object.freeze(["g", "kg", "oz", "lb"]);
export const QC_OUTCOMES = Object.freeze(["pass", "fail", "not-evaluated"]);

export function hasNewQcEvidenceSinceSignOff(records, signOff) {
  if (!Array.isArray(records)) throw new TypeError("QC records must be an array.");
  if (signOff === null) return false;
  if (!signOff || !/^(0|[1-9][0-9]*)$/u.test(signOff.highWaterMark)) {
    throw new TypeError("QC sign-off high-water mark is invalid.");
  }
  const signed = BigInt(signOff.highWaterMark);
  return records.some((record) => record.kind !== "sign-off" && BigInt(record.sequence) > signed);
}

export function evaluateQcMeasurement({ kind, value, unit, targetKey, target }) {
  if (!['weight-check', 'brix-check'].includes(kind)) throw new TypeError("Unsupported QC measurement kind.");
  if (targetKey === null) {
    return { outcome: "not-evaluated", notEvaluatedReason: "no-reviewed-target" };
  }
  if (!target) {
    return { outcome: "not-evaluated", notEvaluatedReason: "target-unavailable" };
  }
  const expectedKind = kind === "weight-check" ? "weight" : "brix";
  if (target.kind !== expectedKind) {
    return { outcome: "not-evaluated", notEvaluatedReason: "target-kind-mismatch" };
  }
  if (!target.active) {
    return { outcome: "not-evaluated", notEvaluatedReason: "target-inactive" };
  }
  if (target.unit !== unit) {
    return { outcome: "not-evaluated", notEvaluatedReason: "unit-mismatch" };
  }
  const observed = Number(value);
  const minimum = target.minimum === null ? null : Number(target.minimum);
  const maximum = target.maximum === null ? null : Number(target.maximum);
  const pass = (minimum === null || observed >= minimum) && (maximum === null || observed <= maximum);
  return { outcome: pass ? "pass" : "fail", notEvaluatedReason: null };
}
