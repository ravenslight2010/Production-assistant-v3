import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { PlannedScheduleRun, ScheduleCatalog } from "../api";
import { scheduleProduct, scheduleRunTitle } from "./schedule-utils";

interface ScheduleRunCardProps {
  run: PlannedScheduleRun;
  index: number;
  total: number;
  isNew: boolean;
  dirty: boolean;
  disabled: boolean;
  catalog: ScheduleCatalog;
  onChange: (run: PlannedScheduleRun) => void;
  onSave: () => void;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
}

export function ScheduleRunCard({
  run,
  index,
  total,
  isNew,
  dirty,
  disabled,
  catalog,
  onChange,
  onSave,
  onMove,
  onRemove,
}: ScheduleRunCardProps) {
  const position = index + 1;
  const product = scheduleProduct(catalog, run.productCode);
  const setups = product?.productionSetups ?? [];
  const prefix = `schedule-run-${run.id}`;

  function update<K extends keyof PlannedScheduleRun>(key: K, value: PlannedScheduleRun[K]) {
    onChange({ ...run, [key]: value });
  }

  return (
    <article className="panel" aria-label={`${isNew ? "New planned run" : `Planned run ${position}`}`}>
      <div className="panel-heading">
        <div className="min-w-0">
          <p className="eyebrow">Order {position}</p>
          <h2 className="mt-1 text-lg font-semibold">{isNew ? "New planned run" : `Planned run ${position}`}</h2>
          {!isNew ? <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{scheduleRunTitle(run, catalog)}</p> : null}
        </div>
        <span className="status-pill">{run.targetCases > 0 ? `${run.targetCases} cases` : "Draft"}</span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium" htmlFor={`${prefix}-product`}>
          Product
          <select
            id={`${prefix}-product`}
            aria-label={`Product for ${isNew ? "new planned run" : `planned run ${position}`}`}
            className="field mt-1.5"
            value={run.productCode}
            disabled={disabled}
            onChange={(event) => {
              const productCode = event.target.value;
              const nextSetups = scheduleProduct(catalog, productCode)?.productionSetups ?? [];
              onChange({
                ...run,
                productCode,
                productionSetupCode: nextSetups.some((item) => item.code === run.productionSetupCode)
                  ? run.productionSetupCode
                  : "",
              });
            }}
          >
            <option value="">Choose product</option>
            {catalog.products.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
          </select>
        </label>

        <label className="text-xs font-medium" htmlFor={`${prefix}-setup`}>
          Production setup
          <select
            id={`${prefix}-setup`}
            aria-label={`Production setup for ${isNew ? "new planned run" : `planned run ${position}`}`}
            className="field mt-1.5"
            value={run.productionSetupCode}
            disabled={disabled || !run.productCode}
            onChange={(event) => update("productionSetupCode", event.target.value)}
          >
            <option value="">Choose production setup</option>
            {setups.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
          </select>
        </label>

        <label className="text-xs font-medium sm:col-span-2" htmlFor={`${prefix}-template`}>
          Run template
          <select
            id={`${prefix}-template`}
            aria-label={`Run template for ${isNew ? "new planned run" : `planned run ${position}`}`}
            className="field mt-1.5"
            value={run.runTemplateCode}
            disabled={disabled}
            onChange={(event) => update("runTemplateCode", event.target.value)}
          >
            <option value="">Choose run template</option>
            {catalog.templates.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}{item.brand || item.flavor ? ` · ${[item.brand, item.flavor].filter(Boolean).join(" ")}` : ""} ({item.code})
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium" htmlFor={`${prefix}-cases`}>
          Target cases
          <input
            id={`${prefix}-cases`}
            aria-label={`Target cases for ${isNew ? "new planned run" : `planned run ${position}`}`}
            className="field mt-1.5"
            type="number"
            min="1"
            max="1000000"
            step="1"
            required
            value={run.targetCases === 0 ? "" : run.targetCases}
            disabled={disabled}
            onChange={(event) => update("targetCases", event.target.value === "" ? 0 : Number(event.target.value))}
          />
        </label>

        <label className="text-xs font-medium sm:col-span-2" htmlFor={`${prefix}-notes`}>
          Notes
          <textarea
            id={`${prefix}-notes`}
            aria-label={`Notes for ${isNew ? "new planned run" : `planned run ${position}`}`}
            className="field mt-1.5 min-h-20 resize-y"
            maxLength={500}
            value={run.notes}
            disabled={disabled}
            onChange={(event) => update("notes", event.target.value)}
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-4">
        <button type="button" className="button-primary" disabled={disabled || !dirty} onClick={onSave}>
          {isNew ? "Add to plan" : `Save run ${position}`}
        </button>
        {!isNew ? (
          <>
            <button
              type="button"
              className="button-secondary px-3"
              aria-label={`Move planned run ${position} up`}
              disabled={disabled || dirty || index === 0}
              onClick={() => onMove(index - 1)}
            ><ChevronUp className="h-4 w-4" />Up</button>
            <button
              type="button"
              className="button-secondary px-3"
              aria-label={`Move planned run ${position} down`}
              disabled={disabled || dirty || index === total - 1}
              onClick={() => onMove(index + 1)}
            ><ChevronDown className="h-4 w-4" />Down</button>
          </>
        ) : null}
        <button type="button" className="button-secondary px-3 text-destructive" disabled={disabled} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />{isNew ? "Discard draft" : "Remove run"}
        </button>
      </div>
    </article>
  );
}
