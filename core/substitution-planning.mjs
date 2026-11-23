const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const QUANTITY = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/u;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(value, required, optional = []) {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function validDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTimestamp(value) {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

export function isValidSubstitutionRule(value) {
  if (!isObject(value) || !hasKeys(value, ["id", "ingredient", "action"], [
    "substituteProductId", "substituteProductCode", "substituteProductName", "quantity",
  ])
    || typeof value.id !== "string" || !UUID.test(value.id)
    || typeof value.ingredient !== "string" || value.ingredient.length < 1 || value.ingredient.length > 120
    || value.ingredient.trim() !== value.ingredient || /[\u0000-\u001f\u007f]/u.test(value.ingredient)
    || !["swap", "add", "remove"].includes(value.action)) return false;
  if (value.action === "remove") return Object.keys(value).length === 3;
  if (!hasKeys(value, [
    "id", "ingredient", "action", "substituteProductId", "substituteProductCode", "substituteProductName",
  ], ["quantity"])
    || typeof value.substituteProductId !== "string" || !UUID.test(value.substituteProductId)
    || typeof value.substituteProductCode !== "string" || !CODE.test(value.substituteProductCode)
    || typeof value.substituteProductName !== "string" || value.substituteProductName.length < 1
    || value.substituteProductName.length > 120) return false;
  if (value.quantity !== undefined && (typeof value.quantity !== "string"
    || !QUANTITY.test(value.quantity) || Number(value.quantity) <= 0)) return false;
  return value.action !== "add" || value.quantity !== undefined;
}

export function isValidSubstitutionOverlay(value, expectedDate) {
  if (!isObject(value) || !hasKeys(value, ["productionDate", "revision", "rules", "updatedAt"])
    || !validDate(value.productionDate) || (expectedDate !== undefined && value.productionDate !== expectedDate)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.rules) || value.rules.length > 100
    || !value.rules.every(isValidSubstitutionRule) || !validTimestamp(value.updatedAt)) return false;
  const ingredients = value.rules.map((rule) => rule.ingredient.toLowerCase());
  const ids = value.rules.map((rule) => rule.id.toLowerCase());
  return new Set(ingredients).size === ingredients.length && new Set(ids).size === ids.length;
}

export function emptySubstitutionOverlay(productionDate) {
  if (!validDate(productionDate)) throw new TypeError("A valid production date is required.");
  return { productionDate, revision: 0, rules: [], updatedAt: null };
}
