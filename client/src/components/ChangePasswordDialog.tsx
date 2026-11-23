import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, changeOwnPassword, type AuthSession } from "../api";

export function ChangePasswordDialog({ online, onChanged, onClose }: {
  online: boolean;
  onChanged: (session: AuthSession) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const commandRef = useRef<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!online) {
      setError("Reconnect before changing your password. Offline access is read-only.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new password and confirmation do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("Choose a new password different from the current password.");
      return;
    }
    commandRef.current ??= crypto.randomUUID();
    setPending(true);
    try {
      const session = await changeOwnPassword({ currentPassword, newPassword, requestId: commandRef.current });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      commandRef.current = null;
      onChanged(session);
      dialogRef.current?.close();
    } catch (cause) {
      setError(cause instanceof ApiError
        ? cause.message
        : "The password change was not confirmed. Retry with the same details; if necessary, sign in with the new password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/70"
      aria-labelledby="change-password-heading"
      onClose={onClose}
    >
      <form className="p-5 sm:p-6" onSubmit={submit}>
        <p className="eyebrow">Account security</p>
        <h2 id="change-password-heading" className="mt-2 text-xl font-semibold">Change password</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">A confirmed change revokes your other sessions and starts a fresh session on this device.</p>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium" htmlFor="current-password">Current password
            <input id="current-password" className="field mt-2" type="password" autoComplete="current-password" autoFocus maxLength={128} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); commandRef.current = null; }} required />
          </label>
          <label className="block text-sm font-medium" htmlFor="new-password">New password
            <input id="new-password" className="field mt-2" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); commandRef.current = null; }} required />
          </label>
          <label className="block text-sm font-medium" htmlFor="confirm-new-password">Confirm new password
            <input id="confirm-new-password" className="field mt-2" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); commandRef.current = null; }} required />
          </label>
        </div>
        {error ? <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className="button-secondary" onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="submit" className="button-primary" disabled={!online || pending}>{pending ? "Changing…" : "Change password"}</button>
        </div>
      </form>
    </dialog>
  );
}
