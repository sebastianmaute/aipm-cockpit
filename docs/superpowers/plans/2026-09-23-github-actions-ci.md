# CI on GitHub Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every blocking gate of the old GitLab pipeline runs as a required GitHub Actions check on
each pull request and push to `main`, and register §200 closes.

**Architecture:** `scripts/gate-local.mjs` becomes the single list of gates, grouped by the CI job
that owns them. `.github/workflows/ci.yml` runs eight jobs that are also the eight required checks,
and `scheduled.yml` runs the weekly non-blocking jobs. A textual vitest guard
(`scripts/ci-workflow.test.mjs` over `scripts/ci-workflow-lib.mjs`) pins the workflow against the
gate list and the docs. Every gate is then proven red against a planted defect before it becomes
required.

**Tech Stack:** GitHub Actions (ubuntu-latest hosted runners), Node 24, vitest 4, Playwright 1.61.1,
semgrep, actionlint, `gh` CLI, `glab` CLI (issues stay on GitLab until sub-project 4).

**Spec:** `docs/superpowers/specs/2026-09-23-github-actions-ci-design.md` — read it first. The plan
argues from it.

## Global Constraints

- Repository stays **private**; nothing in this plan changes visibility.
- GitHub plan: **Pro**. Actions budget: **$0** (included minutes only).
- Required checks, exactly: `static`, `unit`, `unit-shuffled`, `build`, `e2e`, `prod-smoke`, `semgrep`, `audit`.
- Workflow-level `permissions: contents: read`; only `semgrep` adds `security-events: write`.
- Every `uses:` pinned to a 40-hex commit SHA (a `docker://` image by `@sha256:` digest), with the version in a trailing comment.
- `actions/checkout` always with `persist-credentials: false`.
- Every job carries `timeout-minutes`.
- Playwright container tag `mcr.microsoft.com/playwright:v1.61.1-jammy` must equal the resolved `@playwright/test` version in `package-lock.json`.
- Node major **24** (`engines.node` is `>=24`). ★ Deviation from the spec, recorded: the spec says `node-version-file: package.json`, but setup-node resolves the range `>=24` to the newest release, which could silently move CI to a newer major than GitLab's `node:24`. The plan writes `node-version: "24"` instead, and the workflow test pins it to the `engines` floor.
- `npm run gate:local` with no flags keeps its current order, its stop-at-first-failure behaviour, its start line and its final line.
- The leak list is **never** written into the tree, a PR description, a commit message or chat. Control plants use a synthetic canary token (Task 7), never a real list entry: a branch pushed to GitHub stays reachable through `refs/pull/*` forever and becomes public at the flip.
- Merging: `gh pr merge --merge --match-head-commit <sha>`. Never `--auto`. Push, PR and merge happen only when the owner says so.
- Commits cite register entries as `§N` only; `Closes #NN` only in a PR description.
- Never read a gate's exit code through a pipe (AGENTS.md). In workflow `run:` steps that pipe, set `shell: bash`, which gives `-eo pipefail`.
- `scripts/*.mjs` imported by tests carry **no shebang**.
- Never two vitest runs at once on this machine.
- Every commit, control plants included, is made as `65776548+sebastianmaute@users.noreply.github.com` (check `git config user.email` first). Task 10's history proof fails on any third identity reachable from a GitHub ref, `refs/pull/*` included.

## Review Focus

1. **The leak secret is missing in CI** (unset secret, a Dependabot PR — Dependabot has its own secret store — or a job that forgot to export `LEAK_LIST_FILE`). Expected: `static` goes red. Pinned by Task 1's `CI=true` test (a required env var that is unset under CI is a failure with code 2, not a skip) and Task 0's Dependabot secret.
2. **`--keep-going` hides a failure's exit code or reports green with a failed step.** Expected: exit 1 whenever any step failed, and every failure listed. Pinned in Task 1.
3. **`.next/` silently missing from the `build` artifact.** `upload-artifact` excludes hidden files by default, and `.next` is a hidden directory, so prod-smoke would fail with "No .next/ directory found" for the wrong reason. Expected: the artifact carries `.next/` minus `.next/cache`. Pinned by the `include-hidden-files: true` assertion in Task 3's workflow test, and proven by Task 6's first green prod-smoke run.
4. **A piped `run:` step exits 0 on a red command.** GitHub's default shell has no `pipefail`. Expected: the `unit` job goes red when vitest does. Pinned by Task 3's test (every `run:` block containing `|` sits in a step declaring `shell: bash`), and proven by Task 7's failing-unit plant.
5. **A stale PR run cancels a `main` run, or a `main` run is cancelled by the next push.** Expected: only `pull_request` runs are cancel-in-progress. Pinned by Task 3's concurrency assertion.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/gate-local.mjs` | modify | the one gate list (`GATE_STEPS` of `{ group, argv, requiresEnv? }`), CLI parsing, runner, summary table |
| `scripts/gate-local.test.mjs` | modify | unit tests for the above |
| `scripts/ci-workflow-lib.mjs` | create | pure text helpers over workflow YAML and the ci.md required-check block |
| `scripts/ci-workflow.test.mjs` | create | the helpers' own tests + assertions over the real workflow files |
| `.github/workflows/ci.yml` | create | the eight required jobs |
| `.github/workflows/scheduled.yml` | create | weekly `audit-full`, `unit-shuffled-random`, `dast-zap` |
| `.github/dependabot.yml` | create | weekly pin updates for `github-actions` |
| `scripts/check-identifier-leaks.mjs` | modify (header only) | drop "CI WIRING IS PENDING" |
| `package.json` | modify (`scriptsDescriptions`) | `gate:local`, `leaks:check` wording |
| `CONTRIBUTING.md` | modify | PR process; regenerated scripts table |
| `AGENTS.md` | modify | "CI is GitHub Actions" hard constraint |
| `docs/AGENTS/ci.md` | modify | Actions job by job + the required-check block |
| `docs/RUNBOOK.md` | modify | "CI red", "minutes exhausted" |
| `docs/superpowers/specs/2026-09-20-github-migration-roadmap.md` | modify | SP3 status, SP4 requirement |
| `docs/superpowers/specs/2026-09-22-github-cutover-design.md` | modify | dated correction on "`main` protected" |
| `docs/open-followups.md` | modify | new fork-PR entry; §200 closure |
| `.gitlab-ci.yml` | modify (two comments) | scrub the project-number mentions |

PR A = Tasks 1–2. PR B = Tasks 3–5. Tasks 6–9 are rollout on GitHub. PR C = Task 10. Task 11 is a
check one week later.

---

### Task 0: Owner setup (manual — the owner does this; the executor verifies)

**Files:** none.

- [ ] **Step 1: Upgrade the account to GitHub Pro.** github.com → Settings → Billing and plans.
- [ ] **Step 2: Set the Actions budget to $0.** Settings → Billing → Budgets and alerts → Actions → $0 with "stop usage when budget is reached".
- [ ] **Step 3: Store the leak list as an Actions secret and a Dependabot secret.**

```bash
gh secret set LEAK_LIST < ~/.config/aipm-cockpit/leak-list.txt
gh secret set LEAK_LIST --app dependabot < ~/.config/aipm-cockpit/leak-list.txt
gh secret list; gh secret list --app dependabot
```
Expected: `LEAK_LIST` appears in both listings.

- [ ] **Step 4: Create the `main` ruleset without required checks.** Settings → Rules → Rulesets → New branch ruleset, name `main`, target `main`, enforcement Active, bypass list: Repository admin. Rules: Restrict deletions, Block force pushes, Require a pull request before merging (0 approvals; allowed merge method: Merge).
- [ ] **Step 5: Verify (executor).**

```bash
gh api repos/sebastianmaute/aipm-cockpit/rules/branches/main --jq '.[].type'
```
Expected: the output includes `deletion`, `non_fast_forward`, `pull_request`. Before Step 1 this call answered 403. Do **not** test with a live push to `main`: if the rule were missing, the test itself would land a commit there.

---

### Task 1: The shared gate list

**Files:**
- Modify: `scripts/gate-local.mjs`
- Modify: `scripts/gate-local.test.mjs`
- Modify: `package.json` (`scriptsDescriptions["gate:local"]` only)
- Modify: `CONTRIBUTING.md` (regenerated, not hand-edited)

**Interfaces:**
- Produces:
  - `GATE_GROUPS: readonly ["static", "unit", "unit-shuffled", "build"]`
  - `GATE_STEPS: Array<{ group: string, argv: string[], requiresEnv?: string }>`
  - `parseCliArgs(args: string[]) → { group: string|null, keepGoing: boolean, allowDirty: boolean, error: string|null }`
  - `selectSteps(steps, group: string|null) → steps`
  - `runGates(steps, run: (argv) => number|null, opts?: { keepGoing?: boolean, env?: object, log?: (line) => void }) → { ok, failed: string|null, code: number, results: Array<{ label, status: "pass"|"fail"|"skipped", code: number, note: string|null }> }`
  - `formatSummaryTable(results) → string` (Markdown table)
  - unchanged: `resolveWorkers`, `VITEST_WORKERS`, `checkDirtyTree`, `formatStartLine`, `formatFinalLine`, `buildSpawnInvocation`
- Consumed by Task 3 (`GATE_GROUPS`, `GATE_STEPS`).

- [ ] **Step 1: Migrate the existing tests to the new shapes and write the new failing tests.**

In `scripts/gate-local.test.mjs`, update the import:

```js
import {
  GATE_GROUPS, GATE_STEPS, runGates, VITEST_WORKERS, resolveWorkers, parseCliArgs, selectSteps,
  checkDirtyTree, formatStartLine, formatFinalLine, formatSummaryTable, buildSpawnInvocation,
} from "./gate-local.mjs";

const step = (name, extra = {}) => ({ group: "static", argv: [name], ...extra });
```

Replace the whole `describe("runGates", …)` block with:

```js
describe("runGates", () => {
  it("runs every step in order when all pass", () => {
    const seen = [];
    const r = runGates([step("a"), step("b"), step("c")], (argv) => (seen.push(argv[0]), 0));
    expect(seen).toEqual(["a", "b", "c"]);
    expect(r).toMatchObject({ ok: true, failed: null, code: 0 });
    expect(r.results.map((x) => x.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("stops at the first failure and returns its exit code", () => {
    const seen = [];
    const r = runGates([step("a"), step("b"), step("c")], (argv) => (seen.push(argv[0]), argv[0] === "b" ? 3 : 0));
    expect(seen).toEqual(["a", "b"]);
    expect(r).toMatchObject({ ok: false, failed: "b", code: 3 });
  });

  it("treats a step killed by a signal (null status) as a failure with code 1", () => {
    expect(runGates([step("a")], () => null)).toMatchObject({ ok: false, failed: "a", code: 1 });
  });

  it("with keepGoing runs every step, lists every failure, and exits 1", () => {
    const seen = [];
    const r = runGates([step("a"), step("b"), step("c"), step("d")],
      (argv) => (seen.push(argv[0]), argv[0] === "b" ? 3 : argv[0] === "d" ? 2 : 0), { keepGoing: true });
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(r).toMatchObject({ ok: false, failed: "b", code: 1 });
    expect(r.results.filter((x) => x.status === "fail").map((x) => [x.label, x.code])).toEqual([["b", 3], ["d", 2]]);
  });

  it("with keepGoing and no failure exits 0", () => {
    expect(runGates([step("a"), step("b")], () => 0, { keepGoing: true })).toMatchObject({ ok: true, code: 0 });
  });

  it("skips a step whose required env var is unset outside CI, visibly and without running it", () => {
    const seen = [];
    const lines = [];
    const r = runGates([step("a"), step("leaks", { requiresEnv: "LEAK_LIST_FILE" })],
      (argv) => (seen.push(argv[0]), 0), { env: {}, log: (l) => lines.push(l) });
    expect(seen).toEqual(["a"]);
    expect(r).toMatchObject({ ok: true, code: 0 });
    expect(r.results[1]).toEqual({ label: "leaks", status: "skipped", code: 0, note: "LEAK_LIST_FILE unset" });
    expect(lines).toContain("SKIPPED leaks (LEAK_LIST_FILE unset)");
  });

  it("treats a blank or whitespace-only required env var as unset", () => {
    for (const v of ["", "   "]) {
      const r = runGates([step("leaks", { requiresEnv: "LEAK_LIST_FILE" })], () => 0, { env: { LEAK_LIST_FILE: v } });
      expect(r.results[0].status).toBe("skipped");
    }
  });

  it("under CI, an unset required env var FAILS with code 2 instead of skipping", () => {
    const seen = [];
    const r = runGates([step("leaks", { requiresEnv: "LEAK_LIST_FILE" }), step("b")],
      (argv) => (seen.push(argv[0]), 0), { env: { CI: "true" }, keepGoing: true });
    expect(seen).toEqual(["b"]);
    expect(r).toMatchObject({ ok: false, failed: "leaks", code: 1 });
    expect(r.results[0]).toEqual({ label: "leaks", status: "fail", code: 2, note: "LEAK_LIST_FILE unset under CI" });
  });

  it("runs a step whose required env var is set", () => {
    const seen = [];
    runGates([step("leaks", { requiresEnv: "LEAK_LIST_FILE" })], (argv) => (seen.push(argv[0]), 0),
      { env: { LEAK_LIST_FILE: "/tmp/x" } });
    expect(seen).toEqual(["leaks"]);
  });
});
```

Replace the `describe("GATE_STEPS", …)` block with:

```js
describe("GATE_STEPS", () => {
  it("every npm step names a real script", () => {
    const missing = GATE_STEPS.filter((s) => s.argv[0] === "npm").map((s) => s.argv[2]).filter((n) => !(n in pkg.scripts));
    expect(missing).toEqual([]);
  });

  it("typechecks and builds, first lint and last build", () => {
    expect(GATE_STEPS[0].argv).toEqual(["npm", "run", "lint"]);
    expect(GATE_STEPS.map((s) => s.argv)).toContainEqual(["npx", "tsc", "--noEmit"]);
    expect(GATE_STEPS.at(-1).argv).toEqual(["npm", "run", "build"]);
  });

  it("keeps the pre-existing steps in their pre-existing order", () => {
    expect(GATE_STEPS.filter((s) => !s.requiresEnv).map((s) => s.argv.slice(0, 3).join(" "))).toEqual([
      "npm run lint", "npx tsc --noEmit", "npm run test:coverage", "npm run test:shuffle", "npm run dup:check",
      "npm run size:check", "npm run docs:symbols:check", "npm run docs:claims:check", "npm run docs:scripts:check",
      "npm run followups:status:check", "npm run followups:index:check", "npm run followups:workitems:check",
      "npm run version:check", "npm run build",
    ]);
  });

  it("puts every step in exactly one known group, and every group has a step", () => {
    for (const s of GATE_STEPS) expect(GATE_GROUPS).toContain(s.group);
    for (const g of GATE_GROUPS) expect(GATE_STEPS.some((s) => s.group === g)).toBe(true);
  });

  it("groups the steps by the CI job that owns them", () => {
    const byGroup = (g) => GATE_STEPS.filter((s) => s.group === g).map((s) => s.argv[2]);
    expect(byGroup("unit")).toEqual(["test:coverage"]);
    expect(byGroup("unit-shuffled")).toEqual(["test:shuffle"]);
    expect(byGroup("build")).toEqual(["build"]);
    expect(byGroup("static")).toContain("leaks:check");
  });

  it("gates leaks:check on LEAK_LIST_FILE, and nothing else on any env var", () => {
    expect(GATE_STEPS.filter((s) => s.requiresEnv).map((s) => [s.argv[2], s.requiresEnv]))
      .toEqual([["leaks:check", "LEAK_LIST_FILE"]]);
  });

  it("is wired as npm run gate:local with a description", () => {
    expect(pkg.scripts["gate:local"]).toBe("node scripts/gate-local.mjs");
    expect(pkg.scriptsDescriptions["gate:local"]).toBeTruthy();
  });

  it("caps vitest workers on both vitest steps with a positive integer", () => {
    const vitestSteps = GATE_STEPS.filter((s) => s.argv[2] === "test:coverage" || s.argv[2] === "test:shuffle");
    expect(vitestSteps).toHaveLength(2);
    for (const s of vitestSteps) expect(s.argv.slice(3)).toEqual(["--", `--maxWorkers=${VITEST_WORKERS}`]);
    expect(Number.isInteger(VITEST_WORKERS) && VITEST_WORKERS >= 1).toBe(true);
  });

  it("carries no whitespace inside any single argv element", () => {
    // buildSpawnInvocation joins a whole step into ONE string with argv.join(" ") on win32 — an
    // element that itself contained a space or shell metacharacter would need quoting the join
    // does not provide.
    for (const s of GATE_STEPS) {
      for (const part of s.argv) expect(part).not.toMatch(/[\s"'`|&;<>]/);
    }
  });
});

describe("parseCliArgs", () => {
  it("defaults to every group, stop at first failure, clean tree required", () => {
    expect(parseCliArgs([])).toEqual({ group: null, keepGoing: false, allowDirty: false, error: null });
  });

  it("reads --group, --keep-going and --allow-dirty", () => {
    expect(parseCliArgs(["--group", "static", "--keep-going", "--allow-dirty"]))
      .toEqual({ group: "static", keepGoing: true, allowDirty: true, error: null });
  });

  it("rejects an unknown group, and a --group with no value", () => {
    expect(parseCliArgs(["--group", "nope"]).error).toMatch(/unknown group "nope"/);
    expect(parseCliArgs(["--group"]).error).toMatch(/--group needs a value/);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(parseCliArgs(["--keepgoing"]).error).toMatch(/unknown argument "--keepgoing"/);
  });
});

describe("selectSteps", () => {
  it("returns every step for a null group", () => {
    expect(selectSteps(GATE_STEPS, null)).toBe(GATE_STEPS);
  });

  it("returns only the named group's steps, in order", () => {
    const s = selectSteps(GATE_STEPS, "static");
    expect(s.length).toBeGreaterThan(5);
    expect(s.every((x) => x.group === "static")).toBe(true);
    expect(s[0].argv).toEqual(["npm", "run", "lint"]);
  });
});

describe("formatSummaryTable", () => {
  it("renders one Markdown row per step with its result", () => {
    const table = formatSummaryTable([
      { label: "npm run lint", status: "pass", code: 0, note: null },
      { label: "npm run dup:check", status: "fail", code: 1, note: null },
      { label: "npm run leaks:check", status: "skipped", code: 0, note: "LEAK_LIST_FILE unset" },
    ]);
    expect(table.split("\n")).toEqual([
      "| Step | Result |",
      "|---|---|",
      "| `npm run lint` | PASS |",
      "| `npm run dup:check` | FAIL (exit 1) |",
      "| `npm run leaks:check` | SKIPPED (LEAK_LIST_FILE unset) |",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run scripts/gate-local.test.mjs --reporter=dot > "$SP/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/t1.log"` (`$SP` = the session scratchpad).
Expected: EXIT=1, failures naming `GATE_GROUPS`, `parseCliArgs`, `selectSteps` and `formatSummaryTable` (not exported yet) and the `s.argv` shape.

- [ ] **Step 3: Implement.** In `scripts/gate-local.mjs`:

Update the header's first paragraph to:

```js
// Run the repository's blocking npm gates, in order. This file is the ONE list of gates: CI's
// `static` job runs `--group static --keep-going` from it, and the `unit`, `unit-shuffled` and
// `build` jobs run their group's npm script (scripts/ci-workflow.test.mjs pins that). With no flags
// it is the local pre-push check: every group, stopping at the first failure.
// (docs/superpowers/specs/2026-09-23-github-actions-ci-design.md)
//
// Usage: npm run gate:local [-- --allow-dirty] [--group <static|unit|unit-shuffled|build>] [--keep-going]
```

Keep the rest of the header (dirty tree, exit codes, `GATE_LOCAL_WORKERS`) and append one line to
the exit-code paragraph: `--keep-going exits 1 if any step failed; an unknown argument or group exits 2.`

Replace `GATE_STEPS` and `runGates` with:

```js
export const GATE_GROUPS = Object.freeze(["static", "unit", "unit-shuffled", "build"]);

const s = (group, argv, extra = {}) => ({ group, argv, ...extra });

export const GATE_STEPS = [
  s("static", ["npm", "run", "lint"]),
  s("static", ["npx", "tsc", "--noEmit"]),
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
    : `FAIL (exit ${r.code})`);
  return ["| Step | Result |", "|---|---|", ...results.map((r) => `| \`${r.label}\` | ${cell(r)} |`)].join("\n");
}
```

Replace `main()` with:

```js
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
```

and add `import { appendFileSync } from "node:fs";` to the imports.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run scripts/gate-local.test.mjs --reporter=dot > "$SP/t1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/t1.log"`
Expected: EXIT=0, `Test Files  1 passed (1)`.

- [ ] **Step 5: Mutation check (then revert each).** Run the suite once per mutant; each must go red. Revert and confirm `git diff --stat scripts/gate-local.mjs` shows only your intended change after each.
  - `if (isUnset(env.CI))` → `if (true)` (CI state skips) → the "under CI … FAILS" test must fail.
  - `code: keepGoing ? 1 : firstFail.code` → `code: firstFail.code` → the keepGoing exit-1 test must fail.
  - delete `if (!keepGoing) break;` after the failing-run push → the "stops at the first failure" test must fail.

- [ ] **Step 6: Smoke the CLI by hand** (not a gate, a sanity check):

```bash
node scripts/gate-local.mjs --group nope; echo "EXIT=$?"          # expect: unknown group, EXIT=2
node scripts/gate-local.mjs --group static --keep-going --allow-dirty > "$SP/g.log" 2>&1; echo "EXIT=$?"
grep -E "^\| " "$SP/g.log"
```
Expected for the second: EXIT=0 (all static gates green on a clean tree), a table with every static step, and `leaks:check` as PASS when `LEAK_LIST_FILE` is exported in your shell or `SKIPPED (LEAK_LIST_FILE unset)` otherwise.

- [ ] **Step 7: Update the description and regenerate the docs table.** In `package.json` set:

```json
"gate:local": "Run the repository's blocking npm gates (the list CI's static, unit, unit-shuffled and build jobs use), in order, stopping at the first failure. --group <name> runs one group; --keep-going runs every step and reports each failure. Not semgrep, the dependency audit or e2e. leaks:check is skipped when LEAK_LIST_FILE is unset",
```
then `npm run docs:scripts; npm run docs:scripts:check; echo "EXIT=$?"` → EXIT=0, and `git diff --stat` shows `CONTRIBUTING.md` changed.

- [ ] **Step 8: Commit.**

```bash
git add scripts/gate-local.mjs scripts/gate-local.test.mjs package.json CONTRIBUTING.md
git commit -m "feat: gate groups and --keep-going in gate:local, with the leak gate in the list"
```

---

### Task 2: Register — the fork-PR entry, and the cut-over protection correction

**Files:**
- Modify: `docs/open-followups.md` (one new entry + its index row)
- Modify: `docs/superpowers/specs/2026-09-22-github-cutover-design.md`

- [ ] **Step 1: Reserve the next number on `origin/main`.**

```bash
git fetch -q origin
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```
New number N = that + 1. It is reserved once PR A merges; if another branch merges first with N, take the next one.

- [ ] **Step 2: Create the GitLab issue** (issues stay on GitLab until sub-project 4):

```bash
glab issue create --title "§N: Fork PRs cannot run the leak gate — decide the rule at the visibility flip" \
  --label "source::register" --description "Register entry §N in docs/open-followups.md."
```
Record the issue number as `#M`.

- [ ] **Step 3: Write the entry** at the end of the entries, in the register's shape (heading, `**Status:**` line with an ISO date, `**Work item:** #M`, body), and its index row between the index markers. Body:

```markdown
## N. Fork PRs cannot run the leak gate — decide the rule at the visibility flip — open

**Status:** open 2026-09-23 — never machine-verified; undecidable until the repository is public,
because a private repository cannot receive fork PRs.

**Work item:** #M

GitHub gives a pull request from a fork no secrets, so the `static` job's `LEAK_LIST_FILE` is
unset there and `gate:local` (under `CI`) fails `leaks:check` with code 2 — every outside
contribution would be red. Deferred by the sub-project 3 spec
(`docs/superpowers/specs/2026-09-23-github-actions-ci-design.md`, "Leak gate on fork PRs").

Options, undecided:
1. skip `leaks:check` on fork PRs and rely on the push-to-`main` run — a fork's leak is caught only
   after the merge, when a public repository has already published it;
2. keep fork PRs red until a maintainer re-runs the change from a branch in this repository.

Decide at the flip, and prove the chosen rule with a fork PR before closing this entry.
```

- [ ] **Step 4: Correct the cut-over spec.** In `docs/superpowers/specs/2026-09-22-github-cutover-design.md`, directly under the paragraph that begins `**GitHub repository settings.**`, add:

```markdown
> ★★ **Correction 2026-09-23:** "`main` protected" was never in force. On the Free plan a private
> repository can hold neither branch protection nor rulesets — both APIs answer 403 "Upgrade to
> GitHub Pro or make this repository public". Only the merge settings took effect. Sub-project 3
> (`2026-09-23-github-actions-ci-design.md`, "Protection") adds the ruleset after the Pro upgrade.
```

- [ ] **Step 5: Gates.**

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run followups:workitems:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```
Expected: all four EXIT=0.

- [ ] **Step 6: Commit.**

```bash
git add docs/open-followups.md docs/superpowers/specs/2026-09-22-github-cutover-design.md
git commit -m "docs: §N fork-PR leak-gate rule deferred to the flip; correct the cut-over protection claim"
```

- [ ] **Step 7: PR A** (only on the owner's say): push, `gh pr create`, run `npm run gate:local` (export `LEAK_LIST_FILE` first), and merge with `gh pr merge --merge --match-head-commit <sha>` quoting the `gate:local PASS at <sha>` line in the PR. There is no CI yet; this is the last merge gated only locally.

---

### Task 3: The workflow guard (test first) and `ci.yml`

**Files:**
- Create: `scripts/ci-workflow-lib.mjs`
- Create: `scripts/ci-workflow.test.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `docs/AGENTS/ci.md` (the required-check block only; the rest is Task 5)

**Interfaces:**
- Consumes: `GATE_GROUPS`, `GATE_STEPS` from Task 1.
- Produces (`ci-workflow-lib.mjs`):
  - `jobIds(yamlText) → string[]`
  - `jobBlock(yamlText, id) → string` (throws if the job is missing)
  - `unpinnedUses(yamlText) → string[]` (offending `uses:` values)
  - `topLevelBlock(yamlText, key) → string[]` (trimmed non-empty lines under a top-level key)
  - `requiredChecksFromDoc(mdText) → string[]` (throws if the markers are missing or the block is empty)
  - `pipedRunsWithoutBash(yamlText) → string[]` (first line of each offending `run:`)

- [ ] **Step 1: Resolve the pins** (record the output; it is used verbatim in Step 5 and Task 4):

```bash
for r in actions/checkout actions/setup-node actions/upload-artifact actions/download-artifact github/codeql-action; do
  tag=$(gh release view -R "$r" --json tagName --jq .tagName)
  sha=$(gh api "repos/$r/commits/$tag" --jq .sha)
  echo "$r $tag $sha"
done
for img in rhysd/actionlint semgrep/semgrep; do
  tag=$([ "$img" = rhysd/actionlint ] && gh release view -R rhysd/actionlint --json tagName --jq '.tagName|ltrimstr("v")' || echo latest)
  dig=$(curl -s "https://hub.docker.com/v2/repositories/$img/tags/$tag" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).digest))")
  echo "$img $tag $dig"
done
```
Expected: five `owner/repo vX.Y.Z <40-hex>` lines and two `image tag sha256:<64-hex>` lines. `gh api …/commits/<tag>` dereferences an annotated tag to its commit, which is what `uses:` needs. For semgrep, `latest` is resolved **once** to a digest here, and that digest is what gets pinned.

- [ ] **Step 2: Write the lib's failing tests.** Create `scripts/ci-workflow.test.mjs`:

```js
// @vitest-environment node
//
// Textual guard over .github/workflows/*.yml. There is no YAML parser in this repository and one is
// not added for this: the helpers read the fixed two-space layout these files are written in, and
// their own tests below pin what they accept and reject. actionlint (in the static job) is the
// structural check; this file pins the repository-specific rules actionlint cannot know.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_GROUPS, GATE_STEPS } from "./gate-local.mjs";
import {
  jobIds, jobBlock, unpinnedUses, topLevelBlock, requiredChecksFromDoc, pipedRunsWithoutBash,
} from "./ci-workflow-lib.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SHA = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;

const FIXTURE = [
  "name: x",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  one:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: actions/checkout@${SHA} # v5`,
  "      - run: echo hi | tee out",
  "  two:",
  "    steps:",
  "      - shell: bash",
  "        run: echo a | tee b",
  "      - uses: ./local-action",
  "on:",
  "  push:",
].join("\n");

describe("ci-workflow-lib", () => {
  it("jobIds lists the jobs and stops at the next top-level key", () => {
    expect(jobIds(FIXTURE)).toEqual(["one", "two"]);
  });

  it("jobBlock returns one job's text and throws for a missing job", () => {
    expect(jobBlock(FIXTURE, "one")).toMatch(/echo hi/);
    expect(jobBlock(FIXTURE, "one")).not.toMatch(/local-action/);
    expect(() => jobBlock(FIXTURE, "nope")).toThrow(/no job "nope"/);
  });

  it("unpinnedUses accepts SHAs, local actions and docker digests, and flags everything else", () => {
    const y = [
      `  - uses: a/b@${SHA}`,
      "  - uses: a/b@v4",
      "  - uses: a/b@main",
      `  - uses: a/b@${"a".repeat(39)}`,
      "  - uses: ./x",
      `  - uses: docker://img/x@${DIGEST}`,
      "  - uses: docker://img/x:1.2",
      `  uses: a/b/sub@${SHA} # v1`,
    ].join("\n");
    expect(unpinnedUses(y)).toEqual(["a/b@v4", "a/b@main", `a/b@${"a".repeat(39)}`, "docker://img/x:1.2"]);
  });

  it("topLevelBlock returns the lines under one top-level key", () => {
    expect(topLevelBlock(FIXTURE, "permissions")).toEqual(["contents: read"]);
  });

  it("requiredChecksFromDoc reads the marked list and refuses a missing or empty block", () => {
    const md = "x\n<!-- required-checks:begin -->\n- `static`\n- `unit` — words\n<!-- required-checks:end -->\n";
    expect(requiredChecksFromDoc(md)).toEqual(["static", "unit"]);
    expect(() => requiredChecksFromDoc("no markers")).toThrow(/markers/);
    expect(() => requiredChecksFromDoc("<!-- required-checks:begin -->\n<!-- required-checks:end -->")).toThrow(/empty/);
  });

  it("pipedRunsWithoutBash flags a piped run: whose step does not declare shell: bash", () => {
    expect(pipedRunsWithoutBash(FIXTURE)).toEqual(["echo hi | tee out"]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail.**

Run: `npx vitest run scripts/ci-workflow.test.mjs --reporter=dot > "$SP/t3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" "$SP/t3.log" | head`
Expected: EXIT=1, "Failed to load" / cannot find `./ci-workflow-lib.mjs`.

- [ ] **Step 4: Implement the lib.** Create `scripts/ci-workflow-lib.mjs` (no shebang):

```js
/** Pure text helpers over this repository's GitHub workflow files and the required-check list in
 *  docs/AGENTS/ci.md. They assume the fixed layout the workflows are written in: top-level keys at
 *  column 0, job ids at two spaces under `jobs:`, steps as `- ` list items. They are NOT a YAML
 *  parser; ci-workflow.test.mjs pins exactly what they accept. No shebang: this file is imported. */

const JOB_LINE = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const TOP_LEVEL = /^\S/;
const SHA_PIN = /^[^@\s]+@[0-9a-f]{40}$/;
const DOCKER_PIN = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const STEP_START = /^ {6}- /;

function jobsSection(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => TOP_LEVEL.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

export function jobIds(text) {
  return jobsSection(text).map((l) => JOB_LINE.exec(l)?.[1]).filter(Boolean);
}

export function jobBlock(text, id) {
  const lines = jobsSection(text);
  const start = lines.findIndex((l) => JOB_LINE.exec(l)?.[1] === id);
  if (start === -1) throw new Error(`no job "${id}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => JOB_LINE.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function unpinnedUses(text) {
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(l);
    if (!m) continue;
    const v = m[1];
    if (v.startsWith("./") || SHA_PIN.test(v) || DOCKER_PIN.test(v)) continue;
    out.push(v);
  }
  return out;
}

export function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === `${key}:`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => TOP_LEVEL.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter(Boolean);
}

export function requiredChecksFromDoc(md) {
  const begin = md.indexOf("<!-- required-checks:begin -->");
  const end = md.indexOf("<!-- required-checks:end -->");
  if (begin === -1 || end === -1 || end < begin) throw new Error("required-checks markers missing");
  const ids = md.slice(begin, end).split(/\r?\n/).map((l) => /^- `([a-z0-9-]+)`/.exec(l)?.[1]).filter(Boolean);
  if (ids.length === 0) throw new Error("required-checks block is empty");
  return ids;
}

/** Every `run:` value containing a pipe whose list item (step) does not declare `shell: bash`. */
export function pipedRunsWithoutBash(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let step = [];
  const flush = () => {
    const runIdx = step.findIndex((l) => /^\s*(?:-\s*)?run:/.test(l));
    if (runIdx !== -1) {
      const indent = step[runIdx].search(/\S/);
      const body = [step[runIdx].replace(/^\s*(?:-\s*)?run:\s*\|?\s*/, "")];
      for (const l of step.slice(runIdx + 1)) {
        if (l.trim() === "" || l.search(/\S/) > indent) body.push(l.trim());
        else break;
      }
      const cmd = body.filter(Boolean);
      const hasBash = step.some((l) => /^\s*(?:-\s*)?shell:\s*bash\s*$/.test(l));
      if (cmd.some((c) => /(^|[^|])\|([^|]|$)/.test(c)) && !hasBash) out.push(cmd[0]);
    }
    step = [];
  };
  for (const l of lines) {
    // Steps are list items at exactly six spaces in this layout; a job or top-level key also ends one.
    if (STEP_START.test(l) || TOP_LEVEL.test(l) || JOB_LINE.test(l)) flush();
    step.push(l);
  }
  flush();
  return out;
}
```

★ The `(^|[^|])\|([^|]|$)` test matches a single pipe and ignores `||`, which is a fallback, not a
pipe; `run: |` (a block scalar) is stripped before the body is scanned.

- [ ] **Step 5: Run the lib tests to verify they pass.**

Run: `npx vitest run scripts/ci-workflow.test.mjs --reporter=dot > "$SP/t3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/t3.log"`
Expected: EXIT=0.

- [ ] **Step 6: Add the failing assertions over the real files.** Append to `scripts/ci-workflow.test.mjs`:

```js
const CI = read(".github/workflows/ci.yml");
const SCHEDULED_PATH = ".github/workflows/scheduled.yml";
const REQUIRED = requiredChecksFromDoc(read("docs/AGENTS/ci.md"));
const lock = JSON.parse(read("package-lock.json"));
const pkg = JSON.parse(read("package.json"));
const PLAYWRIGHT = lock.packages["node_modules/@playwright/test"].version;
const NODE_MAJOR = /^>=(\d+)/.exec(pkg.engines.node)[1];

function workflowRules(name, text) {
  it(`${name}: every uses: is pinned`, () => expect(unpinnedUses(text)).toEqual([]));
  it(`${name}: top-level permissions are contents: read only`, () =>
    expect(topLevelBlock(text, "permissions")).toEqual(["contents: read"]));
  it(`${name}: every job has a timeout-minutes`, () => {
    for (const id of jobIds(text)) expect(jobBlock(text, id), id).toMatch(/^ {4}timeout-minutes: \d+/m);
  });
  it(`${name}: every checkout drops its credentials`, () => {
    const checkouts = text.split(/\r?\n/).filter((l) => /uses: actions\/checkout@/.test(l)).length;
    expect(checkouts).toBeGreaterThan(0);
    expect(text.match(/persist-credentials: false/g)?.length ?? 0).toBe(checkouts);
  });
  it(`${name}: every piped run: declares shell: bash`, () => expect(pipedRunsWithoutBash(text)).toEqual([]));
  it(`${name}: node version equals the engines floor`, () => {
    const versions = [...text.matchAll(/node-version: "(\d+)"/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([NODE_MAJOR]));
  });
  it(`${name}: every playwright image matches @playwright/test in the lockfile`, () => {
    for (const m of text.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/g)) expect(m[1]).toBe(PLAYWRIGHT);
  });
}

describe("ci.yml", () => {
  workflowRules("ci.yml", CI);

  it("has exactly the required checks as jobs (docs/AGENTS/ci.md is the list)", () => {
    expect(jobIds(CI).sort()).toEqual([...REQUIRED].sort());
    expect(REQUIRED).toHaveLength(8);
  });

  it("has a job for every gate group, running that group", () => {
    for (const g of GATE_GROUPS) expect(jobIds(CI)).toContain(g);
    expect(jobBlock(CI, "static")).toMatch(/node scripts\/gate-local\.mjs --group static --keep-going/);
    for (const g of ["unit", "unit-shuffled", "build"]) {
      for (const st of GATE_STEPS.filter((x) => x.group === g)) {
        expect(jobBlock(CI, g), g).toContain(`npm run ${st.argv[2]}`);
      }
    }
  });

  it("chains unit-shuffled behind unit, and e2e and prod-smoke behind build", () => {
    expect(jobBlock(CI, "unit-shuffled")).toMatch(/^ {4}needs: unit$/m);
    expect(jobBlock(CI, "e2e")).toMatch(/^ {4}needs: build$/m);
    expect(jobBlock(CI, "prod-smoke")).toMatch(/^ {4}needs: build$/m);
  });

  it("exports LEAK_LIST_FILE from the secret before the static gates", () => {
    const b = jobBlock(CI, "static");
    expect(b).toMatch(/LEAK_LIST: \$\{\{ secrets\.LEAK_LIST \}\}/);
    expect(b.indexOf("LEAK_LIST_FILE=")).toBeGreaterThan(-1);
    expect(b.indexOf("LEAK_LIST_FILE=")).toBeLessThan(b.indexOf("--group static"));
  });

  it("uploads .next with hidden files included and the cache excluded", () => {
    const b = jobBlock(CI, "build");
    expect(b).toMatch(/include-hidden-files: true/);
    expect(b).toMatch(/!\.next\/cache/);
  });

  it("cancels superseded runs on pull requests only", () => {
    expect(topLevelBlock(CI, "concurrency")).toEqual([
      "group: ci-${{ github.ref }}",
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    ]);
  });

  it("grants security-events: write to semgrep and to no other job", () => {
    for (const id of jobIds(CI)) {
      expect(/security-events: write/.test(jobBlock(CI, id)), id).toBe(id === "semgrep");
    }
  });

  it("uploads SARIF to code scanning only on a public repository", () => {
    expect(jobBlock(CI, "semgrep")).toMatch(/if: \$\{\{ always\(\) && !github\.event\.repository\.private \}\}/);
  });
});
```

Run the suite; expected: EXIT=1, failing on the missing `ci.yml` / markers (ENOENT or "markers missing").

- [ ] **Step 7: Add the required-check block to `docs/AGENTS/ci.md`**, directly under the existing banner (Task 5 rewrites the rest of the file):

```markdown
## Required checks

The ruleset on `main` requires exactly these, and `scripts/ci-workflow.test.mjs` fails if this list
and the job ids in `.github/workflows/ci.yml` differ.

<!-- required-checks:begin -->
- `static` — every `static` step of `scripts/gate-local.mjs` (`--keep-going`), then actionlint
- `unit` — `npm run test:coverage`; the coverage floors are vitest's
- `unit-shuffled` — `npm run test:shuffle`, after `unit`
- `build` — `npm run build`; publishes `.next/` for prod-smoke
- `e2e` — `npm run e2e`, including the axe gate
- `prod-smoke` — `npm run e2e:smoke:prod` over the built `.next/`
- `semgrep` — ERROR-severity gate; full report as SARIF
- `audit` — `npm audit --omit=dev --audit-level=high`
<!-- required-checks:end -->
```

- [ ] **Step 8: Write `.github/workflows/ci.yml`.** Substitute each `<…-sha>`, `<…-version>` and `<…-digest>` from Step 1's output; nothing else in the file is a placeholder.

```yaml
# Required checks on every pull request and every push to main. The job ids ARE the required
# check names: docs/AGENTS/ci.md lists them and scripts/ci-workflow.test.mjs keeps the two equal.
# Design: docs/superpowers/specs/2026-09-23-github-actions-ci-design.md
name: ci

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  NEXT_TELEMETRY_DISABLED: "1"

jobs:
  static:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      # An empty or missing secret writes an empty list, and leaks:check exits 2 on it: red, never
      # a silent pass. Dependabot PRs read LEAK_LIST from Dependabot's own secret store.
      - name: Write the leak list
        env:
          LEAK_LIST: ${{ secrets.LEAK_LIST }}
        run: |
          printf '%s\n' "$LEAK_LIST" > "$RUNNER_TEMP/leak-list.txt"
          echo "LEAK_LIST_FILE=$RUNNER_TEMP/leak-list.txt" >> "$GITHUB_ENV"
      - name: Static gates (every step runs; each failure is listed in the summary)
        run: node scripts/gate-local.mjs --group static --keep-going
      - name: actionlint
        if: ${{ !cancelled() }}
        uses: docker://rhysd/actionlint@<actionlint-digest> # <actionlint-version>
        with:
          args: -color

  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - name: Unit tests with coverage floors
        shell: bash
        run: npm run test:coverage -- --reporter=default --reporter=junit --outputFile=junit.xml 2>&1 | tee unit.log
      - name: Summary
        if: ${{ always() }}
        shell: bash
        run: |
          { echo "### unit"; echo '```'; grep -E "All files" unit.log || echo "no coverage line (the run did not finish)"; echo '```'
            echo "Failing:"; echo '```'; grep -E "^ *(FAIL|×) " unit.log | head -50 || echo "none"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@<upload-artifact-sha> # <upload-artifact-version>
        if: ${{ always() }}
        with:
          name: unit-results
          path: |
            junit.xml
            coverage/
          retention-days: 7

  unit-shuffled:
    needs: unit
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run test:shuffle

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run build
      # .next is a hidden directory: without include-hidden-files the artifact is silently empty.
      - uses: actions/upload-artifact@<upload-artifact-sha> # <upload-artifact-version>
        with:
          name: next-build
          path: |
            .next/
            !.next/cache
          include-hidden-files: true
          retention-days: 1

  e2e:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 45
    # Keep this tag equal to @playwright/test in package-lock.json (ci-workflow.test.mjs checks).
    container:
      image: mcr.microsoft.com/playwright:v1.61.1-jammy
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@<upload-artifact-sha> # <upload-artifact-version>
        if: ${{ failure() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

  prod-smoke:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    container:
      image: mcr.microsoft.com/playwright:v1.61.1-jammy
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@<download-artifact-sha> # <download-artifact-version>
        with:
          name: next-build
          path: .next
      - run: npx playwright install chromium
      - run: npm run e2e:smoke:prod

  semgrep:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      security-events: write
    container:
      image: semgrep/semgrep@<semgrep-digest>
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - name: Full report, every severity (never fails the job)
        run: semgrep scan --config p/typescript --config p/react --config p/owasp-top-ten --sarif --output semgrep.sarif .
      - name: Gate — ERROR severity only
        run: semgrep scan --config p/typescript --config p/react --config p/owasp-top-ten --severity ERROR --error .
      - uses: actions/upload-artifact@<upload-artifact-sha> # <upload-artifact-version>
        if: ${{ always() }}
        with:
          name: semgrep-sarif
          path: semgrep.sarif
          retention-days: 7
      # Code scanning refuses SARIF on a private repository without Advanced Security; this switches
      # itself on at the visibility flip.
      - uses: github/codeql-action/upload-sarif@<codeql-action-sha> # <codeql-action-version>
        if: ${{ always() && !github.event.repository.private }}
        with:
          sarif_file: semgrep.sarif

  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
      # Reads package-lock.json only; no install needed.
      - run: npm audit --omit=dev --audit-level=high
```

- [ ] **Step 9: Write `.github/dependabot.yml`.**

```yaml
# Keeps the SHA-pinned actions current. Container digests (semgrep, actionlint) are not covered by
# this ecosystem; re-resolve them by hand (see the plan's Task 3 Step 1 command).
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 10: Run the guard.** (`scheduled.yml` is not read yet; Task 4 adds its `describe`.)

Run: `npx vitest run scripts/ci-workflow.test.mjs scripts/gate-local.test.mjs --reporter=dot > "$SP/t3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/t3.log"`
Expected: EXIT=0, `Test Files  2 passed (2)`.

- [ ] **Step 11: Mutation check on the real-file assertions** (revert each; `git diff --stat` must show only intended changes after):
  - change one `@<checkout-sha>` to `@v5` → "every uses: is pinned" red;
  - delete the `- \`audit\`` line from ci.md → "exactly the required checks" red;
  - delete `shell: bash` from the unit test step → "every piped run" red;
  - delete `include-hidden-files: true` → the `.next` upload test red.

- [ ] **Step 12: Commit.**

```bash
git add scripts/ci-workflow-lib.mjs scripts/ci-workflow.test.mjs .github/workflows/ci.yml .github/dependabot.yml docs/AGENTS/ci.md
git commit -m "ci: GitHub Actions workflow for the eight required checks, with a textual guard"
```

---

### Task 4: `scheduled.yml`

**Files:**
- Create: `.github/workflows/scheduled.yml`
- Modify: `scripts/ci-workflow.test.mjs`

- [ ] **Step 1: Add the failing test.** Append to `scripts/ci-workflow.test.mjs`:

```js
describe("scheduled.yml", () => {
  const SCHED = read(SCHEDULED_PATH);
  workflowRules("scheduled.yml", SCHED);

  it("runs weekly and on demand, never on push or pull_request", () => {
    expect(SCHED).toMatch(/cron: "0 3 \* \* 1"/);
    expect(SCHED).toMatch(/^ {2}workflow_dispatch:/m);
    expect(SCHED).not.toMatch(/^ {2}(push|pull_request):/m);
  });

  it("has the three weekly jobs, none of them a required check", () => {
    expect(jobIds(SCHED)).toEqual(["audit-full", "unit-shuffled-random", "dast-zap"]);
    for (const id of jobIds(SCHED)) expect(REQUIRED).not.toContain(id);
  });

  it("echoes the random seed with its reproduce command before running", () => {
    const b = jobBlock(SCHED, "unit-shuffled-random");
    expect(b.indexOf("reproduce:")).toBeGreaterThan(-1);
    expect(b.indexOf("reproduce:")).toBeLessThan(b.indexOf("npm run test:run"));
    expect(b).toMatch(/--sequence\.seed=\$\{\{ github\.run_id \}\}/);
  });
});
```

Run it; expected EXIT=1 (ENOENT on `scheduled.yml`).

- [ ] **Step 2: Write `.github/workflows/scheduled.yml`** (substitute pins from Task 3 Step 1):

```yaml
# Weekly, non-blocking: nothing waits on these and none is a required check. A red run is the signal.
# Design: docs/superpowers/specs/2026-09-23-github-actions-ci-design.md
name: scheduled

on:
  schedule:
    - cron: "0 3 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit-full:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
      - run: npm audit --audit-level=low

  unit-shuffled-random:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - uses: actions/setup-node@<setup-node-sha> # <setup-node-version>
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: 'echo "shuffle seed=${{ github.run_id }}  (reproduce: npx vitest run --sequence.shuffle --sequence.seed=${{ github.run_id }})"'
      - run: npm run test:run -- --sequence.shuffle --sequence.seed=${{ github.run_id }} --reporter=dot

  # OWASP ZAP baseline against the running app. Hosted runners have Docker, so no dind service.
  # ★★ Never validated on any CI before this: its first manual dispatch is rollout Task 8.
  dast-zap:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@<checkout-sha> # <checkout-version>
        with:
          persist-credentials: false
      - run: docker build -t aipm-cockpit-dast -f Dockerfile.dast .
      - run: docker network create dastnet
      - run: docker run -d --name app --network dastnet aipm-cockpit-dast
      - name: Wait for the app
        run: |
          for i in $(seq 1 60); do
            if docker run --rm --network dastnet curlimages/curl -sf http://app:3000 >/dev/null 2>&1; then
              echo "app is up"; exit 0
            fi
            sleep 3
          done
          echo "app never answered on :3000"; exit 1
      # ZAP runs as its own non-root user; the report directory must be writable by it.
      # -I keeps ZAP's findings from failing the job; an infrastructure failure still does.
      - name: ZAP baseline
        run: |
          mkdir zap-out && chmod 777 zap-out
          docker run --rm --network dastnet -v "$PWD/zap-out:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
            zap-baseline.py -t http://app:3000 -I -r zap-report.html -J zap-report.json
      - uses: actions/upload-artifact@<upload-artifact-sha> # <upload-artifact-version>
        if: ${{ always() }}
        with:
          name: zap-report
          path: zap-out/
          retention-days: 7
```

★ `ghcr.io/zaproxy/zaproxy:stable` and `curlimages/curl` are `docker run` images, not `uses:`; they
float as they did in GitLab. Pinning them is a follow-up, not this plan.

- [ ] **Step 3: Run the guard.**

Run: `npx vitest run scripts/ci-workflow.test.mjs --reporter=dot > "$SP/t4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/t4.log"`
Expected: EXIT=0.

- [ ] **Step 4: Commit.**

```bash
git add .github/workflows/scheduled.yml scripts/ci-workflow.test.mjs
git commit -m "ci: weekly full audit, random-seed shuffle and ZAP baseline on GitHub Actions"
```

---

### Task 5: Docs for CI on Actions

**Files:**
- Modify: `AGENTS.md`, `docs/AGENTS/ci.md`, `CONTRIBUTING.md`, `docs/RUNBOOK.md`, `package.json` (`scriptsDescriptions["leaks:check"]`), `scripts/check-identifier-leaks.mjs` (header), `docs/superpowers/specs/2026-09-20-github-migration-roadmap.md`

- [ ] **Step 1: `AGENTS.md`.** Replace the whole hard-constraint bullet that begins `- **GitHub is canonical; CI is between homes.**` with:

```markdown
- **CI is GitHub Actions → [`docs/AGENTS/ci.md`](docs/AGENTS/ci.md).** `.github/workflows/ci.yml`
  runs on every pull request and every push to `main`; its eight job ids ARE the required checks on
  the `main` ruleset (`static` · `unit` · `unit-shuffled` · `build` · `e2e` · `prod-smoke` · `semgrep`
  · `audit`), and `scripts/ci-workflow.test.mjs` fails when the workflow, the gate list in
  `scripts/gate-local.mjs` and the list in `docs/AGENTS/ci.md` disagree. ★★ `gate-local.mjs` is the
  ONE gate list: a new blocking npm gate goes there with a group, never straight into the YAML.
  `npm run gate:local` is the pre-push check, no longer the merge gate. ★★ While the repository is
  private, Actions minutes come from GitHub Pro's allowance with a $0 budget; when they run out,
  checks cannot complete and merging needs the admin bypass on a `gate:local` PASS — see
  `docs/RUNBOOK.md`. Several gates split exit **1 = DRIFT** from exit **2 = could not scan**, and the
  two demand opposite responses. The GitLab project is a READ-ONLY copy synced daily by
  `ci/gitlab-sync.yml`; `.gitlab-ci.yml` stays in the tree only because a test reads it (until
  releases move, migration sub-project 5). No releases or tags until then. New CI gate → also update
  `docs/AGENTS/ci.md`.
```

Then grep for other stale statements and correct each:

```bash
git grep -n -E "merge gate until|until GitHub Actions|CI gap|no CI runs|NOT YET IN CI|run nowhere" -- AGENTS.md docs/AGENTS CONTRIBUTING.md docs/RUNBOOK.md README.md scripts package.json
```
Expected after the edits: hits only in dated records (specs, plans) — leave those, they are history.

- [ ] **Step 2: `docs/AGENTS/ci.md`.** Replace the banner and title with:

```markdown
# CI — GitHub Actions, job by job

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)
```
Keep the "Required checks" block from Task 3 immediately after it. Then add a `## Jobs` section with one paragraph per job from the spec's "Jobs" table and notes, a `## Weekly` section for `scheduled.yml`, a `## Operating it` section copying the spec's "Operating it" three bullets, and demote everything that was below the old title to a final section headed:

```markdown
## Legacy — the GitLab pipeline (no longer runs)

Kept for its per-gate reasoning, most of which still applies because the gates themselves did not
change. GitLab reads only `ci/gitlab-sync.yml`; `.gitlab-ci.yml` remains in the tree because
`release-publish-lib.test.mjs` reads it, until migration sub-project 5.
```

- [ ] **Step 3: `CONTRIBUTING.md`.** In its pull-request section, replace the gap-era process with: push → `gh pr create` → wait for the eight checks → `gh pr merge --merge --match-head-commit <sha>`; `npm run gate:local` before pushing is recommended, and required only for the minutes-exhausted fallback.

- [ ] **Step 4: `docs/RUNBOOK.md`.** Under common issues add two entries: **"A required check is red"** (open the job's step summary; `static` lists every failing step; exit 1 = drift, exit 2 = could not scan) and **"Actions minutes exhausted"** (the spec's fallback, verbatim: `gate:local` with `LEAK_LIST_FILE` set, admin-bypass merge, note the bypass and the PASS line in the PR).

- [ ] **Step 5: `leaks:check` wording.** In `package.json` replace the tail of `scriptsDescriptions["leaks:check"]` from `NOT YET IN CI` to the end with `Runs in CI's static job from the LEAK_LIST secret; locally set LEAK_LIST_FILE`. In `scripts/check-identifier-leaks.mjs` replace the two `★★ CI WIRING IS PENDING` comment lines with:

```js
// ★★ In CI the `static` job writes the LEAK_LIST secret to a temp file and exports LEAK_LIST_FILE;
// gate-local.mjs FAILS this step (code 2) under CI when the variable is unset, and skips it locally.
```
Then `npm run docs:scripts` (regenerates CONTRIBUTING's table).

- [ ] **Step 6: Roadmap.** In `docs/superpowers/specs/2026-09-20-github-migration-roadmap.md`, under "### 3. CI → GitHub Actions", add a status line: `**Status 2026-09-23:** designed (2026-09-23-github-actions-ci-design.md); in rollout.` Under "### 4. Issues, and the register contract", add:

```markdown
★★★ **Requirement from sub-project 3 (§200 closed there):** GitLab issue titles, bodies and comments
very likely carry internal hosts, the employer's name and work addresses, and imported issues become
public at the flip. The import must run the leak scan over the issue text and clean it BEFORE
import. Nothing else tracks this once §200 is closed.
```

- [ ] **Step 7: Gates.**

```bash
for g in docs:symbols:check docs:claims:check docs:scripts:check followups:status:check; do npm run $g > "$SP/g-$g.log" 2>&1; echo "$g EXIT=$?"; done
```
Expected: all EXIT=0. A `docs:symbols:check` failure names a backticked symbol that does not exist — fix the prose, never the allowlist.

- [ ] **Step 8: Commit.**

```bash
git add AGENTS.md docs/AGENTS/ci.md CONTRIBUTING.md docs/RUNBOOK.md package.json scripts/check-identifier-leaks.mjs docs/superpowers/specs/2026-09-20-github-migration-roadmap.md
git commit -m "docs: CI is GitHub Actions — AGENTS.md, ci.md, CONTRIBUTING, RUNBOOK, roadmap"
```

---

### Task 6: PR B — first run, measurement, merge

**Files:** possibly any of Task 3–5's files, to fix what the first run finds; the spec (measured numbers).

- [ ] **Step 1: Local gate** (export `LEAK_LIST_FILE` first): `npm run gate:local > "$SP/gl.log" 2>&1; echo "EXIT=$?"; tail -3 "$SP/gl.log"` → EXIT=0 and `gate:local PASS at <sha>`.
- [ ] **Step 2: Push and open PR B** (owner's say): `git push -u origin <branch>; gh pr create --fill`.
- [ ] **Step 3: Watch the run.** `gh run watch --exit-status; echo "EXIT=$?"`. If a job is red, diagnose from its log (`gh run view --log-failed`), fix on the branch and push; each fix is its own commit. Expected end state: all eight jobs green.
- [ ] **Step 4: Measure.**

```bash
run=$(gh run list --branch <branch> --workflow ci --limit 1 --json databaseId --jq '.[0].databaseId')
gh api "repos/sebastianmaute/aipm-cockpit/actions/runs/$run/jobs" --jq '.jobs[] | "\(.name) \(((.completed_at|fromdate)-(.started_at|fromdate))/60|ceil) min"'
gh api "repos/sebastianmaute/aipm-cockpit/actions/runs/$run/timing" --jq '.billable'
```
Record the per-job minutes and the billable total in the spec's "Measured facts" table (replace the ~45 min estimate, keep it as "GitLab, for comparison") and recompute "pipelines 3,000 minutes buys".

- [ ] **Step 5: Shard decision.** If `unit` took more than 25 minutes, stop and bring the number to the owner. Do not add sharding in this plan: the coverage floors would need merged reports, which the spec deliberately left out.
- [ ] **Step 6: Commit the measurement** (`docs: record the first GitHub Actions run's timings`), push, wait for green, merge with `gh pr merge --merge --match-head-commit <sha>`.
- [ ] **Step 7: The push-to-`main` run** goes green: `gh run list --branch main --workflow ci --limit 1` shows `completed success`.

---

### Task 7: Control PRs — every gate red against a planted defect

**Files:** a throwaway branch `chore/ci-control-plants`, never merged; a second one, `chore/ci-control-audit`.

- [ ] **Step 1: Add a canary to the leak list** (owner-held list, never the tree):

```bash
canary="zq$(node -e "console.log(require('crypto').randomUUID().slice(0,10).replace(/-/g,''))")"
printf '\n@control word:%s\n' "$canary" >> ~/.config/aipm-cockpit/leak-list.txt
gh secret set LEAK_LIST < ~/.config/aipm-cockpit/leak-list.txt
gh secret set LEAK_LIST --app dependabot < ~/.config/aipm-cockpit/leak-list.txt
echo "$canary" > "$SP/canary"
```
The canary is a random nonsense token, so planting it on a branch GitHub keeps forever discloses nothing. The token itself stays out of the tree, the plan, the PR text and the chat.

- [ ] **Step 2: Choose the semgrep plant by measurement, not guesswork.**

```bash
cat > "$SP/plant.ts" <<'EOF'
import { exec } from "node:child_process";
export function run(req: { query: { cmd: string } }) { exec(req.query.cmd); }
EOF
pipx run semgrep scan --config p/typescript --config p/react --config p/owasp-top-ten --severity ERROR --json "$SP/plant.ts" > "$SP/sg.json"; echo "EXIT=$?"
node -e "const r=require(process.argv[1]);console.log(r.results.length, r.results.map(x=>x.check_id).join(' '))" "$SP/sg.json"
```
Expected: at least one ERROR result. If zero, try a different sink (`eval(req.query.cmd)`, `new Function(req.query.cmd)`) and re-run until one reports; record which.

- [ ] **Step 3: Build the control branch** from current `main`, one commit per plant:
  1. **leak:** `docs/ci-control-plant.md` containing the line `control plant: <canary>` (from `$SP/canary`);
  2. **lint:** add `src/app/ci-control-lint.ts` with `export const x = 1; const unused = 2;` (fatal `no-unused-vars` under `--max-warnings=0`);
  3. **unit:** `src/app/ci-control.test.ts` with `import { it, expect } from "vitest"; it("control plant", () => expect(1).toBe(2));`
  4. **a11y:** in `src/app/tasks-section.tsx`, directly before `<PaneSearchInput`, add `<input type="text" />` with no label, `title` or `aria-label`. (Removing the search input's own `ariaLabel` would NOT work: its `title` still names it, and an empty `aria-label` falls back rather than blanks.) axe must report the `label` rule on "Open Points";
  5. **semgrep:** `src/app/ci-control-semgrep.ts` = the Step 2 file that reported;
  6. **prod-only CSP:** in `src/app/layout.tsx`, inside `<head>`, add `<style>{"body{}"}</style>` with no nonce. Dev's CSP allows it (so `e2e` is not what goes red for it); prod's nonce-only `style-src-elem` blocks it and the smoke fails on the console error.
- [ ] **Step 4: Push and open it as a draft PR** titled `ci control plants — DO NOT MERGE`, with no mention of the canary. `gh run watch; gh run view --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'`.
Expected: `static` failure, with the step summary listing **both** `npm run lint` and `npm run leaks:check` as FAIL (proves `--keep-going`), and `leaks:check` exit 1 (not 2) · `unit` failure · `unit-shuffled` skipped (needs `unit`) · `e2e` failure on an axe violation for Open Points · `semgrep` failure on the chosen rule · `prod-smoke` failure on a CSP console error · `build` success · `audit` success. Record each job's failing line in the spec's rollout section.
- [ ] **Step 5: Audit control.** A second draft PR from `main`: `npm install --save --package-lock-only lodash@4.17.20` (a known high-severity advisory). Expected: `audit` failure naming the advisory. If `npm audit` rates it below high by then, pick another package from `npm audit` history with a high advisory and record which.
- [ ] **Step 6: State the `unit-shuffled` limit** in the spec's rollout section: no cheap plant; its only evidence is that it runs `npm run test:shuffle`, the command `npm run test:shuffle` runs locally. Claim no more.

---

### Task 8: Required checks, and proof they bite

- [ ] **Step 1: Add the required checks to the ruleset** (owner, or `gh api` with a Pro account). Settings → Rules → `main` → Require status checks to pass: add `static`, `unit`, `unit-shuffled`, `build`, `e2e`, `prod-smoke`, `semgrep`, `audit`; "Require branches to be up to date" **off**.
- [ ] **Step 2: Verify.**

```bash
gh api repos/sebastianmaute/aipm-cockpit/rules/branches/main --jq '.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context' | sort
```
Expected: exactly the eight names.

- [ ] **Step 3: Prove it bites.** On the red control PR: `gh pr ready <n>; gh pr merge <n> --merge; echo "EXIT=$?"` → nonzero, with a message that required status checks have not passed. Record it. **Do not** use the admin bypass here.
- [ ] **Step 4: Close both control PRs and delete their branches:** `gh pr close <n> --delete-branch` for each. Remove the canary line from the local list only if the owner wants; leaving it is harmless.
- [ ] **Step 5: Dispatch `scheduled.yml` once:** `gh workflow run scheduled; gh run watch --exit-status`. Expected: `audit-full` and `unit-shuffled-random` complete (a red `audit-full` is a finding to report, not a plan failure); `dast-zap` completes, and `gh run download <id> -n zap-report` yields `zap-report.html` and `zap-report.json` that open and list scanned URLs from the app. If `dast-zap` fails for infrastructure reasons, fix it on a branch through a normal PR; its first-ever validation is this step.

---

### Task 9: Record the rollout in the spec

- [ ] **Step 1:** In the spec, under "Rollout", append a dated "Executed" block: the first run's timings (Task 6), each control job's failing line (Task 7), the merge-refusal message (Task 8 Step 3), and the scheduled run's result (Task 8 Step 5).
- [ ] **Step 2:** Commit (`docs: record the Actions rollout evidence`); this and Task 10 ship together as PR C.

---

### Task 10: Close §200

**Files:**
- Modify: `.gitlab-ci.yml` (two comments)
- Modify: `docs/open-followups.md` (§200 and its index row)

- [ ] **Step 1: Scrub the two project-number mentions.**

```bash
git grep -n -E " (GitLab)| (GitLab)" -- .gitlab-ci.yml
```
Expected before: two hits. In the first, `the OPEN issues in  (GitLab)` → `the OPEN issues in the GitLab project`; in the second, ` (GitLab)'s` → `The project's`. Re-run: expected no output (exit 1). Then `npx vitest run scripts/release-publish-lib.test.mjs --reporter=dot` → green (it reads this file).

- [ ] **Step 2: History proof against what GitHub serves.**

```bash
CFG=~/.config/aipm-cockpit/cutover
rm -rf "$SP/gh-mirror.git" "$SP/orig.git"
git clone --mirror https://github.com/sebastianmaute/aipm-cockpit.git "$SP/gh-mirror.git"
LEAK_LIST_FILE=~/.config/aipm-cockpit/leak-list.txt node scripts/verify-rewrite.mjs --repo "$SP/gh-mirror.git" --allow "$CFG/allow.txt" --expect clean; echo "clean EXIT=$?"
git clone --mirror "$CFG/original.bundle" "$SP/orig.git"
LEAK_LIST_FILE=~/.config/aipm-cockpit/leak-list.txt node scripts/verify-rewrite.mjs --repo "$SP/orig.git" --expect dirty; echo "dirty EXIT=$?"
```
Expected: `clean EXIT=0` (PASS; zero blob, message and trailer hits; the identity set equals the allowlist) and `dirty EXIT=0` (PASS with **nonzero** counts). ★ The GitHub mirror now also holds the control PRs' refs (`refs/pull/*`); the canary line in the list makes the clean run report a `control` class hit there. If it does, re-run the clean check with the canary line removed from a copy of the list, and record both runs: the first as proof the scan reads PR refs (a positive control for free), the second as the clean result.

- [ ] **Step 3: Close the entry.** Mark §200's heading `— CLOSED 2026-09-23` (the register's closed-heading form), replace its `**Status:**` line with one citing the two commands above and their results, **delete** its `**Work item:** #185` line, and add a closure paragraph stating:
  - the leak gate runs in CI (`static`), proven red by the control PR;
  - the history GitHub serves verifies clean, with the original bundle as the dirty control;
  - the last two project-number mentions were scrubbed;
  - the gate's known blind spot: it scans file content, never file **names**;
  - the sub-project 4 requirement (leak-scan the issue text before import), and where it is written (the roadmap's SP4 section).
  Update its index row to the closed form.
- [ ] **Step 4: Gates.**

```bash
for g in followups:index:check followups:status:check followups:workitems:check docs:claims:check; do npm run $g > "$SP/c-$g.log" 2>&1; echo "$g EXIT=$?"; done
LEAK_LIST_FILE=~/.config/aipm-cockpit/leak-list.txt npm run leaks:check; echo "leaks EXIT=$?"
```
Expected: all EXIT=0.

- [ ] **Step 5: Commit, then PR C** (owner's say): `git commit -m "docs: close §200 — leak gate in CI, history verified on GitHub"`. The PR description carries `Closes GitLab #185` in prose (GitHub cannot close a GitLab issue). Merge on green checks.
- [ ] **Step 6: Close GitLab #185** after the merge: `glab issue close 185` and `glab issue note 185 -m "Closed by §200's closure, merged to main on GitHub."` Verify: `glab issue view 185 --output json | node -e "…state"` prints `closed`.

---

### Task 11: Minutes check (one week after Task 8)

- [ ] **Step 1:**

```bash
gh api /users/sebastianmaute/settings/billing/usage --jq '.usageItems[] | select(.product=="actions") | "\(.date) \(.quantity) \(.unitType)"' | tail -14
```
If the endpoint answers 404 on this account, read the same figure from Settings → Billing → Usage and record where it came from.

- [ ] **Step 2:** Record the week's minutes, the number of `ci` runs (`gh run list --workflow ci --created ">=<date>" --limit 200 --json databaseId --jq length`), and the projected month against 3,000 in the spec's "Measured facts". If the projection exceeds 3,000, bring it to the owner. Do not change the pipeline shape in this plan.
