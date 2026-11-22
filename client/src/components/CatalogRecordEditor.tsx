import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  parseSetupCatalogCsv,
  parseSetupCatalogRecord,
  setupCatalogCsvLimits,
  setupCatalogCsvTemplates,
  setupCatalogRunTemplateFields,
  type ParsedSetupCatalogRecord,
} from "../../../core/setup-catalog-csv.mjs";
import { renderImportCsvTemplate } from "../../../core/import-csv-templates.mjs";
import {
  listSetupCatalogRecords,
  type SetupCatalogEditRequest,
  type SetupCatalogFamily,
  type SetupCatalogListedRecord,
} from "../api";

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

const DIE_DEFAULT_LABELS: Record<string, string> = {
  crusts_per_cycle: "Crusts per cycle",
  cycle_speed: "Cycle speed",
  speed_adjustment: "Speed adjustment",
  freezer_time: "Freezer time",
  cases_per_layer: "Cases per layer",
  pre_tunnel_min: "Pre-tunnel minutes",
  post_tunnel_min: "Post-tunnel minutes",
  press_oven_min: "Press oven minutes",
  frontline_min: "Frontline minutes",
};

const STRING_LIST_KEYS = new Set(setupCatalogCsvLimits.directoryKeys.filter((key) => ![
  "run-calc-brand-flavors", "run-calc-dough-recipe-presets", "run-calc-frontline-recipe-presets",
  "run-calc-cheese-recipe-presets", "run-calc-shift-start-time", "run-calc-production-start-time",
].includes(key)));
const RECIPE_PRESET_KEYS = new Set([
  "run-calc-dough-recipe-presets", "run-calc-frontline-recipe-presets", "run-calc-cheese-recipe-presets",
]);
const ALIAS_KINDS: Record<string, string[]> = {
  spec: ["brand", "flavor", "appType", "pepType", "cheeseIngredient", "doughIngredient", "sauceIngredient", "recipeName", "dieType", "crossFamilyRouting"],
  merge: ["ingredient", "mixes", "dough", "sauce", "cheese", "brand", "flavor"],
};

type RecordData = Record<string, unknown>;
type RecipeRow = { ingredient: string; ingredientId?: string; lbs: number };
type EditorProps = {
  family: SetupCatalogFamily;
  online: boolean;
  disabled: boolean;
  onStage: (request: SetupCatalogEditRequest) => Promise<boolean>;
};

function field(label: string, control: ReactNode, hint?: string) {
  return <label className="block min-w-0 text-xs font-medium">{label}
    <span className="mt-1.5 block">{control}</span>
    {hint ? <span className="mt-1 block font-normal leading-5 text-muted-foreground">{hint}</span> : null}
  </label>;
}

function textInput(value: unknown, onChange: (value: string) => void, options: { disabled?: boolean; required?: boolean; type?: string } = {}) {
  return <input className="field w-full" type={options.type ?? "text"} value={typeof value === "string" ? value : ""}
    disabled={options.disabled} required={options.required} onChange={(event) => onChange(event.target.value)} />;
}

function numberInput(value: unknown, onChange: (value: number | null) => void, options: { disabled?: boolean; required?: boolean; integer?: boolean } = {}) {
  return <input className="field w-full" type="number" min="0" step={options.integer ? "1" : "any"}
    value={typeof value === "number" ? value : ""} disabled={options.disabled} required={options.required}
    onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />;
}

function checkbox(label: string, value: unknown, onChange: (value: boolean) => void, disabled = false) {
  return <label className="flex min-h-10 items-center gap-2 text-xs font-medium">
    <input type="checkbox" className="h-4 w-4" checked={value === true} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} />{label}
  </label>;
}

function selectInput(value: unknown, choices: readonly string[], onChange: (value: string) => void, disabled = false) {
  return <select className="field w-full" value={typeof value === "string" ? value : ""} disabled={disabled}
    onChange={(event) => onChange(event.target.value)}>
    {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
  </select>;
}

function StringListEditor({ value, onChange, disabled, label }: {
  value: unknown; onChange: (value: string[]) => void; disabled: boolean; label: string;
}) {
  const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const update = (index: number, next: string) => onChange(items.map((item, itemIndex) => itemIndex === index ? next : item));
  return <div className="space-y-2">
    {items.map((item, index) => <div className="flex gap-2" key={index}>
      {textInput(item, (next) => update(index, next), { disabled, required: true })}
      <button type="button" className="button-secondary px-3" aria-label={`Remove ${label} ${index + 1}`} disabled={disabled}
        onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></button>
    </div>)}
    <button type="button" className="button-secondary" disabled={disabled} onClick={() => onChange([...items, ""])}>
      <Plus className="h-4 w-4" />Add {label}
    </button>
  </div>;
}

function RecipeRowsEditor({ value, onChange, disabled }: {
  value: unknown; onChange: (value: RecipeRow[]) => void; disabled: boolean;
}) {
  const rows = Array.isArray(value) ? value as RecipeRow[] : [];
  const update = (index: number, patch: Partial<RecipeRow>) => onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  return <div className="space-y-3">
    {rows.map((row, index) => <div className="rounded-md border border-border/60 p-3" key={index}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_2.75rem]">
        {field("Ingredient", textInput(row.ingredient, (ingredient) => update(index, { ingredient }), { disabled, required: true }))}
        {field("Ingredient ID (optional)", textInput(row.ingredientId ?? "", (ingredientId) => update(index, { ingredientId: ingredientId || undefined }), { disabled }))}
        {field("Pounds", numberInput(row.lbs, (lbs) => update(index, { lbs: lbs ?? 0 }), { disabled, required: true }))}
        <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove recipe ingredient ${index + 1}`} disabled={disabled}
          onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>)}
    <button type="button" className="button-secondary" disabled={disabled}
      onClick={() => onChange([...rows, { ingredient: "", lbs: 0 }])}><Plus className="h-4 w-4" />Add recipe ingredient</button>
  </div>;
}

function ManagerValueEditor({ listKey, value, onChange, disabled }: {
  listKey: string; value: unknown; onChange: (value: unknown) => void; disabled: boolean;
}) {
  if (STRING_LIST_KEYS.has(listKey)) {
    return <StringListEditor label="list value" value={value} disabled={disabled} onChange={onChange} />;
  }
  if (listKey === "run-calc-brand-flavors") {
    const brands = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return <div className="space-y-4">
      {Object.entries(brands).map(([brand, flavors], index) => <div className="rounded-md border border-border/60 p-3" key={index}>
        <div className="flex gap-2">
          {textInput(brand, (nextBrand) => {
            const next = Object.fromEntries(Object.entries(brands).map(([key, item], itemIndex) => [itemIndex === index ? nextBrand : key, item]));
            onChange(next);
          }, { disabled, required: true })}
          <button type="button" className="button-secondary px-3" aria-label={`Remove brand flavors ${index + 1}`} disabled={disabled}
            onClick={() => onChange(Object.fromEntries(Object.entries(brands).filter((_, itemIndex) => itemIndex !== index)))}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="mt-3"><StringListEditor label="flavor" value={flavors} disabled={disabled}
          onChange={(next) => onChange({ ...brands, [brand]: next })} /></div>
      </div>)}
      <button type="button" className="button-secondary" disabled={disabled}
        onClick={() => onChange({ ...brands, [`Brand ${Object.keys(brands).length + 1}`]: [] })}><Plus className="h-4 w-4" />Add brand</button>
    </div>;
  }
  if (RECIPE_PRESET_KEYS.has(listKey)) {
    const recipes = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Record<string, unknown>> : {};
    return <div className="space-y-4">
      {Object.entries(recipes).map(([recipeName, recipe], index) => <div className="rounded-md border border-border/60 p-3" key={index}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_2.75rem]">
          {field("Recipe name", textInput(recipeName, (nextName) => onChange(Object.fromEntries(
            Object.entries(recipes).map(([key, item], itemIndex) => [itemIndex === index ? nextName : key, item]),
          )), { disabled, required: true }))}
          {field("Doughball weight oz", numberInput(recipe.doughballWeightOz,
            (doughballWeightOz) => onChange({ ...recipes, [recipeName]: { ...recipe, ...(doughballWeightOz === null ? {} : { doughballWeightOz }) } }), { disabled }))}
          <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove recipe preset ${index + 1}`} disabled={disabled}
            onClick={() => onChange(Object.fromEntries(Object.entries(recipes).filter((_, itemIndex) => itemIndex !== index)))}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="mt-4"><RecipeRowsEditor value={recipe.rows} disabled={disabled}
          onChange={(rows) => onChange({ ...recipes, [recipeName]: { ...recipe, rows } })} /></div>
      </div>)}
      <button type="button" className="button-secondary" disabled={disabled}
        onClick={() => onChange({ ...recipes, [`Recipe ${Object.keys(recipes).length + 1}`]: { rows: [] } })}><Plus className="h-4 w-4" />Add recipe preset</button>
    </div>;
  }
  return field("Start time", textInput(value, onChange, { disabled, required: true, type: "time" }));
}

function RunTemplateValuesEditor({ value, onChange, disabled }: {
  value: unknown; onChange: (value: Record<string, unknown>) => void; disabled: boolean;
}) {
  const values = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const active = new Set(Object.keys(values));
  const available = setupCatalogRunTemplateFields.filter((item) => !active.has(item.key));
  const [newField, setNewField] = useState("");
  useEffect(() => {
    if (newField && active.has(newField)) setNewField("");
  }, [newField, value]);
  function addField() {
    const definition = setupCatalogRunTemplateFields.find((item) => item.key === newField);
    if (!definition) return;
    onChange({ ...values, [newField]: definition.kind === "number" ? null : definition.kind === "boolean" ? false : definition.kind === "recipe" ? [] : "" });
    setNewField("");
  }
  return <div className="space-y-4">
    {setupCatalogRunTemplateFields.filter((item) => active.has(item.key)).map((definition) => {
      const item = values[definition.key];
      const update = (next: unknown) => onChange({ ...values, [definition.key]: next });
      return <div className="rounded-md border border-border/60 bg-background/30 p-3" key={definition.key}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="break-words text-xs font-semibold">{definition.key}</p>
          <button type="button" className="button-secondary min-h-8 px-2 py-1" disabled={disabled}
            onClick={() => onChange(Object.fromEntries(Object.entries(values).filter(([key]) => key !== definition.key)))}>Remove field</button>
        </div>
        {definition.kind === "number" ? numberInput(item, update, { disabled })
          : definition.kind === "boolean" ? selectInput(String(item), ["false", "true"], (next) => update(next === "true"), disabled)
            : definition.kind === "recipe" ? <RecipeRowsEditor value={item} onChange={update} disabled={disabled} />
              : textInput(item, update, { disabled })}
      </div>;
    })}
    <div className="flex flex-col gap-2 sm:flex-row">
      <select className="field" aria-label="Run template field to add" value={newField} disabled={disabled || available.length === 0}
        onChange={(event) => setNewField(event.target.value)}>
        <option value="">Choose a field</option>
        {available.map((item) => <option value={item.key} key={item.key}>{item.key}</option>)}
      </select>
      <button type="button" className="button-secondary" disabled={disabled || !newField} onClick={addField}><Plus className="h-4 w-4" />Add run field</button>
    </div>
  </div>;
}

function RecordForm({ family, initial, disabled, onStage, onCancel }: {
  family: SetupCatalogFamily;
  initial: ParsedSetupCatalogRecord;
  disabled: boolean;
  onStage: (request: SetupCatalogEditRequest) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ParsedSetupCatalogRecord>(() => JSON.parse(JSON.stringify({
    code: initial.code, name: initial.name, data: initial.data,
  })) as ParsedSetupCatalogRecord);
  const [expectedFingerprint] = useState((initial as SetupCatalogListedRecord).fingerprint ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = draft.data;
  const editing = expectedFingerprint !== null;
  const setData = (patch: RecordData) => setDraft((current) => ({ ...current, data: { ...current.data, ...patch } }));
  const setName = (name: string) => setDraft((current) => ({ ...current, name }));
  const derivedIdentity = ["die-line-defaults", "freezer-pull-items", "manager-lists", "aliases"].includes(family);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || saving) return;
    setSaving(true);
    setError(null);
    try {
      const record = parseSetupCatalogRecord(family, draft);
      const staged = await onStage({ requestId: crypto.randomUUID(), family, record, expectedFingerprint });
      if (staged) onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review the typed setup values and try again.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="mt-5 space-y-5 border-t border-border/70 pt-5" onSubmit={(event) => void submit(event)}>
    <div>
      <p className="eyebrow">{editing ? "Edit canonical record" : "Create canonical record"}</p>
      <h3 className="mt-1 text-base font-semibold">{FAMILY_LABELS[family]}</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Saving stages one typed change. It does not change the catalog until you review and Apply it.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      {field("Code", textInput(draft.code, (code) => setDraft((current) => ({ ...current, code, ...(derivedIdentity ? { name: code } : {}) })), { disabled: disabled || editing, required: true }),
        editing ? "Identity is immutable; stage a new record for a different code." : undefined)}
      {!derivedIdentity ? field("Name", textInput(draft.name, setName, { disabled, required: true })) : null}
    </div>

    {family === "ingredients" ? <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {field("Merged into code (optional)", textInput(data.mergedIntoCode ?? "", (mergedIntoCode) => setData({ mergedIntoCode: mergedIntoCode || null }), { disabled }))}
        <div className="flex flex-wrap gap-5">{checkbox("Enabled", data.enabled, (enabled) => setData({ enabled }), disabled)}
          {checkbox("Allergens reviewed", data.allergensReviewed, (allergensReviewed) => setData({ allergensReviewed }), disabled)}</div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2"><div><p className="mb-2 text-xs font-medium">Categories</p><StringListEditor label="category" value={data.categories} disabled={disabled} onChange={(categories) => setData({ categories })} /></div>
        <div><p className="mb-2 text-xs font-medium">Allergens</p><StringListEditor label="allergen" value={data.allergens} disabled={disabled} onChange={(allergens) => setData({ allergens })} /></div></div>
    </div> : null}

    {family === "mixes" ? <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {field("Brand", textInput(data.brand, (brand) => setData({ brand }), { disabled, required: true }))}
        {field("Flavor", textInput(data.flavor, (flavor) => setData({ flavor }), { disabled, required: true }))}
        {field("Batch size lbs (optional)", numberInput(data.batchSizeLbs, (batchSizeLbs) => setData({ batchSizeLbs }), { disabled }))}
        {field("Days early (optional)", numberInput(data.daysEarly, (daysEarly) => setData({ daysEarly }), { disabled, integer: true }))}
      </div>
      {field("Notes", textInput(data.notes, (notes) => setData({ notes }), { disabled }))}
      <div className="flex flex-wrap gap-5">{checkbox("Prep mix", data.isPrep, (isPrep) => setData({ isPrep }), disabled)}
        {checkbox("Enabled", data.enabled, (enabled) => setData({ enabled }), disabled)}</div>
      <div><p className="mb-2 text-xs font-medium">Components</p><RecipeMixComponents value={data.components} disabled={disabled} onChange={(components) => setData({ components })} /></div>
    </div> : null}

    {family === "die-line-defaults" ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Object.keys(DIE_DEFAULT_LABELS).map((key) => <div key={key}>{field(DIE_DEFAULT_LABELS[key] ?? key, numberInput(data[key],
        (next) => setData({ [key]: next }), { disabled, required: !["pre_tunnel_min", "post_tunnel_min", "press_oven_min", "frontline_min"].includes(key) }))}</div>)}
    </div> : null}

    {family === "production-rules" ? <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {field("Rule type", selectInput(data.type, ["required-field", "numeric-range", "sequence"], (type) => setData({ type }), disabled))}
        {field("Enforcement", selectInput(data.enforcement, ["flexible", "strict"], (enforcement) => setData({ enforcement }), disabled))}
        <div className="flex items-end">{checkbox("Enabled", data.enabled, (enabled) => setData({ enabled }), disabled)}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {field("Required field", textInput(data.field ?? "", (fieldValue) => setData({ field: fieldValue || null }), { disabled }))}
        {field("Minimum", numberInput(data.min, (min) => setData({ min }), { disabled }))}
        {field("Maximum", numberInput(data.max, (max) => setData({ max }), { disabled }))}
        {field("Sequence attribute", textInput(data.attribute ?? "", (attribute) => setData({ attribute: attribute || null }), { disabled }))}
        {field("Before", textInput(data.before ?? "", (before) => setData({ before: before || null }), { disabled }))}
        {field("After", textInput(data.after ?? "", (after) => setData({ after: after || null }), { disabled }))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Strict rules remain server-enforced. Saving a client form cannot waive a violated or unknown strict rule.</p>
      <RuleBypassEditor value={data.bypass} disabled={disabled} onChange={(bypass) => setData({ bypass })} />
      <div><p className="mb-2 text-xs font-medium">Review checklist</p><StringListEditor label="checklist item" value={data.checklist} disabled={disabled} onChange={(checklist) => setData({ checklist })} /></div>
    </div> : null}

    {family === "freezer-pull-items" ? <div className="grid gap-4 md:grid-cols-2">
      {field("Ingredient name", textInput(data.ingredientName, (ingredientName) => {
        setDraft((current) => ({ ...current, name: ingredientName, data: { ...current.data, ingredientName } }));
      }, { disabled, required: true }))}
      {field("Ingredient code (optional)", textInput(data.ingredientCode ?? "", (ingredientCode) => setData({ ingredientCode: ingredientCode || null }), { disabled }))}
      {field("Days early", numberInput(data.daysEarly, (daysEarly) => setData({ daysEarly }), { disabled, required: true, integer: true }))}
      <div className="flex items-end">{checkbox("Enabled", data.enabled, (enabled) => setData({ enabled }), disabled)}</div>
    </div> : null}

    {family === "run-templates" ? <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {field("Brand (optional)", textInput(data.brand ?? "", (brand) => setData({ brand: brand || null }), { disabled }))}
        {field("Flavor (optional)", textInput(data.flavor ?? "", (flavor) => setData({ flavor: flavor || null }), { disabled }))}
      </div>
      <RunTemplateValuesEditor value={data.values} disabled={disabled} onChange={(values) => setData({ values })} />
    </div> : null}

    {family === "manager-lists" ? <div className="space-y-4">
      {field("Approved directory", selectInput(draft.code, setupCatalogCsvLimits.directoryKeys, (key) => {
        setDraft((current) => ({ ...current, code: key, name: key, data: { key, value: defaultManagerValue(key) } }));
      }, disabled || editing))}
      <ManagerValueEditor listKey={draft.code} value={data.value} disabled={disabled} onChange={(value) => setDraft((current) => ({
        ...current, data: { key: current.code, value },
      }))} />
    </div> : null}

    {family === "aliases" ? <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {field("Alias type", selectInput(data.aliasType, ["spec", "merge"], (aliasType) => setData({ aliasType, kind: ALIAS_KINDS[aliasType]?.[0] ?? "brand" }), disabled))}
        {field("Kind", selectInput(data.kind, ALIAS_KINDS[String(data.aliasType)] ?? [], (kind) => setData({ kind }), disabled))}
        {field("External name", textInput(data.externalName, (externalName) => {
          setDraft((current) => ({ ...current, name: externalName, data: { ...current.data, externalName } }));
        }, { disabled, required: true }))}
        {field("Canonical name", textInput(data.canonicalName, (canonicalName) => setData({ canonicalName }), { disabled, required: true }))}
        {field("Context (when required)", textInput(data.context ?? "", (context) => setData({ context: context || null }), { disabled }))}
        {field("Brand (when required)", textInput(data.brand ?? "", (brand) => setData({ brand: brand || null }), { disabled }))}
      </div>
    </div> : null}

    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
      <button type="submit" className="button-primary" disabled={disabled || saving}>{saving ? "Staging…" : "Stage typed edit"}</button>
      <button type="button" className="button-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function RecipeMixComponents({ value, onChange, disabled }: {
  value: unknown; onChange: (value: Record<string, unknown>[]) => void; disabled: boolean;
}) {
  const components = Array.isArray(value) ? value as Record<string, unknown>[] : [];
  const update = (index: number, patch: RecordData) => onChange(components.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="space-y-3">
    {components.map((component, index) => <div className="rounded-md border border-border/60 p-3" key={index}>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_9rem_2.75rem]">
        {field("Ingredient name", textInput(component.ingredientName, (ingredientName) => update(index, { ingredientName }), { disabled, required: true }))}
        {field("Ingredient code (optional)", textInput(component.ingredientCode ?? "", (ingredientCode) => update(index, { ingredientCode: ingredientCode || null }), { disabled }))}
        {field("Oz per pizza", numberInput(component.perPizzaOz, (perPizzaOz) => update(index, { perPizzaOz }), { disabled }))}
        {field("Lbs per batch", numberInput(component.perBatchLbs, (perBatchLbs) => update(index, { perBatchLbs }), { disabled }))}
        <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove mix component ${index + 1}`} disabled={disabled || components.length === 1}
          onClick={() => onChange(components.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>)}
    <button type="button" className="button-secondary" disabled={disabled} onClick={() => onChange([...components, {
      ingredientName: "", ingredientCode: null, perPizzaOz: null, perBatchLbs: null,
    }])}><Plus className="h-4 w-4" />Add mix component</button>
  </div>;
}

function RuleBypassEditor({ value, onChange, disabled }: {
  value: unknown; onChange: (value: { field: string; value: string }[]) => void; disabled: boolean;
}) {
  const bypass = Array.isArray(value) ? value as { field: string; value: string }[] : [];
  return <div className="space-y-3"><p className="text-xs font-medium">Flexible-rule bypass conditions</p>
    {bypass.map((condition, index) => <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]" key={index}>
      {field("Field", textInput(condition.field, (fieldValue) => onChange(bypass.map((item, itemIndex) => itemIndex === index ? { ...item, field: fieldValue } : item)), { disabled, required: true }))}
      {field("Value", textInput(condition.value, (nextValue) => onChange(bypass.map((item, itemIndex) => itemIndex === index ? { ...item, value: nextValue } : item)), { disabled, required: true }))}
      <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove bypass condition ${index + 1}`} disabled={disabled}
        onClick={() => onChange(bypass.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></button>
    </div>)}
    <button type="button" className="button-secondary" disabled={disabled} onClick={() => onChange([...bypass, { field: "", value: "" }])}><Plus className="h-4 w-4" />Add bypass condition</button>
  </div>;
}

function defaultManagerValue(key: string): unknown {
  if (STRING_LIST_KEYS.has(key)) return [];
  if (key === "run-calc-brand-flavors" || RECIPE_PRESET_KEYS.has(key)) return {};
  return "08:00";
}

function emptyRecord(family: SetupCatalogFamily): ParsedSetupCatalogRecord {
  const template = setupCatalogCsvTemplates[family]!;
  const [record] = parseSetupCatalogCsv(family, renderImportCsvTemplate(template));
  return record!;
}

export function CatalogRecordEditor({ family, online, disabled, onStage }: EditorProps) {
  const [catalogs, setCatalogs] = useState<Partial<Record<SetupCatalogFamily, SetupCatalogListedRecord[]>>>({});
  const [cursors, setCursors] = useState<Partial<Record<SetupCatalogFamily, string | null>>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ParsedSetupCatalogRecord | null>(null);
  const records = useMemo(() => catalogs[family], [catalogs, family]);
  const nextCursor = cursors[family];

  async function load(append = false) {
    if (!online) return;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const page = await listSetupCatalogRecords(family, append ? nextCursor ?? null : null);
      setCatalogs((current) => ({ ...current, [family]: append ? [...current[family] ?? [], ...page.records] : page.records }));
      setCursors((current) => ({ ...current, [family]: page.nextCursor }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The setup catalog could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setEditor(null);
    setError(null);
    if (online) void load(false);
  }, [family, online]);

  useEffect(() => {
    const reload = () => { if (online) void load(false); };
    window.addEventListener("fieldline:v3:setup-catalog-changed", reload);
    return () => window.removeEventListener("fieldline:v3:setup-catalog-changed", reload);
  }, [family, online, nextCursor]);

  return <section className="panel" aria-labelledby="typed-catalog-heading">
    <div className="panel-heading">
      <div><p className="eyebrow">Typed catalog editor</p><h2 id="typed-catalog-heading" className="mt-1 text-lg font-semibold">{FAMILY_LABELS[family]}</h2></div>
      <span className="status-pill">{records?.length ?? 0} loaded</span>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Create or revise one record with family-specific fields. Every save enters the same staged review, Apply, history, and Undo lifecycle as CSV.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" className="button-primary" disabled={disabled || !online} onClick={() => setEditor(emptyRecord(family))}><Plus className="h-4 w-4" />Create record</button>
      <button type="button" className="button-secondary" disabled={disabled || !online || loading} onClick={() => void load(false)}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh records</button>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {!online && !records ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Offline read-only view. Reconnect to load this family; no writes are queued.</p> : null}
    {online && !records && loading ? <p className="mt-4 text-sm text-muted-foreground">Loading canonical records…</p> : null}
    {records && records.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No canonical {FAMILY_LABELS[family].toLocaleLowerCase("en-US")} records exist.</p> : null}
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {records?.map((record) => <article className="rounded-lg border border-border/70 bg-background/40 p-4" key={record.code}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{record.name}</h3><p className="mt-1 break-all font-mono text-xs text-amber-300">{record.code}</p></div>
          <button type="button" className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={disabled || !online}
            onClick={() => setEditor(record)}><Pencil className="h-4 w-4" />Edit</button>
        </div>
      </article>)}
    </div>
    {nextCursor ? <button type="button" className="button-secondary mt-4 w-full" disabled={disabled || !online || loadingMore}
      onClick={() => void load(true)}>{loadingMore ? "Loading…" : "Load next 100 records"}</button> : null}
    {editor ? <RecordForm key={`${family}:${editor.code}:${(editor as SetupCatalogListedRecord).fingerprint ?? "new"}`} family={family} initial={editor}
      disabled={disabled || !online} onStage={onStage} onCancel={() => setEditor(null)} /> : null}
  </section>;
}
