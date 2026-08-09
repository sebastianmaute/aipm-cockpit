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
// Exits with the smoke's exit code (1 if the smoke could not be run).

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";

const require = createRequire(import.meta.url);
const port = Number(process.env.PORT) || 3200;
const url = `http://localhost:${port}/`;
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

if (!fs.existsSync(".next")) {
  console.error("No .next/ directory found. Run `npm run build` first — this script does not build.");
  process.exit(1);
}

/**
 * True if ANYTHING is already listening on the port. Guards against the case
 * where `next start` fails to bind because the port is held by an unrelated
 * process: without this check, waitForReady() below would happily succeed
 * against that FOREIGN server, the smoke would run against the wrong app,
 * and stopServer() would then kill someone else's process. Refusing is the
 * safe behaviour — never adopt-then-kill a server we didn't start.
 *
 * ★★ A RAW TCP CONNECT, NOT AN HTTP REQUEST, AND THAT IS THE POINT. An
 * HTTP-only probe misses a listener that never speaks HTTP — and that case is
 * the DESTRUCTIVE one: next start fails to bind, waitForReady burns its full
 * timeout, and stopServer() then port-kills the foreign PID anyway. The check
 * has to cover any listener to be worth having.
 */
function isPortAlreadyInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "localhost", port });
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(2000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

if (await isPortAlreadyInUse()) {
  console.error(
    `Something is already listening on ${url} — refusing to start \`next start\` there ` +
      `(this script would mistake it for its own server and kill it on exit).\n` +
      `If it's a stale server of yours, run: PORT=${port} npm run stop`,
  );
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
      // ★ The per-attempt timeout is REQUIRED, not tidiness: a socket that
      // accepts the connection but never responds would hang this await
      // forever, the while-condition would never be re-evaluated, and
      // READY_TIMEOUT_MS would silently stop being a bound at all.
      await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      return true;
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

// stdio is "inherit", so a child that RAN prints its own output — but a child
// that never launched (ENOENT/EACCES) prints nothing, and would otherwise
// collapse into the same silent exit 1 as "the smoke ran and found issues".
if (smoke.error) console.error("Failed to launch e2e-smoke.mjs:", smoke.error);
else if (smoke.signal) console.error(`e2e-smoke.mjs was killed by ${smoke.signal}`);

stopServer();
process.exit(smoke.status ?? 1);
