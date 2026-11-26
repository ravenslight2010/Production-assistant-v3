// Validate the public agent handoff without reading outside requested link targets.
// Run from anywhere: node agents/scripts/check-agent-docs.mjs

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INDEX_NAME = "AGENTS.md";
const INDEXED_DIRECTORIES = new Set(["memory", "skills"]);
const SECRET_PATTERNS = [
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: "AWS access key", pattern: /\bAKIA[A-Z0-9]{16}\b/u },
];

export function markdownLinkTargets(markdown) {
  return [...markdown.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)/gu)]
    .map((match) => match[1].trim())
    .map((target) => target.startsWith("<") ? target.slice(1, target.indexOf(">")) : target.split(/\s+["']/u)[0])
    .filter(Boolean);
}

export function credentialFindings(markdown) {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(markdown)).map(({ name }) => name);
}

async function markdownFiles(agentsDir) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
  }
  await walk(agentsDir);
  return files.sort();
}

function portablePath(path) {
  return path.split(sep).join("/");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function checkAgentDocs(agentsDir) {
  const errors = [];
  const indexPath = resolve(agentsDir, INDEX_NAME);
  let index;
  try {
    index = await readFile(indexPath, "utf8");
  } catch {
    return [`${INDEX_NAME}: missing agent index`];
  }

  const files = await markdownFiles(agentsDir);
  const indexedTargets = new Set(markdownLinkTargets(index).map((target) => target.split("#")[0]));

  for (const file of files) {
    const relativePath = portablePath(relative(agentsDir, file));
    const markdown = await readFile(file, "utf8");
    for (const finding of credentialFindings(markdown)) {
      errors.push(`${relativePath}: possible ${finding}; remove credential material`);
    }

    for (const target of markdownLinkTargets(markdown)) {
      if (/^(?:https?:\/\/|mailto:)/u.test(target)) continue;
      const pathTarget = target.split("#")[0];
      if (!pathTarget) continue;
      if (pathTarget.startsWith("/")) {
        errors.push(`${relativePath}: absolute local link is not portable: ${target}`);
        continue;
      }
      let decoded;
      try {
        decoded = decodeURIComponent(pathTarget);
      } catch {
        errors.push(`${relativePath}: malformed link target: ${target}`);
        continue;
      }
      const destination = resolve(dirname(file), decoded);
      if (!await pathExists(destination)) {
        errors.push(`${relativePath}: broken relative link: ${target}`);
      }
    }

    const topDirectory = relativePath.split("/")[0];
    if (INDEXED_DIRECTORIES.has(topDirectory) && !indexedTargets.has(relativePath)) {
      errors.push(`${relativePath}: not indexed by ${INDEX_NAME}`);
    }
  }

  return errors;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const agentsDir = fileURLToPath(new URL("../", import.meta.url));
  const errors = await checkAgentDocs(agentsDir);
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    console.error(`Agent documentation: ${errors.length} problem(s)`);
    process.exitCode = 1;
  } else {
    console.log("Agent documentation: PASS");
  }
}
