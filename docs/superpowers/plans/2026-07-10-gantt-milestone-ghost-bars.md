# Gantt Milestone Ghost Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay each Gantt milestone's committed baseline date (from the pinned Turso snapshot) behind its live diamond — a hollow ghost diamond + dotted connector + "+Nd" slip label — so schedule slip is visible where PMs plan.

**Architecture:** A pure selector picks the `isBaseline` snapshot's per-milestone `target` dates into a `Map<id,ISO>`; task-manager memoizes it (Turso-gated) and threads one prop to GanttPanel, which passes each milestone's baseline date to a ghost-aware `GanttMilestoneRow`. A default-on `showBaseline` gantt-pref toggles it; the toolbar button appears only when baseline data exists.

**Tech Stack:** TypeScript, React 19, Next.js (forked), Vitest, Tailwind v4 (AIPM palette tokens only).

**Branch:** `feat/gantt-milestone-baseline` off `main` (create it; do NOT reuse the id-mint branch).

**Conventions (CI-enforced — read before coding):**
- `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`: unused import/var is FATAL), `npm run test:run` after each task.
- Palette: only AIPM tokens + role tokens (`--line`, `text-muted-foreground`, `bg-surface`, `bg-surface-muted`, `border-line`, `border-AIPM-dark-blue`, `text-AIPM-dark-blue`, `focus:ring-AIPM-green`). No new colors, no gradients, no `shadow*` (palette guards scan comments too — don't write the bare word in prose).
- i18n: `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces). Edit `i18n.de.ts` via node utf8 write (CRLF `\r\n` anchors) — the Edit tool corrupts that file. `Lang` is `"en-US" | "en-GB" | "de"`.
- react-hooks purity: no `Date.now()`/`new Date()` in a render body; no set-state-in-effect.

---

## File Structure

- `snapshot.ts` — ADD pure `baselineMilestoneTargets(snapshots)`. (Pure snapshot domain, i18n-free.)
- `snapshot.test.ts` — ADD selector tests.
- `gantt-engine.ts` — ADD pure `milestoneSlipDays(baselineISO, liveISO)`; ADD `showBaseline` to `GanttPrefs` + `DEFAULT_PREFS` + `loadPrefs`.
- `gantt-engine.test.ts` — ADD slip-helper tests (create if absent).
- `use-gantt-prefs.ts` — ADD `toggleBaseline` to `GanttPrefsApi` + impl.
- `use-gantt-prefs.test.ts` — ADD toggle/default/persist test (create if absent).
- `i18n.ts` / `i18n.de.ts` — ADD `ganttBaseline` + `ganttBaselineHint`.
- `gantt-rows.tsx` — `GanttMilestoneRow` ghost render (new `baselineDate?`, `showBaseline?` props).
- `gantt-rows.test.tsx` — ADD ghost render tests (create if absent).
- `gantt-chrome.tsx` — `GanttToolbar` Baseline toggle button (new `hasBaseline` + `toggleBaseline` props).
- `gantt.tsx` — `GanttPanel` accepts `baselineMilestoneDates?`; wires toolbar + rows.
- `workspace-section-types.ts` — ADD `baselineMilestoneDates?` to `WorkspaceSectionProps`.
- `workspace-section.tsx` — forward the prop to `GanttPanel`.
- `task-manager.tsx` — derive the memo (Turso-gated) + thread it.

---

### Task 1: Pure `baselineMilestoneTargets` selector

**Files:**
- Modify: `src/app/snapshot.ts`
- Test: `src/app/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/snapshot.test.ts` (reuse the existing `snap(capturedAt, bucket)` helper at the top of the file). Add:

```typescript
import { baselineMilestoneTargets } from "./snapshot";
import type { SnapshotMilestone } from "./snapshot";

describe("baselineMilestoneTargets", () => {
  const ms = (id: number, target: string): SnapshotMilestone => ({ id, name: `M${id}`, target, forecast: target });

  it("returns an empty map when there are no snapshots", () => {
    expect(baselineMilestoneTargets([]).size).toBe(0);
  });

  it("returns an empty map when no snapshot is the baseline", () => {
    const a = snap("2026-06-01T00:00:00Z", "2026-W23");
    a.milestones = [ms(1, "2026-07-01")];
    expect(baselineMilestoneTargets([a]).size).toBe(0);
  });

  it("maps each milestone id to its target date from the baseline snapshot", () => {
    const older = snap("2026-06-01T00:00:00Z", "2026-W23");
    older.milestones = [ms(1, "2026-06-15")];
    const base = snap("2026-06-08T00:00:00Z", "2026-W24");
    base.isBaseline = true;
    base.milestones = [ms(1, "2026-07-01"), ms(2, "2026-08-01")];
    const map = baselineMilestoneTargets([older, base]);
    expect(map.get(1)).toBe("2026-07-01");
    expect(map.get(2)).toBe("2026-08-01");
    expect(map.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: FAIL — `baselineMilestoneTargets is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/app/snapshot.ts` (after the existing exports; it already imports nothing new — uses only `SnapshotRecord` in scope):

```typescript
/** Per-milestone committed baseline (`target`) dates from the pinned baseline
 *  snapshot, keyed by milestone id. Empty when no snapshot is flagged
 *  `isBaseline`. Pure — the Gantt overlays these behind the live diamonds. */
export function baselineMilestoneTargets(
  snapshots: readonly SnapshotRecord[],
): Map<number, string> {
  const base = snapshots.find((s) => s.isBaseline);
  const map = new Map<number, string>();
  if (!base) return map;
  for (const m of base.milestones) map.set(m.id, m.target);
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/snapshot.ts src/app/snapshot.test.ts
git commit -m "feat(gantt): baselineMilestoneTargets snapshot selector"
```

---

### Task 2: Pure `milestoneSlipDays` helper

**Files:**
- Modify: `src/app/gantt-engine.ts`
- Test: `src/app/gantt-engine.test.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

If `src/app/gantt-engine.test.ts` exists, append the `describe` block; otherwise create the file with this content:

```typescript
import { describe, expect, it } from "vitest";
import { milestoneSlipDays } from "./gantt-engine";

describe("milestoneSlipDays", () => {
  it("is positive when the live date is later than the baseline (slipped)", () => {
    expect(milestoneSlipDays("2026-06-01", "2026-06-06")).toBe(5);
  });
  it("is negative when the live date is earlier than the baseline (pulled in)", () => {
    expect(milestoneSlipDays("2026-06-10", "2026-06-07")).toBe(-3);
  });
  it("is zero when the dates match", () => {
    expect(milestoneSlipDays("2026-06-01", "2026-06-01")).toBe(0);
  });
  it("returns null when either date is unparseable", () => {
    expect(milestoneSlipDays("not-a-date", "2026-06-01")).toBeNull();
    expect(milestoneSlipDays("2026-06-01", "")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/gantt-engine.test.ts`
Expected: FAIL — `milestoneSlipDays is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/app/gantt-engine.ts`, add directly after the existing `diffDays` function (around line 155):

```typescript
/** Signed day slip of a milestone's live date vs its baseline target:
 *  positive = slipped later, negative = pulled in, 0 = on baseline.
 *  `null` when either date is unparseable. Pure (reuses parseISO/diffDays). */
export function milestoneSlipDays(baselineISO: string, liveISO: string): number | null {
  const base = parseISO(baselineISO);
  const live = parseISO(liveISO);
  if (!base || !live) return null;
  return diffDays(base, live);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/gantt-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/gantt-engine.ts src/app/gantt-engine.test.ts
git commit -m "feat(gantt): milestoneSlipDays helper"
```

---

### Task 3: `showBaseline` gantt preference + toggle

**Files:**
- Modify: `src/app/gantt-engine.ts` (`GanttPrefs`, `DEFAULT_PREFS`, `loadPrefs`)
- Modify: `src/app/use-gantt-prefs.ts`
- Test: `src/app/use-gantt-prefs.test.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

Create/append `src/app/use-gantt-prefs.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGanttPrefs } from "./use-gantt-prefs";

describe("useGanttPrefs — showBaseline", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults showBaseline to true", () => {
    const { result } = renderHook(() => useGanttPrefs());
    expect(result.current.prefs.showBaseline).toBe(true);
  });

  it("toggleBaseline flips the flag and persists it", () => {
    const { result } = renderHook(() => useGanttPrefs());
    act(() => result.current.toggleBaseline());
    expect(result.current.prefs.showBaseline).toBe(false);
    const saved = JSON.parse(window.localStorage.getItem("lop-app:gantt-prefs")!);
    expect(saved.showBaseline).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-gantt-prefs.test.ts`
Expected: FAIL — `showBaseline` is `undefined` / `toggleBaseline is not a function`.

- [ ] **Step 3a: Extend the prefs type + default + load**

In `src/app/gantt-engine.ts`:

Add to the `GanttPrefs` type, right after the `showCriticalPath: boolean;` field (line 38):

```typescript
  /** When true, milestones show a hollow ghost diamond at their committed
   *  baseline date (from the pinned snapshot) with a connector + slip label.
   *  Defaults on; only visible when baseline data exists (Turso). */
  showBaseline: boolean;
```

Add to `DEFAULT_PREFS` (after `showCriticalPath: true,`, line 50):

```typescript
  showBaseline: true,
```

Add to the object returned by `loadPrefs`, right after the `showCriticalPath:` block (after line 94):

```typescript
      // Older saved prefs won't have this field; missing means "on".
      showBaseline:
        typeof parsed.showBaseline === "boolean"
          ? parsed.showBaseline
          : DEFAULT_PREFS.showBaseline,
```

- [ ] **Step 3b: Add the toggle to the hook**

In `src/app/use-gantt-prefs.ts`: add `toggleBaseline: () => void;` to the `GanttPrefsApi` type (after `toggleCriticalPath: () => void;`), add the function after `toggleCriticalPath`:

```typescript
  function toggleBaseline() {
    setPrefs((p) => ({ ...p, showBaseline: !p.showBaseline }));
  }
```

and add `toggleBaseline,` to the returned object (after `toggleCriticalPath,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-gantt-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/gantt-engine.ts src/app/use-gantt-prefs.ts src/app/use-gantt-prefs.test.ts
git commit -m "feat(gantt): showBaseline pref + toggle"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `src/app/i18n.ts` (EN)
- Modify: `src/app/i18n.de.ts` (DE — via node utf8 write)

- [ ] **Step 1: Add the EN keys (Edit tool)**

In `src/app/i18n.ts`, immediately after the `ganttCriticalPathHint` value (ends around line 948, before `health:`), add:

```typescript
  ganttBaseline: "Baseline",
  ganttBaselineHint:
    "Show each milestone's committed baseline date as a ghost diamond behind the current date, to reveal schedule slip.",
```

- [ ] **Step 2: Add the DE keys (node utf8 write — Edit corrupts i18n.de.ts)**

Run this exact command (the anchor is the DE critical-path line at ~937; both DE strings are umlaut-free but the file is still written via node to avoid the Edit tool's quote/encoding corruption):

```bash
node -e '
const fs=require("fs");
const p="src/app/i18n.de.ts";
let s=fs.readFileSync(p,"utf8");
const anchor="  ganttCriticalPath: \"Kritischer Pfad\",\r\n";
const add="  ganttBaseline: \"Baseline\",\r\n  ganttBaselineHint:\r\n    \"Zeigt das zugesagte Baseline-Datum jedes Meilensteins als Geisterraute hinter dem aktuellen Datum, um Terminverschiebungen sichtbar zu machen.\",\r\n";
if(!s.includes(anchor)){console.error("ANCHOR NOT FOUND");process.exit(1);}
if(s.includes("ganttBaseline")){console.error("ALREADY PRESENT");process.exit(1);}
s=s.replace(anchor,anchor+add);
fs.writeFileSync(p,s,"utf8");
console.log("OK");
'
```

If the anchor is not found (line differs), first run `grep -n "ganttCriticalPath" src/app/i18n.de.ts` and adapt the anchor string (keep the `\r\n`).

- [ ] **Step 3: Verify parity + encoding**

Run: `npx tsc --noEmit` (enforces EN/DE key parity)
Run: `npx vitest run src/app/i18n-encoding.test.ts`
Expected: both PASS. Also `grep -n "ganttBaseline" src/app/i18n.de.ts` shows the two new keys.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(gantt): ganttBaseline + hint (EN/DE)"
```

---

### Task 5: Ghost render in `GanttMilestoneRow`

**Files:**
- Modify: `src/app/gantt-rows.tsx` (`GanttMilestoneRow`, lines 387-489)
- Test: `src/app/gantt-rows.test.tsx` (create if it does not exist)

**Context:** the live diamond is an SVG `<rect>` rotated 45° at `x = mx = diffDays(range.min, parseISO(m.date)) * DAY_WIDTH_PX`, width/height `MILESTONE_DIAMOND_PX (14)`, vertically centered in `ROW_HEIGHT_PX (32)`. The ghost mirrors it at the baseline date's x, drawn hollow.

- [ ] **Step 1: Write the failing test**

Create/append `src/app/gantt-rows.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GanttMilestoneRow } from "./gantt-rows";
import type { Milestone } from "./types";

const m: Milestone = { id: 1, name: "M1", date: "2026-06-20", linkedTaskIds: [] };
const base = { lang: "en-US" as const, range: { min: new Date(Date.UTC(2026, 5, 1)) }, timelineWidthPx: 1000, tasksById: new Map(), todayISO: "2026-06-10" };

function countDiamonds(c: HTMLElement): number {
  return c.querySelectorAll("rect[transform^='rotate']").length;
}

describe("GanttMilestoneRow ghost baseline", () => {
  it("renders a single live diamond with no baseline", () => {
    const { container } = render(<GanttMilestoneRow m={m} {...base} />);
    // 2 rects total (gutter icon + timeline diamond), only the timeline one is scaled;
    // the ghost adds a THIRD rotated rect when present.
    expect(countDiamonds(container)).toBe(2);
  });

  it("renders a ghost diamond + connector + slip label when a baseline is set and showBaseline is on", () => {
    const { container, getByText } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-15" showBaseline />,
    );
    expect(countDiamonds(container)).toBe(3); // gutter + live + ghost
    expect(container.querySelector("line")).not.toBeNull(); // connector
    expect(getByText("+5d")).toBeInTheDocument(); // live is 5 days after baseline
  });

  it("shows a negative slip label when the live date is before the baseline", () => {
    const { getByText } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-25" showBaseline />,
    );
    expect(getByText("−5d")).toBeInTheDocument(); // −5d (live is 5 days earlier)
  });

  it("renders no ghost when showBaseline is off", () => {
    const { container } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-15" showBaseline={false} />,
    );
    expect(countDiamonds(container)).toBe(2);
  });

  it("renders no ghost when the baseline equals the live date (zero slip)", () => {
    const { container } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-20" showBaseline />,
    );
    expect(countDiamonds(container)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/gantt-rows.test.tsx`
Expected: FAIL — ghost cases fail (still 2 diamonds, no line, no label; props ignored).

- [ ] **Step 3: Implement the ghost**

In `src/app/gantt-rows.tsx`:

3a. Add the two props to the `GanttMilestoneRow` signature. Change the destructure (lines 387-395) to add `baselineDate` and `showBaseline`, and the prop type (lines 395-403) to add:

```typescript
  baselineDate?: string;
  showBaseline?: boolean;
```

3b. Import the slip helper. The file already imports from `./gantt-engine` (it uses `DAY_WIDTH_PX`, `MILESTONE_DIAMOND_PX`, etc.). Add `milestoneSlipDays` to that existing import list.

3c. After the existing `const mx = diffDays(range.min, md) * DAY_WIDTH_PX;` (line 406), compute the ghost geometry:

```typescript
  // Baseline ghost: a hollow diamond at the committed baseline date, a dotted
  // connector to the live diamond, and a signed slip label. Only when enabled,
  // a baseline exists, it is parseable, and the slip is non-zero.
  const bd = showBaseline && baselineDate ? parseISO(baselineDate) : null;
  const slip = bd ? milestoneSlipDays(baselineDate!, m.date) : null;
  const showGhost = bd !== null && slip !== null && slip !== 0;
  const bx = bd ? diffDays(range.min, bd) * DAY_WIDTH_PX : 0;
  const slipLabel = slip !== null ? `${slip > 0 ? "+" : "−"}${Math.abs(slip)}d` : "";
```

(`parseISO` and `diffDays` are already imported from `./gantt-engine`; if not, add them.)

3d. Fold the baseline into the timeline cell's tooltip. Change the timeline `<div>`'s `title` (line 470) from:

```typescript
        title={`${m.name} · ${m.date}`}
```

to:

```typescript
        title={showGhost ? `${m.name} · ${m.date} · baseline ${baselineDate} (${slipLabel})` : `${m.name} · ${m.date}`}
```

3e. Inside the timeline `<svg>` (the one at lines 472-485), render the ghost BEFORE the existing live `<rect>` so the live diamond paints on top. Insert, immediately after the opening `<svg ...>` tag (line 476) and before the live `<rect>`:

```typescript
          {showGhost && (
            <>
              {/* dotted connector baseline → live, at row mid-height */}
              <line
                x1={bx}
                y1={ROW_HEIGHT_PX / 2}
                x2={mx}
                y2={ROW_HEIGHT_PX / 2}
                stroke="var(--line)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              {/* hollow ghost diamond at the baseline date */}
              <rect
                x={bx - MILESTONE_DIAMOND_PX / 2}
                y={(ROW_HEIGHT_PX - MILESTONE_DIAMOND_PX) / 2}
                width={MILESTONE_DIAMOND_PX}
                height={MILESTONE_DIAMOND_PX}
                transform={`rotate(45 ${bx} ${ROW_HEIGHT_PX / 2})`}
                fill="none"
                stroke="var(--line)"
                strokeWidth={1.5}
              />
            </>
          )}
```

3f. Render the slip label. The SVG uses `preserveAspectRatio="none"` (x scales, so SVG `<text>` would distort horizontally) — render the label as an HTML `<span>` OUTSIDE the svg but inside the timeline `<div>`, absolutely positioned. Immediately after the closing `</svg>` (line 485) and before the timeline `</div>` (line 486), add:

```typescript
        {showGhost && (
          <span
            className="pointer-events-none absolute -translate-y-1/2 text-[10px] text-muted-foreground"
            style={{ left: mx + MILESTONE_DIAMOND_PX, top: ROW_HEIGHT_PX / 2 }}
            aria-hidden="true"
          >
            {slipLabel}
          </span>
        )}
```

Note: the timeline `<div>` (line 467) is already `className="relative"`, so `absolute` positions against it. The ghost `<line>`/`<rect>` are decorative inside an `aria-hidden`-equivalent SVG context; the slip is also in the `title` (the accessible channel).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/gantt-rows.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/gantt-rows.tsx src/app/gantt-rows.test.tsx
git commit -m "feat(gantt): milestone baseline ghost diamond + connector + slip label"
```

---

### Task 6: Toolbar toggle + GanttPanel wiring

**Files:**
- Modify: `src/app/gantt-chrome.tsx` (`GanttToolbar`)
- Modify: `src/app/gantt.tsx` (`GanttPanel` prop + toolbar render + milestone-row render)

- [ ] **Step 1: Add the toolbar button (gated on `hasBaseline`)**

In `src/app/gantt-chrome.tsx` `GanttToolbar`:

1a. Add to the destructure (after `toggleCriticalPath,` line 40): `toggleBaseline,` and `hasBaseline,`.
1b. Add to the prop type (after `toggleCriticalPath: () => void;` line 55):

```typescript
  toggleBaseline: () => void;
  hasBaseline: boolean;
```

1c. Immediately AFTER the closing `</button>` of the critical-path button (line 189) and before `<PrintButton ... />` (line 190), add the Baseline button — mirrors the critical-path button but uses a dark-blue active accent (not pink, which is critical-path's semantic) and only renders when a baseline exists:

```typescript
      {hasBaseline && (
        <button
          type="button"
          onClick={toggleBaseline}
          aria-pressed={prefs.showBaseline}
          title={t(lang, "ganttBaselineHint")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 ${
            prefs.showBaseline
              ? "border-AIPM-dark-blue bg-AIPM-dark-blue/10 text-AIPM-dark-blue hover:bg-AIPM-dark-blue/20 focus:ring-AIPM-dark-blue dark:border-AIPM-dark-blue dark:bg-AIPM-dark-blue/20 dark:text-AIPM-light-grey"
              : "border-line bg-surface text-foreground hover:bg-surface-muted focus:ring-AIPM-green"
          }`}
        >
          {/* ghost + solid diamond glyph — baseline vs current */}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <rect x={2} y={7} width={5} height={5} transform="rotate(45 4.5 9.5)" />
            <rect x={11} y={7} width={5} height={5} transform="rotate(45 13.5 9.5)" fill="currentColor" />
          </svg>
          <span>{t(lang, "ganttBaseline")}</span>
        </button>
      )}
```

- [ ] **Step 2: Thread the props through `GanttPanel`**

In `src/app/gantt.tsx`:

2a. Add the panel prop. In the `GanttPanel` destructure (lines 59-73) add `baselineMilestoneDates,`; in the prop type (lines 74-84) add:

```typescript
  baselineMilestoneDates?: ReadonlyMap<number, string>;
```

2b. Add `toggleBaseline` to the `useGanttPrefs()` destructure (around line 103, alongside `toggleCriticalPath`).

2c. Compute `hasBaseline` near the other derived values (a simple const in the component body, before the return):

```typescript
  const hasBaseline = (baselineMilestoneDates?.size ?? 0) > 0;
```

2d. In the `<GanttToolbar ... />` render (line 447), add the two props:

```typescript
        toggleBaseline={toggleBaseline}
        hasBaseline={hasBaseline}
```

2e. In the `<GanttMilestoneRow ... />` render (lines 581-590), add:

```typescript
                baselineDate={baselineMilestoneDates?.get(m.id)}
                showBaseline={prefs.showBaseline}
```

- [ ] **Step 3: Verify typecheck + existing tests**

Run: `npx tsc --noEmit`  → Expected: exit 0.
Run: `npx vitest run src/app/gantt-rows.test.tsx src/app/use-gantt-prefs.test.ts`  → Expected: PASS.
Run: `npx eslint src/app/gantt-chrome.tsx src/app/gantt.tsx --max-warnings=0`  → Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/gantt-chrome.tsx src/app/gantt.tsx
git commit -m "feat(gantt): baseline toolbar toggle + panel wiring"
```

---

### Task 7: Thread `baselineMilestoneDates` from task-manager (Turso-gated)

**Files:**
- Modify: `src/app/workspace-section-types.ts`
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add the prop to the section contract**

In `src/app/workspace-section-types.ts`, add to `WorkspaceSectionProps` (near the other Gantt/milestone props):

```typescript
  /** Per-milestone committed baseline dates for the Gantt ghost overlay.
   *  Undefined/empty off Turso or with no pinned baseline snapshot. */
  baselineMilestoneDates?: ReadonlyMap<number, string>;
```

- [ ] **Step 2: Forward it to GanttPanel**

In `src/app/workspace-section.tsx`, in the `<GanttPanel ... />` render (around line 348), add:

```typescript
              baselineMilestoneDates={baselineMilestoneDates}
```

and add `baselineMilestoneDates` to the props destructured from `WorkspaceSectionProps` at the top of the component (wherever the other props like `milestones` are pulled in).

- [ ] **Step 3: Derive + thread the memo in task-manager**

In `src/app/task-manager.tsx`:

3a. Add the import to the existing `./snapshot` import (or add a new import line if none):

```typescript
import { baselineMilestoneTargets } from "./snapshot";
```

3b. After the `snapshots` / `trendsActive` are defined (around lines 449-477 — `snapshots` is the `useSnapshots(...)` result, `trendsActive` the Turso+module gate), add:

```typescript
  // Per-milestone baseline dates for the Gantt ghost overlay — only when
  // snapshots are live (Turso). Empty/undefined off Turso → no overlay.
  const baselineMilestoneDates = useMemo(
    () => (trendsActive ? baselineMilestoneTargets(snapshots.snapshots) : undefined),
    [trendsActive, snapshots.snapshots],
  );
```

3c. Add `baselineMilestoneDates,` to the object passed as `WorkspaceSectionProps` (the same block that already passes `milestones`, `trends`, etc. — around line 1179/1696; put it near `milestones`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`  → Expected: exit 0.
Run: `npx vitest run src/app/workspace-section.characterization.test.tsx src/app/task-manager.characterization.test.tsx`  → Expected: PASS (if these pin the prop contract, they may need the new optional prop added to their expected set — if a characterization test fails on a missing/extra prop, add `baselineMilestoneDates` to its expected prop list; it is optional so existing callers are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/task-manager.tsx
git commit -m "feat(gantt): thread Turso-gated baselineMilestoneDates to the Gantt"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm run lint` → exit 0 (`--max-warnings=0`)
- [ ] `npm run test:run` → all pass
- [ ] `npm run size:check` → ok (if `gantt-rows.tsx`/`gantt.tsx`/`gantt-chrome.tsx` cross a baseline, run `node scripts/check-file-sizes.mjs --update` — legit growth)
- [ ] `npm run dup:check` → under threshold (the Baseline toolbar button mirrors the critical-path button; if jscpd flags the pair, that is a known near-clone of a small JSX block — acceptable, but confirm the % stays < 1.75)
- [ ] `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt"` → pass (file-mode seed has no baseline, so ghosts/toggle are absent at scan time — this confirms no regression)
- [ ] **Eye-verify the Turso path** (no automated coverage): with a Turso project that has a pinned baseline snapshot and a milestone whose date moved since, open the Gantt — a hollow ghost diamond sits at the old date, a dotted connector runs to the live diamond, a `+Nd`/`−Nd` label shows; the toolbar Baseline toggle appears and hides/shows the overlay; the pref persists across reload.

Then run the superpowers:requesting-code-review flow, then finish the branch (do NOT push/MR until the user says "release").

## Self-review notes
- Spec coverage: baseline·target (Task 1), slip label sign (Task 2 + 5), default-on toggle (Task 3 + 6), ghost+connector+label visual (Task 5), Turso-gating (Task 7), toggle-only-when-baseline (Task 6 `hasBaseline`), a11y title channel (Task 5 3d), palette tokens only (Tasks 5/6). All covered.
- Type consistency: `baselineMilestoneTargets` → `Map<number,string>`; prop `baselineMilestoneDates?: ReadonlyMap<number,string>`; `milestoneSlipDays(baselineISO, liveISO): number | null`; `showBaseline: boolean`; `toggleBaseline: () => void`; `hasBaseline: boolean` — consistent across Tasks 1/2/3/5/6/7.
- `diffDays(a,b) = round((b−a)/DAY_MS)` confirmed → `milestoneSlipDays(baseline, live)` positive when live later. Correct.
