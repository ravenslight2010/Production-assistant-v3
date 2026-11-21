import { calculateScheduleTimeline } from "../../../core/schedule-planning.mjs";
import type { ProductionSchedule, Run, ScheduleCatalog } from "../api";
import { formatScheduleClock, formatScheduleDuration, scheduleRunTitle } from "./schedule-utils";

function actualRunDate(run: Run): string {
  const value = run.startedAt ?? run.createdAt ?? run.updatedAt;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const date = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${date.year}-${date.month}-${date.day}`;
}

export function ScheduleTimeline({
  schedule,
  catalog,
  liveRuns,
}: {
  schedule: ProductionSchedule;
  catalog: ScheduleCatalog;
  liveRuns: Run[];
}) {
  const timeline = calculateScheduleTimeline(schedule, catalog.templates);
  const estimates = new Map(timeline.runs.map((item) => [item.runId, item]));
  const matchingLiveRuns = liveRuns.filter((run) => actualRunDate(run) === schedule.date);

  return (
    <section className="panel" aria-labelledby="schedule-timeline-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Planning estimate</p>
          <h2 id="schedule-timeline-heading" className="mt-1 text-lg font-semibold">Estimated timeline</h2>
        </div>
        <span className="status-pill">{schedule.productionStartTime} Central</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Estimates start at {schedule.productionStartTime} unless production has already begun today. Missing duration inputs remain unknown.
      </p>

      <ol className="mt-5 divide-y divide-border/70 border-y border-border/70">
        {schedule.runs.map((run) => {
          const estimate = estimates.get(run.id);
          const attachedBreaks = timeline.breaks.filter((item) => item.status !== "unassigned"
            && schedule.breaks.find((value) => value.slot === item.slot)?.runId === run.id);
          return (
            <li key={run.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className="text-sm leading-6">{scheduleRunTitle(run, catalog)}</strong>
                <span className="font-mono text-xs text-amber-400">{run.effectiveTargetCases ?? run.targetCases} effective / {run.targetCases} planned cases</span>
              </div>
              {run.carriedInCases !== undefined ? <p className="mt-1 text-xs text-amber-300">{run.carriedInCases} freezer carry-in cases · no repeat ingredient deduction</p> : null}
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {estimate?.startMs === undefined
                  ? "Planned start unknown"
                  : `Planned start ${formatScheduleClock(estimate.startMs)}${estimate.finishMs === undefined ? "" : ` · planned end ${formatScheduleClock(estimate.finishMs)}`}`}
                {" · "}{formatScheduleDuration(estimate?.durationSec)}
              </p>
              {attachedBreaks.map((item) => (
                <p key={item.slot} className="mt-2 text-xs text-amber-300">
                  Break {item.slot} · 30 minutes · {item.startMs === undefined
                    ? "time unknown"
                    : `${formatScheduleClock(item.startMs)}–${formatScheduleClock(item.finishMs)}`}
                </p>
              ))}
            </li>
          );
        })}
        {timeline.breaks.filter((item) => item.status === "unassigned").map((item) => (
          <li key={`unassigned-${item.slot}`} className="py-3 text-xs text-amber-300">
            Break {item.slot} · 30 minutes · choose a planned run
          </li>
        ))}
        {schedule.runs.length === 0 ? <li className="py-4 text-sm text-muted-foreground">Add runs to estimate the planned timeline.</li> : null}
      </ol>

      <p className="mt-4 text-sm leading-6 text-muted-foreground" role="status">
        {timeline.projectedFinishMs === undefined
          ? "Planned finish is unknown until every run has enough duration inputs and enabled breaks are assigned."
          : `Estimated planned finish: ${formatScheduleClock(timeline.projectedFinishMs)}. This is not an actual run completion time.`}
      </p>

      <div className="mt-6 border-t border-border/70 pt-5">
        <h3 className="text-sm font-semibold">Live runs on {schedule.date}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Actual runs remain separate from this planned schedule.</p>
        {matchingLiveRuns.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No V3 live runs are recorded for this production date.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {matchingLiveRuns.map((run) => (
              <li key={run.id} className="text-sm">
                <strong>{run.setupSnapshot.label} · {run.status.replaceAll("_", " ")}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {run.startedAt ? `Started ${formatScheduleClock(Date.parse(run.startedAt))}` : "Not started"} · run {run.id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
