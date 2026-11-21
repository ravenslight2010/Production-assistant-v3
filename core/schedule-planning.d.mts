import type { components } from "../client/src/api/schema";

type ProductionSchedule = components["schemas"]["ProductionSchedule"];
type ScheduleRunTemplate = components["schemas"]["ScheduleRunTemplate"];

export const SCHEDULE_TIME_ZONE: "America/Chicago";
export const DEFAULT_PRODUCTION_START_TIME: "06:00";
export const STANDARD_BREAK_MINUTES: 30;
export const MAX_SCHEDULE_RUNS: 100;

export interface ScheduleTimelineRun {
  runId: string;
  startMs: number | undefined;
  finishMs: number | undefined;
  durationSec: number | undefined;
  status: "planned";
}

export interface ScheduleTimelineBreak {
  slot: number;
  startMs?: number;
  finishMs?: number;
  status: "pending" | "scheduled" | "unassigned";
  reason?: string;
}

export interface ScheduleTimeline {
  timeZone: "America/Chicago";
  productionStartMs: number | undefined;
  runs: ScheduleTimelineRun[];
  breaks: ScheduleTimelineBreak[];
  projectedFinishMs: number | undefined;
  partialFinishMs: number | undefined;
  incomplete: boolean;
}

export function centralDate(now?: number): string;
export function calculateScheduleTimeline(
  schedule: ProductionSchedule,
  templates: ScheduleRunTemplate[],
  options?: { nowMs?: number; today?: string },
): ScheduleTimeline;
