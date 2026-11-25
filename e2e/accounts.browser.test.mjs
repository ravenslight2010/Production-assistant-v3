import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, expect, firefox, webkit } from "playwright/test";

const CSRF_TOKEN = "a".repeat(43);
const MANAGER_ID = "72000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "72000000-0000-4000-8000-000000000002";
const RESET_ID = "72000000-0000-4000-8000-000000000003";
const SECOND_RESET_ID = "72000000-0000-4000-8000-000000000004";
const DIST = new URL("../dist/", import.meta.url);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/logo.svg", ["logo.svg", "image/svg+xml"]],
  ["/favicon.ico", ["logo.svg", "image/svg+xml"]],
]);

async function serveDist(t) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    let asset = PUBLIC_FILES.get(pathname);
    if (!asset && /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pathname)) {
      asset = [pathname.slice(1), pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"];
    }
    if (!asset || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(new URL(asset[0], DIST));
      response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function openBrowser(t, viewport) {
  const engineName = process.env.BROWSER_ENGINE ?? "chromium";
  assert.ok(["chromium", "webkit", "firefox"].includes(engineName), `Unsupported browser engine: ${engineName}`);
  const engine = { chromium, webkit, firefox }[engineName];
  const executablePath = engineName === "chromium"
    ? process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim()
    : undefined;
  const browser = await engine.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    ...(engineName === "chromium" ? { args: ["--no-sandbox"] } : {}),
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  return { browser, context };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(body) });
}

function session(capabilities = ["manage-staff", "approve-password-resets"]) {
  return {
    staff: { userId: MANAGER_ID, username: "manager", role: "manager", capabilities },
    expiresAt: "2026-11-22T12:00:00.000Z",
  };
}

function operator(revision = 1) {
  return { userId: OPERATOR_ID, username: "operator", role: "operator", disabled: false, createdAt: "2026-11-21T12:00:00.000Z", revision };
}

function resetRequest(id = RESET_ID, username = "operator", status = "pending", revision = 1) {
  return {
    requestId: id,
    staffId: OPERATOR_ID,
    username,
    role: "operator",
    status,
    requestedAt: "2026-11-21T12:00:00.000Z",
    expiresAt: "2026-11-28T12:00:00.000Z",
    revision,
    approvedAt: status === "approved" ? "2026-11-21T12:05:00.000Z" : null,
    codeExpiresAt: status === "approved" ? "2026-11-21T12:35:00.000Z" : null,
  };
}

async function installPublicApi(context) {
  const forgotRequests = [];
  const resetRequests = [];
  const invitationRequests = [];
  let loseForgotResponse = true;
  let loseResetResponse = true;
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") return json(route, { error: "Authentication required." }, 401);
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/auth/invitations/accept" && method === "POST") {
      const body = request.postDataJSON();
      invitationRequests.push(body);
      return json(route, { outcome: "accepted", staff: { ...operator(), username: body.username } }, 201);
    }
    if (path === "/api/v3/auth/password-reset-requests" && method === "POST") {
      const body = request.postDataJSON();
      forgotRequests.push(body);
      if (loseForgotResponse) {
        loseForgotResponse = false;
        return json(route, { error: "Synthetic response loss after commit." }, 500);
      }
      return json(route, { outcome: "accepted" }, 202);
    }
    if (path === "/api/v3/auth/password-reset" && method === "POST") {
      const body = request.postDataJSON();
      resetRequests.push(body);
      if (loseResetResponse) {
        loseResetResponse = false;
        return json(route, { error: "Synthetic response loss after commit." }, 500);
      }
      return json(route, { outcome: "completed" });
    }
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return { forgotRequests, resetRequests, invitationRequests };
}

async function installManagerApi(context, baseUrl, { capabilities, loseReissueResponse = false } = {}) {
  let directory = {
    staff: [
      { userId: MANAGER_ID, username: "manager", role: "manager", disabled: false, createdAt: "2026-11-21T12:00:00.000Z", revision: 1 },
      operator(),
    ],
    roles: [
      { name: "manager", capabilities: ["manage-staff", "approve-password-resets"] },
      { name: "operator", capabilities: [] },
    ],
  };
  let invitations = [];
  let requests = [resetRequest(), resetRequest(SECOND_RESET_ID, "second.operator")];
  let invitationSequence = 0;
  let invitationCommand;
  let reissueCommand;
  let loseReissue = loseReissueResponse;
  const invitationCommands = [];
  const approvalCommands = [];
  const reissueCommands = [];
  const staffUpdates = [];
  const passwordChanges = [];
  let losePasswordResponse = true;
  const pendingCount = () => requests.filter((request) => request.status === "pending").length;
  await context.addCookies([{ name: "v3_csrf", value: CSRF_TOKEN, url: baseUrl }]);
  await context.route("**/api/v3/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v3/auth/session" && method === "GET") return json(route, session(capabilities));
    if (path === "/api/v3/auth/bootstrap-status" && method === "GET") return json(route, { available: false });
    if (path === "/api/v3/runs" && method === "GET") return json(route, { runs: [] });
    if (path === "/api/v3/runs/products" && method === "GET") return json(route, { products: [] });
    if (path === "/api/v3/auth/password-reset-requests" && method === "GET") return json(route, { requests, pendingCount: pendingCount() });
    if (path === "/api/v3/auth/staff" && method === "GET") return json(route, directory);
    if (path === "/api/v3/auth/invitations" && method === "GET") return json(route, { invitations });
    if (path === "/api/v3/auth/invitations" && method === "POST") {
      const body = request.postDataJSON();
      invitationCommands.push(body);
      if (invitationCommand === body.requestId) {
        return json(route, { error: "The original invitation secret cannot be replayed.", code: "secret_replay_unavailable", invitation: invitations[0] }, 409);
      }
      invitationCommand = body.requestId;
      invitationSequence += 1;
      const invitation = {
        invitationId: `72000000-0000-4000-8000-${String(100 + invitationSequence).padStart(12, "0")}`,
        roleName: body.roleName,
        status: "active",
        createdAt: "2026-11-21T12:00:00.000Z",
        expiresAt: "2026-11-22T12:00:00.000Z",
        revision: 1,
      };
      invitations = [invitation, ...invitations];
      return json(route, { invitation, secret: `invitation-secret-${invitationSequence}-${"s".repeat(30)}`.slice(0, 43) }, 201);
    }
    const approveMatch = path.match(/^\/api\/v3\/auth\/password-reset-requests\/([^/]+)\/approve$/);
    if (approveMatch && method === "POST") {
      const body = request.postDataJSON();
      approvalCommands.push(body);
      const current = requests.find((item) => item.requestId === approveMatch[1]);
      if (body.expectedRevision !== current.revision) return json(route, { error: "The reset request changed.", code: "conflict", currentRequest: current }, 409);
      const updated = { ...current, status: "approved", revision: current.revision + 1, approvedAt: "2026-11-21T12:05:00.000Z", codeExpiresAt: "2026-11-21T12:35:00.000Z" };
      requests = requests.map((item) => item.requestId === updated.requestId ? updated : item);
      return json(route, { request: updated, code: "ABCD-EFGH" });
    }
    const declineMatch = path.match(/^\/api\/v3\/auth\/password-reset-requests\/([^/]+)\/decline$/);
    if (declineMatch && method === "POST") {
      const body = request.postDataJSON();
      const current = requests.find((item) => item.requestId === declineMatch[1]);
      const updated = { ...current, status: "declined", revision: current.revision + 1 };
      requests = requests.map((item) => item.requestId === updated.requestId ? updated : item);
      return json(route, { request: updated, outcome: "declined", replayed: false });
    }
    const reissueMatch = path.match(/^\/api\/v3\/auth\/password-reset-requests\/([^/]+)\/reissue$/);
    if (reissueMatch && method === "POST") {
      const body = request.postDataJSON();
      reissueCommands.push(body);
      const current = requests.find((item) => item.requestId === reissueMatch[1]);
      if (reissueCommand === body.requestId) {
        return json(route, { error: "The original recovery code cannot be replayed.", code: "secret_replay_unavailable", request: current }, 409);
      }
      reissueCommand = body.requestId;
      const updated = { ...current, revision: current.revision + 1, codeExpiresAt: "2026-11-21T12:40:00.000Z" };
      requests = requests.map((item) => item.requestId === updated.requestId ? updated : item);
      if (loseReissue) {
        loseReissue = false;
        return json(route, { error: "Synthetic response loss after reissue." }, 500);
      }
      return json(route, { request: updated, code: "JKLM-NPQR" });
    }
    const updateMatch = path.match(/^\/api\/v3\/auth\/staff\/([^/]+)$/);
    if (updateMatch && method === "PATCH") {
      const body = request.postDataJSON();
      staffUpdates.push(body);
      const current = directory.staff.find((item) => item.userId === updateMatch[1]);
      if (body.expectedRevision !== current.revision) return json(route, { error: "The staff account changed.", code: "conflict", currentStaff: current }, 409);
      const updated = { ...current, disabled: body.disabled ?? current.disabled, role: body.roleName ?? current.role, revision: current.revision + 1 };
      directory = { ...directory, staff: directory.staff.map((item) => item.userId === updated.userId ? updated : item), outcome: "updated" };
      return json(route, directory);
    }
    const revokeMatch = path.match(/^\/api\/v3\/auth\/staff\/([^/]+)\/revoke-sessions$/);
    if (revokeMatch && method === "POST") {
      const current = directory.staff.find((item) => item.userId === revokeMatch[1]);
      return json(route, { outcome: "revoked", staff: current, replayed: false });
    }
    if (path === "/api/v3/auth/change-password" && method === "POST") {
      const body = request.postDataJSON();
      passwordChanges.push(body);
      if (losePasswordResponse) {
        losePasswordResponse = false;
        return json(route, { error: "Synthetic response loss after password change." }, 500);
      }
      return json(route, session(capabilities));
    }
    if (path === "/api/v3/auth/sign-out" && method === "POST") return route.fulfill({ status: 204 });
    return json(route, { error: `Unexpected test request: ${method} ${path}` }, 500);
  });
  return {
    invitationCommands,
    approvalCommands,
    reissueCommands,
    staffUpdates,
    passwordChanges,
    makeOperatorStale: () => {
      directory = { ...directory, staff: directory.staff.map((item) => item.userId === OPERATOR_ID ? operator(2) : item) };
    },
  };
}

test("public account recovery preserves exact retries and keeps invitation secrets out of URLs", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t, { width: 1440, height: 1000 });
  const api = await installPublicApi(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "Staff sign in" }).waitFor();

  const invitationSecret = "i".repeat(43);
  await page.getByRole("button", { name: "Accept an invitation" }).click();
  await page.getByLabel("Invitation secret").fill(invitationSecret);
  await page.getByLabel("Username", { exact: true }).fill("invited.operator");
  await page.getByLabel("Create password").fill("new-password");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await page.getByText("Invitation accepted. Sign in with your new account.").waitFor();
  assert.equal(page.url().includes(invitationSecret), false);
  assert.equal(await page.evaluate((secret) => Object.values(localStorage).some((value) => value.includes(secret)), invitationSecret), false);
  assert.equal(api.invitationRequests.length, 1);
  assert.match(api.invitationRequests[0].requestId, /^[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Username", { exact: true }).fill("operator");
  await page.getByRole("button", { name: "Request reset", exact: true }).click();
  await page.getByText("Synthetic response loss after commit.").waitFor();
  await page.getByRole("button", { name: "Request reset", exact: true }).click();
  await page.getByText("If the account is eligible, a reset request is now waiting for manager approval. No account details were confirmed.").waitFor();
  assert.equal(api.forgotRequests.length, 2);
  assert.equal(api.forgotRequests[0].requestId, api.forgotRequests[1].requestId);

  await page.getByRole("button", { name: "I have a recovery code" }).click();
  await page.getByLabel("Username", { exact: true }).fill("operator");
  await page.getByLabel("Recovery code", { exact: true }).fill("abcd efgh");
  await page.getByLabel("New password", { exact: true }).fill("replacement-password");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByText("Synthetic response loss after commit.").waitFor();
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByText("Password reset confirmed. Sign in with your new password.").waitFor();
  assert.equal(api.resetRequests.length, 2);
  assert.equal(api.resetRequests[0].requestId, api.resetRequests[1].requestId);
  assert.deepEqual(errors, []);
});

test("manager account workflows clear secrets, adopt conflicts, and survive mobile/offline states", { timeout: 90_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t, { width: 390, height: 844 });
  const api = await installManagerApi(context, baseUrl, { loseReissueResponse: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/#staff`);
  await page.getByRole("heading", { name: "Staff accounts" }).waitFor();
  await expect(page.getByRole("button", { name: "Staff", exact: true })).toHaveAttribute("aria-describedby", "staff-reset-count", { timeout: 12_000 });
  await page.getByText("2 pending password reset requests", { exact: true }).waitFor();

  await page.locator("#invitation-role").selectOption("operator");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Invitation secret", { exact: true }).waitFor();
  const invitationSecret = await page.getByLabel("Invitation secret", { exact: true }).inputValue();
  await page.getByRole("button", { name: "I have secured it" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Invitation secret", { exact: true })).toHaveCount(0);
  assert.equal(await page.getByText(invitationSecret, { exact: true }).count(), 0);

  await page.getByRole("button", { name: "Approve operator", exact: true }).click();
  await page.getByLabel("Recovery code", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Recovery code", { exact: true }).inputValue(), "ABCD-EFGH");
  await page.getByRole("button", { name: "I have secured it" }).click();
  await page.getByRole("button", { name: "Decline second.operator", exact: true }).click();
  await page.getByText("Reset request declined for second.operator. Existing sessions were not revoked.").waitFor();

  await page.getByRole("button", { name: "Reissue code for operator", exact: true }).click();
  await page.getByText("Synthetic response loss after reissue.").waitFor();
  await page.getByRole("button", { name: "Reissue code for operator", exact: true }).click();
  await page.getByText("The original recovery code cannot be replayed.").waitFor();
  assert.equal(api.reissueCommands.length, 2);
  assert.equal(api.reissueCommands[0].requestId, api.reissueCommands[1].requestId);
  assert.equal(await page.getByLabel("Replacement recovery code", { exact: true }).count(), 0);

  api.makeOperatorStale();
  const operatorRow = page.getByRole("row").filter({ hasText: /^operator/ });
  await operatorRow.getByRole("button", { name: "Disable", exact: true }).click();
  await page.getByText("Canonical state is now shown; review it before retrying.", { exact: false }).waitFor();
  assert.equal(api.staffUpdates[0].expectedRevision, 1);
  await operatorRow.getByRole("button", { name: "Disable", exact: true }).click();
  await page.getByText("Account change confirmed; affected sessions were revoked.").waitFor();
  assert.equal(api.staffUpdates[1].expectedRevision, 2);
  assert.notEqual(api.staffUpdates[0].requestId, api.staffUpdates[1].requestId);
  await operatorRow.getByRole("button", { name: "Revoke sessions", exact: true }).click();
  await page.getByText("Sessions revoked for operator.").waitFor();

  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill("old-password");
  await page.getByLabel("New password", { exact: true }).fill("new-password");
  await page.getByLabel("Confirm new password", { exact: true }).fill("new-password");
  await page.getByRole("dialog").getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByText("Synthetic response loss after password change.").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByText("Password changed. Other sessions were revoked and this device has a fresh session.").waitFor();
  assert.equal(api.passwordChanges.length, 2);
  assert.equal(api.passwordChanges[0].requestId, api.passwordChanges[1].requestId);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile layout");
  await context.setOffline(true);
  await page.getByText("Read-only offline", { exact: true }).waitFor();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeDisabled();
  await context.setOffline(false);
  assert.deepEqual(errors, []);
});

test("reset-only approvers stay scoped and unauthorized staff hashes fall back to Live Run", { timeout: 60_000 }, async (t) => {
  const baseUrl = await serveDist(t);
  const { context } = await openBrowser(t, { width: 1440, height: 1000 });
  await installManagerApi(context, baseUrl, { capabilities: ["approve-password-resets"] });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#staff`);
  await page.getByRole("heading", { name: "Password reset requests" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Create staff account" }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Invitations", exact: true }).count(), 0);
  await context.close();

  const denied = await openBrowser(t, { width: 1440, height: 1000 });
  await installManagerApi(denied.context, baseUrl, { capabilities: [] });
  const deniedPage = await denied.context.newPage();
  await deniedPage.goto(`${baseUrl}/#staff`);
  await deniedPage.getByRole("heading", { name: "Run control" }).waitFor();
  await expect.poll(() => new URL(deniedPage.url()).hash).toBe("#run");
  await expect(deniedPage.getByRole("button", { name: "Staff", exact: true })).toHaveCount(0);
});
