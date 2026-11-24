import { useEffect, useMemo, useState } from "react";
import { Layers3, RefreshCw } from "lucide-react";
import {
  type CombinedSetupReview,
  type CombinedSetupReviewRequest,
  type CombinedSetupReviewSummary,
  type SetupCatalogHistoryItem,
  type SourceWorkbookFamily,
} from "../api";

const DEPENDENCY_ORDER: SourceWorkbookFamily[] = [
  "spec-sheets", "dough-guides", "sauce-guides", "premix-sheets", "cheese-mix-specs", "shipping-guides",
];
const FAMILY_LABELS: Record<SourceWorkbookFamily, string> = {
  "spec-sheets": "Pizza specs",
  "dough-guides": "Dough",
  "sauce-guides": "Sauce",
  "premix-sheets": "Premixes",
  "cheese-mix-specs": "Cheese",
  "shipping-guides": "Shipping",
};
const PAGE_SIZE = 50;

type Filter = "decisions" | "fills" | "matches" | "all";

function valueText(value: unknown): string {
  if (value === undefined) return "Not present";
  return JSON.stringify(value) ?? String(value);
}

function sourcePosition(item: SetupCatalogHistoryItem): number {
  return DEPENDENCY_ORDER.indexOf(item.sourceSummary?.sourceFamily ?? "spec-sheets");
}

export function CombinedSetupReviewPanel({ online, disabled, busy, imports, history, review, onCreate, onReopen, onOpenImport }: {
  online: boolean;
  disabled: boolean;
  busy: boolean;
  imports: SetupCatalogHistoryItem[];
  history: CombinedSetupReviewSummary[];
  review: CombinedSetupReview | null;
  onCreate: (request: CombinedSetupReviewRequest) => Promise<boolean>;
  onReopen: (reviewId: string) => Promise<void>;
  onOpenImport: (importId: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("decisions");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const eligible = useMemo(() => imports
    .filter((item) => item.sourceSummary && item.status !== "undone")
    .sort((left, right) => sourcePosition(left) - sourcePosition(right) || left.id.localeCompare(right.id)), [imports]);

  useEffect(() => {
    const active = new Set(eligible.map((item) => item.id));
    setSelected((current) => current.filter((id) => active.has(id)));
  }, [eligible]);

  useEffect(() => setPage(0), [review?.id, filter]);

  const filteredEntries = useMemo(() => {
    if (!review) return [];
    if (filter === "all") return review.entries;
    if (filter === "fills") return review.entries.filter((entry) => entry.disposition === "fill");
    if (filter === "matches") return review.entries.filter((entry) => entry.disposition === "match");
    return review.entries.filter((entry) => entry.requiresDecision);
  }, [review, filter]);
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const visibleEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggle(importId: string) {
    setSelected((current) => current.includes(importId)
      ? current.filter((id) => id !== importId)
      : [...current, importId]);
    setError(null);
  }

  async function create() {
    if (selected.length === 0) {
      setError("Select at least one staged or applied source import.");
      return;
    }
    setError(null);
    await onCreate({ requestId: crypto.randomUUID(), importIds: [...selected].sort() });
  }

  return (
    <section className="panel" aria-labelledby="combined-review-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Whole-corpus coordination</p><h2 id="combined-review-heading" className="mt-1 text-lg font-semibold">Combined setup review</h2></div>
        <Layers3 className="h-5 w-5 text-primary" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Combine canonical staged or applied imports in dependency order. This review explains setup changes but never writes setup data; Apply and Undo remain on each individual import.</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Canonical source imports</h3>
          <div className="mt-3 space-y-2">
            {eligible.map((item) => <label key={item.id} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md border border-border/70 p-3 text-sm">
              <input className="mt-1" type="checkbox" checked={selected.includes(item.id)} disabled={!online || disabled || busy} onChange={() => toggle(item.id)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{FAMILY_LABELS[item.sourceSummary!.sourceFamily]} · {item.rowCount} row(s)</span>
                <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{item.id} · revision {item.revision}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.status} · {item.sourceSummary!.parserVersion} · SHA-256 {item.sourceSummary!.sourceSha256.slice(0, 12)}…</span>
              </span>
            </label>)}
            {eligible.length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Stage a source workbook first. CSV-only and undone imports cannot join a combined review.</p> : null}
          </div>
          <button type="button" className="button-primary mt-4 w-full" disabled={!online || disabled || busy || eligible.length === 0} onClick={() => void create()}>Create combined review</button>
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold">Saved combined reviews</h3>
          <div className="mt-3 space-y-2">
            {history.map((item, index) => <button key={item.id} type="button" className="button-secondary min-h-14 w-full justify-start text-left" aria-label={`Reopen combined review ${index + 1}`} disabled={!online || busy} onClick={() => void onReopen(item.id)}>
              <RefreshCw className="h-4 w-4 shrink-0" />
              <span><span className="block">Reopen combined review {index + 1}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{item.importCount} imports · {item.recordCount} records · {new Date(item.createdAt).toLocaleString()}</span></span>
            </button>)}
            {history.length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No combined reviews have been saved.</p> : null}
          </div>
        </div>
      </div>

      {review ? <div className="mt-6 border-t border-border/70 pt-5" aria-label="Combined setup projection">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="eyebrow">Server-owned projection</p><h3 className="mt-1 break-all font-mono text-sm">{review.id}</h3></div>
          <span className="status-pill">{review.replayed ? "Exact retry confirmed" : "Canonical review"}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <span><strong>{review.summary.fills}</strong> fills</span><span><strong>{review.summary.matches}</strong> matches</span>
          <span><strong>{review.summary.mismatches}</strong> mismatches</span><span><strong>{review.summary.conflicts}</strong> conflicts</span>
          <span><strong>{review.summary.missingDependencies}</strong> missing dependencies</span><span><strong>{review.summary.unresolvedIdentities}</strong> unresolved identities</span>
          <span><strong>{review.summary.imports}</strong> imports</span><span><strong>{review.summary.records}</strong> records</span>
        </div>

        <div className="mt-5 space-y-3">
          <h4 className="text-sm font-semibold">Imports in dependency order</h4>
          {review.imports.map((item) => <div key={item.importId} className="grid gap-3 border-t border-border/60 pt-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <span className="min-w-0"><strong>{FAMILY_LABELS[item.sourceSummary.sourceFamily]}</strong><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{item.importId} · revision {item.revision} · {item.sourceSummary.parserVersion}</span></span>
            <span className={`status-pill justify-self-start ${item.status === "applied" ? "status-running" : "status-paused"}`}>{item.status}</span>
            <button type="button" className="button-secondary w-full sm:w-auto" disabled={!online || busy} onClick={() => onOpenImport(item.importId)}>Open individual import</button>
          </div>)}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">No corpus-wide transaction or automatic rollback exists. If independent Applies partially complete, each successful import remains applied and its receipt stays visible in canonical history; reopen the remaining staged imports to continue.</p>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-3 border-t border-border/70 pt-5">
          <label className="text-xs font-medium">Value entries
            <select className="field mt-1.5" aria-label="Combined review filter" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              <option value="decisions">Needs an individual decision</option>
              <option value="fills">Blank fills</option>
              <option value="matches">Matches</option>
              <option value="all">All value entries</option>
            </select>
          </label>
          <span className="text-xs text-muted-foreground">{filteredEntries.length} shown by this filter</span>
        </div>
        <div className="mt-4 space-y-4">
          {visibleEntries.map((entry) => <article key={`${entry.targetFamily}:${entry.code}:${entry.field}`} className="rounded-lg border border-border/70 bg-background/40 p-4" aria-label={`${entry.disposition} ${entry.code} ${entry.field}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h4 className="break-all font-mono text-sm font-semibold">{entry.code} · {entry.field}</h4><p className="mt-1 text-xs text-muted-foreground">{entry.targetFamily}</p></div>
              <span className={`status-pill ${entry.disposition === "match" ? "status-running" : entry.requiresDecision ? "status-paused" : ""}`}>{entry.disposition}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div><p className="text-xs font-medium">Current canonical value</p><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{entry.currentRecordPresent ? valueText(entry.currentValue) : "No current canonical record"}</pre></div>
              <div><p className="text-xs font-medium">Distinct proposed values</p><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{entry.proposedValues.map(valueText).join("\n")}</pre></div>
            </div>
            {entry.requiresDecision ? <p className="mt-3 text-xs leading-5 text-amber-300">Decision required: keep the current value by leaving imports staged, or open the chosen individual source import and Apply it. For a conflict, choose one source explicitly; this panel does not choose or write for you.</p> : null}
            <div className="mt-4 space-y-3">
              {entry.proposals.map((proposal, index) => <div key={`${proposal.importId}:${proposal.code}:${index}`} className="border-t border-border/60 pt-3 text-xs">
                <p className="font-medium">Proposed {valueText(proposal.value)}</p>
                <p className="mt-1 break-words text-muted-foreground">{proposal.source ? `${proposal.source.workbook} · ${proposal.source.cell}` : "Citation unavailable in legacy /1 history"}</p>
                <p className="mt-1 break-all font-mono text-muted-foreground">Import {proposal.importId} · revision {proposal.revision} · {proposal.parserVersion} · {proposal.importStatus}</p>
                <button type="button" className="button-secondary mt-3 min-h-9 px-3 py-1.5 text-xs" disabled={!online || busy} onClick={() => onOpenImport(proposal.importId)}>Review this source import</button>
              </div>)}
            </div>
          </article>)}
          {visibleEntries.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No value entries match this filter. Missing source fields are not deletion proposals.</p> : null}
        </div>
        {pageCount > 1 ? <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" className="button-secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous entries</button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
          <button type="button" className="button-secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next entries</button>
        </div> : null}

        <div className="mt-6 border-t border-border/70 pt-5">
          <h4 className="text-sm font-semibold">Missing dependencies</h4>
          {review.missingDependencies.map((item) => <article key={`${item.importId}:${item.code}:${item.field}`} className="mt-3 rounded-lg border border-amber-300/60 p-4 text-sm">
            <p><strong>{item.code} · {item.field}</strong> references <span className="font-mono">{item.reference}</span>.</p>
            <p className="mt-2 text-xs text-muted-foreground">No unique exact or normalized canonical mix matches. {item.source ? `${item.source.workbook} · ${item.source.cell} · ` : ""}Import {item.importId} · revision {item.revision} · {item.parserVersion}</p>
            {item.suggestions.length > 0 ? <div className="mt-3 text-xs"><p className="font-medium">Deterministic near-name suggestions only</p><ul className="mt-1 list-disc pl-5">{item.suggestions.map((suggestion) => <li key={suggestion.code}>{suggestion.code} — {suggestion.name}</li>)}</ul><p className="mt-2 text-muted-foreground">These are never learned or linked automatically. Confirm a stable canonical code through an individual import.</p></div> : <p className="mt-2 text-xs text-muted-foreground">No suggestions. Stage the specialized recipe definition or correct the reference in an individual import.</p>}
            <button type="button" className="button-secondary mt-3" disabled={!online || busy} onClick={() => onOpenImport(item.importId)}>Open referring import</button>
          </article>)}
          {review.missingDependencies.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No missing recipe dependencies in this projection.</p> : null}
        </div>

        <div className="mt-6 border-t border-border/70 pt-5">
          <h4 className="text-sm font-semibold">Unresolved identities</h4>
          {review.unresolvedIdentities.map((item, index) => <article key={`${item.type}:${item.targetFamily}:${item.normalizedName}:${index}`} className="mt-3 rounded-lg border border-amber-300/60 p-4 text-sm">
            <p className="font-medium">{item.type === "ambiguous-name" ? "Ambiguous normalized name" : "Ambiguous dependency"}: {item.reference ?? item.normalizedName}</p>
            <p className="mt-1 text-xs text-muted-foreground">Multiple candidates remain distinct. Select the stable canonical code in the responsible individual import; no fuzzy link is learned.</p>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{JSON.stringify(item.candidates, null, 2)}</pre>
          </article>)}
          {review.unresolvedIdentities.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No ambiguous identities in this projection.</p> : null}
        </div>
      </div> : null}
    </section>
  );
}
