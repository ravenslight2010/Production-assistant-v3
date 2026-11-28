import { useRef, useState, type FormEvent } from "react";
import { ApiError, applyRunOutcome, type Run } from "../api";

// v1's RunMeta closeout (actualCases / wasteLbs), ported as a command:
// wholesale-replace semantics, so a resend overwrites and an explicit empty
// clears. Editable while the run is running, paused, or completed — planned
// runs refuse on the server with invalid_transition.

function parseDraft(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 10000000) return "invalid";
  return value;
}

export function RunOutcomePanel({ run, online, onUpdated }: {
  run: Run;
  online: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const editable = online && ["running", "paused", "completed"].includes(run.status);
  const [open, setOpen] = useState(false);
  const [casesDraft, setCasesDraft] = useState("");
  const [wasteDraft, setWasteDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);

  const displayedCases = run.actualCases ?? "—";
  const displayedWaste = run.wasteLbs ?? "—";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const actualCases = parseDraft(casesDraft);
    const wasteLbs = parseDraft(wasteDraft);
    if (actualCases === "invalid" || wasteLbs === "invalid") {
      setError("Enter non-negative numbers within 0–10,000,000, or leave a field blank to clear it.");
      return;
    }
    commandId.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const result = await applyRunOutcome(run, { actualCases, wasteLbs }, commandId.current);
      commandId.current = null;
      setCasesDraft("");
      setWasteDraft("");
      setOpen(false);
      onUpdated(result.run, result.conflict
        ? "Stale outcome update discarded; the latest server state is now displayed."
        : "Run outcome confirmed by the server.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Outcome update failed. Refresh before retrying.");
    } finally {
      setPending(false);
    }
  }

  if (!editable && !open) {
    return (
      <div className="mt-4 border-t border-border pt-3">
        <dl className="grid grid-cols-2 gap-3">
          <div className="metric"><dt>Actual cases</dt><dd>{displayedCases}</dd></div>
          <div className="metric"><dt>Waste (lbs)</dt><dd>{displayedWaste}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Outcome capture unlocks once the run starts.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      {open ? (
        <form onSubmit={submit} className="grid gap-2" aria-label="Record run outcome">
          <label className="text-xs font-medium text-muted-foreground">
            Actual cases
            <input
              className="field mt-1 w-full text-sm text-foreground"
              type="number" min={0} max={10000000} step={1} inputMode="numeric"
              placeholder={run.actualCases === null ? "Not recorded" : String(run.actualCases)}
              value={casesDraft}
              disabled={pending}
              onChange={(event) => { commandId.current = null; setCasesDraft(event.target.value); }}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Waste (lbs)
            <input
              className="field mt-1 w-full text-sm text-foreground"
              type="number" min={0} max={10000000} step="any" inputMode="decimal"
              placeholder={run.wasteLbs === null ? "Not recorded" : String(run.wasteLbs)}
              value={wasteDraft}
              disabled={pending}
              onChange={(event) => { commandId.current = null; setWasteDraft(event.target.value); }}
            />
          </label>
          <p className="text-xs text-muted-foreground">Saving replaces both fields; a blank field clears it.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" className="button-secondary" disabled={pending}>
              {pending ? "Saving…" : "Save outcome"}
            </button>
            <button type="button" className="button-secondary" disabled={pending}
              onClick={() => { setOpen(false); setError(null); setCasesDraft(""); setWasteDraft(""); }}>
              Cancel
            </button>
          </div>
          {error ? <span className="error-text" role="alert">{error}</span> : null}
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <div className="metric"><dt>Actual cases</dt><dd>{displayedCases}</dd></div>
            <div className="metric"><dt>Waste (lbs)</dt><dd>{displayedWaste}</dd></div>
          </dl>
          <button type="button" className="button-secondary mt-3" disabled={!editable} onClick={() => setOpen(true)}>
            Record outcome
          </button>
        </>
      )}
    </div>
  );
}
