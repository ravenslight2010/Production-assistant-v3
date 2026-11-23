import { useEffect, useRef, useState } from "react";
import { ApiError, applyRunToTime, type Run } from "../api";
import { centralDate } from "../../../core/schedule-planning.mjs";
import {
  DEFAULT_RUN_TO_TIME,
  normalizeRunToTimeInput,
  remainingRunToTimeSeconds,
} from "../../../core/run-to-time.mjs";

function displayTime(value: string): string {
  const normalized = normalizeRunToTimeInput(value);
  if (!normalized) return value;
  const [hourValue, minute] = normalized.split(":");
  const hour = Number(hourValue);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function remainingLabel(seconds: number | null): string {
  if (seconds === null) return "Countdown unavailable";
  if (seconds === 0) return "Target reached";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s remaining`
    : `${minutes}m ${String(remainder).padStart(2, "0")}s remaining`;
}

export function RunToTimeControl({ run, online, onUpdated }: {
  run: Run;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const [draft, setDraft] = useState(run.runToTime);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const commandId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const clockAnchor = useRef({ serverNow: run.serverNow, clientNow: Date.now() });
  const readOnly = !online || run.status === "completed";

  useEffect(() => {
    setDraft(run.runToTime);
    setError(null);
    commandId.current = null;
  }, [run.id, run.revision, run.runToTime]);

  useEffect(() => {
    clockAnchor.current = { serverNow: run.serverNow, clientNow: Date.now() };
  }, [run.id, run.serverNow]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const canonicalNow = Date.parse(clockAnchor.current.serverNow)
    + Date.now() - clockAnchor.current.clientNow;
  const productionDate = centralDate(canonicalNow);
  const remaining = remainingRunToTimeSeconds({
    productionDate,
    runToTime: run.runToTime,
    serverNow: new Date(canonicalNow).toISOString(),
  });

  async function commit(value = draft) {
    if (inFlight.current || readOnly) return;
    const normalized = normalizeRunToTimeInput(value);
    if (!normalized) {
      setError("Enter a valid time, such as 7:15 PM or 19:15.");
      return;
    }
    setDraft(normalized);
    setError(null);
    if (normalized === run.runToTime) return;

    commandId.current ??= crypto.randomUUID();
    inFlight.current = true;
    setPending(true);
    try {
      const result = await applyRunToTime(run, normalized, commandId.current);
      commandId.current = null;
      onUpdated(result.run, result.conflict
        ? "Run to Time changed elsewhere; the latest server state is now displayed."
        : `Run to Time confirmed for ${displayTime(result.run.runToTime)} Central.`);
    } catch (cause) {
      setError(cause instanceof ApiError
        ? cause.message
        : "Run to Time was not confirmed. Retry the same change when connected.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-border/70 bg-background/45 p-4" aria-labelledby="run-to-time-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="run-to-time-heading" className="text-sm font-semibold">Run to Time</h3>
          <p className="mt-1 text-xs text-muted-foreground">Today’s Central-time operator target. Informational only; it never starts runs or advances worker progress.</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{displayTime(run.runToTime)}</p>
          <p className="text-xs text-muted-foreground" aria-live="off">{remainingLabel(remaining)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-44 flex-1 text-xs font-medium" htmlFor={`run-to-time-${run.id}`}>
          Target time (Central)
          <input
            id={`run-to-time-${run.id}`}
            className="field mt-1.5 text-sm"
            value={draft}
            disabled={readOnly || pending}
            placeholder="7:15 PM"
            autoComplete="off"
            onChange={(event) => {
              commandId.current = null;
              setDraft(event.target.value);
            }}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <button type="button" className="button-secondary" disabled={readOnly || pending} onClick={() => void commit()}>
          {pending ? "Confirming…" : "Save target"}
        </button>
        <button type="button" className="button-secondary" disabled={readOnly || pending} onClick={() => {
          commandId.current = null;
          setDraft(DEFAULT_RUN_TO_TIME);
          void commit(DEFAULT_RUN_TO_TIME);
        }}>Reset to 7:15 PM</button>
      </div>
      {run.status === "completed" ? <p className="mt-3 text-xs text-muted-foreground">Completed runs are read-only.</p> : null}
      {!online && run.status !== "completed" ? <p className="mt-3 text-xs text-muted-foreground">Reconnect to change the server-owned target.</p> : null}
      {error ? <p className="error-text mt-3" role="alert">{error}</p> : null}
    </section>
  );
}
