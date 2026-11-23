import { createHash } from "node:crypto";
import { isValidProductionDate } from "./schedule-planning.mjs";
import { isValidSubstitutionOverlay } from "./substitution-planning.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const UNIT = /^[A-Za-z][A-Za-z0-9._/-]{0,15}$/u;
const QUANTITY = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/u;
const GET_SQL = "SELECT v3.get_substitution_overlay($1::uuid, $2::date) AS result";
const PRODUCTS_SQL = "SELECT v3.list_substitution_products($1::uuid) AS result";
const COMMAND_SQL = `SELECT v3.apply_substitution_command(
  $1::uuid, $2::uuid, $3::date, $4::text, $5::text, $6::bigint, $7::jsonb
) AS result`;

export class SubstitutionServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "SubstitutionServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  return new SubstitutionServiceError("INVALID_REQUEST", message, 400);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isObject(value)) throw invalid("The substitution request must be an object.");
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw invalid("The substitution request contains missing or unsupported fields.");
  }
}

function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw invalid(`${field} must be a UUID.`);
  return value.toLowerCase();
}

function identity(auth) {
  if (auth?.verified !== true) {
    throw new SubstitutionServiceError("UNAUTHENTICATED", "Sign in to manage temporary substitutions.", 401);
  }
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("manage-factory-settings")) {
    throw new SubstitutionServiceError("FORBIDDEN", "Manager production-plan permission is required.", 403);
  }
  try {
    return { facilityId: uuid(auth.facilityId, "facilityId"), actorId: uuid(auth.actorId, "actorId") };
  } catch {
    throw new SubstitutionServiceError("UNAUTHENTICATED", "Verified facility and staff identity are required.", 401);
  }
}

function quantity(value, required) {
  if (value === null) {
    if (required) throw invalid("Add substitutions require a quantity.");
    return null;
  }
  if (typeof value !== "string" || !QUANTITY.test(value) || Number(value) <= 0) {
    throw invalid("Substitution quantity must be a positive decimal with at most six fractional digits.");
  }
  return value;
}

export function normalizeSubstitutionCommand(command) {
  if (!isObject(command) || typeof command.type !== "string") throw invalid("Choose a substitution change.");
  if (command.type === "clear") {
    exactKeys(command, ["type"]);
    return { type: "clear" };
  }
  if (command.type === "remove") {
    exactKeys(command, ["type", "ruleId"]);
    return { type: "remove", ruleId: uuid(command.ruleId, "ruleId") };
  }
  if (command.type !== "upsert") throw invalid("Choose an upsert, remove, or clear substitution command.");
  exactKeys(command, ["type", "rule"]);
  exactKeys(command.rule, ["id", "ingredient", "action", "substituteProductId", "quantity"]);
  const rule = command.rule;
  if (!(rule.id === null || (typeof rule.id === "string" && UUID.test(rule.id)))) {
    throw invalid("Substitution rule ID must be null or a UUID.");
  }
  if (typeof rule.ingredient !== "string" || rule.ingredient.trim().length < 1
    || rule.ingredient.trim().length > 120 || /[\u0000-\u001f\u007f]/u.test(rule.ingredient)) {
    throw invalid("Ingredient must be 1–120 characters without control characters.");
  }
  if (!["swap", "add", "remove"].includes(rule.action)) throw invalid("Choose swap, add, or remove.");
  const removing = rule.action === "remove";
  if (removing && rule.substituteProductId !== null) throw invalid("Remove rules cannot include a substitute product.");
  if (removing && rule.quantity !== null) throw invalid("Remove rules cannot include a quantity.");
  return {
    type: "upsert",
    rule: {
      id: rule.id === null ? null : rule.id.toLowerCase(),
      ingredient: rule.ingredient.trim(),
      action: rule.action,
      substituteProductId: removing ? null : uuid(rule.substituteProductId, "substituteProductId"),
      quantity: quantity(rule.quantity, rule.action === "add"),
    },
  };
}

function resultOverlay(value, date) {
  if (!isValidSubstitutionOverlay(value, date)) {
    throw new SubstitutionServiceError("INVALID_STORAGE_RESPONSE", "Substitution storage returned an invalid overlay.", 502);
  }
  return value;
}

function storageError(error) {
  if (["P0002", "23505", "40001", "22003"].includes(error?.code)) {
    throw new SubstitutionServiceError("SUBSTITUTION_CONFLICT",
      "The substitution plan changed or a referenced product or rule is unavailable. Refresh and review the current overlay.", 409);
  }
  if (error?.code === "42501") {
    throw new SubstitutionServiceError("FORBIDDEN", "This substitution plan is not available to your account.", 403);
  }
  if (["22023", "22P02", "23514"].includes(error?.code)) {
    throw new SubstitutionServiceError("INVALID_REQUEST", "The substitution change contains invalid values or references.", 400);
  }
  throw error;
}

export function createSubstitutionService({ query }) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");
  return Object.freeze({
    async get({ auth, productionDate }) {
      const principal = identity(auth);
      if (!isValidProductionDate(productionDate)) throw invalid("Choose a valid production date.");
      let result;
      try {
        result = await query(GET_SQL, [principal.facilityId, productionDate]);
      } catch (error) {
        storageError(error);
      }
      return resultOverlay(result?.rows?.[0]?.result, productionDate);
    },

    async listProducts({ auth }) {
      const principal = identity(auth);
      let result;
      try {
        result = await query(PRODUCTS_SQL, [principal.facilityId]);
      } catch (error) {
        storageError(error);
      }
      const products = result?.rows?.[0]?.result;
      if (!Array.isArray(products) || products.length > 10_000 || products.some((product) => !isObject(product)
        || Object.keys(product).sort().join("\u0000") !== "baseUnit\u0000productCode\u0000productId\u0000productName"
        || typeof product.productId !== "string" || !UUID.test(product.productId)
        || typeof product.productCode !== "string" || !CODE.test(product.productCode)
        || typeof product.productName !== "string" || product.productName.length < 1 || product.productName.length > 120
        || typeof product.baseUnit !== "string" || !UNIT.test(product.baseUnit))) {
        throw new SubstitutionServiceError("INVALID_STORAGE_RESPONSE", "Substitution storage returned an invalid product list.", 502);
      }
      return products;
    },

    async execute({ auth, requestId, productionDate, expectedRevision, command }) {
      const principal = identity(auth);
      const commandId = uuid(requestId, "requestId");
      if (!isValidProductionDate(productionDate)) throw invalid("Choose a valid production date.");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw invalid("Expected overlay revision must be a non-negative safe integer.");
      }
      const normalized = normalizeSubstitutionCommand(command);
      const requestHash = createHash("sha256").update(JSON.stringify({
        facilityId: principal.facilityId,
        actorId: principal.actorId,
        productionDate,
        expectedRevision,
        command: normalized,
      }), "utf8").digest("hex");
      let result;
      try {
        result = await query(COMMAND_SQL, [
          principal.facilityId, principal.actorId, productionDate, commandId, requestHash,
          expectedRevision, JSON.stringify(normalized),
        ]);
      } catch (error) {
        storageError(error);
      }
      const response = result?.rows?.[0]?.result;
      if (!isObject(response) || typeof response.replayed !== "boolean") {
        throw new SubstitutionServiceError("INVALID_STORAGE_RESPONSE", "Substitution storage returned an invalid command result.", 502);
      }
      if (response.outcome === "conflict") {
        if (response.expectedRevision !== expectedRevision) {
          throw new SubstitutionServiceError("INVALID_STORAGE_RESPONSE", "Substitution storage returned an invalid conflict.", 502);
        }
        return { ...response, currentOverlay: resultOverlay(response.currentOverlay, productionDate) };
      }
      if (response.outcome !== "accepted" || response.commandId !== commandId) {
        throw new SubstitutionServiceError("INVALID_STORAGE_RESPONSE", "Substitution storage returned an invalid acceptance.", 502);
      }
      return { ...response, overlay: resultOverlay(response.overlay, productionDate) };
    },
  });
}
