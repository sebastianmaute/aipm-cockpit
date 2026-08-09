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
const PORT_PROBE_TIMEOUT_MS = 2_000;
// ★ Same value as PORT_PROBE_TIMEOUT_MS, different question: this bounds ONE
// readiness attempt inside the retry loop, that one bounds the single
// is-the-port-taken probe. Kept separate so tuning one cannot silently move
// the other.
const READY_ATTEMPT_TIMEOUT_MS = 2_000;

if (!fs.existsSync(".next")) {
  console.error("No .next/ directory found. Run `npm run build` first — this script does not build.");
  process.exit(1);
}

/**
 * True if `localhost:<port>` is NOT provably free — it answers `true` both when
 * something is listening and when the probe is ambiguous (see the timeout note
 * below). It is a refuse-to-run signal, not a "someone is listening" fact.
 * Guards against the case where `next start` fails to bind because the port is
 * held by an unrelated process: without this check, waitForReady() below would
 * happily succeed against that FOREIGN server, the smoke would run against the
 * wrong app, and stopServer() would then kill someone else's process. Refusing
 * is the safe behaviour — never adopt-then-kill a server we didn't start.
 *
 * ★★ A RAW TCP CONNECT, NOT AN HTTP REQUEST, AND THAT IS THE POINT. An
 * HTTP-only probe misses a listener that never speaks HTTP — and that case is
 * the DESTRUCTIVE one: next start fails to bind, waitForReady burns its full
 * timeout, and stopServer() then port-kills the foreign PID anyway.
 *
 * ★★ THE TIMEOUT BRANCH RESOLVES `true`, AND THAT IS NOT THE OBVIOUS CHOICE.
 * On loopback a genuinely free port RSTs the SYN, taking the "error" branch in
 * 16.6-30.6 ms — measured over five COLD processes, which is the only condition
 * this script runs in (one probe, then exit). A hang of PORT_PROBE_TIMEOUT_MS is
 * therefore never the "nothing is there" case; it is "something is there and is
 * not answering", e.g. a full accept backlog or a local firewall DROP. Mapping
 * that ambiguous outcome to "free" would re-open the destructive path above, so
 * the ambiguous outcome refuses instead.
 * ★ This said "0-1ms" until it was re-measured. That figure is real but comes
 * from a WARM process on a second connect; a cold process pays DNS resolution
 * for the name "localhost" plus the dual-stack attempt, ~20x more. The
 * conclusion is unchanged — 30 ms is still nowhere near 2000 — but the sole
 * number backing a security-relevant branch decision should not be taken from a
 * condition the code never runs in.
 *
 * ★ RESIDUAL, deliberately not closed here — see `docs/open-followups.md` §130
 * for the measurement and the accept/reject rationale: this probes `localhost`
 * only, so a listener bound to a specific non-loopback address is invisible to
 * it. On Windows the subsequent bind on 0.0.0.0 then SUCCEEDS, and stop-dev.mjs
 * kills every PID whose netstat LOCAL ADDRESS matches `[:.]<port>$` — including
 * that foreign one. Closing it means enumerating local interfaces, which is a
 * lot of machinery for a case that needs someone to have bound a non-loopback
 * address on the smoke's own port. Narrow the claim rather than overstate the
 * guard.
 */
function isPortAlreadyInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "localhost", port });
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
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
      // ★★ The per-attempt timeout is REQUIRED, not tidiness: without it a
      // socket that ACCEPTS the connection and never responds parks this
      // await past the loop's own deadline, so the while-condition is not
      // re-evaluated and READY_TIMEOUT_MS silently stops being a bound.
      // ★ MEASURED, because the obvious wording is wrong: it is not
      // "forever". Node's fetch bails at undici's default headersTimeout —
      // 306_361 ms observed against a server that accepts and stays silent,
      // rejecting UND_ERR_HEADERS_TIMEOUT. That is ~2.6x READY_TIMEOUT_MS,
      // which is what makes the bound useless; "forever" overstates a real
      // defect and invites the next reader to disprove it and dismiss it.
      await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(READY_ATTEMPT_TIMEOUT_MS),
      });
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
