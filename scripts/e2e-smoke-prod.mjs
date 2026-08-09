#!/usr/bin/env node
// scripts/e2e-smoke-prod.mjs — run the smoke against a real PRODUCTION server.
//
// Why this exists: `npm run e2e:smoke` starts no server, so it is only ever
// pointed at a dev server somebody already had running — and the dev CSP is the
// permissive branch (src/proxy.ts: dev gets 'unsafe-inline' on style-src-elem,
// prod gets nonce-only). A prod-only defect was therefore structurally invisible
// to the suite most likely to catch it. See open-followups.md §54.
//
// Usage:
//   npm run build          # required first; this script does NOT build
//   npm run e2e:smoke:prod # PORT overridable, default 3200
//
// Exit code is the smoke's exit code, unmodified.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const port = Number(process.env.PORT) || 3200;
const url = `http://localhost:${port}/`;
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

if (!fs.existsSync(".next")) {
  console.error("No .next/ directory found. Run `npm run build` first — this script does not build.");
  process.exit(1);
}

// Spawn `next start` through node directly rather than via a shell: `npx` needs
// shell:true on win32, and a shell child is not the process that ends up bound
// to the port, which breaks the port-scoped stop below.
const nextBin = require.resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  stdio: "inherit",
});

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  try {
    // Port-scoped kill (netstat+taskkill on win32, lsof+kill elsewhere). NEVER a
    // blanket `taskkill /IM node.exe` — that would take down unrelated tooling.
    execFileSync(process.execPath, ["scripts/stop-dev.mjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: "inherit",
    });
  } catch {
    // stop-dev.mjs already exits 0 when nothing is listening; ignore the rest.
  }
  try {
    server.kill();
  } catch {
    // already gone
  }
}

process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

const ready = await waitForReady();
if (!ready) {
  console.error(`next start did not answer on ${url} within ${READY_TIMEOUT_MS / 1000}s.`);
  stopServer();
  process.exit(1);
}

console.log(`• production server ready at ${url} — running smoke`);

const smoke = spawnSync(process.execPath, ["scripts/e2e-smoke.mjs"], {
  env: { ...process.env, E2E_URL: url },
  stdio: "inherit",
});

stopServer();
process.exit(smoke.status ?? 1);
