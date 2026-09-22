// Run CI's blocking npm gates locally, in order, stopping at the first failure.
// GitHub has no CI until migration sub-project 3, so this IS the merge gate until then
// (docs/superpowers/specs/2026-09-22-github-cutover-design.md). It mirrors the blocking npm
// gates in .gitlab-ci.yml; e2e and axe, semgrep, the dependency audit and prod-smoke are NOT
// here and run nowhere during the gap.
//
// Usage: npm run gate:local
// Exit: 0 when every step passes, otherwise the failing step's exit code (1 for a signal).

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const GATE_STEPS = [
  ["npm", "run", "lint"],
  ["npx", "tsc", "--noEmit"],
  ["npm", "run", "test:coverage"],
  ["npm", "run", "test:shuffle"],
  ["npm", "run", "dup:check"],
  ["npm", "run", "size:check"],
  ["npm", "run", "docs:symbols:check"],
  ["npm", "run", "docs:claims:check"],
  ["npm", "run", "docs:scripts:check"],
  ["npm", "run", "followups:status:check"],
  ["npm", "run", "followups:index:check"],
  ["npm", "run", "followups:workitems:check"],
  ["npm", "run", "version:check"],
  ["npm", "run", "build"],
];

/** Run `steps` in order through `run(argv) → exit status`; stop at the first nonzero. */
export function runGates(steps, run, log = () => {}) {
  for (const argv of steps) {
    const label = argv.join(" ");
    log(label);
    const code = run(argv);
    if (code !== 0) return { ok: false, failed: label, code: code || 1 };
  }
  return { ok: true, failed: null, code: 0 };
}

function main() {
  const result = runGates(
    GATE_STEPS,
    (argv) => spawnSync(argv[0], argv.slice(1), { stdio: "inherit", shell: process.platform === "win32" }).status,
    (label) => console.log(`\n▶ ${label}`),
  );
  console.log(result.ok ? "\ngate:local PASS" : `\ngate:local FAIL at: ${result.failed} (exit ${result.code})`);
  process.exit(result.code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
