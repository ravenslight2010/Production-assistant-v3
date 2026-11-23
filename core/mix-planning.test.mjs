import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMixPlan,
  finalizeMixEntry,
  ingredientNamesMatch,
  mixDaysUntil,
  mixPizzasForRun,
} from "./mix-planning.mjs";

const productId = "10000000-0000-4000-8000-000000000001";
const cheeseId = "20000000-0000-4000-8000-000000000001";
const blendId = "20000000-0000-4000-8000-000000000002";
const mixId = "30000000-0000-4000-8000-000000000001";

function run(overrides = {}) {
  return {
    key: "run:1",
    runId: "40000000-0000-4000-8000-000000000001",
    scheduleRunId: null,
    source: "live",
    label: "Run 1",
    productionDate: "2026-12-01",
    productId,
    productName: "Test Pizza",
    cases: 10,
    pizzas: 144,
    ingredients: [{ productId: cheeseId, name: "Mozzarella", ouncesPerPizza: 2 }],
    warnings: [],
    ...overrides,
  };
}

function mix(overrides = {}) {
  return {
    id: mixId,
    kind: "product",
    productId,
    name: "Cheese Mix",
    notes: "Keep cold",
    batchSizeLbs: 20,
    daysEarly: 2,
    enabled: true,
    components: [
      { ingredientProductId: cheeseId, ingredientName: "Mozzarella", ouncesPerPizza: 2 },
      { ingredientProductId: blendId, ingredientName: "Provolone", ouncesPerPizza: 1 },
    ],
    ...overrides,
  };
}

test("calendar windows and V1 pizza startup behavior are deterministic", () => {
  assert.equal(mixDaysUntil("2026-12-01", "2026-11-29"), 2);
  assert.equal(mixDaysUntil("2026-11-29", "2026-12-01"), -2);
  assert.ok(Number.isNaN(mixDaysUntil("2026-02-30", "2026-12-01")));
  assert.equal(mixPizzasForRun({ cases: 10, pizzasPerCase: 12, casesPerLayer: 2 }), 144);
  assert.equal(mixPizzasForRun({ cases: 10, pizzasPerCase: 0, casesPerLayer: 2 }), null);
});

test("product demand aggregates once and applies dated made and surplus once", () => {
  const groups = buildMixPlan({
    makeDate: "2026-11-29",
    runs: [run(), run({ key: "run:2", runId: "40000000-0000-4000-8000-000000000002" })],
    mixes: [mix()],
    operations: [{ productionDate: "2026-12-01", mixId, productId, alreadyMadeLbs: 10, actualMadeLbs: 0 }],
    surplusAllocations: [{ targetDate: "2026-12-01", mixId, productId, quantityLbs: 1.05 }],
  });
  assert.equal(groups.length, 1);
  const entry = groups[0].entries[0];
  assert.equal(entry.contributions.length, 2);
  assert.equal(entry.componentLbs, 54);
  assert.equal(entry.wasteLbs, 8.1);
  assert.equal(entry.totalLbs, 82.1);
  assert.equal(entry.alreadyMadeLbs, 11.05);
  assert.equal(entry.remainingLbs, 71.05);
  assert.ok(Math.abs(entry.batches - 3.5525) < 1e-12);
  assert.ok(Math.abs(entry.components[0].pullLbs - 36 * 71.05 / 82.1) < 1e-12);
});

test("outside-window and disabled mixes generate no entry", () => {
  assert.deepEqual(buildMixPlan({ makeDate: "2026-11-28", runs: [run()], mixes: [mix({ daysEarly: 2 })] }), []);
  assert.deepEqual(buildMixPlan({ makeDate: "2026-11-29", runs: [run()], mixes: [mix({ enabled: false })] }), []);
});

test("prep mixes use substitution-resolved identities and per-run amounts", () => {
  const prep = mix({
    kind: "prep",
    productId: null,
    components: [{ ingredientProductId: cheeseId, ingredientName: "Mozzarella", ouncesPerPizza: 9 }],
  });
  const groups = buildMixPlan({
    makeDate: "2026-12-01",
    runs: [
      run({ pizzas: 100 }),
      run({ key: "run:2", productId: "10000000-0000-4000-8000-000000000002", productName: "Other", pizzas: 200, ingredients: [{ productId: cheeseId, name: "Mozzarella - diced", ouncesPerPizza: 1.5 }] }),
    ],
    mixes: [prep],
  });
  const entry = groups[0].entries[0];
  assert.equal(entry.productId, null);
  assert.equal(entry.componentLbs, 31.25);
  assert.equal(entry.contributions.length, 2);
  assert.ok(Math.abs(entry.contributions.reduce((sum, contribution) => sum + contribution.componentLbs, 0) - entry.componentLbs) < 1e-12);
  assert.deepEqual(entry.warnings, []);
});

test("actual run zero does not silently become recipe fallback and missing amounts identify runs", () => {
  const prep = mix({ kind: "prep", productId: null, components: [{ ingredientProductId: cheeseId, ingredientName: "Mozzarella", ouncesPerPizza: 2 }] });
  const entry = buildMixPlan({
    makeDate: "2026-12-01",
    runs: [run({ ingredients: [{ productId: cheeseId, name: "Mozzarella", ouncesPerPizza: 0 }] })],
    mixes: [prep],
  })[0].entries[0];
  assert.equal(entry.componentLbs, 0);
  assert.match(entry.warnings.join(" "), /run:1/u);
});

test("missing prep amounts use recipe fallback with an explicit run warning", () => {
  const prep = mix({ kind: "prep", productId: null, components: [{ ingredientProductId: cheeseId, ingredientName: "Mozzarella", ouncesPerPizza: 2 }] });
  const entry = buildMixPlan({
    makeDate: "2026-12-01",
    runs: [run({ pizzas: 100, ingredients: [{ productId: cheeseId, name: "Mozzarella", ouncesPerPizza: null }] })],
    mixes: [prep],
  })[0].entries[0];
  assert.equal(entry.componentLbs, 12.5);
  assert.equal(entry.contributions[0].componentLbs, 12.5);
  assert.deepEqual(entry.components[0].missingRuns, ["run:1"]);
  assert.match(entry.warnings.join(" "), /missing or zero ounces per pizza for run:1/u);
});

test("V1-compatible qualified name matching excludes similar different ingredients", () => {
  assert.equal(ingredientNamesMatch("Pineapple", "Pineapple (Tidbits)"), true);
  assert.equal(ingredientNamesMatch("Pineapple", "Pineapple - Drained"), true);
  assert.equal(ingredientNamesMatch("Apple", "Applesauce"), false);
});

test("finalization scales consumption, handles under/over production, and preserves plan", () => {
  const entry = buildMixPlan({ makeDate: "2026-12-01", runs: [run()], mixes: [mix()] })[0].entries[0];
  const originalTotal = entry.totalLbs;
  const under = finalizeMixEntry(entry, 10);
  assert.equal(under.freshLbs, 10);
  assert.equal(under.surplusLbs, 0);
  assert.equal(under.consumption[0].quantityLbs, 18 * 10 / originalTotal);
  const over = finalizeMixEntry(entry, 60);
  assert.equal(over.freshLbs, 60);
  assert.equal(over.surplusLbs, 60 - entry.remainingLbs);
  const planned = finalizeMixEntry(entry, 0);
  assert.equal(planned.freshLbs, entry.remainingLbs);
  assert.equal(planned.surplusLbs, 0);
  assert.equal(entry.totalLbs, originalTotal);
});

test("a retained finalization and later demand form separate entries", () => {
  const first = run();
  const retained = buildMixPlan({ makeDate: "2026-12-01", runs: [first], mixes: [mix()] })[0].entries[0];
  const later = run({ key: "run:2", runId: "40000000-0000-4000-8000-000000000002", pizzas: 72 });
  const groups = buildMixPlan({
    makeDate: "2026-12-01",
    runs: [first, later],
    mixes: [mix()],
    finalizations: [{ productionDate: "2026-12-01", mixId, productId, contributions: retained.contributions, entry: retained, firstRunId: first.runId }],
  });
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[0].entries.filter((entry) => entry.finalized).length, 1);
  assert.equal(groups[0].entries.find((entry) => !entry.finalized).componentLbs, 13.5);
});
