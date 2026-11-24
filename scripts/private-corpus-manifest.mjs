import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPrivateManifestOutput,
  buildPrivateSourceCorpusManifest,
  privateSourceCorpusRoot,
} from "../core/private-source-corpus.mjs";

const root = privateSourceCorpusRoot();
const outputArgument = process.argv[2];
if (!outputArgument) {
  console.error("Usage: node scripts/private-corpus-manifest.mjs <private-output.json>");
  console.error("The output must be outside both the corpus and the repository.");
  process.exit(1);
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const output = assertPrivateManifestOutput(root, outputArgument, repositoryRoot);
const manifest = buildPrivateSourceCorpusManifest(root);
mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  status: "PASS",
  fileCount: manifest.fileCount,
  families: manifest.families,
  formats: manifest.formats,
  corpusSha256: manifest.corpusSha256,
}, null, 2));
