import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MixPlanEntry } from "../api";

function pounds(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function decimalInput(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

export function MixPlanEntryCard({ entry, disabled, canManage, onSave }: {
  entry: MixPlanEntry;
  disabled: boolean;
  canManage: boolean;
  onSave: (entry: MixPlanEntry, alreadyMadeLbs: string, actualMadeLbs: string) => Promise<boolean>;
}) {
  const [alreadyMade, setAlreadyMade] = useState(decimalInput(entry.manualAlreadyMadeLbs));
  const [actualMade, setActualMade] = useState(decimalInput(entry.actualMadeLbs));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAlreadyMade(decimalInput(entry.manualAlreadyMadeLbs));
    setActualMade(decimalInput(entry.actualMadeLbs));
  }, [entry.key, entry.revision, entry.manualAlreadyMadeLbs, entry.actualMadeLbs, entry.finalized]);

  const title = entry.kind === "product" ? `${entry.productName ?? "Product"} · ${entry.name}` : entry.name;
  const readOnly = disabled || entry.finalized || saving;

  async function save() {
    if (readOnly || !canManage) return;
    setSaving(true);
    try { await onSave(entry, alreadyMade.trim() || "0", actualMade.trim() || "0"); }
    finally { setSaving(false); }
  }

  return (
    <article className="panel" aria-label={`${title} for ${entry.productionDate}`}>
      <div className="panel-heading">
        <div className="min-w-0">
          <p className="eyebrow">{entry.kind === "product" ? "Product mix" : "Prep mix"} · {entry.productionDate}</p>
          <h3 className="mt-1 text-lg font-semibold">{title}</h3>
          {entry.notes ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{entry.notes}</p> : null}
        </div>
        <span className={`status-pill ${entry.finalized ? "status-completed" : ""}`}>
          {entry.finalized ? "Finalized · read only" : `Revision ${entry.revision}`}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="metric"><dt>Ingredients</dt><dd>{pounds(entry.componentLbs)} lb</dd></div>
        <div className="metric"><dt>15% waste</dt><dd>{pounds(entry.wasteLbs)} lb</dd></div>
        <div className="metric"><dt>Startup</dt><dd>{pounds(entry.startupLbs)} lb</dd></div>
        <div className="metric"><dt>Total plan</dt><dd>{pounds(entry.totalLbs)} lb</dd></div>
        <div className="metric"><dt>Remaining</dt><dd>{pounds(entry.remainingLbs)} lb</dd></div>
        <div className="metric"><dt>Batches</dt><dd>{entry.batches === null ? "Review batch size" : pounds(entry.batches)}</dd></div>
      </dl>

      <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
        <p>Manual already made: <strong className="text-foreground">{pounds(entry.manualAlreadyMadeLbs)} lb</strong></p>
        <p>Allocated surplus: <strong className="text-foreground">{pounds(entry.allocatedSurplusLbs)} lb</strong></p>
        <p>Total already made: <strong className="text-foreground">{pounds(entry.alreadyMadeLbs)} lb</strong></p>
      </div>

      {entry.warnings.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-300" role="alert">
          <strong>Review required</strong>
          <ul className="mt-1 list-disc space-y-1 pl-5">{entry.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}

      {entry.finalization ? (
        <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4 text-xs leading-5 text-sky-200">
          <strong>Completion basis retained.</strong> Actual made {pounds(entry.finalization.actualMadeLbs)} lb;
          fresh consumption {pounds(entry.finalization.freshLbs)} lb; surplus {pounds(entry.finalization.surplusLbs)} lb.
          The original plan above is unchanged. Finalized {new Date(entry.finalization.createdAt).toLocaleString()}.
        </div>
      ) : null}

      {canManage ? (
        <form className="mt-5 border-t border-border/70 pt-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium" htmlFor={`already-${entry.key}`}>Already made (lb)
              <input id={`already-${entry.key}`} className="field mt-1.5" type="number" min="0" step="0.000001" inputMode="decimal"
                value={alreadyMade} disabled={readOnly} onChange={(event) => setAlreadyMade(event.target.value)} required />
            </label>
            <label className="text-xs font-medium" htmlFor={`actual-${entry.key}`}>Actual made (lb)
              <input id={`actual-${entry.key}`} className="field mt-1.5" type="number" min="0" step="0.000001" inputMode="decimal"
                value={actualMade} disabled={readOnly} onChange={(event) => setActualMade(event.target.value)} required />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className="button-primary" disabled={readOnly}>
              {saving ? "Saving…" : entry.finalized ? "Finalized" : "Save dated amounts"}
            </button>
            <p className="text-xs leading-5 text-muted-foreground">Blank or zero actual made uses planned fresh need at run completion. No inventory moves from this save.</p>
          </div>
        </form>
      ) : <p className="mt-5 border-t border-border/70 pt-4 text-xs text-muted-foreground">Read-only staff view. An inventory manager records dated amounts.</p>}

      <button type="button" className="button-secondary mt-4 w-full" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {expanded ? "Hide" : "Show"} ingredients and contributions
      </button>

      {expanded ? (
        <div className="mt-5 space-y-5 border-t border-border/70 pt-5">
          <section aria-label={`Ingredients for ${title}`}>
            <h4 className="text-sm font-semibold">Ingredient calculation</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-3">Ingredient</th><th className="py-2 pr-3 text-right">Planned lb</th><th className="py-2 pr-3 text-right">Pull lb</th><th className="py-2 text-right">Reference lb/batch</th></tr></thead>
                <tbody>{entry.components.map((component) => (
                  <tr key={component.ingredientProductId} className="border-b border-border/50 last:border-0">
                    <td className="py-3 pr-3">{component.ingredientName}{component.missingRuns.length > 0 ? <span className="mt-1 block text-amber-300">Missing amount: {component.missingRuns.join(", ")}</span> : null}</td>
                    <td className="py-3 pr-3 text-right font-mono">{pounds(component.plannedLbs)}</td>
                    <td className="py-3 pr-3 text-right font-mono">{pounds(component.pullLbs)}</td>
                    <td className="py-3 text-right font-mono">{component.referencePoundsPerBatch === null ? "—" : pounds(component.referencePoundsPerBatch)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section aria-label={`Contributions for ${title}`}>
            <h4 className="text-sm font-semibold">Scheduled and live contributions</h4>
            <ul className="mt-3 space-y-3">{entry.contributions.map((contribution) => (
              <li key={contribution.key} className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><strong>{contribution.label}</strong><p className="mt-1 text-muted-foreground">{contribution.productName} · {contribution.source === "schedule" ? "Scheduled" : "Live run"}</p></div>
                  <span className="font-mono">{contribution.cases} cases · {contribution.pizzas} pizzas · {pounds(contribution.componentLbs)} lb</span>
                </div>
                {contribution.ingredients.length > 0 ? <p className="mt-2 leading-5 text-muted-foreground">{contribution.ingredients.map((ingredient) => `${ingredient.name}: ${ingredient.ouncesPerPizza === null ? "amount missing" : `${ingredient.ouncesPerPizza} oz/pizza`}`).join(" · ")}</p> : null}
                {contribution.warnings.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-300">{contribution.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
              </li>
            ))}</ul>
          </section>
        </div>
      ) : null}
    </article>
  );
}
