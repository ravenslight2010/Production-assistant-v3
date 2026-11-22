import assert from "node:assert/strict";
import test from "node:test";
import { emptySetupMasterRecord, parseSetupMasterRecord } from "./setup-master-records.mjs";

test("typed dough and shipping records preserve capacity values and source provenance", () => {
  for (const kind of ["recipes", "production-setups"]) {
    const empty = emptySetupMasterRecord(kind, "PRODUCT-1");
    assert.deepEqual(parseSetupMasterRecord(kind, empty), empty);
  }
  const imported = {
    code: "DOUGH-SOURCE",
    name: "Imported dough",
    productCode: "PRODUCT-1",
    data: {
      sourceFamily: "dough-procedure",
      sourceKey: "a".repeat(64),
      fileName: "dough.xlsx",
      fileSha256: "b".repeat(64),
      source: { sheet: "Sheet1", row: 4 },
      doughballYield: 700,
      doughballWeightOz: 8,
      doughballsPerTray: 24,
    },
  };
  assert.deepEqual(parseSetupMasterRecord("recipes", imported), imported);
  assert.throws(() => parseSetupMasterRecord("recipes", {
    ...imported,
    data: { ...imported.data, sourceFamily: "shipping-guide" },
  }), /provenance/u);
  assert.throws(() => parseSetupMasterRecord("recipes", {
    ...imported,
    data: { ...imported.data, doughballYield: 0 },
  }), /yield/u);
  assert.throws(() => parseSetupMasterRecord("production-setups", {
    ...imported,
    data: { ...imported.data, sourceFamily: "shipping-guide", pizzasPerCase: 12 },
  }), /exactly|unsupported/u);
});
