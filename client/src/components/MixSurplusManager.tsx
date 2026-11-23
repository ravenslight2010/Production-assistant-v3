import { useState, type FormEvent } from "react";
import type { MixRecipeCatalog, MixSurplus, MixSurplusCommand, MixSurplusLot } from "../api";

type AllocationDraft = { targetDate: string; quantityLbs: string };

function displayLot(lot: MixSurplusLot): string {
  return lot.productName ? `${lot.productName} · ${lot.mixName}` : lot.mixName;
}

export function MixSurplusManager({ surplus, catalog, defaultDate, disabled, canManage, onCommand }: {
  surplus: MixSurplus;
  catalog: MixRecipeCatalog;
  defaultDate: string;
  disabled: boolean;
  canManage: boolean;
  onCommand: (command: MixSurplusCommand, expectedRevision: number) => Promise<boolean>;
}) {
  const [mixId, setMixId] = useState("");
  const [productionDate, setProductionDate] = useState(defaultDate);
  const [quantityLbs, setQuantityLbs] = useState("");
  const [location, setLocation] = useState("");
  const [drafts, setDrafts] = useState<Record<string, AllocationDraft>>({});
  const [saving, setSaving] = useState(false);
  const readOnly = disabled || saving;
  const selectedRecipe = catalog.recipes.find((recipe) => recipe.id === mixId) ?? null;

  async function send(command: MixSurplusCommand): Promise<boolean> {
    setSaving(true);
    try { return await onCommand(command, surplus.revision); }
    finally { setSaving(false); }
  }

  async function record(event: FormEvent) {
    event.preventDefault();
    if (!selectedRecipe || readOnly || !canManage) return;
    const accepted = await send({
      type: "record", mixId: selectedRecipe.id, productId: selectedRecipe.productId,
      productionDate, quantityLbs, location: location.trim(),
    });
    if (accepted) { setQuantityLbs(""); setLocation(""); }
  }

  async function allocate(lot: MixSurplusLot) {
    const draft = drafts[lot.id];
    if (!draft || readOnly || !canManage) return;
    const accepted = await send({ type: "allocate", lotId: lot.id, targetDate: draft.targetDate, quantityLbs: draft.quantityLbs });
    if (accepted) setDrafts((current) => { const next = { ...current }; delete next[lot.id]; return next; });
  }

  return (
    <section className="panel" aria-labelledby="mix-surplus-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Dated surplus ledger</p><h2 id="mix-surplus-heading" className="mt-1 text-lg font-semibold">Mix surplus</h2></div>
        <span className="status-pill">Revision {surplus.revision}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Automatic overproduction and manual lots retain their source snapshots. Allocate explicitly to a future date; there is no hidden FEFO. Surplus use reduces already-made need and never deducts inventory again.</p>

      {canManage ? (
        <form className="mt-5 rounded-xl border border-border/60 bg-background/35 p-4" onSubmit={(event) => void record(event)} aria-label="Record manual mix surplus">
          <h3 className="text-sm font-semibold">Record manual lot</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-medium" htmlFor="surplus-recipe">Mix recipe
              <select id="surplus-recipe" className="field mt-1.5" value={mixId} required disabled={readOnly} onChange={(event) => setMixId(event.target.value)}>
                <option value="">Choose mix</option>
                {catalog.recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.kind === "product" ? `${recipe.productName} · ${recipe.name}` : recipe.name}{recipe.enabled ? "" : " · Disabled"}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium" htmlFor="surplus-production-date">Source production date
              <input id="surplus-production-date" className="field mt-1.5" type="date" value={productionDate} required disabled={readOnly} onChange={(event) => setProductionDate(event.target.value)} />
            </label>
            <label className="text-xs font-medium" htmlFor="surplus-quantity">Surplus (lb)
              <input id="surplus-quantity" className="field mt-1.5" type="number" min="0.000001" step="0.000001" inputMode="decimal" value={quantityLbs} required disabled={readOnly} onChange={(event) => setQuantityLbs(event.target.value)} />
            </label>
            <label className="text-xs font-medium" htmlFor="surplus-location">Location
              <input id="surplus-location" className="field mt-1.5" value={location} maxLength={120} disabled={readOnly} onChange={(event) => setLocation(event.target.value)} />
            </label>
          </div>
          <button type="submit" className="button-primary mt-4" disabled={readOnly || !selectedRecipe}>{saving ? "Saving…" : "Record surplus lot"}</button>
        </form>
      ) : null}

      <div className="mt-5 space-y-4">
        {surplus.lots.map((lot) => {
          const draft = drafts[lot.id] ?? { targetDate: "", quantityLbs: "" };
          return (
            <article key={lot.id} className="rounded-lg border border-border/60 bg-background/35 p-4" aria-label={`Surplus ${displayLot(lot)} ${lot.productionDate}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-sm font-semibold">{displayLot(lot)}</h3><p className="mt-1 text-xs text-muted-foreground">Source date {lot.productionDate} · {lot.source}{lot.location ? ` · ${lot.location}` : ""}</p></div>
                <span className={`status-pill ${lot.voided ? "" : "status-running"}`}>{lot.voided ? "Voided" : `${lot.remainingLbs} lb available`}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="metric"><dt>Amount made</dt><dd>{lot.amountMadeLbs} lb</dd></div>
                <div className="metric"><dt>Surplus</dt><dd>{lot.surplusLbs} lb</dd></div>
                <div className="metric"><dt>Allocated</dt><dd>{lot.allocatedLbs} lb</dd></div>
                <div className="metric"><dt>Remaining</dt><dd>{lot.remainingLbs} lb</dd></div>
              </dl>
              {lot.allocations.length > 0 ? <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{lot.allocations.map((allocation) => <li key={allocation.id}>Allocated {allocation.quantityLbs} lb to {allocation.targetDate} · {new Date(allocation.createdAt).toLocaleString()}</li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">No dated allocations.</p>}

              {canManage && !lot.voided ? (
                <div className="mt-4 border-t border-border/60 pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium" htmlFor={`allocation-date-${lot.id}`}>Target production date
                      <input id={`allocation-date-${lot.id}`} className="field mt-1.5" type="date" value={draft.targetDate} required disabled={readOnly}
                        onChange={(event) => setDrafts((current) => ({ ...current, [lot.id]: { ...draft, targetDate: event.target.value } }))} />
                    </label>
                    <label className="text-xs font-medium" htmlFor={`allocation-quantity-${lot.id}`}>Allocation (lb)
                      <input id={`allocation-quantity-${lot.id}`} className="field mt-1.5" type="number" min="0" step="0.000001" inputMode="decimal" value={draft.quantityLbs} required disabled={readOnly}
                        onChange={(event) => setDrafts((current) => ({ ...current, [lot.id]: { ...draft, quantityLbs: event.target.value } }))} />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className="button-primary" disabled={readOnly || !draft.targetDate || draft.quantityLbs === ""} onClick={() => void allocate(lot)}>{saving ? "Saving…" : "Save allocation"}</button>
                    <button type="button" className="button-secondary" disabled={readOnly} onClick={() => { if (window.confirm("Void this surplus lot and release its allocations?")) void send({ type: "void", lotId: lot.id }); }}>Void lot</button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">Saving the same target date replaces that allocation. Zero removes it. Allocations cannot exceed the available lot balance.</p>
                </div>
              ) : null}
            </article>
          );
        })}
        {surplus.lots.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No manual or automatic surplus lots are recorded.</p> : null}
      </div>
    </section>
  );
}
