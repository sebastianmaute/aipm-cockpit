# ESLint 9 → 10 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the repo from `eslint@^9` to `eslint@^10` without weakening the blocking CI lint gate.

**Architecture:** Land the source fixes for v10's three new `eslint:recommended` rules FIRST, under eslint 9, where they are independently verifiable. Then bump the dependency and treat the remaining fallout as a bounded spike — the one genuine unknown is v10's new JSX reference tracking, which can shift `no-unused-vars` / `no-undef` results across a `.tsx`-heavy codebase in either direction.

**Tech Stack:** ESLint 10 (flat config) · `eslint-config-next@16.2.6` · TypeScript 6 · Next.js 16 · Node 24 local / `node:20-bookworm-slim` in CI.

---

## Background you need before touching anything

Read `docs/superpowers/specs/2026-08-02-eslint-10-upgrade-design.md` first. Then these, each of which will burn you otherwise:

**1. NEVER read a gate's exit code through a pipe.** This is the single most expensive mistake available in this repo, and it goes wrong in BOTH directions:

```bash
npx eslint --max-warnings=0 src/app | grep -v notice   # exits 1 when eslint PASSED and grep matched nothing
npm run test:run | tail -8                             # exits 0 while tests are FAILING
```

Always redirect, echo the status unpiped, then read the file:

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"          # no pipe at all
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

**2. `npm run lint` does NOT reproduce the CI gate.** It is bare `eslint` with no `--max-warnings`, so it exits 0 with warnings present. Every green claim in this plan must come from `npx eslint --max-warnings=0 …`.

**3. `eslint.config.mjs` is hook-protected.** Edits to it are blocked. If a step needs a config change, STOP and hand the exact diff to the user to apply. Do not try to route around the hook.

**4. This is a tooling change with no user-facing behaviour**, so it takes NO version bump — it ships as a `chore`/`build` commit. (Contrast with the UX plan, which does bump.)

**5. Do not `git checkout <file>` to revert an experiment.** Other work may be in the same tree. Revert by re-applying the inverse edit.

---

## File Structure

| File | Change | Why |
|---|---|---|
| `src/app/activity-log-panel.tsx:136` | Modify | dead `let cmp = 0` initializer |
| `src/app/dismissal-stack.ts:78` | Modify | dead `let claimed = false` initializer |
| `src/app/project-switcher.tsx:84` | Modify | dead `let next = -1` initializer |
| `src/app/sidebar-nav.tsx:82` | Modify | dead `let next = -1` initializer |
| `src/app/use-settings.ts:344` | Modify | dead `let committed = merged` initializer |
| `src/app/workspace-context.tsx:290` | Modify | dead `let cmp = 0` initializer |
| `package.json` / `package-lock.json` | Modify | `eslint ^9` → `^10` |
| `.gitlab-ci.yml:8` | Modify (conditional) | Node floor for the quality job |
| `eslint.config.mjs` | **HOOK-BLOCKED** | only if the spike demands it — hand to the user |
| `CONTRIBUTING.md` / `docs/RUNBOOK.md` | Modify (conditional) | only if either states an ESLint version |

---

### Task 1: Fix the six `no-useless-assignment` violations under ESLint 9

v10 adds `no-unassigned-vars`, `no-useless-assignment` and `preserve-caught-error` to `eslint:recommended`. Measured against this repo with eslint 9 (all three rules already exist there): `no-unassigned-vars` **0**, `preserve-caught-error` **0**, `no-useless-assignment` **6**.

All six are the same shape — `let x = <initial>` where every reachable path reassigns before the first read, so the initializer is dead. The fix is a bare declaration with an explicit type, letting TypeScript's definite-assignment analysis carry it.

Landing this before the bump means the upgrade commit contains only upgrade fallout.

**Files:**
- Modify: `src/app/activity-log-panel.tsx`, `src/app/dismissal-stack.ts`, `src/app/project-switcher.tsx`, `src/app/sidebar-nav.tsx`, `src/app/use-settings.ts`, `src/app/workspace-context.tsx`

- [ ] **Step 1: Reproduce the six violations**

```bash
npx eslint --rule '{"no-useless-assignment":"error"}' src scripts e2e > /tmp/nua-before.log 2>&1; echo "EXIT=$?"
cat /tmp/nua-before.log
```

Expected: EXIT=1, six errors at `activity-log-panel.tsx:136`, `dismissal-stack.ts:78`, `project-switcher.tsx:84`, `sidebar-nav.tsx:82`, `use-settings.ts:344`, `workspace-context.tsx:290`.

★ If the count is not 6, the tree has moved since this plan was written. Re-read each site before editing; do not apply the diffs below blind.

- [ ] **Step 2: Apply the six edits**

`src/app/activity-log-panel.tsx:136` — the if / else-if / else chain is exhaustive, so every path assigns:

```ts
      let cmp: number;
```

`src/app/workspace-context.tsx:290` — same shape, the chain ends in a bare `else`:

```ts
      let cmp: number;
```

`src/app/dismissal-stack.ts:78` — `try` assigns, `catch` assigns; both paths covered:

```ts
    let claimed: boolean;
```

`src/app/project-switcher.tsx:84` — the `switch` returns from `Tab`, `Escape` and `default`; the four remaining cases assign then `break`, so the code after the switch is reachable only with `next` assigned:

```ts
    let next: number;
```

`src/app/sidebar-nav.tsx:82` — identical structure:

```ts
    let next: number;
```

`src/app/use-settings.ts:344` — the `try` assigns `committed` at its end and the `catch` assigns `committed = merged`, so the initializer is dead. `typeof merged` avoids naming the settings type here:

```ts
            let committed: typeof merged;
```

- [ ] **Step 3: Typecheck — this is where a wrong fix shows up**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0.

★ FALLBACK if tsc reports `Variable 'x' is used before being assigned` for any site: TypeScript could not prove definite assignment there. Do NOT reach for `let x!: number` (a definite-assignment assertion silences the checker without proving anything). Restructure instead — for the two switch sites, hoist the computation into a helper that returns the value:

```ts
    const next = nextIndexFor(e.key, i, items.length);
    if (next === null) return;
```

and give the four assigning cases a `return` of their value with `default: return null`. Only do this for a site tsc actually rejects.

- [ ] **Step 4: Verify the rule is clean and nothing else broke**

```bash
npx eslint --rule '{"no-useless-assignment":"error"}' src scripts e2e; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: all three EXIT=0.

★ `dismissal-stack.ts` and `project-switcher.tsx` / `sidebar-nav.tsx` are keyboard-dismissal and menu-roving code — the exact area where a control-flow slip is invisible to a functional test that only exercises the happy path. If `escapeOwner`'s tests or the menu keyboard tests fail, the restructure was wrong, not the tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log-panel.tsx src/app/dismissal-stack.ts src/app/project-switcher.tsx src/app/sidebar-nav.tsx src/app/use-settings.ts src/app/workspace-context.tsx
git commit -F - <<'EOF'
refactor: drop six dead variable initializers

Each is `let x = <initial>` where every reachable path reassigns before
the first read, so the initializer is unreachable state. Replaced with a
bare typed declaration, letting TypeScript's definite-assignment analysis
carry it.

ESLint 10 adds no-useless-assignment to eslint:recommended, so these
become gate failures on upgrade. Landing them first keeps the upgrade
commit to upgrade fallout only; they are an improvement under 9 either way.
EOF
```

---

### Task 2: Confirm the CI Node floor

ESLint 10 requires Node `^20.19.0 || ^22.13.0 || >=24`. The quality job runs on `node:20-bookworm-slim` (`.gitlab-ci.yml:8`) — a FLOATING tag. It very likely resolves above 20.19 today, but a future rebuild could move and the failure would land in CI, not locally (local is v24.18.1).

- [ ] **Step 1: Resolve what the tag actually pulls**

```bash
docker run --rm node:20-bookworm-slim node -v
```

If Docker is unavailable, query the registry instead:

```bash
npx -y node-releases-cli 2>/dev/null || curl -s https://nodejs.org/dist/index.json | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const v=JSON.parse(s).filter(r=>r.version.startsWith('v20.')).map(r=>r.version);
  console.log('latest v20:', v[0]);
});"
```

- [ ] **Step 2: Decide and record**

- Latest v20 ≥ 20.19.0 → the tag satisfies v10 **today**. Still pin, because the tag floats.
- Pin the quality job to `node:22-bookworm-slim` in `.gitlab-ci.yml:8`. The comment on that line says the image is chosen for glibc compatibility with the Playwright image — `node:22-bookworm-slim` keeps that property (still Debian bookworm, still glibc).

★ Do NOT touch the `mcr.microsoft.com/playwright:v1.61.1-jammy` job. It does not lint; changing its image risks the e2e suite for no benefit.

- [ ] **Step 3: Commit**

```bash
git add .gitlab-ci.yml
git commit -F - <<'EOF'
ci: pin the quality job to node 22

ESLint 10 requires Node ^20.19 || ^22.13 || >=24. The job ran on the
floating `node:20-bookworm-slim` tag, which satisfies that today but could
move below the floor on any rebuild — and the failure would appear only in
CI. Still bookworm, so glibc compatibility with the Playwright image holds.
EOF
```

---

### Task 3: The spike — install v10 and capture the true fallout

This is the go/no-go. Everything up to here is safe under eslint 9; this is where the unknown lives.

- [ ] **Step 1: Record the baseline, so "new" means new**

```bash
npx eslint --max-warnings=0 . -f json -o /tmp/lint-v9.json > /dev/null 2>&1; echo "EXIT=$?"
node -e "
const r=require('/tmp/lint-v9.json');
const c={}; for(const f of r) for(const m of f.messages) c[m.ruleId||'(fatal)']=(c[m.ruleId||'(fatal)']||0)+1;
console.log('v9 baseline:', JSON.stringify(c));
"
```

Expected: `{}` or close to it — CI is green, so the tree should be clean.

- [ ] **Step 2: Confirm whether `eslint:recommended` is even in effect**

`eslint-config-next` may or may not layer `js.configs.recommended` in. If it does not, v10's three new recommended rules never activate here and that whole risk class is moot. Either answer is useful; guessing is not.

```bash
npx eslint --print-config src/app/tasks-section.tsx > /tmp/cfg-v9.json 2>&1
node -e "
const c=require('/tmp/cfg-v9.json');
const r=c.rules||{};
for (const k of ['no-unused-vars','no-undef','no-useless-assignment','no-unassigned-vars','preserve-caught-error','@typescript-eslint/no-unused-vars'])
  console.log(k.padEnd(38), JSON.stringify(r[k] ?? '(not configured)'));
"
```

Record the output in the commit message for Step 7 — it is the evidence for whether the JSX-tracking risk is real.

- [ ] **Step 3: Install ESLint 10**

```bash
npm install -D eslint@^10 > /tmp/install.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/install.log
node -e "console.log('eslint', require('eslint/package.json').version)"
```

Expected: EXIT=0, version 10.x. A dry run of this already resolved with no peer conflict — `eslint-config-next@16.2.6` declares `peerDependencies: { eslint: '>=9.0.0' }`.

★ If npm reports ERESOLVE here despite the dry run, do NOT reach for `--legacy-peer-deps` or `--force`. A real peer conflict is the signal to stop and go to the rollback in Task 5.

- [ ] **Step 4: Run the gate, unpiped, and capture everything**

```bash
npx eslint --max-warnings=0 src/app; echo "GATE=$?"
npx eslint --max-warnings=0 . -f json -o /tmp/lint-v10.json > /dev/null 2>&1; echo "ALL=$?"
node -e "
const r=require('/tmp/lint-v10.json');
const c={}; const byFile={};
for(const f of r) for(const m of f.messages){
  const k=m.ruleId||'(fatal)';
  c[k]=(c[k]||0)+1;
  (byFile[k] ||= new Set()).add(f.filePath.replace(/.*aipm-wt-a[\\\\/]/,''));
}
for(const [k,n] of Object.entries(c).sort((a,b)=>b[1]-a[1]))
  console.log(String(n).padStart(5), k, '  e.g.', [...byFile[k]].slice(0,3).join(', '));
if(!Object.keys(c).length) console.log('CLEAN');
"
```

- [ ] **Step 5: Classify every new report before fixing anything**

Put each rule from Step 4 into exactly one bucket:

- **(a) JSX reference tracking.** v10 treats `<Card />` as a reference to the in-scope `Card`. Expect this to REMOVE `no-unused-vars` reports (a component used only in JSX no longer reads as unused) and potentially ADD `no-undef` ones. Additions here are genuine findings — fix the source.
- **(b) `eslint-config-next` plugin incompatibility.** Signature: a `(fatal)` entry, a crash naming a plugin, or a rule reporting nonsense everywhere. This is the rollback trigger.
- **(c) Rule-default change** (`radix` deprecated options, `no-shadow-restricted-names` now flagging `globalThis`, stricter `func-names` schema, `no-invalid-regexp`'s `allowConstructorFlags` requiring unique items). Small, mechanical, fix in source.

Write the classification down. It is what Step 7's commit message and any follow-up entry are built from.

- [ ] **Step 6: Fix bucket (a) and (c) in source**

No blanket disables. If a rule genuinely must be turned off:

- it needs a one-line justification in the config,
- `eslint.config.mjs` is HOOK-BLOCKED, so hand the exact diff to the user,
- and it needs a numbered entry in `docs/open-followups.md`.

Re-run after each fix:

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 7: Commit once the gate is green**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add package.json package-lock.json
git commit -F - <<'EOF'
build(deps): upgrade eslint 9 -> 10

eslint-config-next@16.2.6 peers on eslint >=9.0.0, so the config is
carried over unchanged; the flat config, the absence of custom plugins or
rules, and zero eslint-env comments mean v10's three largest breaking
changes do not apply here.

<REPLACE: the Step 5 classification — which rules newly reported, which
bucket each fell into, and what was changed in response. If nothing
reported, say so explicitly.>
EOF
```

(Include the source fixes from Step 6 in this commit only if they are upgrade fallout; anything unrelated gets its own commit.)

---

### Task 4: Prove the codemod is a no-op

ESLint ships `@eslint/v9-to-v10`, four sub-codemods targeting legacy flags/env vars, custom rules using removed `context`/`SourceCode` members, `RuleTester` cases, and `Linter`/`ESLint` API usage. This repo has none of those. Run it anyway — a five-minute confirmation beats an assumption.

- [ ] **Step 1: Confirm the tree is clean first**

```bash
git status --porcelain
```

Expected: empty. A codemod's diff is only readable against a clean tree.

- [ ] **Step 2: Run it**

```bash
npx codemod @eslint/v9-to-v10 > /tmp/codemod.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/codemod.log
git status --porcelain
```

Expected: no files changed.

- [ ] **Step 3: If it DID change something**

Read the diff. Two cases:

- It touched `eslint.config.mjs` → hook-blocked. Revert your working copy by re-applying the inverse edit (do NOT `git checkout` — other work may share the tree), and hand the exact diff to the user.
- It touched source → review each hunk against the v10 migration guide before keeping it. Codemods are a starting point, not an authority.

```bash
git diff
```

- [ ] **Step 4: Commit only if there is something to commit**

```bash
git add -A
git commit -F - <<'EOF'
chore: apply the eslint v9-to-v10 codemod

<REPLACE: what it changed and why it was kept. Delete this task's commit
entirely if the codemod was a no-op, which is the expected outcome.>
EOF
```

---

### Task 5: Full gate run, docs, and rollback criteria

- [ ] **Step 1: Every gate, each exit code read unpiped**

```bash
npx tsc --noEmit;                                   echo "TSC=$?"
npx eslint --max-warnings=0 src/app;                echo "LINT_APP=$?"
npx eslint --max-warnings=0 .;                      echo "LINT_ALL=$?"
npm run test:run    > /tmp/suite.log 2>&1;          echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:coverage > /tmp/cov.log 2>&1;          echo "COV=$?"
npm run size:check  > /tmp/size.log 2>&1;           echo "SIZE=$?"
npm run dup:check   > /tmp/dup.log 2>&1;            echo "DUP=$?"
npm run build       > /tmp/build.log 2>&1;          echo "BUILD=$?"
```

Expected: every one EXIT=0.

★ `test:coverage` is separate from `test:run` and its floors (global lines 92 / funcs 91 / branch 80 / stmts 89, plus per-engine globs) are BLOCKING in CI while `test:run` does not enforce them. Task 1 removed code from six files; a removed branch can move a per-file ratio.

★ A vitest run reporting a suspiciously LOW file count means workers crashed, not that the suite shrank. Compare `Test Files` against a pre-upgrade run.

- [ ] **Step 2: e2e smoke**

```bash
npm run e2e:smoke > /tmp/e2e.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2e.log
```

Nothing here should touch runtime behaviour, so a failure means Task 1's restructure changed something — most plausibly the menu-roving or dismissal code.

- [ ] **Step 3: Check the docs for a stated ESLint version**

```bash
grep -rn "eslint" CONTRIBUTING.md docs/RUNBOOK.md AGENTS.md | grep -iv "eslint.config\|eslint-disable" | head -20
```

Update any that names a version. `AGENTS.md` describes the lint gate's behaviour at length (the `--max-warnings=0` trap, the `exhaustive-deps` member-expression rule, the `set-state-in-effect` ban) — check those claims still hold under v10 and correct anything that has drifted. That file is ungated; nothing else will catch it.

- [ ] **Step 4: Commit any doc corrections**

```bash
git add CONTRIBUTING.md docs/RUNBOOK.md AGENTS.md
git commit -F - <<'EOF'
docs: record the eslint 10 toolchain

<REPLACE: what was corrected. Skip this commit if nothing stated a version.>
EOF
```

- [ ] **Step 5: Rollback, if the spike said no**

Trigger: bucket (b) from Task 3 Step 5 — `eslint-config-next`'s bundled plugins misbehaving under v10 in a way that cannot be resolved without loosening the gate.

```bash
npm install -D eslint@^9 > /tmp/rollback.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Then revert the Task 3 commit only. **Keep Task 1** — the six dead initializers are an improvement under eslint 9 and are independent of the upgrade. Add a numbered entry to `docs/open-followups.md` recording exactly which plugin failed and how, so the next attempt starts from evidence rather than repeating the spike.

★ STOP HERE. Do not push, open an MR, or merge. Those happen only on an explicit instruction from the user.

---

## Self-review

**Spec coverage:** every row of the spec's audit table is either pre-verified (0 `eslint-env`, flat config, no custom plugins, no bracket globs, no Node API integration) or has a task — Node floor → Task 2; the 3 new recommended rules → Task 1; JSX tracking → Task 3; codemod → Task 4; `stylish`/`chalk` is cosmetic and needs none. The spec's "definition of done" maps to Task 5 Step 1 (gates), Step 3 (docs), and Task 3 Step 6 (no silent rule disables).

**Ordering rationale:** Task 1 lands under eslint 9 deliberately, so its six edits are verified on a known-good toolchain and the upgrade commit isolates upgrade fallout. Task 2 precedes the bump because a Node floor failure would otherwise surface as a confusing CI-only error mid-spike.

**Placeholders:** three `<REPLACE: …>` markers remain, all inside commit-message bodies, all for text that cannot be known until the spike runs (which rules reported, what the codemod did, what the docs said). Each states explicitly what to write and when to delete the commit entirely. No step's *actions* are unspecified.

**Naming consistency:** `/tmp/lint-v9.json` and `/tmp/lint-v10.json` are the before/after captures compared in Task 3 Step 5. Buckets (a)/(b)/(c) are defined in Task 3 Step 5 and referenced by Task 3 Step 6 and Task 5 Step 5 with the same meanings.
