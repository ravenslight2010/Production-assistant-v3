// Fill-in-missing-data detection and proposals (port of v1's
// @workspace/fill-missing, adapted to v3's station model).
//
// v1 scanned a flat run form where every calculator field was directly
// settable; v3's run-time values live in per-station inputs (applied through
// apply_station_command) plus the frozen setup snapshot. The detection and
// proposal-priority rules are ported verbatim:
//
//   - A number field is missing when it is absent or <= 0 (the calculator
//     guards the same way: `n(x)` / firstPositive treat blanks and
//     non-positives as unknown).
//   - Proposal source priority: learned > catalog > default > none.
//     v1's "profile" and "spec" sources (SPEC_PROFILES / the reviewed
//     setup profile) collapse into one v3 "catalog" source: the reviewed
//     product's doughCapacity.pizzasPerCase. Other station inputs have no
//     catalog counterpart today — v3 runs are created from the reviewed
//     catalog but station inputs start empty by design.
//   - v1's documented web-form defaults (casesNeeded 384, barrelLbs 450,
//     ...) belonged to v1's form schema. v3 has no documented constants for
//     these fields, so the "default" source is intentionally absent here;
//     specs declare no default and detection still reports the field.
//   - Derived fields are never proposed (v1 parity): casesPerBatch on
//     stations is derived from casesPerSkid and excluded, as are fields the
//     calculator does not consume (station auto-track rates other than the
//     line rate, timer durations).
//   - Like v1's `fillMissing` wrapper, this module NEVER writes. The UI
//     commits confirmed values through the existing command APIs, one field
//     at a time, and separately offers to remember the value (learned).

export const FILL_MISSING_PROPOSAL_SOURCES = Object.freeze(["learned", "catalog", "none"]);

// One spec per fillable run-time field the operational read consumes.
// `station`/`field` name the apply target: proposals carry
// { kind: "station_command", station, field } so the client can route each
// gap through the existing station command endpoint.
export const FILL_MISSING_FIELD_SPECS = Object.freeze([
  { key: "line.autoTrackRatePerMinute", station: "line", field: "autoTrackRatePerMinute", label: "Line rate (cases/min)", category: "line" },
  { key: "line.casesPerSkid", station: "line", field: "casesPerSkid", label: "Cases per skid", category: "line" },
  { key: "dough.traysPerBatch", station: "dough", field: "traysPerBatch", label: "Trays per batch", category: "dough" },
  { key: "cheese.pizzasPerCase", station: "cheese", field: "pizzasPerCase", label: "Pizzas per case", category: "cheese", firstPositive: ["cheese", "pepperoni", "sauce", "frontline"], catalogKey: "product.pizzasPerCase" },
  { key: "cheese.ozPerPizza", station: "cheese", field: "ozPerPizza", label: "Cheese oz per pizza", category: "cheese" },
  { key: "cheese.batchLbs", station: "cheese", field: "batchLbs", label: "Cheese batch (lbs)", category: "cheese" },
  { key: "pepperoni.ozPerPizza", station: "pepperoni", field: "ozPerPizza", label: "Pepperoni oz per pizza", category: "pepperoni" },
  { key: "pepperoni.batchLbs", station: "pepperoni", field: "batchLbs", label: "Pepperoni batch (lbs)", category: "pepperoni" },
  { key: "sauce.ozPerPizza", station: "sauce", field: "ozPerPizza", label: "Sauce oz per pizza", category: "sauce" },
  { key: "sauce.barrelLbs", station: "sauce", field: "barrelLbs", label: "Sauce barrel (lbs)", category: "sauce" },
  { key: "frontline.ozPerPizza", station: "frontline", field: "ozPerPizza", label: "Frontline oz per pizza", category: "frontline" },
  { key: "frontline.batchLbs", station: "frontline", field: "batchLbs", label: "Frontline batch (lbs)", category: "frontline" },
]);

const SPEC_BY_KEY = new Map(FILL_MISSING_FIELD_SPECS.map((spec) => [spec.key, spec]));

function stationInputs(stationProgress, stationKey) {
  const inputs = stationProgress?.[stationKey]?.inputs;
  return inputs && typeof inputs === "object" && !Array.isArray(inputs) ? inputs : {};
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readCurrentValue(spec, stationProgress) {
  if (Array.isArray(spec.firstPositive)) {
    for (const station of spec.firstPositive) {
      const found = positiveNumber(stationInputs(stationProgress, station)[spec.field]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return positiveNumber(stationInputs(stationProgress, spec.station)[spec.field]);
}

// Port of v1 detectMissingFields: a spec is missing when its current value
// is not a positive number. `key` is the namespaced field key; `runId` is
// carried through for UI row keys (v1 used `${brand}:${flavor}:${key}`).
export function detectMissingFields({ runId, stationProgress }) {
  if (typeof runId !== "string" || runId.length < 1) {
    throw new TypeError("runId is required to detect missing fields.");
  }
  const missing = [];
  for (const spec of FILL_MISSING_FIELD_SPECS) {
    const currentValue = readCurrentValue(spec, stationProgress);
    if (currentValue !== undefined) continue;
    missing.push({
      key: spec.key,
      runId,
      label: spec.label,
      category: spec.category,
      currentValue: null,
    });
  }
  return missing;
}

// Case-insensitive learned lookup per product, keyed by namespaced field
// key. Mirrors v1 pickLearnedForProduct (brand+flavor case-insensitive).
export function pickLearnedForProduct(learnedValues, productCode) {
  const rows = Array.isArray(learnedValues) ? learnedValues : [];
  const wanted = typeof productCode === "string" ? productCode.trim().toLowerCase() : "";
  return (fieldKey) => {
    if (!wanted || typeof fieldKey !== "string") return undefined;
    for (const row of rows) {
      if (typeof row?.productCode !== "string" || typeof row?.fieldKey !== "string") continue;
      if (row.productCode.trim().toLowerCase() !== wanted) continue;
      if (row.fieldKey !== fieldKey) continue;
      const parsed = Number(row.value);
      if (typeof row.value === "string" && row.value.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
      return undefined;
    }
    return undefined;
  };
}

// Catalog lookup: the reviewed product's dough capacity is the only catalog
// value that maps onto a run-time station input today.
function catalogValue(spec, product) {
  if (spec.catalogKey === "product.pizzasPerCase") {
    const value = positiveNumber(product?.doughCapacity?.pizzasPerCase);
    if (value !== undefined) return value;
  }
  return undefined;
}

// Port of v1 buildProposals with the v1 priority order: learned > catalog >
// default > none. Every v3 spec is fillable (apply routes through an
// existing command), matching v1's fillable specs list.
export function buildProposals(missing, { learnedValues = [], product = null, productCode = "" } = {}) {
  if (!Array.isArray(missing)) throw new TypeError("missing must be an array.");
  const learned = pickLearnedForProduct(learnedValues, productCode);
  return missing.map((field) => {
    const spec = SPEC_BY_KEY.get(field.key);
    if (!spec) throw new TypeError(`Unknown fill-missing field: ${field.key}`);
    const learnedValue = learned(field.key);
    const catalog = catalogValue(spec, product);
    const best = learnedValue !== undefined
      ? { value: learnedValue, source: "learned" }
      : catalog !== undefined
        ? { value: catalog, source: "catalog" }
        : { value: undefined, source: "none" };
    return {
      key: field.key,
      runId: field.runId,
      label: spec.label,
      category: spec.category,
      currentValue: field.currentValue,
      proposedValue: best.value,
      source: best.source,
      fillable: true,
      apply: { kind: "station_command", station: spec.station, field: spec.field },
    };
  });
}
