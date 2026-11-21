import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const required = [
  "research/source-index.md",
  "research/feature-matrix.md",
  "research/decisions/approved-v3-design.md",
];
const missing = required.filter((path) => !existsSync(path));
const forbiddenNames = /(?:^|\/)(?:\.env|github-token(?:\([^)]*\))?\.env|id_rsa|.*\.(?:p12|pfx|pem|key))$/i;
const forbiddenContent = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}/;
const failures = [...missing];

function walk(path) {
  for (const entry of readdirSync(path)) {
    const next = join(path, entry);
    if (forbiddenNames.test(next)) failures.push(`${next}: forbidden file type or credential filename`);
    else if (statSync(next).isDirectory()) walk(next);
    else if (/\.(?:md|json|yaml|yml|txt)$/.test(next)) {
      const text = readFileSync(next, "utf8");
      if (forbiddenContent.test(text)) failures.push(`${next}: possible credential content`);
    }
  }
}
if (existsSync("research")) walk("research");
if (failures.length) {
  console.error("Research-library checks failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("PASS: research indexes exist and no credential-pattern files were found.");
