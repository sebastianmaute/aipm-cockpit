#!/usr/bin/env node
// Typechecks desktop/ (tsc -p desktop/tsconfig.json --noEmit), which the root tsc excludes, PLUS
// desktop/tsconfig.test.json (updater.test.ts + updater-module-shape.test.ts — the two desktop
// tests that import electron/electron-updater, so they must stay out of the root tsc program too;
// desktop/tsconfig.json itself excludes every `src/**/*.test.ts`, so neither program sees them
// without this second run). Needs desktop/node_modules (electron's and electron-updater's types).
// Missing: locally a visible SKIP (exit 0); under CI (env CI set) exit 2, so a workflow that
// forgot `npm --prefix desktop ci` cannot pass by skipping.
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

function runTsc(project) {
  const r = spawnSync("npx", ["tsc", "-p", project, "--noEmit"], { stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0 ? 0 : r.status === null ? 2 : 1;
}

const mainExit = runTsc("desktop/tsconfig.json");
const testExit = runTsc("desktop/tsconfig.test.json");
process.exit(Math.max(mainExit, testExit));
