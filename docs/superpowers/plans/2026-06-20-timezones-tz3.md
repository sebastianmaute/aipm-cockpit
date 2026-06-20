# Calendar Multi-Timezone Strip (TZ-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live multi-zone current-time strip atop the Calendar view (effective zone + each additional zone), the final timezone slice.

**Architecture:** A pure `tz-clock.ts` formatter (reuses TZ-1 `formatInZone`), a `tz-clock-strip.tsx` component that ticks each minute and renders one chip per zone, wired into `workspace-section.tsx`'s calendar branch (only for `activeTab==="calendar"` + non-empty `additionalTimezones`).

**Tech Stack:** Next.js 16 (forked) / React 19 / TS, vitest. Reuses TZ-1 `timezone.ts` (`formatInZone`, `resolveTimezone`) — NO new dep. AIPM tokens only. EN/DE parity (tsc).

---

## Conventions (read once)
- Lint fatal (`--max-warnings=0`); tsc enforces EN/DE key parity + typechecks tests.
- DE edits via node UTF-8 CRLF write (Edit corrupts umlauts).
- No `new Date()`/`Date.now()` in a render BODY — the strip captures `now` via a LAZY `useState(() => new Date())` initializer (sanctioned) + advances it in a `useEffect` interval. `formatZoneClock` takes `iso` (pure).
- No `set-state-in-effect` for prop-sync — but a `setInterval`→`setNow` inside `useEffect` is fine (it's an external timer, not a render-derived prop sync).
- AIPM tokens only. `Lang`=`"en-US"|"en-GB"|"de"`; DE assertions call `loadI18n("de")` in `beforeAll`.
- TZ-1 (`timezone.ts`) + TZ-2 are merged on main: `formatInZone(iso,tz,opts,locale)`, `resolveTimezone(override,projectTz)`, `localeFor(lang)` (date-format.ts).

## File Structure
- `tz-clock.ts` (NEW) — `formatZoneClock`.
- `tz-clock-strip.tsx` (NEW) — the live strip.
- `workspace-section.tsx` — compute `effectiveTz` (+ destructure `project`), render the strip in the calendar branch.
- `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md`.

---

## Task 1: `tz-clock.ts` — `formatZoneClock`

**Files:** Create `src/app/tz-clock.ts`, Test `src/app/tz-clock.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it } from "vitest";
import { formatZoneClock } from "./tz-clock";

describe("formatZoneClock", () => {
  it("renders time + short date in the zone", () => {
    const out = formatZoneClock("2026-06-20T22:00:00Z", "Asia/Kolkata", "en-GB");
    expect(out).toContain("03:30"); // 22:00Z + 5:30
    expect(out).toContain("Jun");   // short month present
  });
  it("differs across the date line (date can roll over)", () => {
    const ist = formatZoneClock("2026-06-20T22:00:00Z", "Asia/Kolkata", "en-GB"); // 21 Jun
    const ny = formatZoneClock("2026-06-20T22:00:00Z", "America/New_York", "en-GB"); // 20 Jun
    expect(ist).not.toBe(ny);
    expect(ist).toContain("21");
    expect(ny).toContain("20");
  });
  it("falls back (no throw) on a bad iso", () => {
    expect(formatZoneClock("nope", "UTC", "en-GB")).toBe("nope");
  });
});
```
Run `npm run test:run -- tz-clock` → FAIL.

- [ ] **Step 2: Implement `src/app/tz-clock.ts`**
```ts
// src/app/tz-clock.ts — current time + short date of an instant in a zone, for the
// Calendar multi-timezone strip (TZ-3). Reuses TZ-1 formatInZone. Pure (takes iso).
import { formatInZone } from "./timezone";
import { localeFor } from "./date-format";
import type { Lang } from "./i18n";

const CLOCK_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short", day: "2-digit", month: "short",
  hour: "2-digit", minute: "2-digit",
};

/** "08:30, Sat 20 Jun"-style current time + short date for `iso` in `tz`. The date
 *  is included because it can differ across the date line. Bad iso/zone falls back
 *  via formatInZone (returns the raw iso on an unparseable date). */
export function formatZoneClock(iso: string, tz: string, lang: Lang): string {
  return formatInZone(iso, tz, CLOCK_OPTS, localeFor(lang));
}
```
Run → PASS. (If a locale orders the parts so "21"/"20" assertion is brittle, keep the offset-difference + month assertions and relax the day-number check — report actual output.)

- [ ] **Step 3: Verify + commit**
`npx tsc --noEmit` → 0; `npm run lint` → clean.
```bash
git add src/app/tz-clock.ts src/app/tz-clock.test.ts
git commit -m "feat(tz-3): formatZoneClock (time + short date in a zone)"
```

---

## Task 2: `tz-clock-strip.tsx` + i18n

**Files:** Create `src/app/tz-clock-strip.tsx`, Test `src/app/tz-clock-strip.test.tsx`; Modify `i18n.ts`/`i18n.de.ts`

- [ ] **Step 1: i18n keys**
EN (`i18n.ts`, near other `tz*` keys): `tzClockStripLabel: "Current time by zone"`.
DE (`i18n.de.ts`, node UTF-8 CRLF write): `tzClockStripLabel: "Aktuelle Zeit nach Zone"`.

- [ ] **Step 2: Failing test `tz-clock-strip.test.tsx`**
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TzClockStrip } from "./tz-clock-strip";
import { t } from "./i18n";

describe("TzClockStrip", () => {
  it("renders a labeled region with the default + each additional zone", () => {
    render(<TzClockStrip lang="en-US" defaultTz="Europe/Berlin" zones={["America/New_York", "Asia/Kolkata"]} />);
    const region = screen.getByLabelText(t("en-US", "tzClockStripLabel"));
    expect(region).toBeInTheDocument();
    expect(region.textContent).toContain("Europe/Berlin");
    expect(region.textContent).toContain("America/New_York");
    expect(region.textContent).toContain("Asia/Kolkata");
  });
  it("renders nothing when there are no additional zones", () => {
    const { container } = render(<TzClockStrip lang="en-US" defaultTz="Europe/Berlin" zones={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement `src/app/tz-clock-strip.tsx`**
```tsx
"use client";

// Calendar multi-timezone strip (TZ-3): a live "world clock" row — the default
// (effective) zone + each configured additional zone. Ticks each minute. Shown
// only on the Calendar view when additional zones are configured.
import { useEffect, useState } from "react";
import { type Lang, t } from "./i18n";
import { formatZoneClock } from "./tz-clock";

interface TzClockStripProps {
  lang: Lang;
  defaultTz: string;
  zones: readonly string[];
}

export function TzClockStrip({ lang, defaultTz, zones }: TzClockStripProps) {
  // Lazy init (sanctioned capture; not a render-body new Date()); advance each minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (zones.length === 0) return null;
  const iso = now.toISOString();
  const all = [defaultTz, ...zones];
  return (
    <div
      aria-label={t(lang, "tzClockStripLabel")}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 overflow-x-auto rounded-md border border-line bg-surface px-3 py-1.5 pr-2 text-xs text-foreground"
    >
      {all.map((tz) => (
        <span key={tz} className="whitespace-nowrap">
          <span className="font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{tz}</span>
          <span className="ml-1 text-muted-foreground tabular-nums">{formatZoneClock(iso, tz, lang)}</span>
        </span>
      ))}
    </div>
  );
}
```
Run → PASS.

- [ ] **Step 4: Verify + commit**
`npx tsc --noEmit` → 0 (EN/DE parity); `npm run lint` → clean (no unused).
```bash
git add src/app/tz-clock-strip.tsx src/app/tz-clock-strip.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(tz-3): live multi-timezone clock strip + i18n"
```

---

## Task 3: Wire the strip into the Calendar view

**Files:** Modify `src/app/workspace-section.tsx`

- [ ] **Step 1: Imports + destructure + effectiveTz**
- Add imports: `import { TzClockStrip } from "./tz-clock-strip";` and `import { resolveTimezone } from "./timezone";`.
- Add `project` to the existing `useWorkspace()` destructure (~line 315): `const { tasks, raid, …, milestones, project, steeringCommittee, setSteeringCommittee } = useWorkspace();` (confirm `project` is exposed by the workspace context — it is; it's the active `ProjectMeta`).
- Compute (near where `settings`/`today` are used in the component body): `const effectiveTz = resolveTimezone(settings.timezone, project?.operatingTimezone);`.

- [ ] **Step 2: Render the strip in the calendar tabpanel**
In the resource-views branch (`activeTab === "workload" || "calendar" || "planning"`, ~line 677), inside the `<div role="tabpanel">`, render the strip BEFORE `<ResourcesPanel …>`, gated to the calendar tab + non-empty list:
```tsx
        {(activeTab === "workload" || activeTab === "calendar" || activeTab === "planning") && (
          <div id="panel-resources-view" role="tabpanel" className={panelClass}>
            {activeTab === "calendar" && (settings.additionalTimezones?.length ?? 0) > 0 && (
              <TzClockStrip lang={lang} defaultTz={effectiveTz} zones={settings.additionalTimezones ?? []} />
            )}
            <ResourcesPanel
              view={activeTab}
              … (unchanged) …
```
(Keep `panelClass` + the existing `ResourcesPanel` props exactly as they are. The strip is a sibling above the panel inside the same tabpanel.)

- [ ] **Step 3: Verify**
`npx tsc --noEmit` → 0; `npm run lint` → clean (no unused `effectiveTz`/`resolveTimezone`/`project`; if `project` is now unused elsewhere it IS used by effectiveTz — fine); `npm run test:run` → green (existing workspace-section tests still pass — the strip only renders on calendar+non-empty, default test fixtures have no additionalTimezones so nothing changes).

- [ ] **Step 4: Commit**
```bash
git add src/app/workspace-section.tsx
git commit -m "feat(tz-3): show the multi-timezone clock strip on the Calendar view"
```

---

## Task 4: Release v0.115.0

**Files:** Modify `src/app/version.ts`, `i18n.ts`, `i18n.de.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version + highlight key** — `version.ts`: `APP_VERSION = "0.115.0"`; update the build-date comment; `APP_MILESTONE` = an unused sci-fi author codename (e.g. `"Cherryh"` is taken (0.84); use `"Asimov"` or `"Card"` or `"Herbert"` — pick one NOT already in CHANGELOG; grep CHANGELOG to confirm). Append `"versionHighlightTimezoneCalendar"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Highlight i18n** — EN (`i18n.ts`): `versionHighlightTimezoneCalendar: "Calendar timezones: the Calendar view shows a live strip with the current time in your default timezone plus each additional zone you configured — handy for distributed teams."` (use an em-dash separator to match the harmonized corpus). DE (`i18n.de.ts`, node UTF-8 write, real umlauts): `"Kalender-Zeitzonen: Die Kalenderansicht zeigt eine Live-Leiste mit der aktuellen Zeit in Ihrer Standard-Zeitzone sowie jeder weiteren konfigurierten Zone — praktisch für verteilte Teams."`. Verify parity + umlauts (`für`, `verteilte`).

- [ ] **Step 3: CHANGELOG** — prepend above the top entry:
```markdown
## [0.115.0] - <date> "<codename>"

### Added
- Calendar timezones: the Calendar view now shows a live "world clock" strip with the current time (and date) in your default timezone plus each additional zone configured in Settings - useful for coordinating across distributed teams. The strip appears only when you've added extra zones.
```
(Use an em-dash for the separator to match the other highlight/CHANGELOG style if applicable.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → 0; `npm run lint` → clean; `npm run test:run` → green; `npm run build` → succeeds; `npx playwright test e2e/a11y.spec.ts --project=chromium` → 12/12 (Calendar is NOT in A11Y_VIEWS so the strip isn't directly scanned, but confirm no regression — the strip has no interactive controls).

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(tz-3): release v0.115.0 (calendar multi-timezone strip)"
```

---

## Final steps (after all tasks)
1. Final whole-branch review (focus: lazy-init `now` + interval cleanup, no render-body `new Date()`; strip hidden when no zones; default = effective zone not the TZ-2 display override; only on Calendar; EN/DE parity; AIPM tokens).
2. Use superpowers:finishing-a-development-branch.
3. Branch `timezones-tz3` is off clean main — MR diffs to just TZ-3. **This completes the 3-part timezone roadmap.**

## Self-review notes (resolved)
- **Spec coverage:** formatter (T1), strip component + i18n (T2), calendar wiring (T3), release (T4). Live-tick (T2 interval), hide-when-empty (T2 `null` + T3 gate), calendar-only (T3 `activeTab==="calendar"`), default=effective (T3 `resolveTimezone`) all covered.
- **Type consistency:** `formatZoneClock(iso,tz,lang)`, `TzClockStrip` props `{lang,defaultTz,zones}` consistent T1→T3.
- **Purity:** `now` via lazy `useState(()=>new Date())` + effect interval — no render-body `new Date()`; `formatZoneClock` pure. Interval cleared on unmount.
- **No over-scope:** date-grid cells untouched; strip is additive above the panel; only renders on calendar with ≥1 additional zone.
