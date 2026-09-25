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
