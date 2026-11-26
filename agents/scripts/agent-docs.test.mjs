import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkAgentDocs, backtickedRepoPaths, credentialFindings, markdownLinkTargets } from "./check-agent-docs.mjs";

async function fixture(t, files) {
  const directory = await mkdtemp(resolve(tmpdir(), "v3-agent-docs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const path = resolve(directory, name);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  return directory;
}

test("repository agent documentation passes the handoff checker", async () => {
  const agentsDir = fileURLToPath(new URL("../", import.meta.url));
  assert.deepEqual(await checkAgentDocs(agentsDir), []);
});


test("V3 importer guidance is indexed and maps to current regression tests", async () => {
  const agentsDir = fileURLToPath(new URL("../", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const [index, lessons, skill, testMap] = await Promise.all([
    readFile(resolve(agentsDir, "AGENTS.md"), "utf8"),
    readFile(resolve(agentsDir, "memory/v1-importer-lessons.md"), "utf8"),
    readFile(resolve(agentsDir, "skills/work-on-importers.md"), "utf8"),
    readFile(resolve(agentsDir, "memory/importer-test-map.md"), "utf8"),
  ]);
  assert.match(index, /\[V1 importer lessons\]\(memory\/v1-importer-lessons\.md\)/u);
  assert.match(index, /\[Importer test map\]\(memory\/importer-test-map\.md\)/u);
  assert.match(index, /\[Work on V3 importers\]\(skills\/work-on-importers\.md\)/u);
  for (const path of [
    "core/source-workbook-import.test.mjs",
    "core/setup-catalog-csv.test.mjs",
    "core/import-csv.test.mjs",
    "core/schedule-workbook-import.test.mjs",
    "core/workbook-capacity-import.test.mjs",
    "core/private-source-corpus.test.mjs",
    "core/source-workbook-corpus.test.mjs",
    "e2e/setup-catalog.browser.test.mjs",
    "e2e/schedule.browser.test.mjs",
  ]) {
    assert.ok(testMap.includes(path), "test map should include a verified importer test");
    await readFile(resolve(repoRoot, path), "utf8");
  }
  assert.match(skill, /no-AI/u);
  assert.deepEqual(credentialFindings([index, lessons, skill, testMap].join("\n")), []);
});

test("link parser accepts external links and ignores images", () => {
  const source = "[Guide](https://example.com/help) ![image](missing.png) [Memory](memory/state.md#rule)";
  assert.deepEqual(markdownLinkTargets(source), ["https://example.com/help", "memory/state.md#rule"]);
});

test("checker accepts external links and indexed repository documents", async (t) => {
  const directory = await fixture(t, {
    "AGENTS.md": "# Agents\n[Official](https://example.com/help)\n[State](memory/state.md)\n",
    "memory/state.md": "# State\n[External](https://example.com/source)\n",
  });
  assert.deepEqual(await checkAgentDocs(directory), []);
});

test("checker rejects a broken relative link", async (t) => {
  const directory = await fixture(t, {
    "AGENTS.md": "# Agents\n[Missing](skills/missing.md)\n",
  });
  const errors = await checkAgentDocs(directory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /broken relative link: skills\/missing\.md/u);
});

test("checker rejects an unindexed skill or memory document", async (t) => {
  const directory = await fixture(t, {
    "AGENTS.md": "# Agents\n[Skill](skills/do-work.md)\n",
    "skills/do-work.md": "# Do work\n",
    "memory/state.md": "# State\n",
  });
  assert.deepEqual(await checkAgentDocs(directory), ["memory/state.md: not indexed by AGENTS.md"]);
});

test("checker rejects non-portable absolute local links", async (t) => {
  const directory = await fixture(t, {
    "AGENTS.md": "# Agents\n[Local](/tmp/private-notes.md)\n",
  });
  const errors = await checkAgentDocs(directory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /absolute local link is not portable/u);
});

test("backticked repo path scan keeps literals and skips placeholders and globs", () => {
  assert.deepEqual(
    backtickedRepoPaths("Run `scripts/smoke.mjs`, edit `db/NNNN-x.sql`, glob `e2e/*.test.mjs`, slot `server/<api>.test.mjs`."),
    ["scripts/smoke.mjs"],
  );
});

test("checker rejects a backticked repo path that does not exist", async (t) => {
  const directory = await fixture(t, {
    "AGENTS.md": "# Agents\nSmoke lives at `scripts/smoke.mjs`.\n",
  });
  const errors = await checkAgentDocs(directory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /backticked repo path not found: scripts\/smoke\.mjs/u);
});

test("checker accepts backticked repo paths resolved from the file, agents root, or repo root", async (t) => {
  const directory = await fixture(t, {
    "repo/agents/AGENTS.md": "# Agents\n[State](memory/state.md)\n[Skill](skills/do-work.md)\nSee `scripts/start.sh`.\n",
    "repo/agents/memory/state.md": "# State\nSee `skills/do-work.md`.\n",
    "repo/agents/skills/do-work.md": "# Do work\n",
    "repo/scripts/start.sh": "#!/bin/sh\n",
  });
  assert.deepEqual(await checkAgentDocs(resolve(directory, "repo/agents")), []);
});

test("credential scanner detects a token-shaped value without storing a real token", () => {
  const syntheticToken = ["github", "_pat_", "A".repeat(24)].join("");
  assert.deepEqual(credentialFindings(`Token: ${syntheticToken}`), ["GitHub token"]);
  assert.deepEqual(credentialFindings("Use the configured secret store; never commit credentials."), []);
});

test("checker reports credential-shaped content in agent markdown", async (t) => {
  const syntheticToken = ["github", "_pat_", "B".repeat(24)].join("");
  const directory = await fixture(t, {
    "AGENTS.md": `# Agents\nDo not commit ${syntheticToken}\n`,
  });
  const errors = await checkAgentDocs(directory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /possible GitHub token/u);
});
