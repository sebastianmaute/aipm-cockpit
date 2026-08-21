# Resource Calendar Date-Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Resource Calendar's fixed 30-days-from-today grid with a selectable Month / Week / Custom window that shows past and future dates and scroll-centers today when opened.

**Architecture:** A new pure module `calendar-window.ts` computes `{startDate,endDate}` from the control state. `resources-panel.tsx` owns the calendar control state + control row and passes the resolved window to `ResourceCalendar`, which generates day columns over `[startDate,endDate]` and centers today via a `useLayoutEffect` (mirroring the Gantt).

**Tech Stack:** Next.js 16 / React, TypeScript, Tailwind, Vitest + React Testing Library. UTC date math throughout (matches existing calendar/`generatePeriods`).

---

## File structure

- **Create** `src/app/calendar-window.ts` — pure window math (month/week/custom, step, resolve).
- **Create** `src/app/calendar-window.test.ts` — unit tests for the above.
- **Modify** `src/app/resource-calendar.tsx` — `startDate`/`endDate` props, window-based day generation, today-centering scroll effect.
- **Modify** `src/app/resource-calendar.test.tsx` — supply new props; assert past+future columns + anchoring.
- **Modify** `src/app/resources-panel.tsx` — calendar control state, control row UI, window resolution, pass props.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new control labels (EN + DE).
- **Modify** `src/app/version.ts` + `CHANGELOG.md` — release bump.

---

## Task 1: `calendar-window.ts` pure helpers

**Files:**
- Create: `src/app/calendar-window.ts`
- Test: `src/app/calendar-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/calendar-window.test.ts
import { describe, expect, it } from "vitest";
import {
  MAX_CALENDAR_SPAN_DAYS,
  monthWindow,
  weekWindow,
  customWindow,
  stepAnchor,
  resolveWindow,
} from "./calendar-window";

describe("monthWindow", () => {
  it("returns first..last day of the anchor's month", () => {
    expect(monthWindow("2026-06-15")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
  });
  it("handles 31-day months and December→year boundary", () => {
    expect(monthWindow("2026-07-04")).toEqual({ startDate: "2026-07-01", endDate: "2026-07-31" });
    expect(monthWindow("2026-12-25")).toEqual({ startDate: "2026-12-01", endDate: "2026-12-31" });
  });
  it("handles February in a leap year", () => {
    expect(monthWindow("2028-02-10")).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29" });
  });
});

describe("weekWindow", () => {
  it("returns Monday..Sunday of the anchor's week", () => {
    // 2026-06-15 is a Monday
    expect(weekWindow("2026-06-15")).toEqual({ startDate: "2026-06-15", endDate: "2026-06-21" });
    // 2026-06-21 is a Sunday → same week
    expect(weekWindow("2026-06-21")).toEqual({ startDate: "2026-06-15", endDate: "2026-06-21" });
  });
  it("handles a week spanning a month boundary", () => {
    // 2026-07-01 is a Wednesday → week is Mon 2026-06-29 .. Sun 2026-07-05
    expect(weekWindow("2026-07-01")).toEqual({ startDate: "2026-06-29", endDate: "2026-07-05" });
  });
});

describe("customWindow", () => {
  it("passes through an ordered range", () => {
    expect(customWindow("2026-06-01", "2026-06-10")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-10" });
  });
  it("swaps a reversed range", () => {
    expect(customWindow("2026-06-10", "2026-06-01")).toEqual({ startDate: "2026-06-01", endDate: "2026-06-10" });
  });
  it("clamps a span longer than the max", () => {
    const w = customWindow("2026-01-01", "2030-01-01");
    expect(w.startDate).toBe("2026-01-01");
    const days = Math.round((Date.parse(w.endDate) - Date.parse(w.startDate)) / 86400000);
    expect(days).toBe(MAX_CALENDAR_SPAN_DAYS);
  });
});

describe("stepAnchor", () => {
  it("steps by one month", () => {
    expect(stepAnchor("2026-06-15", "month", 1)).toBe("2026-07-15");
    expect(stepAnchor("2026-01-15", "month", -1)).toBe("2025-12-15");
  });
  it("steps by one week", () => {
    expect(stepAnchor("2026-06-15", "week", 1)).toBe("2026-06-22");
    expect(stepAnchor("2026-06-15", "week", -1)).toBe("2026-06-08");
  });
});

describe("resolveWindow", () => {
  it("dispatches on mode", () => {
    expect(resolveWindow("month", "2026-06-15", "2026-06-03", "2026-06-09"))
      .toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(resolveWindow("week", "2026-06-15", "2026-06-03", "2026-06-09"))
      .toEqual({ startDate: "2026-06-15", endDate: "2026-06-21" });
    expect(resolveWindow("custom", "2026-06-15", "2026-06-03", "2026-06-09"))
      .toEqual({ startDate: "2026-06-03", endDate: "2026-06-09" });
  });
  it("falls back to a degenerate window on unparseable input", () => {
    expect(resolveWindow("month", "nope", "", "")).toEqual({ startDate: "nope", endDate: "nope" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run calendar-window`
Expected: FAIL — `Cannot find module "./calendar-window"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/calendar-window.ts
// Pure window math for the Resource Calendar. All arithmetic is UTC to match
// the rest of the calendar/resource-capacity code and avoid timezone drift.

export type CalendarMode = "month" | "week" | "custom";

/** Max span a window may cover, in days — guards against huge column counts. */
export const MAX_CALENDAR_SPAN_DAYS = 370;

export interface CalendarWindow {
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;   // ISO yyyy-mm-dd, inclusive
}

const MS_PER_DAY = 86_400_000;

function parseUtc(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.valueOf()) ? null : d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** First … last day of the anchor's month. */
export function monthWindow(anchorIso: string): CalendarWindow {
  const d = parseUtc(anchorIso);
  if (!d) return { startDate: anchorIso, endDate: anchorIso };
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    startDate: iso(new Date(Date.UTC(y, m, 1))),
    endDate: iso(new Date(Date.UTC(y, m + 1, 0))), // day 0 of next month = last day of this one
  };
}

/** Monday … Sunday of the anchor's week (ISO, Monday-start). */
export function weekWindow(anchorIso: string): CalendarWindow {
  const d = parseUtc(anchorIso);
  if (!d) return { startDate: anchorIso, endDate: anchorIso };
  const deltaToMonday = (d.getUTCDay() + 6) % 7; // Sun(0)->6, Mon(1)->0, ...
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - deltaToMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { startDate: iso(start), endDate: iso(end) };
}

/** [from, to] normalized so start ≤ end and clamped to MAX_CALENDAR_SPAN_DAYS. */
export function customWindow(fromIso: string, toIso: string): CalendarWindow {
  const a = parseUtc(fromIso);
  const b = parseUtc(toIso);
  if (!a || !b) return { startDate: fromIso, endDate: toIso };
  let start = a;
  let end = b;
  if (start.valueOf() > end.valueOf()) [start, end] = [end, start];
  const span = Math.round((end.valueOf() - start.valueOf()) / MS_PER_DAY);
  if (span > MAX_CALENDAR_SPAN_DAYS) {
    end = new Date(start.valueOf() + MAX_CALENDAR_SPAN_DAYS * MS_PER_DAY);
  }
  return { startDate: iso(start), endDate: iso(end) };
}

/** Step an anchor by ±1 month or ±1 week (Prev/Next). */
export function stepAnchor(anchorIso: string, unit: "month" | "week", dir: -1 | 1): string {
  const d = parseUtc(anchorIso);
  if (!d) return anchorIso;
  if (unit === "month") d.setUTCMonth(d.getUTCMonth() + dir);
  else d.setUTCDate(d.getUTCDate() + dir * 7);
  return iso(d);
}

/** Resolve the active window from the current control state. */
export function resolveWindow(
  mode: CalendarMode,
  anchorIso: string,
  fromIso: string,
  toIso: string,
): CalendarWindow {
  if (mode === "week") return weekWindow(anchorIso);
  if (mode === "custom") return customWindow(fromIso, toIso);
  return monthWindow(anchorIso);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run calendar-window`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/calendar-window.ts src/app/calendar-window.test.ts
git commit -m "feat: add calendar-window helper for resource-calendar date ranges"
```

---

## Task 2: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (near the other `resources…`/calendar keys)
- Modify: `src/app/i18n.de.ts` (same keys)

> NOTE: `i18n.de.ts` has a known issue where the editor can turn ASCII `"` into
> curly quotes. After editing, grep the new keys and confirm the delimiters are
> straight ASCII `"`. Phrase the German strings without embedded double quotes.

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, add after the existing `resourcesViewCalendar` entry (or near other calendar keys):

```ts
  calendarModeCustom: "Custom",
  calendarPrev: "Previous",
  calendarNext: "Next",
  calendarToday: "Today",
  calendarFrom: "From",
  calendarTo: "To",
```

- [ ] **Step 2: Add DE keys**

In `src/app/i18n.de.ts`, add the matching keys (straight ASCII quote delimiters):

```ts
  calendarModeCustom: "Benutzerdefiniert",
  calendarPrev: "Zurück",
  calendarNext: "Weiter",
  calendarToday: "Heute",
  calendarFrom: "Von",
  calendarTo: "Bis",
```

- [ ] **Step 3: Verify quotes + typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no missing-key type errors — `TranslationKey` is derived from `i18n.ts`, so `i18n.de.ts` must define the same keys; if a key is missing, tsc fails here).

Also run: `git diff src/app/i18n.de.ts` and confirm the six new lines use straight `"`.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add calendar date-range control strings (EN+DE)"
```

---

## Task 3: `ResourceCalendar` — window-based day generation

**Files:**
- Modify: `src/app/resource-calendar.tsx` (Props interface ~28-39; `days` useMemo ~106-132; the `CALENDAR_DAYS` constant ~41)
- Modify: `src/app/resource-calendar.test.tsx`

- [ ] **Step 1: Write/extend the failing test**

In `src/app/resource-calendar.test.tsx`, add a test that a window spanning before→after today renders past *and* future day columns. Use the existing render harness in that file as the model for props; supply the new `startDate`/`endDate`. Example:

```tsx
it("renders past and future day columns for the given window", () => {
  render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "a", display: "Aria", email: "" }]}
      absences={[]}
      today="2026-06-15"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-06-10"
      endDate="2026-06-20"
    />,
  );
  // 11 inclusive days → 11 day columns. A past date (the 10th) and a future
  // date (the 20th) both appear; today (15th) is present.
  expect(screen.getByTitle(/2026-06-10/)).toBeTruthy();
  expect(screen.getByTitle(/2026-06-20/)).toBeTruthy();
  expect(screen.getByTitle(/2026-06-15 \(/)).toBeTruthy(); // today title includes "(Today)"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run resource-calendar`
Expected: FAIL — `startDate`/`endDate` are not valid props yet (TS error) and/or the columns are still generated from `today + 30`.

- [ ] **Step 3: Add props + rewrite day generation**

In `src/app/resource-calendar.tsx`:

Add to the `Props` interface:

```ts
  /** Inclusive ISO window the grid renders, resolved by the parent. */
  startDate: string;
  endDate: string;
```

Destructure `startDate, endDate` in `ResourceCalendarInner({ … })`.

Delete the `const CALENDAR_DAYS = 30;` line.

Replace the `days` useMemo body so it iterates the window instead of `today + i`:

```ts
  const days = useMemo<CalendarDay[]>(() => {
    const out: CalendarDay[] = [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return out;
    const loc = localeFor(lang);
    let prevMonth = -1;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const month = d.getUTCMonth();
      const monthChange = out.length === 0 || month !== prevMonth;
      out.push({
        iso,
        dayOfMonth: d.getUTCDate(),
        monthLabel: monthChange ? d.toLocaleDateString(loc, { month: "short" }) : "",
        isWeekend: dow === 0 || dow === 6,
        isHoliday: holidaySet.has(iso),
        isToday: iso === today,
      });
      prevMonth = month;
    }
    return out;
  }, [startDate, endDate, today, holidaySet, lang]);
```

- [ ] **Step 4: Update existing callers in the test file**

Any other `<ResourceCalendar …>` render in `resource-calendar.test.tsx` that previously relied on the 30-day default must now pass `startDate`/`endDate` (e.g. `startDate="2026-06-15" endDate="2026-07-14"` to reproduce the old 30-day-from-today window). Update each render call.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run resource-calendar`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx
git commit -m "feat: resource-calendar renders an arbitrary [start,end] window"
```

---

## Task 4: `ResourceCalendar` — center today on open / window change

**Files:**
- Modify: `src/app/resource-calendar.tsx` (imports; the scroll container `<div className="min-h-0 flex-1 overflow-auto …">` ~158)
- Modify: `src/app/resource-calendar.test.tsx`

The grid's first column is the sticky assignee column (`ASSIGNEE_COL_PX`), then one
`CELL_PX`-wide column per day. Today's center offset is
`ASSIGNEE_COL_PX + todayIndex * CELL_PX + CELL_PX / 2`. Mirror the Gantt: set
`scrollLeft = todayOffset − clientWidth / 2`, clamped to `[0, scrollWidth − clientWidth]`.
Re-run whenever the window (`startDate`/`endDate`) changes, so opening — and any
Today/Prev/Next that brings today back into view — re-centers.

- [ ] **Step 1: Write the failing test**

```tsx
it("scroll-centers today when the window includes it", () => {
  const { container } = render(
    <ResourceCalendar
      lang="en-US"
      rows={[{ key: "a", display: "Aria", email: "" }]}
      absences={[]}
      today="2026-06-15"
      holidaySet={new Set()}
      onAddAbsence={() => {}}
      onEditAbsence={() => {}}
      resources={[]}
      onEditResource={() => {}}
      onAddResource={() => {}}
      startDate="2026-06-01"
      endDate="2026-06-30"
    />,
  );
  const scroller = container.querySelector('[data-calendar-scroll]') as HTMLElement;
  // jsdom reports 0 width, so the clamped target is 0; assert the effect ran
  // (scrollLeft is a number and the hook didn't throw) and the attribute exists.
  expect(scroller).toBeTruthy();
  expect(typeof scroller.scrollLeft).toBe("number");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run resource-calendar`
Expected: FAIL — no element with `data-calendar-scroll`.

- [ ] **Step 3: Implement the scroll effect**

In `src/app/resource-calendar.tsx`:

Update the React import to include the hooks:

```ts
import { memo, useLayoutEffect, useMemo, useRef } from "react";
```

Inside `ResourceCalendarInner`, after `days` is computed, add:

```ts
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Index of today's column within the window (−1 when today is out of range).
  const todayIndex = useMemo(() => days.findIndex((d) => d.isToday), [days]);

  // On open and whenever the window changes, scroll today to the horizontal
  // centre (Gantt-style). No-op when today is outside the window. Manual
  // scrolling within an unchanged window is preserved (deps are the window).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || todayIndex < 0) return;
    const todayCentre = ASSIGNEE_COL_PX + todayIndex * CELL_PX + CELL_PX / 2;
    const target = todayCentre - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target));
  }, [todayIndex, startDate, endDate]);
```

Attach the ref + a test hook to the scroll container (the `min-h-0 flex-1 overflow-auto` div):

```tsx
      <div ref={scrollRef} data-calendar-scroll className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run resource-calendar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-calendar.tsx src/app/resource-calendar.test.tsx
git commit -m "feat: resource-calendar centers today on open / window change"
```

---

## Task 5: `resources-panel.tsx` — control row + window state

**Files:**
- Modify: `src/app/resources-panel.tsx` (imports; component state; the `view === "calendar"` block ~528-541)

Mirror the Planning control row (`mb-2 flex flex-wrap items-center gap-2 text-xs`)
and `SegmentedControl` usage already in this file.

- [ ] **Step 1: Add imports + state**

Add imports near the top of `resources-panel.tsx`:

```ts
import { type CalendarMode, monthWindow, resolveWindow, stepAnchor } from "./calendar-window";
```

Inside `ResourcesPanelInner`, add calendar control state (alongside the other view state such as `viewGranularity`):

```ts
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [calendarAnchor, setCalendarAnchor] = useState<string>(today);
  const [calendarFrom, setCalendarFrom] = useState<string>(() => monthWindow(today).startDate);
  const [calendarTo, setCalendarTo] = useState<string>(() => monthWindow(today).endDate);
  const calendarWin = resolveWindow(calendarMode, calendarAnchor, calendarFrom, calendarTo);
```

> Anchoring-on-open: `calendarAnchor` initializes to `today`, so the calendar
> opens on today's month. (The window is intentionally not persisted.)

- [ ] **Step 2: Build the control row + pass the window**

Replace the `{view === "calendar" && ( <ResourceCalendar … /> )}` block with a
fragment that renders the control row above the calendar and passes the window:

```tsx
      {view === "calendar" && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <SegmentedControl<CalendarMode>
              value={calendarMode}
              ariaLabel={t(lang, "resourcesViewCalendar")}
              options={[
                { value: "month", label: t(lang, "resourcesGranularityMonth") },
                { value: "week", label: t(lang, "resourcesGranularityWeek") },
                { value: "custom", label: t(lang, "calendarModeCustom") },
              ]}
              onChange={setCalendarMode}
            />
            {calendarMode !== "custom" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t(lang, "calendarPrev")}
                  title={t(lang, "calendarPrev")}
                  onClick={() => setCalendarAnchor((a) => stepAnchor(a, calendarMode === "week" ? "week" : "month", -1))}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                >
                  ◀
                </button>
                <span className="min-w-[8rem] text-center font-medium text-foreground tabular-nums">
                  {calendarMode === "week"
                    ? `${shortDateRangeIso(calendarWin.startDate, calendarWin.endDate, lang)}`
                    : new Date(`${calendarWin.startDate}T00:00:00Z`).toLocaleDateString(localeFor(lang), { month: "long", year: "numeric", timeZone: "UTC" })}
                </span>
                <button
                  type="button"
                  aria-label={t(lang, "calendarNext")}
                  title={t(lang, "calendarNext")}
                  onClick={() => setCalendarAnchor((a) => stepAnchor(a, calendarMode === "week" ? "week" : "month", 1))}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                >
                  ▶
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarAnchor(today)}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                >
                  {t(lang, "calendarToday")}
                </button>
              </div>
            )}
            {calendarMode === "custom" && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <span>{t(lang, "calendarFrom")}</span>
                  <input
                    type="date"
                    aria-label={t(lang, "calendarFrom")}
                    value={calendarFrom}
                    onChange={(e) => setCalendarFrom(e.target.value)}
                    className="rounded border border-line px-2 py-1.5 text-sm dark:bg-surface"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span>{t(lang, "calendarTo")}</span>
                  <input
                    type="date"
                    aria-label={t(lang, "calendarTo")}
                    value={calendarTo}
                    onChange={(e) => setCalendarTo(e.target.value)}
                    className="rounded border border-line px-2 py-1.5 text-sm dark:bg-surface"
                  />
                </label>
              </div>
            )}
          </div>
          <ResourceCalendar
            lang={lang}
            rows={rows}
            absences={absences}
            today={today}
            holidaySet={holidaySet}
            onAddAbsence={onAddAbsence}
            onEditAbsence={onEditAbsence}
            resources={resources}
            onEditResource={onEditResource}
            onAddResource={onAddResource}
            startDate={calendarWin.startDate}
            endDate={calendarWin.endDate}
          />
        </>
      )}
```

- [ ] **Step 3: Add the `shortDateRangeIso` label helper**

The Week label needs a compact "26 May – 1 Jun 2026" string from two ISO dates.
Check `src/app/date-format.ts` first — there is an existing `shortDateRange(absence, lang)` that formats an `{startDate,endDate}` object. Reuse it by passing a shaped object, OR add a tiny exported helper in `date-format.ts`:

```ts
// src/app/date-format.ts
export function shortDateRangeIso(startIso: string, endIso: string, lang: Lang): string {
  return shortDateRange({ startDate: startIso, endDate: endIso } as { startDate: string; endDate: string }, lang);
}
```

Import it in `resources-panel.tsx` (add to the existing `./date-format` import that already brings in `localeFor`):

```ts
import { localeFor, shortDateRangeIso } from "./date-format";
```

If `shortDateRange`'s parameter type is narrower than `{startDate,endDate}`, adapt the helper to read only those two fields. Verify the exact signature before writing.

- [ ] **Step 4: Typecheck + run panel tests**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run resources-panel`
Expected: PASS (existing panel tests still green with the new calendar block).

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx src/app/date-format.ts
git commit -m "feat: calendar Month/Week/Custom control row + window wiring"
```

---

## Task 6: Verify end-to-end, bump version, changelog

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full quality gates**

Run: `npm run lint` → expect exit 0.
Run: `npx tsc --noEmit` → expect exit 0.
Run: `npx vitest run` → expect all suites pass.

- [ ] **Step 2: Manual check in the running app**

With the dev server up, open `#calendar` (modern layout): confirm it opens in
Month mode on today's month with today scroll-centered; ◀/▶ step months; the
Week segment shows a Mon–Sun window and steps weekly; Today re-centers; Custom
reveals From/To pickers that drive the window; past dates render to the left of
today.

- [ ] **Step 3: Bump version + changelog**

In `src/app/version.ts`: prepend a `// 0.39.0 …` comment block summarizing the
feature, set `APP_VERSION = "0.39.0"`, update the `APP_BUILD_DATE` trailing
comment. (Minor bump — new user-facing feature. New milestone codename optional;
`APP_MILESTONE` may stay "Chambers" or get a new author name for the 0.39 line —
confirm with the user.)

Add a `## [0.39.0] — <date>` section to `CHANGELOG.md` under the heading:

```markdown
### Added
- **Resource Calendar date range:** the calendar now has Month / Week / Custom views with Prev/Next/Today navigation and From/To date pickers, shows past as well as future dates, and scroll-centers today when opened (like the Gantt).
```

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release v0.39.0 — resource calendar date-range views"
```

---

## Self-review notes

- **Spec coverage:** From/To pickers (Task 5) ✓; Month/Week/Custom + step nav (Task 5) ✓; past+future rendering (Task 3) ✓; today anchoring on open/window change (Task 4) ✓; pure window helper + clamp/swap/Monday-week (Task 1) ✓; i18n EN+DE (Task 2) ✓; no persistence (state is local, Task 5) ✓; tests (Tasks 1,3,4 + gates Task 6) ✓.
- **Open confirmation:** version codename for the 0.39 line (Task 6) — ask the user whether to mint a new milestone name or keep "Chambers".
- **Type consistency:** `CalendarMode`, `resolveWindow`, `stepAnchor`, `monthWindow` names match across Tasks 1 and 5; `startDate`/`endDate` props match across Tasks 3, 4, 5.
