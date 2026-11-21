import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["api", "client/src", "core", "db", "server"];
const textExtensions = new Set([".css", ".html", ".mjs", ".js", ".sql", ".ts", ".tsx", ".yaml"]);
const forbidden = /use-ai-tools|AI_INTEGRATIONS|OPENAI_API_KEY|GOOGLE_API_KEY|ANTHROPIC|OLLAMA|@ai-sdk|aiParseSpecSheet/i;
const failures = [];

function walk(path) {
  for (const entry of readdirSync(path)) {
    const next = join(path, entry);
    const stat = statSync(next);
    if (stat.isDirectory()) walk(next);
    else if (textExtensions.has(next.slice(next.lastIndexOf(".")))) {
      readFileSync(next, "utf8").split("\n").forEach((line, index) => {
        if (forbidden.test(line)) failures.push(`${next}:${index + 1}`);
      });
    }
  }
}

for (const root of roots) walk(root);
if (failures.length) {
  console.error("AI integration markers are excluded from the V3 runtime:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("PASS: no AI provider, adapter, prompt, or AI-capability markers in the V3 runtime.");
