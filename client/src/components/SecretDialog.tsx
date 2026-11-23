import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";

export function SecretDialog({ title, description, secret, secretLabel, onClose }: {
  title: string;
  description: string;
  secret: string;
  secretLabel: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  async function copy() {
    setCopyStatus(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(secret);
      setCopyStatus("Copied. Store it only in the approved handoff channel.");
    } catch {
      setCopyStatus("Automatic copy is unavailable. Select the displayed text and copy it manually.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/70"
      aria-labelledby="secret-dialog-heading"
      onClose={onClose}
    >
      <div className="border-b border-border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">One-time account secret</p>
            <h2 id="secret-dialog-heading" className="mt-2 text-xl font-semibold">{title}</h2>
          </div>
          <button type="button" className="button-secondary min-h-11 w-11 px-0" aria-label="Close secret dialog" autoFocus onClick={() => dialogRef.current?.close()}><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="p-5 sm:p-6">
        <label className="block text-sm font-medium" htmlFor="one-time-secret">{secretLabel}</label>
        <textarea id="one-time-secret" className="field mt-2 min-h-24 resize-none break-all font-mono text-base" readOnly value={secret} onFocus={(event) => event.currentTarget.select()} />
        <p className="mt-3 text-sm text-amber-300">This plaintext cannot be retrieved after closing. Closing clears it from this screen.</p>
        {copyStatus ? <p className="mt-3 text-sm text-muted-foreground" role="status">{copyStatus}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" className="button-secondary" onClick={() => void copy()}><Copy className="h-4 w-4" />Copy secret</button>
          <button type="button" className="button-primary" onClick={() => dialogRef.current?.close()}>I have secured it</button>
        </div>
      </div>
    </dialog>
  );
}
