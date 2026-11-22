import { useEffect, useState, type FormEvent } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { DIE_DEFAULT_FIELDS, REQUIRED_DIE_DEFAULT_FIELDS } from "../../../core/die-defaults.mjs";
import {
  listReviewedDieDefaults,
  type DieDefaultSaveRequest,
  type ReviewedDieDefault as DieDefault,
  type ReviewedDieDefaults as DieDefaultResponse,
  type ReviewedDieLineSettings,
} from "../api";

const LABELS: Record<string, string> = {
  crustsPerCycle: "Crusts per cycle",
  cycleSpeed: "Cycle speed",
  speedAdjustment: "Speed adjustment",
  freezerTime: "Freezer time",
  casesPerLayer: "Cases per layer",
  preTunnelMin: "Pre-tunnel minutes",
  postTunnelMin: "Post-tunnel minutes",
  pressOvenMin: "Press oven minutes",
  frontlineMin: "Frontline minutes",
};

type Props = {
  online: boolean;
  disabled: boolean;
  onSave: (request: DieDefaultSaveRequest) => Promise<boolean>;
};

function emptyDefaults(): ReviewedDieLineSettings {
  return {
    crustsPerCycle: 0,
    cycleSpeed: 0,
    speedAdjustment: 1,
    freezerTime: 0,
    casesPerLayer: 0,
    preTunnelMin: null,
    postTunnelMin: null,
    pressOvenMin: null,
    frontlineMin: null,
  };
}

function DieDefaultForm({ item, disabled, onSave, onCancel }: {
  item: DieDefault;
  disabled: boolean;
  onSave: Props["onSave"];
  onCancel: () => void;
}) {
  const [defaults, setDefaults] = useState<ReviewedDieLineSettings>(() => ({
    ...emptyDefaults(), ...(item.defaults ?? item.suggestedDefaults ?? {}),
  }));
  const [enabled, setEnabled] = useState(item.status !== "disabled");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || saving) return;
    setSaving(true);
    try {
      const saved = await onSave({
        requestId: crypto.randomUUID(),
        dieCode: item.code,
        expectedRevision: item.revision,
        defaults,
        enabled,
      });
      if (saved) onCancel();
    } finally {
      setSaving(false);
    }
  }

  return <form className="mt-4 space-y-4 border-t border-border/70 pt-4" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-3 sm:grid-cols-2">
      {DIE_DEFAULT_FIELDS.map((key) => <label className="block text-xs font-medium" key={key}>{LABELS[key]}
        <input className="field mt-1.5 w-full" type="number" min="0" step="any" disabled={disabled}
          required={REQUIRED_DIE_DEFAULT_FIELDS.includes(key)} value={defaults[key] ?? ""}
          onChange={(event) => setDefaults((current) => ({ ...current, [key]: event.target.value === "" ? null : Number(event.target.value) }))} />
      </label>)}
    </div>
    <label className="flex min-h-10 items-center gap-2 text-xs font-medium">
      <input type="checkbox" className="h-4 w-4" checked={enabled} disabled={disabled}
        onChange={(event) => setEnabled(event.target.checked)} />Enabled for future run defaults
    </label>
    <p className="text-xs leading-5 text-muted-foreground">This direct reviewed-default command is revision-fenced and writes immutable attributed history. Existing run snapshots do not change.</p>
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="button-primary" disabled={disabled || saving}>{saving ? "Saving…" : item.revision === 0 ? "Save reviewed defaults" : "Save new revision"}</button>
      {item.status === "active" ? <button type="button" className="button-secondary" disabled={disabled || saving} onClick={() => setEnabled(false)}>Mark retired on save</button> : null}
      <button type="button" className="button-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export function ReviewedDieDefaults({ online, disabled, onSave }: Props) {
  const [value, setValue] = useState<DieDefaultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    if (!online) return;
    setLoading(true);
    setError(null);
    try {
      setValue(await listReviewedDieDefaults());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reviewed die defaults could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (online) void load(); }, [online]);
  useEffect(() => {
    const reload = () => { setEditing(null); if (online) void load(); };
    window.addEventListener("fieldline:v3:die-defaults-changed", reload);
    return () => window.removeEventListener("fieldline:v3:die-defaults-changed", reload);
  }, [online]);

  return <section className="panel" aria-labelledby="reviewed-die-defaults-heading">
    <div className="panel-heading">
      <div><p className="eyebrow">Direct reviewed commands</p><h2 id="reviewed-die-defaults-heading" className="mt-1 text-lg font-semibold">Reviewed die defaults</h2></div>
      <button type="button" className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={!online || loading} onClick={() => void load()}>
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
      </button>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Imported die-line defaults remain suggestions until reviewed here. Each die saves independently against its current revision.</p>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {!value ? <p className="mt-4 text-sm text-muted-foreground">{online ? "Loading reviewed defaults…" : "Reconnect to load reviewed defaults; previously loaded setup values remain read-only."}</p> : null}
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {value?.defaults.map((item) => <article className="rounded-lg border border-border/70 bg-background/40 p-4" key={item.code}>
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-sm font-semibold">{item.name}</h3><p className="mt-1 font-mono text-xs text-amber-300">{item.code} · revision {item.revision}</p></div>
          <span className={`status-pill ${item.status === "active" ? "status-running" : item.status === "unreviewed" ? "status-paused" : ""}`}>{item.status}</span>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{item.suggestedDefaults ? "An imported suggestion is available for comparison." : "No imported suggestion is available."}</p>
        <button type="button" className="button-secondary mt-4" disabled={disabled || !online} onClick={() => setEditing(editing === item.code ? null : item.code)}>
          <Pencil className="h-4 w-4" />{editing === item.code ? "Close editor" : item.revision === 0 ? "Review suggestion" : "Edit reviewed defaults"}
        </button>
        {editing === item.code ? <DieDefaultForm key={`${item.code}:${item.revision}`} item={item} disabled={disabled} onSave={onSave} onCancel={() => setEditing(null)} /> : null}
      </article>)}
    </div>
    {value && value.defaults.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Import die types before reviewing die defaults.</p> : null}
    <div className="mt-6 border-t border-border/70 pt-5">
      <h3 className="text-sm font-semibold">Immutable reviewed-default history</h3>
      <div className="mt-3 space-y-2">
        {value?.history.map((event) => <article className="rounded-md border border-border/60 p-3 text-xs" key={event.id}>
          <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{event.dieCode} · {event.action} · revision {event.revision}</span><time>{new Date(event.occurredAt).toLocaleString()}</time></div>
          <p className="mt-1 text-muted-foreground">Actor {event.actorId}</p>
        </article>)}
        {value && value.history.length === 0 ? <p className="text-sm text-muted-foreground">No reviewed default changes have been saved.</p> : null}
      </div>
    </div>
  </section>;
}
