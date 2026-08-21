# UI Batch Slice 3 — Undo History, AI Cancel, Budget People Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-step undo/redo history dropdown, a Stop affordance on all six AI triggers, and expandable per-person booking rows in the budget bucket table — plus two slice-2 debts (the settings-rail wrap defect §112 and the missing e2e seed slices).

**Architecture:** Three new pure, coverage-gated `.ts` engines carry all the logic (`takeThrough`/`pushUndoMany` in the existing undo module, `budget-bucket-people.ts`, `use-abortable-ai.ts`); React files stay thin glue and fall under the existing `coverage.exclude` globs. Nothing refactors working code: `undo()`/`redo()`/`undoById` are untouched, and the five AI paths that already abort keep their own controllers.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · vitest 4.1.8 + @testing-library/react · Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-08-08-ui-batch-slice-3-history-cancel-people-design.md`

**Baseline:** branch from `main` @ `59cd9489` (0.223.0 "Okorafor").

---

## Read before you start

You are working in a repo whose docs are largely ungated and whose gates are the real safety net. Four rules apply to every task below:

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits **0 while tests fail** — that is `tail`'s status. Redirect, echo `$?` unpiped, then read the file.
2. **`npm run lint` does not reproduce the CI gate** (it is bare `eslint`, no `--max-warnings`). Use `npx eslint --max-warnings=0 src/app`.
3. **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there.** Patch it with a node UTF-8 write whose anchor matches `\r\n`. The `i18n-encoding` test bans both ASCII substitutions (`fuer`) and `\uXXXX` escapes.
4. **The file-size gate counts `wc -l` + 1.** Read the real number with
   `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`.

Read `AGENTS.md` before your first edit. For task 4 also read `docs/AGENTS/ui-shell.md` (it owns the Escape/Tab dismissal protocol).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/undo/undo-stack.ts` | modify | Pure stack algebra. Gains `takeThrough` + `pushUndoMany`. |
| `src/app/undo/undo-stack.test.ts` | modify | Tests for the two new pure functions. |
| `src/app/undo/use-undo-stack.ts` | modify | Gains `undoThrough` / `redoThrough` on `UndoStackApi`. |
| `src/app/undo/use-undo-stack.test.tsx` | modify | N≥3 through-undo/redo behaviour. |
| `src/app/undo/undo-control.tsx` | modify | Caret popover body becomes a listbox history. |
| `src/app/undo/undo-control.test.tsx` | modify | Listbox band, footer, keyboard, unique names. |
| `src/app/task-manager.tsx` | modify | Two call sites at `:2576-2577`. |
| `src/app/ai-trigger-button.tsx` | **create** | Presentational idle↔Stop trigger, shared by six sites. |
| `src/app/ai-trigger-button.test.tsx` | **create** | Label/name flip + click routing. |
| `src/app/use-abortable-ai.ts` | **create** | `abortRef` + `busy` + `cancel` helper. One consumer. |
| `src/app/use-abortable-ai.test.tsx` | **create** | Abort path returns to idle, no error surfaced. |
| `src/app/use-insight-recommend.ts` | modify | Adopt the helper, thread `signal`. |
| `src/app/budget-bucket-people.ts` | **create** | Pure `buildBucketPeopleRows`. |
| `src/app/budget-bucket-people.test.ts` | **create** | Membership, sort, `null`-vs-`0`. |
| `src/app/budget-panel-people-rows.tsx` | **create** | The `<tbody>` of person rows. |
| `src/app/budget-panel-people-rows.test.tsx` | **create** | Cell rendering + `—` cases. |
| `src/app/budget-panel.tsx` | modify | Disclosure state, mounts the tbody. 729/800 — watch the ratchet. |
| `src/app/settings-view.tsx` | modify | One class on the rail group (§112). |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | modify | New EN/DE strings. |
| `e2e/seed.ts` | modify | `insights` + `timelogLinks` rows, e2e-only. |
| `docs/open-followups.md` | modify | Close §112. |

---

## Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull
git log --oneline -1        # expect 59cd9489 release: 0.223.0 "Okorafor"
git checkout -b feat/ui-batch-slice-3
```

- [ ] **Step 2: Confirm a clean baseline**

```bash
git status --short           # expect empty
```

---

## Task 1: Pure stack algebra — `takeThrough` and `pushUndoMany`

**Files:**
- Modify: `src/app/undo/undo-stack.ts` (append after `dropEntry`, currently ends line 265)
- Test: `src/app/undo/undo-stack.test.ts`

Background you need: the stack is **oldest-at-front, newest-at-end** — `pushUndo` appends and `popUndo` takes from the end. Both new functions are generic over `E extends { meta: UndoMeta }` exactly like the three existing ones, so the hook's private `StackEntry` type never has to be exported.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/undo-stack.test.ts`:

```ts
describe("takeThrough", () => {
  const e = (id: number) => ({ meta: { id, kind: "task.edited", count: 1, timestamp: "", label: `e${id}` } });

  it("returns the taken entries NEWEST-FIRST and the untouched remainder", () => {
    const stack = [e(1), e(2), e(3), e(4)];        // 4 is newest
    const got = takeThrough(stack, 2);
    expect(got?.entries.map((x) => x.meta.id)).toEqual([4, 3, 2]);
    expect(got?.rest.map((x) => x.meta.id)).toEqual([1]);
  });

  it("takes the whole stack when the id is the oldest entry", () => {
    const stack = [e(1), e(2), e(3)];
    const got = takeThrough(stack, 1);
    expect(got?.entries.map((x) => x.meta.id)).toEqual([3, 2, 1]);
    expect(got?.rest).toEqual([]);
  });

  it("takes exactly one when the id is the newest entry", () => {
    const got = takeThrough([e(1), e(2)], 2);
    expect(got?.entries.map((x) => x.meta.id)).toEqual([2]);
    expect(got?.rest.map((x) => x.meta.id)).toEqual([1]);
  });

  it("returns null for an absent id and for an empty stack", () => {
    expect(takeThrough([e(1)], 99)).toBeNull();
    expect(takeThrough([], 1)).toBeNull();
  });

  it("does not mutate the input stack", () => {
    const stack = [e(1), e(2), e(3)];
    takeThrough(stack, 1);
    expect(stack.map((x) => x.meta.id)).toEqual([1, 2, 3]);
  });
});

describe("pushUndoMany", () => {
  const e = (id: number) => ({ meta: { id, kind: "task.edited", count: 1, timestamp: "", label: `e${id}` } });

  it("appends in array order so the LAST element ends on top", () => {
    // takeThrough hands entries newest-first; redo must replay oldest-undone
    // FIRST, and redo pops from the END — so the oldest-undone must land last.
    const got = pushUndoMany([], [e(4), e(3), e(2)], 25);
    expect(got.map((x) => x.meta.id)).toEqual([4, 3, 2]);
  });

  it("evicts from the front when the combined length exceeds the cap", () => {
    const got = pushUndoMany([e(1), e(2)], [e(3), e(4)], 3);
    expect(got.map((x) => x.meta.id)).toEqual([2, 3, 4]);
  });

  it("is a no-op copy for an empty entry list", () => {
    const got = pushUndoMany([e(1)], [], 25);
    expect(got.map((x) => x.meta.id)).toEqual([1]);
  });
});
```

Add `takeThrough` and `pushUndoMany` to the existing import block at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/undo/undo-stack.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit, errors reading `takeThrough is not a function` / `pushUndoMany is not a function`.

★ `--reporter=basic` does **not** exist in vitest 4.1.8 and fails at startup in a way that reads like a broken run. Use `--reporter=dot`.

- [ ] **Step 3: Write the implementation**

Append to `src/app/undo/undo-stack.ts`:

```ts
/** Take every entry from the one with `meta.id === id` up to the TOP, returned
 *  NEWEST-FIRST (the execution order for a through-undo), plus the untouched
 *  remainder below it. Null when the id is absent — mirrors `popUndo`'s
 *  null-on-empty contract. Generic over the entry shape so the undo AND redo
 *  stacks share it. Pure. */
export function takeThrough<E extends { meta: UndoMeta }>(
  stack: readonly E[],
  id: number,
): { entries: E[]; rest: E[] } | null {
  const idx = stack.findIndex((e) => e.meta.id === id);
  if (idx === -1) return null;
  return { entries: stack.slice(idx).reverse(), rest: stack.slice(0, idx) };
}

/** Push N entries in array order and apply the cap ONCE. `pushUndo` caps per
 *  call, which is correct but re-slices N times; the through-path also needs a
 *  single fold so the commit is one setState. Pure. */
export function pushUndoMany<E extends { meta: UndoMeta }>(
  stack: readonly E[],
  entries: readonly E[],
  cap: number,
): E[] {
  const next = [...stack, ...entries];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/undo/undo-stack.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Mutation-check the ordering claim**

Temporarily delete `.reverse()` in `takeThrough`, re-run step 4, and confirm the newest-first tests **fail**. Restore it. A green suite that survives this mutation would mean the ordering is untested.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/undo-stack.ts src/app/undo/undo-stack.test.ts
git commit -F - <<'EOF'
feat: add takeThrough and pushUndoMany to the pure undo stack

takeThrough returns the entries from a given id up to the top, newest-first
(the execution order for a through-undo), plus the remainder. pushUndoMany
folds N pushes with one cap application so the through-path commits once.

Both generic over the entry shape, matching pushUndo/popUndo/dropEntry, so the
hook's private StackEntry type stays private.
EOF
```

---

## Task 2: `undoThrough` / `redoThrough` on the hook

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts` (`UndoStackApi` at `:330`, new callbacks near `:392`, return object at `:462`)
- Test: `src/app/undo/use-undo-stack.test.tsx`

★★ **This cannot be a loop over the existing `undo()`.** `stackRef` is refreshed by an effect (`:359`), so N calls in one tick all read the same stale stack and undo the top entry N times. Read the ref **once** and thread the list locally.

★★ **Every runner executes outside every `setState` updater.** `commitUndo`'s own comment (`:367`) records why: StrictMode double-invokes updaters, so `entries.map(e => e.run())` inside a `setRedoStack` updater applies all N restores twice.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/use-undo-stack.test.tsx`:

```tsx
// A state-backed harness: `capture` needs a real setter, and the through-undo
// property is only observable in the RESULTING ARRAY, not in call counts.
function useRowsHarness(initial: readonly Row[]) {
  const [rows, setRows] = useState<readonly Row[]>(initial);
  const api = useUndoStack(makeDeps());
  return { rows, setRows, api };
}

describe("undoThrough", () => {
  // ★★ SEED THREE. At N=1 a correct threaded implementation and a broken
  // loop-over-undo() are indistinguishable — both revert one entry.
  it("reverts every entry from the target up to the top, in one commit", () => {
    const start: readonly Row[] = [{ id: 1, name: "a" }];
    const { result } = renderHook(() => useRowsHarness(start));

    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "a" }, after: { name: "b" },
      });
      result.current.setRows([{ id: 1, name: "b" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "b" }, after: { name: "c" },
      });
      result.current.setRows([{ id: 1, name: "c" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "c" }, after: { name: "d" },
      });
      result.current.setRows([{ id: 1, name: "d" }]);
    });

    expect(result.current.api.stack).toHaveLength(3);
    const oldest = result.current.api.stack[0].id;

    act(() => { result.current.api.undoThrough(oldest); });

    // All three reverted, back to the starting value.
    expect(result.current.rows).toEqual([{ id: 1, name: "a" }]);
    expect(result.current.api.stack).toHaveLength(0);
    expect(result.current.api.redoStack).toHaveLength(3);
  });

  it("logs ONE activity entry with the summed count and fires ONE toast", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => {
      const [rows, setRows] = useState<readonly Row[]>([{ id: 1, name: "a" }]);
      return { rows, setRows, api: useUndoStack(deps) };
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }],
        fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }],
      });
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "a" }, after: { name: "z" },
      });
    });
    deps.logActivity.mockClear();
    deps.showToast.mockClear();

    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });

    expect(deps.logActivity).toHaveBeenCalledTimes(1);
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 3);   // 2 deleted + 1 edited
    expect(deps.showToast).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for an absent id", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => { result.current.undoThrough(999); });
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
  });

  it("leaves the redo stack replayable oldest-undone-first", () => {
    const { result } = renderHook(() => useRowsHarness([{ id: 1, name: "a" }]));
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "a" }, after: { name: "b" },
      });
      result.current.setRows([{ id: 1, name: "b" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "b" }, after: { name: "c" },
      });
      result.current.setRows([{ id: 1, name: "c" }]);
    });
    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });
    expect(result.current.rows).toEqual([{ id: 1, name: "a" }]);

    // One redo replays the FIRST edit that was undone last → "b".
    act(() => { result.current.api.redo(); });
    expect(result.current.rows).toEqual([{ id: 1, name: "b" }]);
  });
});

describe("redoThrough", () => {
  it("replays every redo entry from the target up to the top", () => {
    const { result } = renderHook(() => useRowsHarness([{ id: 1, name: "a" }]));
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "a" }, after: { name: "b" },
      });
      result.current.setRows([{ id: 1, name: "b" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.edited", id: 1,
        before: { name: "b" }, after: { name: "c" },
      });
      result.current.setRows([{ id: 1, name: "c" }]);
    });
    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });
    expect(result.current.api.redoStack).toHaveLength(2);

    act(() => { result.current.api.redoThrough(result.current.api.redoStack[0].id); });
    expect(result.current.rows).toEqual([{ id: 1, name: "c" }]);
    expect(result.current.api.redoStack).toHaveLength(0);
    expect(result.current.api.stack).toHaveLength(2);
  });
});
```

Add `useState` to the React import if it is not already there (it is — the file imports it at `:3`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero; `result.current.api.undoThrough is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/app/undo/use-undo-stack.ts`, extend the imports from `./undo-stack` with `takeThrough` and `pushUndoMany`. Add to the `UndoStackApi` interface (`:330`), after `undoById`:

```ts
  /** Undo every entry from `id` up to the top, newest-first, as ONE commit. */
  undoThrough: (id: number) => void;
  /** Redo every entry from `id` up to the top of the redo stack, as ONE commit. */
  redoThrough: (id: number) => void;
```

Add the two callbacks after `undo` (`:396`):

```ts
  // ★★ NOT a loop over undo(): `stackRef` is refreshed by an effect, so N calls
  //    in one tick all read the same stale stack and undo the top entry N times.
  //    Read the ref ONCE and thread the list locally.
  // ★★ The runners execute OUTSIDE every setState updater — StrictMode
  //    double-invokes updaters, which would apply all N restores twice (same
  //    reason commitUndo runs entry.run() before its setStates).
  const undoThrough = useCallback((id: number) => {
    const taken = takeThrough(stackRef.current, id);
    if (!taken) return;
    const inverses = taken.entries.map((e) => ({ meta: e.meta, run: e.run() }));
    const summed = taken.entries.reduce((n, e) => n + e.meta.count, 0);
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("undo", summed);
    showToast("info", t(lang, "undoneNActions", inverses.length));
    setStack(taken.rest);
    setRedoStack((rs) => pushUndoMany(rs, inverses, UNDO_CAP));
  }, []);

  // Mirror of undoThrough against the redo stack. Deliberately NOT folded in
  // with redo() — that function has its own body and shares nothing with
  // commitUndo, so unifying them would be a refactor of working code.
  const redoThrough = useCallback((id: number) => {
    const taken = takeThrough(redoStackRef.current, id);
    if (!taken) return;
    const inverses = taken.entries.map((e) => ({ meta: e.meta, run: e.run() }));
    const summed = taken.entries.reduce((n, e) => n + e.meta.count, 0);
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("redo", summed);
    showToast("info", t(lang, "redoneNActions", inverses.length));
    setRedoStack(taken.rest);
    setStack((s) => pushUndoMany(s, inverses, UNDO_CAP));
  }, []);
```

Add `undoThrough,` and `redoThrough,` to the returned object (`:462`).

The two `t(...)` calls need the strings from **Task 3** — implement Task 3 before running the suite, or temporarily assert on `logActivity` only. Prefer doing Task 3 first if you are executing out of order.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Mutation-check the stale-ref guard**

Replace the body of `undoThrough` with a loop over the existing `undo()`:

```ts
const undoThrough = useCallback((id: number) => {
  const taken = takeThrough(stackRef.current, id);
  if (!taken) return;
  taken.entries.forEach(() => undo());
}, [undo]);
```

Re-run step 4. The first test **must fail** — `rows` will not be back at `"a"`. Restore the real implementation. If that mutation passes, the test is not pinning the property this task exists for.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx
git commit -F - <<'EOF'
feat: add undoThrough/redoThrough for multi-step undo

Both read their stack ref ONCE and thread the taken list locally — a loop over
undo() would re-read a ref that is only refreshed by an effect and revert the
top entry N times. Runners execute outside every setState updater so StrictMode
cannot double-apply them.

One activity entry carrying the summed meta.count, one toast, one setStack and
one setRedoStack per call. undo/redo/undoById are unchanged.
EOF
```

---

## Task 3: i18n strings for the undo history

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

★★ Placeholders are **0-based positional** — `t(lang, key, a, b)` fills `{0}` and `{1}`.

- [ ] **Step 1: Add the EN strings**

In `src/app/i18n.ts`, beside the existing `undoShowNext` / `undoNextLabel` entries:

```ts
  undoNActions: "Undo {0} actions",
  redoNActions: "Redo {0} actions",
  undoneNActions: "Undid {0} actions",
  redoneNActions: "Redid {0} actions",
  undoHistoryOption: "{0} – step {1}",
  undoHistoryLabel: "Undo history",
  redoHistoryLabel: "Redo history",
  aiStop: "Stop",
```

★ `undoHistoryOption` exists to make each option's accessible name unique — see Task 4.

- [ ] **Step 2: Add the DE strings via a node UTF-8 write**

The Edit tool corrupts umlauts in this file and curls double quotes. Use:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  undoNextLabel:";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const add =
  "  undoNActions: \"{0} Aktionen rückgängig machen\",\r\n" +
  "  redoNActions: \"{0} Aktionen wiederholen\",\r\n" +
  "  undoneNActions: \"{0} Aktionen rückgängig gemacht\",\r\n" +
  "  redoneNActions: \"{0} Aktionen wiederholt\",\r\n" +
  "  undoHistoryOption: \"{0} – Schritt {1}\",\r\n" +
  "  undoHistoryLabel: \"Verlauf rückgängig machen\",\r\n" +
  "  redoHistoryLabel: \"Verlauf wiederholen\",\r\n" +
  "  aiStop: \"Stopp\",\r\n";
s = s.replace(anchor, add + anchor);
fs.writeFileSync(p, s, "utf8");
console.log("OK");
'
```

★★ The file is CRLF. An anchor or inserted text using bare `\n` silently produces a mixed-ending file; the `\r\n` above is required.

★★ Do **not** run this through a double-quoted `node -e "..."` — backticks inside double quotes become command substitution and content is silently deleted.

- [ ] **Step 3: Verify the bytes**

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");
for (const k of ["undoNActions","undoHistoryOption","aiStop"]) {
  const m = s.match(new RegExp("^  "+k+": \"(.*)\",\r?$","m"));
  console.log(k, m ? JSON.stringify(m[1]) : "MISSING");
}'
```

Expected: real `ü`/`ä` characters in the output, no `ü`, no `ue`.

- [ ] **Step 4: Typecheck key parity**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. A missing DE key is a tsc error, not a runtime one.

- [ ] **Step 5: Run the encoding gate**

```bash
npx vitest run src/app/i18n-encoding --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: add EN/DE strings for the undo history listbox and the AI stop label
EOF
```

---

## Task 4: The undo/redo history listbox

**Files:**
- Modify: `src/app/undo/undo-control.tsx`
- Test: `src/app/undo/undo-control.test.tsx`

The caret's `PopoverPanel` keeps `role="dialog"` and gains an inner `<ul role="listbox">`.

★ `PopoverPanel`'s `role` prop is typed `"dialog" | "menu"` (`popover-panel.tsx:40`). Do **not** widen that union — the panel is a portaled dismissal container and the listbox is its content.

★★ Each option's accessible name appends its stack position. The top bar is axe-scanned in every one of the 17 `A11Y_VIEWS`, and `buildUndoLabel` legitimately produces two identical labels for two edits to the same named row — a WCAG 2.4.6 duplicate the gate passes whenever the seed renders a single row.

★ `aria-selected` belongs to the **active option only**. The band across rows `0..activeIndex` is a visual grouping; the footer count is what tells a screen-reader user how many entries Enter reverts.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/undo/undo-control.test.tsx`:

```tsx
// ★ `kind` must be a real ActivityKind member and must NOT widen to string.
//   "task.edited" DOES NOT EXIST — the task members are task.created /
//   task.updated / task.deleted / task.completed / task.reopened
//   (`activity-log.ts:13-17`). An invented literal or a widened `string` both
//   run green under vitest (which never typechecks) and fail ONLY tsc in CI.
//   Measured on this branch in Tasks 1-2.
const meta = (id: number, label: string) => ({
  id, kind: "task.updated" as const, count: 1, timestamp: "2026-08-08T00:00:00.000Z", label,
});

// Stack order is oldest-first, matching UndoStackApi.stack.
const STACK = [meta(1, 'Edit task "A"'), meta(2, 'Edit task "A"'), meta(3, 'Delete 2 tasks')];

function renderUndo(onUndoThrough = vi.fn(), onUndo = vi.fn()) {
  render(
    <UndoControl lang="en-US" entries={STACK} onUndo={onUndo} onUndoThrough={onUndoThrough} />,
  );
  return { onUndoThrough, onUndo };
}

describe("UndoControl history listbox", () => {
  it("lists every entry newest-first inside a listbox", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Delete 2 tasks");
  });

  it("gives duplicate labels UNIQUE accessible names by stack position", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const names = screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("hovering row n marks rows 0..n as banded and updates the footer count", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    expect(options.filter((o) => o.getAttribute("data-banded") === "true")).toHaveLength(3);
    expect(screen.getByText(t("en-US", "undoNActions", 3))).toBeInTheDocument();
  });

  it("marks ONLY the active option aria-selected, not the whole band", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });

  it("arrow keys move the active option and Enter commits through it", async () => {
    const { onUndoThrough } = renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Display order is newest-first, so index 2 is the OLDEST entry, id 1.
    expect(onUndoThrough).toHaveBeenCalledWith(1);
  });

  it("exposes one tab stop, driving the active option via aria-activedescendant", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("aria-activedescendant");
    expect(screen.getAllByRole("option").every((o) => o.getAttribute("tabindex") === null)).toBe(true);
  });

  it("renders nothing for an empty stack", () => {
    render(<UndoControl lang="en-US" entries={[]} onUndo={vi.fn()} onUndoThrough={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

Keep the file's existing imports and add `userEvent` / `vi` if absent.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/undo/undo-control.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — the component does not accept `entries` yet.

- [ ] **Step 3: Write the implementation**

Replace `UndoRedoControl`'s props and popover body in `src/app/undo/undo-control.tsx`. The full new inner component:

```tsx
function UndoRedoControl({
  entries,
  onActivate,
  onActivateThrough,
  actionLabel,
  labelKey,
  showNextKey,
  historyLabelKey,
  countKey,
  lang,
  icon,
}: {
  /** Oldest-first, exactly as `UndoStackApi.stack` provides it. */
  entries: readonly UndoMeta[];
  onActivate: () => void;
  onActivateThrough: (id: number) => void;
  actionLabel: string;
  labelKey: TranslationKey;
  showNextKey: TranslationKey;
  historyLabelKey: TranslationKey;
  countKey: TranslationKey;
  lang: Lang;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const caretRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const depth = entries.length;
  // Display order is newest-first; `entries` arrives oldest-first.
  const options = useMemo(() => [...entries].reverse(), [entries]);

  const openList = useCallback(() => {
    setActiveIndex(0);
    setOpen(true);
  }, []);

  if (depth <= 0) return null;

  const listId = `undo-history-${labelKey}`;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivateThrough(options[activeIndex].id);
      close();
    }
  };

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={onActivate}
        aria-label={actionLabel}
        title={actionLabel}
        className={`${BUTTON_CLASS} rounded-r-none border-r-0 ${INTERACTIVE}`}
      >
        {icon}
        <span>{t(lang, labelKey)}</span>
        <span className="rounded-full bg-ui-medium-grey px-1.5 text-xs text-white">{depth}</span>
      </button>
      <button
        ref={caretRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        aria-label={t(lang, showNextKey)}
        title={t(lang, showNextKey)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${BUTTON_CLASS} rounded-l-none px-1 ${INTERACTIVE}`}
      >
        {/* Chevron (decorative — aria-label carries the name) */}
        <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <PopoverPanel
        open={open}
        anchorRef={caretRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, historyLabelKey)}
        className="w-72 p-2"
      >
        {/* One tab stop; the active option is announced via aria-activedescendant,
            so the <li>s carry no tabindex. */}
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={t(lang, historyLabelKey)}
          aria-activedescendant={optionId(activeIndex)}
          onKeyDown={onKeyDown}
          autoFocus
          className="max-h-64 overflow-y-auto focus:outline-none focus:ring-2 focus:ring-ui-green"
        >
          {options.map((m, i) => {
            const banded = i <= activeIndex;
            return (
              <li
                key={m.id}
                id={optionId(i)}
                role="option"
                // ★★ The position suffix is what keeps names unique — two edits
                //    to the same named row produce an identical `label`.
                aria-label={t(lang, "undoHistoryOption", m.label, i + 1)}
                aria-selected={i === activeIndex}
                data-banded={banded}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => { onActivateThrough(m.id); close(); }}
                className={`cursor-pointer rounded px-2 py-1 text-sm ${
                  banded ? "bg-surface-muted text-ui-dark-blue dark:text-ui-light-grey" : "text-muted-foreground"
                }`}
              >
                {m.label}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 border-t border-line pt-2 text-xs font-medium text-muted-foreground">
          {t(lang, countKey, activeIndex + 1)}
        </p>
      </PopoverPanel>
    </span>
  );
}
```

Update the imports at the top of the file: add `useMemo` to the React import and `import { type UndoMeta } from "./undo-stack";`.

Then update both exported wrappers:

```tsx
interface UndoControlProps {
  lang: Lang;
  /** The undo stack, oldest-first. Empty → the control renders nothing. */
  entries: readonly UndoMeta[];
  onUndo: () => void;
  onUndoThrough: (id: number) => void;
}

/** Top-bar undo button + a caret opening the multi-step history. */
export function UndoControl({ lang, entries, onUndo, onUndoThrough }: UndoControlProps) {
  return (
    <UndoRedoControl
      entries={entries}
      onActivate={onUndo}
      onActivateThrough={onUndoThrough}
      actionLabel={t(lang, "undoTooltip")}
      labelKey="undo"
      showNextKey="undoShowNext"
      historyLabelKey="undoHistoryLabel"
      countKey="undoNActions"
      lang={lang}
      icon={
        // Undo arrow (decorative — aria-label carries the name)
        <ArrowUturnLeftIcon aria-hidden="true" className="h-4 w-4" />
      }
    />
  );
}

interface RedoControlProps {
  lang: Lang;
  /** The redo stack, oldest-first. Empty → the control renders nothing. */
  entries: readonly UndoMeta[];
  onRedo: () => void;
  onRedoThrough: (id: number) => void;
}

/** Top-bar redo button + multi-step history — mirror of {@link UndoControl}. */
export function RedoControl({ lang, entries, onRedo, onRedoThrough }: RedoControlProps) {
  return (
    <UndoRedoControl
      entries={entries}
      onActivate={onRedo}
      onActivateThrough={onRedoThrough}
      actionLabel={t(lang, "redoTooltip")}
      labelKey="redo"
      showNextKey="redoShowNext"
      historyLabelKey="redoHistoryLabel"
      countKey="redoNActions"
      lang={lang}
      icon={
        // Redo arrow — horizontal mirror of the undo arrow (decorative; aria-label carries the name)
        <ArrowUturnRightIcon aria-hidden="true" className="h-4 w-4" />
      }
    />
  );
}
```

The old `nextHeadingKey` / `nextLabel` props and the `hasPreview` branch are gone. Remove `undoNextLabel` / `redoNextLabel` from `i18n.ts` and `i18n.de.ts` **only if** `grep -rn "undoNextLabel\|redoNextLabel" src/ e2e/` returns nothing else; do it in this same commit if so.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/undo/undo-control.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t4.log
```

Expected: `EXIT=0`. Existing tests in this file that asserted the old preview `<p>` will fail — rewrite them against the listbox rather than deleting them.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: non-zero until Task 5 updates the call sites. That is fine; note it and continue.

- [ ] **Step 6: Commit**

```bash
git add src/app/undo/undo-control.tsx src/app/undo/undo-control.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: replace the undo caret preview with a multi-step history listbox

The PopoverPanel keeps role="dialog" and gains an inner role="listbox"; the
panel's role union is deliberately not widened for one caller.

One activeIndex drives the band, the footer count and aria-activedescendant, so
the drawn and announced states cannot disagree. Each option's accessible name
appends its stack position — buildUndoLabel can produce two identical labels,
and the top bar is axe-scanned in every view.
EOF
```

---

## Task 5: Wire the two top-bar call sites

**Files:**
- Modify: `src/app/task-manager.tsx:2574-2579`

Both header mounts (classic `AppHeader` and the modern `TopBar` trailing slot) are built together in `buildShellChrome` from this one element, so a single edit reaches both.

- [ ] **Step 1: Replace the element**

```tsx
  const undoControlEl = isPopout ? null : (
    <>
      <UndoControl
        lang={lang}
        entries={undoApi.stack}
        onUndo={undoApi.undo}
        onUndoThrough={undoApi.undoThrough}
      />
      <RedoControl
        lang={lang}
        entries={undoApi.redoStack}
        onRedo={undoApi.redo}
        onRedoThrough={undoApi.redoThrough}
      />
    </>
  );
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 3: Run the full unit suite**

```bash
npm run test:run > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t5.log
```

Expected: `EXIT=0`. If `task-manager.characterization.test.tsx` fails, it is pinning the prop contract — update the expectation, do not weaken the test.

- [ ] **Step 4: Commit**

```bash
git add src/app/task-manager.tsx
git commit -F - <<'EOF'
feat: pass the full undo/redo stacks to the top-bar history controls

One element feeds both header mounts via buildShellChrome, so this reaches the
classic AppHeader and the modern TopBar slot together.
EOF
```

---

## Task 6: `ai-trigger-button.tsx`

**Files:**
- Create: `src/app/ai-trigger-button.tsx`
- Test: `src/app/ai-trigger-button.test.tsx`

★ The label must flip **with the action**. A control reading "Asking Claude…" whose click aborts is WCAG 2.5.3 (F96) — the trap `use-raci-suggest.tsx` already documents for its own thinking label.

- [ ] **Step 1: Write the failing test**

Create `src/app/ai-trigger-button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiTriggerButton } from "./ai-trigger-button";
import { t } from "./i18n";

describe("AiTriggerButton", () => {
  it("shows the feature label and runs when idle", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiTriggerButton lang="en-US" busy={false} onRun={onRun} onCancel={onCancel} idleLabelKey="aiSuggest" />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "aiSuggest") });
    await userEvent.click(btn);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("flips BOTH the visible label and the accessible name to Stop when busy", () => {
    render(
      <AiTriggerButton lang="en-US" busy onRun={vi.fn()} onCancel={vi.fn()} idleLabelKey="aiSuggest" />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "aiStop") });
    // WCAG 2.5.3: the visible text must be part of the accessible name.
    expect(btn).toHaveTextContent(t("en-US", "aiStop"));
    expect(btn).not.toHaveTextContent(t("en-US", "aiSuggest"));
  });

  it("routes the click to onCancel while busy", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiTriggerButton lang="en-US" busy onRun={onRun} onCancel={onCancel} idleLabelKey="aiSuggest" />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "aiStop") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
  });
});
```

Replace `"aiSuggest"` with a `TranslationKey` that actually exists — confirm with `grep -n "aiSuggest" src/app/i18n.ts` and substitute a real key if it does not.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/ai-trigger-button.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/ai-trigger-button.tsx`:

```tsx
"use client";
import { type ReactNode } from "react";
import { StopIcon } from "@heroicons/react/24/outline";
import { Button } from "./button";
import { t, type Lang, type TranslationKey } from "./i18n";

/**
 * The shared trigger for every AI feature that can be stopped mid-flight.
 *
 * ★ While busy, the VISIBLE label and the ACCESSIBLE NAME both become "Stop"
 *   and the click aborts. A control whose visible text names something other
 *   than what a click does is WCAG 2.5.3 (F96) — which is why this never shows
 *   a progress label like "Asking Claude…" on the button itself. Put progress
 *   text beside the button if a surface needs it.
 *
 * Purely presentational: the caller's own busy flag and cancel function drive
 * it, so the five features that already own an AbortController keep it.
 */
export function AiTriggerButton({
  lang,
  busy,
  onRun,
  onCancel,
  idleLabelKey,
  idleIcon,
  disabled,
  className,
}: {
  lang: Lang;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  idleLabelKey: TranslationKey;
  idleIcon?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const label = busy ? t(lang, "aiStop") : t(lang, idleLabelKey);
  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={busy ? onCancel : onRun}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={className}
    >
      {busy ? <StopIcon aria-hidden="true" className="h-4 w-4" /> : idleIcon}
      <span>{label}</span>
    </Button>
  );
}
```

★ Keep a real `disabled` attribute. An `aria-disabled` lookalike still fires `onClick`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/ai-trigger-button.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Confirm the size variant exists**

```bash
grep -n "ButtonSize" -A 6 src/app/button.tsx
```

If `xs` is not a member, use the smallest that is and note the substitution in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/app/ai-trigger-button.tsx src/app/ai-trigger-button.test.tsx
git commit -F - <<'EOF'
feat: add AiTriggerButton, the shared idle-to-Stop AI trigger

Busy flips the visible label AND the accessible name to Stop and routes the
click to onCancel — a control whose visible text names something other than
what a click does is WCAG 2.5.3 (F96).

Presentational only: the caller supplies busy and cancel, so the five AI paths
that already own an AbortController keep theirs.
EOF
```

---

## Task 7: `use-abortable-ai.ts` and the one site that needs it

**Files:**
- Create: `src/app/use-abortable-ai.ts`
- Test: `src/app/use-abortable-ai.test.tsx`
- Modify: `src/app/use-insight-recommend.ts`

Of the six AI trigger sites, five already hold an `AbortController`:

| Site | Controller |
|---|---|
| `use-raci-suggest.tsx` | `:131` |
| `use-alloc-plan.tsx` | `:86` |
| `use-tasks-dedup.tsx` | `:82` |
| `use-inline-entity-edit.ts` (backs `inline-ai-edit-popover.tsx`) | `:74` |
| `use-ai-orchestration.ts` → `useActionAnalysis` | `use-action-analysis.ts:18` |

Only `use-insight-recommend` has none — and `runInsightRecommendation` already accepts `args.signal` (`insights/recommend-call.ts`), so this is a controller ref, not a new call path.

★ The five are **not** refactored onto the helper. AGENTS.md's shared-SSRF-core rule is explicit that divergent-but-correct chains do not get parameterised into one factory.

- [ ] **Step 1: Write the failing test**

Create `src/app/use-abortable-ai.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAbortableAi } from "./use-abortable-ai";

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

describe("useAbortableAi", () => {
  it("is idle before a run and busy during one", async () => {
    const { result } = renderHook(() => useAbortableAi());
    expect(result.current.busy).toBe(false);
    let release!: (v: string) => void;
    const pending = new Promise<string>((r) => { release = r; });
    let done!: Promise<string | null>;
    act(() => { done = result.current.run(() => pending); });
    expect(result.current.busy).toBe(true);
    await act(async () => { release("ok"); await done; });
    expect(result.current.busy).toBe(false);
  });

  it("returns null and surfaces NO error when the call aborts", async () => {
    const { result } = renderHook(() => useAbortableAi());
    let out: string | null = "unset";
    await act(async () => { out = await result.current.run(() => Promise.reject(abortError())); });
    expect(out).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("surfaces a non-abort error and returns to idle", async () => {
    const { result } = renderHook(() => useAbortableAi());
    await act(async () => { await result.current.run(() => Promise.reject(new Error("boom"))); });
    expect(result.current.error).toBe("boom");
    expect(result.current.busy).toBe(false);
  });

  it("cancel() aborts the in-flight signal", async () => {
    const { result } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    act(() => {
      void result.current.run((signal) => { seen.push(signal); return new Promise<string>(() => {}); });
    });
    expect(seen[0].aborted).toBe(false);
    act(() => { result.current.cancel(); });
    expect(seen[0].aborted).toBe(true);
  });

  it("starting a new run aborts the previous one", async () => {
    const { result } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    const never = (signal: AbortSignal) => { seen.push(signal); return new Promise<string>(() => {}); };
    act(() => { void result.current.run(never); });
    act(() => { void result.current.run(never); });
    expect(seen[0].aborted).toBe(true);
    expect(seen[1].aborted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/use-abortable-ai.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/use-abortable-ai.ts`:

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "./abort-error";

/**
 * The `busy` + `AbortController` + `cancel` triple that every stoppable AI
 * trigger needs, for the ONE site that did not already have it.
 *
 * ★ The five paths that already own a controller are deliberately NOT
 *   refactored onto this. They are working, tested code with divergent
 *   surrounding logic, and parameterising divergent-but-correct chains into one
 *   factory is the move AGENTS.md's shared-SSRF-core rule exists to prevent.
 *
 * ★ An AbortError is a USER-INITIATED STOP, not a failure: `run` resolves to
 *   null, `error` stays null and nothing is toasted.
 */
export function useAbortableAi() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const run = useCallback(async <T,>(call: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    abortRef.current?.abort();           // a new run supersedes the billed one in flight
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      return await call(controller.signal);
    } catch (e) {
      if (isAbortError(e)) return null;
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, []);

  return { busy, error, run, cancel };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/use-abortable-ai.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Adopt it in `use-insight-recommend.ts`**

Read `src/app/use-insight-recommend.ts` in full first — it tracks per-item busy state rather than the single flag `use-action-analysis.ts` uses, and its own header comment says so. Replace its bare `await runInsightRecommendation({...})` with a `run` call that threads the signal:

```ts
const ai = useAbortableAi();
// …
const rec = await ai.run((signal) => runInsightRecommendation({ ...args, signal }));
if (rec == null) return;   // aborted or already-surfaced error
```

Preserve the existing per-item busy map; `ai.busy` is the global in-flight flag the trigger button reads.

- [ ] **Step 6: Read the other five catch paths and record what you find**

```bash
grep -n "AbortError\|isAbortError" src/app/use-raci-suggest.tsx src/app/use-alloc-plan.tsx \
  src/app/use-tasks-dedup.tsx src/app/use-inline-entity-edit.ts src/app/use-action-analysis.ts
```

Confirm each returns to idle with **no** toast and **no** error banner on abort. Three route through the shared `isAbortError`; `use-raci-suggest` and `use-alloc-plan` hand-roll `errName === "AbortError"`. Do not unify that divergence in this slice — note it in the commit body.

- [ ] **Step 7: Run the affected suites**

```bash
npx vitest run src/app/use-abortable-ai.test.tsx src/app/use-insight-recommend --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/use-abortable-ai.ts src/app/use-abortable-ai.test.tsx src/app/use-insight-recommend.ts
git commit -F - <<'EOF'
feat: give the insight-recommend call an AbortController

It was the only one of the six AI trigger sites without one. runInsightRecommendation
already accepted a signal, so this threads it rather than adding a call path.

The other five keep their own controllers: they are working, tested code with
divergent surrounding logic, and folding them into one factory is the move the
shared-SSRF-core rule exists to prevent. Verified all five classify AbortError
as a user stop; use-raci-suggest and use-alloc-plan hand-roll the check rather
than using isAbortError, which is left alone here.
EOF
```

---

## Task 8: Mount `AiTriggerButton` at all six sites

**Files:**
- Modify: the trigger render site of each of the six features.

Locate them with:

```bash
grep -rn "raciSuggest\|allocPlan\|dedup\|inlineAiEdit\|insightRecommend\|analyzeWithAi" src/app --include=*.tsx | grep -v "\.test\." | head -30
```

- [ ] **Step 1: Replace each hand-rolled trigger**

For every site, pass the feature's existing busy flag and cancel function:

```tsx
<AiTriggerButton
  lang={lang}
  busy={raci.busy}
  onRun={raci.suggest}
  onCancel={raci.cancel}
  idleLabelKey="raciSuggest"
/>
```

★ Do not change any feature's busy semantics. If a site tracks per-item busy (insights), pass the global in-flight flag, not the per-item one — the button must stop what is actually running.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 3: Run the full unit suite**

```bash
npm run test:run > /tmp/t8.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t8.log
```

Expected: `EXIT=0`. Existing tests that queried a trigger by its old accessible name will fail — update the query, do not loosen it to a regex that would also match "Stop".

- [ ] **Step 4: Lint at the CI gate**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0`. An unused import left behind by a replaced trigger is **fatal** in CI.

- [ ] **Step 5: Commit**

```bash
git add -u src/app
git commit -F - <<'EOF'
feat: give every AI trigger a Stop affordance

All six trigger sites now render AiTriggerButton, so no AI call is
uncancellable and the affordance is identical across features.
EOF
```

---

## Task 9: `budget-bucket-people.ts` engine

**Files:**
- Create: `src/app/budget-bucket-people.ts`
- Test: `src/app/budget-bucket-people.test.ts`

Types you need (already in the repo):

```ts
// types.ts:594
BucketAllocation = { roleId: number; resourceIds: number[]; /* … */ }
// timelog-actuals.ts:6,19
HourCell = { hours: number; billableHours: number }
BucketPeriodCell = HourCell & { byResource?: Record<number, HourCell> }
```

★★ `byResource` is **optional on purpose** — the actuals cache can predate it, and `timelog-actuals.ts:14-19` records what guessing costs: attributing every person to `allocations[0]` charged them all at the first role's rate. A period with no breakdown yields `null`, never `0`. A fabricated zero on a cost surface is worse than a dash.

★ Planned capacity is **passed in**, not computed here. `periodCapacityHours` needs the holiday set, `workdayHours` and the resource's filtered absences; taking those as engine inputs would drag settings plumbing into a pure module.

- [ ] **Step 1: Write the failing tests**

Create `src/app/budget-bucket-people.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildBucketPeopleRows } from "./budget-bucket-people";

const PERIODS = [{ key: "2026-01", start: "2026-01-01", end: "2026-01-31" }];

const resources = [
  { id: 1, name: "Zoe", roleId: 10 },
  { id: 2, name: "Adam", roleId: 10 },
  { id: 3, name: "Mia", roleId: 10 },
  { id: 4, name: "Other", roleId: 99 },
] as never[];

const cell = (byResource?: Record<number, { hours: number; billableHours: number }>) => ({
  hours: 0, billableHours: 0, byResource,
});

describe("buildBucketPeopleRows", () => {
  it("includes plan-line members first, alphabetically, then the rest alphabetically", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1, 2] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 3: { hours: 4, billableHours: 4 } }) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 }, 2: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows.map((r) => r.name)).toEqual(["Adam", "Zoe", "Mia"]);
    expect(rows.map((r) => r.hasPlanLine)).toEqual([true, true, false]);
  });

  it("excludes a booker whose role does not match the allocation", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 4: { hours: 9, billableHours: 9 } }) },
      plannedByResourcePeriod: {},
      periods: PERIODS,
    });
    // Role 99 has no line in this bucket — those hours stay in `unattributed`.
    expect(rows).toEqual([]);
  });

  it("gives a no-plan-line member null planned for every period", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 3: { hours: 4, billableHours: 4 } }) },
      plannedByResourcePeriod: { 3: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows[0].planned["2026-01"]).toBeNull();
    expect(rows[0].plannedTotal).toBeNull();
  });

  // ★★ THE TRAP: a fixture with byResource present everywhere cannot tell
  //    `null` from `0`. This period deliberately has NO breakdown.
  it("yields NULL booked — never 0 — for a period whose cell has no byResource", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell(undefined) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows[0].booked["2026-01"]).toBeNull();
    expect(rows[0].booked["2026-01"]).not.toBe(0);
  });

  it("yields 0 — not null — when the breakdown exists but omits this person", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell({ 2: { hours: 5, billableHours: 5 } }) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 } },
      periods: PERIODS,
    });
    expect(rows.find((r) => r.resourceId === 1)!.booked["2026-01"]).toBe(0);
  });

  it("sums totals across periods, skipping null cells", () => {
    const periods = [
      { key: "2026-01", start: "2026-01-01", end: "2026-01-31" },
      { key: "2026-02", start: "2026-02-01", end: "2026-02-28" },
    ];
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: {
        "2026-01": cell({ 1: { hours: 6, billableHours: 6 } }),
        "2026-02": cell(undefined),
      },
      plannedByResourcePeriod: { 1: { "2026-01": 8, "2026-02": 8 } },
      periods,
    });
    expect(rows[0].bookedTotal).toBe(6);
    expect(rows[0].plannedTotal).toBe(16);
  });

  it("gives a NULL booked total when every period is unknown", () => {
    const rows = buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [1] },
      resources,
      actualsByPeriod: { "2026-01": cell(undefined) },
      plannedByResourcePeriod: { 1: { "2026-01": 8 } },
      periods: PERIODS,
    });
    // A total of 0 across all-unknown periods is the same fabricated zero the
    // per-cell null exists to prevent.
    expect(rows[0].bookedTotal).toBeNull();
  });

  it("returns an empty list when the bucket has neither members nor bookings", () => {
    expect(buildBucketPeopleRows({
      allocation: { roleId: 10, resourceIds: [] },
      resources,
      actualsByPeriod: {},
      plannedByResourcePeriod: {},
      periods: PERIODS,
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/budget-bucket-people.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/budget-bucket-people.ts`:

```ts
// Pure, i18n-free: which people sit behind one bucket role line, and what they
// booked against what they were planned. No React, no clock, no DOM.
import type { BucketAllocation, Resource } from "./types";
import type { BucketPeriodCell } from "./timelog-actuals";
import type { Period } from "./resource-capacity";

export interface PersonRow {
  readonly resourceId: number;
  readonly name: string;
  /** True when this person is on the allocation's plan (`resourceIds`). */
  readonly hasPlanLine: boolean;
  /** null = the period's actuals cell carries NO per-resource breakdown, so the
   *  figure is UNKNOWN. Never conflate that with a real zero. */
  readonly booked: Readonly<Record<string, number | null>>;
  readonly planned: Readonly<Record<string, number | null>>;
  readonly bookedTotal: number | null;
  readonly plannedTotal: number | null;
}

export interface BucketPeopleArgs {
  readonly allocation: Pick<BucketAllocation, "roleId" | "resourceIds">;
  readonly resources: readonly Resource[];
  /** This bucket's actuals, keyed by period key. */
  readonly actualsByPeriod: Readonly<Record<string, BucketPeriodCell>>;
  /** Resolved by the caller from `periodCapacityHours` — see the module note. */
  readonly plannedByResourcePeriod: Readonly<Record<number, Record<string, number>>>;
  readonly periods: readonly Period[];
}

export function buildBucketPeopleRows(args: BucketPeopleArgs): readonly PersonRow[] {
  const { allocation, resources, actualsByPeriod, plannedByResourcePeriod, periods } = args;
  const byId = new Map(resources.map((r) => [r.id, r]));

  const planned = new Set(allocation.resourceIds.filter((id) => byId.has(id)));

  // Anyone who booked on this bucket AND whose role matches this line. A booker
  // whose role has no line here is intentionally absent — those hours stay in
  // the existing `unattributed` total (recorded limit, not a defect).
  const bookers = new Set<number>();
  for (const p of periods) {
    const breakdown = actualsByPeriod[p.key]?.byResource;
    if (!breakdown) continue;
    for (const key of Object.keys(breakdown)) {
      const id = Number(key);
      const res = byId.get(id);
      if (res && res.roleId === allocation.roleId) bookers.add(id);
    }
  }

  const build = (id: number, hasPlanLine: boolean): PersonRow | null => {
    const res = byId.get(id);
    if (!res) return null;
    const booked: Record<string, number | null> = {};
    const plannedByPeriod: Record<string, number | null> = {};
    let bookedTotal = 0;
    // ★ A total of 0 across periods that are ALL unknown is the same fabricated
    //   zero the per-cell null exists to prevent — the total stays null unless
    //   at least one period actually reported.
    let anyBooked = false;
    let plannedTotal = 0;
    for (const p of periods) {
      const breakdown = actualsByPeriod[p.key]?.byResource;
      const cell = breakdown ? (breakdown[id]?.hours ?? 0) : null;
      booked[p.key] = cell;
      if (cell != null) { bookedTotal += cell; anyBooked = true; }
      const plan = hasPlanLine ? (plannedByResourcePeriod[id]?.[p.key] ?? 0) : null;
      plannedByPeriod[p.key] = plan;
      if (plan != null) plannedTotal += plan;
    }
    return {
      resourceId: id,
      name: res.name,
      hasPlanLine,
      booked,
      planned: plannedByPeriod,
      bookedTotal: anyBooked ? bookedTotal : null,
      plannedTotal: hasPlanLine ? plannedTotal : null,
    };
  };

  const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
  const planRows = [...planned].map((id) => build(id, true)).filter((r): r is PersonRow => r !== null).sort(byName);
  const extraRows = [...bookers].filter((id) => !planned.has(id))
    .map((id) => build(id, false)).filter((r): r is PersonRow => r !== null).sort(byName);

  return [...planRows, ...extraRows];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/budget-bucket-people.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Mutation-check the null branch**

Change `const cell = breakdown ? (breakdown[id]?.hours ?? 0) : null;` to `... ?? 0` unconditionally. Re-run step 4 — the "NULL booked, never 0" test **must fail**. Restore it.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-bucket-people.ts src/app/budget-bucket-people.test.ts
git commit -F - <<'EOF'
feat: add the pure budget bucket people-row engine

Membership is the plan-line members plus anyone who booked on this bucket under
the same role, plan-line first then alphabetical within each group.

booked is number|null: BucketPeriodCell.byResource is optional by design, and a
period with no breakdown is UNKNOWN, not zero. Rendering a fabricated zero on a
cost surface is the failure this distinction exists to prevent.

Planned capacity is passed in rather than computed, keeping the module free of
holiday-set and workday-hours plumbing.
EOF
```

---

## Task 10: `budget-panel-people-rows.tsx`

**Files:**
- Create: `src/app/budget-panel-people-rows.tsx`
- Test: `src/app/budget-panel-people-rows.test.tsx`

★★ Booked is **not** tinted. Small tinted text on these surfaces is this repo's documented AA trap — `--rag-amber-text` measured 3.5–4.4:1 as small text on dark and mockup schemes. The booked/planned distinction rides position and the `/` separator, so nothing here is colour-alone (WCAG 1.4.1).

★ The rows live in a `<tbody hidden>` keyed `bucketId:roleId`, **not** conditionally-rendered `<tr>`s — the disclosure's `aria-controls` target must stay in the DOM while collapsed, and a `<tbody>` keeps the cells in the same column grid.

- [ ] **Step 1: Write the failing test**

Create `src/app/budget-panel-people-rows.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BucketPeopleRows } from "./budget-panel-people-rows";
import type { PersonRow } from "./budget-bucket-people";

const PERIODS = [{ key: "2026-01", start: "2026-01-01", end: "2026-01-31" }];

const row = (over: Partial<PersonRow> = {}): PersonRow => ({
  resourceId: 1, name: "Adam", hasPlanLine: true,
  booked: { "2026-01": 6 }, planned: { "2026-01": 8 },
  bookedTotal: 6, plannedTotal: 8, ...over,
});

const renderRows = (rows: readonly PersonRow[], collapsed = false) =>
  render(
    <table><BucketPeopleRows id="people-1-10" rows={rows} periods={PERIODS} collapsed={collapsed} /></table>,
  );

describe("BucketPeopleRows", () => {
  it("renders booked / planned per period", () => {
    renderRows([row()]);
    expect(screen.getByText("Adam")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows a dash for planned when the person has no plan line", () => {
    renderRows([row({ hasPlanLine: false, planned: { "2026-01": null }, plannedTotal: null })]);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows a dash — NOT a zero — when booked is unknown for a period", () => {
    renderRows([row({ booked: { "2026-01": null }, bookedTotal: null })]);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("stays in the DOM while collapsed so aria-controls resolves", () => {
    const { container } = renderRows([row()], true);
    const body = container.querySelector("#people-1-10");
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute("hidden");
  });

  it("does not tint the booked figure", () => {
    renderRows([row()]);
    expect(screen.getByText("6").className).not.toMatch(/(^|\s)text-(ui|rag)-/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/budget-panel-people-rows.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/budget-panel-people-rows.tsx`:

```tsx
"use client";
import { DOT_COL_PX, TOTAL_COL_PX } from "./budget-panel-totals";
import type { PersonRow } from "./budget-bucket-people";
import type { Period } from "./resource-capacity";

const DASH = "—";

/**
 * The per-person booking rows behind one bucket role line.
 *
 * ★ A `<tbody hidden>`, never conditionally-rendered `<tr>`s: the disclosure's
 *   aria-controls target must stay in the DOM while collapsed, and a tbody
 *   keeps these cells in the same column grid as the role row above.
 *
 * ★★ Booked is NOT tinted. Small tinted text on these surfaces is this repo's
 *    documented AA trap; the booked/planned distinction rides position and the
 *    `/` separator, so nothing here is colour-alone (WCAG 1.4.1).
 *
 * Read-only by design — no cell border, so these can never be mistaken for the
 * editable budget cells above.
 */
export function BucketPeopleRows({
  id,
  rows,
  periods,
  collapsed,
}: {
  id: string;
  rows: readonly PersonRow[];
  periods: readonly Period[];
  collapsed: boolean;
}) {
  return (
    <tbody id={id} hidden={collapsed}>
      {rows.map((r) => (
        <tr key={r.resourceId} className="text-xs">
          <td style={{ width: DOT_COL_PX }} />
          <td className="truncate py-1 pl-6 pr-3 text-muted-foreground">{r.name}</td>
          <td style={{ width: TOTAL_COL_PX }} className="py-1 pr-3 text-right">
            <span className="text-foreground">{r.bookedTotal ?? DASH}</span>
            <span className="text-muted-foreground"> / {r.plannedTotal ?? DASH}</span>
          </td>
          {periods.map((p) => (
            <td key={p.key} className="py-1 pr-3 text-right">
              <span className="text-foreground">{r.booked[p.key] ?? DASH}</span>
              <span className="text-muted-foreground"> / {r.planned[p.key] ?? DASH}</span>
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
```

Confirm `DOT_COL_PX` / `TOTAL_COL_PX` are exported from `budget-panel-totals.ts` (`budget-panel.tsx:39` already imports both). If the leading-cell structure differs from the two-cell shape above, match `BucketRowLeadCells` exactly — the three pinned leading columns must line up.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/budget-panel-people-rows.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-panel-people-rows.tsx src/app/budget-panel-people-rows.test.tsx
git commit -F - <<'EOF'
feat: add the budget bucket people-row tbody

A <tbody hidden> rather than conditional <tr>s so the disclosure's aria-controls
target stays in the DOM while collapsed and the cells keep the parent table's
column grid.

Booked is untinted: the booked/planned distinction rides position and the
separator, so nothing carries meaning by colour alone.
EOF
```

---

## Task 11: Mount the people rows in `budget-panel.tsx`

**Files:**
- Modify: `src/app/budget-panel.tsx` (role rows at `:602-620`)

★ `budget-panel.tsx` is at **729** of the 800-line ratchet. Check your headroom before and after:

```bash
node -e "console.log(require('fs').readFileSync('src/app/budget-panel.tsx','utf8').split('\n').length)"
```

If the mount pushes it near 800, move the derivation into a small helper in `budget-panel-people-rows.tsx` rather than trimming comments.

- [ ] **Step 1: Add the disclosure state**

Near the panel's other `useState` calls:

```tsx
// bucketId:roleId keys. Collapsed by default; deliberately NOT persisted.
const [openPeople, setOpenPeople] = useState<ReadonlySet<string>>(() => new Set());
const togglePeople = useCallback((key: string) => {
  setOpenPeople((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
}, []);
```

- [ ] **Step 2: Wrap the role row and append the tbody**

Each role row currently renders as a bare `<tr key={a.roleId}>` (`:602`). Group each role row with its people tbody so the disclosure target is a sibling in the same table. Replace the row's label cell content with a `ToggleButton variant="disclosure"`:

```tsx
{(() => {
  const label = roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`;
  const key = `${bucket.id}:${a.roleId}`;
  const bodyId = `bucket-people-${bucket.id}-${a.roleId}`;
  const people = buildBucketPeopleRows({
    allocation: a,
    resources: props.resources,
    actualsByPeriod: actualsByBucket[bucket.id] ?? {},
    plannedByResourcePeriod,
    periods,
  });
  return (
    <>
      <tr key={a.roleId} className="border-t border-line">
        <BucketRowLeadCells
          label={
            <ToggleButton
              variant="disclosure"
              pressed={openPeople.has(key)}
              onToggle={() => togglePeople(key)}
              ariaControls={bodyId}
              // ★ Row-unique: N identical "Show people" names is a WCAG 2.4.6
              //   failure the axe gate passes when the seed renders one row.
              ariaLabel={`${t(lang, "budgetShowPeople")} – ${label}`}
              lang={lang}
            >
              {label}
            </ToggleButton>
          }
          /* …existing props unchanged… */
        />
        {/* …existing period cells unchanged… */}
      </tr>
      <BucketPeopleRows
        id={bodyId}
        rows={people}
        periods={periods}
        collapsed={!openPeople.has(key)}
      />
    </>
  );
})()}
```

★ `BucketRowLeadCells`'s `label` prop is typed `string` today. Widen it to `ReactNode` in `budget-panel-totals.tsx` — that is a one-word type change with no runtime effect.

★ `plannedByResourcePeriod` must be derived once per render from `periodCapacityHours`, not inside the map. Build it beside the panel's other memos:

```tsx
const plannedByResourcePeriod = useMemo(() => {
  const out: Record<number, Record<string, number>> = {};
  for (const r of props.resources) {
    const abs = absencesForResource(props.absences, r);
    out[r.id] = {};
    for (const p of periods) out[r.id][p.key] = periodCapacityHours(r, p, abs, workdayHours, holidaySet);
  }
  return out;
}, [props.resources, props.absences, periods, workdayHours, holidaySet]);
```

Use the panel's existing `workdayHours` / `holidaySet` values — grep for them rather than introducing new ones.

- [ ] **Step 3: Add the `budgetShowPeople` string**

EN in `i18n.ts`: `budgetShowPeople: "Show people",`
DE via the node UTF-8 write pattern from Task 3: `budgetShowPeople: "Personen anzeigen",`

★ The label names what `pressed` **enables**, per `ToggleButton`'s contract, and never flips.

- [ ] **Step 4: Typecheck, lint, size**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
```

Expected: all `0`.

- [ ] **Step 5: Run the budget suites**

```bash
npx vitest run src/app/budget --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t11.log
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add -u src/app
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: expand budget bucket role lines to per-person booking rows

The role label becomes a ToggleButton variant="disclosure" with a row-unique
accessible name — this is that variant's first production consumer, which
settles the open keep-or-delete question as keep.

Disclosure state is a Set of bucketId:roleId, collapsed by default and not
persisted. Planned capacity is derived once per render from periodCapacityHours
and passed into the pure engine.
EOF
```

---

## Task 12: §112 — the settings rail's wrapped layout

**Files:**
- Modify: `src/app/settings-view.tsx:271`
- Modify: `docs/open-followups.md` (§112)

The rail branch is `<div role="group" aria-label={…} className="flex flex-col gap-1">` inside a nav that is `flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col`. Below `md` the group becomes one flex *item*, so the active parent pill stretches to the group's full height — ~120px at 760px wide.

★★ The fix is **`max-md:basis-full`**, not `basis-full`. Above `md` the container is `flex-col`, where `flex-basis` resolves against the **main axis — height**; an unqualified `basis-full` would set the group to 100% height and break the desktop rail that is currently correct.

- [ ] **Step 1: Apply the class**

```tsx
<div role="group" aria-label={t(lang, labelKey)} className="flex flex-col gap-1 max-md:basis-full">
```

- [ ] **Step 2: Verify in a browser — nothing in the unit suite can see this**

jsdom has no layout and the axe gate scans one desktop viewport with no wrap-order rule. Start a fresh isolated server and measure:

```bash
PORT=3100 npm run dev
```

Then in a throwaway Playwright spec built on `e2e/seed.ts`, navigate to Settings, `page.setViewportSize({ width: 760, height: 900 })`, and read back the active parent pill's `boundingBox().height`. Expected: a single-row pill height (~36-40px), not ~120px. Re-measure at 1280px wide and confirm the desktop rail is unchanged.

```bash
PORT=3100 npm run stop
```

★ Four things silently block a seeded eye-verify run: the guided-tour overlay, `gotoApp` failing at narrow widths, the sidebar and rail sharing label text, and the AI disclaimer modal. Dismiss them in the spec's setup.

- [ ] **Step 3: Close §112**

In `docs/open-followups.md`, mark §112 closed with the measured before/after heights and the `max-md:` reason. Keep the entry — closed entries in this file are not compressible.

- [ ] **Step 4: Run the settings suites and the axe gate for Settings**

```bash
npx vitest run src/app/settings --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" --workers=1 > /tmp/axe12.log 2>&1; echo "AXE=$?"
```

Expected: both `0`.

★★★ `--workers=1` whenever more than one view is matched. Local runs default to CPU count while CI runs at one worker; over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and are **not** violations.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-view.tsx docs/open-followups.md
git commit -F - <<'EOF'
fix: stop the settings rail branch stretching its parent pill when wrapped

max-md: is load-bearing. Above the breakpoint the nav is flex-col, where
flex-basis resolves against the main axis — height — so an unqualified
basis-full would set the group to full height and break the desktop rail.

Measured in Chromium at 760px and 1280px; jsdom has no layout and the axe gate
scans one viewport, so neither can see this. Closes open-followups 112.
EOF
```

---

## Task 13: Seed insights and timelog links for e2e

**Files:**
- Modify: `e2e/seed.ts`

Neither slice exists in the curated master:

```bash
node -e 'const m=JSON.parse(require("fs").readFileSync("sample-workspace-small.json","utf8"));
  for (const k of ["insights","timelogLinks"]) console.log(k, m[k]==null?"ABSENT":"present")'
# insights ABSENT
# timelogLinks ABSENT
```

★ Author them in `e2e/seed.ts` **only**, via the existing `SEED_WORKSPACE` override that already augments `documents` for exactly this reason. Adding them to the master would force regenerating `-big`, `-huge` **and** the `__fixtures__/golden-*` byte-stability fixtures — putting a fixture regen inside a feature slice makes a real format change and a refresh indistinguishable in review.

Shapes (already in the repo):

```ts
// insights/insight.ts — types milestoneSlip|overdueTrend|stalledWork|budgetVariance|raidAging,
//                        severities high|medium|low, statuses active|acknowledged|acted|dismissed|…
// timelog-types.ts:39-51
TimelogUserLink    = { timelogUserId: number; resourceId: number; manual: boolean }
TimelogProjectLink = { timelogProjectId: number; bucketId: number | null; manual: boolean }
TimelogLinks       = { userLinks: […]; projectLinks: […]; customerId?: number; projectIds?: number[] }
```

- [ ] **Step 1: Add the rows to `SEED_WORKSPACE`**

```ts
const SEED_WORKSPACE: Record<string, unknown> = {
  ...SAMPLE_WORKSPACE,
  documents: [ /* …unchanged… */ ],
  // ★ e2e-only, like `documents` above: the master is hand-curated and the
  //   CSV/Markdown goldens are generated FROM it, so a test-only row there
  //   would force regenerating -big, -huge and every golden fixture.
  // ★ THREE insights, not one: per-row controls need a COLLISION to expose a
  //   WCAG 2.4.6 duplicate-name failure. One row passes whatever the labels say.
  insights: [
    {
      id: 9101, key: "milestoneSlip:1", type: "milestoneSlip", severity: "high",
      entityRef: { view: "milestones", id: 1 }, data: { days: 5 }, status: "active",
      firstSeenAt: "2026-06-01T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 2,
    },
    {
      id: 9102, key: "stalledWork:2", type: "stalledWork", severity: "medium",
      entityRef: { view: "open-points", id: 2 }, data: { days: 21 }, status: "acknowledged",
      firstSeenAt: "2026-06-02T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 3,
      acknowledgedAt: "2026-06-05T00:00:00.000Z",
    },
    {
      id: 9103, key: "budgetVariance:1", type: "budgetVariance", severity: "low",
      data: { variance: 12 }, status: "active",
      firstSeenAt: "2026-06-03T00:00:00.000Z", lastSeenAt: "2026-06-08T00:00:00.000Z", occurrences: 1,
    },
  ],
  timelogLinks: {
    userLinks: [
      { timelogUserId: 501, resourceId: 1, manual: true },
      { timelogUserId: 502, resourceId: 2, manual: false },
    ],
    projectLinks: [
      { timelogProjectId: 701, bucketId: 1, manual: true },
      { timelogProjectId: 702, bucketId: null, manual: false },
    ],
    customerId: 42,
    projectIds: [701, 702],
  },
};
```

★ Ids are far above the master's range so a later sample addition cannot collide — the same reason the seeded document uses `9001`.

- [ ] **Step 2: Register both in the `KV` map**

```ts
  const KV: Record<string, string> = {
    plan: "resource-plan", fxRates: "fx-rates", status: "project-status",
    milestones: "milestones", changes: "changes", stakeholders: "stakeholders", project: "project",
    documents: "documents", documentVersions: "documentVersions",
    insights: "insights", timelogLinks: "timelogLinks",
  };
```

Confirm the kv key strings against `browser-backend.ts` — the map's **value** is the IndexedDB kv key, and a wrong string seeds nothing while failing nothing.

Update the comment block above the map: it currently says eight slices go unseeded and that Insights is scanned empty. Both change here.

- [ ] **Step 3: Verify the spec still loads without browsers**

```bash
npx playwright test e2e/a11y.spec.ts --list > /tmp/list13.log 2>&1; echo "EXIT=$?"
grep -c "a11y:" /tmp/list13.log
```

Expected: `EXIT=0`. This also proves `e2e/seed.ts`'s module-top-level sample read still resolves — a stale path there ENOENTs the whole e2e job and fails only in CI.

- [ ] **Step 4: Run axe over the two newly-populated views**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights" --workers=1 > /tmp/axe13a.log 2>&1; echo "A=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Time bookings" --workers=1 > /tmp/axe13b.log 2>&1; echo "B=$?"
```

★★ Expect **real violations here** — this is the first time these panes have been scanned with rows. Seeding `documents` for the first time turned up a serious violation the empty state had been hiding. Read the failure **body**: a real violation names a rule id and an impact; a `Test timeout` names neither and is contention, not a defect.

Fix whatever the scan finds before continuing. If a finding is large enough to be its own slice, file it in `docs/open-followups.md` with the rule id and the measurement rather than leaving the gate red.

- [ ] **Step 5: Commit**

```bash
git add e2e/seed.ts
git commit -F - <<'EOF'
test: seed insights and timelog links for the e2e run

Both are absent from the curated master, so they are authored in seed.ts only —
adding them to sample-workspace-small.json would force regenerating -big, -huge
and every golden fixture, which makes a real format change and a refresh
indistinguishable in review.

Three insights rather than one: per-row controls need a collision before a
duplicate-name failure can render at scan time. Insights and Time bookings were
being scanned empty until now.
EOF
```

---

## Task 14: Full gate run

**Files:** none — verification only.

★★ Run these **serially**. Two vitest processes on one machine is the documented saturation condition behind this repo's load-sensitive flakes.

- [ ] **Step 1: Static gates**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
```

Expected: both `0`. Note the eslint command has **no pipe** — a `| grep` would report grep's status instead.

- [ ] **Step 2: Unit suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: `EXIT=0`. ★ If you see `Failed to start forks worker` alongside a passing-looking summary, the run **starved** — the only reliable signal is the file count being lower than usual. Re-run the affected files at `--maxWorkers=2`.

- [ ] **Step 3: Shuffled suite — the only local reproduction of the blocking CI gate**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/shuffle.log
```

Expected: `EXIT=0`. This slice adds tests, so this gate is mandatory before pushing.

- [ ] **Step 4: Coverage, size, duplication, symbols**

```bash
npm run test:coverage > /tmp/cov.log 2>&1;   echo "COV=$?"
npm run size:check   > /tmp/size.log 2>&1;   echo "SIZE=$?"
npm run dup:check    > /tmp/dup.log 2>&1;    echo "DUP=$?"
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"
```

Expected: all `0`. The three new `.ts` engines are coverage-gated; the two new `.tsx` files are excluded by the existing globs. If coverage drops, add tests — do not add the file to `coverage.exclude`.

- [ ] **Step 5: axe over every touched scanned view**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/axe.log 2>&1; echo "AXE=$?"
grep -E "passed|failed" /tmp/axe.log | tail -3
```

Expected: `AXE=0`. Warm the route first (`curl -o /dev/null http://localhost:3000/` until it returns fast) — the 60s per-test timeout also covers the first navigation's one-time Turbopack compile.

Re-measure the spec's own counts in the same run and correct `AGENTS.md` if the total moved:

```bash
npx playwright test e2e/a11y.spec.ts --list | grep -c "a11y:"
```

- [ ] **Step 6: Eye-verify what no gate can see**

On a fresh isolated server (`PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`):

1. **Undo listbox** — open the caret with ≥3 entries. Hover the third row: rows 1-3 band, the footer reads "Undo 3 actions". Arrow down/up moves the band. Enter reverts three edits in one step and fires one toast.
2. **§112** — the settings rail at 760px and at 1280px (Task 12 step 2).
3. **Budget people rows** — expand a role line. The person names align under the role column and the period cells align under their period headers; the `—` cases render where planned or booked is unknown.
4. **Slice-2 debts now reachable** — the timelog `danger` unlink button and the dashboard insight chips at narrow masonry width.

Record what you measured, not what you looked at.

- [ ] **Step 7: Commit any fixes**

```bash
git add -u
git commit -F - <<'EOF'
fix: address findings from the full gate and eye-verify pass
EOF
```

---

## Task 15: Release

**Files:**
- Modify: `src/app/version.ts` · `CHANGELOG.md` · `package.json` · `package-lock.json` · `README.md` · `docs/CODEMAPS/*.md` (5) · `src/app/i18n.ts` · `src/app/i18n.de.ts`

★★ **Eight version sites; five are gated by nothing.** They have silently drifted for eleven releases before.

- [ ] **Step 1: Pick a codename no release has used**

```bash
grep -oE '"[A-Z][a-z]+"' CHANGELOG.md | sort -u > /tmp/names.txt
wc -l /tmp/names.txt
```

Uniqueness is checked by no gate. Verify your pick is absent from that list.

- [ ] **Step 2: Bump `src/app/version.ts`**

`APP_VERSION` → `0.224.0`, `APP_BUILD_DATE` → the real date, milestone → the codename.

- [ ] **Step 3: Add the highlight string**

Append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` and add EN + DE strings. DE goes in via the node UTF-8 write pattern from Task 3 with `\r\n` anchors and real umlauts.

- [ ] **Step 4: Update the five ungated sites**

```bash
grep -n '"version"' package.json
grep -n '"version"' package-lock.json | head -3      # TWO occurrences: root and packages[""]
grep -n "shields.io" README.md
grep -n "Generated:" docs/CODEMAPS/*.md
```

Update every hit to the new version, and the README badge's **codename** too.

- [ ] **Step 5: Write the CHANGELOG entry**

Cover: the multi-step undo/redo history, the Stop affordance on all six AI triggers, budget bucket people rows, the settings-rail wrap fix (§112), and the newly seeded e2e slices.

- [ ] **Step 6: Verify every site agrees**

```bash
grep -rn "0\.224\.0" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/ CHANGELOG.md | wc -l
```

Expected: at least 9 hits (version.ts, package.json, package-lock ×2, README, 5 codemaps, CHANGELOG).

- [ ] **Step 7: Final gate re-run**

Repeat Task 14 steps 1-4. A version bump touches `i18n.ts`, so the parity typecheck and the encoding test must both pass again.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F - <<'EOF'
release: 0.224.0 "<codename>"

Multi-step undo/redo history, a Stop affordance on every AI trigger, budget
bucket people rows, and the settings-rail wrap fix (open-followups 112).
EOF
```

★★ Before pushing, audit what the commit actually contains — `git add -A` has previously swept an unrelated lockfile repair into a docs commit with every gate green:

```bash
git show --stat HEAD
```

- [ ] **Step 9: Stop**

Do **not** push, open an MR, or merge. Those happen only on an explicit instruction. When told to release: push → MR → poll the pipeline → merge **only** after it is green, never with auto-merge.

★★ Expect an `open-followups.md` numbering collision on merge. Main is the trunk and this branch renumbers; check the `## 1NN.` headings on **both** sides before resolving, and keep the filed-under number inside each entry because the commit messages naming it cannot be edited.

---

## Self-review notes

**Spec coverage.** §1 undo history → Tasks 1-5. §2 AI cancel → Tasks 6-8. §3 budget people rows → Tasks 9-11. §4 §112 → Task 12. §5 e2e seed → Task 13. Cross-cutting i18n → Task 3 and Task 11 step 3. Gates, axe, eye-verify → Task 14. Release → Task 15.

**Known gaps the executor must close, not skip:**

- Task 6 step 1 uses `"aiSuggest"` as a stand-in `TranslationKey`; grep and substitute a real one.
- Task 8 needs the six trigger render sites located by grep — the file list is not enumerated here because five of them are call sites inside larger panels.
- Task 10 assumes `BucketPeopleRows`' leading cells mirror `BucketRowLeadCells`; verify against the real component before trusting the column alignment.
- Task 13 step 2's kv key **values** must be checked against `browser-backend.ts`. A wrong string seeds nothing and fails nothing.
