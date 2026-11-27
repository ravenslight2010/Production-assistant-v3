// Cadence contract for the operational read polls: a run that keeps
// answering 304 backs off by half a base interval per consecutive
// not-modified poll, capped well below the runs-list cap because this is the
// live floor view; any fresh payload snaps the caller back to the base pace.

import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATIONAL_BASE_POLL_MS,
  OPERATIONAL_MAX_POLL_MS,
  nextOperationalPollDelayMs,
} from "./operational-cadence.mjs";

test("the base poll matches the live floor cadence", () => {
  assert.equal(OPERATIONAL_BASE_POLL_MS, 2_000);
  assert.equal(nextOperationalPollDelayMs(0), OPERATIONAL_BASE_POLL_MS);
});

test("each consecutive not-modified poll adds half a base interval", () => {
  assert.equal(nextOperationalPollDelayMs(1), 3_000);
  assert.equal(nextOperationalPollDelayMs(2), 4_000);
  assert.equal(nextOperationalPollDelayMs(3), 5_000);
});

test("the backoff streak is capped and the idle run a quiet run stops stretching at the streak-6 factor", () => {
  assert.equal(nextOperationalPollDelayMs(6), 8_000);
  assert.equal(nextOperationalPollDelayMs(7), OPERATIONAL_MAX_POLL_MS);
  assert.equal(nextOperationalPollDelayMs(60), OPERATIONAL_MAX_POLL_MS);
  assert.equal(OPERATIONAL_MAX_POLL_MS, 8_000);
});

test("a non-negative integer streak is required", () => {
  assert.throws(() => nextOperationalPollDelayMs(-1), TypeError);
  assert.throws(() => nextOperationalPollDelayMs(1.5), TypeError);
  assert.throws(() => nextOperationalPollDelayMs("2"), TypeError);
});
