import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  listPrivateSourceCorpusFiles,
  privateSourceCorpusTestOptions,
  requirePrivateSourceCorpus,
} from "./private-source-corpus.mjs";
import {
  linkWorkbookCapacityRows,
  parseDoughCapacityWorkbook,
  parseShippingCapacityWorkbook,
  readWorkbookSheets,
  WorkbookCapacityImportError,
} from "./workbook-capacity-import.mjs";

function makeWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("parses named dough rows and preserves displayed yield and source cells", () => {
  const buffer = makeWorkbook([["Procedure", [
    ["Dough mixing procedure"],
    [],
    ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
    ["North Shop", 7.7, 310.5, 645.19, 84],
  ]]]);
  const parsed = parseDoughCapacityWorkbook(buffer, "procedure.xlsx");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, "North Shop");
  assert.equal(parsed.rows[0].doughballYield, 645.19);
  assert.equal(parsed.rows[0].source.yieldCell, "Procedure!D4");
  assert.equal(parsed.rows[0].source.displayedYield, "645.19");
});

test("keeps missing yield cells unavailable instead of deriving a replacement", () => {
  const buffer = makeWorkbook([["Procedure", [
    ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
    ["North Shop", 7.7, 310.5, "", 84],
  ]]]);
  const parsed = parseDoughCapacityWorkbook(buffer, "procedure.xlsx");
  assert.equal(parsed.rows[0].doughballYield, null);
  assert.equal(parsed.rows[0].source.displayedYield, null);
});

test("parses numeric and explicit multipack case sizes from shipping guides", () => {
  const buffer = makeWorkbook([["Shipping", [
    ["Pizza", "Notes", "Pizzas/CS"],
    ["North Shop", "", 12],
    ["South Shop", "", "4 - 3PACK"],
    ["Unknown Shop", "", "varies"],
  ]]]);
  const parsed = parseShippingCapacityWorkbook(buffer, "shipping.xlsx");
  assert.deepEqual(parsed.rows.map((row) => row.pizzasPerCase), [12, 12, null]);
  assert.equal(parsed.rows[1].source.pizzasPerCaseCell, "Shipping!C3");
});

test("links only unique exact normalized product names and remembers confirmed product codes", () => {
  const row = {
    sourceKey: "a".repeat(64),
    name: "Café’s   Dough",
  };
  assert.equal(linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-A", name: "CAFÉ'S Dough" }],
  )[0].linkType, "exact");

  assert.equal(linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-A", name: "Café’s Dough" }, { code: "DOUGH-B", name: "CAFÉ'S DOUGH" }],
  )[0].linkType, "ambiguous");

  const remembered = linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-A", name: "Renamed Product" }],
    [{ sourceKey: row.sourceKey, productCode: "DOUGH-A" }],
  )[0];
  assert.deepEqual([remembered.productCode, remembered.linkType], ["DOUGH-A", "remembered"]);

  const changedCode = linkWorkbookCapacityRows(
    [row],
    [{ code: "DOUGH-MERGED", name: "Renamed Product" }],
    [{ sourceKey: row.sourceKey, productCode: "DOUGH-A" }],
  )[0];
  assert.deepEqual([changedCode.productCode, changedCode.linkType], [null, "unmatched"]);
});

test("manager links resolve only unmatched rows and retain the active product's stable code", () => {
  const rows = [
    { sourceKey: "a".repeat(64), name: "Misspelled Product" },
    { sourceKey: "b".repeat(64), name: "Exact Product" },
    { sourceKey: "c".repeat(64), name: "Duplicate Product" },
  ];
  const products = [
    { code: "PRODUCT-A", name: "Correct Product" },
    { code: "EXACT", name: "Exact Product" },
    { code: "DUP-A", name: "Duplicate Product" },
    { code: "DUP-B", name: " duplicate product " },
  ];
  const managerLinks = [
    { sourceKey: rows[0].sourceKey, productCode: "product-a" },
    { sourceKey: rows[1].sourceKey, productCode: "PRODUCT-A" },
    { sourceKey: rows[2].sourceKey, productCode: "DUP-A" },
  ];

  const linked = linkWorkbookCapacityRows(rows, products, [], managerLinks);
  assert.deepEqual(linked.map(({ productCode, linkType }) => [productCode, linkType]), [
    ["PRODUCT-A", "manager"],
    ["EXACT", "exact"],
    ["DUP-A", "manager"],
  ]);
  assert.equal(linkWorkbookCapacityRows(
    [rows[2]],
    products,
    [],
  )[0].productCode, null);
});

test("uses real cell bounds instead of empty formatted XFD ranges", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Acme", 20], [], ["Total", 20]]);
  sheet["!ref"] = "A1:XFD44";
  XLSX.utils.book_append_sheet(workbook, sheet, "Sparse");
  const parsed = readWorkbookSheets(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "sparse.xlsx",
  );
  assert.equal(parsed.sheets.length, 1);
  assert.equal(parsed.sheets[0].rows.length, 3);
  assert.deepEqual(parsed.sheets[0].rows[0].slice(0, 2), ["Acme", "20"]);
});

test("accepts the bounded 54-sheet premix shape and rejects sheets beyond the new cap", () => {
  const sheets = Array.from({ length: 54 }, (_, index) => [`Mix ${index + 1}`, [["Per Pizza", "Per Batch"], [1, 2]]]);
  const parsed = readWorkbookSheets(makeWorkbook(sheets), "54-sheets.xlsx");
  assert.equal(parsed.sheets.length, 54);
  sheets.push(["Mix 55", [[1]]]);
  assert.doesNotThrow(() => readWorkbookSheets(makeWorkbook(sheets), "55-sheets.xlsx"));
  while (sheets.length < 65) sheets.push([`Mix ${sheets.length + 1}`, [[1]]]);
  assert.throws(
    () => readWorkbookSheets(makeWorkbook(sheets), "65-sheets.xlsx"),
    /between one and 64 sheets/u,
  );
});

test("matches exact private expectations for every dough procedure and shipping guide", privateSourceCorpusTestOptions(), async () => {
  const corpusRoot = requirePrivateSourceCorpus();
  const expectationsPath = path.resolve(process.env.V3_PRIVATE_SOURCE_EXPECTATIONS
    || path.join(path.dirname(path.dirname(corpusRoot)), "parser-expectations.json"));
  const expectations = JSON.parse(await readFile(expectationsPath, "utf8"));
  assert.equal(expectations.schemaVersion, "v3-source-parser-expectations/2");
  const files = listPrivateSourceCorpusFiles(corpusRoot)
    .filter((file) => file.family === "dough" || file.family === "shipping");
  assert.deepEqual(Object.keys(expectations.capacity).sort(),
    files.map((file) => file.relativePath).sort(),
    "Every current dough and shipping workbook needs exact parser expectations");

  const doughResults = [];
  const shippingResults = [];
  for (const file of files) {
    assert.equal(file.format, ".xlsx", `${file.relativePath} requires deterministic format support before qualification`);
    const expected = expectations.capacity[file.relativePath];
    const parsed = file.family === "dough"
      ? parseDoughCapacityWorkbook(await readFile(file.absolutePath), path.basename(file.relativePath))
      : parseShippingCapacityWorkbook(await readFile(file.absolutePath), path.basename(file.relativePath));
    assert.equal(expected.parser, file.family === "dough" ? "dough-procedure" : "shipping-guide");
    assert.equal(parsed.fileSha256, expected.sha256, `${file.relativePath} source hash`);
    assert.deepEqual(parsed, expected.result, `${file.relativePath} exact parsed rows and citations`);
    (file.family === "dough" ? doughResults : shippingResults).push(...parsed.rows);
  }
  const approvedRow = doughResults.find((row) => row.name === "12'' Aldo");
  assert.equal(approvedRow?.doughballYield, 645.19);
  assert.equal(approvedRow?.source.yieldCell, "Sheet1!E32");
  assert.ok(shippingResults.some((row) => row.name === "Aldo's" && row.pizzasPerCase === 12));
});

test("rejects invalid workbooks and unsupported file families explicitly", () => {
  assert.throws(
    () => parseDoughCapacityWorkbook(Buffer.from("not an xlsx"), "procedure.xlsx"),
    WorkbookCapacityImportError,
  );
  assert.throws(
    () => parseDoughCapacityWorkbook(makeWorkbook([["Sheet1", [["not a dough table"]]]]), "procedure.xlsx"),
    /No doughball yield table was found/u,
  );
});
