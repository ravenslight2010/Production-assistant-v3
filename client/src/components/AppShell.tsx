import { useEffect, useState, type ComponentType } from "react";
import { Activity, BarChart3, Boxes, CalendarDays, ClipboardCheck, CookingPot, Settings2, Users, Warehouse } from "lucide-react";
import { getPasswordResetRequests, type AuthSession } from "../api";
import { RunPage } from "../pages/RunPage";
import { FeaturePage, type FeatureKey } from "../pages/FeaturePage";
import { StaffPage } from "../pages/StaffPage";
import { SchedulePage } from "../pages/SchedulePage";
import { SetupPage } from "../pages/SetupPage";
import { InventoryPage } from "../pages/InventoryPage";
import { MixPlanPage } from "../pages/MixPlanPage";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

type View = "run" | "schedule" | "mix" | "setup" | "inventory" | "warehouse" | "qc" | "reports" | "staff";
type NavItem = { id: View; label: string; icon: ComponentType<{ className?: string }> };

const navigation: NavItem[] = [
  { id: "run", label: "Live run", icon: Activity },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "mix", label: "Mix Plan", icon: CookingPot },
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

export function AppShell({ session, onSessionChange, onSignOut }: {
  session: AuthSession;
  onSessionChange: (session: AuthSession) => void;
  onSignOut: () => Promise<void>;
}) {
  const [view, setView] = useState<View>(initialView);
  const [online, setOnline] = useState(navigator.onLine);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [pendingResetCount, setPendingResetCount] = useState<number | null>(null);
  const canManageStaff = session.staff.capabilities.includes("manage-staff");
  const canApproveResets = session.staff.capabilities.includes("approve-password-resets");
  const canAccessStaff = canManageStaff || canApproveResets;
  const items = canAccessStaff ? [...navigation, { id: "staff" as const, label: "Staff", icon: Users }] : navigation;
  const activeView = view === "staff" && !canAccessStaff ? "run" : view;

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

  useEffect(() => {
    if (view === "staff" && !canAccessStaff) {
      window.location.hash = "run";
      setView("run");
    }
  }, [view, canAccessStaff]);

  useEffect(() => {
    if (!online || !canApproveResets) {
      setPendingResetCount(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const schedule = (delay: number) => {
      if (!stopped) timer = setTimeout(poll, delay);
    };
    const poll = async () => {
      controller = new AbortController();
      try {
        const queue = await getPasswordResetRequests(controller.signal);
        if (!stopped) setPendingResetCount(queue.pendingCount);
      } catch (cause) {
        if (!stopped && (!(cause instanceof Error) || cause.name !== "AbortError")) setPendingResetCount(null);
      } finally {
        if (!stopped) schedule(document.hidden ? 120_000 : 20_000);
      }
    };

    schedule(Math.floor(Math.random() * 10_001));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [online, canApproveResets]);

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
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <span className={`connection ${online ? "text-emerald-300" : "text-amber-300"}`} role="status">
              <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden="true" />
              {online ? "Connected" : "Read-only offline"}
            </span>
            <span className="hidden text-right sm:block">
              <span className="block text-xs font-medium">{session.staff.username}</span>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{session.staff.role}</span>
            </span>
            <button type="button" className="button-secondary min-h-11 px-3 text-xs" onClick={() => { setAccountNotice(null); setChangePasswordOpen(true); }}>Change password</button>
            <button type="button" className="button-secondary min-h-11 px-3 text-xs" disabled={signingOut} onClick={() => {
              setSigningOut(true);
              setSignOutError(null);
              void onSignOut().catch(() => setSignOutError("Sign-out was not confirmed. Retry while connected.")).finally(() => setSigningOut(false));
            }}>{signingOut ? "Signing out…" : "Sign out"}</button>
          </div>
          {signOutError ? <p className="w-full text-right text-xs text-destructive" role="alert">{signOutError}</p> : null}
          {accountNotice ? <p className="w-full text-right text-xs text-emerald-300" role="status">{accountNotice}</p> : null}
        </div>
      </header>

      <nav className="border-b border-border/60 bg-background" aria-label="Production sections">
        <div className="app-shell flex gap-1 overflow-x-auto py-2">
          {items.map((item) => {
            const Icon = item.icon;
            const showResetBadge = item.id === "staff" && canApproveResets && pendingResetCount !== null && pendingResetCount > 0;
            return (
              <span key={item.id} className="relative shrink-0">
                <button type="button" className={`nav-tab ${activeView === item.id ? "nav-tab-active" : ""}`} aria-current={activeView === item.id ? "page" : undefined} aria-describedby={showResetBadge ? "staff-reset-count" : undefined} onClick={() => navigate(item.id)}>
                  <Icon className="h-4 w-4" />{item.label}
                  {showResetBadge ? <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary-foreground" aria-hidden="true">{pendingResetCount}</span> : null}
                </button>
                {showResetBadge ? <span id="staff-reset-count" className="sr-only">{pendingResetCount} pending password reset {pendingResetCount === 1 ? "request" : "requests"}</span> : null}
              </span>
            );
          })}
        </div>
      </nav>

      <main className="app-shell py-6 sm:py-8">
        {activeView === "run" ? <RunPage session={session} online={online} /> : null}
        {activeView === "schedule" ? <SchedulePage session={session} online={online} /> : null}
        {activeView === "mix" ? <MixPlanPage session={session} online={online} /> : null}
        {activeView === "setup" ? <SetupPage session={session} online={online} /> : null}
        {activeView === "inventory" ? <InventoryPage session={session} online={online} /> : null}
        {activeView === "staff" && canAccessStaff ? <StaffPage session={session} online={online} /> : null}
        {!["run", "schedule", "mix", "setup", "inventory", "staff"].includes(activeView) ? <FeaturePage feature={activeView as FeatureKey} online={online} /> : null}
      </main>

      {changePasswordOpen ? <ChangePasswordDialog online={online} onClose={() => setChangePasswordOpen(false)} onChanged={(next) => { onSessionChange(next); setAccountNotice("Password changed. Other sessions were revoked and this device has a fresh session."); }} /> : null}
    </div>
  );
}
