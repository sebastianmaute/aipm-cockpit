# Pin `next` Exactly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin `next` to exactly `16.2.11`, write down the framework-coupled-packages-are-exact-pinned rule that already governs three other packages, re-scope TD-1 to the 16.3 bump alone, and release it as 0.255.1.

**Architecture:** No application code changes. One specifier in `package.json`, the matching specifier in `package-lock.json`, and prose in four documents. The installed dependency tree is byte-identical before and after — that is what makes the browser gates skippable and `npm ci` the load-bearing verification.

**Tech Stack:** npm 10 / Node 24 · GitLab CI (`npm ci` at all four install sites) · the repo's own doc gates (`docs:symbols:check`, `docs:claims:check`)

**Spec:** `docs/superpowers/specs/2026-08-22-next-exact-pin-design.md`

**Branch:** `chore/pin-next-exactly`, already cut from `docs/ci-live-turso` and already carrying the two spec commits. Do **not** re-cut it from `main` — that drops §215, which is unpushed and exists nowhere else.

---

## A note on testing, read before Task 1

**This slice has no unit-testable logic, and the plan does not pretend otherwise.** There is no function to write a failing test against — the change is a version specifier and prose. Fabricating a test that asserts `package.json` contains a string would pin the edit to itself and prove nothing.

What replaces TDD here is a **falsifiable check per task, run before and after**, so each task has a red state and a green state:

- Task 1's check is `npm ci`, which *errors* on a `package.json`/lock mismatch. That is a real red/green, not an inspection.
- The doc tasks are checked by `docs:symbols:check` and `docs:claims:check`, both of which read the files being edited.
- The version bump is checked by a sweep whose **output is read**, never counted.

★★★ **Read every exit code unpiped.** `npm run test:run | tail` reports `tail`'s status, not the suite's, and discards the failure diagnostic — a failing suite then reads as green. The pattern throughout this plan is:

```bash
<command> > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/out.log
```

★★ `node -e` on this machine resolves `/tmp` to `C:\tmp`, which is **not** where the Bash tool writes. If a step needs Node to read a file the shell just wrote, write it under the repo or pass the content on stdin.

---

## File Structure

| File | Responsibility in this slice | Task |
|---|---|---|
| `package.json` | the `next` specifier — the one substantive change | 1 |
| `package-lock.json` | the matching specifier; must move for `next` and nothing else | 1 |
| `CONTRIBUTING.md` | **owns** the dependency-pinning policy (new `### Dependencies` section) | 2 |
| `AGENTS.md` | one line, which currently states the caret and goes false; becomes the pointer | 3 |
| `docs/tech-debt-register.md` | TD-1 re-scoped to the 16.3 bump | 4 |
| `docs/work-inventory.md` | three wrong version strings | 5 |
| `src/app/version.ts` · `CHANGELOG.md` · `README.md` · `docs/CODEMAPS/*.md` | the 0.255.1 release | 6 |

The policy fact lives in exactly one file (`CONTRIBUTING.md`); `AGENTS.md` links rather than restates. That is the repo's doc-set rule, and it is why Task 3 is one line and not a paragraph.

---

## Task 1: Pin `next` and regenerate the lockfile

**Files:**
- Modify: `package.json` (the `"next"` line in `dependencies`)
- Modify: `package-lock.json` (the `next` specifier under the root package's `dependencies`)

- [ ] **Step 1: Record the pre-state, so the diff can be judged**

```bash
node -e "const p=require('./package.json');console.log('spec:',p.dependencies.next)"
node -e "const l=require('./package-lock.json');console.log('installed:',l.packages['node_modules/next'].version)"
npm outdated next; echo "EXIT=$?"
```

Expected:
```
spec: ^16.2.11
installed: 16.2.11
Package  Current  Wanted  Latest ...
next     16.2.11  16.3.2  16.3.2 ...
EXIT=1
```

★ `npm outdated` exits **1** when something is outdated. That is success at this step, not failure.

- [ ] **Step 2: Confirm the tree is clean before touching the lockfile**

```bash
git status --porcelain -uall; echo "EXIT=$?"
```

Expected: no output. A dirty tree here makes Step 5's diff unreadable, which is the whole control on this task.

- [ ] **Step 3: Edit the specifier**

In `package.json`, change the `next` entry in `dependencies`:

```diff
-    "next": "^16.2.11",
+    "next": "16.2.11",
```

Leave `react`, `react-dom` and `eslint-config-next` alone — they are already exact.

- [ ] **Step 4: Regenerate the lockfile without touching `node_modules`**

```bash
npm install --package-lock-only > /tmp/lockgen.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/lockgen.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Read the WHOLE lock diff — this is the control on the task**

```bash
git diff --stat package-lock.json
git diff package-lock.json
```

Expected: a single hunk changing the `next` specifier under the root package's `dependencies` from `^16.2.11` to `16.2.11`.

★★★ **28 other packages currently show available drift** (`npm outdated` lists them), and npm re-resolves opportunistically, so a stale lock can pick up unrelated bumps in this same command. If **anything** other than the `next` specifier moved:

```bash
git checkout -- package-lock.json
```

then edit that one specifier string by hand and re-run Step 5. Do not accept a lock diff you have not read line by line — `--stat` alone is not enough, because a version bump and a specifier change look identical in a file count.

- [ ] **Step 6: Verify with `npm ci`, which cannot be fooled**

```bash
npm ci > /tmp/ci.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/ci.log
```

Expected: `EXIT=0`.

★★ This is the load-bearing check of the whole slice. `npm ci` installs strictly from the lockfile and **errors** when `package.json` and the lock disagree, so a clean run is direct proof the two agree — not an inference from a diff that looked right.

- [ ] **Step 7: Confirm the range no longer reaches 16.3**

```bash
npm outdated next; echo "EXIT=$?"
```

Expected: the **Wanted** column now reads `16.2.11` where it read `16.3.2`. That column is the tell.

★★ **`npm outdated` STILL EXITS 1 AND STILL PRINTS A ROW, and an earlier revision of this step said it would go silent with `EXIT=0`.** That was wrong about the command's semantics, not about the pin: `npm outdated` reports any package whose **Latest** exceeds **Current**, whatever the specifier says, so a correctly pinned package that upstream has moved past is reported forever. Measured after the pin landed:

```
Package  Current   Wanted  Latest
next     16.2.11  16.2.11  16.3.2
```

with `EXIT=1`. Pre-pin the same row read `Wanted 16.3.2`. So neither the exit code nor silence proves anything here — read the Wanted column, which is the only part the specifier controls.

- [ ] **Step 8: Confirm the installed tree did not move**

```bash
node -e "const l=require('./package-lock.json');console.log('installed:',l.packages['node_modules/next'].version)"
```

Expected: `installed: 16.2.11` — identical to Step 1. If this changed, the pin was applied at the wrong version.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json
git commit --only package.json package-lock.json -m "$(cat <<'EOF'
chore: pin next exactly at 16.2.11

The specifier was `^16.2.11` while `npm outdated` reported Wanted 16.3.2,
so only package-lock.json held the version the tree is actually tested
against. react, react-dom and eslint-config-next are already exact; next
was the omission from that set, not a different choice.

CI cannot drift — all four install sites are `npm ci`, which installs
strictly from the lock and errors on a package.json/lock mismatch. The
exposure this closes is a lockfile merge conflict resolved the wrong way:
committed, then installed faithfully, reported green.

Pinned at 16.2.11 rather than 16.2.12 because `npm audit` is clean at every
severity, so there is no security pressure, and 16.2.12 is not privileged by
the old range anyway — `^16.2.11` resolves to 16.3.2.

The lock diff is the specifier alone; the installed version is unchanged and
`npm ci` exits 0.
EOF
)"
```

---

## Task 2: Write the policy into `CONTRIBUTING.md`

**Files:**
- Modify: `CONTRIBUTING.md` — insert a new `### Dependencies` section immediately **before** the existing `### Versioning` section

Both sections are repo-hygiene rules about files that carry version strings, so they belong together.

- [ ] **Step 1: Confirm the insertion point**

```bash
grep -n "^### Versioning" CONTRIBUTING.md
```

Expected: one hit. Insert directly above it.

- [ ] **Step 2: Verify the claim the new text makes, before writing it**

The section asserts that exactly three packages are exact-pinned. Confirm it rather than trusting the spec:

```bash
node -e "const p=require('./package.json');const all={...p.dependencies,...p.devDependencies};const e=Object.entries(all).filter(function(x){return /^[0-9]/.test(x[1])});console.log('total',Object.keys(all).length,'exact',e.length);console.log(e.map(function(x){return x[0]+'@'+x[1]}).join(', '))"
```

Expected after Task 1:
```
total 35 exact 4
next@16.2.11, react@19.2.4, react-dom@19.2.4, eslint-config-next@16.2.6
```

★ `exact` is **4** here, not 3 — Task 1 already landed. If it still reads 3, Task 1 was not committed and this task is out of order.

- [ ] **Step 3: Insert the section**

```markdown
### Dependencies

**Framework-coupled packages are pinned exactly, with no range:** `next`,
`react`, `react-dom`, `eslint-config-next`. Every other dependency carries a
caret so patch releases flow without a slice each.

`npm ci` — which is what all four CI install sites use — already installs
strictly from `package-lock.json`, so an exact pin is *not* what makes an
install reproducible. It protects the **specifier**, which is what a lockfile
merge conflict resolves against: a conflict resolved the wrong way is
committed, and CI then installs it faithfully and reports green.

For `next` specifically, a silent minor bump moves the tree off the version
the `AGENTS.md` opening warning is calibrated against — and every gate stays
green while it happens.

Adding a framework-coupled dependency? Pin it exactly and add it to this list.
Verify the current split with:

```bash
node -e "const p=require('./package.json');const all={...p.dependencies,...p.devDependencies};console.log(Object.entries(all).filter(function(x){return /^[0-9]/.test(x[1])}).map(function(x){return x[0]+'@'+x[1]}).join(', '))"
```
```

- [ ] **Step 4: Check the doc gates read it cleanly**

```bash
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/claims.log
```

Expected: `EXIT=0`, and the summary still says **none added**.

★★ `CONTRIBUTING.md` **is** in the claims gate's scope. Add no `path:LINE` citations to it — the gate is a ratchet and fails on a new one. The section above deliberately names files without line numbers.

- [ ] **Step 5: Commit**

```bash
git add CONTRIBUTING.md
git commit --only CONTRIBUTING.md -m "$(cat <<'EOF'
docs: write down the exact-pin rule that already governed three packages

react, react-dom and eslint-config-next were exact-pinned and next was not,
and nothing recorded that this was a rule rather than an accident — which is
why the omission was possible to miss for as long as it was.

Placed beside Versioning: both sections are about files that carry a version
string and drift silently when nobody is looking.

States why the pin is not redundant with `npm ci`. The lock already pins the
install; the exact specifier is what a merge conflict resolves against.
EOF
)"
```

---

## Task 3: Point `AGENTS.md` at the rule

**Files:**
- Modify: `AGENTS.md` — the `npm run dev` line in the Commands block

This edit is **forced**, not optional: the line currently states the caret range and goes false the moment Task 1 lands.

- [ ] **Step 1: Find the line and confirm it is the only one**

```bash
grep -n "\^16\.2" AGENTS.md CONTRIBUTING.md
```

Expected: exactly one hit, in `AGENTS.md`, reading:

```
npm run dev                 # next dev (public next ^16.2.11 — read node_modules/next/dist/docs for version behavior)
```

★ `CONTRIBUTING.md` has no hit — it never mentioned the range. If Task 2's new section introduced one, remove it there instead.

- [ ] **Step 2: Replace it**

```diff
-npm run dev                 # next dev (public next ^16.2.11 — read node_modules/next/dist/docs for version behavior)
+npm run dev                 # next dev (public next, pinned EXACTLY at 16.2.11 — a caret here would let a
+                            # lockfile merge resolved the wrong way move the framework silently. Framework-coupled
+                            # packages are exact-pinned; the rule and its reasoning live in CONTRIBUTING.md
+                            # under "Dependencies". Read node_modules/next/dist/docs for version behavior.)
```

- [ ] **Step 3: Verify the caret is gone and the version survives**

```bash
grep -n "\^16\.2" AGENTS.md; echo "CARET_EXIT=$?"
grep -c "16\.2\.11" AGENTS.md
```

Expected: `CARET_EXIT=1` (no caret anywhere), and at least one `16.2.11`.

- [ ] **Step 4: Run the gate that actually reads this file**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/claims.log
```

Expected: both `EXIT=0`.

★★ `docs:symbols:check` fails when a **backticked mixed-case name** in `AGENTS.md` exists nowhere in the tree. The replacement text above deliberately backticks nothing — `CONTRIBUTING.md` is referenced in plain prose for exactly this reason.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit --only AGENTS.md -m "$(cat <<'EOF'
docs: AGENTS.md stated the caret, so the pin made it false

This line had to change regardless of where the policy lives — it annotated
`npm run dev` with "public next ^16.2.11", which stopped being true the
moment the specifier became exact.

Made it the pointer rather than a second copy of the rule: it states the
exact version and why the caret is wrong, then sends the reader to
CONTRIBUTING.md. The fact stays in one file; the always-loaded file links to
it, which is the doc-set rule this repo already runs on.

Deliberately backticks no identifier — docs:symbols:check fails on a
backticked mixed-case name that does not exist in the tree, and
"CONTRIBUTING.md" is a filename, not a symbol.
EOF
)"
```

---

## Task 4: Re-scope TD-1 to the 16.3 bump

**Files:**
- Modify: `docs/tech-debt-register.md` — the `| TD-1 | ... |` row in the `## Open items` table

TD-1 **splits; it does not close.** The drift half is done as of Task 1; the 16.3 bump is untouched.

- [ ] **Step 1: Read the row in full before rewriting it**

```bash
grep -n "^| TD-1 |" docs/tech-debt-register.md | cut -c1-200
```

The row is a single very long table line. Rewrite it in place — do not split it across lines, which would break the Markdown table.

- [ ] **Step 2: Verify the two facts the new row asserts**

```bash
grep -nE "npm (ci|install)" .gitlab-ci.yml Dockerfile.dast
npm view next time --json > /tmp/ntime.json 2>/dev/null; echo "EXIT=$?"
```

Expected: four `npm ci` hits and no `npm install` hits across the two files; `EXIT=0` for the registry read.

★★ If you parse `/tmp/ntime.json` in Node, copy it into the repo first or pass it on stdin — `node -e` resolves `/tmp` to `C:\tmp` here. Also note the file is a **one-element array**, not an object: iterating the parsed value directly finds zero versions and reports the drift as absent.

- [ ] **Step 3: Replace the row's Item and Notes cells**

New Item cell:

```
Next.js 16.3 is unowned — the version is now pinned, the upgrade is not
```

New Notes cell (single line in the file):

```
★★ **The drift half of this row is CLOSED as of 0.255.1** — `next` is pinned exactly at `16.2.11`, matching `react`, `react-dom` and `eslint-config-next`, and the rule is written down in `CONTRIBUTING.md` under "Dependencies". What remains is owning the upgrade itself. ★★★ **THIS ROW USED TO IMPLY THE PIPELINE WAS EXPOSED, AND IT IS NOT.** It said "any install that does not honour the lock" moves the version; all four CI install sites are `npm ci`, which installs strictly from the lockfile and errors on a `package.json`/lock mismatch, so CI could never drift. The real route was always a `package-lock.json` merge conflict resolved the wrong way — committed, then installed faithfully and reported green — which is precisely what an exact specifier now prevents. ★ Release timeline, so the gap is a date and not a rotting "days old" figure: 16.2.11 (our pin) 2026-07-21 · 16.2.12 2026-07-25 · 16.3.0 2026-08-03 · 16.3.1 2026-08-13 · 16.3.2 2026-08-21. Re-derive with `npm view next time --json` — ★★ that command returns a ONE-ELEMENT ARRAY, not an object, so a script that iterates the parsed value directly finds nothing and reports no drift. ★★ `npm outdated next` still EXITS 1 and still prints a row — it reports on Latest-vs-Current and ignores the specifier, so a pinned package upstream has moved past is reported forever. The pin shows up in the **Wanted** column alone (`16.3.2` → `16.2.11`). Reading the exit code or an absence of output as "no drift" gets it exactly backwards; compare against `npm view next version` instead. ★★ The bump needs the browser gates the pin was exempt from (e2e, axe, `e2e:smoke:prod`) — a framework minor can move rendering and CSP behaviour — plus a decision on whether `eslint-config-next` moves in step (pinned at `16.2.6` while `next` was at `16.2.11`, so lockstep is not required) and a check against the ESLint 10 block in `docs/open-followups.md` §53 and §45, which lives in that package's bundled `eslint-plugin-react`. ★ The installed `node_modules/next/dist/docs/` ships with the INSTALLED version, so 16.2.11's copy cannot describe 16.3 — read it after upgrading, not before. Design: `docs/superpowers/specs/2026-08-22-next-exact-pin-design.md` §5.
```

- [ ] **Step 4: Verify the table still parses and the gates pass**

```bash
grep -c "^| TD-" docs/tech-debt-register.md
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/claims.log
```

Expected: the same TD- row count as before the edit (the row was rewritten, not added or removed), and `EXIT=0` with **none added**.

★ `docs/tech-debt-register.md` is in the claims gate's scope. The replacement cell cites `§53` and `§45` as section numbers, never as `path:LINE` — that form is what the ratchet counts.

- [ ] **Step 5: Commit**

```bash
git add docs/tech-debt-register.md
git commit --only docs/tech-debt-register.md -m "$(cat <<'EOF'
docs: TD-1 splits — the pin is done, the 16.3 bump is not

Two pieces of work sat under one row. The specifier half closed in this
slice; the upgrade half is untouched, so the row is re-scoped to it rather
than resolved.

Corrects the row's severity in the direction of less alarm, which is the
direction that gets skipped. It implied the pipeline could drift; it cannot,
because all four CI install sites are `npm ci` and that errors on a
package.json/lock mismatch. The real route was a lockfile merge conflict
resolved the wrong way, and an exact specifier is what closes it.

Records the release timeline as dates rather than a "days old" figure that
rots, and corrects what `npm outdated next` proves: it reports on
Latest-vs-Current and ignores the specifier, so it still exits 1 after the
pin and only the Wanted column moved. Carries the array-shaped
`npm view next time --json` trap, which reports no drift when parsed wrong.
EOF
)"
```

---

## Task 5: Fix `docs/work-inventory.md`, and the spec's own count

**Files:**
- Modify: `docs/work-inventory.md` — three wrong version strings
- Modify: `docs/superpowers/specs/2026-08-22-next-exact-pin-design.md` — §6.2 says "two", and there are three

★★ **The spec undercounted this and the plan must not inherit the error.** Spec §6.2 says "Two corrections … in §3 and §5". There are **three**, in §3, §5 and §7.

- [ ] **Step 1: Enumerate the real hits**

```bash
grep -n '0\.254\.0' docs/work-inventory.md
```

Expected: three lines — 80, 196 and 231 (line numbers will have shifted if anything above them changed; go by content, not by number).

- [ ] **Step 2: Correct all three**

Each reads `0.254.0 "Bisson"` and must become `0.255.0 "Bisson"`. The icon migration shipped as **0.255.0**; **0.254.0 was "Yoshinaga"**, a different slice.

```bash
node -e "const f='docs/work-inventory.md';const fs=require('fs');const s=fs.readFileSync(f,'utf8');const out=s.split('0.254.0 \"Bisson\"').join('0.255.0 \"Bisson\"');console.log('replacements:',s.split('0.254.0 \"Bisson\"').length-1);fs.writeFileSync(f,out)"
```

Expected: `replacements: 3`.

★ This targets the **full string including the codename**, so it cannot touch a legitimate mention of 0.254.0 "Yoshinaga" elsewhere in the file.

- [ ] **Step 3: Verify both directions**

```bash
grep -n '0\.254\.0 "Bisson"' docs/work-inventory.md; echo "STALE_EXIT=$?"
grep -c '0\.255\.0 "Bisson"' docs/work-inventory.md
grep -n '0\.254\.0' docs/work-inventory.md
```

Expected: `STALE_EXIT=1` (none left), a count of at least 3, and the third command showing only mentions that legitimately refer to the 0.254.0 release.

★★ Do **not** refresh the file's other measured figures in this pass. The file's own header says every number in it rots and must be re-derived by the reader; a partial refresh produces a document that looks freshly measured and is not.

- [ ] **Step 4: Fix the spec's undercount**

In `docs/superpowers/specs/2026-08-22-next-exact-pin-design.md` §6.2, change:

```diff
-Two corrections, both the same error: the icon migration is recorded as shipping
-**0.254.0 "Bisson"** in §3 and §5. It shipped as **0.255.0**; 0.254.0 was **"Yoshinaga"**.
+Three corrections, all the same error: the icon migration is recorded as shipping
+**0.254.0 "Bisson"** in §3, §5 and §7. It shipped as **0.255.0**; 0.254.0 was **"Yoshinaga"**.
+
+★ This said "two … §3 and §5" until implementation counted them. The spec was written
+from a grep of §3 and §5 alone and never swept the file — the same class of error the
+slice is correcting, committed while correcting it.
```

- [ ] **Step 5: Commit**

```bash
git add docs/work-inventory.md docs/superpowers/specs/2026-08-22-next-exact-pin-design.md
git commit --only docs/work-inventory.md docs/superpowers/specs/2026-08-22-next-exact-pin-design.md -m "$(cat <<'EOF'
docs: the icon migration shipped as 0.255.0, not 0.254.0

work-inventory.md recorded it as 0.254.0 "Bisson" in three places. 0.254.0
was "Yoshinaga" — a different slice — and the icon work is 0.255.0. This is
the exact version-collision class that bit during that slice's own review,
now written into the file the backlog is navigated by, which is how it
propagates to whoever picks the next slice.

Replaced on the full string including the codename, so a legitimate mention
of 0.254.0 "Yoshinaga" cannot be caught by it.

Also corrects the spec, which said there were two and named §3 and §5. There
are three; §7 was missed because the spec was written from a grep of the two
sections rather than a sweep of the file.

Deliberately does not refresh the file's other figures. Its own header says
every number in it rots and must be re-derived, and a partial refresh
produces a document that looks freshly measured and is not.
EOF
)"
```

---

## Task 6: Release 0.255.1

**Files:**
- Modify: `src/app/version.ts` · `CHANGELOG.md` · `package.json` · `package-lock.json` · `README.md` · `docs/CODEMAPS/architecture.md` · `docs/CODEMAPS/backend.md` · `docs/CODEMAPS/data.md` · `docs/CODEMAPS/dependencies.md` · `docs/CODEMAPS/frontend.md`

- [ ] **Step 1: Fetch and check nobody released while this branch was open**

```bash
git fetch origin
git log origin/main --oneline -3
git show origin/main:src/app/version.ts | grep -E "APP_VERSION|APP_MILESTONE"
```

Expected: `APP_VERSION = "0.255.0"`, `APP_MILESTONE = "Bisson"`.

★★★ **If `origin/main` is past 0.255.0, stop and renumber before going further.** The icon slice collided at exactly this step — `main` shipped 0.254.0 while that branch was in review — and this branch additionally carries two commits that have been unpushed for longer.

- [ ] **Step 2: Enumerate the carriers, and identify the two that must NOT move**

```bash
grep -n "0\.255\.0" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/*.md
```

Expected: **12 hits**. Two of them are not carriers:

| Hit | Action |
|---|---|
| `src/app/version.ts` — `APP_VERSION` | bump |
| `src/app/version.ts` — trailing comment on `APP_BUILD_DATE` | **rewrite by hand** to describe 0.255.1, not substitute |
| `package.json` — `version` | bump |
| `package-lock.json` — root `version` | bump |
| `package-lock.json` — root package entry `version` | bump |
| `README.md` — shields badge | bump the version; the codename in it is already `Bisson` |
| each of the 5 codemap headers — `App 0.255.0 "Bisson"` | bump |
| `docs/CODEMAPS/dependencies.md` — prose, "the app's ONLY icon set since 0.255.0" | **LEAVE ALONE** |

★★★ **Do not `sed` this.** That prose sentence is a historical fact about the icon migration; bumping it would assert that lucide became the sole icon set in 0.255.1, which is false. Edit each carrier deliberately.

- [ ] **Step 3: `src/app/version.ts`**

```diff
-export const APP_VERSION = "0.255.0";
-export const APP_BUILD_DATE = "2026-08-22"; // 0.255.0: one icon set app-wide — heroicons retired (Bisson)
+export const APP_VERSION = "0.255.1";
+export const APP_BUILD_DATE = "2026-08-22"; // 0.255.1: next pinned exactly at 16.2.11 (Bisson)
```

★★ `APP_MILESTONE` is **not** touched. Patch releases inherit their minor series' codename — 0.211.1/.2 are both "Samatar", 0.202.1–.4 all "Beukes" — and the docstring already scopes "Bisson" to the 0.255.x *line*. `APP_HIGHLIGHT_KEYS` is **not** touched either: a dependency pin is not a user-facing highlight, which also means no EN/DE string pair and no `i18n.de.ts` edit.

- [ ] **Step 4: `CHANGELOG.md` — insert directly above the `## [0.255.0]` heading**

```markdown
## [0.255.1] - 2026-08-22 "Bisson"

### Changed
- **`next` is now pinned to an exact version** rather than a caret range. The lockfile already held 16.2.11, but the specifier allowed 16.3.2, so a `package-lock.json` merge conflict resolved the wrong way could have moved the framework silently — and every gate would have stayed green. `react`, `react-dom` and `eslint-config-next` were already pinned this way; the rule is now written down in `CONTRIBUTING.md`.

### Fixed
- The tech-debt register implied CI could drift onto a newer Next.js. It could not — every CI install site uses `npm ci`, which installs strictly from the lockfile. The row now describes the real exposure and is re-scoped to the 16.3 upgrade, which remains open.
```

★ Use a **hyphen** in the heading, matching the recent entries. Older entries use an em dash; new ones must not.

★★ No `[session link removed]...` URL in `CHANGELOG.md`. Commit trailers are fine.

- [ ] **Step 5: `package.json`, `package-lock.json`, `README.md`, and the five codemap headers**

```diff
 // package.json
-  "version": "0.255.0",
+  "version": "0.255.1",
```

```diff
 // package-lock.json — BOTH occurrences, the root one and the root package entry
-  "version": "0.255.0",
+  "version": "0.255.1",
```

```diff
 // README.md
-[![version](https://img.shields.io/badge/version-v0.255.0_%22Bisson%22-2e7d32)](./CHANGELOG.md)
+[![version](https://img.shields.io/badge/version-v0.255.1_%22Bisson%22-2e7d32)](./CHANGELOG.md)
```

In each of the five `docs/CODEMAPS/*.md` headers, change `App 0.255.0 "Bisson"` to `App 0.255.1 "Bisson"`.

★ Change **only** the App version in those headers. They also carry a `counts re-verified <date> at <sha>` clause — nothing was regenerated and no source file moved, so editing that clause would assert a re-verification that did not happen.

- [ ] **Step 6: Verify the sweep by READING it, not counting it**

```bash
grep -n "0\.255\.0" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/*.md
grep -n "0\.255\.1" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/*.md
```

Expected: the first returns **exactly one line** — the historical prose in `docs/CODEMAPS/dependencies.md`. The second shows `package-lock.json` **twice** and each codemap header **once**.

- [ ] **Step 7: Confirm the milestone and highlights are untouched**

```bash
grep -n "APP_MILESTONE" src/app/version.ts | head -2
git diff --stat src/app/version.ts
```

Expected: `APP_MILESTONE = "Bisson"`, and the `version.ts` diff is **2 changed lines** — `APP_VERSION` and the build-date comment. If `APP_HIGHLIGHT_KEYS` appears in the diff, revert that part.

- [ ] **Step 8: `npm ci` again — the version fields live in both files it cross-checks**

```bash
npm ci > /tmp/ci2.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/ci2.log
```

Expected: `EXIT=0`. A mismatch between `package.json`'s `version` and the lock's two copies fails here.

- [ ] **Step 9: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit --only src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS -m "$(cat <<'EOF'
chore(release): 0.255.1 "Bisson"

Patch release, so the codename is inherited rather than minted — 0.211.1/.2
are both "Samatar", 0.202.1-.4 all "Beukes", and APP_MILESTONE's docstring
already scopes "Bisson" to the 0.255.x line. APP_MILESTONE and
APP_HIGHLIGHT_KEYS are both untouched, so no i18n.de.ts edit is involved and
the umlaut-corruption hazard is not engaged.

Carriers were edited individually, not substituted. The string 0.255.0
occurs 12 times across these files and two of them must not move:
version.ts's trailing APP_BUILD_DATE comment, which is rewritten to describe
this release, and a prose sentence in docs/CODEMAPS/dependencies.md reading
"the app's ONLY icon set since 0.255.0" — a historical fact about the icon
migration that a blanket sed would have restated as a claim about 0.255.1.

The codemap headers' "counts re-verified" clause is deliberately left alone:
nothing was regenerated and no source file moved, so touching it would
assert a verification that did not happen.
EOF
)"
```

---

## Task 7: Full gate chain

**Files:** none — verification only.

★★★ **Never run two vitest processes at once.** Machine saturation is the load-sensitive-flake condition in this repo. Run these sequentially.

- [ ] **Step 1: Typecheck, lint, unit suite**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC=$?"; tail -3 /tmp/tsc.log
npm run lint > /tmp/lint.log 2>&1; echo "LINT=$?"; tail -3 /tmp/lint.log
npm run test:run > /tmp/test.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/test.log
```

Expected: `TSC=0`, `LINT=0`, `TEST=0`. The suite should report the same pass count as `main` — no test touches any file in this slice.

★ Every `echo "EXIT=$?"` here is **unpiped and immediately after** the command. Piping a gate reports the pipe's status, not the command's.

- [ ] **Step 2: Ratchets and doc gates**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"; tail -2 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"; tail -3 /tmp/dup.log
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"; tail -3 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "CLAIMS=$?"; tail -2 /tmp/claims.log
```

Expected: all four `=0`, and the claims summary still reads **none added**.

- [ ] **Step 3: Record what was deliberately NOT run**

No browser gates: `e2e`, the axe gate, `e2e:visual`, `e2e:smoke:prod`. The installed dependency tree is byte-identical before and after this slice.

★★★ **"AND NO RUNTIME CODE CHANGED" WAS THE ORIGINAL SECOND HALF OF THAT SENTENCE AND IT IS FALSE.** `src/app/version.ts` is runtime code, and `APP_VERSION_LABEL` is threaded into `ModernShell` (`task-manager.tsx`) and rendered in Settings and the version-info modal. A version bump DOES change what a browser paints. The exemption survives, but only for three reasons that had to be checked one at a time — none of which is "nothing changed":

1. `e2e/a11y.spec.ts`'s version guard imports `APP_VERSION` from source and compares it to the served app's `data-app-version`. Both sides move together, because its job is catching a STALE SERVER, not pinning a literal.
2. `e2e/visual.spec.ts` (dashboard · gantt · open-points, all of which paint the shell) MASKS the version label outright — `mask: [page.locator('button[title="Version history"]')]`, the sidebar control whose `title` is `versionHistory` and whose body holds the version string, with the spec's own comment saying it "churns every release". So a bump is invisible to these three screenshots STRUCTURALLY. ★★ The budget beside it (`maxDiffPixelRatio: 0.01`) would also have absorbed one glyph, and an earlier revision of this reason cited ONLY the budget — one layer short of the real guarantee, in the very correction round that exists to document reading one layer short.
3. The ZERO-tolerance baseline — `e2e/icon-gallery.visual.spec.ts`, `maxDiffPixels: 0` — targets `/icon-gallery`, a standalone page that renders no shell and no version string. Verified: its `page.tsx` references neither `ModernShell` nor `APP_VERSION`.

★★ So a future slice must NOT reuse this exemption by analogy. Reason 2 masks the version control and NOTHING else: a change that repaints more of the shell can exceed 1% while sounding just as harmless as a version bump, and reason 3 holds only while that page stays shell-free.

★★ This exemption is specific to *this* slice and does not transfer to the 16.3 bump, which changes the framework and needs all of them.

- [ ] **Step 4: Confirm the tree is clean and the branch is coherent**

```bash
git status --porcelain -uall; echo "STATUS_EXIT=$?"
git log --oneline origin/main..HEAD
```

Expected: no output from the first; the second lists the two spec commits, the two carried commits (§215 and the gitignore chore), and this slice's five commits.

---

## Task 8: Hold for release instruction

**Files:** none.

- [ ] **Step 1: Report, and stop**

Push, MR and merge happen **only** on an explicit instruction from the user, and merge only on a green pipeline. Never `--auto-merge`.

Report: the branch name, the commit list, the gate results with their exit codes, and the two carried commits that will reach `origin` with this MR (§215 and the gitignore chore).

★ No `[session link removed]...` URL in the MR description. Commit trailers and MR comments are unaffected.

---

## Self-review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| §2.1 the pin · §2.2 the lockfile | 1 |
| §3.3 policy text · §3.1 the counter | 2 |
| §3.4 the forced AGENTS.md edit | 3 |
| §4 TD-1 disposition | 4 |
| §6.2 work-inventory | 5 |
| §8 release shape · §8.1 the carriers | 6 |
| §7 verification | 7 |
| §8 push only on instruction | 8 |
| §6.1 branch base | pre-done — branch already cut from `docs/ci-live-turso` |
| §6.3 scratch artifacts | pre-done — deleted before the branch was cut |
| §5 what the 16.3 slice needs | carried into TD-1's new Notes cell by Task 4 |

**Placeholder scan:** no TBD/TODO. Every step that changes a file shows the exact text. Every command has an expected output.

**Consistency:** the branch name is `chore/pin-next-exactly` throughout; the pinned version is `16.2.11` in every task; the release is `0.255.1 "Bisson"` in every task; `APP_MILESTONE` is stated as untouched in both Task 6 and the spec.

**One divergence from the spec, deliberate:** Task 5 corrects the spec's own "two corrections" to "three". Found by running the enumeration this plan asks for, against a spec written from a partial grep.
