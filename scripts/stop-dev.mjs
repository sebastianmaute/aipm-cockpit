#!/usr/bin/env node
// scripts/stop-dev.mjs — stop the app's dev server by PORT (default 3000).
//
// Deliberately PORT-SCOPED, not a blanket "kill every node process": it finds
// only the PID bound to the app's dev port and terminates that one. Killing all
// node.exe would also take down unrelated tools, editors, and this harness.
//
// Cross-platform: netstat+taskkill on win32, lsof+kill elsewhere. Never errors
// when nothing is listening — prints a note and exits 0.

import { execFileSync } from "node:child_process";

const port = Number(process.env.PORT) || 3000;

/** PIDs listening on `port`. Returns a de-duped array (empty if none). */
function pidsOnPort(p) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      // netstat -ano rows: "  TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  12345"
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], {
        encoding: "utf8",
      });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const cols = line.trim().split(/\s+/);
        const local = cols[1] ?? "";
        // Match :<port> at the end of the local address (IPv4 or IPv6).
        if (new RegExp(`[:.]${p}$`).test(local)) {
          const pid = cols[cols.length - 1];
          if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
        }
      }
    } else {
      const out = execFileSync("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"], {
        encoding: "utf8",
      });
      for (const pid of out.split(/\r?\n/)) {
        if (/^\d+$/.test(pid.trim())) pids.add(pid.trim());
      }
    }
  } catch {
    // netstat/lsof missing or nothing bound → treat as no PIDs.
  }
  return [...pids];
}

function kill(pid) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    } else {
      execFileSync("kill", ["-TERM", pid], { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`No dev server listening on port ${port}.`);
  process.exit(0);
}
let killed = 0;
for (const pid of pids) {
  if (kill(pid)) {
    killed += 1;
    console.log(`Stopped dev server (pid ${pid}) on port ${port}.`);
  } else {
    console.log(`Could not stop pid ${pid} on port ${port}.`);
  }
}
process.exit(killed > 0 ? 0 : 1);
