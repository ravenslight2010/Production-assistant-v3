import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkAgentDocs, credentialFindings, markdownLinkTargets } from "./check-agent-docs.mjs";

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
