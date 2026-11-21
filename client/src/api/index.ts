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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSetupCatalogRecord(value: unknown): value is SetupCatalogRecord {
  return object(value) && typeof value.code === "string" && typeof value.name === "string" && object(value.data);
}

function isSetupCatalogHistoryItem(value: unknown): value is SetupCatalogHistoryItem {
  return object(value) && typeof value.id === "string" && UUID.test(value.id)
    && typeof value.family === "string" && ["staged", "applied", "undone"].includes(String(value.status))
    && Number.isSafeInteger(value.rowCount) && Number(value.rowCount) >= 1
    && typeof value.createdBy === "string" && typeof value.createdAt === "string"
    && (value.appliedAt === null || typeof value.appliedAt === "string")
    && (value.undoneAt === null || typeof value.undoneAt === "string");
}

function isSetupCatalogDetail(value: unknown): value is SetupCatalogDetail {
  if (!isSetupCatalogHistoryItem(value)) return false;
  const records = (value as unknown as { records?: unknown }).records;
  return Array.isArray(records) && records.length === value.rowCount && records.every(isSetupCatalogRecord);
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
    || !result.records.every(isSetupCatalogRecord) || typeof result.replayed !== "boolean") {
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
