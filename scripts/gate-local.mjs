// Run the repository's blocking npm gates, in order. This file is the ONE list of gates: CI's
// `static` job runs `--group static --keep-going` from it, and the `unit`, `unit-shuffled` and
// `build` jobs run their group's npm script (scripts/ci-workflow.test.mjs pins that). With no flags
// it is the local pre-push check: every group, stopping at the first failure.
// (docs/superpowers/specs/2026-09-23-github-actions-ci-design.md)
//
// Usage: npm run gate:local [-- --allow-dirty] [--group <static|unit|unit-shuffled|build>] [--keep-going]
// Refuses to start on an uncommitted tracked change (git status --porcelain --untracked-files=no)
// unless --allow-dirty is passed, and names the commit it gated at the start and in the final line
// (`gate:local PASS at <sha>` / `gate:local FAIL at: <step> (exit N) — <sha>`), so a passing run says
// which commit it actually vouches for.
// Exit: 2 on a dirty tree; otherwise 0 when every step passes, or the failing step's exit code (1 for
// a signal). A GATE_LOCAL_WORKERS that is set but not a positive integer throws while the module
// loads, so the run exits 1 with that error before any step and prints no PASS/FAIL line.
// --keep-going exits 1 if any step failed; an unknown argument or group exits 2.

import { appendFileSync } from "node:fs";
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
// The value is read when this module loads, so a bad one in the shell also fails any vitest run that
// collects gate-local.test.mjs — unset it rather than export it.
export function resolveWorkers(env, cpus) {
  const raw = env.GATE_LOCAL_WORKERS;
  if (raw === undefined || raw === "") return Math.max(1, Math.floor(cpus / 2));
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`GATE_LOCAL_WORKERS must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

export const VITEST_WORKERS = resolveWorkers(process.env, availableParallelism());

export const GATE_GROUPS = Object.freeze(["static", "unit", "unit-shuffled", "build"]);

const s = (group, argv, extra = {}) => ({ group, argv, ...extra });

export const GATE_STEPS = [
  s("static", ["npm", "run", "lint"]),
  s("static", ["npx", "tsc", "--noEmit"]),
  s("static", ["npm", "run", "desktop:typecheck"]),
  s("unit", ["npm", "run", "test:coverage", "--", `--maxWorkers=${VITEST_WORKERS}`]),
  s("unit-shuffled", ["npm", "run", "test:shuffle", "--", `--maxWorkers=${VITEST_WORKERS}`]),
  s("static", ["npm", "run", "dup:check"]),
  s("static", ["npm", "run", "size:check"]),
  s("static", ["npm", "run", "docs:symbols:check"]),
  s("static", ["npm", "run", "docs:claims:check"]),
  s("static", ["npm", "run", "docs:scripts:check"]),
  s("static", ["npm", "run", "followups:status:check"]),
  s("static", ["npm", "run", "followups:index:check"]),
  s("static", ["npm", "run", "followups:workitems:check"]),
  s("static", ["npm", "run", "version:check"]),
  // The list lives outside the repository, so most contributors cannot run this step. Locally an
  // unset LEAK_LIST_FILE SKIPS it, visibly; under CI (env CI set) the same state FAILS with code 2,
  // so a workflow that forgot to export it cannot pass by skipping.
  s("static", ["npm", "run", "leaks:check"], { requiresEnv: "LEAK_LIST_FILE" }),
  s("build", ["npm", "run", "build"]),
];

/** Parse the gate's own argv. Unknown input is an error, never ignored. */
export function parseCliArgs(args) {
  const out = { group: null, keepGoing: false, allowDirty: false, error: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keep-going") out.keepGoing = true;
    else if (a === "--allow-dirty") out.allowDirty = true;
    else if (a === "--group") {
      const v = args[++i];
      if (v === undefined) return { ...out, error: "--group needs a value" };
      if (!GATE_GROUPS.includes(v)) return { ...out, error: `unknown group "${v}" (known: ${GATE_GROUPS.join(", ")})` };
      out.group = v;
    } else return { ...out, error: `unknown argument "${a}"` };
  }
  return out;
}

/** The steps of one group, in list order; every step for a null group. */
export function selectSteps(steps, group) {
  return group === null ? steps : steps.filter((st) => st.group === group);
}

function isUnset(value) {
  return value === undefined || String(value).trim() === "";
}

/**
 * Run `steps` through `run(argv) → exit status`. Stops at the first failure unless `keepGoing`,
 * which runs everything and reports code 1 when anything failed. A step whose `requiresEnv` is
 * unset is SKIPPED locally and FAILS with code 2 when `env.CI` is set.
 */
export function runGates(steps, run, { keepGoing = false, env = {}, log = () => {} } = {}) {
  const results = [];
  for (const st of steps) {
    const label = st.argv.join(" ");
    if (st.requiresEnv && isUnset(env[st.requiresEnv])) {
      if (isUnset(env.CI)) {
        const note = `${st.requiresEnv} unset`;
        log(`SKIPPED ${label} (${note})`);
        results.push({ label, status: "skipped", code: 0, note });
        continue;
      }
      results.push({ label, status: "fail", code: 2, note: `${st.requiresEnv} unset under CI` });
      if (!keepGoing) break;
      continue;
    }
    log(label);
    const status = run(st.argv);
    if (status === 0) {
      results.push({ label, status: "pass", code: 0, note: null });
      continue;
    }
    results.push({ label, status: "fail", code: status || 1, note: null });
    if (!keepGoing) break;
  }
  const firstFail = results.find((r) => r.status === "fail");
  if (!firstFail) return { ok: true, failed: null, code: 0, results };
  return { ok: false, failed: firstFail.label, code: keepGoing ? 1 : firstFail.code, results };
}

/** One Markdown row per step — printed at the end of every run and appended to the CI step summary. */
export function formatSummaryTable(results) {
  const cell = (r) => (r.status === "pass" ? "PASS"
    : r.status === "skipped" ? `SKIPPED (${r.note})`
    : `FAIL (exit ${r.code}${r.note ? `; ${r.note}` : ""})`);
  return ["| Step | Result |", "|---|---|", ...results.map((r) => `| \`${r.label}\` | ${cell(r)} |`)].join("\n");
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
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.error) {
    console.error(`gate:local: ${cli.error}`);
    process.exit(2);
  }
  const dirty = checkDirtyTree(
    spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout ?? "",
    cli.allowDirty ? ["--allow-dirty"] : [],
  );
  if (dirty.blocked) {
    console.error(dirty.message);
    process.exit(2);
  }

  const sha = (spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout ?? "").trim();
  console.log(formatStartLine(sha));

  const result = runGates(
    selectSteps(GATE_STEPS, cli.group),
    (argv) => {
      const { command, args, shell } = buildSpawnInvocation(argv, process.platform);
      return spawnSync(command, args, { stdio: "inherit", shell }).status;
    },
    { keepGoing: cli.keepGoing, env: process.env, log: (label) => console.log(`\n▶ ${label}`) },
  );
  const table = formatSummaryTable(result.results);
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### gate:local${cli.group ? ` — ${cli.group}` : ""}\n\n${table}\n`);
  }
  console.log(`\n${formatFinalLine(result, sha)}`);
  process.exit(result.code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
