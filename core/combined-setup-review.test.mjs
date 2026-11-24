import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedSetupIdentity,
  projectCombinedSetupReview,
} from "./combined-setup-review.mjs";

const SPEC = "spec-sheets";
const SAUCE = "sauce-guides";
const RUN = "run-templates";
const MIXES = "mixes";

function summary(sourceFamily, marker) {
  return {
    sourceFamily,
    sourceSha256: marker.repeat(64),
    parserVersion: "v1-source-import/2",
    sourceRows: 1,
    importedRows: 1,
    skippedRows: 0,
    unresolvedRows: 0,
  };
}

function sourceRecord(code, name, values, sourceFamily = SPEC) {
  if (sourceFamily === SPEC) {
    return {
      code,
      name,
      data: { brand: "Example", flavor: name, values },
      source: { workbook: `${code}.xlsx`, cell: `Spec!${code}1` },
      sourceDetails: { code },
    };
  }
  return {
    code,
    name,
    data: {
      brand: "Example", flavor: "House", batchSizeLbs: 40, daysEarly: 1,
      notes: "", isPrep: true, enabled: true, components: [],
    },
    source: { workbook: `${code}.xlsx`, cell: `Sauce!${code}2` },
    sourceDetails: null,
  };
}

function sourceImport(id, sourceFamily, records, status = "staged") {
  return {
    importId: id,
    revision: 1,
    family: sourceFamily === SPEC ? RUN : MIXES,
    status,
    sourceSummary: summary(sourceFamily, id[0]),
    records,
  };
}

function currentRun(code, name, values) {
  return { family: RUN, code, name, data: { brand: "Example", flavor: name, values } };
}

function project(imports, currentRecords = []) {
  return projectCombinedSetupReview({
    id: "10000000-0000-4000-8000-000000000001",
    createdBy: "20000000-0000-4000-8000-000000000001",
    createdAt: "2026-11-24T00:00:00Z",
    imports,
    currentRecords,
  });
}

test("combined projection distinguishes fills, matches, mismatches, and conflicts with canonical citations", () => {
  const first = sourceImport("a0000000-0000-4000-8000-000000000001", SPEC, [
    sourceRecord("FILL", "Fill", { crustsPerCycle: 2 }),
    sourceRecord("MATCH", "Match", { crustsPerCycle: 3 }),
    sourceRecord("MISMATCH", "Mismatch", { crustsPerCycle: 4 }),
    sourceRecord("CONFLICT", "Conflict", { crustsPerCycle: 3 }),
  ]);
  const second = sourceImport("b0000000-0000-4000-8000-000000000002", SPEC, [
    sourceRecord("CONFLICT", "Conflict", { crustsPerCycle: 4 }),
  ]);
  const result = project([second, first], [
    currentRun("FILL", "Fill", {}),
    currentRun("MATCH", "Match", { crustsPerCycle: 3 }),
    currentRun("MISMATCH", "Mismatch", { crustsPerCycle: 3 }),
  ]);
  const dispositions = Object.fromEntries(result.entries
    .filter((entry) => entry.field === "values.crustsPerCycle")
    .map((entry) => [entry.code, entry]));
  assert.equal(dispositions.FILL.disposition, "fill");
  assert.equal(dispositions.FILL.requiresDecision, false);
  assert.equal(dispositions.MATCH.disposition, "match");
  assert.equal(dispositions.MISMATCH.disposition, "mismatch");
  assert.equal(dispositions.MISMATCH.requiresDecision, true);
  assert.equal(dispositions.CONFLICT.disposition, "conflict");
  assert.deepEqual(dispositions.CONFLICT.proposedValues, [3, 4]);
  assert.equal(dispositions.MISMATCH.proposals[0].source.workbook, "MISMATCH.xlsx");
  assert.equal(dispositions.MISMATCH.proposals[0].source.cell, "Spec!MISMATCH1");
  assert.equal(dispositions.MISMATCH.proposals[0].importId, first.importId);
  assert.equal(dispositions.MISMATCH.proposals[0].revision, 1);
  assert.equal(dispositions.MISMATCH.proposals[0].sourceSha256, "a".repeat(64));
  assert.equal(result.imports[0].importId, first.importId);
});

test("missing source fields are absent proposals, never deletion proposals", () => {
  const result = project([
    sourceImport("a0000000-0000-4000-8000-000000000001", SPEC, [
      sourceRecord("KEEP", "Keep", { crustsPerCycle: 2 }),
    ]),
  ], [currentRun("KEEP", "Keep", { crustsPerCycle: 1, sauceOzPerPizza: 9 })]);
  assert.equal(result.entries.some((entry) => entry.field === "values.sauceOzPerPizza"), false);
  assert.equal(result.entries.some((entry) => entry.currentValue === null
    && Object.hasOwn(entry, "proposedValues") && entry.proposedValues.includes(null)), false);
});

test("exact and normalized unique dependencies resolve; ambiguous identities remain explicit", () => {
  const result = project([
    sourceImport("a0000000-0000-4000-8000-000000000001", SPEC, [
      sourceRecord("RESOLVED", "Resolved", { frontlineRecipeName: "House, Red" }),
      sourceRecord("AMBIGUOUS", "Ambiguous", { frontlineRecipeName: "Shared Sauce" }),
    ]),
    sourceImport("b0000000-0000-4000-8000-000000000002", SAUCE, [
      sourceRecord("HOUSE-RED", "House Red", null, SAUCE),
      sourceRecord("SHARED-A", "Shared Sauce", null, SAUCE),
      sourceRecord("SHARED-B", "Shared Sauce", null, SAUCE),
    ]),
  ]);
  assert.equal(result.missingDependencies.length, 0);
  assert.equal(result.unresolvedIdentities.some((item) => item.type === "ambiguous-dependency"
    && item.reference === "Shared Sauce"), true);
  assert.equal(result.unresolvedIdentities.some((item) => item.type === "ambiguous-name"
    && item.normalizedName === "shared sauce"), true);
});

test("normalized matching includes an existing canonical mix without a proposed replacement", () => {
  const result = project([
    sourceImport("a0000000-0000-4000-8000-000000000001", SPEC, [
      sourceRecord("EXISTING", "Existing", { frontlineRecipeName: "House, Red" }),
    ]),
  ], [{
    family: MIXES, code: "HOUSE-RED", name: "House Red",
    data: { brand: "Example", flavor: "House", batchSizeLbs: 40, daysEarly: 1, notes: "", isPrep: true, enabled: true, components: [] },
  }]);
  assert.equal(result.missingDependencies.length, 0);
  assert.equal(result.unresolvedIdentities.length, 0);
});

test("near names are suggestions only and size digits remain distinguishing", () => {
  const result = project([
    sourceImport("a0000000-0000-4000-8000-000000000001", SPEC, [
      sourceRecord("NEAR", "Near", { frontlineRecipeName: "House Rd" }),
      sourceRecord("SIZE", "Size", { frontlineRecipeName: 'House Red 12"' }),
    ]),
    sourceImport("b0000000-0000-4000-8000-000000000002", SAUCE, [
      sourceRecord("HOUSE-RED", "House Red", null, SAUCE),
    ]),
  ]);
  assert.equal(result.missingDependencies.length, 2);
  const near = result.missingDependencies.find((item) => item.code === "NEAR");
  assert.equal(near.suggestionOnly, true);
  assert.deepEqual(near.suggestions, [{ code: "HOUSE-RED", name: "House Red" }]);
  assert.equal(result.entries.some((entry) => entry.field === "values.frontlineRecipe"
    && entry.disposition === "match"), false);
  const size = result.missingDependencies.find((item) => item.code === "SIZE");
  assert.deepEqual(size.suggestions, []);
});

test("normalization retains product qualifiers and size information", () => {
  assert.equal(normalizedSetupIdentity('Synthetic’s Original 12" Pizza'), "synthetics original 12");
  assert.notEqual(normalizedSetupIdentity('Synthetic’s Original 12"'), normalizedSetupIdentity('Synthetic’s Original 11"'));
  assert.notEqual(normalizedSetupIdentity("Synthetic's Original"), normalizedSetupIdentity("Synthetic's Ultra Thin Crust"));
});

test("legacy source history remains projectable with explicit unavailable citations", () => {
  const legacy = sourceImport("a0000000-0000-4000-8000-000000000001", SPEC, [
    sourceRecord("LEGACY", "Legacy", { crustsPerCycle: 2 }),
  ], "applied");
  legacy.sourceSummary.parserVersion = "v1-source-import/1";
  delete legacy.records[0].source;
  delete legacy.records[0].sourceDetails;
  const result = project([legacy]);
  const proposal = result.entries.find((entry) => entry.field === "values.crustsPerCycle").proposals[0];
  assert.equal(proposal.source, null);
  assert.equal(proposal.sourceDetails, null);
  assert.equal(proposal.parserVersion, "v1-source-import/1");
});
