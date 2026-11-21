import { useEffect, useState, type FormEvent } from "react";
import { FileUp } from "lucide-react";
import {
  ApiError,
  previewProductionScheduleWorkbook,
  type PlannedScheduleRun,
  type ProductionSchedule,
  type ScheduleCatalog,
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
  disabled,
  onLoadDate,
  onApply,
}: {
  schedule: ProductionSchedule;
  catalog: ScheduleCatalog;
  online: boolean;
  disabled: boolean;
  onLoadDate: (date: string) => void;
  onApply: (date: string, runs: PlannedScheduleRun[]) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importDate, setImportDate] = useState(schedule.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) setImportDate(schedule.date);
  }, [preview, schedule.date]);

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
    setStatus("Reviewing workbook contents. Nothing will be applied yet.");
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
      setStatus("Workbook reviewed. Nothing has been applied; choose mappings and apply each date separately.");
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

  function apply(date: string, rows: ImportRow[]) {
    try {
      const runs = rows.map((row) => {
        try {
          return validateScheduleRun({
            id: row.importRunId,
            productCode: row.productCode,
            productionSetupCode: row.productionSetupCode,
            runTemplateCode: row.runTemplateCode,
            targetCases: row.targetCases ?? 0,
            notes: row.notes,
          }, catalog);
        } catch (cause) {
          throw new Error(`Review row ${row.rowNumber}: ${cause instanceof Error ? cause.message : "check the mappings."}`);
        }
      });
      onApply(date, runs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review the imported rows.");
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

      {preview && !preview.multiDay ? (
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

      {preview ? (
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
                {schedule.date === date ? (
                  <button type="button" className="button-primary mt-5" disabled={!online || disabled || busy || rows.length === 0} onClick={() => apply(date, rows)}>
                    Apply {rows.length} reviewed run(s) to {date}
                  </button>
                ) : (
                  <button type="button" className="button-secondary mt-5" disabled={!online || disabled || busy} onClick={() => onLoadDate(date)}>
                    Load {date} before applying
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
