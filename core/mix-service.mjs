import { createHash } from "node:crypto";
import { isValidMixDate } from "./mix-planning.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/u;
const MAX_QUANTITY = 999_999_999_999.999999;
const SQL = {
  recipes: "SELECT v3.list_mix_recipes($1::uuid) AS result",
  plan: "SELECT v3.get_mix_plan($1::uuid, $2::date) AS result",
  surplus: "SELECT v3.get_mix_surplus($1::uuid) AS result",
  recipeCommand: `SELECT v3.apply_mix_recipe_command(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::jsonb
  ) AS result`,
  planCommand: `SELECT v3.apply_mix_plan_command(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::jsonb
  ) AS result`,
  surplusCommand: `SELECT v3.apply_mix_surplus_command(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::jsonb
  ) AS result`,
};

export class MixServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "MixServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  return new MixServiceError("INVALID_REQUEST", message, 400);
}

function invalidStorage(message = "Mix Plan storage returned an invalid response.") {
  return new MixServiceError("INVALID_STORAGE_RESPONSE", message, 502);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, message = "The request contains missing or unsupported fields.") {
  if (!isObject(value)) throw invalid("The Mix Plan request must be an object.");
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw invalid(message);
}

function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw invalid(`${field} must be a UUID.`);
  return value.toLowerCase();
}

function nullableUuid(value, field) {
  return value === null ? null : uuid(value, field);
}

function decimal(value, field, { positive = false } = {}) {
  if (typeof value !== "string" || !DECIMAL.test(value) || Number(value) > MAX_QUANTITY
    || (positive && Number(value) <= 0)) {
    throw invalid(`${field} must be ${positive ? "a positive" : "a non-negative"} decimal with at most six fractional digits.`);
  }
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid("Expected revision must be a non-negative safe integer.");
  return value;
}

function text(value, field, maximum, { minimum = 0, trim = false } = {}) {
  if (typeof value !== "string") throw invalid(`${field} must be text.`);
  const result = trim ? value.trim() : value;
  if (result.length < minimum || result.length > maximum) throw invalid(`${field} must be ${minimum}–${maximum} characters.`);
  return result;
}

function identity(auth, write = false) {
  if (auth?.verified !== true) {
    throw new MixServiceError("UNAUTHENTICATED", "Sign in to access the Mix Plan.", 401);
  }
  if (write && (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("manage-inventory"))) {
    throw new MixServiceError("FORBIDDEN", "Inventory-manager permission is required for this Mix Plan change.", 403);
  }
  try {
    return { facilityId: uuid(auth.facilityId, "facilityId"), actorId: uuid(auth.actorId, "actorId") };
  } catch {
    throw new MixServiceError("UNAUTHENTICATED", "Verified facility and staff identity are required.", 401);
  }
}

export function normalizeMixRecipeCommand(command) {
  if (!isObject(command) || typeof command.type !== "string") throw invalid("Choose a mix recipe change.");
  if (command.type === "disable") {
    exactKeys(command, ["type", "mixId"]);
    return { type: "disable", mixId: uuid(command.mixId, "mixId") };
  }
  if (command.type !== "upsert") throw invalid("Choose an upsert or disable mix recipe command.");
  exactKeys(command, ["type", "recipe"]);
  exactKeys(command.recipe, ["id", "kind", "productId", "name", "notes", "batchSizeLbs", "daysEarly", "enabled", "components"]);
  const recipe = command.recipe;
  if (recipe.id !== null && (typeof recipe.id !== "string" || !UUID.test(recipe.id))) {
    throw invalid("Recipe ID must be null or a UUID.");
  }
  if (!["product", "prep"].includes(recipe.kind)) throw invalid("Choose a product or prep mix.");
  if ((recipe.kind === "product" && (typeof recipe.productId !== "string" || !UUID.test(recipe.productId)))
    || (recipe.kind === "prep" && recipe.productId !== null)) {
    throw invalid("The recipe product does not match the mix kind.");
  }
  if (!Number.isSafeInteger(recipe.daysEarly) || recipe.daysEarly < 0 || recipe.daysEarly > 365) {
    throw invalid("Days early must be a whole number from 0 to 365.");
  }
  if (typeof recipe.enabled !== "boolean") throw invalid("Recipe enabled state must be true or false.");
  if (!Array.isArray(recipe.components) || recipe.components.length < 1 || recipe.components.length > 100) {
    throw invalid("A mix recipe requires 1–100 ordered components.");
  }
  const name = text(recipe.name, "Recipe name", 120, { minimum: 1, trim: true });
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw invalid("Recipe name cannot contain control characters.");
  return {
    type: "upsert",
    recipe: {
      id: recipe.id === null ? null : recipe.id.toLowerCase(),
      kind: recipe.kind,
      productId: recipe.kind === "product" ? recipe.productId.toLowerCase() : null,
      name,
      notes: text(recipe.notes, "Recipe notes", 2000),
      batchSizeLbs: decimal(recipe.batchSizeLbs, "Batch size"),
      daysEarly: recipe.daysEarly,
      enabled: recipe.enabled,
      components: recipe.components.map((component) => {
        exactKeys(component, ["ingredientProductId", "ouncesPerPizza", "referencePoundsPerBatch"]);
        return {
          ingredientProductId: uuid(component.ingredientProductId, "ingredientProductId"),
          ouncesPerPizza: decimal(component.ouncesPerPizza, "Ounces per pizza"),
          referencePoundsPerBatch: component.referencePoundsPerBatch === null
            ? null
            : decimal(component.referencePoundsPerBatch, "Reference pounds per batch"),
        };
      }),
    },
  };
}

export function normalizeMixPlanCommand(command) {
  exactKeys(command, ["type", "productionDate", "mixId", "productId", "alreadyMadeLbs", "actualMadeLbs"]);
  if (command.type !== "set-amount") throw invalid("Choose a set-amount Mix Plan command.");
  if (!isValidMixDate(command.productionDate)) throw invalid("Choose a valid production date.");
  return {
    type: "set-amount",
    productionDate: command.productionDate,
    mixId: uuid(command.mixId, "mixId"),
    productId: nullableUuid(command.productId, "productId"),
    alreadyMadeLbs: decimal(command.alreadyMadeLbs, "Already-made pounds"),
    actualMadeLbs: decimal(command.actualMadeLbs, "Actual-made pounds"),
  };
}

export function normalizeMixSurplusCommand(command) {
  if (!isObject(command) || typeof command.type !== "string") throw invalid("Choose a mix surplus change.");
  if (command.type === "record") {
    exactKeys(command, ["type", "mixId", "productId", "productionDate", "quantityLbs", "location"]);
    if (!isValidMixDate(command.productionDate)) throw invalid("Choose a valid surplus production date.");
    return {
      type: "record",
      mixId: uuid(command.mixId, "mixId"),
      productId: nullableUuid(command.productId, "productId"),
      productionDate: command.productionDate,
      quantityLbs: decimal(command.quantityLbs, "Surplus pounds", { positive: true }),
      location: text(command.location, "Surplus location", 120, { trim: true }),
    };
  }
  if (command.type === "allocate") {
    exactKeys(command, ["type", "lotId", "targetDate", "quantityLbs"]);
    if (!isValidMixDate(command.targetDate)) throw invalid("Choose a valid surplus target date.");
    return {
      type: "allocate",
      lotId: uuid(command.lotId, "lotId"),
      targetDate: command.targetDate,
      quantityLbs: decimal(command.quantityLbs, "Allocated pounds"),
    };
  }
  if (command.type === "void") {
    exactKeys(command, ["type", "lotId"]);
    return { type: "void", lotId: uuid(command.lotId, "lotId") };
  }
  throw invalid("Choose a record, allocate, or void surplus command.");
}

function validUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

function validNullableUuid(value) {
  return value === null || validUuid(value);
}

function validDate(value) {
  return isValidMixDate(value);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validDecimalText(value, positive = false) {
  return typeof value === "string" && DECIMAL.test(value) && Number(value) <= MAX_QUANTITY
    && (!positive || Number(value) > 0);
}

function validNumber(value, { integer = false, nullable = false } = {}) {
  if (nullable && value === null) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value));
}

function validText(value, maximum = 10_000) {
  return typeof value === "string" && value.length <= maximum;
}

function validProduct(value) {
  return isObject(value) && validUuid(value.productId) && validText(value.productCode, 80)
    && validText(value.productName, 120) && validText(value.baseUnit, 16);
}

function validRecipe(value) {
  return isObject(value) && validUuid(value.id) && ["product", "prep"].includes(value.kind)
    && (value.kind === "product" ? validUuid(value.productId) && validText(value.productName, 120) : value.productId === null && value.productName === null)
    && validText(value.name, 120) && validText(value.notes, 2000) && validDecimalText(value.batchSizeLbs)
    && validNumber(value.daysEarly, { integer: true }) && value.daysEarly <= 365 && typeof value.enabled === "boolean"
    && validNumber(value.revision, { integer: true }) && validTimestamp(value.updatedAt)
    && Array.isArray(value.components) && value.components.length <= 100 && value.components.every((component) =>
      isObject(component) && validUuid(component.ingredientProductId) && validText(component.ingredientName, 120)
      && validDecimalText(component.ouncesPerPizza)
      && (component.referencePoundsPerBatch === null || validDecimalText(component.referencePoundsPerBatch)));
}

function validCatalog(value) {
  return isObject(value) && Array.isArray(value.recipes) && value.recipes.length <= 10_000
    && value.recipes.every(validRecipe) && Array.isArray(value.products) && value.products.length <= 10_000
    && value.products.every(validProduct);
}

function validContribution(value) {
  return isObject(value) && validText(value.key, 500) && validNullableUuid(value.runId)
    && validNullableUuid(value.scheduleRunId) && ["schedule", "live"].includes(value.source)
    && validText(value.label, 500) && validNullableUuid(value.productId) && validText(value.productName, 120)
    && validNumber(value.cases) && validNumber(value.pizzas) && validNumber(value.componentLbs)
    && Array.isArray(value.warnings) && value.warnings.every((warning) => validText(warning, 2000))
    && (value.ingredients === undefined || (Array.isArray(value.ingredients) && value.ingredients.every((ingredient) =>
      isObject(ingredient) && validNullableUuid(ingredient.productId) && validText(ingredient.name, 120)
      && (ingredient.ouncesPerPizza === null || validNumber(ingredient.ouncesPerPizza)))));
}

function validEntry(value) {
  return isObject(value) && validText(value.key, 500) && validDate(value.productionDate)
    && validNumber(value.daysUntil, { integer: true }) && validUuid(value.mixId) && ["product", "prep"].includes(value.kind)
    && validNullableUuid(value.productId) && (value.productName === null || validText(value.productName, 120))
    && validText(value.name, 120) && validText(value.notes, 2000)
    && ["batchSizeLbs", "componentLbs", "wasteLbs", "startupLbs", "totalLbs", "manualAlreadyMadeLbs",
      "allocatedSurplusLbs", "alreadyMadeLbs", "remainingLbs", "actualMadeLbs"].every((key) => validNumber(value[key]))
    && validNumber(value.batches, { nullable: true }) && validNumber(value.revision, { integer: true })
    && Array.isArray(value.components) && value.components.length <= 100 && value.components.every((component) =>
      isObject(component) && validUuid(component.ingredientProductId) && validText(component.ingredientName, 120)
      && validNumber(component.referencePoundsPerBatch, { nullable: true }) && validNumber(component.plannedLbs)
      && validNumber(component.pullLbs) && Array.isArray(component.missingRuns)
      && component.missingRuns.every((run) => validText(run, 500)))
    && Array.isArray(value.contributions) && value.contributions.every(validContribution)
    && Array.isArray(value.warnings) && value.warnings.every((warning) => validText(warning, 2000))
    && typeof value.finalized === "boolean"
    && (value.finalization === null || (isObject(value.finalization)
      && ["actualMadeLbs", "freshLbs", "surplusLbs"].every((key) => validNumber(value.finalization[key]))
      && validUuid(value.finalization.firstRunId) && validTimestamp(value.finalization.createdAt)
      && Array.isArray(value.finalization.contributions) && value.finalization.contributions.every(validContribution)));
}

function validPlan(value, makeDate) {
  return isObject(value) && value.makeDate === makeDate && validTimestamp(value.derivedAt)
    && Array.isArray(value.groups) && value.groups.length <= 367 && value.groups.every((group) =>
      isObject(group) && validDate(group.productionDate) && validNumber(group.daysUntil, { integer: true })
      && Array.isArray(group.entries) && group.entries.every(validEntry));
}

function validSurplus(value) {
  return isObject(value) && validNumber(value.revision, { integer: true }) && Array.isArray(value.lots)
    && value.lots.length <= 10_000 && value.lots.every((lot) => isObject(lot) && validUuid(lot.id) && validUuid(lot.mixId)
      && validNullableUuid(lot.productId) && validText(lot.mixName, 120)
      && (lot.productName === null || validText(lot.productName, 120)) && validDate(lot.productionDate)
      && ["manual", "automatic"].includes(lot.source)
      && ["amountMadeLbs", "surplusLbs", "allocatedLbs", "remainingLbs"].every((key) => validDecimalText(lot[key]))
      && validText(lot.location, 120) && validNullableUuid(lot.sourceFinalizationRunId) && typeof lot.voided === "boolean"
      && validTimestamp(lot.createdAt) && Array.isArray(lot.allocations) && lot.allocations.every((allocation) =>
        isObject(allocation) && validUuid(allocation.id) && validDate(allocation.targetDate)
        && validDecimalText(allocation.quantityLbs, true) && validTimestamp(allocation.createdAt)));
}

function storageError(error) {
  if (["P0002", "23505", "40001", "22003", "55000"].includes(error?.code)) {
    throw new MixServiceError("MIX_CONFLICT", "The Mix Plan changed or the requested state is no longer available. Refresh and review it again.", 409);
  }
  if (error?.code === "42501") {
    throw new MixServiceError("FORBIDDEN", "This Mix Plan is not available to your account.", 403);
  }
  if (["22023", "22P02", "23514"].includes(error?.code)) {
    throw new MixServiceError("INVALID_REQUEST", "The Mix Plan change contains invalid values or references.", 400);
  }
  throw error;
}

function commandResult(value, { requestId, channel, makeDate }) {
  if (!isObject(value) || typeof value.replayed !== "boolean" || !["accepted", "conflict"].includes(value.outcome)) {
    throw invalidStorage();
  }
  const stateKey = channel === "recipes" ? "catalog" : channel === "plan" ? "plan" : "surplus";
  const state = value[stateKey];
  if (channel === "recipes" ? !validCatalog(state) : channel === "plan" ? !validPlan(state, makeDate) : !validSurplus(state)) {
    throw invalidStorage();
  }
  if (value.outcome === "conflict") return value;
  if (value.requestId !== requestId || (channel === "recipes" && !validRecipe(value.recipe))) throw invalidStorage();
  return value;
}

export function createMixService({ query }) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");

  async function read(auth, channel, makeDate) {
    const principal = identity(auth);
    if (channel === "plan" && !isValidMixDate(makeDate)) throw invalid("Choose a valid Mix Plan make date.");
    let result;
    try {
      result = await query(SQL[channel], channel === "plan" ? [principal.facilityId, makeDate] : [principal.facilityId]);
    } catch (error) {
      storageError(error);
    }
    const value = result?.rows?.[0]?.result;
    if (channel === "recipes" ? !validCatalog(value) : channel === "plan" ? !validPlan(value, makeDate) : !validSurplus(value)) {
      throw invalidStorage();
    }
    return value;
  }

  async function execute({ auth, requestId, expectedRevision, command, channel }) {
    const principal = identity(auth, true);
    const commandId = uuid(requestId, "requestId");
    revision(expectedRevision);
    const normalize = channel === "recipes" ? normalizeMixRecipeCommand
      : channel === "plan" ? normalizeMixPlanCommand : channel === "surplus" ? normalizeMixSurplusCommand : null;
    const sql = channel === "recipes" ? SQL.recipeCommand : channel === "plan" ? SQL.planCommand : channel === "surplus" ? SQL.surplusCommand : null;
    if (!normalize || !sql) throw new TypeError("Unknown Mix Plan command channel.");
    const normalized = normalize(command);
    const makeDate = channel === "plan" ? normalized.productionDate : undefined;
    const requestHash = createHash("sha256").update(JSON.stringify({
      channel,
      facilityId: principal.facilityId,
      actorId: principal.actorId,
      expectedRevision,
      command: normalized,
    }), "utf8").digest("hex");
    let result;
    try {
      result = await query(sql, [principal.facilityId, principal.actorId, commandId, requestHash,
        expectedRevision, JSON.stringify(normalized)]);
    } catch (error) {
      storageError(error);
    }
    return commandResult(result?.rows?.[0]?.result, { requestId: commandId, channel, makeDate });
  }

  return Object.freeze({
    getRecipes: ({ auth }) => read(auth, "recipes"),
    getPlan: ({ auth, makeDate }) => read(auth, "plan", makeDate),
    getSurplus: ({ auth }) => read(auth, "surplus"),
    executeRecipes: (input) => execute({ ...input, channel: "recipes" }),
    executePlan: (input) => execute({ ...input, channel: "plan" }),
    executeSurplus: (input) => execute({ ...input, channel: "surplus" }),
  });
}
