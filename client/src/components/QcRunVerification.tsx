import { useState, type FormEvent } from "react";
import type {
  QcAllergenReviewRequest,
  QcCleaningRequest,
  QcCleaningVerificationRequest,
  QcComponentCheckRequest,
  QcDashboard,
  QcRunRecord,
} from "../api";

export type QcVerificationSubmission =
  | { kind: "component-check"; details: QcComponentCheckRequest["details"] }
  | { kind: "allergen-review"; details: QcAllergenReviewRequest["details"] }
  | { kind: "cleaning"; details: QcCleaningRequest["details"] }
  | { kind: "cleaning-verification"; recordId: string; details: QcCleaningVerificationRequest["details"] };

type Submit = (submission: QcVerificationSubmission) => Promise<boolean>;

const presenceLabels = { present: "Present", absent: "Absent", unknown: "Unknown / not checked" } as const;
const stagingLabels = { staged: "Staged", "not-staged": "Not staged", unknown: "Unknown / not checked" } as const;
const cleaningLabels = { cleaned: "Cleaned", "not-cleaned": "Not cleaned", unknown: "Unknown / not checked" } as const;

function latest(records: QcRunRecord[], kind: QcRunRecord["kind"], componentKey?: string) {
  return [...records].reverse().find((record) => record.kind === kind
    && (componentKey === undefined || ("componentKey" in record.details && record.details.componentKey === componentKey)));
}

function Status({ disabled }: { disabled: boolean }) {
  return <p className="mt-3 text-xs leading-5 text-muted-foreground">{disabled
    ? "Locked while offline, another request is unconfirmed, or this run is unavailable. No writes are queued."
    : "The server must confirm the append-only evidence before success is shown."}</p>;
}

function MappingStatus({ mapping }: { mapping: QcDashboard["allergenMappings"][number] }) {
  if (mapping.status === "reviewed") return <p><strong>Reviewed:</strong> {mapping.allergens.join(", ")}</p>;
  if (mapping.status === "reviewed-empty") return <p><strong>Reviewed:</strong> no fixed allergens listed.</p>;
  if (mapping.status === "unreviewed") return <p><strong>Unreviewed:</strong> allergen status is unknown, not allergen-free.</p>;
  if (mapping.status === "unavailable") return <p><strong>Unavailable:</strong> no canonical allergen mapping is available.</p>;
  return <p><strong>Invalid mapping:</strong> review the canonical setup record; this is not allergen-free.</p>;
}

export function QcComponentCheckPanel({ dashboard, disabled, onSubmit }: {
  dashboard: QcDashboard; disabled: boolean; onSubmit: Submit;
}) {
  const ingredients = dashboard.components.filter((component) => component.componentType === "ingredient");
  const [componentKey, setComponentKey] = useState(ingredients[0]?.componentKey ?? "");
  const [presence, setPresence] = useState<QcComponentCheckRequest["details"]["presence"]>("unknown");
  const [notes, setNotes] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onSubmit({ kind: "component-check", details: { componentKey, presence, notes: notes.trim() } })) setNotes("");
  }
  return (
    <section className="panel min-w-0" aria-labelledby="qc-components-heading">
      <p className="eyebrow">Effective run snapshot</p>
      <h2 id="qc-components-heading" className="mt-1 text-lg font-semibold">Component identity and presence</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{dashboard.componentSnapshot.productionDate} · {dashboard.componentSnapshot.source === "completed-run" ? "Completed-run snapshot" : "Effective plan"} · overlay revision {dashboard.componentSnapshot.overlayRevision}</p>
      <ul className="mt-4 divide-y divide-border/70 border-y border-border/70">
        {dashboard.components.map((component) => {
          const check = latest(dashboard.records, "component-check", component.componentKey);
          return <li key={component.componentKey} className="py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><strong>{component.productName}</strong><span className="ml-2 font-mono text-xs text-muted-foreground">{component.productCode ?? "No product code"}</span></div>
              <span className="status-pill">{check?.kind === "component-check" ? presenceLabels[check.details.presence] : "Not recorded"}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{component.componentType} · {component.quantity ?? "Quantity unavailable"} {component.unit ?? ""}{component.recipeName ? ` · ${component.recipeName}` : ""}</p>
          </li>;
        })}
      </ul>
      {dashboard.components.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No effective components are available. Missing component evidence is not a pass.</p> : null}
      <form className="mt-5" aria-label="Record QC component check" onSubmit={submit}>
        <fieldset disabled={disabled || ingredients.length === 0}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">Effective ingredient
              <select className="field mt-1.5" value={componentKey} onChange={(event) => setComponentKey(event.target.value)} required>
                {ingredients.map((component) => <option key={component.componentKey} value={component.componentKey}>{component.productName} · {component.productCode ?? component.componentKey}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Presence
              <select className="field mt-1.5" value={presence} onChange={(event) => setPresence(event.target.value as typeof presence)}>
                {Object.entries(presenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-4 block text-xs font-medium text-muted-foreground">Component notes (optional)
            <textarea className="field mt-1.5 min-h-20 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
          </label>
          <button type="submit" className="button-primary mt-4">Record component check</button>
          <Status disabled={disabled} />
        </fieldset>
      </form>
    </section>
  );
}

export function QcAllergenReviewPanel({ dashboard, disabled, onSubmit }: {
  dashboard: QcDashboard; disabled: boolean; onSubmit: Submit;
}) {
  const ingredients = dashboard.components.filter((component) => component.componentType === "ingredient");
  const [componentKey, setComponentKey] = useState(ingredients[0]?.componentKey ?? "");
  const [stagingStatus, setStagingStatus] = useState<QcAllergenReviewRequest["details"]["stagingStatus"]>("unknown");
  const [notes, setNotes] = useState("");
  const selectedMapping = dashboard.allergenMappings.find((mapping) => mapping.componentKey === componentKey);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onSubmit({ kind: "allergen-review", details: { componentKey, stagingStatus, notes: notes.trim() } })) setNotes("");
  }
  return (
    <section className="panel min-w-0" aria-labelledby="qc-allergens-heading">
      <p className="eyebrow">Canonical mapping review</p>
      <h2 id="qc-allergens-heading" className="mt-1 text-lg font-semibold">Allergens and staging</h2>
      <div className="mt-4 space-y-3">
        {ingredients.map((component) => {
          const mapping = dashboard.allergenMappings.find((item) => item.componentKey === component.componentKey);
          const review = latest(dashboard.records, "allergen-review", component.componentKey);
          return <div key={component.componentKey} className="border-b border-border/70 pb-3 text-xs leading-5 last:border-0">
            <p className="text-sm font-medium">{component.productName}</p>
            {mapping ? <MappingStatus mapping={mapping} /> : <p><strong>Unavailable:</strong> no component mapping was returned.</p>}
            <p className="mt-1 text-muted-foreground">Staging: {review?.kind === "allergen-review" ? stagingLabels[review.details.stagingStatus] : "Not recorded"}</p>
          </div>;
        })}
      </div>
      {ingredients.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No effective ingredients are available for allergen review.</p> : null}
      <form className="mt-5" aria-label="Record QC allergen review" onSubmit={submit}>
        <fieldset disabled={disabled || ingredients.length === 0}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">Ingredient to review
              <select className="field mt-1.5" value={componentKey} onChange={(event) => setComponentKey(event.target.value)} required>
                {ingredients.map((component) => <option key={component.componentKey} value={component.componentKey}>{component.productName}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Staging status
              <select className="field mt-1.5" value={stagingStatus} onChange={(event) => setStagingStatus(event.target.value as typeof stagingStatus)}>
                {Object.entries(stagingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {selectedMapping ? <div className="mt-3 text-xs leading-5 text-muted-foreground"><MappingStatus mapping={selectedMapping} /></div> : null}
          <label className="mt-4 block text-xs font-medium text-muted-foreground">Allergen review notes (optional)
            <textarea className="field mt-1.5 min-h-20 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
          </label>
          <button type="submit" className="button-primary mt-4">Record allergen review</button>
          <Status disabled={disabled} />
        </fieldset>
      </form>
    </section>
  );
}

export function QcCleaningPanel({ dashboard, canManage, disabled, onSubmit }: {
  dashboard: QcDashboard; canManage: boolean; disabled: boolean; onSubmit: Submit;
}) {
  const [area, setArea] = useState("");
  const [status, setStatus] = useState<QcCleaningRequest["details"]["status"]>("unknown");
  const [notes, setNotes] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<QcCleaningVerificationRequest["details"]["status"]>("verified");
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const cleaning = dashboard.records.filter((record) => record.kind === "cleaning");
  async function submitCleaning(event: FormEvent) {
    event.preventDefault();
    if (await onSubmit({ kind: "cleaning", details: { area: area.trim(), status, notes: notes.trim() } })) {
      setArea(""); setNotes("");
    }
  }
  async function submitVerification(event: FormEvent, recordId: string) {
    event.preventDefault();
    if (await onSubmit({ kind: "cleaning-verification", recordId, details: {
      status: verificationStatus, notes: verificationNotes[recordId]?.trim() ?? "",
    } })) setVerificationNotes((current) => ({ ...current, [recordId]: "" }));
  }
  return (
    <section className="panel min-w-0" aria-labelledby="qc-cleaning-heading">
      <p className="eyebrow">Cleaning evidence</p>
      <h2 id="qc-cleaning-heading" className="mt-1 text-lg font-semibold">Cleaning and independent verification</h2>
      <form className="mt-5" aria-label="Record QC cleaning" onSubmit={submitCleaning}>
        <fieldset disabled={disabled}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">Area or equipment
              <input className="field mt-1.5" value={area} onChange={(event) => setArea(event.target.value)} required maxLength={120} />
            </label>
            <label className="text-xs font-medium text-muted-foreground">Cleaning status
              <select className="field mt-1.5" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                {Object.entries(cleaningLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-4 block text-xs font-medium text-muted-foreground">Cleaning notes (optional)
            <textarea className="field mt-1.5 min-h-20 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
          </label>
          <button type="submit" className="button-primary mt-4">Record cleaning</button>
          <Status disabled={disabled} />
        </fieldset>
      </form>
      <div className="mt-6 border-t border-border/70 pt-4">
        <h3 className="text-sm font-semibold">Recorded cleaning</h3>
        {cleaning.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No cleaning evidence is recorded for this run.</p> : null}
        {cleaning.map((record) => {
          if (record.kind !== "cleaning") return null;
          const verifications = dashboard.records.filter((item) => item.kind === "cleaning-verification" && item.relatedRecordId === record.recordId);
          return <article key={record.recordId} className="mt-4 border-t border-border/50 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{record.details.area}</p><span className="status-pill">{cleaningLabels[record.details.status]}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Sequence {record.sequence} · recorder <span className="font-mono">{record.actorId}</span></p>
            <p className="mt-2 text-xs leading-5">{verifications.length === 0 ? "No independent verification recorded." : verifications.map((item) => <span key={item.recordId} className="block">{item.kind === "cleaning-verification" && item.details.status === "verified" ? "Verified" : "Not verified"} by <span className="font-mono">{item.actorId}</span> at <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time></span>)}</p>
            {canManage ? <form className="mt-3" aria-label={`Verify cleaning ${record.details.area}`} onSubmit={(event) => void submitVerification(event, record.recordId)}>
              <fieldset disabled={disabled}>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
                  <label className="text-xs font-medium text-muted-foreground">Verification for {record.details.area}
                    <select className="field mt-1.5" value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value as typeof verificationStatus)}>
                      <option value="verified">Verified</option><option value="not-verified">Not verified</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-muted-foreground">Verification notes for {record.details.area}
                    <input className="field mt-1.5" value={verificationNotes[record.recordId] ?? ""} onChange={(event) => setVerificationNotes((current) => ({ ...current, [record.recordId]: event.target.value }))} maxLength={1000} />
                  </label>
                </div>
                <button type="submit" className="button-secondary mt-3">Record verification for {record.details.area}</button>
              </fieldset>
            </form> : <p className="mt-3 text-xs text-muted-foreground">A different authorized QC manager must verify this evidence.</p>}
          </article>;
        })}
      </div>
    </section>
  );
}

export function QcSignOffPanel({ dashboard, canManage, disabled, onSignOff }: {
  dashboard: QcDashboard; canManage: boolean; disabled: boolean; onSignOff: () => Promise<boolean>;
}) {
  return (
    <section className="panel min-w-0" aria-labelledby="qc-signoff-heading">
      <p className="eyebrow">Evidence boundary</p>
      <h2 id="qc-signoff-heading" className="mt-1 text-lg font-semibold">QC sign-off</h2>
      {dashboard.signOff ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Signed by</dt><dd className="mt-1 break-all font-mono text-xs">{dashboard.signOff.actorId}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Signed at</dt><dd className="mt-1"><time dateTime={dashboard.signOff.signedAt}>{new Date(dashboard.signOff.signedAt).toLocaleString()}</time></dd></div>
        <div><dt className="text-xs text-muted-foreground">Evidence through</dt><dd className="mt-1 font-mono">{dashboard.signOff.highWaterMark}</dd></div>
      </dl> : <p className="mt-4 text-sm text-muted-foreground">No QC sign-off is recorded for this run.</p>}
      {dashboard.newEvidenceSinceSignOff ? <p className="error-banner mt-4 border-amber-500/40 bg-amber-500/10 text-amber-300" role="status">New evidence recorded since sign-off. The existing sign-off is historical and does not cover the later evidence.</p> : null}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">Sign-off covers evidence through the current high-water mark <strong className="font-mono text-foreground">{dashboard.highWaterMark}</strong>. It is advisory QC evidence only; it does not release, hold, or change production, inventory, schedule, shipping, or run status.</p>
      {canManage ? <button type="button" className="button-primary mt-4" disabled={disabled} onClick={() => void onSignOff()}>Sign off current QC evidence</button>
        : <p className="mt-4 text-xs text-muted-foreground">QC manager authorization is required for sign-off.</p>}
      <Status disabled={disabled || !canManage} />
    </section>
  );
}

export function QcRunVerification({ dashboard, canManage, disabled, onSubmit, onSignOff }: {
  dashboard: QcDashboard; canManage: boolean; disabled: boolean; onSubmit: Submit; onSignOff: () => Promise<boolean>;
}) {
  return <div className="mt-5 grid items-start gap-5 2xl:grid-cols-2">
    <QcComponentCheckPanel dashboard={dashboard} disabled={disabled} onSubmit={onSubmit} />
    <QcAllergenReviewPanel dashboard={dashboard} disabled={disabled} onSubmit={onSubmit} />
    <QcCleaningPanel dashboard={dashboard} canManage={canManage} disabled={disabled} onSubmit={onSubmit} />
    <QcSignOffPanel dashboard={dashboard} canManage={canManage} disabled={disabled} onSignOff={onSignOff} />
  </div>;
}
