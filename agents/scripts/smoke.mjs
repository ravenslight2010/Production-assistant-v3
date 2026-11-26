// Live smoke test for a v3 rig. Exercises the full client protocol:
// sign-in (both cookies) → gzipped list → ETag 304 → CSRF'd sign-out.
//
// Credentials come from env vars ONLY — never hardcode, never commit:
//   V3_SMOKE_BASE      default http://127.0.0.1:5000
//   V3_SMOKE_USERNAME  required
//   V3_SMOKE_PASSWORD  required
//
// Run:  node agents/scripts/smoke.mjs
// Exit: 0 = PASS, 1 = FAIL (details on stdout).

const BASE = (process.env.V3_SMOKE_BASE ?? "http://127.0.0.1:5000").replace(/\/$/, "");

// ---- pure helpers (unit-tested in smoke.test.mjs) ----

export function parseSetCookie(setCookieList, name) {
  for (const entry of setCookieList ?? []) {
    if (entry.startsWith(`${name}=`)) return entry.split(";")[0];
  }
  return null;
}

export function cookieHeader(...pairs) {
  return pairs.filter(Boolean).join("; ");
}

export function csrfHeaderValue(csrfCookie) {
  // Raw cookie value, NOT url-decoded; server compares header === cookie.
  return csrfCookie ? csrfCookie.slice(csrfCookie.indexOf("=") + 1) : "";
}

export function isRunListEtag(value) {
  return typeof value === "string" && /^"\d+-\d+-(all|active)"$/.test(value);
}

export function summarizeChecks(checks) {
  const failed = checks.filter((c) => c.ok !== true);
  return {
    ok: failed.length === 0,
    total: checks.length,
    failed: failed.map((c) => `${c.name}: ${c.detail ?? "failed"}`),
  };
}

// ---- live checks ----

async function check(name, fn) {
  try {
    const detail = await fn();
    return { name, ok: detail === undefined, detail };
  } catch (error) {
    return { name, ok: false, detail: String(error?.message ?? error) };
  }
}

export async function runSmoke(base = BASE, username = process.env.V3_SMOKE_USERNAME, password = process.env.V3_SMOKE_PASSWORD) {
  if (!username || !password) {
    return [{ name: "credentials", ok: false, detail: "Set V3_SMOKE_USERNAME and V3_SMOKE_PASSWORD." }];
  }
  const checks = [];
  let cookies = null;

  checks.push(await check("sign-in", async () => {
    const res = await fetch(`${base}/api/v3/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, username }),
    });
    if (res.status !== 200) throw new Error(`status ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const session = parseSetCookie(res.headers.getSetCookie?.(), "v3_session");
    const csrf = parseSetCookie(res.headers.getSetCookie?.(), "v3_csrf");
    if (!session || !csrf) throw new Error("missing v3_session/v3_csrf cookie");
    cookies = { session, csrf };
  }));

  let etag = null;
  checks.push(await check("run list 200 + gzip", async () => {
    const res = await fetch(`${base}/api/v3/runs?limit=5`, {
      headers: {
        cookie: cookieHeader(cookies.session, cookies.csrf),
        "accept-encoding": "gzip",
      },
    });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    etag = res.headers.get("etag");
    if (!isRunListEtag(etag)) throw new Error(`unexpected etag ${etag}`);
    const body = Buffer.from(await res.arrayBuffer());
    const contentEncoding = res.headers.get("content-encoding");
    if (body.byteLength >= 1024 && contentEncoding !== "gzip") {
      throw new Error(`body ${body.byteLength}B not gzipped (encoding=${contentEncoding})`);
    }
  }));

  checks.push(await check("conditional poll 304", async () => {
    const res = await fetch(`${base}/api/v3/runs?limit=5`, {
      headers: {
        cookie: cookieHeader(cookies.session, cookies.csrf),
        "if-none-match": etag,
      },
    });
    if (res.status !== 304) throw new Error(`expected 304, got ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) !== 0) {
      throw new Error("304 carried a body");
    }
  }));

  checks.push(await check("csrf sign-out", async () => {
    const res = await fetch(`${base}/api/v3/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie: cookieHeader(cookies.session, cookies.csrf),
        "x-csrf-token": csrfHeaderValue(cookies.csrf),
      },
    });
    if (res.status !== 200 && res.status !== 204) throw new Error(`status ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }));

  return checks;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const checks = await runSmoke();
  const summary = summarizeChecks(checks);
  for (const c of checks) console.log(`${c.ok ? "ok" : "FAIL"} - ${c.name}${c.ok ? "" : ` (${c.detail})`}`);
  console.log(summary.ok ? `PASS: ${summary.total} checks` : `FAIL: ${summary.failed.join("; ")}`);
  process.exit(summary.ok ? 0 : 1);
}
