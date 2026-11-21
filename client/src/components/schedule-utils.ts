import type { PlannedScheduleRun, ScheduleCatalog } from "../api";

export function scheduleProduct(catalog: ScheduleCatalog, code: string) {
  return catalog.products.find((product) => product.code === code);
}

export function scheduleTemplate(catalog: ScheduleCatalog, code: string) {
  return catalog.templates.find((template) => template.code === code);
}

export function scheduleRunTitle(run: PlannedScheduleRun, catalog: ScheduleCatalog): string {
  const product = scheduleProduct(catalog, run.productCode);
  const setup = product?.productionSetups.find((item) => item.code === run.productionSetupCode);
  const template = scheduleTemplate(catalog, run.runTemplateCode);
  return `${product?.name ?? run.productCode} · ${setup?.name ?? run.productionSetupCode} · ${template?.name ?? run.runTemplateCode}`;
}

export function validateScheduleRun(
  run: PlannedScheduleRun,
  catalog: ScheduleCatalog,
): PlannedScheduleRun {
  const productCode = run.productCode;
  const productionSetupCode = run.productionSetupCode;
  const runTemplateCode = run.runTemplateCode;
  const targetCases = Number(run.targetCases);
  const notes = run.notes.trim();
  if (!productCode || !productionSetupCode || !runTemplateCode || !run.targetCases) {
    throw new Error("Choose a product, production setup, run template, and target cases.");
  }
  if (!Number.isSafeInteger(targetCases) || targetCases < 1 || targetCases > 1_000_000) {
    throw new Error("Target cases must be a whole number from 1 to 1,000,000.");
  }
  if (!scheduleProduct(catalog, productCode)?.productionSetups.some((item) => item.code === productionSetupCode)) {
    throw new Error("Choose a production setup for the selected product.");
  }
  if (!scheduleTemplate(catalog, runTemplateCode)) throw new Error("Choose an available run template.");
  if (notes.length > 500) throw new Error("Notes must be 500 characters or fewer.");
  return { id: run.id, productCode, productionSetupCode, runTemplateCode, targetCases, notes };
}

export function formatScheduleClock(epochMs: number | undefined): string {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(epochMs));
}

export function formatScheduleDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "Unknown duration";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${remaining} min`;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}
