import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

const client = createClient<paths>({ baseUrl: "/" });

export type AuthSession = components["schemas"]["AuthSession"];
export type Run = components["schemas"]["Run"];
export type RunProduct = components["schemas"]["RunProduct"];
export type RunStatus = Run["status"];
export type RunCommand = "start" | "pause" | "resume" | "complete";
export type RunCommandResult = { run: Run; conflict: boolean };
export type StationKey = "line" | "dough" | "cheese" | "pepperoni" | "sauce" | "frontline" | "packaging";
export type StaffDirectory = components["schemas"]["StaffDirectory"];
export type StaffAccount = components["schemas"]["StaffAccount"];
export type ScheduleCatalog = components["schemas"]["ScheduleCatalog"];
export type ProductionSchedule = Omit<components["schemas"]["ProductionSchedule"], "date"> & { date: string };
export type PlannedScheduleRun = components["schemas"]["PlannedScheduleRun"];
export type ScheduleBreak = components["schemas"]["ScheduleBreak"];
export type ScheduleCommand = components["schemas"]["ProductionScheduleCommandRequest"]["command"];
export type ScheduleCommandRequest = Omit<components["schemas"]["ProductionScheduleCommandRequest"], "date"> & { date: string };
export type ScheduleWorkbookPreview = components["schemas"]["ScheduleWorkbookPreviewResponse"]["preview"];
export type SetupCatalogFamily = components["schemas"]["SetupCatalogStageResponse"]["family"];
export type SetupCatalogRecord = components["schemas"]["SetupCatalogRecord"];
export type SetupCatalogHistoryItem = components["schemas"]["SetupCatalogHistoryItem"];
export type SetupCatalogDetail = components["schemas"]["SetupCatalogDetail"];
export type SetupCatalogStageResponse = components["schemas"]["SetupCatalogStageResponse"];
export type SetupCatalogActionResult = components["schemas"]["SetupCatalogActionResult"];
export type SetupCatalogStageRequest = components["schemas"]["SetupCatalogRequest"];
export type SourceWorkbookFamily = components["schemas"]["SourceWorkbookPreviewRequest"]["family"];
export type SourceWorkbookPreview = components["schemas"]["SourceWorkbookPreviewResponse"];
export type SourceImportSummary = components["schemas"]["SourceImportSummary"];
export type Warehouse = components["schemas"]["Warehouse"];
export type InventoryProduct = components["schemas"]["InventoryProduct"];
export type StockItem = components["schemas"]["StockItem"];
export type InventoryMovement = components["schemas"]["InventoryMovement"];
export type OpeningCountSummary = components["schemas"]["OpeningCountSummary"];
export type OpeningCountRecord = components["schemas"]["OpeningCountRecord"];
export type OpeningCount = components["schemas"]["OpeningCount"];
export type OpeningCountResult = components["schemas"]["OpeningCountResult"];
export type CreateWarehouseRequest = components["schemas"]["CreateWarehouseRequest"];
export type SetProductionWarehouseRequest = components["schemas"]["SetProductionWarehouseRequest"];
export type OpeningCountRequest = components["schemas"]["OpeningCountRequest"];
export type InventoryMovementRequest = components["schemas"]["InventoryMovementRequest"];
export type InventoryTransferRequest = components["schemas"]["InventoryTransferRequest"];
export type InventoryMovementPage = { movements: InventoryMovement[]; nextCursor: { occurredAt: string; id: string } | null };
export type ScheduleCommandResult = {
  schedule: ProductionSchedule;
  replayed: boolean;
  conflict: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | undefined {
  const entry = document.cookie.split("; ").find((value) => value.startsWith("v3_csrf="));
  return entry ? decodeURIComponent(entry.slice("v3_csrf=".length)) : undefined;
}

function mutationHeaders(): { "X-CSRF-Token": string } {
  return { "X-CSRF-Token": csrfToken() ?? "" };
}

async function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): Promise<T> {
  if (result.data !== undefined && result.response.ok) return result.data;
  const error = result.error as { error?: unknown } | undefined;
  const message = typeof error?.error === "string" ? error.error : `Request failed (${result.response.status}).`;
  throw new ApiError(message, result.response.status);
}

export async function getSession(): Promise<AuthSession | null> {
  const result = await client.GET("/api/v3/auth/session");
  if (result.response.status === 401) return null;
  return unwrap(result);
}

export async function signIn(username: string, password: string): Promise<AuthSession> {
  return unwrap(await client.POST("/api/v3/auth/sign-in", { body: { username, password } }));
}

export async function getBootstrapStatus(): Promise<boolean> {
  const result = await unwrap(await client.GET("/api/v3/auth/bootstrap-status"));
  return result.available;
}

export async function bootstrapManager(
  username: string,
  password: string,
  bootstrapCode: string,
): Promise<AuthSession> {
  return unwrap(await client.POST("/api/v3/auth/bootstrap", {
    body: { username, password, bootstrapCode },
  }));
}

export async function signOut(): Promise<void> {
  const result = await client.POST("/api/v3/auth/sign-out", { params: { header: mutationHeaders() } });
  if (!result.response.ok) throw new ApiError("Sign-out could not be confirmed.", result.response.status);
}

export async function listRuns(limit = 50): Promise<Run[]> {
  const result = await unwrap(await client.GET("/api/v3/runs", { params: { query: { limit } } }));
  return result.runs;
}

export async function listRunProducts(): Promise<RunProduct[]> {
  const result = await unwrap(await client.GET("/api/v3/runs/products"));
  return result.products;
}

export async function createRun(input: {
  requestId: string;
  label: string;
  targetCases: number;
  productCode: string;
  productionSetupCode: string;
}): Promise<Run> {
  const { requestId, ...setupSnapshot } = input;
  const result = await unwrap(await client.POST("/api/v3/runs", {
    params: { header: mutationHeaders() },
    body: { requestId, setupSnapshot },
  }));
  return result.run;
}

export async function applyRunCommand(run: Run, commandType: RunCommand, commandId: string): Promise<RunCommandResult> {
  const result = await client.POST("/api/v3/runs/{runId}/commands", {
    params: { path: { runId: run.id }, header: mutationHeaders() },
    body: { commandId, commandType, expectedRevision: run.revision },
  });
  if (result.response.status === 409) {
    const conflict = result.error as { currentRun?: Run } | undefined;
    if (conflict?.currentRun) return { run: conflict.currentRun, conflict: true };
  }
  const accepted = await unwrap(result);
  return { run: accepted.run, conflict: false };
}

export async function applyStationCommand(
  run: Run,
  stationKey: StationKey,
  changes: Record<string, number>,
  commandId: string,
): Promise<RunCommandResult> {
  const result = await client.POST("/api/v3/runs/{runId}/stations/{stationKey}/commands", {
    params: { path: { runId: run.id, stationKey }, header: mutationHeaders() },
    body: { commandId, mode: "manual", expectedRevision: run.revision, changes },
  });
  if (result.response.status === 409) {
    const conflict = result.error as { currentRun?: Run } | undefined;
    if (conflict?.currentRun) return { run: conflict.currentRun, conflict: true };
  }
  const accepted = await unwrap(result);
  return { run: "run" in accepted ? accepted.run : accepted.currentRun, conflict: false };
}

export async function getStaffDirectory(): Promise<StaffDirectory> {
  return unwrap(await client.GET("/api/v3/auth/staff"));
}

export async function createStaffAccount(input: {
  username: string;
  password: string;
  roleName: string;
}): Promise<StaffDirectory> {
  return unwrap(await client.POST("/api/v3/auth/staff", {
    params: { header: mutationHeaders() },
    body: input,
  }));
}

export async function updateStaffAccount(
  userId: string,
  change: { disabled?: boolean; roleName?: string },
): Promise<StaffDirectory> {
  return unwrap(await client.PATCH("/api/v3/auth/staff/{staffId}", {
    params: { path: { staffId: userId }, header: mutationHeaders() },
    body: change,
  }));
}

function isProductionSchedule(value: unknown): value is ProductionSchedule {
  const candidate = value as Partial<ProductionSchedule> | undefined;
  return typeof candidate?.date === "string"
    && Number.isSafeInteger(candidate.revision)
    && candidate.timeZone === "America/Chicago"
    && typeof candidate.productionStartTime === "string"
    && Array.isArray(candidate.runs)
    && Array.isArray(candidate.breaks)
    && candidate.breaks.length === 3;
}

function isScheduleCatalog(value: unknown): value is ScheduleCatalog {
  const candidate = value as Partial<ScheduleCatalog> | undefined;
  return Array.isArray(candidate?.products)
    && Array.isArray(candidate.templates)
    && typeof candidate.productionStartTime === "string"
    && candidate.timeZone === "America/Chicago";
}

export async function getScheduleCatalog(): Promise<ScheduleCatalog> {
  const catalog = await unwrap(await client.GET("/api/v3/schedules/catalog"));
  if (!isScheduleCatalog(catalog)) throw new ApiError("The schedule catalog was incomplete. Refresh and retry.", 502);
  return catalog;
}

export async function getProductionSchedule(date: string): Promise<ProductionSchedule> {
  const result = await unwrap(await client.GET("/api/v3/schedules", { params: { query: { date } } }));
  if (!isProductionSchedule(result.schedule) || result.schedule.date !== date) {
    throw new ApiError("The server returned an incomplete schedule. Refresh and retry.", 502);
  }
  return result.schedule;
}

export async function applyProductionScheduleCommand(
  request: ScheduleCommandRequest,
): Promise<ScheduleCommandResult> {
  const result = await client.POST("/api/v3/schedules/commands", {
    params: { header: mutationHeaders() },
    body: request,
  });
  if (result.response.status === 409) {
    const conflict = result.error as Partial<components["schemas"]["ProductionScheduleCommandResponse"]> | undefined;
    if (conflict?.outcome === "conflict" && isProductionSchedule(conflict.schedule)) {
      return { schedule: conflict.schedule, replayed: false, conflict: true };
    }
  }
  const accepted = await unwrap(result);
  if (accepted.outcome !== "accepted" || !isProductionSchedule(accepted.schedule)) {
    throw new ApiError("The server did not confirm the schedule change. Retry the same request.", 502);
  }
  return { schedule: accepted.schedule, replayed: accepted.replayed, conflict: false };
}

export async function previewProductionScheduleWorkbook(input: {
  fileName: string;
  workbookBase64: string;
  signal: AbortSignal;
}): Promise<ScheduleWorkbookPreview> {
  const { signal, ...body } = input;
  const result = await unwrap(await client.POST("/api/v3/schedules/import-preview", {
    params: { header: mutationHeaders() },
    body,
    signal,
  }));
  const preview = result.preview;
  if (!Array.isArray(preview.rows) || !Array.isArray(preview.errors)
    || !Array.isArray(preview.skipped) || typeof preview.multiDay !== "boolean") {
    throw new ApiError("The workbook review was incomplete. No schedule changes were made.", 502);
  }
  return preview;
}

const SETUP_CATALOG_FAMILIES: SetupCatalogFamily[] = [
  "ingredients", "mixes", "die-types", "die-line-defaults", "production-rules",
  "freezer-pull-items", "run-templates", "manager-lists", "aliases",
];
const SOURCE_WORKBOOK_FAMILIES: SourceWorkbookFamily[] = [
  "spec-sheets", "premix-sheets", "cheese-mix-specs", "shipping-guides", "sauce-guides", "dough-guides",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSetupCatalogRecord(value: unknown): value is SetupCatalogRecord {
  return object(value) && typeof value.code === "string" && typeof value.name === "string" && object(value.data);
}

export function isSourceImportSummary(value: unknown): value is SourceImportSummary {
  return object(value)
    && SOURCE_WORKBOOK_FAMILIES.includes(value.sourceFamily as SourceWorkbookFamily)
    && typeof value.sourceSha256 === "string" && /^[0-9a-f]{64}$/u.test(value.sourceSha256)
    && value.parserVersion === "v1-source-import/1"
    && ["sourceRows", "importedRows", "skippedRows", "unresolvedRows"].every((key) =>
      Number.isSafeInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 2000);
}

function isSourceWorkbookPreview(value: unknown): value is SourceWorkbookPreview {
  if (!object(value) || !SOURCE_WORKBOOK_FAMILIES.includes(value.family as SourceWorkbookFamily)) return false;
  const targetFamily = value.family === "premix-sheets" ? "mixes" : "run-templates";
  return value.targetFamily === targetFamily && value.parserVersion === "v1-source-import/1"
    && typeof value.fileSha256 === "string" && /^[0-9a-f]{64}$/u.test(value.fileSha256)
    && Number.isSafeInteger(value.sourceRows) && Number(value.sourceRows) >= 0 && Number(value.sourceRows) <= 2000
    && Number.isSafeInteger(value.proposedRows) && Number(value.proposedRows) >= 0 && Number(value.proposedRows) <= 2000
    && Number.isSafeInteger(value.skippedRows) && Number(value.skippedRows) >= 0 && Number(value.skippedRows) <= 2000
    && Array.isArray(value.records) && value.records.length === value.proposedRows
    && value.records.every((item) => object(item) && typeof item.source === "string" && item.source.length <= 240
      && item.targetFamily === targetFamily && isSetupCatalogRecord(item.record)
      && (item.sourceDetails === undefined || (object(item.sourceDetails) && JSON.stringify(item.sourceDetails).length <= 20_000)))
    && Array.isArray(value.unresolvedRows) && value.unresolvedRows.length <= 2000
    && value.unresolvedRows.every((item) => object(item) && typeof item.source === "string" && item.source.length <= 240
      && typeof item.reason === "string" && item.reason.length <= 300);
}

function isSetupCatalogHistoryItem(value: unknown): value is SetupCatalogHistoryItem {
  return object(value) && typeof value.id === "string" && UUID.test(value.id)
    && typeof value.family === "string" && ["staged", "applied", "undone"].includes(String(value.status))
    && Number.isSafeInteger(value.rowCount) && Number(value.rowCount) >= 1
    && typeof value.createdBy === "string" && typeof value.createdAt === "string"
    && (value.appliedAt === null || typeof value.appliedAt === "string")
    && (value.undoneAt === null || typeof value.undoneAt === "string")
    && (value.sourceSummary == null || isSourceImportSummary(value.sourceSummary));
}

function isSetupCatalogDetail(value: unknown): value is SetupCatalogDetail {
  if (!isSetupCatalogHistoryItem(value)) return false;
  const records = (value as unknown as { records?: unknown }).records;
  return Array.isArray(records) && records.length === value.rowCount && records.every(isSetupCatalogRecord);
}

export async function previewSourceWorkbook(input: {
  family: SourceWorkbookFamily;
  fileName: string;
  workbookBase64: string;
  signal: AbortSignal;
}): Promise<SourceWorkbookPreview> {
  const { signal, ...body } = input;
  const result = await unwrap(await client.POST("/api/v3/setup-catalog/imports/workbooks/preview", {
    params: { header: mutationHeaders() },
    body,
    signal,
  }));
  if (!isSourceWorkbookPreview(result) || result.family !== body.family) {
    throw new ApiError("The server returned an incomplete source-workbook review. Nothing was staged.", 502);
  }
  return result;
}

export async function listSetupCatalogImports(): Promise<SetupCatalogHistoryItem[]> {
  const result = await unwrap(await client.GET("/api/v3/setup-catalog/imports", {
    params: { query: { limit: 50 } },
  }));
  if (!Array.isArray(result.imports) || !result.imports.every(isSetupCatalogHistoryItem)) {
    throw new ApiError("The server returned incomplete setup import history. Refresh and retry.", 502);
  }
  return result.imports;
}

export async function getSetupCatalogImport(importId: string): Promise<SetupCatalogDetail> {
  const result = await unwrap(await client.GET("/api/v3/setup-catalog/imports/{importId}", {
    params: { path: { importId } },
  }));
  if (!isSetupCatalogDetail(result)) {
    throw new ApiError("The stored setup review was incomplete. Reload history and retry.", 502);
  }
  return result;
}

export async function stageSetupCatalogImport(
  request: SetupCatalogStageRequest,
): Promise<SetupCatalogStageResponse> {
  const result = await unwrap(await client.POST("/api/v3/setup-catalog/imports", {
    params: { header: mutationHeaders() },
    body: request,
  }));
  if (result.outcome !== "staged" || !UUID.test(result.importId)
    || !SETUP_CATALOG_FAMILIES.includes(result.family) || result.family !== request.family
    || !Number.isSafeInteger(result.rowCount) || result.rowCount < 1
    || !Array.isArray(result.records) || result.records.length !== result.rowCount
    || !result.records.every(isSetupCatalogRecord) || typeof result.replayed !== "boolean"
    || (request.sourceSummary
      ? !isSourceImportSummary(result.sourceSummary)
        || !(["sourceFamily", "sourceSha256", "parserVersion", "sourceRows", "importedRows", "skippedRows", "unresolvedRows"] as const)
          .every((key) => result.sourceSummary?.[key] === request.sourceSummary?.[key])
      : result.sourceSummary != null)) {
    throw new ApiError("The server did not return a complete staged setup review. Retry the same request.", 502);
  }
  return result;
}

export async function actOnSetupCatalogImport(
  importId: string,
  action: "apply" | "undo",
): Promise<SetupCatalogActionResult> {
  const path = action === "apply"
    ? "/api/v3/setup-catalog/imports/{importId}/apply"
    : "/api/v3/setup-catalog/imports/{importId}/undo";
  const result = await unwrap(await client.POST(path, {
    params: { path: { importId }, header: mutationHeaders() },
    body: {},
  }));
  const expectedOutcome = action === "apply" ? "applied" : "undone";
  if (result.outcome !== expectedOutcome || result.importId !== importId || typeof result.replayed !== "boolean") {
    throw new ApiError("The server did not confirm the setup action. Reload history before retrying.", 502);
  }
  return result;
}


const INVENTORY_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const INVENTORY_QUANTITY = /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/u;

function isWarehouseCreation(
  value: unknown,
): value is Omit<Warehouse, "isProduction"> & Partial<Pick<Warehouse, "isProduction">> {
  return object(value) && UUID.test(String(value.id)) && typeof value.name === "string"
    && value.name.length > 0 && value.name.length <= 120 && typeof value.active === "boolean"
    && typeof value.createdAt === "string" && typeof value.openingCountApplied === "boolean";
}

function isWarehouse(value: unknown): value is Warehouse {
  return isWarehouseCreation(value) && typeof value.isProduction === "boolean";
}

function isInventoryProduct(value: unknown): value is InventoryProduct {
  return object(value) && UUID.test(String(value.id)) && typeof value.code === "string"
    && INVENTORY_CODE.test(value.code) && typeof value.name === "string" && typeof value.unit === "string"
    && typeof value.active === "boolean";
}

function isStockItem(value: unknown): value is StockItem {
  return object(value) && UUID.test(String(value.productId)) && typeof value.code === "string"
    && INVENTORY_CODE.test(value.code) && typeof value.name === "string" && typeof value.unit === "string"
    && typeof value.quantity === "string" && INVENTORY_QUANTITY.test(value.quantity) && !value.quantity.startsWith("-")
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0;
}

function isInventoryMovement(value: unknown): value is InventoryMovement {
  return object(value) && UUID.test(String(value.id)) && UUID.test(String(value.movementGroupId))
    && typeof value.productCode === "string" && INVENTORY_CODE.test(value.productCode)
    && typeof value.productName === "string" && typeof value.unit === "string"
    && ["receipt", "adjustment", "transfer_out", "transfer_in", "opening_count", "run_consumption"].includes(String(value.type))
    && typeof value.quantityDelta === "string" && INVENTORY_QUANTITY.test(value.quantityDelta)
    && typeof value.reason === "string" && UUID.test(String(value.actorId)) && typeof value.occurredAt === "string";
}

function isOpeningCountRows(value: unknown): value is OpeningCount["rows"] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2000 && value.every((row) =>
    object(row) && typeof row.productCode === "string" && INVENTORY_CODE.test(row.productCode)
    && typeof row.quantity === "string" && INVENTORY_QUANTITY.test(row.quantity) && !row.quantity.startsWith("-"));
}

function isOpeningCountSummary(value: unknown): value is OpeningCountSummary {
  return object(value) && UUID.test(String(value.id)) && UUID.test(String(value.warehouseId))
    && typeof value.warehouseName === "string" && ["staged", "reviewed", "applied"].includes(String(value.status))
    && Number.isSafeInteger(value.rowCount) && Number(value.rowCount) >= 1 && Number(value.rowCount) <= 2000
    && UUID.test(String(value.createdBy))
    && (value.reviewedBy === null || UUID.test(String(value.reviewedBy)))
    && (value.appliedBy === null || UUID.test(String(value.appliedBy)))
    && typeof value.createdAt === "string"
    && (value.reviewedAt === null || typeof value.reviewedAt === "string")
    && (value.appliedAt === null || typeof value.appliedAt === "string");
}

function isOpeningCountRecord(value: unknown): value is OpeningCountRecord {
  return object(value) && UUID.test(String(value.id)) && UUID.test(String(value.warehouseId))
    && ["staged", "reviewed", "applied"].includes(String(value.status)) && isOpeningCountRows(value.rows)
    && UUID.test(String(value.createdBy))
    && (value.reviewedBy === null || UUID.test(String(value.reviewedBy)))
    && (value.appliedBy === null || UUID.test(String(value.appliedBy)))
    && typeof value.createdAt === "string"
    && (value.reviewedAt === null || typeof value.reviewedAt === "string")
    && (value.appliedAt === null || typeof value.appliedAt === "string")
    && (value.result === null || object(value.result));
}

function isOpeningCountResult(value: unknown): value is OpeningCountResult {
  return object(value) && ["reviewed", "applied"].includes(String(value.outcome))
    && UUID.test(String(value.countId)) && UUID.test(String(value.warehouseId))
    && Number.isSafeInteger(value.rowCount) && Number(value.rowCount) >= 1 && typeof value.replayed === "boolean";
}

export async function listInventoryWarehouses(): Promise<Warehouse[]> {
  const result = await unwrap(await client.GET("/api/v3/inventory/warehouses"));
  if (!Array.isArray(result.warehouses) || !result.warehouses.every(isWarehouse)) {
    throw new ApiError("The warehouse list was incomplete. Refresh and retry.", 502);
  }
  return result.warehouses;
}

export async function createInventoryWarehouse(request: CreateWarehouseRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/warehouses", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "created" || typeof result.replayed !== "boolean" || !isWarehouseCreation(result.warehouse)) {
    throw new ApiError("The server did not return a complete warehouse confirmation. Retry the same request.", 502);
  }
  return result;
}

export async function setProductionWarehouse(request: SetProductionWarehouseRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/production-warehouse", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean"
    || !isWarehouse(result.warehouse) || result.warehouse.id !== request.warehouseId) {
    throw new ApiError("The server did not confirm the production warehouse. Retry the same request.", 502);
  }
  return result;
}

export async function listInventoryProducts(): Promise<InventoryProduct[]> {
  const result = await unwrap(await client.GET("/api/v3/inventory/products"));
  if (!Array.isArray(result.products) || !result.products.every(isInventoryProduct)) {
    throw new ApiError("The inventory product list was incomplete. Refresh and retry.", 502);
  }
  return result.products;
}

export async function listWarehouseStock(warehouseId: string): Promise<StockItem[]> {
  const result = await unwrap(await client.GET("/api/v3/inventory/stock", { params: { query: { warehouseId } } }));
  if (!Array.isArray(result.stock) || !result.stock.every(isStockItem)) {
    throw new ApiError("The warehouse stock was incomplete. Refresh and retry.", 502);
  }
  return result.stock;
}

export async function listInventoryMovements(
  warehouseId: string,
  cursor?: { occurredAt: string; id: string },
): Promise<InventoryMovementPage> {
  const result = await unwrap(await client.GET("/api/v3/inventory/movements", {
    params: { query: { warehouseId, limit: 50, ...(cursor ? { beforeAt: cursor.occurredAt, beforeId: cursor.id } : {}) } },
  }));
  const cursorValid = result.nextCursor === null || (object(result.nextCursor)
    && typeof result.nextCursor.occurredAt === "string" && UUID.test(String(result.nextCursor.id)));
  if (!Array.isArray(result.movements) || !result.movements.every(isInventoryMovement) || !cursorValid) {
    throw new ApiError("The movement history was incomplete. Refresh and retry.", 502);
  }
  return { movements: result.movements, nextCursor: result.nextCursor };
}

export async function recordInventoryMovement(request: InventoryMovementRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/movements", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean"
    || !UUID.test(result.movementId) || result.warehouseId !== request.warehouseId
    || result.productCode !== request.productCode || typeof result.quantity !== "string"
    || !INVENTORY_QUANTITY.test(result.quantity) || result.quantity.startsWith("-")
    || !Number.isSafeInteger(result.revision) || result.revision < 0) {
    throw new ApiError("The server did not confirm the inventory movement. Retry the same request.", 502);
  }
  return result;
}

export async function transferInventory(request: InventoryTransferRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/transfers", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean"
    || !UUID.test(result.transferId) || result.productCode !== request.productCode
    || result.quantity !== request.quantity
    || result.sourceWarehouseId !== request.sourceWarehouseId
    || result.targetWarehouseId !== request.targetWarehouseId
    || typeof result.sourceQuantity !== "string" || !INVENTORY_QUANTITY.test(result.sourceQuantity)
    || result.sourceQuantity.startsWith("-")
    || typeof result.targetQuantity !== "string" || !INVENTORY_QUANTITY.test(result.targetQuantity)
    || result.targetQuantity.startsWith("-")
    || !Number.isSafeInteger(result.sourceRevision) || result.sourceRevision < 0
    || !Number.isSafeInteger(result.targetRevision) || result.targetRevision < 0) {
    throw new ApiError("The server did not confirm the inventory transfer. Retry the same request.", 502);
  }
  return result;
}

export async function listOpeningCounts(): Promise<OpeningCountSummary[]> {
  const result = await unwrap(await client.GET("/api/v3/inventory/opening-counts", { params: { query: { limit: 50 } } }));
  if (!Array.isArray(result.counts) || !result.counts.every(isOpeningCountSummary)) {
    throw new ApiError("The physical-count history was incomplete. Refresh and retry.", 502);
  }
  return result.counts;
}

export async function stageOpeningCount(request: OpeningCountRequest): Promise<OpeningCount> {
  const result = await unwrap(await client.POST("/api/v3/inventory/opening-counts", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "staged" || !UUID.test(result.countId) || result.warehouseId !== request.warehouseId
    || !Number.isSafeInteger(result.rowCount) || typeof result.replayed !== "boolean"
    || !isOpeningCountRows(result.rows) || result.rows.length !== result.rowCount) {
    throw new ApiError("The server did not return a complete physical-count review. Retry the same request.", 502);
  }
  return result;
}

export async function getOpeningCount(countId: string): Promise<OpeningCountRecord> {
  const result = await unwrap(await client.GET("/api/v3/inventory/opening-counts/{countId}", {
    params: { path: { countId } },
  }));
  if (!isOpeningCountRecord(result.count) || result.count.id !== countId) {
    throw new ApiError("The stored physical count was incomplete. Reload history and retry.", 502);
  }
  return result.count;
}

export async function actOnOpeningCount(countId: string, action: "review" | "apply"): Promise<OpeningCountResult> {
  const path = action === "review"
    ? "/api/v3/inventory/opening-counts/{countId}/review"
    : "/api/v3/inventory/opening-counts/{countId}/apply";
  const result = await unwrap(await client.POST(path, {
    params: { path: { countId }, header: mutationHeaders() }, body: {},
  }));
  const expectedOutcome = action === "review" ? "reviewed" : "applied";
  if (result.outcome !== expectedOutcome || result.countId !== countId || !isOpeningCountResult(result)) {
    throw new ApiError("The server did not confirm the physical-count action. Retry the same request.", 502);
  }
  return result;
}
