import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  applyRunOperation,
  getStopReasonSettings,
  saveStopReasonSettings,
  type Run,
  type RunOperationDetails,
  type RunOperationType,
  type Stoppage,
  type StopReasonSettings,
} from "../api";

function localInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 19);
}

function isoFromLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Enter a valid date and time.");
  return parsed.toISOString();
}

function duration(stoppage: Stoppage, serverNow: string): string {
  const start = Date.parse(stoppage.startedAt);
  const end = stoppage.endedAt ? Date.parse(stoppage.endedAt) : Date.parse(serverNow);
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`;
}

export function RunOperationsPanel({ run, online, canManageReasons, onUpdated }: {
  run: Run;
  online: boolean;
  canManageReasons: boolean;
  onUpdated: (run: Run, notice?: string) => void;
}) {
  const [settings, setSettings] = useState<StopReasonSettings | null>(null);
  const [notes, setNotes] = useState(run.operationalNotes);
  const [reason, setReason] = useState("");
  const [stopNotes, setStopNotes] = useState("");
  const [pastOpen, setPastOpen] = useState(false);
  const [pastReason, setPastReason] = useState("");
  const [pastNotes, setPastNotes] = useState("");
  const [pastStart, setPastStart] = useState("");
  const [pastEnd, setPastEnd] = useState("");
  const [editing, setEditing] = useState<Stoppage | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());

  useEffect(() => {
    setNotes(run.operationalNotes);
  }, [run.id, run.operationalNotes]);

  useEffect(() => {
    if (!online) return;
    let active = true;
    void getStopReasonSettings().then((next) => {
      if (!active) return;
      setSettings(next);
      setReasonText(next.reasons.join("\n"));
      setLoadError(null);
    }).catch((cause) => {
      if (active) setLoadError(cause instanceof ApiError ? cause.message : "Stop reasons could not be loaded.");
    });
    return () => { active = false; };
  }, [online]);

  const activePause = run.status === "paused"
    ? run.stoppages.find((item) => item.type === "pause" && item.endedAt === null) ?? null
    : null;
  const pauseDecisionMs = activePause ? Date.parse(activePause.startedAt) + 10_000 - Date.parse(run.serverNow) : 0;
  const writable = online && run.status !== "completed" && pending === null;

  async function execute(key: string, type: RunOperationType, details: RunOperationDetails) {
    setError(null);
    const id = commandIds.current.get(key) ?? crypto.randomUUID();
    commandIds.current.set(key, id);
    setPending(key);
    try {
      const result = await applyRunOperation(run, type, details, id);
      commandIds.current.delete(key);
      onUpdated(result.run, result.conflict
        ? "Stale operational change discarded; the latest server state is now displayed."
        : "Operational record confirmed by the server.");
      return true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The operation failed. Retry the same request when connected.");
      return false;
    } finally {
      setPending(null);
    }
  }

  function changed(key: string) {
    commandIds.current.delete(key);
    setError(null);
  }

  async function startStop(event: FormEvent) {
    event.preventDefault();
    if (await execute("start-stop", "start_stop", { reason, notes: stopNotes })) {
      setReason("");
      setStopNotes("");
    }
  }

  async function addPast(event: FormEvent) {
    event.preventDefault();
    try {
      const details = {
        reason: pastReason,
        notes: pastNotes,
        startedAt: isoFromLocal(pastStart),
        endedAt: isoFromLocal(pastEnd),
      };
      if (await execute("add-past", "add_past_stop", details)) {
        setPastOpen(false);
        setPastReason("");
        setPastNotes("");
        setPastStart("");
        setPastEnd("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter valid stoppage times.");
    }
  }

  function beginEdit(item: Stoppage) {
    setEditing(item);
    setEditReason(item.reason);
    setEditNotes(item.notes);
    setEditStart(localInput(item.startedAt));
    setEditEnd(localInput(item.endedAt));
    setError(null);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      const details: RunOperationDetails = {
        stoppageId: editing.id,
        reason: editReason,
        notes: editNotes,
        ...(editing.type === "pause" ? {} : {
          startedAt: isoFromLocal(editStart),
          endedAt: isoFromLocal(editEnd),
        }),
      };
      if (await execute(`edit-${editing.id}`, "update_stoppage", details)) setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter valid stoppage times.");
    }
  }

  async function saveNotes(event: FormEvent) {
    event.preventDefault();
    await execute("run-notes", "set_notes", { operationalNotes: notes });
  }

  async function saveReasons(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const reasons = reasonText.split("\n").map((item) => item.trim()).filter(Boolean);
    setError(null);
    const key = "stop-reasons";
    const id = commandIds.current.get(key) ?? crypto.randomUUID();
    commandIds.current.set(key, id);
    setPending(key);
    try {
      const result = await saveStopReasonSettings(settings, reasons, id);
      commandIds.current.delete(key);
      setSettings(result.settings);
      setReasonText(result.settings.reasons.join("\n"));
      setReasonsOpen(false);
      onUpdated(run, result.conflict
        ? "Stale stop-reason edit discarded; the latest catalog is now displayed."
        : "Stop reasons confirmed by the server.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Stop reasons could not be saved. Retry the same request.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border/70 bg-card/40 p-4" aria-labelledby="operations-heading">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <p className="eyebrow">Shift record</p>
          <h3 id="operations-heading" className="mt-1 text-sm font-semibold">Stoppages &amp; operational notes</h3>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">Server-owned · audited</span>
      </div>
      {loadError ? <p className="error-text mt-3" role="alert">{loadError}</p> : null}
      {error ? <p className="error-text mt-3" role="alert">{error}</p> : null}

      {activePause ? (
        <div className="mt-4 rounded-lg border border-orange-700/60 bg-orange-950/30 p-3" role="status">
          <p className="text-sm font-semibold text-orange-300">Tunnel stopped by default</p>
          {activePause.stopTunnel ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {pauseDecisionMs > 0
                  ? `${Math.ceil(pauseDecisionMs / 1000)} seconds remain to keep the tunnel running.`
                  : "The 10-second tunnel decision window has closed."}
              </p>
              <button type="button" className="button-secondary border-orange-600 text-orange-300"
                disabled={!writable || pauseDecisionMs <= 0}
                onClick={() => void execute(`tunnel-${activePause.id}`, "set_pause_tunnel", {
                  stoppageId: activePause.id, stopTunnel: false,
                })}>Keep tunnel running</button>
            </div>
          ) : <p className="mt-1 text-xs text-orange-300">Operator override confirmed: line and packaging automatic progress continue; all other stations remain paused.</p>}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form onSubmit={startStop} className="rounded-lg border border-border/60 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide">Active line stop</h4>
          <label className="mt-3 block text-xs text-muted-foreground">Reason
            <select className="field mt-1" value={reason} disabled={!writable || run.status !== "running"}
              onChange={(event) => { changed("start-stop"); setReason(event.target.value); }}>
              <option value="">Select later</option>
              {settings?.reasons.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="mt-2 block text-xs text-muted-foreground">Notes
            <input className="field mt-1" maxLength={2000} value={stopNotes} disabled={!writable || run.status !== "running"}
              onChange={(event) => { changed("start-stop"); setStopNotes(event.target.value); }} />
          </label>
          <button type="submit" className="button-secondary mt-3" disabled={!writable || run.status !== "running"}>
            {pending === "start-stop" ? "Recording…" : "Start line stop"}
          </button>
        </form>

        <form onSubmit={saveNotes} className="rounded-lg border border-border/60 p-3">
          <label htmlFor="operational-notes" className="text-xs font-semibold uppercase tracking-wide">Run notes</label>
          <textarea id="operational-notes" className="field mt-3 min-h-24 resize-y" maxLength={4000} value={notes}
            disabled={!writable} onChange={(event) => { changed("run-notes"); setNotes(event.target.value); }}
            placeholder="Operator handoff, quality context, or production notes" />
          <div className="mt-2 flex items-center gap-3">
            <button type="submit" className="button-secondary" disabled={!writable || notes === run.operationalNotes}>
              {pending === "run-notes" ? "Saving…" : "Save run notes"}
            </button>
            <span className="text-[10px] text-muted-foreground">{notes.length}/4000</span>
          </div>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="button-secondary" disabled={!writable || !["running", "paused"].includes(run.status)}
          onClick={() => setPastOpen((current) => !current)}>{pastOpen ? "Close past-event form" : "Add past event"}</button>
        {canManageReasons ? <button type="button" className="button-secondary" disabled={!online || pending !== null || !settings}
          onClick={() => setReasonsOpen((current) => !current)}>{reasonsOpen ? "Close reason editor" : "Edit stop reasons"}</button> : null}
      </div>

      {pastOpen ? (
        <form onSubmit={addPast} aria-label="Past stoppage" className="mt-3 grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Reason
            <select className="field mt-1" value={pastReason} onChange={(event) => { changed("add-past"); setPastReason(event.target.value); }}>
              <option value="">Unspecified</option>
              {settings?.reasons.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Notes
            <input className="field mt-1" maxLength={2000} value={pastNotes} onChange={(event) => { changed("add-past"); setPastNotes(event.target.value); }} />
          </label>
          <label className="text-xs text-muted-foreground">Started
            <input required type="datetime-local" step="1" className="field mt-1" value={pastStart} onChange={(event) => { changed("add-past"); setPastStart(event.target.value); }} />
          </label>
          <label className="text-xs text-muted-foreground">Ended
            <input required type="datetime-local" step="1" className="field mt-1" value={pastEnd} onChange={(event) => { changed("add-past"); setPastEnd(event.target.value); }} />
          </label>
          <button type="submit" className="button-secondary sm:col-span-2" disabled={!writable}>{pending === "add-past" ? "Recording…" : "Record past event"}</button>
        </form>
      ) : null}

      {reasonsOpen && settings ? (
        <form onSubmit={saveReasons} className="mt-3 rounded-lg border border-border/60 p-3">
          <label htmlFor="stop-reason-editor" className="text-xs font-semibold">Stop reasons, one per line</label>
          <textarea id="stop-reason-editor" className="field mt-2 min-h-32" value={reasonText} disabled={!online || pending !== null}
            onChange={(event) => { changed("stop-reasons"); setReasonText(event.target.value); }} />
          <button type="submit" className="button-secondary mt-2" disabled={!online || pending !== null}>{pending === "stop-reasons" ? "Saving…" : "Save stop reasons"}</button>
        </form>
      ) : null}

      <div className="mt-4 space-y-2">
        {run.stoppages.length === 0 ? <p className="text-xs text-muted-foreground">No stoppages recorded for this run.</p> : null}
        {run.stoppages.map((item) => (
          <article key={item.id} className="rounded-lg border border-border/60 bg-background/40 p-3" data-stoppage-type={item.type}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-pill capitalize">{item.type}</span>
              <strong className={`text-sm ${item.reason ? "" : "text-orange-800 dark:text-orange-400"}`}>{item.reason || "Reason needed"}</strong>
              <span className="ml-auto text-xs text-muted-foreground">{duration(item, run.serverNow)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(item.startedAt).toLocaleString()} — {item.endedAt ? new Date(item.endedAt).toLocaleString() : "Active"}</p>
            {item.notes ? <p className="mt-2 whitespace-pre-wrap text-xs">{item.notes}</p> : null}
            {item.type === "pause" ? <p className="mt-1 text-xs text-muted-foreground">Tunnel: {item.stopTunnel ? "stopped" : "kept running by operator"}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {item.type === "stop" && item.endedAt === null ? <button type="button" className="button-secondary px-3 py-1 text-xs" disabled={!writable}
                onClick={() => void execute(`end-${item.id}`, "end_stop", { stoppageId: item.id })}>End stop</button> : null}
              <button type="button" className="button-secondary px-3 py-1 text-xs" disabled={!writable || (item.type !== "pause" && item.endedAt === null)}
                onClick={() => beginEdit(item)}>Edit</button>
              {item.type !== "pause" ? <button type="button" className="button-secondary px-3 py-1 text-xs text-destructive" disabled={!writable}
                onClick={() => void execute(`delete-${item.id}`, "delete_stoppage", { stoppageId: item.id })}>Delete</button> : null}
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <form onSubmit={saveEdit} className="mt-3 grid gap-3 rounded-lg border border-orange-700/50 p-3 sm:grid-cols-2" aria-label="Edit stoppage">
          <h4 className="text-xs font-semibold sm:col-span-2">Edit {editing.type} record</h4>
          <label className="text-xs text-muted-foreground">Reason
            <select className="field mt-1" value={editReason} onChange={(event) => { changed(`edit-${editing.id}`); setEditReason(event.target.value); }}>
              <option value="">Unspecified</option>
              {settings?.reasons.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Notes
            <input className="field mt-1" maxLength={2000} value={editNotes} onChange={(event) => { changed(`edit-${editing.id}`); setEditNotes(event.target.value); }} />
          </label>
          {editing.type !== "pause" ? <>
            <label className="text-xs text-muted-foreground">Started
              <input required type="datetime-local" step="1" className="field mt-1" value={editStart} onChange={(event) => { changed(`edit-${editing.id}`); setEditStart(event.target.value); }} />
            </label>
            <label className="text-xs text-muted-foreground">Ended
              <input required type="datetime-local" step="1" className="field mt-1" value={editEnd} onChange={(event) => { changed(`edit-${editing.id}`); setEditEnd(event.target.value); }} />
            </label>
          </> : <p className="text-xs text-muted-foreground sm:col-span-2">Lifecycle pause timestamps are server-owned and cannot be edited.</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="button-secondary" disabled={!writable}>Save stoppage</button>
            <button type="button" className="button-secondary" disabled={pending !== null} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
