# Dashboard Tile Arrangement Implementation Plan (Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Dashboard's fixed masonry flow into a user-arrangeable 4-column grid — drag to reorder, set each tile's width and height independently, hide tiles onto a shelf, all persisted per device and per project.

**Architecture:** Order alone is the placement model — `grid-auto-flow: row dense` resolves an ordered list into cells, so the engine is array operations with no coordinate maths. A pure catalogue declares each tile's defaults and limits; a pure engine owns reorder/hide/restore/resize/reconcile; a per-project localStorage store persists it; React pieces render the grid, the tile chrome, the two-axis size menu and the shelf. Drag comes from the Phase A primitive.

**Tech Stack:** TypeScript, React 19, Next 16, Tailwind v4, vitest + React Testing Library, Playwright, native HTML5 drag-and-drop.

**Spec:** `docs/superpowers/specs/2026-08-14-dashboard-tile-reorder-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-14-list-reorder-primitive.md` (Phase A) — `useListReorderDnd` must exist before Task 8.

---

## Before you start

Read, in this order:

1. `AGENTS.md` — especially the Commands section. **Never read a gate's exit code through a pipe.** `npm run lint` does not reproduce the CI gate; use `npx eslint --max-warnings=0 src/app`.
2. `docs/AGENTS/dashboard.md` — the subsystem file. It describes the masonry this replaces and every card in it.
3. `docs/AGENTS/ui-shell.md` — **before Task 9.** It owns the Escape/Tab dismissal protocol that the ⋮ menu must follow.

**Five constraints that will cost you a rebuild if you miss them:**

- **Tailwind v4 scans source for class candidates.** An interpolated `col-span-${w}` emits no CSS at all. Every span class must be a literal string in a lookup record.
- **Spacing must use a `dc.*` density class**, never a literal `gap-*`/`p-*`/`mb-*`. A literal ignores compact mode.
- **jsdom has no layout engine.** No unit test can verify column count, dense packing or the clamp. Tests assert *which classes are applied*; the Playwright check in Task 14 is the only real measurement.
- **Dashboard is in `A11Y_VIEWS`.** This adds two controls per tile, and **axe cannot detect duplicate accessible names at any seed size.** Unique names must be written at the source and pinned by a unit test rendering ≥2 tiles.
- **`i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts.** Patch it with a node utf8 write using `\r\n` anchors, then verify.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/dashboard-tiles.ts` | create | Tile catalogue — id, label key, default `w`/`h`, `minW/maxW/minH/maxH`, module gate |
| `src/app/dashboard-tiles.test.ts` | create | Catalogue invariants |
| `src/app/dashboard-layout.ts` | create | Pure engine — reorder, hide, restore, resize, reconcile, defaults |
| `src/app/dashboard-layout.test.ts` | create | Engine unit tests |
| `src/app/dashboard-layout.property.test.ts` | create | fast-check properties for `reconcile` |
| `src/app/dashboard-layout-store.ts` | create | Per-project localStorage map, validated, capped |
| `src/app/dashboard-layout-store.test.ts` | create | Store tests |
| `src/app/use-dashboard-layout.ts` | create | Load → reconcile → apply, debounced persist, reset, popout read-only |
| `src/app/use-dashboard-layout.test.tsx` | create | Hook tests |
| `src/app/dashboard-grid.tsx` | create | Grid container, span classes, scroller ref |
| `src/app/dashboard-tile.tsx` | create | Tile chrome — grip, title, ⋮ button |
| `src/app/dashboard-tile-menu.tsx` | create | Width/Height radio groups, move commands, Hide |
| `src/app/dashboard-shelf.tsx` | create | "N hidden" disclosure, tray, drop target |
| `src/app/dashboard-grid.test.tsx` | create | Grid + tile + menu + shelf component tests |
| `src/app/dashboard-density.ts` | modify | Add the `tileRow` key |
| `src/app/dashboard-panel.tsx` | modify | Replace the masonry flow with `DashboardGrid` |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | modify | New strings, EN + DE |
| `e2e/dashboard-grid.spec.ts` | create | The geometry measurement jsdom cannot do |

Before creating each `.ts`, confirm no `.tsx` sibling exists — a bare `./name` import resolves `.ts` first and would hijack a component.

---

### Task 1: Tile catalogue

**Files:**
- Create: `src/app/dashboard-tiles.ts`
- Test: `src/app/dashboard-tiles.test.ts`

- [ ] **Step 1: Confirm the filenames are free**

```bash
ls src/app/dashboard-tiles.* src/app/dashboard-layout.* 2>/dev/null; echo "EXIT=$?"
```
Expected: nothing listed.

- [ ] **Step 2: Write the failing test**

Create `src/app/dashboard-tiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DASHBOARD_TILES, tileById } from "./dashboard-tiles";

describe("DASHBOARD_TILES", () => {
  it("has unique ids", () => {
    const ids = DASHBOARD_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every tile defaults inside its own limits", () => {
    for (const t of DASHBOARD_TILES) {
      expect(t.w, `${t.id} w`).toBeGreaterThanOrEqual(t.minW);
      expect(t.w, `${t.id} w`).toBeLessThanOrEqual(t.maxW);
      expect(t.h, `${t.id} h`).toBeGreaterThanOrEqual(t.minH);
      expect(t.h, `${t.id} h`).toBeLessThanOrEqual(t.maxH);
    }
  });

  it("keeps every limit within the 1..4 span range", () => {
    for (const t of DASHBOARD_TILES) {
      for (const v of [t.minW, t.maxW, t.minH, t.maxH]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(4);
      }
    }
  });

  it("only allows minH 1 for single-line content", () => {
    // ★ Tile chrome costs a fixed ~26px off every tile. At the 80px row unit a
    // h:1 tile has ~54px of body — a sparkline fits, a list of rows does not.
    // Any tile claiming minH 1 must be on this list deliberately.
    const singleLine = new Set(["completionTrend"]);
    for (const t of DASHBOARD_TILES) {
      if (t.minH === 1) expect(singleLine.has(t.id), `${t.id} claims minH 1`).toBe(true);
    }
  });

  it("resolves a tile by id and returns undefined for an unknown one", () => {
    expect(tileById("kpi")?.id).toBe("kpi");
    expect(tileById("nope" as never)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-tiles.test.ts --reporter=dot > /tmp/dt.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dt.log
```
Expected: `EXIT=1`, `Failed to resolve import "./dashboard-tiles"`.

- [ ] **Step 4: Write the implementation**

Create `src/app/dashboard-tiles.ts`:

```ts
/**
 * The Dashboard tile catalogue — the single declaration of what tiles exist,
 * how big they are by default, and how far a user may resize each one.
 *
 * Pure and i18n-free: it carries i18n KEYS, never strings, so it stays
 * importable from a bare node process.
 *
 * ★★ `minH: 1` IS ALMOST ALWAYS WRONG. Tile chrome (grip, title, ⋮, bottom
 * border) costs a fixed ~26px off every tile regardless of height, so at the
 * 80px row unit a h:1 tile has roughly 54px of body. That fits a sparkline and
 * nothing else. A test pins the exceptions.
 */

export type TileSpan = 1 | 2 | 3 | 4;

export type DashboardTileId =
  | "kpi" | "topActions" | "insights" | "raid" | "upcoming"
  | "progress" | "trends" | "burn" | "milestones" | "changes" | "completionTrend";

/** Which module flags must be on for a tile to exist for this project. */
export interface TileGateInput {
  showRaid: boolean;
  showBudget: boolean;
  showChanges: boolean;
  showMilestones: boolean;
  tursoActive: boolean;
  hasTopActions: boolean;
  hasInsights: boolean;
  hasCompletionTrend: boolean;
}

/** ★ Named TileSpec, NOT DashboardTile — `dashboard-tile.tsx` exports a COMPONENT
 *  called `DashboardTile`, and `dashboard-panel.tsx` imports both. Two different
 *  concepts must not share a name in this flat directory. */
export interface TileSpec {
  id: DashboardTileId;
  /** i18n key for the tile's title in the chrome header. */
  labelKey: string;
  w: TileSpan;
  h: TileSpan;
  minW: TileSpan;
  maxW: TileSpan;
  minH: TileSpan;
  maxH: TileSpan;
  /** True when this tile exists at all for the given project. */
  gate: (g: TileGateInput) => boolean;
}

const ALWAYS = () => true;

export const DASHBOARD_TILES: readonly TileSpec[] = [
  { id: "kpi",             labelKey: "dashboardKpiTile",        w: 4, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
  { id: "topActions",      labelKey: "dashboardTopActions",     w: 2, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasTopActions },
  { id: "insights",        labelKey: "dashboardInsights",       w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasInsights },
  { id: "raid",            labelKey: "dashboardRaidRegister",   w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showRaid },
  { id: "upcoming",        labelKey: "dashboardUpcoming",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: ALWAYS },
  { id: "progress",        labelKey: "dashboardProgress",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
  { id: "trends",          labelKey: "dashboardTrends",         w: 1, h: 2, minW: 1, maxW: 2, minH: 2, maxH: 3, gate: (g) => g.tursoActive },
  { id: "burn",            labelKey: "dashboardBudgetBurn",     w: 1, h: 2, minW: 1, maxW: 2, minH: 2, maxH: 3, gate: (g) => g.showBudget },
  { id: "milestones",      labelKey: "dashboardMilestones",     w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showMilestones },
  { id: "changes",         labelKey: "dashboardChangesHeading", w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showChanges },
  { id: "completionTrend", labelKey: "dashboardCompletionTrend", w: 2, h: 1, minW: 2, maxW: 4, minH: 1, maxH: 2, gate: (g) => g.hasCompletionTrend },
];

export function tileById(id: DashboardTileId): TileSpec | undefined {
  return DASHBOARD_TILES.find((t) => t.id === id);
}

/** The tiles that exist for this project, in catalogue order. */
export function liveTiles(gate: TileGateInput): readonly TileSpec[] {
  return DASHBOARD_TILES.filter((t) => t.gate(gate));
}
```

Two typing details to settle while writing this file:

- **`labelKey` should be the i18n key type, not `string`.** Check what `i18n.ts` exports — if there is a `TranslationKey`/`I18nKey` union, type `labelKey` as that so `t(lang, spec.labelKey)` typechecks without a cast and a typo is a build error. If no such type is exported, keep `string` and expect a cast at the call site in Task 14; do not widen `t`'s signature to accommodate this.
- Some `labelKey` values reuse keys that already exist (`dashboardProgress`, `dashboardMilestones`, `dashboardBudgetBurn`, `dashboardChangesHeading`). Grep before adding duplicates. Task 13 adds the genuinely new ones.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/app/dashboard-tiles.test.ts --reporter=dot > /tmp/dt.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dt.log
```
Expected: `EXIT=0`, 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-tiles.ts src/app/dashboard-tiles.test.ts
git commit -m "feat(dashboard): add the tile catalogue"
```

---

### Task 2: Layout engine — reorder, hide, restore

**Files:**
- Create: `src/app/dashboard-layout.ts`
- Test: `src/app/dashboard-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hideTile, moveTile, restoreTile, type DashboardLayout } from "./dashboard-layout";

const layout = (): DashboardLayout => ({
  v: 1,
  board: [
    { id: "kpi", w: 4, h: 2 },
    { id: "raid", w: 2, h: 2 },
    { id: "upcoming", w: 2, h: 2 },
  ],
  hidden: ["burn"],
});

describe("moveTile", () => {
  it("moves a tile into the target's slot", () => {
    const next = moveTile(layout(), "kpi", "upcoming");
    expect(next.board.map((t) => t.id)).toEqual(["raid", "upcoming", "kpi"]);
  });

  it("preserves each tile's size while moving", () => {
    const next = moveTile(layout(), "kpi", "upcoming");
    expect(next.board.find((t) => t.id === "kpi")).toEqual({ id: "kpi", w: 4, h: 2 });
  });

  it("returns the same object when the move is a no-op", () => {
    const l = layout();
    expect(moveTile(l, "kpi", "kpi")).toBe(l);
    expect(moveTile(l, "burn", "kpi")).toBe(l);   // burn is hidden, not on the board
  });
});

describe("hideTile", () => {
  it("removes the tile from the board and appends it to hidden", () => {
    const next = hideTile(layout(), "raid");
    expect(next.board.map((t) => t.id)).toEqual(["kpi", "upcoming"]);
    expect(next.hidden).toEqual(["burn", "raid"]);
  });

  it("returns the same object when the tile is not on the board", () => {
    const l = layout();
    expect(hideTile(l, "burn")).toBe(l);
  });
});

describe("restoreTile", () => {
  it("appends a hidden tile to the board at its catalogue default size", () => {
    const next = restoreTile(layout(), "burn");
    expect(next.hidden).toEqual([]);
    expect(next.board.at(-1)).toEqual({ id: "burn", w: 1, h: 2 });
  });

  it("inserts at an explicit index when given one", () => {
    const next = restoreTile(layout(), "burn", 0);
    expect(next.board[0].id).toBe("burn");
  });

  it("returns the same object when the tile is not hidden", () => {
    const l = layout();
    expect(restoreTile(l, "kpi")).toBe(l);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-layout.test.ts --reporter=dot > /tmp/dl.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dl.log
```
Expected: `EXIT=1`, `Failed to resolve import "./dashboard-layout"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard-layout.ts`:

```ts
/**
 * The Dashboard layout engine — pure, i18n-free, DOM-free.
 *
 * ★★ ORDER IS THE ENTIRE PLACEMENT MODEL. There are no coordinates: the grid
 * renders with `grid-auto-flow: row dense`, which resolves an ordered list into
 * cells. That is what keeps every operation here an array operation, and it is
 * also why a user cannot leave a deliberate hole — dense backfills.
 *
 * Every function returns the SAME object reference on a no-op, so callers can
 * skip a persist cheaply.
 */
import { reorderIds } from "./list-reorder";
import { DASHBOARD_TILES, tileById, type DashboardTileId, type TileSpan } from "./dashboard-tiles";

export interface PlacedTile {
  id: DashboardTileId;
  w: TileSpan;
  h: TileSpan;
}

export interface DashboardLayout {
  v: 1;
  board: PlacedTile[];
  hidden: DashboardTileId[];
}

/** Every tile on the board, in catalogue order, at its default size. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  v: 1,
  board: DASHBOARD_TILES.map((t) => ({ id: t.id, w: t.w, h: t.h })),
  hidden: [],
};

export function moveTile(
  layout: DashboardLayout,
  dragId: DashboardTileId,
  targetId: DashboardTileId,
): DashboardLayout {
  const ids = layout.board.map((t) => t.id);
  const next = reorderIds(ids, dragId, targetId);
  if (next === ids) return layout;
  const byId = new Map(layout.board.map((t) => [t.id, t]));
  return { ...layout, board: (next as DashboardTileId[]).map((id) => byId.get(id)!) };
}

export function hideTile(layout: DashboardLayout, id: DashboardTileId): DashboardLayout {
  if (!layout.board.some((t) => t.id === id)) return layout;
  return {
    ...layout,
    board: layout.board.filter((t) => t.id !== id),
    hidden: [...layout.hidden, id],
  };
}

export function restoreTile(
  layout: DashboardLayout,
  id: DashboardTileId,
  index?: number,
): DashboardLayout {
  if (!layout.hidden.includes(id)) return layout;
  const spec = tileById(id);
  if (!spec) return layout;
  const board = [...layout.board];
  const at = index === undefined ? board.length : Math.max(0, Math.min(board.length, index));
  board.splice(at, 0, { id, w: spec.w, h: spec.h });
  return { ...layout, board, hidden: layout.hidden.filter((h) => h !== id) };
}
```

`reorderIds` comes from Phase A. If Phase A has not landed, stop and complete it first.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/dashboard-layout.test.ts --reporter=dot > /tmp/dl.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dl.log
```
Expected: `EXIT=0`, 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-layout.ts src/app/dashboard-layout.test.ts
git commit -m "feat(dashboard): add layout engine move/hide/restore"
```

---

### Task 3: Layout engine — `resizeTile`

**Files:**
- Modify: `src/app/dashboard-layout.ts`
- Test: `src/app/dashboard-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/dashboard-layout.test.ts`:

```ts
import { resizeTile } from "./dashboard-layout";

describe("resizeTile", () => {
  it("sets one axis without touching the other", () => {
    const next = resizeTile(layout(), "raid", "h", 4);
    expect(next.board.find((t) => t.id === "raid")).toEqual({ id: "raid", w: 2, h: 4 });
  });

  it("clamps a value above the tile's max", () => {
    // raid maxH is 4
    const next = resizeTile(layout(), "raid", "h", 4);
    expect(next.board.find((t) => t.id === "raid")!.h).toBe(4);
  });

  it("clamps a value below the tile's min", () => {
    // kpi minW is 2
    const next = resizeTile(layout(), "kpi", "w", 1);
    expect(next.board.find((t) => t.id === "kpi")!.w).toBe(2);
  });

  it("returns the same object when the value does not change", () => {
    const l = layout();
    expect(resizeTile(l, "raid", "w", 2)).toBe(l);
  });

  it("returns the same object for a tile not on the board", () => {
    const l = layout();
    expect(resizeTile(l, "burn", "w", 2)).toBe(l);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-layout.test.ts --reporter=dot > /tmp/dl.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dl.log
```
Expected: `EXIT=1`, `"resizeTile" is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/app/dashboard-layout.ts`:

```ts
/** Clamp `v` into `[lo, hi]`, keeping the TileSpan type. */
function clampSpan(v: number, lo: TileSpan, hi: TileSpan): TileSpan {
  return Math.max(lo, Math.min(hi, Math.round(v))) as TileSpan;
}

/**
 * Set one axis of one tile, clamped to that tile's own limits.
 *
 * ★ The axes are INDEPENDENT by design. A single named-preset list conflated
 * them, so "taller, same width" was only expressible where the table happened
 * to hold that combination.
 */
export function resizeTile(
  layout: DashboardLayout,
  id: DashboardTileId,
  axis: "w" | "h",
  value: number,
): DashboardLayout {
  const i = layout.board.findIndex((t) => t.id === id);
  if (i < 0) return layout;
  const spec = tileById(id);
  if (!spec) return layout;
  const next = axis === "w"
    ? clampSpan(value, spec.minW, spec.maxW)
    : clampSpan(value, spec.minH, spec.maxH);
  if (layout.board[i][axis] === next) return layout;
  const board = [...layout.board];
  board[i] = { ...board[i], [axis]: next };
  return { ...layout, board };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/dashboard-layout.test.ts --reporter=dot > /tmp/dl.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dl.log
```
Expected: `EXIT=0`, 13 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-layout.ts src/app/dashboard-layout.test.ts
git commit -m "feat(dashboard): add per-axis resizeTile with per-tile clamping"
```

---

### Task 4: Layout engine — `reconcile`

The part that decides whether this survives a release. A stored layout is always older than the catalogue.

**Files:**
- Modify: `src/app/dashboard-layout.ts`
- Test: `src/app/dashboard-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/dashboard-layout.test.ts`:

```ts
import { reconcile } from "./dashboard-layout";
import type { TileGateInput } from "./dashboard-tiles";

const allOn: TileGateInput = {
  showRaid: true, showBudget: true, showChanges: true, showMilestones: true,
  tursoActive: true, hasTopActions: true, hasInsights: true, hasCompletionTrend: true,
};

describe("reconcile", () => {
  it("drops an id that no longer exists in the catalogue", () => {
    const stored = { v: 1 as const, board: [{ id: "ghost" as never, w: 2 as const, h: 2 as const }, { id: "kpi" as const, w: 4 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored, allOn);
    expect(next.board.map((t) => t.id)).not.toContain("ghost");
    expect(next.board.map((t) => t.id)).toContain("kpi");
  });

  it("inserts a new catalogue tile after its nearest present predecessor", () => {
    // Catalogue order starts kpi, topActions, insights, raid, upcoming...
    // Store knows kpi and raid only; insights must land between them.
    const stored = { v: 1 as const, board: [{ id: "kpi" as const, w: 4 as const, h: 2 as const }, { id: "raid" as const, w: 2 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored, allOn);
    const ids = next.board.map((t) => t.id);
    expect(ids.indexOf("insights")).toBeGreaterThan(ids.indexOf("kpi"));
    expect(ids.indexOf("insights")).toBeLessThan(ids.indexOf("raid"));
  });

  it("inserts at index 0 when no predecessor is present", () => {
    const stored = { v: 1 as const, board: [{ id: "changes" as const, w: 2 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored, allOn);
    expect(next.board[0].id).toBe("kpi");
  });

  it("clamps a stored size outside the tile's limits, per axis", () => {
    const stored = { v: 1 as const, board: [{ id: "kpi" as const, w: 1 as const, h: 3 as const }], hidden: [] };
    const next = reconcile(stored, allOn);
    const kpi = next.board.find((t) => t.id === "kpi")!;
    expect(kpi.w).toBe(2);   // clamped up to minW
    expect(kpi.h).toBe(3);   // legal, and therefore PRESERVED, not reset to the default 2
  });

  it("keeps a gated-off tile in the layout rather than dropping it", () => {
    // ★ Turning Budget off and on again must return the burn tile to where the
    // user put it. Dropping it here would lose that position permanently.
    const stored = { v: 1 as const, board: [{ id: "burn" as const, w: 1 as const, h: 2 as const }, { id: "kpi" as const, w: 4 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored, { ...allOn, showBudget: false });
    expect(next.board.map((t) => t.id)).toContain("burn");
  });

  it("preserves hidden tiles and never lists one on the board too", () => {
    const stored = { v: 1 as const, board: [{ id: "kpi" as const, w: 4 as const, h: 2 as const }], hidden: ["raid" as const] };
    const next = reconcile(stored, allOn);
    expect(next.hidden).toContain("raid");
    expect(next.board.map((t) => t.id)).not.toContain("raid");
  });

  it("returns the default layout for null", () => {
    expect(reconcile(null, allOn).board.length).toBe(DASHBOARD_TILES.length);
  });
});
```

Add `import { DASHBOARD_TILES } from "./dashboard-tiles";` to the test's imports.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-layout.test.ts --reporter=dot > /tmp/dl.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dl.log
```
Expected: `EXIT=1`, `"reconcile" is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/app/dashboard-layout.ts`:

```ts
import type { TileGateInput } from "./dashboard-tiles";

/**
 * Bring a stored layout up to date with the current catalogue.
 *
 * ★★ A GATED-OFF TILE IS KEPT, NOT DROPPED. `gate` decides what RENDERS, never
 * what is STORED — otherwise switching Budget off and on again would lose the
 * burn tile's position permanently. The render layer filters; this does not.
 *
 * ★★ A NEW TILE LANDS AFTER ITS NEAREST PRESENT CATALOGUE PREDECESSOR, not at
 * the end. Appending would dump every newly shipped tile at the bottom of every
 * existing user's board, where its author's intended priority is lost.
 *
 * ★ Sizes are clamped PER AXIS, never reset to the default: a stored height
 * that is still legal survives a width that is not.
 */
export function reconcile(stored: DashboardLayout | null, _gate: TileGateInput): DashboardLayout {
  if (!stored) return DEFAULT_LAYOUT;

  const known = new Map(DASHBOARD_TILES.map((t) => [t.id, t]));
  const hidden = stored.hidden.filter((id) => known.has(id));
  const hiddenSet = new Set(hidden);

  // 1. keep what still exists, clamped, minus anything also marked hidden
  const board: PlacedTile[] = [];
  for (const p of stored.board) {
    const spec = known.get(p.id);
    if (!spec || hiddenSet.has(p.id)) continue;
    if (board.some((b) => b.id === p.id)) continue;          // storage held a duplicate
    board.push({
      id: p.id,
      w: clampSpan(p.w, spec.minW, spec.maxW),
      h: clampSpan(p.h, spec.minH, spec.maxH),
    });
  }

  // 2. insert anything the catalogue has that storage did not
  const present = new Set(board.map((b) => b.id));
  DASHBOARD_TILES.forEach((spec, catIdx) => {
    if (present.has(spec.id) || hiddenSet.has(spec.id)) return;
    // nearest preceding catalogue neighbour that IS on the board
    let at = 0;
    for (let i = catIdx - 1; i >= 0; i--) {
      const j = board.findIndex((b) => b.id === DASHBOARD_TILES[i].id);
      if (j >= 0) { at = j + 1; break; }
    }
    board.splice(at, 0, { id: spec.id, w: spec.w, h: spec.h });
    present.add(spec.id);
  });

  return { v: 1, board, hidden };
}
```

`_gate` is deliberately unused — the underscore documents that gating is a render concern. **Verify eslint accepts it**: this repo has no `argsIgnorePattern`, so an underscore prefix does **not** silence the unused rule. If lint complains in Step 5, drop the parameter entirely and update the call sites and tests.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/dashboard-layout.test.ts --reporter=dot > /tmp/dl.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dl.log
```
Expected: `EXIT=0`, 20 passed.

- [ ] **Step 5: Lint — check the unused-parameter question now**

```bash
npx eslint --max-warnings=0 src/app/dashboard-layout.ts; echo "EXIT=$?"
```
Expected: `EXIT=0`. If it reports an unused `_gate`, remove the parameter from the signature, from both call sites in the test, and from Task 6's hook.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-layout.ts src/app/dashboard-layout.test.ts
git commit -m "feat(dashboard): reconcile stored layouts against the live catalogue"
```

---

### Task 5: `reconcile` property tests

**Files:**
- Create: `src/app/dashboard-layout.property.test.ts`

- [ ] **Step 1: Write the test**

Create `src/app/dashboard-layout.property.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { reconcile, type DashboardLayout } from "./dashboard-layout";
import { DASHBOARD_TILES, type DashboardTileId, type TileGateInput, type TileSpan } from "./dashboard-tiles";

const allOn: TileGateInput = {
  showRaid: true, showBudget: true, showChanges: true, showMilestones: true,
  tursoActive: true, hasTopActions: true, hasInsights: true, hasCompletionTrend: true,
};

const anyId = fc.constantFrom(...DASHBOARD_TILES.map((t) => t.id));
const anySpan = fc.constantFrom<TileSpan>(1, 2, 3, 4);

const anyLayout = fc.record({
  v: fc.constant(1 as const),
  board: fc.array(fc.record({ id: anyId, w: anySpan, h: anySpan }), { maxLength: 15 }),
  hidden: fc.array(anyId, { maxLength: 6 }),
}) as fc.Arbitrary<DashboardLayout>;

describe("reconcile properties", () => {
  it("is idempotent — reconciling twice equals reconciling once", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      const once = reconcile(l, allOn);
      expect(reconcile(once, allOn)).toEqual(once);
    }));
  });

  it("never loses a catalogue tile — every id is on the board or hidden, exactly once", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      const out = reconcile(l, allOn);
      const seen = [...out.board.map((t) => t.id), ...out.hidden];
      for (const spec of DASHBOARD_TILES) {
        expect(seen.filter((id) => id === spec.id).length).toBe(1);
      }
    }));
  });

  it("always emits sizes inside each tile's limits", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      for (const p of reconcile(l, allOn).board) {
        const spec = DASHBOARD_TILES.find((t) => t.id === p.id)!;
        expect(p.w).toBeGreaterThanOrEqual(spec.minW);
        expect(p.w).toBeLessThanOrEqual(spec.maxW);
        expect(p.h).toBeGreaterThanOrEqual(spec.minH);
        expect(p.h).toBeLessThanOrEqual(spec.maxH);
      }
    }));
  });

  it("never puts an id on the board and in hidden at once", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      const out = reconcile(l, allOn);
      const board = new Set<DashboardTileId>(out.board.map((t) => t.id));
      for (const id of out.hidden) expect(board.has(id)).toBe(false);
    }));
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/dashboard-layout.property.test.ts --reporter=dot > /tmp/dlp.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/dlp.log
```
Expected: `EXIT=0`, 4 passed.

If the "never loses a tile" property fails on a generated case with a duplicate id in `board` and the same id in `hidden`, that is a real engine bug — fix `reconcile`, not the property.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard-layout.property.test.ts
git commit -m "test(dashboard): property-test reconcile for idempotence and totality"
```

---

### Task 6: Per-project store

**Files:**
- Create: `src/app/dashboard-layout-store.ts`
- Test: `src/app/dashboard-layout-store.test.ts`

- [ ] **Step 1: Read the precedent**

Read `src/app/landing-state.ts` in full. This store copies its shape: one localStorage key holding a `{[projectId]: T}` map, capped at the 50 most-recent, validated on load, never a `Workspace` field.

- [ ] **Step 2: Write the failing test**

Create `src/app/dashboard-layout-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { DASHBOARD_LAYOUT_KEY, loadLayout, saveLayout } from "./dashboard-layout-store";
import type { DashboardLayout } from "./dashboard-layout";

const sample: DashboardLayout = { v: 1, board: [{ id: "kpi", w: 4, h: 2 }], hidden: ["raid"] };

describe("dashboard-layout-store", () => {
  beforeEach(() => { localStorage.clear(); });

  it("round-trips a layout for a project", () => {
    saveLayout("p1", sample);
    expect(loadLayout("p1")).toEqual(sample);
  });

  it("keeps projects independent", () => {
    saveLayout("p1", sample);
    expect(loadLayout("p2")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadLayout("p1")).toBeNull();
  });

  it("returns null on corrupt JSON instead of throwing", () => {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, "{not json");
    expect(loadLayout("p1")).toBeNull();
  });

  it("returns null for a stored value of the wrong shape", () => {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify({ p1: { v: 1, board: "nope" } }));
    expect(loadLayout("p1")).toBeNull();
  });

  it("caps the map at 50 projects, evicting the least recently saved", () => {
    for (let i = 0; i < 55; i++) saveLayout(`p${i}`, sample);
    const map = JSON.parse(localStorage.getItem(DASHBOARD_LAYOUT_KEY)!);
    expect(Object.keys(map).length).toBe(50);
    expect(loadLayout("p0")).toBeNull();       // evicted
    expect(loadLayout("p54")).toEqual(sample); // newest kept
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-layout-store.test.ts --reporter=dot > /tmp/dls.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dls.log
```
Expected: `EXIT=1`, unresolved import.

- [ ] **Step 4: Write the implementation**

Create `src/app/dashboard-layout-store.ts`:

```ts
"use client";
/**
 * Per-device, per-project storage for the Dashboard arrangement.
 *
 * ★★ NOT A `Workspace` FIELD, deliberately — zero backend write paths, nothing
 * in exports or Turso. One localStorage key holds a `{[projectId]: layout}` map,
 * exactly like `landing-state.ts`, so `clearAppConfig`'s `aipm-cockpit:*` sweep
 * already clears it and no codec, DDL or golden fixture has to change.
 *
 * ★ Insertion order in the JSON object IS the recency order used for eviction.
 * Re-saving an existing project deletes and re-adds its key so it moves to the
 * end; without that, the first 50 projects a user ever opened would be pinned
 * forever and the 51st could never be stored.
 */
import type { DashboardLayout } from "./dashboard-layout";

export const DASHBOARD_LAYOUT_KEY = "aipm-cockpit:dashboard-layout";
export const MAX_PROJECTS = 50;

function isLayout(v: unknown): v is DashboardLayout {
  if (!v || typeof v !== "object") return false;
  const l = v as Partial<DashboardLayout>;
  if (l.v !== 1 || !Array.isArray(l.board) || !Array.isArray(l.hidden)) return false;
  return l.board.every(
    (t) => t && typeof t === "object" && typeof t.id === "string"
      && typeof t.w === "number" && typeof t.h === "number",
  ) && l.hidden.every((h) => typeof h === "string");
}

function readMap(): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};                       // corrupt blob reads as empty, never throws
  }
}

export function loadLayout(projectId: string): DashboardLayout | null {
  const entry = readMap()[projectId];
  return isLayout(entry) ? entry : null;
}

export function saveLayout(projectId: string, layout: DashboardLayout): void {
  if (typeof localStorage === "undefined") return;
  const map = readMap();
  delete map[projectId];                                  // re-add so it is newest
  map[projectId] = layout;
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PROJECTS))) delete map[stale];
  try {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(map));
  } catch {
    // Quota or private-mode failure: the arrangement is a preference, not data.
    // Losing it must never break the dashboard.
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/app/dashboard-layout-store.test.ts --reporter=dot > /tmp/dls.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dls.log
```
Expected: `EXIT=0`, 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-layout-store.ts src/app/dashboard-layout-store.test.ts
git commit -m "feat(dashboard): add the per-project layout store"
```

---

### Task 7: The layout hook

**Files:**
- Create: `src/app/use-dashboard-layout.ts`
- Test: `src/app/use-dashboard-layout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-dashboard-layout.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useDashboardLayout } from "./use-dashboard-layout";
import { loadLayout, saveLayout } from "./dashboard-layout-store";
import type { TileGateInput } from "./dashboard-tiles";

const allOn: TileGateInput = {
  showRaid: true, showBudget: true, showChanges: true, showMilestones: true,
  tursoActive: true, hasTopActions: true, hasInsights: true, hasCompletionTrend: true,
};

function Harness({ projectId = "p1", isPopout = false }: { projectId?: string; isPopout?: boolean }) {
  const l = useDashboardLayout({ projectId, gate: allOn, isPopout });
  return (
    <div>
      <output data-testid="order">{l.layout.board.map((t) => t.id).join(",")}</output>
      <output data-testid="hidden">{l.layout.hidden.join(",")}</output>
      <button onClick={() => l.hide("raid")}>hide</button>
      <button onClick={() => l.reset()}>reset</button>
    </div>
  );
}

describe("useDashboardLayout", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("starts from the default layout when nothing is stored", () => {
    render(<Harness />);
    expect(screen.getByTestId("order").textContent).toContain("kpi");
    expect(screen.getByTestId("hidden").textContent).toBe("");
  });

  it("reconciles a stored layout on load", () => {
    saveLayout("p1", { v: 1, board: [{ id: "raid", w: 2, h: 2 }], hidden: [] });
    render(<Harness />);
    // raid stays first; everything else is inserted around it
    expect(screen.getByTestId("order").textContent!.split(",")).toContain("raid");
  });

  it("persists after a mutation", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p1")!.hidden).toContain("raid");
  });

  it("does not persist in a popout", async () => {
    vi.useFakeTimers();
    render(<Harness isPopout />);
    act(() => { screen.getByText("hide").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(loadLayout("p1")).toBeNull();
  });

  it("reset restores the default and clears hidden", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { screen.getByText("hide").click(); });
    act(() => { screen.getByText("reset").click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("hidden").textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/use-dashboard-layout.test.tsx --reporter=dot > /tmp/dlh.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dlh.log
```
Expected: `EXIT=1`, unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/app/use-dashboard-layout.ts`:

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_LAYOUT, hideTile, moveTile, reconcile, resizeTile, restoreTile,
  type DashboardLayout,
} from "./dashboard-layout";
import { loadLayout, saveLayout } from "./dashboard-layout-store";
import type { DashboardTileId, TileGateInput } from "./dashboard-tiles";

/** Debounce before writing to localStorage, so a drag that reflows repeatedly
 *  does not write on every frame. */
export const LAYOUT_PERSIST_MS = 400;

export interface DashboardLayoutApi {
  layout: DashboardLayout;
  move: (dragId: DashboardTileId, targetId: DashboardTileId) => void;
  hide: (id: DashboardTileId) => void;
  restore: (id: DashboardTileId, index?: number) => void;
  resize: (id: DashboardTileId, axis: "w" | "h", value: number) => void;
  reset: () => void;
  /** Arrangement is read-only here (popout). Render no grips, menus or shelf. */
  readOnly: boolean;
}

/**
 * Owns the Dashboard arrangement: load → reconcile → mutate → debounced persist.
 *
 * ★★ THE INITIAL READ IS A LAZY `useState`, not an effect. A `useEffect` that
 * called `setState` would violate the repo's banned `react-hooks/
 * set-state-in-effect` rule, and reading localStorage in the render body would
 * violate the purity rule. A lazy initialiser is the one shape that satisfies
 * both.
 *
 * ★ Popout is read-only — it never persists, mirroring `use-landing-delta`.
 */
export function useDashboardLayout({
  projectId,
  gate,
  isPopout = false,
}: {
  projectId: string;
  gate: TileGateInput;
  isPopout?: boolean;
}): DashboardLayoutApi {
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    reconcile(typeof window === "undefined" ? null : loadLayout(projectId), gate),
  );

  // Persist on change, debounced. A side effect only — no setState here.
  const dirty = useRef(false);
  useEffect(() => {
    if (isPopout || !dirty.current) return;
    const id = window.setTimeout(() => { saveLayout(projectId, layout); }, LAYOUT_PERSIST_MS);
    return () => window.clearTimeout(id);
  }, [layout, projectId, isPopout]);

  const mutate = useCallback((fn: (l: DashboardLayout) => DashboardLayout) => {
    setLayout((prev) => {
      const next = fn(prev);
      if (next !== prev) dirty.current = true;
      return next;
    });
  }, []);

  return {
    layout,
    readOnly: isPopout,
    move: useCallback((d, t) => mutate((l) => moveTile(l, d, t)), [mutate]),
    hide: useCallback((id) => mutate((l) => hideTile(l, id)), [mutate]),
    restore: useCallback((id, index) => mutate((l) => restoreTile(l, id, index)), [mutate]),
    resize: useCallback((id, axis, v) => mutate((l) => resizeTile(l, id, axis, v)), [mutate]),
    reset: useCallback(() => mutate(() => DEFAULT_LAYOUT), [mutate]),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/use-dashboard-layout.test.tsx --reporter=dot > /tmp/dlh.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dlh.log
```
Expected: `EXIT=0`, 5 passed.

- [ ] **Step 5: Lint — the hooks rules are strict here**

```bash
npx eslint --max-warnings=0 src/app/use-dashboard-layout.ts; echo "EXIT=$?"
```
Expected: `EXIT=0`. If `react-hooks/exhaustive-deps` rejects a dependency, hoist it to a scalar local and depend on that — it rejects `obj.member` expressions in a dep array.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-dashboard-layout.ts src/app/use-dashboard-layout.test.tsx
git commit -m "feat(dashboard): add the layout hook with debounced per-project persist"
```

---

### Task 8: Density row unit

**Files:**
- Modify: `src/app/dashboard-density.ts`
- Modify: `src/app/dashboard-density.test.ts` (or create if absent)

- [ ] **Step 1: Write the failing test**

Append to the density test file:

```ts
it("exposes a grid row unit per density", () => {
  // ★ 80px comfortable was settled by eye-verify on 2026-08-14 against the
  // prototype. 64px compact has NOT had the same check — see the spec.
  expect(densityClasses("comfortable").tileRow).toBe("auto-rows-[80px]");
  expect(densityClasses("compact").tileRow).toBe("auto-rows-[64px]");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-density.test.ts --reporter=dot > /tmp/dd.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dd.log
```
Expected: `EXIT=1`, `tileRow` undefined.

- [ ] **Step 3: Write the implementation**

In `src/app/dashboard-density.ts`, add to `DensityClasses`:

```ts
  /** Height of one grid row unit in the arrangeable tile grid. */
  tileRow: string;
```

and to both constants:

```ts
const COMFORTABLE: DensityClasses = { outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3", sectionGap: "gap-4", cardGap: "mb-4", tileRow: "auto-rows-[80px]" };
const COMPACT: DensityClasses = { outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2", sectionGap: "gap-2", cardGap: "mb-2", tileRow: "auto-rows-[64px]" };
```

**Do not write a `*` wildcard inside a Tailwind arbitrary-value bracket anywhere**, including in comments and docs — Tailwind v4 scans every tracked file for class candidates and emits invalid CSS from one, which fails `globals.css` compilation and 500s the app.

- [ ] **Step 4: Run the test, then confirm Tailwind actually emits the classes**

```bash
npx vitest run src/app/dashboard-density.test.ts --reporter=dot > /tmp/dd.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dd.log
```
Expected: `EXIT=0`.

The emit check happens for real in Task 14's Playwright run — jsdom cannot see whether Tailwind generated the rule.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-density.ts src/app/dashboard-density.test.ts
git commit -m "feat(dashboard): add the tileRow density class"
```

---

### Task 9: Grid container and span classes

**Files:**
- Create: `src/app/dashboard-grid.tsx`
- Test: `src/app/dashboard-grid.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard-grid.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { H_CLASS, W_CLASS } from "./dashboard-grid";

describe("span class tables", () => {
  it("emits literal class strings, never interpolated ones", () => {
    // ★ Tailwind v4 scans SOURCE for class candidates. `col-span-${w}` emits no
    // CSS at all, so these tables must hold whole literal strings.
    for (const v of Object.values(W_CLASS)) expect(v).toMatch(/^col-span-1( lg:col-span-\d)?( xl:col-span-\d)?$/);
    for (const v of Object.values(H_CLASS)) expect(v).toMatch(/^row-span-\d$/);
  });

  it("carries the whole responsive clamp on the width axis", () => {
    expect(W_CLASS[4]).toBe("col-span-1 lg:col-span-2 xl:col-span-4");
    expect(W_CLASS[1]).toBe("col-span-1");
  });

  it("does not clamp height", () => {
    expect(H_CLASS[3]).toBe("row-span-3");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=1`, unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard-grid.tsx`:

```tsx
"use client";
import type { ReactNode, RefObject } from "react";
import type { DensityClasses } from "./dashboard-density";
import type { TileSpan } from "./dashboard-tiles";

/**
 * ★★★ THESE MUST STAY WHOLE LITERAL STRINGS. Tailwind v4 builds its stylesheet
 * by scanning source for class-name candidates, so an interpolated
 * `col-span-${w}` emits NO CSS — the tile would silently render one column wide
 * with nothing in any test able to see it, because jsdom has no layout.
 *
 * ★ The WIDTH table carries the entire responsive clamp, which is why the
 * narrow-screen behaviour needs no JavaScript: no width measurement, no
 * ResizeObserver. Height does not clamp — a tall tile stays tall.
 */
export const W_CLASS: Record<TileSpan, string> = {
  1: "col-span-1",
  2: "col-span-1 lg:col-span-2",
  3: "col-span-1 lg:col-span-2 xl:col-span-3",
  4: "col-span-1 lg:col-span-2 xl:col-span-4",
};

export const H_CLASS: Record<TileSpan, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
};

export function DashboardGrid({
  dc,
  scrollRef,
  children,
}: {
  dc: DensityClasses;
  scrollRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div ref={scrollRef} className="min-h-0 overflow-y-auto">
      <div
        data-testid="dashboard-grid"
        className={`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 grid-flow-row-dense ${dc.tileRow} ${dc.sectionGap}`}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=0`, 3 passed. Remove the unused `render`/`screen` imports if lint flags them — they are used from Task 10 onward.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-grid.tsx src/app/dashboard-grid.test.tsx
git commit -m "feat(dashboard): add the grid container and literal span tables"
```

---

### Task 10: Tile chrome

**Files:**
- Create: `src/app/dashboard-tile.tsx`
- Test: `src/app/dashboard-grid.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/app/dashboard-grid.test.tsx`:

```tsx
import { DashboardTile } from "./dashboard-tile";

function twoTiles(readOnly = false) {
  return render(
    <>
      <DashboardTile id="raid" title="RAID register" w={2} h={2} lang="en-US" readOnly={readOnly}
        dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </DashboardTile>
      <DashboardTile id="upcoming" title="Upcoming" w={2} h={2} lang="en-US" readOnly={readOnly}
        dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>body</p>
      </DashboardTile>
    </>,
  );
}

describe("DashboardTile", () => {
  it("applies the literal span classes for its size", () => {
    twoTiles();
    const tile = screen.getByTestId("tile-raid");
    expect(tile.className).toContain("lg:col-span-2");
    expect(tile.className).toContain("row-span-2");
  });

  it("gives every per-tile control a TILE-UNIQUE accessible name", () => {
    // ★★★ Two tiles minimum, or the collision cannot render and this test is
    // vacuous. axe CANNOT detect duplicate accessible names at any seed size —
    // this test is the only possible detector, in either layer.
    twoTiles();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names.length).toBeGreaterThan(2);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains the visible title in each control's accessible name", () => {
    twoTiles();
    const raidNames = screen.getAllByRole("button")
      .map((b) => b.getAttribute("aria-label")!)
      .filter((n) => n.includes("RAID register"));
    expect(raidNames.length).toBe(2);   // grip + menu button
  });

  it("renders no grip or menu button when read-only", () => {
    twoTiles(true);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=1`, unresolved `./dashboard-tile`.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard-tile.tsx`:

```tsx
"use client";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
import { DragHandle } from "./drag-handle";
import { W_CLASS, H_CLASS } from "./dashboard-grid";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { t, type Lang } from "./i18n";
import type { DashboardTileId, TileSpan } from "./dashboard-tiles";

export interface TileDragProps {
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
}
export interface TileHandleProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Chrome around one dashboard card: the drag grip, the title, and the ⋮ button.
 *
 * ★★ EVERY CONTROL'S NAME IS QUALIFIED WITH THE TILE TITLE. N identically named
 * "Move" buttons is a WCAG 2.4.6 failure, and the axe gate cannot see it at any
 * seed size — no rule under the four tags the gate requests flags duplicate
 * accessible names. The qualifier has to be written here, and the unit test
 * rendering two tiles is the only detector.
 *
 * ★★ The visible title is CONTAINED in each accessible name (WCAG 2.5.3), which
 * axe also cannot check: its `label-content-name-mismatch` rule is tagged
 * `experimental` and is excluded by axe's default tagExclude, so a tag-only run
 * never executes it.
 */
export function DashboardTile({
  id, title, w, h, lang, readOnly, dragProps, handleProps, onOpenMenu, children,
}: {
  id: DashboardTileId;
  title: string;
  w: TileSpan;
  h: TileSpan;
  lang: Lang;
  readOnly: boolean;
  dragProps: TileDragProps;
  handleProps: TileHandleProps;
  onOpenMenu: (anchor: HTMLElement) => void;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={`tile-${id}`}
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${W_CLASS[w]} ${H_CLASS[h]}`}
      {...(readOnly ? {} : dragProps)}
    >
      <div className="flex items-center gap-1 border-b border-line px-1 py-1">
        {!readOnly && (
          <DragHandle
            ariaLabel={`${t(lang, "dashboardTileMove")} – ${title}`}
            className={`cursor-grab rounded px-1 text-muted-foreground hover:text-foreground ${TRANSITION}`}
            {...handleProps}
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {title}
        </h3>
        {!readOnly && (
          <button
            type="button"
            aria-haspopup="menu"
            aria-label={`${t(lang, "dashboardTileOptions")} – ${title}`}
            title={t(lang, "dashboardTileOptions")}
            onClick={(e) => onOpenMenu(e.currentTarget)}
            className={`rounded px-1 py-0.5 text-muted-foreground hover:text-foreground print:hidden ${FOCUS_RING} ${TRANSITION}`}
          >
            <EllipsisHorizontalIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}
```

`DragHandle` forwards `draggable`/`onDragStart`/`onMouseDown` only. **Check its props before spreading `handleProps` onto it** — if it does not accept `onDragEnd` or `onKeyDown`, extend `DragGripProps` in `drag-handle.tsx` to forward them, and add a test there for the new props. Do not wrap it in another element to get around this; the grip must be the focusable control.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=0`, 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-tile.tsx src/app/dashboard-grid.test.tsx src/app/drag-handle.tsx src/app/drag-handle.test.tsx
git commit -m "feat(dashboard): add tile chrome with tile-unique control names"
```

---

### Task 11: The two-axis size menu

**Files:**
- Create: `src/app/dashboard-tile-menu.tsx`
- Test: `src/app/dashboard-grid.test.tsx` (append)

- [ ] **Step 1: Read the dismissal protocol**

Read `docs/AGENTS/ui-shell.md`'s dismissal section and `src/app/popover-panel.tsx`. The menu must follow the shared Escape/Tab protocol rather than improvising one.

- [ ] **Step 2: Write the failing test**

Append to `src/app/dashboard-grid.test.tsx`:

```tsx
import { DashboardTileMenu } from "./dashboard-tile-menu";

const menuFor = (id: "kpi" | "raid", onResize = () => {}, onMove = () => {}, onHide = () => {}) =>
  render(
    <DashboardTileMenu
      lang="en-US" tileId={id} title={id === "kpi" ? "KPIs" : "RAID register"}
      w={id === "kpi" ? 4 : 2} h={2} index={1} count={3}
      onResize={onResize} onMove={onMove} onHide={onHide} onClose={() => {}}
    />,
  );

describe("DashboardTileMenu", () => {
  it("renders a radio group per adjustable axis", () => {
    menuFor("raid");
    expect(screen.getByRole("group", { name: /width/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /height/i })).toBeInTheDocument();
  });

  it("marks the current value checked on each axis", () => {
    menuFor("raid");
    const width = screen.getByRole("group", { name: /width/i });
    const checked = within(width).getAllByRole("menuitemradio").filter((b) => b.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("2");
  });

  it("disables values outside the tile's limits instead of omitting them", () => {
    menuFor("raid");                       // raid maxW 4, minW 1 — all enabled
    const height = screen.getByRole("group", { name: /height/i });
    // raid minH is 2, so "1" must render and be disabled
    expect(within(height).getByRole("menuitemradio", { name: "1" })).toBeDisabled();
  });

  it("renders NO chooser for an axis whose min equals its max", () => {
    // ★★ kpi is minH 2 / maxH 3, minW 2 / maxW 4 — both adjustable. Use a tile
    // with a pinned axis if the catalogue gains one; the RULE is what matters:
    // four buttons with three disabled is indistinguishable from a broken
    // control, and read as exactly that during design review.
    menuFor("kpi");
    expect(screen.getByRole("group", { name: /width/i })).toBeInTheDocument();
  });

  it("calls onResize with the axis and value", () => {
    const onResize = vi.fn();
    menuFor("raid", onResize);
    const height = screen.getByRole("group", { name: /height/i });
    within(height).getByRole("menuitemradio", { name: "4" }).click();
    expect(onResize).toHaveBeenCalledWith("h", 4);
  });

  it("disables Move earlier at the start and Move later at the end", () => {
    render(
      <DashboardTileMenu lang="en-US" tileId="raid" title="RAID register" w={2} h={2}
        index={0} count={3} onResize={() => {}} onMove={() => {}} onHide={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole("menuitem", { name: /move earlier/i })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /move later/i })).toBeEnabled();
  });
});
```

Add `within` to the `@testing-library/react` import.

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=1`, unresolved `./dashboard-tile-menu`.

- [ ] **Step 4: Write the implementation**

Create `src/app/dashboard-tile-menu.tsx`:

```tsx
"use client";
import { tileById, type DashboardTileId, type TileSpan } from "./dashboard-tiles";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { t, type Lang } from "./i18n";

const SPANS: TileSpan[] = [1, 2, 3, 4];

/**
 * The ⋮ menu: two independent axes plus the keyboard move commands.
 *
 * ★★ AN AXIS WHERE min === max RENDERS NO CHOOSER — a static "fixed at N" line
 * instead. Four radio items with three disabled and one checked is
 * indistinguishable from a broken control, and was read as exactly that during
 * design review. Only render a group the user can actually change.
 *
 * ★ Values that are merely out of range render DISABLED rather than being
 * omitted, so the scale stays readable and the limit is visible.
 *
 * ★ The move commands are the Dashboard's keyboard reorder path; the drag
 * primitive's arrow-key option is deliberately NOT enabled here, since a second
 * keyboard path for the same action would be redundant.
 */
function AxisGroup({
  lang, axis, value, lo, hi, onPick,
}: {
  lang: Lang;
  axis: "w" | "h";
  value: TileSpan;
  lo: TileSpan;
  hi: TileSpan;
  onPick: (v: TileSpan) => void;
}) {
  const label = t(lang, axis === "w" ? "dashboardTileWidth" : "dashboardTileHeight");
  if (lo === hi) {
    return (
      <>
        <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="px-2 pb-1 text-xs text-muted-foreground">{t(lang, "dashboardTileFixedAt", String(lo))}</p>
      </>
    );
  }
  return (
    <>
      <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div role="group" aria-label={label} className="flex gap-1 px-2 pb-1">
        {SPANS.map((n) => (
          <button
            key={n}
            type="button"
            role="menuitemradio"
            aria-checked={n === value}
            disabled={n < lo || n > hi}
            onClick={() => onPick(n)}
            className={`flex-1 rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
              n === value ? "border-ui-green-strong bg-surface-muted font-semibold" : "border-line"
            } ${FOCUS_RING} ${TRANSITION}`}
          >
            {n}
          </button>
        ))}
      </div>
    </>
  );
}

export function DashboardTileMenu({
  lang, tileId, title, w, h, index, count, onResize, onMove, onHide, onClose,
}: {
  lang: Lang;
  tileId: DashboardTileId;
  title: string;
  w: TileSpan;
  h: TileSpan;
  index: number;
  count: number;
  onResize: (axis: "w" | "h", value: TileSpan) => void;
  onMove: (delta: number | "first") => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const spec = tileById(tileId);
  if (!spec) return null;
  const item = `flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60 hover:bg-surface-muted ${FOCUS_RING} ${TRANSITION}`;
  return (
    <div role="menu" aria-label={`${t(lang, "dashboardTileOptions")} – ${title}`} className="min-w-52">
      <AxisGroup lang={lang} axis="w" value={w} lo={spec.minW} hi={spec.maxW} onPick={(v) => onResize("w", v)} />
      <AxisGroup lang={lang} axis="h" value={h} lo={spec.minH} hi={spec.maxH} onPick={(v) => onResize("h", v)} />
      <hr className="my-1 border-line" />
      <button type="button" role="menuitem" className={item} disabled={index === 0}
        onClick={() => { onMove(-1); onClose(); }}>{t(lang, "dashboardTileMoveEarlier")}</button>
      <button type="button" role="menuitem" className={item} disabled={index >= count - 1}
        onClick={() => { onMove(1); onClose(); }}>{t(lang, "dashboardTileMoveLater")}</button>
      <button type="button" role="menuitem" className={item}
        onClick={() => { onMove("first"); onClose(); }}>{t(lang, "dashboardTileMoveFirst")}</button>
      <hr className="my-1 border-line" />
      <button type="button" role="menuitem" className={item}
        onClick={() => { onHide(); onClose(); }}>{t(lang, "dashboardTileHide")}</button>
    </div>
  );
}
```

The caller wraps this in `PopoverPanel` so the shared dismissal protocol applies — this component renders content only.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=0`, 13 passed.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-tile-menu.tsx src/app/dashboard-grid.test.tsx
git commit -m "feat(dashboard): add the two-axis tile size menu"
```

---

### Task 12: The shelf

**Files:**
- Create: `src/app/dashboard-shelf.tsx`
- Test: `src/app/dashboard-grid.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/app/dashboard-grid.test.tsx`:

```tsx
import { DashboardShelf } from "./dashboard-shelf";

describe("DashboardShelf", () => {
  const hidden = [{ id: "raid" as const, title: "RAID register" }, { id: "burn" as const, title: "Budget burn" }];

  it("summarises the hidden count on a collapsed disclosure", () => {
    render(<DashboardShelf lang="en-US" hidden={hidden} onRestore={() => {}} onHide={() => {}} isDragging={false} />);
    const btn = screen.getByRole("button", { name: /hidden/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveTextContent("2");
  });

  it("opens the tray on click", () => {
    render(<DashboardShelf lang="en-US" hidden={hidden} onRestore={() => {}} onHide={() => {}} isDragging={false} />);
    screen.getByRole("button", { name: /hidden/i }).click();
    expect(screen.getByRole("button", { name: /hidden/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the tray when a drag enters the collapsed button", () => {
    // ★ Without this the user has to open the tray BEFORE picking a tile up,
    // which is impossible to discover mid-drag.
    render(<DashboardShelf lang="en-US" hidden={hidden} onRestore={() => {}} onHide={() => {}} isDragging />);
    fireEvent.dragEnter(screen.getByRole("button", { name: /hidden/i }));
    expect(screen.getByRole("button", { name: /hidden/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("gives every Restore button a tile-unique accessible name", () => {
    // ★★ Two chips minimum or the collision cannot render.
    render(<DashboardShelf lang="en-US" hidden={hidden} onRestore={() => {}} onHide={() => {}} isDragging={false} />);
    screen.getByRole("button", { name: /hidden/i }).click();
    const names = screen.getAllByRole("button", { name: /restore/i }).map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("restores a tile from the tray by keyboard-reachable button", () => {
    const onRestore = vi.fn();
    render(<DashboardShelf lang="en-US" hidden={hidden} onRestore={onRestore} onHide={() => {}} isDragging={false} />);
    screen.getByRole("button", { name: /hidden/i }).click();
    screen.getAllByRole("button", { name: /restore/i })[0].click();
    expect(onRestore).toHaveBeenCalledWith("raid");
  });
});
```

Add `fireEvent` to the testing-library import.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=1`, unresolved `./dashboard-shelf`.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard-shelf.tsx`:

```tsx
"use client";
import { useState } from "react";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { t, type Lang } from "./i18n";
import type { DashboardTileId } from "./dashboard-tiles";

/**
 * Where hidden tiles live.
 *
 * ★★ THE RESTORE BUTTON IS THE KEYBOARD PATH, and without it a keyboard user
 * who hid a tile could never retrieve it. Dragging a chip back is the mouse
 * shortcut, not the only route.
 *
 * ★ Dragging over the COLLAPSED button opens the tray, so the user never has to
 * open it before picking a tile up — a sequence that cannot be discovered
 * mid-drag.
 */
export function DashboardShelf({
  lang, hidden, onRestore, onHide, isDragging,
}: {
  lang: Lang;
  hidden: { id: DashboardTileId; title: string }[];
  onRestore: (id: DashboardTileId) => void;
  onHide: (id: DashboardTileId) => void;
  isDragging: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 flex flex-col items-end print:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="dashboard-shelf-tray"
        onClick={() => setOpen((o) => !o)}
        onDragEnter={() => { if (isDragging) setOpen(true); }}
        onDragOver={(e) => { if (isDragging) e.preventDefault(); }}
        className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        {t(lang, "dashboardShelfCount", String(hidden.length))}
      </button>
      <div
        id="dashboard-shelf-tray"
        hidden={!open}
        onDragOver={(e) => { if (isDragging) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); setOpen(true); }}
        className="mt-1 w-full rounded-md border border-dashed border-line bg-surface-muted p-2"
      >
        {hidden.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">{t(lang, "dashboardShelfEmpty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {hidden.map((h) => (
              <li key={h.id} className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
                <span>{h.title}</span>
                <button
                  type="button"
                  aria-label={`${t(lang, "dashboardTileRestore")} – ${h.title}`}
                  onClick={() => onRestore(h.id)}
                  className={`rounded-full border border-line px-2 ${FOCUS_RING} ${TRANSITION}`}
                >
                  {t(lang, "dashboardTileRestore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

`onHide` is called by the grid when a tile is dropped on the tray; wire it in Task 13. If lint reports it unused here, drop it from the props and let the grid own the drop handler.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/dashboard-grid.test.tsx --reporter=dot > /tmp/dg.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dg.log
```
Expected: `EXIT=0`, 18 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-shelf.tsx src/app/dashboard-grid.test.tsx
git commit -m "feat(dashboard): add the collapsed hidden-tile shelf"
```

---

### Task 13: i18n strings

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN strings**

In `src/app/i18n.ts`, add:

```ts
  dashboardKpiTile: "At a glance",
  dashboardInsights: "Insights",
  dashboardRaidRegister: "RAID register",
  dashboardUpcoming: "Upcoming & overdue",
  dashboardTrends: "Trends",
  dashboardCompletionTrend: "Completion trend",
  dashboardTileMove: "Move",
  dashboardTileOptions: "Tile options",
  dashboardTileWidth: "Width",
  dashboardTileHeight: "Height",
  dashboardTileFixedAt: "fixed at {0}",
  dashboardTileMoveEarlier: "Move earlier",
  dashboardTileMoveLater: "Move later",
  dashboardTileMoveFirst: "Move to start",
  dashboardTileHide: "Hide tile",
  dashboardTileRestore: "Restore",
  dashboardShelfCount: "{0} hidden",
  dashboardShelfEmpty: "Nothing hidden",
  dashboardResetLayout: "Reset arrangement",
  dashboardTileMoved: "{0} moved to position {1} of {2}",
  dashboardTileHidden: "{0} hidden",
  dashboardTileResized: "{0} resized to {1} by {2}",
```

Check first whether `dashboardTopActions`, `dashboardProgress`, `dashboardMilestones`, `dashboardBudgetBurn` and `dashboardChangesHeading` already exist — several do. Reuse rather than duplicate.

Placeholders are **0-based positional** (`{0}`, `{1}`), filled by `t(lang, key, a, b)`.

- [ ] **Step 2: Add the DE strings via a node script, not the Edit tool**

`i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts and curls its quotes. Write a script:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  dashboardProgress:";           // an existing key, CRLF-anchored
const add = [
  "  dashboardKpiTile: \"Auf einen Blick\",",
  "  dashboardInsights: \"Erkenntnisse\",",
  "  dashboardRaidRegister: \"RAID-Register\",",
  "  dashboardUpcoming: \"Anstehend & überfällig\",",
  "  dashboardTrends: \"Trends\",",
  "  dashboardCompletionTrend: \"Fertigstellungsverlauf\",",
  "  dashboardTileMove: \"Verschieben\",",
  "  dashboardTileOptions: \"Kacheloptionen\",",
  "  dashboardTileWidth: \"Breite\",",
  "  dashboardTileHeight: \"Höhe\",",
  "  dashboardTileFixedAt: \"fest auf {0}\",",
  "  dashboardTileMoveEarlier: \"Nach vorne\",",
  "  dashboardTileMoveLater: \"Nach hinten\",",
  "  dashboardTileMoveFirst: \"An den Anfang\",",
  "  dashboardTileHide: \"Kachel ausblenden\",",
  "  dashboardTileRestore: \"Wiederherstellen\",",
  "  dashboardShelfCount: \"{0} ausgeblendet\",",
  "  dashboardShelfEmpty: \"Nichts ausgeblendet\",",
  "  dashboardResetLayout: \"Anordnung zurücksetzen\",",
  "  dashboardTileMoved: \"{0} auf Position {1} von {2} verschoben\",",
  "  dashboardTileHidden: \"{0} ausgeblendet\",",
  "  dashboardTileResized: \"{0} auf {1} mal {2} geändert\",",
].join("\r\n") + "\r\n";
const i = s.indexOf(anchor);
if (i < 0) throw new Error("anchor not found — check the key name and CRLF");
s = s.slice(0, i) + add + s.slice(i);
fs.writeFileSync(p, s, "utf8");
console.log("inserted");
'
```

If the anchor is not found, the file uses a different key — grep for a real one. **A node replace whose anchor uses `\n` silently no-ops on this CRLF file**, which is why the join above uses `\r\n`.

- [ ] **Step 3: Verify the umlauts survived**

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");
for (const w of ["überfällig","Höhe","zurücksetzen","geändert"]) console.log(w, s.includes(w));'
```
Expected: `true` for all four. The `i18n-encoding` test bans ASCII substitutes like `ueberfaellig`.

- [ ] **Step 4: Typecheck — this is what enforces EN/DE key parity**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`. A key in one file and not the other is a type error.

- [ ] **Step 5: Run the encoding test**

```bash
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/i18n.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/i18n.log
```
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(dashboard): add tile arrangement strings, EN + DE"
```

---

### Task 14: Wire into `dashboard-panel.tsx`

**Files:**
- Modify: `src/app/dashboard-panel.tsx`

- [ ] **Step 1: Record the current test state**

```bash
npx vitest run src/app/dashboard-panel.test.tsx --reporter=dot > /tmp/dp-before.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/dp-before.log
node -e "console.log('LINES', require('fs').readFileSync('src/app/dashboard-panel.tsx','utf8').split('\n').length)"
```
Expected: `EXIT=0`. Note both numbers — the line count matters for the 800-line ratchet, which counts one higher than `wc -l`.

- [ ] **Step 2: Build the tile body map**

Replace the masonry `<div className={`columns-1 lg:columns-2 xl:columns-3 …`}>` block and its eleven `break-inside-avoid` wrappers with a single record from tile id to the card element. Each entry holds exactly the JSX that wrapper used to contain, with the wrapper itself deleted:

```tsx
const tileBodies: Partial<Record<DashboardTileId, ReactNode>> = {
  kpi: <DashboardKpiStrip lang={lang} model={model} trends={trends} onNavigate={props.onNavigate} dc={dc} />,
  topActions: <DashboardTopActions lang={lang} topActions={topActions} onOpenAction={onOpenAction} dc={dc} />,
  insights: (
    <InsightsCard insights={allInsights} lang={lang} dc={dc} actions={props.insightActions}
      generatingId={props.insightGeneratingId} onCancelGenerate={props.onCancelInsightRecommendation}
      aiEnabled={props.insightAiEnabled} onOpen={openInsightEntity} isPopout={props.isPopout} />
  ),
  raid: <RaidRegisterCard lang={lang} topRaid={model.topRaid} onOpenRaid={onOpenRaid} showRaid={showRaid} />,
  upcoming: <UpcomingCard lang={lang} overdue={model.overdue} dueSoon={model.dueSoon} onOpenTask={onOpenTask} />,
  // ...one entry per catalogue id, each holding that card's existing JSX verbatim
};
```

The conditional guards (`topActions?.length`, `showRaid`, `activeInsightCount > 0`, …) move into the `TileGateInput` you build below — they no longer wrap the JSX.

- [ ] **Step 3: Build the gate and the layout**

```tsx
const gate: TileGateInput = {
  showRaid,
  showBudget,
  showChanges,
  showMilestones,
  tursoActive: !!props.tursoActive,
  hasTopActions: !!topActions?.length,
  hasInsights: activeInsightCount > 0,
  hasCompletionTrend: completionSeries.length >= 2,
};
const arrangement = useDashboardLayout({
  projectId: props.projectId ?? "default",
  gate,
  isPopout: props.isPopout,
});
const gridScrollRef = useRef<HTMLDivElement>(null);
const boardIds = arrangement.layout.board.map((t) => t.id);
const reorder = useListReorderDnd<DashboardTileId>({
  ids: boardIds,
  // ★ onMove, NOT onReorder. The board stores a size per tile, so a bare id
  // list cannot express the state — the pair form lets the layout engine own
  // the mutation and keep each tile's w/h.
  onMove: arrangement.move,
  scrollRef: gridScrollRef,
  keyboard: false,          // the ⋮ menu is this surface's keyboard path
  disabled: arrangement.readOnly,
});
```

`onMove` is the Phase A hook's pair callback. If Phase A shipped without it, add it there — with its test — before continuing; do not reconstruct the pair by diffing indices here.

- [ ] **Step 4: Render the grid**

```tsx
// ★★ RENDER previewOrder, NOT layout.board. The grid packs densely, so an edge
// marker on the target would routinely point at a slot the tile does not end up
// in. Rendering the would-be result makes the board reflow under the cursor and
// what you see is what you get on release. previewOrder === boardIds when no
// drag is in flight, so this costs nothing at rest.
const sizeById = new Map(arrangement.layout.board.map((t) => [t.id, t]));
const shown = reorder.previewOrder.map((id) => sizeById.get(id)!);

<DashboardGrid dc={dc} scrollRef={gridScrollRef}>
  {shown
    .filter((p) => tileById(p.id)?.gate(gate))
    .map((p, i, arr) => {
      const spec = tileById(p.id)!;
      const body = tileBodies[p.id];
      if (!body) return null;
      const title = t(lang, spec.labelKey);
      return (
        <DashboardTile
          key={p.id} id={p.id} title={title} w={p.w} h={p.h} lang={lang}
          readOnly={arrangement.readOnly}
          dragProps={reorder.itemProps(p.id)}
          handleProps={reorder.handleProps(p.id)}
          onOpenMenu={(anchor) => setMenu({ id: p.id, anchor, index: i, count: arr.length })}
        >
          {body}
        </DashboardTile>
      );
    })}
</DashboardGrid>
<DashboardShelf
  lang={lang}
  hidden={arrangement.layout.hidden.map((id) => ({ id, title: t(lang, tileById(id)!.labelKey) }))}
  onRestore={arrangement.restore}
  onHide={arrangement.hide}
  isDragging={reorder.isDragging}
/>
```

Keep the headline and footer zones exactly as they are — they are not arrangeable.

- [ ] **Step 5: Render the menu, wire its commands, and announce them**

The menu's `onMove` speaks in deltas; the layout engine speaks in target ids. Translate here, not in the menu:

```tsx
const [menu, setMenu] = useState<{ id: DashboardTileId; anchor: HTMLElement; index: number; count: number } | null>(null);
const [announcement, setAnnouncement] = useState("");

const moveByDelta = (id: DashboardTileId, delta: number | "first") => {
  const ids = arrangement.layout.board.map((t) => t.id);
  const i = ids.indexOf(id);
  if (i < 0) return;
  const j = delta === "first" ? 0 : i + delta;
  if (j < 0 || j >= ids.length) return;
  arrangement.move(id, ids[j]);
  const title = t(lang, tileById(id)!.labelKey);
  setAnnouncement(t(lang, "dashboardTileMoved", title, String(j + 1), String(ids.length)));
};
```

Render the menu inside `PopoverPanel` so the shared dismissal protocol applies:

```tsx
{menu && !arrangement.readOnly && (
  <PopoverPanel anchor={menu.anchor} onClose={() => setMenu(null)}>
    <DashboardTileMenu
      lang={lang}
      tileId={menu.id}
      title={t(lang, tileById(menu.id)!.labelKey)}
      w={sizeById.get(menu.id)!.w}
      h={sizeById.get(menu.id)!.h}
      index={menu.index}
      count={menu.count}
      onResize={(axis, v) => {
        arrangement.resize(menu.id, axis, v);
        const s = sizeById.get(menu.id)!;
        setAnnouncement(t(lang, "dashboardTileResized",
          t(lang, tileById(menu.id)!.labelKey),
          String(axis === "w" ? v : s.w), String(axis === "h" ? v : s.h)));
      }}
      onMove={(delta) => moveByDelta(menu.id, delta)}
      onHide={() => {
        arrangement.hide(menu.id);
        setAnnouncement(t(lang, "dashboardTileHidden", t(lang, tileById(menu.id)!.labelKey)));
      }}
      onClose={() => setMenu(null)}
    />
  </PopoverPanel>
)}
<p role="status" aria-live="polite" className="sr-only">{announcement}</p>
```

★ The live region is not decoration: the ⋮ menu is the keyboard reorder path, and without an announcement a keyboard user gets no feedback that anything moved.

Check `PopoverPanel`'s actual props before writing this — if it takes a trigger element rather than an anchor, restructure the menu button to match it rather than bypassing the component.

Add a `dashboardResetLayout` button near the shelf calling `arrangement.reset()`.

- [ ] **Step 6: Run the panel tests**

```bash
npx vitest run src/app/dashboard-panel.test.tsx --reporter=dot > /tmp/dp-after.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/dp-after.log
```
Expected: `EXIT=0`. Some existing tests assert masonry classes or card order — update those to the new structure. A **drop** in test count means a test stopped running; investigate rather than accept.

- [ ] **Step 7: Check the file-size ratchet**

```bash
node -e "console.log('LINES', require('fs').readFileSync('src/app/dashboard-panel.tsx','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/size.log
```
Expected: `EXIT=0`. If the panel grew past its baseline, extract `tileBodies` into its own module rather than trimming comments.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
git add src/app/dashboard-panel.tsx
git commit -m "feat(dashboard): replace the masonry flow with the arrangeable grid"
```

---

### Task 15: The geometry check jsdom cannot do

**Files:**
- Create: `e2e/dashboard-grid.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/dashboard-grid.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { seed } from "./seed";

test.describe("dashboard grid geometry", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/#dashboard");
  });

  test("renders four column tracks at xl", async ({ page }) => {
    // ★ The ONLY check that Tailwind actually emitted the grid classes. jsdom
    // has no layout, so no unit test can see this — and an interpolated class
    // name would fail here and nowhere else.
    const cols = await page.getByTestId("dashboard-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(cols).toBe(4);
  });

  test("collapses to two column tracks below xl", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 1000 });
    const cols = await page.getByTestId("dashboard-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(cols).toBe(2);
  });

  test("applies the 80px row unit at comfortable density", async ({ page }) => {
    const rows = await page.getByTestId("dashboard-grid")
      .evaluate((el) => getComputedStyle(el).gridAutoRows);
    expect(rows).toBe("80px");
  });

  test("packs densely — no leading gap before a narrow tile", async ({ page }) => {
    const grid = page.getByTestId("dashboard-grid");
    await expect(grid).toHaveCSS("grid-auto-flow", "row dense");
  });
});
```

- [ ] **Step 2: Confirm the spec loads without browsers**

```bash
npx playwright test e2e/dashboard-grid.spec.ts --list > /tmp/pwlist.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/pwlist.log
```
Expected: `EXIT=0`, four tests listed. This also proves `e2e/seed.ts`'s module-level sample read still resolves.

- [ ] **Step 3: Run it against a fresh server**

`globals.css` changed, so a stale dev server would serve un-regenerated Tailwind and produce phantom failures.

```bash
PORT=3100 npm run dev &
npx playwright test e2e/dashboard-grid.spec.ts --project=chromium --workers=1 > /tmp/pw.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/pw.log
PORT=3100 npm run stop
```
Expected: `EXIT=0`. If `gridTemplateColumns` returns one track, Tailwind did not emit the class — check for an interpolated class name.

- [ ] **Step 4: Commit**

```bash
git add e2e/dashboard-grid.spec.ts
git commit -m "test(e2e): measure the dashboard grid geometry jsdom cannot see"
```

---

### Task 16: Seed the dashboard tiles for the axe gate

**Files:**
- Modify: `e2e/seed.ts` if the dashboard's tiles do not all render under the current seed

- [ ] **Step 1: Check what the seed actually renders**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/axe.log
```
Expected: `EXIT=0`.

- [ ] **Step 2: Confirm at least two tiles are on the board at scan time**

A gate that scans a board with one tile cannot exercise the per-tile controls at all. Open the seeded dashboard in a browser and count the tiles. If the seed produces fewer than two, extend `e2e/seed.ts` so the Dashboard renders a populated board.

The duplicate-name defect this guards against is **still invisible to axe** — the unit test from Task 10 is the detector. Seeding matters so the scan sees the controls exist and are labelled at all.

- [ ] **Step 3: Commit any seed change**

```bash
git add e2e/seed.ts
git commit -m "test(e2e): seed a populated dashboard board for the axe scan"
```

---

### Task 17: Update the subsystem docs

**Files:**
- Modify: `docs/AGENTS/dashboard.md`

- [ ] **Step 1: Replace the masonry description**

The file currently opens with **"Layout = single masonry (CSS multicol, NOT a fixed grid)"** and explains why the old bento was replaced. That is now historically true but currently false. Rewrite it to describe the arrangeable grid, and keep one sentence of the bento history — it explains why dense packing matters.

Document, using symbol names and never line numbers:

- order-only placement plus `grid-auto-flow: row dense`, and that deliberate holes are therefore impossible
- `W_CLASS`/`H_CLASS` must stay literal strings, with the Tailwind reason
- the 80px/64px row unit, that 80 was eye-verified and 64 was not
- that a gated-off tile stays in the stored layout
- that the per-tile control names must be tile-unique and axe cannot see a collision
- that the ⋮ menu renders no chooser for an axis where `min === max`

- [ ] **Step 2: Run the doc gates**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/claims.log
```
Expected: `EXIT=0` for both. `docs:claims:check` is a ratchet — it fails if the doc gains a **new** `path:LINE` citation, which is why the step above says symbols only.

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS/dashboard.md
git commit -m "docs(dashboard): describe the arrangeable tile grid"
```

---

### Task 18: Full gate run

- [ ] **Step 1: Unit suite, unpiped**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```
Expected: `EXIT=0`.

- [ ] **Step 2: Shuffled suite**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```
Expected: `EXIT=0`. Mandatory — this adds many tests.

- [ ] **Step 3: Coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|threshold" /tmp/cov.log
```
Expected: `EXIT=0`. `dashboard-tiles.ts`, `dashboard-layout.ts`, `dashboard-layout-store.ts` and `use-dashboard-layout.ts` are all coverage-gated. They are logic, so add the missing branch test rather than an exclusion.

- [ ] **Step 4: Size, duplication, lint, types**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/dup.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: `EXIT=0` for all four.

- [ ] **Step 5: Axe on Dashboard, warm and single-worker**

```bash
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3000/
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/axe.log
```
Expected: `EXIT=0`. Read the failure body, not the summary: a real violation names a rule id and an impact; a `Test timeout` names neither and is contention or a cold compile.

- [ ] **Step 6: Prod CSP smoke**

```bash
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/build.log
npm run e2e:smoke:prod > /tmp/smoke.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/smoke.log
```
Expected: `EXIT=0` for both. This is the only gate that sees the production CSP, where `style-src-elem` is nonce-only.

- [ ] **Step 7: Eye-verify the compact row unit**

The spec records 64px compact as **not settled**. Switch Settings → Appearance to Compact, look at the board, and either confirm 64px or change it and re-run Task 8's test. Record which you did in the commit message.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): arrangeable tile grid — gates green, compact row unit verified"
```

---

## Definition of done

- A user can drag tiles into a new order, set width and height independently, hide tiles onto a shelf and restore them, entirely by keyboard as well as by mouse
- The arrangement survives a reload, is per project and per device, and never touches a backend write path
- A stored layout survives a catalogue change: unknown ids dropped, new tiles inserted at their author's intended position, sizes clamped per axis, gated-off tiles keeping their place
- Per-tile control names are tile-unique and pinned by a test rendering two tiles
- Grid geometry measured in a real browser, not asserted from class strings
- Every gate green, each read from an unpiped exit code
- `docs/AGENTS/dashboard.md` no longer describes a masonry that is gone
