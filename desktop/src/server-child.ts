import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { APP_HOST, APP_PORT } from "./lib/constants";

// Spawn the Next standalone server on ELECTRON'S OWN NODE.
//
// ★★★ process.execPath + ELECTRON_RUN_AS_NODE=1 is what makes a second Node
// runtime unnecessary. Electron already contains one; bundling another would
// add ~50MB for nothing.
//
// ★★★ HOSTNAME is 127.0.0.1, NOT 0.0.0.0. A 0.0.0.0 bind publishes the app --
// and the user's entire workspace -- to the corporate LAN. There is an
// automated test for this in e2e/desktop-smoke.spec.ts; do not "fix" a
// networking problem by widening it.
export function spawnServer(resourcesPath: string): ChildProcess {
  const serverJs = join(resourcesPath, "standalone", "server.js");
  return spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      HOSTNAME: APP_HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

// Kill the server, PID-scoped.
//
// ★★★ NEVER a blanket `taskkill /IM node.exe`. This runs on a user's laptop:
// that command would kill their editor, their other Electron apps, and any
// other Node process they own. This mirrors the discipline in
// scripts/stop-dev.mjs, which is port-scoped for the same reason.
export function killServer(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      // /T kills the process TREE, so a server that spawned workers does not
      // orphan them onto the pinned port.
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Already gone, or taskkill unavailable. Nothing to do -- the next launch's
    // port-owner check is the backstop.
  }
}
