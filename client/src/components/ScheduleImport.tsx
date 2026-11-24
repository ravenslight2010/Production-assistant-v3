import { useEffect, useState, type FormEvent } from "react";
import { FileUp } from "lucide-react";
import {
  ApiError,
  getScheduleImport,
  listScheduleImports,
  previewProductionScheduleWorkbook,
  type CanonicalScheduleImportRun,
  type ProductionSchedule,
  type ScheduleCatalog,
  type ScheduleImportActionResponse,
  type ScheduleImportDetail,
  type ScheduleImportSummary,
  type ScheduleWorkbookPreview,
} from "../api";
import { scheduleProduct, validateScheduleRun } from "./schedule-utils";

type SourceRow = ScheduleWorkbookPreview["rows"][number];
type ImportRow = Omit<SourceRow, "targetCases" | "notes"> & {
  targetCases: number | null;
  notes: string;
  productCode: string;
  productionSetupCode: string;
  runTemplateCode: string;
};
type ImportPreview = Omit<ScheduleWorkbookPreview, "rows"> & { rows: ImportRow[] };

async function encodeWorkbook(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function productMatches(row: SourceRow, catalog: ScheduleCatalog) {
  const name = `${row.brand} ${row.flavor}`.trim().toLocaleLowerCase("en-US");
  const flavor = row.flavor.trim().toLocaleLowerCase("en-US");
  return catalog.products.filter((product) => [product.name, product.code]
    .some((value) => value.trim().toLocaleLowerCase("en-US") === name)
    || product.name.trim().toLocaleLowerCase("en-US") === flavor);
}

function templateMatches(row: SourceRow, catalog: ScheduleCatalog) {
  const brand = row.brand.trim().toLocaleLowerCase("en-US");
  const flavor = row.flavor.trim().toLocaleLowerCase("en-US");
  return catalog.templates.filter((template) => (template.brand ?? "").trim().toLocaleLowerCase("en-US") === brand
    && (template.flavor ?? "").trim().toLocaleLowerCase("en-US") === flavor);
}

export function ScheduleImport({
  schedule,
  catalog,
  online,
  confirmedImport,
  disabled,
  onLoadDate,
  onStage,
  onAction,
}: {
  schedule: ProductionSchedule;
  catalog: ScheduleCatalog;
  online: boolean;
  confirmedImport: ScheduleImportDetail | null;
  disabled: boolean;
  onLoadDate: (date: string) => void;
  onStage: (request: {
    importId: string;
    requestId: string;
    source: ScheduleWorkbookPreview["source"];
    runs: CanonicalScheduleImportRun[];
  }) => Promise<ScheduleImportDetail | null>;
  onAction: (
    action: "apply" | "undo", importId: string,
    request: { requestId: string; date: string; expectedRevision: number },
  ) => Promise<ScheduleImportActionResponse | null>;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [canonical, setCanonical] = useState<ScheduleImportDetail | null>(null);
  const [history, setHistory] = useState<ScheduleImportSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [importDate, setImportDate] = useState(schedule.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) setImportDate(schedule.date);
  }, [preview, schedule.date]);

  useEffect(() => {
    if (confirmedImport) {
      setPreview(null);
      setCanonical(confirmedImport);
    }
  }, [confirmedImport]);

  async function refreshHistory() {
    if (!online) return;
    setHistoryLoading(true);
    try {
      setHistory(await listScheduleImports(50));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Schedule import history could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!online) {
      setPreview(null);
      setCanonical(null);
      setHistory([]);
      return;
    }
    void refreshHistory();
  }, [online]);

  async function openCanonical(importId: string) {
    if (!online || disabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await getScheduleImport(importId);
      setPreview(null);
      setCanonical(detail);
      setStatus(`Reopened canonical import ${detail.source.fileName}. Workbook bytes are not retained.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The canonical import could not be reopened.");
    } finally {
      setBusy(false);
    }
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("schedule-workbook");
    if (!(input instanceof HTMLInputElement) || !input.files?.[0] || !online || busy) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose an XLSX workbook no larger than 5 MiB.");
      setStatus("Workbook review failed. No schedule changes were made.");
      return;
    }
    setBusy(true);
    setError(null);
    setCanonical(null);
    setPreview(null);
    setStatus("Reviewing workbook contents. Nothing will be staged or applied yet.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const workbookBase64 = await encodeWorkbook(file);
      const result = await previewProductionScheduleWorkbook({ fileName: file.name, workbookBase64, signal: controller.signal });
      const rows = result.rows.map((row): ImportRow => {
        const products = productMatches(row, catalog);
        const templates = templateMatches(row, catalog);
        return {
          ...row,
          targetCases: row.targetCases,
          notes: row.notes ?? "",
          productCode: products.length === 1 ? products[0]?.code ?? "" : "",
          productionSetupCode: "",
          runTemplateCode: templates.length === 1 ? templates[0]?.code ?? "" : "",
        };
      });
      setPreview({ ...result, rows });
      if (!result.multiDay && !importDate) setImportDate(schedule.date);
      setStatus("Workbook reviewed. Nothing has been staged or applied; complete every mapping, then stage the canonical rows.");
    } catch (cause) {
      const message = cause instanceof Error && cause.name === "AbortError"
        ? "Workbook review timed out. No schedule changes were made; try again."
        : cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "The workbook could not be reviewed. No schedule changes were made.";
      setError(message);
      setStatus("Workbook review failed. No schedule changes were made.");
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  function updateRow(id: string, changes: Partial<ImportRow>) {
    setPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.importRunId === id ? { ...row, ...changes } : row),
    } : current);
  }

  function rowsForDate(date: string): ImportRow[] {
    return preview?.rows.filter((row) => (preview.multiDay ? row.date : importDate) === date) ?? [];
  }

  async function stage() {
    if (!preview || preview.rows.length === 0 || disabled || busy || !online) return;
    setBusy(true);
    setError(null);
    try {
      const runs = preview.rows.map((row): CanonicalScheduleImportRun => {
        const date = preview.multiDay ? row.date : importDate;
        if (!date) throw new Error(`Review row ${row.rowNumber}: choose a production date.`);
        try {
          const run = validateScheduleRun({
            id: row.importRunId,
            productCode: row.productCode,
            productionSetupCode: row.productionSetupCode,
            runTemplateCode: row.runTemplateCode,
            targetCases: row.targetCases ?? 0,
            notes: row.notes,
          }, catalog);
          return {
            ...run, date,
            source: {
              workbook: preview.source.fileName,
              sheet: row.sheet,
              row: row.sourceRow,
              cells: row.sourceCells as unknown as CanonicalScheduleImportRun["source"]["cells"],
            },
          };
        } catch (cause) {
          throw new Error(`Review row ${row.rowNumber}: ${cause instanceof Error ? cause.message : "check the mappings."}`);
        }
      });
      const detail = await onStage({
        importId: crypto.randomUUID(), requestId: crypto.randomUUID(), source: preview.source, runs,
      });
      if (detail) {
        setCanonical(detail);
        setStatus("Canonical schedule import staged. No schedule changed; Apply each production date independently.");
        await refreshHistory();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review every imported row before staging.");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "apply" | "undo", date: string) {
    if (!canonical || disabled || busy || !online || schedule.date !== date) return;
    if (action === "undo" && !window.confirm(`Remove only unchanged runs created by this import for ${date}? Updated pre-existing runs will not be reverted.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onAction(action, canonical.importId, {
        requestId: crypto.randomUUID(), date, expectedRevision: schedule.revision,
      });
      if (!result) return;
      setCanonical(result.import);
      await refreshHistory();
      if (result.outcome === "conflict") {
        setError(result.reason === "created-runs-changed"
          ? "Undo blocked: a created run was changed or removed. No runs were removed; review the latest schedule."
          : result.reason === "no-created-runs"
            ? "This Apply updated pre-existing runs only. There are no created runs to Undo."
            : "The schedule revision changed. Review the latest plan before retrying.");
        setStatus("No import action was applied.");
      } else {
        const remaining = result.import.dates.filter((item) => item.status !== "applied").map((item) => item.productionDate);
        setStatus(action === "apply"
          ? `Applied ${date}. ${remaining.length ? `Remaining non-applied dates: ${remaining.join(", ")}.` : "All dates have been applied."}`
          : `Undo confirmed for ${date}. Only unchanged created runs were removed.`);
      }
    } finally {
      setBusy(false);
    }
  }

  const dates = preview
    ? [...new Set(preview.rows.map((row) => preview.multiDay ? row.date : importDate))]
      .filter((date): date is string => typeof date === "string" && date.length > 0)
      .sort()
    : [];

  return (
    <section className="panel" aria-labelledby="schedule-import-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Deterministic import</p>
          <h2 id="schedule-import-heading" className="mt-1 text-lg font-semibold">Schedule workbook review</h2>
        </div>
        <span className="status-pill">XLSX · 5 MiB maximum</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Preview only until a manager explicitly applies reviewed rows. Ambiguous products and templates remain unassigned.
      </p>

      <form className="mt-5 grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(event) => void review(event)}>
        <label className="text-xs font-medium" htmlFor="schedule-workbook">
          Schedule workbook
          <input
            id="schedule-workbook"
            name="schedule-workbook"
            className="field mt-1.5"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={!online || disabled || busy}
            required
          />
        </label>
        <button type="submit" className="button-primary" disabled={!online || disabled || busy}>
          <FileUp className="h-4 w-4" />{busy ? "Reviewing…" : "Review workbook"}
        </button>
      </form>

      {preview && !canonical && !preview.multiDay ? (
        <label className="mt-4 block text-xs font-medium" htmlFor="schedule-import-date">
          Production date for flat workbook
          <input
            id="schedule-import-date"
            className="field mt-1.5 sm:max-w-56"
            type="date"
            value={importDate}
            disabled={!online || disabled || busy}
            required={preview.rows.length > 0}
            onChange={(event) => setImportDate(event.target.value)}
          />
        </label>
      ) : null}

      {status ? <p className="mt-4 text-sm text-muted-foreground" role="status">{status}</p> : null}
      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      {preview && !canonical ? (
        <div className="mt-5 border-t border-border/70 pt-5">
          <p className="text-sm font-medium">
            {preview.rows.length} schedule row(s) found · {preview.errors.length} issue(s) · {preview.skipped.length} skipped row(s). Review each date separately.
          </p>
          {preview.errors.map((issue, index) => (
            <p key={`issue-${index}`} className="mt-3 text-sm text-destructive">
              Issue · {issue.sheet} · row {issue.rowNumber}{issue.date ? ` · ${issue.date}` : ""}: {issue.message}
            </p>
          ))}
          {preview.skipped.map((item, index) => (
            <p key={`skipped-${index}`} className="mt-3 text-sm text-amber-300">
              Skipped · {item.sheet} · row {item.rowNumber}{item.date ? ` · ${item.date}` : ""}: {item.reason}
            </p>
          ))}
          {dates.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No rows can be applied. Review the issues or select a supported workbook.</p> : null}

          {dates.map((date) => {
            const rows = rowsForDate(date);
            return (
              <section key={date} className="mt-6 border-t border-border/70 pt-5" aria-labelledby={`import-date-${date}`}>
                <h3 id={`import-date-${date}`} className="text-base font-semibold">Production date · {date}</h3>
                <div className="mt-4 divide-y divide-border/70">
                  {rows.map((row) => {
                    const products = productMatches(row, catalog);
                    const templates = templateMatches(row, catalog);
                    const setups = scheduleProduct(catalog, row.productCode)?.productionSetups ?? [];
                    const ready = row.productCode && row.productionSetupCode && row.runTemplateCode
                      && Number.isSafeInteger(row.targetCases) && (row.targetCases ?? 0) > 0;
                    const sourceCells = row.sourceCells as { brand?: unknown };
                    return (
                      <article key={row.importRunId} className="py-5" aria-label={`Import review row ${row.rowNumber}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold">{row.brand}{row.flavor ? ` · ${row.flavor}` : ""}</h4>
                          <span className={`status-pill ${ready ? "status-running" : ""}`}>{ready ? "Ready for review" : "Mapping required"}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {row.sheet} · row {row.sourceRow}{typeof sourceCells.brand === "string" ? ` · ${sourceCells.brand}` : ""} · {date}
                        </p>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label className="text-xs font-medium" htmlFor={`${row.importRunId}-product`}>
                            Product · {products.length === 1 ? "one exact name match" : products.length > 1 ? `${products.length} exact matches; choose one` : "choose manually"}
                            <select
                              id={`${row.importRunId}-product`}
                              className="field mt-1.5"
                              value={row.productCode}
                              disabled={!online || disabled || busy}
                              onChange={(event) => updateRow(row.importRunId, { productCode: event.target.value, productionSetupCode: "" })}
                            >
                              <option value="">Choose product</option>
                              {catalog.products.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
                            </select>
                          </label>
                          <label className="text-xs font-medium" htmlFor={`${row.importRunId}-setup`}>
                            Production setup
                            <select
                              id={`${row.importRunId}-setup`}
                              aria-label={`Production setup for import row ${row.rowNumber}`}
                              className="field mt-1.5"
                              value={row.productionSetupCode}
                              disabled={!online || disabled || busy || !row.productCode}
                              onChange={(event) => updateRow(row.importRunId, { productionSetupCode: event.target.value })}
                            >
                              <option value="">Choose production setup</option>
                              {setups.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
                            </select>
                          </label>
                          <label className="text-xs font-medium sm:col-span-2" htmlFor={`${row.importRunId}-template`}>
                            Run template · {templates.length === 1 ? "one exact name match" : "choose manually"}
                            <select
                              id={`${row.importRunId}-template`}
                              className="field mt-1.5"
                              value={row.runTemplateCode}
                              disabled={!online || disabled || busy}
                              onChange={(event) => updateRow(row.importRunId, { runTemplateCode: event.target.value })}
                            >
                              <option value="">Choose run template</option>
                              {catalog.templates.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
                            </select>
                          </label>
                          <label className="text-xs font-medium" htmlFor={`${row.importRunId}-cases`}>
                            Target cases
                            <input
                              id={`${row.importRunId}-cases`}
                              className="field mt-1.5"
                              type="number"
                              min="1"
                              max="1000000"
                              step="1"
                              value={row.targetCases ?? ""}
                              disabled={!online || disabled || busy}
                              onChange={(event) => updateRow(row.importRunId, { targetCases: event.target.value ? Number(event.target.value) : null })}
                            />
                          </label>
                          <label className="text-xs font-medium sm:col-span-2" htmlFor={`${row.importRunId}-notes`}>
                            Customer, PO, ship-date notes
                            <input
                              id={`${row.importRunId}-notes`}
                              className="field mt-1.5"
                              type="text"
                              maxLength={500}
                              value={row.notes}
                              disabled={!online || disabled || busy}
                              onChange={(event) => updateRow(row.importRunId, { notes: event.target.value })}
                            />
                          </label>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground" role="status">
                          {ready ? "Ready to add to the selected production date; explicit Apply is still required." : "Choose a product, setup, template, and positive whole-case target."}
                        </p>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <button type="button" className="button-primary mt-5 w-full sm:w-auto" disabled={!online || disabled || busy || preview.rows.length === 0} onClick={() => void stage()}>
            Stage {preview.rows.length} reviewed row(s) without changing schedules
          </button>
        </div>
      ) : null}

      {canonical ? (
        <div className="mt-5 border-t border-border/70 pt-5" data-testid="canonical-schedule-import">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold break-all">{canonical.source.fileName}</h3>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">SHA-256 {canonical.source.sha256} · {canonical.source.parserVersion}</p>
            </div>
            <button type="button" className="button-secondary" disabled={busy} onClick={() => { setCanonical(null); setPreview(null); setStatus(null); }}>Start another review</button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Canonical reviewed rows are read-only. Each date has its own Apply receipt and Undo state.</p>
          {canonical.dates.map((dateState) => {
            const rows = canonical.runs.filter((run) => run.date === dateState.productionDate);
            return (
              <section key={dateState.productionDate} className="mt-5 border-t border-border/60 pt-4" aria-label={`Canonical import date ${dateState.productionDate}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">{dateState.productionDate} · {rows.length} row(s)</h4>
                  <span className={`status-pill ${dateState.status === "applied" ? "status-running" : "status-paused"}`}>{dateState.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{dateState.createdRunCount} created · {dateState.updatedRunCount} pre-existing updated</p>
                <div className="mt-3 divide-y divide-border/60">
                  {rows.map((run) => (
                    <article key={run.id} className="py-3 text-sm" aria-label={`Canonical run ${run.id}`}>
                      <strong>{run.productCode} · {run.targetCases} cases</strong>
                      <span className="mt-1 block text-xs text-muted-foreground">{run.productionSetupCode} · {run.runTemplateCode}{run.notes ? ` · ${run.notes}` : ""}</span>
                      <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{run.source.sheet} row {run.source.row} · {Object.values(run.source.cells).join(" · ")}</span>
                    </article>
                  ))}
                </div>
                {schedule.date !== dateState.productionDate ? (
                  <button type="button" className="button-secondary mt-3 w-full sm:w-auto" disabled={!online || disabled || busy} onClick={() => onLoadDate(dateState.productionDate)}>Load {dateState.productionDate} before Apply or Undo</button>
                ) : (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    {dateState.status !== "applied" ? <button type="button" className="button-primary" disabled={!online || disabled || busy} onClick={() => void act("apply", dateState.productionDate)}>Apply canonical rows to {dateState.productionDate}</button> : null}
                    {dateState.undoAvailable ? <button type="button" className="button-secondary" disabled={!online || disabled || busy} onClick={() => void act("undo", dateState.productionDate)}>Undo unchanged created runs for {dateState.productionDate}</button> : null}
                    {dateState.status === "applied" && !dateState.undoAvailable ? <span className="text-xs text-muted-foreground">No created runs are eligible for Undo; pre-existing updates are not reverted.</span> : null}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}

      <div className="mt-6 border-t border-border/70 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Canonical import history</h3>
          <button type="button" className="button-secondary" disabled={!online || historyLoading || busy} onClick={() => void refreshHistory()}>{historyLoading ? "Loading…" : "Refresh history"}</button>
        </div>
        {!online ? <p className="mt-3 text-sm text-muted-foreground">Import history and reviewed notes are not cached offline.</p> : null}
        {online && history.length === 0 && !historyLoading ? <p className="mt-3 text-sm text-muted-foreground">No canonical schedule imports have been staged.</p> : null}
        <div className="mt-3 space-y-3">
          {history.map((item) => (
            <article key={item.importId} className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><strong className="block break-all text-sm">{item.source.fileName}</strong><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{item.importId} · {item.rowCount} rows · {item.source.parserVersion}</span></div>
                <button type="button" aria-label={`Open schedule import ${item.source.fileName} ${item.importId}`} className="button-secondary w-full sm:w-auto" disabled={!online || disabled || busy} onClick={() => void openCanonical(item.importId)}>Open canonical import</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{item.dates.map((dateState) => <span key={dateState.productionDate} className="status-pill">{dateState.productionDate} · {dateState.status}</span>)}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
