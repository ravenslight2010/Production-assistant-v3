export const RUN_TO_TIME_ZONE = "America/Chicago";
export const DEFAULT_RUN_TO_TIME = "19:15";

const TWENTY_FOUR_HOUR = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TWELVE_HOUR = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i;

export function normalizeRunToTimeInput(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  const twentyFourHour = TWENTY_FOUR_HOUR.exec(value);
  if (twentyFourHour) return `${twentyFourHour[1]}:${twentyFourHour[2]}`;
  const twelveHour = TWELVE_HOUR.exec(value);
  if (!twelveHour) return null;
  const hour = Number(twelveHour[1]) % 12
    + (twelveHour[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${twelveHour[2]}`;
}

function zonedParts(epochMilliseconds, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMilliseconds));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
  return values;
}

function epochForWallTime(date, runToTime, timeZone, offsetHours) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = runToTime.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0);
}

function wallTimeMatches(epochMilliseconds, date, runToTime, timeZone) {
  const actual = zonedParts(epochMilliseconds, timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = runToTime.split(":").map(Number);
  return actual.year === year && actual.month === month && actual.day === day
    && actual.hour === hour && actual.minute === minute && actual.second === 0;
}

export function runToTimeEpoch({ productionDate, runToTime, serverNow,
  timeZone = RUN_TO_TIME_ZONE }) {
  const normalizedTime = normalizeRunToTimeInput(runToTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate ?? "") || !normalizedTime
    || typeof serverNow !== "string" || !Number.isFinite(Date.parse(serverNow))) {
    return null;
  }
  const [year, month, day] = productionDate.split("-").map(Number);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day) return null;

  const now = Date.parse(serverNow);
  const candidates = [];
  for (const offsetHours of [-4, -5, -6, -7, -8]) {
    const epoch = epochForWallTime(productionDate, normalizedTime, timeZone, offsetHours);
    if (wallTimeMatches(epoch, productionDate, normalizedTime, timeZone)) candidates.push(epoch);
  }
  const unique = [...new Set(candidates)].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  // A repeated fall-back wall time remains today's target: use the occurrence
  // that has not passed when possible, never roll the target into tomorrow.
  return unique.find((epoch) => epoch >= now) ?? unique.at(-1);
}

export function remainingRunToTimeSeconds({ productionDate, runToTime, serverNow,
  timeZone = RUN_TO_TIME_ZONE }) {
  const target = runToTimeEpoch({ productionDate, runToTime, serverNow, timeZone });
  if (target === null) return null;
  return Math.max(0, Math.ceil((target - Date.parse(serverNow)) / 1000));
}
