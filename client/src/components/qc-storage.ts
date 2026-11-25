import {
  isQcDashboard,
  isQcTarget,
  type QcBrixCheckRequest,
  type QcDashboard,
  type QcLotRequest,
  type QcTarget,
  type QcTargetSaveRequest,
  type QcWeightCheckRequest,
} from "../api";

const CACHE_PREFIX = "fieldline:v3:qc-cache:";
const SELECTION_PREFIX = "fieldline:v3:qc-run:";
const PENDING_PREFIX = "fieldline:v3:qc-pending:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface QcCache {
  dashboard: QcDashboard;
  targets: QcTarget[];
  cachedAt: string;
}

export type PendingQcCommand =
  | { channel: "lot"; request: QcLotRequest }
  | { channel: "weight-check"; request: QcWeightCheckRequest }
  | { channel: "brix-check"; request: QcBrixCheckRequest }
  | { channel: "target"; request: QcTargetSaveRequest };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maximum = 1000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function decimal(value: unknown, positive = false): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(value)
    && (!positive || Number(value) > 0);
}

function targetKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
}

function validMeasurement(value: unknown, kind: "weight" | "brix"): boolean {
  if (!object(value) || !decimal(value.value, true) || !text(value.notes)
    || !(value.targetKey === null || targetKey(value.targetKey))) return false;
  if (kind === "brix") {
    return value.phase === null && value.unit === "brix" && Number(value.value) <= 100;
  }
  return ["pre-run", "30-minute"].includes(String(value.phase))
    && ["g", "kg", "oz", "lb"].includes(String(value.unit));
}

function validPending(value: unknown): value is PendingQcCommand {
  if (!object(value) || !["lot", "weight-check", "brix-check", "target"].includes(String(value.channel))
    || !object(value.request) || !UUID.test(String(value.request.requestId))) return false;
  const request = value.request;
  if (value.channel === "target") {
    return targetKey(request.targetKey) && Number.isSafeInteger(request.expectedRevision)
      && Number(request.expectedRevision) >= 0 && object(request.details)
      && ["weight", "brix"].includes(String(request.details.kind))
      && ["g", "kg", "oz", "lb", "brix"].includes(String(request.details.unit))
      && (request.details.minimum === null || decimal(request.details.minimum))
      && (request.details.maximum === null || decimal(request.details.maximum))
      && (request.details.minimum !== null || request.details.maximum !== null)
      && typeof request.details.active === "boolean";
  }
  if (!UUID.test(String(request.runId)) || !object(request.details)) return false;
  if (value.channel === "lot") {
    return typeof request.details.productCode === "string"
      && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(request.details.productCode)
      && text(request.details.lotNumber, 120) && request.details.lotNumber.trim().length > 0
      && text(request.details.notes);
  }
  return validMeasurement(request.details, value.channel === "weight-check" ? "weight" : "brix");
}

export function readQcCache(userId: string, runId: string): QcCache | null {
  const key = `${CACHE_PREFIX}${userId}:${runId}`;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<QcCache> | null;
    if (!value || typeof value.cachedAt !== "string" || !Number.isFinite(Date.parse(value.cachedAt))
      || !isQcDashboard(value.dashboard, runId) || !Array.isArray(value.targets)
      || !value.targets.every(isQcTarget)) return null;
    return value as QcCache;
  } catch {
    try { localStorage.removeItem(key); } catch { /* Storage remains unavailable. */ }
    return null;
  }
}

export function writeQcCache(userId: string, dashboard: QcDashboard, targets: QcTarget[]): string {
  const cachedAt = new Date().toISOString();
  localStorage.setItem(`${CACHE_PREFIX}${userId}:${dashboard.run.id}`, JSON.stringify({
    dashboard, targets, cachedAt,
  } satisfies QcCache));
  return cachedAt;
}

export function readQcSelection(userId: string): string | null {
  try {
    const value = localStorage.getItem(`${SELECTION_PREFIX}${userId}`);
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeQcSelection(userId: string, runId: string): void {
  localStorage.setItem(`${SELECTION_PREFIX}${userId}`, runId);
}

export function readPendingQcCommand(userId: string): PendingQcCommand | null {
  const key = `${PENDING_PREFIX}${userId}`;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!validPending(value)) return null;
    return value;
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* Storage remains unavailable. */ }
    return null;
  }
}

export function writePendingQcCommand(userId: string, pending: PendingQcCommand): void {
  sessionStorage.setItem(`${PENDING_PREFIX}${userId}`, JSON.stringify(pending));
}

export function clearPendingQcCommand(userId: string): void {
  sessionStorage.removeItem(PENDING_PREFIX + userId);
}
