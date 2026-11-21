import { useEffect, useRef, useState, type FormEvent } from "react";
import { Boxes, Plus, RefreshCw, Warehouse as WarehouseIcon } from "lucide-react";
import {
  actOnOpeningCount,
  ApiError,
  createInventoryWarehouse,
  getOpeningCount,
  listInventoryMovements,
  listInventoryProducts,
  listInventoryWarehouses,
  listOpeningCounts,
  listWarehouseStock,
  setProductionWarehouse,
  stageOpeningCount,
  type AuthSession,
  type InventoryMovement,
  type InventoryProduct,
  type OpeningCountRecord,
  type OpeningCountRequest,
  type OpeningCountSummary,
  type StockItem,
  type Warehouse,
} from "../api";
import {
  clearPendingInventoryRequest,
  readPendingInventoryRequest,
  writePendingInventoryRequest,
  type PendingInventoryRequest,
} from "../components/inventory-storage";
import { OpeningCountPanel } from "../components/OpeningCountPanel";

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function InventoryPage({ session, online }: { session: AuthSession; online: boolean }) {
  const userId = session.staff.userId;
  const canManage = session.staff.capabilities.includes("manage-inventory");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [stock, setStock] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [nextCursor, setNextCursor] = useState<{ occurredAt: string; id: string } | null>(null);
  const [counts, setCounts] = useState<OpeningCountSummary[]>([]);
  const [currentCount, setCurrentCount] = useState<OpeningCountRecord | null>(null);
  const [pending, setPending] = useState<PendingInventoryRequest | null>(null);
  const [busy, setBusy] = useState<"load" | "write" | "movements" | null>(null);
  const [warehouseName, setWarehouseName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const loadGeneration = useRef(0);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null;
  const writeDisabled = !online || !canManage || busy !== null || pending !== null;

  async function loadCanonical(options: { warehouseId?: string; countId?: string; quiet?: boolean } = {}): Promise<boolean> {
    if (!online || !canManage) return false;
    const generation = ++loadGeneration.current;
    if (!options.quiet) {
      setBusy("load");
      setError(null);
    }
    try {
      const [nextWarehouses, nextProducts, nextCounts] = await Promise.all([
        listInventoryWarehouses(), listInventoryProducts(), listOpeningCounts(),
      ]);
      const requestedId = options.warehouseId ?? selectedWarehouseId;
      const nextWarehouseId = nextWarehouses.some((warehouse) => warehouse.id === requestedId)
        ? requestedId
        : nextWarehouses.find((warehouse) => warehouse.isProduction)?.id ?? nextWarehouses[0]?.id ?? "";
      const nextCountId = options.countId ?? currentCount?.id ?? null;
      const [nextStock, movementPage, nextCount] = await Promise.all([
        nextWarehouseId ? listWarehouseStock(nextWarehouseId) : Promise.resolve([]),
        nextWarehouseId ? listInventoryMovements(nextWarehouseId) : Promise.resolve({ movements: [], nextCursor: null }),
        nextCountId ? getOpeningCount(nextCountId) : Promise.resolve(null),
      ]);
      if (generation !== loadGeneration.current) return false;
      setWarehouses(nextWarehouses);
      setProducts(nextProducts);
      setCounts(nextCounts);
      setSelectedWarehouseId(nextWarehouseId);
      setStock(nextStock);
      setMovements(movementPage.movements);
      setNextCursor(movementPage.nextCursor);
      setCurrentCount(nextCount);
      setLoaded(true);
      return true;
    } catch (cause) {
      if (generation !== loadGeneration.current) return false;
      setError(message(cause, "Inventory could not be loaded. Reconnect and retry."));
      return false;
    } finally {
      if (generation === loadGeneration.current) setBusy(null);
    }
  }

  useEffect(() => {
    loadGeneration.current += 1;
    setPending(readPendingInventoryRequest(userId));
    setError(null);
    setNotice(null);
    setBusy(null);
    if (!canManage) {
      setWarehouses([]); setProducts([]); setStock([]); setMovements([]); setCounts([]); setCurrentCount(null); setLoaded(false);
      return;
    }
    if (online) void loadCanonical();
    else if (!loaded) setError("Offline read-only view. Reconnect to load inventory; no inventory writes are available.");
  }, [online, canManage, userId]);

  function persistPending(request: PendingInventoryRequest): boolean {
    try {
      writePendingInventoryRequest(userId, request);
      setPending(request);
      return true;
    } catch {
      setError("This device could not retain the pending inventory request. Nothing was sent; check browser storage and try again.");
      setNotice(null);
      return false;
    }
  }

  async function sendPending(request: PendingInventoryRequest): Promise<boolean> {
    if (!online || !canManage) return false;
    setBusy("write");
    setError(null);
    setNotice(null);
    try {
      let replayed = false;
      let warehouseId = selectedWarehouseId;
      let countId = currentCount?.id;
      let confirmation = "";
      if (request.kind === "warehouse-create") {
        const result = await createInventoryWarehouse(request.payload);
        replayed = result.replayed;
        warehouseId = result.warehouse.id;
        confirmation = "Warehouse created and available for inventory review.";
      } else if (request.kind === "production-warehouse") {
        const result = await setProductionWarehouse(request.payload);
        replayed = result.replayed;
        warehouseId = result.warehouse.id;
        confirmation = "Production warehouse selected for new runs. Existing runs retain their frozen warehouse.";
      } else if (request.kind === "opening-count") {
        const result = await stageOpeningCount(request.payload);
        replayed = result.replayed;
        warehouseId = result.warehouseId;
        countId = result.countId;
        confirmation = "Opening count staged. Review every stored quantity; no stock has changed.";
      } else {
        const action = request.kind === "opening-review" ? "review" : "apply";
        const result = await actOnOpeningCount(request.countId, action);
        replayed = result.replayed;
        warehouseId = result.warehouseId;
        countId = result.countId;
        confirmation = action === "review"
          ? "Opening count marked reviewed. It is ready for explicit Apply."
          : "Opening count applied to warehouse stock. Canonical history and quantities were reloaded.";
      }
      clearPendingInventoryRequest(userId);
      setPending(null);
      const reloaded = await loadCanonical({ warehouseId, countId: countId ?? undefined, quiet: true });
      setNotice(`${replayed ? `Previous request confirmed. ${confirmation}` : confirmation}${reloaded ? "" : " Canonical reload failed; refresh before further writes."}`);
      return true;
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) {
        clearPendingInventoryRequest(userId);
        setPending(null);
        if (status === 409) await loadCanonical({ quiet: true });
      }
      if (status === 401) setError("Your manager session expired. Sign in again; the same inventory request is retained for safe retry.");
      else if (status === 403) setError("Your session could not authorize this inventory action. Refresh your session; the same request is retained.");
      else if (status === 429 || status >= 500 || status === 0) {
        setError(`${message(cause, "The inventory request was not confirmed.")} Retry the same request; its identity prevents duplicate writes.`);
      } else setError(message(cause, "The inventory request was rejected. Refresh and correct the input before trying again."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = warehouseName.trim();
    if (!name || writeDisabled) return;
    const request: PendingInventoryRequest = { kind: "warehouse-create", payload: { requestId: crypto.randomUUID(), name } };
    if (!persistPending(request)) return;
    if (await sendPending(request)) setWarehouseName("");
  }

  async function selectProduction() {
    if (!selectedWarehouse || writeDisabled || !selectedWarehouse.active || !selectedWarehouse.openingCountApplied || selectedWarehouse.isProduction) return;
    const request: PendingInventoryRequest = {
      kind: "production-warehouse",
      payload: { requestId: crypto.randomUUID(), warehouseId: selectedWarehouse.id },
    };
    if (persistPending(request)) await sendPending(request);
  }

  async function loadOlderMovements() {
    if (!online || !canManage || !selectedWarehouseId || !nextCursor || busy) return;
    setBusy("movements");
    setError(null);
    try {
      const page = await listInventoryMovements(selectedWarehouseId, nextCursor);
      setMovements((current) => {
        const known = new Set(current.map((movement) => movement.id));
        return [...current, ...page.movements.filter((movement) => !known.has(movement.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(message(cause, "Older movements could not be loaded. Retry while connected."));
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return <div><div className="page-heading"><div><p className="eyebrow">Stock authority</p><h1>Inventory</h1><p>Manager-only physical inventory.</p></div></div><section className="panel mt-6 max-w-3xl" role="alert"><h2 className="text-lg font-semibold">Manager access required</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your account does not have the manage-inventory capability required to read or change warehouse inventory.</p></section></div>;
  }

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Stock authority · server reviewed</p><h1>Inventory</h1><p>Warehouses, confirmed stock, append-only movement history, and reviewed physical opening counts.</p></div>
        <button type="button" className="button-secondary" disabled={!online || busy !== null} onClick={() => void loadCanonical()}><RefreshCw className={`h-4 w-4 ${busy === "load" ? "animate-spin" : ""}`} />Refresh inventory</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" role="status"><span className="status-pill">{online ? "Connected" : "Read-only offline"}</span><span>{online ? "Canonical facility inventory · manage-inventory" : "Loaded values only · no file retained or writes queued"}</span></div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}<button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
      {pending ? <div className="notice-banner" role="status"><span>An inventory response is unresolved. Other inventory writes are paused until the exact request succeeds or is rejected.</span><button type="button" className="button-secondary ml-auto" disabled={!online || busy !== null} onClick={() => void sendPending(pending)}>Retry the same inventory request</button></div> : null}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <section className="panel min-w-0" aria-labelledby="warehouse-stock-heading">
          <div className="panel-heading"><div><p className="eyebrow">Warehouse stock</p><h2 id="warehouse-stock-heading" className="mt-1 text-lg font-semibold">Confirmed quantities</h2></div><Boxes className="h-5 w-5 text-amber-300" aria-hidden="true" /></div>
          <label className="mt-5 block text-xs font-medium" htmlFor="inventory-warehouse">Warehouse
            <select id="inventory-warehouse" className="field mt-1.5" value={selectedWarehouseId} disabled={!online || busy !== null || warehouses.length === 0} onChange={(event) => void loadCanonical({ warehouseId: event.target.value })}>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.isProduction ? " · Production" : ""}{warehouse.active ? "" : " · Inactive"}</option>)}
            </select>
          </label>
          {selectedWarehouse ? <div className="mt-4 rounded-lg border border-border/70 bg-background/40 p-4 text-xs text-muted-foreground"><span className="status-pill">{selectedWarehouse.active ? "Active" : "Inactive"}</span><span className="ml-2 status-pill">{selectedWarehouse.openingCountApplied ? "Opening count applied" : "Opening count required"}</span><p className="mt-3">{selectedWarehouse.isProduction ? "Used for new production runs. Existing runs keep their original warehouse snapshot." : "Apply a physical opening count before selecting this warehouse for new runs."}</p><button type="button" className="button-secondary mt-4" disabled={writeDisabled || !selectedWarehouse.active || !selectedWarehouse.openingCountApplied || selectedWarehouse.isProduction} onClick={() => void selectProduction()}><WarehouseIcon className="h-4 w-4" />Use selected warehouse for new runs</button></div> : null}
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2 pr-4">Product</th><th className="py-2 pr-4">Code</th><th className="py-2 pr-4 text-right">On hand</th><th className="py-2 text-right">Revision</th></tr></thead><tbody>{stock.map((item) => <tr key={item.productId} className="border-b border-border/50 last:border-0"><td className="py-3 pr-4">{item.name}<span className="block text-xs text-muted-foreground">{item.unit}</span></td><td className="py-3 pr-4 font-mono text-xs text-amber-300">{item.code}</td><td className="py-3 pr-4 text-right font-mono">{item.quantity}</td><td className="py-3 text-right font-mono text-xs text-muted-foreground">{item.revision}</td></tr>)}</tbody></table>{stock.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{selectedWarehouse ? "No confirmed stock rows for this warehouse. Review and apply its opening count." : "Create a warehouse to begin physical inventory."}</p> : null}</div>
          <form className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-end" onSubmit={(event) => void createWarehouse(event)}>
            <label className="flex-1 text-xs font-medium" htmlFor="new-warehouse-name">New warehouse name<input id="new-warehouse-name" className="field mt-1.5" value={warehouseName} maxLength={120} required disabled={writeDisabled} onChange={(event) => setWarehouseName(event.target.value)} /></label>
            <button type="submit" className="button-secondary" disabled={writeDisabled || !warehouseName.trim()}><Plus className="h-4 w-4" />Create warehouse</button>
          </form>
        </section>

        <section className="panel min-w-0" aria-labelledby="movement-history-heading">
          <div className="panel-heading"><div><p className="eyebrow">Append-only ledger</p><h2 id="movement-history-heading" className="mt-1 text-lg font-semibold">Movement history</h2></div><span className="status-pill">Latest {movements.length}</span></div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Receipts, adjustments, transfers, opening counts, and run consumption remain server-attributed. This wave provides canonical readback.</p>
          <div className="mt-5 space-y-3">{movements.map((movement) => <article key={movement.id} className="rounded-lg border border-border/70 bg-background/40 p-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{movement.productName}</h3><p className="mt-1 font-mono text-xs text-amber-300">{movement.productCode}</p></div><span className="font-mono text-sm">{movement.quantityDelta} {movement.unit}</span></div><p className="mt-2 text-xs text-muted-foreground">{movement.type} · {new Date(movement.occurredAt).toLocaleString()}</p><p className="mt-2 text-xs leading-5">{movement.reason}</p></article>)}{movements.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No movement history for the selected warehouse.</p> : null}</div>
          {nextCursor ? <button type="button" className="button-secondary mt-4 w-full" disabled={!online || busy !== null} onClick={() => void loadOlderMovements()}>{busy === "movements" ? "Loading…" : "Load older movements"}</button> : null}
        </section>
      </div>

      <div className="mt-5"><OpeningCountPanel online={online} disabled={writeDisabled} pending={pending} warehouse={selectedWarehouse} products={products} currentCount={currentCount} counts={counts} onStage={async (request: OpeningCountRequest) => {
        if (writeDisabled) return false;
        const pendingRequest: PendingInventoryRequest = { kind: "opening-count", payload: request };
        return persistPending(pendingRequest) && sendPending(pendingRequest);
      }} onAction={(countId, action) => {
        if (writeDisabled) return;
        const request: PendingInventoryRequest = { kind: action === "review" ? "opening-review" : "opening-apply", countId };
        if (persistPending(request)) void sendPending(request);
      }} onReopen={(countId) => { if (online && !busy) void loadCanonical({ countId }); }} /></div>
    </div>
  );
}
