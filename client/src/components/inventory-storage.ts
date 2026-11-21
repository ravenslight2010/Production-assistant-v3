import type {
  AdjustFreezerSurplusRequest,
  AllocateFreezerSurplusRequest,
  ConfirmFreezerSurplusRequest,
  CreateWarehouseRequest,
  InventoryMovementRequest,
  InventoryTransferRequest,
  OpeningCountRequest,
  MarkCycleCountedRequest,
  SaveCycleCountScheduleRequest,
  SetProductionWarehouseRequest,
} from "../api";

export type PendingInventoryRequest =
  | { kind: "warehouse-create"; payload: CreateWarehouseRequest }
  | { kind: "production-warehouse"; payload: SetProductionWarehouseRequest }
  | { kind: "movement"; payload: InventoryMovementRequest }
  | { kind: "transfer"; payload: InventoryTransferRequest }
  | { kind: "opening-count"; payload: OpeningCountRequest }
  | { kind: "opening-review"; countId: string }
  | { kind: "opening-apply"; countId: string }
  | { kind: "cycle-count-mark"; payload: MarkCycleCountedRequest }
  | { kind: "cycle-count-schedule"; payload: SaveCycleCountScheduleRequest }
  | { kind: "surplus-confirm"; payload: ConfirmFreezerSurplusRequest }
  | { kind: "surplus-allocation"; payload: AllocateFreezerSurplusRequest }
  | { kind: "surplus-adjustment"; payload: AdjustFreezerSurplusRequest };

const PREFIX = "fieldline:v3:inventory-pending:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const key = (userId: string) => `${PREFIX}${userId}`;
const requestId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 200;
const productCode = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value);
const quantity = (value: unknown): value is string => typeof value === "string"
  && /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/u.test(value)
  && !/^-?0(?:\.0{1,6})?$/u.test(value);
const reason = (value: unknown): value is string => typeof value === "string"
  && value.trim().length >= 3 && value.trim().length <= 500;
function inventoryDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

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
  if (candidate.kind === "movement" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    const hasLotNumber = Object.hasOwn(body, "lotNumber");
    const hasReceivedOn = Object.hasOwn(body, "receivedOn");
    const hasExpiresOn = Object.hasOwn(body, "expiresOn");
    const hasLotMetadata = hasLotNumber || hasReceivedOn || hasExpiresOn;
    const validLotNumber = !hasLotNumber || (typeof body.lotNumber === "string"
      && body.lotNumber.trim().length >= 1 && body.lotNumber.trim().length <= 120
      && !/[\u0000-\u001f\u007f]/u.test(body.lotNumber));
    const validDates = (!hasReceivedOn || inventoryDate(body.receivedOn))
      && (!hasExpiresOn || inventoryDate(body.expiresOn))
      && (!hasReceivedOn || !hasExpiresOn || String(body.expiresOn) >= String(body.receivedOn));
    if (requestId(body.commandId) && typeof body.warehouseId === "string" && UUID.test(body.warehouseId)
      && productCode(body.productCode) && (body.type === "receipt" || body.type === "adjustment")
      && quantity(body.quantity) && reason(body.reason) && validLotNumber && validDates
      && (body.type !== "receipt" || !body.quantity.startsWith("-"))
      && (!body.quantity.startsWith("-") || !hasLotMetadata)) {
      return {
        kind: candidate.kind,
        payload: {
          commandId: body.commandId,
          warehouseId: body.warehouseId,
          productCode: body.productCode,
          type: body.type,
          quantity: body.quantity,
          reason: body.reason,
          ...(hasLotNumber ? { lotNumber: body.lotNumber as string } : {}),
          ...(hasReceivedOn ? { receivedOn: body.receivedOn as string } : {}),
          ...(hasExpiresOn ? { expiresOn: body.expiresOn as string } : {}),
        },
      };
    }
  }
  if (candidate.kind === "transfer" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.commandId) && typeof body.sourceWarehouseId === "string" && UUID.test(body.sourceWarehouseId)
      && typeof body.targetWarehouseId === "string" && UUID.test(body.targetWarehouseId)
      && body.sourceWarehouseId !== body.targetWarehouseId && productCode(body.productCode)
      && quantity(body.quantity) && !body.quantity.startsWith("-") && reason(body.reason)) {
      return {
        kind: candidate.kind,
        payload: {
          commandId: body.commandId,
          sourceWarehouseId: body.sourceWarehouseId,
          targetWarehouseId: body.targetWarehouseId,
          productCode: body.productCode,
          quantity: body.quantity,
          reason: body.reason,
        },
      };
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
  if (candidate.kind === "cycle-count-mark" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.section === "string" && body.section.trim() === body.section
      && body.section.length >= 1 && body.section.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(body.section)) {
      return { kind: candidate.kind, payload: { requestId: body.requestId, section: body.section } };
    }
  }
  if (candidate.kind === "cycle-count-schedule" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.section === "string" && body.section.trim() === body.section
      && body.section.length >= 1 && body.section.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(body.section)
      && Number.isSafeInteger(body.cadenceDays) && Number(body.cadenceDays) >= 1 && Number(body.cadenceDays) <= 365
      && typeof body.enabled === "boolean" && Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) >= 0) {
      return { kind: candidate.kind, payload: {
        requestId: body.requestId, section: body.section, cadenceDays: body.cadenceDays as number,
        enabled: body.enabled, expectedRevision: body.expectedRevision as number,
      } };
    }
  }
  if (candidate.kind === "surplus-confirm" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.runId === "string" && UUID.test(body.runId)
      && Number.isSafeInteger(body.cases) && Number(body.cases) >= 0 && Number(body.cases) <= 1_000_000) {
      return { kind: candidate.kind, payload: { requestId: body.requestId, runId: body.runId, cases: body.cases as number } };
    }
  }
  if (candidate.kind === "surplus-allocation" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (requestId(body.requestId) && typeof body.lotId === "string" && UUID.test(body.lotId)
      && inventoryDate(body.productionDate) && typeof body.scheduleRunId === "string" && UUID.test(body.scheduleRunId)
      && Number.isSafeInteger(body.cases) && Number(body.cases) >= 1 && Number(body.cases) <= 1_000_000
      && Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) >= 1) {
      return { kind: candidate.kind, payload: {
        requestId: body.requestId, lotId: body.lotId, productionDate: body.productionDate,
        scheduleRunId: body.scheduleRunId, cases: body.cases as number, expectedRevision: body.expectedRevision as number,
      } };
    }
  }
  if (candidate.kind === "surplus-adjustment" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    const adjustment = body.eventType === "damage" || body.eventType === "return" || body.eventType === "correction";
    const hasCorrection = Object.hasOwn(body, "correctsEventId");
    const validCorrection = body.eventType === "correction"
      ? hasCorrection && typeof body.correctsEventId === "string" && UUID.test(body.correctsEventId)
      : !hasCorrection;
    if (requestId(body.requestId) && typeof body.lotId === "string" && UUID.test(body.lotId) && adjustment
      && Number.isSafeInteger(body.cases) && Number(body.cases) !== 0 && Math.abs(Number(body.cases)) <= 1_000_000
      && (body.eventType === "correction" || Number(body.cases) > 0) && reason(body.reason) && validCorrection
      && Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) >= 1) {
      return { kind: candidate.kind, payload: {
        requestId: body.requestId, lotId: body.lotId,
        eventType: body.eventType as AdjustFreezerSurplusRequest["eventType"], cases: body.cases as number,
        reason: body.reason, expectedRevision: body.expectedRevision as number,
        ...(body.eventType === "correction" ? { correctsEventId: body.correctsEventId as string } : {}),
      } };
    }
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
