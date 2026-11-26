// Runs-list polling cadence. A floor tablet that keeps getting 304s is
// watching a quiet facility, so its poll interval stretches; any changed
// response (or a tab becoming visible again) snaps it back to the base pace.
export const RUNS_LIST_BASE_POLL_MS = 12_000;
export const RUNS_LIST_MAX_POLL_MS = 45_000;

// Each consecutive not-modified poll adds half a base interval, capped so an
// idle floor never polls slower than once per 45 s. The streak is kept by the
// caller (the API client) and reset whenever a poll returns fresh state.
export function nextRunsListPollDelayMs(consecutiveNotModified) {
  if (!Number.isInteger(consecutiveNotModified) || consecutiveNotModified < 0) {
    throw new TypeError("consecutiveNotModified must be a non-negative integer.");
  }
  const factor = 1 + Math.min(consecutiveNotModified, 6) * 0.5;
  return Math.min(Math.round(RUNS_LIST_BASE_POLL_MS * factor), RUNS_LIST_MAX_POLL_MS);
}
