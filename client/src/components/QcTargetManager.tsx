import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { QcTarget, QcTargetSaveRequest } from "../api";

type TargetResult =
  | { status: "saved" }
  | { status: "conflict"; targets: QcTarget[] }
  | { status: "failed" };
type Editor = {
  targetKey: string;
  expectedRevision: number;
  kind: "weight" | "brix";
  unit: "g" | "kg" | "oz" | "lb" | "brix";
  minimum: string;
  maximum: string;
  active: boolean;
};

const emptyEditor: Editor = {
  targetKey: "", expectedRevision: 0, kind: "weight", unit: "g",
  minimum: "", maximum: "", active: true,
};

function decimalText(value: string | null): string {
  if (value === null || !/^-?\d+\.\d+$/.test(value)) return value ?? "";
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

function fromTarget(target: QcTarget): Editor {
  return {
    targetKey: target.targetKey, expectedRevision: target.revision,
    kind: target.kind, unit: target.unit,
    minimum: decimalText(target.minimum), maximum: decimalText(target.maximum), active: target.active,
  };
}

function bounds(target: Pick<QcTarget, "minimum" | "maximum" | "unit">): string {
  return `${target.minimum === null ? "—" : decimalText(target.minimum)} to ${target.maximum === null ? "—" : decimalText(target.maximum)} ${target.unit}`;
}

export function QcTargetManager({ targets, canManage, disabled, onSave }: {
  targets: QcTarget[];
  canManage: boolean;
  disabled: boolean;
  onSave: (request: Omit<QcTargetSaveRequest, "requestId">) => Promise<TargetResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [conflict, setConflict] = useState<{ attempted: Editor; current: QcTarget } | null>(null);

  useEffect(() => {
    if (!canManage) {
      setEditing(false);
      setConflict(null);
    }
  }, [canManage]);

  function edit(target: QcTarget) {
    setEditor(fromTarget(target));
    setEditing(true);
    setConflict(null);
  }

  function change<K extends keyof Editor>(key: K, value: Editor[K]) {
    setEditor((current) => ({ ...current, [key]: value }));
    setConflict(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const attempted = { ...editor };
    const result = await onSave({
      targetKey: editor.targetKey.trim(), expectedRevision: editor.expectedRevision,
      details: {
        kind: editor.kind, unit: editor.unit,
        minimum: editor.minimum.trim() || null, maximum: editor.maximum.trim() || null,
        active: editor.active,
      },
    });
    if (result.status === "saved") {
      setEditing(false);
      setEditor(emptyEditor);
      setConflict(null);
    } else if (result.status === "conflict") {
      const current = result.targets.find((target) => target.targetKey === attempted.targetKey.trim());
      if (current) setConflict({ attempted, current });
      else setConflict(null);
    }
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
      <section className="panel min-w-0" aria-labelledby="qc-target-list-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reviewed measurement bounds</p>
            <h2 id="qc-target-list-heading" className="mt-1 text-lg font-semibold">Current targets</h2>
          </div>
          {canManage ? (
            <button type="button" className="button-secondary" disabled={disabled} onClick={() => { setEditor(emptyEditor); setEditing(true); setConflict(null); }}>
              <Plus className="h-4 w-4" />New target
            </button>
          ) : <span className="status-pill">Read only</span>}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">A target revision is captured on each measurement. Editing a target never rewrites earlier evidence.</p>
        {targets.length === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No reviewed weight or Brix targets are available.</div>
        ) : (
          <div className="relative mt-5 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
              <caption className="sr-only">Current reviewed QC targets</caption>
              <thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-3 font-medium">Target</th><th className="py-2 pr-3 font-medium">Bounds</th><th className="py-2 pr-3 font-medium">Revision</th><th className="py-2 pr-3 font-medium">Status</th>{canManage ? <th className="py-2 font-medium"><span className="sr-only">Action</span></th> : null}</tr></thead>
              <tbody>
                {targets.map((target) => (
                  <tr key={target.targetKey} className="border-b border-border/50 last:border-0">
                    <th scope="row" className="py-3 pr-3 font-medium"><span className="block font-mono text-foreground">{target.targetKey}</span><span className="mt-1 block font-sans font-normal text-muted-foreground">{target.kind}</span></th>
                    <td className="py-3 pr-3 font-mono">{bounds(target)}</td>
                    <td className="py-3 pr-3 font-mono">{target.revision}</td>
                    <td className="py-3 pr-3"><span className={`status-pill ${target.active ? "status-running" : "status-paused"}`}>{target.active ? "Active" : "Inactive"}</span></td>
                    {canManage ? <td className="py-3 text-right"><button type="button" className="button-secondary px-3" disabled={disabled} onClick={() => edit(target)} aria-label={`Edit target ${target.targetKey}`}>Edit</button></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!canManage ? <p className="mt-5 border-t border-border/70 pt-4 text-xs leading-5 text-muted-foreground">Your role can use reviewed targets when recording evidence. Target changes require the manage-qc capability.</p> : null}
      </section>

      {canManage && editing ? (
        <section className="panel" aria-labelledby="qc-target-editor-heading">
          <p className="eyebrow">Revision-fenced editor</p>
          <h2 id="qc-target-editor-heading" className="mt-1 text-lg font-semibold">{editor.expectedRevision === 0 ? "New target" : `Edit ${editor.targetKey}`}</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Expected revision {editor.expectedRevision}. At least one bound is required; units must match the measurement being evaluated.</p>
          {conflict ? (
            <div className="error-banner" role="alert">
              <div className="min-w-0 flex-1">
                <strong className="block">Target changed before this save</strong>
                <p className="mt-1 text-xs leading-5">Your revision {conflict.attempted.expectedRevision} was not applied. Current is revision {conflict.current.revision}: {bounds(conflict.current)}, {conflict.current.active ? "active" : "inactive"}.</p>
                <p className="mt-2 text-xs leading-5">Your unapplied values: {conflict.attempted.minimum || "—"} to {conflict.attempted.maximum || "—"} {conflict.attempted.unit}, {conflict.attempted.active ? "active" : "inactive"}. Review both versions before deciding whether to try again.</p>
                <button type="button" className="button-secondary mt-3" onClick={() => { setEditor(fromTarget(conflict.current)); setConflict(null); }}>Load current values for review</button>
              </div>
            </div>
          ) : null}
          <form aria-label="QC target editor" className="mt-5" onSubmit={submit}>
            <fieldset disabled={disabled || conflict !== null} className="min-w-0">
              <label className="block text-xs font-medium text-muted-foreground">Target key
                <input className="field mt-1.5 font-mono" value={editor.targetKey} readOnly={editor.expectedRevision > 0} onChange={(event) => change("targetKey", event.target.value)} required maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9._:\-]{0,119}" autoComplete="off" />
              </label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-medium text-muted-foreground">Measurement kind
                  <select className="field mt-1.5" value={editor.kind} onChange={(event) => {
                    const kind = event.target.value as Editor["kind"];
                    setEditor((current) => ({ ...current, kind, unit: kind === "brix" ? "brix" : current.unit === "brix" ? "g" : current.unit }));
                    setConflict(null);
                  }}>
                    <option value="weight">Weight</option><option value="brix">Brix</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">Target unit
                  <select className="field mt-1.5" value={editor.unit} onChange={(event) => change("unit", event.target.value as Editor["unit"])}>
                    {(editor.kind === "brix" ? ["brix"] : ["g", "kg", "oz", "lb"]).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">Minimum (optional)
                  <input className="field mt-1.5 font-mono" type="number" inputMode="decimal" min="0" max={editor.kind === "brix" ? "100" : undefined} step="any" value={editor.minimum} onChange={(event) => change("minimum", event.target.value)} />
                </label>
                <label className="text-xs font-medium text-muted-foreground">Maximum (optional)
                  <input className="field mt-1.5 font-mono" type="number" inputMode="decimal" min="0" max={editor.kind === "brix" ? "100" : undefined} step="any" value={editor.maximum} onChange={(event) => change("maximum", event.target.value)} />
                </label>
              </div>
              <label className="mt-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-amber-500" checked={editor.active} onChange={(event) => change("active", event.target.checked)} />Active reviewed target</label>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" className="button-primary">Save target</button>
                <button type="button" className="button-secondary" onClick={() => { setEditing(false); setConflict(null); }}>Cancel</button>
              </div>
            </fieldset>
          </form>
        </section>
      ) : (
        <section className="panel border-dashed bg-background/30" aria-label="Target editing guidance">
          <p className="eyebrow">Target history</p>
          <h2 className="mt-1 text-lg font-semibold">Review before changing</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{canManage ? "Select a current target to edit it, or create a new key. A concurrent change returns the canonical revision instead of overwriting it." : "No target editor is available to this role."}</p>
        </section>
      )}
    </div>
  );
}
