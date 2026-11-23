import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RUN_TO_TIME,
  normalizeRunToTimeInput,
  remainingRunToTimeSeconds,
  runToTimeEpoch,
} from "./run-to-time.mjs";

test("Run to Time accepts V1 12-hour and 24-hour input and resets to 19:15", () => {
  assert.equal(DEFAULT_RUN_TO_TIME, "19:15");
  for (const [input, expected] of [
    ["19:15", "19:15"], [" 07:05 ", "07:05"], ["7:15 PM", "19:15"],
    ["12:00 AM", "00:00"], ["12:00 pm", "12:00"], ["11:59PM", "23:59"],
  ]) assert.equal(normalizeRunToTimeInput(input), expected);
  for (const input of [null, 19, "", "24:00", "7:15", "0:15 AM", "13:00 PM", "7:60 PM"])
    assert.equal(normalizeRunToTimeInput(input), null);
});

test("Central Run to Time countdown handles standard and daylight time", () => {
  assert.equal(remainingRunToTimeSeconds({
    productionDate: "2026-07-01", runToTime: "19:15", serverNow: "2026-07-01T12:00:00.000Z",
  }), 12 * 3600 + 15 * 60);
  assert.equal(remainingRunToTimeSeconds({
    productionDate: "2026-11-19", runToTime: "19:15", serverNow: "2026-11-19T12:00:00.000Z",
  }), 13 * 3600 + 15 * 60);
});

test("current or past targets are reached and never silently move to tomorrow", () => {
  const atTarget = remainingRunToTimeSeconds({
    productionDate: "2026-11-19", runToTime: "19:15", serverNow: "2026-11-20T01:15:00.000Z",
  });
  const pastTarget = remainingRunToTimeSeconds({
    productionDate: "2026-11-19", runToTime: "19:15", serverNow: "2026-11-20T02:00:00.000Z",
  });
  assert.equal(atTarget, 0);
  assert.equal(pastTarget, 0);
  assert.equal(new Date(runToTimeEpoch({
    productionDate: "2026-11-19", runToTime: "19:15", serverNow: "2026-11-20T02:00:00.000Z",
  })).toISOString(), "2026-11-20T01:15:00.000Z");
});

test("DST gaps remain unknown and repeated targets stay on the same local date", () => {
  assert.equal(runToTimeEpoch({
    productionDate: "2026-03-08", runToTime: "02:30", serverNow: "2026-03-08T12:00:00.000Z",
  }), null);
  const repeated = runToTimeEpoch({
    productionDate: "2026-11-01", runToTime: "01:30", serverNow: "2026-11-01T05:00:00.000Z",
  });
  assert.equal(new Date(repeated).toISOString(), "2026-11-01T06:30:00.000Z");
  const later = runToTimeEpoch({
    productionDate: "2026-11-01", runToTime: "01:30", serverNow: "2026-11-01T07:00:00.000Z",
  });
  assert.equal(new Date(later).toISOString(), "2026-11-01T07:30:00.000Z");
});

test("invalid dates and times do not produce an invented countdown", () => {
  assert.equal(runToTimeEpoch({ productionDate: "2027-02-29", runToTime: "19:15", serverNow: "2027-03-01T00:00:00.000Z" }), null);
  assert.equal(runToTimeEpoch({ productionDate: "2026-11-19", runToTime: "25:00", serverNow: "2026-11-19T00:00:00.000Z" }), null);
  assert.equal(remainingRunToTimeSeconds({ productionDate: "2026-11-19", runToTime: "19:15", serverNow: "not-a-date" }), null);
});
