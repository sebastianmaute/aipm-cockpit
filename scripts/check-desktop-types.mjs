#!/usr/bin/env node
// Typechecks desktop/ (tsc -p desktop/tsconfig.json --noEmit), which the root tsc excludes.
// Needs desktop/node_modules (electron's and electron-updater's types). Missing: locally a
// visible SKIP (exit 0); under CI (env CI set) exit 2, so a workflow that forgot
// `npm --prefix desktop ci` cannot pass by skipping.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("desktop/node_modules/electron/package.json")) {
  if (process.env.CI) {
    console.error("[desktop:typecheck] CANNOT CHECK: desktop/node_modules is missing (run npm --prefix desktop ci)");
    process.exit(2);
  }
  console.log("[desktop:typecheck] SKIPPED: desktop/node_modules is missing (npm --prefix desktop ci to enable)");
  process.exit(0);
}
const r = spawnSync("npx", ["tsc", "-p", "desktop/tsconfig.json", "--noEmit"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === 0 ? 0 : r.status === null ? 2 : 1);
