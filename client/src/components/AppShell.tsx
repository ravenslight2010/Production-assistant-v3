import { useEffect, useState, type ComponentType } from "react";
import { Activity, BarChart3, Boxes, CalendarDays, ClipboardCheck, Settings2, Users, Warehouse } from "lucide-react";
import type { AuthSession } from "../api";
import { RunPage } from "../pages/RunPage";
import { FeaturePage, type FeatureKey } from "../pages/FeaturePage";
import { StaffPage } from "../pages/StaffPage";
import { SchedulePage } from "../pages/SchedulePage";
import { SetupPage } from "../pages/SetupPage";
import { InventoryPage } from "../pages/InventoryPage";

type View = "run" | "schedule" | "setup" | "inventory" | "warehouse" | "qc" | "reports" | "staff";
type NavItem = { id: View; label: string; icon: ComponentType<{ className?: string }> };

const navigation: NavItem[] = [
  { id: "run", label: "Live run", icon: Activity },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "warehouse", label: "Warehouse", icon: Warehouse },
  { id: "qc", label: "QC", icon: ClipboardCheck },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

function initialView(): View {
  const candidate = window.location.hash.slice(1);
  return navigation.some((item) => item.id === candidate) || candidate === "staff" ? candidate as View : "run";
}

export function AppShell({ session, onSignOut }: { session: AuthSession; onSignOut: () => Promise<void> }) {
  const [view, setView] = useState<View>(initialView);
  const [online, setOnline] = useState(navigator.onLine);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const canManageStaff = session.staff.capabilities.includes("manage-staff");
  const items = canManageStaff ? [...navigation, { id: "staff" as const, label: "Staff", icon: Users }] : navigation;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const navigate = () => setView(initialView());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);

  function navigate(next: View) {
    window.location.hash = next;
    setView(next);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/80">
        <div className="app-shell flex min-h-20 flex-wrap items-center gap-3 py-3">
          <button type="button" className="flex min-h-11 items-center gap-3 text-left" onClick={() => navigate("run")} aria-label="Production Assistant live run">
            <img src="/logo.svg" alt="" className="h-10 w-10 rounded-xl" />
            <span>
              <span className="block text-sm font-bold tracking-tight">Production Assistant</span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Server-owned operations</span>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <span className={`connection ${online ? "text-emerald-300" : "text-amber-300"}`} role="status">
              <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden="true" />
              {online ? "Connected" : "Read-only offline"}
            </span>
            <span className="hidden text-right sm:block">
              <span className="block text-xs font-medium">{session.staff.username}</span>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{session.staff.role}</span>
            </span>
            <button type="button" className="button-secondary min-h-11 px-3 text-xs" disabled={signingOut} onClick={() => {
              setSigningOut(true);
              setSignOutError(null);
              void onSignOut().catch(() => setSignOutError("Sign-out was not confirmed. Retry while connected.")).finally(() => setSigningOut(false));
            }}>{signingOut ? "Signing out…" : "Sign out"}</button>
          </div>
          {signOutError ? <p className="w-full text-right text-xs text-destructive" role="alert">{signOutError}</p> : null}
        </div>
      </header>

      <nav className="border-b border-border/60 bg-background" aria-label="Production sections">
        <div className="app-shell flex gap-1 overflow-x-auto py-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={`nav-tab ${view === item.id ? "nav-tab-active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
                <Icon className="h-4 w-4" />{item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="app-shell py-6 sm:py-8">
        {view === "run" ? <RunPage session={session} online={online} /> : null}
        {view === "schedule" ? <SchedulePage session={session} online={online} /> : null}
        {view === "setup" ? <SetupPage session={session} online={online} /> : null}
        {view === "inventory" ? <InventoryPage session={session} online={online} /> : null}
        {view === "staff" && canManageStaff ? <StaffPage session={session} online={online} /> : null}
        {!["run", "schedule", "setup", "inventory", "staff"].includes(view) ? <FeaturePage feature={view as FeatureKey} online={online} /> : null}
      </main>
    </div>
  );
}
