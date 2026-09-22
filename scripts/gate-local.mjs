// Run CI's blocking npm gates locally, in order, stopping at the first failure.
// GitHub has no CI until migration sub-project 3, so this IS the merge gate until then
// (docs/superpowers/specs/2026-09-22-github-cutover-design.md). It mirrors the blocking npm
// gates in .gitlab-ci.yml; e2e and axe, semgrep, the dependency audit and prod-smoke are NOT
// here and run nowhere during the gap.
//
// Usage: npm run gate:local
// Exit: 0 when every step passes, otherwise the failing step's exit code (1 for a signal).

import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { pathToFileURL } from "node:url";

// Cap vitest workers so timing-sensitive tests survive a busy desktop.
// Measured: 20-logical-CPU desktop, npm run gate:local went red at npm run test:coverage
// three runs with DIFFERENT timing failures each (20s/60s timeouts, findByRole miss);
// label-binding.guard.test.ts took 94.8s under full run vs 11.5s alone. Parallel coverage
// at --maxWorkers=8 then passed 1180/1180 in 9m42s. Coverage floors and shuffle seed unchanged;
// result still matches CI's gates.
export const VITEST_WORKERS = Math.max(1, Math.floor(availableParallelism() / 2));

export const GATE_STEPS = [
  ["npm", "run", "lint"],
  ["npx", "tsc", "--noEmit"],
  ["npm", "run", "test:coverage", "--", `--maxWorkers=${VITEST_WORKERS}`],
  ["npm", "run", "test:shuffle", "--", `--maxWorkers=${VITEST_WORKERS}`],
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
