import { useState, type FormEvent } from "react";
import { CalendarCheck, ClipboardCheck, Snowflake } from "lucide-react";
import type {
  CycleCountSchedule,
  MarkCycleCountedRequest,
  SaveCycleCountScheduleRequest,
  WarehouseGuidance,
} from "../api";

export function WarehouseGuidancePanel({
  guidance,
  canManage,
  disabled,
  onMark,
  onSave,
}: {
  guidance: WarehouseGuidance;
  canManage: boolean;
  disabled: boolean;
  onMark: (request: MarkCycleCountedRequest) => Promise<boolean>;
  onSave: (request: SaveCycleCountScheduleRequest) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<CycleCountSchedule | null>(null);
  const [section, setSection] = useState("");
  const [cadenceDays, setCadenceDays] = useState("7");
  const [enabled, setEnabled] = useState(true);

  function configure(schedule: CycleCountSchedule | null) {
    setEditing(schedule);
    setSection(schedule?.section ?? "");
    setCadenceDays(String(schedule?.cadenceDays ?? 7));
    setEnabled(schedule?.enabled ?? true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = section.trim();
    const cadence = Number(cadenceDays);
    if (disabled || !name || !Number.isInteger(cadence) || cadence < 1 || cadence > 365) return;
    const saved = await onSave({
      requestId: crypto.randomUUID(), section: name, cadenceDays: cadence,
      enabled, expectedRevision: editing?.revision ?? 0,
    });
    if (saved) configure(null);
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <section className="panel min-w-0" aria-labelledby="cycle-count-heading">
        <div className="panel-heading"><div><p className="eyebrow">Factory date {guidance.factoryDate}</p><h2 id="cycle-count-heading" className="mt-1 text-lg font-semibold">Cycle counts</h2></div><ClipboardCheck className="h-5 w-5 text-amber-300" /></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Count reminders never change stock. Staff may confirm enabled sections; managers own cadence and availability.</p>
        <div className="mt-5 space-y-3">
          {guidance.cycleCounts.map((schedule) => <article key={schedule.section} className="rounded-lg border border-border/70 bg-background/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{schedule.section}</h3><p className="mt-1 text-xs text-muted-foreground">Every {schedule.cadenceDays} days · {schedule.enabled ? schedule.lastCountedOn ? `Last counted ${schedule.lastCountedOn}` : "Never counted" : "Disabled"}</p></div><span className={`status-pill ${schedule.due ? "border-amber-500/40 text-amber-300" : ""}`}>{schedule.due ? schedule.overdueDays ? `${schedule.overdueDays} days overdue` : "Due" : schedule.enabled ? "Scheduled" : "Disabled"}</span></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {schedule.enabled ? <button type="button" className="button-secondary" disabled={disabled} onClick={() => void onMark({ requestId: crypto.randomUUID(), section: schedule.section })}><CalendarCheck className="h-4 w-4" />{schedule.due ? "Mark counted" : "Confirm count"}</button> : null}
              {canManage ? <button type="button" className="button-secondary" disabled={disabled} onClick={() => configure(schedule)}>Configure</button> : null}
            </div>
          </article>)}
          {guidance.cycleCounts.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No cycle-count sections are configured.</p> : null}
        </div>
        {canManage ? <form className="mt-5 border-t border-border/70 pt-5" onSubmit={(event) => void submit(event)}>
          <h3 className="text-sm font-medium">{editing ? `Configure ${editing.section}` : "Add cycle-count section"}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_140px]">
            <label className="text-xs font-medium" htmlFor="cycle-section">Section<input id="cycle-section" className="field mt-1.5" value={section} maxLength={120} required disabled={disabled || editing !== null} onChange={(event) => setSection(event.target.value)} /></label>
            <label className="text-xs font-medium" htmlFor="cycle-cadence">Cadence (days)<input id="cycle-cadence" className="field mt-1.5" type="number" min={1} max={365} step={1} value={cadenceDays} required disabled={disabled} onChange={(event) => setCadenceDays(event.target.value)} /></label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled for reminders and staff confirmation</label>
          <div className="mt-3 flex gap-2"><button type="submit" className="button-secondary" disabled={disabled || !section.trim()}>{editing ? "Save schedule" : "Add schedule"}</button>{editing ? <button type="button" className="button-secondary" disabled={disabled} onClick={() => configure(null)}>Cancel edit</button> : null}</div>
        </form> : null}
      </section>

      <section className="panel min-w-0" aria-labelledby="freezer-pull-heading">
        <div className="panel-heading"><div><p className="eyebrow">Scheduled demand</p><h2 id="freezer-pull-heading" className="mt-1 text-lg font-semibold">Freezer pull</h2></div><Snowflake className="h-5 w-5 text-amber-300" /></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Enabled factory setup items are matched case-insensitively to scheduled recipe and packaging lines. Past runs and items outside their lead-time window are omitted.</p>
        <div className="mt-5 space-y-4">
          {guidance.freezerPull.groups.map((group) => <article key={group.runId} className="rounded-lg border border-border/70 bg-background/40 p-3">
            <div className="flex flex-wrap justify-between gap-2"><div><h3 className="text-sm font-medium">{group.productionDate} · {group.productCode}</h3><p className="mt-1 text-xs text-muted-foreground">{group.targetCases} target cases</p></div><span className="status-pill">{group.items.length} items</span></div>
            <ul className="mt-3 space-y-2">{group.items.map((item) => <li key={item.code} className="border-t border-border/50 pt-2 text-xs"><div className="flex justify-between gap-3"><span>{item.ingredientName}</span><span className="font-mono text-amber-300">{item.resolved ? `${item.quantity} ${item.unit}` : "Unresolved"}</span></div>{item.warning ? <p className="mt-1 leading-5 text-amber-200" role="note">{item.warning}</p> : null}</li>)}</ul>
          </article>)}
          {guidance.freezerPull.groups.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No enabled freezer-pull items are due from the current production schedule.</p> : null}
        </div>
      </section>
    </div>
  );
}
