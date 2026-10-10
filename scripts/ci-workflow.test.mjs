// @vitest-environment node
//
// Textual guard over .github/workflows/*.yml. There is no YAML parser in this repository and one is
// not added for this: the helpers read the fixed two-space layout these files are written in, and
// their own tests below pin what they accept and reject. actionlint (in the static job) is the
// structural check; this file pins the repository-specific rules actionlint cannot know.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_GROUPS, GATE_STEPS } from "./gate-local.mjs";
import { globalTimeoutFrom, MAX_GLOBAL_TIMEOUT_MS } from "../e2e/global-timeout.ts";
import {
  jobIds, jobBlock, unpinnedUses, topLevelBlock, requiredChecksFromDoc, pipedRunsWithoutBash,
} from "./ci-workflow-lib.mjs";
import { INSTALLER_DIR, installerName, expectedAssets } from "./release-publish-lib.mjs";

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

  it("has guard, build, publish, chained in that order", () => {
    expect(jobIds(RELEASE)).toEqual(["guard", "build", "publish"]);
    expect(jobBlock(RELEASE, "build")).toMatch(/^\s+needs: guard$/m);
    expect(jobBlock(RELEASE, "publish")).toMatch(/^\s+needs: \[guard, build\]$/m);
  });

  it("reads by default, and only publish can write", () => {
    expect(topLevelBlock(RELEASE, "permissions")).toEqual(["contents: read"]);
    for (const id of ["guard", "build"]) expect(jobBlock(RELEASE, id)).not.toMatch(/permissions:|: write/);
    const pub = jobBlock(RELEASE, "publish");
    expect(pub).toMatch(/permissions:\n\s+contents: write\n\s+id-token: write\n\s+attestations: write/);
  });

  it("publish runs in the release environment and installs no packages", () => {
    const pub = jobBlock(RELEASE, "publish");
    expect(pub).toMatch(/^\s+environment: release$/m);
    expect(pub).not.toMatch(/npm (ci|install|i )|npx /);
    expect(pub).toMatch(/npm run release:verify -- /);
    expect(pub).toMatch(/npm run release:publish -- /);
  });

  it("attests only on a public repository", () => {
    expect(jobBlock(RELEASE, "publish")).toMatch(/if: \$\{\{ !github\.event\.repository\.private \}\}\n\s+uses: actions\/attest-build-provenance@/);
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
});

// §215: the live-Turso specs against a dedicated throwaway database. Not a required check.
describe("live-turso.yml", () => {
  const LIVE = read(".github/workflows/live-turso.yml");
  workflowRules("live-turso.yml", LIVE);
  const check = jobBlock(LIVE, "check");
  const job = jobBlock(LIVE, "live-turso");
  const config = read("playwright.config.ts");
  const scripts = JSON.parse(read("package.json")).scripts;
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
  // database; a typo would also silently drop a spec. A live spec is one that imports
  // e2e/live-turso-env.ts or live-turso-schema.ts (any quoting, with or without .ts), or reads the
  // throwaway pair itself in CODE (process.env.TURSO_THROWAWAY_… or a quoted "TURSO_THROWAWAY_…",
  // as turso-revision-live does): a bare mention in a comment does not count. Each list is a plain
  // list of names, anchored to WHOLE file names, and matches exactly the listed files.
  it("runs exactly the live specs, each in one list, through the projects the npm scripts name", () => {
    const LIVE_READER = /["']\.\/live-turso-(env|schema)(\.ts)?["']|process\.env\.TURSO_THROWAWAY_|["']TURSO_THROWAWAY_/;
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
    // Listed before the branch that adds the file has merged. Each entry must NOT exist yet: the
    // tree that gains the file fails here until the entry is removed, so the full check below
    // applies to it from then on. turso-revision-live: verify/654-turso-guard; version-compare-live:
    // verify/version-compare-live; demo-trends-live: verify/696-demo-trends.
    const PENDING = ["turso-revision-live", "version-compare-live", "demo-trends-live"];
    for (const name of PENDING) {
      expect(existsSync(specFile(name)), `e2e/${name}.spec.ts exists now: remove "${name}" from PENDING`).toBe(false);
      expect([...destructive, ...appSpecs], `PENDING "${name}" is in neither list`).toContain(name);
    }
    // Each regex, as Playwright applies it (to a full path, either separator), matches exactly its
    // listed files that exist, and no file whose name merely ends in a listed name.
    const specs = readdirSync(new URL("../e2e/", import.meta.url)).filter((f) => f.endsWith(".spec.ts"));
    for (const [re, names] of [[destructiveRe, destructive], [appRe, appSpecs]]) {
      const hits = specs.filter((f) => re.test(`/repo/e2e/${f}`) || re.test(`C:\\repo\\e2e\\${f}`));
      expect(hits.map((f) => f.replace(/\.spec\.ts$/, "")).sort()).toEqual(names.filter((n) => !PENDING.includes(n)).sort());
      for (const n of names) expect(re.test(`/repo/e2e/old-${n}.spec.ts`), `${re} matches old-${n}`).toBe(false);
    }
    for (const name of [...destructive, ...appSpecs]) {
      if (PENDING.includes(name)) continue;
      expect(existsSync(specFile(name)), `${name}: no e2e/${name}.spec.ts`).toBe(true);
      expect(read(`e2e/${name}.spec.ts`), `${name} is not a live spec`).toMatch(LIVE_READER);
    }
    // live-turso-env.spec.ts tests the helper itself and needs no database.
    const readers = readdirSync(new URL("../e2e/", import.meta.url))
      .filter((f) => f.endsWith(".spec.ts") && f !== "live-turso-env.spec.ts")
      .filter((f) => LIVE_READER.test(read(`e2e/${f}`)))
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
