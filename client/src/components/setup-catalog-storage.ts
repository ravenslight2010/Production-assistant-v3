import { isSourceImportSummary, type SetupCatalogStageRequest } from "../api";

const PENDING_PREFIX = "fieldline:v3:setup-catalog-pending:";
const FAMILIES = new Set([
  "ingredients", "mixes", "die-types", "die-line-defaults", "production-rules",
  "freezer-pull-items", "run-templates", "manager-lists", "aliases",
]);

function pendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

export function readPendingSetupCatalogImport(userId: string): SetupCatalogStageRequest | null {
  const key = pendingKey(userId);
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Partial<SetupCatalogStageRequest> | null;
    if (!value || typeof value.requestId !== "string" || value.requestId.length < 1 || value.requestId.length > 200
      || typeof value.family !== "string" || !FAMILIES.has(value.family)
      || typeof value.csv !== "string" || value.csv.length < 1 || value.csv.length > 1024 * 1024
      || (value.sourceSummary !== undefined && !isSourceImportSummary(value.sourceSummary))) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      requestId: value.requestId,
      family: value.family as SetupCatalogStageRequest["family"],
      csv: value.csv,
      ...(value.sourceSummary ? { sourceSummary: value.sourceSummary } : {}),
    };
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function writePendingSetupCatalogImport(userId: string, request: SetupCatalogStageRequest): void {
  sessionStorage.setItem(pendingKey(userId), JSON.stringify(request));
}

export function clearPendingSetupCatalogImport(userId: string): void {
  sessionStorage.removeItem(pendingKey(userId));
}
