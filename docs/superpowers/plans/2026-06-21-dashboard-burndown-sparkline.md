# Dashboard Completion-Trend Sparkline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact completion-% trend sparkline to the Dashboard landing cockpit (slice #6), fed by Turso snapshots when present and reconstructed from the local activity log otherwise.

**Architecture:** A pure i18n-free engine (`completion-trend.ts`) turns snapshots + activity log + live counts into a chronological `CompletionPoint[]`; a minimal pure-SVG `Sparkline` renders it; `DashboardPanel` computes the series in a `useMemo` and renders a self-hiding card directly below the existing KPI strip. New data is read-only — no new persistence path.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript, Vitest + fast-check, Tailwind (AIPM brand tokens only), EN/DE i18n parity (tsc-enforced).

---

## File Structure

- **Create** `src/app/completion-trend.ts` — pure engine: `computeCompletionTrend(input) → CompletionPoint[]`, `MAX_POINTS`, `CompletionPoint`, `CompletionTrendInput`.
- **Create** `src/app/completion-trend.test.ts` — unit tests.
- **Create** `src/app/completion-trend.property.test.ts` — fast-check properties.
- **Create** `src/app/sparkline.tsx` — pure SVG polyline component.
- **Create** `src/app/sparkline.test.tsx` — component tests.
- **Modify** `src/app/i18n.ts` — 4 EN keys.
- **Modify** `src/app/i18n.de.ts` — 4 DE keys (via node utf8 write — Edit corrupts umlauts/quotes).
- **Modify** `src/app/dashboard-panel.tsx` — new optional `snapshots?` prop, series `useMemo`, card render.
- **Modify** `src/app/dashboard-panel.test.tsx` — card visible/hidden tests.
- **Modify** `src/app/workspace-section.tsx` — thread `snapshots={trends.snapshots}`.
- **Modify** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md` — release 0.122.0 "Herbert".

Conventions to honor (CI-enforced): `npm run lint` is `--max-warnings=0` (an unused import is FATAL). `npx tsc --noEmit` enforces EN/DE key parity and typechecks test files (vitest does not). No `new Date()`/`Date.now()`/`Math.random()` in a render body or in the pure engine. AIPM brand tokens only (`stroke-AIPM-dark-blue`, `text-muted-foreground`).

---

## Task 1: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts:565` (after the `versionHighlightTrendArrows` value, before `dashboardKpiStrip`)
- Modify: `src/app/i18n.de.ts:549` (mirror location)

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, immediately after the `versionHighlightTrendArrows: "..."` entry (the value ends on line 565) and before `dashboardKpiStrip:`, insert:

```ts
  versionHighlightBurndownSparkline:
    "The Dashboard now shows a small completion-trend sparkline under the headline numbers, so you can see how % complete has moved over recent snapshots or activity at a glance.",
  dashboardCompletionTrend: "Completion trend",
  dashboardCompletionTrendPoints: "{0} points",
  dashboardCompletionTrendAria: "Completion trend: {0}% now, from {1}% over {2} points",
```

- [ ] **Step 2: Add DE keys via node utf8 write**

The Edit tool corrupts umlauts and curls quotes in `i18n.de.ts`; the file is CRLF (a `\n`-anchored replace silently no-ops). Use a node script that builds the block with `\u` escapes (encoding-proof — no literal umlaut bytes in the script) and matches `\r\n`. `ü` = ü, `ä` = ä. Run from repo root:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
if (s.includes("versionHighlightBurndownSparkline")) { console.log("already present"); process.exit(0); }
const ue = "ü", ae = "ä";
const anchor = "  dashboardKpiStrip:";
const block =
  "  versionHighlightBurndownSparkline:\r\n" +
  "    \"Das Dashboard zeigt jetzt unter den Kennzahlen eine kleine Trendlinie zum Fertigstellungsgrad, sodass auf einen Blick sichtbar ist, wie sich der Fortschritt " + ue + "ber die letzten Snapshots oder Aktivit" + ae + "ten entwickelt hat.\",\r\n" +
  "  dashboardCompletionTrend: \"Fertigstellungstrend\",\r\n" +
  "  dashboardCompletionTrendPoints: \"{0} Punkte\",\r\n" +
  "  dashboardCompletionTrendAria: \"Fertigstellungstrend: {0}% jetzt, von {1}% " + ue + "ber {2} Punkte\",\r\n";
s = s.replace(anchor, block + anchor);
fs.writeFileSync(p, s, "utf8");
console.log("inserted");
'
```

The resulting DE strings (with real umlauts) must read:
- `versionHighlightBurndownSparkline`: "Das Dashboard zeigt jetzt unter den Kennzahlen eine kleine Trendlinie zum Fertigstellungsgrad, sodass auf einen Blick sichtbar ist, wie sich der Fortschritt über die letzten Snapshots oder Aktivitäten entwickelt hat."
- `dashboardCompletionTrend`: "Fertigstellungstrend"
- `dashboardCompletionTrendPoints`: "{0} Punkte"
- `dashboardCompletionTrendAria`: "Fertigstellungstrend: {0}% jetzt, von {1}% über {2} Punkte"

- [ ] **Step 3: Verify parity + umlauts**

Run: `npx tsc --noEmit`
Expected: PASS (no "missing key" parity error between EN and DE dicts).

Run: `npm run test:run -- i18n-encoding`
Expected: PASS (no ASCII umlaut substitutions like "ueber"/"Aktivitaeten" in the final file).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add completion-trend sparkline keys (EN/DE)"
```

---

## Task 2: Pure engine `completion-trend.ts`

**Files:**
- Create: `src/app/completion-trend.ts`
- Test: `src/app/completion-trend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/completion-trend.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { computeCompletionTrend, MAX_POINTS } from "./completion-trend";
import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";

function snap(capturedAt: string, pct: number): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket: capturedAt.slice(0, 10), cadence: "daily",
    trigger: "manual", isBaseline: false, remainingHours: null, remainingCost: null,
    pctComplete: pct, forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
    spi: null, cpi: null, overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

let nextId = 1;
function ev(timestamp: string, kind: ActivityEntry["kind"]): ActivityEntry {
  return { id: nextId++, timestamp, kind, args: [] };
}

describe("computeCompletionTrend", () => {
  test("prefers snapshots when >= 2 (exact pctComplete, log ignored)", () => {
    const snapshots = [snap("2026-06-10T00:00:00.000Z", 20), snap("2026-06-14T00:00:00.000Z", 55)];
    const activity = [ev("2026-06-12T00:00:00.000Z", "task.completed")];
    const out = computeCompletionTrend({ snapshots, activity, currentDone: 9, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([20, 55]);
    expect(out[1].label).toBe("06-14");
  });

  test("falls back to activity-log reconstruction when < 2 snapshots", () => {
    // current: 6 done / 10 total = 60%. Events: day 18 one completion, day 20 one completion.
    // End of 06-20 = current (60%). End of 06-18 = before 06-20's completion: 5/10 = 50%.
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.completed"),
      ev("2026-06-20T09:00:00.000Z", "task.completed"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 6, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([50, 60]);
    expect(out.map((p) => p.label)).toEqual(["06-18", "06-20"]);
  });

  test("created/deleted shift total; reopened decrements done", () => {
    // current 5 done / 10 total. Day A: a created (total was 9 before). Day B: a reopened (done was 6 before).
    const activity = [
      ev("2026-06-15T09:00:00.000Z", "task.created"),
      ev("2026-06-17T09:00:00.000Z", "task.reopened"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 5, currentTotal: 10, today: "2026-06-21" });
    // end of 06-17 = current = 5/10 = 50%.
    // before 06-17 reopened: done 6, total 10 -> end of 06-15 = 6/10 = 60%.
    expect(out.map((p) => p.percent)).toEqual([60, 50]);
  });

  test("fewer than 2 points -> empty", () => {
    expect(computeCompletionTrend({ snapshots: [], activity: [], currentDone: 0, currentTotal: 0, today: "2026-06-21" })).toEqual([]);
    expect(computeCompletionTrend({ snapshots: [snap("2026-06-10T00:00:00.000Z", 20)], activity: [], currentDone: 1, currentTotal: 5, today: "2026-06-21" })).toEqual([]);
  });

  test("caps to the trailing MAX_POINTS", () => {
    const snapshots = Array.from({ length: MAX_POINTS + 5 }, (_, i) =>
      snap(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, i),
    );
    const out = computeCompletionTrend({ snapshots, activity: [], currentDone: 1, currentTotal: 2, today: "2026-06-30" });
    expect(out.length).toBe(MAX_POINTS);
    // trailing window keeps the newest points
    expect(out[out.length - 1].label).toBe(`06-${MAX_POINTS + 5}`);
  });

  test("total 0 -> 0% (no divide by zero)", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.deleted"),
      ev("2026-06-20T09:00:00.000Z", "task.deleted"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 0, currentTotal: 0, today: "2026-06-21" });
    expect(out.every((p) => p.percent === 0)).toBe(true);
  });

  test("ignores future-dated events (clock-skew guard) and non-task kinds", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.completed"),
      ev("2026-06-19T09:00:00.000Z", "raid.created"),       // non-task -> ignored
      ev("2027-01-01T09:00:00.000Z", "task.completed"),     // future -> ignored
      ev("2026-06-20T09:00:00.000Z", "task.completed"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 6, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.label)).toEqual(["06-18", "06-20"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- completion-trend.test`
Expected: FAIL — "Failed to resolve import './completion-trend'".

- [ ] **Step 3: Write the engine**

Create `src/app/completion-trend.ts`:

```ts
// Pure, i18n-free engine for the Dashboard completion-trend sparkline.
// Produces a chronological series of % complete (0–100). Prefers exact Turso
// snapshot history; falls back to reconstructing done/total from the local
// activity log when there are fewer than two snapshots. No I/O, no clock —
// `today`, `currentDone`, `currentTotal` are passed in.

import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";

export interface CompletionPoint {
  /** Short day label "MM-DD" for tooltips/labels. */
  label: string;
  /** Completion percentage, clamped to [0, 100]. */
  percent: number;
}

export interface CompletionTrendInput {
  snapshots: readonly SnapshotRecord[];
  activity: readonly ActivityEntry[];
  /** Live completed-task count (model.progress.completed). */
  currentDone: number;
  /** Live total-task count (model.progress.total). */
  currentTotal: number;
  /** Today as YYYY-MM-DD; used only to drop future-dated (clock-skew) events. */
  today: string;
}

/** Trailing window so a long history doesn't flood the sparkline. */
export const MAX_POINTS = 12;

function clampPct(done: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((100 * done) / total);
  if (!Number.isFinite(pct)) return 0;
  return pct < 0 ? 0 : pct > 100 ? 100 : pct;
}

/** ISO timestamp/date -> "MM-DD". */
function dayLabel(iso: string): string {
  return iso.slice(5, 10);
}

function trailing<T>(arr: readonly T[]): T[] {
  return arr.length > MAX_POINTS ? arr.slice(arr.length - MAX_POINTS) : [...arr];
}

function fromSnapshots(snapshots: readonly SnapshotRecord[]): CompletionPoint[] {
  if (snapshots.length < 2) return [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return trailing(sorted).map((s) => ({
    label: dayLabel(s.capturedAt),
    percent: clampPct(s.pctComplete, 100), // pctComplete is already 0–100; clamp via /100 path
  }));
}

const COUNT_KINDS = new Set(["task.created", "task.completed", "task.reopened", "task.deleted"]);

type DayDelta = { day: string; dDone: number; dTotal: number };

function reconstructFromActivity(
  activity: readonly ActivityEntry[],
  currentDone: number,
  currentTotal: number,
  today: string,
): CompletionPoint[] {
  // Per-day deltas from task events (created/deleted move total; completed/
  // reopened move done). Deleted task's done-state is unknown -> assumed not
  // done (documented approximation).
  const byDay = new Map<string, { dDone: number; dTotal: number }>();
  for (const e of activity) {
    if (!COUNT_KINDS.has(e.kind)) continue;
    const day = e.timestamp.slice(0, 10);
    if (day > today) continue; // clock-skew guard
    const cur = byDay.get(day) ?? { dDone: 0, dTotal: 0 };
    if (e.kind === "task.created") cur.dTotal += 1;
    else if (e.kind === "task.deleted") cur.dTotal -= 1;
    else if (e.kind === "task.completed") cur.dDone += 1;
    else if (e.kind === "task.reopened") cur.dDone -= 1;
    byDay.set(day, cur);
  }
  const days: DayDelta[] = [...byDay.entries()]
    .map(([day, d]) => ({ day, ...d }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (days.length < 2) return [];

  // Walk backward: the last event-day's END state = current; subtract each
  // day's delta to get the end state of the previous day. Floor counts at 0.
  const endState: { done: number; total: number }[] = new Array(days.length);
  let done = currentDone;
  let total = currentTotal;
  for (let i = days.length - 1; i >= 0; i--) {
    endState[i] = { done: Math.max(0, done), total: Math.max(0, total) };
    done -= days[i].dDone;
    total -= days[i].dTotal;
  }
  const points = days.map((d, i) => ({
    label: dayLabel(`${d.day}`),
    percent: clampPct(endState[i].done, endState[i].total),
  }));
  return trailing(points);
}

export function computeCompletionTrend(input: CompletionTrendInput): CompletionPoint[] {
  const snap = fromSnapshots(input.snapshots);
  if (snap.length >= 2) return snap;
  return reconstructFromActivity(input.activity, input.currentDone, input.currentTotal, input.today);
}
```

NOTE on `clampPct(s.pctComplete, 100)`: `pctComplete` is already a 0–100 number, so dividing by 100 and ×100 round-trips it while reusing the single clamp helper. If you prefer clarity, replace that line with an inline clamp: `percent: Math.max(0, Math.min(100, Math.round(s.pctComplete)))`. Pick one; keep it consistent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- completion-trend.test`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/completion-trend.ts src/app/completion-trend.test.ts
git commit -m "feat: completion-trend engine (snapshot-preferred, activity-log fallback)"
```

---

## Task 3: Engine property tests

**Files:**
- Create: `src/app/completion-trend.property.test.ts`

- [ ] **Step 1: Write the property test**

Create `src/app/completion-trend.property.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { computeCompletionTrend, MAX_POINTS } from "./completion-trend";
import type { ActivityEntry } from "./activity-log";

const KINDS = ["task.created", "task.completed", "task.reopened", "task.deleted", "raid.created"] as const;

// Build an ActivityEntry from an integer ms offset (NEVER fc.date — it can emit
// Invalid Date and .toISOString() throws; the dotAll /s regex flag is also banned).
function entryArb() {
  return fc.record({
    ms: fc.integer({ min: 0, max: 60 * 24 * 60 * 60 * 1000 }), // up to ~60 days
    k: fc.constantFrom(...KINDS),
  });
}

describe("computeCompletionTrend properties", () => {
  test("percents always in [0,100], chronological-safe, never throws, capped", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb(), { maxLength: 80 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (raw, done, totalRaw) => {
          const base = Date.UTC(2026, 0, 1);
          const activity: ActivityEntry[] = raw.map((r, i) => ({
            id: i + 1,
            timestamp: new Date(base + r.ms).toISOString(),
            kind: r.k as ActivityEntry["kind"],
            args: [],
          }));
          const total = Math.max(done, totalRaw); // total >= done is the realistic invariant
          const out = computeCompletionTrend({
            snapshots: [], activity, currentDone: done, currentTotal: total, today: "2026-12-31",
          });
          expect(out.length).toBeLessThanOrEqual(MAX_POINTS);
          for (const p of out) {
            expect(p.percent).toBeGreaterThanOrEqual(0);
            expect(p.percent).toBeLessThanOrEqual(100);
            expect(typeof p.label).toBe("string");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:run -- completion-trend.property`
Expected: PASS.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/app/completion-trend.property.test.ts
git commit -m "test: property tests for completion-trend engine"
```

---

## Task 4: `Sparkline` component

**Files:**
- Create: `src/app/sparkline.tsx`
- Test: `src/app/sparkline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/sparkline.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./sparkline";
import type { CompletionPoint } from "./completion-trend";

const pts = (vals: number[]): CompletionPoint[] => vals.map((v, i) => ({ label: `0${i}`, percent: v }));

describe("Sparkline", () => {
  test("renders a polyline for >= 2 points", () => {
    const { container } = render(<Sparkline points={pts([10, 40, 30, 80])} />);
    const line = container.querySelector("polyline");
    expect(line).not.toBeNull();
    // 4 points -> 4 coordinate pairs in the points attr
    expect(line!.getAttribute("points")!.trim().split(/\s+/).length).toBe(4);
  });

  test("renders nothing for fewer than 2 points", () => {
    const { container } = render(<Sparkline points={pts([42])} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("svg is aria-hidden (meaning rides the parent wrapper)", () => {
    const { container } = render(<Sparkline points={pts([10, 20])} />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- sparkline.test`
Expected: FAIL — "Failed to resolve import './sparkline'".

- [ ] **Step 3: Write the component**

Create `src/app/sparkline.tsx`:

```tsx
import type { CompletionPoint } from "./completion-trend";

const W = 240;
const H = 40;
const PAD = 3;

interface SparklineProps {
  points: readonly CompletionPoint[];
  className?: string;
}

/** Minimal axis-less SVG line of a completion-% series. Decorative: the SVG is
 *  aria-hidden and the meaning is carried by the parent wrapper's aria-label
 *  (the RagBadge/label-bleed rule — the line must never become the accessible
 *  name). Renders nothing for fewer than two points. */
export function Sparkline({ points, className }: SparklineProps) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.percent);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const n = points.length;
  const xAt = (i: number) => PAD + (i * (W - 2 * PAD)) / (n - 1);
  const yAt = (v: number) =>
    max <= min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);
  const coords = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.percent).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${className ?? ""}`} aria-hidden="true" preserveAspectRatio="none">
      <polyline points={coords} fill="none" className="stroke-AIPM-dark-blue" strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- sparkline.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/app/sparkline.tsx src/app/sparkline.test.tsx
git commit -m "feat: minimal pure-SVG Sparkline component"
```

---

## Task 5: Render the card in `DashboardPanel`

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (prop at the props interface ~line 57; imports near top; `useMemo` after the existing `model` memo ~line 145; render after the KPI grid ~line 281)
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/dashboard-panel.test.tsx` (inside the existing top-level `describe`, or a new one). First inspect the file for an existing render helper (e.g. `renderPanel(props)`); reuse it. If none exists, use this self-contained pattern (adjust required props to match the file's existing helper — do NOT invent props the panel doesn't have):

```tsx
import { computeCompletionTrend } from "./completion-trend";
import type { SnapshotRecord } from "./snapshot";

function snapRec(capturedAt: string, pct: number): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket: capturedAt.slice(0, 10), cadence: "daily",
    trigger: "manual", isBaseline: false, remainingHours: null, remainingCost: null,
    pctComplete: pct, forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
    spi: null, cpi: null, overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

describe("DashboardPanel completion-trend card", () => {
  test("shows the trend card when snapshots yield >= 2 points", () => {
    // Use the file's existing render helper; pass snapshots with 2 points.
    const snapshots = [snapRec("2026-06-10T00:00:00.000Z", 20), snapRec("2026-06-14T00:00:00.000Z", 55)];
    const { getByText, container } = renderDashboard({ snapshots }); // <- existing helper
    expect(getByText("Completion trend")).toBeInTheDocument();
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  test("hides the trend card when there is no series", () => {
    const { queryByText } = renderDashboard({ snapshots: [] });
    expect(queryByText("Completion trend")).toBeNull();
  });
});
```

If the existing test file has no shared helper, model the new tests on the nearest existing `render(<DashboardPanel ... />)` call in that file — copy its full prop set and add `snapshots`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- dashboard-panel.test`
Expected: FAIL — `getByText("Completion trend")` not found (prop/render not wired yet).

- [ ] **Step 3: Add imports**

At the top of `src/app/dashboard-panel.tsx`, near the other local imports (e.g. beside the `import { TrendArrow } from "./trend-arrow";` line ~25), add:

```ts
import { computeCompletionTrend } from "./completion-trend";
import { Sparkline } from "./sparkline";
import type { SnapshotRecord } from "./snapshot";
```

- [ ] **Step 4: Add the prop**

In the `DashboardPanelProps` interface, beside `variance?: readonly VarianceRow[];` (line 57), add:

```ts
  snapshots?: readonly SnapshotRecord[];
```

- [ ] **Step 5: Compute the series (deps hoisted to scalar locals)**

After the `model` `useMemo` block (ends ~line 145) and before/after the landing-cockpit block, add. The exhaustive-deps rule treats `obj.member`/`?.length` in a dep array as a FATAL warning — hoist to scalar locals and depend on those:

```ts
  // Completion-trend sparkline (slice #6). Snapshot-preferred, activity-log
  // fallback. Deps hoisted to scalars (exhaustive-deps bans obj.member/.length
  // in the array).
  const snapshots = props.snapshots ?? [];
  const snapCount = snapshots.length;
  const activityCount = activity.length;
  const currentDone = model.progress.completed;
  const currentTotal = model.progress.total;
  const completionSeries = useMemo(
    () =>
      computeCompletionTrend({
        snapshots,
        activity,
        currentDone,
        currentTotal,
        today,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapCount, activityCount, currentDone, currentTotal, today],
  );
```

NOTE: `snapshots`/`activity` are intentionally omitted from the dep array in favor of their `*Count` scalars (their identities are stable per render from the same sources); the eslint-disable line documents this. This mirrors how `use-landing-delta` and the coaching memo handle the same rule.

- [ ] **Step 6: Render the card after the KPI grid**

Immediately after the KPI strip's closing `</div>` (line 281) and before the `{/* Top actions ... */}` comment, insert:

```tsx
        {/* Completion-trend sparkline — self-hides without >= 2 points */}
        {completionSeries.length >= 2 && (
          <div
            className="rounded border border-line bg-surface p-3"
            aria-label={t(
              lang,
              "dashboardCompletionTrendAria",
              completionSeries[completionSeries.length - 1].percent,
              completionSeries[0].percent,
              completionSeries.length,
            )}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {t(lang, "dashboardCompletionTrend")}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t(lang, "dashboardCompletionTrendPoints", completionSeries.length)}
              </span>
            </div>
            <Sparkline points={completionSeries} />
          </div>
        )}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:run -- dashboard-panel.test`
Expected: PASS (both new tests + existing tests still green).

- [ ] **Step 8: Typecheck + lint + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: PASS (0 warnings — no unused import).

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat: render completion-trend sparkline card on the Dashboard"
```

---

## Task 6: Wire `snapshots` through `workspace-section`

**Files:**
- Modify: `src/app/workspace-section.tsx:771` (the `DashboardPanel` render — add beside `variance={trends.variance}`)

- [ ] **Step 1: Add the prop to the render**

In the `DashboardPanel` JSX (the `activeTab === "dashboard"` branch, ~line 741–780), beside `variance={trends.variance}` (line 771), add:

```tsx
              snapshots={trends.snapshots}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run the dashboard + workspace tests**

Run: `npm run test:run -- dashboard-panel workspace-section`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/workspace-section.tsx
git commit -m "feat: thread Turso snapshots to the Dashboard for the trend sparkline"
```

---

## Task 7: Release 0.122.0 "Herbert"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md` (version badge)
- Modify: `package.json` (`version`)
- Modify: `AGENTS.md` (Architecture pointers — new module-map entry)

- [ ] **Step 1: Bump `version.ts`**

In `src/app/version.ts`:
- Set `export const APP_VERSION = "0.122.0";`
- Set `export const APP_BUILD_DATE = "2026-06-21";` with a trailing comment `// 0.122.0 Completion-trend sparkline (Herbert)`
- Set `export const APP_MILESTONE = "Herbert";` and update the doc comment from the `Stephenson` line to `Herbert` (Frank Herbert).
- Append `"versionHighlightBurndownSparkline",` as the last entry of `APP_HIGHLIGHT_KEYS` (after `"versionHighlightTrendArrows",`).

- [ ] **Step 2: CHANGELOG entry**

At the top of `CHANGELOG.md` (above the most recent `## [0.121.0]` entry), add:

```markdown
## [0.122.0] - 2026-06-21 "Herbert"

### Added
- **Dashboard completion-trend sparkline.** A compact line under the at-a-glance
  KPI strip shows how % complete has moved over recent Turso snapshots, falling
  back to a reconstruction from the local activity log when snapshots aren't
  available. Self-hides until there are at least two data points.
```

- [ ] **Step 3: README badge**

In `README.md`, update the version badge/text from `0.121.0` / `Stephenson` to `0.122.0` / `Herbert` (search the file for `0.121.0` and replace the badge occurrence; leave unrelated text alone).

- [ ] **Step 4: package.json**

Set `"version": "0.122.0"` in `package.json`.

- [ ] **Step 5: AGENTS.md module-map entry**

In `AGENTS.md`, under "Architecture pointers", after the "Dashboard KPI trend arrows (v0.121.0)" entry, add a "Dashboard completion-trend sparkline (v0.122.0)" bullet capturing: pure `completion-trend.ts` (`computeCompletionTrend`, snapshot-preferred / activity-log fallback, `MAX_POINTS=12`, `today`+counts passed in — no clock); `sparkline.tsx` (axis-less SVG, `aria-hidden`, parent carries the label); rendered in `dashboard-panel.tsx` below the KPI strip gated `series.length >= 2`; new optional `snapshots?` prop threaded from `trends.snapshots` (panel already loads `activity` itself via `loadActivityLog()`); deps hoisted to scalar locals for exhaustive-deps; always-on (no tursoConfig guard — degrades to log on file/IDB); Dashboard IS in axe `A11Y_VIEWS` (sparkline non-interactive).

- [ ] **Step 6: Verify build prerequisites**

Run: `npx tsc --noEmit`
Expected: PASS (EN/DE parity + APP_HIGHLIGHT_KEYS string presence).

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.122.0 \"Herbert\" — dashboard completion-trend sparkline"
```

---

## Task 8: Full gate run

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Lint (CI parity)**

Run: `npm run lint`
Expected: PASS — 0 warnings.

- [ ] **Step 3: Unit/integration suite**

Run: `npm run test:run`
Expected: PASS — full suite green (≈4400+ tests + the new completion-trend/sparkline/panel tests).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (prebuild script-docs sync + next build). If `operating-guide-builtin.generated.ts` shows only EOL churn afterward, `git checkout -- src/app/operating-guide-builtin.generated.ts`.

- [ ] **Step 5: axe a11y gate for Dashboard**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`
Expected: PASS (no axe-critical violations; the live demo seeds a populated project so the sparkline renders, non-interactive).

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore: address gate findings for completion-trend sparkline"
```

---

## Self-Review

**Spec coverage:**
- Metric = completion %, both sources → Task 2 (`computeCompletionTrend`, snapshot-preferred + log fallback). ✓
- Source priority + reconstruction algorithm + deleted-not-done approximation + window cap → Task 2 engine + tests. ✓
- `Sparkline` pure SVG, aria-hidden, <2 → null → Task 4. ✓
- Placement (card below KPI strip, self-hide <2) → Task 5. ✓
- Wiring `snapshots` from `trends.snapshots`; panel already has `activity` → Task 5 (prop) + Task 6 (thread). ✓
- Gating always-on, no tursoConfig guard → Task 5 (engine handles fallback; no guard added). ✓
- a11y wrapper aria-label, no interactive control → Task 5 render + Task 8 axe. ✓
- Versioning + i18n EN/DE + property test → Tasks 1, 3, 7. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. The one soft spot — Task 5 Step 1 depends on the existing dashboard-panel test render helper, whose exact name varies; instruction is explicit to reuse/copy the nearest existing render call rather than invent props. Acceptable (the file's helper must be read, not guessed).

**Type consistency:** `CompletionPoint {label,percent}`, `CompletionTrendInput {snapshots,activity,currentDone,currentTotal,today}`, `MAX_POINTS`, `computeCompletionTrend`, `Sparkline {points,className}` used identically across Tasks 2/3/4/5. `model.progress.completed`/`.total` confirmed against `DashboardProgress`. i18n keys (`dashboardCompletionTrend`/`...Points`/`...Aria`, `versionHighlightBurndownSparkline`) consistent across Tasks 1/5/7. ✓
