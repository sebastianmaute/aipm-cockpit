import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { APP_HOST, APP_PORT } from "./lib/constants";

// Children whose `exit` has fired. UtilityProcess has no `exitCode`, so
// killServer cannot ask the child whether it is dead; it asks this set.
const exited = new WeakSet<UtilityProcess>();

// Start the Next standalone server on ELECTRON'S OWN NODE, as a utility
// process.
//
// ★★★ utilityProcess.fork, NOT spawn(process.execPath) + ELECTRON_RUN_AS_NODE=1.
// The packaged build turns the RunAsNode fuse off (electronFuses.runAsNode in
// electron-builder.yml, §561), and with it off Electron IGNORES
// ELECTRON_RUN_AS_NODE: the old spawn booted a second Electron GUI instance,
// the server never listened, and the app died in its "did not finish
// starting" dialog. utilityProcess runs a Node child without that fuse.
// Either way Electron's own Node is reused -- bundling another would add
// ~50MB for nothing. It can only be called after `app` is ready; start() in
// main.ts runs from `app.whenReady().then(start)`.
//
// ★★★ HOSTNAME is 127.0.0.1, NOT 0.0.0.0. A 0.0.0.0 bind publishes the app --
// and the user's entire workspace -- to the corporate LAN. There is an
// automated test for this in e2e/desktop-smoke.spec.ts; do not "fix" a
// networking problem by widening it.
export function spawnServer(resourcesPath: string): UtilityProcess {
  const serverJs = join(resourcesPath, "standalone", "server.js");
  const child = utilityProcess.fork(serverJs, [], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      HOSTNAME: APP_HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "AI PM Cockpit server",
  });
  child.once("exit", () => exited.add(child));
  return child;
}

// Kill the server, PID-scoped.
//
// ★★★ NEVER a blanket `taskkill /IM node.exe`. This runs on a user's laptop:
// that command would kill their editor, their other Electron apps, and any
// other Node process they own. This mirrors the discipline in
// scripts/stop-dev.mjs, which is port-scoped for the same reason.
export function killServer(child: UtilityProcess | null): void {
  if (!child || exited.has(child) || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      // /T kills the process TREE, so a server that spawned workers does not
      // orphan them onto the pinned port.
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  } catch {
    // Already gone, or taskkill unavailable. Nothing to do -- the next launch's
    // port-owner check is the backstop.
  }
}
