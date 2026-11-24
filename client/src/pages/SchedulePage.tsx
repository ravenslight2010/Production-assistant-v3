import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Plus, RefreshCw } from "lucide-react";
import { centralDate } from "../../../core/schedule-planning.mjs";
import {
  ApiError,
  applyOrUndoScheduleImport,
  applyProductionScheduleCommand,
  getProductionSchedule,
  getScheduleCatalog,
  listRuns,
  type AuthSession,
  type PlannedScheduleRun,
  type ProductionSchedule,
  type Run,
  type ScheduleBreak,
  type ScheduleCatalog,
  type ScheduleCommand,
  type ScheduleCommandRequest,
  type ScheduleImportActionRequest,
  type ScheduleImportActionResponse,
  type ScheduleImportDetail,
  type ScheduleImportStageRequest,
  stageScheduleImport,
} from "../api";
import { ScheduleImport } from "../components/ScheduleImport";
import { ScheduleRunCard } from "../components/ScheduleRunCard";
import { ScheduleTimeline } from "../components/ScheduleTimeline";
import { SubstitutionManager } from "../components/SubstitutionManager";
import { scheduleRunTitle, validateScheduleRun } from "../components/schedule-utils";
import {
  clearPendingScheduleCommand,
  clearPendingScheduleImport,
  readPendingScheduleCommand,
  readPendingScheduleImport,
  readScheduleCache,
  writePendingScheduleCommand,
  writePendingScheduleImport,
  writeScheduleCache,
  type PendingScheduleImportRequest,
} from "../components/schedule-storage";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function SchedulePage({ session, online }: { session: AuthSession; online: boolean }) {
  const userId = session.staff.userId;
  const canManage = session.staff.capabilities.includes("manage-factory-settings");
  const [date, setDate] = useState(() => centralDate());
  const [catalog, setCatalog] = useState<ScheduleCatalog | null>(null);
  const [schedule, setSchedule] = useState<ProductionSchedule | null>(null);
  const [liveRuns, setLiveRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PlannedScheduleRun>>({});
  const [newDraft, setNewDraft] = useState<PlannedScheduleRun | null>(null);
  const [breakDraft, setBreakDraft] = useState<ScheduleBreak[] | null>(null);
  const [pending, setPending] = useState<ScheduleCommandRequest | null>(null);
  const [importPending, setImportPending] = useState<PendingScheduleImportRequest | null>(null);
  const [importConfirmation, setImportConfirmation] = useState<ScheduleImportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastConfirmed, setLastConfirmed] = useState<string | null>(null);
  const [swapFirst, setSwapFirst] = useState("");
  const [swapSecond, setSwapSecond] = useState("");
  const generation = useRef(0);

  const isDirty = newDraft !== null
    || Object.entries(drafts).some(([id, draft]) => {
      const confirmed = schedule?.runs.find((run) => run.id === id);
      return confirmed !== undefined && JSON.stringify(confirmed) !== JSON.stringify(draft);
    })
    || (breakDraft !== null && schedule !== null && JSON.stringify(breakDraft) !== JSON.stringify(schedule.breaks));
  const writeDisabled = !online || !canManage || loading || saving || pending !== null || importPending !== null || !schedule || !catalog;

  function cacheConfirmed(next: ProductionSchedule, nextCatalog: ScheduleCatalog | null): string | null {
    try {
      writeScheduleCache(userId, next, nextCatalog);
      return null;
    } catch {
      return "The server plan loaded, but this device could not retain its read-only offline copy.";
    }
  }

  function applyCachedSchedule(targetDate: string): boolean {
    const cached = readScheduleCache(userId, targetDate);
    if (!cached) return false;
    setSchedule(cached.schedule);
    setCatalog(cached.catalog);
    setLiveRuns([]);
    setLastConfirmed(cached.cachedAt);
    return true;
  }

  async function loadCanonical(targetDate = date, quiet = false) {
    if (!online || !canManage) return;
    const requestGeneration = generation.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
      setNotice(null);
    }
    const [catalogResult, scheduleResult, liveResult] = await Promise.allSettled([
      catalog ? Promise.resolve(catalog) : getScheduleCatalog(),
      getProductionSchedule(targetDate),
      listRuns(100),
    ]);
    if (requestGeneration !== generation.current) return;

    if (scheduleResult.status === "rejected") {
      const cached = applyCachedSchedule(targetDate);
      if (!cached) setSchedule(null);
      setLiveRuns([]);
      setError(cached
        ? `The server could not be reached. Showing the last confirmed read-only plan. ${errorMessage(scheduleResult.reason, "")}`
        : `${errorMessage(scheduleResult.reason, "The schedule could not be loaded.")} No confirmed plan is cached for this date.`);
      setLoading(false);
      return;
    }

    const nextSchedule = scheduleResult.value;
    const nextCatalog = catalogResult.status === "fulfilled" ? catalogResult.value : null;
    setSchedule(nextSchedule);
    setDrafts((current) => Object.fromEntries(Object.entries(current)
      .filter(([id]) => nextSchedule.runs.some((run) => run.id === id))));
    setLastConfirmed(new Date().toISOString());
    const messages: string[] = [];
    if (nextCatalog) {
      setCatalog(nextCatalog);
      const cacheWarning = cacheConfirmed(nextSchedule, nextCatalog);
      if (cacheWarning) messages.push(cacheWarning);
    } else {
      messages.push(`The server plan loaded, but the setup catalog is unavailable. Editing is paused until refresh. ${catalogResult.status === "rejected" ? errorMessage(catalogResult.reason, "") : ""}`);
    }
    if (liveResult.status === "fulfilled") setLiveRuns(liveResult.value);
    else messages.push("The schedule is current, but the separate live-run list could not be refreshed.");
    if (messages.length > 0) setError(messages.join(" "));
    else setError(null);
    if (!quiet) setNotice(`Server schedule loaded · ${nextSchedule.timeZone}. Live runs are shown separately.`);
    setLoading(false);
  }

  useEffect(() => {
    generation.current += 1;
    setLiveRuns([]);
    setDrafts({});
    setNewDraft(null);
    setBreakDraft(null);
    setSwapFirst("");
    setSwapSecond("");
    setNotice(null);
    setError(null);
    setLastConfirmed(null);
    setPending(readPendingScheduleCommand(userId, date));
    if (!canManage) {
      setLoading(false);
      return;
    }
    if (!online) {
      const cached = applyCachedSchedule(date);
      setError(cached
        ? "Offline read-only view. Customer and PO notes are not stored in the confirmed device cache."
        : "No confirmed plan is cached for this date. Reconnect to view the server schedule.");
      setLoading(false);
      return;
    }
    void loadCanonical(date);
  }, [date, online, canManage, userId]);

  useEffect(() => {
    const request = readPendingScheduleImport(userId);
    setImportPending(request);
    if (request && online && canManage) void sendImportPending(request);
  }, [online, canManage, userId]);

  useEffect(() => {
    if (!online || !canManage) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && !isDirty && !saving && !loading && !importPending) {
        void loadCanonical(date, true);
      }
    };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [online, canManage, date, isDirty, saving, loading, catalog, schedule, pending, importPending]);

  function clearDrafts() {
    setDrafts({});
    setNewDraft(null);
    setBreakDraft(null);
  }

  function changeDate(nextDate: string) {
    if (!nextDate || nextDate === date) return;
    if (isDirty && !window.confirm("Discard unsaved schedule edits on this device and load another date?")) return;
    setDate(nextDate);
  }

  function refreshSchedule() {
    if (isDirty && !window.confirm("Reloading replaces unsaved schedule edits on this device. Continue?")) return;
    clearDrafts();
    void loadCanonical(date);
  }

  async function sendImportPending(pendingRequest: PendingScheduleImportRequest): Promise<ScheduleImportDetail | ScheduleImportActionResponse | null> {
    if (!online || saving) return null;
    setSaving(true);
    setError(null);
    setNotice(pendingRequest.kind === "stage" ? "Staging the canonical schedule import…" : `${pendingRequest.kind === "apply" ? "Applying" : "Undoing"} the canonical import date…`);
    try {
      if (pendingRequest.kind === "stage") {
        const result = await stageScheduleImport(pendingRequest.request);
        clearPendingScheduleImport(userId);
        setImportPending(null);
        setImportConfirmation(result.detail);
        setNotice(result.replayed ? "The previous staging request was confirmed; no schedule changed." : "Canonical schedule import staged. No schedule changed.");
        return result.detail;
      }
      const result = await applyOrUndoScheduleImport(pendingRequest.kind, pendingRequest.importId, pendingRequest.request);
      clearPendingScheduleImport(userId);
      setImportPending(null);
      setImportConfirmation(result.import);
      if (result.schedule.date === date) {
        setSchedule(result.schedule);
        clearDrafts();
        const cacheWarning = cacheConfirmed(result.schedule, catalog);
        if (cacheWarning) setError(cacheWarning);
      }
      if (result.outcome === "conflict") {
        setNotice(null);
        setError("The import action was not applied. Review the current schedule and canonical date state.");
      } else {
        setNotice(result.replayed ? "The previous import action was confirmed from its exact retry." : `Canonical import ${pendingRequest.kind === "apply" ? "Apply" : "Undo"} confirmed for ${result.productionDate}.`);
      }
      return result;
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      if (status === 409) {
        clearPendingScheduleImport(userId);
        setImportPending(null);
        await loadCanonical(date, true);
        setError("The import request was rejected against the current state. Review canonical history before submitting a new request.");
      } else {
        setNotice(null);
        setError(`${errorMessage(cause, "The import request could not be confirmed.")} The exact request remains pending; no different request will be substituted.`);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function stageImport(request: ScheduleImportStageRequest): Promise<ScheduleImportDetail | null> {
    if (writeDisabled) return null;
    const pendingRequest: PendingScheduleImportRequest = { kind: "stage", request };
    try {
      writePendingScheduleImport(userId, pendingRequest);
    } catch {
      setError("This device could not retain the pending import. Nothing was sent; check browser storage and try again.");
      return null;
    }
    setImportPending(pendingRequest);
    return await sendImportPending(pendingRequest) as ScheduleImportDetail | null;
  }

  async function importAction(
    action: "apply" | "undo", importId: string, request: ScheduleImportActionRequest,
  ): Promise<ScheduleImportActionResponse | null> {
    if (writeDisabled) return null;
    const pendingRequest: PendingScheduleImportRequest = { kind: action, importId, request };
    try {
      writePendingScheduleImport(userId, pendingRequest);
    } catch {
      setError("This device could not retain the pending import action. Nothing was sent; check browser storage and try again.");
      return null;
    }
    setImportPending(pendingRequest);
    return await sendImportPending(pendingRequest) as ScheduleImportActionResponse | null;
  }

  function submitCommand(command: ScheduleCommand) {
    if (!schedule || writeDisabled) return;
    const request: ScheduleCommandRequest = {
      requestId: crypto.randomUUID(),
      date: schedule.date,
      expectedRevision: schedule.revision,
      command,
    };
    try {
      writePendingScheduleCommand(userId, request);
    } catch {
      setError("This device could not retain the pending request. No change was sent; check browser storage and try again.");
      return;
    }
    setPending(request);
    void sendPending(request);
  }

  async function sendPending(request: ScheduleCommandRequest) {
    if (!online || saving) return;
    setSaving(true);
    setError(null);
    setNotice("Saving the schedule change…");
    const requestGeneration = generation.current;
    try {
      const result = await applyProductionScheduleCommand(request);
      if (requestGeneration !== generation.current) return;
      setSchedule(result.schedule);
      setLastConfirmed(new Date().toISOString());
      const cacheWarning = cacheConfirmed(result.schedule, catalog);
      clearPendingScheduleCommand(userId, request.date);
      setPending(null);

      if (result.conflict) {
        if (request.command.type === "add") setNewDraft(request.command.run);
        if (request.command.type === "update") {
          const requestedRunId = request.command.runId;
          const requestedChanges = request.command.changes;
          const confirmed = result.schedule.runs.find((run) => run.id === requestedRunId);
          if (confirmed) {
            setDrafts((current) => ({
              ...current,
              [confirmed.id]: { ...confirmed, ...requestedChanges },
            }));
          }
        }
        if (request.command.type === "breaks") setBreakDraft(null);
        setNotice(null);
        setError(`Another manager changed this date. The latest confirmed plan is loaded; this change was not saved. Review and submit it again if it is still wanted.${cacheWarning ? ` ${cacheWarning}` : ""}`);
        return;
      }

      if (request.command.type === "add") setNewDraft(null);
      if (request.command.type === "update" || request.command.type === "remove") {
        const changedRunId = request.command.runId;
        setDrafts((current) => {
          const next = { ...current };
          delete next[changedRunId];
          return next;
        });
      }
      if (request.command.type === "breaks") setBreakDraft(null);
      setError(cacheWarning);
      setNotice(result.replayed
        ? "The previous save was confirmed. The current server plan has been reloaded."
        : "Schedule change saved to the server.");
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      const status = cause instanceof ApiError ? cause.status : 0;
      if (status === 409) {
        clearPendingScheduleCommand(userId, request.date);
        setPending(null);
        await loadCanonical(request.date);
        setError("The schedule changed before this save. Review the latest plan before submitting again.");
      } else {
        if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) {
          clearPendingScheduleCommand(userId, request.date);
          setPending(null);
        }
        setNotice(null);
        if (status === 401) setError("Your manager session expired. Sign in again; the same request is retained for safe retry.");
        else if (status === 403) setError("Your session could not authorize this change. Refresh your session; the same request is retained.");
        else if (status === 429 || status >= 500 || status === 0) {
          setError(`${errorMessage(cause, "The save was not confirmed.")} Retry the same request; its request ID prevents duplicate changes.`);
        } else setError(errorMessage(cause, "The schedule change was rejected."));
      }
    } finally {
      if (requestGeneration === generation.current) setSaving(false);
    }
  }

  function saveRun(run: PlannedScheduleRun, isNew: boolean) {
    if (!catalog || !schedule) return;
    try {
      const validated = validateScheduleRun(run, catalog);
      if (isNew) {
        submitCommand({ type: "add", run: validated });
        return;
      }
      const existing = schedule.runs.find((item) => item.id === run.id);
      if (!existing) throw new Error("That planned run is no longer on the schedule. Refresh and review the latest plan.");
      const changes = Object.fromEntries(Object.entries(validated)
        .filter(([key, value]) => key !== "id" && existing[key as keyof PlannedScheduleRun] !== value)) as Extract<ScheduleCommand, { type: "update" }>["changes"];
      if (Object.keys(changes).length > 0) submitCommand({ type: "update", runId: run.id, changes });
    } catch (cause) {
      setError(errorMessage(cause, "Check the planned-run fields."));
    }
  }

  if (!canManage) {
    return (
      <div>
        <div className="page-heading">
          <div><p className="eyebrow">Planning</p><h1>Production schedule</h1><p>Manager-only server scheduling.</p></div>
        </div>
        <section className="panel mt-6 max-w-3xl" role="alert">
          <h2 className="text-lg font-semibold">Manager access required</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Your account does not have the factory-settings capability required to read or change production schedules.</p>
        </section>
      </div>
    );
  }

  const confirmedRuns = schedule?.runs ?? [];
  const currentBreaks = breakDraft ?? schedule?.breaks ?? [];
  const breaksDirty = breakDraft !== null && schedule !== null && JSON.stringify(breakDraft) !== JSON.stringify(schedule.breaks);

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Planning · server confirmed</p>
          <h1>Production schedule</h1>
          <p>Plan run order, breaks, and reviewed workbook rows without creating live runs.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-date">Production date
            <input
              id="schedule-date"
              className="field mt-1.5 w-44"
              type="date"
              value={date}
              disabled={loading || saving}
              onChange={(event) => changeDate(event.target.value)}
            />
          </label>
          <button type="button" className="button-secondary px-3" disabled={!online || loading || saving} onClick={refreshSchedule}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" role="status">
        <span className="status-pill">{online ? "Connected" : "Read-only offline"}</span>
        <span>{schedule?.date === date ? `Confirmed revision ${schedule.revision} · ${schedule.timeZone}` : loading ? "Loading the server schedule…" : "No confirmed schedule loaded"}</span>
        <span>Last confirmed: {lastConfirmed ? new Date(lastConfirmed).toLocaleString() : "not yet"}</span>
      </div>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}<button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
      {pending ? (
        <div className="notice-banner" role="status">
          <span>A schedule save has not been resolved. No other writes are available until its exact retry succeeds or the server rejects it.</span>
          <button type="button" className="button-secondary ml-auto" disabled={!online || saving || loading} onClick={() => void sendPending(pending)}>
            {pending.command.type === "merge-import" ? "Retry the same import" : "Retry the same save"}
          </button>
        </div>
      ) : null}
      {importPending ? (
        <div className="notice-banner" role="status">
          <span>A canonical schedule import {importPending.kind} request is unresolved. Other schedule writes are paused until its exact retry resolves.</span>
          <button type="button" className="button-secondary ml-auto" disabled={!online || saving} onClick={() => void sendImportPending(importPending)}>Retry the same import {importPending.kind}</button>
        </div>
      ) : null}

      {schedule && catalog && schedule.date === date ? (
        <>
          <div className="mt-6">
            <SubstitutionManager
              productionDate={schedule.date}
              overlay={schedule.substitutionOverlay}
              online={online}
              onOverlay={(substitutionOverlay) => {
                const next = { ...schedule, substitutionOverlay };
                setSchedule(next);
                setLastConfirmed(new Date().toISOString());
                const cacheWarning = cacheConfirmed(next, catalog);
                if (cacheWarning) setError(cacheWarning);
              }}
            />
          </div>
          <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,1fr)]">
            <div className="min-w-0 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Planned runs</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{confirmedRuns.length} of 100 planned runs</p>
                </div>
                <button
                  type="button"
                  className="button-primary"
                  disabled={writeDisabled || newDraft !== null || confirmedRuns.length >= 100}
                  onClick={() => setNewDraft({ id: crypto.randomUUID(), productCode: "", productionSetupCode: "", runTemplateCode: "", targetCases: 0, notes: "" })}
                ><Plus className="h-4 w-4" />Add planned run</button>
              </div>

              {confirmedRuns.length === 0 && !newDraft ? (
                <section className="panel"><h2 className="text-lg font-semibold">No runs planned for this date</h2><p className="mt-2 text-sm text-muted-foreground">Add a planned run or review a deterministic workbook import.</p></section>
              ) : null}

              {confirmedRuns.map((run, index) => {
                const draft = drafts[run.id] ?? run;
                const dirty = JSON.stringify(draft) !== JSON.stringify(run);
                return (
                  <ScheduleRunCard
                    key={run.id}
                    run={draft}
                    index={index}
                    total={confirmedRuns.length}
                    isNew={false}
                    dirty={dirty}
                    disabled={writeDisabled}
                    catalog={catalog}
                    onChange={(next) => setDrafts((current) => ({ ...current, [run.id]: next }))}
                    onSave={() => saveRun(draft, false)}
                    onMove={(toIndex) => submitCommand({ type: "move", runId: run.id, toIndex })}
                    onRemove={() => {
                      if (window.confirm("Remove this planned run from the selected date?")) submitCommand({ type: "remove", runId: run.id });
                    }}
                  />
                );
              })}

              {newDraft ? (
                <ScheduleRunCard
                  run={newDraft}
                  index={confirmedRuns.length}
                  total={confirmedRuns.length + 1}
                  isNew
                  dirty
                  disabled={writeDisabled}
                  catalog={catalog}
                  onChange={setNewDraft}
                  onSave={() => saveRun(newDraft, true)}
                  onMove={() => undefined}
                  onRemove={() => setNewDraft(null)}
                />
              ) : null}

              <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <section className="panel" aria-labelledby="schedule-breaks-heading">
                  <h2 id="schedule-breaks-heading" className="text-lg font-semibold">Standard breaks</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Assign each enabled 30-minute break to follow a planned run.</p>
                  <div className="mt-4 space-y-4">
                    {currentBreaks.map((item) => (
                      <div key={item.slot} className="border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
                        <label className="flex min-h-11 items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-amber-500"
                            checked={item.enabled}
                            disabled={writeDisabled}
                            onChange={(event) => setBreakDraft(currentBreaks.map((value) => value.slot === item.slot ? { ...value, enabled: event.target.checked } : value))}
                          />Break {item.slot} · 30 minutes
                        </label>
                        <label className="mt-2 block text-xs font-medium" htmlFor={`schedule-break-${item.slot}`}>Run after break {item.slot}
                          <select
                            id={`schedule-break-${item.slot}`}
                            aria-label={`Run after break ${item.slot}`}
                            className="field mt-1.5"
                            value={item.runId ?? ""}
                            disabled={writeDisabled}
                            onChange={(event) => setBreakDraft(currentBreaks.map((value) => value.slot === item.slot ? { ...value, runId: event.target.value || null } : value))}
                          >
                            <option value="">Not assigned</option>
                            {confirmedRuns.map((run) => <option key={run.id} value={run.id}>{scheduleRunTitle(run, catalog)}</option>)}
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="button-primary mt-5"
                    disabled={writeDisabled || !breaksDirty}
                    onClick={() => submitCommand({ type: "breaks", breaks: currentBreaks })}
                  >Save breaks</button>
                </section>

                <section className="panel" aria-labelledby="schedule-swap-heading">
                  <h2 id="schedule-swap-heading" className="text-lg font-semibold">Swap run order</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Exchange two confirmed positions without editing either run.</p>
                  <div className="mt-4 space-y-4">
                    <label className="block text-xs font-medium" htmlFor="schedule-swap-first">First run
                      <select id="schedule-swap-first" aria-label="First run" className="field mt-1.5" value={swapFirst} disabled={writeDisabled} onChange={(event) => setSwapFirst(event.target.value)}>
                        <option value="">Choose first run</option>
                        {confirmedRuns.map((run) => <option key={run.id} value={run.id}>{scheduleRunTitle(run, catalog)}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs font-medium" htmlFor="schedule-swap-second">Second run
                      <select id="schedule-swap-second" aria-label="Second run" className="field mt-1.5" value={swapSecond} disabled={writeDisabled} onChange={(event) => setSwapSecond(event.target.value)}>
                        <option value="">Choose second run</option>
                        {confirmedRuns.map((run) => <option key={run.id} value={run.id}>{scheduleRunTitle(run, catalog)}</option>)}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="button-secondary mt-5"
                    disabled={writeDisabled || !swapFirst || !swapSecond || swapFirst === swapSecond}
                    onClick={() => submitCommand({ type: "swap", firstRunId: swapFirst, secondRunId: swapSecond })}
                  ><ArrowLeftRight className="h-4 w-4" />Swap selected runs</button>
                </section>
              </div>
            </div>

            <ScheduleTimeline schedule={schedule} catalog={catalog} liveRuns={liveRuns} />
          </div>
        </>
      ) : (
        <section className="panel mt-6">
          <h2 className="text-lg font-semibold">{loading ? "Reading the confirmed schedule…" : schedule?.date === date ? "Schedule catalog unavailable" : "No schedule to display"}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {schedule?.date === date ? `${schedule.runs.length} planned runs are confirmed at revision ${schedule.revision}. Editing remains paused until the catalog loads.` : "Reconnect and refresh to load the server plan and its reviewed catalog."}
          </p>
        </section>
      )}

      {schedule && catalog ? (
        <div className="mt-5">
          <ScheduleImport
            schedule={schedule}
            catalog={catalog}
            online={online}
            confirmedImport={importConfirmation}
            disabled={loading || saving || pending !== null || importPending !== null || isDirty || schedule.date !== date}
            onLoadDate={changeDate}
            onStage={stageImport}
            onAction={importAction}
          />
        </div>
      ) : null}
    </div>
  );
}
