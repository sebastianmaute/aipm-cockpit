import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { APP_HOST, APP_PORT } from "./lib/constants";

// Environment variables that can make the forked server child LOAD OR EXECUTE
// CODE it never chose to run, or ATTACH A DEBUGGER to it (M-6,
// final-release-review.md). The RunAsNode / Node-inspect / NODE_OPTIONS
// fuses (electron-builder.yml, §561) are proven to cover the shipped exe
// ITSELF -- they stop `AI PM Cockpit.exe` being used as a Node interpreter or
// debugger target -- but nothing verified they also govern a
// `utilityProcess.fork`ed child's own env, which is a separate process this
// spawns with `env: { ...process.env, ... }` below, i.e. whatever the OS gave
// the parent. Kept small and deliberately narrow to vars that inject code or
// a debugger; NODE_ENV is left alone (this function overrides it to
// "production" right below regardless of what is inherited).
//
//  - NODE_OPTIONS: passes arbitrary CLI flags via an env var, including
//    `--require`/`--import`/`--loader`/`--inspect[-brk]` (Node docs, CLI
//    "Environment variables").
//  - NODE_PATH: extra module-resolution search directories -- an attacker
//    who controls ANY directory on NODE_PATH can shadow a module the server
//    requires with one of the same name. Confirmed on system Node outside
//    Electron, on this project's pinned version (v24.21.0, engines.node
//    >=24): a same-named module placed on NODE_PATH resolves ahead of
//    "module not found". Not probed through the packaged exe.
//  - NODE_REPL_EXTERNAL_MODULE: loads an external module into the REPL on
//    startup. The Next server never starts a REPL, so this is inert here in
//    practice, but it is a documented code-load vector and costs nothing to
//    scrub as belt-and-braces.
//
// Probed, not assumed (M-6, final-release-review.md; see
// docs/open-followups.md §561): launched the PACKAGED exe with
// NODE_OPTIONS=--require <marker-writing script> set in its OWN environment,
// let the utility-process server start, quit it gracefully, and checked
// whether the marker was created. Result: the marker was NOT created EITHER
// WAY -- with this scrub in place, AND with it reverted (mutation-tested by
// rebuilding/repackaging with `scrubbedEnv()` bypassed back to the plain
// `...process.env` it replaces, then rerunning the same probe). THIS DOES
// NOT SHOW that the enableNodeOptionsEnvironmentVariable fuse
// (electron-builder.yml, §561) already covers the utility-process child --
// the probe's only positive control was plain `node` outside Electron, and
// no run showed a marker appearing through Electron at all, so the no-marker
// result cannot distinguish the fuse blocking the injection from Electron's
// own packaged-app NODE_OPTIONS restrictions, or from the utility process
// simply never honouring the variable. The scrub stays as belt-and-braces
// either way (§561's owed list carries the missing positive control as an
// open item). NODE_PATH / NODE_REPL_EXTERNAL_MODULE were not probed through
// the packaged exe at all (no realistic probe for either against this
// server).
const DANGEROUS_NODE_ENV_VARS = ["NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE"] as const;

/** A copy of `process.env` with `DANGEROUS_NODE_ENV_VARS` removed -- deleted
 *  outright rather than set to `undefined`, since `undefined`-filtering is a
 *  Node `child_process` behaviour this does not rely on `utilityProcess.fork`
 *  (an Electron API, not Node core) also implementing. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of DANGEROUS_NODE_ENV_VARS) delete env[key];
  return env;
}

// Children whose `exit` has fired. UtilityProcess has no `exitCode`, so
// killServer cannot ask the child whether it is dead; it asks this set.
// Belt-and-braces: electron.d.ts also types `pid` as undefined after `exit`,
// but that is the only other signal, and it is equally undefined BEFORE
// `spawn` -- so on its own it cannot tell "dead" from "not started yet".
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
      ...scrubbedEnv(),
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
  if (!child || exited.has(child)) return;
  if (child.pid === undefined) {
    // Forked but not spawned yet: there is no PID to kill. This only covers a
    // `spawn` that completes while the app is still running, i.e. a call from
    // `before-quit` — it then kills the child the moment `spawn` fires. Called
    // from `process.on("exit")` instead, the event loop is already done and
    // this listener never fires; that path has nothing to fall back on but
    // Chromium's own teardown of its child processes.
    child.once("spawn", () => killServer(child));
    return;
  }
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
