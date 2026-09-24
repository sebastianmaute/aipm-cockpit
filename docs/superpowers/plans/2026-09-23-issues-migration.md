# Issues migration (sub-project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and rehearse the tooling that, at the visibility flip, imports the 268 open GitLab issues into the fresh GitHub repository with their GitLab numbers preserved, closes them on GitLab with a pointer, and checks the register against GitHub weekly.

**Architecture:**
- A pure library plans one action per issue number: open issue, closed stub, or placeholder. It generates each body from the register and leak-scans the whole plan.
- An orchestration module applies a plan through an injected GitHub client. It verifies every assigned number and deletes placeholders last, so a resume is simple.
- A thin CLI wires the real clients: `gh auth token` + `fetch` for GitHub, `glab api` for GitLab.
- The GitLab sync check is ported to GitHub over a tracker-neutral comparison, and stays dormant until a repository variable switches it on.

**Tech Stack:** Node 24 ESM scripts (`scripts/*.mjs`, no dependencies beyond the repo's own libs), vitest 4, GitHub REST + GraphQL, `glab` CLI, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-23-issues-migration-design.md`

## Global Constraints

- **Numbers:** issue #N on GitHub = issue #N on GitLab. Actions run for N = 1 … M in order, where M is GitLab's highest issue number at plan time.
- **Imported:** only OPEN GitLab issues, as title + body + labels. No comments.
- **Imported issue text:** generated from the register entry. Never copied from GitLab.
- **Closed GitLab issue:** a closed stub, titled `GitLab #N, closed before the migration`, with no GitLab text.
- **Never-used number:** a placeholder, deleted after all creates.
- **Imported title:** `§N: <register heading without its trailing " — open">`, at most 256 characters.
- **Imported body:** capped at 20,000 characters, and a cut is marked as a cut.
- **Leak guard:** any leak-list hit in any planned title or body means `--plan` exits 1, and `--apply` refuses the plan. No bypass flag exists.
- **Target guard:** `--apply` refuses a target with any PR, and refuses one with any issue unless `--resume` is given.
- **Stale-plan guard:** `--apply` refuses a plan whose `registerSha` differs from `git hash-object docs/open-followups.md`, or whose `maxNumber` is below GitLab's current highest issue number.
- **Exit codes:**
  - importer: 0 ok · 1 refused (with a precise reason) · 2 could not run;
  - sync check: 0 in sync or skipped · 1 drift · 2 could not compare.
- **Sync check switch:** it runs only when the repository variable `REGISTER_TRACKER` is `github`. Otherwise it prints `skipped: REGISTER_TRACKER is not "github" — issues are not on GitHub yet.` and exits 0.
- **Repo rules:** `.superpowers/sdd/2026-09-23-github-actions-ci/repo-rules.md` applies to every task. The rules most often broken:
  - NO `Claude-Session:` or other attribution trailer in any commit;
  - never read an exit code through a pipe;
  - one vitest process at a time;
  - `scripts/*.mjs` imported by tests carry no shebang;
  - never print leak-list contents.
- **No live GitHub or GitLab writes, except in Task 9, and only after the owner's explicit go.** Tests use fakes and fixtures only.

## Review Focus

1. **A PR, or a stray issue, exists in the target before `--apply`.** Expect a refusal (exit 1) naming the counts, before any write. Tested in Task 4.
2. **The run dies mid-way** (network error, Ctrl-C, rate limit). `--resume` must continue from the highest existing number, and must verify every existing number against the plan first. Tested in Task 4.
3. **GitHub assigns an unexpected number** (a concurrent create by someone else). Expect a stop at once with the expected/actual pair, and no further write. Tested in Task 4.
4. **An open GitLab issue whose `§N` has no OPEN register entry,** for example an entry closed without closing the issue. `planImport` must throw naming both numbers; importing a pointer to a closed entry is wrong. Tested in Task 3.
5. **The GitHub issues endpoint returns pull requests mixed with issues.** The sync check must drop them. A PR titled `§N: …` must never read as a register issue. Tested in Task 7.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/followup-workitem-lib.mjs` (modify) | `compareWithGitLab` → `compareWithTracker`; `GITLAB_PROBLEM_HELP` → `TRACKER_PROBLEM_HELP`, worded for either tracker. |
| `scripts/issue-import-lib.mjs` (create) | Pure: `parseIndexAnchors`, `entryTitle`, `issueBody`, `stubIssue`, `planImport`, `leakCheckPlan`. |
| `scripts/issue-import-apply.mjs` (create) | Orchestration against an injected client: `applyPlan`, `closeOnGitLab`, `RateLimited`, `Refused`. |
| `scripts/github-issues-lib.mjs` (create) | Pure GitHub REST helpers: `parseNextLink`, `toTrackerIssue`. |
| `scripts/import-issues.mjs` (create) | CLI: `--plan`, `--apply`, `--resume`, `--close-gitlab`; the real GitHub/GitLab clients. |
| `scripts/check-followup-github.mjs` (create) | The weekly sync check against GitHub. |
| tests beside each | `*.test.mjs` |
| `.github/workflows/scheduled.yml` (modify) | The `register-sync` job. |
| `package.json`, `CONTRIBUTING.md` | npm scripts (`issues:import`, `followups:github:check`) + regenerated table. |
| `docs/AGENTS/ci.md`, the roadmap, the flip checklist, §200 | Docs. |

---

### Task 1 (controller only): measure how GitHub shows the register, and choose the pointer style

**Files:** none (a ledger entry only).

- [ ] **Step 1:** Open `https://github.com/sebastianmaute/aipm-cockpit/blob/main/docs/open-followups.md#614-use-weight-suggestionstesttsx-is-order-dependent--its-shared-mock-is-never-reset--closed-2026-09-23` in the owner's logged-in browser, or ask the owner to. Record whether GitHub:
  - (a) renders the Markdown and scrolls to the heading;
  - (b) shows "file too large" or raw text only.
- [ ] **Step 2:** Record the ruling in the ledger: `POINTER_STYLE = "anchor"` for (a), `"search"` for (b). Task 3 takes it as a parameter, so no code waits on this.

---

### Task 2: make the comparison tracker-neutral

**Files:**
- Modify: `scripts/followup-workitem-lib.mjs` (`compareWithGitLab`, `GITLAB_PROBLEM_HELP`, `VIOLATION_HELP.MISSING`/`ON_CLOSED`/`ISSUE_REUSED`)
- Modify: `scripts/check-followup-gitlab.mjs` (its import and the two call sites)
- Modify: `scripts/followup-workitem-lib.test.mjs`
- Modify: `docs/AGENTS/ci.md` (the one line naming `compareWithGitLab`)

**Interfaces:**
- Produces: `compareWithTracker(entries, issues) → { problems: {code, detail}[], counts }` (the same body as today) and `TRACKER_PROBLEM_HELP: Record<code, string>`.

- [ ] **Step 1: Rename in the test first.** In `scripts/followup-workitem-lib.test.mjs`, replace every `compareWithGitLab` with `compareWithTracker` and every `GITLAB_PROBLEM_HELP` with `TRACKER_PROBLEM_HELP`, including the `describe(...)` title. Add:

```js
  it("words its help for either tracker", () => {
    for (const text of Object.values(TRACKER_PROBLEM_HELP)) expect(text).not.toMatch(/GitLab/);
    for (const text of Object.values(VIOLATION_HELP)) expect(text).not.toMatch(/GitLab/);
  });
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run scripts/followup-workitem-lib.test.mjs --reporter=dot > "$SP/t2-red.log" 2>&1; echo "EXIT=$?"`. Expected: EXIT=1 (the import of `compareWithTracker` is undefined).
- [ ] **Step 3: Rename in the lib.** Rename the function and the constant. Replace the GitLab-specific wording:
  - `ISSUE_NOT_OPEN`: `"the issue was closed or the number is wrong: reopen it, or close the entry, or fix the number"`
  - `VIOLATION_HELP.MISSING`: `` "add `**Work item:** #NN` after the Status block, creating the tracker issue in the same change, or `**Work item:** none — decision record`" ``
  - `VIOLATION_HELP.ON_CLOSED`: `` "a closed entry carries no `**Work item:**` line; delete it and close the tracker issue" ``
  - `VIOLATION_HELP.ISSUE_REUSED`: `"one tracker issue per open entry; create a separate issue for one of them, or merge the entries"`
  - The doc comment: "the OPEN tracker issues (GitLab or GitHub)".
- [ ] **Step 4: Update `check-followup-gitlab.mjs`.** Change the import to `const { compareWithTracker, TRACKER_PROBLEM_HELP } = await import("./followup-workitem-lib.mjs");` and both uses. Its header comment's two `compareWithGitLab` mentions become `compareWithTracker`. In `docs/AGENTS/ci.md`, change `compareWithGitLab` to `compareWithTracker`.
- [ ] **Step 5: Run it and see it pass.**
  - `npx vitest run scripts/followup-workitem-lib.test.mjs scripts/check-followup-gitlab.integration.test.mjs --reporter=dot > "$SP/t2-green.log" 2>&1; echo "EXIT=$?"`. Expected: EXIT=0, and `Test Files  2 passed`.
  - Then `git grep -n "compareWithGitLab\|GITLAB_PROBLEM_HELP"`. Expected: no output (exit 1).
  - Then `npm run docs:symbols:check`: EXIT=0.
- [ ] **Step 6: Commit.** `git add scripts/followup-workitem-lib.mjs scripts/followup-workitem-lib.test.mjs scripts/check-followup-gitlab.mjs docs/AGENTS/ci.md && git commit -m "refactor: make the register-vs-issues comparison tracker-neutral"`

---

### Task 3: the pure import planner

**Files:**
- Create: `scripts/issue-import-lib.mjs`
- Test: `scripts/issue-import-lib.test.mjs`

**Interfaces:**
- Consumes:
  - `parseEntries(text) → {n, title, startLine, body: string[]}[]` and `isClosed(title)` from `./followup-claims-lib.mjs`;
  - `issueSection(title) → number|null` from `./followup-workitem-lib.mjs`;
  - `scanMessage(text, patterns) → {hitLines, trailerLines, classes}` from `./identifier-leak-lib.mjs`.
- Produces:
  - `parseIndexAnchors(registerText) → Map<number, string>`
  - `entryTitle(entry) → string`
  - `issueBody(entry, {n, repoUrl, pointerStyle, anchor, date}) → string`
  - `stubIssue(gitlabIssue) → {title, body}`
  - `planImport(gitlabIssues, registerText, {repoUrl, pointerStyle, date}) → Action[]`, where `Action = {n, kind: "open"|"stub"|"placeholder", title, body, labels: string[]}`
  - `leakCheckPlan(actions, patterns) → {hitLines, classes, actionsHit: number[]}`
  - constants `STUB_TITLE_RE`, `PLACEHOLDER_TITLE = "placeholder (deleted after import)"`, `BODY_CAP = 20000`, `TITLE_CAP = 256`

- [ ] **Step 1: Write the failing tests.** Create `scripts/issue-import-lib.test.mjs`:

```js
// Unit tests for the issue-import planner. Synthetic registers and a synthetic leak
// list only — never the real list.
import { describe, expect, it } from "vitest";
import {
  BODY_CAP,
  PLACEHOLDER_TITLE,
  TITLE_CAP,
  entryTitle,
  issueBody,
  leakCheckPlan,
  parseIndexAnchors,
  planImport,
  stubIssue,
} from "./issue-import-lib.mjs";
import { buildPatterns } from "./identifier-leak-lib.mjs";

const REG = [
  "# Open follow-ups",
  "",
  "<!-- INDEX:BEGIN -->",
  "| [§3](#3-three--open) | three — open | x | S | open |",
  "| [§4](#4-four--closed-2026-09-01) | four — CLOSED 2026-09-01 | x | S | closed |",
  "<!-- INDEX:END -->",
  "",
  "## 3. Three — open",
  "",
  "**Status:** open 2026-09-20 — measured once.",
  "",
  "**Work item:** #3",
  "",
  "First paragraph of three.",
  "",
  "Second paragraph.",
  "",
  "## 4. Four — CLOSED 2026-09-01",
  "",
  "**Status:** CLOSED 2026-09-01.",
  "",
].join("\n");
const OPTS = { repoUrl: "https://github.com/o/r", pointerStyle: "anchor", date: "2026-09-30" };
const gl = (iid, state, title, labels = ["source::register"]) => ({ iid, state, title, labels });

describe("parseIndexAnchors", () => {
  it("maps each index row's § to its anchor", () => {
    const m = parseIndexAnchors(REG);
    expect(m.get(3)).toBe("3-three--open");
    expect(m.get(4)).toBe("4-four--closed-2026-09-01");
    expect(m.size).toBe(2);
  });
});

describe("entryTitle", () => {
  it("drops the trailing open marker and prefixes §N", () => {
    expect(entryTitle({ n: 3, title: "Three — open" })).toBe("§3: Three");
  });
  it("caps at TITLE_CAP characters", () => {
    expect(entryTitle({ n: 3, title: "x".repeat(400) + " — open" }).length).toBe(TITLE_CAP);
  });
});

describe("issueBody", () => {
  const entry = {
    n: 3,
    title: "Three — open",
    body: ["", "**Status:** open 2026-09-20 — measured once.", "", "**Work item:** #3", "", "First paragraph of three.", "", "Second paragraph."],
  };
  it("carries the pointer, the status, the first paragraph and the footer — and not the second paragraph", () => {
    const b = issueBody(entry, { ...OPTS, n: 3, anchor: "3-three--open" });
    expect(b).toContain("https://github.com/o/r/blob/main/docs/open-followups.md#3-three--open");
    expect(b).toContain("**Status:** open 2026-09-20 — measured once.");
    expect(b).toContain("First paragraph of three.");
    expect(b).not.toContain("Second paragraph.");
    expect(b).not.toContain("**Work item:**");
    expect(b).toContain("Imported from GitLab #3 on 2026-09-30.");
  });
  it("uses the search pointer when the register cannot be linked by anchor", () => {
    const b = issueBody(entry, { ...OPTS, pointerStyle: "search", n: 3, anchor: "3-three--open" });
    expect(b).not.toContain("#3-three--open");
    expect(b).toContain("search for `## 3.`");
  });
  it("caps the body and marks the cut", () => {
    const long = { ...entry, body: ["**Status:** " + "y".repeat(BODY_CAP * 2)] };
    const b = issueBody(long, { ...OPTS, n: 3, anchor: "a" });
    expect(b.length).toBeLessThanOrEqual(BODY_CAP);
    expect(b).toContain("(cut — read the full entry in the register)");
  });
});

describe("stubIssue", () => {
  it("names the closed entry when the GitLab title carries §N, and copies no GitLab text", () => {
    const s = stubIssue(gl(40, "closed", "§12: some internal words"));
    expect(s.title).toBe("GitLab #40, closed before the migration");
    expect(s.body).toContain("§12");
    expect(s.body).not.toContain("internal words");
  });
  it("uses a fixed sentence when the title carries no §N", () => {
    const s = stubIssue(gl(41, "closed", "anything at all"));
    expect(s.body).not.toContain("anything");
  });
});

describe("planImport", () => {
  it("emits one action per number 1..max: placeholder, open, stub", () => {
    const acts = planImport([gl(3, "opened", "§3: old gitlab title"), gl(4, "closed", "§4: x")], REG, OPTS);
    expect(acts.map((a) => [a.n, a.kind])).toEqual([
      [1, "placeholder"],
      [2, "placeholder"],
      [3, "open"],
      [4, "stub"],
    ]);
    expect(acts[2].title).toBe("§3: Three");
    expect(acts[2].labels).toEqual(["source::register"]);
    expect(acts[3].labels).toEqual([]);
    expect(acts[0].title).toBe(PLACEHOLDER_TITLE);
  });
  it("throws when an open issue's § has no OPEN entry", () => {
    expect(() => planImport([gl(4, "opened", "§4: x")], REG, OPTS)).toThrow(/#4.*§4/);
  });
  it("throws when an open issue has no §N title", () => {
    expect(() => planImport([gl(3, "opened", "no section")], REG, OPTS)).toThrow(/#3/);
  });
  it("throws on a duplicate GitLab number", () => {
    expect(() => planImport([gl(3, "opened", "§3: a"), gl(3, "opened", "§3: a")], REG, OPTS)).toThrow(/twice/);
  });
});

describe("leakCheckPlan", () => {
  const patterns = buildPatterns(["synthetic-class: secretword"]);
  it("counts a hit in a title or body and names the action, never the text", () => {
    const acts = [
      { n: 1, kind: "open", title: "§1: clean", body: "clean", labels: [] },
      { n: 2, kind: "open", title: "§2: x", body: "has secretword inside", labels: [] },
    ];
    const r = leakCheckPlan(acts, patterns);
    expect(r).toEqual({ hitLines: 1, classes: { "synthetic-class": 1 }, actionsHit: [2] });
    expect(JSON.stringify(r)).not.toContain("secretword");
  });
  it("is zero on a clean plan", () => {
    expect(leakCheckPlan([{ n: 1, kind: "stub", title: "a", body: "b", labels: [] }], patterns).hitLines).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run scripts/issue-import-lib.test.mjs --reporter=dot > "$SP/t3-red.log" 2>&1; echo "EXIT=$?"`. Expected: EXIT=1 (the module is missing).

  ★ Before Step 3, check the class syntax `synthetic-class: secretword` against `CLASS_RE` in `identifier-leak-lib.mjs`, and adjust the test's list line to whatever that regex accepts. The test must not guess the list format.
- [ ] **Step 3: Implement.** Create `scripts/issue-import-lib.mjs`:

```js
/** Pure planner for importing the register's open GitLab issues into a fresh GitHub
 *  repository with their numbers preserved (sub-project 4 spec,
 *  docs/superpowers/specs/2026-09-23-issues-migration-design.md). No network, no
 *  filesystem, no shebang — the CLI (import-issues.mjs) owns I/O. */
import { isClosed, parseEntries } from "./followup-claims-lib.mjs";
import { issueSection } from "./followup-workitem-lib.mjs";
import { scanMessage } from "./identifier-leak-lib.mjs";

export const BODY_CAP = 20000;
export const TITLE_CAP = 256;
export const PLACEHOLDER_TITLE = "placeholder (deleted after import)";
export const STUB_TITLE_RE = /^GitLab #(\d+), closed before the migration$/;
const CUT_MARK = "\n\n… (cut — read the full entry in the register)";
const INDEX_ROW_RE = /^\| \[§(\d+)\]\(#([^)\s]+)\)/;
const OPEN_SUFFIX_RE = /\s+—\s+open\s*$/i;
const REGISTER_PATH = "docs/open-followups.md";

export function parseIndexAnchors(registerText) {
  const out = new Map();
  for (const line of registerText.split(/\r?\n/)) {
    const m = INDEX_ROW_RE.exec(line);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

export function entryTitle(entry) {
  return `§${entry.n}: ${entry.title.replace(OPEN_SUFFIX_RE, "")}`.slice(0, TITLE_CAP);
}

function paragraphs(lines) {
  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

function pointer({ n, repoUrl, pointerStyle, anchor }) {
  const file = `${repoUrl}/blob/main/${REGISTER_PATH}`;
  return pointerStyle === "anchor"
    ? `Register entry [§${n}](${file}#${anchor}).`
    : `Register entry §${n} in [${REGISTER_PATH}](${file}) — search for \`## ${n}.\``;
}

export function issueBody(entry, { n, repoUrl, pointerStyle, anchor, date }) {
  const paras = paragraphs(entry.body);
  const status = paras.find((p) => p.startsWith("**Status:**"));
  const first = paras.find((p) => !p.startsWith("**Status:**") && !p.startsWith("**Work item:**"));
  const footer =
    `\n\n---\n_Imported from GitLab #${n} on ${date}. The register entry is the source of truth; ` +
    `update it, not this issue._`;
  let main = [pointer({ n, repoUrl, pointerStyle, anchor }), status, first].filter(Boolean).join("\n\n");
  const room = BODY_CAP - footer.length;
  if (main.length > room) main = main.slice(0, room - CUT_MARK.length) + CUT_MARK;
  return main + footer;
}

export function stubIssue(gitlabIssue) {
  const section = issueSection(gitlabIssue.title);
  const body =
    section === null
      ? "This number belonged to a GitLab issue closed before the migration. It is kept so old citations resolve."
      : `This number belonged to the GitLab issue for register entry §${section}, closed before the migration. ` +
        "The closed entry in docs/open-followups.md is the record.";
  return { title: `GitLab #${gitlabIssue.iid}, closed before the migration`, body };
}

export function planImport(gitlabIssues, registerText, { repoUrl, pointerStyle, date }) {
  const byIid = new Map();
  for (const gi of gitlabIssues) {
    if (byIid.has(gi.iid)) throw new Error(`GitLab #${gi.iid} appears twice in the issue list`);
    byIid.set(gi.iid, gi);
  }
  const openEntries = new Map(
    parseEntries(registerText)
      .filter((e) => !isClosed(e.title))
      .map((e) => [e.n, e]),
  );
  const anchors = parseIndexAnchors(registerText);
  const max = Math.max(0, ...byIid.keys());
  const actions = [];
  for (let n = 1; n <= max; n += 1) {
    const gi = byIid.get(n);
    if (!gi) {
      actions.push({ n, kind: "placeholder", title: PLACEHOLDER_TITLE, body: "", labels: [] });
      continue;
    }
    if (gi.state !== "opened") {
      actions.push({ n, kind: "stub", ...stubIssue(gi), labels: [] });
      continue;
    }
    const section = issueSection(gi.title);
    if (section === null) throw new Error(`open GitLab #${n} has no §NNN: title`);
    const entry = openEntries.get(section);
    if (!entry) throw new Error(`open GitLab #${n} names §${section}, which is not an OPEN register entry`);
    actions.push({
      n,
      kind: "open",
      title: entryTitle(entry),
      body: issueBody(entry, { n, repoUrl, pointerStyle, anchor: anchors.get(section) ?? "", date }),
      labels: [...gi.labels],
    });
  }
  return actions;
}

export function leakCheckPlan(actions, patterns) {
  let hitLines = 0;
  const classes = {};
  const actionsHit = [];
  for (const a of actions) {
    const r = scanMessage(`${a.title}\n${a.body}`, patterns);
    if (r.hitLines === 0) continue;
    hitLines += r.hitLines;
    actionsHit.push(a.n);
    for (const [k, v] of Object.entries(r.classes)) classes[k] = (classes[k] ?? 0) + v;
  }
  return { hitLines, classes, actionsHit };
}
```

- [ ] **Step 4: Run it and see it pass.** The same command as Step 2 → EXIT=0, `Tests  N passed` with N equal to the number of `it(` in the file.
- [ ] **Step 5: Mutation check (two lines; report the kills).**
  1. Change `if (gi.state !== "opened")` to `if (false)`: expect the planImport kinds test RED.
  2. Delete `.filter((e) => !isClosed(e.title))`: expect "throws when an open issue's § has no OPEN entry" RED.

  Revert each mutation and confirm with `git diff --stat` that only the intended files differ.
- [ ] **Step 6: Lint and commit.** `npx eslint --max-warnings=0 scripts/issue-import-lib.mjs scripts/issue-import-lib.test.mjs`: EXIT=0. Then `git add scripts/issue-import-lib.mjs scripts/issue-import-lib.test.mjs && git commit -m "feat: plan the issue import with GitLab numbers preserved"`

---

### Task 4: apply a plan through an injected GitHub client

**Files:**
- Create: `scripts/issue-import-apply.mjs`
- Test: `scripts/issue-import-apply.test.mjs`

**Interfaces:**
- Consumes: `Action` and `PLACEHOLDER_TITLE` (Task 3).
- Produces:
  - `class Refused extends Error` — the CLI maps it to exit 1.
  - `class RateLimited extends Error { retryAfterMs }` — thrown by a client.
  - `applyPlan(actions, client, { resume = false, sleep, log }) → { created, closed, deleted }`, where `client` is:
    - `counts() → Promise<{issues, pulls}>`
    - `listIssues() → Promise<{number, title, state, nodeId}[]>` (issues only, all states)
    - `ensureLabels(names: string[]) → Promise<void>`
    - `createIssue({title, body, labels}) → Promise<{number, nodeId}>`
    - `closeIssue(number) → Promise<void>`
    - `deleteIssue(nodeId) → Promise<void>`
  - `closeOnGitLab(actions, gitlab, { githubUrl, log }) → { closed, skipped }`, where `gitlab` is:
    - `get(iid) → Promise<{state, notes: string[]}>`
    - `comment(iid, body) → Promise<void>`
    - `close(iid) → Promise<void>`

**Why placeholders are deleted LAST:** GitHub never re-uses a deleted issue's number, but a deleted issue no longer shows up in any listing. If placeholders were deleted as they were created, a resume could not see the highest number already used. Creating every number first, and deleting the placeholders in a final phase, keeps "highest listed number = last created" true at every point where a run can die.

- [ ] **Step 1: Write the failing tests.** Create `scripts/issue-import-apply.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { applyPlan, closeOnGitLab, RateLimited, Refused } from "./issue-import-apply.mjs";
import { PLACEHOLDER_TITLE } from "./issue-import-lib.mjs";

/** In-memory GitHub: numbers are assigned in sequence and shared with PRs; deleted
 *  numbers stay used. */
function fakeGitHub({ pulls = 0, preIssues = 0, rateLimitOnce = new Set(), foreignCreateAt = null } = {}) {
  let next = 1 + pulls;
  const issues = new Map();
  const labels = new Set();
  const calls = [];
  const add = (title, state = "open") => {
    const number = next++;
    issues.set(number, { number, title, state, nodeId: `N${number}`, deleted: false });
    return number;
  };
  for (let i = 0; i < preIssues; i++) add(`pre ${i}`);
  return {
    calls,
    issues,
    labels,
    async counts() {
      return { issues: [...issues.values()].filter((i) => !i.deleted).length, pulls };
    },
    async listIssues() {
      return [...issues.values()].filter((i) => !i.deleted).map(({ number, title, state, nodeId }) => ({ number, title, state, nodeId }));
    },
    async ensureLabels(names) {
      calls.push(["labels", names.length]);
      names.forEach((n) => labels.add(n));
    },
    async createIssue({ title }) {
      if (rateLimitOnce.has(title)) {
        rateLimitOnce.delete(title);
        throw new RateLimited("slow down", 5);
      }
      if (foreignCreateAt !== null && next === foreignCreateAt) add("someone else");
      const number = add(title);
      calls.push(["create", number]);
      return { number, nodeId: `N${number}` };
    },
    async closeIssue(number) {
      issues.get(number).state = "closed";
      calls.push(["close", number]);
    },
    async deleteIssue(nodeId) {
      const n = Number(nodeId.slice(1));
      issues.get(n).deleted = true;
      calls.push(["delete", n]);
    },
  };
}

const plan = [
  { n: 1, kind: "placeholder", title: PLACEHOLDER_TITLE, body: "", labels: [] },
  { n: 2, kind: "open", title: "§2: two", body: "b", labels: ["type::defect"] },
  { n: 3, kind: "stub", title: "GitLab #3, closed before the migration", body: "s", labels: [] },
  { n: 4, kind: "open", title: "§4: four", body: "b", labels: ["theme::ux", "type::defect"] },
];
const noSleep = async () => {};
const quiet = () => {};

describe("applyPlan", () => {
  it("preserves every number, closes stubs, and deletes placeholders last", async () => {
    const gh = fakeGitHub();
    const r = await applyPlan(plan, gh, { sleep: noSleep, log: quiet });
    expect(r).toEqual({ created: 4, closed: 1, deleted: 1 });
    expect(gh.issues.get(2).title).toBe("§2: two");
    expect(gh.issues.get(3).state).toBe("closed");
    expect(gh.issues.get(1).deleted).toBe(true);
    expect(gh.calls.at(-1)).toEqual(["delete", 1]);
    expect(gh.calls[0]).toEqual(["labels", 2]);
  });
  it("refuses a target that has a pull request, before any write", async () => {
    const gh = fakeGitHub({ pulls: 1 });
    await expect(applyPlan(plan, gh, { sleep: noSleep, log: quiet })).rejects.toThrow(Refused);
    expect(gh.calls).toEqual([]);
  });
  it("refuses a target that already has issues unless resuming", async () => {
    const gh = fakeGitHub({ preIssues: 1 });
    await expect(applyPlan(plan, gh, { sleep: noSleep, log: quiet })).rejects.toThrow(/1 issue/);
    expect(gh.calls).toEqual([]);
  });
  it("stops at once when GitHub assigns an unexpected number", async () => {
    const gh = fakeGitHub({ foreignCreateAt: 3 });
    await expect(applyPlan(plan, gh, { sleep: noSleep, log: quiet })).rejects.toThrow(/expected #3.*got #4/);
    expect(gh.calls.filter((c) => c[0] === "create").map((c) => c[1])).toEqual([1, 2, 4]);
  });
  it("waits and retries the same number on a rate limit", async () => {
    const gh = fakeGitHub({ rateLimitOnce: new Set(["§2: two"]) });
    const slept = [];
    await applyPlan(plan, gh, { sleep: async (ms) => slept.push(ms), log: quiet });
    expect(slept).toContain(5);
    expect(gh.issues.get(2).title).toBe("§2: two");
  });
  it("resumes from the highest existing number after checking every existing one", async () => {
    const gh = fakeGitHub();
    await applyPlan(plan.slice(0, 2), gh, { sleep: noSleep, log: quiet }).catch(() => {});
    // the first run created #1-#2 and deleted #1; simulate the crash before the delete:
    gh.issues.get(1).deleted = false;
    const r = await applyPlan(plan, gh, { resume: true, sleep: noSleep, log: quiet });
    expect(r.created).toBe(2);
    expect([...gh.issues.values()].filter((i) => !i.deleted).map((i) => i.number)).toEqual([2, 3, 4]);
  });
  it("refuses to resume when an existing number disagrees with the plan", async () => {
    const gh = fakeGitHub({ preIssues: 1 });
    await expect(applyPlan(plan, gh, { resume: true, sleep: noSleep, log: quiet })).rejects.toThrow(/#1/);
  });
  it("refuses a plan that holds no actions", async () => {
    await expect(applyPlan([], fakeGitHub(), { sleep: noSleep, log: quiet })).rejects.toThrow(Refused);
  });
});

describe("closeOnGitLab", () => {
  it("comments and closes each imported issue once, and skips one already moved", async () => {
    const state = new Map([
      [2, { state: "opened", notes: [] }],
      [4, { state: "closed", notes: ["Moved to GitHub #4: https://github.com/o/r/issues/4"] }],
    ]);
    const log = [];
    const gitlab = {
      get: async (iid) => state.get(iid),
      comment: async (iid, body) => log.push(["comment", iid, body]),
      close: async (iid) => log.push(["close", iid]),
    };
    const r = await closeOnGitLab(plan, gitlab, { githubUrl: "https://github.com/o/r", log: quiet });
    expect(r).toEqual({ closed: 1, skipped: 1 });
    expect(log).toEqual([
      ["comment", 2, "Moved to GitHub #2: https://github.com/o/r/issues/2"],
      ["close", 2],
    ]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run scripts/issue-import-apply.test.mjs --reporter=dot > "$SP/t4-red.log" 2>&1; echo "EXIT=$?"`. Expected: EXIT=1.
- [ ] **Step 3: Implement.** Create `scripts/issue-import-apply.mjs`:

```js
/** Applies an import plan (issue-import-lib.mjs) through an injected client, so every
 *  guard is testable without a network. The CLI supplies the real clients. */
import { PLACEHOLDER_TITLE } from "./issue-import-lib.mjs";

export class Refused extends Error {}
export class RateLimited extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

const MAX_RETRIES = 8;

async function withRetry(fn, sleep, log) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RateLimited) || attempt >= MAX_RETRIES) throw err;
      log(`rate limited; waiting ${err.retryAfterMs} ms`);
      await sleep(err.retryAfterMs);
    }
  }
}

function checkExisting(actions, existing) {
  const byN = new Map(actions.map((a) => [a.n, a]));
  for (const issue of existing) {
    const a = byN.get(issue.number);
    if (!a || a.title !== issue.title) {
      throw new Refused(`existing #${issue.number} ("${issue.title}") does not match the plan — cannot resume`);
    }
  }
}

export async function applyPlan(actions, client, { resume = false, sleep, log }) {
  if (actions.length === 0) throw new Refused("the plan holds no actions");
  const { issues, pulls } = await client.counts();
  if (pulls > 0) throw new Refused(`the target has ${pulls} pull request(s); numbers can no longer be preserved`);
  if (issues > 0 && !resume) throw new Refused(`the target already has ${issues} issue(s); use --resume or a fresh repository`);

  const existing = resume ? await client.listIssues() : [];
  checkExisting(actions, existing);
  const highest = Math.max(0, ...existing.map((i) => i.number));

  await client.ensureLabels([...new Set(actions.flatMap((a) => a.labels))]);

  let created = 0;
  let closed = 0;
  for (const a of actions) {
    if (a.n <= highest) continue;
    const { number } = await withRetry(() => client.createIssue(a), sleep, log);
    if (number !== a.n) throw new Refused(`expected #${a.n} but GitHub assigned #${number}; stopped`);
    created += 1;
    if (a.kind === "stub") {
      await withRetry(() => client.closeIssue(number), sleep, log);
      closed += 1;
    }
    log(`#${number} ${a.kind}`);
  }
  // Stubs created before a crash may still be open; close them now.
  for (const i of existing) {
    const a = actions.find((x) => x.n === i.number);
    if (a.kind === "stub" && i.state !== "closed") {
      await withRetry(() => client.closeIssue(i.number), sleep, log);
      closed += 1;
    }
  }

  let deleted = 0;
  const live = await client.listIssues();
  for (const i of live) {
    if (i.title !== PLACEHOLDER_TITLE) continue;
    await withRetry(() => client.deleteIssue(i.nodeId), sleep, log);
    deleted += 1;
  }
  return { created, closed, deleted };
}

export async function closeOnGitLab(actions, gitlab, { githubUrl, log }) {
  let closedCount = 0;
  let skipped = 0;
  for (const a of actions) {
    if (a.kind !== "open") continue;
    const body = `Moved to GitHub #${a.n}: ${githubUrl}/issues/${a.n}`;
    const current = await gitlab.get(a.n);
    if (current.state === "closed" && current.notes.includes(body)) {
      skipped += 1;
      continue;
    }
    if (!current.notes.includes(body)) await gitlab.comment(a.n, body);
    if (current.state !== "closed") await gitlab.close(a.n);
    closedCount += 1;
    log(`GitLab #${a.n} closed`);
  }
  return { closed: closedCount, skipped };
}
```

- [ ] **Step 4: Run it and see it pass.** The same command → EXIT=0.

  ★ If the resume test's hand-built crash state disagrees with the implementation, fix the TEST's setup so that it models a real crash: the run died after creating #2 and before its delete phase, so #1 and #2 both exist. Do NOT loosen an assertion.
- [ ] **Step 5: Mutation check (report the kills).**
  1. Delete the `pulls > 0` refusal: expect "refuses a target that has a pull request" RED.
  2. Replace `number !== a.n` with `false`: expect "stops at once" RED.
  3. Move the placeholder delete into the create loop, right after a placeholder's create: expect the resume test or "deletes placeholders last" RED.

  Revert each, then check `git diff --stat`.
- [ ] **Step 6: Lint and commit.** `npx eslint --max-warnings=0 scripts/issue-import-apply.mjs scripts/issue-import-apply.test.mjs`. Then `git add` both files, and `git commit -m "feat: apply an issue-import plan with number, target and resume guards"`

---

### Task 5: the CLI, `--plan` mode

**Files:**
- Create: `scripts/import-issues.mjs`
- Test: `scripts/import-issues.test.mjs`
- Modify: `package.json` (script `issues:import` plus its `scriptsDescriptions` entry), then `npm run docs:scripts` to regenerate `CONTRIBUTING.md`

**Interfaces:**
- Consumes: Task 3's `planImport` and `leakCheckPlan`; `parseList` and `buildPatterns` from `identifier-leak-lib.mjs`.
- Produces: a plan file `{ version: 1, createdAt, registerSha, maxNumber, pointerStyle, repoUrl, counts: {open, stub, placeholder}, leak: {hitLines, classes, actionsHit}, actions }`.
- CLI: `node scripts/import-issues.mjs --plan --out <file> --repo <owner/name> --pointer anchor|search [--gitlab-json <file>]`
  - `--gitlab-json` reads the issue list from a file instead of `glab api`. Tests use it; so does a dry run on a saved snapshot.
  - `LEAK_LIST_FILE` must be set, or the command exits 2.

- [ ] **Step 1: Write the failing tests.** Create `scripts/import-issues.test.mjs`. It runs the CLI with `spawnSync(process.execPath, ["scripts/import-issues.mjs", ...])`, inside a temporary working directory. That directory holds:
  - `docs/open-followups.md`: the `REG` fixture from Task 3, `git init`-ed and committed, so `git hash-object` works;
  - a `gitlab.json` fixture;
  - a synthetic leak list file.

  Cases:
  - clean plan → exit 0; the file has `counts {open:1, stub:1, placeholder:2}`, `maxNumber 4`, `leak.hitLines 0`, and a 40-hex `registerSha`; stdout contains `open 1 · stub 1 · placeholder 2 · total 4`.
  - the register's §3 first paragraph contains the synthetic leak word → exit 1; stdout names action `#3` and class `synthetic-class`; stdout and stderr do NOT contain the word; the `--out` file is NOT written.
  - `LEAK_LIST_FILE` unset → exit 2.
  - unknown flag → exit 2.
  - an open issue naming a closed entry → exit 2, with the planner's message.

  Copy the spawn/tempdir helper shape from `scripts/check-commit-message-leaks.test.mjs`, the nearest sibling.
- [ ] **Step 2: Run it and see it fail** (EXIT=1).
- [ ] **Step 3: Implement the `--plan` path** in `scripts/import-issues.mjs`:
  - Parse the flags by hand, the way `check-commit-message-leaks.mjs` does. `--plan`, `--apply`, `--resume` and `--close-gitlab` are mutually exclusive modes.
  - Read the GitLab issues. With `--gitlab-json`, read that file. Otherwise page `glab api "projects/:id/issues?state=all&per_page=100&page=N"` through `execFileSync("glab", [...args])`, which takes an argument array and no shell, until an empty page. Map each issue to `{iid, state, title, labels}`.
  - `registerSha` = `execFileSync("git", ["hash-object", "docs/open-followups.md"]).toString().trim()`.
  - Run `planImport`, then `leakCheckPlan`.
  - Print one line per class and the hit action numbers (never text).
  - Exit 1 without writing if `leak.hitLines > 0`. Otherwise write the JSON, print the counts line, and exit 0.
  - Wrap every failure in exit 2 with `CANNOT RUN: <message>`, as `check-followup-gitlab.mjs` does. Import the libs dynamically inside the try, so a renamed export exits 2 rather than 1.
  - No shebang (the test imports nothing from it, but repo style for `scripts/*.mjs` CLIs run by node is still no shebang: check `head -1 scripts/check-commit-message-leaks.mjs` and match it).
- [ ] **Step 4: Run it and see it pass** (EXIT=0, all cases).
- [ ] **Step 5: package.json.**
  - Add `"issues:import": "node scripts/import-issues.mjs"`.
  - Add the `scriptsDescriptions` entry: `"Plan (--plan), apply (--apply/--resume) or close on GitLab (--close-gitlab) the import of the register's open GitLab issues into a fresh GitHub repository with their numbers preserved — runs in NO CI job; used once, at the visibility flip"`.
  - Run `npm run docs:scripts`, then `npm run docs:scripts:check`: EXIT=0.
- [ ] **Step 6: Lint and commit** (the CLI, the test, `package.json`, `CONTRIBUTING.md`): `feat: add the issue-import CLI's plan mode`.

---

### Task 6: the CLI, `--apply` / `--resume` / `--close-gitlab` modes, and the real clients

**Files:**
- Modify: `scripts/import-issues.mjs`
- Create: `scripts/github-issues-lib.mjs` (pure) and `scripts/github-issues-lib.test.mjs`

**Interfaces:**
- Consumes: Task 4's `applyPlan`, `closeOnGitLab`, `Refused` and `RateLimited`.
- Produces (pure, in `github-issues-lib.mjs`, and used again in Task 7):
  - `parseNextLink(linkHeader: string|null) → string|null`
  - `toTrackerIssue(raw) → {iid, title, labels: string[]} | null` (null for a pull request, i.e. a `pull_request` key)
  - `retryAfterMs(status, headers) → number|null` (403/429 with `retry-after` seconds, or with `x-ratelimit-remaining: 0` and a reset time)

- [ ] **Step 1: Write the failing tests** for `github-issues-lib.mjs`:
  - `parseNextLink('<https://api.github.com/x?page=2>; rel="next", <…>; rel="last"')` returns the page-2 URL; `null` and `'<…>; rel="prev"'` return null.
  - `toTrackerIssue({number: 5, title: "§5: a", labels: [{name: "x"}]})` returns `{iid: 5, title: "§5: a", labels: ["x"]}`; with `pull_request: {}` it returns null; with a missing title it throws.
  - `retryAfterMs(429, new Headers({"retry-after": "3"}))` is 3000; `retryAfterMs(500, new Headers())` is null; a 403 with `x-ratelimit-remaining: 0` and `x-ratelimit-reset` 10 s in the future gives a value between 9,000 and 11,000 (pass the clock in as a third parameter `now`).
- [ ] **Step 2: Red, then implement, then green.** Keep it pure: no fetch.
- [ ] **Step 3: The real GitHub client**, inside `import-issues.mjs`. Build `makeGitHubClient(repo, token)` over `fetch("https://api.github.com/…", { redirect: "manual", headers: { authorization: \`Bearer ${token}\`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } })`:
  - `counts()`: GraphQL `query($o:String!,$r:String!){repository(owner:$o,name:$r){issues{totalCount} pullRequests{totalCount}}}`.
  - `listIssues()`: REST `GET /repos/{repo}/issues?state=all&per_page=100`, following `parseNextLink`, dropping pull requests, and mapping `{number, title, state, nodeId: node_id}`.
  - `ensureLabels(names)`: `GET /repos/{repo}/labels?per_page=100` (paged), then `POST /repos/{repo}/labels {name}` for each missing name.
  - `createIssue`: `POST /repos/{repo}/issues {title, body, labels}` returns `{number, nodeId: node_id}`.
  - `closeIssue`: `PATCH /repos/{repo}/issues/{n} {state: "closed", state_reason: "not_planned"}`.
  - `deleteIssue(nodeId)`: GraphQL `mutation($id:ID!){deleteIssue(input:{issueId:$id}){clientMutationId}}`.
  - Any response where `retryAfterMs` is non-null throws `RateLimited`. Any other non-2xx throws an `Error` with the status and at most 500 characters of body, with the token redacted.
  - Pacing: `sleep(1100)` after each create, to stay under GitHub's secondary limit on content creation. Task 9 measures the real total.
  - Token: `process.env.GH_TOKEN` if set, else `execFileSync("gh", ["auth", "token"])`. The token is never printed.
- [ ] **Step 4: The GitLab client** for `--close-gitlab`, through `glab api` with argument arrays:
  - `get(iid)`: `projects/:id/issues/{iid}` plus `projects/:id/issues/{iid}/notes?per_page=100`, returning the notes' `body` strings;
  - `comment`: `-X POST projects/:id/issues/{iid}/notes -f body=…`;
  - `close`: `-X PUT projects/:id/issues/{iid} -f state_event=close`.
  - Nothing of a response is printed except the iid.
- [ ] **Step 5: Wire the modes.**
  - `--apply --plan <file> --repo <o/r> [--resume]`:
    - read the plan;
    - refuse (exit 1) if `plan.leak.hitLines !== 0`;
    - refuse if `plan.registerSha` differs from `git hash-object docs/open-followups.md`;
    - refuse if `plan.maxNumber` is below GitLab's current highest issue number (one `glab api "projects/:id/issues?state=all&order_by=iid&sort=desc&per_page=1"`);
    - refuse if `--repo` differs from `plan.repoUrl`'s `owner/name`;
    - then run `applyPlan`.
  - `--close-gitlab --plan <file> --repo <o/r>` runs `closeOnGitLab` with `githubUrl = https://github.com/<o/r>`.
  - `Refused` maps to exit 1. Anything else maps to exit 2.
- [ ] **Step 6: Extend `import-issues.test.mjs`** with the refusals that need no network:
  - a plan file with `leak.hitLines: 1` → exit 1;
  - a `registerSha` mismatch → exit 1.

  Order the checks so both run before any client is built, and pass `GH_TOKEN=dummy` so `gh` is never called.
- [ ] **Step 7: Run all four import test files once** (`issue-import-lib`, `issue-import-apply`, `github-issues-lib`, `import-issues`) in one vitest invocation. Expect EXIT=0 and `Test Files  4 passed`. Then run eslint on the changed files, and commit: `feat: apply and close-on-GitLab modes for the issue import`.

---

### Task 7: the GitHub sync check, dormant until the flip

**Files:**
- Create: `scripts/check-followup-github.mjs`
- Create: `scripts/check-followup-github.integration.test.mjs`
- Modify: `package.json` (`followups:github:check` + description), `CONTRIBUTING.md` (regenerated)
- Modify: `.github/workflows/scheduled.yml` (new job `register-sync`)
- Modify: `scripts/ci-workflow-lib.mjs` / `scripts/ci-workflow.test.mjs` (only if they enumerate the scheduled jobs; read them first)
- Modify: `docs/AGENTS/ci.md` (a bullet under the weekly workflow)

**Interfaces:**
- Consumes: `compareWithTracker` and `TRACKER_PROBLEM_HELP` (Task 2); `parseNextLink` and `toTrackerIssue` (Task 6); `parseEntries` and `isClosed`.
- Environment:
  - `REGISTER_TRACKER` (must be `github`, else skip with exit 0);
  - `GITHUB_TOKEN` (required once enabled; whitespace or a control character → exit 2, the same rule as the GitLab script);
  - `GITHUB_REPOSITORY` (`owner/name`, set by Actions);
  - `GITHUB_API_URL` (default `https://api.github.com`; tests point it at a local server);
  - `REGISTER_SYNC_TIMEOUT_MS`.

- [ ] **Step 1: Read `scripts/check-followup-gitlab.integration.test.mjs` in full.** It is the model: a local `http.createServer` stands in for the API. Write `check-followup-github.integration.test.mjs` with the same cases, adapted:
  - `REGISTER_TRACKER` unset → exit 0, and stdout contains `skipped: REGISTER_TRACKER is not "github"`;
  - enabled with no token → exit 2;
  - a server serving the real register's open issues (build them from the real `docs/open-followups.md` Work item lines, as the GitLab test does) → exit 0, and stdout contains `agree`;
  - the same list with one issue missing → exit 1, and `ISSUE_NOT_OPEN`;
  - **(Review Focus 5)** the same list plus `{number: 99999, title: "§1: a PR", pull_request: {}}` → still exit 0. The PR is ignored.
  - two pages linked by a `Link` header → exit 0, and both pages are read;
  - a non-2xx → exit 2;
  - fewer than 50 register issues → exit 2.
- [ ] **Step 2: Red.** Run the new test file: EXIT=1.
- [ ] **Step 3: Implement** `check-followup-github.mjs` by copying `check-followup-gitlab.mjs`'s structure. Keep:
  - the redaction;
  - `CannotCompare`, `describe()`, the floors, the timeout parsing, and the dynamic imports inside the try.

  Change:
  - The skip test comes FIRST: `REGISTER_TRACKER !== "github"`.
  - Pagination: `fetchPage(url)` returns `{ items, next: parseNextLink(res.headers.get("link")) }`, starting at `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/issues?state=open&per_page=100`, with the same `MAX_PAGES`. A repeated number is exit 2.
  - Map with `toTrackerIssue` and drop the nulls.
  - Headers: `authorization: Bearer`, `accept: application/vnd.github+json`, and `redirect: "manual"`.
  - Messages say GitHub; the help text comes from `TRACKER_PROBLEM_HELP`.
  - The header comment states that this replaces `check-followup-gitlab.mjs` at the flip (docs/superpowers/specs/2026-09-23-issues-migration-design.md), and that until then the repository variable keeps it dormant.
- [ ] **Step 4: Green.** The new test file → EXIT=0, with `Tests  N passed` matching the case count.
- [ ] **Step 5: Mutation check.** Remove the `toTrackerIssue` PR filter (return the PR as an issue): expect the Review Focus 5 case RED (its SECTION_ON_TWO_ISSUES or ISSUE_WITHOUT_ENTRY). Revert.
- [ ] **Step 6: The workflow job.** Append to `.github/workflows/scheduled.yml`, reusing the checkout/setup-node pins already used in that file, verbatim:

```yaml
  # Register ⟺ GitHub issues, both ways. Report only (continue-on-error), and dormant until the
  # flip sets the repository variable REGISTER_TRACKER=github (issues-migration spec).
  register-sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    continue-on-error: true
    permissions:
      contents: read
      issues: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "24"
      - run: node scripts/check-followup-github.mjs
        env:
          REGISTER_TRACKER: ${{ vars.REGISTER_TRACKER }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

  - ★ No `npm ci`: the script and its libs import only `node:` modules and repo files. Prove it with `mkdir "$SP/nomods" && git archive HEAD scripts docs | tar -x -C "$SP/nomods" && (cd "$SP/nomods" && REGISTER_TRACKER= node scripts/check-followup-github.mjs; echo "EXIT=$?")`. Expect EXIT=0 and the skip line. If a lib pulls a package, add `npm ci` and say so in the report.
  - ★ Check `git ls-files --eol .github/workflows/scheduled.yml` first, and use the Edit tool.
  - Run actionlint with shellcheck on the file, plus a positive control, as in the SP3 plan.
- [ ] **Step 7: npm and docs.**
  - `package.json`: add `"followups:github:check": "node scripts/check-followup-github.mjs"` and its description: `"Compare docs/open-followups.md's Work item lines with the open GitHub issues in both directions — weekly in scheduled.yml (register-sync, report only); skips unless REGISTER_TRACKER=github"`.
  - Run `npm run docs:scripts`.
  - `docs/AGENTS/ci.md`: a `register-sync` bullet under the weekly workflow (what it compares, the switch, the exit codes, and that it replaces `followups-gitlab-sync` at the flip).
  - If `ci-workflow.test.mjs` enumerates the scheduled jobs, add `register-sync` and run it.
- [ ] **Step 8: Gates and commit.** Redirect each command and read `EXIT=`:
  - vitest on the new test, `ci-workflow.test.mjs` and `followup-workitem-lib.test.mjs` (one invocation);
  - eslint on the changed scripts;
  - `docs:scripts:check`, `docs:symbols:check`, `docs:claims:check`;
  - leaks check.

  Commit: `feat: weekly register-vs-GitHub-issues check, dormant until the flip`.

---

### Task 8: docs — the flip checklist, roadmap, §200, and the filing procedure

**Files:**
- Create: `docs/superpowers/specs/2026-09-23-flip-checklist.md`
- Modify: `docs/superpowers/specs/2026-09-20-github-migration-roadmap.md`
- Modify: `docs/open-followups.md` (§200: a dated pointer paragraph; its index row only if the title changes, and it should not)

- [ ] **Step 1: Write the checklist.** Copy the spec's "Flip checklist" section as the body, turn each step into `- [ ]`, and add under each step the exact command it runs where one exists:
  - step 4: the `verify-rewrite` command from §200;
  - step 6: `npm run issues:import -- --plan --out <file> --repo sebastianmaute/aipm-cockpit --pointer <Task 1 ruling>`, then `-- --apply --plan <file> --repo sebastianmaute/aipm-cockpit`;
  - step 6's check: `REGISTER_TRACKER=github GITHUB_REPOSITORY=sebastianmaute/aipm-cockpit GITHUB_TOKEN=$(gh auth token) npm run followups:github:check`;
  - step 8: `npm run issues:import -- --close-gitlab --plan <file> --repo sebastianmaute/aipm-cockpit`;
  - step 7: `gh variable set REGISTER_TRACKER --body github`.

  Each step's "verify" line states the expected output: counts, EXIT=0, `agree`.
- [ ] **Step 2: Roadmap.**
  - Under "### 4. Issues, and the register contract", add a dated line: design approved 2026-09-23, link the spec; the import runs at the flip, numbers preserved.
  - In the flip section ("Ordering, and the one-way door"), link the checklist.
- [ ] **Step 3: §200.** Add one dated paragraph pointing to the checklist, which now carries this entry's close condition (step 4) in its ordered place. Change nothing else.
- [ ] **Step 4: Gates.** `followups:index:check`, `followups:status:check`, `followups:workitems:check`, `docs:claims:check`, `docs:symbols:check`, leaks. All EXIT=0.
- [ ] **Step 5: Commit** (the three files): `docs: flip checklist and sub-project 4 pointers (§200)`.

---

### Task 9 (controller; owner go needed for step 3): prove it before the flip

**Files:** none in the repo (ledger plus the spec's "Measured" note in Step 5).

- [ ] **Step 1: The plan on today's data.** `LEAK_LIST_FILE=~/.config/aipm-cockpit/leak-list.txt npm run issues:import -- --plan --out "$SP/plan.json" --repo sebastianmaute/aipm-cockpit --pointer <ruling>`. Expect:
  - EXIT=0;
  - counts `open 268 · stub 92 · placeholder 37 · total 397`, or today's numbers, which must sum to `maxNumber`;
  - `leak.hitLines 0`.

  A nonzero leak count here is a real finding in the REGISTER (the tree gate would have caught it). Stop and report it.
- [ ] **Step 2: The leak-guard positive control on real data.** Copy the list to `$SP/list-plus.txt`, append one line whose word is a title fragment of a real open entry (so it MUST hit), and re-run `--plan` with `LEAK_LIST_FILE` pointing at the copy. Expect EXIT=1 with ≥1 action named. Delete the copy.
- [ ] **Step 3: The dress rehearsal (ask the owner first; it creates and deletes a private repository).**
  1. `gh repo create sebastianmaute/aipm-issue-rehearsal --private`.
  2. `--apply` the plan from Step 1 with `--repo sebastianmaute/aipm-issue-rehearsal`. The plan's `repoUrl` guard will refuse. That is intended: regenerate the plan with `--repo sebastianmaute/aipm-issue-rehearsal` for the rehearsal.
  3. Record the wall-clock duration.
  4. `gh issue list -R sebastianmaute/aipm-issue-rehearsal --state all --limit 1000 --json number,title,state` must match the plan one to one: 268 open with `§N:` titles at their N, 92 closed stubs, and #1–#37 absent.
  5. `REGISTER_TRACKER=github GITHUB_REPOSITORY=sebastianmaute/aipm-issue-rehearsal GITHUB_TOKEN=$(gh auth token) npm run followups:github:check`: EXIT=0 and `agree`.
- [ ] **Step 4: The controls on the rehearsal repository.**
  - a second `--apply` → EXIT=1 (it has issues);
  - `--resume` → `created 0`;
  - close one imported issue by hand, then `followups:github:check` → EXIT=1 with `ISSUE_NOT_OPEN`, then reopen it;
  - `REGISTER_TRACKER` unset → EXIT=0 with the skip line.
- [ ] **Step 5: Clean up and record.**
  - `gh repo delete sebastianmaute/aipm-issue-rehearsal --yes`. It needs the `delete_repo` scope; if it is missing, ask the owner to run `! gh auth refresh -h github.com -s delete_repo`.
  - Record the counts, the duration and every control's exit in the spec under a dated "Rehearsed" note, in a docs-only commit.
  - `--close-gitlab` is NOT run. It runs only at the flip.

---

## Self-review (done while writing)

- **Spec coverage:**

| Spec item | Task |
|---|---|
| Decisions and numbering plan | 3, 4 |
| Pointer measurement | 1 |
| Guards | 4, 5, 6 |
| Sync check and its switch | 7 |
| Proof items 1–5 | 9 (steps 1–4), plus 3/4/7's unit controls |
| Flip checklist and docs | 8 |
| Stale-plan guard | 6, step 5 |
| Retiring the GitLab check at the flip | a flip-checklist step (8), not built now |

- **Placeholders:**
  - Task 5's and Task 7's integration tests are specified as case lists over named sibling test files. They are copied from real files, not invented.
  - The one lookup left to the implementer (`CLASS_RE` syntax) is flagged in Task 3.
- **Names:** used identically in every task:
  - `compareWithTracker` and `TRACKER_PROBLEM_HELP` (2, 7);
  - `Action {n, kind, title, body, labels}` (3, 4, 5);
  - `applyPlan`, `closeOnGitLab`, `Refused` and `RateLimited` (4, 6);
  - `parseNextLink` and `toTrackerIssue` (6, 7);
  - `PLACEHOLDER_TITLE` (3, 4).
