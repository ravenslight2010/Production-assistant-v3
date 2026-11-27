import { useRef, useState } from "react";
import { ApiError, applyRunCommand, type Run, type RunCommand } from "../api";
import { RunToTimeControl } from "./RunToTimeControl";
import { RunOperationsPanel } from "./RunOperationsPanel";
import { EffectiveProductionPlan } from "./EffectiveProductionPlan";
import { RunOperationalTabs } from "./RunOperationalTabs";

const commands: Record<Run["status"], RunCommand[]> = {
  planned: ["start"],
  running: ["pause", "complete"],
  paused: ["resume", "complete"],
  completed: [],
};

export function RunDetail({ run, online, canManageReasons, canManageProfiles, onUpdated }: {
  run: Run;
  online: boolean;
  canManageReasons: boolean;
  canManageProfiles: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const [pending, setPending] = useState<RunCommand | null>(null);
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
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="metric"><dt>Target</dt><dd>{run.setupSnapshot.targetCases} cases</dd></div>
        <div className="metric"><dt>Product</dt><dd>{run.setupSnapshot.productCode ?? "—"}</dd></div>
        <div className="metric"><dt>Production date</dt><dd>{run.productionDate}</dd></div>
        <div className="metric"><dt>Revision</dt><dd>{run.revision}</dd></div>
        <div className="metric"><dt>Server update</dt><dd>{new Date(run.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
      </dl>
      <EffectiveProductionPlan run={run} />
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
      {run.status !== "planned" ? <RunOperationalTabs run={run} online={online} canManageProfiles={canManageProfiles} onUpdated={onUpdated} /> : null}
    </section>
  );
}
