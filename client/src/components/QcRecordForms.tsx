import { useEffect, useState, type FormEvent } from "react";
import type {
  QcBrixCheckRequest,
  QcLotRequest,
  QcTarget,
  QcWeightCheckRequest,
  QcWeightUnit,
} from "../api";

type RecordKind = "lot" | "weight-check" | "brix-check";
export type QcRecordSubmission =
  | { kind: "lot"; details: QcLotRequest["details"] }
  | { kind: "weight-check"; details: QcWeightCheckRequest["details"] }
  | { kind: "brix-check"; details: QcBrixCheckRequest["details"] };

const kinds: { id: RecordKind; label: string }[] = [
  { id: "lot", label: "Lot" },
  { id: "weight-check", label: "Weight" },
  { id: "brix-check", label: "Brix" },
];

function TargetOptions({ targets, kind }: { targets: QcTarget[]; kind: "weight" | "brix" }) {
  const applicable = targets.filter((target) => target.kind === kind);
  return (
    <>
      <option value="">No reviewed target — not evaluated</option>
      {applicable.map((target) => (
        <option key={target.targetKey} value={target.targetKey}>
          {target.targetKey} · revision {target.revision}{target.active ? "" : " · inactive"}
        </option>
      ))}
    </>
  );
}

function FormStatus({ disabled }: { disabled: boolean }) {
  return disabled
    ? <p className="mt-4 text-xs leading-5 text-amber-300">Recording is locked while offline, another request is unconfirmed, or this run is unavailable.</p>
    : <p className="mt-4 text-xs leading-5 text-muted-foreground">The server confirms the evidence and its sequence before this screen reports success.</p>;
}

export function QcRecordForms({ runId, targets, disabled, onSubmit }: {
  runId: string;
  targets: QcTarget[];
  disabled: boolean;
  onSubmit: (submission: QcRecordSubmission) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<RecordKind>("lot");
  const [productCode, setProductCode] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [lotNotes, setLotNotes] = useState("");
  const [phase, setPhase] = useState<"pre-run" | "30-minute">("pre-run");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<QcWeightUnit>("g");
  const [weightTarget, setWeightTarget] = useState("");
  const [weightNotes, setWeightNotes] = useState("");
  const [brix, setBrix] = useState("");
  const [brixTarget, setBrixTarget] = useState("");
  const [brixNotes, setBrixNotes] = useState("");

  useEffect(() => {
    setProductCode("");
    setLotNumber("");
    setLotNotes("");
    setPhase("pre-run");
    setWeight("");
    setWeightUnit("g");
    setWeightTarget("");
    setWeightNotes("");
    setBrix("");
    setBrixTarget("");
    setBrixNotes("");
  }, [runId]);

  async function submitLot(event: FormEvent) {
    event.preventDefault();
    const saved = await onSubmit({ kind: "lot", details: {
      productCode: productCode.trim(), lotNumber: lotNumber.trim(), notes: lotNotes.trim(),
    } });
    if (saved) {
      setLotNumber("");
      setLotNotes("");
    }
  }

  async function submitWeight(event: FormEvent) {
    event.preventDefault();
    const saved = await onSubmit({ kind: "weight-check", details: {
      phase, value: weight.trim(), unit: weightUnit,
      targetKey: weightTarget || null, notes: weightNotes.trim(),
    } });
    if (saved) {
      setWeight("");
      setWeightNotes("");
    }
  }

  async function submitBrix(event: FormEvent) {
    event.preventDefault();
    const saved = await onSubmit({ kind: "brix-check", details: {
      phase: null, value: brix.trim(), unit: "brix",
      targetKey: brixTarget || null, notes: brixNotes.trim(),
    } });
    if (saved) {
      setBrix("");
      setBrixNotes("");
    }
  }

  return (
    <section className="panel" aria-labelledby="qc-record-form-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New evidence</p>
          <h2 id="qc-record-form-heading" className="mt-1 text-lg font-semibold">Record against this run</h2>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-1 border-b border-border/70 pb-3" role="tablist" aria-label="QC record type">
        {kinds.map((item, index) => (
          <button
            key={item.id}
            id={`qc-record-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={kind === item.id}
            aria-controls={`qc-record-panel-${item.id}`}
            tabIndex={kind === item.id ? 0 : -1}
            className={`nav-tab ${kind === item.id ? "nav-tab-active" : ""}`}
            onClick={() => setKind(item.id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? kinds.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + kinds.length) % kinds.length;
              const next = kinds[nextIndex]!;
              setKind(next.id);
              document.getElementById(`qc-record-tab-${next.id}`)?.focus();
            }}
          >{item.label}</button>
        ))}
      </div>

      {kind === "lot" ? (
        <form aria-label="Record QC lot" id="qc-record-panel-lot" role="tabpanel" aria-labelledby="qc-record-tab-lot" className="mt-5" onSubmit={submitLot}>
          <fieldset disabled={disabled} className="min-w-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">Product code
                <input className="field mt-1.5" value={productCode} onChange={(event) => setProductCode(event.target.value)} required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,79}" autoComplete="off" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">Lot number
                <input className="field mt-1.5" value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} required maxLength={120} autoComplete="off" />
              </label>
            </div>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">Lot notes (optional)
              <textarea className="field mt-1.5 min-h-24 resize-y" value={lotNotes} onChange={(event) => setLotNotes(event.target.value)} maxLength={1000} />
            </label>
            <button type="submit" className="button-primary mt-4">Record lot</button>
            <FormStatus disabled={disabled} />
          </fieldset>
        </form>
      ) : null}

      {kind === "weight-check" ? (
        <form aria-label="Record QC weight check" id="qc-record-panel-weight-check" role="tabpanel" aria-labelledby="qc-record-tab-weight-check" className="mt-5" onSubmit={submitWeight}>
          <fieldset disabled={disabled} className="min-w-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">Check phase
                <select className="field mt-1.5" value={phase} onChange={(event) => setPhase(event.target.value as "pre-run" | "30-minute")}>
                  <option value="pre-run">Pre-run</option>
                  <option value="30-minute">30-minute</option>
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">Observed weight
                <input className="field mt-1.5 font-mono" type="number" inputMode="decimal" min="0.000001" step="any" value={weight} onChange={(event) => setWeight(event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-muted-foreground">Weight unit
                <select className="field mt-1.5" value={weightUnit} onChange={(event) => setWeightUnit(event.target.value as QcWeightUnit)}>
                  {["g", "kg", "oz", "lb"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">Weight target
                <select className="field mt-1.5" value={weightTarget} onChange={(event) => setWeightTarget(event.target.value)}>
                  <TargetOptions targets={targets} kind="weight" />
                </select>
              </label>
            </div>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">Weight notes (optional)
              <textarea className="field mt-1.5 min-h-24 resize-y" value={weightNotes} onChange={(event) => setWeightNotes(event.target.value)} maxLength={1000} />
            </label>
            <button type="submit" className="button-primary mt-4">Record weight check</button>
            <FormStatus disabled={disabled} />
          </fieldset>
        </form>
      ) : null}

      {kind === "brix-check" ? (
        <form aria-label="Record QC Brix check" id="qc-record-panel-brix-check" role="tabpanel" aria-labelledby="qc-record-tab-brix-check" className="mt-5" onSubmit={submitBrix}>
          <fieldset disabled={disabled} className="min-w-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">Observed Brix
                <input className="field mt-1.5 font-mono" type="number" inputMode="decimal" min="0.000001" max="100" step="any" value={brix} onChange={(event) => setBrix(event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-muted-foreground">Brix target
                <select className="field mt-1.5" value={brixTarget} onChange={(event) => setBrixTarget(event.target.value)}>
                  <TargetOptions targets={targets} kind="brix" />
                </select>
              </label>
            </div>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">Brix notes (optional)
              <textarea className="field mt-1.5 min-h-24 resize-y" value={brixNotes} onChange={(event) => setBrixNotes(event.target.value)} maxLength={1000} />
            </label>
            <button type="submit" className="button-primary mt-4">Record Brix check</button>
            <FormStatus disabled={disabled} />
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
