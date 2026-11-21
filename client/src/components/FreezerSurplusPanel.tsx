import { useEffect, useState, type FormEvent } from "react";
import { Snowflake } from "lucide-react";
import type {
  AdjustFreezerSurplusRequest,
  AllocateFreezerSurplusRequest,
  ConfirmFreezerSurplusRequest,
  FreezerSurplusLedger,
} from "../api";

type AdjustmentType = AdjustFreezerSurplusRequest["eventType"];

export function FreezerSurplusPanel({
  ledger,
  disabled,
  onConfirm,
  onAllocate,
  onAdjust,
}: {
  ledger: FreezerSurplusLedger;
  disabled: boolean;
  onConfirm: (request: ConfirmFreezerSurplusRequest) => Promise<boolean>;
  onAllocate: (request: AllocateFreezerSurplusRequest) => Promise<boolean>;
  onAdjust: (request: AdjustFreezerSurplusRequest) => Promise<boolean>;
}) {
  const undecidedRuns = ledger.runs.filter((run) => run.decision === null || run.decision === "null");
  const decidedRuns = ledger.runs.filter((run) => run.decision === "none" || run.decision === "stored");
  const [runId, setRunId] = useState("");
  const [surplusCases, setSurplusCases] = useState("");
  const [lotId, setLotId] = useState("");
  const [scheduleRunId, setScheduleRunId] = useState("");
  const [allocationCases, setAllocationCases] = useState("1");
  const [eventType, setEventType] = useState<AdjustmentType>("damage");
  const [adjustmentCases, setAdjustmentCases] = useState("1");
  const [correctsEventId, setCorrectsEventId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedLot = ledger.lots.find((lot) => lot.id === lotId) ?? null;
  const eligibleScheduleRuns = ledger.scheduleRuns.filter((run) => run.productCode === selectedLot?.productCode
    && run.effectiveTargetCases > 0);
  const selectedScheduleRun = eligibleScheduleRuns.find((run) => run.runId === scheduleRunId) ?? null;
  const allocationCap = selectedLot && selectedScheduleRun
    ? Math.min(selectedLot.remainingCases, selectedScheduleRun.effectiveTargetCases)
    : 0;
  const correctableEvents = ledger.events.filter((event) => event.lotId === selectedLot?.id);

  useEffect(() => {
    if (!undecidedRuns.some((run) => run.runId === runId)) setRunId(undecidedRuns[0]?.runId ?? "");
  }, [ledger.runs, runId]);

  useEffect(() => {
    if (!ledger.lots.some((lot) => lot.id === lotId)) setLotId(ledger.lots[0]?.id ?? "");
  }, [ledger.lots, lotId]);

  useEffect(() => {
    if (!eligibleScheduleRuns.some((run) => run.runId === scheduleRunId)) {
      setScheduleRunId(eligibleScheduleRuns[0]?.runId ?? "");
    }
  }, [selectedLot?.id, ledger.scheduleRuns, scheduleRunId]);

  useEffect(() => {
    if (!correctableEvents.some((event) => event.id === correctsEventId)) {
      setCorrectsEventId(correctableEvents[0]?.id ?? "");
    }
  }, [selectedLot?.id, ledger.events, correctsEventId]);

  async function confirm(cases: number) {
    setError(null);
    if (disabled || !runId) return;
    const saved = await onConfirm({ requestId: crypto.randomUUID(), runId, cases });
    if (saved) setSurplusCases("");
  }

  async function submitConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cases = Number(surplusCases);
    if (!Number.isSafeInteger(cases) || cases < 1 || cases > 1_000_000) {
      setError("Enter whole surplus cases from 1 to 1,000,000, or explicitly confirm no surplus.");
      return;
    }
    await confirm(cases);
  }

  async function submitAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const cases = Number(allocationCases);
    if (disabled || !selectedLot || !selectedScheduleRun) return;
    if (!Number.isSafeInteger(cases) || cases < 1 || cases > allocationCap) {
      setError(`Enter whole carry-in cases from 1 to ${Math.max(allocationCap, 1)}.`);
      return;
    }
    const saved = await onAllocate({
      requestId: crypto.randomUUID(), lotId: selectedLot.id,
      productionDate: selectedScheduleRun.productionDate, scheduleRunId: selectedScheduleRun.runId,
      cases, expectedRevision: selectedLot.revision,
    });
    if (saved) setAllocationCases("1");
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const cases = Number(adjustmentCases);
    if (disabled || !selectedLot) return;
    if (!Number.isSafeInteger(cases) || cases === 0 || Math.abs(cases) > 1_000_000
      || (eventType !== "correction" && cases < 1)) {
      setError(eventType === "correction"
        ? "Enter a nonzero signed whole-case correction."
        : "Enter positive whole cases from 1 to 1,000,000.");
      return;
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setError("Enter a reason from 3 to 500 characters.");
      return;
    }
    if (eventType === "correction" && !correctsEventId) {
      setError("Select the immutable event this correction explains.");
      return;
    }
    const saved = await onAdjust({
      requestId: crypto.randomUUID(), lotId: selectedLot.id, eventType, cases,
      reason: reason.trim(), expectedRevision: selectedLot.revision,
      ...(eventType === "correction" ? { correctsEventId } : {}),
    });
    if (saved) {
      setAdjustmentCases("1");
      setReason("");
    }
  }

  return (
    <section className="panel min-w-0" aria-labelledby="freezer-surplus-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Finished cases · separate from ingredient stock</p><h2 id="freezer-surplus-heading" className="mt-1 text-lg font-semibold">Freezer surplus</h2></div>
        <Snowflake className="h-5 w-5 text-amber-300" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Record the completed-run decision once, allocate finished cases against scheduled production, and append reasoned physical corrections. These actions never deduct ingredients again.</p>
      {error ? <p className="error-banner mt-4" role="alert">{error}</p> : null}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-4">
          <h3 className="text-sm font-medium">Completed-run decision</h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Zero and positive decisions are immutable. A response retry uses the same request identity and cannot replace the original decision.</p>
          <form className="mt-4 space-y-3" onSubmit={(event) => void submitConfirmation(event)}>
            <label className="block text-xs font-medium" htmlFor="surplus-completed-run">Completed run
              <select id="surplus-completed-run" aria-label="Completed run" className="field mt-1.5" value={runId} disabled={disabled || undecidedRuns.length === 0} onChange={(event) => setRunId(event.target.value)}>
                {undecidedRuns.length === 0 ? <option value="">All completed runs decided</option> : null}
                {undecidedRuns.map((run) => <option key={run.runId} value={run.runId}>{run.label} · {run.productCode} · {new Date(run.completedAt).toLocaleString()}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium" htmlFor="surplus-cases">Surplus cases
              <input id="surplus-cases" className="field mt-1.5" type="number" min={1} max={1_000_000} step={1} value={surplusCases} disabled={disabled || !runId} onChange={(event) => setSurplusCases(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="button-primary" disabled={disabled || !runId || !surplusCases}>Store surplus</button>
              <button type="button" className="button-secondary" disabled={disabled || !runId} onClick={() => void confirm(0)}>Confirm no surplus</button>
            </div>
          </form>
          <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
            {decidedRuns.map((run) => <p key={run.runId} className="text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">{run.label}</span> · {run.decision === "none" ? "No surplus confirmed" : `Stored in lot ${run.lotId}`}</p>)}
            {decidedRuns.length === 0 ? <p className="text-xs text-muted-foreground">No completed-run surplus decisions yet.</p> : null}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-4">
          <h3 className="text-sm font-medium">Finished-case lots</h3>
          <div className="mt-3 space-y-2">
            {ledger.lots.map((lot) => <button key={lot.id} type="button" className={`w-full rounded-lg border p-3 text-left text-xs ${lot.id === selectedLot?.id ? "border-amber-500/60 bg-amber-500/10" : "border-border/70 bg-background/40"}`} aria-label={`Select surplus lot ${lot.id}`} aria-pressed={lot.id === selectedLot?.id} disabled={disabled} onClick={() => { setLotId(lot.id); setError(null); }}>
              <span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{lot.productCode}</strong><span className="font-mono text-amber-300">{lot.remainingCases} / {lot.totalCases} cases</span></span>
              <span className="mt-2 block text-muted-foreground">Produced {lot.productionDate} · revision {lot.revision}</span>
            </button>)}
            {ledger.lots.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No finished-case surplus lots.</p> : null}
          </div>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <form className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-4" onSubmit={(event) => void submitAllocation(event)}>
          <h3 className="text-sm font-medium">Allocate carry-in</h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Only matching products with a positive effective target are eligible. The cap uses both physical cases remaining and the scheduled target still required.</p>
          <label className="mt-4 block text-xs font-medium" htmlFor="surplus-scheduled-run">Scheduled run
            <select id="surplus-scheduled-run" aria-label="Scheduled run" className="field mt-1.5" value={scheduleRunId} disabled={disabled || !selectedLot || eligibleScheduleRuns.length === 0} onChange={(event) => setScheduleRunId(event.target.value)}>
              {eligibleScheduleRuns.length === 0 ? <option value="">No eligible scheduled run</option> : null}
              {eligibleScheduleRuns.map((run) => <option key={`${run.productionDate}:${run.runId}`} value={run.runId}>{run.productionDate} · {run.productCode} · {run.effectiveTargetCases} effective / {run.targetCases} planned</option>)}
            </select>
          </label>
          <label className="mt-3 block text-xs font-medium" htmlFor="surplus-allocation-cases">Carry-in cases
            <input id="surplus-allocation-cases" className="field mt-1.5" type="number" min={1} max={Math.max(allocationCap, 1)} step={1} value={allocationCases} disabled={disabled || allocationCap < 1} onChange={(event) => setAllocationCases(event.target.value)} />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">Available for this allocation: {allocationCap} cases. Selected lot revision: {selectedLot?.revision ?? "—"}.</p>
          <button type="submit" className="button-primary mt-4" disabled={disabled || allocationCap < 1 || !allocationCases}>Allocate carry-in</button>
        </form>

        <form className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-4" onSubmit={(event) => void submitAdjustment(event)}>
          <h3 className="text-sm font-medium">Append physical adjustment</h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Damage and return change physically remaining cases. A signed correction links to prior evidence; no event is rewritten.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium" htmlFor="surplus-event-type">Event type
              <select id="surplus-event-type" aria-label="Event type" className="field mt-1.5" value={eventType} disabled={disabled || !selectedLot} onChange={(event) => setEventType(event.target.value as AdjustmentType)}>
                <option value="damage">Damage</option><option value="return">Return</option><option value="correction">Correction</option>
              </select>
            </label>
            <label className="block text-xs font-medium" htmlFor="surplus-adjustment-cases">{eventType === "correction" ? "Signed correction cases" : "Cases"}
              <input id="surplus-adjustment-cases" className="field mt-1.5" type="number" min={eventType === "correction" ? -1_000_000 : 1} max={1_000_000} step={1} value={adjustmentCases} disabled={disabled || !selectedLot} onChange={(event) => setAdjustmentCases(event.target.value)} />
            </label>
          </div>
          {eventType === "correction" ? <label className="mt-3 block text-xs font-medium" htmlFor="surplus-corrected-event">Corrected event
            <select id="surplus-corrected-event" aria-label="Corrected event" className="field mt-1.5" value={correctsEventId} disabled={disabled || correctableEvents.length === 0} onChange={(event) => setCorrectsEventId(event.target.value)}>
              {correctableEvents.length === 0 ? <option value="">No events for selected lot</option> : null}
              {correctableEvents.map((event) => <option key={event.id} value={event.id}>{event.eventType} · {event.quantityDelta > 0 ? "+" : ""}{event.quantityDelta} · {new Date(event.createdAt).toLocaleString()}</option>)}
            </select>
          </label> : null}
          <label className="mt-3 block text-xs font-medium" htmlFor="surplus-adjustment-reason">Reason
            <input id="surplus-adjustment-reason" className="field mt-1.5" minLength={3} maxLength={500} value={reason} disabled={disabled || !selectedLot} onChange={(event) => setReason(event.target.value)} />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">Expected lot revision: {selectedLot?.revision ?? "—"}. Canonical readback follows every accepted append.</p>
          <button type="submit" className="button-primary mt-4" disabled={disabled || !selectedLot || !adjustmentCases || reason.trim().length < 3 || (eventType === "correction" && !correctsEventId)}>Append {eventType}</button>
        </form>
      </div>

      <div className="mt-5 border-t border-border/70 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Immutable event ledger</h3><span className="status-pill">Latest {Math.min(ledger.events.length, 20)}</span></div>
        <div className="mt-3 space-y-2">
          {ledger.events.slice(0, 20).map((event) => <article key={event.id} className="rounded-lg border border-border/60 bg-background/30 p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium capitalize">{event.eventType}</span><span className="font-mono text-amber-300">{event.quantityDelta > 0 ? "+" : ""}{event.quantityDelta} cases</span></div>
            <p className="mt-2 leading-5">{event.reason}</p>
            <p className="mt-1 text-muted-foreground">{new Date(event.createdAt).toLocaleString()} · lot {event.lotId}{event.correctsEventId ? ` · corrects ${event.correctsEventId}` : ""}</p>
          </article>)}
          {ledger.events.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No surplus events recorded.</p> : null}
        </div>
      </div>
    </section>
  );
}
