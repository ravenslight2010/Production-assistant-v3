import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  applyStationCommand,
  getOperationalSnapshot,
  operationalPollDelayMs,
  resetOperationalPollBackoff,
  type OperationalSnapshot,
  type Run,
} from "../api";

// Station tabs render the server-owned operational read; every number comes
// from the payload and every mutation goes through the command APIs. v1's
// tab capabilities arrive slice by slice — Run and Dough first, then the
// remaining stations, then stoppages.
const TABS = ["run", "dough", "summary"] as const;
type OperationalTab = (typeof TABS)[number];

const tabLabels: Record<OperationalTab, string> = {
  run: "Run",
  dough: "Dough",
  summary: "Summary",
};

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatClock(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function projectedFinishMs(run: Run, calc: OperationalSnapshot["projection"]["calc"]) {
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : null;
  if (startedAt == null || !Number.isFinite(startedAt) || calc.adjustedTimeSec == null) return null;
  return startedAt + calc.adjustedTimeSec * 1000;
}

/**
 * One editable station input: shows the server-confirmed value, accepts a
 * draft, and commits through the station command API with exact-once
 * replay protection. Conflicts surface as a notice, never a silent loss.
 */
function CommandField({ run, stationKey, fieldKey, label, unit, online, onUpdated }: {
  run: Run;
  stationKey: "line" | "dough";
  fieldKey: string;
  label: string;
  unit?: string;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const confirmed = run.stationProgress[stationKey]?.inputs?.[fieldKey];
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const value = Number(draft);
    if (draft === "" || !Number.isFinite(value) || value < 0) {
      setError("Enter a non-negative number.");
      return;
    }
    if (confirmed === value) {
      setDraft("");
      return;
    }
    commandId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await applyStationCommand(run, stationKey, { [fieldKey]: value }, commandId.current);
      commandId.current = null;
      setDraft("");
      onUpdated(result.run, result.conflict
        ? "Stale change discarded; the latest server state is now displayed."
        : `${label} confirmed by the server.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : `${label} update failed. Refresh before retrying.`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-muted-foreground">{label}
        <span className="mt-1 flex items-center gap-2">
          <input className="field w-28 text-sm text-foreground" type="number" min={0} step="any" inputMode="decimal"
            placeholder={typeof confirmed === "number" ? String(confirmed) : "0"}
            value={draft}
            disabled={!online || pending}
            onChange={(event) => { commandId.current = null; setDraft(event.target.value); }} />
          {unit ? <span className="text-muted-foreground">{unit}</span> : null}
        </span>
      </label>
      <button type="submit" className="button-secondary" disabled={!online || pending || draft === ""}>
        {pending ? "Saving…" : "Save"}
      </button>
      {error ? <span className="error-text w-full" role="alert">{error}</span> : null}
    </form>
  );
}

function RunTab({ run, snapshot, online, onUpdated }: {
  run: Run;
  snapshot: OperationalSnapshot;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const { view, projection } = snapshot;
  const finishMs = projectedFinishMs(run, projection.calc);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <section className="panel">
        <p className="eyebrow">Line speed</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{view.pace.ppm.toFixed(1)}<span className="ml-1 text-sm font-normal text-muted-foreground">cases/min</span></p>
        <div className="mt-3">
          <CommandField run={run} stationKey="line" fieldKey="autoTrackRatePerMinute"
            label="Target line speed" unit="cases/min" online={online} onUpdated={onUpdated} />
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Pace</dt><dd className="font-semibold">{view.pace.paceStatus === "ahead" ? `Ahead ${Math.abs(view.pace.paceDelta).toFixed(1)} cases` : view.pace.paceStatus === "behind" ? `Behind ${Math.abs(view.pace.paceDelta).toFixed(1)} cases` : "On pace"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Catch-up speed</dt><dd className="font-semibold tabular-nums">{view.pace.catchUpPpm > 0 ? `${view.pace.catchUpPpm.toFixed(1)} cases/min` : "—"}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Timing</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Started</dt><dd className="font-semibold tabular-nums">{formatClock(run.startedAt)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Projected finish</dt><dd className="font-semibold tabular-nums">{finishMs != null ? new Date(finishMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Planned run time</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.calc.totalTimeSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Adjusted run time</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.calc.adjustedTimeSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Press remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.pressRemainingSec)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Freezer remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.freezerRemainingSec)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Batch</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Batch</dt><dd className="font-semibold tabular-nums">{Math.round(projection.timers.currentBatchNum)} of {Math.round(projection.timers.totalBatchesNeeded)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Next batch in</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.nextBatchInSec)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases left to press</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.pressCasesLeft).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Press</dt><dd className="font-semibold">{view.recap.pressDone ? "Done" : "Open"}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function DoughTab({ run, snapshot, online, onUpdated }: {
  run: Run;
  snapshot: OperationalSnapshot;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const { projection } = snapshot;
  const shortCases = projection.calc.doughShortCases ?? 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <section className="panel">
        <p className="eyebrow">Dough position</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Trays on line</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.traysOnLine).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Batches ready</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.batchesReady).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Batch</dt><dd className="font-semibold tabular-nums">{Math.round(projection.timers.currentBatchNum)} of {Math.round(projection.timers.totalBatchesNeeded)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Next batch in</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.nextBatchInSec)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Dough requirement</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Batches needed</dt><dd className="font-semibold tabular-nums">{Math.round(projection.calc.batchesNeeded ?? 0).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Trays needed</dt><dd className="font-semibold tabular-nums">{Math.round(projection.calc.traysNeeded ?? 0).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Per tray</dt><dd className="font-semibold tabular-nums">{projection.calc.perTray ?? 0}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Per batch</dt><dd className="font-semibold tabular-nums">{projection.calc.perBatch ?? 0}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Dough made at</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.calc.doughMadeTimeSec ?? 0)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Batch setup</p>
        <div className="mt-3">
          <CommandField run={run} stationKey="dough" fieldKey="traysPerBatch"
            label="Trays per batch" online={online} onUpdated={onUpdated} />
        </div>
        {shortCases > 0 ? (
          <div className="error-banner mt-4" role="alert">
            Dough is short {Math.round(shortCases).toLocaleString()} cases for this run.
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">Dough supply covers the full run.</p>
        )}
      </section>
    </div>
  );
}

function SummaryTab({ snapshot }: { snapshot: OperationalSnapshot }) {
  const { view, projection } = snapshot;
  const paceLabel = view.pace.paceStatus === "ahead" ? `Ahead ${Math.abs(view.pace.paceDelta).toFixed(1)} cases`
    : view.pace.paceStatus === "behind" ? `Behind ${Math.abs(view.pace.paceDelta).toFixed(1)} cases`
    : "On pace";
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <section className="panel">
        <p className="eyebrow">Recap</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases needed</dt><dd className="font-semibold tabular-nums">{Math.round(view.recap.casesNeeded).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases completed</dt><dd className="font-semibold tabular-nums">{Math.round(view.recap.casesCompleted).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases left to run</dt><dd className="font-semibold tabular-nums">{Math.round(view.recap.casesLeftToRun).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Extra cases</dt><dd className="font-semibold tabular-nums">{Math.round(view.recap.extraCases).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Press</dt><dd className="font-semibold">{view.recap.pressDone ? "Done" : "Open"}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Pace</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Line speed</dt><dd className="font-semibold tabular-nums">{view.pace.ppm.toFixed(1)} cases/min</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd className="font-semibold">{paceLabel}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Catch-up speed</dt><dd className="font-semibold tabular-nums">{view.pace.catchUpPpm > 0 ? `${view.pace.catchUpPpm.toFixed(1)} cases/min` : "—"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Batch elapsed</dt><dd className="font-semibold tabular-nums">{formatElapsed(view.elapsed.batchSec)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Line</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Run status</dt><dd className="font-semibold">{statusLabel(view.observed.status)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Elapsed (pauses excluded)</dt><dd className="font-semibold tabular-nums">{formatElapsed(view.observed.elapsedBatchSec)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Stoppages</dt><dd className="font-semibold tabular-nums">{view.observed.stoppages.count}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Downtime</dt><dd className="font-semibold tabular-nums">{formatElapsed(view.observed.stoppages.downtimeSeconds)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Projection timers</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Next batch in</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.nextBatchInSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Press remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.pressRemainingSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Freezer remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.freezerRemainingSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Data freshness</dt><dd className="font-semibold">{view.freshness.status === "fresh" ? "Fresh" : "Stale"}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function statusLabel(status: string) {
  return status === "not-started" ? "Not started"
    : status === "running" ? "Running"
    : status === "paused" ? "Paused"
    : "Finished";
}

export function RunOperationalTabs({ run, online, onUpdated }: { run: Run; online: boolean; onUpdated: (run: Run, notice?: string) => void }) {
  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<OperationalTab>("run");
  const [error, setError] = useState<string | null>(null);
  const runId = run.id;

  const refresh = useCallback(async () => {
    if (!online) {
      setError("Offline: showing only the last operational snapshot confirmed by the server.");
      return;
    }
    try {
      const next = await getOperationalSnapshot(runId);
      // 304 resolves to null; the rendered snapshot stays.
      if (next) setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError
        ? cause.message
        : "The operational read could not be refreshed. Retry when connected.");
    }
  }, [online, runId]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const scheduleNextPoll = () => {
      // ±20% jitter keeps floor tablets from polling in lockstep; each
      // consecutive 304 stretches the cadence (an untouched run backs off to
      // 8 s) and any fresh payload snaps it back to the 2 s base pace.
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === "visible") void refresh();
        scheduleNextPoll();
      }, operationalPollDelayMs(runId) + Math.floor(Math.random() * 800));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resetOperationalPollBackoff(runId);
        window.clearTimeout(timer);
        void refresh();
        scheduleNextPoll();
      }
    };
    void refresh();
    scheduleNextPoll();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh, runId]);

  return (
    <section className="mt-5 min-w-0" aria-label="Operational station read">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border" role="tablist" aria-label="Station tabs">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${activeTab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
        {snapshot ? (
          <span className="pb-2 text-xs text-muted-foreground tabular-nums">
            Revision {snapshot.revision} · computed {new Date(snapshot.serverTimeMs).toLocaleTimeString()}
          </span>
        ) : null}
      </div>
      {error ? <div className="error-banner mt-4" role="alert">{error}</div> : null}
      <div className="mt-4">
        {snapshot ? (
          activeTab === "run" ? <RunTab run={run} snapshot={snapshot} online={online} onUpdated={onUpdated} />
          : activeTab === "dough" ? <DoughTab run={run} snapshot={snapshot} online={online} onUpdated={onUpdated} />
          : <SummaryTab snapshot={snapshot} />
        ) : (
          <p className="py-6 text-sm text-muted-foreground">{online ? "Reading operational state…" : "Operational state refreshes when the connection returns."}</p>
        )}
      </div>
    </section>
  );
}
