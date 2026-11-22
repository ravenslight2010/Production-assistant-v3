import {
  isSourceImportSummary,
  type DieDefaultSaveRequest,
  type SetupCatalogEditRequest,
  type SetupCatalogStageRequest,
  type SetupMasterEditRequest,
} from "../api";
import { parseSetupCatalogRecord } from "../../../core/setup-catalog-csv.mjs";
import { parseSetupMasterRecord } from "../../../core/setup-master-records.mjs";

const PENDING_PREFIX = "fieldline:v3:setup-catalog-pending:";
const FAMILIES = new Set([
  "ingredients", "mixes", "die-types", "die-line-defaults", "production-rules",
  "freezer-pull-items", "run-templates", "manager-lists", "aliases",
]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;

export type PendingSetupCatalogRequest = SetupCatalogStageRequest | SetupCatalogEditRequest | SetupMasterEditRequest | DieDefaultSaveRequest;

function pendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

export function readPendingSetupCatalogImport(userId: string): PendingSetupCatalogRequest | null {
  const key = pendingKey(userId);
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
    if (!value || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (Object.hasOwn(value, "dieCode")) {
      const required = ["crustsPerCycle", "cycleSpeed", "speedAdjustment", "freezerTime", "casesPerLayer"];
      const optional = ["preTunnelMin", "postTunnelMin", "pressOvenMin", "frontlineMin"];
      const defaults = value.defaults as Record<string, unknown> | null;
      if (Object.keys(value).sort().join("\u0000") !== "defaults\u0000dieCode\u0000enabled\u0000expectedRevision\u0000requestId"
        || typeof value.dieCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value.dieCode)
        || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0
        || typeof value.enabled !== "boolean" || !defaults || typeof defaults !== "object" || Array.isArray(defaults)
        || Object.keys(defaults).sort().join("\u0000") !== [...required, ...optional].sort().join("\u0000")
        || required.some((key) => typeof defaults[key] !== "number" || !Number.isFinite(defaults[key]) || Number(defaults[key]) < 0)
        || optional.some((key) => defaults[key] !== null
          && (typeof defaults[key] !== "number" || !Number.isFinite(defaults[key]) || Number(defaults[key]) < 0))) {
        sessionStorage.removeItem(key);
        return null;
      }
      return value as unknown as DieDefaultSaveRequest;
    }
    if (Object.hasOwn(value, "kind")) {
      if (Object.keys(value).sort().join("\u0000") !== "expectedFingerprint\u0000kind\u0000record\u0000requestId"
        || typeof value.kind !== "string" || !["recipes", "production-setups"].includes(value.kind)
        || (value.expectedFingerprint !== null
          && (typeof value.expectedFingerprint !== "string" || !FINGERPRINT.test(value.expectedFingerprint)))) {
        sessionStorage.removeItem(key);
        return null;
      }
      const kind = value.kind as SetupMasterEditRequest["kind"];
      const record = parseSetupMasterRecord(kind, value.record);
      return {
        requestId: value.requestId,
        kind,
        record,
        expectedFingerprint: value.expectedFingerprint as string | null,
      };
    }
    if (typeof value.family !== "string" || !FAMILIES.has(value.family)) {
      sessionStorage.removeItem(key);
      return null;
    }
    const family = value.family as SetupCatalogEditRequest["family"];
    if (Object.hasOwn(value, "csv")) {
      if (Object.keys(value).some((key) => !["requestId", "family", "csv", "sourceSummary"].includes(key))
        || typeof value.csv !== "string" || value.csv.length < 1 || value.csv.length > 1024 * 1024
        || (value.sourceSummary !== undefined && !isSourceImportSummary(value.sourceSummary))) {
        sessionStorage.removeItem(key);
        return null;
      }
      return {
        requestId: value.requestId,
        family,
        csv: value.csv,
        ...(value.sourceSummary ? { sourceSummary: value.sourceSummary } : {}),
      };
    }
    if (Object.keys(value).sort().join("\u0000") !== "expectedFingerprint\u0000family\u0000record\u0000requestId"
      || (value.expectedFingerprint !== null
        && (typeof value.expectedFingerprint !== "string" || !FINGERPRINT.test(value.expectedFingerprint)))) {
      sessionStorage.removeItem(key);
      return null;
    }
    const record = parseSetupCatalogRecord(family, value.record);
    return {
      requestId: value.requestId,
      family,
      record,
      expectedFingerprint: value.expectedFingerprint as string | null,
    };
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function writePendingSetupCatalogImport(userId: string, request: PendingSetupCatalogRequest): void {
  sessionStorage.setItem(pendingKey(userId), JSON.stringify(request));
}

export function clearPendingSetupCatalogImport(userId: string): void {
  sessionStorage.removeItem(pendingKey(userId));
}
