// @vitest-environment node
//
// Mostly a textual guard over .github/workflows/*.yml: the helpers read the fixed two-space layout
// these files are written in, and their own tests below pin what they accept and reject. The release
// sign path's app-tree checks are asserted on PARSED YAML instead (js-yaml, which only
// desktop/node_modules holds -- see parsedRelease). actionlint (in the static job) is the
// structural check; this file pins the repository-specific rules actionlint cannot know.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_GROUPS, GATE_STEPS } from "./gate-local.mjs";
import { globalTimeoutFrom, MAX_GLOBAL_TIMEOUT_MS } from "../e2e/global-timeout.ts";
import {
  jobIds, jobBlock, unpinnedUses, topLevelBlock, requiredChecksFromDoc, pipedRunsWithoutBash,
} from "./ci-workflow-lib.mjs";
import { INSTALLER_DIR, installerName, expectedAssets, sbomName } from "./release-publish-lib.mjs";
import { PUBLISHER } from "./release-update-feed.mjs";

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
const RELEASE = read(".github/workflows/release.yml");
// release.yml parsed. js-yaml is electron-builder's dependency, so only desktop/node_modules has it
// (the root copy is nested under date-holidays and not ours to lean on); CI's unit jobs install the
// desktop packages. Loaded on first use, so a root-only run fails just the parsed tests -- loudly,
// never by skipping them.
let releaseDoc = null;
const parsedRelease = () => {
  if (releaseDoc) return releaseDoc;
  let yaml;
  try {
    yaml = createRequire(new URL("../desktop/package.json", import.meta.url))("js-yaml");
  } catch {
    throw new Error("js-yaml not found: run `npm --prefix desktop ci --ignore-scripts` first");
  }
  releaseDoc = yaml.load(RELEASE);
  return releaseDoc;
};
const releaseSteps = (job) => parsedRelease().jobs[job].steps;
const releaseStep = (job, name) => {
  const hits = releaseSteps(job).filter((s) => s.name === name);
  expect(hits, `${job}: ${name}`).toHaveLength(1);
  return hits[0];
};
const releaseStepIndex = (job, name) => releaseSteps(job).indexOf(releaseStep(job, name));
// A job that can read a secret: it names an environment (whose secrets its steps can be handed) or
// references one. The SignPath token must never share a job with build code, so such a job may use
// only these pinned actions and run no package manager, node, or build tool at all.
const TOKEN_JOB_ACTIONS = /^(?:actions\/(?:checkout|setup-node|upload-artifact|download-artifact)|signpath\/github-action-submit-signing-request)@[0-9a-f]{40}$/;
const BUILD_CODE = /\b(?:npm|npx|pnpm|yarn|node|bun|deno|electron-builder)\b/;
const tokenJobs = (doc) => Object.entries(doc.jobs)
  .filter(([, j]) => j.environment !== undefined || /\bsecrets\./.test(JSON.stringify(j))).map(([id]) => id);
const tokenJobViolations = (doc) => tokenJobs(doc).flatMap((id) => (doc.jobs[id].steps ?? []).flatMap((s, i) => {
  const label = `${id}: ${s.name ?? s.uses ?? `step ${i + 1}`}`;
  const out = [];
  if (s.uses !== undefined && !TOKEN_JOB_ACTIONS.test(s.uses)) out.push(`${label}: uses ${s.uses}`);
  if (s.run !== undefined && BUILD_CODE.test(s.run)) out.push(`${label}: runs ${s.run.trim().split("\n")[0]}`);
  return out;
}));
const REQUIRED = requiredChecksFromDoc(read("docs/AGENTS/ci.md"));
const lock = JSON.parse(read("package-lock.json"));
const pkg = JSON.parse(read("package.json"));
const PLAYWRIGHT = lock.packages["node_modules/@playwright/test"].version;
const NODE_MAJOR = /^>=(\d+)/.exec(pkg.engines.node)[1];

// `node: false` for a workflow that installs nothing (the security workflows): it has no node-version to check.
function workflowRules(name, text, { node = true } = {}) {
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
  if (node) it(`${name}: node version equals the engines floor`, () => {
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
    expect(REQUIRED).toHaveLength(9);
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

  // §527: changelog:check reads the PR's labels live, which needs the job's token and the
  // pull-requests read scope. The token is read-only, and nothing in the job writes.
  it("lets the static gates read pull-request labels, and nothing more", () => {
    const b = jobBlock(CI, "static");
    expect(b).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n/m);
    expect(b).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
    expect(b).not.toMatch(/: write/);
  });

  it("chains unit-shuffled behind unit, and e2e and prod-smoke behind build", () => {
    expect(jobBlock(CI, "unit-shuffled")).toMatch(/^ {4}needs: unit$/m);
    expect(jobBlock(CI, "e2e")).toMatch(/^ {4}needs: build$/m);
    expect(jobBlock(CI, "prod-smoke")).toMatch(/^ {4}needs: build$/m);
  });

  // desktop/**/*.test.ts (vitest's own include — see vitest.config.ts) imports
  // electron/electron-updater, and static's desktop:typecheck needs their types too; none of the
  // three jobs installs desktop/node_modules on its own (npm ci at the root does not reach it).
  // Missing this step is exactly PR #400's build-job failure, one layer down: it passed there only
  // because next build's tsc program excludes the two updater test files, but vitest's include does
  // not and cannot — mocking `electron`/`electron-updater` doesn't help, since Vite resolves the
  // import specifier before a mock ever applies.
  it("installs desktop deps (--ignore-scripts, no binary needed) before every job touching desktop/", () => {
    const DESKTOP_INSTALL = /^ {6}- run: npm --prefix desktop ci --ignore-scripts$/m;
    for (const g of ["static", "unit", "unit-shuffled"]) {
      const b = jobBlock(CI, g);
      expect(b, g).toMatch(DESKTOP_INSTALL);
      expect(b.search(DESKTOP_INSTALL), g).toBeGreaterThan(b.indexOf("- run: npm ci"));
    }
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

  // Every pull request proves the SBOM scan on real Next output, in a job of its own beside build:
  // a standalone build with the source maps release:sbom reads, then the web-only check. Nothing
  // waits for it, it uploads nothing, and build's artifact never carries maps.
  it("checks the SBOM scan in its own job on a mapped standalone build, needing nothing and uploading nothing", () => {
    const b = jobBlock(CI, "sbom");
    expect(b).not.toMatch(/^ {4}needs:/m);
    expect(b).toMatch(/^ {4}timeout-minutes: \d+$/m);
    expect(b).not.toMatch(/upload-artifact/);
    const lines = b.split(/\r?\n/);
    const at = (re) => lines.findIndex((l) => re.test(l));
    const order = [
      at(/^ {6}- run: npm ci$/),
      at(/^ {6}- name: Standalone build with source maps for the SBOM check$/),
      at(/^ {6}- run: npm --prefix desktop ci --ignore-scripts$/),
      at(/^ {8}run: npm run release:sbom -- --build \.next --standalone \.next\/standalone --desktop desktop --web-only$/),
    ];
    expect(order.every((i) => i > -1), "every step is present").toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    const step = lines.slice(order[1], order[2]).join("\n");
    expect(step).toMatch(/NEXT_STANDALONE: "1"/);
    expect(step).toMatch(/SBOM_SOURCE_MAPS: "1"/);
    expect(step).toMatch(/run: npm run build$/m);
    // No job waits for it, and build carries no maps and no SBOM step.
    for (const id of jobIds(CI)) expect(jobBlock(CI, id), id).not.toMatch(/^ {4}needs:.*\bsbom\b/m);
    // (Comment lines dropped: the next job's leading comment sits inside build's block.)
    expect(code(jobBlock(CI, "build"))).not.toMatch(/SBOM_SOURCE_MAPS|release:sbom/);
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

  it("uploads SARIF to code scanning only on a public repository, and never from a fork's pull request", () => {
    expect(jobBlock(CI, "semgrep")).toMatch(/if: \$\{\{ always\(\) && !github\.event\.repository\.private && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\) \}\}/);
  });

  // §613: the registry configs (p/typescript, p/react, p/owasp-top-ten) miss request-controlled
  // eval/Function/exec sinks. The local rule file closes that gap and must ride BOTH semgrep
  // steps — the full-report scan and the blocking ERROR-severity gate — or it silently stops
  // covering the report/gate one of them produces.
  it("passes the local injection rule file to both semgrep scans", () => {
    const runs = [...jobBlock(CI, "semgrep").matchAll(/run: semgrep scan[^\n]*/g)].map((m) => m[0]);
    expect(runs.length).toBe(2);
    for (const run of runs) expect(run).toMatch(/--config \.semgrep\/injection\.yml/);
  });

  // §613: passing --config on both steps is not enough on its own — a rule downgraded to WARNING
  // would still ride both scans and never trip `--severity ERROR --error`. Pin the severity itself,
  // not just that the file is wired in. Mutation-checked: flipping `severity: ERROR` to `WARNING`
  // in .semgrep/injection.yml turns this RED (reverted after the check).
  it("every rule in the local injection config is severity ERROR", () => {
    const rule = read(".semgrep/injection.yml");
    const severities = [...rule.matchAll(/^\s*severity:\s*(\S+)/gm)].map((m) => m[1]);
    expect(severities.length).toBeGreaterThan(0);
    for (const s of severities) expect(s).toBe("ERROR");
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

  it("has the four weekly jobs, none of them a required check", () => {
    expect(jobIds(SCHED)).toEqual(["audit-full", "unit-shuffled-random", "dast-zap", "register-sync"]);
    for (const id of jobIds(SCHED)) expect(REQUIRED).not.toContain(id);
  });

  it("register-sync tolerates its own failure and is dormant until the flip", () => {
    const b = jobBlock(SCHED, "register-sync");
    expect(b).toMatch(/^ {4}continue-on-error: true$/m);
    expect(b).toMatch(/REGISTER_TRACKER: \$\{\{ vars\.REGISTER_TRACKER \}\}/);
    expect(b).toMatch(/GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    expect(b).toMatch(/run: node scripts\/check-followup-github\.mjs/);
  });

  it("echoes the random seed with its reproduce command before running", () => {
    const b = jobBlock(SCHED, "unit-shuffled-random");
    expect(b.indexOf("reproduce:")).toBeGreaterThan(-1);
    expect(b.indexOf("reproduce:")).toBeLessThan(b.indexOf("npm run test:run"));
    expect(b).toMatch(/--sequence\.seed=\$\{\{ github\.run_id \}\}/);
  });

  // Same gap as ci.yml's unit/unit-shuffled: test:run's include covers desktop/**/*.test.ts, which
  // imports electron/electron-updater, so this job needs the desktop packages too.
  it("installs desktop deps before running test:run", () => {
    const b = jobBlock(SCHED, "unit-shuffled-random");
    expect(b).toMatch(/^ {6}- run: npm --prefix desktop ci --ignore-scripts$/m);
    expect(b.indexOf("- run: npm --prefix desktop ci")).toBeGreaterThan(b.indexOf("- run: npm ci"));
    expect(b.indexOf("- run: npm --prefix desktop ci")).toBeLessThan(b.indexOf("npm run test:run"));
  });
});

describe("scorecard.yml", () => {
  const SCORE = read(".github/workflows/scorecard.yml");
  workflowRules("scorecard.yml", SCORE, { node: false });

  // scorecard-action refuses to publish from a workflow that does more than this.
  it("has the one scorecard job, writing only security events and the OIDC token", () => {
    expect(jobIds(SCORE)).toEqual(["scorecard"]);
    const b = jobBlock(SCORE, "scorecard");
    expect(b).toMatch(/security-events: write/);
    expect(b).toMatch(/id-token: write/);
    expect(b.match(/: write/g)).toHaveLength(2);
    expect(b).not.toMatch(/^ {4}(env|container|services):/m);
    expect(REQUIRED).not.toContain("scorecard");
  });

  // An extra step (a run:, a hardening action) or a top-level env/defaults stops the publish
  // silently: the workflow stays green and scorecard.dev stops updating.
  it("runs only checkout, scorecard and upload-sarif, with no run: step and no top-level env or defaults", () => {
    const uses = [...jobBlock(SCORE, "scorecard").matchAll(/uses: ([^@\s]+)@/g)].map((m) => m[1]);
    expect(uses).toEqual(["actions/checkout", "ossf/scorecard-action", "github/codeql-action/upload-sarif"]);
    expect(SCORE).not.toMatch(/^\s*(- )?run:/m);
    expect(SCORE).not.toMatch(/^(env|defaults):/m);
  });
});

describe("security.yml", () => {
  const SEC = read(".github/workflows/security.yml");
  workflowRules("security.yml", SEC, { node: false });

  it("runs dependency-review on pull requests only and zizmor at a pinned version; neither is required", () => {
    expect(jobIds(SEC)).toEqual(["dependency-review", "zizmor"]);
    expect(jobBlock(SEC, "dependency-review")).toMatch(/^ {4}if: github\.event_name == 'pull_request'$/m);
    expect(jobBlock(SEC, "dependency-review")).not.toMatch(/: write/);
    expect(jobBlock(SEC, "zizmor")).toMatch(/version: \d+\.\d+\.\d+/);
    expect(SEC).toMatch(/^ {2}pull_request:\r?\n {4}branches: \[main\]\r?$/m);
    for (const id of jobIds(SEC)) expect(REQUIRED).not.toContain(id);
  });

  // A fork's pull request token cannot write security events, so a SARIF upload there fails the
  // job (ci.yml's semgrep carries the same guard on its upload step, pinned in its own describe).
  it("uploads zizmor's SARIF only from this repository, never from a fork's pull request", () => {
    expect(jobBlock(SEC, "zizmor")).toMatch(/advanced-security: \$\{\{ \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\) \}\}/);
  });
});

// §149: its own workflow, so a manual run costs only this suite.
describe("future-clock.yml", () => {
  const FUTURE = read(".github/workflows/future-clock.yml");
  workflowRules("future-clock.yml", FUTURE);

  it("runs weekly and on demand, never on push or pull_request, and is not a required check", () => {
    expect(FUTURE).toMatch(/cron: "0 4 \* \* 1"/);
    expect(FUTURE).toMatch(/^ {2}workflow_dispatch:/m);
    expect(FUTURE).not.toMatch(/^ {2}(push|pull_request):/m);
    expect(jobIds(FUTURE)).toEqual(["unit-future-clock"]);
    expect(REQUIRED).not.toContain("unit-future-clock");
  });

  // The clock offset only takes effect through this env var, read by vitest.setup.ts.
  it("runs the suite with the clock offset set and annotated failures, after installing desktop deps", () => {
    const b = jobBlock(FUTURE, "unit-future-clock");
    expect(b).toMatch(/VITEST_CLOCK_OFFSET_DAYS: "400"/);
    expect(b).toMatch(/--reporter=github-actions/);
    expect(b).toMatch(/^ {6}- run: npm --prefix desktop ci --ignore-scripts$/m);
    expect(b.indexOf("- run: npm --prefix desktop ci")).toBeLessThan(b.indexOf("npm run test:run"));
  });
});

describe("release.yml", () => {
  workflowRules("release.yml", RELEASE);

  it("runs on v* tags only", () => {
    // topLevelBlock returns the block's lines trimmed, blanks dropped.
    expect(topLevelBlock(RELEASE, "on")).toEqual(["push:", "tags:", '- "v*"']);
  });

  const JOBS = ["guard", "build", "sign-app", "repackage", "sign-installer", "finalize", "publish"];
  const job = (id) => parsedRelease().jobs[id];
  const needsOf = (id) => [job(id).needs ?? []].flat();
  const ancestors = (id) => {
    const seen = new Set();
    const walk = (j) => { for (const n of needsOf(j)) if (!seen.has(n)) { seen.add(n); walk(n); } };
    walk(id);
    return seen;
  };
  const ON_EXPR = "${{ vars.SIGNPATH_ENABLED == 'true' }}";
  const ON_APP_EXPR = "${{ vars.SIGNPATH_ENABLED == 'true' && vars.SIGNPATH_SIGN_APP_EXE == 'true' }}";

  it("has guard, build, sign-app, repackage, sign-installer, finalize, publish, chained in that order", () => {
    expect(jobIds(RELEASE)).toEqual(JOBS);
    expect(Object.fromEntries(JOBS.map((id) => [id, needsOf(id)]))).toEqual({
      guard: [],
      build: ["guard"],
      "sign-app": ["guard", "build"],
      repackage: ["guard", "build", "sign-app"],
      "sign-installer": ["guard", "sign-app", "repackage"],
      finalize: ["guard", "build", "sign-app", "repackage", "sign-installer"],
      publish: ["guard", "finalize"],
    });
  });

  it("reads by default, and only publish can write", () => {
    expect(topLevelBlock(RELEASE, "permissions")).toEqual(["contents: read"]);
    for (const id of ["guard", "build", "repackage", "finalize"]) expect(job(id).permissions, id).toBeUndefined();
    // SignPath's connector reads the run's jobs and downloads its artifacts with the job token.
    for (const id of ["sign-app", "sign-installer"]) expect(job(id).permissions, id).toEqual({ contents: "read", actions: "read" });
    for (const id of JOBS.filter((j) => j !== "publish")) expect(JSON.stringify(job(id).permissions ?? {}), id).not.toMatch(/write/);
    expect(job("publish").permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
  });

  // One approval per release: the required reviewer on `release` pauses `sign-app`, the first job
  // that can read the SignPath token. Every job after it needs it, so nothing that signs or
  // publishes starts before the approval, and no other job names `release`, so GitHub asks once.
  it("the owner approves once, at sign-app, before any token use and before publish", () => {
    expect(job("sign-app").environment).toBe("release");
    expect(job("sign-installer").environment).toBe("release-signing");
    for (const id of ["guard", "build", "repackage", "finalize", "publish"]) expect(job(id).environment, id).toBeUndefined();
    for (const id of ["repackage", "sign-installer", "finalize", "publish"]) expect(ancestors(id).has("sign-app"), id).toBe(true);
    expect(ancestors("sign-app")).toEqual(new Set(["guard", "build"]));
    const pub = jobBlock(RELEASE, "publish");
    expect(pub).not.toMatch(/npm (ci|install|i )|npx /);
    expect(pub).toMatch(/npm run release:verify -- /);
    expect(pub).toMatch(/npm run release:publish -- /);
  });

  // Each `if:` evaluated as GitHub would for the case at hand: `!cancelled()` true (a cancelled
  // run is not a case here), vars and needs results substituted, == and != as string compares.
  const evalIf = (expr, { vars = {}, results = {} }) => {
    const js = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replace(/!cancelled\(\)/g, "true")
      .replace(/needs\.([\w-]+)\.result/g, (_, n) => JSON.stringify(results[n] ?? "missing"))
      .replace(/vars\.(\w+)/g, (_, n) => JSON.stringify(vars[n] ?? ""))
      .replace(/([!=])=/g, "$1==");
    expect(js).not.toMatch(/[a-z_]\w*\./i);
    return new Function(`return (${js});`)();
  };

  it("the signing switch skips repackage and sign-installer, and finalize and publish still run (switch off: exactly as before)", () => {
    for (const id of ["guard", "build", "sign-app"]) expect(job(id).if, id).toBeUndefined();
    expect(job("repackage").if).toBe(ON_EXPR);
    expect(job("sign-installer").if).toBe(ON_EXPR);
    const ok = { guard: "success", build: "success", "sign-app": "success" };
    const off = { results: { ...ok, repackage: "skipped", "sign-installer": "skipped" } };
    const on = { vars: { SIGNPATH_ENABLED: "true" }, results: { ...ok, repackage: "success", "sign-installer": "success" } };
    const fin = job("finalize").if;
    expect(evalIf(fin, off)).toBe(true);
    expect(evalIf(fin, { ...off, vars: { SIGNPATH_ENABLED: "false" } })).toBe(true);
    expect(evalIf(fin, on)).toBe(true);
    // Signing on: finalize never runs over an unsigned or unrepackaged setup.
    for (const [n, r] of [["repackage", "failure"], ["repackage", "skipped"], ["sign-installer", "failure"], ["sign-installer", "skipped"], ["sign-installer", "cancelled"]]) {
      expect(evalIf(fin, { ...on, results: { ...on.results, [n]: r } }), `${n} ${r}`).toBe(false);
    }
    // Either way: no approval (or a failed build) means no finalize.
    for (const n of ["guard", "build", "sign-app"]) {
      for (const c of [off, on]) expect(evalIf(fin, { ...c, results: { ...c.results, [n]: "failure" } }), n).toBe(false);
      expect(evalIf(fin, { ...off, results: { ...off.results, [n]: "skipped" } }), n).toBe(false);
    }
    const pub = job("publish").if;
    expect(evalIf(pub, { results: { guard: "success", finalize: "success" } })).toBe(true);
    for (const r of ["failure", "skipped", "cancelled"]) expect(evalIf(pub, { results: { guard: "success", finalize: r } }), r).toBe(false);
  });

  it("publish verifies, attests and publishes the files finalize uploaded, not the build's", () => {
    const pub = jobBlock(RELEASE, "publish").replace(/\r\n/g, "\n");
    expect(pub).toMatch(/uses: actions\/download-artifact@[0-9a-f]{40} # v\S+\n {8}with:\n {10}name: release-final\n {10}path: \$\{\{ runner\.temp \}\}\/release$/m);
    expect(pub).not.toMatch(/name: release-files/);
    const fin = jobBlock(RELEASE, "finalize").replace(/\r\n/g, "\n");
    expect(fin).toMatch(/uses: actions\/download-artifact@[0-9a-f]{40} # v\S+\n {8}with:\n {10}name: release-files\n {10}path: \$\{\{ runner\.temp \}\}\/release$/m);
    expect(fin).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v\S+\n {8}with:\n {10}name: release-final\n {10}path: \$\{\{ runner\.temp \}\}\/release\/\*\n {10}if-no-files-found: error$/m);
    // Only finalize uploads the final files.
    const finals = JOBS.filter((id) => (job(id).steps ?? []).some((s) => s.with?.name === "release-final" && /upload-artifact@/.test(s.uses ?? "")));
    expect(finals).toEqual(["finalize"]);
  });

  it("attests only on a public repository", () => {
    expect(jobBlock(RELEASE, "publish")).toMatch(/if: \$\{\{ !github\.event\.repository\.private \}\}\n\s+uses: actions\/attest-build-provenance@/);
  });

  it("attests the SBOM against the installer, on a public repository only, after the files are verified", () => {
    const pub = jobBlock(RELEASE, "publish").replace(/\r\n/g, "\n");
    const DIR = "${{ runner.temp }}/release";
    const V = "${{ needs.guard.outputs.version }}";
    // actions/attest, not the deprecated actions/attest-sbom wrapper around it.
    const step = /^ {6}- name: Attest the SBOM\n {8}if: \$\{\{ !github\.event\.repository\.private \}\}\n {8}uses: actions\/attest@[0-9a-f]{40} # v\d+\.\d+\.\d+\n {8}with:\n {10}sbom-path: (.+)\n {10}subject-path: (.+)$/m.exec(pub);
    expect(step, "the SBOM attestation step, in this exact shape").not.toBeNull();
    expect(pub).not.toMatch(/attest-sbom@/);
    expect(step[1]).toBe(`${DIR}/${sbomName("9.9.9")}`.replace("9.9.9", V));
    expect(step[2]).toBe(`${DIR}/${installerName("9.9.9")}`.replace("9.9.9", V));
    expect(pub.indexOf("- name: Attest the SBOM")).toBeGreaterThan(pub.indexOf("npm run release:verify"));
    expect(pub.indexOf("- name: Attest the SBOM")).toBeLessThan(pub.indexOf("npm run release:publish"));
  });

  // The order the SBOM needs: maps for the pre-pass; the standalone copies gone BEFORE it, so both
  // passes see exactly the shipped tree; the build's own maps out after it and before anything is
  // copied or packed; the notices into the standalone public/ and (through extraFiles) the install
  // folder; then the final pass over the packed app.asar, then the guard over what was packed.
  it("builds with maps, writes the notices, strips the maps, packages, then writes the final SBOM", () => {
    const lines = jobBlock(RELEASE, "build").split(/\r?\n/);
    const at = (re) => lines.findIndex((l) => re.test(l));
    const order = [
      ["desktop install", at(/^ {6}- run: npm --prefix desktop ci$/)],
      ["mapped build", at(/^ {10}SBOM_SOURCE_MAPS: "1"$/)],
      ["delete standalone maps", at(/^ {8}run: npm run release:strip-maps -- --delete \.next\/standalone$/)],
      ["pre-pass", at(/^ {8}run: npm run release:sbom -- --build \.next --standalone \.next\/standalone --desktop desktop --out \.next\/sbom$/)],
      ["move build maps", at(/^ {8}run: npm run release:strip-maps -- --build \.next --keep sbom-maps$/)],
      ["copy-static", at(/^ {6}- run: npm run desktop:copy-static -- --notices \.next\/sbom\/THIRD-PARTY-NOTICES\.txt$/)],
      ["desktop build", at(/^ {6}- run: npm --prefix desktop run build$/)],
      ["package", at(/^ {6}- run: npm run desktop:package$/)],
      ["final pass", at(/^ {8}run: npm run release:sbom -- --build sbom-maps --standalone \.next\/standalone --desktop desktop --out desktop\/release --asar desktop\/release\/win-unpacked\/resources\/app\.asar$/)],
      ["map and notices guard", at(/^ {6}- name: The package ships the notices and no source map$/)],
      ["upload", at(/uses: actions\/upload-artifact@/)],
    ];
    for (const [name, i] of order) expect(i, name).toBeGreaterThan(-1);
    const indices = order.map(([, i]) => i);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    // The mapped build is the standalone one.
    const build = lines.slice(order[1][1] - 3, order[1][1] + 2).join("\n");
    expect(build).toMatch(/NEXT_STANDALONE: "1"/);
    expect(build).toMatch(/run: npm run build$/m);
    // The final pass writes where the upload reads.
    expect(lines[order[8][1]]).toContain(`--out ${INSTALLER_DIR} `);
  });

  it("fails the build on a source map anywhere in the packed resources, and on notices missing from either place", () => {
    const b = jobBlock(RELEASE, "build");
    expect(b).toMatch(/app=desktop\/release\/win-unpacked$/m);
    // Positive control: a moved tree must fail, not pass a walk over nothing.
    expect(b).toMatch(/test -f "\$app\/resources\/standalone\/server\.js"/);
    expect(b).toMatch(/find "\$app\/resources" -name '\*\.map' -print/);
    // find sees app.asar as one file, so its entries are listed too: the desktop shell's production
    // dependencies ship maps of their own. Counted into a variable (grep -c exits 1 on zero), with a
    // positive control on the archive's own package.json.
    expect(b).toMatch(/listing=\$\("\$asar" list "\$app\/resources\/app\.asar" \| tr -d '\\r'\) \|\| \{/);
    expect(b).toMatch(/root=\$\(grep -cE '\^\[\/\\\\\]package\\\.json\$' <<<"\$listing"\) \|\| true/);
    expect(b).toMatch(/\[ "\$root" = "1" \] \|\| \{/);
    expect(b).toMatch(/asarmaps=\$\(grep -cE '\\\.map\$' <<<"\$listing"\) \|\| true/);
    expect(b).toMatch(/\[ "\$asarmaps" = "0" \] \|\| \{/);
    expect(b).toMatch(/cmp desktop\/release\/THIRD-PARTY-NOTICES\.txt "\$app\/THIRD-PARTY-NOTICES\.txt"/);
    expect(b).toMatch(/cmp desktop\/release\/THIRD-PARTY-NOTICES\.txt "\$app\/resources\/standalone\/public\/third-party-notices\.txt"/);
  });

  // ★ A job that can read the SignPath token runs no npm-installed package and no repository
  // script: the actions a job uses sit in its writable work folder, so build code running there
  // (electron-builder, its dependency tree, the binaries it downloads, js-yaml) could rewrite the
  // SignPath action's files and capture the token.
  it("no job that can read the SignPath token runs npm, npx, node or any action outside the allowlist", () => {
    expect(tokenJobViolations(parsedRelease())).toEqual([]);
    // Positive control: the two token jobs are found as token jobs.
    expect(tokenJobs(parsedRelease())).toEqual(["sign-app", "sign-installer"]);
  });

  it("tokenJobViolations flags build code and unlisted actions in a token job, and nothing in a token-free one", () => {
    const pinned = (a) => `${a}@${SHA}`;
    const doc = {
      jobs: {
        clean: { environment: "release", steps: [{ run: "echo ok" }, { uses: pinned("signpath/github-action-submit-signing-request"), with: { "api-token": "${{ secrets.T }}" } }, { uses: pinned("actions/upload-artifact") }] },
        npm: { environment: { name: "x" }, steps: [{ run: "npm --prefix desktop ci --ignore-scripts" }, { run: "npx foo" }, { run: "npm run desktop:package" }] },
        script: { steps: [{ name: "s", env: { T: "${{ secrets.T }}" }, run: "node scripts/x.mjs" }] },
        action: { environment: "release", steps: [{ uses: pinned("some/electron-builder-action") }, { uses: "actions/checkout@v5" }] },
        free: { steps: [{ run: "npm ci" }, { uses: pinned("some/other") }] },
      },
    };
    expect(tokenJobs(doc)).toEqual(["clean", "npm", "script", "action"]);
    const v = tokenJobViolations(doc);
    expect(v.filter((x) => x.startsWith("clean:"))).toEqual([]);
    expect(v.filter((x) => x.startsWith("npm:"))).toHaveLength(3);
    expect(v.filter((x) => x.startsWith("script:"))).toEqual(["script: s: runs node scripts/x.mjs"]);
    expect(v.filter((x) => x.startsWith("action:"))).toHaveLength(2);
    expect(v.filter((x) => x.startsWith("free:"))).toEqual([]);
  });

  describe("signing", () => {
    const REPACKAGE = "Repackage the setup around the app tree";
    const APP_TREE_CHECK = "The app tree holds the standalone server and its .next build";
    const FEED_WRITE = "Require the SignPath Foundation signature in the app's update feed";
    const FEED_CHECK = "The repackaged app's updater requires the SignPath Foundation signature";
    const INSTALLER_CHECK = "The installer passes the app's own update signature check";
    const EXE_CHECK = "The app's executable is signed by SignPath Foundation";
    const TAKE_SIGNED = "Take the signed installer and rewrite the update feed";
    const RECORD = "Record whether the installer is signed";
    const APP_DIR = "${{ runner.temp }}/app";
    // The update-feed check's .NET pattern, as written inside a PowerShell single-quoted string.
    const PUBLISHER_PS = String.raw`(?m)^publisherName:[ \t]*\r?\n[ \t]+-[ \t]*[''"]?SignPath Foundation[''"]?[ \t]*\r?$`;
    const idx = (j, name) => releaseStepIndex(j, name);
    const subs = (j) => releaseSteps(j).filter((s) => /^signpath\/github-action-submit-signing-request@/.test(s.uses ?? ""));

    it("runs every signing job on windows with a timeout", () => {
      for (const id of ["sign-app", "repackage", "sign-installer", "finalize"]) {
        expect(job(id)["runs-on"], id).toBe("windows-latest");
        expect(job(id)["timeout-minutes"], id).toBeGreaterThan(0);
      }
    });

    // A submission may wait its full completion timeout and download timeout; a job timeout below
    // their sum kills a slow but healthy signing run.
    it("gives each token job more time than its one SignPath submission can take", () => {
      for (const id of ["sign-app", "sign-installer"]) {
        const s = subs(id);
        expect(s, id).toHaveLength(1);
        const signingS = s[0].with["wait-for-completion-timeout-in-seconds"] + s[0].with["download-signed-artifact-timeout-in-seconds"];
        expect(signingS, id).toBe(3600 + 1800);
        expect(job(id)["timeout-minutes"] * 60 - signingS, id).toBeGreaterThanOrEqual(15 * 60);
      }
    });

    it("submits to SignPath only through the pinned action, in the two token jobs, behind the switch", () => {
      const all = JOBS.flatMap((id) => subs(id).map((s) => [id, s]));
      expect(all.map(([id]) => id)).toEqual(["sign-app", "sign-installer"]);
      for (const [id, s] of all) {
        expect(s.uses, id).toMatch(/^signpath\/github-action-submit-signing-request@[0-9a-f]{40}$/);
        expect(s.with["api-token"], id).toBe("${{ secrets.SIGNPATH_API_TOKEN }}");
        for (const v of ["ORGANIZATION_ID", "PROJECT_SLUG", "SIGNING_POLICY_SLUG"]) {
          expect(s.with[v.toLowerCase().replace(/_/g, "-")], `${id} ${v}`).toBe(`\${{ vars.SIGNPATH_${v} }}`);
        }
        expect(s.with["wait-for-completion"], id).toBe(true);
        // The packaged app and the setup are large; the action's default download timeout is 300 s.
        expect(s.with["download-signed-artifact-timeout-in-seconds"], id).toBe(1800);
      }
      expect(releaseStep("sign-app", "Sign the app's own executables").if).toBe(ON_APP_EXPR);
      expect(releaseStep("sign-app", "Sign the app's own executables").with["artifact-configuration-slug"]).toBe("app");
      // sign-installer's own `if:` is the switch, at job level.
      expect(releaseStep("sign-installer", "Sign the installer").if).toBeUndefined();
      expect(releaseStep("sign-installer", "Sign the installer").with["artifact-configuration-slug"]).toBe("installer");
      // Nowhere else in any workflow.
      for (const f of ALL_WORKFLOWS) {
        if (f === "release.yml") continue;
        expect(read(`.github/workflows/${f}`), f).not.toMatch(/signpath/i);
      }
    });

    it("reads the token only as the SignPath steps' api-token; no other job or step sees a secret", () => {
      const text = code(RELEASE.replace(/\r\n/g, "\n"));
      expect(text.match(/SIGNPATH_API_TOKEN/g)).toHaveLength(2);
      expect(text.match(/secrets\./g)).toHaveLength(2);
      for (const id of JOBS) {
        const n = (JSON.stringify(job(id)).match(/secrets\./g) ?? []).length;
        expect(n, id).toBe(["sign-app", "sign-installer"].includes(id) ? 1 : 0);
      }
    });

    it("the app's signed tree reaches repackage by artifact, and the setup is repackaged before it is signed", () => {
      // build -> sign-app: by the build's artifact id.
      const b = jobBlock(RELEASE, "build").replace(/\r\n/g, "\n");
      expect(b).toMatch(/^ {6}unpacked-artifact-id: \$\{\{ steps\.upload-unpacked\.outputs\.artifact-id \}\}$/m);
      const u = releaseStep("build", "Upload the packaged app for signing");
      expect(u.id).toBe("upload-unpacked");
      expect(u.if).toBe(ON_EXPR);
      expect(u.with).toMatchObject({ name: "unpacked-app", path: "desktop/release/win-unpacked", "include-hidden-files": true });
      const appSign = releaseStep("sign-app", "Sign the app's own executables");
      expect(appSign.with["github-artifact-id"]).toBe("${{ needs.build.outputs.unpacked-artifact-id }}");
      expect(appSign.with["output-artifact-directory"]).toBe("${{ runner.temp }}/unpacked-signed");
      const up = releaseStep("sign-app", "Upload the signed app for the repackage job");
      expect(up.if).toBe(ON_APP_EXPR);
      expect(up.with).toMatchObject({ name: "unpacked-signed-app", path: "${{ runner.temp }}/unpacked-signed", "include-hidden-files": true, "if-no-files-found": "error" });
      expect(idx("sign-app", "Sign the app's own executables")).toBeLessThan(idx("sign-app", "Upload the signed app for the repackage job"));
      // sign-app -> repackage: the signed tree when SIGNPATH_SIGN_APP_EXE is on, the build's otherwise.
      const dl = releaseStep("repackage", "Download the packaged app");
      expect(dl.with).toEqual({ name: "${{ vars.SIGNPATH_SIGN_APP_EXE == 'true' && 'unpacked-signed-app' || 'unpacked-app' }}", path: APP_DIR });
      // repackage -> sign-installer: by the unsigned setup's artifact id.
      expect(job("repackage").outputs["unsigned-artifact-id"]).toBe("${{ steps.upload-unsigned.outputs.artifact-id }}");
      const unsigned = releaseStep("repackage", "Upload the unsigned installer");
      expect(unsigned.id).toBe("upload-unsigned");
      expect(unsigned.with.path).toBe("desktop/release/aipm-cockpit-${{ needs.guard.outputs.version }}-setup.exe");
      const inst = releaseStep("sign-installer", "Sign the installer");
      expect(inst.with["github-artifact-id"]).toBe("${{ needs.repackage.outputs.unsigned-artifact-id }}");
      expect(inst.with["output-artifact-directory"]).toBe("${{ runner.temp }}/signed-setup");
      // sign-installer -> finalize: the signed setup by name.
      const signedUp = releaseStep("sign-installer", "Upload the signed installer");
      expect(signedUp.with).toMatchObject({ name: "signed-setup", path: "${{ runner.temp }}/signed-setup/aipm-cockpit-${{ needs.guard.outputs.version }}-setup.exe", "if-no-files-found": "error" });
      expect(releaseStep("finalize", "Download the signed installer").with).toEqual({ name: "signed-setup", path: "${{ runner.temp }}/signed-setup" });
      expect(releaseStep("finalize", TAKE_SIGNED).env.SIGNED).toBe("${{ runner.temp }}/signed-setup");
      // Inside repackage: tree in place, checks, feed, repackage, feed check, upload.
      const order = ["Download the packaged app", EXE_CHECK, APP_TREE_CHECK, FEED_WRITE, REPACKAGE, FEED_CHECK, "Upload the unsigned installer"].map((n) => idx("repackage", n));
      expect(order).toEqual([...order].sort((a, c) => a - c));
      expect(idx("repackage", FEED_WRITE) + 1).toBe(idx("repackage", REPACKAGE));
      expect(idx("repackage", REPACKAGE) + 1).toBe(idx("repackage", FEED_CHECK));
      expect(releaseStep("repackage", REPACKAGE).run).toBe('npm run desktop:package -- --prepackaged "$APP_DIR"');
      for (const n of [APP_TREE_CHECK, FEED_WRITE, REPACKAGE, FEED_CHECK]) expect(releaseStep("repackage", n).env.APP_DIR, n).toBe(APP_DIR);
    });

    // upload-artifact skips dot-folders unless told otherwise, so a packaged app uploaded without
    // include-hidden-files arrives without resources/standalone/.next, and the setup repackaged
    // around it installs an app whose server cannot start. This step refuses such a tree before the
    // repackage, on the same APP_DIR and in the same shell the repackage uses.
    it("fails before the repackage unless the app tree holds server.js and .next/BUILD_ID", () => {
      const c = releaseStep("repackage", APP_TREE_CHECK);
      const p = releaseStep("repackage", REPACKAGE);
      expect(c.shell).toBe(p.shell);
      expect(c.env.APP_DIR).toBe(p.env.APP_DIR);
      expect(c.run).toContain('"$APP_DIR/resources/standalone/server.js"');
      expect(c.run).toContain('"$APP_DIR/resources/standalone/.next/BUILD_ID"');
      expect(c.run).toMatch(/\[ -f "\$f" \] \|\| \{ [^}]*exit 1; \}/);
      expect(idx("repackage", APP_TREE_CHECK)).toBeLessThan(idx("repackage", REPACKAGE));
    });

    it("uploads every artifact that carries the app tree with its hidden .next folder", () => {
      const trees = JOBS.flatMap((id) => releaseSteps(id))
        .filter((s) => /^actions\/upload-artifact@/.test(s.uses ?? "") && /unpacked/.test(String(s.with?.path)));
      expect(trees.map((s) => s.with.path)).toEqual(["desktop/release/win-unpacked", "${{ runner.temp }}/unpacked-signed"]);
      for (const s of trees) expect(s.with["include-hidden-files"], s.with.path).toBe(true);
    });

    // The feed is no longer the build job's to write, so no signed-build marker exists anywhere.
    it("sets no signed-build marker on any packing", () => {
      for (const f of [".github/workflows/release.yml", ".github/workflows/ci.yml", "desktop/electron-builder.yml", "package.json", "docs/AGENTS/ci.md"]) {
        expect(read(f), f).not.toMatch(/AIPM_SIGNED_BUILD/);
      }
    });

    // --prepackaged writes no resources/app-update.yml (electron-builder's after-pack hook does, and
    // a prepackaged run skips it), so the feed in the tree is the build job's, which names no
    // publisher. This step adds it, directly before the repackage.
    it("writes the updater's publisherName into the app tree right before the repackage", () => {
      const s = releaseStep("repackage", FEED_WRITE);
      expect(s.shell).toBe("bash");
      // node is the step's only command, so its exit code is the step's.
      expect(s.run).toBe('node scripts/release-update-feed.mjs "$APP_DIR"');
    });

    // A signed installer whose updater accepts anything must fail the release, not ship.
    it("fails unless the repackaged app's update feed requires SignPath Foundation, right after the repackage", () => {
      const s = releaseStep("repackage", FEED_CHECK);
      expect(s.shell).toBe("pwsh");
      expect(s.run).toContain("Join-Path $env:APP_DIR 'resources/app-update.yml'");
      expect(s.run).toContain(`-notmatch '${PUBLISHER_PS}'`);
      expect(s.run).toMatch(/exit 1/);
    });

    // The step's own pattern, run in JS: PowerShell's '' is one ', and (?m) is the "m" flag. The
    // .NET and JS engines agree on every construct it uses ([ \t], \r?, ^/$ under multiline).
    it("the publisherName pattern accepts only SignPath Foundation as the list item under the key", () => {
      const ps = /-notmatch '((?:[^']|'')*)'/.exec(releaseStep("repackage", FEED_CHECK).run)?.[1];
      expect(ps).toBe(PUBLISHER_PS);
      const re = new RegExp(ps.replace(/''/g, "'").replace(/^\(\?m\)/, ""), "m");
      const yes = [
        "owner: x\npublisherName:\n  - SignPath Foundation\nupdaterCacheDirName: y\n",
        "publisherName:\r\n  - 'SignPath Foundation'\r\nrepo: z\r\n",
        "provider: github\npublisherName:\n  - \"SignPath Foundation\"",
      ];
      const no = [
        "publisherName:\n  - Other CN\nfoo: SignPath Foundation\n",
        "publisherName: SignPath Foundation\n",
        "# publisherName:\n  - SignPath Foundation\n",
        "publisherName:\n  - SignPath Foundation Ltd\n",
        "provider: github\nowner: sebastianmaute\n",
      ];
      for (const t of yes) expect(re.test(t), JSON.stringify(t)).toBe(true);
      for (const t of no) expect(re.test(t), JSON.stringify(t)).toBe(false);
    });

    it("installs the packaging tools without install scripts, only in the token-free repackage and finalize", () => {
      const installs = JOBS.flatMap((id) => releaseSteps(id).filter((s) => /npm (?:--prefix \S+ )?(?:ci|install|i)\b/.test(s.run ?? "")).map((s) => [id, s.run.trim(), s.if ?? null]));
      expect(installs).toEqual([
        ["build", "npm ci", null],
        ["build", "npm --prefix desktop ci", null],
        ["repackage", "npm --prefix desktop ci --ignore-scripts", null],
        ["finalize", "npm --prefix desktop ci --ignore-scripts", ON_EXPR],
      ]);
    });

    it("every finalize step that needs signing switched on carries the switch, and the rest run on every release", () => {
      for (const name of ["Install the desktop packaging tools", "Download the signed installer", "Download the repackaged app's update feed", TAKE_SIGNED, INSTALLER_CHECK]) {
        expect(releaseStep("finalize", name).if, name).toBe(ON_EXPR);
      }
      const unconditional = releaseSteps("finalize").filter((s) => s.if === undefined).map((s) => s.name ?? s.uses.replace(/@.*/, ""));
      expect(unconditional).toEqual(["actions/checkout", "actions/setup-node", "actions/download-artifact", RECORD, "No unsigned release after a signed one", "Verify the files", "actions/upload-artifact"]);
      // Inside repackage the switch is the job's; only the app-exe check has a step condition.
      expect(releaseSteps("repackage").filter((s) => s.if !== undefined).map((s) => [s.name, s.if])).toEqual([[EXE_CHECK, "${{ vars.SIGNPATH_SIGN_APP_EXE == 'true' }}"]]);
      expect(releaseSteps("sign-app").filter((s) => s.if !== undefined).map((s) => s.if)).toEqual([ON_APP_EXPR, ON_APP_EXPR]);
      expect(releaseSteps("sign-installer").filter((s) => s.if !== undefined)).toEqual([]);
    });

    it("rewrites latest.yml and the blockmap over the signed installer, then checks its signature", () => {
      const feed = releaseStep("finalize", TAKE_SIGNED);
      // pwsh: node is the step's last command, so its exit code is the step's.
      expect(feed.shell).toBe("pwsh");
      expect(feed.run.trimEnd()).toMatch(/\nnode scripts\/release-latest-yml\.mjs "\$env:FINAL" "\$env:VERSION"$/);
      expect(idx("finalize", "Download the signed installer")).toBeLessThan(idx("finalize", TAKE_SIGNED));
      expect(idx("finalize", "Install the desktop packaging tools")).toBeLessThan(idx("finalize", TAKE_SIGNED));
      expect(idx("finalize", TAKE_SIGNED) + 1).toBe(idx("finalize", INSTALLER_CHECK));
    });

    // The installed app accepts an update only when verifyUpdateSignature passes it: Valid, and the
    // signer's CN EXACTLY a name in the packaged feed's publisherName. A substring check here let a
    // certificate whose CN merely contains the name pass as signed, shipping a release that would
    // refuse every later update. So the release runs that very verifier on the final setup, with the
    // names from the repackaged tree's own feed, and nothing else in the release judges a signer.
    it("judges the final signed setup with the app's own verifier and the repackaged feed", () => {
      const v = releaseStep("finalize", INSTALLER_CHECK);
      expect(v.id).toBe("installer-signature");
      expect(v.shell).toBe("bash");
      expect(v.env.FILE).toBe("${{ runner.temp }}/release/aipm-cockpit-${{ needs.guard.outputs.version }}-setup.exe");
      expect(v.env.FEED).toBe("${{ runner.temp }}/feed/app-update.yml");
      expect(v.run.trim()).toBe('node scripts/release-verify-signature.mjs --feed "$FEED" "$FILE"');
      // The feed is the repackaged tree's own.
      const feedUp = releaseStep("repackage", "Upload the repackaged app's update feed");
      expect(feedUp.with).toMatchObject({ name: "app-update-feed", path: `${APP_DIR}/resources/app-update.yml`, "if-no-files-found": "error" });
      expect(idx("repackage", FEED_CHECK)).toBeLessThan(idx("repackage", "Upload the repackaged app's update feed"));
      expect(releaseStep("finalize", "Download the repackaged app's update feed").with).toEqual({ name: "app-update-feed", path: "${{ runner.temp }}/feed" });
      expect(idx("finalize", "Download the repackaged app's update feed")).toBeLessThan(idx("finalize", INSTALLER_CHECK));
    });

    it("judges the app's executable with the same verifier, before the feed exists, by the feed's own name", () => {
      const e = releaseStep("repackage", EXE_CHECK);
      expect(e.shell).toBe("bash");
      expect(e.env.FILE).toBe(`${APP_DIR}/AI PM Cockpit.exe`);
      expect(e.run.trim()).toBe(`node scripts/release-verify-signature.mjs --publisher "${PUBLISHER}" "$FILE"`);
    });

    it("leaves no substring signer check anywhere in the release", () => {
      expect(code(RELEASE)).not.toMatch(/-(?:not)?like\b/);
      expect(code(RELEASE)).not.toMatch(/Get-AuthenticodeSignature/);
      const runs = JOBS.flatMap((id) => releaseSteps(id)).map((s) => s.run ?? "").filter((r) => /release-verify-signature/.test(r));
      expect(runs).toHaveLength(2);
    });

    it("runs the one-way guard and release:verify on every release, before the upload, and fails on any non-zero exit", () => {
      const g = releaseStep("finalize", "No unsigned release after a signed one");
      expect(g.if).toBeUndefined();
      expect(g.run.trim()).toBe('node scripts/release-signing-guard.mjs "$TAG" "$FINAL"');
      expect(g.env).toMatchObject({ GH_TOKEN: "${{ github.token }}", GH_REPO: "${{ github.repository }}" });
      const v = releaseStep("finalize", "Verify the files");
      expect(v.if).toBeUndefined();
      expect(v.run.trim()).toBe('npm run release:verify -- "$FINAL" "$TAG"');
      const upload = releaseSteps("finalize").findIndex((s) => s.with?.name === "release-final");
      expect(idx("finalize", INSTALLER_CHECK)).toBeLessThan(idx("finalize", "No unsigned release after a signed one"));
      expect(idx("finalize", "No unsigned release after a signed one")).toBeLessThan(idx("finalize", "Verify the files"));
      expect(idx("finalize", "Verify the files")).toBeLessThan(upload);
      // Exit 2 ("cannot decide") must fail the job like exit 1 does.
      expect(RELEASE).not.toMatch(/continue-on-error/);
      expect(g.run).not.toMatch(/\|\||; *exit 0|\$LASTEXITCODE/);
    });

    // The release notes call the installer signed only when its Authenticode check passed in this
    // run: the switch alone does not decide. Skipped (switch off) or anything but success is false;
    // a failed check fails the job, so publish never runs.
    it("outputs signed=true only after the final installer's signature check passed, and publish passes it on", () => {
      expect(job("finalize").outputs).toEqual({ signed: "${{ steps.signed.outputs.signed }}" });
      const rec = releaseStep("finalize", RECORD);
      expect(rec.id).toBe("signed");
      expect(rec.if).toBeUndefined();
      expect(rec.shell).toBe("bash");
      expect(rec.env).toEqual({ CHECKED: "${{ steps.installer-signature.outcome == 'success' }}" });
      expect(rec.run.trim()).toBe('echo "signed=$CHECKED" >> "$GITHUB_OUTPUT"');
      // Nothing else writes the output, and no other job has one called signed.
      expect(code(RELEASE).match(/signed=/g)).toHaveLength(1);
      for (const id of JOBS.filter((j) => j !== "finalize")) expect(job(id).outputs?.signed, id).toBeUndefined();
      // The check runs on the FINAL installer: after the signed copy replaced the build's.
      expect(idx("finalize", TAKE_SIGNED)).toBeLessThan(idx("finalize", INSTALLER_CHECK));
      expect(idx("finalize", INSTALLER_CHECK)).toBeLessThan(idx("finalize", RECORD));
      const publishStep = releaseStep("publish", "Publish the GitHub Release");
      expect(publishStep.env.RELEASE_SIGNED).toBe("${{ needs.finalize.outputs.signed }}");
      expect(code(RELEASE).match(/RELEASE_SIGNED/g)).toHaveLength(1);
    });
  });

  it("guards the tag against APP_VERSION and main before building", () => {
    const g = jobBlock(RELEASE, "guard");
    expect(g).toMatch(/node scripts\/check-tag-version\.mjs "\$TAG"/);
    expect(g).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  });

  it("every job has a timeout", () => {
    for (const id of jobIds(RELEASE)) expect(jobBlock(RELEASE, id)).toMatch(/^\s+timeout-minutes: \d+$/m);
  });

  it("builds on windows and uploads exactly the files the builder writes and publish expects", () => {
    const b = jobBlock(RELEASE, "build");
    expect(b).toMatch(/^\s+runs-on: windows-latest$/m);
    const V = "${{ needs.guard.outputs.version }}";
    // R3: the version expression contains spaces, so a `\S+` path regex would stop at its first
    // `${{` and never match a `paths:` line at all; `\s*$` forces the non-greedy `.+?` to take the
    // whole line instead. The `ls -l`/`find` lines in the same job never match either way: `^`
    // anchors right after the leading whitespace, which is `l`/`i` there, not `d`.
    const paths = [...b.matchAll(/^\s+(desktop\/release\/.+?)\s*$/gm)].map((m) => m[1].replaceAll(V, "9.9.9"));
    expect(paths).toEqual(expectedAssets("9.9.9").map((f) => `${INSTALLER_DIR}/${f}`));
  });

  // R4 (MINOR 4): pin the ported sharp guard itself, not just its presence as prose. The positive
  // control (`next/package.json`) proves the walk isn't vacuous against a moved/missing tree; the
  // `@img/sharp-*` arm is the nested-package case the electron-builder.yml filter cannot see.
  it("guards against a moved packaged tree and a nested sharp copy", () => {
    const b = jobBlock(RELEASE, "build");
    expect(b).toMatch(/test -f "\$nm\/next\/package\.json"/);
    expect(b).toMatch(/@img\/sharp-\*/);
  });

  // Fix round 1 (review R11 Important 1b): a static import of ./updater in main.ts means a missing
  // electron-updater in the packaged app.asar breaks every installed copy at startup, not just the
  // updater feature -- so this is a POSITIVE control (asar list's real output, grepped), not a prose
  // claim about desktop/electron-builder.yml's `files:`.
  it("guards that the packaged app actually contains electron-updater", () => {
    const b = jobBlock(RELEASE, "build");
    expect(b).toMatch(/asar=desktop\/node_modules\/\.bin\/asar/);
    expect(b).toMatch(/app=desktop\/release\/win-unpacked\/resources\/app\.asar/);
    expect(b).toMatch(/"\$asar" list "\$app"/);
    // The runner is windows-latest, and asar list reports path.join()-native ("\") separators there
    // (measured locally against a real package) -- pinned as a plain substring (not a regex) so this
    // assertion needs no double-escaping of its own for the bracket class the guard's grep uses to
    // accept either separator.
    expect(b).toContain("node_modules[/\\\\]electron-updater[/\\\\]out[/\\\\]main\\.js");
    expect(b).toContain("node_modules[/\\\\]builder-util-runtime");
  });

  // §561: the four fuses electron-builder.yml sets, read off the packaged exe. Each one the guard
  // checks must be one the builder config sets, with the same value, so neither can drift alone.
  it("guards that the packaged exe carries the electron-builder.yml fuses", () => {
    const b = jobBlock(RELEASE, "build");
    expect(b).toMatch(/fuses=desktop\/node_modules\/\.bin\/electron-fuses/);
    expect(b).toContain('exe="desktop/release/win-unpacked/AI PM Cockpit.exe"');
    expect(b).toMatch(/"\$fuses" read --app "\$exe"/);
    const wants = [...b.matchAll(/"(\w+) is (Enabled|Disabled)"/g)].map((m) => [m[1], m[2] === "Enabled"]);
    const eb = read("desktop/electron-builder.yml");
    // To the next top-level key: indented lines and blank lines only (`\s+` would
    // swallow a newline and run on into the next key).
    const block = /^electronFuses:\n((?:[ \t]+.*\n|\n)+)/m.exec(eb.replace(/\r\n/g, "\n"))?.[1] ?? "";
    const set = [...block.matchAll(/^\s+(\w+):\s*(true|false)/gm)].map((m) => [m[1].toLowerCase(), m[2] === "true"]);
    expect(set.length).toBeGreaterThanOrEqual(4);
    expect(wants.map(([k, v]) => [k.toLowerCase(), v]).sort()).toEqual(set.sort());
  });
});

describe("electron-builder.yml agrees with the release library", () => {
  const eb = read("desktop/electron-builder.yml");
  it("writes installerName() into INSTALLER_DIR, with no nested artifactName", () => {
    const name = /^artifactName:\s*["']?([^"'\s]+)/m.exec(eb)?.[1];
    expect(name?.replace(/\$\{version\}/g, "9.9.9")).toBe(installerName("9.9.9"));
    expect(/^\s+artifactName:/m.test(eb)).toBe(false);
    const pkg = JSON.parse(read("package.json"));
    const project = /--project\s+(\S+)/.exec(pkg.scripts["desktop:package"])?.[1];
    const output = /^directories:\n\s+output:\s*(\S+)/m.exec(eb)?.[1];
    expect(`${project}/${output}`).toBe(INSTALLER_DIR);
  });
  it("publishes to this repository on GitHub", () => {
    expect(eb).toMatch(/^publish:\n\s+provider: github\n\s+owner: sebastianmaute\n\s+repo: aipm-cockpit$/m);
  });
  it("keeps source maps out of the app.asar files", () => {
    const block = /^files:\n((?: {2}- .*\n)+)/m.exec(eb.replace(/\r\n/g, "\n"))?.[1] ?? "";
    expect(block).toMatch(/^ {2}- dist\/\*\*$/m);
    expect(block).toMatch(/^ {2}- "!\*\*\/\*\.map"$/m);
  });
  it("keeps source maps out of both standalone resources", () => {
    const block = /^extraResources:\n((?:[ \t]+.*\n|[ \t]*#.*\n)+)/m.exec(eb.replace(/\r\n/g, "\n"))?.[1] ?? "";
    const entries = block.split(/^ {2}- /m).slice(1);
    expect(entries.map((e) => /^to: (\S+)$/m.exec(e.replace(/^ {4}/gm, ""))?.[1])).toEqual(["standalone", "standalone/node_modules"]);
    for (const entry of entries) expect(entry).toMatch(/^ {6}- "!\*\*\/\*\.map"$/m);
  });
  it("puts the notices the release:sbom pre-pass wrote into the installation folder", () => {
    const from = /^extraFiles:\n {2}- from: (\S+)\n {4}to: THIRD-PARTY-NOTICES\.txt$/m.exec(eb.replace(/\r\n/g, "\n"))?.[1];
    // electron-builder resolves `from` against desktop/ (the --project dir).
    expect(from && posix.normalize(`desktop/${from}`)).toBe(".next/sbom/THIRD-PARTY-NOTICES.txt");
    expect(jobBlock(RELEASE, "build")).toContain("--out .next/sbom");
  });
});

// Shared by the two live workflows' blocks below.
// Comment lines name what they forbid; only the YAML itself is checked.
const code = (text) => text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
// GitHub runs .yaml as well as .yml.
const ALL_WORKFLOWS = readdirSync(new URL("../.github/workflows/", import.meta.url)).filter((f) => /\.ya?ml$/.test(f));
// A step, from its "- " line to the next step's, and the step a line index belongs to.
const stepStart = (lines, i) => lines.slice(0, i + 1).findLastIndex((l) => /^ {6}- /.test(l));
const stepLines = (lines, start) => {
  const next = lines.slice(start + 1).findIndex((l) => /^ {6}- /.test(l));
  return lines.slice(start, next === -1 ? undefined : start + 1 + next);
};
const stepId = (step) => step.map((l) => l.match(/^ {6}(?:- | {2})id: (\S+)$/)?.[1]).find(Boolean);

// §215: the live-Turso specs against a dedicated throwaway database. Not a required check.
describe("live-turso.yml", () => {
  const LIVE = read(".github/workflows/live-turso.yml");
  workflowRules("live-turso.yml", LIVE);
  const check = jobBlock(LIVE, "check");
  const job = jobBlock(LIVE, "live-turso");
  const config = read("playwright.config.ts");
  const scripts = JSON.parse(read("package.json")).scripts;
  const jobLines = code(job).split("\n");
  const stepById = (id) => {
    const at = jobLines.findIndex((l) => new RegExp(`^ {6}(- | {2})id: ${id}$`).test(l));
    return at === -1 ? "" : stepLines(jobLines, stepStart(jobLines, at)).join("\n");
  };
  const drop = stepById("drop");
  const app = stepById("app");
  const minutes = (text, re) => Number((text.match(re) ?? [])[1]);

  it("is a secret check plus the live job, and neither is a required check", () => {
    expect(jobIds(LIVE)).toEqual(["check", "live-turso"]);
    for (const id of jobIds(LIVE)) expect(REQUIRED).not.toContain(id);
  });

  // Exactly these triggers: workflow_run, issue_comment and the like are known ways to hand secrets
  // to code a fork controls. pull_request_target would run a fork's code with the secrets outright,
  // so it is banned in every workflow.
  it("runs on pull_request and push to main and workflow_dispatch only, and no workflow uses pull_request_target", () => {
    expect(topLevelBlock(LIVE, "on")).toEqual(["pull_request:", "branches: [main]", "push:", "branches: [main]", "workflow_dispatch:"]);
    for (const f of ALL_WORKFLOWS) expect(code(read(`.github/workflows/${f}`)), f).not.toMatch(/pull_request_target/);
  });

  // workflowRules pins the top-level permissions; a job-level block would override them for the
  // job that holds the secrets.
  it("grants no job its own permissions", () => {
    expect(check).not.toMatch(/^ {4}permissions:/m);
    expect(job).not.toMatch(/^ {4}permissions:/m);
  });

  // Every run shares one database. The group sits on the JOB, after the check, so a skipped run
  // (a fork's pull request) is expected never to take the slot. This pins where the YAML sits, not
  // GitHub's behaviour, which is not yet observed on a real run (docs/AGENTS/ci.md).
  it("queues the live job on one fixed group, never cancels a running job, and leaves the check ungrouped", () => {
    expect(topLevelBlock(LIVE, "concurrency")).toEqual([]);
    expect(job).toMatch(/^ {4}concurrency:\r?\n {6}group: live-turso-throwaway-database\r?\n {6}cancel-in-progress: false$/m);
    expect(check).not.toMatch(/concurrency:/);
    expect(job).toMatch(/^ {4}needs: check$/m);
    expect(job).toMatch(/^ {4}if: needs\.check\.outputs\.present == 'true'$/m);
  });

  // Each secret line has one shape, sits directly under a STEP's env: (a job-level env: would hand
  // the token to npm ci, which runs every dependency's install scripts), and belongs to one of the
  // three steps that need it, found by step id: moving them onto npm ci, or onto any other step,
  // fails. Loose on purpose about spacing: ${{secrets.X}} and toJSON(secrets) must not slip past.
  // ★ Fails closed on a trailing comment after env: or a secret line: keep comments on their own line.
  it("puts the two throwaway secrets only on the env: of the steps that need them", () => {
    const lines = code(LIVE).split("\n");
    const indent = (l) => l.match(/^\s*/)[0].length;
    const perStep = {};
    lines.forEach((line, i) => {
      if (!/(?<!steps\.)\bsecrets\b/.test(line)) return;
      expect(line, line).toMatch(/^ {10}[A-Z_]+: \$\{\{ secrets\.TURSO_THROWAWAY_(DATABASE_URL|AUTH_TOKEN) \}\}$/);
      const parent = lines.slice(0, i).reverse().find((l) => l.trim() !== "" && indent(l) < indent(line));
      expect(parent, line).toMatch(/^( {8}env:| {6}- env:)$/);
      const id = stepId(stepLines(lines, stepStart(lines, i))) ?? "(a step with no id)";
      perStep[id] = (perStep[id] ?? 0) + 1;
    });
    expect(perStep).toEqual({ pair: 2, drop: 2, app: 4 });
  });

  // Two separate checks. (1) code() drops every line starting with #, which cannot tell a YAML
  // comment from a "# ..." line in a run: | body, where GitHub still evaluates ${{ }}. So count on
  // the RAW text: only the 8 secret lines above may hold a ${{ }} naming secrets or env. This counts
  // comment lines too, so a comment quoting such an expression fails it (closed). (2) No ${{ }}
  // anywhere reads env. or env[...], which catches the check job's aliases (${{ env.TOKEN }}).
  it("has no other expression that reads a secret or an env value", () => {
    const raw = LIVE.split(/\r?\n/).filter((l) => /\$\{\{/.test(l) && /\b(secrets|env)\b/.test(l));
    expect(raw, raw.join("\n")).toHaveLength(8);
    expect(LIVE).not.toMatch(/\$\{\{[^}]*\benv\s*[.[]/);
  });

  // A fork's pull request, Dependabot and an unconfigured repository have no secrets: the check says
  // so and the live job is skipped, so nothing installs or runs.
  it("decides on both secrets being present, in the check job", () => {
    expect(check).toMatch(/if \[ -n "\$URL" \] && \[ -n "\$TOKEN" \]/);
    expect(check).toMatch(/present: \$\{\{ steps\.pair\.outputs\.present \}\}/);
    expect(check).not.toMatch(/npm |npx /);
  });

  it("installs, then drops tables, then drives the app, the last even after a failure but not after a failed setup", () => {
    const at = (re) => jobLines.findIndex((l) => re.test(l));
    const npmCi = at(/^ {6}- run: npm ci$/);
    const install = at(/^ {8}id: install$/);
    expect(npmCi).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(npmCi);
    expect(at(/^ {8}id: drop$/)).toBeGreaterThan(install);
    expect(at(/^ {8}id: app$/)).toBeGreaterThan(at(/^ {8}id: drop$/));
    expect(app).toMatch(/^ {8}if: \$\{\{ !cancelled\(\) && steps\.install\.outcome == 'success' \}\}$/m);
  });

  // Each step runs its npm script and then check-live-run.mjs, which fails the step if any test
  // skipped or none ran: every live spec skips when a setting it needs is missing, so without it a
  // run that skipped everything would be green and prove nothing.
  it("runs each suite through its npm script, then fails it if any test skipped or none ran", () => {
    expect(drop).toMatch(/^ {8}run: npm run e2e:live-destructive && node scripts\/check-live-run\.mjs$/m);
    expect(app).toMatch(/^ {8}run: npm run e2e:live-app && node scripts\/check-live-run\.mjs$/m);
    const env = (step, key) => step.match(new RegExp(`^ {10}${key}: (\\S+)$`, "m"))?.[1];
    for (const [name, step] of [["drop", drop], ["app", app]]) {
      const html = env(step, "PLAYWRIGHT_HTML_OUTPUT_DIR");
      const json = env(step, "E2E_JSON_REPORT");
      expect(html, name).toMatch(/^playwright-report\//);
      expect(json, name).toMatch(/^playwright-report\/.+\.json$/);
      // The HTML reporter empties its folder first, so the JSON report must sit outside it.
      expect(json.startsWith(`${html}/`), name).toBe(false);
    }
    // Separate report files and folders, so the second step does not overwrite the first's.
    expect(env(drop, "PLAYWRIGHT_HTML_OUTPUT_DIR")).not.toBe(env(app, "PLAYWRIGHT_HTML_OUTPUT_DIR"));
    expect(env(drop, "E2E_JSON_REPORT")).not.toBe(env(app, "E2E_JSON_REPORT"));
    expect(config).toMatch(/process\.env\.E2E_JSON_REPORT \? \[\["json", \{ outputFile: process\.env\.E2E_JSON_REPORT \}\]/);
    // The app step points the app at the throwaway database; the drop step needs no app at all.
    for (const v of ["TURSO_THROWAWAY_DATABASE_URL", "TURSO_THROWAWAY_AUTH_TOKEN", "NEXT_PUBLIC_TURSO_DATABASE_URL", "NEXT_PUBLIC_TURSO_AUTH_TOKEN"]) {
      expect(app, v).toContain(`${v}: `);
    }
    expect(drop).not.toContain("NEXT_PUBLIC_TURSO_");
  });

  // Which specs run has ONE home: playwright.config.ts's LIVE_TURSO_DESTRUCTIVE and LIVE_TURSO_APP.
  // Both directions are checked. Every live spec must be in one of them, or it never runs here.
  // Every listed name must be a LIVE spec: the lists hand the Turso values to whatever they match,
  // and an ordinary spec (smoke, a11y) is not partition-scoped and would write to the shared
  // database; a typo would also silently drop a spec. A live spec is one whose CODE (comments
  // stripped, so a mention in a comment never counts, backticked or not) imports
  // e2e/live-turso-env.ts or live-turso-schema.ts (any quoting, with or without .ts), or reads
  // process.env.TURSO_THROWAWAY_… or a quoted "TURSO_THROWAWAY_…". Every live spec imports the helper
  // today (grep -lE "live-turso-(env|schema)" e2e/*.spec.ts); the two direct reads still count so a
  // spec that reads the pair itself is caught. Another form (a destructured or aliased process.env)
  // is not recognised, so such a spec would fail as "in neither list" until it uses one. Each list
  // is a plain list of names, anchored to WHOLE file names. Every scan is RECURSIVE, as Playwright's
  // search of testDir is.
  it("runs exactly the live specs, each in one list, through the projects the npm scripts name", () => {
    const LIVE_READER = /["']\.\/live-turso-(env|schema)(\.ts)?["']|process\.env\.TURSO_THROWAWAY_|["']TURSO_THROWAWAY_/;
    // Block comments, then line comments (a "//" after ":" is a URL, not a comment).
    const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
    // Paths relative to e2e/, forward slashes, so a spec in a subfolder shows up as "sub/name".
    const SPECS = readdirSync(new URL("../e2e/", import.meta.url), { recursive: true })
      .map((f) => String(f).replace(/\\/g, "/"))
      .filter((f) => f.endsWith(".spec.ts"));
    const specFile = (name) => new URL(`../e2e/${name}.spec.ts`, import.meta.url);
    const list = (name) => {
      const literal = config.match(new RegExp(`^const ${name} = (/.*/);\\r?$`, "m"))?.[1];
      const names = literal?.match(/^\/\(\?:\^\|\[\\\\\/\]\)\(([a-z0-9-]+(?:\|[a-z0-9-]+)*)\)\\\.spec\\\.ts\$\/$/)?.[1];
      expect(names, `${name} must be /(?:^|[\\\\/])(name|name)\\.spec\\.ts$/, got ${literal}`).toBeDefined();
      return { re: new RegExp(literal.slice(1, -1)), names: names.split("|") };
    };
    const { re: destructiveRe, names: destructive } = list("LIVE_TURSO_DESTRUCTIVE");
    const { re: appRe, names: appSpecs } = list("LIVE_TURSO_APP");
    expect(destructive.filter((n) => appSpecs.includes(n))).toEqual([]);
    // First each listed name on its own, so a typo or a deleted spec gets its own message.
    // Every listed name is a spec file that exists and reads the live database.
    for (const name of [...destructive, ...appSpecs]) {
      expect(existsSync(specFile(name)), `${name}: no e2e/${name}.spec.ts`).toBe(true);
      expect(codeOf(read(`e2e/${name}.spec.ts`)), `${name} is not a live spec`).toMatch(LIVE_READER);
    }
    // Then each regex, as Playwright applies it (to a full path, either separator): it must match
    // exactly its listed top-level files. Given the shape check and the loop above, the one case
    // left for this to catch is a SUBFOLDER spec with a listed name, which the anchored regex also
    // matches and which would run with the credentials.
    for (const [re, names] of [[destructiveRe, destructive], [appRe, appSpecs]]) {
      const hits = SPECS.filter((f) => re.test(`/repo/e2e/${f}`) || re.test(`C:\\repo\\e2e\\${f.replace(/\//g, "\\")}`));
      expect(hits.map((f) => f.replace(/\.spec\.ts$/, "")).sort(), `${re} matches a spec beyond its listed top-level ones (a subfolder copy runs with the credentials)`).toEqual([...names].sort());
      for (const n of names) expect(re.test(`/repo/e2e/old-${n}.spec.ts`), `${re} matches old-${n}`).toBe(false);
    }
    // live-turso-env.spec.ts tests the helper itself and needs no database. A live spec in a
    // subfolder reads "sub/name" and so is in neither list: keep live specs at the top of e2e/.
    const readers = SPECS
      .filter((f) => f !== "live-turso-env.spec.ts")
      .filter((f) => LIVE_READER.test(codeOf(read(`e2e/${f}`))))
      .map((f) => f.replace(/\.spec\.ts$/, ""));
    expect(readers.length).toBeGreaterThan(0);
    for (const name of readers) expect([...destructive, ...appSpecs], `${name} is in neither list`).toContain(name);
    // The app list runs through a project that exists only under the npm script's E2E_LIVE_APP.
    expect(config).toMatch(/\.\.\.\(process\.env\.E2E_LIVE_APP\s*\?\s*\[\{ name: "live-turso-app", testMatch: LIVE_TURSO_APP,/);
    expect(scripts["e2e:live-app"]).toContain("process.env.E2E_LIVE_APP='1'");
    // At most one retry and three final failures. These do NOT bound the run's time (retries queue
    // after every first attempt); E2E_GLOBAL_TIMEOUT_MS does.
    expect(scripts["e2e:live-app"]).toContain("npx playwright test --project=live-turso-app --workers=1 --retries=1 --max-failures=3'");
    expect(scripts["e2e:live-destructive"]).toContain("npx playwright test --project=live-turso-destructive'");
  });

  // Each test step has its own timeout, below the job's, so a hung step fails rather than the job
  // being cancelled; inside it, each Playwright run has its own wall clock, at least 2 minutes under
  // the step's, so it stops itself and writes its report, whatever the number of tests.
  it("bounds each step, and each Playwright run inside it, in time", () => {
    const dropMin = minutes(drop, /^ {8}timeout-minutes: (\d+)$/m);
    const appMin = minutes(app, /^ {8}timeout-minutes: (\d+)$/m);
    const jobMin = minutes(job, /^ {4}timeout-minutes: (\d+)$/m);
    expect(dropMin).toBeGreaterThan(0);
    expect(appMin).toBeGreaterThan(0);
    expect(dropMin + appMin + 15).toBeLessThanOrEqual(jobMin);
    // Read as the config reads it (globalTimeoutFrom): bare, single- or double-quoted, with an
    // optional trailing comment, so an unusable value fails with its own message rather than as NaN.
    const ms = (step, name) => {
      const raw = step.match(/^ {10}E2E_GLOBAL_TIMEOUT_MS:\s*(["']?)([^"'\s#]*)\1\s*(#.*)?$/m)?.[2];
      const value = globalTimeoutFrom(raw);
      expect(value, `${name}: E2E_GLOBAL_TIMEOUT_MS is ${raw === undefined ? "missing" : `"${raw}", which sets no limit`}`).toBeDefined();
      return value;
    };
    expect(ms(drop, "drop step")).toBeLessThanOrEqual((dropMin - 2) * 60_000);
    expect(ms(app, "app step")).toBeLessThanOrEqual((appMin - 2) * 60_000);
    expect(config).toMatch(/^ {2}globalTimeout: globalTimeoutFrom\(process\.env\.E2E_GLOBAL_TIMEOUT_MS\),\r?$/m);
    // The drop-tables project runs without retries (a failure there is the database's answer).
    const destructive = config.slice(config.indexOf('name: "live-turso-destructive"'));
    expect(destructive.slice(0, destructive.indexOf("},"))).toMatch(/^\s+retries: 0,\r?$/m);
  });

  // The value playwright.config.ts passes to globalTimeout. Anything but a whole number of ms in
  // range means no limit; above the range Node would clamp the timer to 1 ms and end the run at once.
  it("reads E2E_GLOBAL_TIMEOUT_MS as a limit only when it is a usable number of ms", () => {
    expect(globalTimeoutFrom("600000")).toBe(600_000);
    expect(globalTimeoutFrom("1")).toBe(1);
    expect(globalTimeoutFrom(String(MAX_GLOBAL_TIMEOUT_MS))).toBe(MAX_GLOBAL_TIMEOUT_MS);
    expect(MAX_GLOBAL_TIMEOUT_MS).toBe(2 ** 31 - 1);
    for (const v of [undefined, "", "0", "-5", "abc", "600000.5", "1e6", " 600000", String(MAX_GLOBAL_TIMEOUT_MS + 1)]) {
      expect(globalTimeoutFrom(v), String(v)).toBeUndefined();
    }
  });

  // Cancelled covers a job that hit timeout-minutes (best-effort: a killed Playwright run may have
  // written no report).
  it("uploads the reports on failure or cancellation only, for 7 days", () => {
    const up = job.slice(job.indexOf("uses: actions/upload-artifact@"));
    expect(up).toMatch(/if: \$\{\{ failure\(\) \|\| cancelled\(\) \}\}/);
    expect(up).toMatch(/path: playwright-report\//);
    expect(up).toMatch(/retention-days: 7/);
  });

  // Every other workflow, today's and any added later: there the live specs skip, and the app runs
  // on browser storage. toJSON(secrets) and secrets: inherit hand over every secret without naming one;
  // GitHub function names are case-insensitive (toJson is the common spelling). RAW text, not code():
  // a "# ..." line in a run: | body is still evaluated.
  it("is the only workflow that reads the throwaway secrets", () => {
    expect(ALL_WORKFLOWS).toContain("live-turso.yml");
    for (const f of ALL_WORKFLOWS.filter((n) => n !== "live-turso.yml")) {
      const text = read(`.github/workflows/${f}`);
      expect(text, f).not.toMatch(/TURSO_THROWAWAY|NEXT_PUBLIC_TURSO/);
      expect(text, f).not.toMatch(/tojson\(\s*secrets\s*\)|secrets:\s*inherit/i);
    }
  });
});

// AI organisation key: the relay and its key check against real Anthropic and a real Cloudflare AI
// Gateway. Not a required check; started by hand only, since every run spends tokens.
describe("ai-live.yml", () => {
  const AI = read(".github/workflows/ai-live.yml");
  workflowRules("ai-live.yml", AI);
  const check = jobBlock(AI, "check");
  const job = jobBlock(AI, "ai-live");
  const SECRETS = ["AI_LIVE_ANTHROPIC_KEY", "AI_LIVE_ORGANIZATION_ID", "AI_LIVE_WORKSPACE_ID", "AI_LIVE_GATEWAY_URL", "AI_LIVE_GATEWAY_TOKEN"];
  const LIVE_TEST = "src/app/api/ai/_relay.live.test.ts";

  it("is a secret check plus the live job, and neither is a required check", () => {
    expect(jobIds(AI)).toEqual(["check", "ai-live"]);
    for (const id of jobIds(AI)) expect(REQUIRED).not.toContain(id);
  });

  it("runs on workflow_dispatch only", () => {
    expect(topLevelBlock(AI, "on")).toEqual(["workflow_dispatch:"]);
  });

  it("grants no job its own permissions and sets no workflow- or job-level env:", () => {
    for (const block of [check, job]) expect(block).not.toMatch(/^ {4}(permissions|env):/m);
    expect(topLevelBlock(AI, "env")).toEqual([]);
  });

  it("queues the live job on one fixed group, never cancels a running job, and leaves the check ungrouped", () => {
    expect(topLevelBlock(AI, "concurrency")).toEqual([]);
    expect(job).toMatch(/^ {4}concurrency:\r?\n {6}group: ai-live-throwaway-organisation\r?\n {6}cancel-in-progress: false$/m);
    expect(check).not.toMatch(/concurrency:/);
    expect(job).toMatch(/^ {4}needs: check$/m);
    expect(job).toMatch(/^ {4}if: needs\.check\.outputs\.present == 'true'$/m);
  });

  // Same shape rule as live-turso.yml's: each secret line sits directly under a STEP's env:, named
  // as the secret itself, and only the check step (`all`) and the test step (`live`) carry them, all
  // five each. Never npm ci, never a run: line.
  it("puts the five secrets only on the env: of the check step and the test step", () => {
    const lines = code(AI).split("\n");
    const indent = (l) => l.match(/^\s*/)[0].length;
    const perStep = {};
    lines.forEach((line, i) => {
      if (!/(?<!steps\.)\bsecrets\b/.test(line)) return;
      const m = line.match(/^ {10}([A-Z_]+): \$\{\{ secrets\.([A-Z_]+) \}\}$/);
      expect(m, line).not.toBeNull();
      expect(m[1], line).toBe(m[2]);
      expect(SECRETS, line).toContain(m[2]);
      const parent = lines.slice(0, i).reverse().find((l) => l.trim() !== "" && indent(l) < indent(line));
      expect(parent, line).toMatch(/^( {8}env:| {6}- env:)$/);
      const id = stepId(stepLines(lines, stepStart(lines, i))) ?? "(a step with no id)";
      perStep[id] = [...(perStep[id] ?? []), m[2]];
    });
    expect(perStep).toEqual({ all: SECRETS, live: SECRETS });
  });

  // RAW text, comment lines included (a "# ..." line in a run: | body is still evaluated): only the
  // ten secret lines may hold a ${{ }} naming secrets or env, and no ${{ }} reads env.
  it("has no other expression that reads a secret or an env value", () => {
    const raw = AI.split(/\r?\n/).filter((l) => /\$\{\{/.test(l) && /\b(secrets|env)\b/.test(l));
    expect(raw, raw.join("\n")).toHaveLength(10);
    expect(AI).not.toMatch(/\$\{\{[^}]*\benv\s*[.[]/);
  });

  it("decides on all five secrets being present, in the check job, and installs nothing there", () => {
    for (const s of SECRETS) expect(check).toContain(`[ -n "$${s}" ]`);
    expect(check).toMatch(/present: \$\{\{ steps\.all\.outputs\.present \}\}/);
    expect(check).not.toMatch(/npm |npx /);
  });

  // A dispatch with a secret missing skips the live job, and the run still shows green: the warning is
  // what tells the reader that nothing was proved.
  it("warns, never merely notes, that a run with a secret missing proved nothing", () => {
    expect(check).toMatch(/echo "::warning::ai-live proved nothing: /);
    expect(check).not.toMatch(/::notice::/);
  });

  // A vitest run in which every test skipped exits 0; AI_LIVE_REQUIRED turns on the test file's one
  // test that fails when any secret is missing, so a renamed secret cannot pass green.
  it("installs without secrets, then runs only the live test file with AI_LIVE_REQUIRED, in its own timeout", () => {
    const lines = code(job).split("\n");
    const npmCi = lines.findIndex((l) => /^ {6}- run: npm ci$/.test(l));
    const liveAt = lines.findIndex((l) => /^ {8}id: live$/.test(l));
    expect(npmCi).toBeGreaterThan(-1);
    expect(liveAt).toBeGreaterThan(npmCi);
    expect(stepLines(lines, npmCi)).toHaveLength(1);
    const live = stepLines(lines, stepStart(lines, liveAt)).join("\n");
    expect(live).toMatch(new RegExp(`^ {8}run: npx vitest run ${LIVE_TEST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --reporter=default$`, "m"));
    expect(live).toMatch(/^ {10}AI_LIVE_REQUIRED: "1"$/m);
    const stepMin = Number(live.match(/^ {8}timeout-minutes: (\d+)$/m)?.[1]);
    const jobMin = Number(job.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]);
    expect(stepMin).toBeGreaterThan(0);
    expect(stepMin + 5).toBeLessThanOrEqual(jobMin);
    const test = read(LIVE_TEST);
    // The proofs run only when the live job asks for them, so a local shell with AI_LIVE_* exported
    // never makes paid calls.
    expect(test).toMatch(/const liveRun = allSecretsSet && process\.env\.AI_LIVE_REQUIRED === "1";/);
    expect(test).toMatch(/describe\.skipIf\(!liveRun\)/);
    expect(test).toMatch(/it\.runIf\(process\.env\.AI_LIVE_REQUIRED === "1"\)/);
    for (const s of SECRETS) expect(test, s).toContain(`"${s}"`);
  });

  // Every other workflow, ci.yml's unit job included (it runs the same test file, which must skip
  // there): none names the secrets or hands over every secret at once.
  it("is the only workflow that reads the AI_LIVE_ secrets", () => {
    expect(ALL_WORKFLOWS).toContain("ai-live.yml");
    for (const f of ALL_WORKFLOWS.filter((n) => n !== "ai-live.yml")) {
      const text = read(`.github/workflows/${f}`);
      expect(text, f).not.toMatch(/AI_LIVE_/);
      expect(text, f).not.toMatch(/tojson\(\s*secrets\s*\)|secrets:\s*inherit/i);
    }
  });
});
