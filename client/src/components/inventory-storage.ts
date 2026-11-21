import type { CreateWarehouseRequest, OpeningCountRequest, SetProductionWarehouseRequest } from "../api";

export type PendingInventoryRequest =
  | { kind: "warehouse-create"; payload: CreateWarehouseRequest }
  | { kind: "production-warehouse"; payload: SetProductionWarehouseRequest }
  | { kind: "opening-count"; payload: OpeningCountRequest }
  | { kind: "opening-review"; countId: string }
  | { kind: "opening-apply"; countId: string };

const PREFIX = "fieldline:v3:inventory-pending:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const key = (userId: string) => `${PREFIX}${userId}`;
const requestId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 200;

function parse(value: unknown): PendingInventoryRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const payload = candidate.payload;
  if (candidate.kind === "warehouse-create" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.name === "string" && body.name.length >= 1 && body.name.length <= 120) {
      return { kind: candidate.kind, payload: { requestId: body.requestId, name: body.name } };
    }
  }
  if (candidate.kind === "production-warehouse" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.warehouseId === "string" && UUID.test(body.warehouseId)) {
      return { kind: candidate.kind, payload: { requestId: body.requestId, warehouseId: body.warehouseId } };
    }
  }
  if (candidate.kind === "opening-count" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.warehouseId === "string" && UUID.test(body.warehouseId)
      && typeof body.csv === "string" && body.csv.length >= 1 && body.csv.length <= 1024 * 1024) {
      return { kind: candidate.kind, payload: { requestId: body.requestId, warehouseId: body.warehouseId, csv: body.csv } };
    }
  }
  if ((candidate.kind === "opening-review" || candidate.kind === "opening-apply")
    && typeof candidate.countId === "string" && UUID.test(candidate.countId)) {
    return { kind: candidate.kind, countId: candidate.countId };
  }
  return null;
}

export function readPendingInventoryRequest(userId: string): PendingInventoryRequest | null {
  const storageKey = key(userId);
  try {
    const result = parse(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"));
    if (!result) sessionStorage.removeItem(storageKey);
    return result;
  } catch {
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage is unavailable; no request was read. */ }
    return null;
  }
}

export function writePendingInventoryRequest(userId: string, request: PendingInventoryRequest): void {
  sessionStorage.setItem(key(userId), JSON.stringify(request));
}

export function clearPendingInventoryRequest(userId: string): void {
  sessionStorage.removeItem(key(userId));
}
