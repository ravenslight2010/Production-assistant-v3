import { useEffect, useRef, useState, type FormEvent } from "react";
import { centralDate } from "../../../core/schedule-planning.mjs";
import { ApiError, createRun, type Run, type RunProduct } from "../api";

export function CreateRunForm({ products, online, onCreated }: {
  products: RunProduct[];
  online: boolean;
  onCreated: (run: Run) => void;
}) {
  const [label, setLabel] = useState("");
  const [productionDate, setProductionDate] = useState(() => centralDate());
  const [targetCases, setTargetCases] = useState("");
  const [productCode, setProductCode] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const product = products.find((item) => item.code === productCode);
  const setups = product?.productionSetups ?? [];

  useEffect(() => {
    if (setups.length === 0) setSetupCode("");
    else if (!setups.some((item) => item.code === setupCode)) setSetupCode(setups[0]!.code);
  }, [productCode, products]);

  function changed(setter: (value: string) => void, value: string) {
    requestId.current = null;
    setter(value);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!online) {
      setError("Reconnect before preparing a run. Offline mode is read-only.");
      return;
    }
    const cases = Number(targetCases);
    if (!product || !setupCode || !/^\d{4}-\d{2}-\d{2}$/u.test(productionDate)
      || !Number.isSafeInteger(cases) || cases < 1) {
      setError("Choose a production date, imported product, and production setup, and enter a whole-number case target.");
      return;
    }
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const run = await createRun({
        requestId: requestId.current,
        productionDate,
        label: label.trim(),
        targetCases: cases,
        productCode,
        productionSetupCode: setupCode,
      });
      requestId.current = null;
      setLabel("");
      setTargetCases("");
      onCreated(run);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The run could not be prepared. Retry with the same details when connected.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="create-run-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New production run</p>
          <h2 id="create-run-heading" className="text-lg font-semibold">Prepare from reviewed setup</h2>
        </div>
        <span className="font-mono text-xs text-muted-foreground">01</span>
      </div>
      {products.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">
          No imported products are available. A manager must complete reviewed product, recipe, production-setup, warehouse, and opening-count imports before a run can be prepared.
        </div>
      ) : (
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <label className="text-sm font-medium sm:col-span-2" htmlFor="run-label">Run label
            <input id="run-label" className="field mt-2" value={label} maxLength={120} autoComplete="off" onChange={(event) => changed(setLabel, event.target.value)} required />
          </label>
          <label className="text-sm font-medium" htmlFor="run-production-date">Production date
            <input id="run-production-date" className="field mt-2" type="date" value={productionDate} onChange={(event) => changed(setProductionDate, event.target.value)} required />
          </label>
          <label className="text-sm font-medium" htmlFor="target-cases">Target cases
            <input id="target-cases" className="field mt-2" type="number" inputMode="numeric" min={1} step={1} value={targetCases} onChange={(event) => changed(setTargetCases, event.target.value)} required />
          </label>
          <label className="text-sm font-medium sm:col-span-2" htmlFor="run-product">Imported product
            <select id="run-product" className="field mt-2" value={productCode} onChange={(event) => changed(setProductCode, event.target.value)} required>
              <option value="" disabled>Choose product</option>
              {products.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium sm:col-span-2" htmlFor="run-setup">Production setup
            <select id="run-setup" className="field mt-2" value={setupCode} onChange={(event) => changed(setSetupCode, event.target.value)} required>
              {setups.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">The server freezes the reviewed recipe, production warehouse, and immutable production date. Retrying a lost response uses the same request ID.</p>
          {error ? <p className="error-text sm:col-span-2" role="alert">{error}</p> : null}
          <button type="submit" className="button-primary sm:col-span-2" disabled={pending || !online}>{pending ? "Preparing on server…" : "Prepare run"}</button>
        </form>
      )}
    </section>
  );
}
