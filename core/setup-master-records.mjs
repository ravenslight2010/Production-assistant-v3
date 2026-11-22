import { ImportCsvError, parseImportCode, parseImportName } from "./import-csv.mjs";

const SOURCE_FAMILY = Object.freeze({
  recipes: "dough-procedure",
  "production-setups": "shipping-guide",
});
const COMMON_FIELDS = ["sourceFamily", "sourceKey", "fileName", "fileSha256", "source"];
const KIND_FIELDS = Object.freeze({
  recipes: [...COMMON_FIELDS, "doughballYield", "doughballWeightOz", "doughballsPerTray"],
  "production-setups": [...COMMON_FIELDS, "pizzasPerCase"],
});
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new ImportCsvError(message, 2);
}

function positive(value, { optional = false, integer = false } = {}) {
  return (optional && value === null) || (typeof value === "number" && Number.isFinite(value)
    && value > 0 && value <= 1_000_000 && (!integer || Number.isSafeInteger(value)));
}

function nullableText(value, maximum) {
  return value === null || (typeof value === "string" && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value));
}

/** Validate the complete, provenance-preserving shape used by typed capacity editors. */
export function parseSetupMasterRecord(kind, value) {
  if (!Object.hasOwn(SOURCE_FAMILY, kind)) fail("Choose a dough recipe or production setup record.");
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== "code\u0000data\u0000name\u0000productCode") {
    fail("A capacity record must contain exactly code, name, productCode, and data.");
  }
  const record = {
    code: parseImportCode(value.code, 2),
    name: parseImportName(value.name, 2),
    productCode: parseImportCode(value.productCode, 2, "productCode"),
    data: value.data,
  };
  const data = record.data;
  const fields = KIND_FIELDS[kind];
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).sort().join("\u0000") !== [...fields].sort().join("\u0000")
    || data.sourceFamily !== SOURCE_FAMILY[kind]
    || !(data.sourceKey === null || (typeof data.sourceKey === "string" && SHA256.test(data.sourceKey)))
    || !nullableText(data.fileName, 120)
    || !(data.fileSha256 === null || (typeof data.fileSha256 === "string" && SHA256.test(data.fileSha256)))
    || !(data.source === null || (typeof data.source === "object" && !Array.isArray(data.source)
      && JSON.stringify(data.source).length <= 20_000))
    || !CODE.test(record.productCode)) {
    fail("The capacity record has unsupported values or incomplete source provenance.");
  }
  if (kind === "recipes") {
    if (!positive(data.doughballYield)
      || !positive(data.doughballWeightOz, { optional: true })
      || !positive(data.doughballsPerTray, { optional: true, integer: true })) {
      fail("Dough yield must be positive; doughball weight and tray count may be blank or positive.");
    }
  } else if (!positive(data.pizzasPerCase, { integer: true })) {
    fail("Pizzas per case must be a positive whole number.");
  }
  return record;
}

export function emptySetupMasterRecord(kind, productCode = "") {
  if (!Object.hasOwn(SOURCE_FAMILY, kind)) fail("Choose a dough recipe or production setup record.");
  const provenance = {
    sourceFamily: SOURCE_FAMILY[kind], sourceKey: null, fileName: null, fileSha256: null, source: null,
  };
  return {
    code: kind === "recipes" ? "DOUGH-MANUAL" : "SHIP-MANUAL",
    name: kind === "recipes" ? "Manual dough procedure" : "Manual shipping capacity",
    productCode,
    data: kind === "recipes"
      ? { ...provenance, doughballYield: 1, doughballWeightOz: null, doughballsPerTray: null }
      : { ...provenance, pizzasPerCase: 1 },
  };
}

export const setupMasterRecordLimits = Object.freeze({
  kinds: Object.freeze(Object.keys(SOURCE_FAMILY)),
  sourceFamilies: SOURCE_FAMILY,
});
