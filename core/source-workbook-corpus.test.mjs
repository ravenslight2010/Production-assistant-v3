import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildPrivateSourceCorpusManifest,
  listPrivateSourceCorpusFiles,
  privateSourceCorpusTestOptions,
  requirePrivateSourceCorpus,
} from "./private-source-corpus.mjs";
import { projectCombinedSetupReview } from "./combined-setup-review.mjs";
import { parseSourceWorkbook } from "./source-workbook-import.mjs";
import { parseDoughCapacityWorkbook } from "./workbook-capacity-import.mjs";

const EXPECTATIONS_ENV = "V3_PRIVATE_SOURCE_EXPECTATIONS";
const MANIFEST_ENV = "V3_PRIVATE_SOURCE_MANIFEST";
const EXPECTATIONS_VERSION = "v3-source-parser-expectations/2";
const SOURCE_FAMILIES = Object.freeze({
  specs: "spec-sheets",
  sauce: "sauce-guides",
  cheese: "cheese-mix-specs",
  mix: "premix-sheets",
});

function recordExpectation(entry) {
  return {
    source: entry.source,
    brand: entry.record.data.brand ?? "",
    flavor: entry.record.data.flavor ?? "",
    values: entry.record.data.values ?? entry.record.data,
  };
}

function sourceRecord(parsed, source) {
  const matches = parsed.records.filter((entry) => entry.source === source);
  assert.equal(matches.length, 1, `Expected one parsed record at ${source}`);
  return matches[0];
}

function externalEvidencePath(corpusRoot, environmentName, fileName) {
  return path.resolve(process.env[environmentName]
    || path.join(path.dirname(path.dirname(corpusRoot)), fileName));
}

async function readExpectations(corpusRoot) {
  const expectations = JSON.parse(await readFile(
    externalEvidencePath(corpusRoot, EXPECTATIONS_ENV, "parser-expectations.json"), "utf8",
  ));
  assert.equal(expectations.schemaVersion, EXPECTATIONS_VERSION);
  return expectations;
}

test("matches the complete external private corpus manifest", privateSourceCorpusTestOptions(), async () => {
  const corpusRoot = requirePrivateSourceCorpus();
  const expected = JSON.parse(await readFile(
    externalEvidencePath(corpusRoot, MANIFEST_ENV, "manifest-20261124.json"), "utf8",
  ));
  assert.deepEqual(buildPrivateSourceCorpusManifest(corpusRoot), expected,
    "Every corpus path, family, format, byte count, and source hash must match the approved manifest");
});

test("matches external private parser expectations and pinned workbook relationships", privateSourceCorpusTestOptions(), async () => {
  const corpusRoot = requirePrivateSourceCorpus();
  const expectations = await readExpectations(corpusRoot);
  const manifest = buildPrivateSourceCorpusManifest(corpusRoot);
  assert.equal(expectations.corpusSha256, manifest.corpusSha256,
    "Private parser expectations must be regenerated after any source-byte change");

  const discovered = listPrivateSourceCorpusFiles(corpusRoot)
    .filter((file) => SOURCE_FAMILIES[file.family]);
  assert.deepEqual(Object.keys(expectations.files).sort(),
    discovered.map((file) => file.relativePath).sort(),
    "Every current spec, sauce, cheese, and premix workbook needs explicit expectations");

  const parsedByPath = new Map();
  for (const file of discovered) {
    const expected = expectations.files[file.relativePath];
    const manifestFile = manifest.files.find((entry) => entry.path === file.relativePath);
    assert.equal(expected.sha256, manifestFile.sha256, `${file.relativePath} source hash`);
    const parsed = parseSourceWorkbook(SOURCE_FAMILIES[file.family],
      await readFile(file.absolutePath), path.basename(file.relativePath));
    assert.equal(parsed.sourceRows, expected.sourceRows, `${file.relativePath} source rows`);
    assert.equal(parsed.proposedRows, expected.proposedRows, `${file.relativePath} proposed rows`);
    assert.equal(parsed.skippedRows, expected.skippedRows, `${file.relativePath} skipped rows`);
    assert.equal(parsed.unresolvedRows.length, expected.unresolvedRows, `${file.relativePath} unresolved rows`);
    if (expected.records) {
      assert.deepEqual(parsed.records.map(recordExpectation), expected.records,
        `${file.relativePath} parsed record values`);
    }
    if (expected.proposedRows === 0) {
      assert.ok(parsed.unresolvedRows.length > 0, `${file.relativePath} must explain its review-only outcome`);
    }
    parsedByPath.set(file.relativePath, parsed);
  }

  for (const relationship of expectations.relationships) {
    const source = sourceRecord(parsedByPath.get(relationship.sourcePath), relationship.sourceRecord);
    const sourceValue = source.record.data.values?.[relationship.sourceField];
    assert.ok(sourceValue !== undefined && sourceValue !== null && sourceValue !== "",
      `${relationship.sourcePath} ${relationship.sourceRecord} must retain ${relationship.sourceField}`);

    if (relationship.targetFamily === "dough-capacity") {
      const target = listPrivateSourceCorpusFiles(corpusRoot)
        .find((file) => file.relativePath === relationship.targetPath);
      assert.ok(target, `${relationship.targetPath} must remain in the corpus`);
      const parsed = parseDoughCapacityWorkbook(await readFile(target.absolutePath), path.basename(target.relativePath));
      assert.ok(parsed.rows.some((row) => row.name === relationship.targetName),
        `${relationship.targetPath} must retain dough row ${relationship.targetName}`);
      continue;
    }
    const target = sourceRecord(parsedByPath.get(relationship.targetPath), relationship.targetRecord);
    const targetValue = target.record.data.values?.[relationship.targetField];
    assert.ok(targetValue !== undefined && targetValue !== null && targetValue !== "",
      `${relationship.targetPath} ${relationship.targetRecord} must retain ${relationship.targetField}`);
  }
});

test("matches the deterministic combined projection for every canonical private source import", privateSourceCorpusTestOptions(), async () => {
  const corpusRoot = requirePrivateSourceCorpus();
  const expectations = await readExpectations(corpusRoot);
  const discovered = listPrivateSourceCorpusFiles(corpusRoot)
    .filter((file) => SOURCE_FAMILIES[file.family])
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  assert.deepEqual(expectations.combinedProjection.sourcePaths,
    discovered.map((file) => file.relativePath),
    "The combined golden must include every current canonical source workbook exactly once");
  assert.deepEqual(expectations.combinedProjection.currentRecords, []);

  const imports = [];
  for (const [index, file] of discovered.entries()) {
    const fileName = path.basename(file.relativePath);
    const parsed = parseSourceWorkbook(SOURCE_FAMILIES[file.family],
      await readFile(file.absolutePath), fileName);
    imports.push({
      importId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revision: 1,
      family: parsed.targetFamily,
      status: "staged",
      sourceSummary: {
        sourceFamily: SOURCE_FAMILIES[file.family],
        sourceSha256: parsed.fileSha256,
        parserVersion: parsed.parserVersion,
        sourceRows: parsed.sourceRows,
        importedRows: parsed.proposedRows,
        skippedRows: parsed.skippedRows,
        unresolvedRows: parsed.unresolvedRows.length,
      },
      records: parsed.records.map((entry) => ({
        ...entry.record,
        source: { workbook: fileName, cell: entry.source },
        sourceDetails: entry.sourceDetails ?? null,
      })),
    });
  }
  const input = {
    id: "10000000-0000-4000-8000-000000000001",
    createdBy: "20000000-0000-4000-8000-000000000001",
    createdAt: "2026-11-24T00:00:00.000Z",
    imports,
    currentRecords: [],
  };
  const projected = projectCombinedSetupReview(input);
  assert.deepEqual(projected, expectations.combinedProjection.result,
    "All combined fills, conflicts, dependencies, citations, and counts must match the private golden");
  assert.deepEqual(projectCombinedSetupReview({ ...input, imports: [...imports].reverse() }), projected,
    "Combined projection must not depend on import selection order");
});
