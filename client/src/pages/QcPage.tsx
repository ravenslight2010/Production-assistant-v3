import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  ApiError,
  getQcRunDashboard,
  getQcTargets,
  listRuns,
  recordQcBrixCheck,
  recordQcLot,
  recordQcWeightCheck,
  saveQcTarget,
  type AuthSession,
  type QcDashboard,
  type QcRunRecord,
  type QcTarget,
  type QcTargetSaveRequest,
  type Run,
} from "../api";
import { QcRecordForms, type QcRecordSubmission } from "../components/QcRecordForms";
import { QcTargetManager } from "../components/QcTargetManager";
import {
  clearPendingQcCommand,
  readPendingQcCommand,
  readQcCache,
  readQcSelection,
  writePendingQcCommand,
  writeQcCache,
  writeQcSelection,
  type PendingQcCommand,
} from "../components/qc-storage";

type Section = "run" | "records" | "targets";
type RecordCommand = Extract<PendingQcCommand, { channel: "lot" | "weight-check" | "brix-check" }>;
type TargetCommand = Extract<PendingQcCommand, { channel: "target" }>;

const reasonLabels: Record<string, string> = {
  "no-reviewed-target": "No reviewed target selected",
  "target-unavailable": "Selected target is unavailable",
  "target-kind-mismatch": "Target kind does not match this measurement",
  "target-inactive": "Captured target is inactive",
  "unit-mismatch": "Measurement and target units differ",
};

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function recordName(record: QcRunRecord): string {
  return record.kind === "lot" ? "Lot" : record.kind === "weight-check" ? "Weight check" : "Brix check";
}

function observation(record: QcRunRecord): string {
  if (record.kind === "lot") return `${record.details.productCode} · ${record.details.lotNumber}`;
  const phase = record.kind === "weight-check" ? `${record.details.phase === "pre-run" ? "Pre-run" : "30-minute"} · ` : "";
  return `${phase}${record.details.value} ${record.details.unit}`;
}

function Evaluation({ record }: { record: QcRunRecord }) {
  if (record.kind === "lot") return <span className="status-pill">Recorded</span>;
  const outcome = record.details.outcome;
  return (
    <div>
      <span className={`status-pill ${outcome === "pass" ? "status-running" : outcome === "fail" ? "border-destructive/40 bg-destructive/10 text-destructive" : "status-paused"}`}>
        {outcome === "not-evaluated" ? "Not evaluated" : outcome}
      </span>
      {record.details.notEvaluatedReason ? <span className="mt-2 block max-w-48 text-[11px] leading-4 text-muted-foreground">{reasonLabels[record.details.notEvaluatedReason]}</span> : null}
      {record.details.target ? <span className="mt-2 block font-mono text-[10px] text-muted-foreground">{record.details.target.targetKey} · revision {record.details.target.revision}</span> : null}
    </div>
  );
}

export function QcPage({ session, online }: { session: AuthSession; online: boolean }) {
  const userId = session.staff.userId;
  const canRecord = session.staff.capabilities.includes("record-qc");
  const canManage = session.staff.capabilities.includes("manage-qc");
  const [section, setSection] = useState<Section>("run");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => readQcSelection(userId));
  const [dashboard, setDashboard] = useState<QcDashboard | null>(null);
  const [targets, setTargets] = useState<QcTarget[]>([]);
  const [pending, setPending] = useState<PendingQcCommand | null>(() => readPendingQcCommand(userId));
  const [loading, setLoading] = useState(canRecord && online);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastConfirmed, setLastConfirmed] = useState<string | null>(null);
  const generation = useRef(0);
  const writeLock = useRef(false);
  const dashboardRef = useRef<QcDashboard | null>(null);
  dashboardRef.current = dashboard;

  const cacheConfirmed = useCallback((nextDashboard: QcDashboard, nextTargets: QcTarget[]): string | null => {
    try {
      const cachedAt = writeQcCache(userId, nextDashboard, nextTargets);
      setLastConfirmed(cachedAt);
      return null;
    } catch {
      setLastConfirmed(new Date().toISOString());
      return "The confirmed QC view loaded, but this device could not retain it for offline reading.";
    }
  }, [userId]);

  const refresh = useCallback(async (quiet = false): Promise<boolean> => {
    if (!online || !canRecord) return false;
    const requestGeneration = generation.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
      setNotice(null);
    }
    try {
      const [nextRuns, nextTargets] = await Promise.all([listRuns(100), getQcTargets()]);
      const chosen = nextRuns.find((run) => run.id === selectedId)
        ?? nextRuns.find((run) => run.status !== "completed") ?? nextRuns[0] ?? null;
      const nextDashboard = chosen ? await getQcRunDashboard(chosen.id) : null;
      if (requestGeneration !== generation.current) return false;
      setRuns(nextRuns);
      setTargets(nextTargets);
      if (chosen) {
        if (chosen.id !== selectedId) {
          setSelectedId(chosen.id);
          try { writeQcSelection(userId, chosen.id); } catch { /* Selection remains valid for this session. */ }
        }
        setDashboard(nextDashboard);
      } else {
        setSelectedId(null);
        setDashboard(null);
      }
      const cacheWarning = nextDashboard ? cacheConfirmed(nextDashboard, nextTargets) : null;
      setLastConfirmed(new Date().toISOString());
      setError(cacheWarning);
      if (!quiet) setNotice(nextDashboard ? "QC server state confirmed." : "No facility runs are available for QC.");
      setLoading(false);
      return true;
    } catch (cause) {
      if (requestGeneration !== generation.current) return false;
      const cached = selectedId ? readQcCache(userId, selectedId) : null;
      if (cached && !dashboardRef.current) {
        setDashboard(cached.dashboard);
        setTargets(cached.targets);
        setRuns([cached.dashboard.run]);
        setLastConfirmed(cached.cachedAt);
      }
      setError(`${message(cause, "QC server state could not be loaded.")}${cached || dashboardRef.current ? " Showing the last confirmed QC view retained on this device; it is not current server truth." : " No confirmed QC view is available."}`);
      setLoading(false);
      return false;
    }
  }, [online, canRecord, selectedId, userId, cacheConfirmed]);

  useEffect(() => {
    generation.current += 1;
    setPending(readPendingQcCommand(userId));
    setNotice(null);
    if (!canRecord) {
      setRuns([]);
      setDashboard(null);
      setTargets([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!online) {
      const cached = selectedId ? readQcCache(userId, selectedId) : null;
      setDashboard(cached?.dashboard ?? null);
      setTargets(cached?.targets ?? []);
      setRuns(cached ? [cached.dashboard.run] : []);
      setLastConfirmed(cached?.cachedAt ?? null);
      setLoading(false);
      setError(cached
        ? "Offline read-only view. Showing QC values confirmed on this device at the labeled time; no writes are queued."
        : "Offline read-only mode. No confirmed QC view is cached for this run; reconnect to load server state.");
      return;
    }
    setError(null);
    void refresh();
  }, [online, canRecord, selectedId, userId, refresh]);

  function selectRun(runId: string) {
    if (runId === selectedId) return;
    setSelectedId(runId);
    setDashboard(null);
    setLastConfirmed(null);
    setNotice(null);
    try { writeQcSelection(userId, runId); } catch {
      setError("This device could not retain the selected run for offline reading. The server selection is unchanged.");
    }
  }

  function begin(command: PendingQcCommand): boolean {
    if (writeLock.current || pending || !online) return false;
    try {
      writePendingQcCommand(userId, command);
      setPending(command);
      return true;
    } catch {
      setError("This device could not retain the exact request for safe retry. Nothing was sent; check browser storage and try again.");
      setNotice(null);
      return false;
    }
  }

  function resolvePending() {
    try { clearPendingQcCommand(userId); } catch { /* The in-memory lock is still released. */ }
    setPending(null);
  }

  async function executeRecord(command: RecordCommand): Promise<boolean> {
    if (!online || writeLock.current) return false;
    writeLock.current = true;
    setSaving(true);
    setError(null);
    const requestGeneration = generation.current;
    try {
      const result = command.channel === "lot" ? await recordQcLot(command.request)
        : command.channel === "weight-check" ? await recordQcWeightCheck(command.request)
          : await recordQcBrixCheck(command.request);
      if (requestGeneration !== generation.current) return false;
      resolvePending();
      setRuns((current) => current.some((run) => run.id === result.run.id)
        ? current.map((run) => run.id === result.run.id ? result.run : run) : [result.run, ...current]);
      const cacheWarning = cacheConfirmed(result, targets);
      if (result.run.id === selectedId) setDashboard(result);
      const outcome = result.record.kind === "lot" ? "Lot evidence recorded."
        : `${recordName(result.record)} recorded with outcome ${result.record.details.outcome.replace("-", " ")}${result.record.details.notEvaluatedReason ? `: ${reasonLabels[result.record.details.notEvaluatedReason]}` : ""}.`;
      setError(cacheWarning);
      setNotice(`${result.replayed ? "Previous request confirmed by exact retry. " : ""}${outcome}`);
      return result.run.id === selectedId;
    } catch (cause) {
      if (requestGeneration !== generation.current) return false;
      const status = cause instanceof ApiError ? cause.status : 0;
      if (!(status === 0 || status === 401 || status === 403 || status === 429 || status >= 500)) resolvePending();
      if (status === 409) await refresh(true);
      setNotice(null);
      if (status === 0 || status === 429 || status >= 500) {
        setError(`${message(cause, "The QC record was not confirmed.")} Retry the same request; its request ID prevents duplicate evidence.`);
      } else if (status === 401) setError("Your session expired. Sign in again, then retry the retained request.");
      else if (status === 403) setError("Your session no longer authorizes this QC record. Refresh your session before retrying.");
      else setError(message(cause, "The QC record was rejected. Review the values and submit a new request."));
      return false;
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }

  async function submitRecord(submission: QcRecordSubmission): Promise<boolean> {
    if (!selectedId || !dashboard || loading || saving || pending || !online) return false;
    const common = { requestId: crypto.randomUUID(), runId: selectedId };
    const command: RecordCommand = submission.kind === "lot"
      ? { channel: "lot", request: { ...common, details: submission.details } }
      : submission.kind === "weight-check"
        ? { channel: "weight-check", request: { ...common, details: submission.details } }
        : { channel: "brix-check", request: { ...common, details: submission.details } };
    return begin(command) ? executeRecord(command) : false;
  }

  async function executeTarget(command: TargetCommand): Promise<{ status: "saved" } | { status: "conflict"; targets: QcTarget[] } | { status: "failed" }> {
    if (!online || writeLock.current) return { status: "failed" };
    writeLock.current = true;
    setSaving(true);
    setError(null);
    const requestGeneration = generation.current;
    try {
      const result = await saveQcTarget(command.request);
      if (requestGeneration !== generation.current) return { status: "failed" };
      resolvePending();
      setTargets(result.targets);
      if (result.outcome === "conflict") {
        if (dashboard) cacheConfirmed(dashboard, result.targets);
        setNotice(null);
        setError("This target changed before your save. The unapplied values and canonical revision are shown for review; nothing was overwritten.");
        return { status: "conflict", targets: result.targets };
      }
      if (dashboard) {
        const cacheWarning = cacheConfirmed(dashboard, result.targets);
        setError(cacheWarning);
      }
      setNotice(`${result.replayed ? "Previous request confirmed by exact retry. " : ""}Target ${result.target.targetKey} saved at revision ${result.target.revision}. Historical measurements keep their captured target.`);
      return { status: "saved" };
    } catch (cause) {
      if (requestGeneration !== generation.current) return { status: "failed" };
      const status = cause instanceof ApiError ? cause.status : 0;
      if (!(status === 0 || status === 401 || status === 403 || status === 429 || status >= 500)) resolvePending();
      if (status === 409) await refresh(true);
      setNotice(null);
      if (status === 0 || status === 429 || status >= 500) {
        setError(`${message(cause, "The target save was not confirmed.")} Retry the same request; its request ID prevents duplicate target writes.`);
      } else if (status === 401) setError("Your session expired. Sign in again, then retry the retained request.");
      else if (status === 403) setError("Your session no longer authorizes target management. Refresh your session before retrying.");
      else setError(message(cause, "The target was rejected. Review the values and submit a new request."));
      return { status: "failed" };
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }

  function submitTarget(request: Omit<QcTargetSaveRequest, "requestId">) {
    if (loading || saving || pending || !online || !canManage) return Promise.resolve({ status: "failed" as const });
    const command: TargetCommand = { channel: "target", request: { ...request, requestId: crypto.randomUUID() } };
    return begin(command) ? executeTarget(command) : Promise.resolve({ status: "failed" as const });
  }

  function retryPending() {
    if (!pending || saving || !online) return;
    if (pending.channel === "target") void executeTarget(pending);
    else void executeRecord(pending);
  }

  const recordDisabled = !online || loading || saving || pending !== null || !dashboard;
  const targetDisabled = !online || loading || saving || pending !== null;
  const lots = dashboard?.records.filter((record) => record.kind === "lot").length ?? 0;
  const weights = dashboard?.records.filter((record) => record.kind === "weight-check").length ?? 0;
  const brixChecks = dashboard?.records.filter((record) => record.kind === "brix-check").length ?? 0;

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Run evidence · server confirmed</p>
          <h1>Quality control</h1>
          <p>Record lots, pre-run and 30-minute weights, and Brix observations. Every measurement retains the exact reviewed target used at entry.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-right text-xs text-muted-foreground sm:block">Confirmed read<br /><strong className="font-medium text-foreground">{lastConfirmed ? new Date(lastConfirmed).toLocaleString() : "Not yet"}</strong></span>
          <button type="button" className="button-secondary px-3" onClick={() => void refresh()} disabled={!online || loading || !canRecord} aria-label="Refresh QC server state"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </div>

      {!canRecord ? (
        <section className="panel mt-6 max-w-3xl" aria-labelledby="qc-access-heading">
          <p className="eyebrow">Restricted runtime access</p>
          <h2 id="qc-access-heading" className="mt-2 text-xl font-semibold">QC access required</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">This account does not have the record-qc capability. QC run evidence and targets were not requested. A manager can assign the reviewed QC role without changing production permissions.</p>
        </section>
      ) : (
        <>
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          {notice ? <div className="notice-banner" role="status">{notice}<button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
          {!online ? <div className="error-banner border-amber-500/40 bg-amber-500/10 text-amber-300" role="status">Read-only offline. All QC recording and target writes are disabled; reconnect before retrying an unconfirmed request.</div> : null}
          {pending ? (
            <div className="error-banner border-amber-500/40 bg-amber-500/10 text-amber-300" role="status">
              <span className="min-w-0 flex-1">One {pending.channel === "target" ? "target change" : `${pending.channel} record`} has not been confirmed. Retry the exact request instead of creating another.</span>
              <button type="button" className="button-secondary" onClick={retryPending} disabled={!online || saving}>{saving ? "Confirming…" : "Retry same request"}</button>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-3">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="QC workspace">
              {([{ id: "run", label: "Run" }, { id: "records", label: `Records${dashboard ? ` (${dashboard.records.length})` : ""}` }, { id: "targets", label: `Targets (${targets.length})` }] as { id: Section; label: string }[]).map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={section === item.id} className={`nav-tab ${section === item.id ? "nav-tab-active" : ""}`} onClick={() => setSection(item.id)}>{item.label}</button>
              ))}
            </div>
            {(runs.length > 0 || selectedId) && section !== "targets" ? (
              <label className="w-full text-xs font-medium text-muted-foreground sm:w-auto sm:min-w-72" htmlFor="qc-run-selector">QC run
                <select id="qc-run-selector" className="field mt-1.5" value={selectedId ?? ""} onChange={(event) => selectRun(event.target.value)} disabled={loading && runs.length === 0}>
                  {!selectedId ? <option value="">Select a run</option> : null}
                  {runs.map((run) => <option key={run.id} value={run.id}>{run.setupSnapshot.label} · {run.productionDate} · {run.status}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          {section === "run" ? (
            dashboard ? (
              <section className="panel mt-5" aria-labelledby="qc-run-heading">
                <div className="panel-heading">
                  <div><p className="eyebrow">Immutable run context</p><h2 id="qc-run-heading" className="mt-1 text-xl font-bold">{dashboard.run.setupSnapshot.label}</h2></div>
                  <span className={`status-pill status-${dashboard.run.status}`}>{dashboard.run.status}</span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="metric"><dt>Production date</dt><dd>{dashboard.run.productionDate}</dd></div>
                  <div className="metric"><dt>Product</dt><dd>{dashboard.run.setupSnapshot.productCode ?? "Not specified"}</dd></div>
                  <div className="metric"><dt>Setup</dt><dd>{dashboard.run.setupSnapshot.productionSetupCode ?? "Not specified"}</dd></div>
                  <div className="metric"><dt>Target cases</dt><dd>{dashboard.run.setupSnapshot.targetCases}</dd></div>
                  <div className="metric"><dt>QC high-water mark</dt><dd className="font-mono">{dashboard.highWaterMark}</dd></div>
                  <div className="metric"><dt>Run revision</dt><dd className="font-mono">{dashboard.run.revision}</dd></div>
                </dl>
                <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-3" aria-label="Recorded QC evidence totals">
                  <div className="bg-background/70 p-4"><span className="font-mono text-2xl">{lots}</span><span className="ml-2 text-xs text-muted-foreground">separate lots</span></div>
                  <div className="bg-background/70 p-4"><span className="font-mono text-2xl">{weights}</span><span className="ml-2 text-xs text-muted-foreground">weight checks</span></div>
                  <div className="bg-background/70 p-4"><span className="font-mono text-2xl">{brixChecks}</span><span className="ml-2 text-xs text-muted-foreground">Brix checks</span></div>
                </div>
                <p className="mt-5 border-t border-border/70 pt-4 text-xs leading-5 text-muted-foreground">The high-water mark is the highest confirmed facility QC sequence linked to this run. Zero means no run evidence. It is not a count, a cadence-compliance claim, or a run-progress revision.</p>
              </section>
            ) : (
              <section className="panel mt-5"><p className="eyebrow">Current run</p><h2 className="mt-2 text-xl font-semibold">{loading ? "Reading confirmed QC state…" : runs.length === 0 && online ? "No production runs are available for QC" : "No confirmed run view available"}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Select a facility-owned run when connected. Empty QC evidence is shown explicitly and is never treated as a pass.</p></section>
            )
          ) : null}

          {section === "records" && dashboard ? (
            <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
              <section className="panel min-w-0" aria-labelledby="qc-records-heading">
                <div className="panel-heading"><div><p className="eyebrow">Append-only run evidence</p><h2 id="qc-records-heading" className="mt-1 text-lg font-semibold">Ordered records</h2></div><span className="status-pill">High-water {dashboard.highWaterMark}</span></div>
                {dashboard.records.length === 0 ? (
                  <div className="mt-5 rounded-lg border border-dashed border-border p-5"><p className="text-sm font-medium">No QC checks recorded for this run.</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Record a lot, weight, or Brix observation using the adjacent form. Missing evidence is not evaluated as compliant.</p></div>
                ) : (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
                      <caption className="sr-only">QC records for {dashboard.run.setupSnapshot.label}, ordered by facility QC sequence</caption>
                      <thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-3 font-medium">Sequence</th><th className="py-2 pr-3 font-medium">Evidence</th><th className="py-2 pr-3 font-medium">Observation</th><th className="py-2 pr-3 font-medium">Evaluation</th><th className="py-2 font-medium">Recorded</th></tr></thead>
                      <tbody>
                        {dashboard.records.map((record) => (
                          <tr key={record.recordId} className="border-b border-border/50 align-top last:border-0">
                            <td className="py-3 pr-3 font-mono text-muted-foreground">{record.sequence}</td>
                            <th scope="row" className="py-3 pr-3 font-medium">{recordName(record)}</th>
                            <td className="py-3 pr-3"><span className="font-mono text-foreground">{observation(record)}</span>{record.details.notes ? <span className="mt-1 block max-w-64 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">{record.details.notes}</span> : null}</td>
                            <td className="py-3 pr-3"><Evaluation record={record} /></td>
                            <td className="py-3 text-muted-foreground"><time dateTime={record.recordedAt}>{new Date(record.recordedAt).toLocaleString()}</time></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <QcRecordForms key={dashboard.run.id} runId={dashboard.run.id} targets={targets} disabled={recordDisabled} onSubmit={submitRecord} />
            </div>
          ) : null}
          {section === "records" && !dashboard ? <section className="panel mt-5"><h2 className="text-lg font-semibold">Select a confirmed run</h2><p className="mt-2 text-sm text-muted-foreground">QC records can only be entered against a facility-owned run loaded from the server or a labeled confirmed offline view.</p></section> : null}

          {section === "targets" ? <div className="mt-5"><QcTargetManager targets={targets} canManage={canManage} disabled={targetDisabled} onSave={submitTarget} /></div> : null}
        </>
      )}
    </div>
  );
}
