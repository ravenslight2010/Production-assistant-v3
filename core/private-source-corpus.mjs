import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRIVATE_SOURCE_CORPUS_ENV = "V3_PRIVATE_SOURCE_CORPUS";
export const REQUIRE_PRIVATE_SOURCE_CORPUS_ENV = "V3_REQUIRE_PRIVATE_SOURCE_CORPUS";
export const SKIP_PRIVATE_SOURCE_CORPUS_ENV = "V3_SKIP_PRIVATE_SOURCE_CORPUS";
export const PRIVATE_SOURCE_CORPUS_MANIFEST_VERSION = "v3-private-source-corpus/1";

const defaultRoot = fileURLToPath(new URL("../attached_assets/source-library/", import.meta.url));
const absentSkipReason = "Private source corpus is not provisioned; this skip is not workbook-fidelity evidence.";

export function privateSourceCorpusRoot(env = process.env) {
  return path.resolve(env[PRIVATE_SOURCE_CORPUS_ENV] || defaultRoot);
}

function isDirectory(root) {
  return existsSync(root) && statSync(root).isDirectory();
}

export function privateSourceCorpusTestOptions({ env = process.env, root = privateSourceCorpusRoot(env) } = {}) {
  const required = env[REQUIRE_PRIVATE_SOURCE_CORPUS_ENV] === "true";
  const explicitlySkipped = env[SKIP_PRIVATE_SOURCE_CORPUS_ENV] === "true";
  if (required && explicitlySkipped) {
    throw new Error(`${REQUIRE_PRIVATE_SOURCE_CORPUS_ENV} and ${SKIP_PRIVATE_SOURCE_CORPUS_ENV} cannot both be true.`);
  }
  if (!required && explicitlySkipped) return { skip: absentSkipReason };
  if (!required && !isDirectory(root)) return { skip: absentSkipReason };
  return { skip: false };
}

export function requirePrivateSourceCorpus(env = process.env) {
  const root = privateSourceCorpusRoot(env);
  if (!isDirectory(root)) {
    throw new Error(`Private source corpus is required but is not provisioned at ${root}.`);
  }
  return root;
}

function normalizedRelativePath(value) {
  return value.split(path.sep).join("/");
}

export function listPrivateSourceCorpusFiles(root) {
  if (!isDirectory(root)) throw new Error(`Private source corpus directory is unavailable at ${root}.`);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new Error(`Private source corpus contains an unsupported filesystem entry at ${absolutePath}.`);
      }
      if (entry.isDirectory()) visit(absolutePath);
      else {
        const relativePath = normalizedRelativePath(path.relative(root, absolutePath));
        const segments = relativePath.split("/");
        files.push({
          absolutePath,
          relativePath,
          family: segments.length > 1 ? segments[0] : "unclassified",
          format: path.extname(entry.name).toLocaleLowerCase("en-US") || "no-extension",
        });
      }
    }
  };
  visit(root);
  return files;
}

function groupedCounts(files, key) {
  const counts = {};
  for (const file of files) counts[file[key]] = (counts[file[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildPrivateSourceCorpusManifest(root) {
  const discovered = listPrivateSourceCorpusFiles(root);
  const corpusHash = createHash("sha256");
  const files = discovered.map((file) => {
    const bytes = readFileSync(file.absolutePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    corpusHash.update(file.relativePath);
    corpusHash.update("\0");
    corpusHash.update(sha256);
    corpusHash.update("\0");
    return {
      path: file.relativePath,
      family: file.family,
      format: file.format,
      bytes: bytes.byteLength,
      sha256,
    };
  });
  corpusHash.update(files.length ? "complete" : "empty");
  return {
    schemaVersion: PRIVATE_SOURCE_CORPUS_MANIFEST_VERSION,
    corpusSha256: corpusHash.digest("hex"),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    families: groupedCounts(files, "family"),
    formats: groupedCounts(files, "format"),
    files,
  };
}

export function assertPrivateManifestOutput(root, outputPath, repositoryRoot) {
  const resolved = path.resolve(outputPath);
  for (const [boundary, label] of [[root, "corpus"], [repositoryRoot, "repository"]]) {
    const relative = path.relative(path.resolve(boundary), resolved);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`Private corpus manifest output must be outside the ${label}.`);
    }
  }
  if (existsSync(resolved) && !lstatSync(resolved).isFile()) {
    throw new Error("Private corpus manifest output is not a regular file.");
  }
  return resolved;
}
