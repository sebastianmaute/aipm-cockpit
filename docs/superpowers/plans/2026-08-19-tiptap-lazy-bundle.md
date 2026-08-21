# Tiptap Lazy-Loading and the Entry Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether Tiptap actually rides the entry chunk, and move it off with a single shared `next/dynamic` wrapper only if the number justifies it.

**Architecture:** One new module, `src/app/rich-text-editor-lazy.tsx`, wraps `RichTextEditor` in `dynamic(… { ssr: false, loading })` with a `Skeleton` fallback. Six consumers change nothing but their import path. `rich-text-editor.tsx` itself is not touched. The decision to keep or revert the four bundle-relevant conversions is made from a `next build` delta, not from an argument.

**Tech Stack:** Next 16.2.11 App Router, React 19, `next/dynamic`, Tiptap 3.x (`@tiptap/react`), vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-tiptap-lazy-bundle-design.md`
**Follow-up:** `docs/open-followups.md` §129
**Branch:** `perf/tiptap-lazy-bundle`, already created off `d20ab9c1`.

---

## Orientation — read this before Task 1

You are converting static imports of a browser-only rich-text editor into one lazily-loaded module,
**to find out whether it is worth doing.** The measurement is the deliverable; the code change is
conditional on it.

**Five facts that were measured on `d20ab9c1`, not assumed. Do not re-derive them, but do not trust
them blindly either — each carries its reproduce command.**

1. **Only four of the eight consumers are reachable from the entry graph.** `change-edit-modal.tsx`
   and `raid-edit-modal.tsx` sit behind `ChangePanel` / `RaidPanel`, which are already `dynamic()` in
   `src/app/workspace-panels.tsx`. **Leave those two on static imports** — converting them is churn.
   ```bash
   grep -n "dynamic(" src/app/workspace-panels.tsx | grep -E "ChangePanel|RaidPanel"
   ```

2. **There is no `React.lazy` anywhere in this repo.** Every lazy boundary is `next/dynamic`. Do not
   introduce `React.lazy` for consistency's sake — it has no precedent here.
   ```bash
   grep -rn "lazy(" src/app --include=*.tsx --include=*.ts | grep -v '\.test\.'   # empty
   ```

3. **The editor handle is a PLAIN PROP, not React `ref` forwarding.** `rich-text-editor.tsx` declares
   `editorRef?: Ref<RichTextEditorHandle>` and feeds it through `useImperativeHandle`. This matters
   enormously: `next/dynamic` does **not** forward `ref`, so a handle passed as `ref` would break
   silently. It is passed as `editorRef`, an ordinary prop, so it passes through the wrapper untouched.
   ```bash
   grep -n "editorRef?:" src/app/rich-text-editor.tsx
   grep -n "editorRef=" src/app/note-log-panel.tsx     # the only consumer that uses it
   ```

4. **`src/app/**/*.tsx` is excluded from the coverage gate** (`vitest.config.ts` `coverage.exclude`),
   so the new wrapper raises no coverage floor. A new `.ts` file would have.

5. **Three of the four target suites already `await screen.findByRole(...)` for the editor.** The
   editor is already async in jsdom because `immediatelyRender: false` defers Editor construction to
   mount. Only `task-form-fields.test.tsx` asserts it synchronously. This corrects the spec's
   pessimistic guess — the spec explicitly said to re-measure this table, and this is that measurement.

**Standing repo rules that will bite you here:**

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports `tail`'s status.
  Redirect to a file, echo `$?` unpiped, then grep the file.
- **`npm run lint` does NOT reproduce CI.** It is bare `eslint` with no `--max-warnings`, so it exits 0
  with warnings present. The real gate is `npx eslint --max-warnings=0 src/app`. An unused import is
  **fatal** there — this plan removes two `import dynamic from "next/dynamic"` lines for exactly that
  reason.
- **`rm -rf` is blocked.** Use PowerShell `Remove-Item -Recurse -Force`.
- **Never run two vitest processes at once.**
- **Commit with a Bash heredoc**, not a PowerShell here-string.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/rich-text-editor-lazy.tsx` | **create** | The single `dynamic()` boundary + the shimmer fallback. Re-exports the handle type so consumers need one import. |
| `src/app/rich-text-editor-lazy.test.tsx` | **create** | Pins the fallback's two design properties: it shimmers, and it is decorative. |
| `src/app/meeting-report-panel.tsx` | modify | Drop its hand-rolled `dynamic()` block + the now-unused `dynamic` import + a stale comment. |
| `src/app/settings-sections/comm-templates-section.tsx` | modify | Same. |
| `src/app/task-form-fields.tsx` | modify | Import path only (line 15). |
| `src/app/note-log-panel.tsx` | modify | Import path only (line 21) — value **and** type. |
| `src/app/dashboard-sections/dashboard-narrative.tsx` | modify | Import path only (line 9). |
| `src/app/milestone-edit-modal.tsx` | modify | Import path only (line 11). |
| `src/app/task-form-fields.test.tsx` | modify | One assertion goes async (line ~180). |
| `docs/open-followups.md` | modify | §129 gets the measurement and its verdict. |
| `docs/superpowers/plans/2026-08-19-tiptap-bundle-baseline.txt` | create (gitignored) | Captured build output, before and after. |

`rich-text-editor.tsx` is **not** in this table. It is not modified by any task.

---

## Task 1: Capture the baseline build

No code changes. This task produces the number everything else is judged against.

**Files:**
- Create: `docs/superpowers/plans/2026-08-19-tiptap-bundle-baseline.txt` (inside the gitignored
  `/docs/superpowers/` tree — it will not appear in `git status`, which is intended)

- [ ] **Step 1: Confirm you are on the right commit with a clean tree**

```bash
git rev-parse --short HEAD          # expect d20ab9c1
git branch --show-current           # expect perf/tiptap-lazy-bundle
git status --porcelain -uall        # expect NO output
```

If `git status` prints anything, stop and report it. A dirty tree makes the measurement meaningless.

- [ ] **Step 2: Remove the build cache so the baseline is cold**

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
```

Run this through the **PowerShell** tool, not Bash. `rm -rf` is blocked by a security gate in this
environment.

- [ ] **Step 3: Build and capture the output unpiped**

```bash
npm run build > docs/superpowers/plans/2026-08-19-tiptap-bundle-baseline.txt 2>&1
echo "EXIT=$?"
```

Expected: `EXIT=0`. If it is anything else, read the captured file — do not retry blindly.

**Do not add `| tail` or `| grep` to that command.** You would get the pipe's exit status, not the
build's, and this repo has already shipped a "green" claim that way.

- [ ] **Step 4: Measure the eager entry graph** — REVISED 2026-08-19, MEASURED

★★★ **THE ORIGINAL STEP HERE WAS INVALID AND THE BUILD DISPROVED IT.** This step used to say
"read the `First Load JS` table out of the captured build output". **That table does not exist on this
app.** Every route prints `ƒ` (dynamic, server-rendered on demand); Next 16.2.11 + Turbopack emits a
First-Load-JS size table only for statically generated routes, and this app has none. The captured
build log is 44 lines and contains ZERO occurrences of `kB`, `First Load`, `shared by all` or
`chunks/`. Reproduce:

```bash
grep -cE "kB|First Load|shared by all|chunks/" docs/superpowers/plans/2026-08-19-tiptap-bundle-baseline.txt   # 0
```

The replacement measures the thing the original was a proxy for, and measures it exactly.
`.next/server/app/page_client-reference-manifest.js` maps every client module to the chunk set needed
to load it. `task-manager.tsx` is the root client component of `/`, so **its chunk list IS the eager
entry graph**. A module moved behind `next/dynamic` gets its own `clientModules` entry and its chunks
DROP OUT of the parent's list — which is exactly the effect this slice is testing for, expressed as a
binary rather than a size guess.

```bash
node docs/superpowers/plans/measure-entry-graph.mjs
```

That script is written and verified. It prints every eager chunk with its size, the total, and — by
grepping each chunk for a `prosemirror-view` marker — whether ProseMirror is in the graph at all.

**Baseline, measured on `d20ab9c1`:**

```
EAGER_TOTAL_KB=2334.7  chunks=19
PROSEMIRROR_IN_ENTRY_GRAPH=true
PROSEMIRROR_KB=428.2        (chunk 0sf-ibxfx9_q_.js)
```

★ Sizes are uncompressed on-disk bytes, not gzip/brotli transfer size. That is fine for a delta
measured the same way twice, and it must be described that way in §129 — quoting 428 kB as what a user
downloads would be wrong by roughly a factor of three.

★★ **The chunk HASH will change between builds even when content does not**, so never compare chunk
NAMES across the two builds. Compare `PROSEMIRROR_IN_ENTRY_GRAPH`, `EAGER_TOTAL_KB`, and the chunk
COUNT. The binary is the primary signal; the total is the corroboration.

- [ ] **Step 5: Record the baseline in the task report**

Nothing to commit — the capture file is gitignored. Report the figures verbatim in your task summary
so the controller has them without reading the file.

---

## Task 2: Create the shared lazy wrapper and its test

This task is a **pure de-duplication with no bundle effect** — the two sites it touches are already
lazy. It is kept regardless of what Task 8 measures.

**Files:**
- Create: `src/app/rich-text-editor-lazy.tsx`
- Create: `src/app/rich-text-editor-lazy.test.tsx`

- [ ] **Step 1: Confirm the filename cannot be shadowed**

```bash
ls src/app/rich-text-editor-lazy.*
```

Expected: `ls: cannot access ... No such file or directory`.

A bare `./rich-text-editor-lazy` import resolves `.ts` **ahead of** `.tsx`. If a `.ts` file of that
name ever appears, it silently hijacks this component and breaks every consumer's tests. Confirming
absence now is what makes the `.tsx` name safe.

- [ ] **Step 2: Write the failing test**

Create `src/app/rich-text-editor-lazy.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RichTextEditorFallback } from "./rich-text-editor-lazy";

// The `dynamic()` boundary itself is not unit-testable in a useful way — vitest
// resolves the import in a microtask, so the fallback is never observed. What IS
// testable, and what the design actually decided, is the fallback component: it
// must shimmer like every other lazy surface in the app, and it must stay out of
// the accessibility tree (the surrounding form labels the field; a decorative
// placeholder announcing itself would be noise).
describe("RichTextEditorFallback", () => {
  it("shimmers, so a loading editor reads like a loading panel", () => {
    const { container } = render(<RichTextEditorFallback />);
    const el = container.firstElementChild;
    expect(el?.className).toContain("animate-pulse");
  });

  it("is decorative — hidden from assistive technology", () => {
    const { container } = render(<RichTextEditorFallback />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reserves the editor's height so the swap does not jump the layout", () => {
    const { container } = render(<RichTextEditorFallback />);
    expect(container.firstElementChild?.className).toContain("min-h-40");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/app/rich-text-editor-lazy.test.tsx --reporter=dot > /tmp/t2.log 2>&1
echo "EXIT=$?"
grep -E "Cannot find module|Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=1`, with a "Cannot find module './rich-text-editor-lazy'" style failure.

Note `--reporter=dot`. **`--reporter=basic` does not exist in vitest 4.1.8** and fails at startup in a
way that reads like a broken test run.

- [ ] **Step 4: Write the wrapper module**

Create `src/app/rich-text-editor-lazy.tsx`:

```tsx
"use client";
// The single `next/dynamic` boundary for the rich-text editor.
//
// Tiptap + ProseMirror is browser-only and large. Every consumer imports the
// editor THROUGH this module so that (a) there is one place that decides the
// loading fallback, and (b) the chunk boundary is visible in one file rather
// than re-derived per call site. Before this module the wrapper was hand-rolled
// verbatim in two consumers and statically imported by six more.
//
// ★ `ssr: false` changes WHERE the component renders, not where Tiptap injects
//   its stylesheet. `useEditor` runs with `immediatelyRender: false`, so
//   `injectCSS()` is deferred to mount under both import styles. This module is
//   therefore NOT a fix for the prod-only CSP defect (open-followups §54), and
//   it does not let `csp-nonce.ts`'s `typeof document` guard go away.
// ★ The editor's imperative handle is passed as the ORDINARY prop `editorRef`,
//   not React's `ref`. That is what makes this wrapper safe: `next/dynamic` does
//   not forward `ref`, so a handle wired the conventional way would break here
//   silently. Do not "tidy" `editorRef` into `ref`.
import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

/** Placeholder shown while the editor chunk loads. Exported so it can be tested
 *  directly — the `dynamic()` boundary resolves in a microtask under vitest, so
 *  the fallback is never observed through a rendered consumer. */
export function RichTextEditorFallback() {
  return <Skeleton className="min-h-40" />;
}

export const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false, loading: RichTextEditorFallback },
);

// Type-only re-export (erased at build time, so it pulls nothing into this
// module's runtime graph). Consumers that use the imperative handle — today only
// `note-log-panel.tsx` — take both names from here rather than importing the
// heavy module for a type.
export type { RichTextEditorHandle } from "./rich-text-editor";
```

`Skeleton` already applies `rounded-md`, `bg-surface-muted`, `animate-pulse` and `aria-hidden="true"` —
check `src/app/skeleton.tsx` if you doubt it. Do not re-add those classes here.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/app/rich-text-editor-lazy.test.tsx --reporter=dot > /tmp/t2.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=0`, `Tests  3 passed`.

- [ ] **Step 6: Prove the shimmer assertion is not vacuous**

Temporarily change `RichTextEditorFallback` to return a plain `<div aria-hidden="true" className="min-h-40" />`
(no `Skeleton`), re-run the suite, and confirm **exactly one** test goes red — the `animate-pulse` one.
Then restore the real implementation and confirm green again.

If nothing goes red, the assertion is reading a class that arrives from somewhere else and the test is
worthless. Report that rather than proceeding.

- [ ] **Step 7: Collapse `meeting-report-panel.tsx` onto the wrapper**

Three edits in `src/app/meeting-report-panel.tsx`:

1. Delete the whole block at lines 18–21:

```tsx
const RichTextEditor = dynamic(() => import("./rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
});
```

2. Delete line 8, `import dynamic from "next/dynamic";`, and add the wrapper import beside the other
   local imports:

```tsx
import { RichTextEditor } from "./rich-text-editor-lazy";
```

`dynamic` is used **nowhere else in this file** — verify with `grep -n "dynamic" src/app/meeting-report-panel.tsx`
after the edit, which must return only the header comment line you fix next. Leaving the import behind
is an unused import, which is **fatal** under `--max-warnings=0`.

3. Fix the now-stale header comment on line 5. It currently reads:

```
// and this renders inside a shared Modal (see steering-committee-panel). The rich
// editor loads via next/dynamic (Tiptap is browser-only). Save/send/generate/
```

Replace the middle sentence so it names where the boundary actually lives:

```
// and this renders inside a shared Modal (see steering-committee-panel). The rich
// editor comes from rich-text-editor-lazy (Tiptap is browser-only). Save/send/generate/
```

A comment naming a mechanism that has moved is the exact class of rot this repo's docs gate cannot see.

- [ ] **Step 8: Collapse `settings-sections/comm-templates-section.tsx` onto the wrapper**

Two edits in `src/app/settings-sections/comm-templates-section.tsx`:

1. Delete the block at lines 22–25:

```tsx
const RichTextEditor = dynamic(() => import("../rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
});
```

2. Delete line 20, `import dynamic from "next/dynamic";`, and add:

```tsx
import { RichTextEditor } from "../rich-text-editor-lazy";
```

Note the `../` — this file is one directory down. Verify `dynamic` is gone:
`grep -n "dynamic" src/app/settings-sections/comm-templates-section.tsx` must return nothing.

- [ ] **Step 9: Run both collapsed suites**

```bash
npx vitest run src/app/meeting-report-panel.test.tsx src/app/settings-sections/comm-templates-section.test.tsx --reporter=dot > /tmp/t2b.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t2b.log
```

Expected: `EXIT=0`, both files passing with the same test counts as before your change.

These two suites `vi.mock("./rich-text-editor")`. That mock still applies through the wrapper, because
vitest mocks by **resolved module id** and the wrapper's `import("./rich-text-editor")` resolves to the
same id. If they fail with a mock-not-applied symptom, that assumption is wrong and you should stop and
report it rather than mocking the wrapper as well.

- [ ] **Step 10: Run the lint gate as CI runs it**

```bash
npx eslint --max-warnings=0 src/app
echo "EXIT=$?"
```

Expected: `EXIT=0`. No pipe. `npm run lint` will **not** catch a leftover unused `dynamic` import.

- [ ] **Step 11: Typecheck**

```bash
npx tsc --noEmit
echo "EXIT=$?"
```

Expected: `EXIT=0`. This is the step that catches a `dynamic()`-wrapped component losing prop
inference. IDE squiggles mid-edit are unreliable here; trust `tsc`.

- [ ] **Step 12: Commit**

```bash
git add src/app/rich-text-editor-lazy.tsx src/app/rich-text-editor-lazy.test.tsx \
        src/app/meeting-report-panel.tsx src/app/settings-sections/comm-templates-section.tsx
git commit -F - <<'EOF'
refactor(rich-text): give the editor one lazy boundary instead of two copies

The `dynamic(… ssr:false)` wrapper was hand-rolled verbatim in the meeting
report pane and the comm-templates settings section, and six other consumers
imported the editor statically. This adds `rich-text-editor-lazy.tsx` as the
single boundary and moves the two existing sites onto it, so the fallback is
decided in one place.

The fallback becomes the shared `Skeleton` shimmer rather than a flat muted
box, matching how the 24 lazy view panels already load.

No bundle effect: both sites were already lazy. Whether the remaining static
consumers move here is a separate, measured question (open-followups §129).
EOF
```

---

## Task 3: Convert `task-form-fields.tsx`

This is the consumer with a **synchronous** editor assertion, so it is where the real test cost lands.
Do it first of the four.

**Files:**
- Modify: `src/app/task-form-fields.tsx:15`
- Modify: `src/app/task-form-fields.test.tsx` (the test at ~line 180)

- [ ] **Step 1: Establish the suite is green before you touch it**

```bash
npx vitest run src/app/task-form-fields.test.tsx --reporter=dot > /tmp/t3a.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t3a.log
```

Expected: `EXIT=0`. Write down the passing test count — you must end this task with the same number.

- [ ] **Step 2: Convert the import**

In `src/app/task-form-fields.tsx`, change line 15 from:

```tsx
import { RichTextEditor } from "./rich-text-editor";
```

to:

```tsx
import { RichTextEditor } from "./rich-text-editor-lazy";
```

That is the entire production change. The render site at line ~614 is untouched.

- [ ] **Step 3: Run the suite and observe the specific failure**

```bash
npx vitest run src/app/task-form-fields.test.tsx --reporter=dot > /tmp/t3b.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |renders the rich Description editor|Unable to find" /tmp/t3b.log
```

Expected: `EXIT=1`, with `renders the rich Description editor (a labelled textbox)` failing on
`Unable to find an accessible element with the role "textbox"`.

**This failure is the point of the task.** It proves the conversion actually changed mount timing. If
the suite stays green, the import did not take effect — check you edited the right line before
proceeding, because a green run here would let you "fix" a test that was never broken.

- [ ] **Step 4: Make the assertion await the editor**

In `src/app/task-form-fields.test.tsx`, the test at ~line 180 currently reads (the surrounding
`render` call may differ slightly — keep it as it is, change only the callback signature and the query):

```tsx
  it("renders the rich Description editor (a labelled textbox)", () => {
    render(<Harness />, { wrapper: TestProviders });
    // NoteEditor mounts a contenteditable with role=textbox + aria-label "Description".
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
  });
```

Change it to:

```tsx
  it("renders the rich Description editor (a labelled textbox)", async () => {
    render(<Harness />, { wrapper: TestProviders });
    // The editor now arrives through `rich-text-editor-lazy`, so the contenteditable
    // appears only after the dynamic chunk resolves — hence findBy, not getBy.
    // The loading fallback is aria-hidden and has no role, so this query cannot be
    // satisfied by the placeholder: it resolves against the real editor or not at all.
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeTruthy();
  });
```

- [ ] **Step 5: Run the suite to verify it passes**

```bash
npx vitest run src/app/task-form-fields.test.tsx --reporter=dot > /tmp/t3c.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t3c.log
```

Expected: `EXIT=0`, and the **same** test count as Step 1.

- [ ] **Step 6: Prove the converted assertion is not vacuous**

The risk being checked: `findByRole` resolving against the skeleton instead of the editor, which would
pass with the editor gone.

Temporarily edit `src/app/task-form-fields.tsx` to render `<RichTextEditorFallback />` in place of the
`<RichTextEditor …>` block (import it from `./rich-text-editor-lazy`). Re-run the suite.

Expected: the `renders the rich Description editor` test goes **red**. Restore the real render site and
confirm green again.

If it stays green with the editor replaced by the fallback, the assertion is worthless and must be
strengthened — assert on a control only the loaded editor renders, e.g.
`screen.getByRole("button", { name: /bold/i })`.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx
git commit -F - <<'EOF'
perf(tasks): load the task description editor through the lazy boundary

task-form-fields is reachable from the entry graph statically
(task-manager -> app-modals -> task-form-modal), so its editor import is one
of the four that put Tiptap in the initial chunk.

The description assertion becomes async: the contenteditable now appears only
once the chunk resolves. The loading fallback is aria-hidden with no role, so
the findByRole query still cannot be satisfied by the placeholder — verified
by replacing the editor with the fallback and watching the test go red.
EOF
```

---

## RETRACTED — "no suite needs an async assertion" was FALSE

★★★ **This section previously asserted that ZERO suites needed an async assertion. That was wrong,
and it was the most expensive error in this slice.** It is left here as a retraction rather than
deleted, because the failure mode is the point.

**The truth, measured three times on the same tree:**

| test file | product import | result |
|---|---|---|
| sync `getByRole` | eager `./rich-text-editor` | 15/15 pass |
| **sync `getByRole`** | **lazy `./rich-text-editor-lazy`** | **1 failed / 14 passed** |
| async `findByRole` | lazy | 15/15 pass |
| async `findByRole` | lazy, render site → `RichTextEditorFallback` | 1 failed / 14 passed |

```bash
npx vitest run src/app/task-form-fields.test.tsx --reporter=dot --maxWorkers=1
# EXIT=1 -- Tests 1 failed | 14 passed (15)
# Unable to find an accessible element with the role "textbox" and name "Description"
```

**So the count is ONE, which is what this plan said before it was "corrected".** The spec said four;
the plan measured one; Task 3 claimed zero; the real answer is one. Fixed in `9ec49f69`.

**Why the false claim was believable.** The `dynamic()` import DOES resolve in a microtask — that half
is true. What it misses is that React still needs a RE-RENDER to swap the fallback for the editor, and
a `getBy` on the line after `render()` runs before that. The rule is not "microtask, therefore
synchronous"; it is **synchronous queries see the Skeleton, awaited queries see the editor.**

★★★ **HOW IT SURVIVED VERIFICATION, which is the transferable lesson.** Task 3's commit reported its
mutant as failing with `Unable to find an accessible element with the role "textbox" and name
"Description"` — the EXACT string its own shipped code then produced. **Mutant and shipped code were
observationally identical for that test**, so the mutant paragraph could not distinguish "I mutated and
reverted" from "I never re-ran after the edit". A vacuity check that cannot tell the fix from the bug
is not evidence. Demand the mutant's result AND a post-change re-run as separate observations.

★★ The controller verified the COMMIT (import line changed, test file untouched) and read that as
verifying the CLAIM. Those are different things: an untouched test file is equally consistent with
"correctly green" and "never re-run".

★★ The false claim then propagated into `rich-text-editor-lazy.tsx`'s docstring and into the briefs for
Tasks 4–6 and 7, which were told **not** to add async assertions to passing tests. The sweep found the
failure while under instructions that discouraged looking. Corrected in `04836fc1`.

**Still true from the original section, and independently confirmed:**
- The other three converted suites are genuinely green — they already `await findByRole`, because
  ProseMirror mounts asynchronously regardless.
- `dashboard-narrative` additionally asserts the toolbar's Bold button, which no fallback can supply.
- **Task 10 Step 2 now DOES apply** if the null-result path is ever taken: `9ec49f69` must be reverted
  along with the four import conversions.

★★ **CRLF trap, hit by two agents AND by the controller:** `src/app/*.tsx` is CRLF. A multi-line anchor
using `
` does NOT match and **reports success while changing nothing**. Use `?
` and assert the
edit landed.

★★ **Fork-pool collapse is AMBIENT, not self-contention.** `Failed to start forks worker` /
`Timeout waiting for worker` → `Test Files no tests` + `EXIT=1`. The ~50 live `node.exe` processes on
this machine are MCP servers and harness plugins, NOT vitest workers — enumerate their command lines
before blaming your own parallelism. It reproduces on a SINGLE file at `--maxWorkers=1`. Classify by
`no tests` plus the worker error, re-run, and never record it as a result in either direction.

---

## Task 4: Convert `note-log-panel.tsx`

The only consumer that uses the imperative handle. Both the value and the type move to the wrapper.

**Files:**
- Modify: `src/app/note-log-panel.tsx:21`

- [ ] **Step 1: Establish the suite is green**

```bash
npx vitest run src/app/note-log-panel.test.tsx --reporter=dot > /tmp/t4a.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t4a.log
```

Expected: `EXIT=0`. Record the test count.

- [ ] **Step 2: Convert the import**

In `src/app/note-log-panel.tsx`, change line 21 from:

```tsx
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor";
```

to:

```tsx
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";
```

Both names come from the wrapper — it re-exports the type. Do **not** split this into two imports from
two modules; that reintroduces a static import of the heavy module (a type-only import is erased, but a
mixed import statement is not, and getting that subtlety wrong is how the conversion silently
under-delivers).

- [ ] **Step 3: Run the suite**

```bash
npx vitest run src/app/note-log-panel.test.tsx --reporter=dot > /tmp/t4b.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |Unable to find" /tmp/t4b.log
```

Expected: `EXIT=0` with the same count as Step 1. This suite already awaits the editor
(`await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") })`), so it should need no
change.

If it fails, the failure is informative — report which assertion and whether it is a timing issue
(`Unable to find`) or a handle issue (a `null` deref on `composerEditorRef.current`). A handle failure
would mean `editorRef` is not passing through the wrapper, which contradicts Orientation fact 3 and
must be reported rather than worked around.

- [ ] **Step 4: Verify the handle still works at runtime, not just in types**

The handle is what `note-log-panel` uses to clear the composer after a note is committed. Confirm the
existing test that exercises it passes by name:

```bash
npx vitest run src/app/note-log-panel.test.tsx -t "commits a typed note through onAdd" --reporter=dot > /tmp/t4c.log 2>&1
echo "EXIT=$?"
grep -E "Tests " /tmp/t4c.log
```

Expected: `EXIT=0`, `1 passed`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
echo "EXIT=$?"
```

Expected: `EXIT=0`. This is the step that catches the type re-export being wrong.

- [ ] **Step 6: Commit**

```bash
git add src/app/note-log-panel.tsx
git commit -F - <<'EOF'
perf(notes): load the note-log editor through the lazy boundary

note-log-panel is reachable from the entry graph statically
(task-manager -> notes-window), so its editor import is one of the four that
put Tiptap in the initial chunk.

Both the component and the RichTextEditorHandle type now come from the
wrapper. The handle keeps working because it travels as the ordinary prop
`editorRef` rather than React's `ref`, which next/dynamic would not forward.
EOF
```

---

## Task 5: Convert `dashboard-sections/dashboard-narrative.tsx`

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-narrative.tsx:9`

- [ ] **Step 1: Establish the suite is green**

```bash
npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx --reporter=dot > /tmp/t5a.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t5a.log
```

Expected: `EXIT=0`. Record the test count.

- [ ] **Step 2: Convert the import**

In `src/app/dashboard-sections/dashboard-narrative.tsx`, change line 9 from:

```tsx
import { RichTextEditor } from "../rich-text-editor";
```

to:

```tsx
import { RichTextEditor } from "../rich-text-editor-lazy";
```

Note the `../` — this file sits in `dashboard-sections/`.

- [ ] **Step 3: Run the suite**

```bash
npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx --reporter=dot > /tmp/t5b.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |Unable to find" /tmp/t5b.log
```

Expected: `EXIT=0` with the same count. This suite already awaits
(`await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") })`).

- [ ] **Step 4: Confirm the toolbar assertion still holds**

The test `mounts the lean rich-text editor with an accessible name` asserts both the textbox **and**
`screen.getByRole("button", { name: /bold/i })`. The Bold button exists only in the real toolbar, never
in the fallback — so this suite already carries its own non-vacuity guarantee and needs no synthetic
mutation check.

```bash
npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx -t "mounts the lean rich-text editor" --reporter=dot > /tmp/t5c.log 2>&1
echo "EXIT=$?"
grep -E "Tests " /tmp/t5c.log
```

Expected: `EXIT=0`, `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-sections/dashboard-narrative.tsx
git commit -F - <<'EOF'
perf(dashboard): load the narrative editor through the lazy boundary

dashboard-narrative is reachable from the entry graph statically
(workspace-section -> dashboard-panel), so its editor import is one of the
four that put Tiptap in the initial chunk.

Its suite already awaited the editor and additionally asserts the toolbar's
Bold button, which the loading fallback cannot supply — so the assertion
proves the real editor mounted, not merely that something rendered.
EOF
```

---

## Task 6: Convert `milestone-edit-modal.tsx`

**Files:**
- Modify: `src/app/milestone-edit-modal.tsx:11`

- [ ] **Step 1: Establish the suite is green**

```bash
npx vitest run src/app/milestone-edit-modal.test.tsx --reporter=dot > /tmp/t6a.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t6a.log
```

Expected: `EXIT=0`. Record the test count.

- [ ] **Step 2: Convert the import**

In `src/app/milestone-edit-modal.tsx`, change line 11 from:

```tsx
import { RichTextEditor } from "./rich-text-editor";
```

to:

```tsx
import { RichTextEditor } from "./rich-text-editor-lazy";
```

- [ ] **Step 3: Run the suite**

```bash
npx vitest run src/app/milestone-edit-modal.test.tsx --reporter=dot > /tmp/t6b.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |Unable to find" /tmp/t6b.log
```

Expected: `EXIT=0` with the same count. This suite already awaits the editor
(`const editor = await screen.findByRole("textbox", { name: DESC_LABEL })`).

- [ ] **Step 4: Check the write-path cap tests specifically**

`MilestoneEditModal rich-field write-path cap` asserts on what the modal **saves**, which flows through
the editor's `onChange`. If lazy mounting broke the wiring, these are where it shows.

```bash
npx vitest run src/app/milestone-edit-modal.test.tsx -t "write-path cap" --reporter=dot > /tmp/t6c.log 2>&1
echo "EXIT=$?"
grep -E "Tests " /tmp/t6c.log
```

Expected: `EXIT=0`, `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/app/milestone-edit-modal.tsx
git commit -F - <<'EOF'
perf(milestones): load the milestone description editor through the lazy boundary

milestone-edit-modal is reachable from the entry graph statically
(workspace-section -> milestones-panel), the fourth and last of the imports
that put Tiptap in the initial chunk.

Leaves change-edit-modal and raid-edit-modal on static imports deliberately:
both already sit behind a dynamic() panel boundary in workspace-panels.tsx, so
converting them would move no bytes.
EOF
```

---

## Task 7: Sweep for suites that render these components transitively

Four components changed how they mount. Any suite that renders them **through a parent** is affected
and has not been run yet.

**Files:** none changed unless the sweep finds a failure.

- [ ] **Step 1: Enumerate the candidate suites**

```bash
grep -rln "task-form-fields\|note-log-panel\|dashboard-narrative\|milestone-edit-modal\|TaskFormModal\|NotesWindow\|MilestonesPanel\|DashboardPanel" src/app --include=*.test.tsx | sort
```

Report the list. Every file on it renders, or may render, a converted component.

- [ ] **Step 2: Run exactly those suites**

Feed the list from Step 1 to vitest as explicit paths:

```bash
npx vitest run <paths from step 1> --reporter=dot > /tmp/t7.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |FAIL" /tmp/t7.log
```

Expected: `EXIT=0`.

For any failure, the fix is the same shape as Task 3 Step 4 — the assertion becomes `await findBy…` —
**and it needs the same vacuity check.** Do not convert an assertion without confirming it can still
fail.

- [ ] **Step 3: Run the full unit suite**

```bash
npm run test:run > /tmp/full.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/full.log
```

Expected: `EXIT=0`.

**If this exits 1 while printing a large passing count, suspect a fork-pool collapse before suspecting
your change.** The symptom is `Failed to start forks worker` or `Timeout waiting for worker` in the log
and a reported **file** count lower than the real one. Check with:

```bash
grep -cE "Failed to start forks worker|Timeout waiting for worker" /tmp/full.log
git ls-files | grep -E "\.(test|spec)\.(ts|tsx|mjs)$" | grep -v "^e2e/" | wc -l
```

If the reported file count is short of that number, re-run the missing files in isolation rather than
debugging a phantom regression. Never run two vitest processes at once while doing so.

- [ ] **Step 4: Run the shuffled suite**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/shuffle.log
```

Expected: `EXIT=0`. This is the only local reproduction of CI's `unit-tests-shuffled` job, and it
catches intra-file order dependence — which async-ifying assertions can introduce.

- [ ] **Step 5: Commit any test fixes**

Only if Step 2 required changes:

```bash
git add <the test files you changed>
git commit -F - <<'EOF'
test: await the lazily-loaded editor in the transitive render suites

Suites that render a converted editor consumer through a parent needed the
same getBy -> findBy change as the direct suites. Each converted assertion was
checked against the loading fallback and still fails when the editor is absent.
EOF
```

If nothing needed changing, record that in your task report and commit nothing.

---

## Task 8: Measure the delta and decide

This task produces the verdict. **It does not change product code.**

**Files:**
- Modify: `docs/superpowers/plans/2026-08-19-tiptap-bundle-baseline.txt` (append the after-figures)

- [ ] **Step 1: Confirm a clean tree**

```bash
git status --porcelain -uall
```

Expected: no output. An uncommitted change would land in the measurement and not in the diff.

- [ ] **Step 2: Remove the build cache**

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
```

PowerShell tool. Same reason as Task 1 — a warm cache can contribute to a fake delta.

- [ ] **Step 3: Build and capture**

```bash
npm run build > /tmp/after-build.txt 2>&1
echo "EXIT=$?"
cat /tmp/after-build.txt >> docs/superpowers/plans/2026-08-19-tiptap-bundle-baseline.txt
```

Expected: `EXIT=0`.

- [ ] **Step 4: Measure the eager entry graph again** — REVISED 2026-08-19, MEASURED

Same script, same tree, so the two runs are comparable by construction:

```bash
node docs/superpowers/plans/measure-entry-graph.mjs
```

If the script throws `ROOT_MODULE not in manifest`, the root client component is no longer
`task-manager.tsx` — stop and report that rather than editing the constant to make it run.

- [ ] **Step 5: Compare, and apply the decision rule**

| Figure | Before (Task 1) | After | Delta |
|---|---|---|---|
| `PROSEMIRROR_IN_ENTRY_GRAPH` | `true` | | |
| `EAGER_TOTAL_KB` | `2334.7` | | |
| eager chunk count | `19` | | |
| `PROSEMIRROR_KB` | `428.2` | | |

The decision rule, restated for the metric that actually exists:

- **`PROSEMIRROR_IN_ENTRY_GRAPH` flips to `false`** and `EAGER_TOTAL_KB` falls by roughly the 428 kB
  the ProseMirror chunk weighed → Tiptap left the entry graph. **SHIP.** Proceed to Task 9.
- **The flag stays `true`** → something still reaches the editor statically. **This is a diagnosable
  result, not a null one.** Report which module still pulls it: re-run the manifest parse listing every
  `clientModules` key whose chunk list contains the ProseMirror chunk, and name the offender. Do not
  proceed to either Task 9 or Task 10 until that is explained — the likeliest cause is a missed import
  line, which is a bug in the conversion rather than a verdict about it.
- **The flag flips to `false` but `EAGER_TOTAL_KB` barely moves** → the bytes were re-homed into another
  eager chunk rather than evicted. **NULL RESULT.** Proceed to Task 10.

★ Do NOT compare chunk names between builds — Turbopack rehashes them.

There is no numeric floor to clear — the decision is a judgement on the figures, deliberately. State
your reading and the numbers behind it explicitly; the controller confirms before you continue.

**Do not proceed to Task 9 or Task 10 without the controller confirming the verdict.**

---

## Task 9: SHIP path — document, close §129, bump the version

Only if Task 8 says SHIP.

**Files:**
- Modify: `docs/open-followups.md` (§129)
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`,
  `docs/CODEMAPS/*.md` (five headers)

- [ ] **Step 1: Close §129 with the measurement**

Rewrite §129's heading line to end in `— CLOSED <today's date>, measured` and replace the
"**The real question is bundle weight, and it is UNMEASURED**" paragraph with the actual figures from
Task 8, plus the reproduce command:

```bash
# The measurement that closed this entry (see the Resolution below):
npm run build > /tmp/b.txt 2>&1; echo "EXIT=$?"; grep -E "First Load JS|chunks/" /tmp/b.txt
```

Add a Resolution section that records, in this order:

1. The before/after table from Task 8, including the shared-chunk lines — not just the `/` figure.
2. **That two of the six named sites were already behind a lazy panel boundary and were deliberately
   left static**, with the `grep -n "dynamic(" src/app/workspace-panels.tsx` reproduce command. Anyone
   reading §129's original table will otherwise count six and find four.
3. That this did **not** fix §54 and did **not** retire the `csp-nonce.ts` guard.
4. That the corrected per-suite test table was: three of four suites already awaited the editor; only
   `task-form-fields.test.tsx` asserted it synchronously. §129's prose predicted four — record that the
   prediction was wrong, because that is the kind of claim this file exists to stop being re-derived.

- [ ] **Step 2: Bump the version in all eight places**

Pick the next version and a codename **not already used in `CHANGELOG.md`** — check with
`grep -oE '"[A-Z][a-z]+"' CHANGELOG.md | sort -u`. The eight sites, none of which any gate checks:

1. `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, and the codename block
2. `CHANGELOG.md` — a new entry
3. `package.json` — `version`
4. `package-lock.json` — the root `version`
5. `package-lock.json` — the `packages[""]` `version`
6. `README.md` — the shields badge, **version and codename both**
7. `docs/CODEMAPS/*.md` — the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five

Verify none were missed:

```bash
grep -rn "0\.248\.0\|Bujold" package.json package-lock.json README.md docs/CODEMAPS/*.md src/app/version.ts
```

Expected: no hits other than historical `CHANGELOG.md` entries.

- [ ] **Step 3: Commit**

```bash
git add docs/open-followups.md src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -F - <<'EOF'
release: <version> "<codename>" — Tiptap leaves the entry chunk

Closes open-followups §129 with the measurement it asked for rather than an
argument. The four editor consumers reachable from the entry graph now load
through one dynamic boundary; the two already behind a lazy panel boundary
were left alone because converting them moves nothing.

Records what the entry got wrong: it named six sites where four matter, and
predicted four suites would need async assertions where only one did.
EOF
```

- [ ] **Step 4: Go to Task 11 (gates).**

---

## Task 10: NULL-RESULT path — revert the four, keep the wrapper

Only if Task 8 says NULL RESULT.

**Files:**
- Modify: `src/app/task-form-fields.tsx`, `src/app/note-log-panel.tsx`,
  `src/app/dashboard-sections/dashboard-narrative.tsx`, `src/app/milestone-edit-modal.tsx`
- Modify: `src/app/task-form-fields.test.tsx` (and any test changed in Task 7)
- Modify: `docs/open-followups.md` (§129)

- [ ] **Step 1: Revert the four import conversions only**

Restore these four lines to their original module path:

```tsx
// src/app/task-form-fields.tsx:15
import { RichTextEditor } from "./rich-text-editor";
// src/app/note-log-panel.tsx:21
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor";
// src/app/dashboard-sections/dashboard-narrative.tsx:9
import { RichTextEditor } from "../rich-text-editor";
// src/app/milestone-edit-modal.tsx:11
import { RichTextEditor } from "./rich-text-editor";
```

**Keep `rich-text-editor-lazy.tsx` and keep the two collapsed sites on it.** That half is a pure
de-duplication with no bundle effect — reverting it would restore two copies of the fallback block in
exchange for nothing. The spec is explicit on this point.

Do **not** use `git checkout --` or `git restore` — both are deny-listed in this environment. Edit the
four lines, or use `git checkout-index -f -- <path>`.

- [ ] **Step 2: Revert the test assertions that were made async — EXPECTED TO BE A NO-OP**

★★ **Measured after Task 3: no assertion was ever made async, so there is nothing here to revert.**
See "Measured correction after Task 3" above. `task-form-fields.test.tsx` still holds its original
synchronous `getByRole` and was never committed to in this branch.

Confirm rather than assume:

```bash
git diff d20ab9c1..HEAD --name-only -- "*.test.tsx"
```

Expected: no output. If it names a file, revert that file's assertion to its `d20ab9c1` form and say so.

- [ ] **Step 3: Run the full unit suite**

```bash
npm run test:run > /tmp/revert.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/revert.log
```

Expected: `EXIT=0`, with the counts from before Task 3.

- [ ] **Step 4: Close §129 as WON'T DO**

Rewrite §129's heading to end in `— CLOSED <today's date>, WON'T DO, measured`, and replace the
"UNMEASURED" paragraph with a Resolution recording:

1. The before/after table from Task 8, with **both** the `/` figure and the shared-chunk lines, and the
   explicit reason the delta is a null result.
2. The import-graph table from the spec — which four sites are reachable from the entry and which two
   are already behind `dynamic()` panels — so nobody derives it a third time.
3. That the wrapper module was **kept** and why, so a future reader does not see `rich-text-editor-lazy.tsx`
   and assume the conversion shipped.
4. That §129's per-suite prediction was wrong: three of four suites already awaited the editor.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-form-fields.tsx src/app/task-form-fields.test.tsx \
        src/app/note-log-panel.tsx src/app/dashboard-sections/dashboard-narrative.tsx \
        src/app/milestone-edit-modal.tsx docs/open-followups.md
git commit -F - <<'EOF'
docs(followups): close §129 WON'T DO — lazy-loading Tiptap moves no bytes

Measured with a clean `next build` before and after converting the four
consumers reachable from the entry graph. The delta on the / route was not a
real reduction, so the four conversions are reverted.

The shared `rich-text-editor-lazy.tsx` wrapper is kept: it removed two verbatim
copies of the dynamic() block and has no bundle effect either way.

§129 now carries the numbers and the import graph, so the question does not get
re-derived from "Tiptap is big" a third time.
EOF
```

This path is **docs-only in product terms and takes no version bump.**

- [ ] **Step 6: Go to Task 11 (gates).**

---

## Task 11: Run every gate

Both paths land here.

**Files:** none, unless a gate fails.

- [ ] **Step 1: Typecheck and lint**

```bash
npx tsc --noEmit
echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app
echo "ESLINT_EXIT=$?"
```

Expected: both `0`. No pipes on either.

- [ ] **Step 2: File-size ratchet**

```bash
npm run size:check
echo "EXIT=$?"
```

Expected: `EXIT=0`. If it fails on a file you edited, note that the script measures
`readFileSync().split("\n").length`, which is **one more** than `wc -l`. Read the real number with:

```bash
node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
```

Never re-baseline to make it pass.

- [ ] **Step 3: Duplication gate**

```bash
npm run dup:check
echo "EXIT=$?"
```

Expected: `EXIT=0`. On the SHIP path this should be no worse than baseline and probably better — the
wrapper removed two verbatim copies of the same block. If it got *worse*, something was duplicated
rather than shared, and that is worth reporting.

- [ ] **Step 4: Doc gates**

```bash
npm run docs:symbols:check
echo "SYM_EXIT=$?"
npm run docs:claims:check
echo "CLAIMS_EXIT=$?"
```

Expected: both `0`. `docs:claims:check` is a ratchet — if you added a `path:LINE` citation to §129 it
will fail. Cite the **symbol** and a grep instead; never re-baseline.

- [ ] **Step 5: The production smoke suite**

```bash
npm run build > /tmp/prod-build.log 2>&1
echo "BUILD_EXIT=$?"
npm run e2e:smoke:prod > /tmp/prod-smoke.log 2>&1
echo "SMOKE_EXIT=$?"
grep -E "passed|failed" /tmp/prod-smoke.log | tail -5
```

Expected: both `0`.

**This is the most important gate in this plan and the reason it is not optional.** It is the only
local check that sees the production CSP — dev grants `'unsafe-inline'` on `style-src-elem` while prod
is nonce-only (`src/proxy.ts`). This slice changes *how* a `<style>`-injecting component loads, which
is precisely the seam §54 lives in. A defect here is invisible to every other suite.

It owns port 3200 and refuses to run if something else holds it. It does **not** build — the build
above is required.

- [ ] **Step 6: The axe accessibility gate on the affected views**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/axe.log 2>&1
echo "EXIT=$?"
grep -E "passed|failed" /tmp/axe.log | tail -3
```

Expected: `EXIT=0`.

`--workers=1` is not optional when matching more than one view. CI runs axe serially; locally it runs
at CPU count, and over-subscribed tests die on `Test timeout of 60000ms exceeded` inside
`page.evaluate` — which prints as a failure with **no rule id and no impact**, i.e. a green branch
reading as red. If you see timeouts, read the failure body before believing it.

- [ ] **Step 7: Record what no gate here can see**

**Nothing in this plan ever observes the shimmer in a real browser.** Under vitest the `dynamic()`
import resolves in a microtask, so the fallback never renders; under Playwright the chunk loads from
localhost faster than a frame. The fallback's *appearance* is therefore pinned only by its class list
(Task 2), never by a rendered pixel.

Do not paper over this with a contrived test. Record it in the task report as a known limit, and — on
the SHIP path only — do one manual check with the browser devtools network throttle set to "Slow 3G":
open a task's Description, a note log, the dashboard narrative and a milestone, and confirm each shows
a shimmering block rather than a blank gap or a collapsed layout.

If that manual check is not run, say so plainly rather than implying it was.

- [ ] **Step 8: Report the full gate matrix**

Report every exit code above in one table. Do not summarise as "gates pass" — the exit codes are the
claim.

---

## Task 12: Hand off

- [ ] **Step 1: Summarise for the controller**

Report:
- The before/after bundle figures and the verdict.
- Which path was taken (SHIP or NULL RESULT).
- The full gate matrix from Task 11.
- Anything measured that contradicted this plan or the spec — especially the per-suite test table,
  which this plan already corrects once.

- [ ] **Step 2: Stop.**

Do not push, do not open an MR, do not merge. Those require an explicit instruction from the user.

---

## Notes on what this plan deliberately does not do

- **It does not touch `rich-text-editor.tsx`.** In particular the `{editor && <RichTextToolbar …>}`
  guard stays — its own comment records that the guard, not `immediatelyRender: false`, is what makes
  the hydration render safe.
- **It does not convert `change-edit-modal.tsx` or `raid-edit-modal.tsx`.** Both are already behind a
  `dynamic()` panel boundary.
- **It does not lazy-load the consumers** (task modal, notes window, milestones panel, narrative).
  That would evict more than Tiptap but changes modal mount timing app-wide, and lands on the standing
  "confirm before altering any window's layout, chrome or empty state" constraint. If Task 8 says SHIP,
  it is a candidate follow-up entry — not part of this slice.
- **It adds no bundle-analyzer dependency.** ★★ The original reason given here was that "`next build`
  already prints the figures" — **it does not**, on this app (see Task 1 Step 4). The reason still
  holds, but the true one is different: the build's own client-reference manifest already carries the
  exact eager chunk graph, so a 30-line script reads it directly and a new dependency would be
  `dependency-audit` surface for nothing.
