import {
  isMixPlan,
  isMixRecipeCatalog,
  isMixSurplus,
  type MixPlan,
  type MixPlanCommandRequest,
  type MixRecipeCatalog,
  type MixRecipeCommandRequest,
  type MixSurplus,
  type MixSurplusCommandRequest,
} from "../api";

const CACHE_PREFIX = "fieldline:v3:mix-plan-cache:";
const PENDING_PREFIX = "fieldline:v3:mix-plan-pending:";

export interface MixPlanCache {
  plan: MixPlan;
  catalog: MixRecipeCatalog | null;
  surplus: MixSurplus | null;
  cachedAt: string;
}

export type PendingMixCommand =
  | { channel: "recipes"; request: MixRecipeCommandRequest }
  | { channel: "plan"; request: MixPlanCommandRequest }
  | { channel: "surplus"; request: MixSurplusCommandRequest };

function cacheKey(userId: string, makeDate: string): string {
  return `${CACHE_PREFIX}${userId}:${makeDate}`;
}

function pendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

export function readMixPlanCache(userId: string, makeDate: string): MixPlanCache | null {
  const key = cacheKey(userId, makeDate);
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<MixPlanCache> | null;
    if (!value || typeof value.cachedAt !== "string" || !Number.isFinite(Date.parse(value.cachedAt))
      || !isMixPlan(value.plan, makeDate)
      || (value.catalog !== null && !isMixRecipeCatalog(value.catalog))
      || (value.surplus !== null && !isMixSurplus(value.surplus))) {
      return null;
    }
    return value as MixPlanCache;
  } catch {
    try { localStorage.removeItem(key); } catch { /* Storage remains unavailable; no cached value is returned. */ }
    return null;
  }
}

export function writeMixPlanCache(
  userId: string,
  plan: MixPlan,
  catalog: MixRecipeCatalog | null,
  surplus: MixSurplus | null,
): string {
  const cachedAt = new Date().toISOString();
  localStorage.setItem(cacheKey(userId, plan.makeDate), JSON.stringify({
    plan,
    catalog,
    surplus,
    cachedAt,
  } satisfies MixPlanCache));
  return cachedAt;
}

function validRequest(value: unknown): value is MixRecipeCommandRequest | MixPlanCommandRequest | MixSurplusCommandRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<MixRecipeCommandRequest>;
  return typeof candidate.requestId === "string"
    && Number.isSafeInteger(candidate.expectedRevision) && Number(candidate.expectedRevision) >= 0
    && candidate.command !== null && typeof candidate.command === "object";
}

export function readPendingMixCommand(userId: string): PendingMixCommand | null {
  const key = pendingKey(userId);
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Partial<PendingMixCommand> | null;
    if (!value || !["recipes", "plan", "surplus"].includes(String(value.channel)) || !validRequest(value.request)) return null;
    return value as PendingMixCommand;
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* Storage remains unavailable; no pending request is returned. */ }
    return null;
  }
}

export function writePendingMixCommand(userId: string, pending: PendingMixCommand): void {
  sessionStorage.setItem(pendingKey(userId), JSON.stringify(pending));
}

export function clearPendingMixCommand(userId: string): void {
  sessionStorage.removeItem(pendingKey(userId));
}
