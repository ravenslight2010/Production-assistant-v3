import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  parseSetupCatalogCsv,
  parseSetupCatalogRecord,
  setupCatalogCsvLimits,
  setupAllergenOptions,
  setupCatalogCsvTemplates,
  setupCatalogRunTemplateFields,
  type ParsedSetupCatalogRecord,
} from "../../../core/setup-catalog-csv.mjs";
import { emptySetupMasterRecord, parseSetupMasterRecord } from "../../../core/setup-master-records.mjs";
import { renderImportCsvTemplate } from "../../../core/import-csv-templates.mjs";
import {
  listInventoryProducts,
  listSetupCatalogRecords,
  listSetupMasterRecords,
  type InventoryProduct,
  type SetupCatalogEditRequest,
  type SetupCatalogFamily,
  type SetupCatalogListedRecord,
  type SetupMasterEditRequest,
  type SetupMasterKind,
  type SetupMasterListedRecord,
  type SetupMasterRecord,
} from "../api";

const FAMILY_LABELS: Record<SetupCatalogFamily, string> = {
  ingredients: "Ingredients and allergens",
  mixes: "Premixes and mixes",
  "die-types": "Die types",
  "die-line-defaults": "Die line defaults",
  "production-rules": "Production rules",
  "freezer-pull-items": "Freezer pull items",
  "run-templates": "Production and shipping guides",
  "manager-lists": "Named recipes and directories",
  aliases: "Aliases",
};

const RECIPE_KIND_LABELS: Record<string, string> = {
  "run-calc-dough-recipe-presets": "Dough recipes",
  "run-calc-frontline-recipe-presets": "Sauce recipes",
  "run-calc-cheese-recipe-presets": "Cheese recipes",
};

const MASTER_KIND_LABELS: Record<SetupMasterKind, string> = {
  recipes: "Product dough yield",
  "production-setups": "Shipping case capacity",
};

const RUN_TEMPLATE_LABELS: Record<string, string> = {
  crustsPerCycle: "Crusts per press cycle",
  cycleSpeed: "Press cycle speed",
  speedAdjustment: "Line speed adjustment",
  approxLineSpeed: "Approximate line speed",
  freezerTime: "Freezer time (minutes)",
  pizzasPerCase: "Pizzas per shipping case",
  casesPerSkid: "Cases per skid",
  casesPerLayer: "Cases per layer",
  doughballsPerTray: "Doughballs per tray",
  crustsPerStack: "Crusts per stack",
  doughBatchYield: "Dough batch yield",
  crustsPerCase: "Crusts per case",
  sauceOzPerPizza: "Sauce ounces per pizza",
  sauceBarrelLbs: "Sauce barrel pounds",
  targetDoughballWeight: "Target doughball weight (oz)",
  doughRecipeName: "Named dough recipe",
  doughRecipe: "Dough recipe ingredients",
  frontlineRecipeName: "Named sauce recipe",
  frontlineRecipe: "Sauce recipe ingredients",
  cartoned: "Cartoned",
  labelPosition: "Label position",
  cartonsPerCase: "Cartons per case",
  cartonSize: "Carton size",
  labelsPerRoll: "Labels per roll",
  topLabelsPerRoll: "Top labels per roll",
  bottomLabelsPerRoll: "Bottom labels per roll",
  circles: "Circles",
  shipper: "Shipper",
  skidStacking: "Skid stacking",
  gripSheets: "Grip sheets",
  slipSheets: "Slip sheets",
  preTunnelMin: "Pre-tunnel minutes",
  pressOvenMin: "Press oven minutes",
  frontlineMin: "Frontline minutes",
  postTunnelMin: "Post-tunnel minutes",
  allergen: "Operational allergen note",
};

function runTemplateLabel(key: string): string {
  if (RUN_TEMPLATE_LABELS[key]) return RUN_TEMPLATE_LABELS[key];
  const applicator = key.match(/^app([1-4])(OzPerPizza|BatchLbs|Type|CheeseRecipeName|CheeseRecipe)$/u);
  if (applicator) {
    const labels: Record<string, string> = {
      OzPerPizza: "ounces per pizza", BatchLbs: "batch pounds", Type: "applicator type",
      CheeseRecipeName: "named cheese recipe", CheeseRecipe: "cheese recipe ingredients",
    };
    return `Applicator ${applicator[1]} ${labels[applicator[2]!]}`;
  }
  const pepperoni = key.match(/^pep([12])(Sticks|OzPerPizza|BatchLbs|Type)(B)?$/u);
  if (pepperoni) {
    const labels: Record<string, string> = {
      Sticks: "sticks", OzPerPizza: "ounces per pizza", BatchLbs: "batch pounds", Type: "type",
    };
    return `Pepperoni ${pepperoni[1]}${pepperoni[3] ? " B" : ""} ${labels[pepperoni[2]!]}`;
  }
  if (key === "pep1Combined") return "Combine pepperoni 1";
  if (key.startsWith("mixer")) return key === "mixerLowSec" ? "Mixer low speed (seconds)" : "Mixer high speed (seconds)";
  if (key === "hopperSec") return "Hopper seconds";
  if (key === "dieType") return "Die type";
  return key.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (letter) => letter.toUpperCase());
}

function runTemplateGroup(key: string): string {
  if (/^(app|sauce|frontline)/u.test(key)) return "Sauce and cheese guides";
  if (/^pep/u.test(key)) return "Pepperoni guides";
  if (/^(pizzasPerCase|cases|crustsPerCase|carton|label|circles|shipper|skid|grip|slip)/u.test(key)) return "Packaging and shipping";
  if (/(Min$|Sec$|Time$)/u.test(key)) return "Timing";
  return "Dough and line guides";
}

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

type MasterEditorProps = {
  online: boolean;
  disabled: boolean;
  onStage: (request: SetupMasterEditRequest) => Promise<boolean>;
};

type DoughballVariant = {
  label: string;
  weightOz?: number;
  perTray?: number;
  customers?: { brand: string; flavor: string }[];
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

function textArea(value: unknown, onChange: (value: string) => void, options: { disabled?: boolean; required?: boolean; rows?: number } = {}) {
  return <textarea className="field min-h-24 w-full resize-y" rows={options.rows ?? 3} value={typeof value === "string" ? value : ""}
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

function withOptional(record: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const next = { ...record };
  if (value === undefined || value === null || value === "") delete next[key];
  else next[key] = value;
  return next;
}

function nextAvailableName(prefix: string, names: readonly string[]): string {
  let index = names.length + 1;
  while (names.includes(`${prefix} ${index}`)) index += 1;
  return `${prefix} ${index}`;
}

function AllergenEditor({ value, reviewed, onChange, onReviewedChange, disabled }: {
  value: unknown;
  reviewed: unknown;
  onChange: (value: string[]) => void;
  onReviewedChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const allergens = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const selected = new Set(allergens.filter((item) => setupAllergenOptions.includes(item)));
  const legacy = allergens.filter((item) => !setupAllergenOptions.includes(item));
  function toggle(option: string, checked: boolean) {
    const next = setupAllergenOptions.filter((item) => item === option ? checked : selected.has(item));
    onChange([...next, ...legacy]);
  }
  return <div className="space-y-4 rounded-lg border border-border/60 bg-background/30 p-4">
    <div>
      <p className="text-xs font-semibold">Fixed-nine allergen visibility</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Unreviewed or missing mappings mean unknown. A reviewed empty selection means none of the fixed nine. These visibility aids never block production, confirm cleaning, release QC holds, or make certified claims.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {setupAllergenOptions.map((option) => <div key={option}>{checkbox(option, selected.has(option), (checked) => toggle(option, checked), disabled)}</div>)}
    </div>
    {legacy.length > 0 ? <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold">Unrecognized legacy allergen text</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">This imported text remains visible and is not treated as allergen-free. Resolve or remove every legacy entry before marking the mapping reviewed.</p>
      <div className="mt-3"><StringListEditor label="legacy allergen text" value={legacy} disabled={disabled}
        onChange={(nextLegacy) => onChange([...selected, ...nextLegacy])} /></div>
    </div> : null}
    {checkbox("Allergen mapping reviewed", reviewed, onReviewedChange, disabled || legacy.length > 0)}
    {legacy.length > 0 ? <p className="text-xs text-amber-300">Review remains unavailable until legacy allergen text is resolved.</p> : null}
  </div>;
}

function DoughballVariantsEditor({ value, onChange, disabled }: {
  value: unknown;
  onChange: (value: DoughballVariant[]) => void;
  disabled: boolean;
}) {
  const variants = Array.isArray(value) ? value as DoughballVariant[] : [];
  const update = (index: number, next: DoughballVariant) => onChange(variants.map((item, itemIndex) => itemIndex === index ? next : item));
  return <div className="space-y-3 rounded-lg border border-border/60 bg-background/30 p-4">
    <div>
      <p className="text-xs font-semibold">Doughball variants</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Labels must be distinct after spacing and case normalization. Customer brand/flavor pairings are descriptive; they do not filter recipe pickers.</p>
    </div>
    {variants.map((variant, index) => {
      const customers = variant.customers ?? [];
      return <div className="space-y-3 rounded-md border border-border/60 p-3" key={index}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_2.75rem]">
          {field("Variant label", textInput(variant.label, (label) => update(index, { ...variant, label }), { disabled, required: true }))}
          {field("Weight oz (optional)", numberInput(variant.weightOz, (weightOz) => update(index, withOptional(variant, "weightOz", weightOz) as DoughballVariant), { disabled }))}
          {field("Per tray (optional)", numberInput(variant.perTray, (perTray) => update(index, withOptional(variant, "perTray", perTray) as DoughballVariant), { disabled, integer: true }))}
          <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove doughball variant ${index + 1}`} disabled={disabled}
            onClick={() => onChange(variants.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium">Customer pairings</p>
          {customers.map((customer, customerIndex) => <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]" key={customerIndex}>
            {field("Brand", textInput(customer.brand, (brand) => update(index, { ...variant, customers: customers.map((item, itemIndex) => itemIndex === customerIndex ? { ...item, brand } : item) }), { disabled, required: true }))}
            {field("Flavor", textInput(customer.flavor, (flavor) => update(index, { ...variant, customers: customers.map((item, itemIndex) => itemIndex === customerIndex ? { ...item, flavor } : item) }), { disabled, required: true }))}
            <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove variant ${index + 1} customer ${customerIndex + 1}`} disabled={disabled}
              onClick={() => update(index, { ...variant, customers: customers.filter((_, itemIndex) => itemIndex !== customerIndex) })}><Trash2 className="h-4 w-4" /></button>
          </div>)}
          <button type="button" className="button-secondary" disabled={disabled}
            onClick={() => update(index, { ...variant, customers: [...customers, { brand: "", flavor: "" }] })}><Plus className="h-4 w-4" />Add customer pairing</button>
        </div>
      </div>;
    })}
    <button type="button" className="button-secondary" disabled={disabled}
      onClick={() => onChange([...variants, { label: "", customers: [] }])}><Plus className="h-4 w-4" />Add doughball variant</button>
  </div>;
}

function RecipePresetCollectionEditor({ listKey, value, onChange, disabled }: {
  listKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const recipes = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Record<string, unknown>> : {};
  const entries = Object.entries(recipes);
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  const visible = entries.filter(([name, recipe]) => !normalizedQuery || [name, recipe.brand, recipe.notes,
    ...(Array.isArray(recipe.flavors) ? recipe.flavors : []),
    ...(Array.isArray(recipe.rows) ? recipe.rows.map((row) => row && typeof row === "object" && !Array.isArray(row) ? (row as RecipeRow).ingredient : "") : []),
  ].some((item) => typeof item === "string" && item.toLocaleLowerCase("en-US").includes(normalizedQuery)));
  const isDough = listKey === "run-calc-dough-recipe-presets";
  const updateRecipe = (name: string, recipe: Record<string, unknown>) => onChange({ ...recipes, [name]: recipe });
  return <div className="space-y-4">
    {nameError ? <div className="error-banner" role="alert">{nameError}</div> : null}
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/30 p-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm font-semibold">{RECIPE_KIND_LABELS[listKey] ?? "Named recipes"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Factory-wide named recipe pool. Editing stages the containing canonical manager-list record with its server fingerprint.</p></div>
      <label className="block min-w-0 text-xs font-medium sm:w-72">Search named recipes
        <input className="field mt-1.5 w-full" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, brand, flavor, or ingredient" />
      </label>
    </div>
    {query ? <p className="text-xs text-muted-foreground" role="status">Showing {visible.length} of {entries.length} named recipes.</p> : null}
    {visible.map(([recipeName, recipe]) => {
      const index = entries.findIndex(([name]) => name === recipeName);
      return <article className="space-y-4 rounded-lg border border-border/70 bg-background/40 p-4" key={index} aria-label={`Named recipe ${index + 1}`}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_2.75rem]">
          {field("Recipe name", textInput(recipeName, (nextName) => {
            if (entries.some(([key], itemIndex) => itemIndex !== index && key === nextName)) {
              setNameError("Recipe names must be unique. The existing recipes were not changed.");
              return;
            }
            setNameError(null);
            onChange(Object.fromEntries(entries.map(([key, item], itemIndex) => [itemIndex === index ? nextName : key, item])));
          }, { disabled, required: true }))}
          <button type="button" className="button-secondary mt-6 px-3" aria-label={`Remove recipe preset ${index + 1}`} disabled={disabled}
            onClick={() => onChange(Object.fromEntries(entries.filter((_, itemIndex) => itemIndex !== index)))}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {field("Brand (optional)", textInput(recipe.brand ?? "", (brand) => updateRecipe(recipeName, withOptional(recipe, "brand", brand)), { disabled }))}
          {field("Doughball weight oz (optional)", numberInput(recipe.doughballWeightOz,
            (weight) => updateRecipe(recipeName, withOptional(recipe, "doughballWeightOz", weight)), { disabled }))}
          {field("Doughballs per tray (optional)", numberInput(recipe.doughballsPerTray,
            (perTray) => updateRecipe(recipeName, withOptional(recipe, "doughballsPerTray", perTray)), { disabled, integer: true }))}
          <div className="flex flex-wrap items-end gap-5">
            {checkbox("Enabled", recipe.enabled !== false, (enabled) => updateRecipe(recipeName, { ...recipe, enabled }), disabled)}
            {isDough ? checkbox("Premade crust", recipe.isPremadeCrust, (isPremadeCrust) => updateRecipe(recipeName, { ...recipe, isPremadeCrust }), disabled) : null}
          </div>
        </div>
        <div><p className="mb-2 text-xs font-medium">Flavors</p><StringListEditor label="flavor" value={recipe.flavors} disabled={disabled}
          onChange={(flavors) => updateRecipe(recipeName, { ...recipe, flavors })} /></div>
        {field("Notes", textArea(recipe.notes ?? "", (notes) => updateRecipe(recipeName, withOptional(recipe, "notes", notes)), { disabled }))}
        <div><p className="mb-2 text-xs font-medium">Ingredients and pounds</p><RecipeRowsEditor value={recipe.rows} disabled={disabled}
          onChange={(rows) => updateRecipe(recipeName, { ...recipe, rows })} /></div>
        {isDough ? <DoughballVariantsEditor value={recipe.doughballVariants} disabled={disabled}
          onChange={(doughballVariants) => updateRecipe(recipeName, { ...recipe, doughballVariants })} /> : null}
      </article>;
    })}
    {entries.length > 0 && visible.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No named recipes match this search.</p> : null}
    <button type="button" className="button-secondary" disabled={disabled}
      onClick={() => {
        setNameError(null);
        onChange({ ...recipes, [nextAvailableName("Recipe", entries.map(([name]) => name))]: {
          rows: [], enabled: true, ...(isDough ? { doughballVariants: [] } : {}),
        } });
      }}><Plus className="h-4 w-4" />Add named recipe</button>
  </div>;
}

function ManagerValueEditor({ listKey, value, onChange, disabled }: {
  listKey: string; value: unknown; onChange: (value: unknown) => void; disabled: boolean;
}) {
  const [brandError, setBrandError] = useState<string | null>(null);
  if (STRING_LIST_KEYS.has(listKey)) {
    return <StringListEditor label="list value" value={value} disabled={disabled} onChange={onChange} />;
  }
  if (listKey === "run-calc-brand-flavors") {
    const brands = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return <div className="space-y-4">
      {brandError ? <div className="error-banner" role="alert">{brandError}</div> : null}
      {Object.entries(brands).map(([brand, flavors], index) => <div className="rounded-md border border-border/60 p-3" key={index}>
        <div className="flex gap-2">
          {textInput(brand, (nextBrand) => {
            if (Object.keys(brands).some((key, itemIndex) => itemIndex !== index && key === nextBrand)) {
              setBrandError("Brand names must be unique. The existing brands were not changed.");
              return;
            }
            setBrandError(null);
            onChange(Object.fromEntries(Object.entries(brands).map(([key, item], itemIndex) => [itemIndex === index ? nextBrand : key, item])));
          }, { disabled, required: true })}
          <button type="button" className="button-secondary px-3" aria-label={`Remove brand flavors ${index + 1}`} disabled={disabled}
            onClick={() => onChange(Object.fromEntries(Object.entries(brands).filter((_, itemIndex) => itemIndex !== index)))}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="mt-3"><StringListEditor label="flavor" value={flavors} disabled={disabled}
          onChange={(next) => onChange({ ...brands, [brand]: next })} /></div>
      </div>)}
      <button type="button" className="button-secondary" disabled={disabled}
        onClick={() => {
          setBrandError(null);
          onChange({ ...brands, [nextAvailableName("Brand", Object.keys(brands))]: [] });
        }}><Plus className="h-4 w-4" />Add brand</button>
    </div>;
  }
  if (RECIPE_PRESET_KEYS.has(listKey)) {
    return <RecipePresetCollectionEditor listKey={listKey} value={value} onChange={onChange} disabled={disabled} />;
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
  const groups = ["Dough and line guides", "Sauce and cheese guides", "Pepperoni guides", "Packaging and shipping", "Timing"];
  return <div className="space-y-5">
    <p className="text-xs leading-5 text-muted-foreground">Guide values remain in the canonical run-template record. Packaging and case-capacity setup records are reviewed separately; no cross-store atomic Apply is implied.</p>
    {groups.map((group) => {
      const definitions = setupCatalogRunTemplateFields.filter((item) => active.has(item.key) && runTemplateGroup(item.key) === group);
      if (definitions.length === 0) return null;
      return <section className="space-y-3" key={group} aria-label={group}>
        <h4 className="text-xs font-semibold text-amber-300">{group}</h4>
        {definitions.map((definition) => {
          const item = values[definition.key];
          const update = (next: unknown) => onChange({ ...values, [definition.key]: next });
          return <div className="rounded-md border border-border/60 bg-background/30 p-3" key={definition.key}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="break-words text-xs font-semibold">{runTemplateLabel(definition.key)}</p>
              <button type="button" className="button-secondary min-h-8 px-2 py-1" aria-label={`Remove ${runTemplateLabel(definition.key)}`} disabled={disabled}
                onClick={() => onChange(Object.fromEntries(Object.entries(values).filter(([key]) => key !== definition.key)))}>Remove field</button>
            </div>
            {definition.kind === "number" ? numberInput(item, update, { disabled })
              : definition.kind === "boolean" ? selectInput(String(item), ["false", "true"], (next) => update(next === "true"), disabled)
                : definition.kind === "recipe" ? <RecipeRowsEditor value={item} onChange={update} disabled={disabled} />
                  : textInput(item, update, { disabled })}
          </div>;
        })}
      </section>;
    })}
    <div className="flex flex-col gap-2 sm:flex-row">
      <select className="field" aria-label="Guide field to add" value={newField} disabled={disabled || available.length === 0}
        onChange={(event) => setNewField(event.target.value)}>
        <option value="">Choose a guide field</option>
        {groups.map((group) => {
          const definitions = available.filter((item) => runTemplateGroup(item.key) === group);
          return definitions.length > 0 ? <optgroup label={group} key={group}>{definitions.map((item) => <option value={item.key} key={item.key}>{runTemplateLabel(item.key)}</option>)}</optgroup> : null;
        })}
      </select>
      <button type="button" className="button-secondary" disabled={disabled || !newField} onClick={addField}><Plus className="h-4 w-4" />Add guide field</button>
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
        <div className="flex flex-wrap gap-5">{checkbox("Enabled", data.enabled, (enabled) => setData({ enabled }), disabled)}</div>
      </div>
      <div><p className="mb-2 text-xs font-medium">Categories</p><StringListEditor label="category" value={data.categories} disabled={disabled} onChange={(categories) => setData({ categories })} /></div>
      <AllergenEditor value={data.allergens} reviewed={data.allergensReviewed} disabled={disabled}
        onChange={(allergens) => setData({ allergens })} onReviewedChange={(allergensReviewed) => setData({ allergensReviewed })} />
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
  const [query, setQuery] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const records = useMemo(() => catalogs[family], [catalogs, family]);
  const visibleRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    return (records ?? []).filter((record) => {
      if (normalized && !`${record.code} ${record.name} ${JSON.stringify(record.data)}`.toLocaleLowerCase("en-US").includes(normalized)) return false;
      if (family === "ingredients" && needsReviewOnly) {
        const allergens = Array.isArray(record.data.allergens) ? record.data.allergens : [];
        return record.data.allergensReviewed !== true
          || allergens.some((item) => typeof item !== "string" || !setupAllergenOptions.includes(item));
      }
      return true;
    });
  }, [records, query, family, needsReviewOnly]);
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
    setQuery("");
    setNeedsReviewOnly(false);
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
    {records && records.length > 0 ? <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border/60 bg-background/30 p-3 sm:flex-row sm:items-end">
      <label className="block min-w-0 flex-1 text-xs font-medium">Search setup records
        <input className="field mt-1.5 w-full" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={family === "manager-lists" ? "Directory, recipe, brand, or ingredient" : "Code, name, or value"} />
      </label>
      {family === "ingredients" ? <div className="min-h-10">{checkbox("Allergen review needed only", needsReviewOnly, setNeedsReviewOnly)}</div> : null}
    </div> : null}
    {records && records.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No canonical {FAMILY_LABELS[family].toLocaleLowerCase("en-US")} records exist.</p> : null}
    {records && records.length > 0 && visibleRecords.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No setup records match the current search and review filter.</p> : null}
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {visibleRecords.map((record) => <article className="rounded-lg border border-border/70 bg-background/40 p-4" key={record.code}>
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

function MasterRecordForm({ kind, initial, products, disabled, onStage, onCancel }: {
  kind: SetupMasterKind;
  initial: SetupMasterRecord;
  products: InventoryProduct[];
  disabled: boolean;
  onStage: (request: SetupMasterEditRequest) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SetupMasterRecord>(() => JSON.parse(JSON.stringify({
    code: initial.code, name: initial.name, productCode: initial.productCode, data: initial.data,
  })) as SetupMasterRecord);
  const [expectedFingerprint] = useState((initial as SetupMasterListedRecord).fingerprint ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = expectedFingerprint !== null;
  const data = draft.data;
  const setData = (patch: RecordData) => setDraft((current) => ({ ...current, data: { ...current.data, ...patch } }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || saving) return;
    setSaving(true);
    setError(null);
    try {
      const record = parseSetupMasterRecord(kind, draft);
      const staged = await onStage({ requestId: crypto.randomUUID(), kind, record, expectedFingerprint });
      if (staged) onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review the typed capacity values and try again.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="mt-5 space-y-5 border-t border-border/70 pt-5" onSubmit={(event) => void submit(event)}>
    <div>
      <p className="eyebrow">{editing ? "Edit canonical product record" : "Create canonical product record"}</p>
      <h3 className="mt-1 text-base font-semibold">{MASTER_KIND_LABELS[kind]}</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Saving stages one typed change with the current server fingerprint. It changes no product capacity until you review and Apply it separately.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      {field("Code", textInput(draft.code, (code) => setDraft((current) => ({ ...current, code })), { disabled: disabled || editing, required: true }),
        editing ? "Identity is immutable; create a separate record for a different code." : undefined)}
      {field("Name", textInput(draft.name, (name) => setDraft((current) => ({ ...current, name })), { disabled, required: true }))}
      <label className="block min-w-0 text-xs font-medium">Product
        <select className="field mt-1.5 w-full" value={draft.productCode} disabled={disabled || editing} required
          onChange={(event) => setDraft((current) => ({ ...current, productCode: event.target.value }))}>
          <option value="">Choose a product</option>
          {products.map((product) => <option value={product.code} key={product.id}>{product.code} — {product.name}{product.active ? "" : " (inactive)"}</option>)}
        </select>
        <span className="mt-1 block font-normal leading-5 text-muted-foreground">The stable product link is preserved on edit.</span>
      </label>
      {kind === "recipes" ? <>
        {field("Doughball yield", numberInput(data.doughballYield, (doughballYield) => setData({ doughballYield }), { disabled, required: true }))}
        {field("Doughball weight oz (optional)", numberInput(data.doughballWeightOz, (doughballWeightOz) => setData({ doughballWeightOz }), { disabled }))}
        {field("Doughballs per tray (optional)", numberInput(data.doughballsPerTray, (doughballsPerTray) => setData({ doughballsPerTray }), { disabled, integer: true }))}
      </> : field("Pizzas per shipping case", numberInput(data.pizzasPerCase, (pizzasPerCase) => setData({ pizzasPerCase }), { disabled, required: true, integer: true }))}
    </div>
    <div className="rounded-lg border border-border/60 bg-background/30 p-4 text-xs leading-5 text-muted-foreground">
      <p className="font-semibold text-foreground">Source provenance preserved</p>
      <p className="mt-1">{String(data.sourceFamily)}{data.fileName ? ` · ${String(data.fileName)}` : " · manual typed record"}{data.fileSha256 ? ` · SHA-256 ${String(data.fileSha256).slice(0, 12)}…` : ""}</p>
      <p className="mt-1">Typed edits retain the existing source metadata. No workbook provenance is fabricated for manual records.</p>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
      <button type="submit" className="button-primary" disabled={disabled || saving}>{saving ? "Staging…" : "Stage capacity edit"}</button>
      <button type="button" className="button-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export function MasterRecordEditor({ online, disabled, onStage }: MasterEditorProps) {
  const [kind, setKind] = useState<SetupMasterKind>("recipes");
  const [records, setRecords] = useState<Partial<Record<SetupMasterKind, SetupMasterListedRecord[]>>>({});
  const [cursors, setCursors] = useState<Partial<Record<SetupMasterKind, string | null>>>({});
  const [products, setProducts] = useState<InventoryProduct[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<SetupMasterRecord | null>(null);
  const [query, setQuery] = useState("");
  const currentRecords = records[kind];
  const nextCursor = cursors[kind];
  const visibleRecords = (currentRecords ?? []).filter((record) => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    return !normalized || `${record.code} ${record.name} ${record.productCode}`.toLocaleLowerCase("en-US").includes(normalized);
  });

  async function load(append = false) {
    if (!online) return;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const [page, nextProducts] = await Promise.all([
        listSetupMasterRecords(kind, append ? nextCursor ?? null : null),
        products ? Promise.resolve(products) : listInventoryProducts(),
      ]);
      setRecords((current) => ({ ...current, [kind]: append ? [...current[kind] ?? [], ...page.records] : page.records }));
      setCursors((current) => ({ ...current, [kind]: page.nextCursor }));
      setProducts(nextProducts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The product capacity records could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setEditor(null);
    setError(null);
    setQuery("");
    if (online) void load(false);
  }, [kind, online]);

  useEffect(() => {
    const reload = () => { if (online) void load(false); };
    window.addEventListener("fieldline:v3:setup-master-changed", reload);
    return () => window.removeEventListener("fieldline:v3:setup-master-changed", reload);
  }, [kind, online, nextCursor, products]);

  function changeKind(next: SetupMasterKind) {
    if (disabled) return;
    setKind(next);
  }

  return <section className="panel" aria-labelledby="typed-master-heading">
    <div className="panel-heading">
      <div><p className="eyebrow">Typed product setup</p><h2 id="typed-master-heading" className="mt-1 text-lg font-semibold">Dough yield and shipping capacity</h2></div>
      <span className="status-pill">{currentRecords?.length ?? 0} loaded</span>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Manage canonical master_records with typed fields and preserved provenance. Product dough and shipping reviews are independent of catalog imports and of each other.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block min-w-0 text-xs font-medium">Capacity record type
        <select className="field mt-1.5 w-full" value={kind} disabled={disabled || !online} onChange={(event) => changeKind(event.target.value as SetupMasterKind)}>
          {Object.entries(MASTER_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <button type="button" className="button-secondary" disabled={disabled || !online || loading} onClick={() => void load(false)}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh product records</button>
    </div>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" className="button-primary" disabled={disabled || !online || !products || products.length === 0}
        onClick={() => setEditor(emptySetupMasterRecord(kind, products?.find((product) => product.active)?.code ?? products?.[0]?.code ?? ""))}><Plus className="h-4 w-4" />Create capacity record</button>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {!online && !currentRecords ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Offline read-only view. Reconnect to load product setup; no writes are queued.</p> : null}
    {online && !currentRecords && loading ? <p className="mt-4 text-sm text-muted-foreground">Loading canonical product records…</p> : null}
    {products && products.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Import a product before creating dough or shipping capacity records.</p> : null}
    {currentRecords && currentRecords.length > 0 ? <label className="mt-4 block text-xs font-medium">Search capacity records
      <input className="field mt-1.5 w-full" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, name, or product" />
    </label> : null}
    {currentRecords && currentRecords.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No canonical {MASTER_KIND_LABELS[kind].toLocaleLowerCase("en-US")} records exist.</p> : null}
    {currentRecords && currentRecords.length > 0 && visibleRecords.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No product records match this search.</p> : null}
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {visibleRecords.map((record) => <article className="rounded-lg border border-border/70 bg-background/40 p-4" key={record.code}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{record.name}</h3><p className="mt-1 break-all font-mono text-xs text-amber-300">{record.code}</p><p className="mt-1 text-xs text-muted-foreground">Product {record.productCode}</p></div>
          <button type="button" className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={disabled || !online}
            onClick={() => setEditor(record)}><Pencil className="h-4 w-4" />Edit</button>
        </div>
      </article>)}
    </div>
    {nextCursor ? <button type="button" className="button-secondary mt-4 w-full" disabled={disabled || !online || loadingMore}
      onClick={() => void load(true)}>{loadingMore ? "Loading…" : "Load next 100 product records"}</button> : null}
    {editor ? <MasterRecordForm key={`${kind}:${editor.code}:${(editor as SetupMasterListedRecord).fingerprint ?? "new"}`} kind={kind} initial={editor} products={products ?? []}
      disabled={disabled || !online} onStage={onStage} onCancel={() => setEditor(null)} /> : null}
  </section>;
}
