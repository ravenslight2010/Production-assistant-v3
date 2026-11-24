import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseSetupCatalogCsv } from "./setup-catalog-csv.mjs";
import {
  parseSourceWorkbook,
  SourceWorkbookImportError,
} from "./source-workbook-import.mjs";

function makeWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function makeFormulaWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Sauce oz/pizza"],
    ["Acme", "Classic", 3.5],
  ]);
  sheet.C2 = { t: "n", f: "1+2", v: 3, w: "3" };
  XLSX.utils.book_append_sheet(workbook, sheet, "Spec");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function makeStoredDocx(text) {
  const name = Buffer.from("word/document.xml");
  const xml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(xml.byteLength, 18);
  local.writeUInt32LE(xml.byteLength, 22);
  local.writeUInt16LE(name.byteLength, 26);
  const localRecord = Buffer.concat([local, name, xml]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(xml.byteLength, 20);
  central.writeUInt32LE(xml.byteLength, 24);
  central.writeUInt16LE(name.byteLength, 28);
  const centralRecord = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.byteLength, 12);
  end.writeUInt32LE(localRecord.byteLength, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

test("maps deterministic spec columns and leaves unsupported recipe columns unresolved", () => {
  const parsed = parseSourceWorkbook("spec-sheets", makeWorkbook([["Profiles", [
    ["Brand", "Flavor", "Dough Recipe", "Sauce oz/pizza", "Applicator 1 Type", "Applicator 1 oz/pizza", "Applicator 1 Recipe", "Pepperoni 1 Type", "Pepperoni 1 Sticks"],
    ["Acme", "Classic", "House Dough", 3.5, "Cheese", 2, "Cheddar Blend", "Cup", 4],
  ]]]), "profile.xlsx");

  assert.equal(parsed.targetFamily, "run-templates");
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0].record.data.values, {
    doughRecipeName: "House Dough",
    sauceOzPerPizza: 3.5,
    app1Type: "Cheese",
    app1OzPerPizza: 2,
    pep1Type: "Cup",
    pep1Sticks: 4,
  });
  assert.equal(parsed.unresolvedRows.length, 1);
  assert.match(parsed.unresolvedRows[0].reason, /no approved V3 field mapping/u);
});

test("parses side-by-side fixed spec blocks and preserves alternate cells for review", () => {
  const parsed = parseSourceWorkbook("spec-sheets", makeWorkbook([["Profiles", [
    ["Acme", "9\" Cheese", "", "", "Acme", "12\" Pepperoni"],
    ["Parbake crust (House Recipe - 12\" Dies)", 7.5, "", "", "Parbake crust (House Recipe - 12\" Dies)", 7.5],
    ["House Sauce (made in house)", 4, "", "", "House Sauce (made in house)", 4],
    ["Applicator - Cheese Blend\n2 Mozzarella", 3, 3.25, "", "Applicator - Cheese Blend\n2 Mozzarella", 2.5],
    ["TARGET WEIGHT", 18, "", "", "Pepperoni Stick (Cured vendor)", "19 = 1.90 *Use approved sticks*"],
    ["WEIGHT SPEC RANGE", "17.75 - 18.25", "", "", "Applicator - Cheese Blend", 2],
    [], [], [], [],
    ["Acme", "PEPPERONI &\nJALAPENO"],
    ["Vendor Crust 7\"x12\" Oval", 7.25],
    ["House Sauce", 4],
    ["TARGET WEIGHT", 16],
  ]]]), "fixed.xlsx");

  assert.equal(parsed.records.length, 3);
  assert.deepEqual(parsed.records[0].record.data.values, {
    doughRecipeName: "House Recipe",
    dieType: "12\"",
    targetDoughballWeight: 7.5,
    frontlineRecipeName: "House Sauce",
    sauceOzPerPizza: 4,
    app1Type: "Cheese Blend",
    app1OzPerPizza: 3,
  });
  assert.deepEqual(parsed.records[1].record.data.values, {
    doughRecipeName: "House Recipe",
    dieType: "12\"",
    targetDoughballWeight: 7.5,
    frontlineRecipeName: "House Sauce",
    sauceOzPerPizza: 4,
    app1Type: "Cheese Blend",
    app1OzPerPizza: 2.5,
    pep1Type: "Pepperoni Stick",
    pep1Sticks: 19,
    pep1OzPerPizza: 1.9,
    app2Type: "Cheese Blend",
    app2OzPerPizza: 2,
  });
  assert.deepEqual(parsed.records.map((entry) => entry.record.data.flavor), [
    "9\" Cheese", "12\" Pepperoni", "PEPPERONI & JALAPENO",
  ]);
  assert.equal(parsed.records[2].record.data.values.doughRecipeName, "Vendor Crust 7\"x12\" Oval");
  assert.equal(parsed.records[2].record.data.values.dieType, undefined);
  assert.equal(parsed.records[2].record.data.values.targetDoughballWeight, undefined);
  assert.equal(parsed.records[0].sourceDetails.reviewOnly[0].source, "Profiles!C4");
  assert.equal(parsed.records[0].sourceDetails.reviewOnly[0].value, "3.25");
  assert.ok(parsed.records[1].sourceDetails.reviewOnly.some((entry) => entry.kind === "pepperoni-annotation"));
  assert.ok(parsed.unresolvedRows.every((entry) => /review-only/iu.test(entry.reason)));
});

test("parses annotated cheese pounds without converting or accepting unrelated annotations", () => {
  const annotated = parseSourceWorkbook("cheese-mix-specs", makeWorkbook([["Acme", [
    ["All Varieties: Spice Mix"], ["Spice Mix"], ["For 1st Cheese Applicator"], ["", "LBS"],
    ["Nutmeg", "0.06 (1.0oz)"], ["Total", 0.06],
  ]]]), "cheese.xlsx");
  assert.deepEqual(annotated.records[0].record.data.values.app1CheeseRecipe, [
    { ingredient: "Nutmeg", lbs: 0.06 },
  ]);

  const unrelated = parseSourceWorkbook("cheese-mix-specs", makeWorkbook([["Acme", [
    ["All Varieties: Cheddar Mix"], ["Cheddar Mix"], ["For 1st Cheese Applicator"], ["", "LBS"],
    ["Yellow Cheddar", "14 (1/3 block)"], ["Total", 14],
  ]]]), "cheese.xlsx");
  assert.deepEqual(unrelated.records[0].record.data.values, {});
  assert.match(unrelated.unresolvedRows[0].reason, /not numeric/u);
});

test("parses side-by-side premix blocks, preserves blanks, and stays idempotent by identity", () => {
  const sheets = [["Mixes", [
    ["Mix Alpha", "", "", "", "Mix Beta"],
    ["", "Per Pizza", "Per Batch", "", "", "Pert Pizza", "Per Batch"],
    ["Flour", 0.5, 10, "", "Oil", "", 2],
    ["Total", 0.5, 10, "", "Total", "", 2],
  ]]];
  const parsed = parseSourceWorkbook("premix-sheets", makeWorkbook(sheets), "premix.xlsx");
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records[0].record.data.components, [{
    ingredientName: "Flour", perPizzaOz: 0.5, perBatchLbs: 10,
  }]);
  assert.deepEqual(parsed.records[1].record.data.components, [{
    ingredientName: "Oil", perPizzaOz: null, perBatchLbs: 2,
  }]);
  assert.equal(parsed.records[1].record.data.batchSizeLbs, 2);
  assert.equal(parsed.records[1].record.data.isPrep, null);
  const corrected = structuredClone(parsed.records[0].record);
  corrected.data.isPrep = false;
  corrected.data.enabled = true;
  const csv = [
    "code,name,brand,flavor,batch_size_lbs,days_early,notes,is_prep,enabled,components_json",
    [
      corrected.code, corrected.name, "", "", "", "", "", "false", "true",
      JSON.stringify(corrected.data.components),
    ].map(csvCell).join(","),
  ].join("\n");
  assert.equal(parseSetupCatalogCsv("mixes", csv).length, 1);
  assert.equal(
    parseSourceWorkbook("premix-sheets", makeWorkbook([["Mixes", [[], ...sheets[0][1]]]]), "premix.xlsx").records[0].record.code,
    parsed.records[0].record.code,
  );
});

test("combines explicit cheese slots into one reviewed profile and blocks guesses", () => {
  const parsed = parseSourceWorkbook("cheese-mix-specs", makeWorkbook([["Acme", [
    ["Acme Cheese Specs"],
    ["All Varieties: Standard Cheese Mix"],
    ["Standard Cheese Mix"],
    ["For 1st Cheese Applicator"],
    ["", "LBS"],
    ["Mozzarella", 20],
    ["Total", 20],
  ]]]), "cheese.xlsx");
  assert.equal(parsed.targetFamily, "run-templates");
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0].record.data.values, {
    app1CheeseRecipeName: "Standard Cheese Mix",
    app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 20 }],
  });
  assert.equal(parsed.unresolvedRows.length, 0);

  const ambiguous = parseSourceWorkbook("cheese-mix-specs", makeWorkbook([["Acme", [
    ["Standard Cheese Mix"], ["", "LBS"], ["Mozzarella", 20], ["Total", 20],
  ]]]), "cheese.xlsx");
  assert.equal(ambiguous.records.length, 1);
  assert.deepEqual(ambiguous.records[0].record.data.values, {});
  assert.equal(ambiguous.unresolvedRows.length, 2);
});

test("maps explicit shipping values but preserves unknown and non-target columns for review", () => {
  const parsed = parseSourceWorkbook("shipping-guides", makeWorkbook([["Shipping", [
    ["PIZZA", "BOX", "DIMENSIONS", "CIRCLE", "PIZZAS/CS", "CASES", "GRIPSHEEETS", "STACKING"],
    ["Acme", "7 inch shipper", "12x12", "N/A", "4 - 3PACK", 80, "X", "Hannaford"],
  ]]]), "shipping.xlsx");
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0].record.data.values, {
    shipper: "7in",
    circles: "none",
    pizzasPerCase: 12,
    casesPerSkid: 80,
    skidStacking: "hannaford",
  });
  assert.equal(parsed.unresolvedRows.length, 1);
  assert.match(parsed.unresolvedRows[0].reason, /dimensions/u);
  assert.match(JSON.stringify(parsed.records[0].sourceDetails), /Grip sheets: X/u);
});

test("stages literal sauce LBS, full-drum, and per-row-pound recipe tables", () => {
  const parsed = parseSourceWorkbook("sauce-guides", makeWorkbook([
    ["Standard", [
      ["", "House Sauce Procedure"], ["", "MATERIALS"], ["", "", "LBS."],
      ["", "Water", 10], ["", "Sauce Base", "50 (1 bag)"], ["", "TOTAL WEIGHT", 60],
      [], ["", "1. Mix until combined."],
    ]],
    ["Drum", [
      ["", "Drum Sauce Procedure"], ["", "MATERIALS"], ["", "DRUM BATCH", "Full Batch", "Half Batch"],
      ["", "Water", 20, 10], ["", "Drum Mix", 5, 2.5], ["", "TOTAL WEIGHT", 25, 12.5],
      [], ["", "1. Mix until combined."],
    ]],
    ["Per row", [
      ["", "Row Sauce Procedure"], ["", "Ingredients:"],
      ["", "Water", 10, "lbs"], ["", "Oil", 2, "lbs"],
      [], ["", "Process"], ["", "Mix until combined."],
    ]],
  ]), "sauces.xlsx");

  assert.equal(parsed.records.length, 3);
  const standard = parsed.records.find((entry) => entry.record.data.values.frontlineRecipeName === "House Sauce");
  assert.deepEqual(standard.record.data.values, {
    frontlineRecipeName: "House Sauce",
    frontlineRecipe: [{ ingredient: "Water", lbs: 10 }, { ingredient: "Sauce Base", lbs: 50 }],
    sauceBarrelLbs: 60,
  });
  assert.ok(standard.sourceDetails.procedure.some((entry) => /Mix until combined/u.test(entry.text)));
  const drum = parsed.records.find((entry) => entry.record.data.values.frontlineRecipeName === "Drum Sauce");
  assert.deepEqual(drum.record.data.values.frontlineRecipe, [
    { ingredient: "Water", lbs: 20 }, { ingredient: "Drum Mix", lbs: 5 },
  ]);
  assert.equal(drum.record.data.values.sauceBarrelLbs, 25);
  assert.ok(drum.sourceDetails.reviewOnly.some((entry) => entry.value === "10"));
  const perRow = parsed.records.find((entry) => entry.record.data.values.frontlineRecipeName === "Row Sauce");
  assert.deepEqual(perRow.record.data.values.frontlineRecipe, [
    { ingredient: "Water", lbs: 10 }, { ingredient: "Oil", lbs: 2 },
  ]);
});

test("keeps literal sauce base batches when alternate batches and totals contain formulas", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["", "Formula Sauce Procedure"], ["", "MATERIALS"], ["", "Single Batch", "LBS.", "2 Bags"],
    ["", "Water", 10, 20], ["", "Sauce Base", 5, 10], ["", "TOTAL WEIGHT", 15, 30],
  ]);
  sheet.D4 = { t: "n", f: "C4*2", v: 20, w: "20" };
  sheet.D5 = { t: "n", f: "C5*2", v: 10, w: "10" };
  sheet.C6 = { t: "n", f: "SUM(C4:C5)", v: 15, w: "15" };
  sheet.D6 = { t: "n", f: "SUM(D4:D5)", v: 30, w: "30" };
  XLSX.utils.book_append_sheet(workbook, sheet, "Sauce");
  const parsed = parseSourceWorkbook("sauce-guides", XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "formula.xlsx");

  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0].record.data.values, {
    frontlineRecipeName: "Formula Sauce",
    frontlineRecipe: [{ ingredient: "Water", lbs: 10 }, { ingredient: "Sauce Base", lbs: 5 }],
  });
  assert.ok(parsed.records[0].sourceDetails.reviewOnly.some((entry) => entry.kind === "formula-total"));
  assert.ok(parsed.records[0].sourceDetails.reviewOnly.some((entry) => entry.kind === "alternate-formula-batch"));
});

test("keeps mixed-unit and experimental sauce tables review-only", () => {
  const mixed = parseSourceWorkbook("sauce-guides", makeWorkbook([["Mixed", [
    ["Mixed Sauce"], ["Ingredients:"], ["Water", "", 28, "qt"], ["Oil", "", 10, "lbs"], ["Process"], ["Mix carefully"],
  ]]]), "mixed.xlsx");
  assert.equal(mixed.records.length, 0);
  assert.ok(mixed.unresolvedRows.some((entry) => /Mixed-unit/iu.test(entry.reason)));
  assert.ok(mixed.unresolvedRows.some((entry) => /Mix carefully/iu.test(entry.reason)));

  const experimental = parseSourceWorkbook("sauce-guides", makeWorkbook([["Experimental", [
    ["Test Sauce"], ["Tested and", "Not Tested"], ["Water", 10, "lb"], ["Oil", 2, "lb"], ["Process"], ["Mix carefully"],
  ]]]), "experimental.xlsx");
  assert.equal(experimental.records.length, 0);
  assert.ok(experimental.unresolvedRows.some((entry) => /experimental/iu.test(entry.reason)));
});

test("parses sauce-guide continuations and exact DOCX paragraphs without applying unsupported text", () => {
  const xlsx = parseSourceWorkbook("sauce-guides", makeWorkbook([["Sauce", [
    ["Acme uses House Red on Classic at 4oz and on Deluxe at 3.5oz"],
    ["Unsupported free-form note"],
  ]]]), "sauce.xlsx");
  assert.equal(xlsx.records.length, 2);
  assert.deepEqual(xlsx.records.map((item) => item.record.data.values.sauceOzPerPizza), [4, 3.5]);
  assert.equal(xlsx.unresolvedRows.length, 1);

  const docx = parseSourceWorkbook(
    "sauce-guides",
    makeStoredDocx("Acme uses their recipe on all varieties at 3oz"),
    "sauce.docx",
  );
  assert.equal(docx.records.length, 1);
  assert.equal(docx.records[0].record.data.values.frontlineRecipeName, "Acme");
  assert.equal(docx.records[0].record.data.values.sauceOzPerPizza, 3);
});

test("reads dough guide column A with nested parentheses and comma-only flavor splitting", () => {
  const parsed = parseSourceWorkbook("dough-guides", makeWorkbook([["Dough", [
    ["Pizza to Dough List"],
    ["Acme (Classic (Thin, Crispy), S&P) = House Dough", "This column is ignored"],
    ["Acme (all) = House Dough"],
  ]]]), "dough.xlsx");
  assert.equal(parsed.records.length, 3);
  assert.deepEqual(parsed.records.map((item) => item.record.data.flavor), [
    "Classic (Thin, Crispy)", "S&P", "",
  ]);
  assert.deepEqual(parsed.records.map((item) => item.record.data.values.doughRecipeName), [
    "House Dough", "House Dough", "House Dough",
  ]);
});

test("formula and cached values, duplicate identities, unsupported files, and size bounds fail closed", () => {
  const formula = parseSourceWorkbook("spec-sheets", makeFormulaWorkbook(), "formula.xlsx");
  assert.equal(formula.records.length, 0);
  assert.equal(formula.unresolvedRows.length, 1);
  assert.match(formula.unresolvedRows[0].reason, /Formula or cached/u);

  const duplicate = parseSourceWorkbook("dough-guides", makeWorkbook([["Dough", [
    ["Acme (Classic) = Dough A"], ["Acme (Classic) = Dough B"],
  ]]]), "dough.xlsx");
  assert.equal(duplicate.records.length, 1);
  assert.match(duplicate.unresolvedRows[0].reason, /Duplicate source identity/u);

  assert.throws(() => parseSourceWorkbook("spec-sheets", Buffer.from("bad"), "input.docx"), /xlsx/iu);
  assert.throws(() => parseSourceWorkbook("sauce-guides", Buffer.from("bad"), "sauce.docx"), SourceWorkbookImportError);
  assert.throws(
    () => parseSourceWorkbook("sauce-guides", Buffer.alloc(5 * 1024 * 1024 + 1), "large.docx"),
    SourceWorkbookImportError,
  );
});
