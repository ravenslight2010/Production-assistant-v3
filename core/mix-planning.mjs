export const MIX_WASTE_FACTOR = 0.15;
export const MIX_STARTUP_LBS = 20;
export const OUNCES_PER_POUND = 16;

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function finite(value, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonnegative(value) {
  return Math.max(0, finite(value));
}

export function isValidMixDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function mixDaysUntil(productionDate, makeDate) {
  if (!isValidMixDate(productionDate) || !isValidMixDate(makeDate)) return Number.NaN;
  return Math.round((Date.parse(`${productionDate}T00:00:00Z`) - Date.parse(`${makeDate}T00:00:00Z`)) / 86_400_000);
}

export function mixPizzasForRun({ cases, pizzasPerCase, casesPerLayer }) {
  const target = nonnegative(cases);
  const perCase = nonnegative(pizzasPerCase);
  const startupCases = nonnegative(casesPerLayer);
  if (target <= 0 || perCase <= 0) return null;
  return target * perCase + startupCases * perCase;
}

export function ingredientNamesMatch(left, right) {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (!longer.startsWith(shorter)) return false;
  return [" ", "-", ",", "(", "/"].includes(longer[shorter.length]);
}

export function findRunIngredient(run, component) {
  const ingredients = Array.isArray(run?.ingredients) ? run.ingredients : [];
  if (component.ingredientProductId) {
    const exact = ingredients.find((ingredient) => ingredient.productId === component.ingredientProductId);
    if (exact) return exact;
  }
  return ingredients.find((ingredient) => ingredientNamesMatch(ingredient.name, component.ingredientName));
}

function blankFinalization(entry, actualMadeLbs) {
  const actual = nonnegative(actualMadeLbs);
  const freshLbs = actual > 0 ? actual : entry.remainingLbs;
  const scale = entry.totalLbs > 0 ? freshLbs / entry.totalLbs : 0;
  return {
    actualMadeLbs: actual,
    freshLbs,
    surplusLbs: Math.max(0, actual - entry.remainingLbs),
    consumption: entry.components.map((component) => ({
      ingredientProductId: component.ingredientProductId,
      ingredientName: component.ingredientName,
      quantityLbs: component.plannedLbs * scale,
    })),
  };
}

export function finalizeMixEntry(entry, actualMadeLbs) {
  if (!entry || !Array.isArray(entry.components)) throw new TypeError("A calculated Mix Plan entry is required.");
  return blankFinalization(entry, actualMadeLbs);
}

function operationFor(operations, productionDate, mix, productId) {
  return operations.find((operation) => operation.productionDate === productionDate
    && operation.mixId === mix.id
    && (operation.productId ?? null) === (mix.kind === "product" ? productId : null));
}

function allocationFor(allocations, productionDate, mix, productId) {
  return allocations.filter((allocation) => allocation.targetDate === productionDate
    && allocation.mixId === mix.id
    && (allocation.productId ?? null) === (mix.kind === "product" ? productId : null)
    && allocation.voided !== true)
    .reduce((sum, allocation) => sum + nonnegative(allocation.quantityLbs), 0);
}

function makeEntry({ productionDate, makeDate, mix, productId, productName, contributions, operation, allocatedSurplusLbs }) {
  const components = mix.components.map((component) => {
    const matching = contributions.map((run) => {
      const ingredient = mix.kind === "prep" ? findRunIngredient(run, component) : undefined;
      if (mix.kind === "prep" && !ingredient) return { run, ounces: null, amountMissing: true };
      const amountMissing = mix.kind === "prep"
        && (ingredient?.ouncesPerPizza === null || ingredient?.ouncesPerPizza === undefined);
      const rawOunces = mix.kind === "prep" && !amountMissing
        ? ingredient.ouncesPerPizza
        : component.ouncesPerPizza;
      return { run, ounces: rawOunces === null || rawOunces === undefined ? null : nonnegative(rawOunces), amountMissing };
    });
    const plannedLbs = matching.reduce((sum, item) => sum + (item.ounces ?? 0) * item.run.pizzas / OUNCES_PER_POUND, 0);
    return {
      ingredientProductId: component.ingredientProductId,
      ingredientName: component.ingredientName,
      referencePoundsPerBatch: component.referencePoundsPerBatch ?? null,
      plannedLbs,
      missingRuns: matching.filter((item) => item.amountMissing || item.ounces === null || item.ounces <= 0).map((item) => item.run.key),
    };
  });
  const componentLbs = components.reduce((sum, component) => sum + component.plannedLbs, 0);
  const wasteLbs = componentLbs * MIX_WASTE_FACTOR;
  const totalLbs = componentLbs + wasteLbs + MIX_STARTUP_LBS;
  const manualAlreadyMadeLbs = nonnegative(operation?.alreadyMadeLbs);
  const alreadyMadeLbs = manualAlreadyMadeLbs + nonnegative(allocatedSurplusLbs);
  const remainingLbs = Math.max(0, totalLbs - alreadyMadeLbs);
  const batchSizeLbs = nonnegative(mix.batchSizeLbs);
  const warnings = [];
  if (batchSizeLbs <= 0) warnings.push("Batch size is zero; no batch count is available.");
  for (const component of components) {
    if (component.missingRuns.length > 0) {
      warnings.push(`${component.ingredientName}: missing or zero ounces per pizza for ${component.missingRuns.join(", ")}.`);
    }
  }
  for (const run of contributions) {
    warnings.push(...(run.warnings ?? []).map((warning) => `${run.key}: ${warning}`));
  }
  const entry = {
    key: `${productionDate}:${mix.id}:${mix.kind === "product" ? productId : "prep"}`,
    productionDate,
    daysUntil: mixDaysUntil(productionDate, makeDate),
    mixId: mix.id,
    kind: mix.kind,
    productId: mix.kind === "product" ? productId : null,
    productName: mix.kind === "product" ? productName : null,
    name: mix.name,
    notes: mix.notes ?? "",
    batchSizeLbs,
    daysEarly: mix.daysEarly,
    componentLbs,
    wasteLbs,
    startupLbs: MIX_STARTUP_LBS,
    totalLbs,
    manualAlreadyMadeLbs,
    allocatedSurplusLbs: nonnegative(allocatedSurplusLbs),
    alreadyMadeLbs,
    remainingLbs,
    batches: batchSizeLbs > 0 ? remainingLbs / batchSizeLbs : null,
    actualMadeLbs: nonnegative(operation?.actualMadeLbs),
    components: components.map((component) => ({
      ...component,
      pullLbs: totalLbs > 0 ? component.plannedLbs * remainingLbs / totalLbs : 0,
    })),
    contributions: contributions.map((run) => ({
      key: run.key,
      runId: run.runId ?? null,
      scheduleRunId: run.scheduleRunId ?? null,
      source: run.source,
      label: run.label,
      productId: run.productId,
      productName: run.productName,
      cases: run.cases,
      pizzas: run.pizzas,
      componentLbs: mix.components.reduce((sum, component) => {
        if (mix.kind === "product") return sum + nonnegative(component.ouncesPerPizza) * run.pizzas / OUNCES_PER_POUND;
        const ingredient = findRunIngredient(run, component);
        if (!ingredient) return sum;
        const ounces = ingredient.ouncesPerPizza ?? component.ouncesPerPizza;
        return sum + nonnegative(ounces) * run.pizzas / OUNCES_PER_POUND;
      }, 0),
    })),
    warnings: [...new Set(warnings)],
    finalized: false,
    finalization: null,
  };
  return entry;
}

export function buildMixPlan({ makeDate, runs, mixes, operations = [], surplusAllocations = [], finalizations = [] }) {
  if (!isValidMixDate(makeDate)) throw new TypeError("makeDate must be a real YYYY-MM-DD date.");
  const validRuns = runs.filter((run) => isValidMixDate(run.productionDate)
    && mixDaysUntil(run.productionDate, makeDate) >= 0
    && Number.isFinite(run.pizzas) && run.pizzas >= 0);
  const entries = [];
  for (const mix of mixes.filter((candidate) => candidate.enabled)) {
    for (const productionDate of [...new Set(validRuns.map((run) => run.productionDate))].sort()) {
      const daysUntil = mixDaysUntil(productionDate, makeDate);
      if (daysUntil > mix.daysEarly) continue;
      const dateRuns = validRuns.filter((run) => run.productionDate === productionDate);
      const productIds = mix.kind === "product" ? [mix.productId] : [null];
      for (const productId of productIds) {
        const contributions = dateRuns.filter((run) => {
          if (mix.kind === "product") return run.productId === mix.productId;
          return mix.components.some((component) => findRunIngredient(run, component));
        });
        if (contributions.length === 0) continue;
        const finalization = finalizations.find((candidate) => candidate.productionDate === productionDate
          && candidate.mixId === mix.id
          && (candidate.productId ?? null) === (mix.kind === "product" ? productId : null));
        const retainedKeys = new Set((finalization?.contributions ?? []).map((run) => run.key));
        const increment = finalization ? contributions.filter((run) => !retainedKeys.has(run.key)) : contributions;
        if (finalization?.entry) entries.push({ ...finalization.entry, finalized: true, finalization });
        if (increment.length === 0) continue;
        const operation = operationFor(operations, productionDate, mix, productId);
        const productName = increment[0]?.productName ?? null;
        entries.push(makeEntry({
          productionDate,
          makeDate,
          mix,
          productId,
          productName,
          contributions: increment,
          operation,
          allocatedSurplusLbs: allocationFor(surplusAllocations, productionDate, mix, productId),
        }));
      }
    }
  }
  const byDate = new Map();
  for (const entry of entries) {
    if (!byDate.has(entry.productionDate)) byDate.set(entry.productionDate, []);
    byDate.get(entry.productionDate).push(entry);
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([productionDate, dateEntries]) => ({
    productionDate,
    daysUntil: mixDaysUntil(productionDate, makeDate),
    entries: dateEntries.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key)),
  }));
}
