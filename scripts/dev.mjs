import { spawn } from "node:child_process";

if (!process.env.V3_DATABASE_URL) {
  console.error("V3_DATABASE_URL is required. Use a disposable PostgreSQL database; see .env.example.");
  process.exit(2);
}

const children = [
  spawn(process.execPath, ["server/main.mjs"], { env: process.env, stdio: "inherit" }),
  spawn(process.execPath, ["server/worker-main.mjs"], { env: process.env, stdio: "inherit" }),
  spawn("pnpm", ["run", "dev:web"], { env: process.env, stdio: "inherit", shell: process.platform === "win32" }),
];
let closing = false;

function close(signal = "SIGTERM") {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(`Development process failed: ${error.name}`);
    close();
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (!closing && (code !== 0 || signal)) {
      close();
      process.exitCode = code || 1;
    }
  });
}
process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));
