import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNS_LIST_BASE_POLL_MS,
  RUNS_LIST_MAX_POLL_MS,
  nextRunsListPollDelayMs,
} from "./runs-list-cadence.mjs";

test("poll cadence starts at the base interval and stretches with each consecutive 304", () => {
  assert.equal(nextRunsListPollDelayMs(0), RUNS_LIST_BASE_POLL_MS);
  assert.equal(nextRunsListPollDelayMs(1), 18_000);
  assert.equal(nextRunsListPollDelayMs(2), 24_000);
  assert.equal(nextRunsListPollDelayMs(3), 30_000);
  assert.equal(nextRunsListPollDelayMs(4), 36_000);
  assert.equal(nextRunsListPollDelayMs(5), 42_000);
  assert.equal(nextRunsListPollDelayMs(6), RUNS_LIST_MAX_POLL_MS);
});

test("poll cadence stays capped at the maximum no matter how quiet it gets", () => {
  assert.equal(nextRunsListPollDelayMs(40), RUNS_LIST_MAX_POLL_MS);
  assert.equal(nextRunsListPollDelayMs(Number.MAX_SAFE_INTEGER), RUNS_LIST_MAX_POLL_MS);
});

test("poll cadence rejects malformed streak counters", () => {
  for (const malformed of [-1, 1.5, "3", null, NaN]) {
    assert.throws(() => nextRunsListPollDelayMs(malformed), TypeError);
  }
});
