import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

const client = createClient<paths>({ baseUrl: "/" });

export type AuthSession = components["schemas"]["AuthSession"];
export type Run = components["schemas"]["Run"];
export type RunProduct = components["schemas"]["RunProduct"];
export type RunStatus = Run["status"];
export type RunCommand = "start" | "pause" | "resume" | "complete";
export type RunCommandResult = { run: Run; conflict: boolean };
export type Stoppage = components["schemas"]["Stoppage"];
export type RunOperationType = components["schemas"]["RunOperationCommand"]["commandType"];
export type RunOperationDetails = components["schemas"]["RunOperationCommand"]["details"];
export type StopReasonSettings = components["schemas"]["StopReasonSettings"];
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
export type SubstitutionOverlay = components["schemas"]["SubstitutionOverlay"];
export type SubstitutionRule = components["schemas"]["SubstitutionRule"];
export type SubstitutionProduct = components["schemas"]["SubstitutionProduct"];
export type SubstitutionCommandRequest = components["schemas"]["SubstitutionCommandRequest"];
export type SetupCatalogFamily = components["schemas"]["SetupCatalogStageResponse"]["family"];
export type SetupCatalogRecord = components["schemas"]["SetupCatalogRecord"];
export type SetupCatalogHistoryItem = components["schemas"]["SetupCatalogHistoryItem"];
export type SetupCatalogDetail = components["schemas"]["SetupCatalogDetail"];
export type SetupCatalogStageResponse = components["schemas"]["SetupCatalogStageResponse"];
export type SetupCatalogActionResult = components["schemas"]["SetupCatalogActionResult"];
export type SetupCatalogStageRequest = components["schemas"]["SetupCatalogRequest"];
export type SetupCatalogEditRequest = components["schemas"]["SetupCatalogEditRequest"];
export type SetupCatalogRecordPage = components["schemas"]["SetupCatalogRecordPage"];
export type SetupCatalogListedRecord = components["schemas"]["SetupCatalogListedRecord"];
export type SetupMasterKind = components["schemas"]["SetupMasterEditRequest"]["kind"];
export type SetupMasterRecord = components["schemas"]["SetupImportMasterRecord"];
export type SetupMasterListedRecord = components["schemas"]["SetupMasterListedRecord"];
export type SetupMasterRecordPage = components["schemas"]["SetupMasterRecordPage"];
export type SetupMasterEditRequest = components["schemas"]["SetupMasterEditRequest"];
export type SetupMasterStageResponse = components["schemas"]["SetupImportPreview"];
export type SetupImportHistoryItem = components["schemas"]["ImportHistoryItem"];
export type SetupImportDetail = components["schemas"]["SetupImportDetail"];
export type SetupImportActionResult = components["schemas"]["ImportResult"];
export type ReviewedDieDefault = components["schemas"]["ReviewedDieDefault"];
export type ReviewedDieLineSettings = components["schemas"]["ReviewedDieLineSettings"];
export type DieDefaultHistoryItem = components["schemas"]["DieDefaultHistoryItem"];
export type DieDefaultSaveRequest = components["schemas"]["DieDefaultSaveRequest"];
export type DieDefaultSaveResult = components["schemas"]["DieDefaultSaveResult"];
export type ReviewedDieDefaults = { defaults: ReviewedDieDefault[]; history: DieDefaultHistoryItem[] };
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
export type WarehouseGuidance = components["schemas"]["WarehouseGuidance"];
export type CycleCountSchedule = components["schemas"]["CycleCountSchedule"];
export type MarkCycleCountedRequest = components["schemas"]["MarkCycleCountedRequest"];
export type SaveCycleCountScheduleRequest = components["schemas"]["SaveCycleCountScheduleRequest"];
export type SaveWarehouseGuidanceSettingsRequest = components["schemas"]["SaveWarehouseGuidanceSettingsRequest"];
export type FreezerSurplusLedger = components["schemas"]["FreezerSurplusLedger"];
export type FreezerSurplusLot = components["schemas"]["FreezerSurplusLot"];
export type FreezerSurplusEvent = components["schemas"]["FreezerSurplusEvent"];
export type ConfirmFreezerSurplusRequest = components["schemas"]["ConfirmFreezerSurplusRequest"];
export type AllocateFreezerSurplusRequest = components["schemas"]["AllocateFreezerSurplusRequest"];
export type AdjustFreezerSurplusRequest = components["schemas"]["AdjustFreezerSurplusRequest"];
export type InventoryMovementPage = { movements: InventoryMovement[]; nextCursor: { occurredAt: string; id: string } | null };
export type ScheduleCommandResult = {
  schedule: ProductionSchedule;
  replayed: boolean;
  conflict: boolean;
};
export type SubstitutionCommandResult = {
  overlay: SubstitutionOverlay;
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
  productionDate: string;
  label: string;
  targetCases: number;
  productCode: string;
  productionSetupCode: string;
}): Promise<Run> {
  const { requestId, productionDate, ...setupSnapshot } = input;
  const result = await unwrap(await client.POST("/api/v3/runs", {
    params: { header: mutationHeaders() },
    body: { requestId, productionDate, setupSnapshot },
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

export async function applyRunToTime(run: Run, runToTime: string, commandId: string): Promise<RunCommandResult> {
  const result = await client.POST("/api/v3/runs/{runId}/run-to-time", {
    params: { path: { runId: run.id }, header: mutationHeaders() },
    body: { commandId, expectedRevision: run.revision, runToTime },
  });
  if (result.response.status === 409) {
    const conflict = result.error as { currentRun?: Run } | undefined;
    if (conflict?.currentRun) return { run: conflict.currentRun, conflict: true };
  }
  const accepted = await unwrap(result);
  return { run: accepted.run, conflict: false };
}

export async function applyRunOperation(
  run: Run,
  commandType: RunOperationType,
  details: RunOperationDetails,
  commandId: string,
): Promise<RunCommandResult> {
  const result = await client.POST("/api/v3/runs/{runId}/operations/commands", {
    params: { path: { runId: run.id }, header: mutationHeaders() },
    body: { commandId, commandType, expectedRevision: run.revision, details },
  });
  if (result.response.status === 409) {
    const conflict = result.error as { currentRun?: Run } | undefined;
    if (conflict?.currentRun) return { run: conflict.currentRun, conflict: true };
  }
  const accepted = await unwrap(result);
  return { run: accepted.run, conflict: false };
}

export async function getStopReasonSettings(): Promise<StopReasonSettings> {
  const result = await unwrap(await client.GET("/api/v3/operations/stop-reasons"));
  if (!result.settings || !Array.isArray(result.settings.reasons) || !Number.isSafeInteger(result.settings.revision)) {
    throw new ApiError("Stop reasons were incomplete. Refresh and retry.", 502);
  }
  return result.settings;
}

export async function saveStopReasonSettings(
  settings: StopReasonSettings,
  reasons: string[],
  commandId: string,
): Promise<{ settings: StopReasonSettings; conflict: boolean }> {
  const result = await client.POST("/api/v3/operations/stop-reasons", {
    params: { header: mutationHeaders() },
    body: { commandId, expectedRevision: settings.revision, reasons },
  });
  if (result.response.status === 409) {
    const conflict = result.error as { currentSettings?: StopReasonSettings } | undefined;
    if (conflict?.currentSettings) return { settings: conflict.currentSettings, conflict: true };
  }
  const accepted = await unwrap(result);
  if (accepted.outcome !== "accepted" || !accepted.settings) {
    throw new ApiError("The server did not confirm the stop reasons. Retry the same request.", 502);
  }
  return { settings: accepted.settings, conflict: false };
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
    && candidate.runs.every((run) => Array.isArray(run.readinessWarnings))
    && Array.isArray(candidate.breaks)
    && candidate.breaks.length === 3
    && isSubstitutionOverlay(candidate.substitutionOverlay, candidate.date);
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

function isSubstitutionOverlay(value: unknown, productionDate?: string): value is SubstitutionOverlay {
  const candidate = value as Partial<SubstitutionOverlay> | undefined;
  return typeof candidate?.productionDate === "string"
    && (productionDate === undefined || candidate.productionDate === productionDate)
    && Number.isSafeInteger(candidate.revision) && Number(candidate.revision) >= 0
    && Array.isArray(candidate.rules)
    && candidate.rules.every((rule) => typeof rule.id === "string"
      && typeof rule.ingredient === "string" && ["swap", "add", "remove"].includes(rule.action))
    && (candidate.updatedAt === null || typeof candidate.updatedAt === "string");
}

export async function getSubstitutionOverlay(productionDate: string): Promise<SubstitutionOverlay> {
  const result = await unwrap(await client.GET("/api/v3/schedules/substitutions", {
    params: { query: { date: productionDate } },
  }));
  if (!isSubstitutionOverlay(result.overlay, productionDate)) {
    throw new ApiError("The server returned an incomplete substitution overlay. Refresh and retry.", 502);
  }
  return result.overlay;
}

export async function listSubstitutionProducts(): Promise<SubstitutionProduct[]> {
  const result = await unwrap(await client.GET("/api/v3/schedules/substitution-products"));
  if (!Array.isArray(result.products) || result.products.some((product) => typeof product.productId !== "string"
    || typeof product.productCode !== "string" || typeof product.productName !== "string"
    || typeof product.baseUnit !== "string")) {
    throw new ApiError("The substitution product list was incomplete. Refresh and retry.", 502);
  }
  return result.products;
}

export async function applySubstitutionCommand(
  request: SubstitutionCommandRequest,
): Promise<SubstitutionCommandResult> {
  const result = await client.POST("/api/v3/schedules/substitutions/commands", {
    params: { header: mutationHeaders() },
    body: request,
  });
  if (result.response.status === 409) {
    const conflict = result.error as Partial<components["schemas"]["SubstitutionCommandConflict"]> | undefined;
    if (conflict?.outcome === "conflict" && isSubstitutionOverlay(conflict.currentOverlay, request.date)) {
      return { overlay: conflict.currentOverlay, replayed: false, conflict: true };
    }
  }
  const accepted = await unwrap(result);
  if (accepted.outcome !== "accepted" || accepted.commandId !== request.requestId.toLowerCase()
    || !isSubstitutionOverlay(accepted.overlay, request.date)) {
    throw new ApiError("The server did not confirm the substitution change. Retry the same request.", 502);
  }
  return { overlay: accepted.overlay, replayed: accepted.replayed, conflict: false };
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

function isSetupCatalogListedRecord(value: unknown): value is SetupCatalogListedRecord {
  const candidate = value as (SetupCatalogRecord & { fingerprint?: unknown }) | null;
  return isSetupCatalogRecord(candidate) && typeof candidate.fingerprint === "string"
    && /^[0-9a-f]{64}$/u.test(candidate.fingerprint);
}

const DIE_DEFAULT_FIELDS = [
  "crustsPerCycle", "cycleSpeed", "speedAdjustment", "freezerTime", "casesPerLayer",
  "preTunnelMin", "postTunnelMin", "pressOvenMin", "frontlineMin",
] as const;
const REQUIRED_DIE_DEFAULT_FIELDS = new Set<string>(DIE_DEFAULT_FIELDS.slice(0, 5));

function isReviewedDieLineSettings(value: unknown): value is ReviewedDieLineSettings {
  return object(value) && Object.keys(value).length === DIE_DEFAULT_FIELDS.length
    && DIE_DEFAULT_FIELDS.every((key) => {
      const item = value[key];
      return (typeof item === "number" && Number.isFinite(item) && item >= 0)
        || (item === null && !REQUIRED_DIE_DEFAULT_FIELDS.has(key));
    });
}

function isReviewedDieDefault(value: unknown): value is ReviewedDieDefault {
  return object(value) && typeof value.code === "string" && typeof value.name === "string"
    && ["active", "disabled", "unreviewed"].includes(String(value.status))
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
    && (value.defaults === null || isReviewedDieLineSettings(value.defaults))
    && (value.suggestedDefaults === null || isReviewedDieLineSettings(value.suggestedDefaults));
}

function isDieDefaultHistoryItem(value: unknown): value is DieDefaultHistoryItem {
  return object(value) && typeof value.id === "string" && UUID.test(value.id)
    && typeof value.dieCode === "string" && typeof value.actorId === "string" && UUID.test(value.actorId)
    && ["created", "updated", "retired", "re-enabled"].includes(String(value.action))
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1
    && (value.before === null || object(value.before)) && object(value.after)
    && typeof value.occurredAt === "string";
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
  const candidate = value as SetupCatalogHistoryItem & Partial<SetupCatalogDetail>;
  return Array.isArray(candidate.records) && candidate.records.length === value.rowCount
    && candidate.records.every(isSetupCatalogRecord)
    && (candidate.editorBefore === null || isSetupCatalogRecord(candidate.editorBefore))
    && (candidate.before === null || (Array.isArray(candidate.before) && candidate.before.every(object)))
    && (candidate.after === null || (Array.isArray(candidate.after) && candidate.after.every(object)));
}

function isSetupMasterRecord(value: unknown): value is SetupMasterRecord {
  return object(value) && typeof value.code === "string" && typeof value.name === "string"
    && typeof value.productCode === "string" && object(value.data);
}

function isSetupMasterListedRecord(value: unknown): value is SetupMasterListedRecord {
  const candidate = value as (SetupMasterRecord & { fingerprint?: unknown }) | null;
  return isSetupMasterRecord(candidate) && typeof candidate.fingerprint === "string"
    && /^[0-9a-f]{64}$/u.test(candidate.fingerprint);
}

function isSetupImportProduct(value: unknown): value is components["schemas"]["SetupImportProduct"] {
  return object(value) && typeof value.code === "string" && typeof value.name === "string"
    && typeof value.unit === "string";
}

function isSetupImportHistoryItem(value: unknown): value is SetupImportHistoryItem {
  return object(value) && typeof value.id === "string" && UUID.test(value.id)
    && ["products", "recipes", "production-setups"].includes(String(value.kind))
    && ["staged", "applied", "undone"].includes(String(value.status))
    && Number.isSafeInteger(value.rowCount) && Number(value.rowCount) >= 1
    && typeof value.createdBy === "string" && UUID.test(value.createdBy)
    && (value.appliedBy === null || (typeof value.appliedBy === "string" && UUID.test(value.appliedBy)))
    && (value.undoneBy === null || (typeof value.undoneBy === "string" && UUID.test(value.undoneBy)))
    && typeof value.createdAt === "string"
    && (value.appliedAt === null || typeof value.appliedAt === "string")
    && (value.undoneAt === null || typeof value.undoneAt === "string");
}

function isSetupImportDetail(value: unknown): value is SetupImportDetail {
  if (!isSetupImportHistoryItem(value)) return false;
  const candidate = value as SetupImportHistoryItem & Partial<SetupImportDetail>;
  return Array.isArray(candidate.records) && candidate.records.length === value.rowCount
    && candidate.records.every((record) => value.kind === "products"
      ? isSetupImportProduct(record)
      : isSetupMasterRecord(record))
    && (candidate.editorBefore === null || isSetupMasterRecord(candidate.editorBefore))
    && (candidate.before === null || (Array.isArray(candidate.before) && candidate.before.every(object)))
    && (candidate.after === null || (Array.isArray(candidate.after) && candidate.after.every(object)));
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

export async function listSetupCatalogRecords(
  family: SetupCatalogFamily,
  after: string | null = null,
): Promise<SetupCatalogRecordPage> {
  const result = await unwrap(await client.GET("/api/v3/setup-catalog/records", {
    params: { query: { family, limit: 100, ...(after ? { after } : {}) } },
  }));
  if (result.family !== family || !Array.isArray(result.records) || result.records.length > 100
    || !result.records.every(isSetupCatalogListedRecord)
    || (result.nextCursor !== null
      && (typeof result.nextCursor !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(result.nextCursor)))) {
    throw new ApiError("The server returned an incomplete setup catalog page. Refresh and retry.", 502);
  }
  return result;
}

export async function stageSetupCatalogEdit(
  request: SetupCatalogEditRequest,
): Promise<SetupCatalogStageResponse> {
  const result = await unwrap(await client.POST("/api/v3/setup-catalog/edits", {
    params: { header: mutationHeaders() },
    body: request,
  }));
  if (result.outcome !== "staged" || !UUID.test(result.importId) || result.family !== request.family
    || result.rowCount !== 1 || typeof result.replayed !== "boolean"
    || !Array.isArray(result.records) || result.records.length !== 1 || !isSetupCatalogRecord(result.records[0])) {
    throw new ApiError("The server did not return a complete typed setup review. Retry the same request.", 502);
  }
  return result;
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

export async function listSetupImports(): Promise<SetupImportHistoryItem[]> {
  const result = await unwrap(await client.GET("/api/v3/imports", {
    params: { query: { limit: 50 } },
  }));
  if (!Array.isArray(result.imports) || !result.imports.every(isSetupImportHistoryItem)) {
    throw new ApiError("The server returned incomplete setup import history. Refresh and retry.", 502);
  }
  return result.imports;
}

export async function listSetupMasterRecords(
  kind: SetupMasterKind,
  after: string | null = null,
): Promise<SetupMasterRecordPage> {
  const result = await unwrap(await client.GET("/api/v3/imports/records", {
    params: { query: { kind, limit: 100, ...(after ? { after } : {}) } },
  }));
  if (result.kind !== kind || !Array.isArray(result.records) || result.records.length > 100
    || !result.records.every(isSetupMasterListedRecord)
    || (result.nextCursor !== null
      && (typeof result.nextCursor !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(result.nextCursor)))) {
    throw new ApiError("The server returned an incomplete setup record page. Refresh and retry.", 502);
  }
  return result;
}

export async function stageSetupMasterEdit(
  request: SetupMasterEditRequest,
): Promise<SetupMasterStageResponse> {
  const result = await unwrap(await client.POST("/api/v3/imports/edits", {
    params: { header: mutationHeaders() },
    body: request,
  }));
  if (result.outcome !== "staged" || !UUID.test(result.importId) || result.kind !== request.kind
    || result.rowCount !== 1 || typeof result.replayed !== "boolean"
    || !Array.isArray(result.records) || result.records.length !== 1 || !isSetupMasterRecord(result.records[0])) {
    throw new ApiError("The server did not return a complete typed capacity review. Retry the same request.", 502);
  }
  return result;
}

export async function getSetupImport(importId: string): Promise<SetupImportDetail> {
  const result = await unwrap(await client.GET("/api/v3/imports/{importId}", {
    params: { path: { importId } },
  }));
  if (!isSetupImportDetail(result.import)) {
    throw new ApiError("The stored setup review was incomplete. Reload history and retry.", 502);
  }
  return result.import;
}

export async function actOnSetupImport(
  importId: string,
  action: "apply" | "undo",
): Promise<SetupImportActionResult> {
  const path = action === "apply"
    ? "/api/v3/imports/{importId}/apply"
    : "/api/v3/imports/{importId}/undo";
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

export async function listReviewedDieDefaults(): Promise<ReviewedDieDefaults> {
  const result = await unwrap(await client.GET("/api/v3/inventory/die-defaults", {
    params: { query: { limit: 50 } },
  }));
  if (!Array.isArray(result.defaults) || !result.defaults.every(isReviewedDieDefault)
    || !Array.isArray(result.history) || !result.history.every(isDieDefaultHistoryItem)) {
    throw new ApiError("The reviewed die defaults were incomplete. Refresh and retry.", 502);
  }
  return result;
}

export async function saveReviewedDieDefault(
  request: DieDefaultSaveRequest,
): Promise<DieDefaultSaveResult> {
  const result = await unwrap(await client.POST("/api/v3/inventory/die-defaults", {
    params: { header: mutationHeaders() },
    body: request,
  }));
  if (!["created", "updated", "retired", "re-enabled"].includes(result.outcome)
    || result.dieCode.toLocaleLowerCase("en-US") !== request.dieCode.toLocaleLowerCase("en-US")
    || result.revision !== request.expectedRevision + 1
    || result.status !== (request.enabled ? "active" : "disabled")
    || !isReviewedDieLineSettings(result.defaults) || typeof result.replayed !== "boolean") {
    throw new ApiError("The server did not confirm the reviewed die default. Reload before retrying.", 502);
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

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isCycleCountSchedule(value: unknown): value is CycleCountSchedule {
  return object(value) && typeof value.section === "string" && value.section.length >= 1 && value.section.length <= 120
    && Number.isSafeInteger(value.cadenceDays) && Number(value.cadenceDays) >= 1 && Number(value.cadenceDays) <= 365
    && typeof value.enabled === "boolean" && (value.lastCountedOn === null
      || (typeof value.lastCountedOn === "string" && CALENDAR_DATE.test(value.lastCountedOn)))
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1 && typeof value.due === "boolean"
    && (value.overdueDays === null || (Number.isSafeInteger(value.overdueDays) && Number(value.overdueDays) >= 0));
}

function isUnsignedQuantity(value: unknown): value is string {
  return typeof value === "string" && INVENTORY_QUANTITY.test(value) && !value.startsWith("-");
}

function isNullableUnsignedQuantity(value: unknown): value is string | null {
  return value === null || isUnsignedQuantity(value);
}

function hasWarehouseReorderPointFields(value: Record<string, unknown>): boolean {
  return UUID.test(String(value.productId)) && INVENTORY_CODE.test(String(value.productCode))
    && typeof value.productName === "string" && value.productName.length > 0 && typeof value.unit === "string"
    && value.unit.length > 0 && isUnsignedQuantity(value.threshold);
}

function isWarehouseReorderPoint(value: unknown): value is WarehouseGuidance["settings"]["reorderPoints"][number] {
  return object(value) && hasWarehouseReorderPointFields(value);
}

function isReorderGuidance(value: unknown): value is WarehouseGuidance["reorder"][number] {
  return object(value) && hasWarehouseReorderPointFields(value) && isUnsignedQuantity(value.onHand)
    && isUnsignedQuantity(value.scheduledDemand) && typeof value.projectedOnHand === "string"
    && INVENTORY_QUANTITY.test(value.projectedOnHand) && isUnsignedQuantity(value.suggestedQuantity);
}

function isUseFirstGuidance(value: unknown): value is WarehouseGuidance["useFirst"][number] {
  return object(value) && UUID.test(String(value.lotId)) && UUID.test(String(value.productId))
    && UUID.test(String(value.warehouseId)) && INVENTORY_CODE.test(String(value.productCode))
    && typeof value.productName === "string" && value.productName.length > 0
    && typeof value.unit === "string" && value.unit.length > 0 && typeof value.warehouseName === "string"
    && value.warehouseName.length > 0 && typeof value.lotNumber === "string" && value.lotNumber.length > 0
    && isUnsignedQuantity(value.quantity) && typeof value.expiresOn === "string" && CALENDAR_DATE.test(value.expiresOn)
    && Number.isSafeInteger(value.daysLeft) && typeof value.expired === "boolean" && typeof value.demandedToday === "boolean";
}

function isWarehouseNeeds(value: unknown): value is WarehouseGuidance["warehouseNeeds"] {
  return object(value) && Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === "string" && warning.length > 0)
    && Array.isArray(value.groups) && value.groups.every((group) => object(group) && typeof group.area === "string"
      && ["Dough", "Sauce", "Frontline", "Packaging"].includes(group.area) && Array.isArray(group.items)
      && group.items.every((item) => object(item) && UUID.test(String(item.productId))
        && INVENTORY_CODE.test(String(item.productCode)) && typeof item.productName === "string" && item.productName.length > 0
        && (item.unit === null || (typeof item.unit === "string" && item.unit.length > 0))
        && isNullableUnsignedQuantity(item.quantity) && typeof item.resolved === "boolean" && Array.isArray(item.runs)
        && item.runs.every((run) => object(run) && UUID.test(String(run.scheduleRunId))
          && typeof run.productionDate === "string" && CALENDAR_DATE.test(run.productionDate)
          && typeof run.runLabel === "string" && isNullableUnsignedQuantity(run.quantity) && typeof run.resolved === "boolean"
          && (run.warning === null || (typeof run.warning === "string" && run.warning.length > 0))
          && (run.resolved ? run.warning === null : run.warning !== null))));
}

function isTransferGuidance(value: unknown): value is WarehouseGuidance["transferGuidance"][number] {
  return object(value) && UUID.test(String(value.warehouseId)) && UUID.test(String(value.productId))
    && INVENTORY_CODE.test(String(value.productCode)) && typeof value.warehouseName === "string" && value.warehouseName.length > 0
    && typeof value.productName === "string" && value.productName.length > 0 && typeof value.unit === "string" && value.unit.length > 0
    && isUnsignedQuantity(value.needed) && isUnsignedQuantity(value.onSite) && isUnsignedQuantity(value.offSite)
    && isUnsignedQuantity(value.shortfall) && isUnsignedQuantity(value.suggestedQuantity) && Array.isArray(value.sources)
    && value.sources.every((source) => object(source) && UUID.test(String(source.warehouseId))
      && typeof source.warehouseName === "string" && source.warehouseName.length > 0 && isUnsignedQuantity(source.quantity));
}

function isSwitchoverGuidance(value: unknown): value is WarehouseGuidance["switchovers"][number] {
  return object(value) && UUID.test(String(value.runId)) && typeof value.runLabel === "string" && value.runLabel.length > 0
    && isUnsignedQuantity(value.pressCasesLeft) && typeof value.skidsLeft === "number" && Number.isFinite(value.skidsLeft)
    && value.skidsLeft >= 0 && value.skidsLeft <= 2 && typeof value.packagingStage === "boolean" && typeof value.shortRun === "boolean"
    && isTimestamp(value.pressStopAt) && isTimestamp(value.lineClearAt) && Array.isArray(value.nextRunLabels)
    && value.nextRunLabels.every((label) => typeof label === "string" && label.length > 0);
}

function isWarehouseGuidance(value: unknown): value is WarehouseGuidance {
  if (!object(value) || typeof value.factoryDate !== "string" || !CALENDAR_DATE.test(value.factoryDate)
    || !Array.isArray(value.cycleCounts) || !value.cycleCounts.every(isCycleCountSchedule)
    || !object(value.freezerPull) || !Array.isArray(value.freezerPull.groups)
    || !object(value.settings) || !Number.isSafeInteger(value.settings.expirySoonDays)
    || Number(value.settings.expirySoonDays) < 0 || Number(value.settings.expirySoonDays) > 365
    || !Number.isSafeInteger(value.settings.revision) || Number(value.settings.revision) < 0
    || !Array.isArray(value.settings.reorderPoints) || !value.settings.reorderPoints.every(isWarehouseReorderPoint)
    || !Array.isArray(value.reorder) || !value.reorder.every(isReorderGuidance)
    || !Array.isArray(value.useFirst) || !value.useFirst.every(isUseFirstGuidance)
    || !isWarehouseNeeds(value.warehouseNeeds) || !Array.isArray(value.transferGuidance)
    || !value.transferGuidance.every(isTransferGuidance) || !Array.isArray(value.switchovers)
    || !value.switchovers.every(isSwitchoverGuidance)) return false;
  return value.freezerPull.groups.every((group) => object(group) && UUID.test(String(group.runId))
    && typeof group.productionDate === "string" && CALENDAR_DATE.test(group.productionDate)
    && INVENTORY_CODE.test(String(group.productCode)) && Number.isSafeInteger(group.targetCases)
    && Number(group.targetCases) >= 1 && Number.isSafeInteger(group.effectiveTargetCases)
    && Number(group.effectiveTargetCases) >= 0 && Number(group.effectiveTargetCases) <= Number(group.targetCases)
    && Array.isArray(group.items) && group.items.every((item) => object(item) && INVENTORY_CODE.test(String(item.code))
      && typeof item.ingredientName === "string" && item.ingredientName.length > 0
      && INVENTORY_CODE.test(String(item.productCode)) && typeof item.resolved === "boolean"
      && isNullableUnsignedQuantity(item.quantity)
      && (item.unit === null || (typeof item.unit === "string" && item.unit.length > 0))
      && (item.warning === null || (typeof item.warning === "string" && item.warning.length > 0))
      && (item.resolved ? item.quantity !== null && item.unit !== null && item.warning === null : item.warning !== null)));
}

export async function getWarehouseGuidance(): Promise<WarehouseGuidance> {
  const result: unknown = await unwrap(await client.GET("/api/v3/inventory/warehouse-guidance"));
  if (!isWarehouseGuidance(result)) throw new ApiError("Warehouse guidance was incomplete. Refresh and retry.", 502);
  return result;
}

export async function saveWarehouseGuidanceSettings(request: SaveWarehouseGuidanceSettingsRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/warehouse-guidance", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "saved" || typeof result.replayed !== "boolean"
    || !Number.isSafeInteger(result.revision) || result.revision !== request.expectedRevision + 1) {
    throw new ApiError("The server did not confirm the warehouse guidance settings. Retry the same request.", 502);
  }
  return result;
}

export async function markCycleCounted(request: MarkCycleCountedRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/cycle-counts/mark", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean" || !UUID.test(result.confirmationId)
    || result.section !== request.section || !CALENDAR_DATE.test(result.countedOn)) {
    throw new ApiError("The server did not confirm the cycle count. Retry the same request.", 502);
  }
  return result;
}

export async function saveCycleCountSchedule(request: SaveCycleCountScheduleRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/cycle-counts/schedules", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (!["created", "updated", "retired", "re-enabled"].includes(result.outcome)
    || typeof result.replayed !== "boolean" || !isCycleCountSchedule(result.schedule)
    || result.schedule.section !== request.section || result.schedule.cadenceDays !== request.cadenceDays
    || result.schedule.enabled !== request.enabled) {
    throw new ApiError("The server did not confirm the cycle-count schedule. Retry the same request.", 502);
  }
  return result;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSurplusLot(value: unknown): value is FreezerSurplusLot {
  return object(value) && UUID.test(String(value.id)) && INVENTORY_CODE.test(String(value.productCode))
    && typeof value.productionDate === "string" && CALENDAR_DATE.test(value.productionDate)
    && Number.isSafeInteger(value.totalCases) && Number(value.totalCases) >= 1 && Number(value.totalCases) <= 1_000_000
    && Number.isSafeInteger(value.remainingCases) && Number(value.remainingCases) >= 0
    && Number(value.remainingCases) <= Number(value.totalCases)
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1 && isTimestamp(value.createdAt);
}

function isSurplusLedger(value: unknown): value is FreezerSurplusLedger {
  if (!object(value) || !Array.isArray(value.lots) || !value.lots.every(isSurplusLot)
    || !Array.isArray(value.runs) || !Array.isArray(value.scheduleRuns)
    || !Array.isArray(value.allocations) || !Array.isArray(value.events)) return false;
  const lotIds = new Set(value.lots.map((lot) => lot.id));
  const validRuns = value.runs.every((run) => object(run) && UUID.test(String(run.runId))
    && typeof run.label === "string" && run.label.length > 0 && INVENTORY_CODE.test(String(run.productCode))
    && isTimestamp(run.completedAt)
    && (run.decision === null || run.decision === "none" || run.decision === "stored")
    && (run.lotId === null || UUID.test(String(run.lotId)))
    && (run.decision === "stored" ? typeof run.lotId === "string" && lotIds.has(run.lotId) : run.lotId === null));
  const validScheduleRuns = value.scheduleRuns.every((run) => object(run) && UUID.test(String(run.runId))
    && typeof run.productionDate === "string" && CALENDAR_DATE.test(run.productionDate)
    && INVENTORY_CODE.test(String(run.productCode))
    && Number.isSafeInteger(run.targetCases) && Number(run.targetCases) >= 1
    && Number.isSafeInteger(run.carriedInCases) && Number(run.carriedInCases) >= 0
    && Number(run.carriedInCases) <= Number(run.targetCases)
    && Number.isSafeInteger(run.effectiveTargetCases)
    && run.effectiveTargetCases === Number(run.targetCases) - Number(run.carriedInCases));
  const validAllocations = value.allocations.every((allocation) => object(allocation)
    && UUID.test(String(allocation.id)) && UUID.test(String(allocation.lotId)) && lotIds.has(String(allocation.lotId))
    && typeof allocation.productionDate === "string" && CALENDAR_DATE.test(allocation.productionDate)
    && UUID.test(String(allocation.scheduleRunId))
    && Number.isSafeInteger(allocation.cases) && Number(allocation.cases) >= 1 && Number(allocation.cases) <= 1_000_000
    && isTimestamp(allocation.createdAt));
  const validEvents = value.events.every((event) => object(event) && UUID.test(String(event.id))
    && UUID.test(String(event.lotId)) && lotIds.has(String(event.lotId))
    && ["receipt", "allocation", "damage", "return", "correction"].includes(String(event.eventType))
    && Number.isSafeInteger(event.quantityDelta) && event.quantityDelta !== 0 && Math.abs(Number(event.quantityDelta)) <= 1_000_000
    && typeof event.reason === "string" && event.reason.trim().length >= 3 && event.reason.trim().length <= 500
    && (event.correctsEventId === null || UUID.test(String(event.correctsEventId)))
    && (event.eventType !== "correction" || event.correctsEventId !== null) && isTimestamp(event.createdAt));
  return validRuns && validScheduleRuns && validAllocations && validEvents;
}

export async function listFreezerSurplus(): Promise<FreezerSurplusLedger> {
  const result = await unwrap(await client.GET("/api/v3/inventory/freezer-surplus"));
  if (!isSurplusLedger(result)) throw new ApiError("The freezer surplus ledger was incomplete. Refresh and retry.", 502);
  return result;
}

export async function confirmFreezerSurplus(request: ConfirmFreezerSurplusRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/freezer-surplus/confirm", {
    params: { header: mutationHeaders() }, body: request,
  }));
  const expectedDecision = request.cases === 0 ? "none" : "stored";
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean" || result.runId !== request.runId
    || result.cases !== request.cases || result.decision !== expectedDecision
    || (expectedDecision === "none" ? result.lotId !== null : !UUID.test(String(result.lotId)))) {
    throw new ApiError("The server did not confirm the freezer surplus decision. Retry the same request.", 502);
  }
  return result;
}

export async function allocateFreezerSurplus(request: AllocateFreezerSurplusRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/freezer-surplus/allocations", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean" || !UUID.test(String(result.allocationId))
    || result.lotId !== request.lotId || !Number.isSafeInteger(result.remainingCases) || Number(result.remainingCases) < 0
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 2
    || !Number.isSafeInteger(result.carriedInCases) || Number(result.carriedInCases) < request.cases
    || !Number.isSafeInteger(result.effectiveTargetCases) || Number(result.effectiveTargetCases) < 0) {
    throw new ApiError("The server did not confirm the freezer surplus allocation. Retry the same request.", 502);
  }
  return result;
}

export async function adjustFreezerSurplus(request: AdjustFreezerSurplusRequest) {
  const result = await unwrap(await client.POST("/api/v3/inventory/freezer-surplus/adjustments", {
    params: { header: mutationHeaders() }, body: request,
  }));
  if (result.outcome !== "accepted" || typeof result.replayed !== "boolean" || !UUID.test(String(result.eventId))
    || result.lotId !== request.lotId || !Number.isSafeInteger(result.remainingCases) || Number(result.remainingCases) < 0
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 2) {
    throw new ApiError("The server did not confirm the freezer surplus adjustment. Retry the same request.", 502);
  }
  return result;
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
