export type FeatureKey = "inventory" | "warehouse" | "qc" | "reports";

const features: Record<FeatureKey, {
  title: string;
  eyebrow: string;
  status: string;
  description: string;
  scope: string[];
}> = {
  inventory: {
    title: "Inventory",
    eyebrow: "Stock authority",
    status: "Server API and exact-once consumption ported · interface pending",
    description: "Opening counts, receipts, adjustments, and run consumption remain server-authoritative and receipted.",
    scope: ["Physical opening counts and cycle counts", "Receipts, adjustments, reconciliation, and movement history", "Exact-once run consumption with shortage recording"],
  },
  warehouse: {
    title: "Warehouse",
    eyebrow: "Stock movement",
    status: "Multi-warehouse API ported · interface pending",
    description: "Warehouse and freezer workflows will share the same facility stock ledger as runs and inventory.",
    scope: ["Warehouse assignment and stock on hand", "Transfers and append-only movements", "V1 freezer-pull and surplus workflows ported in a later tested wave"],
  },
  qc: {
    title: "Quality control",
    eyebrow: "Quality and floor events",
    status: "Role foundation ported · V1 workflows pending",
    description: "V1’s QC and operational evidence screens remain in the approved non-AI target; no quality result is inferred by AI.",
    scope: ["QC checks, photos, review status, and allergens", "Stoppages and production exceptions", "Role-checked recording and review"],
  },
  reports: {
    title: "Reports and history",
    eyebrow: "Production evidence",
    status: "Audit and receipt foundation ported · reporting interface pending",
    description: "Reports will read confirmed V3 runs, inventory receipts, schedules, and audit events rather than separate local histories.",
    scope: ["Run history and day summaries", "Downtime and station trends", "CSV export and auditable production receipts"],
  },
};

export function FeaturePage({ feature, online }: { feature: FeatureKey; online: boolean }) {
  const content = features[feature];
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
        <span className="status-pill">{online ? "Connected" : "Read-only offline"}</span>
      </div>
      <section className="panel mt-6 max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Approved V3 scope</h2>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">{content.status}</span>
        </div>
        <ul className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
          {content.scope.map((item) => <li key={item} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />{item}</li>)}
        </ul>
        <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">This navigation surface is active, but its feature-specific controls are not yet presented as working. Each wave must pass server, browser, and regression verification before its status changes.</p>
      </section>
    </div>
  );
}
