import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { centralDate } from "../../../core/schedule-planning.mjs";
import {
  ApiError,
  applyMixPlanCommand,
  applyMixRecipeCommand,
  applyMixSurplusCommand,
  getMixPlan,
  getMixRecipeCatalog,
  getMixSurplus,
  type AuthSession,
  type MixPlan,
  type MixPlanCommand,
  type MixPlanEntry,
  type MixRecipeCatalog,
  type MixRecipeCommand,
  type MixSurplus,
  type MixSurplusCommand,
} from "../api";
import { MixPlanEntryCard } from "../components/MixPlanEntryCard";
import { MixRecipeManager } from "../components/MixRecipeManager";
import { MixSurplusManager } from "../components/MixSurplusManager";
import {
  clearPendingMixCommand,
  readMixPlanCache,
  readPendingMixCommand,
  writeMixPlanCache,
  writePendingMixCommand,
  type PendingMixCommand,
} from "../components/mix-plan-storage";

type Section = "plan" | "recipes" | "surplus";

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function MixPlanPage({ session, online }: { session: AuthSession; online: boolean }) {
  const userId = session.staff.userId;
  const canManage = session.staff.capabilities.includes("manage-inventory");
  const [makeDate, setMakeDate] = useState(() => centralDate());
  const [section, setSection] = useState<Section>("plan");
  const [plan, setPlan] = useState<MixPlan | null>(null);
  const [catalog, setCatalog] = useState<MixRecipeCatalog | null>(null);
  const [surplus, setSurplus] = useState<MixSurplus | null>(null);
  const [pending, setPending] = useState<PendingMixCommand | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastConfirmed, setLastConfirmed] = useState<string | null>(null);
  const generation = useRef(0);
  const writeLock = useRef(false);
  const writeDisabled = !online || !canManage || loading || saving || pending !== null || !plan;

  function applyCached(targetDate: string): boolean {
    const cached = readMixPlanCache(userId, targetDate);
    if (!cached) return false;
    setPlan(cached.plan);
    setCatalog(cached.catalog);
    setSurplus(cached.surplus);
    setLastConfirmed(cached.cachedAt);
    return true;
  }

  function cacheConfirmed(nextPlan: MixPlan, nextCatalog: MixRecipeCatalog | null, nextSurplus: MixSurplus | null): string | null {
    try {
      const cachedAt = writeMixPlanCache(userId, nextPlan, nextCatalog, nextSurplus);
      setLastConfirmed(cachedAt);
      return null;
    } catch {
      return "The server plan loaded, but this device could not retain its confirmed offline copy.";
    }
  }

  async function loadCanonical(targetDate = makeDate, quiet = false): Promise<boolean> {
    if (!online) return false;
    const requestGeneration = generation.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
      setNotice(null);
    }
    const cached = readMixPlanCache(userId, targetDate);
    const [planResult, catalogResult, surplusResult] = await Promise.allSettled([
      getMixPlan(targetDate),
      getMixRecipeCatalog(),
      getMixSurplus(),
    ]);
    if (requestGeneration !== generation.current) return false;

    if (planResult.status === "rejected") {
      const restored = applyCached(targetDate);
      if (!restored) setPlan(null);
      setError(restored
        ? `The server could not be reached. Showing the last confirmed read-only Mix Plan. ${message(planResult.reason, "")}`
        : `${message(planResult.reason, "The Mix Plan could not be loaded.")} No confirmed plan is cached for this make date.`);
      setLoading(false);
      return false;
    }

    const nextPlan = planResult.value;
    const nextCatalog = catalogResult.status === "fulfilled" ? catalogResult.value : catalog ?? cached?.catalog ?? null;
    const nextSurplus = surplusResult.status === "fulfilled" ? surplusResult.value : surplus ?? cached?.surplus ?? null;
    setPlan(nextPlan);
    setCatalog(nextCatalog);
    setSurplus(nextSurplus);
    const messages: string[] = [];
    if (catalogResult.status === "rejected") {
      messages.push(`The current plan loaded, but mix recipes could not be refreshed. ${nextCatalog ? "The last confirmed catalog is shown; recipe writes are paused until refresh." : "Recipe data is unavailable."} ${message(catalogResult.reason, "")}`);
    }
    if (surplusResult.status === "rejected") {
      messages.push(`The current plan loaded, but surplus could not be refreshed. ${nextSurplus ? "The last confirmed ledger is shown; surplus writes are paused until refresh." : "Surplus data is unavailable."} ${message(surplusResult.reason, "")}`);
    }
    const cacheWarning = cacheConfirmed(nextPlan, nextCatalog, nextSurplus);
    if (cacheWarning) messages.push(cacheWarning);
    setError(messages.length > 0 ? messages.join(" ") : null);
    if (!quiet) setNotice(`Server Mix Plan loaded for make date ${targetDate}.`);
    setLoading(false);
    return true;
  }

  useEffect(() => {
    generation.current += 1;
    setPlan(null);
    setPending(readPendingMixCommand(userId));
    setError(null);
    setNotice(null);
    setLastConfirmed(null);
    setSection("plan");
    if (!online) {
      const cached = applyCached(makeDate);
      setError(cached
        ? "Offline read-only view. Showing confirmed values retained on this device; no Mix Plan writes are queued."
        : "No confirmed Mix Plan is cached for this make date. Reconnect to load the server plan.");
      setLoading(false);
      return;
    }
    void loadCanonical(makeDate);
  }, [makeDate, online, userId]);

  function persistPending(request: PendingMixCommand): boolean {
    try {
      writePendingMixCommand(userId, request);
      setPending(request);
      return true;
    } catch {
      setError("This device could not retain the pending request. Nothing was sent; check browser storage and try again.");
      setNotice(null);
      return false;
    }
  }

  function resolvePending() {
    clearPendingMixCommand(userId);
    setPending(null);
  }

  async function sendPending(request: PendingMixCommand): Promise<boolean> {
    if (!online || !canManage || writeLock.current) return false;
    writeLock.current = true;
    setSaving(true);
    setError(null);
    setNotice("Confirming the Mix Plan change with the server…");
    const requestGeneration = generation.current;
    try {
      let replayed = false;
      let conflict = false;
      let conflictMessage = "";
      let confirmation = "";
      if (request.channel === "recipes") {
        const result = await applyMixRecipeCommand(request.request);
        replayed = result.replayed;
        conflict = result.conflict;
        setCatalog(result.catalog);
        conflictMessage = "Another manager changed this recipe. The latest confirmed catalog is loaded; this change was not saved. Review and submit it again if still wanted.";
        confirmation = request.request.command.type === "disable" ? "Mix recipe disabled." : "Mix recipe saved.";
      } else if (request.channel === "plan") {
        const result = await applyMixPlanCommand(request.request);
        replayed = result.replayed;
        conflict = result.conflict;
        conflictMessage = result.reason === "finalized"
          ? "This aggregate is finalized and read-only. The dated amounts were not changed; the retained completion basis remains authoritative."
          : "The dated amounts changed before this save. Review the latest confirmed plan before submitting again.";
        confirmation = "Dated Mix Plan amounts saved. The original plan and run-completion basis remain separate.";
      } else {
        const result = await applyMixSurplusCommand(request.request);
        replayed = result.replayed;
        conflict = result.conflict;
        setSurplus(result.surplus);
        conflictMessage = result.reason === "over_allocation"
          ? "The allocation exceeds the available dated-lot balance. The latest confirmed ledger is loaded; review the quantity and try again."
          : "The surplus ledger changed before this save. Review the latest confirmed balances before submitting again.";
        confirmation = request.request.command.type === "record" ? "Manual surplus lot recorded."
          : request.request.command.type === "allocate" ? "Dated surplus allocation saved." : "Surplus lot voided and allocations released.";
      }
      if (requestGeneration !== generation.current) return false;
      resolvePending();
      const reloaded = await loadCanonical(makeDate, true);
      if (conflict) {
        setNotice(null);
        setError(`${conflictMessage}${reloaded ? "" : " Canonical reload failed; refresh before further writes."}`);
        return false;
      }
      setError(reloaded ? null : "The change was confirmed, but the canonical view could not be reloaded. Refresh before further writes.");
      setNotice(`${replayed ? `Previous request confirmed by exact retry. ${confirmation}` : confirmation}${reloaded ? "" : " Refresh to reload the current view."}`);
      return true;
    } catch (cause) {
      if (requestGeneration !== generation.current) return false;
      const status = cause instanceof ApiError ? cause.status : 0;
      if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) {
        resolvePending();
        if (status === 409) await loadCanonical(makeDate, true);
      }
      setNotice(null);
      if (status === 401) setError("Your session expired. Sign in again; the same request is retained for safe retry.");
      else if (status === 403) setError("Your session could not authorize this change. Refresh your session; the same request is retained.");
      else if (status === 429 || status >= 500 || status === 0) {
        setError(`${message(cause, "The save was not confirmed.")} Retry the same request; its request ID prevents duplicate changes.`);
      } else setError(message(cause, "The Mix Plan change was rejected. Review the input and try again."));
      return false;
    } finally {
      if (requestGeneration === generation.current) {
        writeLock.current = false;
        setSaving(false);
      }
    }
  }

  function submitRecipe(command: MixRecipeCommand, expectedRevision: number): Promise<boolean> {
    if (writeDisabled || !catalog) return Promise.resolve(false);
    const request: PendingMixCommand = { channel: "recipes", request: { requestId: crypto.randomUUID(), expectedRevision, command } };
    return persistPending(request) ? sendPending(request) : Promise.resolve(false);
  }

  function saveAmount(entry: MixPlanEntry, alreadyMadeLbs: string, actualMadeLbs: string): Promise<boolean> {
    if (writeDisabled || entry.finalized) return Promise.resolve(false);
    const command: MixPlanCommand = {
      type: "set-amount", productionDate: entry.productionDate, mixId: entry.mixId,
      productId: entry.productId, alreadyMadeLbs, actualMadeLbs,
    };
    const request: PendingMixCommand = { channel: "plan", request: { requestId: crypto.randomUUID(), expectedRevision: entry.revision, command } };
    return persistPending(request) ? sendPending(request) : Promise.resolve(false);
  }

  function submitSurplus(command: MixSurplusCommand, expectedRevision: number): Promise<boolean> {
    if (writeDisabled || !surplus || !catalog) return Promise.resolve(false);
    const request: PendingMixCommand = { channel: "surplus", request: { requestId: crypto.randomUUID(), expectedRevision, command } };
    return persistPending(request) ? sendPending(request) : Promise.resolve(false);
  }

  const entries = plan?.groups.reduce((total, group) => total + group.entries.length, 0) ?? 0;

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Operational planning · server derived</p><h1>Mix Plan</h1><p>Confirmed schedule and live-run demand, V1-compatible mix calculations, dated amounts, and explicit surplus allocation.</p></div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="mix-make-date">Make date
            <input id="mix-make-date" className="field mt-1.5 w-44" type="date" value={makeDate} disabled={loading || saving || pending !== null} onChange={(event) => { if (event.target.value) setMakeDate(event.target.value); }} />
          </label>
          <button type="button" className="button-secondary px-3" disabled={!online || loading || saving} onClick={() => void loadCanonical(makeDate)}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" role="status">
        <span className="status-pill">{online ? "Connected" : "Read-only offline"}</span>
        <span>{canManage ? "Inventory-manager writes · all-staff reads" : "Staff read-only view"}</span>
        <span>{plan ? `${entries} plan ${entries === 1 ? "entry" : "entries"} · derived ${new Date(plan.derivedAt).toLocaleString()}` : loading ? "Loading the server plan…" : "No confirmed plan loaded"}</span>
        <span>Device confirmation: {lastConfirmed ? new Date(lastConfirmed).toLocaleString() : "not retained"}</span>
      </div>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}<button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
      {pending ? (
        <div className="notice-banner" role="status">
          <span>A {pending.channel} change is unresolved. Other writes are paused until its exact retry succeeds or the server rejects it. No offline write is queued.</span>
          <button type="button" className="button-secondary ml-auto" disabled={!online || saving || loading || !canManage} onClick={() => void sendPending(pending)}>{saving ? "Confirming…" : "Retry the same request"}</button>
        </div>
      ) : null}

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border/70" role="tablist" aria-label="Mix Plan sections">
        {([["plan", "Daily Mix Plan"], ["recipes", "Mix recipes"], ["surplus", "Surplus ledger"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={`nav-tab ${section === id ? "nav-tab-active" : ""}`} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      {section === "plan" ? (
        <div className="mt-5 space-y-6" role="tabpanel" aria-label="Daily Mix Plan">
          {plan?.groups.map((group) => (
            <section key={group.productionDate} aria-labelledby={`mix-date-${group.productionDate}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-border/60 pb-3">
                <div><p className="eyebrow">Production date</p><h2 id={`mix-date-${group.productionDate}`} className="mt-1 text-xl font-semibold">{group.productionDate}</h2></div>
                <span className="status-pill">{group.daysUntil === 0 ? "Make today" : `${group.daysUntil} ${group.daysUntil === 1 ? "day" : "days"} early`}</span>
              </div>
              <div className="space-y-4">{group.entries.map((entry) => <MixPlanEntryCard key={entry.key} entry={entry} disabled={writeDisabled} canManage={canManage} onSave={saveAmount} />)}</div>
            </section>
          ))}
          {plan && plan.groups.length === 0 ? <section className="panel"><h2 className="text-lg font-semibold">No mix demand in the approved date windows</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Confirmed scheduled runs and planned, running, or paused live runs will appear here when an enabled recipe includes their production date. Completed runs remain history and create no new forward demand.</p></section> : null}
          {!plan && loading ? <section className="panel"><p className="text-sm text-muted-foreground">Loading confirmed Mix Plan demand…</p></section> : null}
        </div>
      ) : null}

      {section === "recipes" ? (
        <div className="mt-5" role="tabpanel" aria-label="Mix recipes">
          {catalog ? <MixRecipeManager catalog={catalog} disabled={writeDisabled || catalog === null} canManage={canManage} onCommand={submitRecipe} /> : <section className="panel"><h2 className="text-lg font-semibold">Recipe catalog unavailable</h2><p className="mt-2 text-sm text-muted-foreground">Reconnect and refresh. No empty catalog has been substituted for confirmed server data.</p></section>}
        </div>
      ) : null}

      {section === "surplus" ? (
        <div className="mt-5" role="tabpanel" aria-label="Surplus ledger">
          {surplus && catalog ? <MixSurplusManager surplus={surplus} catalog={catalog} defaultDate={makeDate} disabled={writeDisabled || surplus === null || catalog === null} canManage={canManage} onCommand={submitSurplus} /> : <section className="panel"><h2 className="text-lg font-semibold">Surplus data unavailable</h2><p className="mt-2 text-sm text-muted-foreground">The confirmed surplus ledger and recipe identities are both required. Reconnect and refresh; no empty ledger has been fabricated.</p></section>}
        </div>
      ) : null}
    </div>
  );
}
