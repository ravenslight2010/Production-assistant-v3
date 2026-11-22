import assert from "node:assert/strict";
import test from "node:test";
import { renderImportCsvTemplate } from "./import-csv-templates.mjs";
import { parseSetupCatalogCsv, parseSetupCatalogRecord, setupCatalogCsvTemplates } from "./setup-catalog-csv.mjs";

test("every approved setup family template parses as a strict synthetic fixture", () => {
  for (const [family, template] of Object.entries(setupCatalogCsvTemplates)) {
    const rows = parseSetupCatalogCsv(family, renderImportCsvTemplate(template));
    assert.equal(rows.length, 1, family);
    assert.equal(typeof rows[0].code, "string", family);
    assert.equal(typeof rows[0].data, "object", family);
  }
});

test("ingredient identities, reviewed-empty allergens, and mix units remain explicit", () => {
  const ingredients = parseSetupCatalogCsv(
    "ingredients",
    'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
      'ING-1,Flour,"[""dough""]","[]",true,,true\n',
  );
  assert.deepEqual(ingredients[0].data, {
    categories: ["dough"], allergens: [], allergensReviewed: true, mergedIntoCode: null, enabled: true,
  });
  const mixes = parseSetupCatalogCsv(
    "mixes",
    'code,name,brand,flavor,batch_size_lbs,days_early,notes,is_prep,enabled,components_json\n' +
      'MIX-1,Base,Brand,Original,40,2,,false,true,' +
      '"[{""ingredientName"":""Flour"",""ingredientCode"":""ING-1"",""perPizzaOz"":1.25,""perBatchLbs"":40}]"\n',
  );
  assert.deepEqual(mixes[0].data.components, [{
    ingredientName: "Flour", ingredientCode: "ING-1", perPizzaOz: 1.25, perBatchLbs: 40,
  }]);
  assert.equal(mixes[0].data.batchSizeLbs, 40);
});

test("run templates reject runtime state and temporary overrides instead of importing them", () => {
  const csv = 'code,name,brand,flavor,values_json\n' +
    'RUN-1,Setup,Brand,Plain,"{""crustsPerCycle"":12,""tempFreezerTime"":5}"\n';
  assert.throws(() => parseSetupCatalogCsv("run-templates", csv), /cannot include/u);
});

test("manager-list imports accept only named directories and preserve null values", () => {
  const csv = 'key,value_json\nrun-calc-brand-flavors,"{""value"":{""Brand"":[""Plain"",""Spicy""]}}"\n';
  const [record] = parseSetupCatalogCsv("manager-lists", csv);
  assert.deepEqual(record.data.value, { Brand: ["Plain", "Spicy"] });
  const [unscoped] = parseSetupCatalogCsv(
    "manager-lists",
    'key,value_json\nrun-calc-flavors,"{""value"":[""Plain"",""Spicy""]}"\n',
  );
  assert.deepEqual(unscoped.data.value, ["Plain", "Spicy"]);
  assert.throws(
    () => parseSetupCatalogCsv("manager-lists", 'key,value_json\narbitrary-key,"{""value"":[]}"\n'),
    /allowlist/u,
  );
  const [emptyAllergens] = parseSetupCatalogCsv(
    "ingredients",
    'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
      'ING-2,Unknown,"[]","[]",false,,true\n',
  );
  assert.equal(emptyAllergens.data.allergensReviewed, false);
  assert.deepEqual(emptyAllergens.data.allergens, []);
});

test("case-insensitive duplicate identity and unsupported fields are rejected", () => {
  assert.throws(
    () => parseSetupCatalogCsv(
      "ingredients",
      'code,name,categories_json,allergens_json,allergens_reviewed,merged_into_code,enabled\n' +
        'ING-1,Flour,"[]","[]",true,,true\ning-1,Meal,"[]","[]",true,,true\n',
    ),
    /only once/u,
  );
  assert.throws(
    () => parseSetupCatalogCsv("die-types", "name,code\nDie,DIE\n"),
    /exactly these CSV columns/u,
  );
});

test("typed editor records round-trip through every strict family parser", () => {
  for (const [family, template] of Object.entries(setupCatalogCsvTemplates)) {
    const [record] = parseSetupCatalogCsv(family, renderImportCsvTemplate(template));
    assert.deepEqual(parseSetupCatalogRecord(family, record), record, family);
  }
  assert.throws(() => parseSetupCatalogRecord("die-types", {
    code: "DIE-1", name: "Die", data: { unexpected: true },
  }), /non-canonical/u);
  assert.throws(() => parseSetupCatalogRecord("ingredients", {
    code: "ING-1", name: "Flour", data: {
      categories: [], allergens: [], allergensReviewed: true, mergedIntoCode: null, enabled: true,
    }, extra: true,
  }), /exactly code, name/u);
});


test("named recipes preserve dough variants and fixed-nine allergen review semantics", () => {
  const recipe = {
    rows: [{ ingredient: "Flour", ingredientId: "ING-1", lbs: 40 }],
    doughballWeightOz: 8,
    doughballsPerTray: 24,
    brand: "Example Brand",
    flavors: ["Original"],
    notes: "Manager-reviewed dough recipe",
    enabled: true,
    isPremadeCrust: false,
    doughballVariants: [{
      label: "8 oz / 24",
      weightOz: 8,
      perTray: 24,
      customers: [{ brand: "Example Brand", flavor: "Original" }],
    }],
  };
  const record = parseSetupCatalogRecord("manager-lists", {
    code: "run-calc-dough-recipe-presets",
    name: "run-calc-dough-recipe-presets",
    data: { key: "run-calc-dough-recipe-presets", value: { "House Dough": recipe } },
  });
  assert.deepEqual(record.data.value["House Dough"], recipe);
  assert.throws(() => parseSetupCatalogRecord("manager-lists", {
    code: "run-calc-dough-recipe-presets",
    name: "run-calc-dough-recipe-presets",
    data: { key: "run-calc-dough-recipe-presets", value: { "House Dough": {
      ...recipe,
      doughballVariants: [{ label: "Same" }, { label: " same  " }],
    } } },
  }), /distinct/u);
  assert.throws(() => parseSetupCatalogRecord("manager-lists", {
    code: "run-calc-cheese-recipe-presets",
    name: "run-calc-cheese-recipe-presets",
    data: { key: "run-calc-cheese-recipe-presets", value: { "House Dough": recipe } },
  }), /unsupported shape/u);

  const base = {
    code: "ING-ALLERGEN", name: "Ingredient", data: {
      categories: [], allergens: ["milk", "sesame"], allergensReviewed: true, mergedIntoCode: null, enabled: true,
    },
  };
  assert.deepEqual(parseSetupCatalogRecord("ingredients", base), base);
  assert.throws(() => parseSetupCatalogRecord("ingredients", {
    ...base, data: { ...base.data, allergens: ["legacy uncertain text"] },
  }), /fixed nine/u);
  assert.deepEqual(parseSetupCatalogRecord("ingredients", {
    ...base, data: { ...base.data, allergens: ["legacy uncertain text"], allergensReviewed: false },
  }).data.allergens, ["legacy uncertain text"]);
});
