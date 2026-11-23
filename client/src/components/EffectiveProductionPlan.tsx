import type { Run, SubstitutionRule } from "../api";

function ruleText(rule: SubstitutionRule): string {
  if (rule.action === "remove") return `${rule.ingredient} removed`;
  const substitute = rule.substituteProductName ?? rule.substituteProductCode ?? "substitute";
  const quantity = rule.quantity ? ` · ${rule.quantity}` : " · original row quantities";
  return `${rule.ingredient} ${rule.action === "add" ? "kept + added" : "swapped"} → ${substitute}${quantity}`;
}

export function EffectiveProductionPlan({ run }: { run: Run }) {
  const plan = run.effectiveProductionPlan;
  const overlay = run.substitutionOverlay;
  if (!plan && !overlay) return null;
  return (
    <section className="mt-5 rounded-xl border border-border/70 bg-background/35 p-4" aria-labelledby="effective-plan-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Dated production overlay</p>
          <h3 id="effective-plan-heading" className="mt-1 text-sm font-semibold">Effective production plan</h3>
        </div>
        <span className="status-pill">{run.status === "completed" ? "Retained at completion" : "Current server derivation"}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {run.productionDate} · overlay revision {overlay?.revision ?? 0}. The base recipe, setup snapshot, and packaging remain unchanged.
      </p>
      {overlay && overlay.rules.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground" aria-label="Applied substitution rules">
          {overlay.rules.map((rule) => <li key={rule.id}>{ruleText(rule)}</li>)}
        </ul>
      ) : <p className="mt-3 text-xs text-muted-foreground">No temporary substitution rules are active for this date.</p>}
      {plan ? (
        <div className="mt-4 space-y-4">
          {plan.recipes.map((recipe) => (
            <section key={recipe.code} aria-label={`${recipe.name} effective ingredients`}>
              <h4 className="text-xs font-semibold">{recipe.name} <span className="font-mono font-normal text-muted-foreground">{recipe.code}</span></h4>
              {recipe.ingredients.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">All ingredient rows are removed for this production date.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60 rounded-lg border border-border/60">
                  {recipe.ingredients.map((line, index) => (
                    <li key={`${line.productId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                      <span>{line.productName} <span className="font-mono text-muted-foreground">{line.productCode}</span></span>
                      <span className="font-mono">{line.quantity} {line.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
