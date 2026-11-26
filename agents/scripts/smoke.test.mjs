import test from "node:test";
import assert from "node:assert/strict";

import {
  cookieHeader,
  csrfHeaderValue,
  isRunListEtag,
  parseSetCookie,
  summarizeChecks,
} from "./smoke.mjs";

test("parseSetCookie extracts the named pair without attributes", () => {
  const list = [
    "v3_session=abc123; Path=/; HttpOnly; SameSite=Lax",
    "v3_csrf=xyz789; Path=/; SameSite=Lax",
  ];
  assert.equal(parseSetCookie(list, "v3_session"), "v3_session=abc123");
  assert.equal(parseSetCookie(list, "v3_csrf"), "v3_csrf=xyz789");
  assert.equal(parseSetCookie(list, "missing"), null);
  assert.equal(parseSetCookie([], "v3_session"), null);
  assert.equal(parseSetCookie(undefined, "v3_session"), null);
});

test("parseSetCookie ignores same-name substrings on other cookies", () => {
  const list = ["v3_session_extra=nope; Path=/", "v3_session=yes; Path=/"];
  assert.equal(parseSetCookie(list, "v3_session"), "v3_session=yes");
});

test("cookieHeader joins pairs and drops nulls", () => {
  assert.equal(cookieHeader("v3_session=a", "v3_csrf=b"), "v3_session=a; v3_csrf=b");
  assert.equal(cookieHeader("v3_session=a", null), "v3_session=a");
  assert.equal(cookieHeader(null, null), "");
});

test("csrfHeaderValue returns the raw cookie value untouched", () => {
  const token = "A-z_09.x+Y";
  assert.equal(csrfHeaderValue(`v3_csrf=${token}`), token);
  // Base64url tokens contain no % — nothing to decode, ever.
  assert.equal(csrfHeaderValue("v3_csrf=a%20b"), "a%20b");
  assert.equal(csrfHeaderValue(null), "");
});

test("isRunListEtag matches the version-limit-scope format only", () => {
  assert.ok(isRunListEtag('"57837-25-all"'));
  assert.ok(isRunListEtag('"1-5-active"'));
  assert.ok(!isRunListEtag('"57837-25"'));
  assert.ok(!isRunListEtag('57837-25-all'));
  assert.ok(!isRunListEtag('"57837-25-everything"'));
  assert.ok(!isRunListEtag(null));
  assert.ok(!isRunListEtag('""'));
});

test("summarizeChecks reports pass only when every check passed", () => {
  const good = summarizeChecks([{ name: "a", ok: true }, { name: "b", ok: true }]);
  assert.deepEqual(good, { ok: true, total: 2, failed: [] });
  const bad = summarizeChecks([
    { name: "a", ok: true },
    { name: "b", ok: false, detail: "boom" },
  ]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.failed, ["b: boom"]);
});
