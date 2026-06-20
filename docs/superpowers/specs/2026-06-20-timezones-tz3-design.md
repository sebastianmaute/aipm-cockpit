# TZ-3 - Calendar Multi-Timezone Strip - Design

**Date:** 2026-06-20
**Status:** Approved (design)
**Target release:** v0.115.0

> Third and FINAL timezone sub-project (TZ-1 v0.113.0 model+logic+settings; TZ-2 v0.114.0 display +
> per-window switcher). TZ-3 adds a live multi-zone current-time strip to the Calendar view.

## Goal

Show, atop the Calendar view, a compact live "world clock" strip with the current time in the
effective (default) timezone plus each configured additional timezone - so a distributed team can see
at a glance what time it is across zones. Completes the original "in calendar we may add additional
timezones to show next to the default timezone" request.

## Non-goals (TZ-3)

- No per-cell / per-column timezone conversion: the Calendar is a date-only day grid (resource
  shifts/absences over calendar dates, no time-of-day), so a zone cannot meaningfully shift a date
  column. The strip is the only sensible multi-tz surface here.
- No new dependency (reuses TZ-1 `formatInZone`). No persistence (zones come from TZ-1
  `settings.additionalTimezones`; the strip is read-only).
- Not shown on the workload/planning sibling views (capacity/allocation, not cross-zone scheduling).
- No change to the day-grid math, logic, or any stored data.

## Decisions (locked during brainstorming)

1. **Multi-zone current-time strip** (not per-column annotation - meaningless on a date grid).
2. **Live tick each minute** (the strip stays current while the Calendar is open).
3. **Hide the strip when `additionalTimezones` is empty** (nothing to compare against the default).
4. **Calendar view only** (`activeTab === "calendar"`), not workload/planning.
5. The strip's default column = the EFFECTIVE zone (TZ-1 `resolveTimezone`), NOT the TZ-2 ephemeral
   display override - this is real current time across real zones.

## Architecture

### A. Pure formatter `tz-clock.ts`
```ts
/** Current time + short date of `iso` in `tz` (e.g. "08:30, Sat 20 Jun"). The date
 *  is included because it can differ across the date line. Pure; reuses TZ-1. */
export function formatZoneClock(iso: string, tz: string, lang: Lang): string;
// = formatInZone(iso, tz, { weekday:"short", day:"2-digit", month:"short",
//     hour:"2-digit", minute:"2-digit" }, localeFor(lang))
```
Pure (takes `iso`); bad zone/iso falls back via `formatInZone`.

### B. Strip component `tz-clock-strip.tsx`
- Props: `{ lang, defaultTz: string, zones: readonly string[] }`.
- Live "now": `const [now, setNow] = useState(() => new Date())` (LAZY initializer - the sanctioned
  capture; NOT a `new Date()` in the render body) + a `useEffect` that `setInterval(() =>
  setNow(new Date()), 60_000)` and clears it on unmount.
- Renders a labeled row (`aria-label={t(lang,"tzClockStripLabel")}`): the `defaultTz` chip first, then
  one chip per `zones` entry. Each chip = the zone name + `formatZoneClock(now.toISOString(), zone,
  lang)`. AIPM palette tokens only; horizontally scrollable with `pr-2` if it overflows.
- Returns `null` when `zones.length === 0` (defensive; the caller also gates).

### C. Wiring (`workspace-section.tsx`, Calendar branch)
- Add `project` to the existing `useWorkspace()` destructure (line ~315) so `operatingTimezone` is in
  scope. Import `resolveTimezone` (TZ-1) + `TzClockStrip`.
- Compute `const effectiveTz = resolveTimezone(settings.timezone, project?.operatingTimezone)`.
- In the resource-views branch (`activeTab === "workload" || "calendar" || "planning"`, ~line 677),
  render the strip ABOVE the panel ONLY for the calendar tab + non-empty list:
  `{activeTab === "calendar" && (settings.additionalTimezones?.length ?? 0) > 0 && (
     <TzClockStrip lang={lang} defaultTz={effectiveTz} zones={settings.additionalTimezones ?? []} />
   )}`.

### D. Error handling
- `formatInZone` falls back to UTC on a bad zone / returns raw on a bad iso (no throw). Additional
  zones are pre-validated by the TZ-1 settings editor. The interval is cleared on unmount (no leak).

## Testing (TDD)
- `formatZoneClock` - a known instant rendered in two zones differs by the offset; a date-line case
  where the SHORT DATE differs between zones (e.g. `...22:00Z` -> next day in `Asia/Kolkata`).
- `tz-clock-strip` - renders one chip per zone (default + each extra); is labeled
  (`getByLabelText(tzClockStripLabel)`); returns null / renders nothing when `zones` is empty. (A tick
  test is optional - assert initial render; advancing fake timers is nice-to-have, keep light.)
- `npx tsc --noEmit` (EN/DE parity) after editing tests. Calendar is NOT in the axe `A11Y_VIEWS`
  (verified) - the strip is eye-verified (text chips + a labeled region, no interactive controls).
- EN+DE i18n (DE via node UTF-8 write).

## i18n / release
- New EN+DE keys: `tzClockStripLabel` ("Current time by zone").
- `versionHighlightTimezoneCalendar` (+ EN/DE) appended to `APP_HIGHLIGHT_KEYS`.
- Bump `version.ts` (0.115.0 + codename), add a `CHANGELOG.md` entry. No CSP change.

## File map
- `tz-clock.ts` (NEW pure) - `formatZoneClock`.
- `tz-clock-strip.tsx` (NEW) - the live strip.
- `workspace-section.tsx` - compute `effectiveTz` (+ destructure `project`), render the strip in the calendar branch.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
