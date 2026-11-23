import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  applySubstitutionCommand,
  listSubstitutionProducts,
  type SubstitutionCommandRequest,
  type SubstitutionOverlay,
  type SubstitutionProduct,
  type SubstitutionRule,
} from "../api";

const emptyForm = { id: null as string | null, ingredient: "", action: "swap" as "swap" | "add" | "remove", substituteProductId: "", quantity: "" };

export function SubstitutionManager({ productionDate, overlay, online, onOverlay }: {
  productionDate: string;
  overlay: SubstitutionOverlay;
  online: boolean;
  onOverlay: (overlay: SubstitutionOverlay) => void;
}) {
  const [products, setProducts] = useState<SubstitutionProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [pendingRequest, setPendingRequest] = useState<SubstitutionCommandRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!online) {
      setProductsLoading(false);
      return () => { active = false; };
    }
    setProductsLoading(true);
    void listSubstitutionProducts().then((next) => {
      if (active) setProducts(next);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Substitution products could not be loaded.");
    }).finally(() => {
      if (active) setProductsLoading(false);
    });
    return () => { active = false; };
  }, [online, productionDate]);

  useEffect(() => {
    setForm(emptyForm);
    setPendingRequest(null);
    setError(null);
    setNotice(null);
  }, [productionDate]);

  function updateForm<Key extends keyof typeof emptyForm>(key: Key, value: (typeof emptyForm)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function editRule(rule: SubstitutionRule) {
    setPendingRequest(null);
    setForm({
      id: rule.id,
      ingredient: rule.ingredient,
      action: rule.action,
      substituteProductId: rule.substituteProductId ?? "",
      quantity: rule.quantity ?? "",
    });
    setError(null);
    setNotice(null);
  }

  async function send(request: SubstitutionCommandRequest) {
    if (!online || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await applySubstitutionCommand(request);
      onOverlay(result.overlay);
      setPendingRequest(null);
      if (result.conflict) {
        setError("Another manager changed this date. The latest overlay is loaded; this change was not saved. Review and submit it again if still wanted.");
      } else {
        setForm(emptyForm);
        setNotice(result.replayed ? "The previous substitution save was confirmed by exact retry." : "Temporary substitution change saved to the server.");
      }
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) setPendingRequest(null);
      setError(cause instanceof ApiError ? cause.message : "The change was not confirmed. Retry the same request when connected.");
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!online || saving) return;
    if (pendingRequest) {
      void send(pendingRequest);
      return;
    }
    const ingredient = form.ingredient.trim();
    if (!ingredient || (form.action !== "remove" && !form.substituteProductId)
      || (form.action === "add" && !form.quantity)) {
      setError("Enter an ingredient and the fields required for the selected action.");
      return;
    }
    const request: SubstitutionCommandRequest = {
      requestId: crypto.randomUUID(),
      date: productionDate,
      expectedRevision: overlay.revision,
      command: {
        type: "upsert",
        rule: {
          id: form.id,
          ingredient,
          action: form.action,
          substituteProductId: form.action === "remove" ? null : form.substituteProductId,
          quantity: form.action === "remove" || form.quantity === "" ? null : form.quantity,
        },
      },
    };
    setPendingRequest(request);
    void send(request);
  }

  function command(request: SubstitutionCommandRequest) {
    if (!online || saving) return;
    setPendingRequest(request);
    void send(request);
  }

  const disabled = !online || saving || pendingRequest !== null;
  return (
    <section className="panel" aria-labelledby="substitutions-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Temporary substitutions · {productionDate}</p>
          <h2 id="substitutions-heading" className="text-lg font-semibold">Dated ingredient overlay</h2>
        </div>
        <span className="status-pill">Revision {overlay.revision}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Applies to planned, running, and paused runs for this date only. Completed runs retain their completion overlay; master recipes and setup snapshots never change.
      </p>
      {error ? <p className="error-text mt-3" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-emerald-300" role="status">{notice}</p> : null}
      {pendingRequest ? (
        <div className="notice-banner mt-3" role="status">
          <span>A substitution save is unresolved. No offline write is queued.</span>
          <button type="button" className="button-secondary ml-auto" disabled={!online || saving} onClick={() => void send(pendingRequest)}>
            {saving ? "Confirming…" : "Retry same request"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-medium" htmlFor="substitution-ingredient">Original ingredient name
            <input id="substitution-ingredient" className="field mt-1.5" value={form.ingredient} maxLength={120} disabled={disabled}
              onChange={(event) => updateForm("ingredient", event.target.value)} required />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium" htmlFor="substitution-action">Action
              <select id="substitution-action" className="field mt-1.5" value={form.action} disabled={disabled}
                onChange={(event) => updateForm("action", event.target.value as typeof form.action)}>
                <option value="swap">Swap</option><option value="add">Add</option><option value="remove">Remove</option>
              </select>
            </label>
            <label className="block text-xs font-medium" htmlFor="substitution-quantity">Quantity {form.action === "add" ? "(required)" : "(optional)"}
              <input id="substitution-quantity" className="field mt-1.5" type="number" min="0" step="any" inputMode="decimal"
                value={form.quantity} disabled={disabled || form.action === "remove"} onChange={(event) => updateForm("quantity", event.target.value)}
                required={form.action === "add"} />
            </label>
          </div>
          <label className="block text-xs font-medium" htmlFor="substitution-product">Substitute product
            <select id="substitution-product" className="field mt-1.5" value={form.substituteProductId}
              disabled={disabled || productsLoading || form.action === "remove"} onChange={(event) => updateForm("substituteProductId", event.target.value)}
              required={form.action !== "remove"}>
              <option value="">{productsLoading ? "Loading products…" : "Choose product"}</option>
              {products.map((product) => <option key={product.productId} value={product.productId}>{product.productName} · {product.productCode} · {product.baseUnit}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="button-primary" disabled={disabled || productsLoading}>
              {saving ? "Saving…" : pendingRequest ? "Retry same request" : form.id ? "Update rule" : "Save rule"}
            </button>
            {form.id ? <button type="button" className="button-secondary" disabled={disabled} onClick={() => setForm(emptyForm)}>Cancel edit</button> : null}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Swap without quantity preserves each matching row’s quantity and unit. Add keeps the original row and requires a quantity.</p>
        </form>

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Active rules ({overlay.rules.length}/100)</h3>
            <button type="button" className="button-secondary px-3" disabled={disabled || overlay.rules.length === 0}
              onClick={() => {
                if (!window.confirm("Clear every temporary substitution rule for this production date?")) return;
                command({ requestId: crypto.randomUUID(), date: productionDate, expectedRevision: overlay.revision, command: { type: "clear" } });
              }}>Clear all</button>
          </div>
          {overlay.rules.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">No temporary substitutions for this date.</p> : (
            <ul className="mt-3 space-y-2">
              {overlay.rules.map((rule) => (
                <li key={rule.id} className="rounded-lg border border-border/60 p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><strong>{rule.ingredient}</strong><span className="ml-2 capitalize text-muted-foreground">{rule.action}</span>
                      {rule.action !== "remove" ? <p className="mt-1 text-muted-foreground">→ {rule.substituteProductName} {rule.quantity ? `· ${rule.quantity}` : "· original quantities"}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="underline" disabled={disabled} onClick={() => editRule(rule)}>Edit</button>
                      <button type="button" className="underline" disabled={disabled} onClick={() => command({
                        requestId: crypto.randomUUID(), date: productionDate, expectedRevision: overlay.revision,
                        command: { type: "remove", ruleId: rule.id },
                      })}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
