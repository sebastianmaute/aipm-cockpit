// Run CI's blocking npm gates locally, in order, stopping at the first failure.
// GitHub has no CI until migration sub-project 3, so this IS the merge gate until then
// (docs/superpowers/specs/2026-09-22-github-cutover-design.md). It mirrors the blocking npm
// gates in .gitlab-ci.yml; e2e and axe, semgrep, the dependency audit and prod-smoke are NOT
// here and run nowhere during the gap.
//
// Usage: npm run gate:local [-- --allow-dirty]
// Refuses to start on an uncommitted tracked change (git status --porcelain --untracked-files=no)
// unless --allow-dirty is passed, and names the commit it gated at the start and in the final line
// (`gate:local PASS at <sha>` / `gate:local FAIL at: <step> (exit N) — <sha>`), so a passing run says
// which commit it actually vouches for.
// Exit: 2 on a dirty tree; otherwise 0 when every step passes, or the failing step's exit code (1 for
// a signal).

import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { pathToFileURL } from "node:url";

// Cap vitest workers so timing-sensitive tests survive a busy desktop.
// Measured on 20-logical-CPU machine: default worker count → gate:local red x3 (timing-only),
// --maxWorkers=8 → coverage pass (1180/1180 files, 9m42s), formula value (Math.max(1,
// Math.floor(availableParallelism() / 2)) = 10 on 20-CPU) → gate:local green on both
// test:coverage and test:shuffle (1180/1180 files, 19500/19500 tests each, 2026-09-22 18:46).
// Coverage floors and shuffle seed are unchanged, but --maxWorkers changes which files share a
// worker, so test:shuffle does not reproduce CI's exact worker layout. GATE_LOCAL_WORKERS overrides
// the formula (a small machine, where half the CPUs may be 1, or a machine that is otherwise idle).
export function resolveWorkers(env, cpus) {
  const raw = env.GATE_LOCAL_WORKERS;
  if (raw === undefined || raw === "") return Math.max(1, Math.floor(cpus / 2));
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`GATE_LOCAL_WORKERS must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

export const VITEST_WORKERS = resolveWorkers(process.env, availableParallelism());

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

/**
 * Decide whether a dirty working tree should refuse the run. `porcelainText` is the output of
 * `git status --porcelain --untracked-files=no`; `cliArgs` is the gate's own argv (`--allow-dirty`
 * opts out — e.g. a caller who already reviewed the diff and wants the gate to run over it anyway).
 * Pure: takes text in, returns a decision, does no git call itself.
 */
export function checkDirtyTree(porcelainText, cliArgs) {
  const isDirty = porcelainText.trim().length > 0;
  const allowDirty = cliArgs.includes("--allow-dirty");
  if (isDirty && !allowDirty) {
    return {
      blocked: true,
      message: "gate:local refuses to start: the working tree has uncommitted tracked changes "
        + "(pass --allow-dirty to run anyway).",
    };
  }
  return { blocked: false, message: null };
}

/** Names the commit the run is about to gate. */
export function formatStartLine(sha) {
  return `gate:local — gating commit ${sha}`;
}

/** The single terminal line: which commit passed, or which step and exit code failed it. */
export function formatFinalLine(result, sha) {
  return result.ok
    ? `gate:local PASS at ${sha}`
    : `gate:local FAIL at: ${result.failed} (exit ${result.code}) — ${sha}`;
}

/**
 * win32's DEP0190: passing BOTH an args array and `shell: true` to spawnSync is deprecated. On
 * win32 we join the whole step into one command string instead (safe here because no GATE_STEPS
 * element contains a space or shell metacharacter — pinned by a test). Every other platform keeps
 * the plain argv array with no shell.
 */
export function buildSpawnInvocation(argv, platform) {
  if (platform === "win32") {
    return { command: argv.join(" "), args: [], shell: true };
  }
  return { command: argv[0], args: argv.slice(1), shell: false };
}

function main() {
  const dirty = checkDirtyTree(
    spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout ?? "",
    process.argv.slice(2),
  );
  if (dirty.blocked) {
    console.error(dirty.message);
    process.exit(2);
  }

  const sha = (spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout ?? "").trim();
  console.log(formatStartLine(sha));

  const result = runGates(
    GATE_STEPS,
    (argv) => {
      const { command, args, shell } = buildSpawnInvocation(argv, process.platform);
      return spawnSync(command, args, { stdio: "inherit", shell }).status;
    },
    (label) => console.log(`\n▶ ${label}`),
  );
  console.log(`\n${formatFinalLine(result, sha)}`);
  process.exit(result.code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
