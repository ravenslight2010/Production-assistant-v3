import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ClipboardCheck, Download, FileUp } from "lucide-react";
import { parseOpeningCountCsv } from "../../../core/import-csv.mjs";
import { openingCountCsvTemplate, renderImportCsvTemplate } from "../../../core/import-csv-templates.mjs";
import type {
  InventoryProduct,
  OpeningCountRecord,
  OpeningCountRequest,
  OpeningCountSummary,
  Warehouse,
} from "../api";
import type { PendingInventoryRequest } from "./inventory-storage";

export function OpeningCountPanel({ online, disabled, pending, warehouse, products, currentCount, counts, onStage, onAction, onReopen }: {
  online: boolean;
  disabled: boolean;
  pending: PendingInventoryRequest | null;
  warehouse: Warehouse | null;
  products: InventoryProduct[];
  currentCount: OpeningCountRecord | null;
  counts: OpeningCountSummary[];
  onStage: (request: OpeningCountRequest) => Promise<boolean>;
  onAction: (countId: string, action: "review" | "apply") => void;
  onReopen: (countId: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const sawOpeningPending = useRef(false);
  const [staging, setStaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeProducts = products.filter((product) => product.active);
  const controlsDisabled = disabled || staging || !online;
  const templateCsv = useMemo(() => renderImportCsvTemplate(openingCountCsvTemplate), []);
  const templateUrl = useMemo(() => URL.createObjectURL(new Blob([templateCsv], { type: "text/csv;charset=utf-8" })), [templateCsv]);

  function clearFile() {
    if (fileInput.current) fileInput.current.value = "";
  }

  useEffect(() => () => URL.revokeObjectURL(templateUrl), [templateUrl]);
  useEffect(() => { if (!online) clearFile(); }, [online]);
  useEffect(() => {
    if (pending?.kind === "opening-count") sawOpeningPending.current = true;
    if (pending?.kind !== "opening-count" && sawOpeningPending.current) {
      sawOpeningPending.current = false;
      clearFile();
    }
  }, [pending]);

  async function stage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || !warehouse || controlsDisabled || activeProducts.length === 0) return;
    if (file.size > 1024 * 1024) {
      setError("Opening-count CSV files must be 1 MiB or smaller. Nothing was staged.");
      return;
    }
    setStaging(true);
    setError(null);
    try {
      const csv = await file.text();
      parseOpeningCountCsv(csv, activeProducts.map((product) => product.code));
      const staged = await onStage({ requestId: crypto.randomUUID(), warehouseId: warehouse.id, csv });
      if (staged) clearFile();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The opening-count CSV could not be validated. Nothing was staged.");
    } finally {
      setStaging(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="opening-count-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Physical inventory start</p><h2 id="opening-count-heading" className="mt-1 text-lg font-semibold">Opening counts</h2></div>
        <ClipboardCheck className="h-5 w-5 text-amber-300" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Every active product must appear exactly once, including explicit zero quantities. Staging changes no stock; a manager must review and apply the stored count.</p>
      <form className="mt-5 space-y-4" onSubmit={(event) => void stage(event)}>
        <div className="rounded-lg border border-border/70 bg-background/40 p-4 text-sm">
          <span className="text-xs font-medium">Counting warehouse</span>
          <p className="mt-1 font-semibold">{warehouse?.name ?? "Create a warehouse first"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{activeProducts.length} active product(s) required in the CSV</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs text-muted-foreground">product_code, quantity</p>
          <a className="button-secondary min-h-9 px-3 py-1.5 text-xs" href={templateUrl} download={openingCountCsvTemplate.fileName}><Download className="h-4 w-4" />Download opening-count template</a>
        </div>
        <label className="block text-xs font-medium" htmlFor="opening-count-file">Opening count CSV
          <input ref={fileInput} id="opening-count-file" className="field mt-1.5" type="file" accept=".csv,text/csv" required disabled={controlsDisabled || !warehouse || activeProducts.length === 0} onChange={() => setError(null)} />
        </label>
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        <button type="submit" className="button-primary" disabled={controlsDisabled || !warehouse || activeProducts.length === 0}><FileUp className="h-4 w-4" />{staging ? "Staging…" : "Stage opening count"}</button>
      </form>

      {currentCount ? <div className="mt-6 rounded-lg border border-border/70 bg-background/40 p-4" role="region" aria-labelledby="current-count-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="eyebrow">Canonical stored count</p><h3 id="current-count-heading" className="mt-1 font-semibold">Opening count review</h3></div>
          <span className={`status-pill ${currentCount.status === "applied" ? "status-running" : "status-paused"}`}>{currentCount.status}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{currentCount.rows.length} counted product(s) · created {new Date(currentCount.createdAt).toLocaleString()}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-72 text-left text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-4">Product</th><th className="py-2 text-right">Quantity</th></tr></thead>
            <tbody>{currentCount.rows.map((row) => <tr key={row.productCode} className="border-b border-border/50 last:border-0"><td className="py-2 pr-4 font-mono text-xs">{row.productCode}</td><td className="py-2 text-right font-mono">{row.quantity}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {currentCount.status === "staged" ? <button type="button" className="button-secondary" disabled={controlsDisabled} onClick={() => onAction(currentCount.id, "review")}>Mark opening count reviewed</button> : null}
          {currentCount.status === "reviewed" ? <button type="button" className="button-primary" disabled={controlsDisabled} onClick={() => onAction(currentCount.id, "apply")}>Apply opening count</button> : null}
          {currentCount.status === "applied" ? <p className="text-xs text-muted-foreground">Applied to warehouse stock. The stored count remains available for audit.</p> : null}
        </div>
      </div> : null}

      <div className="mt-6 border-t border-border/70 pt-5">
        <h3 className="text-sm font-semibold">Opening-count history</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {counts.map((count, index) => <article key={count.id} className="rounded-lg border border-border/70 bg-background/40 p-3" aria-label={`Opening count history ${index + 1}`}>
            <div className="flex items-start justify-between gap-2"><div><h4 className="text-sm font-medium">{count.warehouseName}</h4><p className="mt-1 text-xs text-muted-foreground">{count.rowCount} row(s) · {new Date(count.createdAt).toLocaleString()}</p></div><span className="status-pill">{count.status}</span></div>
            <button type="button" className="button-secondary mt-3 w-full" disabled={!online || disabled} onClick={() => onReopen(count.id)}>{currentCount?.id === count.id ? "Reload count review" : `Reopen count ${index + 1}`}</button>
          </article>)}
          {counts.length === 0 ? <p className="text-sm text-muted-foreground">No physical opening counts have been staged.</p> : null}
        </div>
      </div>
    </section>
  );
}
