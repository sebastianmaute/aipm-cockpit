# TZ-2 - Timezone Display + Per-Window Switcher - Design

**Date:** 2026-06-20
**Status:** Approved (design)
**Target release:** v0.114.0

> Second of three timezone sub-projects (TZ-1 shipped v0.113.0 "Kress"). TZ-1 built the model +
> resolution + pure utilities + shifted LOGIC to the effective zone. TZ-2 routes DISPLAY of instant
> timestamps through a session display timezone, with one shared ephemeral switcher. TZ-3 (calendar
> multi-timezone) remains.

## Goal

Render the app's instant-timestamp displays (activity log, version history, trends/snapshots) in a
session-chosen display timezone - defaulting to TZ-1's resolved effective zone - via a single shared
ephemeral switcher in the top bar, with the zone shown next to each converted time. This answers
"what is this UTC time in IST?" without persisting anything.

## Non-goals (TZ-2)

- TZ-3 (calendar multi-timezone: showing the default + additional zones side by side).
- No persistence: the display-tz override is in-memory for the session (resets on reload).
- No new dependency: reuses TZ-1's `Intl`-based `formatInZone`.
- Date-only fields (task due dates, milestone dates), the gantt month-axis, and storage/export/codec
  timestamps are NOT touched - they are tz-agnostic calendar dates or durable UTC records.
- No change to LOGIC (TZ-1 owns the effective-`today` day-boundary math); TZ-2 is display-only.

## Decisions (locked during brainstorming)

1. **Shared ephemeral display-tz** (not per-view dropdowns): ONE top-bar control sets a session
   display zone that all instant-timestamp displays follow; defaults to the effective zone, resets on
   reload.
2. **Conversion scope:** activity log + version history + trends/snapshot capture times only. (Gantt
   month-axis = a date label, excluded; date-only fields stay tz-agnostic.)
3. **Show the zone** next to converted times (`Intl` `timeZoneName: "short"`).

## Architecture

### A. Ephemeral display-tz state (`display-timezone-context.tsx`)
A React context provided in `task-manager` ABOVE all views (and popouts):
```ts
interface DisplayTimezoneValue {
  displayTz: string;                 // active zone = override ?? effectiveTz
  effectiveTz: string;               // resolveTimezone(settings.timezone, project?.operatingTimezone)
  isOverridden: boolean;             // override !== undefined
  setDisplayOverride: (tz: string | undefined) => void; // undefined clears -> back to effective
  resetDisplayTz: () => void;        // = setDisplayOverride(undefined)
}
```
- Internal: `const [override, setOverride] = useState<string | undefined>(undefined)` - EPHEMERAL,
  never persisted. `displayTz = override ?? effectiveTz`. The provider receives `effectiveTz` as a
  prop (computed by the existing TZ-1 `resolveTimezone(settings.timezone, project?.operatingTimezone)`
  in task-manager) so the default always tracks settings/project while no override is set.
- `useDisplayTimezone()` hook reads the context; throws if used outside the provider (standard).
- The provider wraps the whole shell INCLUDING popouts, so popout timestamps also convert (to the
  effective default - popouts get no switcher control, see B).

### B. Switcher UI (`display-tz-switcher.tsx`)
A compact labeled control rendered in the top bar. Wired into BOTH header sites (modern shell
`topBarMenus` + classic `AppHeader`) per the dual-header rule. The popout `legacyTree` renders no
header, so popouts show no switcher (they use the effective default via the context).
- A `<select>` (or a small menu) with `aria-label = t(lang, "displayTzLabel")`:
  - option `value=""` -> `${t(lang,"displayTzDefault")} (${effectiveTz})` -> `setDisplayOverride(undefined)`.
  - option `UTC`.
  - one option per `settings.additionalTimezones` (deduped, validated already by TZ-1's editor).
  - current `value = isOverridden ? displayTz : ""`.
- AIPM tokens only. Labeled (the top bar is axe-scanned in every view -> unlabeled control = critical fail).

### C. Shared formatter (`tz-display.ts`, or extend `date-format.ts`)
```ts
/** Localized instant + zone label, in the given display zone. Reuses TZ-1 formatInZone. */
export function formatDisplayTimestamp(iso: string, tz: string, lang: Lang): string;
// = formatInZone(iso, tz, { year:"numeric", month:"2-digit", day:"2-digit",
//     hour:"2-digit", minute:"2-digit", timeZoneName:"short" }, localeFor(lang))
```
- Returns e.g. "21/06/2026, 03:30 GMT+5:30" (exact wording is whatever `Intl` emits for the locale +
  zone). Bad iso / bad zone falls back via `formatInZone` (no throw).

### D. Display routing (the three instant-timestamp sites)
Each reads `useDisplayTimezone().displayTz` and formats via `formatDisplayTimestamp`:
- `activity-log-panel.tsx` - replace the local `formatTimestamp(iso, lang)` (currently
  `toLocaleString` in browser-local) with `formatDisplayTimestamp(iso, displayTz, lang)`.
- `history-panel.tsx` - the `capturedAt` displays (the `labelOf` fallback + the ~3 other
  `toLocaleString` sites) -> `formatDisplayTimestamp(capturedAt, displayTz, lang)`.
- `trends-panel.tsx` - the snapshot `capturedAt` displays -> same.
- DO NOT touch: gantt `fmtMonth` (date axis), date-only `shortDateRange`/`formatExpiryDate`, or any
  `toISOString()` storage/export stamp.

### E. Error handling
- `formatInZone` already returns the raw iso on an unparseable date and falls back to UTC on a bad
  zone. The override is always a validated zone (from TZ-1's list). The context default is always a
  valid effective zone. No crash path.

## Testing (TDD)
- `formatDisplayTimestamp` - converts a known instant into a target zone (e.g. `...22:00Z` in
  `Asia/Kolkata` -> contains "03:30"); carries a zone label; bad iso -> returns input.
- `display-timezone-context` - default `displayTz === effectiveTz`; `setDisplayOverride("UTC")` ->
  `displayTz === "UTC"` + `isOverridden`; `resetDisplayTz()` -> back to effective.
- `display-tz-switcher` - lists Default(+effective) / UTC / each additional zone; selecting a zone
  calls `setDisplayOverride`; selecting Default clears it; control is labeled (a11y).
- the three panels - render a converted timestamp when the context provides a non-local zone (mock
  the context/provider; assert the formatted output reflects the zone). jsdom `Intl` supports zones.
- `npx tsc --noEmit` (EN/DE parity) after editing tests; axe gate for any always-present view after
  the switcher lands (top bar is scanned via every view) - run `e2e/a11y.spec.ts`.
- EN+DE i18n (DE via node UTF-8 write, real umlauts).

## i18n / release
- New EN+DE keys: `displayTzLabel` ("Display timezone"), `displayTzDefault` ("Default"), and
  `versionHighlightTimezoneDisplay`.
- Bump `version.ts` (0.114.0 + codename), append the highlight key to `APP_HIGHLIGHT_KEYS` (+ EN/DE),
  add a `CHANGELOG.md` entry. No CSP change.

## File map
- `display-timezone-context.tsx` (NEW) - ephemeral display-tz context + `useDisplayTimezone`.
- `display-tz-switcher.tsx` (NEW) - the top-bar switcher.
- `tz-display.ts` (NEW) OR `date-format.ts` (extend) - `formatDisplayTimestamp`.
- `task-manager.tsx` - mount the provider (above views + popouts); render the switcher in BOTH header sites.
- `activity-log-panel.tsx`, `history-panel.tsx`, `trends-panel.tsx` - route timestamps through the shared formatter + context.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
