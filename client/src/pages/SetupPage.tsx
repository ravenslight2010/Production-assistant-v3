import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Download, FileUp, RefreshCw, RotateCcw } from "lucide-react";
import { parseSetupCatalogCsv, setupCatalogCsvTemplates } from "../../../core/setup-catalog-csv.mjs";
import { renderImportCsvTemplate } from "../../../core/import-csv-templates.mjs";
import {
  actOnSetupCatalogImport,
  ApiError,
  getSetupCatalogImport,
  listSetupCatalogImports,
  stageSetupCatalogImport,
  type AuthSession,
  type SetupCatalogActionResult,
  type SetupCatalogDetail,
  type SetupCatalogFamily,
  type SetupCatalogHistoryItem,
  type SetupCatalogStageRequest,
} from "../api";
import {
  clearPendingSetupCatalogImport,
  readPendingSetupCatalogImport,
  writePendingSetupCatalogImport,
} from "../components/setup-catalog-storage";
import { SourceWorkbookImport } from "../components/SourceWorkbookImport";

const FAMILY_LABELS: Record<SetupCatalogFamily, string> = {
  ingredients: "Ingredients",
  mixes: "Mixes",
  "die-types": "Die types",
  "die-line-defaults": "Die line defaults",
  "production-rules": "Production rules",
  "freezer-pull-items": "Freezer pull items",
  "run-templates": "Run templates",
  "manager-lists": "Manager lists",
  aliases: "Aliases",
};

type CsvTemplate = { fileName: string; headers: readonly string[]; rows: readonly (readonly string[])[] };
const templates = setupCatalogCsvTemplates as Record<SetupCatalogFamily, CsvTemplate>;

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function reviewLabel(status: SetupCatalogHistoryItem["status"]): string {
  if (status === "staged") return "Staged setup · review before applying";
  if (status === "applied") return "Applied setup · imported values";
  return "Undone setup · prior import values";
}

export function SetupPage({ session, online }: { session: AuthSession; online: boolean }) {
  const userId = session.staff.userId;
  const canManage = session.staff.capabilities.includes("manage-inventory");
  const [family, setFamily] = useState<SetupCatalogFamily>("ingredients");
  const [history, setHistory] = useState<SetupCatalogHistoryItem[]>([]);
  const [review, setReview] = useState<SetupCatalogDetail | null>(null);
  const [pending, setPending] = useState<SetupCatalogStageRequest | null>(null);
  const [busy, setBusy] = useState<"history" | "stage" | "apply" | "undo" | "reopen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadGeneration = useRef(0);
  const template = templates[family];
  const templateCsv = useMemo(() => renderImportCsvTemplate(template), [template]);
  const templateUrl = useMemo(() => URL.createObjectURL(new Blob([templateCsv], { type: "text/csv;charset=utf-8" })), [templateCsv]);
  const writeDisabled = !online || !canManage || busy !== null || pending !== null;

  useEffect(() => () => URL.revokeObjectURL(templateUrl), [templateUrl]);

  async function loadCanonical(importId?: string, quiet = false): Promise<boolean> {
    if (!online || !canManage) return false;
    const generation = ++loadGeneration.current;
    if (!quiet) {
      setBusy(importId ? "reopen" : "history");
      setError(null);
    }
    try {
      const [nextHistory, nextReview] = await Promise.all([
        listSetupCatalogImports(),
        importId ? getSetupCatalogImport(importId) : Promise.resolve(null),
      ]);
      if (generation !== loadGeneration.current) return false;
      setHistory(nextHistory);
      setHistoryLoaded(true);
      if (nextReview) setReview(nextReview);
      else if (review && !nextHistory.some((item) => item.id === review.id)) setReview(null);
      return true;
    } catch (cause) {
      if (generation !== loadGeneration.current) return false;
      setError(message(cause, "Setup import history could not be loaded."));
      return false;
    } finally {
      if (generation === loadGeneration.current) setBusy(null);
    }
  }

  useEffect(() => {
    loadGeneration.current += 1;
    setPending(readPendingSetupCatalogImport(userId));
    setError(null);
    setNotice(null);
    setBusy(null);
    if (!online && fileInput.current) fileInput.current.value = "";
    if (!canManage) {
      setHistory([]);
      setReview(null);
      setHistoryLoaded(false);
      return;
    }
    if (online) void loadCanonical();
    else if (!historyLoaded) setError("Offline read-only view. Reconnect to load setup import history; no setup writes are available.");
  }, [online, canManage, userId]);

  function changeFamily(next: SetupCatalogFamily) {
    if (pending || busy) return;
    setFamily(next);
    setReview(null);
    setError(null);
    setNotice(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function clearFile() {
    if (fileInput.current) fileInput.current.value = "";
  }

  function persistPending(request: SetupCatalogStageRequest): boolean {
    try {
      writePendingSetupCatalogImport(userId, request);
      setPending(request);
      return true;
    } catch {
      setError("This device could not retain the pending request. Nothing was sent; check browser storage and try again.");
      setNotice(null);
      return false;
    }
  }

  async function stage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || writeDisabled) return;
    if (file.size > 1024 * 1024) {
      setError("CSV files must be 1 MiB or smaller. Nothing was staged.");
      return;
    }
    setBusy("stage");
    setError(null);
    setNotice("Validating and staging the CSV. Nothing will be applied yet.");
    try {
      const csv = await file.text();
      parseSetupCatalogCsv(family, csv);
      const request: SetupCatalogStageRequest = { requestId: crypto.randomUUID(), family, csv };
      if (!persistPending(request)) return;
      await sendPending(request);
    } catch (cause) {
      setError(message(cause, "The CSV could not be validated. Nothing was staged."));
      setNotice(null);
    } finally {
      setBusy(null);
    }
  }

  async function sendPending(request: SetupCatalogStageRequest): Promise<boolean> {
    if (!online || !canManage) return false;
    setBusy("stage");
    setError(null);
    setNotice("Staging the reviewed setup records. Nothing will be applied yet.");
    try {
      const result = await stageSetupCatalogImport(request);
      clearPendingSetupCatalogImport(userId);
      setPending(null);
      clearFile();
      const reloaded = await loadCanonical(result.importId, true);
      setNotice(result.replayed
        ? `The previous staging request was confirmed. ${reloaded ? "The canonical setup review has been reloaded." : "Canonical review reload failed; refresh before applying."}`
        : `${request.sourceSummary ? "Reviewed source records" : "CSV"} staged. Review the stored records; no setup values have been applied.${reloaded ? "" : " Canonical review reload failed; refresh before applying."}`);
      return true;
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) {
        clearPendingSetupCatalogImport(userId);
        setPending(null);
      }
      setNotice(null);
      if (status === 401) setError("Your manager session expired. Sign in again; the same staging request is retained for safe retry.");
      else if (status === 403) setError("Your session could not authorize staging. Refresh your session; the same request is retained.");
      else if (status === 429 || status >= 500 || status === 0) {
        setError(`${message(cause, "Staging was not confirmed.")} Retry the same request; its request ID prevents duplicate imports.`);
      } else setError(message(cause, "The setup records were rejected. Nothing was staged."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function reopen(item: SetupCatalogHistoryItem) {
    if (!online || !canManage || busy) return;
    setError(null);
    setNotice(null);
    const loaded = await loadCanonical(item.id);
    if (loaded) setNotice("Canonical import details reloaded. Review the preserved values before acting.");
  }

  async function act(action: "apply" | "undo") {
    if (!review || !online || !canManage || busy || pending) return;
    if (action === "apply" && review.status !== "staged") return;
    if (action === "undo" && review.status !== "applied") return;
    if (action === "undo" && !window.confirm("Undo this setup import? Later edits or dependent records may block it.")) return;
    const importId = review.id;
    setBusy(action);
    setError(null);
    setNotice(action === "apply" ? "Applying the reviewed setup import…" : "Undoing the applied setup import…");
    let result: SetupCatalogActionResult;
    try {
      result = await actOnSetupCatalogImport(importId, action);
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setNotice(null);
      if (status === 409) {
        const reloaded = await loadCanonical(importId, true);
        setError(`${message(cause, "The setup changed before this action.")} ${reloaded ? "Canonical details were reloaded; review them before retrying." : "Canonical reload also failed; refresh history before retrying."}`);
      } else {
        setError(`${message(cause, "The setup action was not confirmed.")} Reload the canonical import before retrying.`);
      }
      return;
    } finally {
      setBusy(null);
    }
    const reloaded = await loadCanonical(importId, true);
    setNotice(action === "apply"
      ? `${result.replayed ? "Previous Apply confirmed. " : ""}${result.createdCount ?? 0} setup rows created and ${result.updatedCount ?? 0} updated. ${reloaded ? "Canonical history reloaded." : "Canonical reload failed; refresh history."}`
      : `${result.replayed ? "Previous Undo confirmed. " : ""}Setup import undone. Server dependency and later-edit rules were enforced. ${reloaded ? "Canonical history reloaded." : "Canonical reload failed; refresh history."}`);
  }

  if (!canManage) {
    return (
      <div>
        <div className="page-heading">
          <div><p className="eyebrow">Manager configuration</p><h1>Setup and master data</h1><p>Manager-only reviewed setup imports.</p></div>
        </div>
        <section className="panel mt-6 max-w-3xl" role="alert">
          <h2 className="text-lg font-semibold">Manager access required</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Your account does not have the manage-inventory capability required to read or change setup catalog imports.</p>
        </section>
      </div>
    );
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Manager configuration · server reviewed</p>
          <h1>Setup and master data</h1>
          <p>Stage strict CSV records, review their stored values, then explicitly apply or undo them. Staging alone changes no setup catalog.</p>
        </div>
        <button type="button" className="button-secondary" disabled={!online || busy !== null} onClick={() => void loadCanonical(review?.id)}>
          <RefreshCw className={`h-4 w-4 ${busy === "history" || busy === "reopen" ? "animate-spin" : ""}`} />Refresh history
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" role="status">
        <span className="status-pill">{online ? "Connected" : "Read-only offline"}</span>
        <span>{online ? "Server-owned import lifecycle · manage-inventory" : "Loaded values only · no file retained or writes queued"}</span>
      </div>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}<button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
      {pending ? (
        <div className="notice-banner" role="status">
          <span>A setup staging response is unresolved. Other setup writes are paused until the exact request succeeds or is rejected.</span>
          <button type="button" className="button-secondary ml-auto" disabled={!online || busy !== null} onClick={() => void sendPending(pending)}>Retry the same staging request</button>
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,1fr)]">
        <div className="min-w-0 space-y-5">
          <section className="panel" aria-labelledby="setup-stage-heading">
            <div className="panel-heading">
              <div><p className="eyebrow">Deterministic CSV import</p><h2 id="setup-stage-heading" className="mt-1 text-lg font-semibold">Stage records for review</h2></div>
              <span className="status-pill">CSV · 1 MiB · 2,000 rows maximum</span>
            </div>
            <form className="mt-5 space-y-4" onSubmit={(event) => void stage(event)}>
              <label className="block text-xs font-medium" htmlFor="setup-catalog-family">Setup family
                <select id="setup-catalog-family" className="field mt-1.5" value={family} disabled={!canManage || busy !== null || pending !== null} onChange={(event) => changeFamily(event.target.value as SetupCatalogFamily)}>
                  {Object.entries(FAMILY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="rounded-lg border border-border/70 bg-background/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-medium">Required columns, in order</p>
                  <a className="button-secondary min-h-9 px-3 py-1.5 text-xs" href={templateUrl} download={template.fileName}><Download className="h-4 w-4" />Download CSV template</a>
                </div>
                <p className="mt-3 break-words font-mono text-[11px] leading-5 text-muted-foreground">{template.headers.join(", ")}</p>
              </div>
              <label className="block text-xs font-medium" htmlFor="setup-catalog-file">Setup CSV file
                <input ref={fileInput} id="setup-catalog-file" className="field mt-1.5" type="file" accept=".csv,text/csv" disabled={writeDisabled} required onChange={() => { setError(null); setNotice(null); }} />
              </label>
              <button type="submit" className="button-primary" disabled={writeDisabled}><FileUp className="h-4 w-4" />{busy === "stage" ? "Staging…" : "Review and stage CSV"}</button>
            </form>
          </section>

          <SourceWorkbookImport
            online={online}
            disabled={writeDisabled}
            pending={pending !== null}
            onStage={async (request) => {
              if (writeDisabled || !persistPending(request)) return false;
              return sendPending(request);
            }}
          />

          {review ? (
            <section className="panel" aria-labelledby="setup-review-heading">
              <div className="panel-heading">
                <div><p className="eyebrow">Canonical stored records</p><h2 id="setup-review-heading" className="mt-1 text-lg font-semibold">Setup import review</h2></div>
                <span className={`status-pill ${review.status === "applied" ? "status-running" : review.status === "staged" ? "status-paused" : ""}`}>{review.status}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{reviewLabel(review.status)} · {FAMILY_LABELS[review.family as SetupCatalogFamily] ?? review.family} · {review.rowCount} row(s)</p>
              {review.sourceSummary ? <p className="mt-2 text-xs text-muted-foreground">Source {review.sourceSummary.sourceFamily} · {review.sourceSummary.sourceRows} source row(s) · {review.sourceSummary.importedRows} imported · {review.sourceSummary.skippedRows} skipped · {review.sourceSummary.unresolvedRows} still unresolved · SHA-256 {review.sourceSummary.sourceSha256.slice(0, 12)}…</p> : null}
              <div className="mt-5 space-y-4">
                {review.records.map((record, index) => (
                  <article key={`${record.code}-${index}`} className="rounded-lg border border-border/70 bg-background/40 p-4" aria-label={`Setup record ${index + 1}`}>
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{record.name}</h3><p className="mt-1 break-all font-mono text-xs text-amber-300">{record.code}</p></div>
                      <span className="status-pill">Record {index + 1}</span>
                    </div>
                    <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/70 p-3 font-mono text-[11px] leading-5 text-muted-foreground" aria-label={`Values for ${record.code}`}>{JSON.stringify(record.data, null, 2)}</pre>
                  </article>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-3 border-t border-border/70 pt-5">
                {review.status === "staged" ? <button type="button" className="button-primary" disabled={writeDisabled} onClick={() => void act("apply")}>Apply reviewed import</button> : null}
                {review.status === "applied" ? <button type="button" className="button-secondary" disabled={writeDisabled} onClick={() => void act("undo")}><RotateCcw className="h-4 w-4" />Undo applied import</button> : null}
                {review.status === "undone" ? <p className="text-xs leading-5 text-muted-foreground">This import is undone. Its preserved values are read-only; stage a new CSV for another change.</p> : null}
              </div>
            </section>
          ) : null}
        </div>

        <section className="panel min-w-0" aria-labelledby="setup-history-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Persisted server history</p><h2 id="setup-history-heading" className="mt-1 text-lg font-semibold">Import history</h2></div>
            <span className="status-pill">Latest {history.length}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Reopen any staged, applied, or undone import. Apply and Undo always use its canonical import ID.</p>
          <div className="mt-5 space-y-3">
            {history.map((item, index) => (
              <article key={item.id} className="rounded-lg border border-border/70 bg-background/40 p-4" aria-label={`Setup import history ${index + 1}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h3 className="text-sm font-semibold">{FAMILY_LABELS[item.family as SetupCatalogFamily] ?? item.family}</h3><p className="mt-1 text-xs text-muted-foreground">{item.rowCount} row(s) · {new Date(item.createdAt).toLocaleString()}</p></div>
                  <span className={`status-pill ${item.status === "applied" ? "status-running" : item.status === "staged" ? "status-paused" : ""}`}>{item.status}</span>
                </div>
                {item.sourceSummary ? <p className="mt-3 text-xs text-muted-foreground">Source {item.sourceSummary.sourceFamily} · {item.sourceSummary.importedRows} imported · {item.sourceSummary.skippedRows} skipped · {item.sourceSummary.unresolvedRows} unresolved</p> : null}
                {item.createdCount != null || item.updatedCount != null ? <p className="mt-3 text-xs text-muted-foreground">{item.createdCount ?? 0} created · {item.updatedCount ?? 0} updated</p> : null}
                <button type="button" className="button-secondary mt-4 w-full" disabled={!online || busy !== null} onClick={() => void reopen(item)}>{review?.id === item.id ? "Reload canonical review" : `Reopen import ${index + 1}`}</button>
              </article>
            ))}
            {history.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">{busy === "history" ? "Loading canonical import history…" : online ? "No setup catalog imports have been staged." : "Reconnect to load setup import history."}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
