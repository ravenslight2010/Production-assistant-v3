import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CalendarClock, ClipboardList, PackageSearch, Settings2 } from "lucide-react";
import type { InventoryProduct, SaveWarehouseGuidanceSettingsRequest, WarehouseGuidance } from "../api";

type Props = {
  guidance: WarehouseGuidance;
  products: InventoryProduct[];
  canManage: boolean;
  disabled: boolean;
  onSaveSettings: (request: SaveWarehouseGuidanceSettingsRequest) => Promise<boolean>;
};

const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/u;

function Empty({ children }: { children: string }) {
  return <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{children}</p>;
}

export function WarehouseOperationsPanel({ guidance, products, canManage, disabled, onSaveSettings }: Props) {
  const [expirySoonDays, setExpirySoonDays] = useState(String(guidance.settings.expirySoonDays));
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setExpirySoonDays(String(guidance.settings.expirySoonDays));
    setThresholds(Object.fromEntries(products.map((product) => [
      product.id,
      guidance.settings.reorderPoints.find((point) => point.productId === product.id)?.threshold ?? "0",
    ])));
    setValidationError(null);
  }, [guidance.settings, products]);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);

  async function saveSettings() {
    const days = Number(expirySoonDays);
    if (!/^\d{1,3}$/u.test(expirySoonDays) || !Number.isSafeInteger(days) || days < 0 || days > 365) {
      setValidationError("Use a whole-number expiry window from 0 to 365 days.");
      return;
    }
    const reorderPoints = activeProducts.map((product) => ({ productId: product.id, threshold: thresholds[product.id] ?? "0" }));
    if (reorderPoints.some((point) => !NON_NEGATIVE_DECIMAL.test(point.threshold))) {
      setValidationError("Use non-negative thresholds with no more than six decimal places.");
      return;
    }
    setValidationError(null);
    await onSaveSettings({
      requestId: crypto.randomUUID(), expirySoonDays: days, reorderPoints,
      expectedRevision: guidance.settings.revision,
    });
  }

  return <div className="mt-5 space-y-5">
    {guidance.switchovers.length > 0 ? <section className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4" aria-labelledby="switchover-heading">
      <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden="true" /><h2 id="switchover-heading" className="font-semibold text-amber-100">Switchover warning</h2></div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">{guidance.switchovers.map((item) => <article key={item.runId} className="rounded-lg border border-amber-300/20 bg-background/40 p-4">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{item.runLabel}</h3><span className="status-pill">{item.skidsLeft} skids left</span>{item.packagingStage ? <span className="status-pill">Packaging stage</span> : null}{item.shortRun ? <span className="status-pill">Short run</span> : null}</div>
        <p className="mt-2 text-sm text-muted-foreground">{item.pressCasesLeft} cases left on press. Stop press at {new Date(item.pressStopAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; line clears at {new Date(item.lineClearAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>
        {item.nextRunLabels.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">Next: {item.nextRunLabels.join(" · ")}</p> : null}
      </article>)}</div>
    </section> : null}

    <div className="grid items-start gap-5 xl:grid-cols-2">
      <section className="panel min-w-0" aria-labelledby="reorder-heading">
        <div className="panel-heading"><div><p className="eyebrow">All upcoming scheduled demand</p><h2 id="reorder-heading" className="mt-1 text-lg font-semibold">Reorder review</h2></div><PackageSearch className="h-5 w-5 text-amber-300" aria-hidden="true" /></div>
        <p className="mt-3 text-xs text-muted-foreground">Projected on hand = stock across every warehouse − resolved demand dated today or later. Carry-in cases are excluded.</p>
        {guidance.reorder.length > 0 ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-3">Product</th><th className="py-2 pr-3 text-right">Projected</th><th className="py-2 pr-3 text-right">Threshold</th><th className="py-2 text-right">Suggested order</th></tr></thead><tbody>{guidance.reorder.map((item) => <tr key={item.productId} className="border-b border-border/50 last:border-0"><td className="py-3 pr-3">{item.productName}<span className="block text-xs text-muted-foreground">{item.productCode} · {item.onHand} on hand · {item.scheduledDemand} scheduled</span></td><td className="py-3 pr-3 text-right font-mono">{item.projectedOnHand} {item.unit}</td><td className="py-3 pr-3 text-right font-mono">{item.threshold}</td><td className="py-3 text-right font-mono font-semibold text-amber-200">{item.suggestedQuantity} {item.unit}</td></tr>)}</tbody></table></div> : <Empty>No configured product is at or below its reorder threshold.</Empty>}
      </section>

      <section className="panel min-w-0" aria-labelledby="use-first-heading">
        <div className="panel-heading"><div><p className="eyebrow">FEFO · {guidance.settings.expirySoonDays}-day window</p><h2 id="use-first-heading" className="mt-1 text-lg font-semibold">Use first</h2></div><CalendarClock className="h-5 w-5 text-amber-300" aria-hidden="true" /></div>
        {guidance.useFirst.length > 0 ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-3">Lot</th><th className="py-2 pr-3">Location</th><th className="py-2 pr-3 text-right">Quantity</th><th className="py-2 text-right">Expiry</th></tr></thead><tbody>{guidance.useFirst.map((item) => <tr key={item.lotId} className="border-b border-border/50 last:border-0"><td className="py-3 pr-3">{item.productName}<span className="block text-xs text-muted-foreground">{item.lotNumber}{item.demandedToday ? " · Needed today" : ""}</span></td><td className="py-3 pr-3 text-xs">{item.warehouseName}</td><td className="py-3 pr-3 text-right font-mono">{item.quantity} {item.unit}</td><td className={`py-3 text-right text-xs ${item.expired ? "font-semibold text-red-300" : "text-amber-200"}`}>{item.expired ? "Expired · " : ""}{item.expiresOn}<span className="block text-muted-foreground">{item.daysLeft} days</span></td></tr>)}</tbody></table></div> : <Empty>No positive expiring lots fall inside the configured window.</Empty>}
      </section>
    </div>

    <section className="panel" aria-labelledby="warehouse-needs-heading">
      <div className="panel-heading"><div><p className="eyebrow">Today and later · carry-in adjusted</p><h2 id="warehouse-needs-heading" className="mt-1 text-lg font-semibold">Warehouse needs</h2></div><ClipboardList className="h-5 w-5 text-amber-300" aria-hidden="true" /></div>
      {guidance.warehouseNeeds.warnings.length > 0 ? <div className="error-banner mt-4" role="alert"><div><p className="font-medium">Some scheduled demand is unresolved.</p><ul className="mt-1 list-disc pl-5">{guidance.warehouseNeeds.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div> : null}
      {guidance.warehouseNeeds.groups.length > 0 ? <div className="mt-4 grid gap-4 lg:grid-cols-2">{guidance.warehouseNeeds.groups.map((group) => <article key={group.area} className="rounded-lg border border-border/70 bg-background/30 p-4"><h3 className="font-medium">{group.area}</h3><div className="mt-3 space-y-3">{group.items.map((item) => <div key={item.productId}><div className="flex items-start justify-between gap-3 text-sm"><span>{item.productName}<span className="block text-xs text-muted-foreground">{item.productCode}</span></span><span className="shrink-0 font-mono">{item.resolved ? `${item.quantity} ${item.unit}` : "Unresolved"}</span></div><details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Scheduled runs ({item.runs.length})</summary><ul className="mt-2 space-y-1 pl-4">{item.runs.map((run) => <li key={`${run.scheduleRunId}-${run.productionDate}`}>{run.productionDate} · {run.runLabel}: {run.resolved ? `${run.quantity}${item.unit ? ` ${item.unit}` : ""}` : "Unresolved"}{run.warning ? ` — ${run.warning}` : ""}</li>)}</ul></details></div>)}</div></article>)}</div> : <Empty>No scheduled ingredient or packaging demand is available.</Empty>}
    </section>

    <section className="panel" aria-labelledby="transfer-guidance-heading">
      <div className="panel-heading"><div><p className="eyebrow">Today · active production warehouse</p><h2 id="transfer-guidance-heading" className="mt-1 text-lg font-semibold">Transfer guidance</h2></div><ArrowRightLeft className="h-5 w-5 text-amber-300" aria-hidden="true" /></div>
      <p className="mt-3 text-xs text-muted-foreground">Advisory only. Record any physical transfer through the existing manager-controlled transfer workflow.</p>
      {guidance.transferGuidance.length > 0 ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{guidance.transferGuidance.map((item) => <article key={`${item.warehouseId}-${item.productId}`} className="rounded-lg border border-border/70 bg-background/30 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{item.productName}</h3><p className="text-xs text-muted-foreground">{item.productCode} → {item.warehouseName}</p></div><span className="font-mono font-semibold text-amber-200">{item.suggestedQuantity} {item.unit}</span></div><p className="mt-3 text-sm">Needed {item.needed}; on site {item.onSite}; shortfall {item.shortfall}; off site {item.offSite}.</p><p className="mt-2 text-xs text-muted-foreground">Sources: {item.sources.map((source) => `${source.warehouseName} (${source.quantity})`).join(" · ")}</p></article>)}</div> : <Empty>No off-site transfer is suggested for today’s resolved demand.</Empty>}
    </section>

    {canManage ? <section className="panel" aria-labelledby="guidance-settings-heading">
      <div className="panel-heading"><div><p className="eyebrow">Manager configuration · revision {guidance.settings.revision}</p><h2 id="guidance-settings-heading" className="mt-1 text-lg font-semibold">Reorder and expiry settings</h2></div><Settings2 className="h-5 w-5 text-amber-300" aria-hidden="true" /></div>
      <div className="mt-5 max-w-xs"><label className="block text-xs font-medium" htmlFor="expiry-soon-days">Use-first expiry window (days)<input id="expiry-soon-days" className="field mt-1.5" inputMode="numeric" value={expirySoonDays} disabled={disabled} onChange={(event) => setExpirySoonDays(event.target.value)} /></label></div>
      {activeProducts.length > 0 ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[30rem] text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-4">Product</th><th className="py-2 pr-4">Unit</th><th className="py-2 text-right">Reorder threshold</th></tr></thead><tbody>{activeProducts.map((product) => <tr key={product.id} className="border-b border-border/50 last:border-0"><td className="py-3 pr-4">{product.name}<span className="block text-xs text-muted-foreground">{product.code}</span></td><td className="py-3 pr-4">{product.unit}</td><td className="py-3 text-right"><input aria-label={`Reorder threshold for ${product.name}`} className="field ml-auto w-36 text-right font-mono" inputMode="decimal" value={thresholds[product.id] ?? "0"} disabled={disabled} onChange={(event) => setThresholds((current) => ({ ...current, [product.id]: event.target.value }))} /></td></tr>)}</tbody></table></div> : <Empty>Create active inventory products before configuring reorder thresholds.</Empty>}
      {validationError ? <p className="error-banner mt-4" role="alert">{validationError}</p> : null}
      <p className="mt-4 text-xs text-muted-foreground">Zero disables reorder alerts for a product. Saving replaces the facility’s threshold set atomically.</p>
      <button type="button" className="button-primary mt-4" disabled={disabled || activeProducts.length === 0} onClick={() => void saveSettings()}>Save guidance settings</button>
    </section> : null}
  </div>;
}
