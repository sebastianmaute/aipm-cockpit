# Burn-down chart hover readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering, focusing or tapping the budget chart tells the reader what every drawn line is worth at the position under the pointer, with a one-line explanation per line.

**Architecture:** A pure i18n-free module derives the snap dates and the rows from the existing `ChartModel`; a hook owns the active stop and turns pointer/keyboard input into one; a shared `TooltipSurface` (extracted verbatim from `InfoTooltip`) carries the box, so the app gains no second tooltip look; `burndown-chart.tsx` draws a guide line plus per-series dots and mounts the box. Nothing about what the chart draws changes.

**Tech Stack:** TypeScript, React 19 (Next 16), Tailwind v4 tokens, vitest + @testing-library/react, Playwright (axe + visual), i18n EN/DE dictionaries.

**Spec:** `docs/superpowers/specs/2026-09-17-burndown-chart-hover-readout-design.md`

## Global Constraints

- Read `AGENTS.md` before the first edit. It is always loaded for you; its "Hard constraints" section gates merges.
- `src/app/**` is CRLF. Use the Edit tool (it preserves line endings); never `sed -i` on a source file, and never rewrite a whole source file with the Write tool.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical — `npx tsc --noEmit` enforces it. DE must use real umlauts. **Edit `i18n.de.ts` only via a small Node script that writes UTF-8 and anchors on `\r\n`**, never with the Edit tool (it corrupts umlauts and curls quotes).
- Interpolation is 0-based positional: `t(lang, key, a, b)` → `{0}`, `{1}`.
- `Lang` is `"en-US" | "en-GB" | "de"`. Use `"en-US"` in tests; a DE assertion must `await loadI18n("de")` first.
- Palette: only sanctioned tokens from `globals.css` (`stroke-line`, `stroke-muted-foreground`, `fill-foreground`, `--rag-amber`, `ui-green`, `ui-dark-blue`, `ui-purple`, `surface`). No new colours, gradients or shadows.
- Every new interactive control needs an accessible name and keyboard operability. Never hand-roll a control that a primitive already covers; the one new element here is the chart's own trigger button, which is deliberate and specified below.
- Icons only from `src/app/icons.ts` (this plan needs none).
- Never read a gate's exit code through a pipe. Run `cmd > /tmp/x.log 2>&1; echo "EXIT=$?"` then grep the file.
- Never run two vitest processes at once. Pass `--maxWorkers=1` when the machine is busy.
- Run `npx tsc --noEmit` after editing ANY test file (vitest never typechecks).
- Lint with `npx eslint --max-warnings=0 <paths>`; every warning is fatal. `react-hooks/set-state-in-effect` is banned — no `useEffect` that calls a setter. A render body may not call `Date.now()`, `new Date()` or `Math.random()`.
- Commit messages: conventional prefix, no `#` followed by digits anywhere, and end with the trailer `Claude-Session: https://[session link removed]`.
- Stage by explicit path. Never `git add -A`, never `git add .`, never `git commit --amend`, never `git stash`. Never stage `not-in-use.env.local.bak` or `sample-workspace-huge.json`.
- Visual baselines must NOT change in this plan: the readout is hidden until hover/focus. A changed baseline means the idle chart moved — that is a defect in the change, not a baseline to refresh.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/burndown-readout.ts` (new) | Pure, i18n-free, formatter-free. Snap-date set, nearest-stop search, and the rows at a stop, derived from `ChartModel`. |
| `src/app/burndown-readout.test.ts` (new) | Unit tests for the above, over hand-built `ChartModel` fixtures. |
| `src/app/tooltip-surface.tsx` (new) | The portalled tooltip bubble lifted out of `info-tooltip.tsx`, unchanged in styling. |
| `src/app/info-tooltip.tsx` (modify) | Consumes `TooltipSurface`; behaviour and markup unchanged. |
| `src/app/use-chart-readout.ts` (new) | Active-stop state, pointer→stop mapping, arrow/Home/End/Escape handling, the box's clamped screen anchor. |
| `src/app/use-chart-readout.test.tsx` (new) | Tests the hook through a tiny harness component. |
| `src/app/chart-readout.tsx` (new) | Renders the rows (labels, values, explanations) inside `TooltipSurface`; exports `readoutSentence` for the live region. |
| `src/app/chart-readout.test.tsx` (new) | Row order, explanation lines, flags, sentence text. |
| `src/app/burndown-chart.tsx` (modify) | Trigger button around the SVG, guide line, per-series dots, the box, the polite live region. |
| `src/app/burndown-chart.test.tsx` (modify) | Pointer, keyboard and dismissal wiring. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` (modify) | New keys: trigger name, row labels not already present, short explanations, flag words. |
| `e2e/budget-chart-readout.spec.ts` (new) | Hover and keyboard readout on the Reports budget chart. |
| `e2e/a11y.spec.ts` (modify) | One Reports scan with the readout open. |
| `docs/AGENTS/dashboard.md` (modify) | Documents the readout, the stop rule and the test traps. |

---

## Task 1: The pure readout module

**Files:**
- Create: `src/app/burndown-readout.ts`
- Test: `src/app/burndown-readout.test.ts`

**Interfaces:**
- Consumes: `ChartModel`, `ChartPoint`, `BacMarker`, `scaleDate`, `daysBetweenUtc` from `./burndown-geometry`.
- Produces:
  ```ts
  export type ReadoutKind =
    | "plan" | "budget" | "baseline" | "actual" | "ev" | "evPoint"
    | "pace" | "efficiency" | "change" | "runOut";
  export type ReadoutRow = {
    kind: ReadoutKind;
    value: number;
    /** EV only: the point sits in a partial span. */
    partial?: boolean;
    /** pace/efficiency: the value is a forecast, not a record. */
    forecast?: boolean;
    /** change only: the bucket names behind the marker. */
    label?: string;
    /** change only: every entry behind the marker deleted its bucket. */
    removed?: boolean;
  };
  export type Readout = { date: string; today: boolean; rows: readonly ReadoutRow[] };
  export function readoutStops(model: ChartModel): readonly string[];
  export function readoutAt(model: ChartModel, date: string): Readout | null;
  export function nearestStop(
    stops: readonly string[], xDomain: readonly [string, string],
    x0: number, x1: number, x: number,
  ): string | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/app/burndown-readout.test.ts`. The fixture builder keeps every test honest about which field it is exercising — build the full `ChartModel` once and override per test.

```ts
import { describe, expect, it } from "vitest";
import type { ChartModel } from "./burndown-geometry";
import { nearestStop, readoutAt, readoutStops } from "./burndown-readout";

const BASE: ChartModel = {
  empty: false,
  xDomain: ["2026-01-01", "2026-03-01"],
  yDomain: [0, 100],
  total: 100,
  planned: [{ date: "2026-01-01", value: 100 }, { date: "2026-03-01", value: 0 }],
  actual: [{ date: "2026-01-01", value: 100 }, { date: "2026-02-01", value: 60 }],
  over: false,
  pace: {
    from: { date: "2026-02-01", value: 60 }, to: { date: "2026-03-01", value: 10 },
    endFigure: -10, vac: -10,
  },
  efficiency: {
    from: { date: "2026-02-01", value: 60 }, to: { date: "2026-03-01", value: 20 },
    endFigure: -5, vac: -5,
  },
  runOut: { date: "2026-02-15", value: 0 },
  ev: { date: "2026-02-01", value: 55 },
  evSegments: null,
  evJoins: [],
  evPartialNames: [],
  evUnavailable: null,
  bacSteps: null,
  bacBaseline: null,
  bacMarkers: [],
  bacLine: 100,
  today: "2026-02-01",
  planEnd: "2026-03-01",
  frameDiffers: false,
};
const model = (over: Partial<ChartModel>): ChartModel => ({ ...BASE, ...over });

describe("readoutStops", () => {
  it("unions every series date with today, plan end, markers and the run-out", () => {
    const stops = readoutStops(model({
      bacSteps: [{ date: "2026-01-01", value: 90 }, { date: "2026-01-20", value: 100 }],
      bacBaseline: 90,
      bacMarkers: [{ date: "2026-01-20", value: 100, amount: 10, label: "Vendor", removed: false }],
    }));
    expect(stops).toEqual([
      "2026-01-01", "2026-01-20", "2026-02-01", "2026-02-15", "2026-03-01",
    ]);
  });

  it("de-duplicates and sorts", () => {
    const stops = readoutStops(model({ actual: [{ date: "2026-03-01", value: 0 }] }));
    expect(stops).toEqual(["2026-01-01", "2026-02-01", "2026-02-15", "2026-03-01"]);
  });

  it("is empty for an empty model", () => {
    expect(readoutStops(model({ empty: true }))).toEqual([]);
  });
});

describe("readoutAt", () => {
  it("lists plan, budget and actual where their points exist", () => {
    const out = readoutAt(model({}), "2026-01-01")!;
    expect(out.rows.map((r) => [r.kind, r.value])).toEqual([
      ["plan", 100], ["budget", 100], ["actual", 100],
    ]);
    expect(out.today).toBe(false);
  });

  it("omits a series that has no point at the stop", () => {
    const out = readoutAt(model({}), "2026-02-01")!;
    expect(out.rows.some((r) => r.kind === "plan")).toBe(false);
    expect(out.rows.some((r) => r.kind === "actual")).toBe(true);
    expect(out.today).toBe(true);
  });

  it("reads the stepped budget at its current level, plus the baseline row", () => {
    const stepped = model({
      bacSteps: [{ date: "2026-01-01", value: 90 }, { date: "2026-01-20", value: 100 }],
      bacBaseline: 90,
      bacLine: null,
    });
    expect(readoutAt(stepped, "2026-01-01")!.rows.find((r) => r.kind === "budget")!.value).toBe(90);
    expect(readoutAt(stepped, "2026-02-01")!.rows.find((r) => r.kind === "budget")!.value).toBe(100);
    expect(readoutAt(stepped, "2026-02-01")!.rows.find((r) => r.kind === "baseline")!.value).toBe(90);
  });

  it("interpolates each forecast inside its own segment and omits it outside", () => {
    const at = readoutAt(model({}), "2026-02-15")!;
    const pace = at.rows.find((r) => r.kind === "pace")!;
    const eff = at.rows.find((r) => r.kind === "efficiency")!;
    // 14 of 28 days from 60 → 10 is 35; 60 → 20 is 40.
    expect(pace.value).toBeCloseTo(35, 5);
    expect(pace.forecast).toBe(true);
    expect(eff.value).toBeCloseTo(40, 5);
    const before = readoutAt(model({}), "2026-01-01")!;
    expect(before.rows.some((r) => r.kind === "pace" || r.kind === "efficiency")).toBe(false);
  });

  it("takes a forecast's own endpoint value rather than interpolating a zero-length span", () => {
    const flat = model({
      pace: {
        from: { date: "2026-02-01", value: 60 }, to: { date: "2026-02-01", value: 60 },
        endFigure: 0, vac: 0,
      },
    });
    expect(readoutAt(flat, "2026-02-01")!.rows.find((r) => r.kind === "pace")!.value).toBe(60);
  });

  it("flags a partial earned-value point and prefers a complete span on a shared boundary", () => {
    const withEv = model({
      evSegments: [
        { partial: true, points: [{ date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 55 }] },
        { partial: false, points: [{ date: "2026-02-01", value: 55 }, { date: "2026-03-01", value: 80 }] },
      ],
    });
    expect(readoutAt(withEv, "2026-01-01")!.rows.find((r) => r.kind === "ev")!.partial).toBe(true);
    expect(readoutAt(withEv, "2026-02-01")!.rows.find((r) => r.kind === "ev")!.partial).toBe(false);
  });

  it("adds the marker's names and signed amount on a change date", () => {
    const out = readoutAt(model({
      bacSteps: [{ date: "2026-01-01", value: 90 }, { date: "2026-01-20", value: 82 }],
      bacBaseline: 90,
      bacLine: null,
      bacMarkers: [{ date: "2026-01-20", value: 82, amount: -8, label: "Ops", removed: true }],
    }), "2026-01-20")!;
    const change = out.rows.find((r) => r.kind === "change")!;
    expect(change).toMatchObject({ value: -8, label: "Ops", removed: true });
  });

  it("adds the run-out row only on the run-out date", () => {
    expect(readoutAt(model({}), "2026-02-15")!.rows.some((r) => r.kind === "runOut")).toBe(true);
    expect(readoutAt(model({}), "2026-02-01")!.rows.some((r) => r.kind === "runOut")).toBe(false);
  });

  it("returns null when nothing is drawn at the date", () => {
    expect(readoutAt(model({ bacLine: null }), "2026-01-15")).toBeNull();
  });
});

describe("nearestStop", () => {
  const stops = ["2026-01-01", "2026-02-01", "2026-03-01"];

  it("picks the closest stop by x", () => {
    // x spans 0…60 over 59 days, so 2026-02-01 sits near 31.5.
    expect(nearestStop(stops, ["2026-01-01", "2026-03-01"], 0, 60, 30)).toBe("2026-02-01");
    expect(nearestStop(stops, ["2026-01-01", "2026-03-01"], 0, 60, 1)).toBe("2026-01-01");
    expect(nearestStop(stops, ["2026-01-01", "2026-03-01"], 0, 60, 100)).toBe("2026-03-01");
  });

  it("returns null with no stops", () => {
    expect(nearestStop([], ["2026-01-01", "2026-03-01"], 0, 60, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run src/app/burndown-readout.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Cannot find" /tmp/t1.log
```
Expected: EXIT=1, "Cannot find module './burndown-readout'".

- [ ] **Step 3: Write the module**

Create `src/app/burndown-readout.ts`:

```ts
// The hover/keyboard readout's pure half (spec A): which dates the readout can
// land on, and what every drawn series is worth there. i18n-free and
// formatter-free by design — `chart-readout.tsx` owns the words, the chart owns
// the number formatting, and this file owns only the arithmetic.
import { daysBetweenUtc, scaleDate, type ChartModel, type ChartPoint, type ChartSegment } from "./burndown-geometry";

export type ReadoutKind =
  | "plan" | "budget" | "baseline" | "actual" | "ev" | "evPoint"
  | "pace" | "efficiency" | "change" | "runOut";

export type ReadoutRow = {
  kind: ReadoutKind;
  value: number;
  /** EV only: the point sits in a partial span. */
  partial?: boolean;
  /** pace/efficiency: the value is a forecast, not a record. */
  forecast?: boolean;
  /** change only: the bucket names behind the marker. */
  label?: string;
  /** change only: every entry behind the marker deleted its bucket. */
  removed?: boolean;
};

export type Readout = { date: string; today: boolean; rows: readonly ReadoutRow[] };

/**
 * Every date the readout may land on: the union of all drawn series' own
 * points, today, the plan end, each budget-change marker and the run-out.
 *
 * ★ Deliberately NOT every calendar day. `actual` and the earned-value spans
 * carry ONE point per plan period, so a value between two points would be
 * invented; the two forecasts are straight segments, so reading along them at
 * a stop is exactly what the chart draws.
 */
export function readoutStops(model: ChartModel): readonly string[] {
  if (model.empty) return [];
  const dates = new Set<string>();
  const add = (list: readonly ChartPoint[]) => { for (const p of list) dates.add(p.date); };
  add(model.planned);
  add(model.actual);
  if (model.bacSteps) add(model.bacSteps);
  for (const seg of model.evSegments ?? []) add(seg.points);
  for (const marker of model.bacMarkers) dates.add(marker.date);
  for (const seg of [model.pace, model.efficiency]) {
    if (seg) { dates.add(seg.from.date); dates.add(seg.to.date); }
  }
  if (model.ev) dates.add(model.ev.date);
  if (model.runOut) dates.add(model.runOut.date);
  if (model.today) dates.add(model.today);
  dates.add(model.planEnd);
  return [...dates].sort();
}

/** The stop whose x is closest to `x`, in the SVG's own coordinate space. */
export function nearestStop(
  stops: readonly string[], xDomain: readonly [string, string],
  x0: number, x1: number, x: number,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const stop of stops) {
    const dist = Math.abs(scaleDate(stop, xDomain, x0, x1) - x);
    if (dist < bestDist) { best = stop; bestDist = dist; }
  }
  return best;
}

function pointAt(list: readonly ChartPoint[], date: string): number | null {
  const hit = list.find((p) => p.date === date);
  return hit ? hit.value : null;
}

/** The stepped budget's level at `date`: the last step at or before it. */
function steppedAt(steps: readonly ChartPoint[], date: string): number | null {
  let value: number | null = null;
  for (const p of steps) {
    if (p.date <= date) value = p.value;
  }
  return value;
}

/** A forecast's value along its straight segment, or null outside it. */
function segmentAt(seg: ChartSegment | null, date: string): number | null {
  if (!seg) return null;
  if (date < seg.from.date || date > seg.to.date) return null;
  const span = daysBetweenUtc(seg.from.date, seg.to.date);
  if (span <= 0) return seg.from.value;
  const gone = daysBetweenUtc(seg.from.date, date);
  return seg.from.value + ((seg.to.value - seg.from.value) * gone) / span;
}

/**
 * Earned value at `date`, with the partial flag of the span it belongs to.
 * ★ Neighbouring spans SHARE their boundary point and the span leading out of a
 * partial run is drawn as complete, so a boundary point that any complete span
 * holds is reported complete.
 */
function evAt(model: ChartModel, date: string): { value: number; partial: boolean } | null {
  let found: { value: number; partial: boolean } | null = null;
  for (const seg of model.evSegments ?? []) {
    const value = pointAt(seg.points, date);
    if (value === null) continue;
    if (!seg.partial) return { value, partial: false };
    found = { value, partial: true };
  }
  return found;
}

/** Every drawn series' value at one stop, in the legend's order. */
export function readoutAt(model: ChartModel, date: string): Readout | null {
  if (model.empty) return null;
  const rows: ReadoutRow[] = [];
  const push = (kind: ReadoutKind, value: number | null, extra: Omit<ReadoutRow, "kind" | "value"> = {}) => {
    if (value !== null) rows.push({ kind, value, ...extra });
  };
  push("plan", pointAt(model.planned, date));
  push("budget", model.bacSteps ? steppedAt(model.bacSteps, date) : model.bacLine);
  push("baseline", model.bacSteps ? model.bacBaseline : null);
  push("actual", pointAt(model.actual, date));
  const ev = evAt(model, date);
  if (ev) rows.push({ kind: "ev", value: ev.value, partial: ev.partial });
  // The singular EV point is drawn in BOTH orientations (the amber diamond), while
  // `evSegments` exists only in the cumulative one — so this row is the ONLY earned-value
  // row a reader gets in the default burn-down view, and in cumulative both may appear.
  if (model.ev && model.ev.date === date) rows.push({ kind: "evPoint", value: model.ev.value });
  push("pace", segmentAt(model.pace, date), { forecast: true });
  push("efficiency", segmentAt(model.efficiency, date), { forecast: true });
  const marker = model.bacMarkers.find((m) => m.date === date);
  if (marker) rows.push({ kind: "change", value: marker.amount, label: marker.label, removed: marker.removed });
  if (model.runOut && model.runOut.date === date) rows.push({ kind: "runOut", value: model.runOut.value });
  if (rows.length === 0) return null;
  return { date, today: model.today === date, rows };
}
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/burndown-readout.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/burndown-readout.ts src/app/burndown-readout.test.ts; echo "LINT_EXIT=$?"
```
Expected: all three EXIT=0; 14 tests pass.

- [ ] **Step 5: Mutation-check the two rules that a green suite can hide**

Make each edit, run the test file, confirm it goes RED, then revert it with an anchored Edit (never `git checkout --`) and confirm `git diff --stat` is empty for the file.

1. In `evAt`, change `if (!seg.partial) return { value, partial: false };` to `found = { value, partial: false };` → the shared-boundary test must fail.
2. In `segmentAt`, drop the `date > seg.to.date` half of the guard → the "omits it outside" test must fail.

If either mutant survives, the test is vacuous — fix the test, not the module.

- [ ] **Step 6: Commit**

```bash
git add src/app/burndown-readout.ts src/app/burndown-readout.test.ts
git commit -F - <<'EOF'
feat(chart): derive the budget chart's readout stops and rows

Pure, i18n-free half of the hover readout: the snap-date union (series
points, today, plan end, change markers, run-out), the nearest-stop search
in SVG coordinates, and every drawn series' value at one stop. Forecast
lines read along their own straight segment; the earned-value flag prefers a
complete span on a boundary point, matching how the line is drawn.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 2: Extract `TooltipSurface` from `InfoTooltip`

**Files:**
- Create: `src/app/tooltip-surface.tsx`
- Modify: `src/app/info-tooltip.tsx`
- Test: `src/app/info-tooltip.test.tsx` (must stay green unchanged), `src/app/tooltip-surface.test.tsx` (new)

**Interfaces:**
- Produces:
  ```ts
  export const TOOLTIP_SURFACE_CLASS: string;
  export function TooltipSurface(props: {
    top: number; left: number; className?: string; children: ReactNode;
  }): ReactNode;
  ```
- `InfoTooltip`'s rendered markup must be byte-identical to today's: `role="tooltip"`, `data-tooltip-portal`, the same inline style and the same class string.

- [ ] **Step 1: Write the failing test**

Create `src/app/tooltip-surface.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TOOLTIP_SURFACE_CLASS, TooltipSurface } from "./tooltip-surface";

describe("TooltipSurface", () => {
  it("portals a positioned tooltip carrying the shared class", () => {
    render(<TooltipSurface top={12} left={34}>hello</TooltipSurface>);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("hello");
    expect(tip).toHaveStyle({ top: "12px", left: "34px" });
    expect(tip.getAttribute("class")).toContain(TOOLTIP_SURFACE_CLASS);
    expect(tip).toHaveAttribute("data-tooltip-portal");
  });

  it("appends a caller class without dropping the shared one", () => {
    render(<TooltipSurface top={0} left={0} className="max-w-[22rem]">x</TooltipSurface>);
    const cls = screen.getByRole("tooltip").getAttribute("class") ?? "";
    expect(cls).toContain("max-w-[22rem]");
    expect(cls).toContain("border-line");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/tooltip-surface.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Cannot find" /tmp/t2.log
```
Expected: EXIT=1, module not found.

- [ ] **Step 3: Create the surface**

Create `src/app/tooltip-surface.tsx`:

```tsx
"use client";

// The tooltip bubble, lifted verbatim out of `info-tooltip.tsx` so the chart
// readout can reuse the one surface instead of hand-rolling a second tooltip
// look. Positioning stays the CALLER's job: `InfoTooltip` clamps against its
// trigger, the chart readout against the chart's own box.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** ★ The exact class string `InfoTooltip` shipped; changing it restyles every
 *  tooltip in the app, not just one. */
export const TOOLTIP_SURFACE_CLASS =
  "pointer-events-none fixed z-[100] w-max max-w-[16rem] rounded-md border border-line bg-surface px-2 py-1 text-xs font-normal normal-case text-foreground";

export function TooltipSurface({
  top, left, className, children,
}: { top: number; left: number; className?: string; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      role="tooltip"
      data-tooltip-portal
      style={{ top, left, transform: "translateX(-50%)" }}
      className={className ? `${TOOLTIP_SURFACE_CLASS} ${className}` : TOOLTIP_SURFACE_CLASS}
    >
      {children}
    </span>,
    document.body,
  );
}
```

- [ ] **Step 4: Make `InfoTooltip` consume it**

In `src/app/info-tooltip.tsx`, replace the portal block (the `{open && pos && typeof document !== "undefined" && createPortal(...)}` expression) with:

```tsx
      {open && pos && <TooltipSurface top={pos.top} left={pos.left}>{text}</TooltipSurface>}
```

Add `import { TooltipSurface } from "./tooltip-surface";` to the imports and drop the now-unused `createPortal` import (an unused import is a fatal lint warning).

- [ ] **Step 5: Run both test files plus the gates**

```bash
npx vitest run src/app/tooltip-surface.test.tsx src/app/info-tooltip.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/tooltip-surface.tsx src/app/tooltip-surface.test.tsx src/app/info-tooltip.tsx; echo "LINT_EXIT=$?"
```
Expected: EXIT=0 everywhere. `info-tooltip.test.tsx` passes **unedited** — that is the evidence the extraction changed no behaviour. If it needed an edit, the extraction is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/app/tooltip-surface.tsx src/app/tooltip-surface.test.tsx src/app/info-tooltip.tsx
git commit -F - <<'EOF'
refactor(ui): share the tooltip bubble as TooltipSurface

InfoTooltip's portalled bubble becomes a reusable surface so the budget
chart's readout uses the one tooltip look rather than a second hand-rolled
one. Markup, styling and positioning behaviour are unchanged, which
info-tooltip's own unedited test file pins.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: The readout hook

**Files:**
- Create: `src/app/use-chart-readout.ts`
- Test: `src/app/use-chart-readout.test.tsx`

**Interfaces:**
- Consumes: `readoutStops`/`nearestStop` from Task 1 (the caller passes the stop list in).
- Produces:
  ```ts
  export type ReadoutAnchor = { top: number; left: number };
  export type ChartReadoutApi = {
    /** The active stop's date, or null when the readout is closed. */
    stop: string | null;
    anchor: ReadoutAnchor | null;
    close: () => void;
    /** Spread on the element that wraps the SVG. */
    triggerProps: {
      ref: (el: HTMLElement | null) => void;
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
      onPointerLeave: () => void;
      onClick: (e: React.MouseEvent<HTMLElement>) => void;
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
      onBlur: () => void;
    };
  };
  export function useChartReadout(opts: {
    stops: readonly string[];
    xDomain: readonly [string, string];
    x0: number; x1: number; viewBoxWidth: number;
  }): ChartReadoutApi;
  ```
- Geometry contract: the wrapper's `getBoundingClientRect()` maps client x into the SVG's coordinate space as `((clientX - rect.left) / rect.width) * viewBoxWidth`. The anchor's `left` is the active stop's x mapped back to client space and clamped to `[rect.left + HALF, rect.right - HALF]` only when the rect is wider than the box; `top` is `rect.top + ANCHOR_TOP_PX`.

- [ ] **Step 1: Write the failing test**

Create `src/app/use-chart-readout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChartReadout } from "./use-chart-readout";

const STOPS = ["2026-01-01", "2026-02-01", "2026-03-01"];
const RECT = { left: 100, top: 50, width: 640, height: 240, right: 740, bottom: 290, x: 100, y: 50, toJSON: () => ({}) } as DOMRect;

function Harness() {
  const readout = useChartReadout({
    stops: STOPS, xDomain: ["2026-01-01", "2026-03-01"], x0: 64, x1: 560, viewBoxWidth: 640,
  });
  return (
    <div>
      <button type="button" {...readout.triggerProps}>chart</button>
      <output>{readout.stop ?? "closed"}</output>
      <span data-testid="anchor">{readout.anchor ? `${readout.anchor.top}/${Math.round(readout.anchor.left)}` : "none"}</span>
    </div>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

function stubRect() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
}

describe("useChartReadout", () => {
  it("starts closed", () => {
    stubRect();
    render(<Harness />);
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    expect(screen.getByTestId("anchor")).toHaveTextContent("none");
  });

  it("opens on pointer move at the nearest stop and closes on pointer leave", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    // Client 100 + 312 = the SVG's x 312, nearest the middle stop (x 312).
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    expect(screen.getByTestId("anchor")).toHaveTextContent("58/");
    await user.pointer({ target: document.body, coords: { clientX: 0, clientY: 0 } });
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("steps with the arrow keys and jumps with Home and End", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    await user.keyboard("{End}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-03-01");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-03-01");
    await user.keyboard("{Home}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
  });

  it("closes on Escape and on blur", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.tab();
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("toggles on click, for touch", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.click(trigger);
    expect(screen.getByRole("status")).not.toHaveTextContent("closed");
    await user.click(trigger);
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("stays closed with no stops", async () => {
    stubRect();
    function Empty() {
      const r = useChartReadout({ stops: [], xDomain: ["2026-01-01", "2026-03-01"], x0: 64, x1: 560, viewBoxWidth: 640 });
      return <><button type="button" {...r.triggerProps}>chart</button><output>{r.stop ?? "closed"}</output></>;
    }
    const user = userEvent.setup();
    render(<Empty />);
    await user.click(screen.getByRole("button", { name: "chart" }));
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/use-chart-readout.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Cannot find" /tmp/t3.log
```
Expected: EXIT=1, module not found.

- [ ] **Step 3: Write the hook**

Create `src/app/use-chart-readout.ts`:

```ts
"use client";

// Pointer/keyboard state for the budget chart's readout (spec A). Every value
// is computed inside a handler from a live `getBoundingClientRect`, so there is
// no effect that syncs state — `react-hooks/set-state-in-effect` is banned, and
// a rect read during render would be wrong on the first paint anyway.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { nearestStop } from "./burndown-readout";
import { scaleDate } from "./burndown-geometry";

export type ReadoutAnchor = { top: number; left: number };

/** Half the readout box's max width (`max-w-[22rem]` = 352px). */
const HALF = 176;
/** The box sits this far below the chart box's top edge. */
const ANCHOR_TOP_PX = 8;

export type ChartReadoutApi = {
  stop: string | null;
  anchor: ReadoutAnchor | null;
  close: () => void;
  triggerProps: {
    ref: (el: HTMLElement | null) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onClick: (e: MouseEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
};

export function useChartReadout({
  stops, xDomain, x0, x1, viewBoxWidth,
}: {
  stops: readonly string[];
  xDomain: readonly [string, string];
  x0: number; x1: number; viewBoxWidth: number;
}): ChartReadoutApi {
  const hostRef = useRef<HTMLElement | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<ReadoutAnchor | null>(null);

  const close = useCallback(() => { setStop(null); setAnchor(null); }, []);

  /** Screen position of a stop, clamped inside the chart's own box. */
  const anchorFor = useCallback((date: string): ReadoutAnchor | null => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const svgX = scaleDate(date, xDomain, x0, x1);
    const raw = rect.left + (svgX / viewBoxWidth) * rect.width;
    const left = rect.width > HALF * 2
      ? Math.min(Math.max(raw, rect.left + HALF), rect.right - HALF)
      : raw;
    return { top: rect.top + ANCHOR_TOP_PX, left };
  }, [x0, x1, viewBoxWidth, xDomain]);

  const showStop = useCallback((date: string | null) => {
    if (date === null) { close(); return; }
    setStop(date);
    setAnchor(anchorFor(date));
  }, [anchorFor, close]);

  const move = useCallback((clientX: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) { close(); return; }
    const svgX = ((clientX - rect.left) / rect.width) * viewBoxWidth;
    showStop(nearestStop(stops, xDomain, x0, x1, svgX));
  }, [close, showStop, stops, viewBoxWidth, x0, x1, xDomain]);

  const step = useCallback((delta: number | "first" | "last") => {
    if (stops.length === 0) return;
    const at = stop === null ? -1 : stops.indexOf(stop);
    const next = delta === "first" ? 0
      : delta === "last" ? stops.length - 1
      : Math.min(Math.max(at < 0 ? 0 : at + delta, 0), stops.length - 1);
    showStop(stops[next]);
  }, [showStop, stop, stops]);

  // A scroll or resize invalidates the rect the anchor was computed from, and
  // re-anchoring mid-scroll would chase the pointer — close, exactly as
  // `InfoTooltip` does.
  useEffect(() => {
    if (stop === null) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [close, stop]);

  return {
    stop, anchor, close,
    triggerProps: {
      ref: (el) => { hostRef.current = el; },
      onPointerMove: (e) => move(e.clientX),
      onPointerLeave: close,
      onClick: (e) => {
        e.preventDefault();
        if (stop !== null) { close(); return; }
        move(e.clientX);
        // A keyboard/assistive click reports clientX 0, which would snap to the
        // first stop by accident; fall back to today's end of the series.
        if (e.clientX === 0) step("first");
      },
      onKeyDown: (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        else if (e.key === "Home") { e.preventDefault(); step("first"); }
        else if (e.key === "End") { e.preventDefault(); step("last"); }
        else if (e.key === "Escape") { close(); }
      },
      onBlur: close,
    },
  };
}
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/use-chart-readout.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/use-chart-readout.ts src/app/use-chart-readout.test.tsx; echo "LINT_EXIT=$?"
```
Expected: all EXIT=0, 7 tests pass. If the anchor assertion's number disagrees with the geometry, recompute it from the stub rect rather than loosening the assertion: `left = 100 + (312/640)*640 = 412`, clamped to `[276, 564]` → 412; `top = 50 + 8 = 58`.

- [ ] **Step 5: Mutation-check the stepping clamp**

Change `Math.min(Math.max(..., 0), stops.length - 1)` to `at + delta` (unclamped) and run the file: the End-then-ArrowRight assertion must fail with `undefined`. Revert with an anchored Edit and confirm `git diff --stat` is empty for the file.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-chart-readout.ts src/app/use-chart-readout.test.tsx
git commit -F - <<'EOF'
feat(chart): pointer and keyboard state for the chart readout

Owns the active snap stop and the box's clamped screen anchor: pointer move
maps client x into the SVG's space and snaps to the nearest stop; the arrow
keys step, Home and End jump, Escape and blur close, and a click toggles for
touch. Every rect is read inside a handler, so no effect syncs state.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 4: The readout box and its words

**Files:**
- Create: `src/app/chart-readout.tsx`
- Test: `src/app/chart-readout.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Consumes: `Readout`, `ReadoutRow`, `ReadoutKind` (Task 1); `TooltipSurface`, `ReadoutAnchor` (Tasks 2-3).
- Produces:
  ```ts
  export function ChartReadout(props: {
    lang: Lang; readout: Readout; anchor: ReadoutAnchor;
    fmt: (value: number) => string; locale: string;
  }): ReactNode;
  export function readoutSentence(
    lang: Lang, readout: Readout, fmt: (value: number) => string, locale: string,
  ): string;
  ```
- Row labels reuse existing keys where they exist: `burndownPlanned`, `burndownActual`, `burndownEvHistory`, `burndownEvPartial`, `forecastPaceTitle`, `forecastEfficiencyTitle`, `burndownBacBaseline`, `forecastRunOut`. New keys cover the rest.

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, next to the other `burndown*` keys (after `burndownBacBaseline`), add with the Edit tool:

```ts
  burndownReadoutTrigger:
    "Read the chart's values: press the left and right arrow keys to step through each recorded point.",
  burndownReadoutBudget: "Budget",
  burndownReadoutChange: "Budget change",
  burndownReadoutForecast: "forecast",
  burndownReadoutPartialFlag: "partial",
  burndownReadoutTodayFlag: "today",
  burndownReadoutTipPlan: "What the plan expected to be spent by this date.",
  burndownReadoutTipBudget: "The budget at completion in force on this date.",
  burndownReadoutTipBaseline: "The budget at completion before the first recorded change.",
  burndownReadoutTipActual: "The value of all hours booked up to this date.",
  burndownReadoutTipEv: "The budget value of the work finished by this date.",
  burndownReadoutTipEvPoint: "The budget value of all work finished so far.",
  burndownReadoutTipPace: "Where spending lands if it continues at the recent daily average.",
  burndownReadoutTipEfficiency: "Where spending lands if the remaining work costs what finished work did.",
  burndownReadoutTipChange: "A recorded change to the budget, summed over this period.",
  burndownReadoutTipRunOut: "The day the budget is used up at the current pace.",
  burndownReadoutSentence: "{0}: {1}",
```

- [ ] **Step 2: Add the DE keys with a Node script**

`i18n.de.ts` is CRLF and holds umlauts; the Edit tool corrupts them. Write and run this script from the scratchpad (`node <path>`), never inline with `node -e` (the quoting eats backslashes):

```js
import { readFileSync, writeFileSync } from "node:fs";
const p = "C:/Projects/aipm-cockpit/src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
const anchor = '  burndownBacBaseline:';
const i = s.indexOf(anchor);
if (i < 0 || s.indexOf(anchor, i + 1) >= 0) { console.log("ANCHOR", i); process.exit(1); }
const block = [
  '  burndownReadoutTrigger:',
  '    "Werte des Diagramms lesen: mit den Pfeiltasten links und rechts durch die erfassten Punkte gehen.",',
  '  burndownReadoutBudget: "Budget",',
  '  burndownReadoutChange: "Budgetänderung",',
  '  burndownReadoutForecast: "Prognose",',
  '  burndownReadoutPartialFlag: "teilweise",',
  '  burndownReadoutTodayFlag: "heute",',
  '  burndownReadoutTipPlan: "Was der Plan bis zu diesem Datum an Ausgaben erwartet hat.",',
  '  burndownReadoutTipBudget: "Das zu diesem Datum gültige Budget bei Fertigstellung.",',
  '  burndownReadoutTipBaseline: "Das Budget bei Fertigstellung vor der ersten erfassten Änderung.",',
  '  burndownReadoutTipActual: "Der Wert aller bis zu diesem Datum gebuchten Stunden.",',
  '  burndownReadoutTipEv: "Der Budgetwert der bis zu diesem Datum fertiggestellten Arbeit.",',
  '  burndownReadoutTipEvPoint: "Der Budgetwert der bisher fertiggestellten Arbeit.",',
  '  burndownReadoutTipPace: "Wohin die Ausgaben laufen, wenn das Tagesmittel der letzten Zeit anhält.",',
  '  burndownReadoutTipEfficiency: "Wohin die Ausgaben laufen, wenn die restliche Arbeit so viel kostet wie die fertige.",',
  '  burndownReadoutTipChange: "Eine erfasste Budgetänderung, summiert über diese Periode.",',
  '  burndownReadoutTipRunOut: "Der Tag, an dem das Budget beim aktuellen Tempo aufgebraucht ist.",',
  '  burndownReadoutSentence: "{0}: {1}",',
].join("\r\n") + "\r\n";
s = s.slice(0, i) + block + s.slice(i);
writeFileSync(p, s, "utf8");
const lf = (s.match(/(?<!\r)\n/g) || []).length;
console.log("bare LF count (must be 0):", lf);
```

Then verify the file is still CRLF and the umlauts survived:

```bash
git ls-files --eol src/app/i18n.de.ts            # expect i/lf w/crlf
grep -c "Budgetänderung" src/app/i18n.de.ts      # expect 1
grep -c "fuer\|aenderung" src/app/i18n.de.ts     # expect 0 new ASCII substitutes
npx tsc --noEmit; echo "TSC_EXIT=$?"             # key parity gate
```

- [ ] **Step 3: Write the failing component test**

Create `src/app/chart-readout.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Readout } from "./burndown-readout";
import { ChartReadout, readoutSentence } from "./chart-readout";

const fmt = (v: number) => `${v} EUR`;
const full: Readout = {
  date: "2026-02-01",
  today: true,
  rows: [
    { kind: "plan", value: 80 },
    { kind: "budget", value: 100 },
    { kind: "baseline", value: 90 },
    { kind: "actual", value: 70 },
    { kind: "ev", value: 65, partial: true },
    { kind: "evPoint", value: 64 },
    { kind: "pace", value: 60, forecast: true },
    { kind: "efficiency", value: 55, forecast: true },
    { kind: "change", value: -8, label: "Ops", removed: true },
    { kind: "runOut", value: 0 },
  ],
};

describe("ChartReadout", () => {
  it("lists every row in the legend's order with its value", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toContain("Planned");
    expect(rows[0]).toContain("80 EUR");
    expect(rows[1]).toContain("Budget");
    expect(rows[2]).toContain("Budget at start of recording");
    expect(rows[3]).toContain("Actual");
    expect(rows[4]).toContain("Partial earned value");
    // "Earned value (today)" (`burndownEv`), NOT "Earned value" (`burndownEvHistory`) — a bare
    // "Earned value" here is a substring of both and would pass against the wrong key.
    expect(rows[5]).toContain("Earned value (today)");
    expect(rows[5]).toContain("64 EUR");
    expect(rows[6]).toContain("At current pace");
    expect(rows[7]).toContain("At current efficiency");
    expect(rows[8]).toContain("Ops");
    expect(rows[9]).toContain("Runs out");
  });

  // Every tip is asserted BY NAME. An earlier cut checked two of them, which left seven
  // strings written, read and never tested — the vacuous-coverage shape this repo keeps
  // being bitten by. One case per row kind, so a missing or mis-mapped tip fails here.
  it.each([
    ["What the plan expected to be spent by this date."],
    ["The budget at completion in force on this date."],
    ["The budget at completion before the first recorded change."],
    ["The value of all hours booked up to this date."],
    ["The budget value of the work finished by this date."],
    ["The budget value of all work finished so far."],
    ["Where spending lands if it continues at the recent daily average."],
    ["Where spending lands if the remaining work costs what finished work did."],
    ["A recorded change to the budget, summed over this period."],
    ["The day the budget is used up at the current pace."],
  ])("carries the explanation %s", (tip) => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    expect(screen.getByText(tip)).toBeInTheDocument();
  });

  it("marks the forecasts as forecasts and says when the date is today", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    expect(screen.getAllByText("forecast")).toHaveLength(2);
    expect(screen.getByRole("tooltip")).toHaveTextContent("today");
  });

  it("signs a change amount and names a deletion", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale="en-US" />);
    const change = screen.getAllByRole("listitem")[8].textContent ?? "";
    expect(change).toContain("-8 EUR");
    expect(change).toContain("removed");
  });

  it("signs a positive change with a plus", () => {
    const plus: Readout = { date: "2026-02-01", today: false, rows: [{ kind: "change", value: 8, label: "Vendor", removed: false }] };
    render(<ChartReadout lang="en-US" readout={plus} anchor={{ top: 0, left: 0 }} fmt={fmt} locale="en-US" />);
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("+8 EUR");
  });

  it("positions the box at the anchor", () => {
    render(<ChartReadout lang="en-US" readout={full} anchor={{ top: 33, left: 44 }} fmt={fmt} locale="en-US" />);
    expect(screen.getByRole("tooltip")).toHaveStyle({ top: "33px", left: "44px" });
  });
});

describe("readoutSentence", () => {
  it("names the date and every row for the live region", () => {
    const text = readoutSentence("en-US", full, fmt, "en-US");
    expect(text).toContain("1 Feb 2026");
    expect(text).toContain("Planned: 80 EUR");
    expect(text).toContain("At current pace: 60 EUR");
    expect(text).toContain("Ops");
  });

  it("is empty for a readout with no rows", () => {
    expect(readoutSentence("en-US", { date: "2026-02-01", today: false, rows: [] }, fmt, "en-US")).toBe("");
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run src/app/chart-readout.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Cannot find" /tmp/t4.log
```
Expected: EXIT=1, module not found.

- [ ] **Step 5: Write the component**

Create `src/app/chart-readout.tsx`:

```tsx
"use client";

// The readout box (spec A): one row per drawn series at the active stop, each
// with its colour swatch, value and a one-line explanation. It renders inside
// the shared `TooltipSurface`, so the app keeps ONE tooltip look. Formatting
// arrives as `fmt` from the chart, which owns the unit (€ or hours).
import { type Lang, t, type TranslationKey } from "./i18n";
import { formatDayMonthYear, signedFigure } from "./forecast-format";
import { TooltipSurface } from "./tooltip-surface";
import type { Readout, ReadoutKind, ReadoutRow } from "./burndown-readout";
import type { ReadoutAnchor } from "./use-chart-readout";

/** Label, explanation and swatch per row kind. The swatch classes mirror the
 *  lines `burndown-chart.tsx` draws; the dash patterns are not repeated, since
 *  the row's own words carry the meaning. */
const ROW: Record<ReadoutKind, { label: TranslationKey; tip: TranslationKey; swatch: string }> = {
  plan: { label: "burndownPlanned", tip: "burndownReadoutTipPlan", swatch: "bg-muted-foreground" },
  budget: { label: "burndownReadoutBudget", tip: "burndownReadoutTipBudget", swatch: "bg-muted-foreground" },
  baseline: { label: "burndownBacBaseline", tip: "burndownReadoutTipBaseline", swatch: "bg-muted-foreground" },
  actual: { label: "burndownActual", tip: "burndownReadoutTipActual", swatch: "bg-ui-green" },
  ev: { label: "burndownEvHistory", tip: "burndownReadoutTipEv", swatch: "bg-[var(--rag-amber)]" },
  // The diamond's own legend wording is `burndownEv`, NOT `burndownEvHistory` — the two are
  // different series and both can appear at one stop in the cumulative orientation.
  evPoint: { label: "burndownEv", tip: "burndownReadoutTipEvPoint", swatch: "bg-[var(--rag-amber)]" },
  pace: { label: "forecastPaceTitle", tip: "burndownReadoutTipPace", swatch: "bg-ui-dark-blue" },
  efficiency: { label: "forecastEfficiencyTitle", tip: "burndownReadoutTipEfficiency", swatch: "bg-ui-purple" },
  change: { label: "burndownReadoutChange", tip: "burndownReadoutTipChange", swatch: "bg-muted-foreground" },
  runOut: { label: "forecastRunOut", tip: "burndownReadoutTipRunOut", swatch: "bg-ui-pink" },
};

/** A partial earned-value point names the partial line, not the solid one. */
function labelKey(row: ReadoutRow): TranslationKey {
  return row.kind === "ev" && row.partial ? "burndownEvPartial" : ROW[row.kind].label;
}

/** A change row reads "+€3,000 Vendor" / "−€800 Ops removed"; every other row
 *  reads its plain formatted value. */
function valueText(lang: Lang, row: ReadoutRow, fmt: (v: number) => string): string {
  if (row.kind !== "change") return fmt(row.value);
  const amount = signedFigure(fmt(row.value), row.value);
  return row.removed
    ? t(lang, "burndownBacMarkerRemoved", amount, row.label ?? "")
    : `${amount} ${row.label ?? ""}`;
}

function rowText(lang: Lang, row: ReadoutRow, fmt: (v: number) => string): string {
  return t(lang, "burndownReadoutSentence", t(lang, labelKey(row)), valueText(lang, row, fmt));
}

/** The live region's text: the date, then every row, semicolon separated. */
export function readoutSentence(
  lang: Lang, readout: Readout, fmt: (v: number) => string, locale: string,
): string {
  if (readout.rows.length === 0) return "";
  const head = readout.today
    ? `${formatDayMonthYear(readout.date, locale)} (${t(lang, "burndownReadoutTodayFlag")})`
    : formatDayMonthYear(readout.date, locale);
  return [head, ...readout.rows.map((row) => rowText(lang, row, fmt))].join("; ");
}

export function ChartReadout({
  lang, readout, anchor, fmt, locale,
}: {
  lang: Lang; readout: Readout; anchor: ReadoutAnchor;
  fmt: (value: number) => string; locale: string;
}) {
  if (readout.rows.length === 0) return null;
  return (
    <TooltipSurface top={anchor.top} left={anchor.left} className="max-w-[22rem]">
      {/* aria-hidden: the polite live region in `burndown-chart.tsx` is the
          accessible channel, so this box must not be announced twice. */}
      <span aria-hidden="true" className="block">
        <span className="block font-semibold tabular-nums">
          {formatDayMonthYear(readout.date, locale)}
          {readout.today && <span className="ml-1 font-normal text-muted-foreground">{t(lang, "burndownReadoutTodayFlag")}</span>}
        </span>
        <span role="list" className="mt-1 block space-y-1">
          {readout.rows.map((row) => (
            <span role="listitem" key={row.kind} className="block">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${ROW[row.kind].swatch}`} />
                <span className="font-medium">{t(lang, labelKey(row))}</span>
                <span className="ml-auto pl-2 tabular-nums">{valueText(lang, row, fmt)}</span>
                {row.forecast && <span className="text-muted-foreground">({t(lang, "burndownReadoutForecast")})</span>}
              </span>
              <span className="block pl-3.5 text-muted-foreground">{t(lang, ROW[row.kind].tip)}</span>
            </span>
          ))}
        </span>
      </span>
    </TooltipSurface>
  );
}
```

- [ ] **Step 6: Run the tests and the gates**

```bash
npx vitest run src/app/chart-readout.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/chart-readout.tsx src/app/chart-readout.test.tsx src/app/i18n.ts src/app/i18n.de.ts; echo "LINT_EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts src/app/i18n-plural.test.ts > /tmp/t4b.log 2>&1; echo "ENC_EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4b.log
```
Expected: all EXIT=0. `i18n-encoding.test.ts` is the test that bans ASCII umlaut substitutes (`fuer`, `druecken`); `i18n.test.ts` covers the dictionaries themselves.

- [ ] **Step 7: Commit**

```bash
git add src/app/chart-readout.tsx src/app/chart-readout.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(chart): render the readout box and its spoken sentence

One row per drawn series at the active stop: swatch, label, value and a
one-line explanation, inside the shared tooltip surface. A change row keeps
the marker's signed amount and bucket names, a partial earned-value point
names the partial line, and readoutSentence builds the text the chart
announces politely. EN and DE keys added in step.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 5: Wire it into the chart

**Files:**
- Modify: `src/app/burndown-chart.tsx`
- Test: `src/app/burndown-chart.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1, 3 and 4.
- Produces: the chart renders `data-readout-guide` (the vertical guide line), `data-readout-dot` (one per row that has a drawn point), the box, and a `data-readout-live` polite region. Later specs (B and C) rely on none of these names, but the e2e spec in Task 6 does.

- [ ] **Step 1: Write the failing wiring test**

Append to `src/app/burndown-chart.test.tsx` (keep the file's existing imports and fixture helpers; add what is missing):

```tsx
describe("hover readout", () => {
  const RECT = { left: 0, top: 0, width: 640, height: 240, right: 640, bottom: 240, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

  afterEach(() => { vi.restoreAllMocks(); });

  it("is absent until the chart is hovered or focused", () => {
    render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.querySelector("[data-readout-guide]")).toBeNull();
  });

  it("shows the guide line, a dot per drawn point and the box on hover", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
    const user = userEvent.setup();
    render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
    await user.pointer({ target: screen.getByRole("button", { name: /arrow keys/i }), coords: { clientX: 312, clientY: 100 } });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(document.querySelector("[data-readout-guide]")).not.toBeNull();
    expect(document.querySelectorAll("[data-readout-dot]").length).toBeGreaterThan(0);
  });

  it("steps with the keyboard and announces the stop politely", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
    const user = userEvent.setup();
    render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    const live = document.querySelector("[data-readout-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live?.textContent ?? "").toContain("Planned");
  });

  it("keeps the chart's own description on the image", () => {
    render(<BurndownChart lang="en-US" currency="EUR" model={MODEL} unit="eur" orientation="cumulative" periods={["Jan", "Mar"]} />);
    expect(screen.getByRole("img").getAttribute("aria-label") ?? "").toContain("in ");
  });

  it("renders no trigger for an empty model", () => {
    render(<BurndownChart lang="en-US" currency="EUR" model={{ ...MODEL, empty: true }} unit="eur" orientation="cumulative" periods={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

`MODEL` is the file's existing chart-model fixture; if it has none, add the same `BASE`/`model()` builder used in `burndown-readout.test.ts` (copy it — a shared test fixture module is not worth a new file for two callers).

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/burndown-chart.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Unable to find" /tmp/t5.log
```
Expected: EXIT=1 — no button with that name.

- [ ] **Step 3: Wire the chart**

In `src/app/burndown-chart.tsx`:

1. Add the imports:

```tsx
import { ChartReadout, readoutSentence } from "./chart-readout";
import { readoutAt, readoutStops } from "./burndown-readout";
import { useChartReadout } from "./use-chart-readout";
```

2. Hooks must run unconditionally, and the component returns early for an empty model. Split the file so the early return happens in the exported wrapper and the hook lives in the body:

```tsx
export function BurndownChart(props: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
}) {
  if (props.model.empty) return <p className="text-sm text-muted-foreground">{t(props.lang, "dashboardNoBudget")}</p>;
  return <BurndownChartBody {...props} />;
}

function BurndownChartBody({
  lang, currency, model, unit, orientation, periods,
}: {
  lang: Lang; currency: string; model: ChartModel; unit: ChartUnit; orientation: ChartOrientation; periods: readonly string[];
}) {
```

Everything else in today's body stays as it is, minus the `if (model.empty)` line it used to open with.

3. After `const y = ...` and the other geometry consts, add the readout state. `readoutStops` walks the model, so memoize it on the model identity:

```tsx
  const stops = useMemo(() => readoutStops(model), [model]);
  const readout = useChartReadout({ stops, xDomain: model.xDomain, x0: X0, x1: X1, viewBoxWidth: W });
  const active = readout.stop === null ? null : readoutAt(model, readout.stop);
  const activeX = readout.stop === null ? null : x(readout.stop);
  const announce = active ? readoutSentence(lang, active, fmt, locale) : "";
```

Add `useMemo` to the React import (the file currently imports no hooks; add `import { useMemo } from "react";`).

4. Wrap the `<svg>` in the trigger button, inside the existing `<div>`:

```tsx
        <button
          type="button"
          {...readout.triggerProps}
          aria-label={t(lang, "burndownReadoutTrigger")}
          className="block w-full cursor-crosshair rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green print:cursor-auto"
        >
          <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={aria.join(" ")}>
            {/* …unchanged chart content… */}
```

5. As the LAST children inside the `<svg>` (so they paint over the lines), add the guide line and the dots. `aria-hidden` and `pointer-events-none` keep them out of both the accessibility tree and the pointer path:

```tsx
          {activeX !== null && active && (
            <g aria-hidden="true" className="pointer-events-none print:hidden">
              <line data-readout-guide="" x1={activeX} y1={yTop} x2={activeX} y2={yBottom} className="stroke-foreground" strokeWidth={1} />
              {active.rows
                .filter((row) => row.kind !== "change")
                .map((row) => (
                  <circle data-readout-dot="" key={row.kind} cx={activeX} cy={y(row.value)} r={2.5} className="fill-foreground" />
                ))}
            </g>
          )}
```

6. After the `</button>`, still inside the same `<div>`, mount the box and the live region:

```tsx
        {active && readout.anchor && (
          <span className="print:hidden">
            <ChartReadout lang={lang} readout={active} anchor={readout.anchor} fmt={fmt} locale={locale} />
          </span>
        )}
        <span data-readout-live="" aria-live="polite" className="sr-only">{announce}</span>
```

The change row is excluded from the dots on purpose: its value is a delta, not a position on any line, so a dot at `y(amount)` would sit at a meaningless height.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/burndown-chart.test.tsx src/app/burndown-chart-panel.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/burndown-chart.tsx src/app/burndown-chart.test.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/burndown-chart.tsx','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE_EXIT=$?"; tail -3 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP_EXIT=$?"; tail -3 /tmp/dup.log
git ls-files --eol src/app/burndown-chart.tsx    # expect i/lf w/crlf
```
Expected: every EXIT=0. The file-size limit is 1600 counted as `wc -l` + 1, so the printed number must stay under it.

- [ ] **Step 5: Check the idle chart did not move**

The readout is hidden until hover or focus, so no visual baseline may change. Run the two Reports captures and the dashboard one:

```bash
npx playwright test e2e/visual.spec.ts --project=visual -g "budget history" > /tmp/v1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/v1.log
```
Expected: EXIT=0 with no snapshot written. A diff here means the wrapper button changed the idle layout — fix the change (the button must be `block w-full` with no padding or margin), never update the baseline.

- [ ] **Step 6: Commit**

```bash
git add src/app/burndown-chart.tsx src/app/burndown-chart.test.tsx
git commit -F - <<'EOF'
feat(chart): read values off the budget chart on hover, focus or tap

The chart becomes one trigger: pointing at it snaps a guide line to the
nearest recorded date, dots each drawn line there and opens a box naming
every series' value with a one-line explanation. Arrow keys step the same
stops, Home and End jump, Escape closes, and a polite live region announces
the same text. The image keeps its full description, and the idle chart is
unchanged, so no visual baseline moves.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 6: Browser coverage and docs

**Files:**
- Create: `e2e/budget-chart-readout.spec.ts`
- Modify: `e2e/a11y.spec.ts`, `docs/AGENTS/dashboard.md`

**Interfaces:**
- Consumes: the `data-readout-*` hooks and the trigger's accessible name from Task 5.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/budget-chart-readout.spec.ts`, following the conventions of the existing Reports specs (read `e2e/seed-content.spec.ts` first for the seeding and navigation helpers this repo uses, and reuse them rather than re-rolling navigation). In `e2e/`, `getByRole` name matching is a case-insensitive substring by default — pass `exact: true` where a name could collide.

```ts
// `./seed` re-exports playwright's `test`/`expect` wrapped with this repo's
// seeding, plus `gotoApp` (frozen clock + shell ready) and `openView`. The seed
// carries the budget history this spec needs.
import { test, expect, gotoApp, openView } from "./seed";

test("the budget chart reads out values on hover and from the keyboard", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
  await gotoApp(page);
  await openView(page, "Reports");
  const block = page.getByTestId("report-block-budget-report");
  const trigger = block.getByRole("button", { name: /arrow keys/i });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  const box = await trigger.boundingBox();
  if (!box) throw new Error("chart has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Actual");
  await expect(page.locator("[data-readout-guide]")).toHaveCount(1);

  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.locator("[data-readout-live]")).toContainText("Planned");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
```

`report-block-budget-report` is the test id Reports stamps on every block; `e2e/visual.spec.ts`'s "visual: Reports budget history (cumulative)" test is the working reference for this navigation, including the tour suppression. Read it before writing this spec.

★ A `has:` locator resolves RELATIVE to each candidate, so build any `page.getByRole(...)` used inside a `has:`/`locator()` filter from `page`, never from `block` — a block-prefixed one looks for the block inside the candidate and matches nothing (measured on that visual test).

- [ ] **Step 2: Run it**

```bash
npx playwright test e2e/budget-chart-readout.spec.ts --project=chromium > /tmp/e1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e1.log
```
Expected: EXIT=0. A `Received: 0` on the trigger usually means a stale `.next` — stop the dev server, `Remove-Item -Recurse -Force .next`, restart, and do not chain Playwright invocations (they race their own reused server).

- [ ] **Step 3: Add the axe scan with the readout open**

In `e2e/a11y.spec.ts`, add one test beside the existing Reports scans that opens the readout from the keyboard and scans:

```ts
test("Reports with the chart readout open has no axe violations", async ({ page }) => {
  await gotoApp(page);
  await openView(page, "Reports");
  const trigger = page
    .getByTestId("report-block-budget-report")
    .getByRole("button", { name: /arrow keys/i });
  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  // Without this the scan can run before the box mounts and report GREEN over
  // markup that is not in the DOM — the silent no-op this file warns about.
  await expect(page.getByRole("tooltip")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(blocking).toEqual([]);
});
```

Match the file's own pattern exactly: it already imports `AxeBuilder` from `@axe-core/playwright`, filters to critical + serious, and builds a summary string for the failure message — copy that shape from the nearest existing test rather than the sketch above where they differ.

- [ ] **Step 4: Run the axe scan**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "readout" --workers=1 > /tmp/e2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/e2.log
```
Expected: EXIT=0. Local axe failures that read as timeouts are contention — `--workers=1` is already set; a real violation names the rule.

- [ ] **Step 5: Document it**

In `docs/AGENTS/dashboard.md`, in the section that covers the burn-down chart, add a bullet block stating: the readout's stop rule (recorded dates only, and why); that `burndown-readout.ts` is pure and the words live in `chart-readout.tsx`; that `TooltipSurface` is shared with `InfoTooltip` so a style change there moves every tooltip; that the box and the dots are `aria-hidden` and the polite live region is the accessible channel; and the test trap — jsdom gives a zero-width rect, so a pointer test must stub `getBoundingClientRect` or it silently exercises nothing.

Then run the docs gates:

```bash
npm run docs:symbols:check > /tmp/d1.log 2>&1; echo "SYMBOLS_EXIT=$?"; tail -3 /tmp/d1.log
npm run docs:claims:check > /tmp/d2.log 2>&1; echo "CLAIMS_EXIT=$?"; tail -3 /tmp/d2.log
```
Expected: both EXIT=0. Every backticked mixed-case name you write must exist in the code, and adding a `path:LINE` citation fails the claims ratchet — cite symbols, never line numbers.

- [ ] **Step 6: Commit**

```bash
git add e2e/budget-chart-readout.spec.ts e2e/a11y.spec.ts docs/AGENTS/dashboard.md
git commit -F - <<'EOF'
test(chart): browser coverage for the chart readout, and document it

An e2e spec drives the readout by mouse and by keyboard on the Reports
budget chart, one more axe scan covers Reports with the box open, and the
dashboard subsystem doc records the stop rule, the shared tooltip surface and
the zero-width-rect test trap.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 7: Whole-branch verification

**Files:** none (verification only; any fix belongs in the task that owns the file).

- [ ] **Step 1: Run the gates this branch can break**

One at a time, never two vitest runs at once:

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src; echo "LINT_EXIT=$?"
npm run test:run > /tmp/all.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "Test Files|Tests " /tmp/all.log
npm run size:check > /tmp/size.log 2>&1; echo "SIZE_EXIT=$?"; tail -3 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP_EXIT=$?"; tail -3 /tmp/dup.log
npm run docs:symbols:check > /tmp/ds.log 2>&1; echo "DOCS_SYM_EXIT=$?"
npm run docs:claims:check > /tmp/dc.log 2>&1; echo "DOCS_CLAIM_EXIT=$?"
npm run followups:index:check > /tmp/fi.log 2>&1; echo "FOLLOWUP_INDEX_EXIT=$?"
npm run followups:status:check > /tmp/fs.log 2>&1; echo "FOLLOWUP_STATUS_EXIT=$?"
npm run followups:workitems:check > /tmp/fw.log 2>&1; echo "FOLLOWUP_WORKITEM_EXIT=$?"
```

The whole unit suite is the one full-suite run this plan asks for, and it is at the end. `npm run test:shuffle` is the only local reproduction of CI's shuffled job and this plan adds test files, so run it too:

```bash
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "SHUFFLE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```

- [ ] **Step 2: Confirm the working tree holds only what this plan touched**

```bash
git status --porcelain
git diff --stat origin/main..HEAD
```
Expected: `not-in-use.env.local.bak` untracked and nothing else unexpected; the diff names only the files listed in this plan's File Structure. `not-in-use.env.local.bak` must never be opened, read, printed or staged.

- [ ] **Step 3: Report**

Write the report the executing skill asks for, quoting every EXIT code above, the unit-test counts, and the mutation results from Tasks 1 and 3. Do not push, tag, or open a merge request — those wait for an explicit instruction.

---

## Self-review

**Spec coverage:** stop rule → Task 1 (`readoutStops`, its two tests); row list and order → Tasks 1 and 4; explanations → Task 4's keys; keyboard/touch/Escape/blur → Task 3, wired in Task 5; both surfaces → Task 5 (the chart component is the one both mount, so the dashboard tile gets it with no extra work); print hidden → Task 5's `print:hidden` on the box, the guide group and the cursor; one new display surface only → Task 2; screen-reader channel → Task 5's live region plus Task 4's `readoutSentence`; tests incl. the "baselines must not change" assertion → Tasks 1-6 and Step 5 of Task 5; out-of-scope items appear in no task.

**Placeholders:** none — every step carries its command or its code.

**Correction, 2026-09-18 (found by Task 1's review, fixed here and in Task 1's code):** the first
cut of this plan had `readoutAt` read earned value from `model.evSegments` alone. Geometry computes
`evFields = !down && evHistory ? … : NO_EV`, so `evSegments` is **null in the default burn-down
orientation**, while the singular `model.ev` is set in both and is drawn in both (the amber diamond,
with its own legend entry `burndownEv`). Since `readoutStops` already snaps to `model.ev.date`, the
default view offered a stop with no earned-value row at all. Hence the `"evPoint"` kind: a distinct
row, because in the cumulative orientation the history line and the diamond BOTH exist and the
legend words them differently. Task 4's tip test was widened to one case per row kind at the same
time — it previously asserted two of the explanations and left the rest untested.

**Type consistency:** `Readout`, `ReadoutRow`, `ReadoutKind`, `readoutStops`, `readoutAt`, `nearestStop` (Task 1) are consumed under those names in Tasks 3-5; `ReadoutAnchor`, `ChartReadoutApi`, `useChartReadout` (Task 3) in Tasks 4-5; `TooltipSurface`, `TOOLTIP_SURFACE_CLASS` (Task 2) in Tasks 2 and 4; `ChartReadout`, `readoutSentence` (Task 4) in Task 5. The i18n keys added in Task 4 are the exact ones `ROW`, `labelKey` and `valueText` read.

**Known risk to watch in review:** `BurndownChart` splits into a wrapper plus `BurndownChartBody` so the hook can run unconditionally. Any existing test that imports the component by name still works, but a test asserting on the component's `displayName` or snapshotting the React tree would notice. Task 5 Step 4 runs `burndown-chart-panel.test.tsx` alongside for exactly that reason.
