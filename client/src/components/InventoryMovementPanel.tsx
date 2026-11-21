import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeftRight } from "lucide-react";
import type {
  InventoryMovementRequest,
  InventoryProduct,
  InventoryTransferRequest,
  Warehouse,
} from "../api";

type MovementMode = "receipt" | "adjustment" | "transfer";

export function InventoryMovementPanel({
  online,
  disabled,
  warehouse,
  warehouses,
  products,
  onMovement,
  onTransfer,
}: {
  online: boolean;
  disabled: boolean;
  warehouse: Warehouse | null;
  warehouses: Warehouse[];
  products: InventoryProduct[];
  onMovement: (request: InventoryMovementRequest) => Promise<boolean>;
  onTransfer: (request: InventoryTransferRequest) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<MovementMode>("receipt");
  const [productCode, setProductCode] = useState("");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const activeProducts = products.filter((product) => product.active);
  const targets = warehouses.filter((candidate) => candidate.id !== warehouse?.id
    && candidate.active && candidate.openingCountApplied);
  const sourceReady = Boolean(warehouse?.active && warehouse.openingCountApplied);
  const positive = mode !== "adjustment" || !quantity.startsWith("-");
  const controlsDisabled = disabled || !online || !sourceReady || activeProducts.length === 0
    || (mode === "transfer" && targets.length === 0);

  useEffect(() => {
    if (!targets.some((target) => target.id === targetWarehouseId)) {
      setTargetWarehouseId(targets[0]?.id ?? "");
    }
  }, [warehouse?.id, warehouses]);

  function changeMode(nextMode: MovementMode) {
    setMode(nextMode);
    setQuantity("");
    setReason("");
    setLotNumber("");
    setReceivedOn("");
    setExpiresOn("");
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (controlsDisabled || !warehouse || !productCode) return;
    if (!/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/u.test(quantity)
      || /^-?0(?:\.0{1,6})?$/u.test(quantity)
      || ((mode === "receipt" || mode === "transfer") && quantity.startsWith("-"))) {
      setError(mode === "adjustment"
        ? "Enter a nonzero positive or negative quantity with up to six decimal places."
        : "Enter a positive quantity with up to six decimal places.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Enter a reason from 3 to 500 characters.");
      return;
    }
    if (receivedOn && expiresOn && expiresOn < receivedOn) {
      setError("Expiration date cannot be before the received date.");
      return;
    }
    let confirmed: boolean;
    if (mode === "transfer") {
      if (!targetWarehouseId || targetWarehouseId === warehouse.id) {
        setError("Choose a different active warehouse with an applied opening count.");
        return;
      }
      confirmed = await onTransfer({
        commandId: crypto.randomUUID(),
        sourceWarehouseId: warehouse.id,
        targetWarehouseId,
        productCode,
        quantity,
        reason: reason.trim(),
      });
    } else {
      confirmed = await onMovement({
        commandId: crypto.randomUUID(),
        warehouseId: warehouse.id,
        productCode,
        type: mode,
        quantity,
        reason: reason.trim(),
        ...(positive && lotNumber.trim() ? { lotNumber: lotNumber.trim() } : {}),
        ...(positive && receivedOn ? { receivedOn } : {}),
        ...(positive && expiresOn ? { expiresOn } : {}),
      });
    }
    if (confirmed) {
      setProductCode("");
      setQuantity("");
      setReason("");
      setLotNumber("");
      setReceivedOn("");
      setExpiresOn("");
    }
  }

  return (
    <section className="panel" aria-labelledby="inventory-actions-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Coordinated stock and lots</p><h2 id="inventory-actions-heading" className="mt-1 text-lg font-semibold">Receipts, adjustments, and transfers</h2></div>
        <ArrowLeftRight className="h-5 w-5 text-amber-300" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Positive stock creates a coordinated lot. Negative adjustments consume earliest-expiring lots first. Transfers preserve lot identity and dates across warehouses.</p>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Inventory action">
        {(["receipt", "adjustment", "transfer"] as const).map((value) => (
          <button key={value} type="button" className={mode === value ? "button-primary" : "button-secondary"}
            aria-pressed={mode === value} disabled={disabled || !online} onClick={() => changeMode(value)}>
            {value === "receipt" ? "Receipt" : value === "adjustment" ? "Adjustment" : "Transfer"}
          </button>
        ))}
      </div>
      <form className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => void submit(event)}>
        <div className="rounded-lg border border-border/70 bg-background/40 p-4 text-sm md:col-span-2 xl:col-span-4">
          <span className="text-xs font-medium">{mode === "transfer" ? "Source warehouse" : "Stock warehouse"}</span>
          <p className="mt-1 font-semibold">{warehouse?.name ?? "Select a warehouse"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sourceReady ? "Active with an applied opening count" : "An active warehouse with an applied opening count is required"}</p>
        </div>
        {mode === "transfer" ? <label className="block text-xs font-medium md:col-span-2" htmlFor="transfer-target">Target warehouse
          <select id="transfer-target" className="field mt-1.5" required value={targetWarehouseId} disabled={controlsDisabled}
            onChange={(event) => setTargetWarehouseId(event.target.value)}>
            {targets.length === 0 ? <option value="">No eligible target warehouse</option> : null}
            {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
          </select>
        </label> : null}
        <label className="block text-xs font-medium" htmlFor="movement-product">Product
          <select id="movement-product" className="field mt-1.5" required value={productCode} disabled={controlsDisabled}
            onChange={(event) => setProductCode(event.target.value)}>
            <option value="">Select product</option>
            {activeProducts.map((product) => <option key={product.id} value={product.code}>{product.name} · {product.code}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium" htmlFor="movement-quantity">{mode === "adjustment" ? "Quantity (+/-)" : "Quantity"}
          <input id="movement-quantity" className="field mt-1.5" required inputMode="decimal" value={quantity}
            placeholder={mode === "adjustment" ? "10 or -2.5" : "10"} disabled={controlsDisabled}
            onChange={(event) => { setQuantity(event.target.value.trim()); setError(null); }} />
        </label>
        <label className="block text-xs font-medium md:col-span-2" htmlFor="movement-reason">Reason
          <input id="movement-reason" className="field mt-1.5" required minLength={3} maxLength={500} value={reason}
            disabled={controlsDisabled} onChange={(event) => setReason(event.target.value)} />
        </label>
        {mode !== "transfer" && positive ? <>
          <label className="block text-xs font-medium" htmlFor="movement-lot">Lot number <span className="font-normal text-muted-foreground">(optional)</span>
            <input id="movement-lot" className="field mt-1.5" maxLength={120} value={lotNumber} disabled={controlsDisabled}
              onChange={(event) => setLotNumber(event.target.value)} />
          </label>
          <label className="block text-xs font-medium" htmlFor="movement-received">Received date <span className="font-normal text-muted-foreground">(optional)</span>
            <input id="movement-received" className="field mt-1.5" type="date" value={receivedOn} disabled={controlsDisabled}
              onChange={(event) => setReceivedOn(event.target.value)} />
          </label>
          <label className="block text-xs font-medium" htmlFor="movement-expires">Expiration date <span className="font-normal text-muted-foreground">(optional)</span>
            <input id="movement-expires" className="field mt-1.5" type="date" min={receivedOn || undefined} value={expiresOn} disabled={controlsDisabled}
              onChange={(event) => setExpiresOn(event.target.value)} />
          </label>
        </> : null}
        {mode === "adjustment" && !positive ? <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-xs leading-5 text-muted-foreground md:col-span-2 xl:col-span-4">This negative adjustment will consume existing lots in earliest-expiration order. New lot metadata does not apply.</p> : null}
        {error ? <p className="error-banner md:col-span-2 xl:col-span-4" role="alert">{error}</p> : null}
        <div className="md:col-span-2 xl:col-span-4">
          <button type="submit" className="button-primary" disabled={controlsDisabled || !productCode || !quantity || reason.trim().length < 3}>
            {mode === "receipt" ? "Record receipt" : mode === "adjustment" ? "Record adjustment" : "Transfer stock"}
          </button>
        </div>
      </form>
    </section>
  );
}
