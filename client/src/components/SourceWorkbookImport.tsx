import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileSearch, FileUp } from "lucide-react";
import { parseSetupCatalogCsv, setupCatalogCsvTemplates } from "../../../core/setup-catalog-csv.mjs";
import {
  previewSourceWorkbook,
  type SetupCatalogRecord,
  type SetupCatalogStageRequest,
  type SourceImportSummary,
  type SourceWorkbookFamily,
  type SourceWorkbookPreview,
} from "../api";

const FAMILY_LABELS: Record<SourceWorkbookFamily, string> = {
  "spec-sheets": "Spec sheets",
  "premix-sheets": "Premix sheets",
  "cheese-mix-specs": "Cheese mix specs",
  "shipping-guides": "Shipping guides",
  "sauce-guides": "Sauce guides",
  "dough-guides": "Dough guides",
};

type Candidate = SourceWorkbookPreview["records"][number] & {
  include: boolean;
  reviewed: boolean;
  dataText: string;
  jsonError: boolean;
};
type Unresolved = SourceWorkbookPreview["unresolvedRows"][number] & {
  resolution: "corrected" | "review-only" | "skipped" | null;
};
type Review = Omit<SourceWorkbookPreview, "records" | "unresolvedRows"> & {
  fileName: string;
  candidates: Candidate[];
  unresolved: Unresolved[];
};

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function csvField(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function recordsToCsv(family: "mixes" | "run-templates", records: SetupCatalogRecord[]): string {
  const headers = setupCatalogCsvTemplates[family]!.headers;
  const rows = records.map(({ code, name, data }) => {
    if (family === "mixes") {
      return [
        code, name, data.brand, data.flavor, data.batchSizeLbs, data.daysEarly, data.notes,
        data.isPrep, data.enabled, JSON.stringify(data.components ?? []),
      ];
    }
    return [code, name, data.brand, data.flavor, JSON.stringify(data.values ?? {})];
  });
  return [headers, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

function hasExplicitCheeseSlot(record: SetupCatalogRecord): boolean {
  const values = record.data.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  const mapped = values as Record<string, unknown>;
  return [1, 2, 3, 4].some((slot) => {
    const name = mapped[`app${slot}CheeseRecipeName`];
    return Array.isArray(mapped[`app${slot}CheeseRecipe`]) && typeof name === "string" && name.trim().length > 0;
  });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

export function SourceWorkbookImport({ online, disabled, pending, onStage }: {
  online: boolean;
  disabled: boolean;
  pending: boolean;
  onStage: (request: SetupCatalogStageRequest) => Promise<boolean>;
}) {
  const [family, setFamily] = useState<SourceWorkbookFamily>("spec-sheets");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<"preview" | "stage" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewController = useRef<AbortController | null>(null);
  const sourceRequested = useRef(false);
  const sawSourcePending = useRef(false);
  const controlsDisabled = disabled || busy !== null;
  const sauce = family === "sauce-guides";

  function clearFile() {
    if (fileInput.current) fileInput.current.value = "";
  }

  useEffect(() => () => previewController.current?.abort(), []);

  useEffect(() => {
    if (!online) {
      previewController.current?.abort();
      clearFile();
      setBusy(null);
      setNotice(null);
    }
  }, [online]);

  useEffect(() => {
    if (pending && sourceRequested.current) sawSourcePending.current = true;
    if (!pending && sawSourcePending.current) {
      sourceRequested.current = false;
      sawSourcePending.current = false;
      setReview(null);
      clearFile();
    }
  }, [pending]);

  function changeFamily(next: SourceWorkbookFamily) {
    previewController.current?.abort();
    setFamily(next);
    setReview(null);
    setError(null);
    setNotice(null);
    clearFile();
  }

  function updateCandidate(index: number, update: (candidate: Candidate) => Candidate) {
    setReview((current) => current ? {
      ...current,
      candidates: current.candidates.map((candidate, candidateIndex) =>
        candidateIndex === index ? update(candidate) : candidate),
    } : current);
  }

  function updateUnresolved(index: number, resolution: Unresolved["resolution"]) {
    setReview((current) => current ? {
      ...current,
      unresolved: current.unresolved.map((row, rowIndex) => rowIndex === index
        ? { ...row, resolution: row.resolution === resolution ? null : resolution }
        : row),
    } : current);
  }

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || controlsDisabled) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Source workbooks must be 5 MiB or smaller. Nothing was previewed or staged.");
      return;
    }
    if (!/\.xlsx$/iu.test(file.name) && !(sauce && /\.docx$/iu.test(file.name))) {
      setError(sauce ? "Choose an XLSX workbook or DOCX sauce guide." : "Choose an XLSX workbook.");
      return;
    }
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setBusy("preview");
    setReview(null);
    setError(null);
    setNotice(null);
    try {
      const result = await previewSourceWorkbook({
        family,
        fileName: file.name,
        workbookBase64: await fileToBase64(file),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setReview({
        ...result,
        fileName: file.name,
        candidates: result.records.map((candidate) => ({
          ...candidate,
          include: true,
          reviewed: false,
          dataText: JSON.stringify(candidate.record.data, null, 2),
          jsonError: false,
        })),
        unresolved: result.unresolvedRows.map((row) => ({ ...row, resolution: null })),
      });
      setNotice("Deterministic preview loaded. Nothing has been staged or applied; review every included and unresolved row.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(message(cause, "The source workbook could not be previewed. Nothing was staged."));
    } finally {
      if (previewController.current === controller) {
        previewController.current = null;
        setBusy(null);
      }
    }
  }

  async function stage() {
    if (!review || controlsDisabled) return;
    const included = review.candidates.filter((candidate) => candidate.include);
    if (included.length === 0) {
      setError("Include at least one reviewed source record before staging.");
      return;
    }
    if (included.some((candidate) => !candidate.reviewed || candidate.jsonError)) {
      setError("Review every included source record and correct invalid mapped JSON before staging.");
      return;
    }
    if (review.unresolved.some((row) => row.resolution === null)) {
      setError("Resolve, acknowledge, or skip every unresolved source row before staging.");
      return;
    }
    if (review.family === "cheese-mix-specs" && included.some((candidate) => !hasExplicitCheeseSlot(candidate.record))) {
      setError("Choose an explicit V3 cheese applicator slot for every included cheese recipe.");
      return;
    }
    setBusy("stage");
    setError(null);
    setNotice(null);
    try {
      const csv = recordsToCsv(review.targetFamily, included.map((candidate) => candidate.record));
      parseSetupCatalogCsv(review.targetFamily, csv);
      const sourceSummary: SourceImportSummary = {
        sourceFamily: review.family,
        sourceSha256: review.fileSha256,
        parserVersion: review.parserVersion,
        sourceRows: review.sourceRows,
        importedRows: included.length,
        skippedRows: review.skippedRows
          + review.candidates.filter((candidate) => !candidate.include).length
          + review.unresolved.filter((row) => row.resolution === "skipped").length,
        unresolvedRows: review.unresolved.filter((row) => row.resolution === "review-only").length,
      };
      sourceRequested.current = true;
      const workbook = review.fileName;
      const sourceRecords = included.map((candidate) => ({
        code: candidate.record.code,
        source: { workbook, cell: candidate.source },
        sourceDetails: candidate.sourceDetails ?? null,
      }));
      const staged = await onStage({
        requestId: crypto.randomUUID(), family: review.targetFamily, csv, sourceSummary, sourceRecords,
      });
      if (staged) {
        sourceRequested.current = false;
        sawSourcePending.current = false;
        setReview(null);
        clearFile();
      }
    } catch (cause) {
      sourceRequested.current = false;
      setError(message(cause, "The reviewed source records could not be staged."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4" aria-labelledby="source-workbook-heading">
      <div className="flex items-start gap-3">
        <FileSearch className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 id="source-workbook-heading" className="font-medium">Review a source workbook</h2>
          <p className="mt-1 text-sm text-muted-foreground">Deterministic XLSX preview, with DOCX also accepted for sauce guides. Review and confirm records before staging them into the shared setup-import history. Nothing is applied automatically.</p>
        </div>
      </div>
      <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end" onSubmit={preview}>
        <label className="text-sm font-medium">Source family
          <select className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal" aria-label="Source workbook family" value={family} disabled={!online || controlsDisabled} onChange={(event) => changeFamily(event.target.value as SourceWorkbookFamily)}>
            {Object.entries(FAMILY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Source file
          <input ref={fileInput} className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm font-normal file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1" type="file" aria-label="Source workbook file" accept={sauce ? ".xlsx,.docx" : ".xlsx"} required disabled={!online || controlsDisabled} onChange={() => { setError(null); setNotice(null); }} />
        </label>
        <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground disabled:opacity-50" type="submit" disabled={!online || controlsDisabled}>
          <FileUp className="size-4" aria-hidden="true" />{busy === "preview" ? "Previewing…" : "Preview workbook"}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-md bg-muted p-3 text-sm">{notice}</p>}
      {review && <div className="mt-4 border-t pt-4" aria-label="Source workbook review">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{review.sourceRows} source rows</span><span>{review.candidates.length} proposed</span><span>{review.skippedRows} parser-skipped</span><span>{review.unresolved.length} unresolved</span>
          <span>SHA-256 {review.fileSha256.slice(0, 12)}…</span><span>{review.parserVersion}</span>
        </div>
        <div className="mt-3 space-y-3">
          {review.candidates.map((candidate, index) => <article key={`${candidate.source}:${index}`} className="rounded-md border p-3" aria-label={`Source record ${index + 1}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="font-medium">{candidate.record.code} — {candidate.record.name}</h3><p className="text-xs text-muted-foreground">{candidate.source}</p></div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={candidate.include} disabled={!online || controlsDisabled} onChange={(event) => updateCandidate(index, (current) => ({ ...current, include: event.target.checked }))} />Include</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={candidate.reviewed} disabled={!online || controlsDisabled} onChange={(event) => updateCandidate(index, (current) => ({ ...current, reviewed: event.target.checked }))} />Reviewed and confirmed</label>
              </div>
            </div>
            <details className="mt-3" open>
              <summary className="cursor-pointer text-sm font-medium">Parsed evidence and V3 mapping</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-medium">V3 code<input className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm" value={candidate.record.code} disabled={!online || controlsDisabled} onChange={(event) => updateCandidate(index, (current) => ({ ...current, reviewed: false, record: { ...current.record, code: event.target.value } }))} /></label>
                <label className="text-xs font-medium">V3 name<input className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={candidate.record.name} disabled={!online || controlsDisabled} onChange={(event) => updateCandidate(index, (current) => ({ ...current, reviewed: false, record: { ...current.record, name: event.target.value } }))} /></label>
              </div>
              <label className="mt-3 block text-xs font-medium">Mapped V3 JSON
                <textarea aria-label="Mapped V3 JSON" className="mt-1 min-h-44 w-full rounded-md border bg-background p-2 font-mono text-xs" value={candidate.dataText} disabled={!online || controlsDisabled} onChange={(event) => {
                  const dataText = event.target.value;
                  try {
                    const data: unknown = JSON.parse(dataText);
                    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Mapped V3 JSON must be an object.");
                    updateCandidate(index, (current) => ({ ...current, reviewed: false, dataText, jsonError: false, record: { ...current.record, data: data as Record<string, unknown> } }));
                  } catch {
                    updateCandidate(index, (current) => ({ ...current, reviewed: false, dataText, jsonError: true }));
                  }
                }} />
              </label>
              {candidate.jsonError && <p role="alert" className="mt-1 text-xs text-destructive">Mapped V3 JSON must be a valid object.</p>}
              <div className="mt-3"><h4 className="text-xs font-medium">Parsed source evidence</h4><pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(candidate.sourceDetails ?? {}, null, 2)}</pre></div>
              {review.family === "cheese-mix-specs" && <p className="mt-2 text-xs text-muted-foreground">Cheese recipes must explicitly populate at least one V3 applicator cheese slot and name in the mapped JSON.</p>}
            </details>
          </article>)}
        </div>
        {review.unresolved.length > 0 && <div className="mt-4 space-y-3"><h3 className="font-medium">Unresolved source rows</h3>
          {review.unresolved.map((row, index) => <article key={`${row.source}:${index}`} className="rounded-md border border-amber-300 p-3" aria-label={`Unresolved source row ${index + 1}`}>
            <p className="text-sm font-medium">{row.source}</p>
            <p className="mt-1 text-sm">{row.reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["corrected", "review-only", "skipped"] as const).map((resolution) => <button key={resolution} type="button" className={`rounded-md border px-3 py-1.5 text-sm ${row.resolution === resolution ? "bg-primary text-primary-foreground" : "bg-background"}`} aria-pressed={row.resolution === resolution} disabled={!online || controlsDisabled} onClick={() => updateUnresolved(index, resolution)}>{resolution === "corrected" ? "Corrected in proposed records" : resolution === "review-only" ? "Acknowledge review-only" : "Skip row"}</button>)}
            </div>
            {row.resolution === "review-only" && <p className="mt-2 text-xs text-muted-foreground">This row remains unresolved in the source summary and will not be imported.</p>}
          </article>)}
        </div>}
        <button className="mt-4 min-h-10 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" type="button" disabled={!online || controlsDisabled} onClick={() => void stage()}>{busy === "stage" ? "Staging reviewed records…" : "Stage reviewed source records"}</button>
        <p className="mt-2 text-xs text-muted-foreground">Excluded candidates and skipped unresolved rows are not imported. Corrected rows must already be represented in an included proposed record; review-only rows remain explicitly unresolved.</p>
      </div>}
    </section>
  );
}
