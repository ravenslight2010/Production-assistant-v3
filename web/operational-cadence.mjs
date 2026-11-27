// Operational read polling cadence. A floor tablet rendering one run's
// station tabs wants near-live numbers while the line is moving, but a run
// that keeps answering 304 (paused overnight, nobody touching anything) has
// no reason to stay at the base pace. Same backoff shape as the runs list,
// tightened for the live view: short base, short cap.
export const OPERATIONAL_BASE_POLL_MS = 2_000;
// Cap sits exactly at the streak-6 factor (1 + 6 × 0.5 = 4 × base); a
// longer streak cannot stretch the cadence further.
export const OPERATIONAL_MAX_POLL_MS = 8_000;

// Each consecutive not-modified poll adds half a base interval, capped so a
// quiet run never polls slower than once per 8 s. The streak is kept by the
// caller (the API client) and reset whenever a poll returns fresh state or
// the tab becomes visible again.
export function nextOperationalPollDelayMs(consecutiveNotModified) {
  if (!Number.isInteger(consecutiveNotModified) || consecutiveNotModified < 0) {
    throw new TypeError("consecutiveNotModified must be a non-negative integer.");
  }
  const factor = 1 + Math.min(consecutiveNotModified, 6) * 0.5;
  return Math.min(Math.round(OPERATIONAL_BASE_POLL_MS * factor), OPERATIONAL_MAX_POLL_MS);
}
