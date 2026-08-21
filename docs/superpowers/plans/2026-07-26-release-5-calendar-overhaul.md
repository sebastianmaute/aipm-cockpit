# R5 Calendar Overhaul (0.202.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Resources → Calendar grid into a general datebox surface: weekday + ISO-week headers, silent start>end clamping, drag/resize/reassign of absences, and a new recurring `CalendarEvent` entity rendered as a meetings band with a series list and editor.

**Architecture:** All decision logic lands in pure, i18n-free, clock-free modules (`date-range.ts`, `calendar-drag.ts`, `calendar-event.ts`, `recurrence.ts`, `occurrence-lanes.ts`) that are unit-tested directly. `resource-calendar.tsx` splits on the gantt convention into orchestrator + `-rows` + `-band` before it approaches the 800-line ratchet. `CalendarEvent` is a real row entity: one `ENTITY_SPECS` registration buys CSV plus both Turso schemas, with Markdown/JSON/IndexedDB wired by hand.

**Tech Stack:** Next.js 16 + React (client components), TypeScript strict, vitest + @testing-library/react, fast-check for property tests, Tailwind v4 with AIPM brand tokens only.

**Spec:** `docs/superpowers/specs/2026-07-26-r5-calendar-overhaul-design.md` (slices S1–S5; S6–S7 are the separate 0.203.0 plan).

---

## Ground rules for every task

Read these once before Task 1. They are repo-specific and violating them fails CI.

- **Lint is `--max-warnings=0`.** An unused import or variable is fatal. `react-hooks/exhaustive-deps` rejects an `obj.member` dep — hoist to a scalar local first. `react-hooks/set-state-in-effect` is banned; sync state to a changed prop with the render-time reconcile pattern.
- **A react-hooks purity rule bans `Date.now()` / `new Date()` / `Math.random()` in a render body**, including inside `useMemo`. Capture via a lazy `useState(() => …)` or read it inside an effect/callback.
- **Run `npx tsc --noEmit` after editing ANY test file.** `next build` does not typecheck tests and vitest never typechecks, so a test-only type error passes locally and fails CI.
- **`i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical** (tsc enforces). `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double-quotes in it — patch it with a node utf8 write matching `\r\n`, then grep-verify. DE must use real umlauts; ASCII substitutions (`fuer`, `druecken`) are banned by `i18n-encoding.test`.
- **Palette:** sanctioned AIPM tokens only. No gradients, no shadows, no off-palette colors. The guards scan comments too — do not write the bare word "shadow" in prose.
- **Commit after every task** using conventional-commit format (`feat:`, `fix:`, `test:`, `refactor:`).
- Full-suite command is `npm run test:run`. A run reporting far fewer FILES than ~721 has not passed — it partly did not run (worker crashes). Treat a file-count shortfall as a red flag.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/date-range.ts` | `clampRangeEnd` — the one range invariant, shared by the absence and event editors |
| `src/app/calendar-drag.ts` | Pure drag/resize/reassign resolution → an `Absence` patch |
| `src/app/calendar-event.ts` | `CalendarEvent` types, `sanitizeCalendarEvent`, JSON-in-cell encode/decode |
| `src/app/recurrence.ts` | Pure occurrence expansion over a window, exceptions applied |
| `src/app/occurrence-lanes.ts` | Pure lane packing for overlapping same-day occurrences |
| `src/app/resource-calendar-rows.tsx` | Presentational assignee rows (extracted) |
| `src/app/resource-calendar-band.tsx` | Presentational meetings band |
| `src/app/calendar-event-modal.tsx` | Series create/edit modal |
| `src/app/calendar-series-list.tsx` | All-series list (built on `DataTable`) |
| `src/app/drag-handle.tsx` | Shared grip atom — extracted from `ColumnResizeHandle`, consumed by it and by the calendar edge-resize |
| `src/app/calendar-chip.tsx` | Shared interactive chip primitive for calendar occurrences |
| `src/app/entity-chip-picker.tsx` | Generic multi-select chip picker — `StakeholderChipPicker` / `TaskLinkPicker` / attendees all build on it |

### No hand-rolled controls (standing rule)

Where a shared primitive covers a need, USE it — do not hand-roll, and do not
adapt one past what it means. The four decisions taken for this release:

| Need | Decision |
|---|---|
| Absence edge-resize grip | Extract a shared `DragHandle` atom; `ColumnResizeHandle` (`task-manager-ui.tsx:94`) refactors onto it |
| Occurrence chip in the band | New shared `CalendarChip` primitive (`Badge` is a non-interactive `<span>`, so nothing existing fits) |
| All-series list | `DataTable` + `SortResizeTh` + `EmptyState`, like every other register |
| Attendees multi-select | **DEFERRED to 0.203.0** — no picker this release (see below) |

Two of these refactor shipped code (`ColumnResizeHandle`, the two pickers), so
each gets its own task with the existing tests as the regression net — Tasks 6a
and 14a below. Anything else that looks like it wants a new control: STOP and ask
before building it.

**Modified:** `resource-capacity.ts` (export `isoWeekParts`), `resource-calendar.tsx`, `absence-edit-modal.tsx`, `csv-codecs-core.ts`, `csv-codecs-config.ts`, `csv-codecs-decode.ts`, `markdown-codecs-core.ts`, `markdown-codecs-decode.ts`, `turso-schema.ts`, `workspace.ts`, `browser-backend.ts`, `workspace-context.tsx`, `use-storage-backend.ts`, `task-manager.tsx`, `resources-panel.tsx`, `use-resource-planner.ts`, `i18n.ts`, `i18n.de.ts`, `version.ts`, `package.json`, `CHANGELOG.md`, `AGENTS.md`.

---

# Slice S1 — Grid chrome + range clamp

## Task 1: Export `isoWeekParts`, add weekday + week to `CalendarDay`

**Files:**
- Modify: `src/app/resource-capacity.ts:26`
- Modify: `src/app/resource-calendar.tsx:~95` (the `CalendarDay` interface) and the `days` useMemo
- Test: `src/app/resource-calendar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/resource-calendar.test.tsx`:

```tsx
import { isoWeekParts } from "./resource-capacity";

describe("isoWeekParts", () => {
  it("is exported and gives the ISO week-numbering year and week", () => {
    expect(isoWeekParts(new Date("2026-07-26T00:00:00Z"))).toEqual({ year: 2026, week: 30 });
  });

  it("keeps a January date in the previous ISO year when the week straddles", () => {
    // 2026-12-28 is the Monday of 2026-W53; 2027-01-01 falls inside that same week.
    expect(isoWeekParts(new Date("2026-12-28T00:00:00Z"))).toEqual({ year: 2026, week: 53 });
    expect(isoWeekParts(new Date("2027-01-01T00:00:00Z"))).toEqual({ year: 2026, week: 53 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "isoWeekParts"`
Expected: FAIL — `isoWeekParts` is not exported from `./resource-capacity`.

- [ ] **Step 3: Export the existing helper**

In `src/app/resource-capacity.ts`, change line 26 from:

```ts
function isoWeekParts(d: Date): { year: number; week: number } {
```

to:

```ts
/** ISO-8601 week-numbering year + week for a UTC date. Exported for the
 *  calendar's week band — do NOT write a second implementation, the
 *  periodKeyForDate contract below depends on this being the only one. */
export function isoWeekParts(d: Date): { year: number; week: number } {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "isoWeekParts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for the day model**

Append to `src/app/resource-calendar.test.tsx`:

```tsx
it("renders a weekday label above each day number", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-29"
    />,
  );
  // 2026-07-27 is a Monday.
  expect(screen.getByText("Mon")).toBeInTheDocument();
  expect(screen.getByText("Tue")).toBeInTheDocument();
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "weekday label"`
Expected: FAIL — unable to find text `Mon`.

- [ ] **Step 7: Extend `CalendarDay` and the `days` memo**

In `src/app/resource-calendar.tsx`, add to the `CalendarDay` interface:

```ts
interface CalendarDay {
  iso: string;
  dayOfMonth: number;
  /** Localised short weekday, e.g. "Mon" / "Mo". */
  weekdayLabel: string;
  /** ISO-8601 week number (1-53) of this date. */
  isoWeek: number;
  /** Month label shown on the first day and at each month transition. */
  monthLabel: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
}
```

Add the import:

```ts
import { isoWeekParts } from "./resource-capacity";
```

Inside the `days` useMemo, in the `out.push({ … })` call, add the two fields:

```ts
      out.push({
        iso,
        dayOfMonth: d.getUTCDate(),
        weekdayLabel: d.toLocaleDateString(loc, { weekday: "short" }),
        isoWeek: isoWeekParts(d).week,
        monthLabel: monthChange ? d.toLocaleDateString(loc, { month: "short" }) : "",
        isWeekend: dow === 0 || dow === 6,
        isHoliday: holidaySet.has(iso),
        isToday: iso === today,
      });
```

In the day `<th>` render block, replace the inner `<div className="leading-tight">` contents:

```tsx
                  <div className="leading-tight">
                    <div className="h-3 text-[9px] font-semibold uppercase">
                      {d.monthLabel}
                    </div>
                    <div className="text-[9px] uppercase opacity-80">{d.weekdayLabel}</div>
                    <div className="tabular-nums">{d.dayOfMonth}</div>
                  </div>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/app/resource-calendar.test.tsx`
Expected: PASS, all tests in the file.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/resource-capacity.ts src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx
git commit -m "feat(calendar): show weekday labels and export isoWeekParts"
```

---

## Task 2: ISO week-number band header row

**Files:**
- Modify: `src/app/resource-calendar.tsx` (the `<thead>` block at ~line 219)
- Test: `src/app/resource-calendar.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the i18n key**

In `src/app/i18n.ts`, beside the other `resources*` keys:

```ts
  calendarWeekAbbrev: "W",
```

In `src/app/i18n.de.ts`, patch with a node utf8 write (the file is CRLF and the Edit tool corrupts it):

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const anchor='  resourcesHoliday:';if(!s.includes(anchor))throw new Error('anchor missing');s=s.replace(anchor,'  calendarWeekAbbrev: \"KW\",\r\n'+anchor);fs.writeFileSync(p,s,'utf8');console.log('ok')"
grep -n "calendarWeekAbbrev" src/app/i18n.de.ts
```

Expected: prints `ok` then the new DE line.

- [ ] **Step 2: Write the failing test**

Append to `src/app/resource-calendar.test.tsx`:

```tsx
it("groups day columns under an ISO week band", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-08-03"
    />,
  );
  // Mon 2026-07-27 .. Sun 2026-08-02 is W31; Mon 2026-08-03 starts W32.
  const w31 = screen.getByText("W31");
  expect(w31).toBeInTheDocument();
  expect(w31.closest("th")).toHaveAttribute("colspan", "7");
  expect(screen.getByText("W32").closest("th")).toHaveAttribute("colspan", "1");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "ISO week band"`
Expected: FAIL — unable to find text `W31`.

- [ ] **Step 4: Derive the week runs**

In `src/app/resource-calendar.tsx`, directly after the `days` useMemo, add:

```ts
  // Contiguous runs of same-ISO-week columns, for the header band's colSpans.
  // Derived from `days` alone so it can never disagree with the day row.
  const weekRuns = useMemo<{ week: number; span: number }[]>(() => {
    const runs: { week: number; span: number }[] = [];
    for (const d of days) {
      const last = runs[runs.length - 1];
      if (last && last.week === d.isoWeek) last.span += 1;
      else runs.push({ week: d.isoWeek, span: 1 });
    }
    return runs;
  }, [days]);
```

- [ ] **Step 5: Render the band row**

In the `<thead>` block, insert a new `<tr>` BEFORE the existing `<tr role="row">`:

```tsx
            <tr role="row">
              <th
                role="columnheader"
                aria-hidden="true"
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-ui-dark-blue px-3 py-0.5"
                style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX }}
              />
              {weekRuns.map((run, i) => (
                <th
                  key={`${run.week}-${i}`}
                  role="columnheader"
                  colSpan={run.span}
                  className="sticky top-0 z-20 border-b border-r border-line bg-ui-dark-blue px-1 py-0.5 text-center text-[10px] font-semibold tracking-wide text-white"
                >
                  {`${t(lang, "calendarWeekAbbrev")}${run.week}`}
                </th>
              ))}
            </tr>
```

Then change the EXISTING day-header `<th>`s from `sticky top-0` to `sticky top-[18px]` so the second header row sticks below the band instead of on top of it (the band row is `py-0.5` + 10px text ≈ 18px). The sticky assignee `<th>` in that row changes the same way.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/app/resource-calendar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verify roving is intact**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "grid"`
Expected: PASS — the existing roving/arrow-key tests still pass, because `data-cell` lives on body cells only and the new row is in `<thead>`.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): add an ISO week-number band to the grid header"
```

---

## Task 3: `clampRangeEnd` + absence editor clamps instead of erroring

**Files:**
- Create: `src/app/date-range.ts`
- Create: `src/app/date-range.test.ts`
- Modify: `src/app/absence-edit-modal.tsx:~149`
- Test: `src/app/absence-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/date-range.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampRangeEnd } from "./date-range";

describe("clampRangeEnd", () => {
  it("returns the end unchanged when it is not before the start", () => {
    expect(clampRangeEnd("2026-07-01", "2026-07-05")).toBe("2026-07-05");
    expect(clampRangeEnd("2026-07-01", "2026-07-01")).toBe("2026-07-01");
  });

  it("collapses an end that precedes the start", () => {
    expect(clampRangeEnd("2026-07-10", "2026-07-05")).toBe("2026-07-10");
  });

  it("leaves a blank or malformed end alone rather than inventing a date", () => {
    expect(clampRangeEnd("2026-07-10", "")).toBe("");
    expect(clampRangeEnd("", "2026-07-05")).toBe("2026-07-05");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/date-range.test.ts`
Expected: FAIL — cannot find module `./date-range`.

- [ ] **Step 3: Write the implementation**

Create `src/app/date-range.ts`:

```ts
// Shared date-range invariant. Pure, i18n-free, no clock.
//
// ISO dates compare correctly as strings, so no Date parsing is needed — and
// none is wanted: an empty or half-typed value must pass through untouched so
// a mid-edit input is never rewritten under the user's cursor.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The end of a range, clamped so it can never precede the start.
 * Returns `end` unchanged unless both values are complete ISO dates AND
 * `end < start`, in which case it returns `start` (a single-day range).
 */
export function clampRangeEnd(start: string, end: string): string {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return end;
  return end < start ? start : end;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/date-range.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing modal test**

Append to `src/app/absence-edit-modal.test.tsx` (match the existing render helper in that file for props):

```tsx
it("pulls the end date along when the start moves past it", async () => {
  const onSave = vi.fn();
  renderModal({
    absence: { id: 1, assignee: "Anna", startDate: "2026-07-01", endDate: "2026-07-03", type: "vacation" },
    isNew: false,
    onSave,
  });
  const start = screen.getByLabelText(/start/i);
  fireEvent.change(start, { target: { value: "2026-07-10" } });
  expect((screen.getByLabelText(/end/i) as HTMLInputElement).value).toBe("2026-07-10");
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/absence-edit-modal.test.tsx -t "pulls the end date"`
Expected: FAIL — end input still reads `2026-07-03`.

- [ ] **Step 7: Wire the clamp into the start-date field**

In `src/app/absence-edit-modal.tsx`, add the import:

```ts
import { clampRangeEnd } from "./date-range";
```

Change the start-date input's `onChange` (currently `onChange={(e) => update("startDate", e.target.value)}`) to:

```tsx
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setDraft((prev) =>
                      prev
                        ? { ...prev, startDate: nextStart, endDate: clampRangeEnd(nextStart, prev.endDate) }
                        : prev,
                    );
                  }}
```

Leave the `endDate < startDate` submit check at line 75 in place — it is the backstop for a typed end date, and `sanitizeAbsence`'s swap stays untouched.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/app/absence-edit-modal.test.tsx`
Expected: PASS, all tests in the file (the existing "rejects end before start" test still passes — it edits the END field, which is unclamped).

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/date-range.ts src/app/date-range.test.ts src/app/absence-edit-modal.tsx src/app/absence-edit-modal.test.tsx
git commit -m "feat(calendar): clamp the absence end date when the start moves past it"
```

---

# Slice S2 — Drag / resize / reassign

## Task 4: Pure `calendar-drag.ts`

**Files:**
- Create: `src/app/calendar-drag.ts`
- Create: `src/app/calendar-drag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-drag.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveCalendarDrag } from "./calendar-drag";
import type { Absence, Resource } from "./types";

const abs: Absence = {
  id: 7,
  assignee: "Anna",
  assigneeEmail: "anna@example.com",
  startDate: "2026-07-06",
  endDate: "2026-07-08",
  type: "vacation",
  resourceId: 3,
};

describe("resolveCalendarDrag", () => {
  it("moves the whole range, preserving the span", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-07", dropDate: "2026-07-09",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    });
    expect(out).toEqual({ kind: "move", patch: { startDate: "2026-07-08", endDate: "2026-07-10" } });
  });

  it("moves backwards across a month boundary", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-06-30",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    });
    expect(out?.patch).toEqual({ startDate: "2026-06-30", endDate: "2026-07-02" });
  });

  it("reassigns when dropped on another row, rewriting all three identity fields", () => {
    const ben: Resource = {
      id: 9, firstName: "Ben", lastName: "Stone", email: "ben@example.com",
    } as Resource;
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-06",
      currentRowKey: "anna", dropRowKey: "ben stone", mode: "move",
      dropRow: { display: "Ben Stone", email: "ben@example.com", resource: ben },
    });
    expect(out).toEqual({
      kind: "reassign",
      patch: {
        startDate: "2026-07-06", endDate: "2026-07-08",
        assignee: "Ben Stone", assigneeEmail: "ben@example.com", resourceId: 9,
      },
    });
  });

  it("clears the FK when the target row has no backing resource", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-06",
      currentRowKey: "anna", dropRowKey: "cara", mode: "move",
      dropRow: { display: "Cara", email: "", resource: undefined },
    });
    expect(out?.patch).toMatchObject({ assignee: "Cara", assigneeEmail: undefined, resourceId: undefined });
  });

  it("resizes the end", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-08", dropDate: "2026-07-11",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-end",
    });
    expect(out).toEqual({ kind: "resize", patch: { startDate: "2026-07-06", endDate: "2026-07-11" } });
  });

  it("collapses to a single day when a resize crosses over", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-08", dropDate: "2026-07-04",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-end",
    });
    expect(out?.patch).toEqual({ startDate: "2026-07-06", endDate: "2026-07-06" });
  });

  it("resizes the start and clamps the other way", () => {
    const out = resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-06", dropDate: "2026-07-20",
      currentRowKey: "anna", dropRowKey: "anna", mode: "resize-start",
    });
    expect(out?.patch).toEqual({ startDate: "2026-07-20", endDate: "2026-07-20" });
  });

  it("returns null for a no-op drop so a stray click writes nothing", () => {
    expect(resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-07", dropDate: "2026-07-07",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    })).toBeNull();
  });

  it("returns null for a malformed drop date rather than producing NaN dates", () => {
    expect(resolveCalendarDrag({
      absence: abs, grabbedDate: "2026-07-07", dropDate: "not-a-date",
      currentRowKey: "anna", dropRowKey: "anna", mode: "move",
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-drag.test.ts`
Expected: FAIL — cannot find module `./calendar-drag`.

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-drag.ts`:

```ts
// Pure resolution of a calendar grid gesture (drag-move, drag-reassign,
// edge-resize) into an Absence patch. i18n-free, clock-free, no React.
//
// The component decides WHICH gesture happened; this module decides what the
// gesture MEANS. Everything the caller needs to write is in `patch` — the
// caller never recomputes a date.

import { clampRangeEnd } from "./date-range";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, Resource } from "./types";

export type DragMode = "move" | "resize-start" | "resize-end";

export interface DragDropRow {
  /** Original-case display name of the target row. */
  display: string;
  /** First email observed for that row; "" when unknown. */
  email: string;
  /** Backing directory resource, when the row has one. */
  resource: Resource | undefined;
}

export interface CalendarDragInput {
  absence: Absence;
  /** The date cell the gesture STARTED on. */
  grabbedDate: string;
  /** The date cell the gesture ENDED on. */
  dropDate: string;
  currentRowKey: string;
  dropRowKey: string;
  mode: DragMode;
  /** Required only when dropRowKey differs from currentRowKey. */
  dropRow?: DragDropRow;
}

export interface CalendarDragResult {
  kind: "move" | "reassign" | "resize";
  patch: Partial<Absence>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Resolve a grid gesture into an Absence patch, or `null` when it is a no-op
 * or the input is unusable. A `null` result must write nothing — that is what
 * keeps a stray click from being recorded as an edit.
 *
 * The patch always carries BOTH dates, even when only one moved, so the caller
 * writes one coherent range and an undo entry restores one coherent range.
 */
export function resolveCalendarDrag(input: CalendarDragInput): CalendarDragResult | null {
  const { absence, grabbedDate, dropDate, currentRowKey, dropRowKey, mode, dropRow } = input;

  const drop = toUtc(dropDate);
  const grabbed = toUtc(grabbedDate);
  const start = toUtc(absence.startDate);
  const end = toUtc(absence.endDate);
  if (drop === null || grabbed === null || start === null || end === null) return null;

  const rowChanged = dropRowKey !== currentRowKey;

  if (mode === "resize-start") {
    if (dropDate === absence.startDate) return null;
    // Clamp forwards: a start dragged past the end collapses to a single day.
    const nextEnd = clampRangeEnd(dropDate, absence.endDate);
    return { kind: "resize", patch: { startDate: dropDate, endDate: nextEnd } };
  }

  if (mode === "resize-end") {
    if (dropDate === absence.endDate) return null;
    // Clamp backwards: an end dragged before the start collapses to a single day.
    const nextEnd = clampRangeEnd(absence.startDate, dropDate);
    return { kind: "resize", patch: { startDate: absence.startDate, endDate: nextEnd } };
  }

  const deltaDays = Math.round((drop - grabbed) / DAY_MS);
  if (deltaDays === 0 && !rowChanged) return null;

  const patch: Partial<Absence> = {
    startDate: addDays(absence.startDate, deltaDays),
    endDate: addDays(absence.endDate, deltaDays),
  };

  if (!rowChanged) return { kind: "move", patch };

  // A reassign rewrites all three identity fields together. Writing the name
  // without the FK would leave the absence pointing at the previous person's
  // resource record, which every downstream rollup reads.
  const res = dropRow?.resource;
  return {
    kind: "reassign",
    patch: {
      ...patch,
      assignee: res ? resourceDisplayName(res) : (dropRow?.display ?? absence.assignee),
      assigneeEmail: (res?.email || dropRow?.email) || undefined,
      resourceId: res?.id,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/calendar-drag.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/app/calendar-drag.ts src/app/calendar-drag.test.ts
git commit -m "feat(calendar): add the pure drag/resize/reassign resolver"
```

---

## Task 5: Wire drag-move and drag-reassign into the grid

**Files:**
- Modify: `src/app/resource-calendar.tsx`
- Modify: `src/app/resources-panel.tsx` (thread the new `onMoveAbsence` prop)
- Test: `src/app/resource-calendar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/resource-calendar.test.tsx`:

```tsx
it("calls onMoveAbsence with the resolved patch when a range is dragged", () => {
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-28", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const cells = screen.getAllByRole("gridcell");
  const dt = { data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(cells[0].querySelector("button")!, { dataTransfer: dt });
  fireEvent.drop(cells[2].querySelector("button")!, { dataTransfer: dt });
  expect(onMoveAbsence).toHaveBeenCalledWith(7, { startDate: "2026-07-29", endDate: "2026-07-30" }, "move");
});

it("does not open the absence editor when a drag ends on the same cell", () => {
  const onEditAbsence = vi.fn();
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={onEditAbsence}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const btn = screen.getAllByRole("gridcell")[0].querySelector("button")!;
  const dt = { data: {} as Record<string, string>,
    setData(k: string, v: string) { this.data[k] = v; },
    getData(k: string) { return this.data[k] ?? ""; },
    effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(btn, { dataTransfer: dt });
  fireEvent.drop(btn, { dataTransfer: dt });
  fireEvent.click(btn);
  expect(onMoveAbsence).not.toHaveBeenCalled();
  expect(onEditAbsence).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "onMoveAbsence"`
Expected: FAIL — `onMoveAbsence` is not a known prop.

- [ ] **Step 3: Add the prop and the drag state**

In `src/app/resource-calendar.tsx`, add to `Props`:

```ts
  /** Commit a drag/resize/reassign. Omit to make the grid read-only (popout). */
  onMoveAbsence?: (id: number, patch: Partial<Absence>, kind: "move" | "reassign" | "resize") => void;
```

Add the import and destructure `onMoveAbsence` in the parameter list. Then, beside the other refs:

```ts
  // The gesture currently in flight. A ref (not state) because the drop handler
  // reads it synchronously and re-rendering mid-drag would tear the ghost.
  const dragRef = useRef<{ absenceId: number; grabbedDate: string; rowKey: string; mode: DragMode } | null>(null);
  // Set by a completed drag so the click that browsers fire afterwards is
  // ignored — otherwise every drag also opens the absence editor.
  const suppressClickRef = useRef(false);
```

- [ ] **Step 4: Wire the handlers onto the cell button**

Replace the cell `<button>` in the days map with this version (the additions are `draggable`, the four drag handlers, and the click guard):

```tsx
                        <button
                          type="button"
                          data-cell={`${rowIndex}-${colIndex}`}
                          draggable={!!hit && !!onMoveAbsence}
                          onDragStart={(e) => {
                            if (!hit || !onMoveAbsence) return;
                            dragRef.current = { absenceId: hit.id, grabbedDate: d.iso, rowKey: row.key, mode: "move" };
                            e.dataTransfer.effectAllowed = "move";
                            // Firefox requires data to be set or the drag never starts.
                            e.dataTransfer.setData("text/plain", String(hit.id));
                          }}
                          onDragOver={(e) => {
                            if (!dragRef.current || !onMoveAbsence) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            const drag = dragRef.current;
                            dragRef.current = null;
                            if (!drag || !onMoveAbsence) return;
                            e.preventDefault();
                            suppressClickRef.current = true;
                            const moving = absences.find((a) => a.id === drag.absenceId);
                            if (!moving) return;
                            const result = resolveCalendarDrag({
                              absence: moving,
                              grabbedDate: drag.grabbedDate,
                              dropDate: d.iso,
                              mode: drag.mode,
                              target: row.key === drag.rowKey
                                ? { kind: "same-row" }
                                : {
                                    kind: "other-row",
                                    rowKey: row.key,
                                    row: { display: row.display, email: row.email, resource: resourceByKey.get(row.key) },
                                  },
                            });
                            if (result) onMoveAbsence(moving.id, result.patch, result.kind);
                          }}
                          onDragEnd={() => { dragRef.current = null; }}
                          tabIndex={rowIndex === focusRow && colIndex === focusCol ? 0 : -1}
                          onClick={() => {
                            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                            setFocusCell({ row: rowIndex, col: colIndex });
                            handleClick();
                          }}
                          title={tip}
                          aria-label={tip}
                          className={`flex h-full w-full items-center justify-center text-[11px] font-semibold tabular-nums focus:ring-inset ${INTERACTIVE} ${baseBg}`}
                        >
                          {hit ? (
                            <span className="text-foreground">
                              {absenceGlyph(hit.type)}
                            </span>
                          ) : null}
                        </button>
```

Add the import:

```ts
import { resolveCalendarDrag, type DragMode } from "./calendar-drag";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/resource-calendar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Thread the handler from the panel**

In `src/app/resources-panel.tsx`, at the `<ResourceCalendar … />` mount (~line 580), add:

```tsx
            onMoveAbsence={
              isPopout || !onSaveAbsence
                ? undefined
                : (id, patch) => {
                    const target = absences.find((a) => a.id === id);
                    if (target) onSaveAbsence({ ...target, ...patch });
                  }
            }
```

★★ **CORRECTED against the real code — the original text here was wrong on two counts.**

1. **`ResourcesPanel` receives NO absence save prop.** It gets only `onAddAbsence` / `onEditAbsence`, which merely OPEN the modal. The real save path is `handleSaveAbsence` (`use-resource-planner.ts:344`), threaded today only into `app-modals.tsx` for the editor's `onSave`. So the full chain `task-manager.tsx` → `workspace-section.tsx` → `ResourcesPanel` must be threaded, or the drag is **inert in the live app** — `onMoveAbsence` stays `undefined` at the mount site and the cells are never `draggable`.

2. **`handleSaveAbsence` captures NO undo entry.** Unlike `handleSaveRaidItem` (which uses `captureFieldChanges`), it only stamps `localModifiedAt` and logs the activity. The claim that a drag would inherit undo "for free" was false.

Route the drag through `handleSaveAbsence` (never a raw `setAbsences` — that would be a second write path), and capture undo **at the drag entry point in `task-manager.tsx`**, using `captureFieldEdit`. ONE gesture ⇒ ONE entry whose `before`/`after` cover every patched field, so a reassign (assignee + email + FK + both dates) undoes as a unit.

★ Do NOT add capture inside `handleSaveAbsence` itself — that would silently give modal edits undo behaviour this release never asked for, changing a shipped flow as a side effect. Undo is load-bearing for a drag specifically because a mis-drop is one slip and the user may not remember the original dates; someone who opened the editor and typed is in a different position.

- [ ] **Step 7: Verify end to end**

Run: `npx vitest run src/app/resources-panel.test.tsx src/app/resource-calendar.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx src/app/resources-panel.tsx
git commit -m "feat(calendar): drag absences to reschedule and reassign"
```

---

## Task 6a: Extract the shared `DragHandle` atom

**Files:**
- Create: `src/app/drag-handle.tsx`
- Create: `src/app/drag-handle.test.tsx`
- Modify: `src/app/task-manager-ui.tsx:94` (`ColumnResizeHandle`)

`ColumnResizeHandle` and the calendar's edge-resize are the same gesture with
different meanings (column width vs. a date). Extract the shared grip — the
accessible-name-carrying `role="button"` element, the `aria-hidden` glyph, the
`cursor-ew-resize` affordance and the interaction atoms — into one atom both
consume. This is a refactor-first task: `ColumnResizeHandle`'s behaviour must not
change at all.

- [ ] **Step 1: Establish the baseline**

Run: `npx vitest run src/app/task-manager-ui.test.tsx src/app/jira-conflicts-modal.test.tsx src/app/budget-panel.test.tsx src/app/change-panel.test.tsx src/app/activity-log-panel.test.tsx`
Record the counts. These are the regression net — `ColumnResizeHandle` has many consumers, so the whole point is that these stay identical.

- [ ] **Step 2: Write the failing test for the new atom**

Create `src/app/drag-handle.test.tsx` asserting the atom: renders a `role="button"` carrying the passed `ariaLabel` as its accessible name; the decorative glyph child is `aria-hidden`; `onDragStart` fires when it is `draggable`; and it renders the caller's `className` additively rather than replacing its base classes.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/app/drag-handle.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `DragHandle`**

Props: `ariaLabel: string`, `orientation?: "vertical" | "horizontal"` (cursor), `draggable?: boolean`, `onDragStart?`, `onMouseDown?`, `className?`. Compose the interaction atoms from `interaction-styles.ts`; use only sanctioned tokens. The glyph is `aria-hidden` so the accessible name stays the `ariaLabel`.

- [ ] **Step 5: Refactor `ColumnResizeHandle` onto it**

`ColumnResizeHandle` keeps its exact public props, its `print:hidden`, its dark-header token styling and its mouse-down width logic — it just renders `DragHandle` internally instead of its own markup.

- [ ] **Step 6: Prove nothing changed**

Re-run the Step 1 command set. Counts and results must be IDENTICAL. Then `npx tsc --noEmit` and `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/app/drag-handle.tsx src/app/drag-handle.test.tsx src/app/task-manager-ui.tsx
git commit -m "refactor(ui): extract the shared DragHandle atom from ColumnResizeHandle"
```

★ Gantt's name-column grip (`gantt-chrome.tsx`) is a THIRD near-duplicate, deliberately styled for a light header. Leave it alone this release — note it as a follow-up rather than widening this refactor.

---

## Task 6: Edge resize + keyboard move mode

**Files:**
- Modify: `src/app/resource-calendar.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/resource-calendar.test.tsx`

- [ ] **Step 1: Add the i18n keys**

In `src/app/i18n.ts`:

```ts
  calendarResizeStart: "Change start date",
  calendarResizeEnd: "Change end date",
  calendarMoveModeOn: "Move mode: arrows reschedule, Enter confirms, Escape cancels",
  calendarMoveModeCancelled: "Move cancelled",
```

Add the four DE strings via a node utf8 write as in Task 2:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const anchor='  calendarWeekAbbrev:';if(!s.includes(anchor))throw new Error('anchor missing');const add=['  calendarResizeStart: \"Startdatum ändern\",','  calendarResizeEnd: \"Enddatum ändern\",','  calendarMoveModeOn: \"Verschiebemodus: Pfeiltasten verschieben, Enter bestätigt, Escape bricht ab\",','  calendarMoveModeCancelled: \"Verschieben abgebrochen\",'].join('\r\n')+'\r\n';s=s.replace(anchor,add+anchor);fs.writeFileSync(p,s,'utf8');console.log('ok')"
grep -n "calendarResizeStart\|calendarMoveModeOn" src/app/i18n.de.ts
```

Expected: `ok`, then the DE lines with real umlauts (`ändern`, `bestätigt`).

- [ ] **Step 2: Write the failing test**

Append to `src/app/resource-calendar.test.tsx`:

```tsx
it("offers a labelled resize handle on the first and last cell of a span only", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-29", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  expect(screen.getAllByLabelText(/change start date/i)).toHaveLength(1);
  expect(screen.getAllByLabelText(/change end date/i)).toHaveLength(1);
});

it("moves an absence by keyboard without committing on every arrow press", () => {
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const grid = screen.getByRole("grid");
  const first = screen.getAllByRole("gridcell")[0].querySelector("button")!;
  first.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  expect(onMoveAbsence).not.toHaveBeenCalled(); // nothing committed yet
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).toHaveBeenCalledTimes(1);
  expect(onMoveAbsence).toHaveBeenCalledWith(7, { startDate: "2026-07-29", endDate: "2026-07-29" }, "move");
});

it("discards a pending keyboard move on Escape", () => {
  const onMoveAbsence = vi.fn();
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 7, assignee: "Anna", startDate: "2026-07-27", endDate: "2026-07-27", type: "vacation" }]}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      onMoveAbsence={onMoveAbsence}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-31"
    />,
  );
  const grid = screen.getByRole("grid");
  screen.getAllByRole("gridcell")[0].querySelector("button")!.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "Escape" });
  fireEvent.keyDown(grid, { key: "Enter" });
  expect(onMoveAbsence).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "resize handle"`
Expected: FAIL — no element with that label.

- [ ] **Step 4: Add the resize handles**

Inside the cell `<td>`, wrap the button so the handles can be absolutely positioned. Replace `className="border-b border-r border-line p-0"` with `className="relative border-b border-r border-line p-0"`, and render the handles after the `</button>`:

```tsx
Use the shared `DragHandle` atom from Task 6a — do NOT hand-roll a grip here.

★★ **Use its DECORATIVE mode — pass NO `ariaLabel`.** `DragHandle` has two modes: omitting `ariaLabel` gives `aria-hidden` + no `role` + no `tabIndex`; passing one gives `role="button"` + `tabIndex={0}` + a focus ring. The accessible mode is WRONG here: this grid's keyboard model is a roving tabindex with **exactly one tab stop**, and two focusable grips per absence span would put several more in it, breaking the invariant every existing grid test pins. The keyboard equivalent for resizing is the `Alt+Shift+←/→` move mode below — the same rationale `ColumnResizeHandle` already uses ("resize is a mouse enhancement; the operation stays reachable another way"). Keep `title` for hover discoverability.

```tsx
                        {hit && onMoveAbsence && d.iso === hit.startDate ? (
                          <DragHandle
                            ariaLabel={t(lang, "calendarResizeStart")}
                            draggable
                            onDragStart={(e) => {
                              dragRef.current = { absenceId: hit.id, grabbedDate: d.iso, rowKey: row.key, mode: "resize-start" };
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", String(hit.id));
                              e.stopPropagation();
                            }}
                            className="absolute inset-y-0 left-0 w-2"
                          />
                        ) : null}
                        {hit && onMoveAbsence && d.iso === hit.endDate ? (
                          <DragHandle
                            ariaLabel={t(lang, "calendarResizeEnd")}
                            draggable
                            onDragStart={(e) => {
                              dragRef.current = { absenceId: hit.id, grabbedDate: d.iso, rowKey: row.key, mode: "resize-end" };
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", String(hit.id));
                              e.stopPropagation();
                            }}
                            className="absolute inset-y-0 right-0 w-2"
                          />
                        ) : null}
```
```

- [ ] **Step 5: Add pending move-mode state**

Beside the other state in `ResourceCalendarInner`:

```ts
  // A keyboard move in progress. Committing only on Enter is deliberate: one
  // undo entry per intent, not one per arrow press.
  const [pendingMove, setPendingMove] = useState<
    { absenceId: number; dayDelta: number; rowDelta: number } | null
  >(null);
```

- [ ] **Step 6: Extend `onGridKeyDown`**

At the TOP of `onGridKeyDown`, before the existing roving switch, insert:

```ts
    if (pendingMove) {
      if (e.key === "Escape") { e.preventDefault(); setPendingMove(null); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const moving = absences.find((a) => a.id === pendingMove.absenceId);
        const targetIndex = Math.min(Math.max(focusRow + pendingMove.rowDelta, 0), Math.max(rowCount - 1, 0));
        const targetRow = visibleRows[targetIndex];
        const originRowKey = visibleRows[focusRow]?.key ?? targetRow?.key;
        if (moving && targetRow && onMoveAbsence) {
          const result = resolveCalendarDrag({
            absence: moving,
            grabbedDate: moving.startDate,
            dropDate: addIsoDays(moving.startDate, pendingMove.dayDelta),
            mode: "move",
            target: targetRow.key === originRowKey
              ? { kind: "same-row" }
              : {
                  kind: "other-row",
                  rowKey: targetRow.key,
                  row: { display: targetRow.display, email: targetRow.email, resource: resourceByKey.get(targetRow.key) },
                },
          });
          if (result) onMoveAbsence(moving.id, result.patch, result.kind);
        }
        setPendingMove(null);
        return;
      }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        setPendingMove((p) => p && ({
          ...p,
          dayDelta: p.dayDelta + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0),
          rowDelta: p.rowDelta + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0),
        }));
        return;
      }
      return; // swallow everything else while a move is pending
    }

    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const day = days[focusCol];
      const rowKey = visibleRows[focusRow]?.key;
      const hit = day && rowKey
        ? (absencesByKey.get(rowKey) ?? []).find((a) => day.iso >= a.startDate && day.iso <= a.endDate)
        : undefined;
      if (!hit || !onMoveAbsence) return;
      e.preventDefault();
      setPendingMove({
        absenceId: hit.id,
        dayDelta: e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
        rowDelta: e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0,
      });
      return;
    }
```

Add the module-level helper beside `CELL_PX`:

```ts
function addIsoDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 7: Announce move mode**

Directly inside the outer wrapper `<div>` of the component's return, add a live region:

```tsx
      <div aria-live="polite" className="sr-only">
        {pendingMove ? t(lang, "calendarMoveModeOn") : ""}
      </div>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/app/resource-calendar.test.tsx`
Expected: PASS.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): edge-resize handles and a keyboard move mode"
```

---

# Slice S3 — `CalendarEvent` entity + persistence

## Task 7: Types, sanitizer, JSON-in-cell codecs

**Files:**
- Create: `src/app/calendar-event.ts`
- Create: `src/app/calendar-event.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  sanitizeCalendarEvent, encodeRecurrence, decodeRecurrence,
  encodeExceptions, decodeExceptions,
} from "./calendar-event";

const base = { id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15 };

describe("sanitizeCalendarEvent", () => {
  it("accepts a minimal valid event", () => {
    expect(sanitizeCalendarEvent(base)).toMatchObject({ id: 1, title: "Standup", startTime: "09:00", durationMinutes: 15 });
  });

  it("returns null without an id, a title or a start date", () => {
    expect(sanitizeCalendarEvent({ ...base, id: 0 })).toBeNull();
    expect(sanitizeCalendarEvent({ ...base, title: "   " })).toBeNull();
    expect(sanitizeCalendarEvent({ ...base, startDate: "nope" })).toBeNull();
    expect(sanitizeCalendarEvent(null)).toBeNull();
  });

  it("defaults a malformed time and duration instead of rejecting the event", () => {
    expect(sanitizeCalendarEvent({ ...base, startTime: "25:00" })?.startTime).toBe("09:00");
    expect(sanitizeCalendarEvent({ ...base, durationMinutes: 0 })?.durationMinutes).toBe(60);
    expect(sanitizeCalendarEvent({ ...base, durationMinutes: 99999 })?.durationMinutes).toBe(60);
  });

  it("keeps only one range terminator, preferring until", () => {
    const out = sanitizeCalendarEvent({
      ...base, recurrence: { freq: "weekly", interval: 1, until: "2026-12-31", count: 10 },
    });
    expect(out?.recurrence).toEqual({ freq: "weekly", interval: 1, until: "2026-12-31" });
  });

  it("drops an until that precedes the start", () => {
    const out = sanitizeCalendarEvent({
      ...base, recurrence: { freq: "daily", interval: 1, until: "2026-07-01" },
    });
    expect(out?.recurrence).toEqual({ freq: "daily", interval: 1 });
  });

  it("prefers byDay over byMonthDay for monthly and defaults the day-of-month otherwise", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "monthly", interval: 1, byMonthDay: 5, byDay: { ordinal: 2, day: "TU" } },
    })?.recurrence).toEqual({ freq: "monthly", interval: 1, byDay: { ordinal: 2, day: "TU" } });

    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "monthly", interval: 1 },
    })?.recurrence).toEqual({ freq: "monthly", interval: 1, byMonthDay: 27 });
  });

  it("dedupes and orders weekly byDay, dropping an empty list", () => {
    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "weekly", interval: 1, byDay: ["FR", "MO", "MO", "BAD"] },
    })?.recurrence).toEqual({ freq: "weekly", interval: 1, byDay: ["MO", "FR"] });

    expect(sanitizeCalendarEvent({
      ...base, recurrence: { freq: "weekly", interval: 1, byDay: [] },
    })?.recurrence).toEqual({ freq: "weekly", interval: 1 });
  });

  it("clamps interval into range", () => {
    expect(sanitizeCalendarEvent({ ...base, recurrence: { freq: "daily", interval: 0 } })?.recurrence)
      .toEqual({ freq: "daily", interval: 1 });
  });

  it("degrades a move exception with an invalid target to a skip", () => {
    expect(sanitizeCalendarEvent({
      ...base, exceptions: [{ date: "2026-08-03", kind: "move", toDate: "garbage" }],
    })?.exceptions).toEqual([{ date: "2026-08-03", kind: "skip" }]);
  });

  it("dedupes exceptions by date, last wins, sorted ascending", () => {
    expect(sanitizeCalendarEvent({
      ...base,
      exceptions: [
        { date: "2026-09-01", kind: "skip" },
        { date: "2026-08-03", kind: "skip" },
        { date: "2026-09-01", kind: "move", toDate: "2026-09-02" },
      ],
    })?.exceptions).toEqual([
      { date: "2026-08-03", kind: "skip" },
      { date: "2026-09-01", kind: "move", toDate: "2026-09-02" },
    ]);
  });

  it("keeps dangling attendee ids rather than silently dropping them", () => {
    expect(sanitizeCalendarEvent({ ...base, attendeeResourceIds: [3, 3, -1, 9] })?.attendeeResourceIds)
      .toEqual([3, 9]);
  });

  it("treats sendInvitations as true only when it is literally true", () => {
    expect(sanitizeCalendarEvent({ ...base, sendInvitations: "yes" })?.sendInvitations).toBeUndefined();
    expect(sanitizeCalendarEvent({ ...base, sendInvitations: true })?.sendInvitations).toBe(true);
  });
});

describe("JSON-in-cell codecs", () => {
  it("round-trips a recurrence rule", () => {
    const rule = { freq: "weekly", interval: 2, byDay: ["MO", "WE"] } as const;
    expect(decodeRecurrence(encodeRecurrence(rule))).toEqual(rule);
  });

  it("encodes an absent value to the empty string and back to undefined", () => {
    expect(encodeRecurrence(undefined)).toBe("");
    expect(decodeRecurrence("")).toBeUndefined();
    expect(encodeExceptions(undefined)).toBe("");
    expect(decodeExceptions("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON rather than throwing", () => {
    expect(decodeRecurrence("{not json")).toBeUndefined();
    expect(decodeExceptions("[[[")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event.test.ts`
Expected: FAIL — cannot find module `./calendar-event`.

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-event.ts`:

```ts
// CalendarEvent — a timed meeting on the resource calendar, optionally
// recurring. Pure, i18n-free, clock-free.
//
// The sanitizer NEVER throws: every load path (JSON import, CSV/MD decode,
// Turso row, IndexedDB) runs untrusted data through it and expects null for an
// unrecoverable record rather than an exception.

import { sanitizeMultiline, sanitizeText, toNumber } from "./sanitize";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RecurrenceRule =
  | { freq: "daily"; interval: number; until?: string; count?: number }
  | { freq: "weekly"; interval: number; byDay?: Weekday[]; until?: string; count?: number }
  | { freq: "monthly"; interval: number; byMonthDay?: number;
      byDay?: { ordinal: 1 | 2 | 3 | 4 | -1; day: Weekday }; until?: string; count?: number };

export type EventException =
  | { date: string; kind: "skip" }
  | { date: string; kind: "move"; toDate: string; toTime?: string };

export interface CalendarEvent {
  id: number;
  title: string;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
  recurrence?: RecurrenceRule;
  exceptions?: EventException[];
  attendeeResourceIds?: number[];
  sendInvitations?: boolean;
  localModifiedAt?: string;
  outlookEventId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const MAX_EXCEPTIONS = 500;
const MAX_ATTENDEES = 100;
const DEFAULT_TIME = "09:00";
const DEFAULT_DURATION = 60;

function isoDateOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    ? v : undefined;
}

function intInRange(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

function weekdayOrUndefined(v: unknown): Weekday | undefined {
  return typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v) ? (v as Weekday) : undefined;
}

function sanitizeRecurrence(raw: unknown, startDate: string): RecurrenceRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const interval = intInRange(r.interval, 1, 52, 1);

  // At most ONE range terminator survives. Both present is ambiguous, and
  // `until` is the one a user can verify by reading it.
  const until = isoDateOrUndefined(r.until);
  const validUntil = until && until >= startDate ? until : undefined;
  const count = validUntil ? undefined : (() => {
    const n = toNumber(r.count);
    return Number.isInteger(n) && n >= 1 && n <= 500 ? n : undefined;
  })();
  const range = { ...(validUntil ? { until: validUntil } : {}), ...(count ? { count } : {}) };

  if (r.freq === "daily") return { freq: "daily", interval, ...range };

  if (r.freq === "weekly") {
    const days = Array.isArray(r.byDay)
      ? WEEKDAYS.filter((d) => (r.byDay as unknown[]).some((x) => weekdayOrUndefined(x) === d))
      : [];
    return { freq: "weekly", interval, ...(days.length ? { byDay: [...days] } : {}), ...range };
  }

  if (r.freq === "monthly") {
    const nth = r.byDay && typeof r.byDay === "object" ? (r.byDay as Record<string, unknown>) : null;
    const day = nth ? weekdayOrUndefined(nth.day) : undefined;
    const ordinalRaw = nth ? toNumber(nth.ordinal) : NaN;
    const ordinal = [1, 2, 3, 4, -1].includes(ordinalRaw) ? (ordinalRaw as 1 | 2 | 3 | 4 | -1) : undefined;
    // byDay wins over byMonthDay: the two express different intents and keeping
    // both would leave the expansion engine choosing silently.
    if (day && ordinal) return { freq: "monthly", interval, byDay: { ordinal, day }, ...range };
    const fallbackDom = Number(startDate.slice(8, 10));
    return { freq: "monthly", interval, byMonthDay: intInRange(r.byMonthDay, 1, 31, fallbackDom), ...range };
  }

  return undefined;
}

function sanitizeExceptions(raw: unknown): EventException[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byDate = new Map<string, EventException>();
  for (const item of raw.slice(0, MAX_EXCEPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const date = isoDateOrUndefined(e.date);
    if (!date) continue;
    if (e.kind === "move") {
      const toDate = isoDateOrUndefined(e.toDate);
      // A move whose target is unusable degrades to a skip, never to nothing:
      // an occurrence the user moved must not reappear on its original date.
      if (!toDate) { byDate.set(date, { date, kind: "skip" }); continue; }
      const toTime = typeof e.toTime === "string" && HHMM.test(e.toTime) ? e.toTime : undefined;
      byDate.set(date, { date, kind: "move", toDate, ...(toTime ? { toTime } : {}) });
    } else {
      byDate.set(date, { date, kind: "skip" });
    }
  }
  if (byDate.size === 0) return undefined;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sanitizeAttendees(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<number>();
  for (const v of raw) {
    const n = toNumber(v);
    // Dangling ids (resource since deleted) are KEPT — same stance as every
    // other FK in the app; the UI renders them unresolved rather than lying
    // about who was invited.
    if (Number.isInteger(n) && n > 0) seen.add(n);
    if (seen.size >= MAX_ATTENDEES) break;
  }
  return seen.size ? [...seen] : undefined;
}

export function sanitizeCalendarEvent(input: unknown): CalendarEvent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const id = toNumber(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const title = sanitizeText(raw.title, TITLE_MAX);
  if (!title) return null;

  const startDate = isoDateOrUndefined(raw.startDate);
  if (!startDate) return null;

  const startTime = typeof raw.startTime === "string" && HHMM.test(raw.startTime)
    ? raw.startTime : DEFAULT_TIME;

  return {
    id,
    title,
    startDate,
    startTime,
    durationMinutes: intInRange(raw.durationMinutes, 5, 1440, DEFAULT_DURATION),
    location: sanitizeText(raw.location, LOCATION_MAX) || undefined,
    notes: sanitizeMultiline(raw.notes, 2000) || undefined,
    recurrence: sanitizeRecurrence(raw.recurrence, startDate),
    exceptions: sanitizeExceptions(raw.exceptions),
    attendeeResourceIds: sanitizeAttendees(raw.attendeeResourceIds),
    sendInvitations: raw.sendInvitations === true ? true : undefined,
    localModifiedAt: typeof raw.localModifiedAt === "string" ? raw.localModifiedAt : undefined,
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
  };
}

// --- JSON-in-cell codecs (mirrors encodeNoteLog / decodeNoteLog) ------------
// An absent value encodes to "" and decodes back to undefined, so a plain
// non-recurring event carries no JSON in its row.

export function encodeRecurrence(rule: RecurrenceRule | undefined): string {
  return rule ? JSON.stringify(rule) : "";
}

export function decodeRecurrence(cell: string): RecurrenceRule | undefined {
  if (!cell.trim()) return undefined;
  try {
    const parsed = JSON.parse(cell) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RecurrenceRule) : undefined;
  } catch { return undefined; }
}

export function encodeExceptions(list: readonly EventException[] | undefined): string {
  return list && list.length ? JSON.stringify(list) : "";
}

export function decodeExceptions(cell: string): EventException[] | undefined {
  if (!cell.trim()) return undefined;
  try {
    const parsed = JSON.parse(cell) as unknown;
    return Array.isArray(parsed) ? (parsed as EventException[]) : undefined;
  } catch { return undefined; }
}

export function encodeAttendees(ids: readonly number[] | undefined): string {
  return ids && ids.length ? ids.join("|") : "";
}

export function decodeAttendees(cell: string): number[] | undefined {
  if (!cell.trim()) return undefined;
  const out = cell.split("|").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return out.length ? out : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/calendar-event.test.ts`
Expected: PASS.

Note: the decoded values from `decodeRecurrence` / `decodeExceptions` are raw JSON — they are re-validated because every decoder feeds `sanitizeCalendarEvent`, which runs `sanitizeRecurrence` / `sanitizeExceptions` over them again. Do not add a second validation layer inside the codecs.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/app/calendar-event.ts src/app/calendar-event.test.ts
git commit -m "feat(calendar): add the CalendarEvent model, sanitizer and cell codecs"
```

---

## Task 8: CSV columns, encoder, decoder, Turso registration

**Files:**
- Modify: `src/app/csv-codecs-core.ts` (beside `ABSENCES_CSV_COLUMNS` at line 115 and `absencesToCsv` at ~526)
- Modify: `src/app/csv-codecs-config.ts` (section const import list ~line 25, `workspaceToCsv` ~line 509)
- Modify: `src/app/csv-codecs-decode.ts` (mode union line 133, section switch line 168, split result ~210, assembler ~392)
- Modify: `src/app/turso-schema.ts` (imports, `ENTITY_SPECS`)
- Test: `src/app/csv-codecs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/csv-codecs.test.ts`:

```ts
import { calendarEventsToCsv, csvToCalendarEvents, EVENTS_CSV_COLUMNS } from "./csv-codecs";

describe("calendar events CSV", () => {
  it("round-trips a recurring event with exceptions", () => {
    const events = [{
      id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
      recurrence: { freq: "weekly" as const, interval: 1, byDay: ["MO" as const, "WE" as const] },
      exceptions: [{ date: "2026-08-03", kind: "skip" as const }],
      attendeeResourceIds: [3, 9],
    }];
    const round = csvToCalendarEvents(calendarEventsToCsv(events));
    expect(round).toEqual(events);
  });

  it("round-trips a plain event with no JSON cells", () => {
    const events = [{ id: 2, title: "Kickoff", startDate: "2026-08-01", startTime: "14:30", durationMinutes: 90 }];
    const csv = calendarEventsToCsv(events);
    expect(csv.split("\r\n")[1]).toBe("2,Kickoff,2026-08-01,14:30,90,,,,,,,,");
    expect(csvToCalendarEvents(csv)).toEqual(events);
  });

  it("declares the expected column order", () => {
    expect(EVENTS_CSV_COLUMNS).toEqual([
      "id", "title", "startDate", "startTime", "durationMinutes", "location", "notes",
      "recurrence", "exceptions", "attendeeResourceIds", "sendInvitations",
      "localModifiedAt", "outlookEventId",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/csv-codecs.test.ts -t "calendar events CSV"`
Expected: FAIL — `EVENTS_CSV_COLUMNS` is not exported.

- [ ] **Step 3: Add columns, field encoder and row decoder**

In `src/app/csv-codecs-core.ts`, after `ABSENCES_CSV_COLUMNS` (line 126):

```ts
// Columns persisted for CalendarEvent in CSV, Markdown and both Turso schemas.
// recurrence / exceptions / attendeeResourceIds ride as JSON-in-cell (the
// note-log precedent) so a nested shape needs no extra tables.
export const EVENTS_CSV_COLUMNS: Array<keyof CalendarEvent> = [
  "id",
  "title",
  "startDate",
  "startTime",
  "durationMinutes",
  "location",
  "notes",
  "recurrence",
  "exceptions",
  "attendeeResourceIds",
  "sendInvitations",
  "localModifiedAt",
  "outlookEventId",
];

export function calendarEventFieldToString(e: CalendarEvent, col: string): string {
  switch (col) {
    case "recurrence": return encodeRecurrence(e.recurrence);
    case "exceptions": return encodeExceptions(e.exceptions);
    case "attendeeResourceIds": return encodeAttendees(e.attendeeResourceIds);
    case "sendInvitations": return e.sendInvitations ? "true" : "";
    default: {
      const v = (e as unknown as Record<string, unknown>)[col];
      return v == null ? "" : String(v);
    }
  }
}

export function buildCalendarEventFromObj(o: Record<string, string>): CalendarEvent | null {
  return sanitizeCalendarEvent({
    id: Number(o.id),
    title: o.title,
    startDate: o.startDate,
    startTime: o.startTime,
    durationMinutes: Number(o.durationMinutes),
    location: o.location,
    notes: o.notes,
    recurrence: decodeRecurrence(o.recurrence ?? ""),
    exceptions: decodeExceptions(o.exceptions ?? ""),
    attendeeResourceIds: decodeAttendees(o.attendeeResourceIds ?? ""),
    sendInvitations: o.sendInvitations === "true",
    localModifiedAt: o.localModifiedAt,
    outlookEventId: o.outlookEventId,
  });
}

export function calendarEventsToCsv(events: readonly CalendarEvent[], neutralize = false): string {
  const lines: string[] = [EVENTS_CSV_COLUMNS.join(",")];
  for (const e of events) {
    lines.push(
      EVENTS_CSV_COLUMNS.map((c) =>
        csvCellEscape(calendarEventFieldToString(e, c), neutralize),
      ).join(","),
    );
  }
  return lines.join("\r\n");
}
```

Add to that file's imports:

```ts
import {
  type CalendarEvent, sanitizeCalendarEvent,
  encodeRecurrence, decodeRecurrence,
  encodeExceptions, decodeExceptions,
  encodeAttendees, decodeAttendees,
} from "./calendar-event";
```

- [ ] **Step 4: Add the section constant and encoder wiring**

In `src/app/csv-codecs-core.ts`, beside the other `CSV_SECTION_*` constants:

```ts
export const CSV_SECTION_CALENDAR_EVENTS = "# CALENDAR EVENTS";
```

In `src/app/csv-codecs-config.ts`, add `CSV_SECTION_CALENDAR_EVENTS` and `calendarEventsToCsv` to the import list, and after the absences line (509) in `workspaceToCsv`:

```ts
  if (enabled("calendarEvents") && (ws.calendarEvents?.length ?? 0) > 0) {
    csvPush(CSV_SECTION_CALENDAR_EVENTS, calendarEventsToCsv(ws.calendarEvents ?? [], neutralize));
  }
```

★★ **CORRECTED during execution.** `ExportSectionKey` cascades further than the CSV gate: `export-sections.ts` has an exhaustive `BUILDERS: Record<ExportSectionKey, SectionBuilder>` and `settings-sections/export-section.tsx` an exhaustive `LABEL_KEYS: Record<ExportSectionKey, TranslationKey>`, and the latter needs a new i18n key in BOTH `i18n.ts` and `i18n.de.ts`. That is a UI + i18n change, not a codec change.

For THIS task use the storage-only gate instead — the pattern `steeringCommittee` / `timelogLinks` / `settingsOverrides` already use just below it:

```ts
if (config === undefined && ws.calendarEvents && ws.calendarEvents.length > 0)
  csvPush(CSV_SECTION_CALENDAR_EVENTS, calendarEventsToCsv(ws.calendarEvents, neutralize));
```

Events then round-trip fully through storage but are omitted from document exports. **Task 8b closes that** (below) — do not leave it undone, because every other user-content entity IS exportable and a user would notice meetings missing from an exported pack.

---

## Task 8b: Make `calendarEvents` a first-class exportable section

**Files:** `src/app/settings-types.ts` (`ExportSectionKey` + `EXPORT_SECTION_KEYS`), `src/app/export-sections.ts` (the `BUILDERS` map + a section builder), `src/app/settings-sections/export-section.tsx` (`LABEL_KEYS`), `src/app/i18n.ts`, `src/app/i18n.de.ts`.

Add the key (default ON), write the PDF/document section builder alongside the existing ones, add the export checkbox label, and add one i18n key in EN + DE. Then switch the CSV and Markdown gates from the storage-only form to `enabled("calendarEvents")`.

★ `i18n.de.ts` is CRLF and the Edit tool corrupts it — patch via a node utf8 write matching `\r\n`, then grep-verify and byte-check (0 NUL bytes, 0 bare LF).
★ Settings → Export is an axe-scanned surface: the new checkbox needs a real label, not a placeholder.

- [ ] **Step 5: Add the decoder**

In `src/app/csv-codecs-decode.ts`:

- add `"calendarEvents"` to the `mode` union on line 133;
- declare `const calendarEventsLines: string[] = [];` beside `absencesLines`;
- add the section guard beside line 168:

```ts
    if (trimmed.startsWith(CSV_SECTION_CALENDAR_EVENTS)) { mode = "calendarEvents"; continue; }
```

- add the accumulator arm beside line 188:

```ts
    else if (mode === "calendarEvents") calendarEventsLines.push(line);
```

- add to the split result (~line 210): `calendarEventsText: calendarEventsLines.join("\r\n"),` and to its interface: `calendarEventsText: string;`
- add the exported decoder:

```ts
export function csvToCalendarEvents(text: string): CalendarEvent[] {
  return rowsToObjects(text)
    .map((o) => buildCalendarEventFromObj(o))
    .filter((e): e is CalendarEvent => e !== null);
}
```

(`rowsToObjects` is the existing header-row helper this file already uses for the other entities — reuse it, do not write a second parser.)

- in the `csvToWorkspace` assembler (~line 392), beside the absences line:

```ts
    calendarEvents: s.calendarEventsText.trim() ? csvToCalendarEvents(s.calendarEventsText) : undefined,
```

`undefined` rather than `[]` keeps an event-free workspace byte-stable on re-encode.

- [ ] **Step 6: Register with Turso**

In `src/app/turso-schema.ts`, add to the `csv-codecs` import list `EVENTS_CSV_COLUMNS, calendarEventFieldToString, buildCalendarEventFromObj`, add `import type { CalendarEvent } from "./calendar-event";`, and append to `ENTITY_SPECS` after the stakeholders line:

```ts
  spec<CalendarEvent>({ table: "calendar_events", wsKey: "calendarEvents", columns: EVENTS_CSV_COLUMNS, get: (w) => w.calendarEvents ?? [], toRow: calendarEventFieldToString as unknown as (e: CalendarEvent, col: string) => string, fromObj: buildCalendarEventFromObj }),
```

This one line produces the DDL, the insert, the select and the load for BOTH Turso schemas, and adds `calendar_events` to `TABLE_NAMES`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/app/csv-codecs.test.ts src/app/turso-schema.test.ts src/app/turso-migrate.test.ts`
Expected: PASS. `turso-migrate.test.ts:166` asserts the table list mirrors `ENTITY_SPECS`, so it follows automatically.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/csv-codecs-core.ts src/app/csv-codecs-config.ts src/app/csv-codecs-decode.ts src/app/turso-schema.ts src/app/csv-codecs.test.ts
git commit -m "feat(calendar): persist calendar events to CSV and both Turso schemas"
```

---

## Task 9: Markdown codec

**Files:**
- Modify: `src/app/markdown-codecs-core.ts` (`ABSENCES_MD_COLUMNS` at line 88, `absencesToMarkdown` at 422, `workspaceToMarkdown` at 649)
- Modify: `src/app/markdown-codecs-decode.ts`
- Test: `src/app/markdown-codecs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/markdown-codecs.test.ts`:

```ts
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";

describe("calendar events markdown", () => {
  it("round-trips a recurring event through the markdown table", () => {
    const ws = {
      ...emptyWorkspace(),
      calendarEvents: [{
        id: 1, title: "Standup | with a pipe", startDate: "2026-07-27", startTime: "09:00",
        durationMinutes: 15,
        recurrence: { freq: "weekly" as const, interval: 1 },
        exceptions: [{ date: "2026-08-03", kind: "skip" as const }],
      }],
    };
    const md = workspaceToMarkdown(ws);
    expect(md).toContain("## Calendar Events");
    expect(markdownToWorkspace(md).calendarEvents).toEqual(ws.calendarEvents);
  });

  it("omits the section entirely when there are no events", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Calendar Events");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/markdown-codecs.test.ts -t "calendar events markdown"`
Expected: FAIL — the section is missing.

- [ ] **Step 3: Add the MD columns and encoder**

In `src/app/markdown-codecs-core.ts`, after `ABSENCES_MD_COLUMNS`:

```ts
export const EVENTS_MD_COLUMNS: Array<{ key: keyof CalendarEvent; label: string }> = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "startDate", label: "Start Date" },
  { key: "startTime", label: "Start Time" },
  { key: "durationMinutes", label: "Duration (min)" },
  { key: "location", label: "Location" },
  { key: "notes", label: "Notes" },
  { key: "recurrence", label: "Recurrence" },
  { key: "exceptions", label: "Exceptions" },
  { key: "attendeeResourceIds", label: "Attendees" },
  { key: "sendInvitations", label: "Send Invitations" },
  { key: "localModifiedAt", label: "Modified" },
  { key: "outlookEventId", label: "Outlook Event" },
];

export function calendarEventsToMarkdown(events: readonly CalendarEvent[]): string {
  const header = `| ${EVENTS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${EVENTS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const rows = events.map((e) =>
    `| ${EVENTS_MD_COLUMNS.map((c) => mdEscape(calendarEventFieldToString(e, c.key))).join(" | ")} |`,
  );
  return ["## Calendar Events", "", header, sep, ...rows, ""].join("\n");
}
```

Import `calendarEventFieldToString` from `./csv-codecs-core` and the `CalendarEvent` type.

In `workspaceToMarkdown` (line 649 area), beside the absences push:

```ts
  if (enabled("calendarEvents") && (ws.calendarEvents?.length ?? 0) > 0) {
    mdParts.push(calendarEventsToMarkdown(ws.calendarEvents ?? []));
  }
```

- [ ] **Step 4: Add the MD decoder**

In `src/app/markdown-codecs-decode.ts`, add the `## Calendar Events` case to `splitMarkdownSections`, then:

```ts
export function markdownToCalendarEvents(md: string): CalendarEvent[] {
  const colMap: Record<string, string> = {};
  for (const c of EVENTS_MD_COLUMNS) colMap[c.label] = c.key as string;
  return markdownTableToObjects(md, colMap)
    .map((o) => buildCalendarEventFromObj(o))
    .filter((e): e is CalendarEvent => e !== null);
}
```

and in `markdownToWorkspace`:

```ts
    calendarEvents: sections.calendarEvents ? markdownToCalendarEvents(sections.calendarEvents) : undefined,
```

**Landmine:** the MD decoders build the object from an explicit `colMap` of LABEL → key. A column added to `EVENTS_MD_COLUMNS` without a `colMap` entry decodes to `undefined` silently — this is exactly what bit R2. The loop above derives `colMap` from the column list so the two cannot drift; keep it derived.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/markdown-codecs.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/markdown-codecs-core.ts src/app/markdown-codecs-decode.ts src/app/markdown-codecs.test.ts
git commit -m "feat(calendar): persist calendar events to markdown"
```

---

## Task 10: Workspace field, JSON, IndexedDB, app wiring, golden regen

**Files:**
- Modify: `src/app/workspace.ts` (type at 71, `jsonToWorkspace` ~525)
- Modify: `src/app/browser-backend.ts`
- Modify: `src/app/workspace-context.tsx`
- Modify: `src/app/use-storage-backend.ts` (lines 90, 177, 275, 309, 363, 389, 477, 508)
- Modify: `src/app/task-manager.tsx` (restore effect ~1030 and its deps ~1042)
- Create: `src/app/calendar-events-persistence.test.ts`
- Modify: `src/app/entity-persistence-registry.test.ts`
- Modify: `sample-workspace-small.json`, `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md`

- [ ] **Step 1: Write the failing guard test**

Create `src/app/calendar-events-persistence.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-scan guard. `calendarEvents` must appear in EVERY save path or edits
// silently vanish on reload — the failure mode this repo has shipped twice
// (timelogLinks, and the knowledgeItems autosave deps array).
const SRC = readFileSync("src/app/use-storage-backend.ts", "utf8");

describe("calendarEvents is wired into every save path", () => {
  it("appears in each backend.save literal and in currentWorkspace", () => {
    const saveLiterals = SRC.match(/save\(\{[^}]*\}\)/g) ?? [];
    expect(saveLiterals.length).toBeGreaterThanOrEqual(3);
    for (const lit of saveLiterals) expect(lit).toContain("calendarEvents");
  });

  it("appears in the autosave effect dependency array", () => {
    const deps = SRC.match(/\}, \[tasks, raid, absences[^\]]*\]/g) ?? [];
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) expect(d).toContain("calendarEvents");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-events-persistence.test.ts`
Expected: FAIL — the save literals do not contain `calendarEvents`.

- [ ] **Step 3: Add the Workspace field**

In `src/app/workspace.ts`, at the end of the `Workspace` type:

```ts
  /** Recurring / one-off calendar meetings rendered on the resource calendar.
   *  Optional & additive: undefined serializes to nothing (byte-stable).
   *  Sanitized by sanitizeCalendarEvent. */
  calendarEvents?: ReadonlyArray<CalendarEvent>;
```

Import the type, and in `jsonToWorkspace` (beside line 525):

```ts
      calendarEvents: Array.isArray(p.calendarEvents)
        ? (p.calendarEvents as unknown[])
            .map((e) => sanitizeCalendarEvent(e))
            .filter((e): e is CalendarEvent => e !== null)
        : undefined,
```

Also add `calendarEvents` to the `isWorkspaceEmpty` check and to the record-count helper at lines 157 and 175, so an events-only workspace is not treated as empty (which would arm the data-loss guard against a legitimate save).

- [ ] **Step 4: Wire IndexedDB**

In `src/app/browser-backend.ts`, beside `KV_KNOWLEDGE_ITEMS_KEY`:

```ts
const KV_CALENDAR_EVENTS_KEY = "calendarEvents";
```

Declare `let calendarEvents: Workspace["calendarEvents"] | undefined;` in `load`, read it in the same block that reads `knowledgeItems`, attach it after line 263 with `if (calendarEvents) raw.calendarEvents = calendarEvents;`, and mirror the knowledgeItems write in `save`:

```ts
      ws.calendarEvents && ws.calendarEvents.length
        ? idbSet(KV_CALENDAR_EVENTS_KEY, ws.calendarEvents)
        : idbDelete(KV_CALENDAR_EVENTS_KEY),
```

A KV slot (not a new object store) is deliberate: a new store needs an IndexedDB version bump and upgrade path, and events number in the tens.

- [ ] **Step 5: Wire the React state**

In `src/app/workspace-context.tsx`, mirroring `knowledgeItems` at lines 113, 146, 365 and 397:

```ts
  calendarEvents: readonly CalendarEvent[] | undefined;
  setCalendarEvents: Dispatch<SetStateAction<readonly CalendarEvent[] | undefined>>;
```
```ts
  const [calendarEvents, setCalendarEvents] = useState<readonly CalendarEvent[] | undefined>(undefined);
```

and add `calendarEvents, setCalendarEvents,` to both the provider value and the memo dep list.

- [ ] **Step 6: Wire the storage hook**

In `src/app/use-storage-backend.ts` add `calendarEvents` to:
- the destructure at line 90,
- `applyWorkspace` at line 177: `setCalendarEvents(workspace.calendarEvents);`
- the `outgoing` literal (275), all three `backend.save({…})` literals (309, 389, 477), `currentWorkspace()` (508),
- **and the autosave effect dep array at line 363.**

In `src/app/task-manager.tsx`, add `setCalendarEvents(w.calendarEvents);` to the restore effect at line 1030 and `setCalendarEvents` to its dep array at 1042.

- [ ] **Step 7: Run the guard test**

Run: `npx vitest run src/app/calendar-events-persistence.test.ts`
Expected: PASS.

- [ ] **Step 8: Add the registry row**

In `src/app/entity-persistence-registry.test.ts`, add a row for `calendarEvents` asserting that `EVENTS_CSV_COLUMNS` and `EVENTS_MD_COLUMNS` cover the same keys — follow the shape of the existing absence row exactly.

- [ ] **Step 9: Seed the sample and regenerate fixtures**

Add two events to `sample-workspace-small.json` (the hand-curated master) — one plain weekly, one monthly nth-weekday carrying a `skip` exception, so both encodings are exercised by the goldens:

```json
  "calendarEvents": [
    { "id": 1, "title": "Project standup", "startDate": "2026-01-05", "startTime": "09:00",
      "durationMinutes": 15,
      "recurrence": { "freq": "weekly", "interval": 1, "byDay": ["MO", "WE", "FR"] } },
    { "id": 2, "title": "Steering board", "startDate": "2026-01-13", "startTime": "14:00",
      "durationMinutes": 60,
      "recurrence": { "freq": "monthly", "interval": 1, "byDay": { "ordinal": 2, "day": "TU" } },
      "exceptions": [{ "date": "2026-04-14", "kind": "skip" }] }
  ],
```

Then regenerate:

```bash
npx vite-node scripts/generate-sample-workspace.ts
npx vitest run src/app/golden-workspace.test.ts -u
git diff --stat src/app/__fixtures__/
```

Expected: the diff touches ONLY the new Calendar Events section in each fixture. Any change to another section means a real format regression — stop and investigate rather than accepting the update.

- [ ] **Step 10: Full suite, typecheck, commit**

```bash
npm run test:run
npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(calendar): persist calendar events across all six write paths"
```

Expected: ~721 test files. A materially lower file count means workers crashed — re-run before trusting it.

---

# Slice S4 — Recurrence engine

## Task 11: `recurrence.ts` expansion

**Files:**
- Create: `src/app/recurrence.ts`
- Create: `src/app/recurrence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/recurrence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { expandOccurrences, MAX_OCCURRENCES } from "./recurrence";
import type { CalendarEvent } from "./calendar-event";

const base: CalendarEvent = {
  id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
};
const dates = (e: CalendarEvent, a: string, b: string) =>
  expandOccurrences(e, a, b).occurrences.map((o) => o.date);

describe("expandOccurrences", () => {
  it("returns the single date for a non-recurring event inside the window", () => {
    expect(dates(base, "2026-07-01", "2026-08-31")).toEqual(["2026-07-27"]);
  });

  it("returns nothing for a non-recurring event outside the window", () => {
    expect(dates(base, "2026-09-01", "2026-09-30")).toEqual([]);
  });

  it("expands daily with an interval", () => {
    const e = { ...base, recurrence: { freq: "daily" as const, interval: 3 } };
    expect(dates(e, "2026-07-27", "2026-08-05")).toEqual(["2026-07-27", "2026-07-30", "2026-08-02", "2026-08-05"]);
  });

  it("expands weekly on the start weekday when byDay is absent", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1 } };
    expect(dates(e, "2026-07-27", "2026-08-17")).toEqual(["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17"]);
  });

  it("expands weekly byDay honouring the interval between weeks", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 2, byDay: ["MO" as const, "WE" as const] } };
    expect(dates(e, "2026-07-27", "2026-08-13")).toEqual(["2026-07-27", "2026-07-29", "2026-08-10", "2026-08-12"]);
  });

  it("expands monthly by day-of-month and SKIPS months that lack the day", () => {
    const e = {
      ...base, startDate: "2026-01-31",
      recurrence: { freq: "monthly" as const, interval: 1, byMonthDay: 31 },
    };
    // February and April have no 31st — skipped, never clamped to the 28th/30th.
    expect(dates(e, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("expands monthly by nth weekday", () => {
    const e = {
      ...base, startDate: "2026-01-13",
      recurrence: { freq: "monthly" as const, interval: 1, byDay: { ordinal: 2 as const, day: "TU" as const } },
    };
    expect(dates(e, "2026-01-01", "2026-03-31")).toEqual(["2026-01-13", "2026-02-10", "2026-03-10"]);
  });

  it("expands monthly by LAST weekday", () => {
    const e = {
      ...base, startDate: "2026-01-27",
      recurrence: { freq: "monthly" as const, interval: 1, byDay: { ordinal: -1 as const, day: "TU" as const } },
    };
    expect(dates(e, "2026-01-01", "2026-03-31")).toEqual(["2026-01-27", "2026-02-24", "2026-03-31"]);
  });

  it("distinguishes a 4th weekday from the last one in a 5-weekday month", () => {
    const fourth = {
      ...base, startDate: "2026-01-01",
      recurrence: { freq: "monthly" as const, interval: 1, byDay: { ordinal: 4 as const, day: "FR" as const } },
    };
    // January 2026 has five Fridays: 2,9,16,23,30. 4th = 23rd, last = 30th.
    expect(dates(fourth, "2026-01-01", "2026-01-31")).toEqual(["2026-01-23"]);
  });

  it("stops at until, inclusive", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, until: "2026-08-10" } };
    expect(dates(e, "2026-07-01", "2026-12-31")).toEqual(["2026-07-27", "2026-08-03", "2026-08-10"]);
  });

  it("stops after count occurrences even when the window is wider", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, count: 2 } };
    expect(dates(e, "2026-07-01", "2026-12-31")).toEqual(["2026-07-27", "2026-08-03"]);
  });

  it("counts occurrences from the series start, not from the window start", () => {
    const e = { ...base, recurrence: { freq: "weekly" as const, interval: 1, count: 3 } };
    // The series ends 2026-08-10; a window opening after that yields nothing.
    expect(dates(e, "2026-08-17", "2026-12-31")).toEqual([]);
  });

  it("removes a skipped occurrence", () => {
    const e = {
      ...base,
      recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "skip" as const }],
    };
    expect(dates(e, "2026-07-27", "2026-08-10")).toEqual(["2026-07-27", "2026-08-10"]);
  });

  it("relocates a moved occurrence and remembers its original date", () => {
    const e = {
      ...base,
      recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "move" as const, toDate: "2026-08-05", toTime: "16:00" }],
    };
    const out = expandOccurrences(e, "2026-07-27", "2026-08-10").occurrences;
    const moved = out.find((o) => o.originalDate === "2026-08-03");
    expect(moved).toMatchObject({ date: "2026-08-05", time: "16:00", isMoved: true });
  });

  it("renders an occurrence moved OUTSIDE the window, because the user put it there", () => {
    const e = {
      ...base,
      recurrence: { freq: "weekly" as const, interval: 1 },
      exceptions: [{ date: "2026-08-03", kind: "move" as const, toDate: "2026-09-20" }],
    };
    const out = expandOccurrences(e, "2026-07-27", "2026-08-10").occurrences;
    expect(out.some((o) => o.date === "2026-09-20")).toBe(true);
  });

  it("reports truncation instead of silently rendering a partial series", () => {
    const e = { ...base, startDate: "2020-01-01", recurrence: { freq: "daily" as const, interval: 1 } };
    const out = expandOccurrences(e, "2020-01-01", "2030-01-01");
    expect(out.truncated).toBe(true);
    expect(out.occurrences).toHaveLength(MAX_OCCURRENCES);
  });

  it("returns an empty, non-throwing result for a malformed window", () => {
    expect(expandOccurrences(base, "garbage", "2026-08-01")).toEqual({ occurrences: [], truncated: false });
    expect(expandOccurrences(base, "2026-08-01", "2026-07-01")).toEqual({ occurrences: [], truncated: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/recurrence.test.ts`
Expected: FAIL — cannot find module `./recurrence`.

- [ ] **Step 3: Write the implementation**

Create `src/app/recurrence.ts`:

```ts
// Pure occurrence expansion for CalendarEvent. i18n-free and CLOCK-FREE — the
// window is always passed in, never derived from `new Date()`, so the output is
// deterministic and the react-hooks purity rule is satisfied at every call site.

import { WEEKDAYS, type CalendarEvent, type EventException, type Weekday } from "./calendar-event";

export interface Occurrence {
  eventId: number;
  /** Date this occurrence renders on (the moved date, when moved). */
  date: string;
  /** Wall-clock start (the moved time, when the move carried one). */
  time: string;
  durationMinutes: number;
  /** The date the RULE produced — the key for exceptions and sync baselines. */
  originalDate: string;
  isMoved: boolean;
}

export interface ExpansionResult {
  occurrences: Occurrence[];
  /** True when MAX_OCCURRENCES cut the series short. Never render a truncated
   *  series as if it were complete — "nothing after March" must not look like
   *  a series that genuinely ends in March. */
  truncated: boolean;
}

export const MAX_OCCURRENCES = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const EMPTY: ExpansionResult = { occurrences: [], truncated: false };

function utc(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Mon=0 .. Sun=6, matching the WEEKDAYS order. */
const dowIndex = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7;
const weekdayOf = (ms: number): Weekday => WEEKDAYS[dowIndex(ms)];
const mondayOf = (ms: number): number => ms - dowIndex(ms) * DAY_MS;

/** The date of the nth (or last) `day` in the given month, or null if the month
 *  has no such nth weekday. */
function nthWeekdayOfMonth(year: number, month: number, ordinal: number, day: Weekday): string | null {
  const target = WEEKDAYS.indexOf(day);
  if (ordinal === -1) {
    const lastDom = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let dom = lastDom; dom >= 1; dom--) {
      const ms = Date.UTC(year, month, dom);
      if (dowIndex(ms) === target) return iso(ms);
    }
    return null;
  }
  let seen = 0;
  const lastDom = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let dom = 1; dom <= lastDom; dom++) {
    const ms = Date.UTC(year, month, dom);
    if (dowIndex(ms) === target && ++seen === ordinal) return iso(ms);
  }
  return null;
}

/** Raw rule dates from the series start forward, ignoring the window. The
 *  window filters LATER, because `count` counts from the series start — a
 *  window-relative count would report different occurrences per scroll. */
function ruleDates(event: CalendarEvent, hardStop: string): { dates: string[]; truncated: boolean } {
  const rule = event.recurrence;
  const start = utc(event.startDate);
  if (start === null) return { dates: [], truncated: false };
  if (!rule) return { dates: [event.startDate], truncated: false };

  const limit = rule.count ?? MAX_OCCURRENCES;
  const until = rule.until;
  const stop = until && until < hardStop ? until : hardStop;
  const out: string[] = [];
  const push = (d: string): boolean => {
    if (d < event.startDate || d > stop) return d <= stop;
    out.push(d);
    return out.length < limit && out.length < MAX_OCCURRENCES;
  };

  if (rule.freq === "daily") {
    for (let ms = start; iso(ms) <= stop; ms += rule.interval * DAY_MS) {
      if (!push(iso(ms))) break;
    }
  } else if (rule.freq === "weekly") {
    const days = rule.byDay?.length ? rule.byDay : [weekdayOf(start)];
    let weekStart = mondayOf(start);
    outer: while (iso(weekStart) <= stop) {
      for (const d of WEEKDAYS) {
        if (!days.includes(d)) continue;
        const ms = weekStart + WEEKDAYS.indexOf(d) * DAY_MS;
        const candidate = iso(ms);
        if (candidate < event.startDate) continue;
        if (candidate > stop) break outer;
        if (!push(candidate)) break outer;
      }
      weekStart += rule.interval * 7 * DAY_MS;
    }
  } else {
    const y0 = Number(event.startDate.slice(0, 4));
    const m0 = Number(event.startDate.slice(5, 7)) - 1;
    for (let step = 0; ; step += 1) {
      const monthIndex = m0 + step * rule.interval;
      const y = y0 + Math.floor(monthIndex / 12);
      const m = ((monthIndex % 12) + 12) % 12;
      const probe = iso(Date.UTC(y, m, 1));
      if (probe > stop) break;
      const candidate = rule.byDay
        ? nthWeekdayOfMonth(y, m, rule.byDay.ordinal, rule.byDay.day)
        // A month lacking the day-of-month is SKIPPED, never clamped: clamping
        // would invent an occurrence on a date the user never chose.
        : (new Date(Date.UTC(y, m + 1, 0)).getUTCDate() >= (rule.byMonthDay ?? 1)
            ? iso(Date.UTC(y, m, rule.byMonthDay ?? 1))
            : null);
      if (candidate && candidate > stop) break;
      if (candidate && !push(candidate)) break;
    }
  }

  return { dates: out, truncated: out.length >= MAX_OCCURRENCES };
}

/**
 * Occurrences of `event` overlapping [windowStart, windowEnd], with exceptions
 * applied. Never throws; a malformed or inverted window yields an empty result.
 */
export function expandOccurrences(
  event: CalendarEvent,
  windowStart: string,
  windowEnd: string,
): ExpansionResult {
  const ws = utc(windowStart);
  const we = utc(windowEnd);
  if (ws === null || we === null || we < ws) return EMPTY;

  // Generate a little past the window so an occurrence MOVED into it is found.
  const hardStop = iso(we + 366 * DAY_MS);
  const { dates, truncated } = ruleDates(event, hardStop);

  const byDate = new Map<string, EventException>();
  for (const ex of event.exceptions ?? []) byDate.set(ex.date, ex);

  const occurrences: Occurrence[] = [];
  for (const originalDate of dates) {
    const ex = byDate.get(originalDate);
    if (ex?.kind === "skip") continue;

    const date = ex?.kind === "move" ? ex.toDate : originalDate;
    const time = ex?.kind === "move" && ex.toTime ? ex.toTime : event.startTime;

    // In-window, OR moved anywhere: a user who dragged an occurrence somewhere
    // must be able to see where it went.
    const inWindow = date >= windowStart && date <= windowEnd;
    if (!inWindow && ex?.kind !== "move") continue;

    occurrences.push({
      eventId: event.id,
      date,
      time,
      durationMinutes: event.durationMinutes,
      originalDate,
      isMoved: ex?.kind === "move",
    });
  }

  occurrences.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  return { occurrences, truncated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/recurrence.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/app/recurrence.ts src/app/recurrence.test.ts
git commit -m "feat(calendar): add the pure recurrence expansion engine"
```

---

## Task 12: Recurrence property tests

**Files:**
- Create: `src/app/recurrence.property.test.ts`

- [ ] **Step 1: Write the property tests**

Create `src/app/recurrence.property.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expandOccurrences, MAX_OCCURRENCES } from "./recurrence";
import { sanitizeCalendarEvent, WEEKDAYS } from "./calendar-event";

// fast-check gotchas that pass vitest but fail tsc or the test itself:
// fc.date() can emit an Invalid Date, so map a bounded integer ms range instead.
const MIN_MS = Date.UTC(2020, 0, 1);
const MAX_MS = Date.UTC(2030, 0, 1);
const isoArb = fc.integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms - (ms % 86_400_000)).toISOString().slice(0, 10));

const eventArb = fc.record({
  id: fc.integer({ min: 1, max: 9999 }),
  title: fc.constant("E"),
  startDate: isoArb,
  startTime: fc.constant("09:00"),
  durationMinutes: fc.constant(30),
  recurrence: fc.option(
    fc.oneof(
      fc.record({ freq: fc.constant("daily" as const), interval: fc.integer({ min: 1, max: 12 }) }),
      fc.record({
        freq: fc.constant("weekly" as const),
        interval: fc.integer({ min: 1, max: 6 }),
        byDay: fc.uniqueArray(fc.constantFrom(...WEEKDAYS), { minLength: 1, maxLength: 7 }),
      }),
      fc.record({
        freq: fc.constant("monthly" as const),
        interval: fc.integer({ min: 1, max: 6 }),
        byMonthDay: fc.integer({ min: 1, max: 31 }),
      }),
    ),
    { nil: undefined },
  ),
}).map((raw) => sanitizeCalendarEvent(raw)!).filter((e) => e !== null);

describe("expandOccurrences properties", () => {
  it("never emits an occurrence before the series start", () => {
    fc.assert(fc.property(eventArb, isoArb, isoArb, (event, a, b) => {
      const [ws, we] = a <= b ? [a, b] : [b, a];
      for (const o of expandOccurrences(event, ws, we).occurrences) {
        expect(o.originalDate >= event.startDate).toBe(true);
      }
    }), { numRuns: 100 });
  });

  it("emits every unmoved occurrence inside the requested window", () => {
    fc.assert(fc.property(eventArb, isoArb, isoArb, (event, a, b) => {
      const [ws, we] = a <= b ? [a, b] : [b, a];
      for (const o of expandOccurrences(event, ws, we).occurrences) {
        if (!o.isMoved) expect(o.date >= ws && o.date <= we).toBe(true);
      }
    }), { numRuns: 100 });
  });

  it("is deterministic and bounded", () => {
    fc.assert(fc.property(eventArb, isoArb, isoArb, (event, a, b) => {
      const [ws, we] = a <= b ? [a, b] : [b, a];
      const first = expandOccurrences(event, ws, we);
      const second = expandOccurrences(event, ws, we);
      expect(first).toEqual(second);
      expect(first.occurrences.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
    }), { numRuns: 100 });
  });

  it("emits strictly increasing original dates", () => {
    fc.assert(fc.property(eventArb, isoArb, isoArb, (event, a, b) => {
      const [ws, we] = a <= b ? [a, b] : [b, a];
      const originals = expandOccurrences(event, ws, we).occurrences.map((o) => o.originalDate);
      const sortedUnique = [...new Set(originals)].sort();
      expect(originals).toEqual(sortedUnique);
    }), { numRuns: 100 });
  });

  it("honours count as an upper bound regardless of window", () => {
    fc.assert(fc.property(isoArb, fc.integer({ min: 1, max: 20 }), (start, count) => {
      const event = sanitizeCalendarEvent({
        id: 1, title: "E", startDate: start, startTime: "09:00", durationMinutes: 30,
        recurrence: { freq: "daily", interval: 1, count },
      })!;
      const out = expandOccurrences(event, "2020-01-01", "2030-01-01");
      expect(out.occurrences.length).toBeLessThanOrEqual(count);
    }), { numRuns: 100 });
  });
});
```

- [ ] **Step 2: Run the property tests**

Run: `npx vitest run src/app/recurrence.property.test.ts`
Expected: PASS (5 properties, 100 runs each).

If a property fails, fast-check prints a minimal counterexample. Fix `recurrence.ts`, not the property — a property that has to be weakened to pass is usually reporting a real bug.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/recurrence.property.test.ts
git commit -m "test(calendar): property-test recurrence expansion"
```

---

# Slice S5 — Band, series list, editor

## Task 13: Split `resource-calendar.tsx` (gantt convention)

**Files:**
- Create: `src/app/resource-calendar-rows.tsx`
- Modify: `src/app/resource-calendar.tsx`

This is a **move-only refactor**: no behaviour changes, so the existing tests are the regression net.

- [ ] **Step 1: Confirm the baseline is green**

Run: `npx vitest run src/app/resource-calendar.test.tsx`
Expected: PASS. Record the test count — it must be identical after the split.

- [ ] **Step 2: Extract the row renderer**

Create `src/app/resource-calendar-rows.tsx` exporting `CalendarRows`, a **pure presentational** component. Move the `visibleRows.map(...)` `<tbody>` body verbatim. Its props are everything that body reads:

```tsx
interface CalendarRowsProps {
  lang: Lang;
  visibleRows: readonly CalendarAssignee[];
  days: readonly CalendarDay[];
  absencesByKey: ReadonlyMap<string, Absence[]>;
  resourceByKey: ReadonlyMap<string, Resource>;
  absences: readonly Absence[];
  focusRow: number;
  focusCol: number;
  setFocusCell: (cell: { row: number; col: number }) => void;
  dragRef: React.MutableRefObject<DragState | null>;
  suppressClickRef: React.MutableRefObject<boolean>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  onMoveAbsence?: (id: number, patch: Partial<Absence>, kind: "move" | "reassign" | "resize") => void;
}
```

Export `CalendarDay`, `CalendarAssignee` and `DragState` from a shared place (keep them in `resource-calendar.tsx` and import, or move all three into `calendar-drag.ts` if that avoids a cycle — check with `npx tsc --noEmit`). Move `localTypeLabel`, `CELL_PX` and `ASSIGNEE_COL_PX` alongside whichever file uses them and re-export if both do.

- [ ] **Step 3: Render the extracted component**

In `resource-calendar.tsx`, replace the `<tbody>` block with:

```tsx
          <CalendarRows
            lang={lang}
            visibleRows={visibleRows}
            days={days}
            absencesByKey={absencesByKey}
            resourceByKey={resourceByKey}
            absences={absences}
            focusRow={focusRow}
            focusCol={focusCol}
            setFocusCell={setFocusCell}
            dragRef={dragRef}
            suppressClickRef={suppressClickRef}
            onAddAbsence={onAddAbsence}
            onEditAbsence={onEditAbsence}
            onEditResource={onEditResource}
            onAddResource={onAddResource}
            onMoveAbsence={onMoveAbsence}
          />
```

- [ ] **Step 4: Verify nothing changed**

```bash
npx vitest run src/app/resource-calendar.test.tsx
npx tsc --noEmit && npm run lint
npm run size:check
```

Expected: identical test count, all passing; `size:check` green with no re-baseline.

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-calendar.tsx src/app/resource-calendar-rows.tsx
git commit -m "refactor(calendar): extract CalendarRows from resource-calendar"
```

---

## Task 14: Lane packing + the meetings band

**Files:**
- Create: `src/app/occurrence-lanes.ts`
- Create: `src/app/occurrence-lanes.test.ts`
- Create: `src/app/resource-calendar-band.tsx`
- Modify: `src/app/resource-calendar.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/resource-calendar.test.tsx`

- [ ] **Step 1: Write the failing lane test**

Create `src/app/occurrence-lanes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { packOccurrenceLanes } from "./occurrence-lanes";
import type { Occurrence } from "./recurrence";

const occ = (eventId: number, date: string, time: string): Occurrence =>
  ({ eventId, date, time, durationMinutes: 30, originalDate: date, isMoved: false });

describe("packOccurrenceLanes", () => {
  it("puts non-colliding occurrences in one lane", () => {
    expect(packOccurrenceLanes([occ(1, "2026-07-27", "09:00"), occ(2, "2026-07-28", "09:00")]))
      .toEqual([[occ(1, "2026-07-27", "09:00"), occ(2, "2026-07-28", "09:00")]]);
  });

  it("stacks same-day occurrences into separate lanes", () => {
    const lanes = packOccurrenceLanes([occ(1, "2026-07-27", "09:00"), occ(2, "2026-07-27", "11:00")]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toEqual([occ(1, "2026-07-27", "09:00")]);
    expect(lanes[1]).toEqual([occ(2, "2026-07-27", "11:00")]);
  });

  it("reuses an earlier lane once the day is free again", () => {
    const lanes = packOccurrenceLanes([
      occ(1, "2026-07-27", "09:00"), occ(2, "2026-07-27", "11:00"), occ(3, "2026-07-28", "09:00"),
    ]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((o) => o.eventId)).toEqual([1, 3]);
  });

  it("returns no lanes for an empty list", () => {
    expect(packOccurrenceLanes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/occurrence-lanes.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `src/app/occurrence-lanes.ts`:

```ts
// Greedy lane packing for the meetings band. Pure, i18n-free.
// One lane renders as one <tr>; an occurrence occupies exactly one date cell,
// so two occurrences collide only when they fall on the same date.

import type { Occurrence } from "./recurrence";

/** Assign occurrences to lanes so no lane holds two occurrences on one date.
 *  Input order decides priority; expandOccurrences already sorts by date+time. */
export function packOccurrenceLanes(occurrences: readonly Occurrence[]): Occurrence[][] {
  const lanes: Occurrence[][] = [];
  const taken: Set<string>[] = [];
  for (const o of occurrences) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (taken[i].has(o.date)) continue;
      lanes[i].push(o);
      taken[i].add(o.date);
      placed = true;
      break;
    }
    if (!placed) {
      lanes.push([o]);
      taken.push(new Set([o.date]));
    }
  }
  return lanes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/occurrence-lanes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the band i18n keys**

`src/app/i18n.ts`:

```ts
  calendarMeetings: "Meetings",
  calendarAddMeeting: "Add meeting",
  calendarSeriesRecurring: "Recurring",
  calendarOccurrenceMoved: "Moved",
```

DE via a node utf8 write (same technique as Task 2): `Termine`, `Termin hinzufügen`, `Serientermin`, `Verschoben`.

- [ ] **Step 6: Write the failing band test**

Append to `src/app/resource-calendar.test.tsx`:

```tsx
it("renders occurrences of a recurring series in the meetings band", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={[{
        id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
        recurrence: { freq: "daily", interval: 1 },
      }]}
      onEditEvent={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-29"
    />,
  );
  expect(screen.getByText("Meetings")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Standup/ })).toHaveLength(3);
});

it("gives each occurrence a row-unique accessible name", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[]}
      calendarEvents={[{
        id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
        recurrence: { freq: "daily", interval: 1 },
      }]}
      onEditEvent={() => {}}
      today="2026-07-27"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-07-27"
      endDate="2026-07-28"
    />,
  );
  const names = screen.getAllByRole("button", { name: /Standup/ }).map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "meetings band"`
Expected: FAIL — `calendarEvents` is not a known prop.

- [ ] **Step 7b: Write the shared `CalendarChip` primitive FIRST**

No existing primitive is an interactive chip — `Badge` is a non-interactive `<span>` — so this is a sanctioned NEW primitive, not a hand-roll. Create `src/app/calendar-chip.tsx` + `calendar-chip.test.tsx`.

```tsx
interface CalendarChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Full accessible name — must be row-unique at the call site. */
  ariaLabel: string;
  /** Wall-clock start, rendered tabular so chips line up across lanes. */
  time: string;
  /** Event title; truncates rather than wrapping (the cell is ~40px). */
  title: string;
  /** Marks an occurrence relocated by an exception. */
  moved?: boolean;
}
```

Renders a real `<button>` composing `INTERACTIVE` from `interaction-styles.ts`, a left brand stripe, tabular time, truncating title. `moved` alters a NON-COLOUR cue as well as any tint — colour alone must never be the only signal. Tests: accessible name comes from `ariaLabel` (not the visible text); the title truncates rather than wraps; `moved` renders its non-colour marker; extra props (`draggable`, `data-*`) pass through.

★ Palette: sanctioned tokens only, no shadow/gradient. ★ Primitives here concatenate `className` with NO tailwind-merge, so give the chip the variants it needs rather than expecting callers to override.

- [ ] **Step 8: Write the band component**

Create `src/app/resource-calendar-band.tsx` (it consumes `CalendarChip`, never its own button):

```tsx
"use client";

// Meetings band — lanes of event occurrences rendered as <tbody> rows in the
// SAME table as the assignee rows, which is what keeps the columns aligned.
//
// Band cells deliberately carry `data-band-cell`, NOT `data-cell`: the grid's
// roving-tabindex model indexes `data-cell` by row/column and a band cell in
// that set would break the single-tab-stop invariant.

import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import type { CalendarEvent } from "./calendar-event";
import type { Occurrence } from "./recurrence";

interface Props {
  lang: Lang;
  lanes: readonly (readonly Occurrence[])[];
  days: readonly { iso: string }[];
  eventsById: ReadonlyMap<number, CalendarEvent>;
  assigneeColPx: number;
  cellPx: number;
  onEditEvent: (event: CalendarEvent) => void;
  onMoveOccurrence?: (occurrence: Occurrence, toDate: string) => void;
}

export function CalendarBand({
  lang, lanes, days, eventsById, assigneeColPx, cellPx, onEditEvent, onMoveOccurrence,
}: Props) {
  if (lanes.length === 0) return null;
  return (
    <tbody data-calendar-band>
      {lanes.map((lane, laneIndex) => {
        const byDate = new Map(lane.map((o) => [o.date, o]));
        return (
          <tr key={laneIndex} role="row">
            <td
              role="rowheader"
              className="sticky left-0 z-10 border-b border-r border-line bg-surface-muted px-2 py-1 text-xs font-medium text-muted-foreground"
              style={{ minWidth: assigneeColPx, width: assigneeColPx }}
            >
              {laneIndex === 0 ? t(lang, "calendarMeetings") : ""}
            </td>
            {days.map((d) => {
              const occ = byDate.get(d.iso);
              const event = occ ? eventsById.get(occ.eventId) : undefined;
              const label = occ && event
                ? `${event.title} – ${occ.date} ${occ.time}${occ.isMoved ? ` (${t(lang, "calendarOccurrenceMoved")})` : ""}`
                : "";
              return (
                <td
                  key={d.iso}
                  role="gridcell"
                  className="border-b border-r border-line bg-surface-muted p-0"
                  style={{ minWidth: cellPx, width: cellPx, height: 22 }}
                  onDragOver={(e) => { if (onMoveOccurrence) e.preventDefault(); }}
                  onDrop={(e) => {
                    if (!onMoveOccurrence) return;
                    e.preventDefault();
                    const id = Number(e.dataTransfer.getData("text/plain"));
                    const dragged = lanes.flat().find((o) => o.eventId === id && o.date !== d.iso);
                    if (dragged) onMoveOccurrence(dragged, d.iso);
                  }}
                >
                  {occ && event ? (
                    <CalendarChip
                      data-band-cell={`${laneIndex}-${d.iso}`}
                      draggable={!!onMoveOccurrence}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(occ.eventId))}
                      onClick={() => onEditEvent(event)}
                      ariaLabel={label}
                      time={occ.time}
                      title={event.title}
                      moved={occ.isMoved}
                    />
                  ) : null}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}
```

- [ ] **Step 9: Mount the band**

In `resource-calendar.tsx`, add the props:

```ts
  calendarEvents?: readonly CalendarEvent[];
  onEditEvent?: (event: CalendarEvent) => void;
  onMoveOccurrence?: (occurrence: Occurrence, toDate: string) => void;
```

and the derivation (window bounds are already props, so no clock is involved):

```ts
  const eventsById = useMemo(
    () => new Map((calendarEvents ?? []).map((e) => [e.id, e])),
    [calendarEvents],
  );
  const lanes = useMemo(() => {
    const all = (calendarEvents ?? [])
      .flatMap((e) => expandOccurrences(e, startDate, endDate).occurrences)
      .filter((o) => o.date >= startDate && o.date <= endDate)
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    return packOccurrenceLanes(all);
  }, [calendarEvents, startDate, endDate]);
```

Render `<CalendarBand … />` between `</thead>` and `<CalendarRows … />`, guarded on `onEditEvent` being present.

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/app/resource-calendar.test.tsx src/app/occurrence-lanes.test.ts`
Expected: PASS. Re-run the roving test to confirm the band did not enter the tab-stop set:
`npx vitest run src/app/resource-calendar.test.tsx -t "grid"` → PASS.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/occurrence-lanes.ts src/app/occurrence-lanes.test.ts src/app/resource-calendar-band.tsx src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): render meeting occurrences in a lane-packed band"
```

---

## Task 14a: ~~Generalize the chip pickers~~ — CANCELLED

**Do not implement.** Investigation showed the premise was wrong: `StakeholderChipPicker` and
`TaskLinkPicker` are not one pattern wearing two hats.

- `StakeholderChipPicker` renders EVERY item as a checkbox toggle chip — bounded lists, 2 consumers, byte-identical shape. A clean seam.
- `TaskLinkPicker` renders only SELECTED items as `×`-chips plus a search box to add from an unbounded universe. It is already a correctly-shared component with 4 consumers — the opposite of a hand-roll problem.

Folding the second onto the first would have required a rendering-mode flag and would have
CHANGED what it renders, which its consumers' tests would (correctly) have caught.

The task existed only to prepare an attendees picker, and **attendees are deferred to 0.203.0**,
where the Outlook invitations that give the field its purpose actually ship. So nothing is
extracted and nothing is refactored.

★ Uncaptured duplication found while investigating, for a LATER release: `RaidCausedByField`
(`raid-edit-fields.tsx:60-179`) hand-rolls the same search + remove-chip pattern as
`TaskLinkPicker`, inline and unexported, just for `RaidItem`. That is a real duplicate of
`TaskLinkPicker`'s pattern — worth its own task, out of scope here.

<details><summary>Original (unused) task text</summary>

**Files:**
- Create: `src/app/entity-chip-picker.tsx`, `src/app/entity-chip-picker.test.tsx`
- Modify: `src/app/edit-modal-chrome.tsx` (`StakeholderChipPicker`), `src/app/task-link-picker.tsx` (`TaskLinkPicker`)

`StakeholderChipPicker` and `TaskLinkPicker` are the same control hardcoded to
different entities, and the attendees field in Task 15 would be a third. Extract
the shared shell so all three consume one picker. Refactor-first: both existing
pickers keep their exact public props and rendered behaviour.

- [ ] **Step 1: Establish the baseline**

Run the suites for every consumer — the change/raid/stakeholder edit modals and anything rendering `TaskLinkPicker` (grep for both component names to find them all). Record the counts; these are the regression net.

- [ ] **Step 2: Write the failing test for the generic picker**

`entity-chip-picker.test.tsx`: given items, selected ids and an `onToggle`, it renders one chip per item with a **row-unique accessible name**; toggles the right id on click; reflects selection state non-visually (`aria-pressed`); and renders its empty state when there are no items.

- [ ] **Step 3: Run it, watch it fail.** `npx vitest run src/app/entity-chip-picker.test.tsx`

- [ ] **Step 4: Write `EntityChipPicker`**

Generic over the item: `items: readonly T[]`, `selectedIds: readonly number[]`, `getId: (item: T) => number`, `getLabel: (item: T) => string`, `onToggle: (id: number) => void`, `label: string`, plus optional `emptyText`. All i18n done by the caller — the picker takes strings, never keys.

★ Row-unique accessible names are load-bearing: N identical "Toggle" labels is a WCAG 2.4.6 failure, and the axe gate can pass it when only one row is seeded, so it will not catch a regression here.

- [ ] **Step 5: Refactor both existing pickers onto it**

Each keeps its current props and becomes a thin wrapper supplying its own `getId`/`getLabel`. Their own tests must pass UNCHANGED.

- [ ] **Step 6: Prove nothing changed**

Re-run the Step 1 command set — identical results. Then `npx tsc --noEmit`, `npm run lint`, and `npm run dup:check` (the duplication gate is BLOCKING in CI; this refactor should move it in the right direction).

- [ ] **Step 7: Commit**

```bash
git add src/app/entity-chip-picker.tsx src/app/entity-chip-picker.test.tsx src/app/edit-modal-chrome.tsx src/app/task-link-picker.tsx
git commit -m "refactor(ui): extract EntityChipPicker from the stakeholder and task pickers"
```

</details>

---

## Task 15: Series editor modal

**Files:**
- Create: `src/app/calendar-event-modal.tsx`
- Create: `src/app/calendar-event-modal.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the i18n keys**

`src/app/i18n.ts`:

```ts
  calendarEventTitle: "Title",
  calendarEventStart: "First occurrence",
  calendarEventTime: "Start time",
  calendarEventDuration: "Duration (minutes)",
  calendarEventLocation: "Location",
  calendarEventRepeat: "Repeat",
  calendarRepeatNever: "Does not repeat",
  calendarRepeatDaily: "Daily",
  calendarRepeatWeekly: "Weekly",
  calendarRepeatMonthly: "Monthly",
  calendarEventInterval: "Every",
  calendarEventEnds: "Ends",
  calendarEndsNever: "Never",
  calendarEndsOn: "On date",
  calendarEndsAfter: "After occurrences",
  calendarEventAttendees: "Attendees",
  calendarEventConfirmDelete: "Delete this meeting series?",
  calendarEventTitleRequired: "A title is required",
```

Add the DE strings with a node utf8 write, using real umlauts where German needs them (`Dauer (Minuten)`, `Wiederholen`, `Täglich`, `Wöchentlich`, `Monatlich`, `Endet`, `Nie`, `Teilnehmer`, `Diese Terminserie löschen?`, `Ein Titel ist erforderlich`).

- [ ] **Step 2: Write the failing test**

Create `src/app/calendar-event-modal.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarEventModal } from "./calendar-event-modal";

const open = {
  id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
};

describe("CalendarEventModal", () => {
  it("renders nothing when no event is open", () => {
    const { container } = render(
      <CalendarEventModal lang="en-US" event={null} isNew={false} resources={[]}
        onSave={() => {}} onDelete={() => {}} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("saves a sanitized event", () => {
    const onSave = vi.fn();
    render(
      <CalendarEventModal lang="en-US" event={open} isNew={false} resources={[]}
        onSave={onSave} onDelete={() => {}} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Daily sync" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 1, title: "Daily sync" }));
  });

  it("blocks a save with a blank title", () => {
    const onSave = vi.fn();
    render(
      <CalendarEventModal lang="en-US" event={open} isNew={false} resources={[]}
        onSave={onSave} onDelete={() => {}} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/title is required/i);
  });

  it("clamps the until date when the first occurrence moves past it", () => {
    render(
      <CalendarEventModal lang="en-US"
        event={{ ...open, recurrence: { freq: "weekly", interval: 1, until: "2026-08-10" } }}
        isNew={false} resources={[]} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/first occurrence/i), { target: { value: "2026-09-01" } });
    expect((screen.getByLabelText(/on date/i) as HTMLInputElement).value).toBe("2026-09-01");
  });

  it("hides recurrence detail fields when the series does not repeat", () => {
    render(
      <CalendarEventModal lang="en-US" event={open} isNew={false} resources={[]}
        onSave={() => {}} onDelete={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByLabelText(/every/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-modal.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write the modal**

Create `src/app/calendar-event-modal.tsx` following the six-modal convention: `EditModalShell` + `useDraftState<CalendarEvent>` + `ModalFieldError` + `ModalEditFooter` + `useDraggable("aipm-cockpit:modal-pos:calendar-event")` + `useConfirm` for delete. Requirements the tests pin:

- Fields: title (`Input`), first occurrence (date `Input`), start time (`time` `Input`), duration (number `Input`), location (`Input`), repeat (`Select` of never/daily/weekly/monthly), interval (number `Input`, shown only when repeating), weekly `byDay` checkbox row (weekly only), monthly mode radio between day-of-month and nth-weekday (monthly only), ends (never / on date / after N).

★ **NO attendees field this release.** `attendeeResourceIds` and `sendInvitations` stay on the model and persist, but get no editor UI until 0.203.0, where the Outlook invitations that give them their purpose ship — and where the bounded-list-vs-typeahead question can be answered against a real requirement rather than guessed at. Do not add a picker; do not hand-roll one.
- Every field carries an `aria-label` or a bound `<label>` — `placeholder` is not an accessible name.
- The first-occurrence `onChange` clamps the `until` field through `clampRangeEnd(nextStart, prevUntil)`.
- Submit runs the draft through `sanitizeCalendarEvent`; a `null` result sets the `calendarEventTitleRequired` error and does not call `onSave`.
- `onSave` receives the sanitized event, so the modal can never emit a shape the storage layer would reject.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-event-modal.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/calendar-event-modal.tsx src/app/calendar-event-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): add the meeting series editor modal"
```

---

## Task 16: Series list, toolbar button, panel wiring

**Files:**
- Create: `src/app/calendar-series-list.tsx`
- Create: `src/app/calendar-series-list.test.tsx`
- Modify: `src/app/resources-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the i18n keys**

`src/app/i18n.ts`:

```ts
  calendarAllSeries: "All meeting series",
  calendarSeriesNext: "Next occurrence",
  calendarSeriesNone: "No further occurrences",
  calendarSeriesRule: "Repeats",
  calendarSeriesEmpty: "No meetings yet",
```

DE via node utf8 write (`Alle Terminserien`, `Nächster Termin`, `Keine weiteren Termine`, `Wiederholung`, `Noch keine Termine`).

- [ ] **Step 2: Write the failing test**

Create `src/app/calendar-series-list.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarSeriesList } from "./calendar-series-list";

const events = [
  { id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "daily" as const, interval: 1 } },
  { id: 2, title: "Retro", startDate: "2020-01-01", startTime: "15:00", durationMinutes: 60 },
];

describe("CalendarSeriesList", () => {
  it("lists every series regardless of the visible window", () => {
    render(<CalendarSeriesList lang="en-US" events={events} today="2026-07-26" onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: /Standup/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retro/ })).toBeInTheDocument();
  });

  it("shows the next occurrence, or says there is none", () => {
    render(<CalendarSeriesList lang="en-US" events={events} today="2026-07-26" onEdit={() => {}} />);
    expect(screen.getByText("2026-07-27")).toBeInTheDocument();
    expect(screen.getByText(/no further occurrences/i)).toBeInTheDocument();
  });

  it("opens the editor for the clicked series", () => {
    const onEdit = vi.fn();
    render(<CalendarSeriesList lang="en-US" events={events} today="2026-07-26" onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /Standup/ }));
    expect(onEdit).toHaveBeenCalledWith(events[0]);
  });

  it("shows an empty message with no series", () => {
    render(<CalendarSeriesList lang="en-US" events={[]} today="2026-07-26" onEdit={() => {}} />);
    expect(screen.getByText(/no meetings yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-series-list.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write the component**

Create `src/app/calendar-series-list.tsx` using the SHARED table primitives — do not hand-roll a table. A `<details>` titled `calendarAllSeries` wraps a `DataTable` (`data-table.tsx`) with columns: title, human-readable rule, next occurrence, attendee count, actions. Use `SortResizeTh` for any sortable header and `TABLE_HEAD_CLASS` via `DataTable`'s own `head` slot, exactly as the other registers do. No series ⇒ render the `EmptyState` primitive with the `calendarSeriesEmpty` message, not a bare `<p>`.

Derive the next occurrence with `expandOccurrences(event, today, addYear(today))` and take the first — `today` comes in as a **prop**, so the component stays clock-free. Each row's edit control is a `<button>` whose accessible name includes the series title, so the names are row-unique.

Build the rule string from the sanitized rule (freq + interval + byDay + terminator); keep it in this file, since it is the only consumer.

- [ ] **Step 5: Wire the panel**

In `src/app/resources-panel.tsx`:
- add `calendarEvents`, `onSaveEvent`, `onDeleteEvent` props (all optional; popouts pass nothing and the surface goes read-only);
- hold `const [eventDraft, setEventDraft] = useState<CalendarEvent | null>(null)` and `const [eventIsNew, setEventIsNew] = useState(false)`;
- add an "+ Add meeting" `Button` to the calendar control row (`view === "calendar"`), placed BEFORE the trailing Print · reset-columns · reset-size group;
- pass `calendarEvents`, `onEditEvent={setEventDraft}` and `onMoveOccurrence` to `<ResourceCalendar />`;
- render `<CalendarSeriesList />` under the grid and `<CalendarEventModal />` at the end.

New-event ids come from the existing `nextEntityId` helper over `calendarEvents`, matching every other entity.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-series-list.test.tsx src/app/resources-panel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/calendar-series-list.tsx src/app/calendar-series-list.test.tsx src/app/resources-panel.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): add the series list, add-meeting button and panel wiring"
```

---

## Task 17: Occurrence drag → exception (or a plain date move)

**Files:**
- Modify: `src/app/calendar-event.ts` (add `applyOccurrenceMove`)
- Modify: `src/app/calendar-event.test.ts`
- Modify: `src/app/resources-panel.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/calendar-event.test.ts`:

```ts
import { applyOccurrenceMove } from "./calendar-event";

describe("applyOccurrenceMove", () => {
  const recurring = {
    id: 1, title: "Standup", startDate: "2026-07-27", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "weekly" as const, interval: 1 },
  };

  it("records a move exception on a recurring series, leaving the rule alone", () => {
    const out = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-05");
    expect(out.startDate).toBe("2026-07-27");
    expect(out.recurrence).toEqual(recurring.recurrence);
    expect(out.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-05" }]);
  });

  it("replaces an existing exception for the same original date", () => {
    const once = applyOccurrenceMove(recurring, "2026-08-03", "2026-08-05");
    const twice = applyOccurrenceMove(once, "2026-08-03", "2026-08-06");
    expect(twice.exceptions).toEqual([{ date: "2026-08-03", kind: "move", toDate: "2026-08-06" }]);
  });

  it("rewrites startDate directly for a NON-recurring event instead of minting an exception", () => {
    const single = { id: 2, title: "Kickoff", startDate: "2026-08-01", startTime: "10:00", durationMinutes: 60 };
    const out = applyOccurrenceMove(single, "2026-08-01", "2026-08-04");
    expect(out.startDate).toBe("2026-08-04");
    expect(out.exceptions).toBeUndefined();
  });

  it("returns the event unchanged for a no-op move", () => {
    expect(applyOccurrenceMove(recurring, "2026-08-03", "2026-08-03")).toBe(recurring);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event.test.ts -t "applyOccurrenceMove"`
Expected: FAIL — not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/app/calendar-event.ts`:

```ts
/**
 * Move one occurrence of `event` from `originalDate` to `toDate`.
 *
 * A RECURRING series records a `move` exception, so the rule keeps producing
 * every other occurrence unchanged. A NON-recurring event has its `startDate`
 * rewritten instead: an exception on a one-occurrence event would be a second
 * source of truth for the same date.
 */
export function applyOccurrenceMove(
  event: CalendarEvent,
  originalDate: string,
  toDate: string,
): CalendarEvent {
  if (originalDate === toDate) return event;
  if (!event.recurrence) return { ...event, startDate: toDate };
  const kept = (event.exceptions ?? []).filter((e) => e.date !== originalDate);
  const next: EventException = { date: originalDate, kind: "move", toDate };
  return {
    ...event,
    exceptions: [...kept, next].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/calendar-event.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it to the band drag**

In `src/app/resources-panel.tsx`, pass to `<ResourceCalendar />`:

```tsx
            onMoveOccurrence={
              isPopout || !onSaveEvent
                ? undefined
                : (occurrence, toDate) => {
                    const event = (calendarEvents ?? []).find((e) => e.id === occurrence.eventId);
                    if (event) onSaveEvent(applyOccurrenceMove(event, occurrence.originalDate, toDate));
                  }
            }
```

Note it is `occurrence.originalDate`, not `occurrence.date` — exceptions are keyed by the date the RULE produced, so dragging an already-moved occurrence a second time updates the same exception instead of stacking a new one.

- [ ] **Step 6: Full suite, typecheck, lint, commit**

```bash
npm run test:run && npx tsc --noEmit && npm run lint
git add src/app/calendar-event.ts src/app/calendar-event.test.ts src/app/resources-panel.tsx
git commit -m "feat(calendar): drag an occurrence to move it via an exception"
```

---

## Task 18: Release chores

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `AGENTS.md`

- [ ] **Step 1: Choose an unused codename**

```bash
grep -oE '"[A-Z][a-z]+"' CHANGELOG.md | sort -u
```

Pick a sci-fi/fantasy author surname NOT in that list (codenames are unique per minor block).

- [ ] **Step 2: Bump the version in BOTH places**

`src/app/version.ts`: `APP_VERSION = "0.202.0"` and `APP_MILESTONE` = the chosen codename.
`package.json`: set `"version": "0.202.0"`.

Both are required — AGENTS.md's checklist omits `package.json`, but every prior release commit touches it.

- [ ] **Step 3: Add the highlight key**

Add `versionHighlightCalendarOverhaul` to `src/app/i18n.ts` and `i18n.de.ts` (DE via node utf8 write), and append the key to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 4: Write the changelog entry**

Add a `## 0.202.0 "<Codename>"` section to `CHANGELOG.md` covering: weekday + ISO-week headers, start>end clamping, absence drag/resize/reassign with a keyboard equivalent, and the recurring meetings band with its series list and editor. State plainly that Outlook sync for meetings lands in 0.203.0.

- [ ] **Step 5: Update AGENTS.md**

Add a "Calendar overhaul (R5)" bullet under Architecture pointers recording: the `resource-calendar` three-file split; that `isoWeekParts` is the single ISO-week source and must not be reimplemented; that `calendar_events` joins `ENTITY_SPECS` (and therefore `TABLE_NAMES`) with recurrence/exceptions/attendees as JSON-in-cell; that band cells use `data-band-cell` and must stay out of the `data-cell` roving set; that `expandOccurrences` is clock-free with the window passed in; and that exceptions are keyed by `originalDate`, never the moved date.

- [ ] **Step 6: Run the full gate set**

```bash
npm run lint
npx tsc --noEmit
npm run test:run
npm run dup:check
npm run size:check
npm run build
```

Expected: all exit 0. `test:run` should report ~721+ files — a lower count means workers crashed, not that tests were skipped.

- [ ] **Step 7: Verify the DE file survived editing**

```bash
node -e "const b=require('fs').readFileSync('src/app/i18n.de.ts');console.log('NUL bytes:',b.filter(x=>x===0).length);const s=b.toString('utf8');console.log('bare LF:',(s.match(/(?<!\r)\n/g)||[]).length);console.log('ASCII subs:',/fuer|druecken|oe\b/.test(s));"
```

Expected: `NUL bytes: 0`, `bare LF: 0`, `ASCII subs: false`.

- [ ] **Step 8: Axe check on a FRESH server**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"
PORT=3100 npm run stop
```

Expected: PASS across all 5 schemes. Use a fresh port — a reused `:3000` server may serve stale Tailwind output.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(release): 0.202.0 calendar overhaul"
```

---

## Done criteria

- [ ] Grid header shows weekday labels and an ISO week band, correct across the 2026/2027 boundary
- [ ] Moving an absence start past its end pulls the end along, silently
- [ ] Absences drag to reschedule, drag across rows to reassign, and edge-drag to resize
- [ ] Every gesture has a keyboard equivalent, and each produces exactly one undo entry
- [ ] `CalendarEvent` round-trips byte-stable through all six write paths
- [ ] Golden fixtures changed ONLY in their new Calendar Events section
- [ ] Recurring series render in a lane-packed meetings band; dragging one occurrence moves only that one
- [ ] All series are reachable from the list regardless of the visible window
- [ ] lint · tsc · test:run · dup:check · size:check · build all exit 0
- [ ] Axe passes on Resources across all 5 schemes
