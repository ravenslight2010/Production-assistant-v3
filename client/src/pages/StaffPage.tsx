import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  approvePasswordReset,
  createStaffAccount,
  createStaffInvitation,
  declinePasswordReset,
  getPasswordResetRequests,
  getStaffDirectory,
  getStaffInvitations,
  reissuePasswordReset,
  revokeStaffInvitation,
  revokeStaffSessions,
  updateStaffAccount,
  type AuthSession,
  type PasswordResetQueue,
  type PasswordResetRequest,
  type StaffAccount,
  type StaffDirectory,
  type StaffInvitation,
} from "../api";
import { SecretDialog } from "../components/SecretDialog";

type SecretState = {
  title: string;
  description: string;
  secret: string;
  secretLabel: string;
};

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}

function replaceById<T, K extends keyof T>(items: T[], replacement: T, key: K) {
  return items.map((item) => item[key] === replacement[key] ? replacement : item);
}

export function StaffPage({ session, online }: { session: AuthSession; online: boolean }) {
  const canManage = session.staff.capabilities.includes("manage-staff");
  const canApprove = session.staff.capabilities.includes("approve-password-resets");
  const [directory, setDirectory] = useState<StaffDirectory | null>(null);
  const [invitations, setInvitations] = useState<StaffInvitation[] | null>(null);
  const [resetQueue, setResetQueue] = useState<PasswordResetQueue | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roleName, setRoleName] = useState("staff");
  const [invitationRole, setInvitationRole] = useState("staff");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<SecretState | null>(null);
  const commands = useRef(new Map<string, string>());

  function commandId(key: string) {
    let value = commands.current.get(key);
    if (!value) {
      value = crypto.randomUUID();
      commands.current.set(key, value);
    }
    return value;
  }

  const refresh = useCallback(async () => {
    if (!online) return;
    const jobs: Promise<void>[] = [];
    if (canManage) {
      jobs.push(getStaffDirectory().then((nextDirectory) => {
        setDirectory(nextDirectory);
        if (nextDirectory.roles.length > 0) {
          setRoleName((current) => nextDirectory.roles.some((role) => role.name === current) ? current : nextDirectory.roles[0]!.name);
          setInvitationRole((current) => nextDirectory.roles.some((role) => role.name === current) ? current : nextDirectory.roles[0]!.name);
        }
      }).catch((cause: unknown) => setError(errorMessage(cause, "Staff accounts could not be loaded."))));
      jobs.push(getStaffInvitations().then(setInvitations).catch((cause: unknown) => setError(errorMessage(cause, "Invitations could not be loaded."))));
    }
    if (canApprove) {
      jobs.push(getPasswordResetRequests().then(setResetQueue).catch((cause: unknown) => setError(errorMessage(cause, "Password reset requests could not be loaded."))));
    }
    await Promise.all(jobs);
  }, [online, canManage, canApprove]);

  useEffect(() => { void refresh(); }, [refresh]);

  function adoptConflict(cause: unknown) {
    if (!(cause instanceof ApiError) || cause.status !== 409) return false;
    const currentStaff = (cause.details.currentStaff ?? cause.details.staff) as StaffAccount | undefined;
    const currentInvitation = (cause.details.currentInvitation ?? cause.details.invitation) as StaffInvitation | undefined;
    const currentRequest = (cause.details.currentRequest ?? cause.details.request) as PasswordResetRequest | undefined;
    if (currentStaff?.userId) setDirectory((current) => current ? { ...current, staff: replaceById(current.staff, currentStaff, "userId") } : current);
    if (currentInvitation?.invitationId) setInvitations((current) => current ? replaceById(current, currentInvitation, "invitationId") : current);
    if (currentRequest?.requestId) setResetQueue((current) => current ? { ...current, requests: replaceById(current.requests, currentRequest, "requestId") } : current);
    return Boolean(currentStaff || currentInvitation || currentRequest);
  }

  function actionError(cause: unknown, fallback: string) {
    const adopted = adoptConflict(cause);
    setError(`${errorMessage(cause, fallback)}${adopted ? " Canonical state is now shown; review it before retrying." : ""}`);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const key = "create-staff";
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      setDirectory(await createStaffAccount({ username, password, roleName, requestId: commandId(key) }));
      commands.current.delete(key);
      setUsername("");
      setPassword("");
      setNotice("Staff account created. The password was not stored in the browser.");
    } catch (cause) {
      actionError(cause, "The staff account could not be created. Retry with the same details if the outcome is uncertain.");
    } finally {
      setPending(false);
    }
  }

  async function update(staff: StaffAccount, change: { disabled?: boolean; roleName?: string }) {
    const key = `staff:${staff.userId}:${staff.revision}:${JSON.stringify(change)}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      setDirectory(await updateStaffAccount(staff.userId, { ...change, expectedRevision: staff.revision, requestId: commandId(key) }));
      commands.current.delete(key);
      setNotice("Account change confirmed; affected sessions were revoked.");
    } catch (cause) {
      actionError(cause, "The account change failed.");
    } finally {
      setPending(false);
    }
  }

  async function revokeSessions(staff: StaffAccount) {
    const key = `sessions:${staff.userId}:${staff.revision}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await revokeStaffSessions(staff, commandId(key));
      commands.current.delete(key);
      setDirectory((current) => current ? { ...current, staff: replaceById(current.staff, result.staff, "userId") } : current);
      setNotice(`Sessions revoked for ${staff.username}.`);
    } catch (cause) {
      actionError(cause, "Sessions could not be revoked.");
    } finally {
      setPending(false);
    }
  }

  async function createInvitation(event: FormEvent) {
    event.preventDefault();
    const key = `create-invitation:${invitationRole}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createStaffInvitation({ roleName: invitationRole, requestId: commandId(key) });
      commands.current.delete(key);
      setInvitations((current) => current ? [result.invitation, ...current] : [result.invitation]);
      setSecret({
        title: "Invitation created",
        description: "Give this secret to the staff member through the approved handoff channel. They must enter it on the invitation-acceptance form; do not put it in a URL.",
        secret: result.secret,
        secretLabel: "Invitation secret",
      });
    } catch (cause) {
      actionError(cause, "The invitation could not be created. If the outcome is uncertain, retry once with the same role; a secret replay will not reveal plaintext.");
    } finally {
      setPending(false);
    }
  }

  async function revokeInvitation(invitation: StaffInvitation) {
    const key = `revoke-invitation:${invitation.invitationId}:${invitation.revision}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await revokeStaffInvitation(invitation, commandId(key));
      commands.current.delete(key);
      setInvitations((current) => current ? replaceById(current, result.invitation, "invitationId") : current);
      setNotice("Invitation revoked.");
    } catch (cause) {
      actionError(cause, "The invitation could not be revoked.");
    } finally {
      setPending(false);
    }
  }

  async function approve(request: PasswordResetRequest) {
    const key = `approve-reset:${request.requestId}:${request.revision}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await approvePasswordReset(request, commandId(key));
      commands.current.delete(key);
      setResetQueue((current) => current ? {
        requests: replaceById(current.requests, result.request, "requestId"),
        pendingCount: current.requests.filter((item) => item.requestId !== request.requestId && item.status === "pending").length,
      } : current);
      setSecret({
        title: `Recovery code for ${request.username}`,
        description: "Give this single-use code to the account holder through the approved handoff channel. Approval has revoked the account’s existing sessions.",
        secret: result.code,
        secretLabel: "Recovery code",
      });
    } catch (cause) {
      actionError(cause, "The reset could not be approved. If the outcome is uncertain, retry once; a secret replay will not reveal plaintext.");
    } finally {
      setPending(false);
    }
  }

  async function decline(request: PasswordResetRequest) {
    const key = `decline-reset:${request.requestId}:${request.revision}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await declinePasswordReset(request, commandId(key));
      commands.current.delete(key);
      setResetQueue((current) => current ? {
        requests: replaceById(current.requests, result.request, "requestId"),
        pendingCount: current.requests.filter((item) => item.requestId !== request.requestId && item.status === "pending").length,
      } : current);
      setNotice(`Reset request declined for ${request.username}. Existing sessions were not revoked.`);
    } catch (cause) {
      actionError(cause, "The reset request could not be declined.");
    } finally {
      setPending(false);
    }
  }

  async function reissue(request: PasswordResetRequest) {
    const key = `reissue-reset:${request.requestId}:${request.revision}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await reissuePasswordReset(request, commandId(key));
      commands.current.delete(key);
      setResetQueue((current) => current ? { ...current, requests: replaceById(current.requests, result.request, "requestId") } : current);
      setSecret({
        title: `Replacement recovery code for ${request.username}`,
        description: "The previous code is invalid. Give only this replacement code to the account holder through the approved handoff channel.",
        secret: result.code,
        secretLabel: "Replacement recovery code",
      });
    } catch (cause) {
      actionError(cause, "A replacement recovery code could not be issued.");
    } finally {
      setPending(false);
    }
  }

  const roles = directory?.roles ?? [];

  return (
    <div>
      <div className="page-heading"><div><p className="eyebrow">Account administration</p><h1>Staff accounts</h1><p>Fresh V3 accounts with capability-scoped administration, one-time secrets, and server-confirmed session revocation.</p></div></div>
      {!online ? <div className="notice-banner" role="status">Offline: showing last-confirmed account state. Account changes are disabled.</div> : null}
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="notice-banner" role="status">{notice}</div> : null}

      {canManage ? (
        <>
          <div className="mt-6 grid items-start gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <section className="panel" aria-labelledby="create-staff-heading">
              <h2 id="create-staff-heading" className="text-lg font-semibold">Create staff account</h2>
              <form className="mt-5 space-y-4" onSubmit={create}>
                <label className="block text-sm font-medium" htmlFor="new-staff-name">Username<input id="new-staff-name" className="field mt-2" autoComplete="off" minLength={3} maxLength={40} value={username} onChange={(event) => { setUsername(event.target.value); commands.current.delete("create-staff"); }} required /></label>
                <label className="block text-sm font-medium" htmlFor="new-staff-password">Initial password<input id="new-staff-password" className="field mt-2" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value); commands.current.delete("create-staff"); }} required /></label>
                <label className="block text-sm font-medium" htmlFor="new-staff-role">Role<select id="new-staff-role" className="field mt-2" value={roleName} onChange={(event) => { setRoleName(event.target.value); commands.current.delete("create-staff"); }}>{roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select></label>
                <button className="button-primary w-full" type="submit" disabled={!online || pending || !directory}>Create account</button>
              </form>
            </section>
            <section className="panel overflow-x-auto" aria-labelledby="directory-heading">
              <h2 id="directory-heading" className="mb-4 text-lg font-semibold">Facility staff</h2>
              <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-3 font-medium">Username</th><th className="py-3 font-medium">Role</th><th className="py-3 font-medium">Status</th><th className="py-3 text-right font-medium">Actions</th></tr></thead>
                <tbody>{directory?.staff.map((staff) => {
                  const roleOptions = roles.some((role) => role.name === staff.role) ? roles : [{ name: staff.role, capabilities: [] }, ...roles];
                  return (
                    <tr key={staff.userId} className="border-b border-border/60 last:border-0">
                      <td className="py-3 font-medium">{staff.username}{staff.userId === session.staff.userId ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}</td>
                      <td className="py-3"><select className="field min-h-10 max-w-44 py-1 text-xs" aria-label={`Role for ${staff.username}`} value={staff.role} disabled={!online || pending} onChange={(event) => void update(staff, { roleName: event.target.value })}>{roleOptions.map((role) => <option key={role.name} value={role.name} disabled={!roles.some((candidate) => candidate.name === role.name)}>{role.name}</option>)}</select></td>
                      <td className="py-3 text-xs text-muted-foreground">{staff.disabled ? "Disabled" : "Active"}</td>
                      <td className="py-3"><div className="flex flex-wrap justify-end gap-2"><button type="button" className="button-secondary min-h-10 px-3 text-xs" disabled={!online || pending || staff.userId === session.staff.userId} onClick={() => void update(staff, { disabled: !staff.disabled })}>{staff.disabled ? "Enable" : "Disable"}</button><button type="button" className="button-secondary min-h-10 px-3 text-xs" disabled={!online || pending} onClick={() => void revokeSessions(staff)}>Revoke sessions</button></div></td>
                    </tr>
                  );
                })}</tbody>
              </table>
              {!directory ? <p className="text-sm text-muted-foreground" role="status">Loading staff accounts…</p> : null}
            </section>
          </div>

          <section className="panel mt-5" aria-labelledby="invitations-heading">
            <div className="panel-heading"><div><h2 id="invitations-heading" className="text-lg font-semibold">Invitations</h2><p className="mt-1 text-sm text-muted-foreground">Single-use secrets expire after 24 hours. Acceptance requires a new username and password.</p></div></div>
            <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={createInvitation}>
              <label className="block min-w-48 flex-1 text-sm font-medium" htmlFor="invitation-role">Role<select id="invitation-role" className="field mt-2" value={invitationRole} disabled={!online || pending || !directory} onChange={(event) => setInvitationRole(event.target.value)}>{roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select></label>
              <button type="submit" className="button-primary" disabled={!online || pending || !directory}>Create invitation</button>
            </form>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-3 font-medium">Role</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Expires</th><th className="py-3 text-right font-medium">Action</th></tr></thead>
                <tbody>{invitations?.map((invitation) => <tr key={invitation.invitationId} className="border-b border-border/60 last:border-0"><td className="py-3 font-medium">{invitation.roleName}</td><td className="py-3"><span className="status-pill">{invitation.status}</span></td><td className="py-3 text-xs text-muted-foreground">{new Date(invitation.expiresAt).toLocaleString()}</td><td className="py-3 text-right">{invitation.status === "active" ? <button type="button" className="button-secondary min-h-10 px-3 text-xs" disabled={!online || pending} onClick={() => void revokeInvitation(invitation)}>Revoke invitation</button> : null}</td></tr>)}</tbody>
              </table>
              {invitations?.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No invitations have been created.</p> : null}
            </div>
          </section>
        </>
      ) : null}

      {canApprove ? (
        <section className="panel mt-5" aria-labelledby="resets-heading">
          <div className="panel-heading"><div><h2 id="resets-heading" className="text-lg font-semibold">Password reset requests</h2><p className="mt-1 text-sm text-muted-foreground">Approval revokes existing sessions and reveals a recovery code once. Declining leaves sessions unchanged.</p></div>{resetQueue ? <span className="status-pill" aria-label={`${resetQueue.pendingCount} pending password reset requests`}>{resetQueue.pendingCount} pending</span> : null}</div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-3 font-medium">Username</th><th className="py-3 font-medium">Role</th><th className="py-3 font-medium">Requested</th><th className="py-3 font-medium">Status</th><th className="py-3 text-right font-medium">Actions</th></tr></thead>
              <tbody>{resetQueue?.requests.map((request) => <tr key={request.requestId} className="border-b border-border/60 last:border-0"><td className="py-3 font-medium">{request.username}</td><td className="py-3 text-xs text-muted-foreground">{request.role}</td><td className="py-3 text-xs text-muted-foreground">{new Date(request.requestedAt).toLocaleString()}</td><td className="py-3"><span className="status-pill">{request.status}</span>{request.status === "approved" && request.codeExpiresAt ? <span className="mt-1 block text-xs text-muted-foreground">Code expires {new Date(request.codeExpiresAt).toLocaleString()}</span> : null}</td><td className="py-3"><div className="flex flex-wrap justify-end gap-2">{request.status === "pending" ? <><button type="button" className="button-primary min-h-10 px-3 text-xs" disabled={!online || pending} onClick={() => void approve(request)}>Approve {request.username}</button><button type="button" className="button-secondary min-h-10 px-3 text-xs" disabled={!online || pending} onClick={() => void decline(request)}>Decline {request.username}</button></> : null}{request.status === "approved" ? <button type="button" className="button-secondary min-h-10 px-3 text-xs" disabled={!online || pending} onClick={() => void reissue(request)}>Reissue code for {request.username}</button> : null}</div></td></tr>)}</tbody>
            </table>
            {!resetQueue ? <p className="text-sm text-muted-foreground" role="status">Loading password reset requests…</p> : null}
            {resetQueue?.requests.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No password reset requests.</p> : null}
          </div>
        </section>
      ) : null}

      {secret ? <SecretDialog {...secret} onClose={() => setSecret(null)} /> : null}
    </div>
  );
}
