# Edit-task modal rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the edit-task modal — reorder its sections, pair its relationship pickers and its classification fields, move the dictation mic beside its caption, and replace the standalone *Time spent* field with a Jira-style Time tracking dialog opened from the progress bar.

**Architecture:** Mostly layout work inside `task-form-fields.tsx`, plus one genuinely new persisted field (`remainingEstimateMinutes`) and two new components (`effort-field.tsx`, extracted so the dialog can reuse it, and `task-time-tracking-modal.tsx`). The dialog stacks over `TaskFormModal` using the existing `Modal` primitive, which owns the dismissal stack itself.

**Tech Stack:** Next.js 16 / React / TypeScript / Tailwind v4 / vitest + Testing Library / Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-edit-task-modal-rework-design.md`
**Branch:** `feat/edit-task-modal-rework`, at `5de25711` (= `origin/main` `03df1445` + the spec commit).
**No release, no version bump in this plan.** The slice ships separately on explicit say.

---

## Two corrections to the spec, established while writing this plan

**1. JSON and IndexedDB need NO code change.** The spec says the new column "rides all six write paths",
implying work on each. It does not. `migrateTask` (`task-status.ts:26`) is a passthrough — it spreads
and returns the task by reference when `status` and `createdDate` are already fine — and it is the
only task normalizer on the JSON and IndexedDB load paths. An unknown field rides through untouched.
The real work is **CSV + Markdown only**; Turso derives from `CSV_COLUMNS`. Task 14 corrects the spec
text so the next reader does not go hunting for four edits that do not exist.

**2. The spec's "byte-identical serialization" test is impossible as worded, and is replaced.** The
spec asks for a test that "a task carrying no remaining value serialises byte-identically to today".
It cannot: adding a column changes the bytes for *every* task, which is the whole point. The intent —
catch a codec change masquerading as a new column — is served instead by Task 3 Step 13, which
inspects the regenerated fixture diff and requires that the ONLY change is the new header column plus
one empty field per row, with no other column moving. Task 14 corrects the spec text.

**3. There is no golden-fixture regeneration script.** `golden-workspace.test.ts`'s own header says
the fixtures were generated ONCE and warns: *"do NOT regenerate the fixtures to 'fix' a failure of
this test: a failure means the storage byte format changed, which is the bug."* Here the byte format
genuinely does change, so regeneration is correct — but it needs a deliberate one-off, and
`jsonToWorkspace` returns an EMPTY workspace under bare node because it needs a DOM. Task 3 carries a
recipe that runs under vitest's jsdom environment.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/effort-field.tsx` | **create** | `EffortField` — a duration text input over `parseDuration`/`formatDuration`. Extracted from `task-form-fields.tsx` so the dialog can reuse it rather than duplicate it. |
| `src/app/task-time-tracking-modal.tsx` | **create** | The stacked Time tracking dialog: progress bar, logged line, estimate sentence, Time spent + Time remaining, format legend, Save/Cancel. |
| `src/app/task-time-tracking-button.tsx` | **create** | The clickable widget that replaces the display-only `EffortProgressBar` call site and opens the dialog. |
| `src/app/duration.ts` | modify | gains `derivedRemaining`. |
| `src/app/types.ts` | modify | gains `Task.remainingEstimateMinutes`. |
| `src/app/csv-codecs-core.ts` | modify | `CSV_COLUMNS` gains the column. `fieldToString` needs no case — it falls through to `String(t[c] ?? "")`. |
| `src/app/csv-codecs-decode.ts` | modify | `buildTaskFromObj` admits it. |
| `src/app/markdown-columns.ts` | modify | one `{ key, label }` row. |
| `src/app/markdown-codecs-decode.ts` | modify | `colMap` entry + decode object. |
| `src/app/task-form-context.tsx` | modify | the form draft gains the field. |
| `src/app/use-task-submit.ts` | modify | **two** sites: the save payload and the edit-hydration. |
| `src/app/templates.ts` | modify | template tasks carry it. |
| `src/app/task-form-layout.tsx` | modify | `Field` gains `captionAction`, which forces `group`. |
| `src/app/task-form-fields.tsx` | modify | all six layout items. |
| `src/app/modal-fields.ts` | modify | `timeSpent` label + tier. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | modify | new keys. |
| `src/app/effort-progress-bar.tsx` | modify | `aria-hidden` track; role dropped. |
| `src/app/__fixtures__/golden-workspace.{csv,md}` | regenerate | legitimate new-column format change. |

**Standing rules for every task below.**

- `src/app/*.ts(x)` are **CRLF**. Use the **Edit tool only** — never Write, never `sed -i`, both of
  which silently re-line the whole file.
- `i18n.de.ts` takes an **anchored node utf8 write with `\r\n` anchors** and REAL umlauts. The Edit
  tool corrupts umlauts and curls quotes there. The `i18n-encoding` test bans ASCII substitutions
  (`fuer`, `druecken`).
- **Never** `git add -A` or `git add .`. Commit with `git commit --only <paths>`.
  `sample-workspace-huge.json` is modified by a foreign concurrent writer and
  `not-in-use.env.local.bak` is untracked, not gitignored, and holds live Turso credentials.
- **Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect, check
  unpiped, then read the file.
- **Never run two vitest processes at once.**
- `npx tsc --noEmit` exits **2** on diagnostics, not 1.

**The task-form test harness — use it, do not invent one.** `src/app/task-form-fields.test.tsx`
already defines everything the layout tasks need, and the tests below assume it:

- `function Harness(over: { onOpenNotes?: () => void; budgetLink?: TaskBudgetLink } = {})` renders
  `<TaskFormFields …/>` inside a `<form aria-label="form">` with every required prop stubbed.
- Every render call is `render(<Harness />, { wrapper: TestProviders })`. **`TestProviders` is
  required** — the component reads settings and workspace context.
- Budget bucket needs `render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, …)`;
  `BUCKETS` is already defined in that file.
- The field tier is driven through the UI by `selectFieldTier` from `../test/field-tier` — the tier
  control lives in a popover, so the radios do not exist in the DOM until it is opened. Never set the
  tier by reaching into state.
- That file uses **`it`**, not `test`. Match it.
- A `beforeAll` there polyfills `Range.prototype.getClientRects`/`getBoundingClientRect` so the Tiptap
  description editor can mount under jsdom. Any NEW test file that renders `TaskFormFields` needs the
  same polyfill.

---

## Task 1: Extract `EffortField` into its own file

The dialog needs this input twice. Extract before use so nothing is duplicated.

**Files:**
- Create: `src/app/effort-field.tsx`
- Modify: `src/app/task-form-fields.tsx` (delete the local helper at ~735-779, add an import)

- [ ] **Step 1: Read the current helper verbatim**

Run: `sed -n '735,779p' src/app/task-form-fields.tsx`

Expected: the `function EffortField({ lang, label, minutes, onChange })` body ending in `}`.

- [ ] **Step 2: Create the new file**

Create `src/app/effort-field.tsx` with exactly this content (this file is NEW, so the Write tool is
fine — the CRLF rule applies to existing files):

```tsx
"use client";

import { useId, useState } from "react";
import { formatDuration, parseDuration } from "./duration";
import { FieldNotice } from "./field-feedback";
import { Input } from "./form-controls";
import { type Lang, t } from "./i18n";
import { Field } from "./task-form-layout";

/** A duration text input over `parseDuration`/`formatDuration` (w/d/h/m).
 *
 *  Extracted from `task-form-fields.tsx` so the Time tracking dialog can reuse
 *  it. `minutes` seeds the text ONCE via lazy `useState` — the box is
 *  free-text while focused and must not be re-formatted under the user's
 *  cursor, so remount (a `key`) is how a caller forces a reseed. Both existing
 *  call sites already pass `key={`estimate-${editingId ?? "new"}`}` for that
 *  reason; keep doing so. */
export function EffortField({
  lang,
  label,
  minutes,
  onChange,
  placeholder,
  captionHint,
}: {
  lang: Lang;
  label: string;
  minutes: number | undefined;
  onChange: (minutes: number | undefined) => void;
  /** Overrides the default `taskEffortHint` placeholder — the dialog's
   *  remaining box shows the DERIVED figure here instead. */
  placeholder?: string;
  /** Optional InfoTooltip text beside the caption. */
  captionHint?: string;
}) {
  const [text, setText] = useState(() => formatDuration(minutes ?? 0));
  const [invalid, setInvalid] = useState(false);
  const noticeId = useId();

  return (
    <Field label={label} hint={captionHint}>
      <Input
        type="text"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (value.trim() === "") {
            setInvalid(false);
            onChange(undefined);
            return;
          }
          const mins = parseDuration(value);
          if (mins === null) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onChange(mins);
        }}
        placeholder={placeholder ?? t(lang, "taskEffortHint")}
        invalid={invalid}
        aria-describedby={invalid ? noticeId : undefined}
        className="w-full"
      />
      {invalid && <FieldNotice id={noticeId}>{t(lang, "taskEffortInvalid")}</FieldNotice>}
    </Field>
  );
}
```

- [ ] **Step 3: Delete the local helper and import the new one**

In `src/app/task-form-fields.tsx`, use the Edit tool to delete the whole `function EffortField({` …
closing `}` block (currently ~735-779), and add this import next to the existing
`import { formatDuration, parseDuration } from "./duration";` line:

```ts
import { EffortField } from "./effort-field";
```

★ After deleting the helper, `useId` and possibly `formatDuration`/`parseDuration` may become unused
in `task-form-fields.tsx`. `npm run lint` runs with `--max-warnings=0` and
`@typescript-eslint/no-unused-vars` is fatal, so remove any import that is now dead. Step 5 catches
this.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`. (This command exits **2** on diagnostics.)

- [ ] **Step 5: Lint the two files**

Run: `npx eslint --max-warnings=0 src/app/effort-field.tsx src/app/task-form-fields.tsx; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Run the existing task-form tests — this is a pure extraction, so they must be green unchanged**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log`

★ Use the session scratchpad rather than `/tmp` if the harness provides one; never a shared temp dir.

Expected: `EXIT=0`, and the same test count as before the extraction. If the file does not exist,
run `npx vitest run src/app/task-form --maxWorkers=2` and record whatever matches.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/effort-field.tsx src/app/task-form-fields.tsx -F - <<'EOF'
refactor(tasks): extract EffortField so the time-tracking dialog can reuse it

Pure extraction, no behaviour change. The dialog needs this duration input
twice; duplicating it would put two parsers behind one format.

Adds two optional props the dialog needs and the existing call sites do not
pass: `placeholder` (the remaining box shows the DERIVED figure instead of the
generic hint) and `captionHint`.
EOF
```

---

## Task 2: `derivedRemaining` in `duration.ts`

One pure function, so "derived" is defined once and the widget and the dialog cannot disagree.

**Files:**
- Modify: `src/app/duration.ts`
- Test: `src/app/duration.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/duration.test.ts` (Edit tool — this file is CRLF):

```ts
describe("derivedRemaining", () => {
  test("is the estimate less the spent time", () => {
    expect(derivedRemaining(480, 180)).toBe(300);
  });

  test("floors at zero when spent exceeds the estimate", () => {
    expect(derivedRemaining(120, 500)).toBe(0);
  });

  test("treats a missing spent value as zero spent", () => {
    expect(derivedRemaining(480, undefined)).toBe(480);
  });

  test("is zero with no estimate, because nothing is known to remain", () => {
    expect(derivedRemaining(undefined, 300)).toBe(0);
  });
});
```

Add `derivedRemaining` to the existing import from `./duration` at the top of that file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/duration.test.ts --maxWorkers=2 > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log`
Expected: non-zero exit; failures naming `derivedRemaining is not a function`.

- [ ] **Step 3: Implement**

Append to `src/app/duration.ts` (Edit tool):

```ts
/** Minutes still to do when the user has NOT pinned a remaining value.
 *
 *  Zero with no estimate: "no estimate" means nothing is known to remain, and
 *  returning the spent time instead would claim the task is exactly as far
 *  from done as the work already put into it. Floors at zero — negative
 *  remaining is not a state the UI can render or the user can act on. */
export function derivedRemaining(estimateMin?: number, spentMin?: number): number {
  if (!estimateMin) return 0;
  return Math.max(0, estimateMin - (spentMin ?? 0));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/app/duration.test.ts --maxWorkers=2 > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log`
Expected: `EXIT=0`, four more tests than before.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/duration.ts src/app/duration.test.ts -F - <<'EOF'
feat(duration): add derivedRemaining

One definition of "remaining when not overridden", so the tracking widget and
the dialog cannot disagree. Zero with no estimate: nothing is known to remain.
EOF
```

---

## Task 3: `remainingEstimateMinutes` — the persisted column

The only irreversible part of this slice. CSV + Markdown only; JSON/IndexedDB ride through
`migrateTask` untouched, and Turso derives from `CSV_COLUMNS`.

**Files:**
- Modify: `src/app/types.ts`, `src/app/csv-codecs-core.ts`, `src/app/csv-codecs-decode.ts`,
  `src/app/markdown-columns.ts`, `src/app/markdown-codecs-decode.ts`, `src/app/templates.ts`
- Regenerate: `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md`
- Test: `src/app/codec-roundtrip.test.ts` (or the nearest existing task-codec test — Step 1 locates it)

- [ ] **Step 1: Locate the task codec round-trip test**

Run: `grep -rln "timeSpentMinutes" src/app --include=*.test.ts | head`

Use the file that already round-trips a task through CSV and Markdown. If there is none, create
`src/app/task-remaining-estimate.test.ts` with the imports the neighbouring codec tests use.

- [ ] **Step 2: Write the failing tests**

★ `baseTask` and `emptyWorkspace` below are the neighbouring file's OWN fixtures — reuse whatever it
already calls them (`makeTask()`, a `BASE_WS` const, etc.) rather than adding a second set. If you
create a new test file instead, define them there as a minimal valid `Task` and `Workspace`, matching
the shape `csvToWorkspace`/`workspaceToCsv` already round-trip in the existing codec tests.

```ts
test("round-trips remainingEstimateMinutes through CSV", () => {
  const task = { ...baseTask, originalEstimateMinutes: 480, timeSpentMinutes: 120, remainingEstimateMinutes: 240 };
  const back = csvToWorkspace(workspaceToCsv({ ...emptyWorkspace, tasks: [task] }));
  expect(back.tasks[0].remainingEstimateMinutes).toBe(240);
});

test("round-trips remainingEstimateMinutes through Markdown", () => {
  const task = { ...baseTask, originalEstimateMinutes: 480, timeSpentMinutes: 120, remainingEstimateMinutes: 240 };
  const back = markdownToWorkspace(workspaceToMarkdown({ ...emptyWorkspace, tasks: [task] }));
  expect(back.tasks[0].remainingEstimateMinutes).toBe(240);
});

// ★★ THIS is the test that catches a codec change masquerading as a new column.
// A task with no remaining value must decode to `undefined`, never 0 — a stored
// zero is the real claim "no work left", which is a different thing from
// "not overridden".
test("a task with no remaining value decodes to undefined, not zero", () => {
  const back = csvToWorkspace(workspaceToCsv({ ...emptyWorkspace, tasks: [baseTask] }));
  expect(back.tasks[0].remainingEstimateMinutes).toBeUndefined();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run <that file> --maxWorkers=2 > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log`
Expected: non-zero exit; the two round-trip tests fail on `undefined`. The third may already pass —
that is fine and expected, it is a regression pin, not a red-first test.

- [ ] **Step 4: Add the field to `Task`**

`src/app/types.ts`, immediately after line 81's `timeSpentMinutes?: number;`:

```ts
  /** Minutes still to do, when the user has PINNED a value in the Time tracking
   *  dialog. Absent means "not overridden" — read `derivedRemaining()` instead.
   *  Never 0 for "not overridden": 0 is the real claim "no work left". */
  remainingEstimateMinutes?: number;
```

- [ ] **Step 5: Add the CSV column**

`src/app/csv-codecs-core.ts`, in `CSV_COLUMNS`, immediately after `"timeSpentMinutes",` (line 89):

```ts
  "remainingEstimateMinutes",
```

★ `fieldToString` needs NO case — it falls through to `String(t[c] ?? "")`, which is correct for a
number. ★ The array is `as const satisfies readonly (keyof Task)[]`, so Step 4 must land first or
tsc rejects this.

- [ ] **Step 6: Admit it on the CSV decode**

`src/app/csv-codecs-decode.ts`, in `buildTaskFromObj`, immediately after line 733's
`timeSpentMinutes: sanitizeOptionalMinutes(obj.timeSpentMinutes),`:

```ts
    remainingEstimateMinutes: sanitizeOptionalMinutes(obj.remainingEstimateMinutes),
```

★ `sanitizeOptionalMinutes` (`sanitize-core.ts:164`) already returns `undefined` for absent, empty,
non-integer and negative input, so the undefined-not-zero rule holds for free.

- [ ] **Step 7: Add the Markdown column**

`src/app/markdown-columns.ts`, immediately after line 52's
`{ key: "timeSpentMinutes", label: "TimeSpentMin" },`:

```ts
  { key: "remainingEstimateMinutes", label: "RemainingEstimateMin" },
```

- [ ] **Step 8: Admit it on the Markdown decode — TWO places**

`src/app/markdown-codecs-decode.ts`, in the `colMap` chain after the `timespentmin` arm (~line 491):

```ts
    else if (norm === "remainingestimatemin" || norm === "remainingestimateminutes")
      colMap[idx] = "remainingEstimateMinutes";
```

and in the decode object after line 539's `timeSpentMinutes: sanitizeOptionalMinutes(...)`:

```ts
      remainingEstimateMinutes: sanitizeOptionalMinutes(obj.remainingEstimateMinutes),
```

- [ ] **Step 9: Carry it through templates**

`src/app/templates.ts`, after the `timeSpentMinutes` block at ~226-227, matching its shape exactly:

```ts
  const remainingEstimateMinutes = sanitizeOptionalMinutes(raw.remainingEstimateMinutes);
  if (remainingEstimateMinutes !== undefined) task.remainingEstimateMinutes = remainingEstimateMinutes;
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 11: Confirm the golden test now fails, and that it fails for the RIGHT reason**

Run: `npx vitest run src/app/golden-workspace.test.ts --maxWorkers=2 > /tmp/t3g.log 2>&1; echo "EXIT=$?"; head -40 /tmp/t3g.log`

Expected: FAIL. The first differing line must be the TASKS **header**, gaining
`,remainingEstimateMinutes` after `timeSpentMinutes` — and each task row gaining one empty trailing
field in that position. If any OTHER column moved, stop: the insertion landed in the wrong place.

- [ ] **Step 12: Regenerate the two fixtures — deliberately, under jsdom**

There is no regeneration script, and `jsonToWorkspace` returns an EMPTY workspace under bare node
because it needs a DOM. Create a throwaway test file `src/app/__regen-golden.test.ts` so it runs in
vitest's jsdom environment:

```ts
import { test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } from "./storage";

test("regenerate the golden fixtures", () => {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const fixturesDir = join(import.meta.dirname, "__fixtures__");
  const ws = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8"));
  if (ws.tasks.length === 0) throw new Error("empty workspace — jsdom missing, refusing to write");
  writeFileSync(join(fixturesDir, "golden-workspace.csv"), workspaceToCsv(ws), "utf8");
  writeFileSync(join(fixturesDir, "golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
});
```

★ The `ws.tasks.length === 0` guard is load-bearing: without a DOM this writes two EMPTY fixtures and
`golden-workspace.test` then passes against them, certifying nothing.

Run: `npx vitest run src/app/__regen-golden.test.ts --maxWorkers=2; echo "EXIT=$?"`
Expected: `EXIT=0`.

Then delete the throwaway: `rm src/app/__regen-golden.test.ts`
(`rm -rf` is gate-blocked; a plain `rm` of one file is fine. On PowerShell use `Remove-Item`.)

- [ ] **Step 13: Verify the regenerated fixtures changed ONLY as expected**

Run: `git diff --stat src/app/__fixtures__/`
Expected: both files changed.

Run: `git diff src/app/__fixtures__/golden-workspace.csv | head -30`
Expected: the TASKS header gains `remainingEstimateMinutes` after `timeSpentMinutes`; task rows gain
one empty field in that position. **No other column moves, and no other section of the file changes.**
If anything else moved, revert the fixtures and find out why before continuing.

★ The fixtures are marked `-text` in `.gitattributes`, so git performs no line-ending conversion:
the CSV stays CRLF and the Markdown stays LF because the serializers emit them that way.

- [ ] **Step 14: Run the codec and golden tests together**

Run: `npx vitest run src/app/golden-workspace.test.ts src/app/codec-roundtrip.property.test.ts <your test file> --maxWorkers=2 > /tmp/t3b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3b.log`
Expected: `EXIT=0`.

- [ ] **Step 15: Commit**

```bash
git commit --only src/app/types.ts src/app/csv-codecs-core.ts src/app/csv-codecs-decode.ts src/app/markdown-columns.ts src/app/markdown-codecs-decode.ts src/app/templates.ts src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md <your test file> -F - <<'EOF'
feat(tasks): persist remainingEstimateMinutes

A pinned "time remaining", so a user can record that a task will take longer
than its estimate implied. Absent means NOT OVERRIDDEN and callers derive
max(0, estimate - spent); it is never stored as 0, which is the different and
real claim "no work left".

CSV and Markdown only. JSON and IndexedDB need no code: migrateTask is a
passthrough, so an unknown field rides through untouched. Both Turso layouts
derive from CSV_COLUMNS via the turso-schema task spec.

The golden fixtures move because the storage byte format genuinely changed --
the TASKS header gains one column and each row one empty field, and nothing
else in either file differs. Regenerated deliberately under jsdom, with a
guard refusing to write an empty workspace.
EOF
```

---

## Task 4: Thread the field through the form draft and both submit sites

**Files:**
- Modify: `src/app/task-form-context.tsx` (~47), `src/app/use-task-submit.ts` (~173 and ~567)

- [ ] **Step 1: Add it to the empty draft**

`src/app/task-form-context.tsx`, immediately after line 48's `timeSpentMinutes: undefined as number | undefined,`:

```ts
    // Pinned "time remaining". undefined = not overridden; the dialog then
    // shows derivedRemaining() as a placeholder rather than a value.
    remainingEstimateMinutes: undefined as number | undefined,
```

- [ ] **Step 2: Add it to the SAVE payload**

`src/app/use-task-submit.ts`, after line 173's `timeSpentMinutes: form.timeSpentMinutes,`:

```ts
        remainingEstimateMinutes: form.remainingEstimateMinutes,
```

- [ ] **Step 3: Add it to the EDIT hydration — the second site, easy to miss**

`src/app/use-task-submit.ts`, after line 567's `timeSpentMinutes: task.timeSpentMinutes,`:

```ts
        remainingEstimateMinutes: task.remainingEstimateMinutes,
```

★ Two sites, not one. Missing the hydration one means opening an existing task silently drops its
pinned remaining value on the next save — a data loss with a green suite.

- [ ] **Step 4: Update `validForm()` in the existing test — tsc fails without it**

`TaskFormDraft` is `ReturnType<typeof emptyForm>`, so the moment Step 1 lands, the
`validForm(): TaskFormDraft` literal in `src/app/use-task-submit.test.ts` is missing a property and
`npx tsc --noEmit` fails there. Add it beside line 53's `timeSpentMinutes: undefined,`:

```ts
    remainingEstimateMinutes: undefined,
```

★ `next build` does NOT typecheck test files and vitest never typechecks, so this failure appears
ONLY under `npx tsc --noEmit` — i.e. in CI, if you skip Step 7.

- [ ] **Step 5: Write a test pinning BOTH directions**

`src/app/use-task-submit.test.ts` already has `makeTask(overrides)`, `validForm()` and drives the
hook with `renderHook` + `act`. Use them; do not build a second harness. Add:

```ts
describe("remainingEstimateMinutes", () => {
  it("carries a pinned remaining value from the draft into the saved task", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit({ ...submitDeps, tasks: [], setTasks }),
    );
    act(() => {
      result.current.handleSubmit({
        ...validForm(),
        originalEstimateMinutes: 480,
        timeSpentMinutes: 120,
        remainingEstimateMinutes: 240,
      });
    });
    const saved = setTasks.mock.calls.at(-1)?.[0];
    const rows = typeof saved === "function" ? saved([]) : saved;
    expect(rows[0].remainingEstimateMinutes).toBe(240);
  });

  it("hydrates a pinned remaining value when an existing task is opened for edit", () => {
    // ★ THE SITE A FIRST CUT MISSES. Without the hydration line, opening a task
    // that carries a pinned remaining value and pressing Save silently clears
    // it -- a data loss with the whole suite green.
    const setForm = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit({ ...submitDeps, tasks: [makeTask({ remainingEstimateMinutes: 240 })], setForm }),
    );
    act(() => {
      result.current.handleEdit(makeTask({ remainingEstimateMinutes: 240 }));
    });
    const draft = setForm.mock.calls.at(-1)?.[0];
    expect(draft.remainingEstimateMinutes).toBe(240);
  });
});
```

★ `submitDeps`, the exact hook argument shape, and the names of the submit/edit entry points
(`handleSubmit` / `handleEdit` above) must match what the neighbouring tests in that file already
use. Read the file's existing `renderHook(() => useTaskSubmit(...))` calls first and copy their
argument object verbatim, changing only what these two tests need. If the hook exposes the edit path
under a different name, use that name — do not add a wrapper to make this snippet fit.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/use-task-submit.test.ts --maxWorkers=2 > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log`
Expected: `EXIT=0`.

- [ ] **Step 7: Mutation-prove the hydration test**

Comment out the line added in Step 3, re-run, and record which cases fail:

Run: `npx vitest run src/app/use-task-submit.test.ts --maxWorkers=2 > /tmp/t4m.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4m.log`

Expected: the hydration test FAILS. Record the result as `N failed / M passed`, and confirm
**N + M equals the file's runtime test count** from Step 6 — a mutant that changes the total means
something did not run.

Then restore the line by an **inverse anchored write**: assert the anchor is unique before and after,
and finish on `git diff --stat` showing that file unchanged. (`git checkout -- <file>` is
DENY-BLOCKED; do not reach for it.)

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/task-form-context.tsx src/app/use-task-submit.ts src/app/use-task-submit.test.ts -F - <<'EOF'
feat(tasks): thread remainingEstimateMinutes through the task form

Two sites, not one: the save payload AND the edit hydration. Missing the
hydration site would silently clear a pinned remaining value on the next save
of an existing task, with the suite green -- so that test is mutation-proved.
EOF
```

---

## Task 5: i18n keys

**Files:**
- Modify: `src/app/i18n.ts` (EN), `src/app/i18n.de.ts` (DE)

- [ ] **Step 1: Add the EN keys**

`src/app/i18n.ts`, immediately after line 96's `taskEffortNoEstimate: "No estimate set",` (Edit tool):

```ts
  taskTimeTracking: "Time tracking",
  taskTimeTrackingButton: "Time tracking: {0} logged of {1}",
  taskTimeTrackingButtonNoEstimate: "Time tracking: {0} logged, no estimate set",
  taskTimeTrackingLogged: "{0} logged",
  taskTimeTrackingOriginal: "The original estimate for this work item was {0}.",
  taskTimeTrackingOriginalNone: "No original estimate has been set for this work item.",
  taskTimeRemaining: "Time remaining",
  taskTimeRemainingHint: "Leave this empty to follow the estimate automatically. Type a value to pin it.",
  taskTimeFormat: "Use the format: 2w 4d 6h 45m",
  taskTimeFormatWeeks: "w = weeks",
  taskTimeFormatDays: "d = days",
  taskTimeFormatHours: "h = hours",
  taskTimeFormatMinutes: "m = minutes",
  taskTimeTrackingSave: "Save",
```

★ There is **no generic `save` key** in this codebase — each modal carries its own (`savedViewsSaveConfirm`,
`documentsRename`, …). `cancel` DOES exist (`i18n.ts:10`) and is reused.
★ Placeholders are **0-based positional**: `t(lang, key, a, b)` fills `{0}` and `{1}`.

- [ ] **Step 2: Add the DE keys with an anchored node write**

★★ Do NOT use the Edit tool on `i18n.de.ts` — it corrupts umlauts and curls double quotes. The file
is CRLF, so a `\n` anchor silently no-ops; match `\r\n`.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  taskEffortNoEstimate: \"Keine Schätzung gesetzt\",\r\n";
if (s.split(anchor).length !== 2) throw new Error("anchor not unique: " + (s.split(anchor).length - 1));
const add = [
  "  taskTimeTracking: \"Zeiterfassung\",",
  "  taskTimeTrackingButton: \"Zeiterfassung: {0} erfasst von {1}\",",
  "  taskTimeTrackingButtonNoEstimate: \"Zeiterfassung: {0} erfasst, keine Schätzung gesetzt\",",
  "  taskTimeTrackingLogged: \"{0} erfasst\",",
  "  taskTimeTrackingOriginal: \"Die ursprüngliche Schätzung für diesen Vorgang war {0}.\",",
  "  taskTimeTrackingOriginalNone: \"Für diesen Vorgang wurde keine ursprüngliche Schätzung gesetzt.\",",
  "  taskTimeRemaining: \"Verbleibende Zeit\",",
  "  taskTimeRemainingHint: \"Leer lassen, um der Schätzung automatisch zu folgen. Einen Wert eingeben, um ihn festzusetzen.\",",
  "  taskTimeFormat: \"Format verwenden: 2w 4d 6h 45m\",",
  "  taskTimeFormatWeeks: \"w = Wochen\",",
  "  taskTimeFormatDays: \"d = Tage\",",
  "  taskTimeFormatHours: \"h = Stunden\",",
  "  taskTimeFormatMinutes: \"m = Minuten\",",
  "  taskTimeTrackingSave: \"Speichern\",",
].join("\r\n") + "\r\n";
fs.writeFileSync(p, s.replace(anchor, anchor + add), "utf8");
console.log("ok");
'
```

- [ ] **Step 3: Verify the file is still CRLF and the umlauts are real**

Run: `git ls-files --eol src/app/i18n.de.ts`
Expected: `i/lf w/crlf` — healthy. `i/lf w/lf` means something re-lined the file; undo and retry.

Run: `grep -c 'Schätzung\|für\|Vorgang' src/app/i18n.de.ts`
Expected: a non-zero count, with real `ä`/`ü` — not `ae`/`ue`.

- [ ] **Step 4: Typecheck — EN/DE key parity is tsc-enforced**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`. A missing DE key fails here with a type error naming it.

- [ ] **Step 5: Run the encoding test**

Run: `npx vitest run src/app/i18n-encoding --maxWorkers=2 > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log`
Expected: `EXIT=0`. This test BANS ASCII substitutions like `fuer`/`druecken`.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts -F - <<'EOF'
feat(i18n): add the time-tracking dialog strings

Fourteen keys in both dictionaries. There is no generic `save` key in this
codebase -- each modal carries its own -- so the dialog gets
taskTimeTrackingSave; `cancel` is reused.
EOF
```

---

## Task 6: `Field.captionAction`, which FORCES `group`

**Files:**
- Modify: `src/app/task-form-layout.tsx` (the `Field` component)
- Test: `src/app/task-form-layout.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Field } from "./task-form-layout";

describe("Field captionAction", () => {
  test("clicking the caption focuses the input and does NOT activate the caption control", async () => {
    // ★★★ THE POINT OF THE WHOLE PROP. A <label> with no `for` binds to its
    // first LABELABLE descendant, and a button IS labelable. With the caption
    // control inside a binding <label>, clicking the words "Task name" would
    // fire the mic instead of focusing the field.
    const onMic = vi.fn();
    render(
      <Field
        label="Task name"
        captionAction={<button type="button" onClick={onMic}>Hold to dictate</button>}
      >
        <input aria-label="Task name" />
      </Field>,
    );
    await userEvent.click(screen.getByText("Task name"));
    expect(onMic).not.toHaveBeenCalled();
  });

  test("renders a named group rather than a label when captionAction is passed", () => {
    render(
      <Field label="Task name" captionAction={<button type="button">Hold to dictate</button>}>
        <input aria-label="Task name" />
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Task name" })).toBeInTheDocument();
  });

  test("still wraps in a label when no captionAction is passed", async () => {
    // The default branch must be untouched -- every other Field in the app
    // relies on the implicit label binding.
    render(
      <Field label="Group">
        <input />
      </Field>,
    );
    await userEvent.click(screen.getByText("Group"));
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/task-form-layout.test.tsx --maxWorkers=2 > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log`
Expected: non-zero exit; the first two fail (`captionAction` is not a prop yet, so the button is not
rendered at all and `getByRole("group")` finds nothing).

- [ ] **Step 3: Implement**

In `src/app/task-form-layout.tsx`, Edit the `Field` component. Add to the prop type, after `group?: boolean;`:

```ts
  /** A control rendered at the caption's trailing edge (the task-name dictation
   *  mic). ★★★ PASSING THIS FORCES `group` MODE, and that is the whole point.
   *  The default branch wraps caption AND children in a `<label>`; a `<label>`
   *  with no `for` binds to its FIRST LABELABLE descendant; a button IS
   *  labelable — so a control in the caption would steal the click from the
   *  input and clicking "Task name" would start dictation. Forcing `group`
   *  makes that unreachable for every future caller rather than fixing it once
   *  at one call site.
   *  ★ CONSEQUENCE: a named `role="group"` does NOT give its input an
   *  accessible name, so a consumer passing this MUST give its own control an
   *  explicit `aria-label`. An unlabeled form control is an axe-CRITICAL fail. */
  captionAction?: React.ReactNode;
```

Add to the caption, as the last child inside the caption `<span>`:

```tsx
      {captionAction && <span className="ml-auto inline-flex">{captionAction}</span>}
```

Change the branch condition from `if (group) {` to:

```tsx
  if (group || captionAction) {
```

Remember to add `captionAction` to the destructured parameter list.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/app/task-form-layout.test.tsx --maxWorkers=2 > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log`
Expected: `EXIT=0`; three tests passing.

- [ ] **Step 5: Mutation-prove the forcing — this is the guard, so prove it**

Change `if (group || captionAction) {` back to `if (group) {` and re-run:

Run: `npx vitest run src/app/task-form-layout.test.tsx --maxWorkers=2 > /tmp/t6m.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6m.log`

Expected: **2 failed / 1 passed** — the click test AND the group test go red, the default-branch test
stays green. Confirm 2 + 1 equals the file's runtime test count. If only the group test fails, the
click test is not actually exercising label forwarding and must be rewritten before continuing —
that test is the one that matters.

Restore by inverse anchored write; assert the anchor is unique in both directions; finish on
`git diff --stat` showing the file unchanged.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Run: `npx eslint --max-warnings=0 src/app/task-form-layout.tsx src/app/task-form-layout.test.tsx; echo "EXIT=$?"`
Expected: `EXIT=0` for both.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/task-form-layout.tsx src/app/task-form-layout.test.tsx -F - <<'EOF'
feat(forms): Field gains captionAction, which forces group mode

A control in the caption of the default <label> branch would become the
label's first labelable descendant, so clicking the caption text would fire it
instead of focusing the input. Forcing group makes that unreachable for every
future caller rather than fixing it once at one call site.

Mutation-proved: reverting the forcing turns 2 of the 3 tests red.
EOF
```

---

## Task 7: Move the dictation mic beside the caption

**Files:**
- Modify: `src/app/task-form-fields.tsx` (the Task name Field, ~198-224)

- [ ] **Step 1: Write the failing test**

In `src/app/task-form-fields.test.tsx` (or the nearest task-form test file):

```tsx
it("puts the dictation control in the task-name caption and keeps the input separately named", () => {
  render(<Harness />, { wrapper: TestProviders });
  const group = screen.getByRole("group", { name: t("en-US", "taskName") });
  // The mic is INSIDE the caption group, not a sibling of the input.
  expect(within(group).getByRole("button", { name: /dictate/i })).toBeInTheDocument();
  // And the input still has its own accessible name, which the named group does
  // NOT give it -- an unlabeled form control is an axe-critical failure.
  expect(screen.getByRole("textbox", { name: t("en-US", "taskName") })).toBeInTheDocument();
});
```

★ Add `within` to the existing `@testing-library/react` import in that file if it is not there yet.
★ Check the mic's real accessible name before trusting `/dictate/i`:
`grep -n "aria-label" src/app/dictation-mic.tsx` — use whatever it actually renders.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log`
Expected: non-zero exit — there is no `role="group"` named "Task name" yet.

- [ ] **Step 3: Rewrite the Task name Field**

In `src/app/task-form-fields.tsx`, replace the Task name `Field` (currently opening at ~197 and using
a `<div className="flex items-center gap-1">` wrapper around the `Input` and `{titleMic}`) with:

```tsx
        <Field
          label={t(lang, "taskName")}
          required
          className="sm:col-span-2"
          captionAction={titleMic}
        >
          <Input
            type="text"
            required
            value={form.taskName}
            // ★ Explicit, because `captionAction` forces `group` mode and a named
            // role="group" does NOT give its input an accessible name. An
            // unlabeled form control is an axe-CRITICAL failure.
            aria-label={t(lang, "taskName")}
            onChange={(e) => setForm({ ...form, taskName: e.target.value })}
            onFocus={titleDictationReg.onFocus}
            onBlur={(e) => {
              setForm({ ...form, taskName: describeTextCap(e.target.value, TASK_NAME_MAX).value.trim() });
              markTouched("taskName");
              titleDictationReg.onBlur();
            }}
            placeholder={t(lang, "placeholderTaskName")}
            invalid={errorFor("taskName") ? true : undefined}
            aria-describedby={describedBy("taskName", "taskName-counter")}
            className="w-full"
          />
          <CharCounter value={form.taskName} max={TASK_NAME_MAX} id="taskName-counter" lang={lang} />
          {titleDictationStatus}
          <FieldError id="taskName-error">{errorFor("taskName")}</FieldError>
        </Field>
```

★ The `<div className="flex items-center gap-1">` wrapper and the `{titleMic}` inside it are both
GONE. The dictation status line stays where it was, below the input.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Mutation-prove the aria-label**

Delete the `aria-label={t(lang, "taskName")}` line and re-run. Expected: the second assertion fails
(no textbox with that accessible name). Record `N failed / M passed` and confirm the sum matches.
Restore by inverse anchored write and finish on an empty `git diff --stat` for that file.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx -F - <<'EOF'
feat(tasks): move the task-name dictation mic beside its caption

Uses Field's new captionAction, which forces group mode. The input therefore
needs its own explicit aria-label -- a named role="group" does not give it one,
and an unlabeled form control is an axe-critical failure. Mutation-proved.
EOF
```

---

## Task 8: The Time tracking dialog

**Files:**
- Create: `src/app/task-time-tracking-modal.tsx`
- Test: `src/app/task-time-tracking-modal.test.tsx`

- [ ] **Step 1: Read the dismissal contract BEFORE writing this**

Run: `grep -n "dismissal" -A 60 docs/AGENTS/ui-shell.md | head -120`

You are looking for the Escape/Tab protocol and `isTopmostOfKind`. Read it in full. `Modal`
(`src/app/modal.tsx:92`) already pushes and pops the shared dismissal stack keyed on `[open]` alone,
so a nested modal opened later IS topmost by construction — but the reason that works is documented
there, and a change that re-orders the stack breaks it silently.

★ `TaskFormModal` uses the default `zIndex={40}`. This dialog must sit above it; use `zIndex={50}`,
matching `edit-modal-chrome.tsx` and `project-edit-modal.tsx`. `ConfirmDialog` uses 60 and must stay
above both.

- [ ] **Step 2: Write the failing tests**

Create `src/app/task-time-tracking-modal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TaskTimeTrackingModal } from "./task-time-tracking-modal";

const base = { open: true, lang: "en-US" as const, estimateMinutes: 480, spentMinutes: 120, remainingMinutes: undefined };

describe("TaskTimeTrackingModal", () => {
  test("shows the derived remaining figure as a placeholder when nothing is pinned", () => {
    render(<TaskTimeTrackingModal {...base} onSave={vi.fn()} onClose={vi.fn()} />);
    // 480 - 120 = 360 minutes = "6h"
    expect(screen.getByRole("textbox", { name: /time remaining/i })).toHaveAttribute("placeholder", "6h");
  });

  test("shows a pinned remaining value as the field's value, not its placeholder", () => {
    render(<TaskTimeTrackingModal {...base} remainingMinutes={90} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /time remaining/i })).toHaveValue("1h 30m");
  });

  test("saving an emptied remaining box stores undefined, never zero", async () => {
    // ★★ THE RULE THAT DEFINES THE OVERRIDE. A stored 0 is the real claim
    // "no work left"; undefined is "not overridden". Conflating them makes
    // clearing the box silently assert the task is finished.
    const onSave = vi.fn();
    render(<TaskTimeTrackingModal {...base} remainingMinutes={90} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.clear(screen.getByRole("textbox", { name: /time remaining/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith({ spentMinutes: 120, remainingMinutes: undefined });
  });

  test("cancel discards edits", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TaskTimeTrackingModal {...base} onSave={onSave} onClose={onClose} />);
    await userEvent.clear(screen.getByRole("textbox", { name: /time spent/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /time spent/i }), "3h");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("states plainly that there is no original estimate rather than printing an empty one", () => {
    render(<TaskTimeTrackingModal {...base} estimateMinutes={undefined} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/no original estimate/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/app/task-time-tracking-modal.test.tsx --maxWorkers=2 > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log`
Expected: non-zero exit; module not found.

- [ ] **Step 4: Implement**

Create `src/app/task-time-tracking-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "./button";
import { derivedRemaining, effortProgress, formatDuration } from "./duration";
import { EffortField } from "./effort-field";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProgressTrack } from "./progress-track";

export interface TimeTrackingValues {
  spentMinutes: number | undefined;
  remainingMinutes: number | undefined;
}

/** Jira-style time tracking, stacked over the task form.
 *
 *  ★ Save writes to the caller's FORM STATE, never to storage: the task may be
 *  unsaved and have no id yet, so this dialog cannot persist independently.
 *  Values reach the workspace on the task form's own Save.
 *
 *  ★ zIndex 50 sits above TaskFormModal's default 40 and below ConfirmDialog's
 *  60. `Modal` owns dismissal-stack membership keyed on [open] alone, so this
 *  dialog is topmost while it is open and Escape reaches it first. */
export function TaskTimeTrackingModal({
  open,
  lang,
  estimateMinutes,
  spentMinutes,
  remainingMinutes,
  onSave,
  onClose,
}: {
  open: boolean;
  lang: Lang;
  estimateMinutes: number | undefined;
  spentMinutes: number | undefined;
  remainingMinutes: number | undefined;
  onSave: (values: TimeTrackingValues) => void;
  onClose: () => void;
}) {
  const [spent, setSpent] = useState<number | undefined>(spentMinutes);
  const [remaining, setRemaining] = useState<number | undefined>(remainingMinutes);

  const { hasEstimate, pct, over } = effortProgress(estimateMinutes, spent);
  const fillPct = Math.min(pct, 1) * 100;

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t(lang, "taskTimeTracking")}
      align="center"
      zIndex={50}
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-0 shadow-lg">
        <ModalHeader lang={lang} title={t(lang, "taskTimeTracking")} onClose={onClose} />

        <div className="space-y-4 p-4">
          <div>
            <ProgressTrack height="h-2.5" aria-hidden="true">
              {hasEstimate && (
                <div
                  className={`h-full rounded-full transition-all ${over ? "bg-ui-pink" : "bg-ui-dark-blue"}`}
                  style={{ width: `${fillPct}%` }}
                />
              )}
            </ProgressTrack>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "taskTimeTrackingLogged", formatDuration(spent ?? 0) || "0m")}
            </p>
          </div>

          <p className="text-sm text-foreground">
            {hasEstimate
              ? t(lang, "taskTimeTrackingOriginal", formatDuration(estimateMinutes ?? 0))
              : t(lang, "taskTimeTrackingOriginalNone")}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EffortField
              lang={lang}
              label={t(lang, "taskTimeSpent")}
              minutes={spent}
              onChange={setSpent}
            />
            <EffortField
              lang={lang}
              label={t(lang, "taskTimeRemaining")}
              captionHint={t(lang, "taskTimeRemainingHint")}
              minutes={remaining}
              // ★ The DERIVED figure as placeholder, so an unpinned box shows
              // what the app will use without claiming it as a stored value.
              placeholder={formatDuration(derivedRemaining(estimateMinutes, spent)) || "0m"}
              onChange={setRemaining}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <p>{t(lang, "taskTimeFormat")}</p>
            <ul className="ml-4 list-disc">
              <li>{t(lang, "taskTimeFormatWeeks")}</li>
              <li>{t(lang, "taskTimeFormatDays")}</li>
              <li>{t(lang, "taskTimeFormatHours")}</li>
              <li>{t(lang, "taskTimeFormatMinutes")}</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="primary"
              onClick={() => {
                onSave({ spentMinutes: spent, remainingMinutes: remaining });
                onClose();
              }}
            >
              {t(lang, "taskTimeTrackingSave")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t(lang, "cancel")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

★ `EffortField` seeds its text once via lazy `useState`, so this dialog must be **conditionally
mounted** by its parent (Task 9 does that) rather than kept mounted with `open={false}` — otherwise
reopening it shows the previous session's text.

★ Confirm `ProgressTrack` accepts `aria-hidden` and children as used here:
`grep -n "export function ProgressTrack" -A 20 src/app/progress-track.tsx`. If its props differ,
match the real signature rather than this sketch, and keep the `aria-hidden`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/app/task-time-tracking-modal.test.tsx --maxWorkers=2 > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log`
Expected: `EXIT=0`, five tests.

- [ ] **Step 6: Mutation-prove the undefined-not-zero rule**

Change the save handler to `remainingMinutes: remaining ?? 0` and re-run. Expected: the
"stores undefined, never zero" test fails and the other four pass — `1 failed / 4 passed`, summing to
5. Restore by inverse anchored write, finishing on an empty `git diff --stat`.

- [ ] **Step 7: Typecheck, lint, size**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Run: `npx eslint --max-warnings=0 src/app/task-time-tracking-modal.tsx src/app/task-time-tracking-modal.test.tsx; echo "EXIT=$?"`
Expected: `EXIT=0` for both.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/task-time-tracking-modal.tsx src/app/task-time-tracking-modal.test.tsx -F - <<'EOF'
feat(tasks): add the Jira-style Time tracking dialog

Stacks over the task form at zIndex 50 (above TaskFormModal's 40, below
ConfirmDialog's 60). Modal owns dismissal-stack membership keyed on [open]
alone, so this dialog is topmost while open.

Save writes to the caller's form state, not storage -- the task may have no id
yet. An unpinned remaining box shows the DERIVED figure as its placeholder, and
clearing it stores undefined rather than 0, which is mutation-proved: a stored
zero is the different and real claim "no work left".
EOF
```

---

## Task 9: The tracking button, replacing the display-only bar

**Files:**
- Create: `src/app/task-time-tracking-button.tsx`
- Modify: `src/app/effort-progress-bar.tsx`
- Test: `src/app/task-time-tracking-button.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/app/task-time-tracking-button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TaskTimeTrackingButton } from "./task-time-tracking-button";

const base = { lang: "en-US" as const, estimateMinutes: 480, spentMinutes: 120, remainingMinutes: undefined, onChange: vi.fn() };

describe("TaskTimeTrackingButton", () => {
  test("names itself with the figures, so the state is available without opening the dialog", () => {
    render(<TaskTimeTrackingButton {...base} />);
    // ★ WCAG 2.5.3 is CONTAINMENT, case-insensitive and position-independent --
    // not prefix. The visible text must appear somewhere in the name.
    // ★★ formatDuration uses a JIRA WORKING-TIME basis: 8h = 1 day, 5d = 1 week.
    // So 120 minutes is "2h" and 480 minutes is "1d", NOT "8h". Getting this
    // wrong makes the test fail against a correct implementation.
    const btn = screen.getByRole("button", { name: /time tracking/i });
    expect(btn).toHaveAccessibleName(expect.stringContaining("2h"));
    expect(btn).toHaveAccessibleName(expect.stringContaining("1d"));
  });

  test("is still operable with no estimate, because time can be logged against an unestimated task", async () => {
    render(<TaskTimeTrackingButton {...base} estimateMinutes={undefined} />);
    const btn = screen.getByRole("button", { name: /time tracking/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /time tracking/i })).toBeInTheDocument();
  });

  test("opens the dialog and reports saved values to its caller", async () => {
    const onChange = vi.fn();
    render(<TaskTimeTrackingButton {...base} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /time tracking/i }));
    await userEvent.clear(screen.getByRole("textbox", { name: /time spent/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /time spent/i }), "3h");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onChange).toHaveBeenCalledWith({ spentMinutes: 180, remainingMinutes: undefined });
  });

  test("does not expose a progressbar role, because the track is decorative here", () => {
    render(<TaskTimeTrackingButton {...base} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/task-time-tracking-button.test.tsx --maxWorkers=2 > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9.log`
Expected: non-zero exit; module not found.

- [ ] **Step 3: Make the bar decorative**

In `src/app/effort-progress-bar.tsx`, Edit the `ProgressTrack` to drop the progressbar semantics —
the wrapping button now carries the meaning:

```tsx
      <ProgressTrack
        height="h-2.5"
        aria-hidden="true"
        className={hasEstimate ? undefined : "opacity-60"}
      >
```

Delete the `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` and `aria-valuenow`
props.

**Also change the component's wrapper `<div className="sm:col-span-2">` to `<div>`.** Inside the
button that class is wrong — the button now owns the cell, and a grid-span class on a non-grid child
does nothing here but will silently mislead the next reader. `labelPct` becomes unused once
`aria-valuenow` is gone unless the caption still prints it; keep the caption's use and delete the
variable only if it is genuinely dead (`--max-warnings=0` makes an unused local fatal).

Add above the component:

```tsx
/** ★ The track is DECORATIVE. This component has exactly one call site (the
 *  task form's Time tracking button), and that button carries the accessible
 *  name and the figures. A progressbar nested inside a button announces twice.
 *  ★ `settings-sections/ai-usage-panel.tsx` renders its OWN progressbar; this
 *  change does not touch it. */
```

★ `effort-progress-bar.test.tsx` asserts the progressbar role today. Update those assertions to the
new contract in this same commit — the role is gone deliberately, and leaving a stale test red is not
an option.

- [ ] **Step 4: Implement the button**

Create `src/app/task-time-tracking-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { effortProgress, formatDuration } from "./duration";
import { EffortProgressBar } from "./effort-progress-bar";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { TaskTimeTrackingModal, type TimeTrackingValues } from "./task-time-tracking-modal";

/** The task form's Time tracking cell: a button showing the bar and the
 *  figures, opening the dialog.
 *
 *  ★ The dialog is CONDITIONALLY MOUNTED, not kept mounted with open={false} --
 *  EffortField seeds its text once via lazy useState, so a retained instance
 *  would reopen showing the previous session's text. */
export function TaskTimeTrackingButton({
  lang,
  estimateMinutes,
  spentMinutes,
  remainingMinutes,
  onChange,
}: {
  lang: Lang;
  estimateMinutes: number | undefined;
  spentMinutes: number | undefined;
  remainingMinutes: number | undefined;
  onChange: (values: TimeTrackingValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const { hasEstimate } = effortProgress(estimateMinutes, spentMinutes);
  const spentText = formatDuration(spentMinutes ?? 0) || "0m";

  // ★ WCAG 2.5.3: the name CONTAINS the visible text (the figures the bar's
  // caption prints), so a speech-input user can say what they see.
  const name = hasEstimate
    ? t(lang, "taskTimeTrackingButton", spentText, formatDuration(estimateMinutes ?? 0))
    : t(lang, "taskTimeTrackingButtonNoEstimate", spentText);

  return (
    <div className="block">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "taskTimeTracking")}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={name}
        className={`w-full rounded-md border border-line p-2 text-left hover:bg-surface-muted ${INTERACTIVE}`}
      >
        <EffortProgressBar lang={lang} estimateMin={estimateMinutes} spentMin={spentMinutes} />
      </button>
      {open && (
        <TaskTimeTrackingModal
          open
          lang={lang}
          estimateMinutes={estimateMinutes}
          spentMinutes={spentMinutes}
          remainingMinutes={remainingMinutes}
          onSave={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

★ `EffortProgressBar` currently returns a `<div className="sm:col-span-2">`. Inside this button that
span class is wrong — remove it from `effort-progress-bar.tsx` in Step 3 and let the button own its
cell width.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/app/task-time-tracking-button.test.tsx src/app/effort-progress-bar.test.tsx --maxWorkers=2 > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9.log`
Expected: `EXIT=0`.

- [ ] **Step 6: Mutation-prove the containment**

Replace `aria-label={name}` with `aria-label={t(lang, "taskTimeTracking")}` and re-run. Expected: the
naming test fails on the missing figures (`1 failed / 3 passed`). Restore by inverse anchored write,
finishing on an empty `git diff --stat`.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/task-time-tracking-button.tsx src/app/task-time-tracking-button.test.tsx src/app/effort-progress-bar.tsx src/app/effort-progress-bar.test.tsx -F - <<'EOF'
feat(tasks): make the effort progress bar a Time tracking button

The whole widget becomes one button whose accessible name CONTAINS the visible
figures (WCAG 2.5.3 is containment, not prefix -- mutation-proved). The track
inside goes aria-hidden: a progressbar nested in a button announces twice, and
this component has exactly one call site. ai-usage-panel keeps its own
progressbar, untouched.

Still operable with no estimate -- time can be logged against an unestimated
task. The dialog is conditionally mounted so EffortField's once-seeded text
cannot leak between sessions.
EOF
```

---

## Task 10: Effort & Classification rows

**Files:**
- Modify: `src/app/task-form-fields.tsx` (the section currently at `index={3}`, ~397-455)

- [ ] **Step 1: Write the failing test**

```tsx
it("replaces the standalone Time spent field with the tracking button", async () => {
  render(<Harness />, { wrapper: TestProviders });
  await selectFieldTier("en-US", "fieldViewFull");
  expect(screen.getByRole("button", { name: /time tracking/i })).toBeInTheDocument();
  // The standalone Time spent input is GONE -- spent is edited only in the dialog.
  expect(screen.queryByRole("textbox", { name: t("en-US", "taskTimeSpent") })).not.toBeInTheDocument();
});
```

★ `selectFieldTier`'s exact signature is in `src/test/field-tier.ts` — read it and call it as the
nine sibling modal tests already do, rather than as written here.
★ A testing-library string `name` is a WHOLE-STRING match, so `t("en-US", "taskTimeSpent")` will not
accidentally match the dialog's own field. This test never opens the dialog, but the next task's
does.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log`
Expected: non-zero exit — the standalone Time spent field still renders.

- [ ] **Step 3: Rewrite the section body**

In `src/app/task-form-fields.tsx`, replace the contents of the Effort section so the field order is
estimate, tracking, then group, then labels — Budget bucket is inserted between them in Task 11:

```tsx
        {isVisible("estimate") && (
          <EffortField
            key={`estimate-${editingId ?? "new"}`}
            lang={lang}
            label={t(lang, "taskOriginalEstimate")}
            minutes={form.originalEstimateMinutes}
            onChange={(minutes) =>
              setForm((prev) => ({ ...prev, originalEstimateMinutes: minutes }))
            }
          />
        )}

        {isVisible("timeSpent") && (
          <TaskTimeTrackingButton
            lang={lang}
            estimateMinutes={form.originalEstimateMinutes}
            spentMinutes={form.timeSpentMinutes}
            remainingMinutes={form.remainingEstimateMinutes}
            onChange={({ spentMinutes, remainingMinutes }) =>
              setForm((prev) => ({
                ...prev,
                timeSpentMinutes: spentMinutes,
                remainingEstimateMinutes: remainingMinutes,
              }))
            }
          />
        )}

        <Field label={t(lang, "group")} hint={t(lang, "taskHintGroup")}>
          <ComboInput
            lang={lang}
            value={form.group}
            suggestions={uniqueGroups}
            onChange={(group) => setForm({ ...form, group })}
            onBlur={(e) =>
              setForm((prev) => ({ ...prev, group: describeTextCap(e.target.value, GROUP_MAX).value.trim() }))
            }
            aria-describedby="group-counter"
            placeholder={t(lang, "placeholderGroup")}
          />
          <CharCounter value={form.group} max={GROUP_MAX} id="group-counter" lang={lang} />
        </Field>

        {isVisible("labels") && (
          <Field label={t(lang, "labels")} group>
            <LabelsInput
              lang={lang}
              value={form.labels}
              suggestions={uniqueLabels}
              onChange={(labels) => setForm({ ...form, labels })}
            />
          </Field>
        )}
```

The old `{isVisible("timeSpent") && (<> <EffortField …spent…/> <EffortProgressBar …/> </>)}` fragment
is deleted entirely. Replace the `EffortProgressBar` import with:

```ts
import { TaskTimeTrackingButton } from "./task-time-tracking-button";
```

★ Group moved from FIRST in the section to third. That is the reordering item; do not leave a second
copy behind.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Run: `npx eslint --max-warnings=0 src/app/task-form-fields.tsx; echo "EXIT=$?"`
Expected: `EXIT=0` for both. A now-unused `EffortProgressBar` import is fatal here.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx -F - <<'EOF'
feat(tasks): pair estimate with time tracking, and group with labels

The standalone Time spent field is deleted -- spent is edited only through the
Time tracking dialog, which also carries the pinned remaining value.
EOF
```

---

## Task 11: Move Budget bucket, and pair the dependency pickers

Done as ONE task so neither section is ever in a broken intermediate state.

**Files:**
- Modify: `src/app/task-form-fields.tsx` (the Relationships section, ~458-536, and the Effort section)

- [ ] **Step 1: Write the failing test**

```tsx
it("renders budget bucket between the tracking button and the group field", async () => {
  render(
    <Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange: vi.fn() }} />,
    { wrapper: TestProviders },
  );
  await selectFieldTier("en-US", "fieldViewFull");
  const tracking = screen.getByRole("button", { name: /time tracking/i });
  const bucket = screen.getByRole("combobox", { name: t("en-US", "taskBudgetBucket") });
  const group = screen.getByRole("textbox", { name: t("en-US", "group") });
  expect(tracking.compareDocumentPosition(bucket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(bucket.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

★ DOM order is what this asserts, and it is the only thing jsdom can see — the *visual* row placement
is Task 16's job. Say so in the test's own comment so a later reader does not mistake a green run for
proof the layout is right.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t11.log`
Expected: non-zero exit — the bucket is still in Relationships, after the group field.

- [ ] **Step 3: Cut the Budget bucket block out of Relationships**

Delete this whole block from the Relationships section (currently ~521-535):

```tsx
        {budgetLink !== undefined && isVisible("budgetBucket") && (
        <Field label={t(lang, "taskBudgetBucket")}>
          …
        </Field>
        )}
```

- [ ] **Step 4: Paste it into the Effort section between the two rows**

Insert it in the Effort section between the `TaskTimeTrackingButton` block and the `group` `Field`,
unchanged except for the added comment:

```tsx
        {/* ★ Half width in the left column, matching every other select in this
            modal; the right cell stays empty. A full-width select for short
            bucket names would read as more important than the estimate row. */}
        {budgetLink !== undefined && isVisible("budgetBucket") && (
        <Field label={t(lang, "taskBudgetBucket")}>
          <Select
            value={budgetLink.bucketId === null ? "" : String(budgetLink.bucketId)}
            onChange={(e) => budgetLink.onChange(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full"
          >
            <option value="">{t(lang, "budgetBucketNone")}</option>
            {budgetLink.buckets.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        )}
```

- [ ] **Step 5: Fix the Relationships section's own render guard**

The section's guard currently reads:

```tsx
      {(isVisible("dependencies") || isVisible("blockers") || (budgetLink !== undefined && isVisible("budgetBucket"))) && (
```

Budget bucket no longer lives there, so drop that disjunct:

```tsx
      {(isVisible("dependencies") || isVisible("blockers")) && (
```

★ Leaving it would render an EMPTY Relationships section for a user who has dependencies and blockers
hidden but budget bucket shown.

- [ ] **Step 6: Make the dependency pickers half width**

On BOTH the `depPredecessors` and `depSuccessors` `Field`s, change
`className="sm:col-span-2" group` to `group`:

```tsx
        <Field label={t(lang, "depPredecessors")} hint={t(lang, "taskHintDependencies")} group>
```
```tsx
        <Field label={t(lang, "depSuccessors")} hint={t(lang, "taskHintSuccessors")} group>
```

★★ `group` STAYS on both. Their first labelable descendant is a chip's remove ✕, so the default
`<label>` branch would bind the caption to it and clicking "Predecessors" would delete a link. Only
the col-span changes.
★ The shared `depHelp` `<p>` KEEPS `sm:col-span-2` — it is a legend under both columns.

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t11.log`
Expected: `EXIT=0`.

- [ ] **Step 8: Prove the dependency captions still do not delete a link**

Add:

```tsx
it("does not remove a dependency chip when the predecessors caption is clicked", async () => {
  // ★ The chip's remove x is the Field's first LABELABLE descendant, so the
  // default <label> branch would bind the caption to it. `group` is what
  // prevents that, and this test is the only thing that says so.
  render(<Harness />, { wrapper: TestProviders });
  await selectFieldTier("en-US", "fieldViewFull");
  const before = screen.queryAllByRole("button", { name: /remove/i }).length;
  await userEvent.click(screen.getByText(t("en-US", "depPredecessors")));
  expect(screen.queryAllByRole("button", { name: /remove/i })).toHaveLength(before);
});
```

★ `Harness` passes `tasksForDeps={[]}`, so there is no chip to remove and `before` is 0 — which makes
this test VACUOUS as written. Give the harness a task to depend on (extend `Harness` with a
`tasksForDeps` override the way it already takes `budgetLink`) and seed one dependency, so `before`
is at least 1. Verify that by asserting `expect(before).toBeGreaterThan(0)` before the click; without
it the mutation proof in the next step cannot go red.

Mutation-prove it by removing `group` from that Field: expected `1 failed`, the rest passing.
Restore by inverse anchored write, finishing on an empty `git diff --stat`.

- [ ] **Step 9: Commit**

```bash
git commit --only src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx -F - <<'EOF'
feat(tasks): move budget bucket into the effort section and pair the dep pickers

Budget bucket sits half width between the estimate row and the group/labels
row. The Relationships section's render guard drops its budgetBucket disjunct,
which would otherwise render an empty section for a user with dependencies and
blockers hidden.

Predecessors and successors take one grid cell each. Both KEEP `group`: their
first labelable descendant is a chip's remove x, so the default label branch
would make clicking the caption delete a link. Mutation-proved.
EOF
```

---

## Task 12: Section reorder and renumbering

**Files:**
- Modify: `src/app/task-form-fields.tsx` (the five `TaskFormSection` blocks)

- [ ] **Step 1: Write the failing test**

```tsx
it("renders the five sections in the reworked order", async () => {
  render(<Harness />, { wrapper: TestProviders });
  await selectFieldTier("en-US", "fieldViewFull");
  const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual([
    "1. Details",
    "2. Scheduling",
    "3. Status & Notes",
    "4. Effort & Classification",
    "5. Relationships",
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t12.log`
Expected: non-zero exit, showing the current order with Status & Notes last.

- [ ] **Step 3: Move the Status & Notes block and renumber**

Move the entire `<TaskFormSection index={5} title={t(lang, "taskFormSectionStatus")}>` … `</TaskFormSection>`
block so it sits immediately after the Scheduling section and before Effort & Classification. Then set
the `index` literals to:

| Section | `index` |
|---|---|
| `taskFormSectionDetails` | `1` |
| `taskFormSectionScheduling` | `2` |
| `taskFormSectionStatus` | `3` |
| `taskFormSectionEffort` | `4` |
| `taskFormSectionRelationships` | `5` |

★ Move the whole block including any `{cond && (` wrapper around it. Do not renumber first and move
second — a half-applied state has two sections claiming the same number and the test cannot tell you
which.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/task-form-fields.test.tsx --maxWorkers=2 > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t12.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Confirm nothing else keyed off the old order**

Run: `grep -rn "taskFormSection" src e2e --include=*.ts --include=*.tsx | grep -v "^src/app/i18n"`
Expected: five `TaskFormSection` lines in `task-form-fields.tsx`, plus your new test. Nothing in
`e2e/`, help content or the tour.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx -F - <<'EOF'
feat(tasks): move Status & Notes to third and renumber the sections

Order is now Details / Scheduling / Status & Notes / Effort & Classification /
Relationships. Section numbers are rendered from the index prop and are
referenced nowhere else -- not in e2e, help content or the tour.
EOF
```

---

## Task 13: `modal-fields` tier and label

**Files:**
- Modify: `src/app/modal-fields.ts` (line 42)
- Test: `src/app/modal-fields.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
test("time tracking is an advanced-tier field, so the estimate row is never half empty", () => {
  const task = MODAL_FIELDS.task;
  const estimate = task.find((f) => f.id === "estimate");
  const tracking = task.find((f) => f.id === "timeSpent");
  expect(tracking?.tier).toBe(estimate?.tier);
});

test("keeps the persisted id 'timeSpent'", () => {
  // ★★ The id IS the key under which each user's cog-checklist choice is
  // stored. Renaming it silently resets the preference for everyone who set it.
  expect(MODAL_FIELDS.task.some((f) => f.id === "timeSpent")).toBe(true);
  expect(MODAL_FIELDS.task.some((f) => f.id === "timeTracking")).toBe(false);
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `npx vitest run src/app/modal-fields.test.ts --maxWorkers=2 > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t13.log`
Expected: non-zero exit — `"full"` !== `"advanced"`. The second test already passes; it is a
regression pin.

- [ ] **Step 3: Implement**

`src/app/modal-fields.ts` line 42 — change the label key and the tier, keeping the id:

```ts
    { id: "timeSpent", labelKey: "taskTimeTracking", tier: "advanced" },
```

Move the line up beside the `estimate` entry so the registry reads in render order.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/app/modal-fields.test.ts --maxWorkers=2 > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t13.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/modal-fields.ts src/app/modal-fields.test.ts -F - <<'EOF'
feat(tasks): pair the time-tracking field with the estimate tier

Moves it full -> advanced so an advanced-tier user never sees an estimate with
an empty cell beside it. The id stays "timeSpent" and only the labelKey
changes: the id is the persisted cog-checklist key, so renaming it would
silently reset every user's saved preference.
EOF
```

---

## Task 14: Sweep the prose a third effort field falsifies

**Files:**
- Modify: `src/app/sanitize-core.ts` (~159), `src/app/snapshot.ts` (~249),
  `docs/superpowers/specs/2026-09-05-edit-task-modal-rework-design.md`

- [ ] **Step 1: Find every comment naming the effort fields as a pair**

Run: `grep -rn "originalEstimateMinutes" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`

Read each hit. The two that are PROSE rather than code are `sanitize-core.ts:159` and
`snapshot.ts:249`; both describe the two effort fields as a pair, which a third field falsifies.
`ai-entity-token.ts` also comments on the byte-pinned TASKS header — read it and confirm it is still
true (adding a column is the safe direction there; removing one is not).

- [ ] **Step 2: Correct both comments**

Edit each to name three fields instead of two, or to stop enumerating them at all. Do not renumber a
line citation — re-verify the claim.

- [ ] **Step 3: Correct the spec's two overstatements**

In `docs/superpowers/specs/2026-09-05-edit-task-modal-rework-design.md`, replace the claim that the
column "rides all six write paths" with what is actually true: CSV and Markdown are hand-written,
Turso derives from `CSV_COLUMNS`, and JSON/IndexedDB need no change because `migrateTask` is a
passthrough. Add a line recording that regeneration needs jsdom and has no script.

★ A correction is a NEW claim and inherits none of the verification of the thing it corrects. Run a
command against the replacement text, not only against the error you found.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/sanitize-core.ts src/app/snapshot.ts docs/superpowers/specs/2026-09-05-edit-task-modal-rework-design.md -F - <<'EOF'
docs: sweep prose a third effort field falsifies

Two src comments described the effort fields as a pair. The spec claimed the
new column rides all six write paths; it does not -- migrateTask is a
passthrough, so JSON and IndexedDB need no code, and Turso derives from
CSV_COLUMNS. Also records that the golden fixtures have no regeneration script
and that regeneration needs jsdom.
EOF
```

---

## Task 15: Full gate run

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: `EXIT=0`. (Exits **2** on diagnostics.)

- [ ] **Step 2: Lint the whole source tree at CI strictness**

Run: `npx eslint --max-warnings=0 src scripts e2e; echo "EXIT=$?"`
Expected: `EXIT=0`. Do NOT use `npm run lint` — it exits 1 from gitignored `.worktrees/` and
`.demo-tmp/` leftovers.

- [ ] **Step 3: Predict the suite total, THEN run it**

Write down the expected test-file and test counts before running — this converts "whatever appeared"
into a falsifiable claim.

Run: `npm run test:run > /tmp/full.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full.log`
Expected: `EXIT=0`, and counts matching your prediction. If `Test Files no tests` appears at exit 1,
that is worker contention, not a broken suite — re-run with `npx vitest run --maxWorkers=2`.

- [ ] **Step 4: Shuffled run — new tests were added, so this gate is live**

Run: `npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log`
Expected: `EXIT=0`, agreeing with Step 3 on BOTH counts.

★ Never run this concurrently with Step 3.

- [ ] **Step 5: Size ratchet**

Run: `npm run size:check; echo "EXIT=$?"`
Expected: `EXIT=0`. LIMIT is 1600 and the script counts `split("\n").length`, i.e. `wc -l` **+ 1**.
NEVER run it with `--update`.

- [ ] **Step 6: Confirm every touched source file is still CRLF**

Run: `git ls-files --eol src/app/i18n.de.ts src/app/task-form-fields.tsx src/app/task-form-layout.tsx src/app/types.ts`
Expected: `i/lf w/crlf` on each. `i/lf w/lf` means something re-lined a file.

- [ ] **Step 7: Confirm nothing unintended is staged or dirty**

Run: `git status --short`
Expected: only `M sample-workspace-huge.json` and `?? not-in-use.env.local.bak`, both of which stay
untouched and unstaged.

---

## Task 16: Eye-verify — a gate, not a nicety

jsdom has no layout, so **nothing in the unit suite can see any of this**. It is owed before the
slice ships.

- [ ] **Step 1: Start a clean dev server**

Run: `PORT=3100 npm run dev`
(Stop it afterwards with `PORT=3100 npm run stop`. Do NOT disturb anything on port 3000 — the user
may have a live-data tab open there.)

- [ ] **Step 2: Verify the layout by eye**

Open a task for editing at the **full** field tier and confirm:

1. Sections read `1. Details`, `2. Scheduling`, `3. Status & Notes`, `4. Effort & Classification`,
   `5. Relationships`.
2. The dictation mic sits at the trailing edge of the **Task name** caption, and clicking the words
   "Task name" focuses the input rather than starting dictation.
3. Original estimate and the Time tracking button share a row, each half width.
4. Budget bucket is half width in the left column with the right cell empty.
5. Group and Labels share the row beneath it.
6. Predecessors and Successors share one row, half each, with the legend spanning beneath.
7. The tracking button's hit area covers its whole cell, not just the bar.

- [ ] **Step 3: Verify the dialog**

1. Clicking the bar opens the dialog ABOVE the task form, not behind it.
2. **Escape closes the dialog only** — the task form stays open.
3. Tab cycles inside the dialog and does not reach the task form behind it.
4. Clearing Time remaining and saving leaves the box showing the derived placeholder, not `0m`.
5. With no original estimate, the dialog says so and both inputs still work.

- [ ] **Step 4: Cross-engine check of the dismissal ordering**

Run: `npm run e2e:crossengine; echo "EXIT=$?"`
Expected: `EXIT=0` in real Chromium AND real Firefox.

★★ This is the only layer that can see this class. Chromium dispatches `focusout` with
`relatedTarget === null` synchronously as a focused node is removed; Firefox and jsdom dispatch none.
Focus-restore logic reading containment in a passive effect cleanup is green across the entire unit
suite and dead in the browser we ship.

- [ ] **Step 5: Record the result**

If anything above fails, fix it and re-run the affected gates. If the eye-verify cannot be performed,
say so explicitly rather than shipping silently — an owed eye-verify that ships is the one nobody
comes back to.

---

## Follow-ups

Mint register numbers from **§383**. `§368-369` are ours but unused; `§370-382` are a peer's,
unlanded, and by our own rule not reserved — the gap is left deliberately, because renumbering into a
reused number means sweeping every citation.

File an entry for anything discovered and not fixed. Closure is a FOUR-place edit: heading marker,
summary-table STATUS cell, summary-table ANCHOR, and the `**Status:**` witness line. A body line must
never contain the word CLOSED.

★★ Do NOT run the register's own index-rebuild recipe — it claims idempotence and is not (§319).

## Known risk

The peer's unlanded branch edits `i18n.ts`, `i18n.de.ts` and `task-manager.tsx`, and is already at
`0.283.0 "Lessing"`. This slice adds keys to both dictionaries. **Adjudicate that merge per row, not
per file** — a resolution taking one side wholesale loses the other's keys and every gate stays green
afterwards. When this slice releases it is 0.284.0 with a codename that is not "Lessing".
