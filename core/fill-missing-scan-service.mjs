// Fill-missing scan service: assembles the gap list for one run from the
// server-owned run record, the factory-wide learned values, and the reviewed
// product catalog. Detection and proposal logic lives in core/fill-missing.mjs
// (the single source of truth, ported from v1's @workspace/fill-missing);
// this service only fetches inputs and validates the assembled result.

import { detectMissingFields, buildProposals } from "./fill-missing.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_LEARNED_SQL = `SELECT v3.list_fill_missing_values($1::uuid) AS result`;
const PROPOSAL_SOURCES = new Set(["learned", "catalog", "none"]);

export class FillMissingScanError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "FillMissingScanError";
    this.code = code;
    this.status = status;
  }
}

function normalizeFacilityId(auth) {
  if (auth?.verified !== true) {
    throw new FillMissingScanError("UNAUTHENTICATED", "Sign in to access runs.", 401);
  }
  if (typeof auth.facilityId !== "string" || !UUID_PATTERN.test(auth.facilityId)) {
    throw new FillMissingScanError("UNAUTHENTICATED", "Refresh your V3 session before continuing.", 401);
  }
  return auth.facilityId.toLowerCase();
}

function validateGap(gap) {
  return typeof gap?.key === "string"
    && typeof gap?.runId === "string"
    && typeof gap?.label === "string"
    && typeof gap?.category === "string"
    && PROPOSAL_SOURCES.has(gap?.source)
    && (gap?.proposedValue === undefined || (typeof gap.proposedValue === "number" && Number.isFinite(gap.proposedValue) && gap.proposedValue > 0))
    && gap?.apply?.kind === "station_command"
    && typeof gap.apply.station === "string"
    && typeof gap.apply.field === "string";
}

export function createFillMissingScanService({ runs, query }) {
  if (!runs || typeof runs.get !== "function" || typeof runs.listProducts !== "function") {
    throw new TypeError("Run read services are required.");
  }
  if (typeof query !== "function") {
    throw new TypeError("A parameterized database query function is required.");
  }

  return Object.freeze({
    async build({ auth, runId }) {
      const facilityId = normalizeFacilityId(auth);
      const run = await runs.get({ auth, runId });
      if (run === null) return null;

      let learnedResult;
      let productsResult;
      try {
        [learnedResult, productsResult] = await Promise.all([
          query(LIST_LEARNED_SQL, [facilityId]),
          runs.listProducts({ auth }),
        ]);
      } catch (error) {
        throw new FillMissingScanError("STORAGE_ERROR", "The fill-missing scan could not be completed. Try again.", 503);
      }

      const learnedValues = learnedResult?.rows?.[0]?.result;
      if (!Array.isArray(learnedValues)) {
        throw new FillMissingScanError("INVALID_STORAGE_RESPONSE", "Learned values returned an unexpected result.", 502);
      }
      const products = Array.isArray(productsResult?.products) ? productsResult.products : [];
      const productCode = run?.setupSnapshot?.productCode;
      const product = typeof productCode === "string"
        ? products.find((item) => typeof item?.code === "string" && item.code.toLowerCase() === productCode.toLowerCase())
        : undefined;

      const missing = detectMissingFields({ runId: run.id, stationProgress: run.stationProgress });
      const gaps = buildProposals(missing, { learnedValues, product, productCode });
      if (!gaps.every(validateGap)) {
        throw new FillMissingScanError("INVALID_STORAGE_RESPONSE", "The fill-missing scan returned an unexpected result.", 502);
      }
      return { runId: run.id, productCode: productCode ?? null, gaps };
    },
  });
}
