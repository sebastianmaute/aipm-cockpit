# Import-loss reporting and the template rich-field carry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §168, §36(a), §150 and §152 — four register entries where data is lost, or loss goes
unreported, on a load or import path.

**Architecture:** Phase 1 carries note logs through template capture/apply and adds the allow-list
pass that was missing, touching no contested symbol. Phase 2 adds a malformed-quote detector as a
third cause on the incomplete-load guard and splits the import-diagnostics channel with per-section
attribution — both of which sit on files another branch is rewriting first.

**Tech Stack:** TypeScript, React 19, Next 16.2.11, vitest 4 (+ fast-check), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-import-loss-and-template-carry-design.md`

---

## Read this before Task 1

Measured landmines, not folklore. Each will bite this slice specifically.

- ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits `0` while
  tests fail — that is `tail`'s status. Redirect, check unpiped, then read the file:
  `npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/suite.log"`
- ★★★ **`/tmp` is shared across concurrent sessions on this machine, and another session is active in
  this repo right now.** A peer's gate log has previously overwritten one of ours and been read as
  our own result. Write every gate log to the session scratchpad, never `/tmp`. Set this once per
  shell before running anything below — every `$SCRATCH` in this plan refers to it:

  ```bash
  SCRATCH="$CLAUDE_SCRATCHPAD"   # or any session-private directory
  mkdir -p "$SCRATCH"; echo "$SCRATCH"
  ```

  Note that `node -e` resolves a bare `/tmp` to `C:\tmp` under Git Bash on this machine, which is a
  different directory again — another reason to use an absolute scratchpad path.
- ★★ **Never run two vitest processes at once.** A red carrying `Failed to start forks worker` or
  `Test Files no tests` at EXIT=1 is machine contention, not a failure. Re-run with `--maxWorkers=2`.
- ★★ **`npx tsc --noEmit` after editing ANY test** — `next build` does not typecheck tests and vitest
  never typechecks. It exits **2** on diagnostics, not 1.
- ★★ **`--reporter=basic` does not exist in vitest 4.** Use `--reporter=dot`.
- ★★ **Every `src/app/*.ts(x)` is CRLF.** Use the Edit tool, never `Write` (which re-lines the file to
  LF invisibly to `git diff`) and never `sed -i`. Check with `git ls-files --eol <file>` — healthy is
  `i/lf w/crlf`.
- ★★ **`i18n.de.ts` corrupts under the Edit tool** (umlauts, and it curls double quotes). Patch it
  with a node UTF-8 write matching `\r\n`. Real umlauts only — the `i18n-encoding` test bans ASCII
  substitutes (`fuer`, `druecken`) and `\u00XX` escapes.
- ★ `docs/**` is LF. Source is CRLF. Do not mix the tools.
- ★ Commit via a Bash heredoc, not a PowerShell here-string. Never `git commit --amend` — this
  worktree shares its object store with two others. Scope every commit with
  `git commit --only <paths>`.
- ★ `git checkout -- <file>` is deny-blocked here. Revert an experiment with an inverse anchored
  edit, then prove `git diff --stat` is empty.

---

## The sequencing gate

**Phase 1 is executable immediately. Phase 2 is NOT.**

`fix/meta-decode-loss-chain` is cut from the same base (`24581bc6`) and lands first. It renames three
guard symbols, rewrites the `reportFor` census, and adds to `use-storage-backend.ts` — all of which
Phase 2 builds on. Starting Phase 2 early means redoing it against a moved guard.

Phase 1 touches `templates.ts` and `template-apply.ts`, which that branch does not touch at all.

---

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `src/app/template-note-carry.test.ts` | Unit tests for the DOM-free seed note-log carry. |
| `src/app/template-apply.allowlist.test.ts` | Unit tests for the apply-time allow-list pass. |

**Modify (Phase 1):**

| File | Change |
|---|---|
| `src/app/templates.ts` | add `sanitizeSeedNoteLog`; wire it into the task and RAID seed sanitizers |
| `src/app/template-apply.ts` | allow-list pass over the seed's rich fields at apply time |
| `AGENTS.md` | correct the false bare-node rationale (see Task 4) |
| `docs/open-followups.md` | close §168 and §36(a); add the §151 site |

**Modify (Phase 2 — after the rebase):**

| File | Change |
|---|---|
| `src/app/csv-line-scan.ts` | malformed-quote detection in the existing walk |
| `src/app/csv-codecs-decode.ts` | forward the count; thread section keys |
| `src/app/markdown-codecs-decode.ts`, `src/app/markdown-codecs-core.ts` | thread section keys |
| `src/app/local-file-backend.ts`, `src/app/sharepoint-backend.ts` | publish the new field |
| `src/app/use-load-truncation.ts` | third hold slot; the split report op |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new EN+DE pairs |

---

# Phase 1 — the template carry (§168, §36(a))

## Task 1: The DOM-free seed note-log carry

**Files:**
- Modify: `src/app/templates.ts`
- Test: `src/app/template-note-carry.test.ts` (create)

Template capture assigns live entity arrays by reference, so a captured template really does carry
note logs. The seed sanitizers never mention the field, so import drops every one.

- [ ] **Step 1: Write the failing test**

Create `src/app/template-note-carry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeSeedTask } from "./templates";

describe("sanitizeSeedNoteLog, through sanitizeSeedTask", () => {
  it("carries a captured note log instead of dropping it", () => {
    const task = sanitizeSeedTask({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>note</p>", text: "note" },
      ],
    });
    expect(task?.noteLog).toHaveLength(1);
    expect(task?.noteLog?.[0].html).toBe("<p>note</p>");
  });

  it("derives text from the sanitised html, not from the captured projection", () => {
    // A captured `text` can disagree with `html` — a hand-edited template, or an
    // entry whose html was narrowed by a sink change since capture. The html is
    // the source of truth, so a stale projection must not survive.
    const task = sanitizeSeedTask({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>real</p>", text: "STALE" },
      ],
    });
    expect(task?.noteLog?.[0].text).toBe("real");
  });

  it("drops an entry with no usable id or timestamp, keeping its siblings", () => {
    const task = sanitizeSeedTask({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>keep</p>", text: "keep" },
        { html: "<p>no id</p>", text: "no id" },
      ],
    });
    expect(task?.noteLog).toHaveLength(1);
    expect(task?.noteLog?.[0].text).toBe("keep");
  });

  it("omits noteLog entirely when nothing survives, rather than storing []", () => {
    // The field is optional on Task. An empty array is a different value from
    // absent and would round-trip differently through the six write paths.
    const task = sanitizeSeedTask({ id: 1, taskName: "T1", noteLog: [{ html: "<p>x</p>" }] });
    expect(task?.noteLog).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/template-note-carry.test.ts --reporter=dot
```

Expected: FAIL — `task?.noteLog` is `undefined` in the first three tests, because nothing carries the
field. The fourth passes for the wrong reason; it is a regression pin for Step 3.

- [ ] **Step 3: Implement the carry**

In `src/app/templates.ts`, add above `sanitizeSeedTask`:

```ts
/**
 * The DOM-free seed carry for a captured note log.
 *
 * ★★ Same posture as `description` below — `sanitizeRichText` against
 * `RICH_SINK`, no DOMPurify pass. This file is in the sample generator's import
 * graph, and its DOM-free contract is deliberate; the allow-list runs at APPLY
 * time in `template-apply.ts`, which is outside that graph.
 *
 * ★★★ DO NOT "fix" this by re-attaching the captured log after sanitizing. That
 * stores it un-sanitised. The whole point of the carry is that every entry goes
 * through the same boundary the description does.
 *
 * ★ `text` is DERIVED, never carried. A captured projection can disagree with
 * its html — a hand-edited template, or a sink change since capture — and the
 * html is the source of truth.
 */
function sanitizeSeedNoteLog(raw: unknown): NoteLogEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NoteLogEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const id = fkIdOrUndefined(item.id);
    if (id === undefined) continue;
    const timestamp = nonEmptyStr(item.timestamp);
    if (!timestamp) continue;
    const html = sanitizeRichText(item.html, TEXTAREA_MAX, RICH_SINK);
    const entry: NoteLogEntry = { id, timestamp, html, text: htmlPlainProjection(html) };
    const authorResourceId = fkIdOrUndefined(item.authorResourceId);
    if (authorResourceId !== undefined) entry.authorResourceId = authorResourceId;
    const authorName = nonEmptyStr(item.authorName);
    if (authorName) entry.authorName = authorName;
    const editedAt = nonEmptyStr(item.editedAt);
    if (editedAt) entry.editedAt = editedAt;
    out.push(entry);
  }
  return out.length ? out : undefined;
}
```

Add the imports this needs. `htmlPlainProjection` and `sanitizeRichText` both live in
`rich-text-plain.ts`, which is already imported here — extend the existing import rather than adding
a second one. `NoteLogEntry` comes from `./types`.

Then wire it into `sanitizeSeedTask`, immediately before its `return`:

```ts
  const noteLog = sanitizeSeedNoteLog(raw.noteLog);
  if (noteLog) task.noteLog = noteLog;
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/app/template-note-carry.test.ts --reporter=dot
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: 4 passed, `TSC_EXIT=0`.

- [ ] **Step 5: Prove the import graph guard is still green**

The carry must not have pulled a banned module into `templates.ts`.

```bash
npx vitest run src/app/rich-text-plain.test.ts --reporter=dot
```

Expected: PASS, including "keeps rich-text-projection out of every DOM-free reach".

- [ ] **Step 6: Commit**

```bash
git add src/app/template-note-carry.test.ts
git commit --only src/app/templates.ts src/app/template-note-carry.test.ts -F - <<'MSG'
fix(templates): carry a captured note log through template import

Template capture assigns live entity arrays by reference, so a captured
template really does carry note logs; the seed sanitizers never mentioned
the field, so import dropped every one.

sanitizeSeedNoteLog takes the same DOM-free posture as `description` —
sanitizeRichText against RICH_SINK, no DOMPurify pass — because this file
is in the sample generator's import graph. The allow-list runs at apply
time instead.

`text` is derived from the sanitised html rather than carried, so a stale
captured projection cannot survive.

Closes §168 (task half; RAID follows).
MSG
```

## Task 2: The same carry for RAID

**Files:**
- Modify: `src/app/templates.ts`
- Test: `src/app/template-note-carry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/template-note-carry.test.ts`:

```ts
import { sanitizeSeed } from "./templates";

describe("the RAID seed carry", () => {
  it("carries a captured RAID note log", () => {
    const seed = sanitizeSeed({
      raid: [
        {
          id: 1,
          category: "R",
          title: "R1",
          status: "Open",
          noteLog: [
            { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>raid note</p>", text: "raid note" },
          ],
        },
      ],
    });
    expect(seed?.raid?.[0].noteLog).toHaveLength(1);
    expect(seed?.raid?.[0].noteLog?.[0].text).toBe("raid note");
  });
});
```

If `sanitizeSeed` is not exported, export it — it is already the function `sanitizeTemplate` calls,
and testing through it is what proves the RAID route is wired, not merely the helper.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/template-note-carry.test.ts --reporter=dot
```

Expected: FAIL — `seed?.raid?.[0].noteLog` is `undefined`.

- [ ] **Step 3: Wire it**

In `sanitizeSeedRaidItem`, immediately before its `return`:

```ts
  const noteLog = sanitizeSeedNoteLog(raw.noteLog);
  if (noteLog) item.noteLog = noteLog;
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/app/template-note-carry.test.ts --reporter=dot
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: 5 passed, `TSC_EXIT=0`.

- [ ] **Step 5: Check whether changes need the same wiring**

Changes route to `sanitizeChangeItem` in `sanitize-records.ts`, not to a local seed sanitizer. Find
out whether it already carries the field before writing anything:

```bash
grep -n "noteLog" src/app/sanitize-records.ts
echo "EXIT=$?  (1 = the field is absent and changes need the same treatment)"
```

If it is absent, add the identical wiring there, exported from `templates.ts` or duplicated locally
depending on whether `sanitize-records.ts` can import it without creating a cycle — check with
`grep -n "^import" src/app/sanitize-records.ts` first. If it is present, record in the commit message
that changes already carried it and no edit was needed.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/templates.ts src/app/template-note-carry.test.ts src/app/sanitize-records.ts -F - <<'MSG'
fix(templates): carry note logs on the RAID and change seed routes too

Same carry as the task route. RAID goes through the local
sanitizeSeedRaidItem; changes go through sanitizeChangeItem in
sanitize-records.ts.

Closes §168.
MSG
```

## Task 3: The apply-time allow-list (§36(a))

**Files:**
- Modify: `src/app/template-apply.ts`
- Test: `src/app/template-apply.allowlist.test.ts` (create)

`templates.ts` upgrades but never allow-lists. Before 0.196.0 the description went through
`plainToHtml`, which escaped `& < >`, so this boundary got *less* strict in a release about write
boundaries. `template-apply.ts` is outside the sample generator's import graph, so it may call
DOMPurify.

- [ ] **Step 1: Write the failing test**

Create `src/app/template-apply.allowlist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyTemplate } from "./template-apply";
import { emptyWorkspace } from "./workspace";

const seedTemplate = (task: Record<string, unknown>) =>
  ({ id: "t1", name: "T", seed: { tasks: [task] } }) as never;

describe("applyTemplate allow-lists the seed's rich fields", () => {
  it("strips a script element from a seed description", () => {
    const ws = applyTemplate(emptyWorkspace(), seedTemplate({
      id: 1,
      taskName: "T1",
      description: "<p>ok</p><script>alert(1)</script>",
    }), { includeSeed: true });
    expect(ws.tasks[0].description).not.toContain("script");
    expect(ws.tasks[0].description).toContain("ok");
  });

  it("strips a script element from a seed note-log entry", () => {
    const ws = applyTemplate(emptyWorkspace(), seedTemplate({
      id: 1,
      taskName: "T1",
      noteLog: [
        { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>ok</p><script>alert(1)</script>", text: "ok" },
      ],
    }), { includeSeed: true });
    expect(ws.tasks[0].noteLog?.[0].html).not.toContain("script");
  });

  it("leaves legitimate rich markup intact", () => {
    // The allow-list must not be narrower than the sink the value lands in, or
    // a captured heading is destroyed on apply — the §107 classifier/sink rule.
    const ws = applyTemplate(emptyWorkspace(), seedTemplate({
      id: 1,
      taskName: "T1",
      description: "<h2>Plan</h2><p>steps</p>",
    }), { includeSeed: true });
    expect(ws.tasks[0].description).toContain("<h2>Plan</h2>");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/template-apply.allowlist.test.ts --reporter=dot
```

Expected: the first two FAIL (the `<script>` survives), the third PASSES. If the third fails, the
allow-list you are about to add is narrower than the destination sink — stop and re-read the
classifier/sink note in `sanitizeSeedTask`.

- [ ] **Step 3: Implement the pass**

In `src/app/template-apply.ts`, add two imports — `sanitizeRichHtml` from `./sanitize-html` and the
`NoteLogEntry` type from `./types` — then apply the pass to the seed's rich fields on the path where
the seed's tasks are already sanitised. Use `sanitizeRichHtml`, which is the same 21-tag list
`RICH_SINK` classifies against; the agreement between classifier and sink is what makes this safe,
not the function's name.

```ts
const allowListRich = <T extends { description?: string; noteLog?: NoteLogEntry[] }>(row: T): T => {
  const next: T = { ...row };
  if (next.description) next.description = sanitizeRichHtml(next.description);
  if (next.noteLog) {
    next.noteLog = next.noteLog.map((n) => ({ ...n, html: sanitizeRichHtml(n.html) }));
  }
  return next;
};
```

Apply it to seed tasks and seed RAID rows on the same path that already sanitises them.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/template-apply.allowlist.test.ts src/app/template-note-carry.test.ts --reporter=dot
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: all pass, `TSC_EXIT=0`.

- [ ] **Step 5: Prove the guard still holds**

`template-apply.ts` must stay OUT of the generator's import graph — the pass is only legal because it
is. Re-resolve the graph rather than assuming:

```bash
npx vitest run src/app/rich-text-plain.test.ts --reporter=dot
```

Expected: PASS. A failure here naming `template-apply.ts` means something pulled it into the graph
and the allow-list has to move.

- [ ] **Step 6: Commit**

```bash
git add src/app/template-apply.allowlist.test.ts
git commit --only src/app/template-apply.ts src/app/template-apply.allowlist.test.ts -F - <<'MSG'
fix(templates): allow-list the seed's rich fields at apply time

templates.ts upgrades a captured description to HTML but never
allow-lists it, so this boundary got LESS strict in 0.210.0 — before
0.196.0 it went through plainToHtml, which escaped & < >.

The pass goes in template-apply.ts because that module is outside the
sample generator's import graph and may therefore call DOMPurify. It uses
sanitizeRichHtml, the same 21-tag list RICH_SINK classifies against, so
classifier and sink agree and a captured heading survives.

Closes §36(a).
MSG
```

## Task 4: Correct the rationale this slice disproved

**Files:**
- Modify: `AGENTS.md`, `docs/open-followups.md`

§36(a) says the fix "CANNOT be fixed in `templates.ts` — that file is in the sample generator's
import graph, so a DOMPurify call there breaks the generator under bare node". **Measured on
2026-08-28: that is false.** DOMPurify is already inside the 92-file graph by two independent paths,
and the generator installs JSDOM globals before its dynamic import precisely so it works.

The DOM-free contract for `templates.ts` still stands — it is a deliberate architectural boundary —
but it stands on the contract, not on this rationale. This is §151's cluster, which already records
four retractions of the same claim.

- [ ] **Step 1: Reproduce the disproof and keep the output**

```bash
grep -n "sanitize-html" src/app/html-start.ts
grep -n "^import DOMPurify" src/app/sanitize-html.ts
grep -nE "JSDOM|await import" scripts/generate-sample-workspace.ts | head -6
```

Expected: `html-start.ts` imports from `sanitize-html`; `sanitize-html.ts` imports `dompurify` at top
level; the generator constructs a `JSDOM` and installs globals **before** its `await import`.

- [ ] **Step 2: Correct §36(a) in `docs/open-followups.md`**

Rewrite the `★★ It CANNOT be fixed in templates.ts` paragraph. Keep the conclusion — the fix belongs
at the browser-side caller — and replace the reason: the DOM-free contract on `templates.ts` is
deliberate and the guard bans the two named DOMPurify modules from the graph, but "a DOMPurify call
breaks the generator under bare node" is not true and must not be restated.

- [ ] **Step 3: Add the site to §151**

§151 records that "the sample generator runs under bare node" is false and is still asserted as a live
rationale in several places. Add §36(a) to that list as a now-corrected site, with the date.

- [ ] **Step 4: Correct `AGENTS.md`**

The icons/rich-text area of `AGENTS.md` restates the same rationale. Correct it in the same commit —
the repo's rule is to fix what you disprove, in the commit that disproves it.

- [ ] **Step 5: Run the doc gates**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
```

Expected: all `EXIT=0`. The status gate is blocking and any entry you edited must keep a conforming
`**Status:**` line.

- [ ] **Step 6: Commit**

```bash
git commit --only AGENTS.md docs/open-followups.md -F - <<'MSG'
docs: the bare-node rationale for the templates.ts DOM-free rule is false

§36(a) says a DOMPurify call in templates.ts "breaks the generator under
bare node". Measured 2026-08-28: DOMPurify is ALREADY in the generator's
92-file import graph by two independent paths —

  sanitize-html.ts <- html-start.ts <- sanitize-records.ts <- sanitize.ts
  note-log.ts <- workspace.ts <- scale-workspace.ts <- the generator

— and the generator installs JSDOM globals before its dynamic import
precisely so that works.

The DOM-free contract still stands, on the contract itself and on the
guard that bans the two named DOMPurify modules from graph files. It does
not stand on this rationale. Recorded as the fifth site in §151.
MSG
```

## Task 5: Phase 1 gate run

- [ ] **Step 1: Full unit suite**

```bash
npm run test:run > "$SCRATCH/phase1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/phase1.log"
```

Expected: `EXIT=0`. A red carrying `Failed to start forks worker` is contention — re-run with
`--maxWorkers=2` before reading it as a failure.

- [ ] **Step 2: Shuffled run at CI's pinned seed**

This slice adds test files, so the shuffled gate is the one that can catch order dependence.

```bash
npm run test:shuffle > "$SCRATCH/phase1-shuffle.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/phase1-shuffle.log"
```

- [ ] **Step 3: Lint, types, size, duplication**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
```

- [ ] **Step 4: Confirm line endings survived**

```bash
git ls-files --eol src/app/templates.ts src/app/template-apply.ts
```

Expected: `i/lf w/crlf` for both. `i/lf w/lf` means a tool re-lined the file — revert and redo the
edit with the Edit tool.

---

# Phase 2 — the import-loss channel (§150, §152)

**DO NOT START until `fix/meta-decode-loss-chain` is on `origin/main`.**

## Task 6: Rebase and re-verify the ground

- [ ] **Step 1: Confirm the other slice landed**

```bash
git fetch --prune origin
git log --oneline -5 origin/main | grep -i "meta-decode\|incomplete"
```

- [ ] **Step 2: Rebase**

```bash
git rebase origin/main
echo "EXIT=$?"
```

- [ ] **Step 3: Re-verify the three guard names**

```bash
grep -rn "loadWasIncomplete\|mayCommitAfterIncompleteLoad\|allowIncompleteSave" src/app --include=*.ts --include=*.tsx | head
grep -rn "loadWasTruncated\|mayCommitAfterTruncation\|allowTruncatedSave" src/app --include=*.ts --include=*.tsx
echo "EXIT=$?  (1 on the second grep = the rename completed)"
```

If the names differ from the spec's table, **use what is on main** and correct the spec in the same
commit.

- [ ] **Step 4: Re-measure the size headroom**

The other slice adds to `use-storage-backend.ts`, which had one line of headroom against the 800 cap.

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
```

If this is at or above 800, the split-report op must be added by extracting rather than inlining.
Budget that before Task 10.

- [ ] **Step 5: Read the rewritten census**

```bash
grep -n "REPORT_EXEMPT_MARKER\|OPS_FILES\|reportFor" src/app/use-load-truncation.test.ts | head -20
```

Task 10 composes with this, not with the pre-rebase version.

## Task 7: Malformed-quote detection

**Files:**
- Modify: `src/app/csv-line-scan.ts`
- Test: `src/app/csv-line-scan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("counts a quote opening mid-field", () => {
  expect(splitCsvLines('a"b,c\r\n').malformedQuotes).toBe(1);
});

it("counts a quoted field closing before a non-delimiter", () => {
  expect(splitCsvLines('"a"b,c\r\n').malformedQuotes).toBe(1);
});

it("does NOT fire on a legitimately quoted marker-shaped cell", () => {
  // THE CONTROL THAT MATTERS. §150 rejects a detector that fires on this — a
  // well-formed file legitimately carrying a marker-shaped line inside a quoted
  // cell is precisely the §105 shape the quote-aware split exists to handle.
  // Without this assertion the suite cannot tell this detector from that one.
  expect(splitCsvLines('1,"# MILESTONES\r\nstill the same cell",x\r\n').malformedQuotes).toBe(0);
});

it("does NOT fire on a doubled quote inside a quoted cell", () => {
  expect(splitCsvLines('1,"say ""hi""",x\r\n').malformedQuotes).toBe(0);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/csv-line-scan.test.ts --reporter=dot
```

Expected: FAIL — `malformedQuotes` is `undefined`.

- [ ] **Step 3: Implement**

Track field position in the existing `splitCsvLines` walk — a field starts at a line start or
immediately after an unquoted `,`. Count a `"` seen while not in quotes and not at a field start, and
count a closing `"` whose next character is not `,`, `\r\n`, or end of input. **Do not change
`quoteStep`** — it is shared with `parseCsv` and the two scanners must not disagree. Add no imports;
this file's zero-import rule is load-bearing.

- [ ] **Step 4: Run the tests, and prove the rule held**

```bash
npx vitest run src/app/csv-line-scan.test.ts --reporter=dot
grep -nE "^\s*(import|require)" src/app/csv-line-scan.ts; echo "EXIT=$?  (1 = still zero imports)"
```

- [ ] **Step 5: Add the false-positive property**

```ts
it("never fires on output our own encoder wrote", () => {
  fc.assert(fc.property(arbWorkspace(), (ws) => {
    expect(splitCsvLines(workspaceToCsv(ws)).malformedQuotes).toBe(0);
  }), { numRuns: 200 });
});
```

This states the false-positive guarantee as a law. Use a bounded integer mapped through
`new Date(ms)` rather than `fc.date()` (which can emit an Invalid Date), and `[\s\S]` rather than the
`/s` flag (which fails tsc at this target).

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/csv-line-scan.ts src/app/csv-line-scan.test.ts -F - <<'MSG'
fix(csv): detect malformed quoting during the existing scan

§150 proves INTENT is undecidable — a swallowed section marker and a
legitimately quoted marker-shaped cell are byte-identical — and correctly
rejects a "the two splits disagree" detector, which would fire on every
correct import.

MALFORMEDNESS is a separate and decidable property: an opening quote not
at a field start, or a closing quote not followed by a delimiter, is an
RFC 4180 violation. csvEscape wraps and doubles, so nothing this app
writes can trip it, and the §105 legitimate case is properly quoted and
does not trip it either. That is the discrimination the rejected detector
lacked, and the pinned control test is what proves it.
MSG
```

## Task 8: Publish the signal

**Files:** `src/app/csv-codecs-decode.ts`, `src/app/local-file-backend.ts`,
`src/app/sharepoint-backend.ts`, `src/app/workspace.ts`

- [ ] **Step 1** Add `malformedQuotes?: number` to `ImportDiag`, forwarded by `splitCsvSections`.
- [ ] **Step 2** Add `lastImportMalformedQuotes?: number` to the `StorageBackend` surface in
      `workspace.ts`, documented CSV-only exactly as `lastImportUnterminatedQuote` already is.
- [ ] **Step 3** Set and reset it in both backends, beside the two existing fields — reset it on
      every load, since a stale value is worse than zero.
- [ ] **Step 4** `npx vitest run src/app/csv-codecs-decode.test.ts --reporter=dot` and
      `npx tsc --noEmit; echo "EXIT=$?"`.
- [ ] **Step 5** Commit.

## Task 9: The third hold slot, and its strings

**Files:** `src/app/use-load-truncation.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Write the failing test** in `src/app/use-load-truncation.test.ts`: a load reporting
      `lastImportMalformedQuotes: 2` raises `loadWasIncomplete`; a subsequent clean load lowers it;
      `allowIncompleteSave` clears it; and a save is refused while it is up.
- [ ] **Step 2** Run it and watch it fail.
- [ ] **Step 3: Implement** as a third state slot beside `truncation` and `decodeFailures`, folded
      into the single `loadWasIncomplete` derivation, cleared by `allowIncompleteSave`, recorded in
      `reportFor`, and lowered on a clean load. Follow the other slice's shape exactly — a separate
      slot per cause, not a discriminated union.
- [ ] **Step 4: Add the strings.** EN in `i18n.ts` via the Edit tool; DE in `i18n.de.ts` via a **node
      UTF-8 write matching `\r\n`**, with real umlauts. Both must be complete sentences, because
      `reportImportDiagnostics` joins applicable parts with a single space.
- [ ] **Step 5** `npx tsc --noEmit` (enforces EN/DE key parity) and
      `npx vitest run src/app/i18n.encoding.test.ts --reporter=dot`.
- [ ] **Step 6** Commit.

## Task 10: Split the signals (§152, first half)

**Files:** `src/app/use-load-truncation.ts`, `src/app/use-load-truncation.test.ts`

- [ ] **Step 1: Write the failing test** — a path calling the import-only op reports dropped rows and
      does **not** raise or lower the incomplete-load hold.
- [ ] **Step 2** Run it and watch it fail.
- [ ] **Step 3: Implement** the second op on `TruncationOps`.
- [ ] **Step 4: Widen the census** so the new op satisfies it, and so a path expressing **neither**
      op still fails. The new op must not be expressible through `REPORT_EXEMPT_MARKER` — otherwise a
      path can claim exemption while reporting nothing.
- [ ] **Step 5: Prove the census still bites.** Temporarily delete a `reportFor` call from a load
      path, confirm the census goes RED, then restore it with an inverse anchored edit and prove
      `git diff --stat` is empty. A census that cannot go red is not a census.
- [ ] **Step 6** Commit.

## Task 11: Per-section attribution (§152, second half)

**Files:** `src/app/csv-codecs-decode.ts`, `src/app/markdown-codecs-decode.ts`,
`src/app/markdown-codecs-core.ts`

Roughly 27 call sites, each a one-argument edit. Re-derive the list rather than trusting a count:

```bash
grep -nE "collectRows[<(]|decodeCsvSection[<(]" src/app/csv-codecs-decode.ts
grep -rn "decodeMdTable" src/app/*.ts | grep -v "\.test\." | grep -v "export function"
```

- [ ] **Step 1** Introduce `ImportSectionKey` — a new union, codec-neutral, derived from the
      `CSV_SECTION_*` constants in `csv-codecs-sections.ts` and narrowed to sections whose decoders
      can reject a row. Config-blob decoders, blank rows and dangling-dependency pruning are not
      counted today and must not start being counted.
- [ ] **Step 2: Write the failing test** — a CSV with one malformed task row and one malformed
      milestone row attributes one drop to each section, and the flat total is 2.
- [ ] **Step 3** Add `droppedBySection` to `ImportDiag`, keeping `droppedRows` as the derived total so
      existing readers do not churn. Update both together at each increment so they cannot disagree.
- [ ] **Step 4** Thread the section key through `collectRows`, `decodeCsvSection` and `decodeMdTable`,
      and pass it at every call site. Do the CSV family and the Markdown family as two commits.
- [ ] **Step 5** Repeat the test for the Markdown family.
- [ ] **Step 6** Commit each family separately.

## Task 12: Name the sections in the report

**Files:** `src/app/use-load-truncation.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Check which sections already have an entity-name key** before writing the map:

```bash
grep -nE "\"(tasks|milestones|raid|changes|stakeholders|resources|budgets|absences|shifts)\":" src/app/i18n.ts | head -20
```

Add EN+DE pairs for any section in `ImportSectionKey` that has none.

- [ ] **Step 2: Write the failing test** — a report over two sections names both.
- [ ] **Step 3** Implement via a typed `Record<ImportSectionKey, TranslationKey>` so a new section
      fails `tsc` rather than rendering nothing.
- [ ] **Step 4: Pin the ordering.** A file that both drops rows and is malformed must show the
      diagnostic, not a confirmation. Assert on the **LAST** `showToast` call — the surface is
      single-slot and replaces, so a test asserting it was *called* cannot see this defect.
- [ ] **Step 5** `npx tsc --noEmit` and the i18n encoding test.
- [ ] **Step 6** Commit.

---

# Phase 3 — close and release

## Task 13: Register, docs, release chain

- [ ] **Step 1** Close §150, §152, §168 and §36(a) in `docs/open-followups.md`, each with a
      conforming `**Status:**` line — `followups-status-check` is blocking.
- [ ] **Step 2** Rewrite §150's "Why no fix is proposed" section. **Keep** its undecidability-of-intent
      argument and its rejection of the two-splits-disagree detector: both remain correct. Replace
      only the conclusion that no fix exists.
- [ ] **Step 3** Correct the stale graph-size comment in the import-graph guard in
      `rich-text-plain.test.ts` (it says 76; re-measure and use today's number).
- [ ] **Step 4** Update `AGENTS.md` where it describes the load-reporting posture.
- [ ] **Step 5** `CHANGELOG.md` entry under `### Fixed`; bump with `npm run version:sync`. Patch, not
      minor — the codename is per minor series, so 0.263.x stays "Okorafor". **No
      `[session link removed]...` URL in the changelog or the MR description.**
- [ ] **Step 6** Full gate chain:

```bash
npm run test:run > "$SCRATCH/final.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/final.log"
npm run test:shuffle > "$SCRATCH/final-shuffle.log" 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```

- [ ] **Step 7** Axe on the surfaces this touched, at one worker (local runs default to CPU count and
      a timeout there reads like a violation):

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Settings"
```

- [ ] **Step 8** Code review before release, then push → MR → poll → **merge only on green**, with
      `--auto-merge=false` passed explicitly (glab defaults it to true).
