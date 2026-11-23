import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { MixRecipe, MixRecipeCatalog, MixRecipeCommand } from "../api";

type EditorComponent = MixRecipe["components"][number] & { editorKey: string };
type RecipeForm = {
  id: string | null;
  kind: "product" | "prep";
  productId: string;
  name: string;
  notes: string;
  batchSizeLbs: string;
  daysEarly: string;
  enabled: boolean;
  components: EditorComponent[];
};

function blankComponent(editorKey = crypto.randomUUID()): EditorComponent {
  return { editorKey, ingredientProductId: "", ingredientName: "", ouncesPerPizza: "0", referencePoundsPerBatch: null };
}

function blankForm(): RecipeForm {
  return {
    id: null, kind: "product", productId: "", name: "", notes: "", batchSizeLbs: "20", daysEarly: "1", enabled: true,
    components: [blankComponent()],
  };
}

function editForm(recipe: MixRecipe): RecipeForm {
  return {
    id: recipe.id,
    kind: recipe.kind,
    productId: recipe.productId ?? "",
    name: recipe.name,
    notes: recipe.notes,
    batchSizeLbs: recipe.batchSizeLbs,
    daysEarly: String(recipe.daysEarly),
    enabled: recipe.enabled,
    components: recipe.components.map((component) => ({ ...component, editorKey: crypto.randomUUID() })),
  };
}

export function MixRecipeManager({ catalog, disabled, canManage, onCommand }: {
  catalog: MixRecipeCatalog;
  disabled: boolean;
  canManage: boolean;
  onCommand: (command: MixRecipeCommand, expectedRevision: number) => Promise<boolean>;
}) {
  const [form, setForm] = useState<RecipeForm | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = disabled || saving;

  function update<Key extends keyof RecipeForm>(key: Key, value: RecipeForm[Key]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  function updateComponent(editorKey: string, changes: Partial<EditorComponent>) {
    setForm((current) => current ? {
      ...current,
      components: current.components.map((component) => component.editorKey === editorKey ? { ...component, ...changes } : component),
    } : current);
  }

  function moveComponent(index: number, direction: -1 | 1) {
    setForm((current) => {
      if (!current) return current;
      const destination = index + direction;
      if (destination < 0 || destination >= current.components.length) return current;
      const components = [...current.components];
      const moving = components[index];
      const displaced = components[destination];
      if (!moving || !displaced) return current;
      components[index] = displaced;
      components[destination] = moving;
      return { ...current, components };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || readOnly || !canManage) return;
    const daysEarly = Number(form.daysEarly);
    if (!form.name.trim() || !Number.isInteger(daysEarly) || daysEarly < 0 || daysEarly > 365
      || (form.kind === "product" && !form.productId)
      || form.components.some((component) => !component.ingredientProductId)) {
      return;
    }
    const command: MixRecipeCommand = {
      type: "upsert",
      recipe: {
        id: form.id,
        kind: form.kind,
        productId: form.kind === "product" ? form.productId : null,
        name: form.name.trim(),
        notes: form.notes,
        batchSizeLbs: form.batchSizeLbs,
        daysEarly,
        enabled: form.enabled,
        components: form.components.map(({ ingredientProductId, ouncesPerPizza, referencePoundsPerBatch }) => ({
          ingredientProductId, ouncesPerPizza, referencePoundsPerBatch,
        })),
      },
    };
    const revision = form.id ? catalog.recipes.find((recipe) => recipe.id === form.id)?.revision : 0;
    if (revision === undefined) return;
    setSaving(true);
    try { if (await onCommand(command, revision)) setForm(null); }
    finally { setSaving(false); }
  }

  async function changeEnabled(recipe: MixRecipe, enabled: boolean) {
    if (readOnly || !canManage) return;
    const command: MixRecipeCommand = enabled
      ? {
          type: "upsert",
          recipe: {
            id: recipe.id, kind: recipe.kind, productId: recipe.productId, name: recipe.name, notes: recipe.notes,
            batchSizeLbs: recipe.batchSizeLbs, daysEarly: recipe.daysEarly, enabled: true,
            components: recipe.components.map(({ ingredientProductId, ouncesPerPizza, referencePoundsPerBatch }) => ({
              ingredientProductId, ouncesPerPizza, referencePoundsPerBatch,
            })),
          },
        }
      : { type: "disable", mixId: recipe.id };
    setSaving(true);
    try { await onCommand(command, recipe.revision); }
    finally { setSaving(false); }
  }

  return (
    <section className="panel" aria-labelledby="mix-recipes-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Recipe master data</p><h2 id="mix-recipes-heading" className="mt-1 text-lg font-semibold">Mix recipes</h2></div>
        {canManage ? <button type="button" className="button-primary" disabled={readOnly || form !== null} onClick={() => setForm(blankForm())}><Plus className="h-4 w-4" />New mix recipe</button> : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Product mixes attach to one stable product. Prep mixes can contribute across products and runs. Component order is retained; recipe changes affect future derivation, not posted history.</p>

      {form ? (
        <form className="mt-5 rounded-xl border border-amber-500/30 bg-background/40 p-4" onSubmit={(event) => void submit(event)} aria-label={form.id ? "Edit mix recipe" : "New mix recipe"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium" htmlFor="mix-recipe-kind">Mix kind
              <select id="mix-recipe-kind" className="field mt-1.5" value={form.kind} disabled={readOnly || form.id !== null}
                onChange={(event) => setForm((current) => current ? { ...current, kind: event.target.value as RecipeForm["kind"], productId: "" } : current)}>
                <option value="product">Product mix</option><option value="prep">Prep mix</option>
              </select>
            </label>
            <label className="text-xs font-medium" htmlFor="mix-recipe-product">Product {form.kind === "prep" ? "(not used for prep)" : ""}
              <select id="mix-recipe-product" className="field mt-1.5" value={form.productId} disabled={readOnly || form.kind === "prep"} required={form.kind === "product"}
                onChange={(event) => update("productId", event.target.value)}>
                <option value="">Choose product</option>
                {catalog.products.map((product) => <option key={product.productId} value={product.productId}>{product.productName} · {product.productCode}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium" htmlFor="mix-recipe-name">Recipe name
              <input id="mix-recipe-name" className="field mt-1.5" value={form.name} maxLength={120} required disabled={readOnly} onChange={(event) => update("name", event.target.value)} />
            </label>
            <label className="text-xs font-medium" htmlFor="mix-recipe-batch">Batch size (lb)
              <input id="mix-recipe-batch" className="field mt-1.5" type="number" min="0" step="0.000001" inputMode="decimal" value={form.batchSizeLbs} required disabled={readOnly} onChange={(event) => update("batchSizeLbs", event.target.value)} />
            </label>
            <label className="text-xs font-medium" htmlFor="mix-recipe-days">Days early
              <input id="mix-recipe-days" className="field mt-1.5" type="number" min="0" max="365" step="1" value={form.daysEarly} required disabled={readOnly} onChange={(event) => update("daysEarly", event.target.value)} />
            </label>
            <label className="flex min-h-11 items-end gap-3 pb-2 text-xs font-medium" htmlFor="mix-recipe-enabled">
              <input id="mix-recipe-enabled" type="checkbox" className="h-5 w-5 accent-amber-500" checked={form.enabled} disabled={readOnly} onChange={(event) => update("enabled", event.target.checked)} />Enabled for future plans
            </label>
          </div>
          <label className="mt-4 block text-xs font-medium" htmlFor="mix-recipe-notes">Notes
            <textarea id="mix-recipe-notes" className="field mt-1.5 min-h-20 resize-y" value={form.notes} maxLength={2000} disabled={readOnly} onChange={(event) => update("notes", event.target.value)} />
          </label>

          <div className="mt-5 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Ordered components ({form.components.length}/100)</h3>
            <button type="button" className="button-secondary px-3" disabled={readOnly || form.components.length >= 100} onClick={() => setForm((current) => current ? { ...current, components: [...current.components, blankComponent()] } : current)}><Plus className="h-4 w-4" />Add component</button>
          </div>
          <div className="mt-3 space-y-3">
            {form.components.map((component, index) => (
              <div key={component.editorKey} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">Component {index + 1}</span>
                  <div className="flex gap-1">
                    <button type="button" className="button-secondary min-h-9 px-2" aria-label={`Move component ${index + 1} up`} disabled={readOnly || index === 0} onClick={() => moveComponent(index, -1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className="button-secondary min-h-9 px-2" aria-label={`Move component ${index + 1} down`} disabled={readOnly || index === form.components.length - 1} onClick={() => moveComponent(index, 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className="button-secondary min-h-9 px-2" aria-label={`Remove component ${index + 1}`} disabled={readOnly || form.components.length === 1} onClick={() => setForm((current) => current ? { ...current, components: current.components.filter((item) => item.editorKey !== component.editorKey) } : current)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(8rem,0.7fr)_minmax(8rem,0.7fr)]">
                  <label className="text-xs font-medium" htmlFor={`ingredient-${component.editorKey}`}>Ingredient product
                    <select id={`ingredient-${component.editorKey}`} className="field mt-1.5" value={component.ingredientProductId} required disabled={readOnly} onChange={(event) => updateComponent(component.editorKey, { ingredientProductId: event.target.value })}>
                      <option value="">Choose ingredient</option>
                      {catalog.products.map((product) => <option key={product.productId} value={product.productId}>{product.productName} · {product.productCode}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium" htmlFor={`ounces-${component.editorKey}`}>Ounces/pizza
                    <input id={`ounces-${component.editorKey}`} className="field mt-1.5" type="number" min="0" step="0.000001" inputMode="decimal" value={component.ouncesPerPizza} required disabled={readOnly} onChange={(event) => updateComponent(component.editorKey, { ouncesPerPizza: event.target.value })} />
                  </label>
                  <label className="text-xs font-medium" htmlFor={`reference-${component.editorKey}`}>Reference lb/batch
                    <input id={`reference-${component.editorKey}`} className="field mt-1.5" type="number" min="0" step="0.000001" inputMode="decimal" value={component.referencePoundsPerBatch ?? ""} disabled={readOnly} onChange={(event) => updateComponent(component.editorKey, { referencePoundsPerBatch: event.target.value === "" ? null : event.target.value })} />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="submit" className="button-primary" disabled={readOnly}>{saving ? "Saving…" : form.id ? "Save recipe" : "Create recipe"}</button>
            <button type="button" className="button-secondary" disabled={readOnly} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="mt-5 space-y-3">
        {catalog.recipes.map((recipe) => (
          <article key={recipe.id} className="rounded-lg border border-border/60 bg-background/35 p-4" aria-label={`Recipe ${recipe.name}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold">{recipe.name}</h3><p className="mt-1 text-xs text-muted-foreground">{recipe.kind === "product" ? recipe.productName : "Prep mix"} · {recipe.batchSizeLbs} lb batch · {recipe.daysEarly} days early · Revision {recipe.revision}</p></div>
              <span className={`status-pill ${recipe.enabled ? "status-running" : ""}`}>{recipe.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{recipe.components.map((component) => `${component.ingredientName} ${component.ouncesPerPizza} oz/pizza`).join(" · ")}</p>
            {recipe.notes ? <p className="mt-2 text-xs leading-5">{recipe.notes}</p> : null}
            {canManage ? <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="button-secondary px-3" disabled={readOnly || form !== null} onClick={() => setForm(editForm(recipe))}>Edit</button>
              <button type="button" className="button-secondary px-3" disabled={readOnly || form !== null} onClick={() => void changeEnabled(recipe, !recipe.enabled)}>{recipe.enabled ? "Disable" : "Re-enable"}</button>
            </div> : null}
          </article>
        ))}
        {catalog.recipes.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No mix recipes are configured. An inventory manager can create the first product or prep recipe.</p> : null}
      </div>
    </section>
  );
}
