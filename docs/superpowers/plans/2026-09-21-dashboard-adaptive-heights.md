# Dashboard Adaptive Heights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure Dashboard tile heights from their content on open and on density change (keeping any
height the user chose), merge the Progress tile into At a glance, and make the status summary a single
surface edited inline.

**Architecture:** The shared arrangement engine gains per-axis provenance flags (`wSet`/`hSet`) that
only `resizeBlock` writes and `reconcile` carries and sanitises. A pure `rowsForHeight` converts a
measured content height to a row count. A Dashboard-only hook measures in a `requestAnimationFrame`
callback and yields a render-time height override that is never persisted. The layout upgrade becomes an
ordered list of independently gated steps so a Progress-removal step can follow the existing burn step.

**Tech Stack:** Next.js (exact-pinned), React, TypeScript, Tailwind v4, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-dashboard-adaptive-heights-design.md` (revision 2). Read it
before any task. The plan argues from it; where they disagree, the spec wins and the plan is the defect.

## Global Constraints

- `src/app/*.ts(x)` is CRLF. Edit with the Edit tool, never `sed -i`. Check with `git ls-files --eol <file>` (healthy: `i/lf w/crlf`).
- `i18n.de.ts` is edited ONLY by a node utf8 write whose anchors use `\r\n`. The Edit tool corrupts umlauts and curls double quotes there. Re-verify line endings and umlauts after.
- `i18n.ts` and `i18n.de.ts` must hold identical key sets; `npx tsc --noEmit` enforces it. Test code calls `t()` with `"en-US"`, never `"en"`.
- Run `npx tsc --noEmit` after editing ANY test file. vitest never typechecks.
- Lint with `npx eslint --max-warnings=0 src`. Every warning is fatal. `react-hooks/set-state-in-effect` is fatal: never call `setState` synchronously in an effect body.
- `W_CLASS`/`H_CLASS` values stay whole literal strings. Never build a class name by interpolation (`row-span-${h}`). Tailwind v4 emits no CSS for it and no rendered test can see the difference.
- Never put a `*` inside a Tailwind arbitrary-value bracket in any tracked file, docs included.
- Never read an exit code through a pipe: redirect to a file, then `echo "EXIT=$?"` unpiped, then grep the file.
- vitest: `--reporter=dot`. Never run two vitest processes at once.
- Commit with explicit paths. No `git add -A`, no `--amend`, no `git stash`. Never stage `not-in-use.env.local.bak`.
- End every commit message with the session trailer. No `#` followed by digits in a commit message.
- Cite symbols, never `path:LINE`, in any doc under `docs/`. `npm run docs:claims:check` is a blocking ratchet on new line citations.
- ★★ Never write a count into a comment or doc. Write the recipe that produces it. The previous branch in this repo found seven counts that a later commit falsified; none of them needed to be a number.

## Review Focus

1. **A tile whose body finishes loading after the first frame.** Measurement runs once per trigger. A body that fills its box (`h-full`) measures as its box and keeps its height. A body with natural height that is still a skeleton when measured is sized to the skeleton until the next open. Expected: never smaller than `minH`. Pinned by `rowsForHeight`'s `minH` clamp tests (Task 2). A body that later outgrows its measured height scrolls inside the tile, which is this design's documented normal mode, until the next open re-measures it. That second half is accepted, not pinned.
2. **Reset after a manual resize.** A reset board must be measured again, not stay at the size the user had chosen. Pinned in Task 1 (Reset clears flags) and Task 3 (unflagged tiles are measured).
3. **A keyboard user choosing the height already shown in the ⋮ menu.** That is an explicit choice. It must stamp `hSet`, persist, and survive a reload. Pinned in Tasks 1 and 3.
4. **Clearing the status summary from inside the editor.** After Clear, the read-only area must show the "Add status summary" button, not a blank card and not nothing. Pinned in Task 6.
5. **Printing a measured board.** Heights measured for the screen stay applied under print media. Expected: no tile paints over another. Task 3 re-runs `e2e/print.spec.ts`'s "no dashboard tile paints over another".

---

### Task 1: Per-axis provenance in the arrangement engine

The engine is shared with Reports. Reports gets the flags and ignores them.

**Files:**
- Modify: `src/app/arrangement-layout.ts` (`PlacedBlock`, `resizeBlock`, `reconcile`, the file header's no-op paragraph)
- Test: `src/app/arrangement-layout.test.ts`, `src/app/dashboard-layout.test.ts`

**Interfaces:**
- Produces: `PlacedBlock<Id>` with optional `wSet?: true` and `hSet?: true`. `resizeBlock` stamps the axis it was asked to set. `reconcile` keeps a flag only when its value is exactly `true`.

- [ ] **Step 1: Write the failing tests** in `src/app/arrangement-layout.test.ts`, reusing the file's existing `CAT` catalogue and `DEF` default:

```ts
describe("per-axis provenance (hSet / wSet)", () => {
  it("stamps only the axis that was set", () => {
    const next = resizeBlock(CAT, DEF, "c", "h", 3);
    const c = next.board.find((b) => b.id === "c")!;
    expect(c.hSet).toBe(true);
    expect(c.wSet).toBeUndefined();
  });

  it("stamps an unflagged axis even when the value equals the stored one, and returns a NEW object", () => {
    const c0 = DEF.board.find((b) => b.id === "c")!;
    const next = resizeBlock(CAT, DEF, "c", "w", c0.w);
    expect(next).not.toBe(DEF);
    expect(next.board.find((b) => b.id === "c")!.wSet).toBe(true);
  });

  it("is a same-reference no-op when the value is unchanged AND the axis is already flagged", () => {
    const once = resizeBlock(CAT, DEF, "c", "w", 4);
    expect(resizeBlock(CAT, once, "c", "w", 4)).toBe(once);
  });

  it("reconcile carries a true flag through", () => {
    const stored = { v: 1 as const, hidden: [], board: [{ id: "c", w: 4, h: 3, hSet: true as const }] };
    expect(reconcile(CAT, stored, DEF).board.find((b) => b.id === "c")!.hSet).toBe(true);
  });

  it("reconcile drops a flag whose value is not exactly true, without rejecting the block", () => {
    const stored = { v: 1 as const, hidden: [], board: [{ id: "c", w: 4, h: 3, hSet: "yes" }] };
    const c = reconcile(CAT, stored as never, DEF).board.find((b) => b.id === "c")!;
    expect(c).toBeDefined();
    expect("hSet" in c).toBe(false);
  });

  it("reconcile keeps hSet through a clamp: a chosen height the clamp moves is still a choice", () => {
    const spec = CAT.find((s) => s.id === "c")!;
    const stored = { v: 1 as const, hidden: [], board: [{ id: "c", w: 4, h: 99, hSet: true as const }] };
    const c = reconcile(CAT, stored as never, DEF).board.find((b) => b.id === "c")!;
    expect(c.h).toBe(spec.maxH);
    expect(c.hSet).toBe(true);
  });

  it("reconcile drops junk keys a stored block carries", () => {
    const stored = { v: 1 as const, hidden: [], board: [{ id: "c", w: 4, h: 3, junk: 1 }] };
    const c = reconcile(CAT, stored as never, DEF).board.find((b) => b.id === "c")!;
    expect(Object.keys(c).sort()).toEqual(["h", "id", "w"]);
  });
});
```

★ Read the top of `arrangement-layout.test.ts` first and use its real catalogue and block ids. `"c"` above is a stand-in: if the file's catalogue has no id `"c"` with a height range above 3, pick one that does, and say which in the report. Do not add a new fixture when one exists.

Add one more to the same describe. It pins Review Focus 2: Reset writes the fallback by reference, so a reset board is flag-free only while the fallback itself carries no flags.

```ts
  it("the reset target carries no flags, so a reset board is measured again", () => {
    for (const b of defaultLayout(CAT).board) {
      expect("hSet" in b).toBe(false);
      expect("wSet" in b).toBe(false);
    }
  });
```

- [ ] **Step 2: Migrate the two tests the new contract inverts**

In `arrangement-layout.test.ts`, "returns the same object when a resize changes nothing" calls `resizeBlock(CAT, DEF, "c", "w", 4)` on an unflagged block and asserts `toBe(DEF)`. Under the new contract that call stamps `wSet`. Rewrite it to assert the no-op on a FLAGGED block:

```ts
it("returns the same object when a resize changes nothing on an already-chosen axis", () => {
  const chosen = resizeBlock(CAT, DEF, "c", "w", 4);
  expect(resizeBlock(CAT, chosen, "c", "w", 4)).toBe(chosen);
});
```

In `dashboard-layout.test.ts`, "returns the same object when the value does not change" calls `resizeTile(l, "raid", "w", 2)` unflagged. Rewrite it the same way, via a first `resizeTile` call that stamps. In the same file, "sets one axis without touching the other" asserts `toEqual({ id: "raid", w: 2, h: 4 })`. Change the expectation to `toEqual({ id: "raid", w: 2, h: 4, hSet: true })`.

- [ ] **Step 3: Run the tests and confirm the new ones FAIL for the right reason**

```bash
npx vitest run src/app/arrangement-layout.test.ts src/app/dashboard-layout.test.ts --reporter=dot > "$TEMP/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |AssertionError|expected" "$TEMP/t1.log" | head -30
```

Expected: FAIL. The stamping tests fail on `expected undefined to be true`, and the reconcile flag tests fail because `reconcile` rebuilds `{id, w, h}`. A compile error or an import failure is a broken test, not evidence. Fix the test and re-run until it fails on an assertion.

- [ ] **Step 4: Add the flags to `PlacedBlock`**

```ts
export interface PlacedBlock<Id extends string> {
  id: Id;
  w: BlockWidth;
  h: BlockHeight;
  /** Set by `resizeBlock` when the USER chose this axis. Absent = the value is a default.
   *  `reconcile` keeps it only when it is exactly `true`. */
  wSet?: true;
  hSet?: true;
}
```

- [ ] **Step 5: Rewrite the two branches of `resizeBlock`**

Replace each no-op test so it counts as a no-op only when the axis is ALREADY flagged:

```ts
  const board = [...layout.board];
  if (axis === "w") {
    const next = clampSpan(value, spec.minW, spec.maxW);
    if (layout.board[i].w === next && layout.board[i].wSet === true) return layout;
    board[i] = { ...board[i], w: next, wSet: true };
  } else {
    const next = clampSpan(value, spec.minH, spec.maxH);
    if (layout.board[i].h === next && layout.board[i].hSet === true) return layout;
    board[i] = { ...board[i], h: next, hSet: true };
  }
  return { ...layout, board };
```

Keep the two-branch shape and the comment above it. Do not collapse it into a computed `[axis]` key.

- [ ] **Step 6: Rewrite `reconcile`'s block literal so it carries and sanitises the flags**

The loop over `stored.board` currently pushes `{ id: p.id, w: clampSpan(...), h: clampSpan(...) }`. Replace that push with:

```ts
    board.push({
      id: p.id,
      w: clampSpan(p.w, spec.minW, spec.maxW),
      h: clampSpan(p.h, spec.minH, spec.maxH),
      // ★★ Exactly `true` or absent. This literal is also the ONLY place a stored block's junk
      // keys are dropped (the store's validator ignores extra keys), so a spread here would
      // let junk straight through into the saved layout.
      ...((p as { wSet?: unknown }).wSet === true ? { wSet: true as const } : {}),
      ...((p as { hSet?: unknown }).hSet === true ? { hSet: true as const } : {}),
    });
```

Leave the step-2 splice (`{ id: spec.id, w: spec.w, h: spec.h }`) alone: a newly added catalogue block is a default and carries no flag.

- [ ] **Step 7: Reword the file header's no-op paragraph**

The header says the four mutators return the same object reference on a no-op. Add the exception for `resizeBlock`: choosing a value on an axis with no flag stamps the flag and returns a new object even when the value is unchanged, because selecting a size is a choice; the same value on an already-flagged axis is still a same-reference no-op. Say why the exception is load-bearing: `useArrangement`'s `mutate` drops a same-reference result as "not dirty", so without the exception a user's explicit choice would never persist.

- [ ] **Step 8: Run the tests and confirm they pass**

```bash
npx vitest run src/app/arrangement-layout.test.ts src/app/dashboard-layout.test.ts src/app/use-arrangement.test.tsx --reporter=dot > "$TEMP/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$TEMP/t1.log"
npx tsc --noEmit; echo "TSC=$?"
```

Expected: all pass, `TSC=0`. `use-arrangement.test.tsx` is included because it exercises `resize` through `mutate`.

- [ ] **Step 9: Mutation-check the two guards, one at a time**

Before each run, predict which tests go red. Revert each mutant before the next.
- Delete `&& layout.board[i].hSet === true` from the `h` branch. Expected: the flagged no-op test and its migrated sibling go red.
- Replace the `reconcile` flag spread with `...p`. Expected: "drops a flag whose value is not exactly true" and "drops junk keys" go red.

Report the colour table. A mutant that turns nothing red is a missing test, not a pass.

- [ ] **Step 10: Commit**

```bash
git add src/app/arrangement-layout.ts src/app/arrangement-layout.test.ts src/app/dashboard-layout.test.ts
git commit -m "feat(arrangement): record which axis the user chose

A placed block gains optional wSet/hSet flags. resizeBlock stamps the axis it
sets, including when the value is unchanged, because choosing a size is a
choice. reconcile carries a flag only when it is exactly true, which also
keeps it the place a stored block's junk keys are dropped."
```

---

### Task 2: `rowsForHeight`, the pure conversion

**Files:**
- Create: `src/app/arrangement-measure.ts`
- Test: `src/app/arrangement-measure.test.ts`

**Interfaces:**
- Consumes: `BlockHeight` from `./arrangement-layout`.
- Produces: `rowsForHeight(contentPx, rowUnitPx, gapPx, nonBodyPx, minH, maxH): BlockHeight`.

★ Before creating `arrangement-measure.ts`, check that no `arrangement-measure.tsx` exists. A bare `./arrangement-measure` import resolves `.ts` ahead of `.tsx`, so a new `.ts` file would hijack an existing component of that name.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { rowsForHeight } from "./arrangement-measure";

// A tile spanning n rows is n*row + (n-1)*gap tall; nonBody of it is not body.
// With row 80, gap 16, nonBody 39: body(n) = 96n - 55  →  n=2: 137, n=3: 233, n=4: 329.
const R = 80, G = 16, NB = 39;

describe("rowsForHeight", () => {
  it("returns the smallest n whose body fits the content exactly at a boundary", () => {
    expect(rowsForHeight(137, R, G, NB, 1, 8)).toBe(2);
    expect(rowsForHeight(138, R, G, NB, 1, 8)).toBe(3);
  });
  it("clamps up to minH", () => {
    expect(rowsForHeight(10, R, G, NB, 2, 8)).toBe(2);
  });
  it("clamps down to maxH", () => {
    expect(rowsForHeight(100_000, R, G, NB, 1, 4)).toBe(4);
  });
  it("can SHRINK: content shorter than a tall tile needs few rows", () => {
    expect(rowsForHeight(120, R, G, NB, 1, 8)).toBe(2);
  });
  it("treats zero or non-finite content as minH", () => {
    expect(rowsForHeight(0, R, G, NB, 2, 8)).toBe(2);
    expect(rowsForHeight(Number.NaN, R, G, NB, 2, 8)).toBe(2);
  });
  it("treats a non-positive row unit as unmeasurable and returns minH", () => {
    expect(rowsForHeight(500, 0, G, NB, 2, 8)).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/arrangement-measure.test.ts --reporter=dot > "$TEMP/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find|Failed to resolve" "$TEMP/t2.log"
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement**

```ts
/**
 * Converts a measured content height into a tile row count.
 *
 * Pure and DOM-free, so it is fully unit-tested; the DOM reads live in the Dashboard's
 * measuring hook. Every pixel argument is READ from the page by the caller, never quoted —
 * this repo's hand-quoted chrome figure was once 11px wrong.
 *
 * A tile spanning n rows is `n * rowUnitPx + (n - 1) * gapPx` tall, of which `nonBodyPx` (header
 * plus section borders) is not body. Returns the smallest n whose body holds `contentPx`,
 * clamped to [minH, maxH].
 */
import type { BlockHeight } from "./arrangement-layout";

export function rowsForHeight(
  contentPx: number,
  rowUnitPx: number,
  gapPx: number,
  nonBodyPx: number,
  minH: BlockHeight,
  maxH: BlockHeight,
): BlockHeight {
  if (!(rowUnitPx > 0) || !Number.isFinite(contentPx) || contentPx <= 0) return minH;
  const perRow = rowUnitPx + gapPx;
  // body(n) = n*perRow - gapPx - nonBodyPx  →  smallest n with body(n) >= contentPx
  const n = Math.ceil((contentPx + nonBodyPx + gapPx) / perRow);
  return Math.max(minH, Math.min(maxH, n)) as BlockHeight;
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run src/app/arrangement-measure.test.ts --reporter=dot > "$TEMP/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$TEMP/t2.log"
npx tsc --noEmit; echo "TSC=$?"
```

- [ ] **Step 5: Mutation-check the boundary**

Change `Math.ceil` to `Math.floor`. Expected: the boundary test (`138 → 3`) goes red. Revert. Report.

- [ ] **Step 6: Commit**

```bash
git add src/app/arrangement-measure.ts src/app/arrangement-measure.test.ts
git commit -m "feat(arrangement): rowsForHeight converts a measured height to rows"
```

---

### Task 3: Measure on mount and on density change; render the measured height

**Files:**
- Modify: `src/app/arrangement-tile.tsx` (data attributes on the section and body)
- Modify: `src/app/arrangement-grid.tsx` (data attribute on the grid)
- Create: `src/app/use-measured-heights.ts`
- Modify: `src/app/dashboard-panel.tsx` (call the hook; route all three height readers through `renderedH`)
- Modify: `src/app/dashboard-tiles.ts` (`kpi` to `minH: 2, maxH: 4`; its docstring)
- Modify: `src/app/arrangement-block-menu.tsx` (the `kpi` fixed-height note)
- Test: `src/app/use-measured-heights.test.tsx`, `src/app/dashboard-grid.test.tsx`, `src/app/dashboard-layout.test.ts`
- Test: `e2e/dashboard-grid.spec.ts`

**Interfaces:**
- Consumes: `rowsForHeight` (Task 2), `PlacedBlock.hSet` (Task 1).
- Produces: `useMeasuredHeights({ density, tiles }): ReadonlyMap<string, BlockHeight>`, where each tile is `{ id, minH, maxH, flagged }`.

- [ ] **Step 1: Add the data attributes**

In `ArrangementTile`, add `data-arrangement-section=""` to the `<section>` and `data-arrangement-body=""` to the body `div` (the `min-h-0 flex-1 overflow-auto p-2` one). In `ArrangementGrid`, add `data-arrangement-grid=""` to the grid element. Change nothing else in either file: no wrapper around `{children}`. A wrapper of automatic height would collapse every `h-full` child. The spec explains why.

Run `npx vitest run src/app/report --reporter=dot` redirected to a file. Reports renders these components, and a Reports test that snapshots their markup would now change. Update such a snapshot only if the sole difference is the new attribute, and say so in the report.

- [ ] **Step 2: Write the hook's failing test** (`src/app/use-measured-heights.test.tsx`)

jsdom returns 0 for every rect, which is exactly the no-op path. Test that directly, then test the arithmetic by stubbing `getBoundingClientRect` on the elements the hook reads:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useMeasuredHeights } from "./use-measured-heights";

function Probe({ onResult, density }: { onResult: (m: ReadonlyMap<string, number>) => void; density: string }) {
  const m = useMeasuredHeights({
    density,
    tiles: [{ id: "a", minH: 2, maxH: 4, flagged: false }],
  });
  onResult(m);
  return (
    <div data-arrangement-grid="" style={{ gridAutoRows: "80px", rowGap: "16px" }}>
      <section data-arrangement-section="" data-tile-id="a">
        <div data-arrangement-body="" style={{ paddingTop: "8px", paddingBottom: "8px" }}>
          <div data-child="1" />
        </div>
      </section>
    </div>
  );
}

const flushRaf = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

afterEach(() => vi.restoreAllMocks());

describe("useMeasuredHeights", () => {
  it("measures nothing in jsdom, where every rect is 0, so no tile is overridden", async () => {
    let last: ReadonlyMap<string, number> = new Map([["x", 9]]);
    render(<Probe onResult={(m) => { last = m; }} density="comfortable" />);
    await flushRaf();
    expect(last.size).toBe(0);
  });
});
```

★ The hook needs to find which tile a section belongs to. Step 4 adds `data-tile-id={id}` to the section in `ArrangementTile` next to `data-arrangement-section`. The probe above already carries it.

Add the arithmetic case after the jsdom case passes, by stubbing `Element.prototype.getBoundingClientRect` so the section reads 176 tall, the body `clientHeight` reads 137, and the child spans 0 to 300. Then assert the map holds `a → rowsForHeight(300 + 16, 80, 16, 39, 2, 4)`. Compute the expectation by CALLING `rowsForHeight` in the test, never by writing the number: a derived expectation keeps the test honest if the formula changes.

- [ ] **Step 3: Run it and confirm it fails** (module missing), then implement `src/app/use-measured-heights.ts`:

```ts
/**
 * Measures each unflagged tile's content once per trigger (mount, density change) and returns a
 * render-time height override. NEVER persisted: a stored measured height would read as a user's
 * choice on the next open and freeze the board.
 *
 * ★★ Measurement runs in a requestAnimationFrame callback scheduled from an effect, following
 * tour-overlay.tsx. A synchronous setState in an effect body trips react-hooks/set-state-in-effect,
 * which is fatal here; the frame also lets the board lay out before any rect is read.
 * ★★ Content height is the EXTENT of the body's element children plus the body's padding — never the
 * body's scrollHeight, which equals the box when content fits and so can only ever grow a tile.
 * ★ One pass converges because content height depends on width, and width is fixed by W_CLASS at the
 * breakpoint. See the spec's "Why one pass is enough".
 */
import { useEffect, useState } from "react";
import type { BlockHeight } from "./arrangement-layout";
import { rowsForHeight } from "./arrangement-measure";

export interface MeasuredTile { id: string; minH: BlockHeight; maxH: BlockHeight; flagged: boolean }

export function useMeasuredHeights(args: {
  density: string;
  tiles: readonly MeasuredTile[];
}): ReadonlyMap<string, BlockHeight> {
  const [measured, setMeasured] = useState<ReadonlyMap<string, BlockHeight>>(() => new Map());
  const { density, tiles } = args;
  // ★★ The re-measure key covers density, WHICH tiles are present, and each tile's FLAG — never its
  // height, which would loop. The flag is in the key because Reset clears every flag without
  // changing density or the tile set. Without it, a tile the user had resized would stay at its
  // default after Reset instead of being measured, which is what the spec says Reset does.
  const tileKey = tiles.map((t) => `${t.id}:${t.minH}-${t.maxH}:${t.flagged ? "f" : "u"}`).join(",");

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const grid = document.querySelector<HTMLElement>("[data-arrangement-grid]");
      if (!grid) return;
      const cs = getComputedStyle(grid);
      const rowUnit = parseFloat(cs.gridAutoRows);
      const gap = parseFloat(cs.rowGap);
      const next = new Map<string, BlockHeight>();
      for (const t of tiles) {
        if (t.flagged) continue;
        const section = grid.querySelector<HTMLElement>(`[data-arrangement-section][data-tile-id="${t.id}"]`);
        const body = section?.querySelector<HTMLElement>("[data-arrangement-body]");
        if (!section || !body) continue;
        const kids = Array.from(body.children) as HTMLElement[];
        if (kids.length === 0) continue;
        const top = Math.min(...kids.map((k) => k.getBoundingClientRect().top));
        const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
        const extent = bottom - top;
        const sectionH = section.getBoundingClientRect().height;
        if (!(extent > 0) || !(sectionH > 0)) continue;           // jsdom: every rect is 0
        const bs = getComputedStyle(body);
        const content = extent + parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom);
        const nonBody = sectionH - body.clientHeight;
        next.set(t.id, rowsForHeight(content, rowUnit, gap, nonBody, t.minH, t.maxH));
      }
      setMeasured(next);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on tileKey and density by design; see docstring
  }, [density, tileKey]);

  return measured;
}
```

★★ The `eslint-disable` above is a claim that a reviewer must check. It is justified only if listing `tiles` would re-run the effect on every render and re-measure continuously, because the panel builds that array fresh each render. If you can make `tiles` stable (a `useMemo` keyed on `tileKey`) and drop the disable, do that instead and say so. A disable comment that is not needed is a defect.

★ Why it is safe that a user's resize does not trigger an immediate re-measure beyond the key change: `renderedH` checks `hSet` BEFORE the measured map, so a freshly flagged tile shows its chosen height even while the map still holds its old measured value. The flag in the key makes the next pass skip it.

- [ ] **Step 4: Tag each section with its tile id**

In `ArrangementTile`, add `data-tile-id={id}` to the `<section>`. It carries `data-testid={`${testIdPrefix}-${id}`}` today, whose prefix differs per surface. The hook needs the bare id.

- [ ] **Step 5: Wire the hook into the panel, and route all three height readers through one helper**

In `dashboard-panel.tsx`, after `sizeById` and `visible` are computed, call the hook and define `renderedH`:

```tsx
const measured = useMeasuredHeights({
  density,
  tiles: visible.map((p) => {
    const s = tileById(p.id)!;
    return { id: p.id, minH: s.minH, maxH: s.maxH, flagged: p.hSet === true };
  }),
});
/** ★★ The ONE place a tile's displayed height is decided. The tile, the ⋮ menu and the resize
 *  announcement all read it. Reading `p.h` directly in any of them shows the STORED default of a
 *  measured tile, which is exactly the mismatch the spec forbids. */
const renderedH = (p: PlacedTile): TileHeight =>
  p.hSet === true ? p.h : (measured.get(p.id) ?? p.h);
```

Then change the three readers:
1. `<DashboardTile ... h={p.h}>` becomes `h={renderedH(p)}`.
2. `<DashboardTileMenu ... h={menuSize.h}>` becomes `h={renderedH(menuSize)}`.
3. In `setAnnouncement(t(lang, "arrangementTileResized", ...))`, the `menuSize.h` operand becomes `renderedH(menuSize)`.

After editing, confirm no reader was missed: `grep -n "menuSize.h\b\|h={p.h}" src/app/dashboard-panel.tsx` must print nothing.

★ The hook must be called unconditionally, before any early return. Read `dashboard-panel.tsx` for early returns before placing it.

- [ ] **Step 6: Widen `kpi` and correct what asserted its fixed height**

In `DASHBOARD_TILES`, change `kpi` to `minH: 2, maxH: 4`. Then:
- `dashboard-tiles.ts` docstring: the `kpi` paragraph says its height is effectively fixed. Rewrite it to say the height is measured and why the fixed height is gone. Do not quote a number.
- `arrangement-block-menu.tsx`: the note that `kpi` pins its height. Rewrite it the same way.
- `dashboard-grid.test.tsx` "renders no height chooser for the KPI tile": this inverts. Rename it, and assert that a height chooser now renders with options 2 to 4.
- `dashboard-layout.test.ts` "clamps a value above the tile's max": it expects `resizeTile(layout(), "kpi", "h", 4)` to give 3. With `maxH: 4`, 4 is legal. Change the input to 5 and expect 4.
- `dashboard-layout.test.ts` "clamps a stored kpi height below the new minH (3) up to it": with `minH: 2`, a stored 2 is legal. Change the stored value to 1 and expect 2, and fix the title.
- `dashboard-layout.test.ts` "clamps a stored size outside the tile's limits, per axis": its comment says `minH === maxH === 3`. Correct the comment.

- [ ] **Step 7: Run everything this task touches**

```bash
npx vitest run src/app/use-measured-heights.test.tsx src/app/dashboard-grid.test.tsx src/app/dashboard-layout.test.ts src/app/dashboard-panel.test.tsx src/app/dashboard-panel-layout.test.tsx --reporter=dot > "$TEMP/t3.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |FAIL" "$TEMP/t3.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src; echo "ESLINT=$?"
```

Expected: all green. The panel tests stay green because jsdom measures nothing, so `renderedH` returns the stored height. That is the no-op path working, and it is the reason these suites need no migration for A.

- [ ] **Step 8: e2e — the only witness that measurement is right**

In `e2e/dashboard-grid.spec.ts`:

- **"applies the 80px comfortable row unit to the container AND to a real tile"** expects `upcoming` at `2 * 80 + rowGap`. `upcoming` is now measured. Seed a layout in which `upcoming` carries `hSet: true` at `h: 2`, so its height is a recorded choice, and keep the assertion. Say in the test why the flag is there.
- **"emitted the Dashboard-only height utilities — an h:8 tile is eight row units tall"**: seed `burn` with `hSet: true` at `h: 8` for the same reason, rather than relying on its content happening to overflow.
- **Add** "a tile with no chosen height renders at its measured height": for `upcoming` with no `hSet`, read the rendered section height, the body's children extent and the grid metrics from the page (reuse `gridMetrics`), and assert the rendered row count equals what `rowsForHeight` computes from those same measured numbers. Import `rowsForHeight` from `../src/app/arrangement-measure`. Never write the expected row count as a literal.
- **Add** "a tile measured shorter than its default renders shorter": pick a tile whose default height exceeds its content in the e2e seed, and assert its rendered height is below its catalogue default. This is the test that catches a `scrollHeight` measurement, which can only grow. If no seeded tile's content is shorter than its default, say so and seed one, rather than asserting on a tile where the test cannot fail.
- **Add** "an explicitly resized tile keeps its height across a reload": resize `upcoming` through the ⋮ menu, reload, and assert the height.
- **Add** "a density change re-measures": switch density through Settings, return to the Dashboard, and assert that a measured tile's height is recomputed from the new row unit (again derived from page reads, not a literal).

Run the file and the print spec (Review Focus 5):

```bash
npx playwright test e2e/dashboard-grid.spec.ts e2e/print.spec.ts --project=chromium --workers=1 > "$TEMP/e3.log" 2>&1; echo "EXIT=$?"
grep -E "passed|failed|✘" "$TEMP/e3.log"
```

★★ Chained `npx playwright test` invocations race their own web server locally. Run the two specs in ONE invocation, as above.

- [ ] **Step 9: Mutation-check `renderedH`**

Make `renderedH` ignore `measured` (return `p.h`). Expected: the e2e "renders at its measured height" and "renders shorter" go red. Revert. The unit suite stays green on this mutant, which is correct and expected: say so in the report, because jsdom cannot see it.

- [ ] **Step 10: Commit**

```bash
git add src/app/arrangement-tile.tsx src/app/arrangement-grid.tsx src/app/use-measured-heights.ts src/app/use-measured-heights.test.tsx src/app/dashboard-panel.tsx src/app/dashboard-tiles.ts src/app/arrangement-block-menu.tsx src/app/dashboard-grid.test.tsx src/app/dashboard-layout.test.ts e2e/dashboard-grid.spec.ts
git commit -m "feat(dashboard): measure tile heights on open and on density change"
```

---

### Task 4: Layout upgrade as ordered steps; remove Progress from stored layouts

**Files:**
- Modify: `src/app/dashboard-layout.ts` (a new exported id)
- Modify: `src/app/dashboard-layout-upgrade.ts`
- Test: `src/app/dashboard-layout-upgrade.test.ts`, `src/app/use-dashboard-layout.test.tsx`

**Interfaces:**
- Produces: `DASHBOARD_PROGRESS_REMOVAL_UPGRADE`, `burnUpgradeStep`, `progressRemovalStep`, and `upgradeDashboardLayout` composed from them. The `useArrangement` `upgrade` option still takes one function; `upgradeDashboardLayout` stays that function.

- [ ] **Step 1: Add the id** in `dashboard-layout.ts`, beside `DASHBOARD_BURN_UPGRADE`:

```ts
/** Removes the retired Progress tile from stored layouts (its content moved into At a glance).
 *  ★ NOT added to DEFAULT_LAYOUT.upgrades: the step records its id only when it removed something,
 *  and a fresh or reset board never contains `progress`, so the step is a no-op on it. */
export const DASHBOARD_PROGRESS_REMOVAL_UPGRADE = "dashboard-progress-into-kpi";
```

`DEFAULT_LAYOUT` is unchanged. Its `upgrades` stays `[DASHBOARD_BURN_UPGRADE]`, so the pinned test "already carries the upgrade id, so a fresh or reset board is never upgraded" keeps passing.

- [ ] **Step 2: Write the failing tests** in `dashboard-layout-upgrade.test.ts`:

```ts
import { progressRemovalStep, upgradeDashboardLayout } from "./dashboard-layout-upgrade";
import { DASHBOARD_BURN_UPGRADE, DASHBOARD_PROGRESS_REMOVAL_UPGRADE } from "./dashboard-layout";

describe("progressRemovalStep", () => {
  const base = { v: 1 as const, upgrades: [DASHBOARD_BURN_UPGRADE] };

  it("removes progress from the board and records its id", () => {
    const l = { ...base, hidden: [], board: [{ id: "kpi", w: 2, h: 3 }, { id: "progress", w: 2, h: 2 }] };
    const out = progressRemovalStep(l as never);
    expect(out.board.map((b) => b.id)).toEqual(["kpi"]);
    expect(out.upgrades).toContain(DASHBOARD_PROGRESS_REMOVAL_UPGRADE);
  });

  it("removes progress from the hidden list too", () => {
    const l = { ...base, hidden: ["progress"], board: [{ id: "kpi", w: 2, h: 3 }] };
    expect(progressRemovalStep(l as never).hidden).toEqual([]);
  });

  it("returns the SAME object, and records nothing, when there is no progress to remove", () => {
    const l = { ...base, hidden: [], board: [{ id: "kpi", w: 2, h: 3 }] };
    expect(progressRemovalStep(l as never)).toBe(l);
  });
});

describe("upgradeDashboardLayout composes both steps", () => {
  it("still removes progress from a layout the burn step already upgraded", () => {
    const l = { v: 1 as const, upgrades: [DASHBOARD_BURN_UPGRADE], hidden: [],
                board: [{ id: "burn", w: 2, h: 8 }, { id: "progress", w: 2, h: 2 }] };
    expect(upgradeDashboardLayout(l).board.map((b) => b.id)).toEqual(["burn"]);
  });

  it("returns the same object when neither step has anything to do", () => {
    const l = { v: 1 as const, upgrades: [DASHBOARD_BURN_UPGRADE], hidden: [],
                board: [{ id: "burn", w: 2, h: 8 }] };
    expect(upgradeDashboardLayout(l)).toBe(l);
  });
});
```

★ "still removes progress from a layout the burn step already upgraded" is the regression this task exists for. The current function returns early on the burn id, so it would pass `progress` straight through. Run it before implementing and confirm it goes red on that assertion.

- [ ] **Step 3: Run and confirm red**

```bash
npx vitest run src/app/dashboard-layout-upgrade.test.ts --reporter=dot > "$TEMP/t4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |AssertionError|is not a function|not exported" "$TEMP/t4.log"
```

- [ ] **Step 4: Restructure the upgrade**

In `dashboard-layout-upgrade.ts`, move the existing body into an exported `burnUpgradeStep`, byte-for-byte except that its first two lines (the `isArrangementLayout` check and the cast) move out to the composer. Keep its early `return layout` on its own id: inside one step, that is correct. Then:

```ts
export function progressRemovalStep(layout: DashboardLayout): DashboardLayout {
  const onBoard = layout.board.some((p) => (p.id as string) === "progress");
  const inHidden = layout.hidden.some((h) => (h as string) === "progress");
  if (!onBoard && !inHidden) return layout;
  return {
    ...layout,
    board: layout.board.filter((p) => (p.id as string) !== "progress"),
    hidden: layout.hidden.filter((h) => (h as string) !== "progress"),
    upgrades: [...(layout.upgrades ?? []), DASHBOARD_PROGRESS_REMOVAL_UPGRADE],
  };
}

/** Each step is gated on its OWN id and runs independently. A single function with an early
 *  return would skip every later step for a user who already has an earlier one — exactly the
 *  users a later step exists for. */
export function upgradeDashboardLayout(stored: unknown): DashboardLayout {
  if (!isArrangementLayout(stored)) return DEFAULT_LAYOUT;
  const layout = stored as DashboardLayout;
  return progressRemovalStep(burnUpgradeStep(layout));
}
```

★ The `as string` casts exist because Task 5 removes `"progress"` from the `DashboardTileId` union, after which comparing a `DashboardTileId` to `"progress"` stops typechecking. Retired ids are compared as strings.

★★ Order matters: `burnUpgradeStep` runs first. It filters only `burn` out of the board before re-inserting it, so a `progress` entry passes through it untouched and the second step can see it. Read the step and confirm that before relying on it. If the burn step ever filtered by anything wider than `burn`, the progress step would find nothing to remove and record nothing, and the stale entry would sit in storage unrecorded.

- [ ] **Step 5: Keep the existing burn tests on the burn step**

The existing tests call `upgradeDashboardLayout` and assert burn-only results, for example "records the upgrade id" with `toEqual([BURN])`. If any of their fixtures contains a `progress` tile, the composed function now also removes it and records a second id, and the assertion breaks for a reason unrelated to what it tests. For each existing test whose fixture contains `progress`, change the call to `burnUpgradeStep`, so it keeps testing exactly what it tested. Leave tests whose fixtures have no `progress` on `upgradeDashboardLayout`. List every test you moved, in the report.

- [ ] **Step 6: Run both upgrade suites**

```bash
npx vitest run src/app/dashboard-layout-upgrade.test.ts src/app/use-dashboard-layout.test.tsx --reporter=dot > "$TEMP/t4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$TEMP/t4.log"
npx tsc --noEmit; echo "TSC=$?"
```

`use-dashboard-layout.test.tsx` "never runs again: a burn the user moved back keeps its place" asserts byte-identical storage for a layout with no `progress` tile. It must still pass, which proves the progress step writes nothing when there is nothing to remove.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard-layout.ts src/app/dashboard-layout-upgrade.ts src/app/dashboard-layout-upgrade.test.ts
git commit -m "refactor(dashboard): run layout upgrades as independently gated steps

The burn upgrade returned early on its own id, so any later step would have
been skipped for every user who already had it. Adds a step that removes the
retired Progress tile, recording its id only when it removed something."
```

---

### Task 5: Merge Progress into At a glance

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-kpi-strip.tsx`
- Modify: `src/app/dashboard-tile-bodies.tsx` (delete the `progress` body)
- Modify: `src/app/dashboard-tiles.ts` (delete `progress` from the union and the catalogue)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`dashboardCompleteHint`)
- Modify: `src/app/dashboard-panel.tsx` (the prose comment that counts tile bodies)
- Test: `src/app/dashboard-sections/dashboard-kpi-strip.test.tsx`, `src/app/dashboard-panel.test.tsx`, `src/app/dashboard-panel-layout.test.tsx`
- Test: `e2e/seed-content.spec.ts`, `e2e/dashboard-grid.spec.ts`

**Interfaces:**
- Consumes: Task 4, which removes stored `progress` entries.
- Produces: `KpiCellCount = 4 | 5 | 6`.

- [ ] **Step 1: Add two i18n keys, splitting the Progress caption between the two cells it describes**

`dashboardProgressCaption` is two captions. Its first sentence is about COMPLETION; its second is about the R/A/G SPLIT. Merging all of it into the Complete tooltip would describe the wrong cell. So:

- **`dashboardCompleteHint`**: `dashboardKpiCompleteHint` plus the caption's first sentence.
- **`dashboardRagSplitHint`**: the caption's second sentence. It replaces `dashboardRagHint` on the R/A/G cell. ★ `dashboardRagHint` says "health counts across your project areas", but this card's counts are TASKS by health (`model.progress.counts`). The caption's sentence is the accurate description, so this also corrects that card's tooltip.

EN, added to `i18n.ts` with the Edit tool, next to `dashboardKpiCompleteHint`:

```ts
  dashboardCompleteHint: "Share of tasks with a completion date, out of every task still counted as scope — cancelled work is out of both. Trending up is good; a flat line signals stalled delivery.",
  dashboardRagSplitHint: "The Red / Amber / Green split covers work still in scope; delivered work counts Green and cancelled work is counted separately, unless its health was set by hand.",
```

DE, added to `i18n.de.ts` ONLY with a node utf8 write anchored on `\r\n`:

```bash
node -e "
const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');
const anchor='  dashboardKpiCompleteHint:';
if(!s.includes(anchor)) throw new Error('anchor missing');
const add='  dashboardCompleteHint: \"Anteil der Aufgaben mit Abschlussdatum an allen Aufgaben, die noch zum Umfang zählen — abgebrochene Arbeit bleibt in beiden außen vor. Steigend ist gut; eine flache Linie deutet auf stockende Lieferung hin.\",\r\n'
        +'  dashboardRagSplitHint: \"Die Rot/Gelb/Grün-Aufteilung umfasst Aufgaben im Umfang; gelieferte Arbeit zählt als Grün, abgebrochene wird separat gezählt, sofern die Ampel nicht manuell gesetzt wurde.\",\r\n';
s=s.replace(anchor, add+anchor); fs.writeFileSync(p,s,'utf8');"
git ls-files --eol src/app/i18n.de.ts
```

Both DE strings are taken verbatim from the existing `dashboardKpiCompleteHint` and `dashboardProgressCaption`, so no new German is invented. Then run `npx vitest run src/app/i18n --reporter=dot` (the encoding test bans ASCII umlaut substitutes) and `npx tsc --noEmit` (EN/DE key parity).

- [ ] **Step 2: Write the failing strip tests** in `dashboard-kpi-strip.test.tsx`, in a new describe, using the file's existing model builders:

- the Complete cell renders its percentage, its gradient bar (`getByRole("img")`), its trend arrow, AND the count (`dashboardCompletedOf`);
- its tooltip's accessible name is the `dashboardCompleteHint` text;
- in the no-active-scope state the tooltip is absent;
- an R / A / G cell renders, with the ✕ marker only when `outOfScope > 0`;
- the strip renders 4 cells with no index, 5 with one, and 6 with both, in the spec's order.

- [ ] **Step 3: Run and confirm red.**

- [ ] **Step 4: Extend the strip**

In `DashboardKpiStrip`:
- The Complete `Tile` keeps its `label`, `value`, `bar`, `trend`, `onActivate` and `activateLabel`. Add `sub={noActiveScope ? undefined : t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.inScope))}`. `sub` is the `Tile` slot documented for "a qualifier the headline number needs". Change `hint` to `noActiveScope ? undefined : t(lang, "dashboardCompleteHint")`.
- After the Complete cell, add the R / A / G `Tile`, moved from `dashboard-tile-bodies.tsx`'s `progress` body: its `label`, the `RagDot` value including the conditional ✕ with its `aria-hidden` glyph and `sr-only` companion, and its `onActivate`/`activateLabel`, all unchanged. Its hint becomes `hint={t(lang, "dashboardRagSplitHint")}` (see Step 1). Import `RagDot` from wherever `dashboard-tile-bodies.tsx` imports it.
- The count becomes `(4 + (showSpi ? 1 : 0) + (showCpi ? 1 : 0)) as KpiCellCount`.
- `KpiCellCount` becomes `4 | 5 | 6`. In `KPI_STRIP_COLS`, delete key 3, keep 4 and 5 unchanged (a class depends on the cell COUNT, not on which cells), and add:

```ts
  6: "@2xs:grid-cols-2 @[25rem]:grid-cols-3 @4xl:grid-cols-6",
```

★ `@4xl` rests on an estimate that six cells need about 802px. That was arithmetic, not a measurement. Step 8's e2e is what establishes it. If the six-cell strip overflows its tile, adjust the class and record the measured width in the docstring beside the class, as a recipe that re-derives it.

- Update the file's docstring: the strip is now "completion (with count) · R/A/G · overdue · open RAID, plus Effort SPI · Effort CPI when non-null".

- [ ] **Step 5: Delete the Progress tile**

- Delete the `progress` entry from `buildTileBodies` in `dashboard-tile-bodies.tsx`. Delete its `RagDot` import only if nothing else there uses it.
- Delete `"progress"` from the `DashboardTileId` union and its row from `DASHBOARD_TILES`.
- `dashboardProgress` (the old tile title), `dashboardProgressCaption` and possibly `dashboardRagHint` become unused. Before removing a key, grep `src/` and `e2e/` for it: `grep -rn "dashboardRagHint" src e2e`. Remove a key only when nothing references it, from BOTH i18n files, the DE one by node write.
- `dashboard-panel.tsx` has a prose comment that counts the tile bodies, with a recipe beside it. Re-run its recipe and replace the count with the recipe alone. Do not write the new number.
- `dashboard.ts` has a comment saying the Progress tile and the at-a-glance KPI card render the same completion figure. Rewrite it: there is now one card.

- [ ] **Step 6: Migrate the tests that used Progress as their always-present tile**

`upcoming` (title "Upcoming & overdue", `gate: ALWAYS`, `minH: 2`, `maxH: 4`) replaces it. Where a test needs the height at a fixed value, resize `upcoming` through the ⋮ menu first, so its height is a recorded choice and measurement cannot move it.

In `dashboard-panel.test.tsx`, for each test below make the change shown, and keep the test's intent:
- "wraps the Progress section in a boxed rounded-lg card", "still renders overall RAG and progress when all module flags are false", "gives each tile the span classes its catalogue entry declares", "qualifies every per-tile control with that tile's title", "renders no grip, menu, shelf or reset in a popout (read-only)", "hides a tile from the ⋮ menu onto the shelf, announces it, and restores it", "lands focus on the hidden-tiles badge after hiding", "lands focus on the restored tile's ⋮ trigger when the restore empties the tray", "keeps focus on the size control through a resize, WITHOUT any focus machinery", "ends the drag when a tile is dropped onto the shelf", "leaves the tray open to a REAL drag", "orders the stack Print, Reset layout, Reset size, then the hidden-tiles badge", "restores a hidden tile when the reset button is clicked": use `upcoming` / "Upcoming & overdue" / `tile-upcoming`.
- "renders the RAID register (Top open RAID) BEFORE the Progress card in DOM order": compare against the Upcoming card. The catalogue places `raid` before `upcoming`.
- "renders the progress caption, and no longer the burn caption": the caption is now a tooltip. Assert that the `dashboardCompleteHint` text is the accessible name of an InfoTooltip trigger, and keep the burn-caption absence assertion.
- "reads as no-active-scope when every task is cancelled": `getAllByText(dashboardNoActiveScope)` becomes `toHaveLength(1)`. Update the comment: there is one card now, so the drift the pair guarded against is gone by construction.
- "renders '5 of 5 complete' beside '100% complete'": the count is now the Complete cell's `sub` beside its "100%" value. Assert both.
- "leaves an empty project on 0% complete": assert the Complete cell's "0%" value.
- "renders the narrative editor (Status summary) AFTER the bento Progress card": Task 6 replaces this test. Leave it for Task 6 and note it in the report.

In `dashboard-panel-layout.test.tsx`, change the vehicle in: "shows no badge with nothing hidden, and a count badge once a tile is hidden", "shows the badge while a tile is being dragged, even at a count of 0", "never renders the badge in a popout", "returns focus to the badge after a Restore that leaves tiles hidden", "closes the tray when the last hidden tile is restored", "closes the tray after a drag that opened it at hidden-count 0 ends without a drop".

Then in `dashboard-kpi-strip.test.tsx`, the §581 describe: delete the 3-cell test (the key no longer exists), keep the 4- and 5-cell literal-class tests, add a 6-cell one, and change "gives each count its own classes" to the set of `COLS[4]`, `COLS[5]`, `COLS[6]`.

★ After migrating, check that nothing still names the retired tile: `grep -rn "tile-progress\|\"Progress\"" src/app e2e` must print nothing except i18n and unrelated prose. Read every hit.

- [ ] **Step 7: Run the unit suites**

```bash
npx vitest run src/app/dashboard-sections src/app/dashboard-panel.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/dashboard-tiles.test.ts src/app/dashboard-layout --reporter=dot > "$TEMP/t5.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |FAIL" "$TEMP/t5.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src; echo "ESLINT=$?"
```

- [ ] **Step 8: e2e**

- `e2e/seed-content.spec.ts` "the seeded dashboard renders a populated board": remove "Progress" from its tile list, and correct the prose above it that lists the tiles.
- `e2e/dashboard-grid.spec.ts` "the ${cells}-cell KPI strip fits its tile body at half-width xl": the counts become 6 and 5, because R/A/G is always present. Replace the `rows === 2` assertion with one derived from `KPI_STRIP_COLS` and the measured container width. Keep the "no inner scroll" assertion: it now tests measurement.
- `e2e/dashboard-grid.spec.ts` "a later tile backfills the gap an over-wide tile left behind": its `DENSE_LAYOUT` uses `progress` as the backfilling tile. Use `raid` (gated on `showRaid`, which is on in the seed), and remove `raid` from that layout's `hidden` list. Rewrite the comment that explains the kpi height change.

```bash
npx playwright test e2e/dashboard-grid.spec.ts e2e/seed-content.spec.ts --project=chromium --workers=1 > "$TEMP/e5.log" 2>&1; echo "EXIT=$?"
grep -E "passed|failed|✘" "$TEMP/e5.log"
```

- [ ] **Step 9: axe**

At a glance gained a cell carrying its own tooltip trigger. Run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1`, redirected, with the EXIT read unpiped.

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard-sections/dashboard-kpi-strip.tsx src/app/dashboard-sections/dashboard-kpi-strip.test.tsx \
  src/app/dashboard-tile-bodies.tsx src/app/dashboard-tiles.ts src/app/dashboard.ts src/app/dashboard-panel.tsx \
  src/app/dashboard-panel.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/i18n.ts src/app/i18n.de.ts \
  e2e/seed-content.spec.ts e2e/dashboard-grid.spec.ts
git commit -m "feat(dashboard): merge the Progress tile into At a glance

The Complete cell keeps its bar and trend arrow and gains the count. R/A/G
joins the strip with its out-of-scope marker. The Progress caption splits
between the two cells it describes, which also corrects the R/A/G tooltip:
it said project areas, and the card counts tasks. Tests that used Progress
as their always-present tile now use Upcoming."
```

Add any other file you touched to the `git add` line, and check `git status --porcelain` shows nothing unexpected before committing.

---

### Task 6: One status summary, edited inline

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-narrative.tsx`
- Modify: `src/app/dashboard-panel.tsx` (delete the bottom instance; pass `readOnly`)
- Modify: `src/app/rich-text-editor.tsx` (a focus capability)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`dashboardStatusSummaryEdit`, `dashboardStatusSummaryAdd`)
- Test: `src/app/dashboard-sections/dashboard-narrative.test.tsx`, `src/app/dashboard-panel.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NarrativeSummary` props `{ lang, status, setStatus, readOnly }`. `NarrativeEditor` gains `onDone?: () => void` and `autoFocus?: boolean`.

- [ ] **Step 1: Read before designing the focus capability.** Read `rich-text-editor.tsx` and `rich-text-editor-lazy.tsx` in full. Establish and write in the report:
  1. whether the lazy wrapper forwards every prop to the real editor;
  2. how the real editor creates its Tiptap editor instance, and whether a mount-time effect in it can call that instance's focus command.

Implement the capability as an `autoFocus?: boolean` prop that the REAL editor honours once its editor instance exists. That removes the need to wait for the lazy chunk, because the editor focuses itself when it mounts. If the lazy wrapper does not forward the prop, forward it. **If the real editor cannot focus from a mount effect, stop and report.** Do not substitute a timer.

- [ ] **Step 2: Add the two i18n keys**

EN, added to `i18n.ts` with the Edit tool, next to `dashboardStatusSummary`:

```ts
  dashboardStatusSummaryEdit: "Edit status summary",
  dashboardStatusSummaryAdd: "Add status summary",
```

DE, added to `i18n.de.ts` ONLY with a node utf8 write anchored on `\r\n`. The German reuses the existing `dashboardStatusSummary` noun ("Statuszusammenfassung"), so the three stay consistent:

```bash
node -e "
const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');
const anchor='  dashboardStatusSummary:';
if(!s.includes(anchor)) throw new Error('anchor missing');
const add='  dashboardStatusSummaryEdit: \"Statuszusammenfassung bearbeiten\",\r\n'
        +'  dashboardStatusSummaryAdd: \"Statuszusammenfassung hinzufügen\",\r\n';
s=s.replace(anchor, add+anchor); fs.writeFileSync(p,s,'utf8');"
git ls-files --eol src/app/i18n.de.ts
npx vitest run src/app/i18n --reporter=dot > "$TEMP/i6.log" 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "TSC=$?"
```

★ Run it once. The anchor `  dashboardStatusSummary:` survives the insert (the new keys differ from it at the character after the noun, `E` or `A` instead of `:`), so a second run inserts both keys a second time. `npx tsc --noEmit` catches that as a duplicate property in an object literal, which is why the command ends with it.

- [ ] **Step 3: Write the failing tests** in `dashboard-narrative.test.tsx`:

- with an empty narrative, the summary renders an "Add status summary" button (replacing "renders nothing when the narrative is empty or blank markup" and "renders nothing when the narrative sanitises away to nothing", which invert: rename both and assert the Add button);
- with a narrative, it renders the narrative and an "Edit status summary" button;
- clicking Edit or Add replaces the summary with the editor in place;
- **clicking the editor's Bold button keeps the editor open** (the existing "applies Bold to the selection instead of losing the click to a remount" must still pass unchanged);
- Save returns to the read-only summary showing the saved text;
- moving focus to a button outside the editor region returns to read-only;
- after Clear, the read-only view shows the Add button (Review Focus 4);
- with `readOnly`, no Edit or Add button renders.

Use `userEvent.tab()` and real clicks to move focus. `element.focus()` does not fire the `focusout` the close rule depends on.

- [ ] **Step 4: Run and confirm red.**

- [ ] **Step 5: Implement**

`NarrativeSummary`:

```tsx
export function NarrativeSummary({ lang, status, setStatus, readOnly }: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const html = narrativeToHtml(status.narrative);
  const rendered = html ? sanitizeRichHtml(html) : "";
  const empty = !rendered || isNarrativeEmpty(rendered);

  if (editing) {
    return (
      <NarrativeEditor
        lang={lang}
        status={status}
        setStatus={setStatus}
        autoFocus
        onDone={() => { setEditing(false); requestAnimationFrame(() => toggleRef.current?.focus()); }}
      />
    );
  }
  // ★★ Always renders. With the bottom editor gone, a summary that hid itself when empty would
  // leave no way to write a first narrative, or a new one after Clear.
  return (
    <Card boxed className="p-3">
      {!empty && <RichTextView html={rendered} />}
      {!empty && status.narrativeUpdatedAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
        </p>
      ) : null}
      {!readOnly && (
        <div className="mt-2 flex justify-end print:hidden">
          <Button ref={toggleRef} variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t(lang, empty ? "dashboardStatusSummaryAdd" : "dashboardStatusSummaryEdit")}
          </Button>
        </div>
      )}
    </Card>
  );
}
```

★ Check that `Button` forwards a `ref` before relying on `toggleRef`. If it does not, focus the toggle another way, and say which.

★ In a read-only popout with an empty narrative, this renders an empty `Card`. Decide whether an empty card with no button should render at all. Rendering `null` in that exact case, and only that case, matches the old behaviour where it was reachable. Say which you chose and why.

`NarrativeEditor`: add `onDone` and `autoFocus` to its props. Pass `autoFocus` to `RichTextEditor`. Replace the `<details>`/`<summary>` fold with a plain container: the editor is only on screen while editing, so a fold would be a second open/close control for the same state. Then add the close rule to the existing commit-on-blur wrapper, without changing the commit:

```tsx
const regionRef = useRef<HTMLDivElement | null>(null);
// ★★ Closes only when focus LEAVES the whole editor region. React's onBlur is focusout and
// bubbles, so it also fires when focus moves to the editor's own toolbar; closing on that would
// unmount the editor mid-click, the defect the Bold test pins one level down.
const onRegionBlur = (e: React.FocusEvent<HTMLDivElement>) => {
  commitNarrative();
  const next = e.relatedTarget as Node | null;
  if (onDone && (!next || !regionRef.current?.contains(next))) onDone();
};
```

`regionRef` wraps the editor AND its Save/Clear buttons, so moving focus to Save does not close the editor before Save's click lands. Save calls `commitNarrative()` and then `onDone?.()`. Clear keeps its `onMouseDown` `preventDefault` and its unconditional `seedNonce` bump, unchanged.

★ `relatedTarget` is `null` when focus leaves the window, so switching browser tabs closes the editor. The draft is committed first, so nothing is lost, and that is acceptable. Say so in a comment.

In `dashboard-panel.tsx`: pass `setStatus` and `readOnly={arrangement.readOnly}` to `NarrativeSummary`, and delete the bottom `<NarrativeEditor ... />` and its "Tier 3" comment. Rewrite the Tier 0 comment above `NarrativeSummary`, which says it self-hides when empty.

- [ ] **Step 6: Replace the panel test the deletion invalidates**

`dashboard-panel.test.tsx` "renders the narrative editor (Status summary) AFTER the bento Progress card" is obsolete. Replace it with a test that the status summary renders BEFORE the tile grid in DOM order, and that no second "Status summary" editor exists.

- [ ] **Step 7: Run**

```bash
npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx src/app/dashboard-panel.test.tsx src/app/rich-text --reporter=dot > "$TEMP/t6.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |FAIL" "$TEMP/t6.log"
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src; echo "ESLINT=$?"
```

- [ ] **Step 8: Mutation-check the close rule**

Change `onRegionBlur` to call `onDone()` unconditionally. Expected: the Bold test and "clicking the editor's Bold button keeps the editor open" go red. Revert. Report.

- [ ] **Step 9: axe.** The Dashboard gained a button.

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1 > "$TEMP/a6.log" 2>&1; echo "EXIT=$?"
grep -E "passed|failed|✘|violation" "$TEMP/a6.log"
```

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard-sections/dashboard-narrative.tsx src/app/dashboard-sections/dashboard-narrative.test.tsx \
  src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx src/app/rich-text-editor.tsx \
  src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(dashboard): one status summary, edited inline

The summary area always renders, with Edit when there is a narrative and Add
when there is none, so a first narrative can still be written once the bottom
editor is gone. The editor closes on Save or when focus leaves it, never when
its own toolbar takes focus."
```

Add `rich-text-editor-lazy.tsx` to the `git add` line if Step 1 required forwarding the prop there.

---

### Task 7: Documentation and the full gate run

**Files:**
- Modify: `docs/AGENTS/dashboard.md`

- [ ] **Step 1: Correct `docs/AGENTS/dashboard.md`.** Grep it for `progress`, `kpi`, `minH`, `NarrativeEditor`, `self-hides`, `KpiCellCount` and the "6 of 9" overflow paragraph, and correct each claim the change falsified. Describe the measured-height model once, in the tile-grid section: measured on mount and on density change, never persisted, applied only where `hSet` is absent, read by the tile, the menu and the announcement through `renderedH`. The overflow figure predates this change. Replace it with a statement that measurement removes inner scrolls up to each tile's `maxH`, and that a tile at `maxH` still scrolls.

★ Every recipe written into the doc is RUN first and must print what the prose beside it claims. This repo found six recipes that matched their own comment line and confirmed themselves.

- [ ] **Step 2: Run the full gate set on a still tree**

```bash
git status --porcelain
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src e2e scripts > "$TEMP/g.log" 2>&1; echo "ESLINT=$?"
npm run size:check > "$TEMP/g.log" 2>&1; echo "SIZE=$?"
npm run dup:check > "$TEMP/g.log" 2>&1; echo "DUP=$?"
npm run docs:symbols:check > "$TEMP/g.log" 2>&1; echo "SYMBOLS=$?"
npm run docs:claims:check > "$TEMP/g.log" 2>&1; echo "CLAIMS=$?"
npm run test:run > "$TEMP/full.log" 2>&1; echo "SUITE=$?"; grep -E "Test Files|Tests " "$TEMP/full.log"
```

`git status --porcelain` must show nothing but the untracked `.bak` before the whole-repo gates run. A gate read against a moving tree is worthless in either colour.

- [ ] **Step 3: Commit** the doc with an explicit path.
