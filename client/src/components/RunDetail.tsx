import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, applyRunCommand, applyStationCommand, type Run, type RunCommand, type StationKey } from "../api";
import { RunToTimeControl } from "./RunToTimeControl";
import { RunOperationsPanel } from "./RunOperationsPanel";

const stationOrder: StationKey[] = ["line", "dough", "cheese", "pepperoni", "sauce", "frontline", "packaging"];
const stationFields: Record<StationKey, { inputs: string[]; progress: string[] }> = {
  line: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"], progress: ["casesProduced", "casesOnLine", "casesInFreezer"] },
  dough: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "traysPerBatch"], progress: ["casesProduced", "traysOnLine", "batchesReady", "batchesMade"] },
  cheese: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"], progress: ["casesCompleted", "batchesMade", "stockOnLineLbs"] },
  pepperoni: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"], progress: ["casesCompleted", "batchesMade", "stockOnLineLbs"] },
  sauce: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "barrelLbs"], progress: ["barrelsMade", "stockBarrels"] },
  frontline: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"], progress: ["batchesMade", "stockOnLineLbs", "stockConsumedLbs"] },
  packaging: { inputs: ["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"], progress: ["casesPacked"] },
};
const commands: Record<Run["status"], RunCommand[]> = {
  planned: ["start"],
  running: ["pause", "complete"],
  paused: ["resume", "complete"],
  completed: [],
};

function fieldLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function StationCard({ run, stationKey, online, onUpdated }: {
  run: Run;
  stationKey: StationKey;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const station = run.stationProgress[stationKey] ?? {
    status: "not_started", revision: 0, inputs: {}, progress: {},
    startedAt: null, pausedAt: null, completedAt: null, nextDueAt: null, updatedAt: run.updatedAt,
  };
  const definition = stationFields[stationKey];
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries([...definition.inputs, ...definition.progress].map((key) => {
      const confirmed = station.inputs[key] ?? station.progress[key];
      const fallback = definition.progress.includes(key) || key === "autoTrackRatePerMinute" ? "0" : "";
      return [key, typeof confirmed === "number" && Number.isFinite(confirmed) ? String(confirmed) : fallback];
    })));
    commandId.current = null;
  }, [run.id, run.revision, stationKey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const changes = Object.fromEntries(Object.entries(values)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => [key, Number(value)]));
    if (Object.values(changes).some((value) => !Number.isFinite(value) || value < 0)) {
      setError("Station values must be non-negative numbers.");
      return;
    }
    if (Object.keys(changes).length === 0) {
      setError("Enter at least one station value before saving.");
      return;
    }
    commandId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await applyStationCommand(run, stationKey, changes, commandId.current);
      commandId.current = null;
      onUpdated(result.run, result.conflict
        ? "Stale station change discarded; the latest server state is now displayed."
        : "Station change confirmed by the server.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Station update failed. Refresh before retrying.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="rounded-xl border border-border/70 bg-background/45 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold capitalize">{stationKey}</h3>
        <span className="status-pill">{station.status.replace("_", " ")}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">station revision {station.revision}</span>
      </div>
      <form className="mt-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(values).map(([key, value]) => (
            <label key={key} className="text-xs font-medium text-muted-foreground">{fieldLabel(key)}
              <input className="field mt-1.5 text-sm text-foreground" type="number" min={0} step="any" inputMode="decimal" value={value} onChange={(event) => {
                commandId.current = null;
                setValues((current) => ({ ...current, [key]: event.target.value }));
              }} />
            </label>
          ))}
        </div>
        {Object.keys(values).length === 0 ? <p className="text-xs text-muted-foreground">No manual numeric inputs are defined for this station.</p> : null}
        {error ? <p className="error-text mt-3" role="alert">{error}</p> : null}
        {Object.keys(values).length > 0 ? (
          <button type="submit" className="button-secondary mt-4" disabled={!online || pending || run.status !== "running"}>
            {pending ? "Confirming…" : run.status === "running" ? "Save station update" : "Start run to edit stations"}
          </button>
        ) : null}
      </form>
    </article>
  );
}

export function RunDetail({ run, online, canManageReasons, onUpdated }: {
  run: Run;
  online: boolean;
  canManageReasons: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const [pending, setPending] = useState<RunCommand | null>(null);
  const [selectedStation, setSelectedStation] = useState<StationKey>("line");
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<RunCommand, string>());

  async function execute(commandType: RunCommand) {
    setError(null);
    const commandId = commandIds.current.get(commandType) ?? crypto.randomUUID();
    commandIds.current.set(commandType, commandId);
    setPending(commandType);
    try {
      const result = await applyRunCommand(run, commandType, commandId);
      commandIds.current.delete(commandType);
      onUpdated(result.run, result.conflict
        ? `Stale ${commandType} command discarded; the latest server state is now displayed.`
        : `${commandType} confirmed by the server.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The command failed. Refresh and retry when connected.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="current-run-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Current run</p>
          <h2 id="current-run-heading" className="mt-1 text-xl font-bold">{run.setupSnapshot.label}</h2>
        </div>
        <span className={`status-pill status-${run.status}`}>{run.status}</span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="metric"><dt>Target</dt><dd>{run.setupSnapshot.targetCases} cases</dd></div>
        <div className="metric"><dt>Product</dt><dd>{run.setupSnapshot.productCode ?? "—"}</dd></div>
        <div className="metric"><dt>Revision</dt><dd>{run.revision}</dd></div>
        <div className="metric"><dt>Server update</dt><dd>{new Date(run.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
      </dl>
      <RunToTimeControl run={run} online={online} onUpdated={onUpdated} />
      <RunOperationsPanel run={run} online={online} canManageReasons={canManageReasons} onUpdated={onUpdated} />
      {run.productionRules?.length ? (
        <div className="mt-4 rounded-lg border border-border p-3 text-xs text-muted-foreground">
          Production rules: {run.productionRules.map((rule) => `${rule.name}: ${rule.status}`).join(" · ")}
        </div>
      ) : null}
      {run.inventoryConsumption ? <p className="mt-4 text-xs text-emerald-300">Completion inventory receipt recorded; consumption is exact-once.</p> : null}
      {error ? <p className="error-text mt-4" role="alert">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {commands[run.status].map((command) => (
          <button key={command} type="button" className={command === "complete" ? "button-primary capitalize" : "button-secondary capitalize"} disabled={!online || pending !== null} onClick={() => void execute(command)}>
            {pending === command ? `${command} pending…` : command}
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Station progress</h3>
          <span className="text-xs text-muted-foreground">Manual updates only; the worker owns automatic progress.</span>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Production stations">
          {stationOrder.map((stationKey) => (
            <button key={stationKey} type="button" role="tab" aria-selected={selectedStation === stationKey}
              className={`nav-tab ${selectedStation === stationKey ? "nav-tab-active" : ""}`}
              onClick={() => setSelectedStation(stationKey)}>{stationKey}</button>
          ))}
        </div>
        <StationCard key={selectedStation} run={run} stationKey={selectedStation} online={online} onUpdated={onUpdated} />
      </div>
    </section>
  );
}
