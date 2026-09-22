# Offered-Surface Sweep Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the offered-surface sweep (detector, axis module, spec, plan, register rows) on `main`, green against main's current code, with its acceptance mutants re-proved there.

**Architecture:** Port, not merge. The branch `feat/offered-surface-sweep` (20 commits, never pushed) splits into 15 detector/docs commits and 5 fix commits; main already carries the fixes in a later, review-corrected form (0.297.0, MR !460). This plan copies the branch-only files verbatim first, then adapts only what main changed underneath them, then re-measures everything on main. Spec: `docs/superpowers/specs/2026-09-11-offered-surface-sweep-landing-design.md`.

**Tech Stack:** Vitest 4 + Testing Library (unit), TypeScript, git. No production code changes except one docstring paragraph.

> **As executed:** see "As executed › A second src/app comment edit" — `inline-ai-edit/plan.ts` comments also changed, in 32769326.

---

## Read before starting

**Branch:** `feat/offered-surface-sweep-landing`, already created off `origin/main` = `fe82d1db` in `C:\Projects\aipm-wt-a`, carrying one commit (the spec). The source branch is `feat/offered-surface-sweep`; its fork point is `754e8129`. Do not check out, rebase or modify the source branch.

**Scratch directory.** Every log goes here, never `/tmp` (shared across sessions) and never the repo:

```bash
SCRATCH="/c/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad"
```

Give every log a basename unique to its task (`t5-baseline.log`, `t7-m1.log` …). Never reuse another task's log.

**Hard rules — each has cost real work in this repo:**

1. **Never read an exit code through a pipe.** Redirect to a file, `echo "EXIT=$?"` on its own, then grep the file.
2. **Never run two vitest processes at once.** Always `--maxWorkers=1`. Never background a vitest run.
3. **Never `git add -A` / `git add .`** — an untracked file in this checkout holds a live credential. Stage explicit paths; commit with `git commit --only <paths>`. **Never `git commit --amend`.**
4. **`git checkout -- <file>` is deny-blocked**, and `git restore` must not be used as a substitute. Revert a mutant with an inverse Edit whose anchor is asserted unique in BOTH directions, then prove `git diff --stat` empty.
5. **Never bare `git stash`.** **Never `npm ci`.**
6. **Line endings.** Every `src/**` file is `i/lf w/crlf` (index LF, working tree CRLF). Edit them with the Edit tool only — never the Write tool, never `sed -i`, never a heredoc. Docs under `docs/` are LF.
7. **`src/app/sanitize-records.ts` sits at exactly the 1600-line ratchet LIMIT (§447).** Nothing in this plan may leave it longer. Mutants there are same-line replacements and are reverted.
8. **`src/app/i18n.ts` / `src/app/i18n.de.ts` are off limits.** Nothing here needs a key.
9. **No full suite, no `npm run test:shuffle`.** The user's standing instruction: run only the gates this slice moves. CI runs both full suites (`unit-tests`, `unit-tests-shuffled` — both blocking).
10. **Read `tsc` by its `src/` error count, not its exit code:** `npx tsc --noEmit > "$SCRATCH/tN-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "^src/" "$SCRATCH/tN-tsc.log"`. Expected `0`.
11. **Every script whose source contains a backslash is written to a file with the Write tool, never inlined** into `node -e` or a heredoc. Measured while writing this plan: an inline `node -e` carrying `\\|` reached node as `\|`, the JS template literal then read it as `|`, and a regex silently matched the wrong thing — `0/5` on a check whose real answer is `5/5`. Single-backslash `grep -E` patterns in double quotes (`"^\s+"`, `"\."`) are unaffected.

**A red sweep case is a FINDING, not a failure of this plan.** If a Relation A or Relation B case fails on main, STOP and report to the controller, who takes it to the user as a go/cut decision. Never make the sweep green by exempting a field, narrowing a probe, weakening a floor, adding a skip, or editing `SYNTHETIC_INPUTS`. The axis docstrings carry the precedents; read them before touching the axis.

**Commit trailer.** Every commit message ends with the session trailer.

Commit messages carry backticks and quotes, so write each to `$SCRATCH/tN-msg.txt` with the Write tool and commit with `git commit --only <paths> -F "$SCRATCH/tN-msg.txt"`. A heredoc carrying backticks has already broken the shell once in this session.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md` | Create (port + banner) | Dated record of the original design |
| `docs/superpowers/plans/2026-09-08-offered-surface-sweep.md` | Create (port + banner) | Dated record of the original plan as executed |
| `src/test/offered-surface-axis.ts` | Create (port), then adapt `AXIS_BASELINE` only if Task 6 applies | The axis: offered surface read from `TOOL_DEFS`, persisted columns, create bases, recorded axis sizes |
| `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` | Create (port, verbatim) | The detector: axis floors, Relation A, Relation B |
| `src/app/inline-ai-edit/plan.create-path-guards.test.ts` | Modify (hand-port of `5f0de0de`) | Seven create-path guard pins, now reading `CREATE_BASE` |
| `src/app/inline-ai-edit/plan.model-writable-surface.test.ts` | Modify (cherry-pick `f99aa51a`, `799ae26c`) | §437 ratchet, now reading shared `PERSISTED_COLUMNS` |
| `src/app/chat-tools-updates.ts` | Modify (one docstring paragraph) | Records the measured create-strip redundancy |
| `docs/open-followups.md` | Modify | Close §436 · §439; mint §440–446 |

> **As executed:** see "As executed › Commit map" — the sweep gained a ledger, axis comments changed, §459–§461 were filed.

---

## Task 1: Port the original spec and plan as dated records

**Files:**
- Create: `docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md`
- Create: `docs/superpowers/plans/2026-09-08-offered-surface-sweep.md`

- [ ] **Step 1: Copy both files from the source branch (LF, byte-exact)**

```bash
cd /c/Projects/aipm-wt-a
git show feat/offered-surface-sweep:docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md > docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md
git show feat/offered-surface-sweep:docs/superpowers/plans/2026-09-08-offered-surface-sweep.md > docs/superpowers/plans/2026-09-08-offered-surface-sweep.md
for f in docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md docs/superpowers/plans/2026-09-08-offered-surface-sweep.md; do
  git show feat/offered-surface-sweep:$f | cmp - $f && echo "BYTE-EXACT $f"; done
```

Expected: `BYTE-EXACT` printed twice.

- [ ] **Step 2: Insert the banner after the title line of each file**

Write this script to `$SCRATCH/t1-banner.mjs` with the Write tool, then run `node "$SCRATCH/t1-banner.mjs"`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const BANNER = [
  "",
  "> **Landing note, 2026-09-11 — execution split.** The fixes this detector found shipped in",
  "> 0.297.0 \"Gentle\" (MR !460) on a rebased branch. The detector, its axis module and its register",
  "> rows landed separately via `docs/superpowers/specs/2026-09-11-offered-surface-sweep-landing-design.md`,",
  "> re-measured against main. Everything below is the dated record of the branch as executed and is not",
  "> rewritten: branch SHAs cited below never reached main, and figures below are the branch's, not main's.",
].join("\n");
for (const f of [
  "docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md",
  "docs/superpowers/plans/2026-09-08-offered-surface-sweep.md",
]) {
  const s = readFileSync(f, "utf8");
  if (s.includes("\r")) throw new Error(`${f}: expected LF-only`);
  if (s.includes("Landing note, 2026-09-11")) throw new Error(`${f}: banner already present`);
  const nl = s.indexOf("\n");
  if (!s.startsWith("# ") || nl < 0) throw new Error(`${f}: first line is not an H1`);
  writeFileSync(f, s.slice(0, nl) + "\n" + BANNER + s.slice(nl));
  console.log("bannered", f);
}
```

Expected: `bannered …` twice.

- [ ] **Step 3: Verify**

```bash
for f in docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md docs/superpowers/plans/2026-09-08-offered-surface-sweep.md; do
  head -8 "$f"; node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log('CR',(s.match(/\r/g)||[]).length)" "$f"; done
```

Expected: each shows its H1, a blank line, the five-line `>` banner; `CR 0` twice.

- [ ] **Step 4: Commit**

Message (`$SCRATCH/t1-msg.txt`):

```
docs(ai): carry the offered-surface sweep's spec and plan onto main as dated records

Both were written and executed on feat/offered-surface-sweep, which never
reached main; 0.297.0 took its fixes and left these behind. Copied byte-exact
from the branch, then bannered so a reader knows the figures and SHAs inside
are the branch's, not main's. The bodies are not rewritten.
```

```bash
git add -- docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md docs/superpowers/plans/2026-09-08-offered-surface-sweep.md
git commit --only docs/superpowers/specs/2026-09-08-offered-surface-sweep-design.md docs/superpowers/plans/2026-09-08-offered-surface-sweep.md -F "$SCRATCH/t1-msg.txt"; echo "EXIT=$?"
git status --short
```

Expected: `EXIT=0`; `git status --short` prints nothing.

---

## Task 2: Port the axis module and the sweep test verbatim

**Files:**
- Create: `src/test/offered-surface-axis.ts`
- Create: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

Verbatim first, so every later adaptation to main is a visible diff against the branch's own text.

- [ ] **Step 1: Write both files with CRLF working-tree endings**

Write `$SCRATCH/t2-port.mjs` with the Write tool (hard rule 11), then run `node "$SCRATCH/t2-port.mjs"`:

```js
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
for (const f of [
  "src/test/offered-surface-axis.ts",
  "src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts",
]) {
  if (existsSync(f)) throw new Error(`${f} already exists — refusing to overwrite`);
  const blob = execFileSync("git", ["show", `feat/offered-surface-sweep:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (blob.includes("\r")) throw new Error(`${f}: blob already carries CR`);
  writeFileSync(f, blob.replace(/\n/g, "\r\n"));
  console.log("wrote", f, blob.split("\n").length, "lines");
}
```

(`execFileSync` with an argument array, never a shell string: `cmd.exe` eats `^` and other characters in a shell string.)

Expected: `wrote src/test/offered-surface-axis.ts 228 lines` and `wrote src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts 818 lines` (±1: `split` counts the trailing newline).

- [ ] **Step 2: Stage and prove the blobs are byte-identical to the branch and the working tree is CRLF**

```bash
git add -- src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
for f in src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts; do
  [ "$(git rev-parse :$f)" = "$(git rev-parse feat/offered-surface-sweep:$f)" ] && echo "SAME BLOB $f" || echo "DIFFERENT BLOB $f"; done
git ls-files --eol src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/test/inline-sweep-fixtures.ts
```

Expected: `SAME BLOB` twice; all three lines `i/lf    w/crlf`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit > "$SCRATCH/t2-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "^src/" "$SCRATCH/t2-tsc.log"; grep "^src/" "$SCRATCH/t2-tsc.log" | head -20
```

Expected: `0`. Every import was checked against main's exports while planning (`src/test/chat-dispatcher-fixture.tsx`, `inline-sweep-fixtures.ts`, `ai-entity-token.ts`, `chat-proposal-apply.ts`, `inline-ai-edit/plan.ts`, `csv-codecs-core.ts` all export what is imported). If errors appear, they are real drift between the branch and main: report them to the controller with the full error lines. Do not edit either file to silence them in this task.

- [ ] **Step 4: Do NOT run the test yet.** Task 5 is the measurement; running it here produces a number nobody records.

- [ ] **Step 5: Commit (verbatim port — may be red against main, which Task 5 measures)**

Message (`$SCRATCH/t2-msg.txt`):

```
test(ai): carry the offered-surface sweep and its axis onto main, verbatim

Byte-identical to feat/offered-surface-sweep's tip (blob hashes compared).
Nothing is adapted here on purpose: every change main needs is made in a
later commit, so it reads as a diff against the branch's own text rather
than disappearing into the copy.

Not yet measured against main. The axis reads TOOL_DEFS at runtime and main
gained declarations after the branch forked, so the recorded axis sizes may
have moved; the next commits measure that.
```

```bash
git commit --only src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -F "$SCRATCH/t2-msg.txt"; echo "EXIT=$?"
git status --short
```

Expected: `EXIT=0`; clean.

---

## Task 3: Hand-port `5f0de0de` onto main's `plan.create-path-guards.test.ts`

**Files:**
- Modify: `src/app/inline-ai-edit/plan.create-path-guards.test.ts`

Main changed this file twice after the fork (`3ca1a9d9`, `ee6a7ef7`), so the branch's copy must not be taken. The regions `5f0de0de` touched are byte-identical on main (verified while planning), so the edits below are that commit's hunks, applied one at a time. Use the Edit tool for each; each `old_string` must match exactly once.

- [ ] **Step 1: Confirm the regions are still what this task expects**

```bash
F=src/app/inline-ai-edit/plan.create-path-guards.test.ts
grep -c -F "drives \`update_*\` tools ONLY — its plumbing reads" $F
grep -c -F "and must not be read as create-path parity coverage. A real create relation —" $F
grep -c -F 'valid: { title: "A risk" },' $F
grep -c -F 'valid: { title: "A change" },' $F
grep -c -F 'valid: { name: "A milestone", date: "2026-06-01" },' $F
grep -c -F 'valid: { name: "Ada Lovelace" },' $F
grep -c -F 'valid: { firstName: "Grace", lastName: "Hopper" },' $F
grep -c -F 'valid: { assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" },' $F
grep -c -F 'recurrence: { freq: "weekly", interval: 1 },' $F
```

Expected: nine `1`s. Any other count: stop and report — main moved since planning.

- [ ] **Step 2: Correct the header's first ★★★ paragraph**

`old_string`:

```
// drives `update_*` tools ONLY — its plumbing reads
// `INLINE_DESCRIPTORS[entity].updateTool` and there is no create relation to
// read — so every guard added at a merge site was, until §438, a guard on
// editing alone. A field the model was refused when EDITING was accepted when
// CREATING, silently, on six of the seven create tools.
```

`new_string`:

```
// drives `update_*` tools ONLY — its plumbing hardcodes
// `INLINE_DESCRIPTORS[entity].updateTool` — so every guard added at a merge
// site was, until §438, a guard on editing alone. A field the model was refused
// when EDITING was accepted when CREATING, silently, on six of the seven create
// tools.
//
// ★★ `createTool` WAS THERE THE WHOLE TIME, and saying otherwise overstates the
// work. It is a declared member of `InlineEntityDescriptor` and all eight
// entities carry one (`grep -c 'createTool: "create_' entity-descriptor.ts` →
// 8); `chat-proposal-describe.ts` indexes `toolEntity[d.createTool]` off it.
// `sweepPlumbing` simply declines to read it. The same wrong sentence sat in
// §439 and is corrected there too.
```

All three factual claims were re-verified against main while planning: the grep prints `8`, `chat-proposal-describe.ts:66` is `toolEntity[d.createTool] = d.entity;`, and `sweepPlumbing` (`src/test/inline-sweep-fixtures.ts`) reads `.updateTool` only.

> **As executed:** see "As executed › Task 3: the prescribed comment named a type that does not exist" — the type is `EntityDescriptor`; 82e7ee87 fixed the comment.

- [ ] **Step 3: Correct the "PIN, NOT A SWEEP" paragraph**

`old_string`:

```
// ★★ THIS IS A PIN, NOT A SWEEP. It asserts one refused field per entity
// rather than enumerating an axis, so it cannot replace the mechanical sweep
// and must not be read as create-path parity coverage. A real create relation —
// comparing the create CARD against the created ROW — is still owed; see §438.
// What this file buys is that the seven guards cannot be quietly removed from
// the create sites again.
```

`new_string`:

```
// ★★ THIS IS A PIN, NOT A SWEEP. It asserts one refused field per entity rather
// than enumerating an axis, so it cannot replace a mechanical sweep and must not
// be read as create-path parity coverage. The axis-driven create relation it
// was waiting for is `plan.offered-surface-sweep.test.ts` (§439); what this file
// buys on top is that the seven guards cannot be quietly removed from the create
// sites again.
```

- [ ] **Step 4: Add the import**

`old_string`:

```
import { JUNK_KEY, KNOWLEDGE_LINKS, snapshot, type WsKey } from "../../test/inline-sweep-fixtures";
```

`new_string`:

```
import { JUNK_KEY, KNOWLEDGE_LINKS, snapshot, type WsKey } from "../../test/inline-sweep-fixtures";
import { CREATE_BASE } from "../../test/offered-surface-axis";
```

- [ ] **Step 5: Replace the six single-line `valid` payloads**

Six Edit calls, one per row:

| `old_string` | `new_string` |
|---|---|
| `    valid: { title: "A risk" },` | `    valid: CREATE_BASE.raid,` |
| `    valid: { title: "A change" },` | `    valid: CREATE_BASE.change,` |
| `    valid: { name: "A milestone", date: "2026-06-01" },` | `    valid: CREATE_BASE.milestone,` |
| `    valid: { name: "Ada Lovelace" },` | `    valid: CREATE_BASE.stakeholder,` |
| `    valid: { firstName: "Grace", lastName: "Hopper" },` | `    valid: CREATE_BASE.resource,` |
| `    valid: { assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" },` | `    valid: CREATE_BASE.absence,` |

`CREATE_BASE`'s values are byte-identical to these six literals (`git show feat/offered-surface-sweep:src/test/offered-surface-axis.ts | grep -A 16 "export const CREATE_BASE"`), so the pins exercise exactly what they did.

- [ ] **Step 6: Replace the calendarEvent `valid` block**

`old_string`:

```
    valid: {
      title: "Weekly sync",
      startDate: "2026-06-01",
      startTime: "09:00",
      durationMinutes: 30,
      // `sanitizeCalendarEvent` stores exceptions only when a recurrence is
      // present, so without this the probe cannot land and the assertion would
      // pass whatever the guard did.
      recurrence: { freq: "weekly", interval: 1 },
    },
```

`new_string`:

```
    // `sanitizeCalendarEvent` stores exceptions only when a recurrence is
    // present, so without it the probe cannot land and the assertion would pass
    // whatever the guard did. That is why `CREATE_BASE.calendarEvent` carries a
    // recurrence rather than being the bare `required` set — see its docstring.
    valid: CREATE_BASE.calendarEvent,
```

- [ ] **Step 7: Prove the result equals main's file plus exactly `5f0de0de`'s intent**

```bash
F=src/app/inline-ai-edit/plan.create-path-guards.test.ts
git diff --stat -- $F
grep -c "CREATE_BASE\." $F
grep -c 'valid: {' $F
git ls-files --eol $F
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log('bare LF',(s.match(/(?<!\r)\n/g)||[]).length)" $F
```

Expected: one file changed; `CREATE_BASE.` count `7`; `valid: {` count `0`; `w/crlf`; `bare LF 0`.

> **As executed:** see "As executed › Task 3 Step 7: the `CREATE_BASE.` count" — 8 at a278cc30 (Step 6's own comment), 9 at 32769326.

- [ ] **Step 8: Run it**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.create-path-guards.test.ts > "$SCRATCH/t3-cpg.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3-cpg.log"
```

Expected: `EXIT=0`, `Test Files  1 passed (1)`. Record the test count. Red here means a `CREATE_BASE` value differs from what main's pins need — report it; do not edit `CREATE_BASE`.

- [ ] **Step 9: Commit**

Message (`$SCRATCH/t3-msg.txt`):

```
test(ai): the create-path pins read their payloads from the shared CREATE_BASE

Hand-port of the branch commit that lifted these seven payloads into the
offered-surface axis. Main changed this file twice after the branch forked,
so the branch's copy was not taken; the hunks were re-applied one at a time
against main's text, whose affected regions were byte-identical.

The payloads are the same bytes, so the pins exercise what they did. The
header's createTool sentence is corrected here, as it is in §439: createTool
is a declared member on all eight descriptors (grep -c prints 8), and only
sweepPlumbing declines to read it.
```

```bash
git commit --only src/app/inline-ai-edit/plan.create-path-guards.test.ts -F "$SCRATCH/t3-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 4: Repoint the §437 ratchet at the shared `PERSISTED_COLUMNS`

**Files:**
- Modify: `src/app/inline-ai-edit/plan.model-writable-surface.test.ts`

Main has not touched this file since the fork, so `f99aa51a` and `799ae26c` (which touch only this file) apply cleanly by cherry-pick.

- [ ] **Step 1: Confirm main has not touched the file since the fork**

```bash
git log --format=%h 754e8129..HEAD -- src/app/inline-ai-edit/plan.model-writable-surface.test.ts
git show --stat --format= f99aa51a 799ae26c | grep '|'
```

Expected: first command prints nothing; second prints only `plan.model-writable-surface.test.ts`, twice.

- [ ] **Step 2: Cherry-pick both, without committing**

```bash
git cherry-pick -n f99aa51a 799ae26c > "$SCRATCH/t4-cp.log" 2>&1; echo "EXIT=$?"; cat "$SCRATCH/t4-cp.log"
git diff --cached --stat
git ls-files --eol src/app/inline-ai-edit/plan.model-writable-surface.test.ts
```

Expected: `EXIT=0`; staged diff touches only that one file; `w/crlf`. On a non-zero exit run `git cherry-pick --abort` and report — do not resolve by hand.

- [ ] **Step 3: Run it**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.model-writable-surface.test.ts > "$SCRATCH/t4-mws.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t4-mws.log"
```

Expected: `EXIT=0`. Record the count.

- [ ] **Step 4: Commit**

Message (`$SCRATCH/t4-msg.txt`):

```
test(ai): the §437 ratchet reads the shared PERSISTED_COLUMNS

Cherry-picked from feat/offered-surface-sweep (f99aa51a, then 799ae26c's
comment trim). Main has not touched this file since the branch forked, so
both applied cleanly. The ratchet and the offered-surface sweep now read one
definition of "the persisted columns" instead of two private ones.
```

```bash
git commit --only src/app/inline-ai-edit/plan.model-writable-surface.test.ts -F "$SCRATCH/t4-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 5: The baseline run on main — the measurement gate

**Files:** none modified. This task produces measurements.

- [ ] **Step 1: Run the whole inline-ai-edit directory once, serially**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/ > "$SCRATCH/t5-baseline.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5-baseline.log"
grep -E "plan\.offered-surface-sweep\.test\.ts" "$SCRATCH/t5-baseline.log" | head -3
```

- [ ] **Step 2: Classify every failure**

```bash
grep -E "^ *(FAIL|×|✗) " "$SCRATCH/t5-baseline.log" | sort -u
grep -cE "stored the model's undeclared value" "$SCRATCH/t5-baseline.log"
grep -cE "changed nothing and the card said nothing" "$SCRATCH/t5-baseline.log"
grep -cE "create was offered the field and dropped it" "$SCRATCH/t5-baseline.log"
```

Sort each failure into exactly one bucket:

- **(a) Axis-size floor only** — test name `<entity>: the axis is the size it was measured at`. Go to Task 6.
- **(b) Relation A or Relation B, or any other axis floor** — a FINDING. **STOP.** Report to the controller: entity, relation, arm (create/update), field names and the failure message verbatim. The controller takes it to the user as go/cut. Do not proceed to Task 6 or later.
- **(c) A test file other than the sweep** — this slice broke a neighbour. Report it; do not fix it.

If there are no failures, Task 6 is skipped.

> **As executed:** see "As executed › Task 5: the baseline and the go/cut stop" — five bucket (b) failures; the go/cut decision added a findings ledger.

- [ ] **Step 3: Record the write-path sweep's verbose fingerprint (Task 7's mutant 4 needs it)**

```bash
npx vitest run --maxWorkers=1 --reporter=verbose src/app/inline-ai-edit/plan.write-path-sweep.test.ts > "$SCRATCH/t5-wps.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5-wps.log"
grep -E "^\s+(✓|×|↓)" "$SCRATCH/t5-wps.log" | sed -E 's/ [0-9]+ms$//' | md5sum
```

- [ ] **Step 4: Write the baseline record**

Write `$SCRATCH/landing-baseline.md` containing: the sweep file's RUNTIME test count (its own line in the Step 1 output — expected 73, which is 5 axis checks × 8 entities + 2 × 8 Relation A + 1 + 2 × 8 Relation B); its failed/passed split; the three finding-string counts; the full failure list with bucket labels; the write-path sweep's passed count and md5. Tasks 6, 7, 8 and 9 read their numbers from this file only.

> **As executed:** see "As executed › Task 5: the baseline and the go/cut stop" — 73 tests, 5 failed, 6 finding lines; 74 tests after the ledger.

---

## Task 6 (only if Task 5 found bucket (a) failures): re-baseline `AXIS_BASELINE` as a recorded decision

> **As executed:** see "As executed › Task 6: skipped" — no axis-size case failed; `AXIS_BASELINE` is unchanged.

**Files:**
- Modify: `src/test/offered-surface-axis.ts` (the `AXIS_BASELINE` object and its docstring only)

`AXIS_BASELINE`'s docstring: "A RECORDED BASELINE, NOT A TARGET. A change here is legitimate whenever a schema or a CSV column list changes — but it must be a DECISION." Each moved number must be traced to a named commit on main.

- [ ] **Step 1: Read each floor failure's expected-vs-received pair from the log**

```bash
grep -A 12 "the axis is the size it was measured at" "$SCRATCH/t5-baseline.log" | grep -E "Expected|Received|declared|undeclared|^\s+[-+] " | head -60
```

Record per entity: branch `{declared, undeclared}` → main `{declared, undeclared}`.

- [ ] **Step 2: Attribute every move to a schema or column change on main since the fork**

```bash
git diff 754e8129 HEAD -- src/app/chat-tool-defs.ts | grep -E "^[-+]\s+[a-zA-Z]+: \{" 
git diff 754e8129 HEAD -- src/app/csv-codecs-core.ts | grep -E "^[-+]" | grep -v -E "^(\+\+\+|---)"
git log --format='%h %s' 754e8129..HEAD -- src/app/chat-tool-defs.ts src/app/csv-codecs-core.ts
```

Candidates known while planning: `599a87bf` (declares `raid.ownerEmail`), `43ae5cab` (declares `stakeholders.email`). A field that moves from undeclared to declared trades one-for-one when the persisted column count is unchanged — the same shape as the `change` paragraph already in the docstring.

**If any move cannot be attributed to a specific line in those diffs, STOP and report.** An unexplained axis move is exactly what the floor exists to catch.

- [ ] **Step 3: Update the numbers and record the decision**

With the Edit tool, change only the moved entities' numbers in `AXIS_BASELINE`, change the docstring's first line from `The axis sizes measured on \`origin/main\` = 754e8129, 2026-09-08.` to `The axis sizes measured on \`origin/main\` = fe82d1db, 2026-09-11 (first measured at 754e8129, 2026-09-08).`, and append one paragraph per moved entity immediately before `export const AXIS_BASELINE`, inside the docstring, in this form (fill the brackets from Step 2 — every bracket is a measured value, never a guess):

```
 *
 *  ★★ `<entity>` MOVED <old d>/<old u> -> <new d>/<new u> ON 2026-09-11, AND THAT IS A
 *  DECISION, NOT DRIFT. `<commit>` declared `<field>` on the `<tool>` schema, so it
 *  LEFT the undeclared set and JOINED the declared one; the persisted column count
 *  did not move, which is why the two numbers trade one-for-one. Relation B now
 *  probes it on both arms.
```

If a move is not one-for-one (the column count changed too), say so explicitly and name the `csv-codecs-core.ts` line.

- [ ] **Step 4: Re-run the sweep and prove only the floor moved**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t6-sweep.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t6-sweep.log"
```

Expected: `EXIT=0`, 73 passed. Anything else is a finding: back to Task 5 Step 2's bucket (b).

- [ ] **Step 5: Commit**

Message (`$SCRATCH/t6-msg.txt`) — fill the entity lines from Step 2:

```
test(ai): re-measure the offered-surface axis on main, and record why it moved

The axis sizes were measured at the branch's fork point. Main declared
fields after that, and the floor that pins the sizes went red on exactly
those entities and nowhere else:

  <entity>: <old> -> <new>, <commit> declared <field>
  ...

Each move is attributed to a named commit in the docstring, the way the
existing `change` paragraph records its own. No relation was touched, no
field exempted, and the sweep is otherwise unchanged.
```

```bash
git commit --only src/test/offered-surface-axis.ts -F "$SCRATCH/t6-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 7: Re-prove the six acceptance mutants on main

**Files:** each mutant temporarily edits one file and reverts it. The tree must be committed and clean before starting: `git status --short` prints nothing.

**Expected outcome, from the branch:** mutants 1, 3, 4, 5, 6 are KILLED; mutant 2 SURVIVES (§441 records that survival and why). Any other outcome changes a register row's text in Task 9 — record it, do not "fix" it.

**The scorecard rule.** Record each mutant as `N failed / M passed` for the sweep file, with `N + M` equal to the runtime count in `$SCRATCH/landing-baseline.md`, plus the names of the newly failing cases. A mutant that changes nothing is SURVIVED; name it as such.

> **As executed:** see "As executed › Task 7: mutant outcomes" — M3 survived, M4 died on the create arm; sums are 74.

**Every mutant follows this shape:**

1. `git status --short` prints nothing.
2. Apply with the Edit tool.
3. **Assert it landed:** `git diff --stat` shows exactly the expected file, 1 insertion / 1 deletion (mutant 6: 1 insertion / 0 deletions); `grep -c -F '<mutant text>' <file>` prints `1`.
4. Run, redirect, `echo "EXIT=$?"` unpiped, grep the log.
5. Revert with the inverse Edit. Assert `grep -c -F '<original text>' <file>` prints `1` and `grep -c -F '<mutant text>' <file>` prints `0`.
6. `git diff --stat` prints nothing.

Run command for mutants 1, 2, 3, 5, 6 (substitute `N`):

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t7-mN.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t7-mN.log"; grep -E "^ *(FAIL|×) " "$SCRATCH/t7-mN.log" | sort -u
```

- [ ] **Mutant 1 — Relation A, denylist entity, create path** — `src/app/use-register-tools.ts`

Original: `const item = sanitizeStakeholder({ ...dropUnacceptedStakeholderFields(input), id, raci: {} });`
Mutant: `const item = sanitizeStakeholder({ ...input, id, raci: {} });`

Expected: KILLED — Relation A `stakeholder` create fails.

- [ ] **Mutant 2 — Relation A, denylist entity, update path** — `src/app/use-chat-dispatcher.ts`

★ Re-anchored for main: the spread now sits on its own line inside a multi-line object, so the branch plan's one-line anchor matches nothing here.

Original (confirm `grep -c -F '          ...dropUnacceptedResourceFields(patch),' src/app/use-chat-dispatcher.ts` prints `1` first): `          ...dropUnacceptedResourceFields(patch),`
Mutant: `          ...patch,`

Expected: SURVIVED, per §441 (the resource update guard's refusals are CLEARs, which Relation A's probe-value assertion cannot see). If it is KILLED on main, record which case failed: §441's text changes in Task 9.

- [ ] **Mutant 3 — Relation A, allowlist entity, create path** — `src/app/use-register-tools.ts`

Original: `const item = sanitizeCalendarEvent({ ...dropUnacceptedCalendarEventFields(input), id });`
Mutant: `const item = sanitizeCalendarEvent({ ...input, id });`

Expected: KILLED — Relation A `calendarEvent` create fails on `exceptions` (§438's defect, reintroduced).

> **As executed:** see "As executed › Task 7: mutant outcomes" — SURVIVED on main; only `plan.create-path-guards.test.ts` catches it.

- [ ] **Mutant 4 — Relation B, allowlist entity: §436's own reproduce** — `src/app/sanitize-records.ts`

Original: `  note: (v) => typeof v === "string",` (inside `ABSENCE_FIELD_GUARDS`; confirm the count is `1`)
Mutant: `  note: () => false,`

Run BOTH detectors in one invocation, so the contrast is recorded rather than asserted:

```bash
npx vitest run --maxWorkers=1 --reporter=verbose \
  src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts \
  src/app/inline-ai-edit/plan.write-path-sweep.test.ts \
  > "$SCRATCH/t7-m4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t7-m4.log"
grep -E "^\s+(✓|×|↓)" "$SCRATCH/t7-m4.log" | grep "write-path-sweep\|Write-path\|write path" | head -3
npx vitest run --maxWorkers=1 --reporter=verbose src/app/inline-ai-edit/plan.write-path-sweep.test.ts > "$SCRATCH/t7-m4-wps.log" 2>&1; echo "EXIT=$?"
grep -E "^\s+(✓|×|↓)" "$SCRATCH/t7-m4-wps.log" | sed -E 's/ [0-9]+ms$//' | md5sum
```

Expected: the offered-surface sweep KILLED on Relation B `absence` update, field `note`; the write-path sweep's passed count AND md5 identical to `$SCRATCH/landing-baseline.md` (it stays blind — §436's measurement). Record both halves. If the write-path sweep moves, §436's measurement no longer holds: report before continuing.

> **As executed:** see "As executed › Task 7: mutant outcomes" — killed on the absence CREATE arm; the update arm stayed green.

- [ ] **Mutant 5 — Relation B, denylist entity** — `src/app/sanitize-records.ts`

First confirm `severity` is a declared raid property and has a `RAID_FIELD_GUARDS` row:

```bash
grep -n -F "severity: acceptsRaidSeverity," src/app/sanitize-records.ts
grep -n "RAID_FIELD_GUARDS" src/app/sanitize-records.ts | head -2
grep -n "severity" src/app/chat-tool-defs.ts | head -5
```

Original: `  severity: acceptsRaidSeverity,`
Mutant: `  severity: () => false,`

Expected: KILLED — Relation B `raid` update fails on `severity`.

- [ ] **Mutant 6 — the axis itself** — `src/test/offered-surface-axis.ts`

Original line (anchor): `export function declaredProperties(entity: InlineEntity, op: "create" | "update"): readonly string[] {`
Mutant: insert, immediately after that line, `  if (entity === "stakeholder") return [];` (with CRLF — use the Edit tool with `old_string` = the anchor line and `new_string` = the anchor line, a newline, and the inserted line).

Expected: KILLED by floor 1 (`stakeholder: the axis is the size it was measured at`). Floor 3 does NOT fire and cannot — the branch plan's Task 8 records why (the union's two terms are complements over one base). Revert by the inverse Edit.

- [ ] **Final step: the tree is clean and the scorecard is written**

```bash
git diff --stat; git status --short
```

Expected: both print nothing. Append the six-row scorecard to `$SCRATCH/landing-baseline.md`.

---

## Task 8: Re-measure and restore the create-strip redundancy note

**Files:**
- Modify: `src/app/chat-tools-updates.ts` (one docstring paragraph)

The branch's `040c24f6` recorded: "reverting the strip at `create_absence` or at `create_calendar_event` leaves `plan.offered-surface-sweep.test.ts` UNCHANGED … the same revert at the other five takes it to [one more failure]". 0.297.0 kept that docstring's rule sentence and dropped the measurement, because the test it cited did not exist on main. It exists now; re-measure before writing a word of it.

- [ ] **Step 1: Confirm the seven call sites**

```bash
grep -n -F 'createInputWithoutId<' src/app/chat-tools.ts
```

Expected: seven lines — raid, change, milestone, resource, stakeholder, absence, calendarEvent. If the count differs, the note's "seven" is wrong: report it.

- [ ] **Step 2: Revert each strip in turn and run the sweep** — seven mutants, the Task 7 shape for each

All in `src/app/chat-tools.ts`. The mutant is the exact pre-0.297.0 form (`git show 29744af1 --format= -- src/app/chat-tools.ts` shows it). Each original must `grep -c -F` to `1` before applying:

| Entity | Original | Mutant |
|---|---|---|
| raid | `d.createRaid(createInputWithoutId<RaidInput>(input, "raid"))` | `d.createRaid(input as RaidInput)` |
| change | `d.createChange(createInputWithoutId<ChangeInput>(input, "change"))` | `d.createChange(input as ChangeInput)` |
| milestone | `d.createMilestone(createInputWithoutId<MilestoneInput>(input, "milestone"))` | `d.createMilestone(input as MilestoneInput)` |
| resource | `d.createResource(createInputWithoutId<ResourceInput>(input, "resource"))` | `d.createResource(input as ResourceInput)` |
| stakeholder | `d.createStakeholder(createInputWithoutId<StakeholderInput>(input, "stakeholder"))` | `d.createStakeholder(input as StakeholderInput)` |
| absence | `d.createAbsence(createInputWithoutId<AbsenceInput>(input, "absence"))` | `d.createAbsence(input as AbsenceInput)` |
| calendarEvent | `d.createCalendarEvent(createInputWithoutId<CalendarEventInput>(input, "calendarEvent"))` | `d.createCalendarEvent(input as CalendarEventInput)` |

Run:

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts > "$SCRATCH/t8-<entity>.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t8-<entity>.log"; grep -E "^ *(FAIL|×) " "$SCRATCH/t8-<entity>.log" | sort -u
```

Record, per entity: failed/passed and the failing case names. Revert; `git diff --stat` empty before the next.

- [ ] **Step 3: Decide what the note may say**

- If exactly absence and calendarEvent leave the sweep unchanged and each of the other five adds a failure: write the paragraph below with main's figures.
- Any other pattern: STOP and report the per-entity table. The note's claim would be different, and that is a decision for the controller, not a rewording.

- [ ] **Step 4: Insert the paragraph**

With the Edit tool, `old_string`:

```
 *  can keep straight.
 *
 *  ★★ `create_task` is deliberately NOT routed through this helper and that is
```

`new_string` (fill `<F0>/<P0>` = the unchanged figures from Task 5, `<F1>/<P1>` = the five-site figures from Step 2):

```
 *  can keep straight.
 *
 *  ★★ TWO OF THE SEVEN CALL SITES ARE DEFENCE IN DEPTH, NOT LOAD-BEARING, AND
 *  A MUTATION RUN WILL TELL YOU SO — do not read that as licence to delete
 *  them. Measured 2026-09-11: reverting the strip at `create_absence` or at
 *  `create_calendar_event` leaves `plan.offered-surface-sweep.test.ts` at
 *  <F0> failed / <P0> passed, i.e. UNCHANGED, because those two handlers guard
 *  with an ALLOWLIST that already drops both fields; the same revert at any of
 *  the other five takes it to <F1> failed / <P1>. That is the uniform rule
 *  above paying for itself, not an inconsistency in it.
 *
 *  ★★ `create_task` is deliberately NOT routed through this helper and that is
```

Confirm the `old_string` is unique first: `grep -c -F ' *  can keep straight.' src/app/chat-tools-updates.ts` prints `1`.

> **As executed:** see "As executed › Task 8: the note's shape" — main already had this paragraph; a five-line measurement was inserted into it instead.

- [ ] **Step 5: Verify**

```bash
F=src/app/chat-tools-updates.ts
git diff --stat -- $F
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log('lines',s.split('\n').length,'bare LF',(s.match(/(?<!\r)\n/g)||[]).length)" $F
npx eslint --max-warnings=0 $F > "$SCRATCH/t8-eslint.log" 2>&1; echo "EXIT=$?"
```

Expected: 9 insertions (eight text lines plus one ` *` separator), 0 deletions; `bare LF 0`; `EXIT=0`.

> **As executed:** see "As executed › Task 8: the note's shape" — 78569052 has 5 insertions, not 9.

- [ ] **Step 6: Commit**

Message (`$SCRATCH/t8-msg.txt`) — fill from Step 2:

```
docs(ai): restore the measured half of the create-strip note, re-measured on main

0.297.0 kept this docstring's uniform-strip rule and dropped the measurement
beside it, correctly: it cited plan.offered-surface-sweep.test.ts, which
main did not have. It does now, so the measurement was re-run against main
rather than copied from the branch.

Seven call-site reverts, one at a time:
  absence, calendarEvent  -> sweep unchanged (<F0> failed / <P0> passed)
  raid, change, milestone,
  resource, stakeholder   -> <F1> failed / <P1> each

Comment only.
```

```bash
git commit --only src/app/chat-tools-updates.ts -F "$SCRATCH/t8-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 9: The register — close §436 · §439, mint §440–446

**Files:**
- Modify: `docs/open-followups.md` (LF-only, ~2.5 MB — edit by node script with uniqueness assertions, never by Edit on an ambiguous anchor)

Every row's text was written against branch code. Each reproduce command below is re-run on this branch and its result compared with the row's claim. **A row whose claim no longer holds is corrected in this same commit** — never flagged for later.

> **As executed:** see "As executed › Task 9: split in two, and landed with the second fix round" — drafted, then applied; committed with fix round 2; §459–§461 added.

- [ ] **Step 1: Confirm the numbers are still free**

```bash
git fetch -q origin
for r in origin/main $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin | grep -v -x -e feat/offered-surface-sweep -e origin/HEAD); do
  h=$(git show $r:docs/open-followups.md 2>/dev/null | grep -oE '^## 44[0-6]\.' | tr '\n' ' '); [ -n "$h" ] && echo "$r: $h"; done
```

Expected: no output (nothing but the source branch holds §440–446). If `origin/main` moved, merge it first (`git merge origin/main`) and re-run Task 5 Step 1 before continuing.

- [ ] **Step 2: Extract the branch's text for the nine rows**

Write `$SCRATCH/t9-extract.mjs` with the Write tool (hard rule 11):

```js
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
const s = readFileSync(src, "utf8");
const at = (n) => {
  const m = [...s.matchAll(new RegExp(`^## ${n}\\.`, "gm"))];
  if (m.length !== 1) throw new Error(`## ${n}. occurs ${m.length}x on the branch`);
  return m[0].index;
};
const block = (a, b) => {
  if (at(b) < at(a)) throw new Error(`${b} precedes ${a}`);
  return s.slice(at(a), at(b));
};
writeFileSync(`${out}/t9-b436.md`, block(436, 437));
writeFileSync(`${out}/t9-b439.md`, block(439, 440));
writeFileSync(`${out}/t9-b440-446.md`, block(440, 450));
console.log("extracted");
```

```bash
git show feat/offered-surface-sweep:docs/open-followups.md > "$SCRATCH/t9-branch-of.md"
node "$SCRATCH/t9-extract.mjs" "$SCRATCH/t9-branch-of.md" "$SCRATCH"; echo "EXIT=$?"
wc -l "$SCRATCH"/t9-b436.md "$SCRATCH"/t9-b439.md "$SCRATCH"/t9-b440-446.md
```

Expected: 69, 50 and 287 lines.

- [ ] **Step 3: Re-verify every claim, row by row, and edit the extracted copies**

Run each command on THIS branch and edit the corresponding scratch copy wherever the result differs. Record every command and its output in `$SCRATCH/t9-verify.md`.

| Row | Re-run | Then |
|---|---|---|
| §436 | — | Heading `— CLOSED 2026-09-08` → `— CLOSED 2026-09-11`. Status first line `CLOSED 2026-09-08 by Relation B of` → `CLOSED 2026-09-11 by Relation B of`. In the ★ mutant-4 paragraph replace `37 passed` with the write-path sweep's passed count from Task 7 mutant 4, and state the md5 was compared against the unmutated baseline measured on main. |
| §439 | — | Heading and Status date → `2026-09-11`. Replace the sentence `It landed RED by design — 73 tests, 11 failing, 15 findings — so the relation exists and the surface it exposes is filed rather than fixed here (§440 · §441 · §442 · §443).` with: `It was built on a branch where it landed RED by design at its first baseline — 73 tests, 11 failing, 15 findings, 2026-09-08 — and the surface it exposed was filed (§440 · §441 · §443) or fixed (§442, shipped in 0.297.0). It landed on main on 2026-09-11 at <N> tests, <F> failing.` with `<N>/<F>` from `$SCRATCH/landing-baseline.md`. Keep the ★★★ `createTool` correction paragraph; its reproduce (`grep -c 'createTool: "create_' src/app/inline-ai-edit/entity-descriptor.ts` → 8) holds on main. |
| §440 | `grep -n "plan.rejected.push" src/app/inline-ai-edit/plan.ts` (row says **5**, none inside the `CREATE_TOOLS` branch) · `grep -n "plan.creates.push" src/app/inline-ai-edit/plan.ts` | Correct the count and the claim if they differ. |
| §441 | `grep -n "dropUnacceptedResourceFields" src/app/use-chat-dispatcher.ts` · `grep -n "NEEDS A VALID PROBE" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` · Task 7 mutant 2 result | The row says mutant 2 SURVIVED and five of six were killed. If Task 7 disagrees, the Status line and that sentence carry main's result. |
| §442 | `grep -n "decisionDate" src/app/chat-tool-defs.ts` (comments only) · `grep -n -B 2 "decisionDate: () => false" src/app/sanitize-records.ts` · `grep -n "dropUnacceptedChangeFields" src/app/use-register-tools.ts` (two call sites) · `grep -n "applyChangeStatus" src/app/use-register-tools.ts` · `grep -n -A 8 "export function applyChangeStatus" src/app/change-log.ts` · `grep -n -A 4 "export function applyModelChangeStatus" src/app/change-log.ts` | Keep the heading's `— CLOSED 2026-09-09`: the fix reached main that day (`## [0.297.0] - 2026-09-09 "Gentle"` in `CHANGELOG.md`). Remap the three branch SHAs, which never reach main: `6db1ea93` and `7e91855d` → `eca6312d`; `4c28d3fd` → `8162aa91` (verified by file set while planning: `eca6312d` touches exactly the union of the first two, minus the axis file; `8162aa91` exactly the third's set). Add `shipped in 0.297.0 "Gentle"` to the Status line. Then run the SHA check in Step 4. |
| §443 | `grep -n "MAIL_UNSAFE_BOOLEANS" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` · `grep -n "startTime" src/test/offered-surface-axis.ts src/test/inline-sweep-fixtures.ts` · `grep -n "validProbeFor" -A 30 src/test/inline-sweep-fixtures.ts \| grep -n "09:00\|10:00"` | The row claims the HH:MM branch has exactly two outputs and the seed holds `"14:00"`; correct if main's fixture differs. |
| §444 | — | Leave OPEN. Replace its body's reason (a peer session held a full suite) with: `This slice follows the standing instruction to run no full suite locally; CI's blocking unit-tests-shuffled job is the run that settles it, and this entry is closed citing that pipeline.` Task 11 closes it. |
| §445 | `grep -c "propose_project" src/app/chat-tool-defs.ts` (row says **0**) · `grep -n "TOOL_DEFS" src/test/offered-surface-axis.ts` · `grep -n "buildList(s.changes" src/app/ai-project-proposal.ts` · `git show 2645debb --stat --format=%s` | If `2645debb` (proposal seed-schema strip, 0.297.0) changed what can land through `propose_project`, add one sentence saying so; the REACHABILITY claim — neither relation drives `propose_project` — is what keeps the row OPEN. Drop the row only if a relation now reaches it. |
| §446 | `grep -n "decisionBy" src/app/chat-tool-defs.ts` (one property) · `grep -n "decisionBy" src/app/sanitize-records.ts` (one line, no `status` term, no `CHANGE_FIELD_GUARDS` row) · `grep -c "decisionBy" src/app/change-log.ts` (→ **0**) · `grep -n "decisionBy" src/app/inline-ai-edit/entity-descriptor.ts` | Correct any count that moved. |

> **As executed:** see "As executed › Task 9: prescribed wording that landed differently" — several rows landed reworded; the register entries are the record.

- [ ] **Step 4: Every SHA in the ported text must exist on this branch**

```bash
cat "$SCRATCH"/t9-b436.md "$SCRATCH"/t9-b439.md "$SCRATCH"/t9-b440-446.md | grep -oE "\b[0-9a-f]{8}\b" | sort -u | while read h; do
  git merge-base --is-ancestor $h HEAD 2>/dev/null && echo "ok   $h" || echo "GONE $h"; done
```

Expected: every line `ok`. Remap or delete each `GONE` — never leave one.

- [ ] **Step 5: Derive the anchor slugs — never type them**

Write `$SCRATCH/t9-slug.mjs` with the Write tool (hard rule 11):

```js
export const slug = (heading) =>
  heading.replace(/^##\s+/, "").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
```

Positive control first — it must reproduce existing anchors exactly, including one whose heading carries an em dash. Write `$SCRATCH/t9-slugcheck.mjs` with the Write tool:

```js
import { readFileSync } from "node:fs";
import { slug } from "./t9-slug.mjs";
const s = readFileSync("docs/open-followups.md", "utf8");
let ok = 0;
for (const n of [437, 438, 447]) {
  const h = s.match(new RegExp(`^## ${n}\\..*$`, "m"))[0];
  const want = s.match(new RegExp(`\\| \\[§${n}\\]\\(#([^)]+)\\)`))[1];
  if (slug(h) === want) ok++; else console.log(`MISMATCH ${n}\n  got  ${slug(h)}\n  want ${want}`);
}
console.log(`SLUG ${ok}/3`);
```

Run from the repo root (a `node -e` import cannot resolve an MSYS `/c/...` path, a script path argument can):

```bash
node "$SCRATCH/t9-slugcheck.mjs"
```

Expected: `SLUG 3/3`. (An em dash drops out and leaves TWO hyphens — the reason anchors are derived, never typed.)

- [ ] **Step 6: Apply to the register**

Index rows split on `" | "` into exactly five cells: `| [§N](#anchor)`, Item, Origin, Size, `State |`. Write `$SCRATCH/t9-apply.mjs` with the Write tool:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { slug } from "./t9-slug.mjs";

const SCRATCH = process.argv[2];
if (!SCRATCH) throw new Error("usage: node t9-apply.mjs <scratch dir>");
const REG = "docs/open-followups.md";
const read = (f) => readFileSync(`${SCRATCH}/${f}`, "utf8");

let s = readFileSync(REG, "utf8");
if (s.includes("\r")) throw new Error("register must be LF-only");
const b436 = read("t9-b436.md");
const b439 = read("t9-b439.md");
const b440 = read("t9-b440-446.md");
const branch = read("t9-branch-of.md");

const headAt = (txt, n) => {
  const m = [...txt.matchAll(new RegExp(`^## ${n}\\.`, "gm"))];
  if (m.length !== 1) throw new Error(`## ${n}. occurs ${m.length}x`);
  return m[0].index;
};
const heading = (txt, n) => txt.match(new RegExp(`^## ${n}\\..*$`, "m"))[0];

// 1. §436's block
{
  const a = headAt(s, 436), b = headAt(s, 437);
  if (b < a) throw new Error("437 precedes 436");
  s = s.slice(0, a) + b436 + s.slice(b);
}
// 2. §439's block, followed by the seven new ones, in the slot before §450
{
  const a = headAt(s, 439), b = headAt(s, 450);
  if (b < a) throw new Error("450 precedes 439");
  const inner = s.slice(a, b).split("\n").slice(1);
  if (inner.some((l) => /^## \d+\./.test(l))) throw new Error("a heading sits between 439 and 450 — main moved");
  s = s.slice(0, a) + b439 + b440 + s.slice(b);
}

// 3. index rows
const lines = s.split("\n");
const rowIdx = (arr, n) => {
  const hits = arr.flatMap((l, k) => (l.startsWith(`| [§${n}](`) ? [k] : []));
  if (hits.length !== 1) throw new Error(`index row §${n} occurs ${hits.length}x`);
  return hits[0];
};
const rebuild = (row, n, state) => {
  const c = row.split(" | ");
  if (c.length !== 5) throw new Error(`§${n} row has ${c.length} cells`);
  c[0] = `| [§${n}](#${slug(heading(s, n))})`;
  if (state) c[4] = `${state} |`;
  return c.join(" | ");
};
for (const n of [436, 439]) {
  const k = rowIdx(lines, n);
  lines[k] = rebuild(lines[k], n, "**CLOSED** 2026-09-11");
}
const blines = branch.split("\n");
const STATE = { 442: "**CLOSED** 2026-09-09 (fixed in 0.297.0)" };
const newRows = [440, 441, 442, 443, 444, 445, 446].map((n) => rebuild(blines[rowIdx(blines, n)], n, STATE[n] ?? null));
lines.splice(rowIdx(lines, 439) + 1, 0, ...newRows);
s = lines.join("\n");

// 4. assertions
for (let n = 436; n <= 446; n++) {
  headAt(s, n);
  const rows = s.split("\n").filter((l) => l.startsWith(`| [§${n}](`));
  if (rows.length !== 1) throw new Error(`after: §${n} row occurs ${rows.length}x`);
  if (!rows[0].startsWith(`| [§${n}](#${slug(heading(s, n))}) | `)) throw new Error(`after: §${n} anchor does not match its heading`);
}
writeFileSync(REG, s);
console.log("applied; rows 436-446 anchored to their headings");
```

Run from the repo root:

```bash
node "$SCRATCH/t9-apply.mjs" "$SCRATCH"; echo "EXIT=$?"
git diff --stat -- docs/open-followups.md
grep -n -E "^\| \[§(439|44[0-7])\]" docs/open-followups.md | cut -c1-60
```

Expected: `applied …`, `EXIT=0`; one file changed; rows §439, §440 … §446, §447 in that order.

★ `headAt` asserting exactly-once is the uniqueness guard: every marker this script anchors on is checked before it is used, so a register that moved since planning throws instead of silently writing into the wrong slot.

- [ ] **Step 7: Gates**

```bash
npm run followups:index:check > "$SCRATCH/t9-idx.log" 2>&1; echo "EXIT=$?"; tail -3 "$SCRATCH/t9-idx.log"
npm run followups:status:check > "$SCRATCH/t9-status.log" 2>&1; echo "EXIT=$?"; tail -3 "$SCRATCH/t9-status.log"
npm run docs:claims:check > "$SCRATCH/t9-claims.log" 2>&1; echo "EXIT=$?"; tail -3 "$SCRATCH/t9-claims.log"
npm run docs:symbols:check > "$SCRATCH/t9-symbols.log" 2>&1; echo "EXIT=$?"; tail -3 "$SCRATCH/t9-symbols.log"
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');console.log('CR',(s.match(/\r/g)||[]).length)"
```

Expected: four `EXIT=0`; `CR 0`. `docs:claims:check` is a ratchet — a NEW `path:LINE` citation in the ported text fails it; convert such a cite to a symbol plus a grep, never re-baseline.

- [ ] **Step 8: Commit**

> **As executed:** see "As executed › Task 9: split in two, and landed with the second fix round" — landed as 32769326, with `plan.ts`, under another subject.

Message (`$SCRATCH/t9-msg.txt`):

```
docs(followups): close 436 and 439 with the sweep, and file what it found

The offered-surface sweep's register work was written on its branch against
branch code; this carries it across re-verified against main. Every
reproduce command in the ported rows was re-run here, and every branch SHA
was remapped to its main twin or removed.

Closed: 436 (Relation B reads TOOL_DEFS, which a guard-table edit cannot
move; mutant 4 re-proved on main) and 439 (the create relation exists).
Filed: 440, 441, 443, 445, 446 open; 442 closed, its fix having shipped in
0.297.0; 444 open until CI's shuffled suite runs on this branch.

<one line per row whose text changed against main, naming the change>
```

```bash
git commit --only docs/open-followups.md -F "$SCRATCH/t9-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 10: Gates, cold review, report and STOP

**Files:** none modified unless the review finds something.

- [ ] **Step 1: The gates this slice can move**

```bash
npx tsc --noEmit > "$SCRATCH/t10-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "^src/" "$SCRATCH/t10-tsc.log"
npx eslint --max-warnings=0 src/test/offered-surface-axis.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.model-writable-surface.test.ts src/app/chat-tools-updates.ts > "$SCRATCH/t10-eslint.log" 2>&1; echo "EXIT=$?"
npm run size:check > "$SCRATCH/t10-size.log" 2>&1; echo "EXIT=$?"
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/ > "$SCRATCH/t10-dir.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t10-dir.log"
```

Expected: `tsc` `0` src errors; eslint, size and the directory run `EXIT=0`.

- [ ] **Step 2: Cold review**

Dispatch a reviewer subagent (cold — no session history) over `git diff origin/main...HEAD`, with the spec path, and this brief: refute the claims, not only read the code. Specifically: every number in the new comment, the register rows and the axis docstring must reproduce by running its command; the create-path-guards port must be `5f0de0de`'s intent and nothing else; no field was exempted and no probe narrowed. Ask for a mutation COUNT for any claim of "pinned". Fix every CONFIRMED finding in a new commit (never amend), re-running that finding's command against the corrected text.

- [ ] **Step 3: Report to the controller and STOP**

Report: the commits made; the Task 5 baseline; whether Task 6 applied and what moved; the Task 7 six-row scorecard; the Task 8 seven-site table; which register rows changed text against the branch and why; gate results; review findings and their disposition.

**Do not push, open an MR or merge.** Release happens only on the user's explicit say-so.

---

## Task 11 (only on the user's say-so): release

**Files:** `docs/open-followups.md` (§444 closure only).

No version bump, no CHANGELOG entry: tests and docs only, so the refactor-only rule applies.

- [ ] **Step 1: Push and open the MR**

```bash
git fetch -q origin; git log --oneline HEAD..origin/main | head
git push -u origin feat/offered-surface-sweep-landing > "$SCRATCH/t11-push.log" 2>&1; echo "EXIT=$?"
```

If `origin/main` moved, merge it and re-run Task 10 Step 1 before pushing. Write the MR description to `$SCRATCH/t11-mr.md`. ★★ It must carry NO assistant session URL — the user's standing rule forbids one in an MR description or `CHANGELOG.md`, and it outranks any generic attribution instruction. Commit trailers and MR comments are exempt, so if attribution is wanted, post the URL as an MR comment after creation. Then:

```bash
glab mr create --source-branch feat/offered-surface-sweep-landing --target-branch main --title "test(ai): land the offered-surface sweep that 0.297.0 left behind" --description "$(cat "$SCRATCH/t11-mr.md")" --auto-merge=false --yes > "$SCRATCH/t11-mr.log" 2>&1; echo "EXIT=$?"; cat "$SCRATCH/t11-mr.log"
```

- [ ] **Step 2: Poll the pipeline to a terminal state**, reading every job, not only the pipeline status. Merge nothing on red.

- [ ] **Step 3: Close §444 citing the green `unit-tests-shuffled` job** — Status `CLOSED 2026-09-11 by pipeline #<id>, job unit-tests-shuffled (seed 1), green on <sha>`; index row State `**CLOSED** 2026-09-11`; anchor re-derived with `t9-slug.mjs`. Run the four Task 9 Step 7 gates, commit, push, and poll the new pipeline.

- [ ] **Step 4: Merge on green**

```bash
glab mr merge <iid> --yes --auto-merge=false > "$SCRATCH/t11-merge.log" 2>&1; echo "EXIT=$?"; cat "$SCRATCH/t11-merge.log"
```

Then poll the post-merge `main` pipeline and report its result.

---

## As executed (2026-09-11)

This section was added after execution. Everything above it is the plan as committed in `26f3deb2`
"docs(plan): land the offered-surface sweep in eleven tasks, measured on main" and is not rewritten;
the lines starting `> **As executed:**` above it point here. It records execution up to
`32769326` "docs(followups): close 436 and 439, file 440-446 and 459-461, and correct the create-path
gate comment". Task 11 (release) had not run at that commit, so §444 is still OPEN.

Figures quoted as "N failed / M passed" come from the commit messages or register entries named
beside them; they are vitest runs and are not re-run here. Where a claim can be checked without
vitest, a command that reproduces it sits beside it.

### Commit map

| Plan task | Commit | Departure |
|---|---|---|
| Task 1 | `a546d615` docs(ai): carry the offered-surface sweep's spec and plan onto main as dated records | none |
| Task 2 | `ce982ce6` test(ai): carry the offered-surface sweep and its axis onto main, verbatim | none |
| Task 3 | `a278cc30` test(ai): the create-path pins read their payloads from the shared CREATE_BASE | the two Task 3 subsections below |
| Task 4 | `7d95c061` test(ai): the §437 ratchet reads the shared PERSISTED_COLUMNS | none |
| not in the plan | `82e7ee87` test(ai): pin the recurrence the calendarEvent create pin depends on | "Two commits the plan did not list" |
| not in the plan | `87566496` docs(ai): correct three axis docstrings that main's code has outrun | "Two commits the plan did not list" |
| Task 5 | no commit; its go/cut stop produced `eef92310` test(ai): hold the sweep's six known findings in a ledger checked both ways | "Task 5", "Ledger decision 1" |
| Task 6 | skipped | "Task 6: skipped" |
| Task 7 | no commit (every mutant is reverted); the scorecard is in `32769326`'s message | "Task 7: mutant outcomes" |
| Task 8 | `78569052` docs(ai): put the measurement back beside the create-strip rule, re-measured on main | "Task 8: the note's shape" |
| fix round 1 | `70615677` test(ai): key the sweep's findings ledger by field and kind, and correct the comments a review disproved | "Ledger decision 2" |
| Task 9 and fix round 2 | `32769326` (subject above) | the three Task 9 subsections |
| Task 10 | not recorded at `32769326` | none yet |
| Task 11 | not run at `32769326` | none yet |

Reproduce: `git log --format='%h %s' fe82d1db..32769326`.

Fix rounds 1 and 2 are the review-driven corrections defined under "Task 9: split in two, and landed
with the second fix round".

### Task 3: the prescribed comment named a type that does not exist

- **Plan said:** Task 3 Step 2's `new_string` has the header say that `createTool` "is a declared
  member of `InlineEntityDescriptor`".
- **What happened:** that text landed as prescribed in `a278cc30`. No type of that name exists; the
  interface is `EntityDescriptor`. `82e7ee87` "test(ai): pin the recurrence the calendarEvent create
  pin depends on" corrected the one word in the comment ("Also corrects the header's type name" in its
  message). Nothing was renamed: no type of that name has ever existed on main, and only the comment
  changed.
- **Evidence:** `git grep -n "InlineEntityDescriptor" fe82d1db` prints nothing, and neither does
  `git log --oneline -S InlineEntityDescriptor fe82d1db -- src`;
  `git grep -n "interface EntityDescriptor" fe82d1db -- src` prints one line, in
  `src/app/inline-ai-edit/entity-descriptor.ts`. The wrong name still appears in Task 3 Step 2 above
  and in the two 2026-09-08 records, which are dated and not rewritten.
- **Why:** the "All three factual claims were re-verified" note under Step 2 covered the grep count,
  the `chat-proposal-describe.ts` indexing and `sweepPlumbing`. The type name was a fourth claim, and
  nothing checked it.

### Task 3 Step 7: the `CREATE_BASE.` count

- **Plan said:** `grep -c "CREATE_BASE\." $F` prints `7`.
- **What happened:** it printed `8` at `a278cc30` and prints `9` at `32769326`. The eighth reference is
  the comment Step 6 itself prescribes ("That is why `CREATE_BASE.calendarEvent` carries a
  recurrence"); the ninth is a comment `82e7ee87` added beside its new precondition. The seven payload
  lines are as planned, and `valid: {` counts `0` at both commits.
- **Evidence:**

  ```bash
  F=src/app/inline-ai-edit/plan.create-path-guards.test.ts
  git show a278cc30:$F | grep -c "CREATE_BASE\."          # 8
  git show 32769326:$F | grep -c "CREATE_BASE\."          # 9
  git show 32769326:$F | grep -c "valid: CREATE_BASE\."   # 7
  ```

- **Why:** the expected value counted the payload lines only and missed the prescribed comment.

### Two commits the plan did not list

Both landed between Task 4 and the Task 5 baseline, which `eef92310`'s message says was measured at
`87566496`.

- **`82e7ee87`** "test(ai): pin the recurrence the calendarEvent create pin depends on" adds an optional
  `precondition` to `CreateCase` in `plan.create-path-guards.test.ts`, and the `calendarEvent` case now
  asserts that the created row stored a `recurrence` before it reads `exceptions`. Its message: with the
  recurrence removed from `CREATE_BASE.calendarEvent` the pin stayed green (40 passed) while testing
  nothing; with the precondition the same mutant gives 1 failed / 39 passed. Why: Step 6's comment
  stated that dependency in prose only, and nothing asserted it.
- **`87566496`** "docs(ai): correct three axis docstrings that main's code has outrun" changes comments
  only in `src/test/offered-surface-axis.ts` (`git show --stat --format= 87566496`: one file, 19
  insertions, 14 deletions). The SCOPE paragraph said `propose_project` could still land
  `change.decisionDate`, which `2645debb`'s `SEED_OFFERED_KEYS` filter had already closed; the
  `undeclaredColumns` reproduce no longer reproduced, because `29744af1`'s create strip removed the leak
  it measured; a `chat-tools.ts` line citation had drifted and now names the symbol. Why: the "File
  structure" table allows edits to the axis only through Task 6's `AXIS_BASELINE` step, but the ported
  docstrings described code main had since changed.

`70615677` later changed comments in the axis, `plan.create-path-guards.test.ts`,
`plan.model-writable-surface.test.ts` and `chat-tools-updates.ts` as well (see "Ledger decision 2" and
"Task 8: the note's shape").

### Task 5: the baseline and the go/cut stop

- **Plan said:** Step 2 sorts every failure into a bucket, and any bucket (b) failure is a STOP for a
  go/cut decision. Step 4 expects a runtime count of 73; Task 6 Step 4 and the Task 7 scorecard reuse
  that count.
- **What happened:** the first run on main gave 73 tests with 5 failing, all in Relation B, so all
  five were bucket (b) and no axis-size case failed. The 5 failing cases carry **6 finding lines**,
  because the `calendarEvent` create case reports two fields, so a count of failing tests (5) and a
  count of findings (6) are different numbers here. The six findings, none of them a write-path
  defect:

  | Case (entity:arm) | Finding | Recorded as |
  |---|---|---|
  | `task:create` | `task.assigneeEmail`, create threw | §459, a badly derived probe |
  | `resource:update` | `resource.name`, unchanged | the recorded `SYNTHETIC_INPUTS` decision |
  | `resource:create` | `resource.name`, dropped | the recorded `SYNTHETIC_INPUTS` decision |
  | `absence:create` | `absence.startDate`, dropped | §459, a badly derived probe |
  | `calendarEvent:create` | `calendarEvent.sendInvitations`, dead | §443, unmeasured by policy |
  | `calendarEvent:create` | `calendarEvent.startTime`, dead | §443, dead by construction |

  The write-path sweep's baseline was 37 passed, verbose-output md5 `2cff2178852afbef0ddd5fef7fbcdcd1`.
  The stop's decision is "Ledger decision 1" below. After it the sweep runs **74** tests, not 73: the
  extra case is "every expected-findings ledger entry names a real entity, arm, subject and kind". Every
  later offered-surface sweep scorecard in this section sums to 74.
- **Evidence:** `eef92310`'s message ("73 tests with 5 failing, all in Relation B"); `32769326`'s
  message ("sweep 73 tests, 5 failed, 6 finding lines"); the ledger holds six entries under five keys:
  `git show 32769326:src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts | grep -c '{ subject: "'`
  prints `6`.

### Ledger decision 1: both directions

- **Plan said:** a red case is a finding, never to be made green by exempting a field, narrowing a
  probe, weakening a floor, adding a skip or editing `SYNTHETIC_INPUTS` ("Read before starting"). The
  spec requires the sweep to be green to land, because `unit-tests` is blocking.
- **What happened:** at the Task 5 stop the user chose to hold the findings in a ledger checked in
  both directions. Relation B now compares its findings with `EXPECTED_FINDINGS` instead of with the
  empty list. A finding missing from the ledger turns its case red, and so does a ledgered finding that stops firing. Every field is still
  probed and every finding is still computed; nothing was exempted.
- **Evidence:** `eef92310` "test(ai): hold the sweep's six known findings in a ledger checked both
  ways". Its mutants: dropping the absence entry gives 1 failed / 73 passed; a bogus task entry gives
  1 failed / 73 passed; misspelling the absence key as `absense:create` gives 2 failed / 72 passed, and
  tsc rejects it too (TS2353).
- **Why:** Relation B reports dead and decided fields as findings by design, so on main's code it
  cannot be green on its own. Checking both directions means an entry cannot outlive the finding it
  records.

### Ledger decision 2: keyed by field and kind

- **Plan said:** nothing; the ledger is not in the plan. As first landed in `eef92310` it held exact
  finding strings.
- **What happened:** in the first fix round, at the user's choice, the entries were re-keyed by field
  and kind: they are now `{ subject, kind }` over one `FINDING_KINDS` array, and the verdict compares
  sorted `subject:kind` tokens in both directions. The full finding line stays in the failure text. The case is still red on
  a new finding, on a ledgered finding that stops firing, and on a field changing kind.
- **Evidence:** `70615677`'s message, each mutant applied and reverted alone: deleting the
  `absence.startDate` entry gives 1 failed / 73 (absence create); changing the `task.assigneeEmail` kind
  from `threw` to `dropped` gives 1 failed / 73 (task create); rewording the "assigneeEmail is invalid"
  message in `use-chat-dispatcher.ts` gives 0 failed / 74, which is the point of the change; a resource
  subject under `task:create` gives 2 failed / 72; an unknown kind gives 2 failed / 72. Clean runs:
  sweep 74, `plan.create-path-guards.test.ts` 40, `plan.model-writable-surface.test.ts` 24.
  `32769326`'s message re-measures the ledger: delete an entry 1 / 73, add a stale entry 1 / 73,
  mistype a key 2 / 72.
- **Why:** with exact strings, rewording a production error message or editing a shared seed turned
  Relation B red, and the cheapest response was to paste the new output into the ledger, which is the
  reflex the ledger exists to prevent.

### Task 6: skipped

- **Plan said:** Task 6 runs only if Task 5 finds bucket (a) failures.
- **What happened:** there were none, so `AXIS_BASELINE` and its docstring are as ported. Main's
  declarations added after the fork did not move the recorded axis sizes: the size case passed for all
  eight entities.
- **Evidence:** the eight rows are identical at the verbatim port and at `32769326` (task 11/17,
  raid 16/6, change 15/5, milestone 5/3, stakeholder 8/4, resource 13/6, absence 7/2, calendarEvent
  9/3 declared/undeclared), and the docstring still names the first measurement:

  ```bash
  A=src/test/offered-surface-axis.ts
  diff <(git show ce982ce6:$A | grep -A 9 "export const AXIS_BASELINE") \
       <(git show 32769326:$A | grep -A 9 "export const AXIS_BASELINE")   # prints nothing
  git show 32769326:$A | grep -c "= 754e8129, 2026-09-08"                  # 1
  ```

### Task 7: mutant outcomes

- **Plan said:** mutants 1, 3, 4, 5 and 6 are KILLED and mutant 2 SURVIVES. Mutant 3 is expected to
  fail Relation A's `calendarEvent` create on `exceptions`; mutant 4 is expected to fail Relation B's
  `absence` UPDATE arm on `note`. Each scorecard sums to Task 5's runtime count.
- **What happened** (`32769326`'s message; offered-surface sweep figures unless another file is named;
  every sum is 74 because the mutants ran after the ledger landed):

  | Mutant | Outcome on main |
  |---|---|
  | M1 | KILLED, Relation A `stakeholder` create |
  | M2 | SURVIVED, as expected (§441) |
  | M3 | **SURVIVED** the sweep (0 failed / 74, per §441), where the branch killed it. On main only `plan.create-path-guards.test.ts` catches it: 1 failed / 39 passed, the `create_calendar_event` refuses `exceptions` case |
  | M4 | KILLED on the `absence` **CREATE** arm, 1 failed / 73; the UPDATE arm stays green. The write-path sweep stayed byte-identical: 37 passed, same md5 as the baseline (§436) |
  | M5 | KILLED on both `raid` arms, 2 failed / 72 |
  | M6 | KILLED by floor 1, 6 failed / 68 |

- **Why M3 survives:** `29744af1`'s create strip now removes `localModifiedAt` and `outlookEventId`
  before the handler runs, and the third undeclared field, `exceptions`, is seeded by no sweep fixture,
  so its trespass probe is a string that `sanitizeExceptions` drops whatever the guard does. §441 ("A
  THIRD INSTANCE, MEASURED ON MAIN ON 2026-09-11") has the detail.
- **Why M4 is caught on the create arm only** (by reading, not separately measured; see §436): the
  UPDATE arm reads `rawTypeGuards`, which for
  `absence` and `calendarEvent` is the same object as the allow-list, so a narrowed row reads as a
  disclosed refusal there. §436 therefore closes by the CREATE arm, with a Residual block for the rest.
- **Consequence:** the plan's own rule ("Any other outcome changes a register row's text in Task 9")
  applied: §441 now says four of the six mutants are killed on main.

### Task 8: the note's shape

- **Plan said:** Step 4 inserts a nine-line paragraph headed "TWO OF THE SEVEN CALL SITES ARE DEFENCE
  IN DEPTH" after `can keep straight.`, and Step 5 expects 9 insertions, 0 deletions.
- **What happened:** main already carried that paragraph (0.297.0 kept it and dropped only the figures
  beside it), so the template would have duplicated it. `78569052` inserted a five-line measurement
  into that paragraph instead, after its `sites".` line: 5 insertions, 0 deletions. `70615677` then
  moved those five lines to the paragraph's end, after `can keep straight.`, so that "that claim" again
  refers to the claim before it (5 insertions, 5 deletions in this file). The "two back-to-back JSDoc
  blocks merged" in its message is in `plan.model-writable-surface.test.ts`, not here. The Step 3
  decision rule held: against a clean 0 failed / 74 passed, reverting the strip at `create_absence` or
  `create_calendar_event` leaves the sweep unchanged, and reverting it at any of the other five gives
  1 failed / 73, that entity's Relation A create case.
- **Evidence:** `git show fe82d1db:src/app/chat-tools-updates.ts | grep -c "TWO OF THE SEVEN CALL SITES"`
  prints `1`; `git show --stat --format= 78569052` shows 5 insertions; both commits' messages.
- **Why:** the plan's premise that "0.297.0 kept that docstring's rule sentence and dropped the
  measurement" was right, but the template restated the paragraph that had been kept.

### Task 9: split in two, and landed with the second fix round

- **Plan said:** Task 9 is one task that extracts, re-verifies, applies by script, runs the gates and
  commits `docs/open-followups.md` alone, under the Step 8 message template.
- **What happened:** execution ran it in two parts, one drafting the entries for §436, §439–§446 and
  §459 for review and one writing them into `docs/open-followups.md`. Two review-driven fix rounds ran
  before anything in the register was committed: fix round 1 is `70615677`, whose subject says it
  corrects "the comments a review disproved" and which does not touch the register; fix round 2 has no
  commit of its own, and its corrections are listed in `32769326`'s message. The register edits landed
  with fix round 2 in `32769326`, together with a comment change to `src/app/inline-ai-edit/plan.ts`
  (see "A second src/app comment edit") and under a different subject from the Step 8 template.
- **Index rows:** `32769326`'s message states that the rows for 436, 439, 440–446 and 459–461 match
  the output of the register's own index rebuild recipe (the `REBUILD` script in the register's
  preamble) byte-for-byte, and that the recipe was not run over the whole table because it would
  rewrite 122 unrelated rows. §442's State cell reads `**CLOSED** 2026-09-09`, without the
  `(fixed in 0.297.0)` the Step 6 script would have written.
- **Evidence:** `git log --format='%h %s' fe82d1db..32769326 -- docs/open-followups.md` prints one line,
  `32769326`; `git show --stat --format= 70615677` lists five files, none of them the register.

### Task 9: entries the plan did not list (§459–§461)

- **Plan said:** close §436 and §439, mint §440–§446; the spec's "Register" table lists the same.
- **What happened:** three more entries were filed OPEN in `32769326`, numbered after §458, the highest
  entry on `origin/main` at `fe82d1db`:
  - **§459**, two Relation B create-arm probes invalid by construction (`task.assigneeEmail`,
    `absence.startDate`). First reported on 2026-09-08 on the local-only original branch and never
    filed there; these are the two ledgered findings with no other home.
  - **§460**, a create card can preview meeting attendees the create then stores none of. Suspected
    and not runtime-verified. The preview's link guard runs on updates only, while since `68486cd4`
    "fix(ai-write): route every create tool through its merge-site guard (§438)", released in 0.294.0,
    both allow-list creates enforce it. The preview half is pinned as correct by the `plan.test.ts`
    case "does NOT apply the guard to a create, whose write never sees it", so a fix must rewrite that
    case in the same change; `32769326` does not touch that test.
  - **§461**, an absence stores an assignee email that is not an address, where a task refuses the same
    value loudly.
- **Evidence:**

  ```bash
  grep -nE "^## (436|439|44[0-6]|459|46[01])\." docs/open-followups.md
  # 436 and 439 CLOSED 2026-09-11; 440, 441, 443, 444, 445, 446 OPEN;
  # 442 CLOSED 2026-09-09; 459, 460, 461 OPEN
  git show fe82d1db:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1   # 458
  ```

### Task 9: prescribed wording that landed differently

The Step 3 table prescribes replacement text for several rows. Where the landed text differs, the
register entry is the record; read it rather than the table:

- **§436:** the prescribed Status start "CLOSED 2026-09-11 by Relation B of" landed as "CLOSED
  2026-09-11 by the CREATE arm of Relation B in", followed by a Residual block for what the closure does
  not cover (the UPDATE arm, and three `calendarEvent` fields outside the create arm).
- **§439:** the prescribed replacement sentence landed reworded. The 73 / 11 / 15 figures are dated to
  `681c6c07` on the original branch, all fifteen findings are accounted for, and the landing figures
  are 73 tests with 5 failing at the first run on main and 74 tests with 0 failing at landing.
- **§440–§446:** the corrections are listed in `32769326`'s message: §441's mutant 2 and mutant 3 are
  described as "replace", not "delete", and it adds the probe-shape blind spots and says four of six
  mutants are killed on main; §442's guard change is described correctly and its greps print exactly
  the call sites; §443's "only the finding output says so" is corrected; §444 names the landing branch;
  §445 stays OPEN, because the write defect is fixed (`2645debb`) but its reachability claim still
  holds; §446's Status names its greps as presence witnesses.
- **SHAs:** landing-branch SHAs cited in the register carry their subject lines, so they can still be
  found after a squash (`32769326`'s message).

### A second src/app comment edit

- **Plan said:** "No production code changes except one docstring paragraph" ("Tech Stack"), the
  paragraph being Task 8's in `src/app/chat-tools-updates.ts`.
- **What happened:** `32769326` also changes comments in `src/app/inline-ai-edit/plan.ts`, 28 changed
  lines and all of them comment, with no behaviour change. The comment above the create path's link
  gate said both allow-list creates skip the allow-list, which has been false since `68486cd4`
  (0.294.0); it now says so and points at §460, and the `toolName` parameter docstring agrees with it.
- **Evidence:** `git diff --stat fe82d1db 32769326 -- 'src/app/*.ts' ':(exclude)*.test.ts'` lists
  exactly `src/app/chat-tools-updates.ts` and `src/app/inline-ai-edit/plan.ts`.
- **Why:** the comment sits on the gate §460 describes and had been false since `68486cd4`, so it was
  corrected in the commit that filed §460.

### Probe blind spots: recorded, not fixed

- **Plan said:** nothing beyond what the ported §441 (as on `feat/offered-surface-sweep`'s tip, which
  Task 9 Step 2 extracts) already recorded: mutant 2's blind spot and the `change.decisionDate`
  date-probe instance (its Task 9 Step 3 row re-runs the `NEEDS A VALID PROBE` grep).
- **What happened:** execution found more, and recorded it without fixing it. Added to the sweep's
  comments in `70615677` and to §441 in `32769326`: a third instance, `calendarEvent.exceptions`, which no sweep fixture
  seeds, so mutant 3 survives (see "Task 7: mutant outcomes"); the three instances named as one class,
  because Relation A's trespass probe is never a valid value, so an undeclared field whose sanitizer
  rejects or reshapes an arbitrary value is invisible to it (at least `knowledgeLinks`,
  `calendarEvent.exceptions`, `stakeholder.raci`, five resource fields and `change.decisionDate`); and
  a Relation B sibling, `validProbeFor` having no object branch, so a refused `recurrence` reads as
  landed on create. Recorded in §459 and in the ledger's comments: two create-arm probes derived from
  seeded values the create will not accept.
- **Evidence:** `70615677`'s message ends "Probes are recorded, not changed: fixing them is a follow-up
  slice."; `git grep -n "NEVER A VALID VALUE\|NO OBJECT BRANCH" 32769326 -- src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`
  prints the two recording comments.
- **Deferred to a follow-up slice:** fixing those probes, and fixing §460 together with the
  `plan.test.ts` case "does NOT apply the guard to a create, whose write never sees it".
