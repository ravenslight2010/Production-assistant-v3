// Server-owned operational read model. Assembles the v1-shaped inputs from
// one pa3 run snapshot, then derives the auto-track schedule, the live
// projection, and the audit view — all on the server, all behind the run
// revision ETag, so clients render but never recompute.
//
// The mapping from pa3's leaner station model to the v1 calculator input is
// deliberate and documented line by line in adaptStationRun(). pa3 stores
// explicit rates where v1 stored machine settings, so runs map onto v1's
// "crusts" calculator mode (direct ppm). Line timing (freezer time,
// press/oven and frontline minutes) comes from the snapshot's reviewed
// die-line settings (adjustable mid-run via apply_line_timing_command);
// per-slot applicator details v1 carried still default to zero/NaN guards,
// degrading exactly as v1 did for an empty form.

import { computeCalc } from "./station-live-calc.mjs";
import { computeAutoTrackSchedule } from "./station-autotrack-schedule.mjs";
import { buildOperationalProjection } from "./station-operational-projection.mjs";
import { deriveOperationalRunView } from "./station-operational-view.mjs";
import { RunServiceError } from "./run-service.mjs";

function ms(iso) {
  if (iso === null || iso === undefined) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Map one pa3 run snapshot (with stationProgress) to the v1 calculator input. */
export function adaptStationRun({ run }) {
  if (!run || typeof run !== "object" || typeof run.id !== "string") {
    throw new TypeError("A run snapshot is required.");
  }
  const sp = run.stationProgress ?? {};
  const inputs = (station) => sp?.[station]?.inputs ?? {};
  const progress = (station) => sp?.[station]?.progress ?? {};

  const line = inputs("line");
  const lineSettings = run.setupSnapshot?.dieSetup?.lineSettings ?? {};
  const dough = inputs("dough");
  const cheese = inputs("cheese");
  const pepperoni = inputs("pepperoni");
  const sauce = inputs("sauce");
  const frontline = inputs("frontline");
  const packagingInputs = inputs("packaging");
  const doughProgress = progress("dough");
  const sauceProgress = progress("sauce");
  const cheeseProgress = progress("cheese");
  const pepperoniProgress = progress("pepperoni");
  const packagingProgress = progress("packaging");

  // pizzasPerCase is entered per ingredient station in pa3; they must agree,
  // so the first positive value wins.
  const pizzasPerCase = positive(cheese.pizzasPerCase) || positive(pepperoni.pizzasPerCase)
    || positive(sauce.pizzasPerCase) || positive(frontline.pizzasPerCase);
  const casesPerSkid = positive(line.casesPerSkid) || positive(packagingInputs.casesPerSkid);

  const packed = positive(packagingProgress.casesPacked);
  const skidsCompleted = casesPerSkid > 0 ? Math.floor(packed / casesPerSkid) : 0;
  const casesOnCurrentSkid = casesPerSkid > 0 ? packed % casesPerSkid : 0;

  const runValues = {
    // pa3's explicit line rate is the analog of v1's crusts-tab ppm; with
    // speedAdjustment 1 the rate is already effective (no 0.92 baseline).
    approxLineSpeed: positive(line.autoTrackRatePerMinute),
    speedAdjustment: 1,
    casesNeeded: positive(run.setupSnapshot?.targetCases),
    pizzasPerCase,
    casesPerSkid,
    casesPerLayer: 0,
    // Crusts-mode per-tray count: pa3 tracks trays per dough batch, the
    // closest per-tray unit the station model carries. crustsPerCase =
    // pizzasPerCase by definition (one crust per pizza).
    crustsPerStack: positive(dough.traysPerBatch) || 1,
    crustsPerCase: pizzasPerCase,
    doughballsPerTray: 0,
    doughBatchYield: 0,
    // Line-timing from the run snapshot's reviewed die-line settings. Zero or
    // missing values keep the projection's typeof-check fallbacks (v1's
    // pre/post tunnel 2.5 min defaults), so runs created before die defaults
    // behave exactly as before; runs with real timing get honest projections.
    freezerTime: positive(lineSettings.freezerTime),
    preTunnelMin: positive(lineSettings.preTunnelMin),
    postTunnelMin: positive(lineSettings.postTunnelMin),
    pressOvenMin: positive(lineSettings.pressOvenMin),
    frontlineMin: positive(lineSettings.frontlineMin),
    skidsCompleted,
    casesOnCurrentSkid,
    traysOnLine: positive(doughProgress.traysOnLine),
    batchesReady: positive(doughProgress.batchesReady),
    batchesMade: positive(doughProgress.batchesMade),
    targetDoughballWeight: 0,
    doughRecipe: [],
    // Effective barrel size comes straight from the sauce station; frontline
    // batch pounds map onto v1's frontline recipe rows ({lbs}) so staged
    // supply can express frontline demand.
    sauceBarrelLbs: positive(sauce.barrelLbs),
    sauceOzPerPizza: positive(sauce.ozPerPizza),
    frontlineRecipe: positive(frontline.batchLbs) > 0 ? [{ lbs: frontline.batchLbs }] : [],
    app1OzPerPizza: positive(cheese.ozPerPizza),
    app1BatchLbs: positive(cheese.batchLbs),
    app1Type: "", app1CheeseRecipe: [],
    app2OzPerPizza: 0, app2BatchLbs: 0, app2Type: "", app2CheeseRecipe: [],
    app3OzPerPizza: 0, app3BatchLbs: 0, app3Type: "", app3CheeseRecipe: [],
    app4OzPerPizza: 0, app4BatchLbs: 0, app4Type: "", app4CheeseRecipe: [],
    pep1OzPerPizza: positive(pepperoni.ozPerPizza),
    pep1Sticks: 0,
    pep1BatchLbs: positive(pepperoni.batchLbs),
    pep1Type: "",
    pep2OzPerPizza: 0, pep2Sticks: 0, pep2BatchLbs: 0, pep2Type: "",
    pep1Combined: false,
    pep1TypeB: "", pep1OzPerPizzaB: 0, pep1SticksB: 0, pep1BatchLbsB: 0,
    pep2TypeB: "", pep2OzPerPizzaB: 0, pep2SticksB: 0, pep2BatchLbsB: 0,
    // Server-owned stock ledger (sauce) and mix-applicator counters.
    sauceBarrelsMade: positive(sauceProgress.barrelsMade),
    sauceStockInitialized: sp.sauce !== undefined,
    sauceStockBarrels: positive(sauceProgress.stockBarrels),
    app1BatchesMade: positive(cheeseProgress.batchesMade),
    app2BatchesMade: 0, app3BatchesMade: 0, app4BatchesMade: 0,
    pep1BatchesMade: positive(pepperoniProgress.batchesMade),
    frontlineBatchesMade: positive(progress("frontline").batchesMade),
  };

  const startedAt = ms(run.startedAt);
  const runMeta = {
    id: run.id,
    brand: typeof run.setupSnapshot?.label === "string" ? run.setupSnapshot.label : "",
    flavor: typeof run.setupSnapshot?.productCode === "string" ? run.setupSnapshot.productCode : "",
    startedAt,
    pausedAt: ms(run.pausedAt),
    endedAt: ms(run.completedAt),
    stoppages: (run.stoppages ?? []).map((s) => ({
      type: s.type,
      startedAt: ms(s.startedAt) ?? 0,
      endedAt: ms(s.endedAt),
      stopTunnel: s.stopTunnel,
    })),
    subTab: "crusts",
  };

  return {
    runMeta,
    runValues,
    packagingEntry: { skidsCompleted, casesOnCurrentSkid },
    startedAt: startedAt ?? 0,
    date: run.productionDate,
  };
}

export function createOperationalReadService({ runs, now = () => Date.now() }) {
  if (typeof runs?.get !== "function") {
    throw new TypeError("A run service with get() is required.");
  }
  if (typeof now !== "function") {
    throw new TypeError("A clock function is required.");
  }

  return Object.freeze({
    /**
     * Full operational payload: schedule + projection + view, server-computed.
     * One run fetch; the math runs only when the client's If-None-Match does
     * not match the run revision, so steady-state polls cost a single cheap
     * read (and a 304) instead of the calculator chain.
     */
    async build({ auth, runId, ifNoneMatch } = {}) {
      const run = await runs.get({ auth, runId });
      if (run === null || run === undefined) {
        throw new RunServiceError("RUN_NOT_FOUND", "Run not found.", 404);
      }
      const etag = `"${run.revision}"`;
      if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
        return { matched: true, etag, revision: run.revision };
      }

      const nowMs = now();
      const { runMeta, runValues, packagingEntry, date } = adaptStationRun({ run });
      const merged = { ...runValues, ...packagingEntry };
      const calc = computeCalc({
        v: merged,
        ve: merged,
        currentRun: runMeta,
        nowTimeMs: nowMs,
        doughSubTab: runMeta.subTab,
        defaultPepTypes: [],
      });
      const schedule = computeAutoTrackSchedule({
        runId,
        startedAt: runMeta.startedAt,
        endedAt: runMeta.endedAt,
        pausedAt: runMeta.pausedAt,
        nowMs,
        v: {
          casesNeeded: runValues.casesNeeded,
          pizzasPerCase: runValues.pizzasPerCase,
          freezerTime: runValues.freezerTime,
          sauceOzPerPizza: runValues.sauceOzPerPizza,
        },
        calc,
        progress: {
          sauceStockInitialized: runValues.sauceStockInitialized,
          sauceStockBarrels: runValues.sauceStockBarrels,
          sauceBarrelsMade: runValues.sauceBarrelsMade,
        },
        coordination: {},
        serverNetOwnership: {},
      });
      const projection = buildOperationalProjection({
        runs: [runMeta],
        runId,
        runValues: { [runId]: runValues },
        progress: packagingEntry,
        schedule,
        nowMs,
        calculationRevision: run.revision,
        defaultPepTypes: [],
      });
      const view = deriveOperationalRunView({
        snapshot: {
          syncVersion: 1,
          completeness: "complete",
          dayState: { runs: [runMeta], date, resetAt: undefined, substitutions: [] },
          runValues: { [runId]: runValues },
          packagingProgress: { [runId]: packagingEntry },
        },
        date,
        runId,
        nowMs,
        snapshotMetadata: {
          snapshotId: `operational:${runId}:${run.revision}`,
          capturedAt: nowMs,
          date,
          maxAgeMs: 60_000,
        },
      });
      return {
        matched: false,
        etag,
        revision: run.revision,
        body: {
          view,
          projection,
          schedule,
          revision: run.revision,
          serverTimeMs: nowMs,
        },
      };
    },
  });
}
