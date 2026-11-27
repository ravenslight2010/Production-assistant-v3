import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TriangleAlert, Wand2 } from "lucide-react";
import {
  ApiError,
  applyLineTiming,
  applyStationCommand,
  getOperationalSnapshot,
  getRunFillMissing,
  operationalPollDelayMs,
  resetOperationalPollBackoff,
  saveFillMissingValues,
  type FillMissingGap,
  type FillMissingScan,
  type OperationalSnapshot,
  type Run,
  type RunLineTiming,
  type StationKey,
} from "../api";

// Station tabs render the server-owned operational read; every number comes
// from the payload and every mutation goes through the command APIs. v1's
// tab capabilities arrive slice by slice — Run and Dough first, then the
// remaining stations, then stoppages.
const TABS = ["run", "dough", "sauce", "frontline", "packaging", "stoppages", "summary"] as const;
type OperationalTab = (typeof TABS)[number];

const tabLabels: Record<OperationalTab, string> = {
  run: "Run",
  dough: "Dough",
  sauce: "Sauce",
  frontline: "Frontline",
  packaging: "Packaging",
  stoppages: "Stoppages",
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
 * One editable station value (input or progress): shows the server-confirmed
 * value, accepts a draft, and commits through the station command API with
 * exact-once replay protection. Conflicts surface as a notice, never a
 * silent loss. Edits are open only while the run is running, matching the
 * station-card rule the tabs replace.
 */
function CommandField({ run, stationKey, fieldKey, label, unit, kind = "inputs", online, onUpdated }: {
  run: Run;
  stationKey: StationKey;
  fieldKey: string;
  label: string;
  unit?: string;
  kind?: "inputs" | "progress";
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const confirmed = run.stationProgress[stationKey]?.[kind]?.[fieldKey];
  const editable = online && run.status === "running";
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
            disabled={!editable || pending}
            onChange={(event) => { commandId.current = null; setDraft(event.target.value); }} />
          {unit ? <span className="text-muted-foreground">{unit}</span> : null}
        </span>
      </label>
      <button type="submit" className="button-secondary" disabled={!editable || pending || draft === ""}>
        {pending ? "Saving…" : "Save"}
      </button>
      {error ? <span className="error-text w-full" role="alert">{error}</span> : null}
    </form>
  );
}

// v1's LineTransitSettings: adjust the reviewed die-line transit timings of
// a live run. preTunnelMin is server-derived as pressOvenMin + frontlineMin;
// the amber warning is client-side math (same rule as v1) and never blocks.
const TIMING_FIELDS = [
  { key: "pressOvenMin", label: "Press/Oven transit" },
  { key: "frontlineMin", label: "Frontline transit" },
  { key: "postTunnelMin", label: "Wrapper/Packaging transit" },
  { key: "freezerTime", label: "Total line freeze time" },
] as const;
type TimingFieldKey = (typeof TIMING_FIELDS)[number]["key"];

function LineTimingEditor({ run, online, onUpdated }: {
  run: Run;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const lineSettings = run.setupSnapshot.dieSetup?.lineSettings;
  const editable = online && ["planned", "running", "paused"].includes(run.status);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<TimingFieldKey, string>>({
    pressOvenMin: "", frontlineMin: "", postTunnelMin: "", freezerTime: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);

  if (!lineSettings) return null;

  const current = (key: TimingFieldKey): number => lineSettings[key] ?? 0;
  const draftValue = (key: TimingFieldKey): number => {
    const raw = drafts[key];
    return raw === "" ? current(key) : Number(raw);
  };
  const preTunnel = draftValue("pressOvenMin") + draftValue("frontlineMin");
  const total = preTunnel + draftValue("freezerTime") + draftValue("postTunnelMin");
  const sectionExceeds = preTunnel + draftValue("postTunnelMin") > draftValue("freezerTime");
  const unchanged = TIMING_FIELDS.every((field) => drafts[field.key] === "" || draftValue(field.key) === current(field.key));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const timing: RunLineTiming = {};
    for (const field of TIMING_FIELDS) {
      const raw = drafts[field.key];
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError("Enter non-negative numbers, or leave a field blank to keep its current value.");
        return;
      }
      if (value !== current(field.key)) timing[field.key] = value;
    }
    if (Object.keys(timing).length === 0) {
      setOpen(false);
      return;
    }
    commandId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await applyLineTiming(run, timing, commandId.current);
      commandId.current = null;
      setDrafts({ pressOvenMin: "", frontlineMin: "", postTunnelMin: "", freezerTime: "" });
      setOpen(false);
      onUpdated(result.run, result.conflict
        ? "Stale change discarded; the latest server state is now displayed."
        : "Line timing confirmed by the server.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Line timing update failed. Refresh before retrying.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      {open ? (
        <form onSubmit={submit} className="grid gap-2" aria-label="Adjust line timing">
          {TIMING_FIELDS.map((field) => (
            <label key={field.key} className="text-xs font-medium text-muted-foreground">
              {field.label}
              <input
                className="field mt-1 w-full text-sm text-foreground"
                type="number" min={0} step="any" inputMode="decimal"
                placeholder={String(current(field.key))}
                value={drafts[field.key]}
                disabled={!editable || pending}
                onChange={(event) => { commandId.current = null; setDrafts((prior) => ({ ...prior, [field.key]: event.target.value })); }}
              />
            </label>
          ))}
          <dl className="mt-1 space-y-1 text-sm">
            <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Pre-tunnel (derived)</dt><dd className="font-semibold tabular-nums">{preTunnel.toFixed(1)} min</dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Total line time (derived)</dt><dd className="font-semibold tabular-nums">{total.toFixed(1)} min</dd></div>
          </dl>
          {sectionExceeds ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-600" role="alert">
              <TriangleAlert className="size-3.5" /> Section times exceed total line freeze time
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" className="button-secondary" disabled={!editable || pending || unchanged}>
              {pending ? "Saving…" : "Save timing"}
            </button>
            <button type="button" className="button-secondary" disabled={pending}
              onClick={() => { setOpen(false); setError(null); setDrafts({ pressOvenMin: "", frontlineMin: "", postTunnelMin: "", freezerTime: "" }); }}>
              Cancel
            </button>
          </div>
          {error ? <span className="error-text" role="alert">{error}</span> : null}
        </form>
      ) : (
        <button type="button" className="button-secondary" disabled={!editable}
          onClick={() => setOpen(true)}>
          Adjust line timing
        </button>
      )}
    </div>
  );
}

const FILL_MISSING_CATEGORIES: FillMissingGap["category"][] = ["line", "dough", "cheese", "pepperoni", "sauce", "frontline"];

// v1's FillMissing panel, ported to the run cockpit: one server-side scan
// reports every blank station input the calculator consumes, each with a
// proposal (learned > catalog) and a one-click apply routed through the
// existing station command. The scan never writes; confirmed values are
// committed field by field, exactly as v1 did.
function FillMissingPanel({ run, online, canManageProfiles, onUpdated }: {
  run: Run;
  online: boolean;
  canManageProfiles: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const [scan, setScan] = useState<FillMissingScan | null>(null);
  const [scanned, setScanned] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());
  const editable = online && ["planned", "running", "paused"].includes(run.status);

  async function scanNow() {
    setError(null);
    setScanning(true);
    try {
      const result = await getRunFillMissing(run.id);
      setScan(result);
      setScanned(true);
      setSkipped([]);
      setDrafts({});
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The scan failed. Refresh and retry when connected.");
    } finally {
      setScanning(false);
    }
  }

  const gaps = scan ? scan.gaps.filter((gap) => !skipped.includes(gap.key)) : [];
  const groups = FILL_MISSING_CATEGORIES
    .map((category) => [category, gaps.filter((gap) => gap.category === category)] as const)
    .filter(([, list]) => list.length > 0);
  const productCode = scan?.productCode ?? run.setupSnapshot.productCode;

  async function applyGap(gap: FillMissingGap) {
    const raw = drafts[gap.key] ?? (gap.proposedValue != null ? String(gap.proposedValue) : "");
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setError(`Enter a positive number for ${gap.label}.`);
      return;
    }
    setError(null);
    let commandId = commandIds.current.get(gap.key);
    if (!commandId) {
      commandId = crypto.randomUUID();
      commandIds.current.set(gap.key, commandId);
    }
    setPendingKey(gap.key);
    try {
      const result = await applyStationCommand(
        run,
        gap.apply.station as StationKey,
        { [gap.apply.field]: value },
        commandId,
      );
      commandIds.current.delete(gap.key);
      // v1's one-click remember: after the server confirms the value, offer
      // to store it as a learned value for this product. Best effort — the
      // fill itself already landed.
      if (remember && canManageProfiles && productCode) {
        try {
          await saveFillMissingValues([{ productCode, fieldKey: gap.key, value: String(value) }]);
        } catch {
          // The fill landed; failing to remember must not surface an error.
        }
      }
      setScan((prior) => prior ? { ...prior, gaps: prior.gaps.filter((item) => item.key !== gap.key) } : prior);
      onUpdated(result.run, result.conflict
        ? "Stale change discarded; the latest server state is now displayed."
        : `${gap.label} confirmed by the server.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : `${gap.label} could not be applied. Refresh before retrying.`);
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Missing data</p>
        <button type="button" className="button-secondary" disabled={!editable || scanning} onClick={() => void scanNow()}>
          <Wand2 className="mr-1 inline size-3.5" />
          {scanning ? "Scanning…" : scanned ? "Rescan" : "Scan for missing data"}
        </button>
      </div>
      {!scanned ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Find blank station inputs this run's calculator needs, with proposals from remembered and catalog values.
        </p>
      ) : null}
      {scanned && gaps.length === 0 ? (
        <div className="notice-banner mt-3" role="status">No missing data found.</div>
      ) : null}
      {groups.map(([category, list]) => (
        <div key={category} className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</p>
          <ul className="mt-1 divide-y divide-border">
            {list.map((gap) => (
              <li key={gap.key} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-40 flex-1 text-sm font-medium">{gap.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {gap.source === "learned" ? "Learned" : gap.source === "catalog" ? "Catalog" : "No suggestion"}
                </span>
                <input
                  className="field w-24 text-sm text-foreground"
                  type="number" min={0} step="any" inputMode="decimal"
                  aria-label={gap.label}
                  placeholder={gap.proposedValue != null ? String(gap.proposedValue) : "blank"}
                  value={drafts[gap.key] ?? ""}
                  disabled={!editable || pendingKey !== null}
                  onChange={(event) => { commandIds.current.delete(gap.key); setDrafts((prior) => ({ ...prior, [gap.key]: event.target.value })); }}
                />
                <button type="button" className="button-secondary" disabled={!editable || pendingKey !== null}
                  onClick={() => void applyGap(gap)}>
                  {pendingKey === gap.key ? "Applying…" : "Apply"}
                </button>
                <button type="button" className="text-xs underline text-muted-foreground disabled:opacity-50"
                  disabled={pendingKey !== null}
                  onClick={() => setSkipped((prior) => [...prior, gap.key])}>
                  Skip
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {canManageProfiles && productCode && gaps.length > 0 ? (
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Remember confirmed values for {productCode}
        </label>
      ) : null}
      {error ? <span className="error-text mt-2 block" role="alert">{error}</span> : null}
    </div>
  );
}

function RunTab({ run, snapshot, online, canManageProfiles, onUpdated }: {
  run: Run;
  snapshot: OperationalSnapshot;
  online: boolean;
  canManageProfiles: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const { view, projection } = snapshot;
  const finishMs = projectedFinishMs(run, projection.calc);
  return (
    <>
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
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Projected finish</dt><dd className="shrink-0 font-semibold tabular-nums">{finishMs != null ? new Date(finishMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Planned run time</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.calc.totalTimeSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Adjusted run time</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.calc.adjustedTimeSec ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Press remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.pressRemainingSec)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Freezer remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.freezerRemainingSec)}</dd></div>
        </dl>
        <LineTimingEditor run={run} online={online} onUpdated={onUpdated} />
      </section>
      <section className="panel">
        <p className="eyebrow">Batch</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Batch</dt><dd className="font-semibold tabular-nums">{Math.round(projection.timers.currentBatchNum)} of {Math.round(projection.timers.totalBatchesNeeded)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Next batch in</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.nextBatchInSec)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases left to press</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.pressCasesLeft).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Press</dt><dd className="font-semibold">{view.recap.pressDone ? "Done" : "Open"}</dd></div>
        </dl>
        <div className="mt-4">
          <CommandField run={run} stationKey="line" fieldKey="casesProduced" kind="progress"
            label="Cases produced" online={online} onUpdated={onUpdated} />
        </div>
      </section>
      </div>
      <FillMissingPanel run={run} online={online} canManageProfiles={canManageProfiles} onUpdated={onUpdated} />
    </>
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
        <div className="mt-3 space-y-3">
          <CommandField run={run} stationKey="dough" fieldKey="traysPerBatch"
            label="Trays per batch" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="dough" fieldKey="traysOnLine" kind="progress"
            label="Trays on line" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="dough" fieldKey="batchesReady" kind="progress"
            label="Batches ready" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="dough" fieldKey="batchesMade" kind="progress"
            label="Batches made" online={online} onUpdated={onUpdated} />
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

function SauceTab({ run, snapshot, online, onUpdated }: {
  run: Run;
  snapshot: OperationalSnapshot;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const { projection } = snapshot;
  const remainingSec = Math.max(0, (projection.calc.adjustedTimeSec ?? 0) - projection.effectiveElapsedSec);
  const depletionSec = projection.calc.sauceDepletionSec ?? 0;
  const short = remainingSec > 0 && depletionSec > 0 && depletionSec < remainingSec;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <section className="panel">
        <p className="eyebrow">Barrel position</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Barrels made</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.sauceBarrelsMade).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Effective barrel</dt><dd className="font-semibold tabular-nums">{(projection.calc.sauceEffBarrel ?? 0).toFixed(2)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Sauce batches</dt><dd className="font-semibold tabular-nums">{Math.round(projection.calc.sauceBatches ?? 0).toLocaleString()}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Supply</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Supply covers</dt><dd className="font-semibold tabular-nums">{depletionSec > 0 ? formatElapsed(depletionSec) : "—"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Run time remaining</dt><dd className="font-semibold tabular-nums">{formatElapsed(remainingSec)}</dd></div>
        </dl>
        {short ? (
          <div className="error-banner mt-4" role="alert">
            Sauce runs out in {formatElapsed(depletionSec)} — {formatElapsed(remainingSec - depletionSec)} short of the remaining run.
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">Sauce supply covers the remaining run.</p>
        )}
      </section>
      <section className="panel">
        <p className="eyebrow">Barrel setup</p>
        <div className="mt-3 space-y-3">
          <CommandField run={run} stationKey="sauce" fieldKey="barrelLbs"
            label="Barrel size" unit="lb" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="sauce" fieldKey="barrelsMade" kind="progress"
            label="Barrels made" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="sauce" fieldKey="stockBarrels" kind="progress"
            label="Stock barrels" online={online} onUpdated={onUpdated} />
        </div>
      </section>
    </div>
  );
}

function FrontlineTab({ run, snapshot, online, onUpdated }: {
  run: Run;
  snapshot: OperationalSnapshot;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const { projection } = snapshot;
  const applicators = [
    { n: 1, batches: projection.counters.app1BatchesMade, lbs: projection.calc.app1Lbs },
    { n: 2, batches: projection.counters.app2BatchesMade, lbs: projection.calc.app2Lbs },
    { n: 3, batches: projection.counters.app3BatchesMade, lbs: projection.calc.app3Lbs },
    { n: 4, batches: projection.counters.app4BatchesMade, lbs: projection.calc.app4Lbs },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <section className="panel sm:col-span-2 xl:col-span-2">
        <p className="eyebrow">Applicator batches</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-4 font-medium">Applicator</th>
                <th className="py-1 pr-4 text-right font-medium">Batches made</th>
                <th className="py-1 text-right font-medium">Pounds</th>
              </tr>
            </thead>
            <tbody>
              {applicators.map((app) => (
                <tr key={app.n} className="border-t border-border/60">
                  <td className="py-2 pr-4">Applicator {app.n}</td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums">{Math.round(app.batches).toLocaleString()}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{Math.round(app.lbs ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <p className="eyebrow">Toppings supply</p>
        {(["cheese", "pepperoni"] as const).map((stationKey) => (
          <div key={stationKey} className="mt-3 border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
            <p className="mb-2 text-sm font-semibold capitalize">{stationKey}</p>
            <div className="space-y-3">
              <CommandField run={run} stationKey={stationKey} fieldKey="batchesMade" kind="progress"
                label="Batches made" online={online} onUpdated={onUpdated} />
              <CommandField run={run} stationKey={stationKey} fieldKey="stockOnLineLbs" kind="progress"
                label="Stock on line" unit="lb" online={online} onUpdated={onUpdated} />
              <CommandField run={run} stationKey={stationKey} fieldKey="batchLbs"
                label="Batch size" unit="lb" online={online} onUpdated={onUpdated} />
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <p className="eyebrow">Batch setup</p>
        <div className="mt-3 space-y-3">
          <CommandField run={run} stationKey="frontline" fieldKey="batchLbs"
            label="Batch size" unit="lb" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="frontline" fieldKey="ozPerPizza"
            label="Ounces per pizza" unit="oz" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="frontline" fieldKey="batchesMade" kind="progress"
            label="Batches made" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="frontline" fieldKey="stockOnLineLbs" kind="progress"
            label="Stock on line" unit="lb" online={online} onUpdated={onUpdated} />
        </div>
      </section>
    </div>
  );
}

function PackagingTab({ run, snapshot, online, onUpdated }: {
  run: Run;
  snapshot: OperationalSnapshot;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const { projection } = snapshot;
  const packed = run.stationProgress.packaging?.progress?.casesPacked;
  const perSkid = run.stationProgress.packaging?.inputs?.casesPerSkid;
  const onLastSkid = projection.calc.casesOnLastSkid ?? 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <section className="panel">
        <p className="eyebrow">Skid building</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases packed</dt><dd className="font-semibold tabular-nums">{typeof packed === "number" ? Math.round(packed).toLocaleString() : "—"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Current skid</dt><dd className="font-semibold tabular-nums">{perSkid ? `${Math.round(onLastSkid)} of ${Math.round(perSkid)}` : `${Math.round(onLastSkid)}`}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Stacks needed</dt><dd className="font-semibold tabular-nums">{Math.round(projection.calc.stacksNeededTotal ?? 0).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases left to open</dt><dd className="font-semibold tabular-nums">{Math.round(projection.calc.casesLeftToOpen ?? 0).toLocaleString()}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Freeze tunnel</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases on line</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.casesOnLine).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Cases in freezer</dt><dd className="font-semibold tabular-nums">{Math.round(projection.counters.casesInFreezer).toLocaleString()}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Tunnel clears in</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.timers.freezerRemainingSec)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Time per skid</dt><dd className="font-semibold tabular-nums">{formatElapsed(projection.calc.timePerSkidSec ?? 0)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <p className="eyebrow">Skid setup</p>
        <div className="mt-3 space-y-3">
          <CommandField run={run} stationKey="packaging" fieldKey="casesPerSkid"
            label="Cases per skid" online={online} onUpdated={onUpdated} />
          <CommandField run={run} stationKey="packaging" fieldKey="casesPacked" kind="progress"
            label="Cases packed" online={online} onUpdated={onUpdated} />
        </div>
      </section>
    </div>
  );
}

function StoppagesTab({ run, snapshot }: { run: Run; snapshot: OperationalSnapshot }) {
  const { view } = snapshot;
  const entries = [...(run.stoppages ?? [])].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const typeLabel = (type: string) => type === "pause" ? "Pause" : type === "manual" ? "Manual" : "Stop";
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <section className="panel">
        <p className="eyebrow">Downtime summary</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Stoppages</dt><dd className="font-semibold tabular-nums">{view.observed.stoppages.count}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Downtime</dt><dd className="font-semibold tabular-nums">{formatElapsed(view.observed.stoppages.downtimeSeconds)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Elapsed (excl. pauses)</dt><dd className="font-semibold tabular-nums">{formatElapsed(view.observed.elapsedBatchSec)}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Log a stoppage from the line-stop controls above; entries land here on the next refresh.</p>
      </section>
      <section className="panel sm:col-span-2">
        <p className="eyebrow">Stoppage log</p>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No stoppages recorded for this run.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-4 font-medium">Type</th>
                  <th className="py-1 pr-4 font-medium">Reason</th>
                  <th className="py-1 pr-4 font-medium">Started</th>
                  <th className="py-1 pr-4 font-medium">Ended</th>
                  <th className="py-1 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const startedMs = Date.parse(entry.startedAt);
                  const endedMs = entry.endedAt ? Date.parse(entry.endedAt) : null;
                  return (
                    <tr key={entry.id} className="border-t border-border/60 align-top">
                      <td className="py-2 pr-4">{typeLabel(entry.type)}</td>
                      <td className="py-2 pr-4">
                        {entry.reason}
                        {entry.notes ? <span className="block text-xs text-muted-foreground">{entry.notes}</span> : null}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{Number.isFinite(startedMs) ? new Date(startedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="py-2 pr-4 tabular-nums">{endedMs != null && Number.isFinite(endedMs) ? new Date(endedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Open"}</td>
                      <td className="py-2 text-right tabular-nums">{endedMs != null && Number.isFinite(endedMs) ? formatElapsed((endedMs - startedMs) / 1000) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

export function RunOperationalTabs({ run, online, canManageProfiles, onUpdated }: { run: Run; online: boolean; canManageProfiles: boolean; onUpdated: (run: Run, notice?: string) => void }) {
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
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${activeTab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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
          activeTab === "run" ? <RunTab run={run} snapshot={snapshot} online={online} canManageProfiles={canManageProfiles} onUpdated={onUpdated} />
          : activeTab === "dough" ? <DoughTab run={run} snapshot={snapshot} online={online} onUpdated={onUpdated} />
          : activeTab === "sauce" ? <SauceTab run={run} snapshot={snapshot} online={online} onUpdated={onUpdated} />
          : activeTab === "frontline" ? <FrontlineTab run={run} snapshot={snapshot} online={online} onUpdated={onUpdated} />
          : activeTab === "packaging" ? <PackagingTab run={run} snapshot={snapshot} online={online} onUpdated={onUpdated} />
          : activeTab === "stoppages" ? <StoppagesTab run={run} snapshot={snapshot} />
          : <SummaryTab snapshot={snapshot} />
        ) : (
          <p className="py-6 text-sm text-muted-foreground">{online ? "Reading operational state…" : "Operational state refreshes when the connection returns."}</p>
        )}
      </div>
    </section>
  );
}
