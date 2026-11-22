import {
  ImportCsvError,
  parseCsvRows,
  parseImportCode,
  parseImportName,
  parseImportObjectJson,
  validateCsvHeaders,
} from "./import-csv.mjs";
import { renderImportCsvTemplate } from "./import-csv-templates.mjs";

const value = (fileName, headers, rows = []) => Object.freeze({
  fileName,
  headers: Object.freeze(headers),
  rows: Object.freeze(rows.map((row) => Object.freeze(row))),
});

const DIRECTORY_KEYS = Object.freeze([
  "run-calc-brands", "run-calc-brand-flavors", "run-calc-ingredient-types",
  "run-calc-flavors",
  "run-calc-pep-types", "run-calc-die-types", "run-calc-cheese-ingredients",
  "run-calc-dough-ingredients", "run-calc-frontline-ingredients", "run-calc-mix-ingredients",
  "run-calc-dough-recipe-names", "run-calc-dough-recipe-presets",
  "run-calc-frontline-recipe-names", "run-calc-frontline-recipe-presets",
  "run-calc-cheese-recipe-names", "run-calc-cheese-recipe-presets",
  "run-calc-mix-recipe-names", "run-calc-stop-reasons", "run-calc-circles",
  "run-calc-shippers", "run-calc-skid-stacking", "run-calc-grip-sheets",
  "run-calc-shift-start-time", "run-calc-production-start-time",
]);

const FAMILY_DEFINITIONS = Object.freeze({
  ingredients: value("ingredients-template.csv", [
    "code", "name", "categories_json", "allergens_json", "allergens_reviewed", "merged_into_code", "enabled",
  ], [["TEMPLATE-ING", "Example Ingredient", "[]", "[]", "false", "", "true"]]),
  mixes: value("mixes-template.csv", [
    "code", "name", "brand", "flavor", "batch_size_lbs", "days_early", "notes", "is_prep", "enabled", "components_json",
  ], [["TEMPLATE-MIX", "Example Mix", "Example Brand", "Example Flavor", "100", "1", "", "false", "true",
    '[{"ingredientName":"Example Ingredient","perPizzaOz":1,"perBatchLbs":10}]']]),
  "die-types": value("die-types-template.csv", ["code", "name"], [["TEMPLATE-DIE", "Example Die"]]),
  "die-line-defaults": value("die-line-defaults-template.csv", [
    "die_code", "crusts_per_cycle", "cycle_speed", "speed_adjustment", "freezer_time", "cases_per_layer",
    "pre_tunnel_min", "post_tunnel_min", "press_oven_min", "frontline_min",
  ], [["TEMPLATE-DIE", "0", "0", "1", "0", "0", "", "", "", ""]]),
  "production-rules": value("production-rules-template.csv", [
    "code", "name", "type", "enforcement", "enabled", "field", "min", "max", "attribute", "before", "after",
    "bypass_json", "checklist_json",
  ], [["TEMPLATE-RULE", "Example required field", "required-field", "flexible", "true", "brand", "", "", "", "", "", "[]", "[]"]]),
  "freezer-pull-items": value("freezer-pull-items-template.csv", [
    "code", "ingredient_name", "ingredient_code", "days_early", "enabled",
  ], [["TEMPLATE-PULL", "Example Ingredient", "", "3", "true"]]),
  "run-templates": value("run-templates-template.csv", ["code", "name", "brand", "flavor", "values_json"],
    [["TEMPLATE-RUN", "Example setup", "Example Brand", "Example Flavor", '{"crustsPerCycle":0,"allergen":"none"}']]),
  "manager-lists": value("manager-lists-template.csv", ["key", "value_json"],
    [["run-calc-brands", '{"value":["Example Brand"]}']]),
  aliases: value("aliases-template.csv", [
    "code", "alias_type", "kind", "external_name", "canonical_name", "context", "brand",
  ], [["ALIAS-EXAMPLE", "spec", "appType", "Example external name", "Example canonical name", "", ""]]),
});

export const setupCatalogCsvTemplates = Object.freeze(Object.fromEntries(
  Object.entries(FAMILY_DEFINITIONS).map(([family, definition]) => [
    family,
    definition,
  ]),
));

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const POSITIVE = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/u;
const INTEGER = /^(?:0|[1-9][0-9]{0,8})$/u;
const TEMPLATE_FIELDS = new Set([
  "crustsPerCycle", "cycleSpeed", "speedAdjustment", "approxLineSpeed", "freezerTime", "pizzasPerCase",
  "casesPerSkid", "casesPerLayer", "doughballsPerTray", "crustsPerStack", "doughBatchYield", "crustsPerCase",
  "mixerLowSec", "mixerHighSec", "hopperSec", "sauceOzPerPizza", "sauceBarrelLbs",
  "app1OzPerPizza", "app1BatchLbs", "app2OzPerPizza", "app2BatchLbs", "app3OzPerPizza", "app3BatchLbs",
  "app4OzPerPizza", "app4BatchLbs", "pep1Sticks", "pep1OzPerPizza", "pep1BatchLbs", "pep2Sticks",
  "pep2OzPerPizza", "pep2BatchLbs", "pep1SticksB", "pep1OzPerPizzaB", "pep1BatchLbsB",
  "pep2SticksB", "pep2OzPerPizzaB", "pep2BatchLbsB", "pep1Combined", "app1Type", "app2Type", "app3Type",
  "app4Type", "pep1Type", "pep2Type", "pep1TypeB", "pep2TypeB", "dieType", "allergen", "doughRecipeName",
  "targetDoughballWeight", "doughRecipe", "app1CheeseRecipeName", "app1CheeseRecipe", "app2CheeseRecipeName",
  "app2CheeseRecipe", "app3CheeseRecipeName", "app3CheeseRecipe", "app4CheeseRecipeName", "app4CheeseRecipe",
  "frontlineRecipeName", "frontlineRecipe", "cartoned", "labelPosition", "cartonsPerCase", "cartonSize",
  "labelsPerRoll", "topLabelsPerRoll", "bottomLabelsPerRoll", "circles", "shipper", "skidStacking",
  "gripSheets", "slipSheets", "preTunnelMin", "pressOvenMin", "frontlineMin", "postTunnelMin",
]);
const TEMPLATE_NUMBERS = new Set([...TEMPLATE_FIELDS].filter((field) => ![
  "pep1Combined", "app1Type", "app2Type", "app3Type", "app4Type", "pep1Type", "pep2Type", "pep1TypeB",
  "pep2TypeB", "dieType", "allergen", "doughRecipeName", "doughRecipe", "app1CheeseRecipeName",
  "app1CheeseRecipe", "app2CheeseRecipeName", "app2CheeseRecipe", "app3CheeseRecipeName",
  "app3CheeseRecipe", "app4CheeseRecipeName", "app4CheeseRecipe", "frontlineRecipeName",
  "frontlineRecipe", "cartoned", "labelPosition", "circles", "shipper", "skidStacking", "gripSheets",
  "slipSheets",
].includes(field)));
const STRING_LIST_DIRECTORY_KEYS = new Set(DIRECTORY_KEYS.filter((key) =>
  !["run-calc-brand-flavors", "run-calc-dough-recipe-presets", "run-calc-frontline-recipe-presets",
    "run-calc-cheese-recipe-presets", "run-calc-shift-start-time", "run-calc-production-start-time"].includes(key)));
const RECIPE_DIRECTORY_KEYS = new Set([
  "run-calc-dough-recipe-presets", "run-calc-frontline-recipe-presets", "run-calc-cheese-recipe-presets",
]);
export const setupAllergenOptions = Object.freeze([
  "milk", "eggs", "fish", "crustacean shellfish", "tree nuts", "peanuts", "wheat", "soybeans", "sesame",
]);
const ALLERGEN_OPTIONS = new Set(setupAllergenOptions);
const RECIPE_FIELDS = new Set([
  "rows", "doughballWeightOz", "doughballsPerTray", "brand", "flavors", "notes", "enabled",
  "isPremadeCrust", "doughballVariants",
]);
const DOUGH_ONLY_FIELDS = new Set(["isPremadeCrust", "doughballVariants"]);
const JSON_FAMILIES = Object.freeze(Object.keys(FAMILY_DEFINITIONS));

function fail(message, row, field) {
  throw new ImportCsvError(message, row, field);
}

function parseBoolean(input, row, field) {
  if (input === "true") return true;
  if (input === "false") return false;
  fail("Use exactly true or false.", row, field);
}

function parseNumber(input, row, field, { optional = false, integer = false } = {}) {
  if (optional && input === "") return null;
  if (!(integer ? INTEGER : POSITIVE).test(input)) {
    fail(integer ? "Enter a non-negative whole number." : "Enter a non-negative number with up to six decimals.", row, field);
  }
  const result = Number(input);
  if (!Number.isFinite(result)) fail("Enter a finite number.", row, field);
  return result;
}

function parseJson(input, row, field, expectedType) {
  if (input.length > 20_000) fail("JSON data must be 20,000 characters or less.", row, field);
  let parsed;
  try { parsed = JSON.parse(input); } catch { fail("Enter valid JSON data.", row, field); }
  if ((expectedType === "array" && !Array.isArray(parsed))
    || (expectedType === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed)))) {
    fail(`JSON data must be an ${expectedType}.`, row, field);
  }
  let count = 0;
  const pending = [{ item: parsed, depth: 1 }];
  while (pending.length) {
    const { item, depth } = pending.pop();
    if (++count > 1000 || depth > 10) fail("JSON data is too complex.", row, field);
    if (item && typeof item === "object") {
      for (const child of Object.values(item)) pending.push({ item: child, depth: depth + 1 });
    } else if (typeof item === "number" && !Number.isFinite(item)) fail("JSON numbers must be finite.", row, field);
  }
  return parsed;
}

function requireStringList(input, row, field) {
  const list = parseJson(input, row, field, "array");
  if (list.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 200)) {
    fail("List values must be non-empty text entries of at most 200 characters.", row, field);
  }
  return list;
}

function validateRecipeRows(rows, row, field) {
  if (rows && !Array.isArray(rows)) fail("Recipe presets must be arrays of recipe rows.", row, field);
  if (rows?.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry)
    || typeof entry.ingredient !== "string" || !entry.ingredient.trim()
    || Object.keys(entry).some((key) => !["ingredient", "ingredientId", "lbs"].includes(key))
    || !Number.isFinite(Number(entry.lbs)) || Number(entry.lbs) < 0
    || (entry.ingredientId !== undefined && typeof entry.ingredientId !== "string"))) {
    fail("Recipe presets may contain only ingredient, optional identity, and non-negative pounds.", row, field);
  }
}

function optionalPositiveNumber(value) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1_000_000);
}

function optionalText(value, maximum, { empty = true } = {}) {
  return value === undefined || (typeof value === "string" && value.length <= maximum
    && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
}

function validateRecipePreset(recipe, listKey, row) {
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)
    || Object.keys(recipe).some((field) => !RECIPE_FIELDS.has(field)
      || (DOUGH_ONLY_FIELDS.has(field) && listKey !== "run-calc-dough-recipe-presets"))
    || !Array.isArray(recipe.rows) || recipe.rows.length > 500) {
    fail("A recipe preset has an unsupported shape.", row, "value_json");
  }
  validateRecipeRows(recipe.rows, row, "value_json");
  if (!optionalPositiveNumber(recipe.doughballWeightOz)
    || !optionalPositiveNumber(recipe.doughballsPerTray)
    || (recipe.doughballsPerTray !== undefined && !Number.isSafeInteger(recipe.doughballsPerTray))
    || !optionalText(recipe.brand, 200) || !optionalText(recipe.notes, 2000)
    || (recipe.enabled !== undefined && typeof recipe.enabled !== "boolean")
    || (recipe.isPremadeCrust !== undefined && typeof recipe.isPremadeCrust !== "boolean")
    || (recipe.flavors !== undefined && (!Array.isArray(recipe.flavors) || recipe.flavors.length > 100
      || recipe.flavors.some((flavor) => typeof flavor !== "string" || !flavor.trim() || flavor.length > 200)))) {
    fail("Recipe metadata, doughball values, and enabled state are invalid.", row, "value_json");
  }
  if (recipe.doughballVariants === undefined) return;
  if (!Array.isArray(recipe.doughballVariants) || recipe.doughballVariants.length > 100) {
    fail("Doughball variants must be a bounded list.", row, "value_json");
  }
  const labels = new Set();
  for (const variant of recipe.doughballVariants) {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)
      || Object.keys(variant).some((field) => !["label", "weightOz", "perTray", "customers"].includes(field))
      || typeof variant.label !== "string" || !variant.label.trim() || variant.label.length > 120
      || !optionalPositiveNumber(variant.weightOz) || !optionalPositiveNumber(variant.perTray)
      || (variant.perTray !== undefined && !Number.isSafeInteger(variant.perTray))
      || (variant.customers !== undefined && (!Array.isArray(variant.customers) || variant.customers.length > 500
        || variant.customers.some((customer) => !customer || typeof customer !== "object" || Array.isArray(customer)
          || Object.keys(customer).sort().join("\u0000") !== "brand\u0000flavor"
          || typeof customer.brand !== "string" || !customer.brand.trim() || customer.brand.length > 200
          || typeof customer.flavor !== "string" || !customer.flavor.trim() || customer.flavor.length > 200)))) {
      fail("Each doughball variant needs a label, positive optional values, and valid customer pairings.", row, "value_json");
    }
    const label = variant.label.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
    if (labels.has(label)) fail("Doughball variant labels must be distinct.", row, "value_json");
    labels.add(label);
  }
}

function validateRunTemplate(values, row) {
  for (const key of Object.keys(values)) {
    if (!TEMPLATE_FIELDS.has(key)) fail(`Run templates cannot include the "${key}" field.`, row, "values_json");
    const item = values[key];
    if (TEMPLATE_NUMBERS.has(key) && item !== null
      && (typeof item !== "number" || !Number.isFinite(item) || item < 0)) {
      fail(`The "${key}" field must be a non-negative number.`, row, "values_json");
    }
    if (!TEMPLATE_NUMBERS.has(key) && !["doughRecipe", "app1CheeseRecipe", "app2CheeseRecipe",
      "app3CheeseRecipe", "app4CheeseRecipe", "frontlineRecipe"].includes(key)
      && typeof item !== "string" && typeof item !== "boolean" && item !== null) {
      fail(`The "${key}" field has an unsupported value.`, row, "values_json");
    }
    if (key.endsWith("Recipe") && Array.isArray(item)) validateRecipeRows(item, row, "values_json");
  }
}

function parseRecord(family, cells, row) {
  const headers = FAMILY_DEFINITIONS[family].headers;
  const pick = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  if (family === "manager-lists") {
    const key = pick.key.trim();
    if (!DIRECTORY_KEYS.includes(key)) fail("This manager list is not in the approved setup directory allowlist.", row, "key");
    const parsed = parseJson(pick.value_json, row, "value_json", "object");
    if (!Object.hasOwn(parsed, "value") || Object.keys(parsed).length !== 1) {
      fail('Wrap the preserved list value in an object with exactly one "value" field.', row, "value_json");
    }
    const listValue = parsed.value;
    if (STRING_LIST_DIRECTORY_KEYS.has(key)) {
      if (!Array.isArray(listValue) || listValue.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)) {
        fail("This directory must be a list of non-empty text values.", row, "value_json");
      }
    } else if (key === "run-calc-brand-flavors") {
      if (!listValue || typeof listValue !== "object" || Array.isArray(listValue)
        || Object.entries(listValue).some(([brand, flavors]) => !brand.trim() || !Array.isArray(flavors)
          || flavors.some((flavor) => typeof flavor !== "string" || !flavor.trim() || flavor.length > 200))) {
        fail("Brand flavors must map each brand to a list of non-empty flavor names.", row, "value_json");
      }
    } else if (RECIPE_DIRECTORY_KEYS.has(key)) {
      if (!listValue || typeof listValue !== "object" || Array.isArray(listValue)) {
        fail("Recipe presets must be an object keyed by recipe name.", row, "value_json");
      }
      if (Object.keys(listValue).length > 2000
        || Object.keys(listValue).some((name) => !name.trim() || name.length > 200)) {
        fail("Recipe preset names must be non-empty and bounded.", row, "value_json");
      }
      for (const recipe of Object.values(listValue)) validateRecipePreset(recipe, key, row);
    } else if (typeof listValue !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(listValue)) {
      fail("Shift and production start times must use HH:MM.", row, "value_json");
    }
    return { code: key, name: key, data: { key, value: listValue } };
  }
  if (family === "aliases") {
    const code = parseImportCode(pick.code, row);
    const aliasType = pick.alias_type;
    const kinds = aliasType === "spec"
      ? new Set([
        "brand", "flavor", "appType", "pepType", "cheeseIngredient", "doughIngredient",
        "sauceIngredient", "recipeName", "dieType", "crossFamilyRouting",
      ])
      : aliasType === "merge"
        ? new Set(["ingredient", "mixes", "dough", "sauce", "cheese", "brand", "flavor"])
        : null;
    if (!kinds || !kinds.has(pick.kind)) fail("Choose a supported alias type and kind.", row, "kind");
    const externalName = parseImportName(pick.external_name, row, "external_name");
    const canonicalName = parseImportName(pick.canonical_name, row, "canonical_name");
    const context = pick.context.trim() || null;
    const brand = pick.brand.trim() || null;
    if (aliasType === "spec" && pick.kind === "flavor" && !context) {
      fail("Flavor spec aliases require an explicit brand context.", row, "context");
    }
    if (aliasType === "spec" && pick.kind === "recipeName" && !["dough", "sauce"].includes(context)) {
      fail("Recipe-name aliases require a dough or sauce context.", row, "context");
    }
    if (aliasType === "spec" && pick.kind === "crossFamilyRouting" && !["cheese", "mix"].includes(context)) {
      fail("Cross-family aliases require a cheese or mix context.", row, "context");
    }
    if (aliasType === "merge" && pick.kind === "flavor" && !brand) {
      fail("Flavor merge aliases require an explicit brand.", row, "brand");
    }
    return { code, name: externalName, data: { aliasType, kind: pick.kind, externalName, canonicalName, context, brand } };
  }
  if (family === "ingredients") {
    const code = parseImportCode(pick.code, row);
    const name = parseImportName(pick.name, row);
    const categories = requireStringList(pick.categories_json, row, "categories_json");
    const allergens = requireStringList(pick.allergens_json, row, "allergens_json");
    if (new Set(allergens.map((item) => item.toLocaleLowerCase("en-US"))).size !== allergens.length) {
      fail("An allergen may appear only once.", row, "allergens_json");
    }
    const allergensReviewed = parseBoolean(pick.allergens_reviewed, row, "allergens_reviewed");
    if (allergensReviewed && allergens.some((item) => !ALLERGEN_OPTIONS.has(item))) {
      fail("A reviewed allergen mapping may contain only the fixed nine allergen options.", row, "allergens_json");
    }
    return { code, name, data: { categories, allergens, allergensReviewed, mergedIntoCode: pick.merged_into_code.trim() ? parseImportCode(pick.merged_into_code, row, "merged_into_code") : null, enabled: parseBoolean(pick.enabled, row, "enabled") } };
  }
  if (family === "mixes") {
    const code = parseImportCode(pick.code, row);
    const name = parseImportName(pick.name, row);
    const components = parseJson(pick.components_json, row, "components_json", "array");
    if (components.length === 0 || components.some((item) => !item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => !["ingredientName", "ingredientCode", "perPizzaOz", "perBatchLbs"].includes(key))
      || typeof item.ingredientName !== "string" || !item.ingredientName.trim()
      || (item.ingredientCode != null && (typeof item.ingredientCode !== "string" || !CODE.test(item.ingredientCode)))
      || (item.perPizzaOz != null && (typeof item.perPizzaOz !== "number" || !Number.isFinite(item.perPizzaOz) || item.perPizzaOz < 0))
      || (item.perBatchLbs != null && (typeof item.perBatchLbs !== "number" || !Number.isFinite(item.perBatchLbs) || item.perBatchLbs < 0))
      || (item.perPizzaOz == null && item.perBatchLbs == null))) {
      fail("Each mix component needs a name, at least one quantity, and optional explicit ingredient code.", row, "components_json");
    }
    return { code, name, data: {
      brand: pick.brand, flavor: pick.flavor,
      batchSizeLbs: parseNumber(pick.batch_size_lbs, row, "batch_size_lbs", { optional: true }),
      daysEarly: parseNumber(pick.days_early, row, "days_early", { optional: true, integer: true }),
      notes: pick.notes, isPrep: parseBoolean(pick.is_prep, row, "is_prep"),
      enabled: parseBoolean(pick.enabled, row, "enabled"), components,
    } };
  }
  if (family === "die-types") {
    return { code: parseImportCode(pick.code, row), name: parseImportName(pick.name, row), data: {} };
  }
  if (family === "die-line-defaults") {
    const dieCode = parseImportCode(pick.die_code, row, "die_code");
    const required = ["crusts_per_cycle", "cycle_speed", "speed_adjustment", "freezer_time", "cases_per_layer"];
    const data = {};
    for (const field of required) data[field] = parseNumber(pick[field], row, field);
    for (const field of ["pre_tunnel_min", "post_tunnel_min", "press_oven_min", "frontline_min"]) {
      data[field] = parseNumber(pick[field], row, field, { optional: true });
    }
    return { code: dieCode, name: dieCode, data };
  }
  if (family === "production-rules") {
    const code = parseImportCode(pick.code, row);
    const name = parseImportName(pick.name, row);
    if (!["required-field", "numeric-range", "sequence"].includes(pick.type)) fail("Choose a supported production rule type.", row, "type");
    if (!["flexible", "strict"].includes(pick.enforcement)) fail("Choose flexible or strict enforcement.", row, "enforcement");
    const bypass = parseJson(pick.bypass_json, row, "bypass_json", "array");
    const checklist = parseJson(pick.checklist_json, row, "checklist_json", "array");
    if (bypass.some((item) => !item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => !["field", "value"].includes(key))
      || typeof item.field !== "string" || typeof item.value !== "string")
      || checklist.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)) {
      fail("Use only valid bypass conditions and checklist labels.", row, "bypass_json");
    }
    const data = {
      type: pick.type, enforcement: pick.enforcement, enabled: parseBoolean(pick.enabled, row, "enabled"),
      field: pick.field || null, min: pick.min === "" ? null : parseNumber(pick.min, row, "min"),
      max: pick.max === "" ? null : parseNumber(pick.max, row, "max"), attribute: pick.attribute || null,
      before: pick.before || null, after: pick.after || null, bypass, checklist,
    };
    if (data.min !== null && data.max !== null && data.min > data.max) fail("Minimum cannot exceed maximum.", row, "min");
    return { code, name, data };
  }
  if (family === "freezer-pull-items") {
    const code = parseImportCode(pick.code, row);
    const ingredientName = parseImportName(pick.ingredient_name, row, "ingredient_name");
    return { code, name: ingredientName, data: {
      ingredientName, ingredientCode: pick.ingredient_code.trim() ? parseImportCode(pick.ingredient_code, row, "ingredient_code") : null,
      daysEarly: parseNumber(pick.days_early, row, "days_early", { integer: true }),
      enabled: parseBoolean(pick.enabled, row, "enabled"),
    } };
  }
  if (family === "run-templates") {
    const code = parseImportCode(pick.code, row);
    const name = parseImportName(pick.name, row);
    const values = parseImportObjectJson(pick.values_json, row, "values_json");
    validateRunTemplate(values, row);
    return { code, name, data: { brand: pick.brand || null, flavor: pick.flavor || null, values } };
  }
  fail("Choose a supported setup family.", row);
}

export function parseSetupCatalogCsv(family, csv) {
  const definition = FAMILY_DEFINITIONS[family];
  if (!definition) fail("Choose a supported setup family.");
  const rows = validateCsvHeaders(parseCsvRows(csv), definition.headers);
  const seen = new Set();
  const aliasIdentities = new Set();
  const records = rows.map((cells, index) => {
    const rowNumber = index + 2;
    const record = parseRecord(family, cells, rowNumber);
    const normalized = record.code.toLocaleLowerCase("en-US");
    if (seen.has(normalized)) fail("A code or identity may appear only once in this import.", rowNumber, "code");
    seen.add(normalized);
    if (family === "aliases") {
      const identity = [
        record.data.aliasType, record.data.kind, record.data.brand?.toLocaleLowerCase("en-US") ?? "",
        record.data.context?.toLocaleLowerCase("en-US") ?? "",
        record.data.externalName.toLocaleLowerCase("en-US"),
      ].join("\u0000");
      if (aliasIdentities.has(identity)) fail("An alias identity may appear only once in this import.", rowNumber, "external_name");
      aliasIdentities.add(identity);
    }
    return record;
  });
  if (records.length > 2000) fail("CSV files may contain at most 2,000 data rows.");
  return records;
}

function recordCells(family, record) {
  const { code, name, data } = record;
  switch (family) {
    case "ingredients":
      return [code, name, JSON.stringify(data.categories), JSON.stringify(data.allergens),
        String(data.allergensReviewed), data.mergedIntoCode ?? "", String(data.enabled)];
    case "mixes":
      return [code, name, data.brand, data.flavor, data.batchSizeLbs ?? "", data.daysEarly ?? "",
        data.notes, String(data.isPrep), String(data.enabled), JSON.stringify(data.components)];
    case "die-types":
      return [code, name];
    case "die-line-defaults":
      return [code, data.crusts_per_cycle, data.cycle_speed, data.speed_adjustment,
        data.freezer_time, data.cases_per_layer, data.pre_tunnel_min ?? "", data.post_tunnel_min ?? "",
        data.press_oven_min ?? "", data.frontline_min ?? ""];
    case "production-rules":
      return [code, name, data.type, data.enforcement, String(data.enabled), data.field ?? "",
        data.min ?? "", data.max ?? "", data.attribute ?? "", data.before ?? "", data.after ?? "",
        JSON.stringify(data.bypass), JSON.stringify(data.checklist)];
    case "freezer-pull-items":
      return [code, data.ingredientName, data.ingredientCode ?? "", data.daysEarly, String(data.enabled)];
    case "run-templates":
      return [code, name, data.brand ?? "", data.flavor ?? "", JSON.stringify(data.values)];
    case "manager-lists":
      return [code, JSON.stringify({ value: data.value })];
    case "aliases":
      return [code, data.aliasType, data.kind, data.externalName, data.canonicalName,
        data.context ?? "", data.brand ?? ""];
    default:
      fail("Choose a supported setup family.");
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

/** Validate one typed editor record through the exact same family parser used by CSV imports. */
export function parseSetupCatalogRecord(family, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== "code\u0000data\u0000name") {
    fail("A setup record must contain exactly code, name, and family-specific data.", 2);
  }
  const definition = FAMILY_DEFINITIONS[family];
  if (!definition) fail("Choose a supported setup family.", 2);
  const cells = recordCells(family, value);
  const csv = renderImportCsvTemplate({ fileName: definition.fileName, headers: definition.headers, rows: [cells] });
  const [record] = parseSetupCatalogCsv(family, csv);
  if (JSON.stringify(canonicalValue(record)) !== JSON.stringify(canonicalValue(value))) {
    fail("The setup record contains unsupported or non-canonical values.", 2);
  }
  return record;
}

export const setupCatalogRunTemplateFields = Object.freeze([...TEMPLATE_FIELDS].map((key) => Object.freeze({
  key,
  kind: key.endsWith("Recipe") && !key.endsWith("RecipeName")
    ? "recipe"
    : TEMPLATE_NUMBERS.has(key) ? "number" : key === "cartoned" ? "boolean" : "text",
})));

export const setupCatalogCsvLimits = Object.freeze({
  families: JSON_FAMILIES,
  directoryKeys: DIRECTORY_KEYS,
  maxRows: 2000,
});
