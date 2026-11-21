import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ApiError, listRunProducts, listRuns, type Run, type RunProduct } from "../api";
import { CreateRunForm } from "../components/CreateRunForm";
import { RunDetail } from "../components/RunDetail";

export function RunPage({ online }: { online: boolean }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [products, setProducts] = useState<RunProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastConfirmed, setLastConfirmed] = useState<Date | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!online) {
      setError("Offline: showing only the last state confirmed during this session. Writes are disabled.");
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const [nextRuns, nextProducts] = await Promise.all([listRuns(), listRunProducts()]);
      setRuns(nextRuns);
      setProducts(nextProducts);
      setSelectedId((current) => nextRuns.some((run) => run.id === current)
        ? current
        : nextRuns.find((run) => run.status !== "completed")?.id ?? nextRuns[0]?.id ?? null);
      setLastConfirmed(new Date());
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not refresh production state. Retry when connected.");
    } finally {
      setLoading(false);
    }
  }, [online]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  function updated(run: Run, message?: string) {
    setRuns((current) => current.some((item) => item.id === run.id)
      ? current.map((item) => item.id === run.id ? run : item)
      : [run, ...current]);
    setSelectedId(run.id);
    setLastConfirmed(new Date());
    setNotice(message ?? "Server state updated.");
    setError(null);
  }

  const selected = runs.find((run) => run.id === selectedId) ?? null;

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Live operations · V3</p>
          <h1>Run control</h1>
          <p>One shared production state. Every visible change is confirmed by the server.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-right text-xs text-muted-foreground sm:block">Last confirmed<br /><strong className="font-medium text-foreground">{lastConfirmed ? lastConfirmed.toLocaleTimeString() : "Not yet"}</strong></span>
          <button type="button" className="button-secondary px-3" onClick={() => void refresh()} disabled={!online || loading} aria-label="Refresh server state">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
          </button>
        </div>
      </div>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}<button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>Dismiss</button></div> : null}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,1fr)]">
        <div className="min-w-0">
          {runs.length > 1 ? (
            <label className="mb-3 block text-xs font-medium text-muted-foreground" htmlFor="run-selector">Visible run
              <select id="run-selector" className="field mt-1.5" value={selectedId ?? ""} onChange={(event) => { setSelectedId(event.target.value); setNotice(null); }}>
                {runs.map((run) => <option key={run.id} value={run.id}>{run.setupSnapshot.label} · {run.status}</option>)}
              </select>
            </label>
          ) : null}
          {selected ? <RunDetail run={selected} online={online} onUpdated={updated} /> : (
            <section className="panel">
              <p className="eyebrow">Current run</p>
              <h2 className="mt-2 text-xl font-semibold">{loading ? "Reading server state…" : "No production runs yet"}</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Prepare a run from reviewed setup. The server will assign its identity, snapshot, revision, station state, and audit trail.</p>
            </section>
          )}
        </div>
        <CreateRunForm products={products} online={online} onCreated={updated} />
      </div>
    </div>
  );
}
