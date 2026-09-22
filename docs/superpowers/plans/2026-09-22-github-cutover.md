# GitHub Cut-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub the only canonical home for the code, with GitLab reduced to a read-only copy that a daily scheduled job syncs in from GitHub.

**Architecture:** Part A adds three repository changes on the rewritten history's `chore/rewrite-history` branch: the sync job (`ci/gitlab-sync.yml`), the local merge gate (`npm run gate:local`) and the docs. Part B is the cut-over itself, eight operational steps in the spec's order, each with a guard before it and a server-side check after it. The owner performs every step that needs a credential or cannot be undone.

**Tech Stack:** git, git-filter-repo (only if a catch-up rewrite is needed), `gh` CLI, `glab` CLI, GitLab 19.4 CE CI, Node ESM scripts with vitest tests.

**Spec:** `docs/superpowers/specs/2026-09-22-github-cutover-design.md`

## Global Constraints

- Work happens in `C:\Projects\aipm-rewritten` (the rewritten history), never in an old-history clone, except where a task says to run `glab` from an old clone (its `origin` is GitLab).
- GitHub repository: `sebastianmaute/aipm-cockpit`, **private** throughout. Nothing in this plan makes anything public.
- Commits on the rewritten history carry **no** `Claude-Session:` trailer and use the author identity `Sebastian Maute <65776548+sebastianmaute@users.noreply.github.com>`.
- Never print or write into tracked text: the GitLab host, the GitLab group path, the old numeric project id, any token, any `git remote get-url` output. Redirect every `git push`/`fetch`/`ls-remote`/`clone` against a remote to a file under the scratchpad and print only its exit code; `git` prints remote addresses in `host:path` form that URL-shaped filters miss.
- Never `git add -A` / `git add .`; stage explicit paths. Never `--amend`. Never `npm ci`. Never read an exit code through a pipe. Never run two vitest processes at once.
- Never auto-merge. Merges only on the owner's explicit say.
- Sync schedule: `0 3 * * *`, timezone `Europe/Berlin`. CI config path on GitLab: `ci/gitlab-sync.yml`.
- `.gitlab-ci.yml` stays byte-identical (`release-publish-lib.test.mjs` reads it; sub-project 3 ports from it).
- Pushes into GitLab carry `-o ci.skip`.
- No releases and no tags are made during the CI gap.

## Review Focus

1. **Pushing the 5 rewritten tags into GitLab while its CI still reads `.gitlab-ci.yml`** would start the tag pipelines, which build and publish desktop releases. The CI config path must point at `ci/gitlab-sync.yml`, and the push must carry `-o ci.skip`, before any push into GitLab. Owned by Task 8, which checks both before pushing.
2. **Branch protection on a private repository may be unavailable** on a free GitHub personal plan. The expectation is that `main` is protected where the plan allows, and the gap is reported honestly where it does not. Owned by Task 7, which reads the plan first and branches on it.
3. **A `gate:local` step naming an npm script that was later renamed or removed** would fail with "missing script" and read as a broken gate. Expected: the drift is caught by a unit test, not on a merge day. Owned by Task 2 (`every npm step names a real script`).
4. **The sync job running with a token missing** must fail, not "succeed" by pushing nothing. Owned by Task 1 (`fails fast when a token is missing`).
5. **Deleting an old clone that still holds unpushed work.** Expected: the deletion refuses until every branch in every clone and worktree is contained in a remote. Owned by Task 10's guard script.

---

## Part A — repository changes (branch `chore/rewrite-history`, `C:\Projects\aipm-rewritten`)

### Task 1: The sync job

**Files:**
- Create: `ci/gitlab-sync.yml`
- Test: `scripts/gitlab-sync-config.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `ci/gitlab-sync.yml` with one job, `sync-from-github`, reading the CI variables `GITHUB_SYNC_TOKEN` and `GITLAB_SYNC_TOKEN` (set in Task 9).

- [ ] **Step 1: Write the failing test**

```js
// scripts/gitlab-sync-config.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const yml = readFileSync(fileURLToPath(new URL("../ci/gitlab-sync.yml", import.meta.url)), "utf8");
const lines = yml.split(/\r?\n/);

describe("ci/gitlab-sync.yml", () => {
  it("runs only on a schedule or the manual Run pipeline button", () => {
    const ifs = lines.filter((l) => /^\s*- if:/.test(l));
    expect(ifs).toHaveLength(2);
    expect(ifs.join("\n")).toContain('$CI_PIPELINE_SOURCE == "schedule"');
    expect(ifs.join("\n")).toContain('$CI_PIPELINE_SOURCE == "web"');
    expect(yml).toMatch(/^\s*- when: never\s*$/m);
  });

  it("force-updates branches, keeps tags unforced, prunes, and skips CI on GitLab", () => {
    const push = lines.find((l) => /git push/.test(l)) ?? "";
    expect(push).toContain("--prune");
    expect(push).toContain("-o ci.skip");
    expect(push).toContain("'+refs/heads/*:refs/heads/*'");
    expect(push).toContain("'refs/tags/*:refs/tags/*'");
    expect(push).not.toContain("'+refs/tags/");
  });

  it("never pushes every ref (a mirror clone of GitHub carries refs/pull/*)", () => {
    expect(yml).not.toMatch(/push[^\n]*--mirror/);
    expect(yml).not.toMatch(/refs\/\*:/);
  });

  it("fails fast when a token is missing", () => {
    expect(yml).toMatch(/test -n "\$GITHUB_SYNC_TOKEN"/);
    expect(yml).toMatch(/test -n "\$GITLAB_SYNC_TOKEN"/);
    expect(yml).toMatch(/exit 2/);
  });

  it("clears the image's git ENTRYPOINT so the script runs at all", () => {
    expect(yml).toMatch(/entrypoint: \[""\]/);
  });

  it("never echoes a token", () => {
    expect(lines.filter((l) => /echo/.test(l) && /TOKEN/.test(l))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/gitlab-sync-config.test.mjs > ../t.log 2>&1; echo EXIT=$?; grep -E "Test Files|Tests |Error" ../t.log`
Expected: EXIT=1, `ENOENT` for `ci/gitlab-sync.yml`.

- [ ] **Step 3: Pick the image tag.** Run `curl -s -o /dev/null -w "%{http_code}" https://hub.docker.com/v2/repositories/alpine/git/tags/v2.49.1`. If it prints 200, use `alpine/git:v2.49.1`. Otherwise list the tags with `curl -s "https://hub.docker.com/v2/repositories/alpine/git/tags?page_size=20" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).results.map(r=>r.name).join(' ')))"` and use the newest `v2.x.y` verbatim. Never `latest`.

- [ ] **Step 4: Write the file** (replace the image tag if Step 3 chose another):

```yaml
# GitLab is a READ-ONLY copy of GitHub (docs/superpowers/specs/2026-09-22-github-cutover-design.md).
# The GitLab project's CI configuration path points at THIS file, so none of the jobs in
# .gitlab-ci.yml ever run here. That file stays as the source sub-project 3 ports from.
#
# Once a day it mirror-clones GitHub and pushes branches and tags into this project:
# - branches are force-updated and pruned, so anything pushed here directly is overwritten;
# - `main` is protected with force push OFF, so a force-push to GitHub's main (which must never
#   happen) FAILS this job instead of silently rewriting GitLab: the failure mail is the alarm;
# - tags are pushed unforced, so a moved tag fails the job the same way;
# - `-o ci.skip` keeps the push from starting a pipeline.
# Tokens are masked, protected CI variables. The script is GitHub content: whoever can merge to
# GitHub main controls what runs with GITLAB_SYNC_TOKEN.

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
    - if: '$CI_PIPELINE_SOURCE == "web"'
    - when: never

sync-from-github:
  image:
    name: alpine/git:v2.49.1
    entrypoint: [""]   # the image's ENTRYPOINT is `git`, which would swallow the job script
  variables:
    GIT_STRATEGY: none
  script:
    - test -n "$GITHUB_SYNC_TOKEN" && test -n "$GITLAB_SYNC_TOKEN" || { echo "sync token variable missing" >&2; exit 2; }
    - git clone --quiet --mirror "https://x-access-token:${GITHUB_SYNC_TOKEN}@github.com/sebastianmaute/aipm-cockpit.git" github.git
    - cd github.git
    - git push --quiet --prune -o ci.skip "${CI_SERVER_PROTOCOL}://sync:${GITLAB_SYNC_TOKEN}@${CI_SERVER_HOST}:${CI_SERVER_PORT}/${CI_PROJECT_PATH}.git" '+refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
```

- [ ] **Step 5: Run the test.** Same command as Step 2. Expected: EXIT=0, 6 passed.

- [ ] **Step 6: Mutation check.** Delete `-o ci.skip` from the push line, re-run and expect exactly one failure. Restore the line, then run `git diff --stat` and expect only the new files.

- [ ] **Step 7: Commit**

```bash
git add ci/gitlab-sync.yml scripts/gitlab-sync-config.test.mjs
git commit -m "ci: add the daily GitHub-to-GitLab sync job (cut-over Task 1)"
```

---

### Task 2: `npm run gate:local`

**Files:**
- Create: `scripts/gate-local.mjs`
- Test: `scripts/gate-local.test.mjs`
- Modify: `package.json` (`scripts`, `scriptsDescriptions`)
- Modify: `CONTRIBUTING.md` (generated scripts table only, via `npm run docs:scripts`)

**Interfaces:**
- Produces: `GATE_STEPS: string[][]` (argv arrays) and `runGates(steps, run, log?) → { ok: boolean, failed: string | null, code: number }`, where `run(argv) → number | null` is the exit status.

- [ ] **Step 1: Write the failing test**

```js
// scripts/gate-local.test.mjs
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_STEPS, runGates } from "./gate-local.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("runGates", () => {
  it("runs every step in order when all pass", () => {
    const seen = [];
    const r = runGates([["a"], ["b"], ["c"]], (argv) => (seen.push(argv[0]), 0));
    expect(seen).toEqual(["a", "b", "c"]);
    expect(r).toEqual({ ok: true, failed: null, code: 0 });
  });

  it("stops at the first failure and returns its exit code", () => {
    const seen = [];
    const r = runGates([["a"], ["b"], ["c"]], (argv) => (seen.push(argv[0]), argv[0] === "b" ? 3 : 0));
    expect(seen).toEqual(["a", "b"]);
    expect(r).toEqual({ ok: false, failed: "b", code: 3 });
  });

  it("treats a step killed by a signal (null status) as a failure with code 1", () => {
    expect(runGates([["a"]], () => null)).toEqual({ ok: false, failed: "a", code: 1 });
  });
});

describe("GATE_STEPS", () => {
  it("every npm step names a real script", () => {
    const missing = GATE_STEPS.filter((s) => s[0] === "npm").map((s) => s[2]).filter((n) => !(n in pkg.scripts));
    expect(missing).toEqual([]);
  });

  it("typechecks and builds, first lint and last build", () => {
    expect(GATE_STEPS[0]).toEqual(["npm", "run", "lint"]);
    expect(GATE_STEPS).toContainEqual(["npx", "tsc", "--noEmit"]);
    expect(GATE_STEPS.at(-1)).toEqual(["npm", "run", "build"]);
  });

  it("is wired as npm run gate:local with a description", () => {
    expect(pkg.scripts["gate:local"]).toBe("node scripts/gate-local.mjs");
    expect(pkg.scriptsDescriptions["gate:local"]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** `npx vitest run scripts/gate-local.test.mjs > ../t.log 2>&1; echo EXIT=$?; grep -E "Test Files|Tests |Error" ../t.log`. Expected: EXIT=1, cannot resolve `./gate-local.mjs`.

- [ ] **Step 3: Implement** (no shebang: vitest imports it):

```js
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
```

- [ ] **Step 4: Wire it up.** In `package.json`, add `"gate:local": "node scripts/gate-local.mjs"` to `scripts`. Add to `scriptsDescriptions`: `"gate:local": "Run CI's blocking gates locally, in order, stopping at the first failure — the merge gate until GitHub Actions exists"`. Then run `npm run docs:scripts` to regenerate the table in `CONTRIBUTING.md`, and `npm run docs:scripts:check; echo EXIT=$?` (expect 0).

- [ ] **Step 5: Run the test.** Expected: EXIT=0, 6 passed. Then `npx eslint --max-warnings=0 scripts/gate-local.mjs scripts/gate-local.test.mjs; echo EXIT=$?` (expect 0).

- [ ] **Step 6: Mutation check.** Change `if (code !== 0)` to `if (code > 0)`, re-run and expect the signal test to fail. Restore it.

- [ ] **Step 7: Run it for real once**, and note the wall time: `npm run gate:local > ../gate.log 2>&1; echo EXIT=$?; tail -3 ../gate.log`. Expected: EXIT=0 and `gate:local PASS`. A red step here is a real finding: fix it or report it, never skip it.

- [ ] **Step 8: Commit**

```bash
git add scripts/gate-local.mjs scripts/gate-local.test.mjs package.json CONTRIBUTING.md
git commit -m "chore: add npm run gate:local, the merge gate until CI moves to GitHub (cut-over Task 2)"
```

---

### Task 3: Docs

**Files:**
- Modify: `AGENTS.md` (the "CI is GitLab" hard-constraint bullet)
- Modify: `CONTRIBUTING.md` (new "Working on GitHub" section before "## Pull request checklist"; one checklist line)
- Modify: `docs/RUNBOOK.md` (banner under "## Publishing a desktop release")
- Modify: `docs/AGENTS/ci.md` (banner after the header comment)
- Modify: `docs/superpowers/specs/2026-09-20-github-migration-roadmap.md` (three corrections)
- Modify: `docs/open-followups.md` (§200: one paragraph)

**Interfaces:**
- Consumes: `ci/gitlab-sync.yml` (Task 1), `npm run gate:local` (Task 2).

- [ ] **Step 1: AGENTS.md.** Read the bullet that starts `- **CI is GitLab** (not GitHub)`. Replace its opening sentence, up to and including the `docs/AGENTS/ci.md` link, with the text below, and keep everything after it (the gate descriptions still describe the pipeline being ported):

```markdown
- **GitHub is canonical; CI is between homes.** Since the cut-over
  (`docs/superpowers/specs/2026-09-22-github-cutover-design.md`), branches, pull requests and
  merges live on GitHub. The GitLab project is a READ-ONLY copy that a daily scheduled job syncs in
  (`ci/gitlab-sync.yml`), and it runs no other job. ★★★ Until migration sub-project 3 ports the
  pipeline to GitHub Actions, NO CI runs anywhere: `npm run gate:local` is the merge gate, and e2e
  with the axe gate, semgrep, the dependency audit and prod-smoke do not run at all. No releases
  and no tags until sub-project 5. The pipeline described next is the one being ported →
  [`docs/AGENTS/ci.md`](docs/AGENTS/ci.md).
```

- [ ] **Step 2: CONTRIBUTING.md.** Insert before `## Pull request checklist`:

```markdown
## Working on GitHub

GitHub (`sebastianmaute/aipm-cockpit`) is the only place changes land. The GitLab project is a
read-only copy synced from GitHub once a day; never push to it, and do not open merge requests
there. Its issues stay in use until they migrate to GitHub.

Remotes in a fresh clone:

    git remote -v            # origin = GitHub
    git remote add gitlab <gitlab-url>           # only for glab (issues)
    git remote set-url --push gitlab DISABLED    # makes an accidental push fail

A change lands like this:

1. Push the branch to `origin` and open a pull request (`gh pr create`).
2. Run `npm run gate:local`. There is no CI until the pipeline is ported to GitHub Actions, so
   this is the gate. It stops at the first failure; do not merge on red.
3. Merge with a merge commit (`gh pr merge --merge`); squash and rebase merging are disabled so
   the history keeps the shape the commit citations rely on. Never enable auto-merge.

No releases and no tags are made until releasing moves to GitHub Releases.
```

Then add as the first checklist item under `## Pull request checklist`: `- [ ] \`npm run gate:local\` passes (the merge gate until CI runs on GitHub).`

- [ ] **Step 3: RUNBOOK.** Directly under `## Publishing a desktop release`, insert:

```markdown
> ★★★ **Paused.** This section describes the GitLab release pipeline. Since the GitHub cut-over
> (`docs/superpowers/specs/2026-09-22-github-cutover-design.md`) GitLab runs only its sync job,
> so pushing a tag publishes nothing. Releasing returns with migration sub-project 5 (GitHub
> Releases). Until then, make no release tags.
```

- [ ] **Step 4: ci.md.** After the header comment's closing `-->`, insert:

```markdown
> ★★★ **This pipeline no longer runs.** Since the GitHub cut-over the GitLab project reads its CI
> configuration from `ci/gitlab-sync.yml` and runs only the daily sync. Everything below describes
> `.gitlab-ci.yml` as the source that migration sub-project 3 ports to GitHub Actions. Until that
> lands, `npm run gate:local` is the merge gate.
```

- [ ] **Step 5: Roadmap.** Three edits, each dated:
  - `| Scope | Leave GitLab entirely — not a mirror, not a partial split |` → `| Scope | GitHub fully canonical; GitLab kept as a read-only copy synced in from GitHub daily (changed 2026-09-22; was "leave GitLab entirely") |`
  - `| Commit identity | A personal address owned by the author |` → `| Commit identity | The author's GitHub users.noreply address (changed 2026-09-22 during the rewrite; was "a personal address") |`
  - The ★ paragraph beginning `**The identity choice carries a permanent cost**`: replace it with `★ **Identity, as executed:** the rewrite mapped every author and committer to the GitHub \`users.noreply\` address (decided 2026-09-22), so no working mailbox is published. The earlier choice of a personal address, and the harvesting cost it accepted, no longer apply.`
  - In the open-questions table, set the "personal address" row's status to `**decided 2026-09-22:** GitHub \`users.noreply\``.

- [ ] **Step 6: §200.** At the end of its Status paragraph, add: `Sub-project 2 (\`docs/superpowers/specs/2026-09-22-github-cutover-design.md\`) publishes only the rewritten history, to a private GitHub repository recreated empty for it; the entry closes at the visibility flip, not before.`

- [ ] **Step 7: Gates, unpiped, each expecting 0:** `docs:symbols:check`, `docs:claims:check`, `docs:scripts:check`, `followups:status:check`, `followups:index:check`, `followups:workitems:check`, and `LEAK_LIST_FILE="$HOME/.config/aipm-cockpit/leak-list.txt" npm run leaks:check`.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md CONTRIBUTING.md docs/RUNBOOK.md docs/AGENTS/ci.md docs/superpowers/specs/2026-09-20-github-migration-roadmap.md docs/open-followups.md
git commit -m "docs: repoint the process docs at GitHub for the cut-over (cut-over Task 3)"
```

---

## Part B — the cut-over (owner present; spec steps 0–8)

`SP` below means the session scratchpad directory; `<rw>` is the directory holding the sub-project 1
mirrors (`original.git`, `rewritten.git`). `CFG` is `~/.config/aipm-cockpit/cutover`: after Task 4
Step 1 every list the plan names (`$CFG/allow.txt`, `$CFG/replacements.txt`, `$CFG/mailmap.txt`,
`$CFG/commit-map`, `$CFG/original.bundle`) is read from there, never from `<rw>`. Every remote command
writes to a log under `$SP/cutover/` and prints only `EXIT=`.

### Task 4: Backups, freeze and catch-up (spec steps 0–2)

**Files:** none tracked. Creates `~/.config/aipm-cockpit/cutover/`.

- [ ] **Step 1: Back up the original history.** From the old clone `C:\Projects\aipm-wt-a`, run `git fetch -q origin > "$SP/cutover/fetch.log" 2>&1; echo EXIT=$?`. Then:
  - Bundle every ref of the original mirror: `git -C "<rw>/original.git" bundle create "$CFG/original.bundle" --all`, then `git bundle verify` it and expect "is okay".
  - Record the old GitLab `main` hash: `git rev-parse origin/main > ~/.config/aipm-cockpit/cutover/gitlab-main-before.txt`.
  - Copy `replacements.txt`, `mailmap.txt` and `allow.txt` from `<rw>` to `~/.config/aipm-cockpit/cutover/`, and `commit-map` from `<rw>/rewritten.git/filter-repo/`.

- [ ] **Step 2: Freeze.** Tell the owner the freeze has started: no commits to GitLab from any session from now on. List every local branch that is ahead of `origin/main` in every old clone and worktree (`git worktree list`, then `git rev-list --count origin/main..<branch>` for each branch). Today the known one is `feat/timelog-booking-review-tl1` (2 ahead). For each, the owner rules: merge it on GitLab first (before the freeze closes), replay it (Step 4), or drop it.

- [ ] **Step 3: Has GitLab moved?** `git merge-base --is-ancestor origin/main 2f2a279ee` plus `git rev-parse origin/main`. If `origin/main` still equals `2f2a279ee`, skip to Step 4. Otherwise, do a catch-up rewrite:
  1. Make a fresh `git clone --no-local --mirror` of GitLab, and a second one kept untouched as the new original.
  2. Run `scripts/rewrite-history/run.sh <new-mirror> <replacements> <mailmap>`.
  3. Run `verify-rewrite` twice: `--expect dirty` on the new original and `--expect clean --allow "$CFG/allow.txt"` on the new mirror. Both must PASS.
  4. In `C:\Projects\aipm-rewritten`, create a branch from the new rewritten `main`. Replay every `chore/rewrite-history` commit onto it **except** `docs: remap commit citations …`, using the Step 4 procedure.
  5. Re-run `node scripts/remap-commit-citations.mjs --old <new-original> --map <new-mirror>/filter-repo/commit-map --write` and commit its output, with the message of the dropped commit and the new counts.
  6. That branch replaces `chore/rewrite-history`.

- [ ] **Step 4: Replay procedure** (for each branch the owner chose to replay):
  1. From the old clone, run `git format-patch -o "$SP/cutover/patches/<branch>" origin/main..<branch>`.
  2. In each patch, replace the `From:` line with the noreply identity and delete `Claude-Session:` lines. Use a node script with latin1 read/write; never `sed -i`.
  3. In `C:\Projects\aipm-rewritten`, create a branch from `main` and run `git am --keep-cr` on the patches.
  4. Check: `git rev-parse <old-branch>^{tree}` (old clone) must equal `git rev-parse HEAD^{tree}` (new clone). This holds because both `main` trees are identical; a mismatch means STOP.

- [ ] **Step 5: Positive control.** Run `LEAK_LIST_FILE=… node scripts/verify-rewrite.mjs --repo C:/Projects/aipm-rewritten --allow "$CFG/allow.txt" --expect clean` and expect PASS. This covers every branch about to be published.

### Task 5: Remove the GitLab → GitHub push mirror (spec step 3)

- [ ] **Step 1:** From the old clone, run `glab api "projects/:id/remote_mirrors" > "$SP/cutover/mirrors.json" 2>&1; echo EXIT=$?`. Then print only `id`, `enabled` and `only_protected_branches` per entry. Expect exactly 1.
- [ ] **Step 2:** Run `glab api -X DELETE "projects/:id/remote_mirrors/<id>" > "$SP/cutover/mirror-del.log" 2>&1; echo EXIT=$?`.
- [ ] **Step 3:** Re-run Step 1. Expect `[]`, 0 entries. ★★ Task 6 must not start before this reads 0.

### Task 6: Recreate the GitHub repository (spec step 4, owner-run, irreversible)

- [ ] **Step 1: Guard.** Run `gh auth status > "$SP/cutover/gh.log" 2>&1; echo EXIT=$?`, expecting 0. Then read these counts with `gh api` and print only the numbers:
  - pull requests: `repos/sebastianmaute/aipm-cockpit/pulls?state=all`, length
  - issues: `…/issues?state=all`, length
  - releases: `…/releases`, length
  - forks: `.forks_count`
  - wiki: `.has_wiki`
  - branches: `…/branches`, names

  Every count must be 0, except a branch list containing only `main`. Any other number means STOP: the owner decides first.
- [ ] **Step 2: Owner runs** (it needs the `delete_repo` scope, which this session does not use):

```bash
gh auth refresh -h github.com -s delete_repo
gh repo delete sebastianmaute/aipm-cockpit --yes
gh repo create sebastianmaute/aipm-cockpit --private --disable-wiki
```

- [ ] **Step 3: Verify it is empty and private:** `gh api repos/sebastianmaute/aipm-cockpit --jq '[.private, .size]'` must print `[true,0]`, and `gh api repos/sebastianmaute/aipm-cockpit/branches --jq length` must print `0`.

### Task 7: Push, configure and verify GitHub (spec step 5)

- [ ] **Step 1: Push `main` and tags** from `C:\Projects\aipm-rewritten`:
  1. `git remote add github https://github.com/sebastianmaute/aipm-cockpit.git`
  2. `git push github main:main > "$SP/cutover/push-main.log" 2>&1; echo EXIT=$?`
  3. Push only the 5 rewritten tags, by name. List them from `git tag`, then run `git push github <tag>…`, logged the same way.
- [ ] **Step 2: Merge settings:** `gh api -X PATCH repos/sebastianmaute/aipm-cockpit -F allow_merge_commit=true -F allow_squash_merge=false -F allow_rebase_merge=false -F delete_branch_on_merge=true -F allow_auto_merge=false > "$SP/cutover/settings.log" 2>&1; echo EXIT=$?`.
- [ ] **Step 3: Branch protection.** Read the plan with `gh api user --jq .plan.name`.
  - If protection is available, `gh api -X PUT repos/sebastianmaute/aipm-cockpit/branches/main/protection --input <file>` with this body:
    ```json
    {"required_status_checks": null, "enforce_admins": true, "required_pull_request_reviews": {"required_approving_review_count": 0}, "restrictions": null, "allow_force_pushes": false, "allow_deletions": false}
    ```
  - If it answers 403 "Upgrade to GitHub Pro or make this repository public", record that in the task report and tell the owner: `main` is unprotected until the visibility flip or a plan upgrade, and "changes via pull request" is convention only.
- [ ] **Step 4: Verify the server, not the local clone.** Run `git clone --mirror https://github.com/sebastianmaute/aipm-cockpit.git "$SP/cutover/gh-mirror.git"` (logged). Then:
  - `verify-rewrite --repo "$SP/cutover/gh-mirror.git" --allow "$CFG/allow.txt" --expect clean` → PASS.
  - `git clone "$CFG/original.bundle" "$SP/cutover/orig-from-bundle.git" --mirror`, then `verify-rewrite --repo "$SP/cutover/orig-from-bundle.git" --expect dirty` → PASS, with nonzero counts. This is the positive control.
  - Commit count: `git -C gh-mirror.git rev-list --count main` equals the same count on the local `main`. Tag count equals 5.
  - Tree: `git -C gh-mirror.git rev-parse main^{tree}` equals the old clone's `git rev-parse origin/main^{tree}` (`d6662657ae96a3fe1ff32efb43325cd2986a82a6` unless Task 4 Step 3 ran).
  - A checkout of the mirror: `leaks:check` → 0.
- [ ] **Step 5: First pull request.**
  1. `git push github chore/rewrite-history` (logged).
  2. Run `gh pr create --base main --head chore/rewrite-history`. Title: `Sanitise tail, cut-over tooling and docs`. Body: the branch's commit list, and no session link.
  3. `C:\Projects\aipm-rewritten\node_modules` is a junction into the old clone, and Turbopack refuses
     it (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`), so
     `build` (gate step 14) fails there. Replace it with a real install: `cmd /c rmdir node_modules`
     (removes the junction only — never `Remove-Item -Recurse`, which can follow it and empty the old
     clone's modules); confirm `C:\Projects\aipm-wt-a\node_modules` still has content; `npm install`
     (never `npm ci`).
  4. Run `npm run gate:local` → must end `gate:local PASS`.
  5. **Stop and ask the owner to say "merge".** Then run `gh pr merge --merge` with no `--auto`.
  6. Re-check: `gh api repos/sebastianmaute/aipm-cockpit/commits/main --jq .sha` equals `git rev-parse github/main` after a fetch.
- [ ] **Step 6: If the merge settings from Step 2 could not be applied** (squash and/or rebase merging
      still enabled), correct CONTRIBUTING.md's "squash and rebase merging are disabled" sentence
      (`Working on GitHub`, step 3) on the PR branch before merging, so the doc matches what GitHub
      actually allows.

### Task 8: Load the rewritten history into GitLab (spec step 6)

Run the `glab` commands from the old clone (its `origin` is GitLab). Push from `C:\Projects\aipm-rewritten` after `git fetch github`.

- [ ] **Step 1: Stop GitLab from running the old pipeline before anything arrives.** Run `glab api -X PUT "projects/:id" -f ci_config_path=ci/gitlab-sync.yml -f merge_requests_access_level=disabled` (logged). Re-read `projects/:id` and print only `ci_config_path` and `merge_requests_access_level`. Expect `ci/gitlab-sync.yml disabled`. ★★★ This must precede Step 3: the 5 tags would otherwise start release pipelines.
- [ ] **Step 2: Allow force push once:** `glab api -X PATCH "projects/:id/protected_branches/main" -f allow_force_push=true` (logged). Re-read it and expect `true`.
- [ ] **Step 3: Push.** Add the GitLab remote to `C:\Projects\aipm-rewritten` without printing it:
  ```bash
  git remote add gitlab "$(git -C C:/Projects/aipm-wt-a remote get-url origin)"
  git remote set-url --push gitlab DISABLED
  ```
  For this task only, push with an explicit URL variable that is never echoed:
  ```bash
  GL=$(git -C C:/Projects/aipm-wt-a remote get-url origin)
  git push --force -o ci.skip "$GL" github/main:refs/heads/main > "$SP/cutover/gl-main.log" 2>&1; echo EXIT=$?
  git push --force -o ci.skip "$GL" <the 5 tags as refs/tags/X:refs/tags/X> > "$SP/cutover/gl-tags.log" 2>&1; echo EXIT=$?
  ```
- [ ] **Step 4: Re-protect:** `-f allow_force_push=false`. Re-read it and expect `false`.
- [ ] **Step 5: Verify.**
  - `git ls-remote "$GL" refs/heads/main` and `git ls-remote github refs/heads/main`, both redirected to files. A node one-liner compares the hashes and prints only `EQUAL` or `DIFFER`. Expect `EQUAL`.
  - GitLab's pipeline list since Step 3 is empty: `glab api "projects/:id/pipelines?updated_after=<Step 3 time ISO>" --jq length` → `0`.

### Task 9: Configure and prove the sync (spec step 7)

- [ ] **Step 1: Owner creates the two tokens in the web UIs.** This session never sees the values.
  - GitHub fine-grained token: repository `sebastianmaute/aipm-cockpit` only, Contents read-only, one year expiry.
  - GitLab project access token: role Maintainer, scope `write_repository`, one year expiry.
  - The owner adds both as project CI variables `GITHUB_SYNC_TOKEN` and `GITLAB_SYNC_TOKEN`: masked, protected, not expanded.
  - Verify by name only: `glab api "projects/:id/variables" --jq '[.[] | {key, masked, protected}]'` shows both with `masked: true, protected: true`.
- [ ] **Step 2: Schedule:** `glab api -X POST "projects/:id/pipeline_schedules" -f description="daily sync from GitHub" -f ref=main -f cron="0 3 * * *" -f cron_timezone=Europe/Berlin -f active=true` (logged). Record the schedule id.
- [ ] **Step 3: Proof, positive control first.**
  1. `git push github main:refs/heads/sync-probe` (logged).
  2. Run the schedule now: `glab api -X POST "projects/:id/pipeline_schedules/<id>/play"`. Poll its latest pipeline until `success`, or `failed` (STOP).
  3. `git ls-remote "$GL" refs/heads/sync-probe` must return one line.
  4. `git push github :refs/heads/sync-probe`, play again, and the same ls-remote must return nothing.
  5. Re-run the Task 8 Step 5 hash comparison → `EQUAL`.

### Task 10: Re-clone and retire the old clones (spec step 8)

**Files:** none tracked. Creates `$SP/cutover/retire-guard.mjs`.

- [ ] **Step 1: Guard script.** It takes a list of paths and runs `git fsck --no-dangling` in each. It then judges every local branch, and every worktree's HEAD, by which history the clone is on:
  - **Old-history clones** (`C:\Projects\aipm-cockpit` and its worktrees, `C:\Projects\aipm-wt-a`). Do NOT fetch: after Task 8, fetching would move `origin/main` onto the rewritten history and make every old branch look unpushed. A tip is SAFE when `git -C "$SP/cutover/orig-from-bundle.git" cat-file -e <sha>^{commit}` succeeds, because the backup holds it. Otherwise it HOLDS unpushed work, which the owner replays (Task 4 Step 4) or drops.
  - **Rewritten-history clones** (`C:\Projects\aipm-rewritten`). Run `git fetch github -q` (logged); a branch is SAFE when `git branch -r --contains <branch>` lists a `github/` ref.
  - Output per path: `<path> SAFE`, or `<path> HOLDS <n> unpushed branch(es): <branch names>`. It never prints a remote URL. Write it to `$SP/cutover/retire-guard.mjs` and run it with `node`.
- [ ] **Step 2: Re-clone.**
  1. Rename `C:\Projects\aipm-cockpit` to `C:\Projects\aipm-cockpit.old-gitlab`.
  2. `git clone https://github.com/sebastianmaute/aipm-cockpit.git C:\Projects\aipm-cockpit` (logged).
  3. Add the `gitlab` remote as in Task 8 Step 3, with the push URL `DISABLED`.
  4. Set the noreply identity in local config, then `npm install` (never `npm ci`).
  5. `npm run gate:local` → EXIT=0.
- [ ] **Step 3: glab in the new clone.** Run `glab issue list --per-page 1 > "$SP/cutover/glab.log" 2>&1; echo EXIT=$?`. If it fails because glab resolves `origin` (GitHub), set glab's host with `glab config set -h <gitlab host> …`, taken from the remote URL inside a variable and never echoed, then re-check. Also `npm run followups:gitlab:check; echo EXIT=$?`.
- [ ] **Step 4: Owner decides deletion.** Present the guard output. Old directories are deleted only on the owner's explicit say, and only those marked SAFE, with `Remove-Item -Recurse -Force`.
- [ ] **Step 5: Memory.** Update the memory files that describe the GitLab flow (`release-merge-on-green`, `gitlab-ci-and-ops`, `mr-only-on-explicit-say`, and the sanitise-phase-a entry) to: GitHub canonical, `gh pr` flow, `gate:local`, no releases in the gap, GitLab read-only with a daily sync.
