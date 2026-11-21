import { useCallback, useEffect, useState } from "react";
import { ApiError, getBootstrapStatus, getSession, signOut, type AuthSession } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { AppShell } from "./components/AppShell";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [current, canBootstrap] = await Promise.all([getSession(), getBootstrapStatus()]);
      setSession(current);
      setBootstrapAvailable(canBootstrap);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The server could not be reached. Check the connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <div className="text-center" role="status">
          <img src="/logo.svg" alt="" className="mx-auto mb-5 h-16 w-16 rounded-2xl" />
          <p className="text-sm text-muted-foreground">Confirming your staff session…</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthPage
        bootstrapAvailable={bootstrapAvailable}
        error={error}
        onRetry={() => void refresh()}
        onAuthenticated={(next) => { setSession(next); setBootstrapAvailable(false); }}
      />
    );
  }

  return (
    <AppShell
      session={session}
      onSignOut={async () => {
        await signOut();
        setSession(null);
      }}
    />
  );
}
