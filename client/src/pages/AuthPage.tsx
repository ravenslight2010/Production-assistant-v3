import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { ApiError, bootstrapManager, signIn, type AuthSession } from "../api";

type Props = {
  bootstrapAvailable: boolean;
  error: string | null;
  onRetry: () => void;
  onAuthenticated: (session: AuthSession) => void;
};

export function AuthPage({ bootstrapAvailable, error: startupError, onRetry, onAuthenticated }: Props) {
  const [setup, setSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError("Reconnect before signing in. Offline access is read-only.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      onAuthenticated(setup
        ? await bootstrapManager(username, password, code)
        : await signIn(username, password));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Sign-in failed. Check the connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/logo.svg" alt="Production Assistant" className="mx-auto mb-5 h-20 w-20 rounded-2xl shadow-lg" />
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-amber-500">Production floor · V3</p>
          <h1 className="text-3xl font-bold tracking-tight">Production Assistant</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Planning, run control, and inventory with one server-confirmed production state.
          </p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl" aria-labelledby="access-heading">
          <div className="h-1 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-300" />
          <div className="p-6 sm:p-7">
            <h2 id="access-heading" className="text-lg font-semibold">{setup ? "Set up the first manager" : "Staff sign in"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {setup ? "Available once on a fresh V3 database with the administrator’s setup code." : "Use your V3 staff account. V1 and V2 credentials are not transferred."}
            </p>

            {startupError ? (
              <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4" role="alert">
                <p className="text-sm text-destructive">{startupError}</p>
                <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">Check server again</button>
              </div>
            ) : (
              <form className="mt-6 space-y-5" onSubmit={submit}>
                {setup ? (
                  <label className="block text-sm font-medium" htmlFor="setup-code">
                    One-time setup code
                    <input id="setup-code" className="field mt-2" type="password" autoComplete="off" minLength={32} maxLength={256} value={code} onChange={(event) => setCode(event.target.value)} required />
                  </label>
                ) : null}
                <label className="block text-sm font-medium" htmlFor="username">
                  Username
                  <input id="username" className="field mt-2" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} required />
                </label>
                <label className="block text-sm font-medium" htmlFor="password">
                  Password
                  <span className="relative mt-2 block">
                    <input id="password" className="field pr-12" type={showPassword ? "text" : "password"} autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 6 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
                    <button type="button" className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </span>
                </label>
                {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
                <button type="submit" className="button-primary w-full" disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {pending ? "Contacting server…" : setup ? "Create first manager" : "Sign in"}
                </button>
              </form>
            )}

            {bootstrapAvailable && !startupError ? (
              <button type="button" className="mt-5 min-h-11 w-full text-sm text-amber-400 hover:text-amber-300" onClick={() => { setSetup((value) => !value); setError(null); }}>
                {setup ? "Back to staff sign in" : "Set up the first manager"}
              </button>
            ) : null}
          </div>
        </section>
        <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">Offline mode is read-only. Writes resume only after the server confirms the latest state.</p>
      </div>
    </main>
  );
}
