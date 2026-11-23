import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  acceptStaffInvitation,
  ApiError,
  bootstrapManager,
  completePasswordReset,
  requestPasswordReset,
  signIn,
  type AuthSession,
} from "../api";

type Mode = "sign-in" | "setup" | "invitation" | "forgot" | "reset";

type Props = {
  bootstrapAvailable: boolean;
  error: string | null;
  onRetry: () => void;
  onAuthenticated: (session: AuthSession) => void;
};

const headings: Record<Mode, string> = {
  "sign-in": "Staff sign in",
  setup: "Set up the first manager",
  invitation: "Accept staff invitation",
  forgot: "Request a password reset",
  reset: "Use a recovery code",
};

export function AuthPage({ bootstrapAvailable, error: startupError, onRetry, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [invitationSecret, setInvitationSecret] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const commandRef = useRef<{ action: Mode; requestId: string } | null>(null);

  function changeMode(next: Mode) {
    setMode(next);
    setPassword("");
    setSetupCode("");
    setInvitationSecret("");
    setRecoveryCode("");
    setShowPassword(false);
    setError(null);
    setNotice(null);
    commandRef.current = null;
  }

  function invalidateCommand() {
    commandRef.current = null;
    setNotice(null);
  }

  function requestId() {
    if (commandRef.current?.action !== mode) commandRef.current = { action: mode, requestId: crypto.randomUUID() };
    return commandRef.current.requestId;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError("Reconnect before changing account access. Offline access is read-only.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        onAuthenticated(await signIn(username, password));
      } else if (mode === "setup") {
        onAuthenticated(await bootstrapManager(username, password, setupCode));
      } else if (mode === "invitation") {
        await acceptStaffInvitation({ secret: invitationSecret, username, password, requestId: requestId() });
        commandRef.current = null;
        setMode("sign-in");
        setPassword("");
        setInvitationSecret("");
        setNotice("Invitation accepted. Sign in with your new account.");
      } else if (mode === "forgot") {
        await requestPasswordReset(username, requestId());
        commandRef.current = null;
        setNotice("If the account is eligible, a reset request is now waiting for manager approval. No account details were confirmed.");
      } else {
        await completePasswordReset({ username, code: recoveryCode, password, requestId: requestId() });
        commandRef.current = null;
        setMode("sign-in");
        setPassword("");
        setRecoveryCode("");
        setNotice("Password reset confirmed. Sign in with your new password.");
      }
    } catch (cause) {
      setError(cause instanceof ApiError
        ? cause.message
        : "The account request could not be confirmed. Check the connection and retry with the same details.");
    } finally {
      setPending(false);
    }
  }

  const passwordLabel = mode === "reset" ? "New password" : mode === "invitation" ? "Create password" : "Password";
  const submitLabel = mode === "sign-in" ? "Sign in"
    : mode === "setup" ? "Create first manager"
      : mode === "invitation" ? "Accept invitation"
        : mode === "forgot" ? "Request reset" : "Reset password";

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
            <h2 id="access-heading" className="text-lg font-semibold">{headings[mode]}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "setup" ? "Available once on a fresh V3 database with the administrator’s setup code."
                : mode === "invitation" ? "Enter the one-time secret supplied by your manager. Invitation secrets are never read from a URL."
                  : mode === "forgot" ? "A manager must approve the request and give you a single-use recovery code."
                    : mode === "reset" ? "Use the eight-character code before it expires. Approved codes are valid for 30 minutes."
                      : "Use your V3 staff account. V1 and V2 credentials are not transferred."}
            </p>

            {startupError ? (
              <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4" role="alert">
                <p className="text-sm text-destructive">{startupError}</p>
                <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">Check server again</button>
              </div>
            ) : (
              <form className="mt-6 space-y-5" onSubmit={submit}>
                {mode === "setup" ? (
                  <label className="block text-sm font-medium" htmlFor="setup-code">
                    One-time setup code
                    <input id="setup-code" className="field mt-2" type="password" autoComplete="off" minLength={32} maxLength={256} value={setupCode} onChange={(event) => setSetupCode(event.target.value)} required />
                  </label>
                ) : null}
                {mode === "invitation" ? (
                  <label className="block text-sm font-medium" htmlFor="invitation-secret">
                    Invitation secret
                    <input id="invitation-secret" className="field mt-2 font-mono" type="password" autoComplete="off" minLength={43} maxLength={43} value={invitationSecret} onChange={(event) => { setInvitationSecret(event.target.value.trim()); invalidateCommand(); }} required />
                  </label>
                ) : null}
                <label className="block text-sm font-medium" htmlFor="username">
                  Username
                  <input id="username" className="field mt-2" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} value={username} onChange={(event) => { setUsername(event.target.value); invalidateCommand(); }} required />
                </label>
                {mode === "reset" ? (
                  <label className="block text-sm font-medium" htmlFor="recovery-code">
                    Recovery code
                    <input id="recovery-code" className="field mt-2 font-mono uppercase tracking-widest" type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={64} placeholder="XXXX-XXXX" value={recoveryCode} onChange={(event) => { setRecoveryCode(event.target.value); invalidateCommand(); }} required />
                  </label>
                ) : null}
                {mode !== "forgot" ? (
                  <label className="block text-sm font-medium" htmlFor="password">
                    {passwordLabel}
                    <span className="relative mt-2 block">
                      <input id="password" className="field pr-12" type={showPassword ? "text" : "password"} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={mode === "sign-in" ? 1 : 6} maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); invalidateCommand(); }} required />
                      <button type="button" className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                ) : null}
                {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
                {notice ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300" role="status">{notice}</p> : null}
                <button type="submit" className="button-primary w-full" disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {pending ? "Contacting server…" : submitLabel}
                </button>
              </form>
            )}

            {!startupError ? (
              <div className="mt-5 space-y-1 text-center text-sm">
                {mode === "sign-in" ? (
                  <>
                    <button type="button" className="min-h-11 w-full text-amber-400 hover:text-amber-300" onClick={() => changeMode("forgot")}>Forgot password?</button>
                    <button type="button" className="min-h-11 w-full text-muted-foreground hover:text-foreground" onClick={() => changeMode("invitation")}>Accept an invitation</button>
                    <button type="button" className="min-h-11 w-full text-muted-foreground hover:text-foreground" onClick={() => changeMode("reset")}>I have a recovery code</button>
                  </>
                ) : (
                  <>
                    {mode === "forgot" ? <button type="button" className="min-h-11 w-full text-amber-400 hover:text-amber-300" onClick={() => changeMode("reset")}>I have a recovery code</button> : null}
                    <button type="button" className="min-h-11 w-full text-muted-foreground hover:text-foreground" onClick={() => changeMode("sign-in")}>Back to staff sign in</button>
                  </>
                )}
                {bootstrapAvailable && mode !== "setup" ? <button type="button" className="min-h-11 w-full text-amber-400 hover:text-amber-300" onClick={() => changeMode("setup")}>Set up the first manager</button> : null}
              </div>
            ) : null}
          </div>
        </section>
        <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">Offline mode is read-only. Writes resume only after the server confirms the latest state.</p>
      </div>
    </main>
  );
}
