# Dashboard layout rework (spec C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Dashboard's first screen answers "what changed", "what is the one thing to do now" and "how is the project doing" without scrolling; the Budget burn tile becomes a large chart-only tile, and the figures that crowded it move to where they belong.

**Architecture:** The shared arrangement engine splits its one span union into `BlockWidth` (1–4) and `BlockHeight` (1–8) and gains an optional `upgrades` list on the stored layout (still `v: 1`), carried by `reconcile`, sanitised by `readArrangement`, and consumed by a new surface-supplied `upgrade` option on `useArrangement`. The Dashboard supplies `upgradeDashboardLayout` (burn to the front at 2×8, completion trend clamped into 2–4) and a new catalogue default. Grouping of next actions is lifted into `task-manager.tsx` once; `ActionsPanel` and the Dashboard both receive the groups (the hero through one shared `pickHeroGroup`). The panel gets two presentational rows (`dashboard-rows.tsx`): row 1 = delta strip · digest · control stack (Print · Reset layout · Reset size · a new hidden-tiles badge), the hidden-tiles tray under it, row 2 = `ActionHeroCard` beside `DashboardHero`.

**Tech Stack:** TypeScript, React 19 (Next 16), Tailwind v4 tokens, vitest + @testing-library/react, Playwright (axe, geometry, visual), i18n EN/DE dictionaries.

**Spec:** `docs/superpowers/specs/2026-09-17-dashboard-layout-rework-design.md` (binding, including its "Revision notes"; decisions 2, 4, 10 and 11 are the revised ones).

## Global Constraints

- Read `AGENTS.md` before the first edit (it is always loaded for you). Open `docs/AGENTS/dashboard.md` before touching any `dashboard-*` or `arrangement-*` file and `docs/AGENTS/accessibility.md` before adding a control.
- `src/app/**` and `e2e/**` are CRLF in the working tree (`git ls-files --eol` shows `i/lf w/crlf`). Prefer the Edit tool (it preserves line endings). Where a step creates a WHOLE new file, write it with the Write tool and then normalise it: `node -e "const f=process.argv[1];const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" <file>` and confirm `git ls-files --eol <file>` (for a new, untracked file: `file <file>` must end in `with CRLF line terminators`). **Never `sed -i` any file under `src/` or `e2e/`** — it re-lines the whole file to LF invisibly.
- `AGENTS.md` and `docs/**` are LF (`.gitattributes` `eol=lf`); edit them with the Edit tool.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical (`npx tsc --noEmit` enforces it). DE uses real umlauts. **Edit `i18n.de.ts` only through the Node scripts given in this plan**, saved to your scratchpad directory and run with `node <path>` (never inline `node -e`). Never open `i18n.de.ts` in the Edit tool — it corrupts umlauts and curls quotes. Every script anchors on `\r\n` and exits 1 unless each replacement matched exactly once.
- A paired key (`X` + `XOne`) must be rendered with `tPlural`, never `t` — `i18n-plural.test.ts` scans for it.
- `Lang` is `"en-US" | "en-GB" | "de"`. Tests use `"en-US"`; a DE assertion must `await loadI18n("de")` first.
- Palette: sanctioned tokens only. This plan adds no colours, shadows or gradients.
- Accessibility: never hand-roll a control a primitive covers. The badge is the `IconButton` primitive (`variant="bordered" size="md"`, the exact box `ResetSizeButton` uses). A disclosure uses `aria-expanded` + `aria-controls` against an always-mounted, `hidden`-toggled target (the repo's disclosure precedent, `arrangement-shelf.tsx` / `action-reasons.tsx`); **never `aria-pressed`**. Every control's accessible name must contain its visible text (WCAG 2.5.3) and be unique on screen (WCAG 2.4.6) — axe sees neither, so unit tests pin both.
- Density: every NEW spacing class on a cockpit slice uses a `dc.*` class, never a literal `gap-*`/`space-y-*`/`p-*`.
- Tailwind: every class stays a whole literal string (an interpolated class emits no CSS).
- Never read a gate's exit code through a pipe. Run `cmd > /tmp/dlr-x.log 2>&1; echo "EXIT=$?"` and then grep the file. Prefix every log with `dlr-` (`/tmp` is shared with other sessions).
- Never run two vitest processes at once. Each task runs ONE `npx vitest run <files>` over only that task's files and asserts `Test Files  N passed (N)` with N = the number of files named. **No `npm run test:run`, `test:shuffle` or `test:coverage` anywhere in this plan** — the user runs the whole suite at the end, on their say.
- `npx tsc --noEmit` after any `.ts`/`.tsx` change (vitest never typechecks). Pass = exit 0 AND `grep -c "error TS" <log>` prints 0 — zero errors in total, not "zero in src/".
- Lint with `npx eslint --max-warnings=0 <paths>`; every warning is fatal. `react-hooks/set-state-in-effect` is banned; no `Date.now()`/`new Date()`/`Math.random()` in a render body; an unused import, variable or destructured prop is fatal.
- Mutation check: every task has one. Apply it with the Edit tool, watch the named test go red, revert with the inverse Edit, watch it go green, then prove `git diff --stat` lists only the task's files. Never leave a mutant in the tree.
- Commits: conventional prefix, message ends with the trailer line the session trailer, and contains no `#` followed by digits. Stage by explicit path only (`git add <paths>`). Never `git add -A`/`git add .`, never `git commit --amend`, never `git stash`, never `git checkout -- <file>`, `git checkout HEAD -- <file>` or `git restore`. Never open, read or stage `not-in-use.env.local.bak`. Do not push.
- Size ratchet: `LIMIT` in `scripts/check-file-sizes.mjs` is 1600 (test files are exempt). Largest non-test file touched: `task-manager.tsx` (3315, baselined at 6040), then `workspace-section.tsx` (1039); `dashboard-panel.tsx` (690) stays near 700 because rows 1–2 are extracted to `dashboard-rows.tsx` (AGENTS.md panel-split convention). Task 7 runs `size:check` once.
- Cite symbols, never `path:line`, in any doc you edit (`docs:claims:check` ratchets new line cites).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/arrangement-layout.ts` (modify) | `BlockWidth`/`BlockHeight` replace `BlockSpan`; optional `upgrades` on `ArrangementLayout`; `reconcile` carries it. |
| `src/app/arrangement-grid.tsx` (modify) | `W_CLASS: Record<BlockWidth,…>` unchanged values; `H_CLASS: Record<BlockHeight,…>` gains `row-span-5`…`row-span-8`. |
| `src/app/arrangement-tile.tsx`, `src/app/arrangement-block-menu.tsx`, `src/app/dashboard-tiles.ts`, `src/app/dashboard-tile-menu.tsx` (modify) | Take the split span types. |
| `src/app/arrangement-store.ts` (modify) | `readArrangement` sanitises `upgrades`; the guard ignores it. |
| `src/app/use-arrangement.ts` (modify) | Optional `upgrade` option, run before `reconcile`; an upgraded read starts dirty so it is written back once. |
| `src/app/dashboard-layout.ts` (modify) | `DASHBOARD_BURN_UPGRADE`; `DEFAULT_LAYOUT` carries it. |
| `src/app/dashboard-layout-upgrade.ts` (create) | Pure `upgradeDashboardLayout`. Coverage-gated `.ts` — tested, not excluded. |
| `src/app/use-dashboard-layout.ts` (modify) | Passes the upgrade to `useArrangement`. |
| `src/app/dashboard-tile-bodies.tsx` (modify) | Burn body chart-only; the KPI body's Effort SPI/CPI tiles are model-keyed, no new prop. |
| `src/app/dashboard-sections/dashboard-kpi-strip.tsx` (modify) | Effort SPI/CPI tiles with their hints. |
| `src/app/next-actions/group.ts` (modify) | `pickHeroGroup`; `topGroupPrimaries` takes groups. |
| `src/app/task-manager.tsx`, `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx`, `src/app/actions-panel.tsx`, `src/app/action-hero-card.tsx` (modify) | Grouping lifted once; groups + hero + handler bundle threaded. |
| `src/app/dashboard-rows.tsx` (create) | `DashboardTopRow` (row 1) and `DashboardStatusRow` (row 2), presentational. |
| `src/app/arrangement-shelf.tsx` (modify) | Extract `ArrangementShelfTray`; `ArrangementShelf` (Reports) composes it, DOM unchanged. |
| `src/app/dashboard-shelf.tsx` (modify) | Now the Dashboard's TRAY adapter; exports `DASHBOARD_SHELF_TRAY_ID`. |
| `src/app/dashboard-hidden-badge.tsx` (create) | The count badge (toggle + drop target). |
| `src/app/dashboard-panel.tsx` (modify, Tasks 4–6) | Money plumbing removed; row 2; row 1 + badge + tray; focus requests. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` (modify) | Task 4 removes three dead keys; Task 6 adds the badge's two keys. |
| Tests | Listed per task, each hit labelled DELETE / MIGRATE / KEEP. |
| `docs/AGENTS/dashboard.md`, `AGENTS.md` (modify) | Task 7. |
| `e2e/dashboard-grid.spec.ts` (modify), `e2e/visual.spec.ts-snapshots/dashboard-visual-win32.png` (regenerate) | Task 7. |

---

## Task 1: Split the span type — widths 1–4, heights 1–8

**Files:**
- Modify: `src/app/arrangement-layout.ts`, `src/app/arrangement-grid.tsx`, `src/app/arrangement-tile.tsx`, `src/app/arrangement-block-menu.tsx`, `src/app/arrangement-store.ts` (comment), `src/app/dashboard-tiles.ts`, `src/app/dashboard-tile-menu.tsx`, `src/app/dashboard-tile.tsx` (comment), `src/app/report-blocks.ts` (comments), `src/app/reports.tsx` (comment)
- Test: `src/app/arrangement-grid.test.tsx`, `src/app/arrangement-block-menu.test.tsx`, `src/app/arrangement-layout.property.test.ts`, `src/app/dashboard-layout.property.test.ts`, `src/app/dashboard-tiles.test.ts`, `src/app/report-blocks.test.ts`, `src/app/reports.test.tsx` (comment only)

**Interfaces:**
- Consumes: nothing new.
- Produces (every later task relies on these names):
  ```ts
  // arrangement-layout.ts
  export type BlockWidth = 1 | 2 | 3 | 4;
  export type BlockHeight = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  // BlockSpec: w, minW, maxW: BlockWidth; h, minH, maxH: BlockHeight
  // PlacedBlock: w: BlockWidth; h: BlockHeight
  // dashboard-tiles.ts
  export type TileWidth = BlockWidth;
  export type TileHeight = BlockHeight;
  // arrangement-grid.tsx
  export const W_CLASS: Record<BlockWidth, string>;   // values unchanged
  export const H_CLASS: Record<BlockHeight, string>;  // 1..8 → "row-span-1".."row-span-8"
  ```
  `BlockSpan` and `TileSpan` are DELETED (no alias kept — a kept alias would let a width call site keep a type that can hold 8).

**Ruling (brief item 2 — every consumer of `BlockSpan`/`TileSpan`):** `grep -rn "BlockSpan\|TileSpan" src e2e scripts --include=*.ts --include=*.tsx` → 16 files today. Classification:

| Hit | Label | Takes |
|---|---|---|
| `arrangement-layout.ts` decl + `BlockSpec`/`PlacedBlock` fields + `clampSpan` + header comment | MIGRATE | width fields `BlockWidth`, height fields `BlockHeight`; `clampSpan` generic |
| `arrangement-layout.ts` `resizeBlock` | MIGRATE | clamps each axis with its own type (two branches, no computed key) |
| `arrangement-grid.tsx` `W_CLASS` / `H_CLASS` + comment | MIGRATE | `Record<BlockWidth>` / `Record<BlockHeight>` |
| `arrangement-tile.tsx` props `w`/`h` | MIGRATE | `BlockWidth` / `BlockHeight` |
| `arrangement-block-menu.tsx` `spansBetween`, `AxisGroup`, `ArrangementBlockMenu` props, `SpanValue` | MIGRATE | the picker is typed on `BlockHeight` (the wider union; widths are a subset), bounds per axis |
| `dashboard-tiles.ts` `TileSpan` + `TileSpec` fields | MIGRATE | `TileWidth` / `TileHeight` |
| `dashboard-tile-menu.tsx` props + `TileAxisGroup` | MIGRATE | `TileWidth`/`TileHeight`; picker on `TileHeight` |
| `arrangement-store.ts`, `dashboard-tile.tsx`, `report-blocks.ts` (2), `reports.tsx`, `reports.test.tsx` | MIGRATE (comment text only) | named below |
| `arrangement-block-menu.test.tsx`, `arrangement-layout.property.test.ts`, `dashboard-layout.property.test.ts`, `report-blocks.test.ts` | MIGRATE | the split types |
| `arrangement-grid.test.tsx` source scan (`toHaveLength(4)`) | MIGRATE | 4 widths, 8 heights |
| `dashboard-tiles.test.ts` "keeps every limit within the 1..4 span range" | MIGRATE | widths 1–4, heights 1–8 |
| `dashboard-grid.test.tsx` runtime table asserts (`/^row-span-\d$/`) | KEEP | still true |

Resize clamping: `resizeBlock` and `reconcile` both clamp through `clampSpan`, which becomes generic over the axis type, so a width is clamped into `[minW, maxW]: BlockWidth` and a height into `[minH, maxH]: BlockHeight`.

- [ ] **Step 1: Write the failing tests**

`src/app/arrangement-grid.test.tsx` — inside `describe("span class tables", …)`, directly after the `it("does not clamp height", …)` block, add:

```tsx
  it("holds a WHOLE literal row-span class for each Dashboard-only height 5–8 (spec C)", () => {
    // ★★ A literal assertion, not the regex above: `/^row-span-\d$/` would pass
    // a table that spelled 8 as `row-span-4`. Heights 5–8 exist for the
    // Dashboard's tall Budget burn tile; Reports caps itself at 4 through its
    // own catalogue (`report-blocks.test.ts`).
    expect(H_CLASS[5]).toBe("row-span-5");
    expect(H_CLASS[6]).toBe("row-span-6");
    expect(H_CLASS[7]).toBe("row-span-7");
    expect(H_CLASS[8]).toBe("row-span-8");
  });
```

and in `describe("span class tables (source form)", …)` replace

```tsx
  for (const name of ["W_CLASS", "H_CLASS"]) {
    it(`holds ${name} as whole double-quoted literals, never a template`, () => {
      const body = tableBody(name);
      expect(body).not.toContain("${");
      expect(body).not.toContain("`");
      const values = [...body.matchAll(/^\s*\d\s*:\s*(.+?),\s*$/gm)].map((m) => m[1]);
      expect(values).toHaveLength(4);          // one per BlockSpan; a miss means the regex drifted
```

with

```tsx
  // ★ Spec C split the span type: four WIDTHS (`BlockWidth`, the four-column
  // grid) and eight HEIGHTS (`BlockHeight`). A miss means the regex drifted or
  // a table lost an entry.
  const ENTRIES: Record<"W_CLASS" | "H_CLASS", number> = { W_CLASS: 4, H_CLASS: 8 };
  for (const name of ["W_CLASS", "H_CLASS"] as const) {
    it(`holds ${name} as whole double-quoted literals, never a template`, () => {
      const body = tableBody(name);
      expect(body).not.toContain("${");
      expect(body).not.toContain("`");
      const values = [...body.matchAll(/^\s*\d\s*:\s*(.+?),\s*$/gm)].map((m) => m[1]);
      expect(values).toHaveLength(ENTRIES[name]);
```

`src/app/arrangement-block-menu.test.tsx` — replace

```tsx
import type { BlockSpan } from "./arrangement-layout";

type Bounds = { minW?: BlockSpan; maxW?: BlockSpan; minH?: BlockSpan; maxH?: BlockSpan };
```

with

```tsx
import type { BlockHeight, BlockWidth } from "./arrangement-layout";

type Bounds = { minW?: BlockWidth; maxW?: BlockWidth; minH?: BlockHeight; maxH?: BlockHeight };
```

replace `    onResize?: (a: "w" | "h", v: BlockSpan) => void;` with `    onResize?: (a: "w" | "h", v: BlockHeight) => void;`, and add at the end of the file's first `describe` block (before its closing `});`):

```tsx
  it("offers the Dashboard-only heights 5–8 when a block's bounds allow them (spec C)", () => {
    menu({ minH: 4, maxH: 8 });
    const group = screen.getByRole("radiogroup", { name: "Height – Alpha board" });
    expect(within(group).getAllByRole("radio")).toHaveLength(5);
    for (const n of [4, 5, 6, 7, 8]) {
      expect(within(group).getByRole("radio", { name: `Height ${n} – Alpha board` })).toBeInTheDocument();
    }
  });
```

`src/app/arrangement-layout.property.test.ts` — in the import, replace `type BlockSpec, type ArrangementLayout, type BlockSpan,` with `type BlockSpec, type ArrangementLayout, type BlockWidth, type BlockHeight,`; replace `const spanArb = fc.constantFrom<BlockSpan>(1, 2, 3, 4);` with

```ts
const widthArb = fc.constantFrom<BlockWidth>(1, 2, 3, 4);
const heightArb = fc.constantFrom<BlockHeight>(1, 2, 3, 4, 5, 6, 7, 8);
```

replace `  board: fc.array(fc.record({ id: idArb, w: spanArb, h: spanArb }), { maxLength: 8 }),` with `  board: fc.array(fc.record({ id: idArb, w: widthArb, h: heightArb }), { maxLength: 8 }),`, and in the comment above `layoutArb` replace `` `w: spanArb` `` with `` `w: widthArb` ``.

`src/app/dashboard-layout.property.test.ts` — replace

```ts
import { DASHBOARD_TILES, type DashboardTileId, type TileSpan } from "./dashboard-tiles";

const anyId = fc.constantFrom(...DASHBOARD_TILES.map((t) => t.id));
const anySpan = fc.constantFrom<TileSpan>(1, 2, 3, 4);
```

with

```ts
import { DASHBOARD_TILES, type DashboardTileId, type TileHeight, type TileWidth } from "./dashboard-tiles";

const anyId = fc.constantFrom(...DASHBOARD_TILES.map((t) => t.id));
const anyWidth = fc.constantFrom<TileWidth>(1, 2, 3, 4);
const anyHeight = fc.constantFrom<TileHeight>(1, 2, 3, 4, 5, 6, 7, 8);
```

and `  board: fc.array(fc.record({ id: anyId, w: anySpan, h: anySpan }), { maxLength: 15 }),` with `  board: fc.array(fc.record({ id: anyId, w: anyWidth, h: anyHeight }), { maxLength: 15 }),`.

`src/app/dashboard-tiles.test.ts` — replace the whole `it("keeps every limit within the 1..4 span range", …)` block with

```ts
  it("keeps every width within 1..4 and every height within 1..8", () => {
    // ★ Spec C split the span type: widths stay on the four-column grid,
    // heights reach 8 for the Dashboard's tall tiles.
    for (const t of DASHBOARD_TILES) {
      for (const v of [t.minW, t.maxW]) {
        expect(v, `${t.id} width`).toBeGreaterThanOrEqual(1);
        expect(v, `${t.id} width`).toBeLessThanOrEqual(4);
      }
      for (const v of [t.minH, t.maxH]) {
        expect(v, `${t.id} height`).toBeGreaterThanOrEqual(1);
        expect(v, `${t.id} height`).toBeLessThanOrEqual(8);
      }
    }
  });
```

`src/app/report-blocks.test.ts` — replace `import { defaultLayout, reconcile, type BlockSpan } from "./arrangement-layout";` with `import { defaultLayout, reconcile, resizeBlock, type BlockWidth } from "./arrangement-layout";`; replace both remaining `` `Record<ReportBlockId, BlockSpan>` `` comment mentions with `` `Record<ReportBlockId, BlockWidth>` ``; replace `const EXPECTED_MIN_W: Record<ReportBlockId, BlockSpan> = {` with `const EXPECTED_MIN_W: Record<ReportBlockId, BlockWidth> = {`; and directly after the `it("keeps every span within its own bounds", …)` block add:

```ts
  // ★★ Spec C decision 10: heights 5–8 exist for the DASHBOARD only. The engine
  // type now admits 8, so the Reports cap is this catalogue's own `maxH` — and
  // nothing else. These two pin it.
  it("caps every block's height at 4", () => {
    for (const b of REPORT_BLOCKS) {
      expect(b.maxH, `${b.id} maxH`).toBeLessThanOrEqual(4);
      expect(b.h, `${b.id} h`).toBeLessThanOrEqual(4);
    }
  });

  it("refuses a resize past 4 on every block", () => {
    for (const b of REPORT_BLOCKS) {
      const next = resizeBlock(REPORT_BLOCKS, REPORTS_DEFAULT_LAYOUT, b.id, "h", 8);
      expect(next.board.find((p) => p.id === b.id)!.h, b.id).toBeLessThanOrEqual(4);
    }
  });
```

- [ ] **Step 2: Run them and watch the right ones fail**

```bash
npx vitest run src/app/arrangement-grid.test.tsx src/app/arrangement-block-menu.test.tsx src/app/arrangement-layout.test.ts src/app/arrangement-layout.property.test.ts src/app/dashboard-layout.property.test.ts src/app/dashboard-layout.test.ts src/app/dashboard-tiles.test.ts src/app/report-blocks.test.ts src/app/dashboard-grid.test.tsx src/app/arrangement-tile.test.tsx > /tmp/dlr-t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" /tmp/dlr-t1.log | head -20
```
Expected: EXIT=1. `H_CLASS[5]` is `undefined` (the literal test fails) and the `H_CLASS` source scan counts 4, not 8. Already green, as pins: the 5–8 height-radio test (at runtime `spansBetween` already emits 4…8; it pins that the widened TYPE keeps doing so) and the two Reports cap tests (an existing property that the type change makes load-bearing). `npx tsc --noEmit` fails now (the imported types do not exist) — expected until Step 3.

- [ ] **Step 3: Implement the split**

`src/app/arrangement-layout.ts` (Edit tool):

(a) header comment — replace

```ts
 *   1. `BlockSpan` is `1|2|3|4` — a FOUR-COLUMN grid, baked in as a closed
```

with

```ts
 *   1. `BlockWidth` is `1|2|3|4` — a FOUR-COLUMN grid, baked in as a closed
```

(b) replace

```ts
/** A block spans 1-4 grid columns/rows. A CLOSED union on purpose: `number`
 *  would let an un-clamped value through the type system into storage. */
export type BlockSpan = 1 | 2 | 3 | 4;
```

with

```ts
/** A block spans 1-4 grid COLUMNS. A CLOSED union on purpose: `number` would
 *  let an un-clamped value through the type system into storage.
 *  ★★ WIDTH AND HEIGHT ARE SEPARATE TYPES SINCE SPEC C (decision 10). They were
 *  one `1|2|3|4` union; heights 5–8 had to exist for the Dashboard's tall Budget
 *  burn tile, and widening a shared union would have let an 8-WIDE block
 *  type-check — `W_CLASS` has no entry for it, so it would render one column
 *  wide with nothing able to see it. */
export type BlockWidth = 1 | 2 | 3 | 4;

/** A block spans 1-8 grid ROWS. Rows are not a grid dimension, so nothing but a
 *  catalogue's own `maxH` bounds a surface: the Dashboard reaches 8, Reports
 *  caps itself at 4 (`report-blocks.test.ts` pins it). */
export type BlockHeight = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
```

(c) replace

```ts
  labelKey: TranslationKey;
  w: BlockSpan;
  h: BlockSpan;
  minW: BlockSpan;
  maxW: BlockSpan;
  minH: BlockSpan;
  maxH: BlockSpan;
}

export interface PlacedBlock<Id extends string> {
  id: Id;
  w: BlockSpan;
  h: BlockSpan;
}
```

with

```ts
  labelKey: TranslationKey;
  w: BlockWidth;
  h: BlockHeight;
  minW: BlockWidth;
  maxW: BlockWidth;
  minH: BlockHeight;
  maxH: BlockHeight;
}

export interface PlacedBlock<Id extends string> {
  id: Id;
  w: BlockWidth;
  h: BlockHeight;
}
```

(d) replace

```ts
/** Clamp `v` into `[lo, hi]`, keeping the BlockSpan type. */
function clampSpan(v: number, lo: BlockSpan, hi: BlockSpan): BlockSpan {
  return Math.max(lo, Math.min(hi, Math.round(v))) as BlockSpan;
}
```

with

```ts
/** Clamp `v` into `[lo, hi]`, keeping the axis's own span type — a width
 *  clamps to a `BlockWidth`, a height to a `BlockHeight`. */
function clampSpan<S extends number>(v: number, lo: S, hi: S): S {
  return Math.max(lo, Math.min(hi, Math.round(v))) as S;
}
```

(e) in `resizeBlock`, replace

```ts
  const next = axis === "w"
    ? clampSpan(value, spec.minW, spec.maxW)
    : clampSpan(value, spec.minH, spec.maxH);
  if (layout.board[i][axis] === next) return layout;
  const board = [...layout.board];
  board[i] = { ...board[i], [axis]: next };
  return { ...layout, board };
```

with

```ts
  // ★ Two branches, not a computed `[axis]` key: a computed key of type
  // `"w" | "h"` is not checked per axis, so it would let a height value into
  // `w` with no type error now that the two axes have different types.
  const board = [...layout.board];
  if (axis === "w") {
    const next = clampSpan(value, spec.minW, spec.maxW);
    if (layout.board[i].w === next) return layout;
    board[i] = { ...board[i], w: next };
  } else {
    const next = clampSpan(value, spec.minH, spec.maxH);
    if (layout.board[i].h === next) return layout;
    board[i] = { ...board[i], h: next };
  }
  return { ...layout, board };
```

`src/app/arrangement-grid.tsx`: replace `import type { BlockSpan } from "./arrangement-layout";` with `import type { BlockHeight, BlockWidth } from "./arrangement-layout";`; replace `export const W_CLASS: Record<BlockSpan, string> = {` with `export const W_CLASS: Record<BlockWidth, string> = {`; replace

```tsx
export const H_CLASS: Record<BlockSpan, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
};
```

with

```tsx
// ★★ 5–8 exist for the Dashboard only (spec C decision 10): its Budget burn
// tile defaults to 8 rows. Reports caps its own heights at 4 through its
// catalogue. Whole literals, like every entry here.
export const H_CLASS: Record<BlockHeight, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
  5: "row-span-5",
  6: "row-span-6",
  7: "row-span-7",
  8: "row-span-8",
};
```

and replace

```tsx
 * ★★ THE FOUR-COLUMN GRID IS BAKED IN HERE AND IN `BlockSpan`, and the two must
 * move together. `xl:grid-cols-4` below is the same assumption `BlockSpan`'s
```

with

```tsx
 * ★★ THE FOUR-COLUMN GRID IS BAKED IN HERE AND IN `BlockWidth`, and the two must
 * move together. `xl:grid-cols-4` below is the same assumption `BlockWidth`'s
```

`src/app/arrangement-tile.tsx`: replace `import type { BlockSpan } from "./arrangement-layout";` with `import type { BlockHeight, BlockWidth } from "./arrangement-layout";` and

```tsx
  w: BlockSpan;
  h: BlockSpan;
```

with

```tsx
  w: BlockWidth;
  h: BlockHeight;
```

`src/app/arrangement-block-menu.tsx`: replace `import type { BlockSpan } from "./arrangement-layout";` with `import type { BlockHeight, BlockWidth } from "./arrangement-layout";`; replace

```tsx
/** `SegmentedControl` is generic over a STRING union, so spans cross as text. */
type SpanValue = "1" | "2" | "3" | "4";

function spansBetween(lo: BlockSpan, hi: BlockSpan): BlockSpan[] {
  const out: BlockSpan[] = [];
  for (let n = lo; n <= hi; n += 1) out.push(n as BlockSpan);
  return out;
}
```

with

```tsx
/** `SegmentedControl` is generic over a STRING union, so spans cross as text.
 *  ★ Covers the HEIGHT range (1–8, spec C); widths are the 1–4 subset. */
type SpanValue = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

/** ★ Typed on `BlockHeight`, the wider union: one picker serves both axes, and
 *  every width is a valid height value, never the reverse. */
function spansBetween(lo: BlockHeight, hi: BlockHeight): BlockHeight[] {
  const out: BlockHeight[] = [];
  for (let n: number = lo; n <= hi; n += 1) out.push(n as BlockHeight);
  return out;
}
```

replace

```tsx
  value: BlockSpan;
  lo: BlockSpan;
  hi: BlockSpan;
  onPick: (v: BlockSpan) => void;
```

with

```tsx
  value: BlockHeight;
  lo: BlockHeight;
  hi: BlockHeight;
  onPick: (v: BlockHeight) => void;
```

replace `          onChange={(v) => onPick(Number(v) as BlockSpan)}` with `          onChange={(v) => onPick(Number(v) as BlockHeight)}`; and replace

```tsx
  w: BlockSpan;
  h: BlockSpan;
  /** The four bounds, from whoever owns the catalogue. See the ★★★ above. */
  minW: BlockSpan;
  maxW: BlockSpan;
  minH: BlockSpan;
  maxH: BlockSpan;
```

with

```tsx
  w: BlockWidth;
  h: BlockHeight;
  /** The four bounds, from whoever owns the catalogue. See the ★★★ above. */
  minW: BlockWidth;
  maxW: BlockWidth;
  minH: BlockHeight;
  maxH: BlockHeight;
```

and `  onResize: (axis: "w" | "h", value: BlockSpan) => void;` with `  onResize: (axis: "w" | "h", value: BlockHeight) => void;`.

`src/app/dashboard-tiles.ts`: replace `import { specById, type BlockSpan } from "./arrangement-layout";` with `import { specById, type BlockHeight, type BlockWidth } from "./arrangement-layout";`; replace

```ts
/** ★ AN ALIAS OF THE ENGINE'S `BlockSpan`, NOT A SECOND DECLARATION. The two
 *  were briefly independent spellings of the same closed union, which is how a
 *  widened engine and an un-widened catalogue could have disagreed in silence.
 *  The NAME stays because it has 20+ call sites across the Dashboard's own
 *  components — this is a rename-free collapse, not an export change. */
export type TileSpan = BlockSpan;
```

with

```ts
/** ★ ALIASES OF THE ENGINE'S `BlockWidth` / `BlockHeight`, NOT SECOND
 *  DECLARATIONS. Two independent spellings of one union are how a widened
 *  engine and an un-widened catalogue could disagree in silence. Spec C split
 *  the former single `TileSpan` in two so an 8-wide tile cannot type-check. */
export type TileWidth = BlockWidth;
export type TileHeight = BlockHeight;
```

and

```ts
  w: TileSpan;
  h: TileSpan;
  minW: TileSpan;
  maxW: TileSpan;
  minH: TileSpan;
  maxH: TileSpan;
```

with

```ts
  w: TileWidth;
  h: TileHeight;
  minW: TileWidth;
  maxW: TileWidth;
  minH: TileHeight;
  maxH: TileHeight;
```

`src/app/dashboard-tile-menu.tsx`: replace `import { tileById, type DashboardTileId, type TileSpan } from "./dashboard-tiles";` with `import { tileById, type DashboardTileId, type TileHeight, type TileWidth } from "./dashboard-tiles";`; in `DashboardTileMenu`'s props replace

```tsx
  w: TileSpan;
  h: TileSpan;
```

with

```tsx
  w: TileWidth;
  h: TileHeight;
```

and `  onResize: (axis: "w" | "h", value: TileSpan) => void;` with `  onResize: (axis: "w" | "h", value: TileHeight) => void;`; in `TileAxisGroup`'s props replace

```tsx
  value: TileSpan;
  lo: TileSpan;
  hi: TileSpan;
  onPick: (v: TileSpan) => void;
```

with

```tsx
  value: TileHeight;
  lo: TileHeight;
  hi: TileHeight;
  onPick: (v: TileHeight) => void;
```

Comment-only sweeps (Edit tool):
- `src/app/arrangement-store.ts`: `` `PlacedBlock`'s `w`/`h` are `BlockSpan = 1|2|3|4`, while this accepts any `` → `` `PlacedBlock`'s `w`/`h` are `BlockWidth`/`BlockHeight` (1–4 / 1–8), while this accepts any ``
- `src/app/dashboard-tile.tsx`: `` ENGINE's vocabulary — `BlockSpec`, `PlacedBlock`, `BlockSpan`, `moveBlock` — `` → `` ENGINE's vocabulary — `BlockSpec`, `PlacedBlock`, `BlockWidth`, `moveBlock` — ``
- `src/app/report-blocks.ts`: `` whole embedded report panel. `BlockSpan` is `1|2|3|4` over a four-column `` → `` whole embedded report panel. `BlockWidth` is `1|2|3|4` over a four-column ``; and `` The reason for the number: `BlockSpan` caps at 4, so at the Dashboard's `` → `` The reason for the number: this catalogue caps every `maxH` at 4, so at the Dashboard's ``
- `src/app/reports.tsx`: `` difference. ★★ 120px, not the Dashboard's 80px: `BlockSpan` caps at 4, `` → `` difference. ★★ 120px, not the Dashboard's 80px: `REPORT_BLOCKS` caps heights at 4, ``
- `src/app/reports.test.tsx`: `` // `BlockSpan` caps at 4, so an 80px unit would put an embedded report in a `` → `` // `REPORT_BLOCKS` caps heights at 4, so an 80px unit would put an embedded report in a ``

- [ ] **Step 4: Prove nothing still names the old types, then run the tests and gates**

```bash
grep -rn "BlockSpan\|TileSpan" src e2e scripts --include=*.ts --include=*.tsx > /tmp/dlr-t1-sweep.log; echo "GREP_EXIT=$?"; cat /tmp/dlr-t1-sweep.log
npx vitest run src/app/arrangement-grid.test.tsx src/app/arrangement-block-menu.test.tsx src/app/arrangement-layout.test.ts src/app/arrangement-layout.property.test.ts src/app/dashboard-layout.property.test.ts src/app/dashboard-layout.test.ts src/app/dashboard-tiles.test.ts src/app/report-blocks.test.ts src/app/dashboard-grid.test.tsx src/app/arrangement-tile.test.tsx > /tmp/dlr-t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/dlr-t1.log
npx tsc --noEmit > /tmp/dlr-tsc1.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc1.log
npx eslint --max-warnings=0 src/app/arrangement-layout.ts src/app/arrangement-grid.tsx src/app/arrangement-tile.tsx src/app/arrangement-block-menu.tsx src/app/arrangement-store.ts src/app/dashboard-tiles.ts src/app/dashboard-tile-menu.tsx src/app/dashboard-tile.tsx src/app/report-blocks.ts src/app/reports.tsx src/app/reports.test.tsx src/app/arrangement-grid.test.tsx src/app/arrangement-block-menu.test.tsx src/app/arrangement-layout.property.test.ts src/app/dashboard-layout.property.test.ts src/app/dashboard-tiles.test.ts src/app/report-blocks.test.ts; echo "LINT_EXIT=$?"
```
Expected: GREP_EXIT=1 with an empty log (grep found nothing); EXIT=0 with `Test Files  10 passed (10)`; TSC_EXIT=0 and `0`; LINT_EXIT=0.

- [ ] **Step 5: Mutation-check the height table**

With the Edit tool change `  8: "row-span-8",` in `arrangement-grid.tsx` to `  8: "row-span-4",`. Re-run the vitest command from Step 4: expected EXIT=1 — "holds a WHOLE literal row-span class for each Dashboard-only height 5–8" fails (the source scan still passes — it only proves literalness, which is exactly why the literal test exists). Revert with the inverse Edit, re-run: EXIT=0. Then `git diff --stat` — expected exactly the 17 files named in this task's **Files**.

- [ ] **Step 6: Commit**

```bash
git add src/app/arrangement-layout.ts src/app/arrangement-grid.tsx src/app/arrangement-tile.tsx src/app/arrangement-block-menu.tsx src/app/arrangement-store.ts src/app/dashboard-tiles.ts src/app/dashboard-tile-menu.tsx src/app/dashboard-tile.tsx src/app/report-blocks.ts src/app/reports.tsx src/app/reports.test.tsx src/app/arrangement-grid.test.tsx src/app/arrangement-block-menu.test.tsx src/app/arrangement-layout.property.test.ts src/app/dashboard-layout.property.test.ts src/app/dashboard-tiles.test.ts src/app/report-blocks.test.ts
git commit -F - <<'EOF'
refactor(arrangement): split the span type into widths 1-4 and heights 1-8

BlockSpan was one 1|2|3|4 union for both axes. Heights 5-8 are needed for
the Dashboard's tall Budget burn tile, and widening the shared union would
let an 8-wide block type-check with no W_CLASS entry behind it. Width and
height are now BlockWidth and BlockHeight (TileWidth/TileHeight on the
Dashboard), resizeBlock clamps each axis with its own type, and H_CLASS
gains literal row-span-5 to row-span-8. Reports keeps a maximum height of 4
through its own catalogue, now pinned by a test.
EOF
```

---

## Task 2: The optional `upgrades` list and the hook's upgrade seam (engine-level)

**Files:**
- Modify: `src/app/arrangement-layout.ts`, `src/app/arrangement-store.ts`, `src/app/use-arrangement.ts`
- Test: `src/app/arrangement-layout.test.ts`, `src/app/arrangement-store.test.ts`, `src/app/use-arrangement.test.tsx`, `src/app/use-reports-arrangement.test.tsx`

**Interfaces:**
- Consumes: Task 1's types.
- Produces:
  ```ts
  // arrangement-layout.ts
  export interface ArrangementLayout<Id extends string> {
    v: 1; board: PlacedBlock<Id>[]; hidden: Id[];
    upgrades?: readonly string[];          // applied one-time upgrade ids
  }
  // reconcile(...) returns { v: 1, board, hidden } plus `upgrades` when the stored layout had one.
  // arrangement-store.ts
  export function sanitizeUpgrades(raw: unknown): string[] | undefined; // non-array → undefined; strings only, de-duplicated
  // readArrangement: an `ok` layout carries a sanitised `upgrades` or none; isArrangementLayout ignores the field.
  // use-arrangement.ts — ArrangementOptions<Id> gains:
  upgrade?: (stored: ArrangementLayout<Id>) => ArrangementLayout<Id>;
  ```

**Ruling (brief item 1 — `upgrades` plumbing):**
- *Type:* `upgrades?: readonly string[]` on `ArrangementLayout`, generic over nothing — the ids are surface strings the engine never interprets.
- *Validation:* `isArrangementLayout` stays unchanged and ignores the field (so a junk value can never reject — and thereby reset — a layout). `readArrangement`, the single read path, returns the `ok` layout through `sanitizeUpgrades`: a non-array is dropped, an array keeps only its distinct strings. `loadArrangement` inherits it (it wraps `readArrangement`).
- *`reconcile`:* returns `{ v: 1, board, hidden }` as before, plus `upgrades: stored.upgrades` when present — no key when absent, so every existing `toEqual` stays byte-stable. The fresh-object identity behaviour is untouched.
- *Mutators:* they already spread `...layout`, so they carry the list for free (pinned below).
- *Hook seam:* `useArrangement` takes an optional `upgrade`. `readLayout` runs it on the `ok` read only (never on `missing`/`rejected`, never on the seed) BEFORE `reconcile`, and reports `upgraded = (result !== stored)`. The state starts `dirty: upgraded`, so the existing debounced persist writes the upgraded layout back exactly once (the next load finds the id and the upgrade returns its input by reference). `readOnly` still suppresses the write. The contract "return the input BY REFERENCE when there is nothing to do" is documented on the option and pinned; it is a contract on the UPGRADE's output, not on `reconcile`'s, so it does not violate the rule that nothing may build a persist-skip on `reconcile`'s identity.
- *Surfaces:* Reports passes no `upgrade` (`use-reports-arrangement.ts` is not touched), so it is never upgraded — pinned below. The Dashboard wires its upgrade in Task 3.

- [ ] **Step 1: Write the failing tests**

`src/app/arrangement-layout.test.ts` — append at the end of the file:

```ts
describe("arrangement-layout — the applied-upgrades list (spec C)", () => {
  const withUpgrades: ArrangementLayout<TestId> = { ...DEF, upgrades: ["u1"] };

  it("reconcile carries a stored upgrades list through", () => {
    expect(reconcile(CAT, withUpgrades, DEF).upgrades).toEqual(["u1"]);
  });

  it("reconcile adds no upgrades key to a layout that had none", () => {
    expect("upgrades" in reconcile(CAT, { v: 1, board: DEF.board, hidden: [] }, DEF)).toBe(false);
  });

  it("the four mutators keep the list", () => {
    expect(moveBlock(withUpgrades, "a", "c").upgrades).toEqual(["u1"]);
    expect(hideBlock(withUpgrades, "b").upgrades).toEqual(["u1"]);
    expect(restoreBlock(CAT, hideBlock(withUpgrades, "b"), "b").upgrades).toEqual(["u1"]);
    expect(resizeBlock(CAT, withUpgrades, "a", "w", 4).upgrades).toEqual(["u1"]);
  });
});
```

`src/app/arrangement-store.test.ts` — append at the end of the file:

```ts
describe("the optional upgrades list (spec C)", () => {
  beforeEach(() => localStorage.clear());

  it("accepts a v:1 layout with and without an upgrades list", () => {
    expect(isArrangementLayout(L)).toBe(true);
    expect(isArrangementLayout({ ...L, upgrades: ["dashboard-burn-2x8"] })).toBe(true);
  });

  it("never rejects a layout for a junk upgrades value", () => {
    for (const junk of ["nope", 7, null, { a: 1 }, [1, null]]) {
      expect(isArrangementLayout({ ...L, upgrades: junk }), JSON.stringify(junk)).toBe(true);
    }
  });

  it("reads a non-array upgrades value as absent, keeping the layout", () => {
    for (const junk of ["nope", 7, null, { a: 1 }]) {
      localStorage.setItem(KEY_A, JSON.stringify({ p1: { ...L, upgrades: junk } }));
      const read = readArrangement(KEY_A, "p1");
      expect(read.status, JSON.stringify(junk)).toBe("ok");
      expect(read.status === "ok" && "upgrades" in read.layout, JSON.stringify(junk)).toBe(false);
    }
  });

  it("keeps only the distinct string members of an upgrades array", () => {
    localStorage.setItem(KEY_A, JSON.stringify({ p1: { ...L, upgrades: ["a", 3, null, "a", "b"] } }));
    expect(readArrangement(KEY_A, "p1")).toEqual({ status: "ok", layout: { ...L, upgrades: ["a", "b"] } });
  });

  it("round-trips a clean list through save and load", () => {
    saveArrangement(KEY_A, "p1", { ...L, upgrades: ["u1"] });
    expect(loadArrangement(KEY_A, "p1")).toEqual({ ...L, upgrades: ["u1"] });
  });
});
```

`src/app/use-arrangement.test.tsx` — extend the `Harness`: in its props destructuring replace

```tsx
  seed,
  log,
}: {
  projectId?: string;
  readOnly?: boolean;
  seed?: () => ArrangementLayout<TestId> | null;
  log?: string[];
}) {
  const a = useArrangement<TestId>({
    catalogue: CAT, storageKey: KEY, fallback: FALLBACK, projectId, readOnly, seed,
  });
```

with

```tsx
  seed,
  upgrade,
  log,
}: {
  projectId?: string;
  readOnly?: boolean;
  seed?: () => ArrangementLayout<TestId> | null;
  upgrade?: (l: ArrangementLayout<TestId>) => ArrangementLayout<TestId>;
  log?: string[];
}) {
  const a = useArrangement<TestId>({
    catalogue: CAT, storageKey: KEY, fallback: FALLBACK, projectId, readOnly, seed, upgrade,
  });
```

and append at the end of the file:

```tsx
describe("useArrangement — the optional upgrade (spec C)", () => {
  const STORED: ArrangementLayout<TestId> = {
    v: 1, board: [{ id: "a", w: 2, h: 2 }, { id: "b", w: 1, h: 1 }, { id: "c", w: 4, h: 2 }], hidden: [],
  };
  /** Reverses the board and records "u1"; returns its input BY REFERENCE once
   *  "u1" is recorded — the contract the option documents. */
  const markU1 = (l: ArrangementLayout<TestId>): ArrangementLayout<TestId> =>
    l.upgrades?.includes("u1")
      ? l
      : { ...l, board: [...l.board].reverse(), upgrades: [...(l.upgrades ?? []), "u1"] };

  it("runs on a stored layout before reconcile and writes the result back once", async () => {
    vi.useFakeTimers();
    saveArrangement(KEY, "p1", STORED);
    render(<Harness upgrade={markU1} />);
    expect(ids()).toEqual(["c", "b", "a"]);
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    const stored = loadArrangement(KEY, "p1")!;
    expect(stored.upgrades).toEqual(["u1"]);
    expect(stored.board.map((b) => b.id)).toEqual(["c", "b", "a"]);
  });

  it("writes nothing when the upgrade has nothing to do", async () => {
    vi.useFakeTimers();
    const blob = JSON.stringify({ p1: { ...STORED, upgrades: ["u1"] } });
    localStorage.setItem(KEY, blob);
    render(<Harness upgrade={markU1} />);
    expect(ids()).toEqual(["a", "b", "c"]);
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    expect(localStorage.getItem(KEY)).toBe(blob);
  });

  it("is not consulted when nothing is stored — the fallback is already current", async () => {
    vi.useFakeTimers();
    const upgrade = vi.fn(markU1);
    render(<Harness upgrade={upgrade} />);
    expect(upgrade).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("upgrades in memory but writes nothing when readOnly", async () => {
    vi.useFakeTimers();
    saveArrangement(KEY, "p1", STORED);
    const before = localStorage.getItem(KEY);
    render(<Harness upgrade={markU1} readOnly />);
    expect(ids()).toEqual(["c", "b", "a"]);
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it("upgrades a project switched INTO, and writes it under THAT project's id", async () => {
    vi.useFakeTimers();
    saveArrangement(KEY, "p2", STORED);
    const { rerender } = render(<Harness projectId="p1" upgrade={markU1} />);
    rerender(<Harness projectId="p2" upgrade={markU1} />);
    expect(ids()).toEqual(["c", "b", "a"]);
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    expect(loadArrangement(KEY, "p2")!.upgrades).toEqual(["u1"]);
    expect(loadArrangement(KEY, "p1")).toBeNull();
  });
});
```

`src/app/use-reports-arrangement.test.tsx` — append at the end of the file:

```tsx
describe("useReportsArrangement — no Dashboard upgrade (spec C)", () => {
  it("never upgrades or rewrites a stored Reports layout", () => {
    // ★ Reports binds `useArrangement` with no `upgrade`, so a stored layout
    // with no upgrades list is read, reconciled and left alone — the Dashboard's
    // one-time migration can never reach this surface's key.
    localStorage.setItem(REPORTS_LAYOUT_KEY, JSON.stringify({ p1: { v: 1, board: [{ id: "stats", w: 4, h: 1 }], hidden: [] } }));
    const before = localStorage.getItem(REPORTS_LAYOUT_KEY);
    const r = mount();
    settle();
    expect(localStorage.getItem(REPORTS_LAYOUT_KEY)).toBe(before);
    expect(r.result.current.layout.upgrades).toBeUndefined();
  });
});
```

Breakage sweep for this task: `grep -rn "readArrangement\|loadArrangement\|isArrangementLayout" src e2e --include=*.ts --include=*.tsx | grep -v "^src/app/arrangement-store"` → `use-arrangement.ts` MIGRATE (below), `dashboard-layout-store.ts` KEEP (wraps `loadArrangement`, gains the sanitised read), `arrangement-store.test.ts` KEEP (its `toEqual` read tests compare content, and a sanitised copy is content-equal), `use-arrangement.test.tsx` KEEP + the tests above, `use-reports-arrangement.test.tsx` KEEP. `grep -rn "{ v: 1, board, hidden }" src/app` → only `reconcile` (MIGRATE).

- [ ] **Step 2: Run them and watch the right ones fail**

```bash
npx vitest run src/app/arrangement-layout.test.ts src/app/arrangement-store.test.ts src/app/use-arrangement.test.tsx src/app/use-reports-arrangement.test.tsx > /tmp/dlr-t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" /tmp/dlr-t2.log | head -20
```
Expected: EXIT=1. "reconcile carries a stored upgrades list through" fails (the list is dropped); the two sanitising read tests fail (junk is passed through); the three `useArrangement` upgrade tests that expect `c,b,a` fail (the option is ignored). Already green, as pins: "reconcile adds no upgrades key", "the four mutators keep the list", the two guard tests, the round-trip, "is not consulted when nothing is stored", and the Reports test. `tsc` also fails (`upgrades` is not on the type; `upgrade` is not an option) — expected.

- [ ] **Step 3: Implement**

`src/app/arrangement-layout.ts` — replace

```ts
export interface ArrangementLayout<Id extends string> {
  v: 1;
  board: PlacedBlock<Id>[];
  hidden: Id[];
}
```

with

```ts
export interface ArrangementLayout<Id extends string> {
  v: 1;
  board: PlacedBlock<Id>[];
  hidden: Id[];
  /**
   * Ids of one-time upgrades already applied to this stored layout (spec C
   * decision 11) — how a surface migrates its stored arrangement WITHOUT a
   * version bump, which would be a lockstep decision across every surface
   * (`arrangement-store.ts` says why). Optional: absent on every layout written
   * before it existed and on every surface with no upgrade (Reports).
   * ★★ `readArrangement` sanitises it and `isArrangementLayout` ignores it, so
   * junk here is dropped and never rejects — i.e. never resets — a layout.
   * `reconcile` carries it through. ★ An OLDER build's `reconcile` rebuilds
   * `{v, board, hidden}` and drops it; a layout an older build rewrites is
   * therefore upgraded once more. Accepted in the spec.
   */
  upgrades?: readonly string[];
}
```

and replace `  return { v: 1, board, hidden };` (the last line of `reconcile`) with

```ts
  // ★ Spec C: carry the applied-upgrades list through, and add NO key when the
  // stored layout had none, so a layout without one stays byte-identical.
  return stored.upgrades ? { v: 1, board, hidden, upgrades: stored.upgrades } : { v: 1, board, hidden };
```

`src/app/arrangement-store.ts` — directly after the closing `}` of `isArrangementLayout`, insert:

```ts
/**
 * The optional `upgrades` list, made safe to trust (spec C decision 11): a
 * non-array is dropped (`undefined`), an array keeps only its distinct string
 * members, in order.
 *
 * ★★ SANITISED HERE, NOT REJECTED BY `isArrangementLayout`. A junk list must
 * cost the user nothing but a re-run of an idempotent upgrade; rejecting the
 * whole layout for it would reset their arrangement, which is the one outcome
 * the guard exists to prevent.
 */
export function sanitizeUpgrades(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(raw.filter((u): u is string => typeof u === "string"))];
}

function withSanitizedUpgrades(entry: ArrangementLayout<string>): ArrangementLayout<string> {
  const { upgrades: raw, ...core } = entry as Omit<ArrangementLayout<string>, "upgrades"> & { upgrades?: unknown };
  const upgrades = sanitizeUpgrades(raw);
  return upgrades === undefined ? core : { ...core, upgrades };
}
```

and in `readArrangement` replace

```ts
  return isArrangementLayout(entry) ? { status: "ok", layout: entry } : { status: "rejected" };
```

with

```ts
  return isArrangementLayout(entry)
    ? { status: "ok", layout: withSanitizedUpgrades(entry) }
    : { status: "rejected" };
```

and in `isArrangementLayout`'s docstring, directly before its closing ` */`, add:

```ts
 * ★ It IGNORES the optional `upgrades` list on purpose: `readArrangement`
 * sanitises that field on the way out, so a junk list can never reject a
 * layout (spec C decision 11).
```

`src/app/use-arrangement.ts`:

(a) in `ArrangementOptions`, directly after `  seed?: () => ArrangementLayout<Id> | null;` add:

```ts
  /**
   * ★ Optional one-time migration of a STORED layout (spec C decision 11). It
   * runs on a read that found a usable stored layout (`ok`) — never on a
   * `missing` or `rejected` read and never on the seed — and BEFORE `reconcile`,
   * so it sees the stored order and sizes and `reconcile` then clamps whatever
   * it produced. The Dashboard passes `upgradeDashboardLayout`; Reports passes
   * nothing and is never upgraded.
   * ★★★ IT MUST RETURN ITS INPUT BY REFERENCE WHEN IT HAS NOTHING TO DO. The
   * hook reads "returned a different object" as "the stored blob needs
   * rewriting" and starts that read DIRTY, so the persist effect writes the
   * upgraded layout back exactly once; the next load then finds the upgrade's
   * id and gets its input back. An upgrade that always copies would rewrite
   * storage on every load. That is a contract on THIS function's output, and it
   * is not a persist-skip on `reconcile`'s identity, which stays forbidden.
   * ★★ PURE, for the same reason as `seed`: both `readLayout` call sites run in
   * render (the lazy initialiser and the project-switch reconcile).
   */
  upgrade?: (stored: ArrangementLayout<Id>) => ArrangementLayout<Id>;
```

(b) in the hook's destructuring replace

```ts
  readOnly = false,
  seed,
}: ArrangementOptions<Id>): ArrangementApi<Id> {
```

with

```ts
  readOnly = false,
  seed,
  upgrade,
}: ArrangementOptions<Id>): ArrangementApi<Id> {
```

(c) replace

```ts
  const readLayout = (pid: string): ArrangementLayout<Id> => {
    if (typeof window === "undefined") return fallback;
```

with

```ts
  const readLayout = (pid: string): { layout: ArrangementLayout<Id>; upgraded: boolean } => {
    if (typeof window === "undefined") return { layout: fallback, upgraded: false };
```

and replace

```ts
    const read = readArrangement(storageKey, pid) as ArrangementRead<Id>;
    const stored = read.status === "ok" ? read.layout : null;
    const seeded = read.status === "missing" ? (seed?.() ?? null) : null;
    return reconcile(catalogue, stored ?? seeded, fallback);
  };
```

with

```ts
    const read = readArrangement(storageKey, pid) as ArrangementRead<Id>;
    const stored = read.status === "ok" ? read.layout : null;
    const upgradedStored = stored && upgrade ? upgrade(stored) : stored;
    const seeded = read.status === "missing" ? (seed?.() ?? null) : null;
    return {
      layout: reconcile(catalogue, upgradedStored ?? seeded, fallback),
      upgraded: upgradedStored !== stored,
    };
  };
```

(d) replace

```ts
  }>(() => ({ projectId, layout: readLayout(projectId), dirty: false }));

  // Render-time reconcile — NOT an effect (`set-state-in-effect` is banned).
  if (state.projectId !== projectId) {
    setState({ projectId, layout: readLayout(projectId), dirty: false });
  }
```

with

```ts
  }>(() => {
    const read = readLayout(projectId);
    // ★ Spec C: a read the `upgrade` rewrote starts DIRTY, so the persist
    // effect below writes the upgraded layout back once.
    return { projectId, layout: read.layout, dirty: read.upgraded };
  });

  // Render-time reconcile — NOT an effect (`set-state-in-effect` is banned).
  if (state.projectId !== projectId) {
    const read = readLayout(projectId);
    setState({ projectId, layout: read.layout, dirty: read.upgraded });
  }
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/arrangement-layout.test.ts src/app/arrangement-store.test.ts src/app/use-arrangement.test.tsx src/app/use-reports-arrangement.test.tsx src/app/dashboard-layout-store.test.ts > /tmp/dlr-t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/dlr-t2.log
npx tsc --noEmit > /tmp/dlr-tsc2.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc2.log
npx eslint --max-warnings=0 src/app/arrangement-layout.ts src/app/arrangement-store.ts src/app/use-arrangement.ts src/app/arrangement-layout.test.ts src/app/arrangement-store.test.ts src/app/use-arrangement.test.tsx src/app/use-reports-arrangement.test.tsx; echo "LINT_EXIT=$?"
```
Expected: EXIT=0 with `Test Files  5 passed (5)`; TSC_EXIT=0 and `0`; LINT_EXIT=0.

- [ ] **Step 5: Mutation-check the write-back**

With the Edit tool change `    return { projectId, layout: read.layout, dirty: read.upgraded };` to `    return { projectId, layout: read.layout, dirty: false };`. Re-run the vitest command: expected EXIT=1 — "runs on a stored layout before reconcile and writes the result back once" fails (nothing is written). Revert, re-run: EXIT=0. Second mutant: in `reconcile` replace the new return with `  return { v: 1, board, hidden };` — "reconcile carries a stored upgrades list through" fails. Revert, re-run: EXIT=0. `git diff --stat` — exactly the seven files of this task.

- [ ] **Step 6: Commit**

```bash
git add src/app/arrangement-layout.ts src/app/arrangement-store.ts src/app/use-arrangement.ts src/app/arrangement-layout.test.ts src/app/arrangement-store.test.ts src/app/use-arrangement.test.tsx src/app/use-reports-arrangement.test.tsx
git commit -F - <<'EOF'
feat(arrangement): carry an applied-upgrades list and let a surface upgrade its stored layout

Stored layouts stay at v: 1; a version bump is a lockstep decision across
every surface. They gain an optional upgrades list instead: readArrangement
sanitises it (junk is dropped, never rejected), reconcile carries it, and
the mutators keep it. useArrangement takes an optional pure upgrade that
runs on a stored read before reconcile; a read it rewrote starts dirty, so
the upgraded layout is written back once. Reports passes none and is never
upgraded.
EOF
```

---

## Task 3: The Dashboard's one-time upgrade and the new catalogue defaults

**Files:**
- Create: `src/app/dashboard-layout-upgrade.ts`, `src/app/dashboard-layout-upgrade.test.ts`
- Modify: `src/app/dashboard-tiles.ts`, `src/app/dashboard-layout.ts`, `src/app/use-dashboard-layout.ts`
- Test: `src/app/dashboard-layout.test.ts`, `src/app/dashboard-tiles.test.ts`, `src/app/use-dashboard-layout.test.tsx`

**Interfaces:**
- Consumes: `ArrangementLayout.upgrades`, `useArrangement`'s `upgrade` (Task 2); `TileHeight` (Task 1); `isArrangementLayout` (`arrangement-store.ts`).
- Produces:
  ```ts
  // dashboard-layout.ts
  export const DASHBOARD_BURN_UPGRADE = "dashboard-burn-2x8";
  export const DEFAULT_LAYOUT: DashboardLayout;   // burn first at 2×8, upgrades: [DASHBOARD_BURN_UPGRADE]
  // dashboard-layout-upgrade.ts
  export function upgradeDashboardLayout(stored: unknown): DashboardLayout;
  ```
  Catalogue: `burn` → `w:2 h:8 minW:1 maxW:4 minH:4 maxH:8`, FIRST in `DASHBOARD_TILES`; `completionTrend` → `h:2 minH:2 maxH:4` (width unchanged).

**Rulings:**
- *Before `reconcile`* (as the spec says): the upgrade sees the stored order and sizes. It only touches `burn` and `completionTrend`, so an unknown id or an out-of-range span elsewhere is left for `reconcile` to drop or clamp.
- *Burn's size is the literal 2×8*, matching the upgrade id's name, not a read of the catalogue — an id that says "2x8" must mean 2×8 even if the catalogue later moves.
- *A burn missing from the stored layout entirely* (a layout saved before the tile existed) is inserted at the front at the catalogue default by `reconcile` itself (it is first in the catalogue, so its nearest predecessor search yields index 0) — no special case.
- *`DEFAULT_LAYOUT` carries the id.* Without it, a fresh board or a Reset layout would be persisted with no list and upgraded again on the next load, moving burn back to the front of a board the user has since rearranged. Pinned below.
- *`upgradeDashboardLayout(stored: unknown)`* validates with `isArrangementLayout` and returns `DEFAULT_LAYOUT` by reference for junk (the spec's "junk input falls back to the default layout"). A function over `unknown` is assignable to the hook's `(stored: ArrangementLayout<Id>) => …` parameter.

Breakage sweep (brief item 7): `grep -rn "\"burn\"\|completionTrend\|DEFAULT_LAYOUT\|defaultLayout(DASHBOARD" src e2e --include=*.ts --include=*.tsx`:
- `dashboard-layout.test.ts` "appends a hidden tile to the board at its catalogue default size" (`{ id: "burn", w: 1, h: 3 }`) — MIGRATE to `w: 2, h: 8`.
- `dashboard-layout.test.ts` "inserts at index 0 when no predecessor is present" (`board[0].id` is `"kpi"`) — MIGRATE to `"burn"` (burn is now catalogue-first).
- `dashboard-layout.test.ts` "inserts a new catalogue tile after its nearest present predecessor" — KEEP (logic unchanged); MIGRATE its comment, which lists the catalogue order.
- `dashboard-layout.test.ts` other `burn` uses (hidden fixture, gate test) — KEEP.
- `dashboard-tiles.test.ts` "only allows minH 1 for single-line content" — MIGRATE: `completionTrend` no longer claims minH 1, so its allow-set becomes empty (the test then pins that NO tile claims 1).
- `use-dashboard-layout.test.tsx` "starts from the default layout" (`toContain("kpi")`) — KEEP; "does not write the OLD project's layout over the new project's stored one" — KEEP (the switched-into p2 layout is upgraded and written back, and its `hidden` stays `["upcoming"]`, which is what it asserts).
- `e2e/dashboard-grid.spec.ts` `DENSE_LAYOUT` (burn and completionTrend hidden) — KEEP: the upgrade leaves a hidden burn hidden and touches no on-board tile there; the geometry tests measure `kpi`/`upcoming`, whose spans are unchanged.
- `e2e/seed-content.spec.ts` comment listing the rendered tiles — KEEP (a floor, not an order).
- `dashboard-panel.test.tsx` tile-order tests ("moves a tile earlier" reads `before[2]` generically; "renders the RAID register BEFORE the Progress card") — KEEP; run to prove it.

- [ ] **Step 1: Write the failing tests**

Create `src/app/dashboard-layout-upgrade.test.ts` (Write tool, then the CRLF normaliser):

```ts
import { describe, expect, it } from "vitest";
import { upgradeDashboardLayout } from "./dashboard-layout-upgrade";
import { DASHBOARD_BURN_UPGRADE, DEFAULT_LAYOUT, reconcile, type DashboardLayout } from "./dashboard-layout";
import type { TileHeight } from "./dashboard-tiles";

/** A pre-spec-C stored layout: no upgrades list, burn mid-board at its old
 *  1×3, Completion trend at its old h:1, one tile hidden. */
const legacy = (): DashboardLayout => ({
  v: 1,
  board: [
    { id: "kpi", w: 4, h: 2 },
    { id: "raid", w: 1, h: 3 },
    { id: "burn", w: 1, h: 3 },
    { id: "completionTrend", w: 3, h: 1 },
    { id: "upcoming", w: 2, h: 4 },
  ],
  hidden: ["changes"],
});

describe("upgradeDashboardLayout (spec C decision 11)", () => {
  it("records the upgrade id", () => {
    expect(upgradeDashboardLayout(legacy()).upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
  });

  it("moves Budget burn to the front at 2×8", () => {
    const out = upgradeDashboardLayout(legacy());
    expect(out.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
    expect(out.board.filter((p) => p.id === "burn")).toHaveLength(1);
  });

  it("keeps a hidden Budget burn hidden, and off the board", () => {
    const stored: DashboardLayout = { ...legacy(), board: legacy().board.filter((p) => p.id !== "burn"), hidden: ["changes", "burn"] };
    const out = upgradeDashboardLayout(stored);
    expect(out.hidden).toEqual(["changes", "burn"]);
    expect(out.board.some((p) => p.id === "burn")).toBe(false);
    expect(out.upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
  });

  it("clamps Completion trend's height into 2–4, from 1 and from any out-of-range stored value", () => {
    const cases: [number, number][] = [[1, 2], [0, 2], [-3, 2], [3, 3], [5, 4], [8, 4], [99, 4], [2.6, 3]];
    for (const [stored, expected] of cases) {
      const layout: DashboardLayout = { v: 1, board: [{ id: "completionTrend", w: 2, h: stored as TileHeight }], hidden: [] };
      const trend = upgradeDashboardLayout(layout).board.find((p) => p.id === "completionTrend")!;
      expect(trend.h, `stored h ${stored}`).toBe(expected);
      expect(trend.w).toBe(2);
    }
  });

  it("preserves every other tile's order, size and hidden state", () => {
    const out = upgradeDashboardLayout(legacy());
    expect(out.board.slice(1)).toEqual([
      { id: "kpi", w: 4, h: 2 },
      { id: "raid", w: 1, h: 3 },
      { id: "completionTrend", w: 3, h: 2 },
      { id: "upcoming", w: 2, h: 4 },
    ]);
    expect(out.hidden).toEqual(["changes"]);
  });

  it("is a no-op on a second run — the same reference comes back", () => {
    const once = upgradeDashboardLayout(legacy());
    expect(upgradeDashboardLayout(once)).toBe(once);
  });

  it("leaves a layout already carrying the id untouched, burn wherever the user put it", () => {
    const moved: DashboardLayout = { ...legacy(), upgrades: [DASHBOARD_BURN_UPGRADE] };
    expect(upgradeDashboardLayout(moved)).toBe(moved);
  });

  it("keeps any other applied upgrade id beside its own", () => {
    expect(upgradeDashboardLayout({ ...legacy(), upgrades: ["other"] }).upgrades).toEqual(["other", DASHBOARD_BURN_UPGRADE]);
  });

  it("falls back to the default layout for junk input", () => {
    for (const junk of [null, undefined, "x", 7, {}, { v: 2, board: [], hidden: [] }, { v: 1, board: null, hidden: [] }]) {
      expect(upgradeDashboardLayout(junk), JSON.stringify(junk)).toBe(DEFAULT_LAYOUT);
    }
  });

  it("survives reconcile: burn stays first at 2×8 and the id stays recorded", () => {
    const out = reconcile(upgradeDashboardLayout(legacy()));
    expect(out.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
    expect(out.upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
  });
});

describe("DEFAULT_LAYOUT (spec C)", () => {
  it("puts Budget burn first at 2×8", () => {
    expect(DEFAULT_LAYOUT.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
  });

  it("already carries the upgrade id, so a fresh or reset board is never upgraded", () => {
    expect(DEFAULT_LAYOUT.upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
    expect(upgradeDashboardLayout(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT);
  });
});
```

`src/app/dashboard-layout.test.ts` (MIGRATE):
- replace `    expect(next.board.at(-1)).toEqual({ id: "burn", w: 1, h: 3 });` with `    expect(next.board.at(-1)).toEqual({ id: "burn", w: 2, h: 8 });   // spec C catalogue default`
- replace

```ts
    // Catalogue order starts kpi, topActions, insights, raid, upcoming...
```

with

```ts
    // Catalogue order starts burn, kpi, topActions, insights, raid, upcoming...
    // (spec C moved burn first; burn itself is absent here and lands at 0.)
```

- in "inserts at index 0 when no predecessor is present" replace `    expect(next.board[0].id).toBe("kpi");` with `    expect(next.board[0].id).toBe("burn");   // spec C: burn is catalogue-first`

`src/app/dashboard-tiles.test.ts` (MIGRATE) — in "only allows minH 1 for single-line content" replace `    const singleLine = new Set(["completionTrend"]);` with

```ts
    // ★ Spec C raised Completion trend to minH 2, so NO tile claims 1 today;
    // the empty set makes this pin that. Adding one means adding it here.
    const singleLine = new Set<string>();
```

`src/app/use-dashboard-layout.test.tsx` — append at the end of the file:

```tsx
describe("useDashboardLayout — the one-time burn upgrade (spec C)", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("upgrades a pre-spec-C stored layout on load and writes it back once", async () => {
    vi.useFakeTimers();
    saveLayout("p1", { v: 1, board: [{ id: "kpi", w: 4, h: 2 }, { id: "burn", w: 1, h: 3 }], hidden: [] });
    render(<Harness />);
    expect(screen.getByTestId("order").textContent!.split(",")[0]).toBe("burn");
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    const stored = loadLayout("p1")!;
    expect(stored.upgrades).toContain("dashboard-burn-2x8");
    expect(stored.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
  });

  it("never runs again: a burn the user moved back keeps its place", async () => {
    vi.useFakeTimers();
    saveLayout("p1", {
      v: 1, board: [{ id: "kpi", w: 4, h: 2 }, { id: "burn", w: 1, h: 4 }], hidden: [], upgrades: ["dashboard-burn-2x8"],
    });
    const before = localStorage.getItem("aipm-cockpit:dashboard-layout");
    render(<Harness />);
    expect(screen.getByTestId("order").textContent!.split(",")[0]).toBe("kpi");
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    expect(localStorage.getItem("aipm-cockpit:dashboard-layout")).toBe(before);
  });

  it("persists the id with a reset, so the next load does not re-run the upgrade", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide").click(); });
    act(() => { screen.getByText("reset").click(); });
    await act(async () => { vi.advanceTimersByTime(LAYOUT_PERSIST_MS + 50); });
    expect(loadLayout("p1")!.upgrades).toContain("dashboard-burn-2x8");
  });
});
```

- [ ] **Step 2: Run them and watch the right ones fail**

```bash
npx vitest run src/app/dashboard-layout-upgrade.test.ts src/app/dashboard-layout.test.ts src/app/dashboard-tiles.test.ts src/app/use-dashboard-layout.test.tsx > /tmp/dlr-t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" /tmp/dlr-t3.log | head -20
```
Expected: EXIT=1. `dashboard-layout-upgrade.test.ts` fails to import (module and `DASHBOARD_BURN_UPGRADE` do not exist); the two migrated `dashboard-layout.test.ts` assertions fail (burn is still 1×3 and not first); the first and third `useDashboardLayout` upgrade tests fail. `dashboard-tiles.test.ts` fails on `completionTrend` still claiming minH 1.

- [ ] **Step 3: Implement**

`src/app/dashboard-tiles.ts` — replace the whole `DASHBOARD_TILES` array body

```ts
export const DASHBOARD_TILES: readonly TileSpec[] = [
  { id: "kpi",             labelKey: "dashboardKpiTile",        w: 4, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
```

through its closing `];` with

```ts
// ★★ `burn` IS FIRST, AND ORDER HERE IS `DEFAULT_LAYOUT`'S ORDER (spec C
// decision 7): the chart-only Budget burn tile leads a fresh board at 2 wide ×
// 8 tall. Moving it here does NOT move it for users who already have a stored
// layout — `reconcile` never reorders an existing tile — which is why
// `dashboard-layout-upgrade.ts` exists.
export const DASHBOARD_TILES: readonly TileSpec[] = [
  { id: "burn",            labelKey: "dashboardBudgetBurn",     w: 2, h: 8, minW: 1, maxW: 4, minH: 4, maxH: 8, gate: (g) => g.showBudget },
  { id: "kpi",             labelKey: "dashboardKpiTile",        w: 4, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
  { id: "topActions",      labelKey: "dashboardTopActions",     w: 2, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasTopActions },
  { id: "insights",        labelKey: "dashboardInsights",       w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasInsights },
  { id: "raid",            labelKey: "dashboardRaidRegister",   w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showRaid },
  { id: "upcoming",        labelKey: "dashboardUpcoming",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: ALWAYS },
  { id: "progress",        labelKey: "dashboardProgress",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
  { id: "trends",          labelKey: "dashboardTrends",         w: 1, h: 2, minW: 1, maxW: 2, minH: 2, maxH: 3, gate: (g) => g.tursoActive },
  { id: "milestones",      labelKey: "dashboardMilestones",     w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showMilestones },
  { id: "changes",         labelKey: "dashboardChangesHeading", w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showChanges },
  { id: "completionTrend", labelKey: "dashboardCompletionTrend", w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasCompletionTrend },
];
```

`src/app/dashboard-layout.ts` — replace `export const DEFAULT_LAYOUT: DashboardLayout = defaultLayout(DASHBOARD_TILES);` with

```ts
/** The Dashboard's one stored-layout upgrade id (spec C decision 11): Budget
 *  burn to the front at 2×8, Completion trend's height into 2–4. */
export const DASHBOARD_BURN_UPGRADE = "dashboard-burn-2x8";

// ★★★ THE DEFAULT CARRIES THE UPGRADE ID, AND MUST. A fresh board and a Reset
// layout both persist THIS object; without the id they would be upgraded again
// on the next load, dragging burn back to the front of a board the user has
// since rearranged. Still ONE module-level instance (see above).
export const DEFAULT_LAYOUT: DashboardLayout = {
  ...defaultLayout(DASHBOARD_TILES),
  upgrades: [DASHBOARD_BURN_UPGRADE],
};
```

Create `src/app/dashboard-layout-upgrade.ts` (Write tool, then the CRLF normaliser):

```ts
/**
 * The Dashboard's one-time stored-layout upgrade — spec C decision 11. Pure,
 * i18n-free, DOM-free.
 *
 * Runs through `useArrangement`'s `upgrade` option on every read that found a
 * stored layout, BEFORE `reconcile`, and is keyed on `DASHBOARD_BURN_UPGRADE`
 * in the layout's `upgrades` list:
 *   · Budget burn moves to the FRONT of the board at 2×8 — unless the user has
 *     hidden it: a hidden tile stays hidden, and restoring it later gives it the
 *     catalogue default, which is 2×8 anyway.
 *   · Completion trend's height is clamped into its new 2–4.
 *   · Every other tile keeps its order, size and hidden state.
 * The id is then recorded, so it never runs again.
 *
 * ★★★ IT RETURNS ITS INPUT BY REFERENCE WHEN THE ID IS ALREADY RECORDED. That
 * is the hook's signal that nothing needs writing; a copy would rewrite storage
 * on every load (`use-arrangement.ts`, the `upgrade` option).
 * ★★ WHY A SEPARATE STEP, not a catalogue edit: `reconcile` never reorders or
 * resizes a tile the stored layout already holds, so moving `burn` first in
 * `DASHBOARD_TILES` changes a FRESH board only.
 * ★ Accepted cost (spec): an older build's `reconcile` drops the `upgrades`
 * list, so a layout it rewrites is upgraded once more, moving burn back to the
 * front.
 */
import { isArrangementLayout } from "./arrangement-store";
import {
  DASHBOARD_BURN_UPGRADE, DEFAULT_LAYOUT,
  type DashboardLayout, type PlacedTile,
} from "./dashboard-layout";
import type { TileHeight } from "./dashboard-tiles";

/** Completion trend's height bounds after spec C decision 9. */
const TREND_MIN_H = 2;
const TREND_MAX_H = 4;

function clampTrendHeight(h: number): TileHeight {
  return Math.max(TREND_MIN_H, Math.min(TREND_MAX_H, Math.round(h))) as TileHeight;
}

/**
 * ★ Takes `unknown`, not a layout: junk falls back to `DEFAULT_LAYOUT` (by
 * reference). Through the hook it only ever sees a validated, sanitised layout
 * — `readArrangement` applied `isArrangementLayout` first — so that branch is
 * for direct callers.
 */
export function upgradeDashboardLayout(stored: unknown): DashboardLayout {
  if (!isArrangementLayout(stored)) return DEFAULT_LAYOUT;
  // Membership is `reconcile`'s job: an unknown id rides through untouched and
  // is dropped there, exactly as for any other stored layout.
  const layout = stored as DashboardLayout;
  if (layout.upgrades?.includes(DASHBOARD_BURN_UPGRADE)) return layout;

  const rest: PlacedTile[] = layout.board
    .filter((p) => p.id !== "burn")
    .map((p) => (p.id === "completionTrend" ? { ...p, h: clampTrendHeight(p.h) } : p));
  const burnHidden = layout.hidden.includes("burn");
  return {
    ...layout,
    // The literal 2×8 the id names, never a read of the catalogue.
    board: burnHidden ? rest : [{ id: "burn", w: 2, h: 8 }, ...rest],
    upgrades: [...(layout.upgrades ?? []), DASHBOARD_BURN_UPGRADE],
  };
}
```

`src/app/use-dashboard-layout.ts` — replace `import { DEFAULT_LAYOUT } from "./dashboard-layout";` with

```ts
import { DEFAULT_LAYOUT } from "./dashboard-layout";
import { upgradeDashboardLayout } from "./dashboard-layout-upgrade";
```

and replace

```ts
    readOnly: isPopout,
  });
}
```

with

```ts
    readOnly: isPopout,
    // ★ Spec C decision 11: the one-time burn upgrade. A module-level function,
    // so a stable reference like the two constants above. Reports passes none.
    upgrade: upgradeDashboardLayout,
  });
}
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/dashboard-layout-upgrade.test.ts src/app/dashboard-layout.test.ts src/app/dashboard-layout.property.test.ts src/app/dashboard-tiles.test.ts src/app/use-dashboard-layout.test.tsx src/app/dashboard-grid.test.tsx src/app/dashboard-panel.test.tsx > /tmp/dlr-t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/dlr-t3.log
npx tsc --noEmit > /tmp/dlr-tsc3.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc3.log
npx eslint --max-warnings=0 src/app/dashboard-layout-upgrade.ts src/app/dashboard-layout-upgrade.test.ts src/app/dashboard-tiles.ts src/app/dashboard-layout.ts src/app/use-dashboard-layout.ts src/app/dashboard-layout.test.ts src/app/dashboard-tiles.test.ts src/app/use-dashboard-layout.test.tsx; echo "LINT_EXIT=$?"
git ls-files --eol src/app/dashboard-tiles.ts; file src/app/dashboard-layout-upgrade.ts src/app/dashboard-layout-upgrade.test.ts
```
Expected: EXIT=0 with `Test Files  7 passed (7)`; TSC_EXIT=0 and `0`; LINT_EXIT=0; `w/crlf`; both new files `… with CRLF line terminators`.

- [ ] **Step 5: Mutation-check the hidden-burn rule and the default's id**

Mutant 1: in `upgradeDashboardLayout` change `    board: burnHidden ? rest : [{ id: "burn", w: 2, h: 8 }, ...rest],` to `    board: [{ id: "burn", w: 2, h: 8 }, ...rest],`. Re-run the vitest command: EXIT=1 — "keeps a hidden Budget burn hidden, and off the board" fails. Revert; EXIT=0.
Mutant 2: in `dashboard-layout.ts` change `  upgrades: [DASHBOARD_BURN_UPGRADE],` to `  upgrades: [],`. Re-run: EXIT=1 — "already carries the upgrade id…" and "persists the id with a reset…" fail. Revert; EXIT=0. `git diff --stat` — the eight files of this task.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-layout-upgrade.ts src/app/dashboard-layout-upgrade.test.ts src/app/dashboard-tiles.ts src/app/dashboard-layout.ts src/app/use-dashboard-layout.ts src/app/dashboard-layout.test.ts src/app/dashboard-tiles.test.ts src/app/use-dashboard-layout.test.tsx
git commit -F - <<'EOF'
feat(dashboard): lead the board with a 2x8 Budget burn and upgrade stored layouts once

Budget burn is first in the catalogue at 2 wide x 8 tall (resizable 1-4 x
4-8) and Completion trend becomes h:2, 2-4. Existing stored layouts get a
one-time upgrade keyed on "dashboard-burn-2x8": burn to the front at 2x8
unless hidden, the trend's height clamped, everything else untouched. The
default layout already carries the id, so a fresh or reset board is never
re-upgraded.
EOF
```

---

## Task 4: Budget burn becomes chart-only; Effort SPI/CPI move into the KPI tile

**Files:**
- Modify: `src/app/dashboard-tile-bodies.tsx`, `src/app/dashboard-sections/dashboard-kpi-strip.tsx`, `src/app/dashboard-panel.tsx`, `src/app/budget-forecast-link.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Delete: `src/app/budget-forecast-headline.tsx`, `src/app/budget-forecast-headline.test.tsx`
- Test: `src/app/dashboard-panel.test.tsx`, `src/app/dashboard-sections/dashboard-kpi-strip.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DashboardKpiStrip` renders its Effort SPI/Effort CPI tiles keyed directly on `model.evm.spi`/`model.evm.cpi` — no new prop (each index is visible whenever it can move a value the user sees, independent of the Budget module; see the Rulings below). `TileBodyArgs` loses `money`, `buckets`, `fxRates` and gains nothing. `src/app/budget-forecast-headline.tsx` and its test are DELETED — its only production caller (the burn tile) is removed by this task — along with four i18n keys dead only because of that deletion (`forecastTileActuals`, `forecastTileRange`, `forecastTileSingle`, `forecastTileRunsOut`) and the three already-dead `dashboardSubSpent`, `dashboardSpentHint`, `dashboardHoursHint`; all seven are REMOVED from both dictionaries.

**Rulings:**
- *Spec file names:* the spec asks for `dashboard-tile-bodies.test.tsx`, which does not exist. Burn-body assertions go in `dashboard-panel.test.tsx` (the body needs a `DashboardModel`, and the panel is its only producer; the existing S5 spy pattern already swaps a forecast bundle in), and KPI-body assertions go in `dashboard-kpi-strip.test.tsx` (the body IS `DashboardKpiStrip`). No new file.
- *What stays in the burn tile:* the compact `BurndownChartPanel` and its `BurndownChainWarning` (a qualifier of the chart it heads, and its three tests stay green). With no burn-down series the tile shows `dashboardNoBudget`. The burn caption (`dashboardBurnCaption`) leaves the tile: its first sentence describes the Spent/hours figures that left. The key stays (the Budget report uses it).
- *SPI/CPI visibility — user's resolution of the open question ("hiding something which affects a value is not acceptable"):* each index is shown whenever it can move a value the user actually sees, independent of the Budget module — NOT `showBudget && model.evm.coverage.withEstimate > 0` as first drafted. Evidence: `computeEvm(input.tasks, todayISO, …)` (`evm.ts`) runs over `input.tasks` alone; `dashboard-panel.tsx` passes `tasks: props.tasks` into `computeDashboard` UNCONDITIONALLY, unlike `budgets: showBudget ? props.budgets : []` — so `model.evm.spi`/`model.evm.cpi` are non-null whenever estimates exist, Budget module on or off. SPI: `evmIndexHealth(evm.spi)` is worst-of'd into `scheduleComputed` (`dashboard.ts`), which has no `showBudget` gate anywhere. CPI: `evmIndexHealth(evm.cpi)` is worst-of'd into `budgetComputed` → `model.budget.effective` — the hero's own Budget `OverrideSelect` IS gated on `showBudget` (`dashboard-sections/dashboard-hero.tsx:79`), but `model.budget.effective` ALSO feeds three surfaces with no such gate: `dashboard-panel.tsx:199`'s `currentRag.budget`, fed straight to `useLandingDelta` so a CPI-driven flip renders as a flip badge in the Dashboard's OWN row-1 delta strip (`dashboard-delta-strip.tsx`'s flip renderer takes no `showBudget`); `ai-dashboard-snapshot.ts:81`'s `rag.budget` (the `get_dashboard_snapshot` chat tool payload); and `snapshot.ts:224`'s persisted `budgetRag` (Trends) and `use-portfolio-health.ts:142`'s `budget` column, rendered unconditionally by `portfolio-health-panel.tsx:188`'s `<RagCell value={row.budget} />` (Portfolio health table). So CPI, like SPI, can move a value the user sees with Budget off, and gets the same rule. `showSpi`/`showCpi` inside `DashboardKpiStrip` are keyed directly on `model.evm.spi !== null` / `model.evm.cpi !== null`, with no prop at all — consistent with the strip's other three tiles, which are also plain functions of `model`. `TileBodyArgs` and the KPI call site in `dashboard-tile-bodies.tsx` need no `showBudget` plumbing for this. With no estimates both tiles are simply absent, unchanged from the first draft: an index that does not exist cannot turn a badge amber, and `evmIndexHealth(null)` is null.
- *`ForecastHeadline` deletion — user's resolution of the open question:* its only production caller was `dashboard-tile-bodies.tsx`'s burn body, removed by Step 5 of this task, so `src/app/budget-forecast-headline.tsx` and `src/app/budget-forecast-headline.test.tsx` are deleted (Step 5(i)) rather than left orphaned. Breakage sweep, `grep -rn "ForecastHeadline\|budget-forecast-headline" src e2e docs/AGENTS AGENTS.md`: `dashboard-tile-bodies.tsx`'s import and JSX use — DELETE (Step 5(a)/(e) of this task); the file's own export and its whole test file — DELETE; `budget-forecast-link.tsx`'s comment naming `budget-forecast-headline.tsx`'s EAC-ordering ternary — MIGRATE (Step 5(i); `forecastLinkText` itself never imported the file and is untouched); `dashboard-panel.test.tsx`'s lead comment for the S5 rate-mix-chip describe block — already DELETE (Step 1(f) of this task deletes that whole block); `docs/AGENTS/dashboard.md`'s two mentions (the forecast-figures paragraph naming `budget-forecast-headline.tsx`, and the MR-3 paragraph's `ForecastHeadline`/`RateMixChip` sentence) — MIGRATE in Task 7 (Task 7 Step 5(d), revised to say DELETED rather than "NO production caller"). Four i18n keys become dead ONLY because of this deletion — `forecastTileActuals`, `forecastTileRange`, `forecastTileSingle`, `forecastTileRunsOut` (each greps to only `i18n.ts`/`i18n.de.ts` and `budget-forecast-headline.tsx` outside this check) — removed by Step 3 alongside the three already-dead keys. Consequence for this task's own new test: the "holds the chart and none of the headline, rate-mix chip, Spent or hours figures" test (Step 1(f)) can no longer import `forecastHeadlineText` to compute the exact absent string, so it asserts absence with a substring match (`/EAC|VAC/`) instead.

Breakage sweep (brief item 7): `grep -rn "dashboardSubSpent\|dashboardSpentHint\|dashboardHoursHint\|dashboardBurnCaption\|BudgetFxRollupNotice\|ForecastHeadline\|budget-forecast-headline\|Effort SPI\|Effort CPI\|evmSpi\|evmCpi\|forecastTileActuals\|forecastTileRange\|forecastTileSingle\|forecastTileRunsOut\|\"Spent\"\|getByText(\"h\")" src e2e docs/AGENTS AGENTS.md --include=*.ts --include=*.tsx --include=*.md`:
- `dashboard-panel.test.tsx` "renders the progress and burn captions" — MIGRATE (progress caption present, burn caption absent).
- `dashboard-panel.test.tsx` describe "DashboardPanel budget-burn CPI stat": "shows the CPI value in the EVM row…" — MIGRATE (scoped to `tile-kpi`); "does not duplicate CPI in the budget-burn (Sub-budget + hours) row" — MIGRATE (CPI once, in the KPI tile, not in burn; its `getByText("h")` anchor no longer exists).
- `dashboard-panel.test.tsx` module-visibility "shows the Effort SPI/CPI tiles when showBudget is true" — KEEP (still true, trivially, once neither index is gated on `showBudget`); "hides Budget burn section and EVM when showBudget is false" — MIGRATE (the Budget-burn TILE still hides on `showBudget` via the catalogue's own gate; the EVM indices no longer do — see the SPI/CPI ruling above).
- `dashboard-panel.test.tsx` "labels the burn tile's spend box \"Spent\"…" — DELETE (the Spent box leaves the dashboard; its absence is asserted in the new burn test).
- `dashboard-panel.test.tsx` "DashboardPanel currency labelling" → "labels the Budget tile in EUR…" — DELETE (that tile no longer exists); "labels the burn-down value axis in EUR…" — KEEP.
- `dashboard-panel.test.tsx` describe "budget tile — unresolved-rate FX rollup notice (§474)" (3 tests) — DELETE (decision 7 moves the notice off the dashboard; replaced by an absence assertion).
- `dashboard-panel.test.tsx` describe "burn tile — rate-mix chip (S5)", including its lead comment naming `ForecastHeadline` — DELETE (the headline that carried the chip leaves the tile; its spy pattern is reused by the new test, which asserts the chip is ABSENT).
- `dashboard-panel.test.tsx` "top-band Budget/Scope pill gating" — KEEP (`"Budget"` exact text still absent when Budget is off).
- `dashboard-panel.test.tsx` "burn-down chain warning" (3) — KEEP.
- `budget-forecast-headline.tsx` (`forecastHeadlineText`, `ForecastHeadline`) and its whole test file `budget-forecast-headline.test.tsx` — DELETE (Step 5(i); see the `ForecastHeadline` deletion ruling above).
- `budget-forecast-link.tsx`'s comment naming `budget-forecast-headline.tsx`'s EAC-ordering ternary — MIGRATE (Step 5(i); `forecastLinkText` itself never imported the file and is untouched).
- `budget-fx-rollup-notice.test.tsx`, `budget-report-panel.test.tsx` — KEEP (other surfaces, unaffected by the `ForecastHeadline` deletion).
- `dashboard-kpi-strip.test.tsx` existing tests — KEEP (unaffected; the new SPI/CPI tests are keyed on the model, not on a new prop).
- `docs/AGENTS/dashboard.md` burn-content paragraphs, including its two `ForecastHeadline`/`budget-forecast-headline.tsx` mentions — MIGRATE in Task 7 (Step 5(d), revised to say DELETED rather than "NO production caller").
- e2e: no hit.

- [ ] **Step 1: Write the tests (one characterization test that must already pass, the rest failing)**

`src/app/dashboard-panel.test.tsx`:

(a) add `import { healthColorName } from "./health";` to the imports. (Do NOT add an import from `./budget-forecast-headline` — Step 5(i) deletes that file; the new chart-only test in (f) below checks the headline's absence with a substring match instead of computing the exact string.)

(b) in "renders the progress and burn captions", replace

```tsx
  it("renders the progress and burn captions", () => {
    renderDashboard();
    expect(screen.getByText(t("en-US", "dashboardProgressCaption"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "dashboardBurnCaption"))).toBeInTheDocument();
  });
```

with

```tsx
  // ★ Spec C: the burn caption described the Spent/hours figures, which left the
  // chart-only burn tile, so the caption left with them (the Budget report
  // keeps it). The positive half keeps this from passing on an empty render.
  it("renders the progress caption, and no longer the burn caption", () => {
    renderDashboard();
    expect(screen.getByText(t("en-US", "dashboardProgressCaption"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardBurnCaption"))).toBeNull();
  });
```

(c) replace the two `it(...)` blocks of `describe("DashboardPanel budget-burn CPI stat", …)` — from `  // CPI is an EVM index → it lives ONLY in the EVM SPI/CPI row (the burn row now` through the closing `  });` of "does not duplicate CPI in the budget-burn (Sub-budget + hours) row" — with

```tsx
  // ★ Spec C decision 8: the EVM indices live in the KPI tile now, not the burn
  // tile. The KPI tile's grid holds all five tiles, so SPI and CPI still share
  // one row there.
  function evmCpiTile(): HTMLElement {
    const kpi = screen.getByTestId("tile-kpi");
    return within(kpi).getByText("Effort CPI").closest("div.rounded-lg") as HTMLElement;
  }

  it("shows the CPI value in the KPI tile when model.evm.cpi is present", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={taskWithCpi}
        raid={[]}
        budgets={minimalBudget as never}
        plan={plan}
        roles={[]}
        resources={[]}
        absences={[]}
        holidaySet={new Set<string>()}
        workdayHours={8}
        today="2026-06-02"
      />,
      { wrapper },
    );
    expect(within(evmCpiTile()).getByText("0.95")).toBeInTheDocument();
  });

  it("renders CPI exactly once — in the KPI tile, never in the burn tile", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={taskWithCpi}
        raid={[]}
        budgets={minimalBudget as never}
        plan={plan}
        roles={[]}
        resources={[]}
        absences={[]}
        holidaySet={new Set<string>()}
        workdayHours={8}
        today="2026-06-02"
      />,
      { wrapper },
    );
    expect(screen.getAllByText("Effort CPI")).toHaveLength(1);
    expect(within(screen.getByTestId("tile-kpi")).getByText("Effort CPI")).toBeInTheDocument();
    expect(within(screen.getByTestId("tile-burn")).queryByText("Effort CPI")).toBeNull();
  });
```

(d) DELETE the whole `it("labels the burn tile's spend box \"Spent\", not \"Budget\" …", …)` block.

(e) In `describe("DashboardPanel currency labelling", …)` DELETE the whole `it("labels the Budget tile in EUR even when the plan names another currency", …)` block, and in the comment block above the describe replace

```tsx
// ★★ The dashboard is the LANDING view, and both of its money surfaces render
// figures that came out of the budget engine and convert NOTHING:
//   · the Budget tile prints `model.burn.consumedValue / budgetValue`, which
//     `dashboard.ts` copies straight off `computeBudgetReport(...).project`;
//   · the burn-down chart prints `model.burndown`, whose values are
//     `budgetHours × role.rates.external`.
```

with

```tsx
// ★★ The dashboard is the LANDING view, and its one money surface — the
// burn-down chart (`model.burndown`, values `budgetHours × role.rates.external`)
// — renders figures that came out of the budget engine and convert NOTHING.
// (Spec C removed the second one, the Budget tile's Spent figure.)
```

(f) DELETE the whole `describe("DashboardPanel budget tile — unresolved-rate FX rollup notice (§474)", …)` block with its lead comment, and the whole `describe("DashboardPanel burn tile — rate-mix chip (S5)", …)` block with its lead comment, and append at the end of the file:

```tsx
// ── Spec C decision 7: the burn tile is chart-only ──────────────────────────
describe("DashboardPanel burn tile is chart-only (spec C)", () => {
  const ratedRoles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  const ratedBucket = {
    id: 1, name: "PO", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
  } as unknown as BudgetBucket;

  it("holds the chart and none of the headline, rate-mix chip, Spent or hours figures", () => {
    // The real model with a forecast bundle swapped in, so the headline and the
    // chip WOULD render if the body still built them (the S5 pattern).
    const realCompute = dashboardModule.computeDashboard;
    const spy = vi.spyOn(dashboardModule, "computeDashboard").mockImplementation(
      (...args: Parameters<typeof realCompute>) => ({
        ...realCompute(...args), forecast: BUNDLE_HOURS_WORSE.eur, forecastBundle: BUNDLE_HOURS_WORSE,
      }),
    );
    try {
      render(
        <DashboardPanel
          lang="en-US" tasks={[]} raid={[]} budgets={[ratedBucket]} plan={plan} roles={ratedRoles}
          resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8} today="2026-06-02"
        />,
        { wrapper },
      );
      const tile = screen.getByTestId("tile-burn");
      // Positive control: the chart is there (its € caption).
      expect(within(tile).getByText(/Budget remaining/i)).toBeInTheDocument();
      // `forecastHeadlineText` is gone with the deleted `budget-forecast-headline.tsx`
      // (see Step 5(i)); a substring match is enough to prove the headline is absent.
      expect(within(tile).queryByText(/EAC|VAC/)).toBeNull();
      const chipText = rateMixTileChipText("en-US", MIX_HOURS_WORSE, HOURS_FORECAST_HOURS_WORSE);
      expect(within(tile).queryByRole("button", { name: rateMixWhyName("en-US", chipText) })).toBeNull();
      expect(screen.queryByText("Spent")).toBeNull();
      expect(within(tile).queryByText("h")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("carries no FX rollup notice, even for a rateless non-EUR fixed-price bucket", () => {
    const usdFixed = { ...ratedBucket, currency: "USD", type: "fixed", fixedPriceAmount: 10000 } as unknown as BudgetBucket;
    render(
      <DashboardPanel
        lang="en-US" tasks={[]} raid={[]} budgets={[usdFixed]} plan={plan} roles={ratedRoles}
        resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8} today="2026-06-02"
      />,
      { wrapper },
    );
    expect(screen.getByTestId("tile-burn")).toBeInTheDocument();
    expect(screen.queryByText(/without an FX rate/i)).toBeNull();
  });
});

// ── Spec C: removing the figures changed no health input ───────────────────
// ★★★ A CHARACTERIZATION TEST: it is written BEFORE the change and must pass on
// the old tree AND the new one — that is what "the same before and after"
// means. Effort SPI/CPI feed the Schedule and Budget RAG through `dashboard.ts`
// (`evmIndexHealth`), never through the tile, so moving the tiles must not move
// a badge. Fixture: 80 h earned of 120 h planned (SPI 0.67 → Red) and 100 h
// booked (CPI 0.80 → Amber), no budget buckets.
describe("DashboardPanel health inputs are unchanged by spec C", () => {
  const BAD_EVM_TASKS = [
    {
      id: 1, title: "Built", status: "Done", health: "G",
      originalEstimateMinutes: 4800, timeSpentMinutes: 6000,
      dueDate: "2026-06-02", completedDate: "2026-06-02",
      linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [],
    },
    {
      id: 2, title: "Open", status: "To Do", health: "G",
      originalEstimateMinutes: 2400, dueDate: "2026-06-02",
      linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [],
    },
  ] as never[];

  it("keeps Schedule Red and Budget Amber for a bad-SPI/CPI fixture", () => {
    render(
      <DashboardPanel
        lang="en-US" tasks={BAD_EVM_TASKS} raid={[]} budgets={[]} plan={plan} roles={[]}
        resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8} today="2026-06-02"
      />,
      { wrapper },
    );
    // `getByTitle`, not `getByRole`: the badges sit inside the closed
    // Adjust-health <details>, and the title IS their accessible name.
    expect(screen.getByTitle(`${t("en-US", "dashboardSubSchedule")}: ${healthColorName("R", "en-US")}`)).toBeInTheDocument();
    expect(screen.getByTitle(`${t("en-US", "dashboardSubBudget")}: ${healthColorName("A", "en-US")}`)).toBeInTheDocument();
  });
});
```

`rateMixTileChipText`, `rateMixWhyName`, `BUNDLE_HOURS_WORSE`, `HOURS_FORECAST_HOURS_WORSE` and `MIX_HOURS_WORSE` stay imported — the new burn test uses all five.

(g) In the existing `describe("DashboardPanel module visibility gates (Task 8)", …)` block, replace — from the comment line `// The EVM tiles only render once there is estimate coverage (\`evm.ts\`` through the closing `});` of "hides Budget burn section and EVM when showBudget is false" — with:

```tsx
// The EVM tiles only render once there is estimate coverage (`evm.ts`
// `computeEvm`: a task participates iff `originalEstimateMinutes > 0`) —
// plain `fullProps` (tasks: []) never reaches that branch. This task gives a
// non-null coverage without otherwise changing what `fullProps`-based
// baseline assertions see. ★ Spec C: Effort SPI and Effort CPI are each keyed
// on their OWN model field (`model.evm.spi`/`model.evm.cpi`), never on
// `showBudget` (see the SPI/CPI visibility ruling above), so
// `tasksWithEvmEstimate` is exercised both WITH and WITHOUT the Budget
// module below.
const tasksWithEvmEstimate = [
  {
    id: 1, title: "Done task", status: "Done", health: "G",
    originalEstimateMinutes: 57, timeSpentMinutes: 60,
    dueDate: "2026-06-01", completedDate: "2026-06-01",
    linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [],
  },
] as never[];

describe("DashboardPanel module visibility gates (Task 8)", () => {
  it("shows Budget burn section and RAID section when all flags are true (baseline)", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    expect(screen.getByText("Budget burn")).toBeInTheDocument();
    expect(screen.getByText("Top open RAID")).toBeInTheDocument();
    expect(screen.getByText("Milestones")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
  });

  it("shows the Effort SPI/CPI tiles when showBudget is true (positive control)", () => {
    // Without this, the negative test below (queryByText → toBeNull) would pass
    // just as happily if the EVM row's text were renamed out from under the
    // query — a bare `queryByText` failing to find a stale string reads
    // identically to the gate actually working.
    render(<DashboardPanel {...fullProps} tasks={tasksWithEvmEstimate} />, { wrapper });
    expect(screen.getByText(t("en-US", "evmSpi"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "evmCpi"))).toBeInTheDocument();
  });

  // ★ Spec C ruling: "hiding something which affects a value is not
  // acceptable" — SPI feeds the Schedule RAG and CPI feeds the Budget RAG
  // (`dashboard.ts` `evmIndexHealth`) from `model.evm`, which is computed over
  // `tasks` alone and never gated on `showBudget`; the Budget RAG it moves
  // also reaches the delta strip's flip badges, the AI snapshot tool, Trends'
  // `budgetRag` and the Portfolio health table with the Budget module off. So
  // neither index hides with the module — only the (unrelated) "Budget burn"
  // tile itself still does, via the catalogue's own `showBudget` gate.
  it("keeps the Effort SPI/CPI tiles visible when showBudget is false, and still hides the Budget burn tile", () => {
    render(<DashboardPanel {...fullProps} tasks={tasksWithEvmEstimate} showBudget={false} />, { wrapper });
    expect(screen.queryByText("Budget burn")).toBeNull();
    expect(screen.getByText(t("en-US", "evmSpi"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "evmCpi"))).toBeInTheDocument();
  });
```

`src/app/dashboard-sections/dashboard-kpi-strip.test.tsx` — append at the end of the file:

```tsx
// ── Spec C decision 8: Effort SPI / Effort CPI live in the KPI tile ─────────
describe("DashboardKpiStrip — Effort SPI and CPI (spec C)", () => {
  // 80 h earned of 120 h planned → SPI 0.67; 100 h booked → CPI 0.80.
  const EVM_TASKS = [
    { ...taskFixture(1, "Done", "2026-06-02"), dueDate: "2026-06-02", originalEstimateMinutes: 4800, timeSpentMinutes: 6000 },
    { ...taskFixture(2, "To Do"), dueDate: "2026-06-02", originalEstimateMinutes: 2400 },
  ];

  it("adds both index tiles with their labels, values and hints when estimates exist", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor(EVM_TASKS)} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByText(t("en-US", "evmSpi"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "evmCpi"))).toBeInTheDocument();
    expect(screen.getByText("0.67")).toBeInTheDocument();
    expect(screen.getByText("0.80")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "evmSpiHint") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "evmCpiHint") })).toBeInTheDocument();
  });

  it("opens the Budget view from either index tile, named after its own label", () => {
    const onNavigate = vi.fn();
    render(<DashboardKpiStrip lang="en-US" model={modelFor(EVM_TASKS)} trends={trends} onNavigate={onNavigate} dc={densityClasses("comfortable")} />);
    const open = t("en-US", "dashboardOpenBudgetView");
    screen.getByRole("button", { name: `${t("en-US", "evmSpi")} – ${open}` }).click();
    screen.getByRole("button", { name: `${t("en-US", "evmCpi")} – ${open}` }).click();
    expect(onNavigate).toHaveBeenNthCalledWith(1, "budget");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "budget");
  });

  // ★ Neither tile takes a Budget-module signal at all — `modelFor` above
  // always passes `budgets: []` (see its definition earlier in this file), so
  // this run doubles as proof that both render with the Budget module
  // effectively off, exactly as the migrated `dashboard-panel.test.tsx`
  // integration test pins.
  it("omits both when no task carries an estimate", () => {
    render(<DashboardKpiStrip lang="en-US" model={model()} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();          // positive control
    expect(screen.queryByText(t("en-US", "evmSpi"))).toBeNull();
    expect(screen.queryByText(t("en-US", "evmCpi"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch the right ones fail**

```bash
npx vitest run src/app/dashboard-panel.test.tsx src/app/dashboard-sections/dashboard-kpi-strip.test.tsx > /tmp/dlr-t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL|✓.*health inputs|×.*health inputs" /tmp/dlr-t4.log | head -30
```
Expected: EXIT=1. Failing: the caption test (burn caption still rendered), both migrated CPI tests (CPI is in `tile-burn`), the two chart-only tests (headline/Spent/FX notice still there), the migrated module-visibility test (the EVM indices still hide with `showBudget={false}`, because the old burn-tile gate still holds them), and the two KPI-strip tests that expect the index tiles at all (`DashboardKpiStrip` does not render them yet). **"keeps Schedule Red and Budget Amber for a bad-SPI/CPI fixture" MUST PASS here** — it is the before-half of the characterization. If it fails on the old tree, stop: the fixture is wrong, not the code.

- [ ] **Step 3: Remove the seven dead keys from both dictionaries**

Three are dead because the burn tile's Spent/hours figures leave (`dashboardSubSpent`, `dashboardSpentHint`, `dashboardHoursHint`); four more are dead only because Step 5(i) deletes `budget-forecast-headline.tsx`, their only reader (`forecastTileActuals`, `forecastTileRange`, `forecastTileSingle`, `forecastTileRunsOut` — each greps to nowhere else in `src`). Save as `remove-burn-keys.mjs` in your scratchpad directory and run `node <that path>`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const KEYS = [
  "dashboardSubSpent", "dashboardSpentHint", "dashboardHoursHint",
  "forecastTileActuals", "forecastTileRange", "forecastTileSingle", "forecastTileRunsOut",
];
for (const p of ["C:/Projects/aipm-cockpit/src/app/i18n.ts", "C:/Projects/aipm-cockpit/src/app/i18n.de.ts"]) {
  let s = readFileSync(p, "utf8");
  for (const k of KEYS) {
    // One whole CRLF line: `\r\n  <key>: "<value>",` followed by the next `\r\n`.
    const re = new RegExp(`\\r\\n  ${k}: "[^"\\r\\n]*",(?=\\r\\n)`, "g");
    const hits = s.match(re) ?? [];
    if (hits.length !== 1) { console.log(p, k, "hits", hits.length); process.exit(1); }
    s = s.replace(re, "");
  }
  const bare = (s.match(/(?<!\r)\n/g) || []).length;
  if (bare !== 0) { console.log(p, "bare LF count", bare); process.exit(1); }
  writeFileSync(p, s, "utf8");
  console.log("ok", p);
}
```

It exits 1 without writing if any key is not exactly one whole line. Verify:

```bash
grep -c "dashboardSubSpent\|dashboardSpentHint\|dashboardHoursHint\|forecastTileActuals\|forecastTileRange\|forecastTileSingle\|forecastTileRunsOut" src/app/i18n.ts src/app/i18n.de.ts   # expect 0 and 0
git ls-files --eol src/app/i18n.ts src/app/i18n.de.ts                                                  # expect w/crlf twice
git diff --stat src/app/i18n.ts src/app/i18n.de.ts                                                     # expect 7 deletions in each
```

- [ ] **Step 4: Implement the KPI tiles**

`src/app/dashboard-sections/dashboard-kpi-strip.tsx`:

(a) replace the doc line `/** Standalone "at a glance" KPI card: completion % · overdue · open RAID.` with `/** Standalone "at a glance" KPI card: completion % · overdue · open RAID, plus Effort SPI · Effort CPI whenever \`model.evm.spi\`/\`model.evm.cpi\` is non-null (spec C decision 8) — each is independent of the Budget module (see the SPI/CPI visibility ruling above); \`DashboardKpiStripProps\` gains no new field.`

(b) replace

```tsx
export function DashboardKpiStrip({ lang, model, trends, onNavigate, dc }: DashboardKpiStripProps) {
  const noActiveScope = hasNoActiveScope(model.progress);
  return (
    <div className={dc.cardPad}>
      <div className={`grid grid-cols-1 sm:grid-cols-3 ${dc.kpiGap}`}>
```

with

```tsx
export function DashboardKpiStrip({ lang, model, trends, onNavigate, dc }: DashboardKpiStripProps) {
  const noActiveScope = hasNoActiveScope(model.progress);
  // ★ Spec C decision 8, user's ruling: each index is shown whenever IT can
  // move a value the user sees — never gated on the Budget module. SPI feeds
  // the Schedule RAG and CPI feeds the Budget RAG (`dashboard.ts`
  // `evmIndexHealth`) from `model.evm`, which is computed over `tasks` alone
  // and is never gated on `showBudget`; the Budget RAG it moves also reaches
  // the delta strip, the AI snapshot tool, Trends and the Portfolio health
  // table with the Budget module off. No estimate → the index is `null` → no
  // badge for it to explain, so the tile is simply absent (never "—").
  const showSpi = model.evm.spi !== null;
  const showCpi = model.evm.cpi !== null;
  const openBudget = onNavigate ? () => onNavigate("budget") : undefined;
  // ★★ Whole literal class strings — an interpolated grid-cols emits no CSS.
  // Up to five tiles fit one row from `lg`, where the KPI tile is full width.
  const cols = showSpi || showCpi ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-3";
  return (
    <div className={dc.cardPad}>
      <div className={`grid grid-cols-1 ${cols} ${dc.kpiGap}`}>
```

(c) directly before the closing `</div>` of that grid — i.e. after the Open RAID `Tile`'s closing `/>` — insert:

```tsx
        {showSpi && (
          <Tile
            label={t(lang, "evmSpi")} hint={t(lang, "evmSpiHint")}
            value={model.evm.spi!.toFixed(2)}
            onActivate={openBudget}
            activateLabel={`${t(lang, "evmSpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
          />
        )}
        {showCpi && (
          <Tile
            label={t(lang, "evmCpi")} hint={t(lang, "evmCpiHint")}
            value={model.evm.cpi!.toFixed(2)}
            onActivate={openBudget}
            activateLabel={`${t(lang, "evmCpi")} – ${t(lang, "dashboardOpenBudgetView")}`}
          />
        )}
```

- [ ] **Step 5: Implement the chart-only burn body and remove the money plumbing**

`src/app/dashboard-tile-bodies.tsx`:

(a) delete the three import lines `import { ratioHealth } from "./budget-health";`, `import { BudgetFxRollupNotice } from "./budget-fx-rollup-notice";` and `import { ForecastHeadline } from "./budget-forecast-headline";`; replace `import type { BudgetBucket, ChangeStatus, FxRates } from "./types";` with `import type { ChangeStatus } from "./types";`.

(b) in `TileBodyArgs` replace

```tsx
  /** Formats a number in EUR + the panel's locale. Both money surfaces here
   *  render budget-engine figures, which are EUR and are converted nowhere —
   *  see the comment on `money` in `dashboard-panel.tsx`. */
  money: (n: number) => string;
  /** Currency label for the burn-down axis. EUR for the same reason. */
  currency: string;
  /** §474 (third surface): the same raw inputs `BudgetFxRollupNotice` reads on
   *  budget-panel.tsx / budget-report-panel.tsx, so the tile's EUR burn figures
   *  get the same "Includes N bucket(s) counted 1:1 without an FX rate" disclosure those two surfaces
   *  already carry. Passed through unconverted — the component recomputes the
   *  count itself via `countUnresolvedBuckets`, exactly like the other two call
   *  sites, rather than a count threaded off a dashboard-engine field. */
  buckets: readonly Pick<BudgetBucket, "type" | "currency" | "fxRateOverride">[];
  fxRates: FxRates | null;
```

with

```tsx
  /** Currency label for the burn-down axis. EUR: the engine's burn-down series
   *  is `budgetHours × role.rates.external` and converts nothing — see the
   *  `currency` argument in `dashboard-panel.tsx`. */
  currency: string;
```

(no `showBudget` field is added here: the KPI tile's Effort SPI/CPI visibility is keyed on `model.evm.spi`/`model.evm.cpi` alone — see the SPI/CPI visibility ruling above — so `TileBodyArgs` needs no new field for it.)

(c) replace

```tsx
  const { lang, dc, model, money } = a;
  const openTasks = a.onNavigate ? () => a.onNavigate!("open-points") : undefined;
  const openBudget = a.onNavigate ? () => a.onNavigate!("budget") : undefined;
```

with

```tsx
  const { lang, dc, model } = a;
  const openTasks = a.onNavigate ? () => a.onNavigate!("open-points") : undefined;
```

(d) No change: the KPI strip call site (`      <DashboardKpiStrip lang={lang} model={model} trends={a.trends} onNavigate={a.onNavigate} dc={dc} />`) is unchanged. `showSpi`/`showCpi` are computed inside `DashboardKpiStrip` from `model.evm.spi`/`model.evm.cpi` (Step 4), not passed in — see the SPI/CPI visibility ruling above.

(e) replace the whole `burn:` entry — from the line `    burn: (` through the `    ),` line directly above `    milestones: (` — with:

```tsx
    // ★★ Spec C decision 7: CHART-ONLY. The forecast headline, the Spent and
    // hours tiles, the FX rollup notice and the Effort SPI/CPI tiles all left:
    // the indices moved to the KPI tile (decision 8); the rest live on the
    // Budget view and report. `compact` still suppresses the change table. The
    // chain warning stays because it qualifies the chart it heads.
    burn: model.burndown ? (
      <>
        <BurndownChainWarning lang={lang} chain={model.bucketChain} />
        <BurndownChartPanel
          lang={lang}
          series={model.burndown}
          bundle={model.forecastBundle}
          today={model.chartDates.today}
          planEnd={model.chartDates.planEnd}
          currency={a.currency}
          compact
        />
      </>
    ) : (
      <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>
    ),
```

`src/app/dashboard-panel.tsx`:

(f) delete `import { formatCurrency } from "./resource-cost";` and replace `import { type Lang, t, localeFor } from "./i18n";` with `import { type Lang, t } from "./i18n";`.

(g) delete the block from `  const locale = localeFor(lang);` through `  const money = (n: number) => formatCurrency(n, "EUR", locale);` (the `locale` line, the whole ★★ comment about both money surfaces, and the `money` line).

(h) in the `buildTileBodies({ … })` call replace

```tsx
    money,
    // EUR for the same reason as `money` above — this labels the engine's
    // burn-down series, which converts nothing.
    currency: "EUR",
    // §474 (third surface): same raw buckets/fxRates budget-panel.tsx and
    // budget-report-panel.tsx already pass to `BudgetFxRollupNotice` — the
    // "burn" tile body only renders it alongside `model.burn`, so it never
    // shows for a tile built with budgets gated off (showBudget=false).
    buckets: props.budgets,
    fxRates,
```

with

```tsx
    // ★★ EUR, never `plan.currency`: this labels the engine's burn-down series
    // (`budgetHours × role.rates.external`), which converts nothing. Narrowing
    // `plan.currency` to the `BudgetCurrency` union did not make it safe — the
    // union still admits USD/GBP — and labelling with it printed EUR money
    // under another symbol on the LANDING view (docs/open-followups.md §465).
    currency: "EUR",
```

(no `showBudget` is threaded into `buildTileBodies` here either — same reason as (b) above.)

(i) Delete the now-orphaned `ForecastHeadline` component and its test (user's resolution of the open question — see the `ForecastHeadline` deletion ruling above; its only production caller was the burn body just replaced in (e)):

```bash
rm src/app/budget-forecast-headline.tsx src/app/budget-forecast-headline.test.tsx
```

In `src/app/budget-forecast-link.tsx`, replace

```tsx
// ★ The EAC-range ordering (low EAC first) is the same IDEA as
//   `budget-forecast-headline.tsx`'s tile headline, but the two are NOT
//   extracted into a shared helper: the only thing they share is a one-line
//   ternary (`a.eac <= b.eac ? [a, b] : [b, a]`), and every other formatting
//   detail differs — the headline also emits a VAC pair and a "runs out"
//   clause and has its own pace-unavailable branch (Actuals of BAC), while
//   this line never shows VAC/run-out and has THREE pace-unavailable texts of
//   its own (§6.4). Sharing a one-line ternary across files is not worth the
//   coupling; duplicating one ternary is not the "duplicated logic block" the
//   task brief warns against.
```

with

```tsx
// ★ The EAC-range ordering (low EAC first) mirrored the same idea in
//   `budget-forecast-headline.tsx`'s tile headline before spec C deleted that
//   file (its only production caller, the burn tile, moved to a chart-only
//   body). The two were never worth extracting into a shared helper: they
//   shared only a one-line ternary (`a.eac <= b.eac ? [a, b] : [b, a]`), and
//   every other formatting detail differed — the deleted headline also
//   emitted a VAC pair and a "runs out" clause and had its own
//   pace-unavailable branch (Actuals of BAC), while this line never shows
//   VAC/run-out and has THREE pace-unavailable texts of its own (§6.4).
```

- [ ] **Step 6: Run the tests and the gates**

```bash
npx vitest run src/app/dashboard-panel.test.tsx src/app/dashboard-sections/dashboard-kpi-strip.test.tsx src/app/budget-forecast-link.test.tsx src/app/i18n.test.ts src/app/i18n-encoding.test.ts > /tmp/dlr-t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/dlr-t4.log
npx tsc --noEmit > /tmp/dlr-tsc4.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc4.log
npx eslint --max-warnings=0 src/app/dashboard-tile-bodies.tsx src/app/dashboard-sections/dashboard-kpi-strip.tsx src/app/dashboard-panel.tsx src/app/budget-forecast-link.tsx src/app/dashboard-panel.test.tsx src/app/dashboard-sections/dashboard-kpi-strip.test.tsx src/app/i18n.ts; echo "LINT_EXIT=$?"
```
Expected: EXIT=0 with `Test Files  5 passed (5)`; TSC_EXIT=0 and `0` (tsc also proves the two dictionaries still have identical key sets, and that nothing still imports the deleted `budget-forecast-headline.tsx`); LINT_EXIT=0. The characterization test is still green — the after-half.

- [ ] **Step 7: Mutation-check the model-keyed gate on the moved indices**

Change `  const showCpi = model.evm.cpi !== null;` to `  const showCpi = model.evm.cpi === null;` in `dashboard-sections/dashboard-kpi-strip.tsx`. Re-run the vitest command: EXIT=1 — "adds both index tiles…" fails (CPI now absent when it should show) and "omits both when no task carries an estimate" fails (CPI now present when it should not); the panel's migrated "keeps the Effort SPI/CPI tiles visible when showBudget is false…" test fails too (CPI absent for `tasksWithEvmEstimate`, whose `cpi` is non-null). Revert; EXIT=0. `git diff --stat` — exactly the ten files of this task (eight modified, two deleted).

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard-tile-bodies.tsx src/app/dashboard-sections/dashboard-kpi-strip.tsx src/app/dashboard-panel.tsx src/app/budget-forecast-link.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/dashboard-panel.test.tsx src/app/dashboard-sections/dashboard-kpi-strip.test.tsx
git rm src/app/budget-forecast-headline.tsx src/app/budget-forecast-headline.test.tsx
git commit -F - <<'EOF'
feat(dashboard): make the Budget burn tile chart-only and move Effort SPI/CPI to the KPI tile

The burn tile now renders the compact burn-down chart (with its chain
warning) and nothing else; the forecast headline, Spent, hours, the FX
rollup notice and the caption leave it. Effort SPI and Effort CPI keep
their labels and hints in the KPI tile, each shown whenever its own
model field is non-null — independent of the Budget module, because
both indices can move a value the user sees with Budget off (SPI the
Schedule RAG always; CPI the Budget RAG, which still reaches the
dashboard's own delta strip, the AI snapshot tool, Trends and the
Portfolio health table). A characterization test pins that the
Schedule and Budget RAG did not move. The now-orphaned
`ForecastHeadline` component and its test are deleted, along with
seven now-unused i18n keys, from both dictionaries.
EOF
```

---

## Task 5: Lift grouping once, share the hero rule, thread the CTA bundle, mount row 2

**Files:**
- Create: `src/app/dashboard-rows.tsx`, `src/app/dashboard-rows.test.tsx`, `src/app/dashboard-panel-layout.test.tsx`
- Modify: `src/app/next-actions/group.ts`, `src/app/actions-panel.tsx`, `src/app/action-hero-card.tsx`, `src/app/task-manager.tsx`, `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx`, `src/app/dashboard-panel.tsx`
- Test: `src/app/next-actions/group.test.ts`, `src/app/actions-panel.test.tsx`, `src/app/action-hero-card.test.tsx`, `src/app/workspace-section.test.tsx`, `src/app/workspace-section.characterization.test.tsx`, `src/app/task-manager.characterization.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // next-actions/group.ts
  export function pickHeroGroup(groups: readonly ActionGroup[]): ActionGroup | null;
  export function topGroupPrimaries(groups: readonly ActionGroup[], n: number): SuggestedAction[]; // was (actions, n)
  // workspace-section-types.ts — WorkspaceSectionProps gains
  nextActionGroups: readonly ActionGroup[];
  // actions-panel.tsx — ActionsPanelProps: `actions` REPLACED by
  groups: readonly ActionGroup[];
  // action-hero-card.tsx — ActionHeroCardProps gains
  className?: string;                        // default "mb-4" (the Next-actions page, unchanged)
  // dashboard-panel.tsx — DashboardPanelProps gains
  heroGroup?: ActionGroup | null;
  actionHandlers?: Omit<ActionHandlers, "onOpen">;
  expertMode?: boolean;
  // dashboard-rows.tsx
  export function DashboardStatusRow(props: { dc: DensityClasses; hero: ReactNode; status: ReactNode }): JSX.Element;
  ```

**Rulings (brief items 3 and 4):**
- *Where grouping runs:* `task-manager.tsx` computes `nextActions` with `computeNextActions` inside a `useMemo`; directly after it, `const nextActionGroups = useMemo(() => groupNextActions(nextActions), [nextActions]);`, threaded on `workspaceProps` beside `nextActions`. The flat list keeps flowing to everything that reads it (notifications, the Tasks pane chips, `TasksSection`).
- *Spec claim corrected:* the Top actions tile is NOT fed a flat head of the list today — `workspace-section.tsx` passes `topActions={topGroupPrimaries(nextActions, 5)}`, which calls `groupNextActions` a SECOND time. After this task `topGroupPrimaries` takes the groups, so grouping runs exactly once. The tile still renders one `ActionRow` per primary (decision 4's "flat" is about rendering, and it stays).
- *The one hero rule:* `ActionsPanel` picked `groups[0] && groups[0].tier !== "monitor" ? groups[0] : null`. That moves verbatim into `pickHeroGroup`; `ActionsPanel` and `workspace-section.tsx` (for the Dashboard) both call it on the same array, so the two surfaces cannot disagree.
- *Handler bundle:* `ActionsPanel` receives `onSnooze, onCreateTask, onDraftMessage, assignOwner, escalate, rebaseline, reschedule, onMarkDone, onClearBlocker, onLogAsRaid` (+ `onOpen`, `expertMode`) and spreads them as `rowProps` into both its `ActionRow`s and its `ActionHeroCard`. `task-manager.tsx` already popout-gates most of them (`isPopout ? undefined : …`). `workspace-section.tsx` passes the SAME ten to the Dashboard as one `actionHandlers` bag (AGENTS.md's calendar-bag convention: one bag, not ten flat props); `onOpenAction` and `expertMode` are separate props. The AGENTS.md "Action-Center CTAs surface-only" warning (thread to BOTH lists) concerns `ActionsPanel`'s two `ActionRow` lists, which keep `rowProps`; the Dashboard has one CTA surface (its hero). The Top actions tile keeps `onOpen` only, as today.
- *Popout:* the panel drops the bag entirely in a popout (`isPopout`) — decision 4's "renders without handlers" — even for the two handlers `task-manager.tsx` does not gate (`onSnooze`, `onLogAsRaid`).
- *Name collision (spec claim corrected):* the tile's rows are row-unique only WITHIN the tile. With the hero and the tile listing the same action, the hero's "Open – <title>" would equal the tile row's. The Dashboard hero therefore gets a section-segment token, `rowLabel(t(lang, "actionHeroEyebrow"), title)` → "Open – Do this first – <title>" — the same shape as `AiActionRow`'s section segment. Its visible CTA text is unchanged and still contained in the name; the tile's names are unchanged. On the Next-actions page the hero keeps its existing token.
- *Equal height:* each column of row 2 is a CSS `grid` cell (`grid min-w-0 lg:flex-1`) in a `lg:items-stretch` flex row, so each card stretches to the row's height with no pixel height. `ActionHeroCard` gains `className` (default `"mb-4"`) because its fixed bottom margin would otherwise leave the hero 16px short of the status card; the Dashboard passes `"h-full"`.
- *Order:* row 2 moves up to sit directly under row 1, above `NarrativeSummary` · `DashboardCoachingCard` · `DashboardTipCard`, and the grid follows. (The digest still sits between the tip and the grid until Task 6 moves it into row 1.)

Breakage sweep (brief item 7): `grep -rn "groupNextActions\|topGroupPrimaries\|<ActionsPanel\|nextActions:" src e2e --include=*.ts --include=*.tsx`:
- `next-actions/group.test.ts` `topGroupPrimaries(actions, …)` ×2 — MIGRATE (wrap in `groupNextActions`).
- `actions-panel.test.tsx` — every `<ActionsPanel … actions={…}>` render (about 25) — MIGRATE through ONE local wrapper component that groups, so no render site changes.
- `workspace-section.test.tsx` `makeProps` and "hands the dashboard one action per group…" — MIGRATE (`nextActionGroups`).
- `workspace-section.characterization.test.tsx` `makeProps` — MIGRATE (`nextActionGroups: []`).
- `task-manager.characterization.test.tsx` action-center key list — MIGRATE (add `nextActionGroups`).
- `workspace-panels.tsx` dynamic `ActionsPanel` — KEEP (types flow).
- `settings-sections/next-actions-section.test.tsx` `nextActions:` — KEEP (a settings object, unrelated).
- `dashboard-panel.test.tsx` Top-actions tests — KEEP (they pass no `heroGroup`, so no hero renders and their `/^Open – /` queries stay unique).
- e2e: no hit.

- [ ] **Step 1: Write the failing tests**

`src/app/next-actions/group.test.ts` — replace `import { groupNextActions, topGroupPrimaries } from "./group";` with `import { groupNextActions, pickHeroGroup, topGroupPrimaries } from "./group";`; replace `    expect(topGroupPrimaries(actions, 5).map((a) => a.id)).toEqual(["e1a", "e2"]);` with `    expect(topGroupPrimaries(groupNextActions(actions), 5).map((a) => a.id)).toEqual(["e1a", "e2"]);` and `    expect(topGroupPrimaries(actions, 2).map((a) => a.id)).toEqual(["a", "b"]);` with `    expect(topGroupPrimaries(groupNextActions(actions), 2).map((a) => a.id)).toEqual(["a", "b"]);`; and append:

```ts
describe("pickHeroGroup (spec C: one rule for the Next-actions page and the Dashboard)", () => {
  it("returns the top-ranked group when it is not monitor-tier", () => {
    const groups = groupNextActions([mk("a", 90, 1, "now"), mk("b", 80, 2, "soon")]);
    expect(pickHeroGroup(groups)).toBe(groups[0]);
  });

  it("returns null when the top-ranked group is monitor-tier", () => {
    expect(pickHeroGroup(groupNextActions([mk("m", 10, 1, "monitor")]))).toBeNull();
  });

  it("never reaches past a monitor-tier top group for a lower Now one", () => {
    // Rank is score order; a monitor group can outrank a now group.
    expect(pickHeroGroup(groupNextActions([mk("m", 99, 1, "monitor"), mk("n", 50, 2, "now")]))).toBeNull();
  });

  it("returns null for no groups", () => {
    expect(pickHeroGroup([])).toBeNull();
  });
});
```

`src/app/actions-panel.test.tsx` — replace

```tsx
import { ActionsPanel } from "./actions-panel";
import type { SuggestedAction } from "./next-actions/types";
```

with

```tsx
import type { ComponentProps } from "react";
import { ActionsPanel as GroupedActionsPanel } from "./actions-panel";
import { groupNextActions, pickHeroGroup } from "./next-actions/group";
import type { SuggestedAction } from "./next-actions/types";

/**
 * ★ Spec C lifted grouping out of `ActionsPanel` into `task-manager.tsx`, so
 * the panel now takes `groups`. This wrapper groups exactly as production does
 * (`groupNextActions` over the flat list) and keeps every render site below
 * byte-identical — "the actions-panel tests still pass when fed grouped data
 * from above", which is the spec's own wording.
 */
function ActionsPanel({ actions, ...rest }: Omit<ComponentProps<typeof GroupedActionsPanel>, "groups"> & { actions: readonly SuggestedAction[] }) {
  return <GroupedActionsPanel {...rest} groups={groupNextActions(actions)} />;
}
```

and append at the end of the file:

```tsx
describe("ActionsPanel — fed grouped data from above (spec C)", () => {
  it("promotes exactly the group pickHeroGroup picks, so the Dashboard's hero cannot differ", () => {
    const groups = groupNextActions([mk("low", "monitor"), mk("mid", "soon"), mk("top", "now")]);
    render(<GroupedActionsPanel lang="en-US" groups={groups} onOpen={() => {}} />);
    const expected = pickHeroGroup(groups)!;
    const hero = screen.getByRole("region", { name: /Do this first/i });
    expect(hero).toHaveTextContent(t("en-US", expected.primary.title.key, ...(expected.primary.title.params ?? [])));
  });
});
```

`src/app/action-hero-card.test.tsx` — append at the end of the file (it reuses the file's own `noOwner` fixture and `group()` helper):

```tsx
describe("ActionHeroCard — the box (spec C)", () => {
  it("keeps its bottom margin by default and takes a caller class instead", () => {
    const { unmount } = render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(screen.getByRole("region", { name: /Do this first/i }).className).toContain("mb-4");
    unmount();
    render(<ActionHeroCard rowToken="Row" lang="en-US" group={group(noOwner)} onOpen={() => {}} className="h-full" />);
    const region = screen.getByRole("region", { name: /Do this first/i });
    expect(region.className).toContain("h-full");
    expect(region.className).not.toContain("mb-4");
  });
});
```

`src/app/workspace-section.test.tsx`:
- add `import { groupNextActions, pickHeroGroup } from "./next-actions/group";` to the imports;
- in `makeProps` replace `    nextActions: [],` with `    nextActions: [],\n    nextActionGroups: [],` (two lines, CRLF — use the Edit tool with a real line break);
- in "hands the dashboard one action per group, not the flat list's head" replace `    render(<WorkspaceSection {...makeProps({ nextActions })} />, { wrapper: Wrapper });` with `    render(<WorkspaceSection {...makeProps({ nextActions, nextActionGroups: groupNextActions(nextActions) })} />, { wrapper: Wrapper });`;
- append at the end of the file:

```tsx
describe("WorkspaceSection — the dashboard hero and its CTA bundle (spec C)", () => {
  beforeEach(() => {
    dashboardPanelMock.props.length = 0;
  });

  const mkAction = (id: string, tier: SuggestedAction["tier"], score: number, ctaId: number): SuggestedAction => ({
    id, source: "raid",
    title: { key: "actionRaidTitle", params: [ctaId, id] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score, tier,
    cta: { kind: "open", view: "raid", id: ctaId },
  });

  it("hands the dashboard pickHeroGroup's choice, from the ONE grouping it was given", () => {
    const groups = groupNextActions([mkAction("n", "now", 60, 1), mkAction("s", "soon", 30, 2)]);
    render(<WorkspaceSection {...makeProps({ nextActions: groups.map((g) => g.primary), nextActionGroups: groups })} />, { wrapper: Wrapper });
    const props = dashboardPanelMock.props.at(-1)!;
    expect(props.heroGroup).toBe(pickHeroGroup(groups));
    expect(props.heroGroup).toBe(groups[0]);
  });

  it("hands the dashboard no hero when the top group is monitor-only", () => {
    const groups = groupNextActions([mkAction("m", "monitor", 10, 1)]);
    render(<WorkspaceSection {...makeProps({ nextActions: groups.map((g) => g.primary), nextActionGroups: groups })} />, { wrapper: Wrapper });
    expect(dashboardPanelMock.props.at(-1)!.heroGroup).toBeNull();
  });

  it("threads the SAME ten handler functions ActionsPanel receives, as one bag", () => {
    const onMarkDone = vi.fn();
    const onSnooze = vi.fn();
    const onLogAsRaid = vi.fn();
    render(<WorkspaceSection {...makeProps({ onMarkDone, onSnooze, onLogAsRaid, expertMode: true })} />, { wrapper: Wrapper });
    const props = dashboardPanelMock.props.at(-1)!;
    const bag = props.actionHandlers as Record<string, unknown>;
    expect(Object.keys(bag).sort()).toEqual([
      "assignOwner", "escalate", "onClearBlocker", "onCreateTask", "onDraftMessage",
      "onLogAsRaid", "onMarkDone", "onSnooze", "rebaseline", "reschedule",
    ]);
    expect(bag.onMarkDone).toBe(onMarkDone);
    expect(bag.onSnooze).toBe(onSnooze);
    expect(bag.onLogAsRaid).toBe(onLogAsRaid);
    expect(props.expertMode).toBe(true);
  });
});
```

`src/app/workspace-section.characterization.test.tsx` — in `makeProps` replace `    nextActions: [],` with `    nextActions: [],` + a new line `    nextActionGroups: [],`.

`src/app/task-manager.characterization.test.tsx` — in "threads the action-center handler bundles", replace

```tsx
    for (const key of [
      "nextActions",
      "onOpenAction",
```

with

```tsx
    // ★ Spec C: grouping runs ONCE in task-manager, and both the Next-actions
    // page and the Dashboard read this array.
    expect(Array.isArray(p.nextActionGroups), "nextActionGroups must reach WorkspaceSection as an array").toBe(true);
    for (const key of [
      "nextActions",
      "nextActionGroups",
      "onOpenAction",
```

Create `src/app/dashboard-rows.test.tsx` (Write tool, then the CRLF normaliser):

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardStatusRow } from "./dashboard-rows";
import { densityClasses } from "./dashboard-density";

const dc = densityClasses("comfortable");

describe("DashboardStatusRow (spec C row 2)", () => {
  it("puts the hero first and Overall status beside it, stacking below lg", () => {
    render(<DashboardStatusRow dc={dc} hero={<p>hero</p>} status={<p>status</p>} />);
    const row = screen.getByTestId("dashboard-row-status");
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("lg:flex-row");
    expect(row.children).toHaveLength(2);
    expect(row.children[0]).toHaveTextContent("hero");
    expect(row.children[1]).toHaveTextContent("status");
  });

  it("gives Overall status the whole row when there is no hero", () => {
    render(<DashboardStatusRow dc={dc} hero={null} status={<p>status</p>} />);
    const row = screen.getByTestId("dashboard-row-status");
    expect(row.children).toHaveLength(1);
    expect(screen.queryByTestId("dashboard-row-status-hero")).toBeNull();
    expect(screen.getByTestId("dashboard-row-status-overall").className).toContain("lg:flex-1");
  });

  it("makes the two cards equal height by stretch, never a pixel height", () => {
    render(<DashboardStatusRow dc={dc} hero={<p>hero</p>} status={<p>status</p>} />);
    const row = screen.getByTestId("dashboard-row-status");
    expect(row.className).toContain("lg:items-stretch");
    for (const el of [row, ...Array.from(row.children)]) {
      expect(el.className, el.getAttribute("data-testid") ?? "").not.toMatch(/(^|\s)(h|min-h|max-h)-\[/);
    }
    // Each column is a grid cell, so its one child stretches to the row height.
    for (const col of Array.from(row.children)) expect(col.className).toMatch(/(^|\s)grid(\s|$)/);
  });

  it("spaces the row with the density class, not a literal gap", () => {
    render(<DashboardStatusRow dc={densityClasses("compact")} hero={<p>hero</p>} status={<p>status</p>} />);
    expect(screen.getByTestId("dashboard-row-status").className).toContain(densityClasses("compact").sectionGap);
  });
});
```

Create `src/app/dashboard-panel-layout.test.tsx` (Write tool, then the CRLF normaliser):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { groupNextActions } from "./next-actions/group";
import { rowLabel } from "./row-tokens";
import { t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";

/**
 * Spec C: the Dashboard's fixed rows, exercised through the real panel.
 * ★ Every test uses its own `projectId` — `useDashboardLayout` persists per
 * project, and RTL cleanup flushes pending writes, so a shared id leaks.
 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const EN = "en-US" as const;
const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const };
const baseProps = {
  lang: EN, tasks: [], raid: [], budgets: [], plan, roles: [], resources: [], absences: [],
  holidaySet: new Set<string>(), workdayHours: 8, today: "2026-06-02",
};
const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

const nowAction: SuggestedAction = {
  id: "raid:1:severity", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "Vendor slip"] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: 60, tier: "now",
  cta: { kind: "open", view: "raid", id: 1 },
};
const heroGroup = groupNextActions([nowAction])[0];
const TITLE = t(EN, "actionRaidTitle", 1, "Vendor slip");
const HERO = t(EN, "actionHeroEyebrow");
const HERO_TOKEN = rowLabel(HERO, TITLE);

describe("DashboardPanel row 2 — the hero beside Overall status (spec C)", () => {
  it("mounts the Next-Actions hero in row 2, before Overall status, filling its cell", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row2-hero" heroGroup={heroGroup} onOpenAction={vi.fn()} />, { wrapper });
    const row = screen.getByTestId("dashboard-row-status");
    const hero = within(row).getByRole("region", { name: HERO });
    const overall = within(row).getByText(t(EN, "dashboardAdjustHealth"));
    expect(hero.compareDocumentPosition(overall) & FOLLOWING).toBeTruthy();
    expect(hero.className).toContain("h-full");
    expect(hero.className).not.toContain("mb-4");
  });

  it("gives Overall status the whole row when there is no Now/Soon hero", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row2-none" />, { wrapper });
    const row = screen.getByTestId("dashboard-row-status");
    expect(within(row).queryByRole("region", { name: HERO })).toBeNull();
    expect(row.children).toHaveLength(1);
    expect(within(row).getByText(t(EN, "dashboardAdjustHealth"))).toBeInTheDocument();
  });

  it("renders row 2 before the coaching card, and the coaching card before the grid", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row2-order" />, { wrapper });
    const row = screen.getByTestId("dashboard-row-status");
    const coaching = screen.getByText(t(EN, "coachingTitle"));
    const grid = screen.getByTestId("dashboard-grid");
    expect(row.compareDocumentPosition(coaching) & FOLLOWING).toBeTruthy();
    expect(coaching.compareDocumentPosition(grid) & FOLLOWING).toBeTruthy();
  });

  it("keeps the hero's action in the Top actions tile too, with names that never collide", () => {
    render(
      <DashboardPanel {...baseProps} projectId="p-row2-dupe" heroGroup={heroGroup} topActions={[nowAction]} onOpenAction={vi.fn()} />,
      { wrapper },
    );
    // Decision 5: no de-duplication — both surfaces show the action.
    expect(within(screen.getByTestId("tile-topActions")).getByText(TITLE)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: HERO })).getByText(TITLE)).toBeInTheDocument();
    // WCAG 2.4.6, which axe cannot see: every control naming this action is unique.
    const names = screen.getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((n) => n.includes(TITLE));
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(rowLabel(t(EN, "actionOpen"), TITLE));        // the tile row, unchanged
    expect(names).toContain(rowLabel(t(EN, "actionOpen"), HERO_TOKEN));   // the hero, section-qualified
  });

  it("threads the CTA bundle to the hero", async () => {
    const user = userEvent.setup();
    const onSnooze = vi.fn();
    render(
      <DashboardPanel {...baseProps} projectId="p-row2-cta" heroGroup={heroGroup} onOpenAction={vi.fn()} actionHandlers={{ onSnooze }} />,
      { wrapper },
    );
    await user.click(screen.getByRole("button", { name: rowLabel(t(EN, "actionMoreActions"), HERO_TOKEN) }));
    await user.click(screen.getByRole("button", { name: t(EN, "actionSnooze1h") }));
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onSnooze.mock.calls[0][0]).toBe(nowAction);
  });

  it("renders the hero without its handlers in a popout", () => {
    render(
      <DashboardPanel {...baseProps} projectId="p-row2-popout" isPopout heroGroup={heroGroup} onOpenAction={vi.fn()} actionHandlers={{ onSnooze: vi.fn() }} />,
      { wrapper },
    );
    expect(screen.getByRole("region", { name: HERO })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: rowLabel(t(EN, "actionMoreActions"), HERO_TOKEN) })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch the right ones fail**

```bash
npx vitest run src/app/next-actions/group.test.ts src/app/actions-panel.test.tsx src/app/action-hero-card.test.tsx src/app/workspace-section.test.tsx src/app/workspace-section.characterization.test.tsx src/app/task-manager.characterization.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx > /tmp/dlr-t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" /tmp/dlr-t5.log | head -30
```
Expected: EXIT=1. `pickHeroGroup` and `dashboard-rows` do not exist (import failures, which fail `group.test.ts`, `actions-panel.test.tsx`, `workspace-section.test.tsx`, `dashboard-rows.test.tsx` and `dashboard-panel-layout.test.tsx` as whole files); `action-hero-card.test.tsx`'s new test fails (`mb-4` is not overridable yet); the characterization key test fails (`nextActionGroups` absent). `workspace-section.characterization.test.tsx` stays green (it only gained a fixture field).

- [ ] **Step 3: Implement the shared helpers**

`src/app/next-actions/group.ts` — replace

```ts
/** The primaries of the top `n` groups, in group rank order. For a compact
 *  surface that renders one row per action (the dashboard's Top actions tile):
 *  slicing the FLAT list first would let several signals on one entity — e.g.
 *  one per missing project key fact — fill every slot with the same row. */
export function topGroupPrimaries(actions: readonly SuggestedAction[], n: number): SuggestedAction[] {
  return groupNextActions(actions).slice(0, n).map((g) => g.primary);
}
```

with

```ts
/** The primaries of the top `n` groups, in group rank order. For a compact
 *  surface that renders one row per action (the dashboard's Top actions tile):
 *  slicing the FLAT list first would let several signals on one entity — e.g.
 *  one per missing project key fact — fill every slot with the same row.
 *  ★ Takes the GROUPS (spec C): `task-manager.tsx` groups once and hands the
 *  result down, so this no longer runs `groupNextActions` a second time. */
export function topGroupPrimaries(groups: readonly ActionGroup[], n: number): SuggestedAction[] {
  return groups.slice(0, n).map((g) => g.primary);
}

/**
 * The single group a surface promotes to "Do this first": the top-ranked group,
 * but only when it carries real urgency (tier !== "monitor" — never promote a
 * low/monitor item). ★★ ONE helper for BOTH surfaces (spec C decision 4): the
 * Next-actions page and the Dashboard's row 2 call it on the same array, so
 * they cannot promote different heroes.
 */
export function pickHeroGroup(groups: readonly ActionGroup[]): ActionGroup | null {
  const top = groups[0];
  return top && top.tier !== "monitor" ? top : null;
}
```

`src/app/actions-panel.tsx`:
- replace `import { groupNextActions, type ActionGroup } from "./next-actions/group";` with `import { pickHeroGroup, type ActionGroup } from "./next-actions/group";`;
- in `ActionsPanelProps` replace `  actions: readonly SuggestedAction[];` with

```tsx
  /** The grouped next actions (spec C): grouped ONCE in `task-manager.tsx` and
   *  shared with the Dashboard, which picks its hero with the same helper. */
  groups: readonly ActionGroup[];
```

- in the function signature replace `export function ActionsPanel({ lang, actions, onOpen,` with `export function ActionsPanel({ lang, groups, onOpen,`;
- delete the line `  const groups = useMemo(() => groupNextActions(actions), [actions]);`;
- replace

```tsx
  // Hero = the single top-ranked group, but only when it carries real urgency
  // (tier !== monitor — never promote a low/monitor item to "Do this first").
  const hero = groups[0] && groups[0].tier !== "monitor" ? groups[0] : null;
```

with

```tsx
  // Hero = `pickHeroGroup` — the one rule the Dashboard's row 2 uses too.
  const hero = pickHeroGroup(groups);
```

`src/app/action-hero-card.tsx`:
- in `ActionHeroCardProps`, directly after `  rowToken: string;` add:

```tsx
  /** The card's outer spacing. Default `"mb-4"` — the Next-actions page, where
   *  the hero sits above the tier lists. The Dashboard's row 2 passes
   *  `"h-full"`: a bottom margin there would leave the hero shorter than the
   *  Overall status card beside it (spec C decision 3). */
  className?: string;
```

- replace `  const { lang, group, expertMode, rowToken } = props;` with `  const { lang, group, expertMode, rowToken, className = "mb-4" } = props;`;
- replace `      className={`mb-4 rounded-lg border border-line border-l-4 ${rag.stripe} bg-surface p-4 shadow-[var(--shadow-card)]`}` with `      className={`${className} rounded-lg border border-line border-l-4 ${rag.stripe} bg-surface p-4 shadow-[var(--shadow-card)]`}`.

Create `src/app/dashboard-rows.tsx` (Write tool, then the CRLF normaliser):

```tsx
"use client";
/**
 * The Dashboard's fixed rows (spec C), presentational only: the panel owns
 * every value and passes each slot in. Extracted per AGENTS.md's panel-split
 * convention so `dashboard-panel.tsx` stays an orchestrator.
 *
 * ★ Density: gaps come from `dc.*`, never a literal class — a literal ignores
 * compact mode.
 */
import type { ReactNode } from "react";
import type { DensityClasses } from "./dashboard-density";

/**
 * Row 2 (decision 3): the Next-Actions hero on the left, Overall status on the
 * right, equal height; stacks below `lg`; with no hero, Overall status takes
 * the whole row.
 *
 * ★★ EQUAL HEIGHT IS STRETCH, NEVER A PIXEL HEIGHT (spec Accessibility): the
 * flex row stretches both columns to the taller one, and each column is a
 * one-cell GRID, whose child stretches to the cell — so a long hero grows the
 * row instead of clipping.
 */
export function DashboardStatusRow({
  dc, hero, status,
}: {
  dc: DensityClasses;
  hero: ReactNode;
  status: ReactNode;
}) {
  return (
    <div data-testid="dashboard-row-status" className={`flex flex-col lg:flex-row lg:items-stretch ${dc.sectionGap}`}>
      {hero ? (
        <div data-testid="dashboard-row-status-hero" className="grid min-w-0 lg:flex-1">{hero}</div>
      ) : null}
      <div data-testid="dashboard-row-status-overall" className="grid min-w-0 lg:flex-1">{status}</div>
    </div>
  );
}
```

- [ ] **Step 4: Thread the groups, the hero and the bag**

`src/app/task-manager.tsx`:
- replace `import { computeNextActions } from "./next-actions";` with

```tsx
import { computeNextActions } from "./next-actions";
import { groupNextActions } from "./next-actions/group";
```

- directly after the line `  const nowCount = nextActions.filter((a) => a.tier === "now").length;` insert:

```tsx
  // ★ Spec C decision 4: grouping runs ONCE, here, beside `computeNextActions`.
  // Both the Next-actions page and the Dashboard (its hero and Top actions tile)
  // read this array, so the two surfaces cannot pick different heroes. The flat
  // list keeps flowing to everything that wants it (notifications, chips, AI).
  const nextActionGroups = useMemo(() => groupNextActions(nextActions), [nextActions]);
```

- in `workspaceProps`, replace

```tsx
    nextActions,
    onOpenAction: openAction,
    // Insights lifecycle bag (#6B SP1/SP2).
```

with

```tsx
    nextActions,
    nextActionGroups,
    onOpenAction: openAction,
    // Insights lifecycle bag (#6B SP1/SP2).
```

(Use the Edit tool; the anchor includes the `// Insights lifecycle bag` line so it matches only the `workspaceProps` site, not the `useAiOrchestration` deps object that also lists `nextActions,`.)

`src/app/workspace-section-types.ts`:
- replace

```ts
import type {
  SuggestedAction,
} from "./next-actions";
```

with

```ts
import type {
  SuggestedAction,
} from "./next-actions";
import type { ActionGroup } from "./next-actions/group";
```

- replace

```ts
  nextActions: readonly SuggestedAction[];
  onOpenAction: (a: SuggestedAction) => void;
```

with

```ts
  nextActions: readonly SuggestedAction[];
  /** `groupNextActions(nextActions)`, computed ONCE in `task-manager.tsx`
   *  (spec C decision 4). `ActionsPanel` renders it; the Dashboard gets its
   *  hero (`pickHeroGroup`) and Top-actions primaries from it. */
  nextActionGroups: readonly ActionGroup[];
  onOpenAction: (a: SuggestedAction) => void;
```

`src/app/workspace-section.tsx`:
- replace `import { topGroupPrimaries } from "./next-actions/group";` with `import { pickHeroGroup, topGroupPrimaries } from "./next-actions/group";`;
- in the destructuring replace

```tsx
  nextActions,
  onOpenAction,
  insightActions,
```

with

```tsx
  nextActions,
  nextActionGroups,
  onOpenAction,
  insightActions,
```

- in the `DashboardPanel` element replace

```tsx
              topActions={topGroupPrimaries(nextActions, 5)}
              onOpenAction={onOpenAction}
```

with

```tsx
              topActions={topGroupPrimaries(nextActionGroups, 5)}
              // ★ Spec C decision 4: the SAME hero rule and the SAME ten
              // handlers `ActionsPanel` gets below — one bag, not ten props.
              // The panel itself drops the bag in a popout.
              heroGroup={pickHeroGroup(nextActionGroups)}
              actionHandlers={{
                onSnooze, onCreateTask, onDraftMessage, assignOwner, escalate,
                rebaseline, reschedule, onMarkDone, onClearBlocker, onLogAsRaid,
              }}
              expertMode={expertMode}
              onOpenAction={onOpenAction}
```

- in the `ActionsPanel` element replace `<ActionsPanel lang={lang} actions={nextActions} onOpen={onOpenAction}` with `<ActionsPanel lang={lang} groups={nextActionGroups} onOpen={onOpenAction}`.

`src/app/dashboard-panel.tsx`:
- add imports after `import type { SuggestedAction } from "./next-actions/types";`:

```tsx
import type { ActionGroup } from "./next-actions/group";
import type { ActionHandlers } from "./action-cta-controls";
import { ActionHeroCard } from "./action-hero-card";
import { rowLabel } from "./row-tokens";
import { DashboardStatusRow } from "./dashboard-rows";
```

- after the `EMPTY_SNAPSHOTS` constant add:

```tsx
/** Stable empties for the hero's CTA bundle — see `heroHandlers` below. */
const NO_HANDLERS: Omit<ActionHandlers, "onOpen"> = {};
const NOOP_OPEN = () => {};
```

- in `DashboardPanelProps` replace

```tsx
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
```

with

```tsx
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  /** Row 2's Next-Actions hero (spec C decisions 3–4): `pickHeroGroup` over the
   *  ONE grouping `task-manager.tsx` runs, so this panel and the Next-actions
   *  page cannot promote different groups. null/absent = no Now/Soon group →
   *  Overall status takes the whole row. */
  heroGroup?: ActionGroup | null;
  /** The CTA bundle `ActionsPanel` hands its hero, minus `onOpen` (this panel's
   *  `onOpenAction` is that). Ignored in a popout. */
  actionHandlers?: Omit<ActionHandlers, "onOpen">;
  expertMode?: boolean;
```

- directly after the line `  const repTaskId = model.overdue[0]?.id ?? model.dueSoon[0]?.id;` insert:

```tsx
  // ── Row 2: the Next-Actions hero (spec C decisions 3–4) ─────────────────────
  // ★ A popout is read-only: the hero renders without ANY handler, including
  // the two `task-manager.tsx` does not popout-gate (`onSnooze`, `onLogAsRaid`).
  const heroGroup = props.heroGroup ?? null;
  const heroHandlers = props.isPopout ? NO_HANDLERS : (props.actionHandlers ?? NO_HANDLERS);
  // ★★ THE HERO'S TOKEN CARRIES A SECTION SEGMENT HERE, and only here. The Top
  // actions tile keeps listing the hero's action (decision 5), and its rows are
  // row-unique only WITHIN the tile, so a bare title would give the hero and the
  // tile row the same "Open – <title>" — a WCAG 2.4.6 collision axe cannot see.
  // "Open – Do this first – <title>" still contains the visible "Open"; the
  // tile's names are unchanged. Same shape as `AiActionRow`'s section segment.
  const heroEl = heroGroup ? (
    <ActionHeroCard
      {...heroHandlers}
      onOpen={onOpenAction ?? NOOP_OPEN}
      lang={lang}
      group={heroGroup}
      expertMode={props.expertMode}
      rowToken={rowLabel(
        t(lang, "actionHeroEyebrow"),
        t(lang, heroGroup.primary.title.key, ...(heroGroup.primary.title.params ?? [])),
      )}
      className="h-full"
    />
  ) : null;
```

- in the JSX, replace

```tsx
        </div>

        {/* Tier 0 — read-only status narrative summary (self-hides when empty) */}
```

with

```tsx
        </div>

        {/* Row 2 (spec C decision 3): the Next-Actions hero beside Overall
            status; the order below it is narrative → coaching → tip → grid. */}
        <DashboardStatusRow
          dc={dc}
          hero={heroEl}
          status={
            <DashboardHero
              lang={lang}
              today={today}
              model={model}
              status={status}
              setStatus={setStatus}
              showBudget={showBudget}
              showChanges={showChanges}
            />
          }
        />

        {/* Tier 0 — read-only status narrative summary (self-hides when empty) */}
```

- delete the old hero block:

```tsx
        {/* Tier 1 — hero: Overall RAG band + Adjust-health disclosure */}
        <DashboardHero
          lang={lang}
          today={today}
          model={model}
          status={status}
          setStatus={setStatus}
          showBudget={showBudget}
          showChanges={showChanges}
        />

```

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/app/next-actions/group.test.ts src/app/actions-panel.test.tsx src/app/action-hero-card.test.tsx src/app/workspace-section.test.tsx src/app/workspace-section.characterization.test.tsx src/app/task-manager.characterization.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/dashboard-panel.test.tsx > /tmp/dlr-t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/dlr-t5.log
npx tsc --noEmit > /tmp/dlr-tsc5.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc5.log
npx eslint --max-warnings=0 src/app/next-actions/group.ts src/app/actions-panel.tsx src/app/action-hero-card.tsx src/app/task-manager.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/dashboard-panel.tsx src/app/dashboard-rows.tsx src/app/next-actions/group.test.ts src/app/actions-panel.test.tsx src/app/action-hero-card.test.tsx src/app/workspace-section.test.tsx src/app/workspace-section.characterization.test.tsx src/app/task-manager.characterization.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx; echo "LINT_EXIT=$?"
grep -rn "groupNextActions(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\." > /tmp/dlr-t5-group.log; cat /tmp/dlr-t5-group.log
```
Expected: EXIT=0 with `Test Files  9 passed (9)`; TSC_EXIT=0 and `0`; LINT_EXIT=0; the last grep lists exactly two production lines — the `groupNextActions` definition in `group.ts` and the one call in `task-manager.tsx` (proof grouping runs once). If `useMemo` is now unused in `actions-panel.tsx`, the lint step says so — it is not: `actionTokens` still uses it.

- [ ] **Step 6: Mutation-check the shared hero rule and the collision guard**

Mutant 1: in `workspace-section.tsx` change `heroGroup={pickHeroGroup(nextActionGroups)}` to `heroGroup={nextActionGroups[0] ?? null}`. Re-run the vitest command: EXIT=1 — "hands the dashboard no hero when the top group is monitor-only" fails. Revert; EXIT=0.
Mutant 2: in `dashboard-panel.tsx` replace the `rowToken={rowLabel(…)}` expression with `rowToken={t(lang, heroGroup.primary.title.key, ...(heroGroup.primary.title.params ?? []))}`. Re-run: EXIT=1 — "keeps the hero's action in the Top actions tile too, with names that never collide" fails on the duplicate. Revert; EXIT=0. `git diff --stat` — exactly the 16 files of this task.

- [ ] **Step 7: Commit**

```bash
git add src/app/next-actions/group.ts src/app/actions-panel.tsx src/app/action-hero-card.tsx src/app/task-manager.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/dashboard-panel.tsx src/app/dashboard-rows.tsx src/app/next-actions/group.test.ts src/app/actions-panel.test.tsx src/app/action-hero-card.test.tsx src/app/workspace-section.test.tsx src/app/workspace-section.characterization.test.tsx src/app/task-manager.characterization.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx
git commit -F - <<'EOF'
feat(dashboard): group next actions once and put the Next-Actions hero beside Overall status

groupNextActions now runs once, in task-manager, and both the Next-actions
page and the Dashboard read the result; pickHeroGroup is the one hero rule
both call, and the Top actions tile takes its primaries from the same
groups. The Dashboard's new row 2 mounts ActionHeroCard beside the Overall
status card, equal height by stretch, with the same handler bundle the
Next-actions page passes (none in a popout). The hero's CTA names carry a
section segment so they never collide with the Top actions tile, which
keeps listing the same action.
EOF
```

---

## Task 6: Row 1 with the digest, the hidden-tiles badge and the tray under row 1

**Files:**
- Create: `src/app/dashboard-hidden-badge.tsx`, `src/app/dashboard-hidden-badge.test.tsx`
- Modify: `src/app/dashboard-rows.tsx`, `src/app/arrangement-shelf.tsx`, `src/app/dashboard-shelf.tsx`, `src/app/dashboard-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/dashboard-rows.test.tsx`, `src/app/dashboard-panel-layout.test.tsx`, `src/app/dashboard-panel.test.tsx`, `src/app/dashboard-grid.test.tsx`

**Interfaces:**
- Consumes: `DashboardStatusRow` (Task 5).
- Produces:
  ```ts
  // dashboard-rows.tsx
  export function DashboardTopRow(props: { dc: DensityClasses; delta: ReactNode; digest: ReactNode; controls: ReactNode }): JSX.Element;
  // arrangement-shelf.tsx
  export function ArrangementShelfTray(props: {
    lang: Lang; hidden: { id: string; title: string }[]; onRestore: (id: string) => void;
    dropProps: BlockDragProps; open: boolean; trayId: string;
  }): JSX.Element;   // ArrangementShelf (Reports) now = its toggle + this tray; DOM unchanged
  // dashboard-shelf.tsx
  export const DASHBOARD_SHELF_TRAY_ID = "dashboard-shelf-tray";
  export function DashboardShelf(props: {
    lang: Lang; hidden: { id: DashboardTileId; title: string }[]; onRestore: (id: DashboardTileId) => void;
    dropProps: TileDragProps; open: boolean;
  }): JSX.Element;   // the TRAY only (no toggle, no toggleRef)
  // dashboard-hidden-badge.tsx
  export function DashboardHiddenBadge(props: {
    lang: Lang; count: number; open: boolean; onOpenChange: (open: boolean) => void;
    isDragging: boolean; dropProps: TileDragProps; trayId: string; badgeRef?: Ref<HTMLButtonElement>;
  }): JSX.Element | null;   // null when count === 0 && !isDragging
  // i18n: dashboardHiddenTilesBadge "{0} hidden tiles" / DE "{0} ausgeblendete Kacheln";
  //       dashboardHiddenTilesBadgeOne "1 hidden tile" / DE "1 ausgeblendete Kachel". Rendered with tPlural.
  ```

**Rulings (brief items 5 and 6):**
- *Primitive:* the badge is `IconButton` `variant="bordered" size="md"` with no `className` — byte-for-byte the class string `ResetSizeButton` produces (pinned by a test), with the count as its child instead of an icon. It is a disclosure: `aria-expanded` + `aria-controls`, exactly as the current shelf toggle; never `aria-pressed`. No new primitive is invented, so there is no open question here.
- *Name:* "3 hidden tiles" / "1 hidden tile" through `tPlural` (a paired key must be — `i18n-plural.test.ts`); the visible text is the digit, contained in the name (WCAG 2.5.3).
- *Split:* the tray markup is extracted as `ArrangementShelfTray`; Reports' `ArrangementShelf` renders its unchanged toggle plus that tray, so its DOM and its tests are unchanged. The Dashboard stops using the combined shelf: `DashboardShelf` becomes the tray adapter and `DashboardHiddenBadge` is the toggle. One `open` state lives in the panel and drives both (`aria-expanded` and the tray's `hidden`), and the tray stays mounted whenever the surface is editable, so the `aria-controls` target exists.
- *Drop target:* the badge spreads the SAME `shelfDropProps` object the tray gets (one implementation), plus the existing drag-enter-opens-while-dragging behaviour.
- *Visibility:* the badge returns `null` at 0 unless a drag is in flight; the panel adds `!arrangement.readOnly` at its call site (the guard stays at each control's own site). The tray is shown only while open AND (count > 0 OR dragging), so it can never be left open with no control to close it.
- *Focus (spec gap ruled):* "Focus after Restore returns to the badge" cannot hold for the LAST hidden tile — the badge unmounts at 0. Restore focuses the badge while tiles remain hidden, and the restored tile's own ⋮ trigger when the tray empties. Hide focuses the badge. Both become post-commit requests through the effect the Move case already uses (generalised from `focusAfterMove` to `focusRequest`), because hiding the first tile MOUNTS the badge in the same commit — a synchronous `.focus()` would find nothing. `PopoverPanel`'s own restore runs in a passive cleanup, before this passive effect, so the badge wins.
- *Toolbar order:* Print · Reset layout · Reset size · badge, asserted with `expectButtonOrder(…, { contiguous: true })`. The badge key in that assertion is `dashboardHiddenTilesBadgeOne` (the helper substring-matches `t(lang, key)` with no args, so it must be a placeholder-free string; the test hides exactly one tile first).
- *Row 1:* the digest column is `lg:w-1/3` with `empty:hidden`, so a self-hidden digest (`DigestCard` returns `null`) leaves an empty slot that CSS removes and the delta strip's `flex-1` takes the width — no JS.

Breakage sweep (brief item 7): `grep -rn "arrangementShelfCount\|DashboardShelf\|toggleRef\|shelfToggleRef\|focusShelfToggle\|focusAfterMove\|dashboard-shelf-tray" src e2e docs/AGENTS --include=*.ts --include=*.tsx --include=*.md`:
- `dashboard-panel.test.tsx` "renders no grip, menu, shelf or reset in a popout" — MIGRATE (no badge in a popout, by name pattern).
- `dashboard-panel.test.tsx` "hides a tile from the ⋮ menu onto the shelf, announces it, and restores it" — MIGRATE (badge name).
- `dashboard-panel.test.tsx` "lands focus on the shelf disclosure after hiding…" — MIGRATE (badge).
- `dashboard-panel.test.tsx` "lands focus back on the shelf disclosure after restoring a tile" — MIGRATE (restoring the last tile → the tile's ⋮).
- `dashboard-panel.test.tsx` "ends the drag when a tile is dropped onto the shelf" and "leaves the tray open to a REAL drag…" — MIGRATE (the badge is the drop target; it shows as "0 hidden tiles" during the drag).
- `dashboard-panel.test.tsx` "drops a hidden tile from the shelf once its module gate goes off" — MIGRATE (at count 0 the badge is absent, not "0 hidden").
- `dashboard-panel.test.tsx` "orders the stack Print, Reset layout, Reset size" — MIGRATE (extended to four).
- `dashboard-grid.test.tsx` `describe("DashboardShelf", …)` (8 tests), its `HIDDEN`/`shelf()`/`toggle()` helpers and the `DashboardShelf` import — MIGRATE: moved to `dashboard-hidden-badge.test.tsx`, reworked for the badge + tray pair (the "still offers the disclosure when nothing is hidden" test becomes "absent at 0 unless dragging").
- `arrangement-shelf.test.tsx` — KEEP (Reports' combined shelf, DOM unchanged).
- `reports.tsx` `ArrangementShelf` usage — KEEP.
- `arrangementShelfCount` i18n key — KEEP (Reports still renders it).
- `docs/AGENTS/dashboard.md` shelf/toggle paragraphs — MIGRATE in Task 7.

- [ ] **Step 1: Add the two i18n keys**

`src/app/i18n.ts` (Edit tool) — replace `  arrangementResetLayout: "Reset layout",` with

```ts
  arrangementResetLayout: "Reset layout",
  // Spec C decision 2: the Dashboard's hidden-tiles badge. Its visible text is
  // the bare count; the name states it in words and contains the digit
  // (WCAG 2.5.3). A paired key — render it with `tPlural`, never `t`.
  dashboardHiddenTilesBadge: "{0} hidden tiles",
  dashboardHiddenTilesBadgeOne: "1 hidden tile",
```

For `src/app/i18n.de.ts`, save as `de-hidden-tiles-badge.mjs` in your scratchpad directory and run `node <that path>`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const p = "C:/Projects/aipm-cockpit/src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
if (s.includes("dashboardHiddenTilesBadge")) { console.log("ALREADY PRESENT"); process.exit(1); }
const anchor = "\r\n  arrangementTileMoved:";
const i = s.indexOf(anchor);
if (i < 0 || s.indexOf(anchor, i + 1) >= 0) { console.log("ANCHOR", i); process.exit(1); }
const insert =
  '\r\n  dashboardHiddenTilesBadge: "{0} ausgeblendete Kacheln",' +
  '\r\n  dashboardHiddenTilesBadgeOne: "1 ausgeblendete Kachel",';
s = s.slice(0, i) + insert + s.slice(i);
writeFileSync(p, s, "utf8");
console.log("bare LF count (must be 0):", (s.match(/(?<!\r)\n/g) || []).length);
```

It inserts directly after `arrangementResetLayout: "Anordnung zurücksetzen",` without touching that line. Verify:

```bash
git ls-files --eol src/app/i18n.de.ts                                    # expect i/lf w/crlf
grep -n "dashboardHiddenTilesBadge" src/app/i18n.ts src/app/i18n.de.ts   # expect two lines in each
grep -c "Anordnung zurücksetzen" src/app/i18n.de.ts                      # expect 1 (neighbour untouched)
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/dashboard-hidden-badge.test.tsx` (Write tool, then the CRLF normaliser):

```tsx
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DashboardHiddenBadge } from "./dashboard-hidden-badge";
import { DASHBOARD_SHELF_TRAY_ID, DashboardShelf } from "./dashboard-shelf";
import { ResetSizeButton } from "./task-manager-ui";
import { loadI18n, t, tPlural } from "./i18n";
import type { DashboardTileId } from "./dashboard-tiles";

/**
 * Moved from `dashboard-grid.test.tsx`'s `DashboardShelf` block (spec C split
 * the shelf's toggle from its tray). The harness wires the badge and the tray
 * exactly as `dashboard-panel.tsx` does: ONE open state, the badge in the
 * control stack, the tray elsewhere.
 */
const HIDDEN: { id: DashboardTileId; title: string }[] = [
  { id: "raid", title: "RAID register" },
  { id: "burn", title: "Budget burn" },
];

function Harness({
  hidden = HIDDEN, isDragging = false, onRestore = () => {},
}: {
  hidden?: { id: DashboardTileId; title: string }[];
  isDragging?: boolean;
  onRestore?: (id: DashboardTileId) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open && (hidden.length > 0 || isDragging);
  return (
    <>
      <ResetSizeButton onClick={() => {}} lang="en-US" />
      <DashboardHiddenBadge lang="en-US" count={hidden.length} open={shown} onOpenChange={setOpen}
        isDragging={isDragging} dropProps={{}} trayId={DASHBOARD_SHELF_TRAY_ID} />
      <DashboardShelf lang="en-US" hidden={hidden} onRestore={onRestore} dropProps={{}} open={shown} />
    </>
  );
}

const badge = (n: number) => screen.getByRole("button", { name: tPlural("en-US", "dashboardHiddenTilesBadge", n, n) });
const restoreButtons = () => screen.getAllByRole("button", { name: /restore/i });

beforeAll(async () => {
  await loadI18n("de");
});

describe("DashboardHiddenBadge — what it shows (spec C decision 2)", () => {
  it("shows the count and no words, and names the count in words", () => {
    render(<Harness />);
    expect(badge(2)).toHaveTextContent(/^2$/);
    expect(badge(2)).toHaveAccessibleName("2 hidden tiles");
  });

  it("contains its visible text in its accessible name (WCAG 2.5.3)", () => {
    render(<Harness />);
    const b = badge(2);
    expect(b).toHaveAccessibleName(expect.stringContaining(b.textContent ?? "\u0000"));
  });

  it("uses the singular for one hidden tile", () => {
    render(<Harness hidden={[HIDDEN[0]]} />);
    expect(screen.getByRole("button", { name: t("en-US", "dashboardHiddenTilesBadgeOne") })).toHaveTextContent(/^1$/);
  });

  it("reads German plural and singular with real stems", () => {
    const { unmount } = render(<DashboardHiddenBadge lang="de" count={3} open={false} onOpenChange={() => {}} isDragging={false} dropProps={{}} trayId="x" />);
    expect(screen.getByRole("button", { name: "3 ausgeblendete Kacheln" })).toBeInTheDocument();
    unmount();
    render(<DashboardHiddenBadge lang="de" count={1} open={false} onOpenChange={() => {}} isDragging={false} dropProps={{}} trayId="x" />);
    expect(screen.getByRole("button", { name: "1 ausgeblendete Kachel" })).toBeInTheDocument();
  });

  it("is the same box as Reset size — the same primitive, variant and size", () => {
    render(<Harness />);
    const resetSize = screen.getByRole("button", { name: t("en-US", "tableResetSizeHint") });
    expect(badge(2).className).toBe(resetSize.className);
  });

  it("is not rendered at a count of 0 — unless a tile is being dragged", () => {
    const { unmount } = render(<Harness hidden={[]} />);
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
    unmount();
    render(<Harness hidden={[]} isDragging />);
    fireEvent.click(badge(0));
    expect(screen.getByText("Nothing hidden")).toBeVisible();
  });
});

describe("DashboardHiddenBadge + tray — the disclosure", () => {
  it("toggles the tray on click", () => {
    render(<Harness />);
    expect(badge(2)).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(badge(2));
    expect(badge(2)).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(DASHBOARD_SHELF_TRAY_ID)).not.toHaveAttribute("hidden");
  });

  it("opens the tray when a drag enters the collapsed badge", () => {
    render(<Harness isDragging />);
    fireEvent.dragEnter(badge(2));
    expect(badge(2)).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves the tray shut when a pointer wanders in with nothing being dragged", () => {
    // ★★ Pins the `isDragging` guard; the test above passes either way alone.
    render(<Harness isDragging={false} />);
    fireEvent.dragEnter(badge(2));
    expect(badge(2)).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the aria-controls target mounted while collapsed", () => {
    render(<Harness />);
    const target = document.getElementById(badge(2).getAttribute("aria-controls")!);
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("hidden");
  });

  it("gives every Restore button a tile-unique accessible name", () => {
    render(<Harness />);
    fireEvent.click(badge(2));
    const names = restoreButtons().map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("restores a tile from the tray through a keyboard-reachable button", () => {
    const onRestore = vi.fn();
    render(<Harness onRestore={onRestore} />);
    fireEvent.click(badge(2));
    fireEvent.click(restoreButtons()[0]);
    expect(onRestore).toHaveBeenCalledWith("raid");
  });

  it("is a drop target through the SAME handlers the tray carries", () => {
    const onDrop = vi.fn();
    const onDragOver = vi.fn();
    render(<DashboardHiddenBadge lang="en-US" count={0} open={false} onOpenChange={() => {}} isDragging dropProps={{ onDrop, onDragOver }} trayId="x" />);
    fireEvent.dragOver(badge(0));
    fireEvent.drop(badge(0));
    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
```

`src/app/dashboard-grid.test.tsx` (MIGRATE — the block moved) — delete `import { DashboardShelf } from "./dashboard-shelf";`, and delete everything from `const HIDDEN: { id: DashboardTileId; title: string }[] = [` through the end of `describe("DashboardShelf", …)` (its closing `});`). If `DashboardTileId` or `fireEvent`/`vi` become unused in that file, remove them from its imports (lint will name them).

`src/app/dashboard-rows.test.tsx` — replace `import { DashboardStatusRow } from "./dashboard-rows";` with `import { DashboardStatusRow, DashboardTopRow } from "./dashboard-rows";` and append:

```tsx
describe("DashboardTopRow (spec C row 1)", () => {
  it("puts the digest beside the delta strip at about a third, with the controls on the far right", () => {
    render(<DashboardTopRow dc={dc} delta={<p>delta</p>} digest={<p>digest</p>} controls={<div data-testid="controls" />} />);
    const row = screen.getByTestId("dashboard-row-top");
    const slot = screen.getByTestId("dashboard-row-top-digest");
    expect(slot).toHaveTextContent("digest");
    expect(slot.className).toContain("lg:w-1/3");
    expect(row.lastElementChild).toBe(screen.getByTestId("controls"));
    expect(screen.getByText("delta").parentElement!.className).toContain("flex-1");
  });

  it("stacks the delta strip and the digest below lg", () => {
    render(<DashboardTopRow dc={dc} delta={<p>delta</p>} digest={<p>digest</p>} controls={<div />} />);
    const inner = screen.getByTestId("dashboard-row-top-digest").parentElement!;
    expect(inner.className).toContain("flex-col");
    expect(inner.className).toContain("lg:flex-row");
  });

  it("collapses the digest slot when the digest renders nothing, so the delta strip takes the width", () => {
    function NoDigest() { return null; }
    render(<DashboardTopRow dc={dc} delta={<p>delta</p>} digest={<NoDigest />} controls={<div />} />);
    const slot = screen.getByTestId("dashboard-row-top-digest");
    expect(slot.matches(":empty")).toBe(true);
    expect(slot.className).toContain("empty:hidden");
  });
});
```

`src/app/dashboard-panel-layout.test.tsx` — add `import { tPlural } from "./i18n";` beside the existing `t` import (change it to `import { t, tPlural } from "./i18n";`), add `import { fireEvent } from "@testing-library/react";` into the existing testing-library import (make it `import { fireEvent, render, screen, within } from "@testing-library/react";`), and append:

```tsx
const kebab = (title: string) => `${t(EN, "actionMoreActions")} – ${title}`;
const grip = (title: string) => `${t(EN, "reorderHandleDragOnly")} – ${title}`;
const badgeName = (n: number) => tPlural(EN, "dashboardHiddenTilesBadge", n, n);

async function hideFromMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: kebab(title) }));
  const menu = screen.getByRole("dialog", { name: kebab(title) });
  await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));
}

describe("DashboardPanel row 1, the badge and the tray (spec C)", () => {
  it("holds the delta strip, the digest slot and the control stack in row 1", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1" />, { wrapper });
    const row = screen.getByTestId("dashboard-row-top");
    expect(within(row).getByTestId("dashboard-row-top-digest")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t(EN, "printHint") })).toBeInTheDocument();
    expect(within(row).getByText(/Welcome/i)).toBeInTheDocument();
  });

  it("renders the tray under row 1 and above row 2", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1-tray" />, { wrapper });
    const tray = document.getElementById("dashboard-shelf-tray")!;
    expect(tray).not.toBeNull();
    expect(screen.getByTestId("dashboard-row-top").compareDocumentPosition(tray) & FOLLOWING).toBeTruthy();
    expect(tray.compareDocumentPosition(screen.getByTestId("dashboard-row-status")) & FOLLOWING).toBeTruthy();
  });

  it("shows no badge with nothing hidden, and a count badge once a tile is hidden", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-badge" />, { wrapper });
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
    await hideFromMenu(user, "Progress");
    expect(screen.getByRole("button", { name: badgeName(1) })).toHaveTextContent(/^1$/);
  });

  it("shows the badge while a tile is being dragged, even at a count of 0", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1-drag" />, { wrapper });
    fireEvent.dragStart(screen.getByRole("button", { name: grip("Progress") }));
    expect(screen.getByRole("button", { name: badgeName(0) })).toBeInTheDocument();
  });

  it("never renders the badge in a popout", async () => {
    // A tile hidden in the editable view, then the same project read-only.
    const user = userEvent.setup();
    const { unmount } = render(<DashboardPanel {...baseProps} projectId="p-row1-popout" />, { wrapper });
    await hideFromMenu(user, "Progress");
    unmount();                                                        // flushes the write
    render(<DashboardPanel {...baseProps} projectId="p-row1-popout" isPopout />, { wrapper });
    expect(screen.queryByTestId("tile-progress")).toBeNull();         // the hide was persisted
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
  });

  it("returns focus to the badge after a Restore that leaves tiles hidden", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-restore" />, { wrapper });
    await hideFromMenu(user, "Progress");
    await hideFromMenu(user, "Upcoming & overdue");
    await user.click(screen.getByRole("button", { name: badgeName(2) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Progress` }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: badgeName(1) }));
  });
});
```

`src/app/dashboard-panel.test.tsx` (MIGRATE):
- replace `import { t } from "./i18n";` with `import { t, tPlural } from "./i18n";`, and directly after the `const kebab = …` line add `const badgeName = (n: number) => tPlural(EN, "dashboardHiddenTilesBadge", n, n);`;
- in "renders no grip, menu, shelf or reset in a popout (read-only)" replace `    expect(screen.queryByRole("button", { name: t(EN, "arrangementShelfCount", 0) })).toBeNull();` with `    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();`;
- in "hides a tile from the ⋮ menu onto the shelf, announces it, and restores it" replace `    await user.click(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) }));` with `    await user.click(screen.getByRole("button", { name: badgeName(1) }));`;
- replace the title and the last two lines of "lands focus on the shelf disclosure after hiding, instead of dropping it on <body>":

```tsx
  it("lands focus on the shelf disclosure after hiding, instead of dropping it on <body>", async () => {
```
→
```tsx
  it("lands focus on the hidden-tiles badge after hiding, instead of dropping it on <body>", async () => {
```
and
```tsx
    const shelf = screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) });
    expect(document.activeElement).toBe(shelf);
```
→
```tsx
    // ★ Spec C: the badge MOUNTS in the commit this hide causes (it is absent at
    // 0), which is why the panel focuses it post-commit rather than inline.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: badgeName(1) }));
```
- replace the whole `it("lands focus back on the shelf disclosure after restoring a tile", …)` block with:

```tsx
  it("lands focus on the restored tile's ⋮ trigger when the restore empties the tray", async () => {
    // ★★ Spec C: the badge unmounts at a count of 0, so "focus returns to the
    // badge" cannot hold for the LAST hidden tile. The restored tile is now on
    // the board, and its own ⋮ is the route to act on it again.
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-restore-focus" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));

    await user.click(screen.getByRole("button", { name: badgeName(1) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Progress` }));
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: kebab("Progress") }));
  });
```

- in "ends the drag when a tile is dropped onto the shelf" replace

```tsx
    fireEvent.drop(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) }));
    expect(screen.queryByTestId("tile-progress")).toBeNull();     // the grip really did unmount

    const shelf = screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) });
```

with

```tsx
    // Spec C: the badge is the drop target; during a drag it shows even at 0.
    fireEvent.drop(screen.getByRole("button", { name: badgeName(0) }));
    expect(screen.queryByTestId("tile-progress")).toBeNull();     // the grip really did unmount

    const shelf = screen.getByRole("button", { name: badgeName(1) });
```

- in "leaves the tray open to a REAL drag, so the test above is not vacuous" replace `    const shelf = screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) });` with `    const shelf = screen.getByRole("button", { name: badgeName(0) });`;
- in "drops a hidden tile from the shelf once its module gate goes off" replace `    await user.click(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) }));` with `    await user.click(screen.getByRole("button", { name: badgeName(1) }));` and `    expect(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) })).toBeInTheDocument();` with `    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();   // spec C: absent at 0`;
- replace the whole `it("orders the stack Print, Reset layout, Reset size", …)` block with:

```tsx
  // ★ Spec C: the stack is Print · Reset layout · Reset size · hidden-tiles
  // badge. The badge only renders while a tile is hidden (or a drag is in
  // flight), so the three resets are asserted contiguous with it absent, then
  // all four with one tile hidden. `dashboardHiddenTilesBadgeOne` is the key
  // because `expectButtonOrder` substring-matches `t(lang, key)` with no args —
  // the singular carries no placeholder.
  it("orders the stack Print, Reset layout, Reset size, then the hidden-tiles badge", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-reset-order" />, { wrapper });
    expectButtonOrder(["printHint", "arrangementResetLayout", "tableResetSizeHint"], { contiguous: true });

    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));
    expectButtonOrder(
      ["printHint", "arrangementResetLayout", "tableResetSizeHint", "dashboardHiddenTilesBadgeOne"],
      { contiguous: true },
    );
  });
```

- [ ] **Step 3: Run them and watch them fail**

```bash
npx vitest run src/app/dashboard-hidden-badge.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/dashboard-panel.test.tsx src/app/dashboard-grid.test.tsx > /tmp/dlr-t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" /tmp/dlr-t6.log | head -30
```
Expected: EXIT=1 — the badge module, `DASHBOARD_SHELF_TRAY_ID` and `DashboardTopRow` do not exist; every migrated panel test fails on the badge name.

- [ ] **Step 4: Extract the tray**

`src/app/arrangement-shelf.tsx` — replace everything from the line `  const [open, setOpen] = useState(false);` (the first line of `ArrangementShelf`'s body) through the end of the file with the code below. Every comment and every line of chip markup in it is the existing text, moved, not rewritten:

```tsx
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 flex flex-col items-end print:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={trayId}
        onClick={() => setOpen((o) => !o)}
        onDragEnter={() => { if (isDragging) setOpen(true); }}
        {...dropProps}
        className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> {t(lang, "arrangementShelfCount", hidden.length)}
      </button>
      <ArrangementShelfTray lang={lang} hidden={hidden} onRestore={onRestore} dropProps={dropProps} open={open} trayId={trayId} />
    </div>
  );
}

/**
 * The shelf's TRAY on its own: the always-mounted, `hidden`-toggled list of
 * hidden blocks with their Restore buttons, and a drop target.
 *
 * ★★ EXTRACTED FOR SPEC C, WITH NO CHANGE TO ITS MARKUP. The Dashboard splits
 * the toggle from the tray (its badge sits in the control stack, the tray under
 * row 1); Reports keeps the combined `ArrangementShelf` above, which renders
 * this, so its DOM is byte-identical. `open` is controlled by whoever owns the
 * toggle, and the node stays mounted either way so `aria-controls` resolves.
 */
export function ArrangementShelfTray({
  lang, hidden, onRestore, dropProps, open, trayId,
}: {
  lang: Lang;
  hidden: { id: string; title: string }[];
  onRestore: (id: string) => void;
  /** The grid's own drop handlers — the tray never decodes the drag itself. */
  dropProps: BlockDragProps;
  open: boolean;
  /** The tray's DOM id — see `ArrangementShelf`'s `trayId` for why it is a prop. */
  trayId: string;
}) {
  const restore = t(lang, "arrangementTileRestore");
  /**
   * ★★★ THE SHELF IS THE LIST OWNER, SO THE TOKEN MAP IS BUILT HERE — the repo's
   * standing rule (`row-tokens.ts`, and AGENTS.md's "a per-item component cannot
   * disambiguate itself"). This is the difference between this component and
   * `arrangement-tile.tsx`: a tile sees one title and can only qualify with it,
   * while the shelf sees every chip at once and can number a genuine clash.
   *
   * ★★ ADDED HERE, NOT INHERITED — it is a DELIBERATE DEPARTURE from the plan's
   * "type change only". Before this, two hidden blocks sharing a title rendered
   * two controls both named "Restore – X", a WCAG 2.4.6 failure that axe cannot
   * see in any view at any seed size. It could not arise from the Dashboard
   * catalogue, whose labels are all distinct, so it was latent rather than live;
   * a second surface's catalogue is a new chance to hit it, and `hidden` is
   * caller-supplied so neither catalogue is a guarantee.
   * ★ It is also what makes a `requireCollisionSeed: true` test POSSIBLE at all:
   * that guard certifies disambiguation by the ` (N)` occurrence suffix, which
   * is precisely what `buildRowTokens` emits and what prefix-only qualification
   * cannot produce.
   * ★★ NO DASHBOARD OUTPUT CHANGES: a name unique within the map is used BARE,
   * and `rowLabel` renders the same `${verb} – ${token}` shape this file already
   * spelled by hand, so with distinct titles the emitted string is identical.
   *
   * ★★★ PRECONDITION — `hidden` MUST HOLD UNIQUE IDS. The map is keyed on
   * `h.id`, so two entries sharing an id collapse to ONE token and the second
   * chip reads the first's name: the exact collision this block exists to close,
   * reintroduced silently. The guard test cannot see it (its fixture uses
   * distinct ids), and neither can `requireCollisionSeed`. The same assumption
   * already rides the `key={h.id}` on the list item below, and neither the
   * Dashboard's nor Reports' catalogue can produce a duplicate — but `hidden` is
   * CALLER-supplied, and "the caller might hand us anything" is this block's own
   * argument for existing, so it is stated rather than assumed.
   */
  const tokens = useMemo(
    () => buildRowTokens(hidden.map((h) => ({ id: h.id, name: h.title }))),
    [hidden],
  );
  return (
    <div
      id={trayId}
      hidden={!open}
      {...dropProps}
      className="mt-1 w-full rounded-md border border-dashed border-line bg-surface-muted p-2"
    >
      {hidden.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">{t(lang, "arrangementShelfEmpty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {hidden.map((h) => (
            <li key={h.id} className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
              <span>{h.title}</span>
              {/* ★★ The block title is in the accessible name because N chips
                  render at once and N identical "Restore" buttons is a WCAG
                  2.4.6 failure the axe gate cannot see, in any view, at any
                  seed size.
                  ★★ THIS IS THE SURFACE THAT CAN CARRY A COLLISION-SEEDED
                  TEST, unlike `arrangement-tile.tsx`: the shelf renders the
                  LIST, so it sees its own siblings and a fixture can seed two
                  chips sharing a title.
                  ★ WCAG 2.5.3 holds by CONTAINMENT: the visible label
                  "Restore" is contained in "Restore – <block>".
                  ★★ The `?? h.title` fallback is UNREACHABLE and therefore
                  UNPINNED — do not read it as covered behaviour. The map is
                  built from this very list one hook call above, so every id
                  here is in it; no test exercises the right-hand side and none
                  can without breaking that invariant deliberately. It is kept
                  so the name degrades to the raw title rather than the string
                  "undefined" if a future change ever separates the two. */}
              <Button
                variant="ghost"
                size="xs"
                aria-label={rowLabel(restore, tokens.get(h.id) ?? h.title)}
                onClick={() => onRestore(h.id)}
                className="rounded-full border border-line"
              >
                {restore}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Diff check for this file: `git diff src/app/arrangement-shelf.tsx` must show `ArrangementShelf` losing its `restore`/`tokens` block and its inline tray `<div>`, gaining the `<ArrangementShelfTray …/>` line, and the new function — and NO change to any class string, attribute or comment text. The imports are unchanged (`useMemo`, `Button`, `buildRowTokens`, `rowLabel`, `FOCUS_RING`, `TRANSITION` are all still used).

`src/app/dashboard-shelf.tsx` — replace the whole file body below its header comment's closing ` */` with:

```tsx
import { ArrangementShelfTray } from "./arrangement-shelf";
import type { Lang } from "./i18n";
import type { TileDragProps } from "./dashboard-tile";
import type { DashboardTileId } from "./dashboard-tiles";

/** ★ UNCHANGED VALUE, exported since spec C: the badge's `aria-controls`
 *  (`dashboard-hidden-badge.tsx`) must name this same id. */
export const DASHBOARD_SHELF_TRAY_ID = "dashboard-shelf-tray";

/* ★★ SINCE SPEC C THIS BINDS THE TRAY ONLY. The toggle is the Dashboard's own
 * `DashboardHiddenBadge` in the control stack, and the panel owns the one `open`
 * state both read; Reports keeps the combined `ArrangementShelf`. The `onRestore`
 * cast is the adapter's job for the reason below. */
/* ★★ THE `onRestore` LAMBDA IS THE ADAPTER'S JOB AND IS DELIBERATELY VISIBLE.
 * The generic tray hands back a `string`, because it cannot know a surface's id
 * union; the Dashboard's handler wants a `DashboardTileId`, and under
 * `strictFunctionTypes` a `(id: DashboardTileId) => void` is NOT assignable to a
 * `(id: string) => void` parameter. The cast is safe: every id the tray can hand
 * back came out of the `hidden` array THIS component was given. */
export function DashboardShelf({
  lang, hidden, onRestore, dropProps, open,
}: {
  lang: Lang;
  hidden: { id: DashboardTileId; title: string }[];
  onRestore: (id: DashboardTileId) => void;
  /** The grid's own drop handlers — the tray never decodes the drag itself. */
  dropProps: TileDragProps;
  /** Controlled by the panel, which also drives the badge's `aria-expanded`. */
  open: boolean;
}) {
  return (
    <ArrangementShelfTray
      lang={lang}
      hidden={hidden}
      onRestore={(id) => onRestore(id as DashboardTileId)}
      dropProps={dropProps}
      open={open}
      trayId={DASHBOARD_SHELF_TRAY_ID}
    />
  );
}
```

and in that file's header comment replace

```tsx
 * ★ The exported name and props are UNCHANGED on purpose — `dashboard-panel.tsx`
 * and the Dashboard's own tests keep compiling and passing untouched. If a
 * Dashboard test needs editing to accommodate a change here, the change is
 * wrong.
```

with

```tsx
 * ★ SPEC C CHANGED THIS ADAPTER'S PROPS: the toggle, `isDragging` and the
 * focus ref left for `DashboardHiddenBadge`, and its tests moved to
 * `dashboard-hidden-badge.test.tsx`, which exercises the badge and this tray
 * together exactly as the panel wires them.
```

- [ ] **Step 5: The badge and row 1**

Create `src/app/dashboard-hidden-badge.tsx` (Write tool, then the CRLF normaliser):

```tsx
"use client";
/**
 * The Dashboard's hidden-tiles control (spec C decision 2): a count-only badge
 * in the control stack, directly under Reset size, that toggles the tray
 * rendered under row 1, and doubles as the drag-to-hide drop target.
 *
 * ★★ THE `IconButton` PRIMITIVE, `bordered`/`md`, NO `className` — so its box is
 * byte-for-byte `ResetSizeButton`'s (pinned). The count is its visible child;
 * the accessible name states the count in words and CONTAINS the digit
 * (WCAG 2.5.3). A paired key, so `tPlural`, never `t`.
 * ★★ A DISCLOSURE, NOT A TOGGLE BUTTON: `aria-expanded` + `aria-controls`
 * against the always-mounted tray, the repo's disclosure precedent. Never
 * `aria-pressed`.
 * ★ ABSENT AT A COUNT OF 0 — except while a tile is being dragged, because it
 * is the drop target and hiding the FIRST tile by drag needs somewhere to drop.
 * The popout guard (`arrangement.readOnly`) is at the panel's call site, like
 * every control in that stack.
 * ★ ONE DROP IMPLEMENTATION: `dropProps` is the very object the tray receives
 * (`shelfDropProps` in `dashboard-panel.tsx`); this spreads it, it does not
 * decode a drag itself.
 */
import type { Ref } from "react";
import { IconButton } from "./icon-button";
import { tPlural, type Lang } from "./i18n";
import type { TileDragProps } from "./dashboard-tile";

export interface DashboardHiddenBadgeProps {
  lang: Lang;
  /** Hidden tiles that could be restored (gated-off ones excluded by the panel). */
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDragging: boolean;
  dropProps: TileDragProps;
  /** The tray's id — `DASHBOARD_SHELF_TRAY_ID`. */
  trayId: string;
  /** Focus target after hide/restore (`dashboard-panel.tsx`'s focus request). */
  badgeRef?: Ref<HTMLButtonElement>;
}

export function DashboardHiddenBadge({
  lang, count, open, onOpenChange, isDragging, dropProps, trayId, badgeRef,
}: DashboardHiddenBadgeProps) {
  if (count === 0 && !isDragging) return null;
  const name = tPlural(lang, "dashboardHiddenTilesBadge", count, count);
  return (
    <IconButton
      ref={badgeRef}
      variant="bordered"
      size="md"
      label={name}
      title={name}
      aria-expanded={open}
      aria-controls={trayId}
      onClick={() => onOpenChange(!open)}
      // ★ Guarded on `isDragging`, so a stray dragEnter (a file dragged over
      // the window) cannot pop the tray open.
      onDragEnter={() => { if (isDragging) onOpenChange(true); }}
      {...dropProps}
    >
      <span className="inline-flex h-4 min-w-4 items-center justify-center text-xs font-semibold tabular-nums">
        {count}
      </span>
    </IconButton>
  );
}
```

`src/app/dashboard-rows.tsx` — directly before the `/**` doc comment of `DashboardStatusRow`, insert:

```tsx
/**
 * Row 1 (decision 1): "since you last looked" takes the free width, the weekly
 * digest sits beside it at about a third, and the control stack stays on the
 * far right. The delta strip and the digest stack below `lg`; the control stack
 * stays right at every width, as it always has.
 *
 * ★★ THE DIGEST SLOT IS `empty:hidden`. `DigestCard` renders `null` until the
 * digest is enabled and generated, which leaves this slot with no children; CSS
 * then removes it and the delta strip's `flex-1` takes the whole row. No JS
 * decides it, so nothing here can disagree with the digest's own rule.
 */
export function DashboardTopRow({
  dc, delta, digest, controls,
}: {
  dc: DensityClasses;
  delta: ReactNode;
  digest: ReactNode;
  controls: ReactNode;
}) {
  return (
    <div data-testid="dashboard-row-top" className="flex items-start gap-2">
      <div className={`flex min-w-0 flex-1 flex-col lg:flex-row lg:items-start ${dc.kpiGap}`}>
        <div className="min-w-0 flex-1">{delta}</div>
        <div data-testid="dashboard-row-top-digest" className="min-w-0 empty:hidden lg:w-1/3 lg:shrink-0">
          {digest}
        </div>
      </div>
      {controls}
    </div>
  );
}

```

- [ ] **Step 6: Rewire the panel**

`src/app/dashboard-panel.tsx`:

(a) imports: replace `import { DashboardShelf } from "./dashboard-shelf";` with

```tsx
import { DashboardShelf, DASHBOARD_SHELF_TRAY_ID } from "./dashboard-shelf";
import { DashboardHiddenBadge } from "./dashboard-hidden-badge";
```

and replace `import { DashboardStatusRow } from "./dashboard-rows";` with `import { DashboardStatusRow, DashboardTopRow } from "./dashboard-rows";`.

(b) replace the comment block that begins `  // ★★★ HIDING AND RESTORING BOTH DESTROY THE CONTROL THE USER JUST PRESSED, so` through the two lines

```tsx
  const shelfToggleRef = useRef<HTMLButtonElement | null>(null);
  const focusShelfToggle = () => shelfToggleRef.current?.focus();
```

with

```tsx
  // ★★★ HIDING AND RESTORING BOTH DESTROY THE CONTROL THE USER JUST PRESSED, so
  // one of them has to say where focus goes or the browser drops it on `<body>`.
  // Hide is pressed inside the ⋮ popover, which unmounts along with the tile it
  // was anchored to; Restore is pressed on a chip that the same click removes.
  // ★★ SPEC C: THE DESTINATION IS THE HIDDEN-TILES BADGE — and it is absent at a
  // count of 0, so hiding the FIRST tile MOUNTS it in the very commit the hide
  // causes. Focus is therefore a POST-COMMIT request (`focusRequest` below, the
  // same effect the Move case uses), never a synchronous `.focus()`, which would
  // find nothing. `PopoverPanel`'s own §297 restore runs in a passive CLEANUP,
  // before this passive effect, so the request wins; its anchor (the hidden
  // tile's ⋮) is detached by then anyway.
  // ★★ Restoring the LAST hidden tile empties the tray and unmounts the badge,
  // so that one case lands on the restored tile's own ⋮ trigger instead.
  const badgeRef = useRef<HTMLButtonElement | null>(null);
```

(c) replace

```tsx
  // ★ A fresh object per request, never a bare id: two consecutive moves of the
  // SAME tile must both re-run this, and `setState` with an equal id would not.
  const triggerRefs = useRef(new Map<DashboardTileId, HTMLButtonElement>());
  const [focusAfterMove, setFocusAfterMove] = useState<{ id: DashboardTileId } | null>(null);
  useEffect(() => {
    if (focusAfterMove === null) return;
    triggerRefs.current.get(focusAfterMove.id)?.focus();
  }, [focusAfterMove]);
```

with

```tsx
  // ★ A fresh object per request, never a bare id: two consecutive moves of the
  // SAME tile must both re-run this, and `setState` with an equal id would not.
  // ★ Spec C generalised it: a request names a tile's ⋮ trigger (Move, and a
  // Restore that empties the tray) or the hidden-tiles badge (Hide, Restore).
  const triggerRefs = useRef(new Map<DashboardTileId, HTMLButtonElement>());
  const [focusRequest, setFocusRequest] = useState<{ tile: DashboardTileId } | { badge: true } | null>(null);
  useEffect(() => {
    if (focusRequest === null) return;
    if ("tile" in focusRequest) triggerRefs.current.get(focusRequest.tile)?.focus();
    else badgeRef.current?.focus();
  }, [focusRequest]);
```

(d) in `moveByDelta` replace `    setFocusAfterMove({ id });` with `    setFocusRequest({ tile: id });`.

(e) directly after the closing `};` of the `shelfDropProps` declaration, insert:

```tsx
  // The tray's chips. ★★ Filtered by `isRenderable`, the SAME predicate the
  // board uses — the tray must never offer a tile restoring cannot bring back.
  // flatMap, not map + `!`: a stale id would otherwise throw on the title.
  const shelfHidden = layout.hidden.flatMap((id) => {
    const spec = tileById(id);
    return spec && isRenderable(id) ? [{ id, title: t(lang, spec.labelKey) }] : [];
  });
  // ★ Spec C: ONE open state drives the badge's `aria-expanded` and the tray's
  // `hidden`. The tray only SHOWS while there is something to show or a drag is
  // in flight — otherwise it could be left open with no badge to close it.
  const [trayOpen, setTrayOpen] = useState(false);
  const trayShown = trayOpen && (shelfHidden.length > 0 || reorder.isDragging);
  const restoreFromShelf = (id: DashboardTileId) => {
    arrangement.restore(id);
    setFocusRequest(shelfHidden.length > 1 ? { badge: true } : { tile: id });
  };
```

(f) replace the whole row-1 block — from the line `        {/* Landing: greeting + since-you-last-looked. The heading is removed; the` through the `        </div>` that closes `<div className="flex items-start gap-2">` (the line directly above the blank line before `{/* Row 2 (spec C`) — with:

```tsx
        {/* Row 1 (spec C decision 1): "since you last looked", the weekly digest
            beside it, and the control stack on the far right. */}
        <DashboardTopRow
          dc={dc}
          delta={
            <DashboardDeltaStrip
              lang={lang}
              delta={delta}
              greeting={greeting}
              onOpenTask={
                // onOpenTask opens a SPECIFIC task editor by id, so only wire it
                // when a representative task exists — otherwise the strip renders
                // the chip as a non-interactive span (no dead -1 click). RAID/
                // milestone/change handlers route to the VIEW (ignore the id), so
                // they stay wired unconditionally below.
                onOpenTask && repTaskId !== undefined ? () => onOpenTask(repTaskId) : undefined
              }
              onOpenRaid={onOpenRaid ? () => onOpenRaid(model.topRaid[0]?.id ?? -1) : undefined}
              onOpenMilestone={props.onOpenMilestone ? () => props.onOpenMilestone!(-1) : undefined}
              onOpenChange={props.onOpenChange ? () => props.onOpenChange!(-1) : undefined}
            />
          }
          digest={
            // Weekly status digest — self-hides until enabled (Settings) + generated;
            // its slot collapses then (`DashboardTopRow`).
            <DigestCardConnected
              lang={lang}
              dc={dc}
              model={model}
              raid={props.raid}
              projectId={props.projectId ?? "default"}
              isPopout={props.isPopout ?? false}
            />
          }
          controls={
            <div className="flex shrink-0 flex-col gap-2 print:hidden">
              <PrintButton lang={lang} />
              {/* ★★★ The `!arrangement.readOnly` guard is LOAD-BEARING and is not
                  inherited here: the stack itself is gated only on `print:hidden`.
                  Without it a popout — a surface with no grip, no ⋮ menu and no
                  tray by design — gains a working reset. */}
              {!arrangement.readOnly && (
                <ResetLayoutButton onClick={arrangement.reset} lang={lang} />
              )}
              <ResetSizeButton onClick={resetSize} lang={lang} />
              {/* Spec C decision 2: the hidden-tiles badge, directly under Reset
                  size; carries its own `readOnly` guard like Reset layout. */}
              {!arrangement.readOnly && (
                <DashboardHiddenBadge
                  lang={lang}
                  count={shelfHidden.length}
                  open={trayShown}
                  onOpenChange={setTrayOpen}
                  isDragging={reorder.isDragging}
                  dropProps={shelfDropProps}
                  trayId={DASHBOARD_SHELF_TRAY_ID}
                  badgeRef={badgeRef}
                />
              )}
            </div>
          }
        />

        {/* The hidden-tiles tray, directly under row 1 (spec C). The wrapper is
            `hidden` while the tray is shut, so the `space-y` flow gains no empty
            gap; the tray node itself stays mounted for `aria-controls`. */}
        {!arrangement.readOnly && (
          <div className="print:hidden" hidden={!trayShown}>
            <DashboardShelf
              lang={lang}
              hidden={shelfHidden}
              onRestore={restoreFromShelf}
              dropProps={shelfDropProps}
              open={trayShown}
            />
          </div>
        )}
```

(g) delete the old digest block:

```tsx
        {/* Weekly status digest — self-hides until enabled (Settings) + generated */}
        <DigestCardConnected
          lang={lang}
          dc={dc}
          model={model}
          raid={props.raid}
          projectId={props.projectId ?? "default"}
          isPopout={props.isPopout ?? false}
        />

```

(h) delete the old shelf block — from `        {/* Popout is READ-ONLY: no shelf, no menu (the reset is guarded at its` through its closing `        )}` (the `</div>` + `)}` after `<DashboardShelf … toggleRef={shelfToggleRef} />`).

(i) in the ⋮ menu's `onHide`, replace `                focusShelfToggle();` with `                setFocusRequest({ badge: true });`.

- [ ] **Step 7: Run the tests and the gates**

```bash
npx vitest run src/app/dashboard-hidden-badge.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/dashboard-panel.test.tsx src/app/dashboard-grid.test.tsx src/app/arrangement-shelf.test.tsx src/app/reports.test.tsx src/app/i18n.test.ts src/app/i18n-plural.test.ts src/app/i18n-encoding.test.ts > /tmp/dlr-t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/dlr-t6.log
npx tsc --noEmit > /tmp/dlr-tsc6.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc6.log
npx eslint --max-warnings=0 src/app/dashboard-hidden-badge.tsx src/app/dashboard-rows.tsx src/app/arrangement-shelf.tsx src/app/dashboard-shelf.tsx src/app/dashboard-panel.tsx src/app/i18n.ts src/app/dashboard-hidden-badge.test.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/dashboard-panel.test.tsx src/app/dashboard-grid.test.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/dashboard-panel.tsx','utf8').split('\n').length)"
file src/app/dashboard-hidden-badge.tsx src/app/dashboard-hidden-badge.test.tsx src/app/dashboard-rows.tsx src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx
```
Expected: EXIT=0 with `Test Files  10 passed (10)`; TSC_EXIT=0 and `0`; LINT_EXIT=0; `dashboard-panel.tsx` under 800 lines; every new file `… with CRLF line terminators`. `arrangement-shelf.test.tsx` and `reports.test.tsx` green prove the extraction left Reports unchanged.

- [ ] **Step 8: Mutation-check the badge's visibility rule and the focus request**

Mutant 1: in `dashboard-hidden-badge.tsx` delete the line `  if (count === 0 && !isDragging) return null;`. Re-run: EXIT=1 — "is not rendered at a count of 0…" and the panel's "shows no badge with nothing hidden…" fail. Revert; EXIT=0.
Mutant 2: in `restoreFromShelf` change `shelfHidden.length > 1 ? { badge: true } : { tile: id }` to `{ badge: true }`. Re-run: EXIT=1 — "lands focus on the restored tile's ⋮ trigger when the restore empties the tray" fails. Revert; EXIT=0. `git diff --stat` — exactly the 12 files of this task.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard-hidden-badge.tsx src/app/dashboard-hidden-badge.test.tsx src/app/dashboard-rows.tsx src/app/arrangement-shelf.tsx src/app/dashboard-shelf.tsx src/app/dashboard-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/dashboard-rows.test.tsx src/app/dashboard-panel-layout.test.tsx src/app/dashboard-panel.test.tsx src/app/dashboard-grid.test.tsx
git commit -F - <<'EOF'
feat(dashboard): put the digest in row 1 and turn hidden tiles into a count badge

Row 1 holds "since you last looked", the weekly digest at about a third
(its slot collapses when the digest self-hides) and the control stack,
which gains a count-only badge under Reset size: the IconButton box Reset
size uses, a disclosure for the hidden-tiles tray that now renders under
row 1, and the drag-to-hide drop target (the same handlers the tray has).
It is absent at 0 except during a drag and never shown in a popout. Focus
after hide goes to the badge; after a restore to the badge, or to the
restored tile when none remain. Reports keeps its combined shelf; its tray
is extracted without markup change.
EOF
```

---

## Task 7: Docs, browser geometry, axe and the Dashboard visual baseline

**Files:**
- Modify: `docs/AGENTS/dashboard.md`, `AGENTS.md`, `e2e/dashboard-grid.spec.ts`
- Regenerate: `e2e/visual.spec.ts-snapshots/dashboard-visual-win32.png`

**Interfaces:** consumes Tasks 1–6; produces nothing new.

- [ ] **Step 1: Extend the geometry spec for an 8-row tile**

`e2e/dashboard-grid.spec.ts` — inside `test.describe("dashboard grid geometry", …)`, directly after the test "applies the 80px comfortable row unit to the container AND to a real tile", add:

```ts
  test("emitted the Dashboard-only height utilities — an h:8 tile is eight row units tall", async ({ page }) => {
    // ★★ Spec C: `H_CLASS` gained literal `row-span-5`…`row-span-8`, and only
    // the rendered box can prove Tailwind emitted the rule — a missing one
    // would collapse the tile to one implicit row with every unit test green.
    // `burn` is 2×8 by default and first on a fresh board (this seed stores no
    // layout, so the default is what renders).
    const m = await gridMetrics(page);
    expect(m.autoRows).toBe("80px");
    const burn = await tileBox(page, "burn");
    expect(Math.abs(burn.height - (8 * 80 + 7 * m.rowGap))).toBeLessThan(1.5);
    // …and it is two of the four xl tracks wide.
    expect(Math.abs(burn.width - (m.contentWidth - m.colGap) / 2)).toBeLessThan(1.5);
  });
```

- [ ] **Step 2: Run the Dashboard e2e specs and the axe scans in ONE invocation**

```bash
npx playwright test e2e/dashboard-grid.spec.ts e2e/a11y.spec.ts e2e/seed-content.spec.ts --project=chromium -g "dashboard grid|Dashboard|Next actions|populated board" --workers=1 > /tmp/dlr-e1.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/dlr-e1.log
```
Expected: EXIT=0, and the log lists by name the new 8-row test, the Dashboard axe scan(s) and the "Next actions" axe scan (its panel now takes `groups`) as passed — a `-g` that matched nothing also exits 0, so read the names. A local timeout is contention (`--workers=1` is set), not a violation; a real violation names its axe rule. This is a superset of the brief's `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1`. If an axe rule fails on the badge, the tray or row 2, the fix belongs in Task 5 or 6's code — fix it there, re-run that task's gates, and commit it as its own `fix(dashboard): …` commit.

- [ ] **Step 3: Watch the Dashboard visual baseline change, and look at it**

```bash
npx playwright test --project=visual -g "visual: Dashboard" > /tmp/dlr-v1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dlr-v1.log
```
Expected: EXIT=1 with `dashboard.png` differing. Open the `*-actual.png` and `*-diff.png` the log names under `test-results/` (the Read tool shows images) and check by eye against the spec's Layout sketch at the 1440px viewport:
- row 1: delta strip across the free width, the control stack on the right — Print, Reset layout, Reset size (no badge: the seed hides nothing); no digest (the seed does not enable it), and no empty gap where it would be;
- no tray visible;
- row 2: the hero card (the seed produces a Now/Soon action) beside Overall status, the two the same height, the hero's CTAs unclipped;
- coaching/tip (if the seed shows them) below row 2, then the grid;
- the grid led by Budget burn, 2 columns × 8 rows, chart only (no headline, Spent, hours or index tiles), readable axis labels; the KPI tile carrying Effort SPI and Effort CPI in one row with the three others.

If any of that is wrong, stop: it is a defect in Tasks 3–6, not a baseline to refresh.

- [ ] **Step 4: Refresh the baseline deliberately, then prove the others did not move**

```bash
npx playwright test --project=visual -g "visual: Dashboard" --update-snapshots > /tmp/dlr-v2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/dlr-v2.log
npx playwright test --project=visual > /tmp/dlr-v3.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/dlr-v3.log
git status --porcelain e2e/visual.spec.ts-snapshots
```
Expected: both EXIT=0. The full visual run re-checks the Gantt, Open Points and both Reports baselines UNCHANGED (Reports' shelf DOM and catalogue are unchanged; a Reports diff is a defect). `git status` lists exactly `dashboard-visual-win32.png` as modified. Re-open the refreshed PNG once more before staging.

- [ ] **Step 5: Update `docs/AGENTS/dashboard.md`** (Edit tool; LF file)

(a) Replace

```
`dashboard-panel.tsx` stays a thin orchestrator (data derivation + the `computeDashboard` memo) and
renders three zones: a full-width HEADLINE (`DashboardDeltaStrip` · `NarrativeSummary` ·
`DashboardCoachingCard` · `DashboardTipCard` · `DigestCardConnected` · `DashboardHero`), whose
right-hand vertical control stack is `PrintButton` · `ResetLayoutButton` · `ResetSizeButton` → the
arrangeable tile grid (`DashboardGrid`, `DashboardShelf`) → a full-width
FOOTER (`NarrativeEditor`).
```

with

```
`dashboard-panel.tsx` stays a thin orchestrator (data derivation + the `computeDashboard` memo) and
renders, top to bottom (spec C; the two rows are presentational in `dashboard-rows.tsx`): ROW 1
(`DashboardTopRow`) — `DashboardDeltaStrip` in the free width, `DigestCardConnected` beside it at about
a third (its slot is `empty:hidden`, so a self-hidden digest hands the delta strip the whole row) and
the right-hand vertical control stack `PrintButton` · `ResetLayoutButton` · `ResetSizeButton` ·
`DashboardHiddenBadge`; the hidden-tiles TRAY (`DashboardShelf`) directly under row 1, shown only while
open; ROW 2 (`DashboardStatusRow`) — the Next-Actions `ActionHeroCard` beside `DashboardHero` (Overall
status), equal height by stretch, the hero absent when there is no Now/Soon group; then
`NarrativeSummary` · `DashboardCoachingCard` · `DashboardTipCard` → the arrangeable tile grid
(`DashboardGrid`) → a full-width FOOTER (`NarrativeEditor`). Both rows stack below `lg`.
```

(b) Directly after the paragraph ending `This sentence used to lump all five together, which is exactly the claim someone would build that skip
on.` insert a blank line and:

```
★★ **WIDTHS RUN 1–4 AND HEIGHTS 1–8, AS TWO TYPES (spec C).** `BlockWidth` (the four-column grid)
and `BlockHeight` replaced the one shared union, so an 8-wide block cannot type-check; `H_CLASS`
carries literal `row-span-5` … `row-span-8`. Only the Dashboard's catalogue reaches past 4 — `burn` is
`w:2 h:8`, FIRST in `DEFAULT_LAYOUT` — and Reports caps itself through its own `maxH`, pinned in
`report-blocks.test.ts`. The 8-row box is measured by `e2e/dashboard-grid.spec.ts`.

★★ **A STORED LAYOUT CARRIES AN OPTIONAL `upgrades` LIST, NOT A NEW VERSION (spec C).** `v` stays 1
(a bump is a lockstep decision across every surface — `arrangement-store.ts`). `useArrangement` takes
an optional `upgrade` that runs on a stored `ok` read BEFORE `reconcile`; a different object back marks
that read dirty, so the upgraded layout is written back once. The Dashboard passes
`upgradeDashboardLayout` (`dashboard-layout-upgrade.ts`), keyed on `DASHBOARD_BURN_UPGRADE`: Budget burn
to the front at 2×8 unless hidden, Completion trend's height clamped into 2–4, nothing else touched.
★★★ `DEFAULT_LAYOUT` already carries the id and must — a fresh or reset board is persisted from it,
and without the id its next load would drag burn back to the front. `readArrangement` sanitises the list
(junk is dropped, never a rejection) and `reconcile` carries it. ★ An older build's `reconcile` drops the
list, so a layout it rewrites is upgraded once more — accepted in the spec.
```

(c) Replace the line `is what per-axis resize is for. Measure comfortable before calling anything a regression.` (it ends the "DO NOT READ A SCROLLBAR ON A COMPACT TILE" paragraph) with

```
is what per-axis resize is for. Measure comfortable before calling anything a regression. ★ Those
numbers predate spec C, which made `burn` chart-only at h:8 — re-measure before quoting them.
```

(d) Replace the two paragraphs starting `★ **The `burn` tile's content (forecast figures union, MR 2):**` and `★ **The `burn` tile's chart and hours signal (MR 3):**` (through `body scrolls inside the tile at `h: 3` as before.`) with:

```
★★ **The `burn` tile is CHART-ONLY (spec C decision 7).** Its body is the compact
`BurndownChartPanel` (the component the Budget report mounts, with the device settings
`budgetChartView` / `budgetChartUnit`) headed by `BurndownChainWarning`, or `dashboardNoBudget` with no
burn-down series. The forecast headline, the Spent and hours tiles, the FX rollup notice, the caption
and the Effort SPI/CPI tiles all left it; `ForecastHeadline` (`budget-forecast-headline.tsx`) is now
DELETED — its only production caller was this tile's headline — along with its test and four i18n keys
(`forecastTileActuals`, `forecastTileRange`, `forecastTileSingle`, `forecastTileRunsOut`) that had no
other reader.
★★ Effort SPI and Effort CPI moved into the KPI tile (`DashboardKpiStrip`), keeping `evmSpi`/`evmCpi`
and their hints: they are the only figures on the dashboard that explain a Schedule or Budget badge gone
amber on the index alone. Neither is gated on the Budget module — `showSpi`/`showCpi` inside the strip
key on `model.evm.spi`/`model.evm.cpi` alone, never `showBudget` — because SPI feeds the Schedule RAG
unconditionally and CPI feeds the Budget RAG, which reaches the dashboard's own delta-strip flip badges,
the AI `get_dashboard_snapshot` tool, Trends' persisted `budgetRag` and the Portfolio health table with
the Budget module off, none of them gated either. That RAG comes from the MODEL —
`evmIndexHealth(evm.spi)` into Schedule, `evmIndexHealth(evm.cpi)` into Budget (`dashboard.ts`) — never
from a tile, and a characterization test in `dashboard-panel.test.tsx` pins that moving the tiles moved
no badge. `dashboard.ts`'s `budgetComputed` still reads the budget RAG from `paceVacHealth` once the pace
forecast exists and falls back to `computeBudgetStatus`; Trends' persisted `budgetRag` reads the same
`model.budget.effective`.
```

(e) In the §549 paragraph replace

```
The tile is too narrow to have carried the table anyway: at its DEFAULT width (`w: 1`) it is half the pane at
`lg`'s 2-column grid and a quarter at `xl`'s 4-column grid (`arrangement-grid.tsx`), though a user may widen it up to
`maxW: 2` (`dashboard-tiles.ts`), which is full pane width at `lg` (`col-span-2` there spans both columns) — and the
```

with

```
The tile is too narrow to have carried the table anyway: at its DEFAULT width (`w: 2`, spec C) it is full pane width
at `lg`'s 2-column grid and half at `xl`'s 4-column grid (`arrangement-grid.tsx`), and a user may widen it to
`maxW: 4` (`dashboard-tiles.ts`) — and the
```

(f) In the "HIDE→RESTORE DISCARDS A RESIZE" paragraph replace the line

```
who widens `burn` to w:2, hides it and restores it gets w:1 back. `dashboard-layout.test.ts` pins this
```

with

```
who narrows `burn` to w:1, hides it and restores it gets its catalogue 2×8 back. `dashboard-layout.test.ts` pins this
```

(g) Replace

```
• **Hide** → the shelf disclosure. The ⋮ trigger it was anchored to goes with the tile, and the shelf is
  where the tile now lives. `DashboardShelf` takes a `toggleRef` for it — the one node in that subtree
  that never unmounts.
• **Restore** → the shelf disclosure again. The chip's own Restore button is removed by the click that
  restores, and the remaining chips shift, so the chip list is the wrong target in both directions.
```

with

```
• **Hide** → the hidden-tiles badge (`DashboardHiddenBadge`, spec C). The ⋮ trigger it was anchored to
  goes with the tile, and the badge is the route back. ★★ It is a POST-COMMIT focus request (the same
  effect as Move below), never a synchronous `.focus()`: the badge is absent at a count of 0, so hiding
  the FIRST tile MOUNTS it in the very commit the hide causes.
• **Restore** → the badge again while tiles remain hidden; the restored tile's own ⋮ trigger when the
  restore empties the tray, because the badge unmounts at 0. The chip's own Restore button is removed by
  the click that restores and the remaining chips shift, so the chip list is the wrong target.
```

(h) Replace

```
`DashboardTileMenu` / `TileAxisGroup` / `DashboardShelf` as thin bindings, so every claim below is still
```

with

```
`DashboardTileMenu` / `TileAxisGroup` / `DashboardShelf` as thin bindings (★ since spec C `DashboardShelf`
binds only the TRAY, `ArrangementShelfTray`; the toggle is the Dashboard's own `DashboardHiddenBadge`,
while Reports keeps the combined `ArrangementShelf`), so every claim below is still
```

(i) Replace

```
- `dashboard-sections/dashboard-kpi-strip.tsx` (`DashboardKpiStrip`) — the 3 "at a glance" KPI tiles
  (complete % · overdue · open RAID; overdue and open-RAID always carry a `TrendArrow`, completion
```

with

```
- `dashboard-sections/dashboard-kpi-strip.tsx` (`DashboardKpiStrip`) — the "at a glance" KPI tiles
  (complete % · overdue · open RAID, plus Effort SPI · Effort CPI whenever `model.evm.spi`/
  `model.evm.cpi` is non-null — spec C, independent of the Budget module; overdue and open-RAID
  always carry a `TrendArrow`, completion
```

(j) Replace

```
and a user can move it anywhere or hide it. Nothing in the headline zone is ranked any more. Dashboard
```

with

```
and a user can move it anywhere or hide it. ★ Since spec C row 2 carries the Next-Actions HERO
(`pickHeroGroup`, the rule the Next-actions page uses) beside Overall status — the one ranked item above
the grid; the Top-actions tile keeps listing that action too, by decision, and the hero's CTA names carry
a section segment so the two never collide. Dashboard
```

- [ ] **Step 6: Update `AGENTS.md`** (Edit tool; LF, always loaded — three minimal edits)

(a) In the "Action-Center grouping (slice 1)" bullet replace

```
  so snooze-only ids never merge; `primary`=max-score, `extra`=rest, group `score`/`tier`=primary's). `computeNextActions`
  stays FLAT — grouping is SURFACE-ONLY; learning/notifications/AI keep the flat list. `actions-panel.tsx` caps Now/Soon
```

with

```
  so snooze-only ids never merge; `primary`=max-score, `extra`=rest, group `score`/`tier`=primary's). `computeNextActions`
  stays FLAT — grouping is SURFACE-ONLY; learning/notifications/AI keep the flat list. ★ It runs ONCE, in
  `task-manager.tsx` (`nextActionGroups`), which `ActionsPanel` renders and the Dashboard takes its hero and Top-actions
  primaries from (spec C). `actions-panel.tsx` caps Now/Soon
```

(b) Replace `  hero. Hero = `groups[0]`, shown only when `tier!=="monitor"`, DE-DUPED from its tier list (`g.key!==heroKey`).` with `  hero. Hero = `pickHeroGroup(groups)` (`groups[0]`, only when `tier!=="monitor"` — the Dashboard's row 2 calls the same helper), DE-DUPED from its tier list (`g.key!==heroKey`).`

(c) In the Toolbar-order bullet, directly after the line `  read-only by design and would otherwise gain a working reset.` insert:

```
  ★★ SINCE SPEC C THE DASHBOARD'S STACK ENDS WITH A FOURTH CONTROL AFTER THE GROUP — `DashboardHiddenBadge`, the
  hidden-tiles count that toggles the tray under row 1: Print · reset-layout · reset-size · badge. It is the one
  deliberate exception to "ends with the trailing group": it is the arrangement's disclosure and drop target, not a
  utility, and it renders only while a tile is hidden or a drag is in flight, so the three resets stay contiguous with
  or without it. Pinned by the same `contiguous: true` assertion, once without the badge and once with it.
```

- [ ] **Step 7: Run the doc gates and the cheap repo gates**

```bash
npm run docs:symbols:check > /tmp/dlr-ds.log 2>&1; echo "DOCS_SYM_EXIT=$?"; tail -5 /tmp/dlr-ds.log
npm run docs:claims:check > /tmp/dlr-dc.log 2>&1; echo "DOCS_CLAIM_EXIT=$?"; tail -5 /tmp/dlr-dc.log
npm run size:check > /tmp/dlr-size.log 2>&1; echo "SIZE_EXIT=$?"; tail -3 /tmp/dlr-size.log
npm run dup:check > /tmp/dlr-dup.log 2>&1; echo "DUP_EXIT=$?"; tail -3 /tmp/dlr-dup.log
npx eslint --max-warnings=0 e2e/dashboard-grid.spec.ts; echo "LINT_EXIT=$?"
npx tsc --noEmit > /tmp/dlr-tsc7.log 2>&1; echo "TSC_EXIT=$?"; grep -c "error TS" /tmp/dlr-tsc7.log
```
Expected: every EXIT=0 and `0`. `docs:symbols:check` proves every backticked mixed-case name added to the two docs exists (`DashboardHiddenBadge`, `DashboardTopRow`, `DashboardStatusRow`, `ArrangementShelfTray`, `upgradeDashboardLayout`, `pickHeroGroup`, `nextActionGroups`, `BlockWidth`, `BlockHeight`, `showSpi`, `showCpi`, …) — it proves the NAMES, never the claims, so re-read each edited sentence against the code once. The whole-repo unit gates (`npm run test:run`, `test:shuffle`, `test:coverage`) are deliberately NOT run — the user runs them at the end.

- [ ] **Step 8: Confirm the tree, then commit**

```bash
git status --porcelain
git diff --stat
```
Expected: `not-in-use.env.local.bak` untracked (never opened or staged); modified exactly `AGENTS.md`, `docs/AGENTS/dashboard.md`, `e2e/dashboard-grid.spec.ts` and `e2e/visual.spec.ts-snapshots/dashboard-visual-win32.png`.

```bash
git add AGENTS.md docs/AGENTS/dashboard.md e2e/dashboard-grid.spec.ts e2e/visual.spec.ts-snapshots/dashboard-visual-win32.png
git commit -F - <<'EOF'
docs(dashboard): record the spec C layout, and measure the 8-row tile

The Dashboard doc now describes rows 1 and 2, the badge and tray split,
the 1-8 height range, the optional upgrades list and the chart-only burn
tile; AGENTS.md records the single grouping, the shared hero rule and the
badge after the toolbar's trailing group. The grid geometry spec measures
an 8-row tile at the 80px unit, and the Dashboard visual baseline is
refreshed after an eye check; the other baselines were re-run unchanged.
EOF
```

- [ ] **Step 9: Report**

Quote every EXIT above, the Test Files counts from Tasks 1–6, each mutation's outcome, and the eye-check notes for the Dashboard PNG. Do not push, tag or open a merge request — those wait for an explicit instruction.

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Decision 1 — row 1: delta free width, digest ~⅓, controls far right; digest self-hides → delta full width; stacks below `lg` | Task 6 (`DashboardTopRow`, `empty:hidden`; row tests + panel test) |
| Decision 2 — badge: under Reset size, same size, count only, name with count, toggles tray, tray under row 1, absent at 0 except while dragging, never in popout, reuses drop wiring, tray keeps its own drop target | Task 6 (badge + tray split; badge, panel and toolbar tests; mutation 1) |
| Decision 3 — row 2: hero left, Overall status right, equal height, stacks below `lg`, no hero → status full row | Task 5 (`DashboardStatusRow`; row + panel tests) |
| Decision 4 — same `ActionHeroCard`, same grouped data, same bundle, none in popout; grouping once beside `computeNextActions`; threaded task-manager → workspace-section → dashboard-panel; tile stays flat | Task 5 (`nextActionGroups`, `pickHeroGroup`, `actionHandlers`; parity + threading + popout tests; grep proof of one call) |
| Decision 5 — Top actions tile keeps showing the hero's action | Task 5 ("keeps the hero's action in the Top actions tile too…") |
| Decision 6 — order after row 2: narrative → coaching → tip → grid | Task 5 (row 2 moved above narrative; order test), Task 6 (digest leaves that run) |
| Decision 7 — burn chart-only, 2×8 default, 1–4 × 4–8, first in `DEFAULT_LAYOUT` | Task 3 (catalogue, default), Task 4 (body; chart-only tests) |
| Decision 8 — Effort SPI/CPI into KPI tile, same labels and hints, no computation change, each shown whenever it can move a visible value regardless of the Budget module | Task 4 (model-keyed `showSpi`/`showCpi`; KPI tests; characterization test) |
| Decision 9 — Completion trend `h:2 minH:2 maxH:4` | Task 3 |
| Decision 10 — width/height types split; `H_CLASS` 5–8 literal; `W_CLASS` untouched; Reports max 4 via its catalogue | Task 1 (+ Reports cap tests; literal-class test) |
| Decision 11 — `upgrades` list at `v: 1`, one-time upgrade, validator sanitises, `reconcile` carries | Task 2 (engine, store, hook), Task 3 (Dashboard upgrade + default + wiring) |
| Components — `dashboard-hidden-badge.tsx`, `dashboard-shelf.tsx` split, `dashboard-layout-upgrade.ts`, `dashboard-tile-bodies.tsx`, i18n, `docs/AGENTS/dashboard.md` | Tasks 3, 4, 6, 7 |
| Accessibility — badge is a real button, name states count, contains visible number | Task 6 (label-in-name + singular/plural + DE tests) |
| Accessibility — tray always mounted, `hidden`-toggled | Task 6 ("keeps the aria-controls target mounted while collapsed") |
| Accessibility — row 2 equal height by stretch, no pixel height | Task 5 (row test: no `h-[`, grid cells, `lg:items-stretch`) |
| Accessibility — hero CTAs keep their names; hero vs tile names do not collide | Task 5 (section-segment token; collision test + mutation 2) — see ruling 6 |
| Accessibility — `RagBadge` `aria-hidden` wrapper in `milestone-horizon-strip.tsx` | No change needed: verified present on both chip branches; no task touches that file |
| Accessibility — duplicate names, colour-only state, label-in-name pinned by unit tests | Tasks 5–6 (names, label-in-name); the badge is text, not colour, so no colour-only state exists |
| Testing — `dashboard-layout-upgrade.test.ts` (all seven bullets) | Task 3 |
| Testing — store/engine: with/without `upgrades`, junk sanitised, `reconcile` preserves, Reports never upgraded | Task 2 |
| Testing — span: 5–8 literal classes, Reports refuses >4 | Task 1 |
| Testing — actions-panel fed grouped data; same hero on both surfaces | Task 5 |
| Testing — `dashboard-panel.test.tsx` rows, badge, tray, focus, row 2, tile, toolbar order | Tasks 5–6 (split between `dashboard-panel.test.tsx` and the new `dashboard-panel-layout.test.tsx`, which keeps the 1595-line file from growing) |
| Testing — `dashboard-tile-bodies.test.tsx` burn/KPI bodies | Task 4 (in `dashboard-panel.test.tsx` and `dashboard-kpi-strip.test.tsx` — ruling 8) |
| Testing — "no health input changed" | Task 4 (characterization test, green before and after) |
| Testing — `e2e/dashboard-grid.spec.ts` 8-row height at 80px | Task 7 Step 1 |
| Testing — axe scan of the dashboard | Task 7 Step 2 (plus Next actions) |
| Testing — `dashboard-visual` refreshed deliberately, eyeballed | Task 7 Steps 3–4 |
| Out of scope — scoring/grouping/providers, EVM/forecast/health, Reports layout, tip/coaching/narrative contents | No task touches `next-actions/providers`, `group.ts`'s grouping function, `dashboard.ts`, `evm.ts`, the budget engines, `report-blocks.ts`'s catalogue, or those cards |

**Placeholders:** none of "TBD"/"similar to Task N"; every code step carries its code and every run step its command and expected result. A few long deletions/replacements are specified by an exact start line and an exact end line rather than by quoting the whole old block (Task 4 Step 1(c), (g) and Step 5(e) and Step 5(g); Task 6 Step 6(b), (f) and (h)); the implementer reads the file and selects between those two lines, and the replacement text is given in full.

**Type consistency:** `BlockWidth`/`BlockHeight`/`TileWidth`/`TileHeight` (Task 1) are the names Tasks 3 and 6 use. `upgrades?: readonly string[]` and `upgrade?:` (Task 2) are what Task 3's `DEFAULT_LAYOUT`, `upgradeDashboardLayout` and `use-dashboard-layout.ts` use. `DASHBOARD_BURN_UPGRADE = "dashboard-burn-2x8"` is the literal the Task 3 tests assert. `pickHeroGroup`, `topGroupPrimaries(groups, n)`, `nextActionGroups`, `heroGroup`, `actionHandlers`, `expertMode` (Task 5) are the names `workspace-section.tsx`, `dashboard-panel.tsx` and their tests use. `DashboardStatusRow` (Task 5) and `DashboardTopRow` (Task 6) share `dashboard-rows.tsx`. `DASHBOARD_SHELF_TRAY_ID`, `DashboardShelf`'s `open` prop, `ArrangementShelfTray` and `DashboardHiddenBadge`'s props (Task 6) match the harness and the panel. `dashboardHiddenTilesBadge`/`…One` (Task 6 Step 1) are the keys the badge renders through `tPlural` and the toolbar-order test reads.

**Rulings made, with the cost of each if wrong:**
1. *`upgrades` sanitised in `readArrangement`, ignored by `isArrangementLayout`* — if wrong (someone wants junk rejected), a junk list would reset a whole arrangement instead of re-running an idempotent upgrade; reversing it is a two-line change in the store.
2. *The upgrade runs before `reconcile`, literal 2×8, on `ok` reads only* — if the spec meant after, the only observable difference is for a stored `burn` with an out-of-range span, which `reconcile` clamps either way; no data loss.
3. *An upgraded read starts dirty (reference-inequality of the upgrade's own output)* — if an upgrade ever copies unconditionally it would rewrite storage on every load; the contract is documented on the option and pinned by "writes nothing when the upgrade has nothing to do".
4. *`DEFAULT_LAYOUT` carries the upgrade id* — without it a reset board would be re-upgraded on its next load (burn dragged back to the front); pinned by mutation 2 of Task 3.
5. *Width and height are separate types with no `BlockSpan` alias left behind* — cost if wrong: none at runtime; a larger diff than an alias, paid once.
6. *Hero CTA names get a section segment on the Dashboard only* ("Open – Do this first – <title>") — **RESOLVED, confirmed by the user (Option A):** the spec says the hero keeps its Next-actions names AND must not collide with the tile; both cannot hold, because the tile's tokens are unique only within the tile, so the Dashboard hero alone carries the section-segment token. Cost if the user had preferred the alternative instead (qualifying the TILE's names): a larger diff, since the tile's pinned names and tests would change instead of the hero's.
7. *Grouping lifted to `task-manager.tsx`; `topGroupPrimaries` takes groups; `ActionsPanel` takes `groups` (its tests migrate through one wrapper)* — cost if wrong: one more prop contract change on `ActionsPanel`; no behaviour change (same function, same list).
8. *Burn/KPI body tests live in `dashboard-panel.test.tsx` and `dashboard-kpi-strip.test.tsx`, not a new `dashboard-tile-bodies.test.tsx`* — cost: the spec's file name does not exist; the assertions it lists are all present.
9. *SPI/CPI in the KPI tile are each shown whenever its own `model.evm` field is non-null, independent of the Budget module* — **RESOLVED, confirmed by the user** ("hiding something which affects a value is not acceptable"): SPI always feeds the Schedule RAG, and CPI's Budget RAG also reaches the dashboard's own delta-strip flip badges, the AI snapshot tool, Trends and the Portfolio health table with Budget off (see the SPI/CPI visibility ruling in Task 4). Both tiles are absent only with no estimates. Cost if the user had preferred keeping today's `showBudget`-gated behaviour instead: a one-condition change (`&& showBudget`) plus reverting the migrated test.
10. *The burn caption and the "No task estimates yet." line leave the dashboard; three i18n keys are deleted* — cost if wrong: re-adding a caption means a new, accurate string (the old one described figures that left).
11. *Hero handlers are dropped entirely in a popout*, including the two `task-manager.tsx` does not gate — stricter than `ActionsPanel` in a popout; cost if wrong: a popout hero offers no snooze.
12. *Restoring the LAST hidden tile focuses that tile's ⋮ trigger, not the badge* — forced: the badge unmounts at 0. Cost if wrong: none for a sighted user; a screen-reader user lands on the tile they just brought back.
13. *The tray is shown only while open AND (count > 0 OR dragging)* — prevents an open tray with no badge to close it; cost: a tray open when the last tile is restored closes itself.
14. *`expectButtonOrder` uses the singular key* — the helper cannot match a `{0}` placeholder; cost if the helper later gains args support: none, the test still holds.
15. *`ForecastHeadline` and its test are deleted in Task 4* — **RESOLVED, confirmed by the user:** its only production caller left with the burn tile's Spent/hours figures. Cost if wrong (some caller still needed it): none found by Task 4's breakage sweep (`grep -rn "ForecastHeadline\|budget-forecast-headline" src e2e docs/AGENTS AGENTS.md`), and its EAC-range-ordering idea was never shared with `budget-forecast-link.tsx`'s own formatter — reverting to "stays orphaned" is a two-file `git checkout` away.
