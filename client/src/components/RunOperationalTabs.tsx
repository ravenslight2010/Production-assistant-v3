import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getOperationalSnapshot,
  operationalPollDelayMs,
  resetOperationalPollBackoff,
  type OperationalSnapshot,
  type Run,
} from "../api";

// Station tabs render the server-owned operational read; every number comes
// from the payload and every mutation goes through the command APIs. v1's
// tab capabilities arrive slice by slice — Summary first, then the station
// tabs, then stoppages.
const TABS = ["summary"] as const;
type OperationalTab = (typeof TABS)[number];

const tabLabels: Record<OperationalTab, string> = {
  summary: "Summary",
};

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  return status === "not-started" ? "Not started"
    : status === "running" ? "Running"
    : status === "paused" ? "Paused"
    : "Finished";
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

export function RunOperationalTabs({ run, online }: { run: Run; online: boolean }) {
  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<OperationalTab>("summary");
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
      // 12 s) and any fresh payload snaps it back to the 2 s base pace.
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
        {snapshot ? <SummaryTab snapshot={snapshot} /> : (
          <p className="py-6 text-sm text-muted-foreground">{online ? "Reading operational state…" : "Operational state refreshes when the connection returns."}</p>
        )}
      </div>
    </section>
  );
}
