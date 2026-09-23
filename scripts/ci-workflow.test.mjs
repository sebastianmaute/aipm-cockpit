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

const SCHEDULED_PATH = ".github/workflows/scheduled.yml";

const CI = read(".github/workflows/ci.yml");
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

  it("scans the event's commit messages in static, over a full-history checkout, after the gates", () => {
    const b = jobBlock(CI, "static");
    expect(b).toMatch(/^ {6}- uses: actions\/checkout@\S+.*\n {8}with:\n {10}fetch-depth: 0$/m);
    const scan = b.indexOf("node scripts/check-commit-message-leaks.mjs");
    expect(scan).toBeGreaterThan(b.indexOf("--group static"));
    const stepStart = b.lastIndexOf("- name: Commit-message leak scan", scan);
    expect(stepStart).toBeGreaterThan(-1);
    const step = b.slice(stepStart, scan);
    // It still runs when the gate step is red.
    expect(step).toMatch(/^ {8}if: \$\{\{ !cancelled\(\) \}\}$/m);
    // Event values reach the script through env:, never a ${{ }} inside run:.
    expect(step).toMatch(/PR_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    expect(step).toMatch(/PUSH_BEFORE: \$\{\{ github\.event\.before \}\}/);
    const run = b.lastIndexOf("run: |", scan);
    expect(run).toBeGreaterThan(stepStart);
    expect(b.slice(run, scan)).not.toMatch(/\$\{\{/);
    // A pull request starts at the merge-base with the fetched base branch, not the payload's
    // (possibly stale) base.sha, and a failed merge-base is exit 2, never a silent skip.
    expect(step).toMatch(/git merge-base "\$PR_HEAD" "refs\/remotes\/origin\/\$GITHUB_BASE_REF"\) \|\| \{/);
    expect(step).toMatch(/exit 2; \}/);
    expect(step).not.toMatch(/base\.sha/);
    // An all-zeros `before` (a new branch) falls through to the head commit alone.
    expect(step).toMatch(/\[ -n "\$\{PUSH_BEFORE\/\/0\/\}" \]/);
    expect(step).toMatch(/RANGE="\$HEAD_SHA\^!"/);
  });

  it("uploads .next with hidden files included and the cache excluded", () => {
    const b = jobBlock(CI, "build");
    expect(b).toMatch(/include-hidden-files: true/);
    expect(b).toMatch(/!\.next\/cache/);
  });

  // Push runs are keyed by commit: a shared group keeps only one pending run, so a queued main run
  // would be replaced by the next merge even with cancel-in-progress off.
  it("cancels superseded runs on pull requests only, and never replaces a queued main run", () => {
    expect(topLevelBlock(CI, "concurrency")).toEqual([
      "group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
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
