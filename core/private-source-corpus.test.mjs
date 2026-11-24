import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPrivateManifestOutput,
  buildPrivateSourceCorpusManifest,
  listPrivateSourceCorpusFiles,
  PRIVATE_SOURCE_CORPUS_MANIFEST_VERSION,
  privateSourceCorpusFamily,
  privateSourceCorpusTestOptions,
  REQUIRE_PRIVATE_SOURCE_CORPUS_ENV,
  SKIP_PRIVATE_SOURCE_CORPUS_ENV,
} from "./private-source-corpus.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "v3-private-corpus-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("absent private evidence skips publicly but remains required for qualification", () => {
  const root = path.join(tmpdir(), "v3-corpus-definitely-absent");
  assert.match(privateSourceCorpusTestOptions({ env: {}, root }).skip, /not workbook-fidelity evidence/u);
  assert.match(privateSourceCorpusTestOptions({
    env: { [SKIP_PRIVATE_SOURCE_CORPUS_ENV]: "true" }, root,
  }).skip, /not workbook-fidelity evidence/u);
  assert.deepEqual(privateSourceCorpusTestOptions({
    env: { [REQUIRE_PRIVATE_SOURCE_CORPUS_ENV]: "true" }, root,
  }), { skip: false });
  assert.throws(() => privateSourceCorpusTestOptions({
    env: {
      [REQUIRE_PRIVATE_SOURCE_CORPUS_ENV]: "true",
      [SKIP_PRIVATE_SOURCE_CORPUS_ENV]: "true",
    },
    root,
  }), /cannot both be true/u);
});

test("recursive discovery accounts for every regular file without fixed family counts", (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, "specs", "nested"), { recursive: true });
  mkdirSync(path.join(root, "dough"), { recursive: true });
  writeFileSync(path.join(root, "specs", "nested", "one.xlsx"), "first");
  writeFileSync(path.join(root, "dough", "two.xls"), "second");
  writeFileSync(path.join(root, "dough", "three.xlsx"), "third");

  const files = listPrivateSourceCorpusFiles(root);
  assert.deepEqual(files.map((file) => file.relativePath), [
    "dough/three.xlsx",
    "dough/two.xls",
    "specs/nested/one.xlsx",
  ]);
  const manifest = buildPrivateSourceCorpusManifest(root);
  assert.equal(manifest.schemaVersion, PRIVATE_SOURCE_CORPUS_MANIFEST_VERSION);
  assert.equal(manifest.fileCount, 3);
  assert.equal(manifest.totalBytes, 16);
  assert.deepEqual(manifest.families, { dough: 2, specs: 1 });
  assert.deepEqual(manifest.formats, { ".xls": 1, ".xlsx": 2 });
  assert.equal(manifest.files[0].sha256, createHash("sha256").update("third").digest("hex"));
  assert.equal(buildPrivateSourceCorpusManifest(root).corpusSha256, manifest.corpusSha256);

  writeFileSync(path.join(root, "dough", "three.xlsx"), "changed");
  assert.notEqual(buildPrivateSourceCorpusManifest(root).corpusSha256, manifest.corpusSha256);
});

test("normalizes Drive family folders and classifies the extra shipping guide", () => {
  assert.equal(privateSourceCorpusFamily("Dough/procedure.xlsx"), "dough");
  assert.equal(privateSourceCorpusFamily("Specs/product.xlsx"), "specs");
  assert.equal(privateSourceCorpusFamily("Mix/premix.xlsx"), "mix");
  assert.equal(privateSourceCorpusFamily("extra/Shipping and Palletizing Guide.xlsx"), "shipping");
  assert.equal(privateSourceCorpusFamily("extra/other.xlsx"), "extra");
  assert.equal(privateSourceCorpusFamily("root.xlsx"), "unclassified");
});

test("private manifests cannot be written into the corpus or repository", (t) => {
  const root = fixture(t);
  const repository = fixture(t);
  assert.throws(() => assertPrivateManifestOutput(root, path.join(root, "manifest.json"), repository), /outside the corpus/u);
  assert.throws(() => assertPrivateManifestOutput(root, path.join(repository, "manifest.json"), repository), /outside the repository/u);
  const output = path.join(tmpdir(), "v3-private-manifest-test.json");
  assert.equal(assertPrivateManifestOutput(root, output, repository), output);
});
