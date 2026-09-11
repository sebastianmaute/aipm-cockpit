# Offered-Surface Sweep Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the offered-surface sweep (detector, axis module, spec, plan, register rows) on `main`, green against main's current code, with its acceptance mutants re-proved there.

**Architecture:** Port, not merge. The branch `feat/offered-surface-sweep` (20 commits, never pushed) splits into 15 detector/docs commits and 5 fix commits; main already carries the fixes in a later, review-corrected form (0.297.0, MR !460). This plan copies the branch-only files verbatim first, then adapts only what main changed underneath them, then re-measures everything on main. Spec: `docs/superpowers/specs/2026-09-11-offered-surface-sweep-landing-design.md`.

**Tech Stack:** Vitest 4 + Testing Library (unit), TypeScript, git. No production code changes except one docstring paragraph.

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

**Commit trailer.** Every commit message ends with:

```
Claude-Session: https://[session link removed]
```

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

Claude-Session: https://[session link removed]
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

Claude-Session: https://[session link removed]
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

Claude-Session: https://[session link removed]
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

Claude-Session: https://[session link removed]
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

- [ ] **Step 3: Record the write-path sweep's verbose fingerprint (Task 7's mutant 4 needs it)**

```bash
npx vitest run --maxWorkers=1 --reporter=verbose src/app/inline-ai-edit/plan.write-path-sweep.test.ts > "$SCRATCH/t5-wps.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5-wps.log"
grep -E "^\s+(✓|×|↓)" "$SCRATCH/t5-wps.log" | sed -E 's/ [0-9]+ms$//' | md5sum
```

- [ ] **Step 4: Write the baseline record**

Write `$SCRATCH/landing-baseline.md` containing: the sweep file's RUNTIME test count (its own line in the Step 1 output — expected 73, which is 5 axis checks × 8 entities + 2 × 8 Relation A + 1 + 2 × 8 Relation B); its failed/passed split; the three finding-string counts; the full failure list with bucket labels; the write-path sweep's passed count and md5. Tasks 6, 7, 8 and 9 read their numbers from this file only.

---

## Task 6 (only if Task 5 found bucket (a) failures): re-baseline `AXIS_BASELINE` as a recorded decision

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

Claude-Session: https://[session link removed]
```

```bash
git commit --only src/test/offered-surface-axis.ts -F "$SCRATCH/t6-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 7: Re-prove the six acceptance mutants on main

**Files:** each mutant temporarily edits one file and reverts it. The tree must be committed and clean before starting: `git status --short` prints nothing.

**Expected outcome, from the branch:** mutants 1, 3, 4, 5, 6 are KILLED; mutant 2 SURVIVES (§441 records that survival and why). Any other outcome changes a register row's text in Task 9 — record it, do not "fix" it.

**The scorecard rule.** Record each mutant as `N failed / M passed` for the sweep file, with `N + M` equal to the runtime count in `$SCRATCH/landing-baseline.md`, plus the names of the newly failing cases. A mutant that changes nothing is SURVIVED; name it as such.

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

- [ ] **Step 5: Verify**

```bash
F=src/app/chat-tools-updates.ts
git diff --stat -- $F
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log('lines',s.split('\n').length,'bare LF',(s.match(/(?<!\r)\n/g)||[]).length)" $F
npx eslint --max-warnings=0 $F > "$SCRATCH/t8-eslint.log" 2>&1; echo "EXIT=$?"
```

Expected: 9 insertions (eight text lines plus one ` *` separator), 0 deletions; `bare LF 0`; `EXIT=0`.

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

Claude-Session: https://[session link removed]
```

```bash
git commit --only src/app/chat-tools-updates.ts -F "$SCRATCH/t8-msg.txt"; echo "EXIT=$?"; git status --short
```

---

## Task 9: The register — close §436 · §439, mint §440–446

**Files:**
- Modify: `docs/open-followups.md` (LF-only, ~2.5 MB — edit by node script with uniqueness assertions, never by Edit on an ambiguous anchor)

Every row's text was written against branch code. Each reproduce command below is re-run on this branch and its result compared with the row's claim. **A row whose claim no longer holds is corrected in this same commit** — never flagged for later.

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

Claude-Session: https://[session link removed]
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

If `origin/main` moved, merge it and re-run Task 10 Step 1 before pushing. Write the MR description to `$SCRATCH/t11-mr.md`. ★★ It must carry NO `[session link removed]` URL — the user's standing rule forbids one in an MR description or `CHANGELOG.md`, and it outranks any generic attribution instruction. Commit trailers and MR comments are exempt, so if attribution is wanted, post the URL as an MR comment after creation. Then:

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
