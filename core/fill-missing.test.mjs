import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILL_MISSING_FIELD_SPECS,
  detectMissingFields,
  buildProposals,
  pickLearnedForProduct,
} from "./fill-missing.mjs";

const RUN_ID = "4d41f660-0000-4000-8000-000000000001";

function runWithInputs(stationProgress) {
  return { runId: RUN_ID, stationProgress };
}

test("fresh run reports every spec missing", () => {
  const missing = detectMissingFields(runWithInputs({}));
  assert.deepEqual(
    missing.map((field) => field.key).sort(),
    FILL_MISSING_FIELD_SPECS.map((spec) => spec.key).sort(),
  );
  assert.ok(missing.every((field) => field.currentValue === null && field.runId === RUN_ID));
});

test("zero and negative inputs count as missing", () => {
  const missing = detectMissingFields(runWithInputs({
    line: { inputs: { autoTrackRatePerMinute: 0, casesPerSkid: -4 } },
    sauce: { inputs: { barrelLbs: 0 } },
  }));
  const keys = missing.map((field) => field.key);
  assert.ok(keys.includes("line.autoTrackRatePerMinute"));
  assert.ok(keys.includes("line.casesPerSkid"));
  assert.ok(keys.includes("sauce.barrelLbs"));
});

test("filled station inputs drop out of the missing list", () => {
  const missing = detectMissingFields(runWithInputs({
    line: { inputs: { autoTrackRatePerMinute: 10.5, casesPerSkid: 48 } },
    dough: { inputs: { traysPerBatch: 9 } },
  }));
  const keys = missing.map((field) => field.key);
  assert.ok(!keys.includes("line.autoTrackRatePerMinute"));
  assert.ok(!keys.includes("line.casesPerSkid"));
  assert.ok(!keys.includes("dough.traysPerBatch"));
  assert.ok(keys.includes("cheese.ozPerPizza"));
});

test("pizzasPerCase is first-positive across ingredient stations", () => {
  const missing = detectMissingFields(runWithInputs({
    cheese: { inputs: {} },
    pepperoni: { inputs: {} },
    sauce: { inputs: { pizzasPerCase: 12 } },
    frontline: { inputs: {} },
  }));
  assert.ok(!missing.map((field) => field.key).includes("cheese.pizzasPerCase"));
});

test("non-numeric or blank learned values are ignored", () => {
  const learned = pickLearnedForProduct([
    { productCode: "CHEESE-16", fieldKey: "sauce.barrelLbs", value: "abc" },
  ], "cheese-16");
  assert.equal(learned("sauce.barrelLbs"), undefined);
});

test("learned lookup matches product code case-insensitively by exact field key", () => {
  const learned = pickLearnedForProduct([
    { productCode: "cheese-16", fieldKey: "cheese.batchLbs", value: "40" },
    { productCode: "CHEESE-16", fieldKey: "cheese.batchLbs", value: "55" },
  ], "Cheese-16");
  assert.equal(learned("cheese.batchLbs"), 40, "first matching row wins");
  assert.equal(learned("cheese.ozPerPizza"), undefined);
  assert.equal(learned("CHEESE.BATCHLBS"), undefined, "field keys are case-sensitive");
});

test("proposal priority: learned beats catalog", () => {
  const [proposal] = buildProposals(
    [{ key: "cheese.pizzasPerCase", runId: RUN_ID, label: "Pizzas per case", category: "cheese", currentValue: null }],
    {
      productCode: "CHEESE-16",
      product: { code: "CHEESE-16", doughCapacity: { pizzasPerCase: 14 } },
      learnedValues: [{ productCode: "cheese-16", fieldKey: "cheese.pizzasPerCase", value: "12" }],
    },
  );
  assert.equal(proposal.source, "learned");
  assert.equal(proposal.proposedValue, 12);
});

test("proposal falls back to catalog doughCapacity then to none", () => {
  const base = { key: "cheese.pizzasPerCase", runId: RUN_ID, label: "Pizzas per case", category: "cheese", currentValue: null };
  const [catalog] = buildProposals([base], {
    productCode: "CHEESE-16",
    product: { code: "CHEESE-16", doughCapacity: { pizzasPerCase: 14 } },
    learnedValues: [],
  });
  assert.equal(catalog.source, "catalog");
  assert.equal(catalog.proposedValue, 14);

  const [none] = buildProposals([{ ...base, key: "sauce.barrelLbs", label: "Sauce barrel (lbs)", category: "sauce" }], {
    productCode: "CHEESE-16",
    product: { code: "CHEESE-16", doughCapacity: { pizzasPerCase: 14 } },
    learnedValues: [],
  });
  assert.equal(none.source, "none");
  assert.equal(none.proposedValue, undefined);
});

test("proposals carry station-command apply routing and stay fillable", () => {
  const gaps = buildProposals(
    [
      { key: "sauce.barrelLbs", runId: RUN_ID, label: "Sauce barrel (lbs)", category: "sauce", currentValue: null },
      { key: "line.autoTrackRatePerMinute", runId: RUN_ID, label: "Line rate (cases/min)", category: "line", currentValue: null },
    ],
    { productCode: "CHEESE-16", product: null, learnedValues: [] },
  );
  assert.deepEqual(gaps[0].apply, { kind: "station_command", station: "sauce", field: "barrelLbs" });
  assert.deepEqual(gaps[1].apply, { kind: "station_command", station: "line", field: "autoTrackRatePerMinute" });
  assert.ok(gaps.every((gap) => gap.fillable === true));
});

test("detectMissingFields requires a runId", () => {
  assert.throws(() => detectMissingFields({ stationProgress: {} }), /runId is required/);
});
