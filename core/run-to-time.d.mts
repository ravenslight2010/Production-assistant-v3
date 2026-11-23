export declare const RUN_TO_TIME_ZONE: "America/Chicago";
export declare const DEFAULT_RUN_TO_TIME: "19:15";
export declare function normalizeRunToTimeInput(input: unknown): string | null;
export declare function runToTimeEpoch(input: {
  productionDate: string;
  runToTime: string;
  serverNow: string;
  timeZone?: string;
}): number | null;
export declare function remainingRunToTimeSeconds(input: {
  productionDate: string;
  runToTime: string;
  serverNow: string;
  timeZone?: string;
}): number | null;
