import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, createStaffAccount, getStaffDirectory, updateStaffAccount, type AuthSession, type StaffDirectory } from "../api";

export function StaffPage({ session, online }: { session: AuthSession; online: boolean }) {
  const [directory, setDirectory] = useState<StaffDirectory | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roleName, setRoleName] = useState("staff");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getStaffDirectory();
      setDirectory(next);
      if (next.roles.length > 0 && !next.roles.some((role) => role.name === roleName)) setRoleName(next.roles[0]!.name);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Staff accounts could not be loaded.");
    }
  }, [roleName]);

  useEffect(() => { if (online) void refresh(); }, [online]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setDirectory(await createStaffAccount({ username, password, roleName }));
      setUsername("");
      setPassword("");
      setNotice("Staff account created. The password was not stored in the browser.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The staff account could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function update(userId: string, change: { disabled?: boolean; roleName?: string }) {
    setPending(true);
    setError(null);
    try {
      setDirectory(await updateStaffAccount(userId, change));
      setNotice("Account change confirmed; affected sessions were revoked.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The account change failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="page-heading"><div><p className="eyebrow">Manager access</p><h1>Staff accounts</h1><p>Fresh V3 accounts with facility membership, role checks, and session revocation.</p></div></div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}</div> : null}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="panel">
          <h2 className="text-lg font-semibold">Create staff account</h2>
          <form className="mt-5 space-y-4" onSubmit={create}>
            <label className="block text-sm font-medium" htmlFor="new-staff-name">Username<input id="new-staff-name" className="field mt-2" autoComplete="off" minLength={3} maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
            <label className="block text-sm font-medium" htmlFor="new-staff-password">Initial password<input id="new-staff-password" className="field mt-2" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <label className="block text-sm font-medium" htmlFor="new-staff-role">Role<select id="new-staff-role" className="field mt-2" value={roleName} onChange={(event) => setRoleName(event.target.value)}>{directory?.roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select></label>
            <button className="button-primary w-full" type="submit" disabled={!online || pending || !directory}>Create account</button>
          </form>
        </section>
        <section className="panel overflow-x-auto">
          <h2 className="mb-4 text-lg font-semibold">Facility staff</h2>
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-3 font-medium">Username</th><th className="py-3 font-medium">Role</th><th className="py-3 font-medium">Status</th><th className="py-3 text-right font-medium">Action</th></tr></thead>
            <tbody>{directory?.staff.map((staff) => (
              <tr key={staff.userId} className="border-b border-border/60 last:border-0">
                <td className="py-3 font-medium">{staff.username}{staff.userId === session.staff.userId ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}</td>
                <td className="py-3"><select className="field min-h-10 max-w-44 py-1 text-xs" aria-label={`Role for ${staff.username}`} value={staff.role} disabled={!online || pending} onChange={(event) => void update(staff.userId, { roleName: event.target.value })}>{directory.roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select></td>
                <td className="py-3 text-xs text-muted-foreground">{staff.disabled ? "Disabled" : "Active"}</td>
                <td className="py-3 text-right"><button type="button" className="button-secondary min-h-10 px-3 text-xs" disabled={!online || pending || staff.userId === session.staff.userId} onClick={() => void update(staff.userId, { disabled: !staff.disabled })}>{staff.disabled ? "Enable" : "Disable"}</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!directory ? <p className="text-sm text-muted-foreground" role="status">Loading staff accounts…</p> : null}
        </section>
      </div>
    </div>
  );
}
