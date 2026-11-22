export type DieDefaultField =
  | "crustsPerCycle" | "cycleSpeed" | "speedAdjustment" | "freezerTime" | "casesPerLayer"
  | "preTunnelMin" | "postTunnelMin" | "pressOvenMin" | "frontlineMin";

export declare const DIE_DEFAULT_FIELDS: readonly DieDefaultField[];
export declare const REQUIRED_DIE_DEFAULT_FIELDS: readonly DieDefaultField[];
export declare function isDieLineSettings(
  value: unknown,
  options?: { allowMissingRequired?: boolean; allowEmpty?: boolean },
): boolean;
export declare function resolveDieLineDefaults(
  defaults: unknown,
  current: unknown,
): Partial<Record<DieDefaultField, number | null>>;
export declare function resolveDieLineDefaultsOnSwitch(
  defaults: unknown,
  current: unknown,
  knownDefaults?: unknown[],
): Partial<Record<DieDefaultField, number | null>>;
