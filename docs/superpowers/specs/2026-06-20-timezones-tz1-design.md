# TZ-1 - Timezone Foundation + Logic + Settings - Design

**Date:** 2026-06-20
**Status:** Approved (design)
**Target release:** v0.113.0

> First of THREE sub-projects for the timezone feature:
> - **TZ-1 (this):** model + resolution + pure utilities + shift day-boundary LOGIC to the effective
>   timezone + settings/project UI.
> - **TZ-2:** route all datetime DISPLAY through the effective tz + a per-window ephemeral tz switcher.
> - **TZ-3:** calendar multi-timezone (default + additional zones shown together).
> Build order TZ-1 -> TZ-2 -> TZ-3 (2 + 3 depend on TZ-1's foundation).

## Goal

Give the app a configurable timezone: a per-project operating timezone and a per-device override, with
the app's day-boundary logic ("today", overdue, reminders, due-date math) computed in the EFFECTIVE
timezone instead of the current hard-coded UTC date. Establish the pure timezone utilities and the
settings/project UI the later sub-projects build on.

## Non-goals (TZ-1)

- TZ-2 (display routing of timestamps + the per-window switcher) and TZ-3 (calendar multi-tz).
- No new dependency: `Intl.DateTimeFormat` / `Intl.supportedValuesOf` cover everything.
- No change to STORAGE/EXPORT timestamps (codecs, backend `loggedAt`, snapshot `fetchedAt`,
  version `createdAt`): those stay UTC ISO - correct for durable records.
- The app stores date-only entity fields (`YYYY-MM-DD`) unchanged; timezones never rewrite stored data,
  only how "today" is derived for logic.

## Decisions (locked during brainstorming)

1. **Display + logic** (not display-only): the effective tz shifts day-boundary logic. TZ-1 does the
   LOGIC half (the single `today` anchor + a couple of secondary derivations); TZ-2 does the DISPLAY half.
2. **Both** storage locations: a per-project `operatingTimezone` AND a per-device `settings.timezone`
   override. Resolution: `settings.timezone ?? ws.operatingTimezone ?? browserTimeZone()`.
3. Per-device `additionalTimezones` list lives in settings now (TZ-1) so TZ-2/TZ-3 can consume it; TZ-1
   only adds the editor + validation (no display use yet).

## Architecture

### A. Pure engine `timezone.ts` (i18n-free, no new dep)
```ts
/** YYYY-MM-DD of `now` in the given IANA zone. Pure given `now`. */
export function todayInZone(now: Date, tz: string): string;        // Intl.DateTimeFormat("en-CA", {timeZone: tz, year, month, day}) -> "YYYY-MM-DD"
/** Format an ISO datetime in a zone (used heavily in TZ-2; landed here). */
export function formatInZone(iso: string, tz: string, opts: Intl.DateTimeFormatOptions, locale: string): string;
/** True if `tz` is a valid IANA zone (try/catch around Intl.DateTimeFormat). */
export function isValidTimeZone(tz: string): boolean;
/** The host's detected zone. Env read (client) — NOT a module const (SSR/test-safe). */
export function browserTimeZone(): string;                          // Intl.DateTimeFormat().resolvedOptions().timeZone, fallback "UTC"
```
- All total + never throw. `todayInZone`/`formatInZone` assume `tz` already valid (caller resolves to a
  valid zone first); if `Intl` rejects it they fall back to UTC rather than throwing.
- `todayInZone` MUST use `"en-CA"` (or `formatToParts`) to get an ISO `YYYY-MM-DD` regardless of UI locale.
- No internal `new Date()`/`Date.now()` (purity rule) — `now` is always passed in.

### B. Resolution (pure) `resolveTimezone(settings, ws): string`
Lives beside the model (e.g. in `timezone.ts` or `settings-types.ts`). Returns the first defined of:
`settings.timezone` (per-device override) -> `ws.operatingTimezone` (per-project) -> `browserTimeZone()`.
Each candidate is gated through `isValidTimeZone`; an invalid stored value is skipped (defensive).

### C. Data model
- `types.ts`/`workspace.ts`: `Workspace.operatingTimezone?: string` (IANA). NESTED-field-style optional;
  persisted across ALL SIX backends (JSON/CSV/MD/Turso single+tenant/IndexedDB). It is a single scalar
  (a string), so it serializes like `status`/`fxRates`-adjacent scalars: a CSV `# TIMEZONE` section (one
  `value,<tz>` row) + a Markdown `## Timezone` line + a Turso `meta` row `operating_timezone` (reuse the
  `meta` singleton, NOT a new TABLE_NAMES entry) + the JSON object + IndexedDB KV slot. Emitted only when
  set (committee-less byte-stability precedent). Regenerate golden fixtures + add to `sample-workspace-small`.
- `sanitize.ts`: `sanitizeTimezone(raw): string | undefined` - string + `isValidTimeZone`, else undefined.
  `jsonToWorkspace` + every codec/decoder runs the stored value through it on load.
- `settings-types.ts`: `timezone?: string` (override) + `additionalTimezones?: string[]`. NOT in
  `defaultSettings` (absent = follow project/browser). Persisted via `writeSettings` (spreads whole object).

### D. Wire the logic (the "today" anchor)
- `task-manager.tsx`: replace `const today = todayISO()` with `const today = effectiveToday(tz)` where
  `tz = resolveTimezone(settings, currentWorkspaceForTz)` and `effectiveToday(tz)` is a module fn
  `todayInZone(new Date(), tz)` (a module fn, mirroring the existing `todayISO()`, so it does not trip the
  `new Date()`-in-render lint). `today` flows unchanged into `buildActionInput` + components, so
  overdue/next-actions/reminders/due-date math now use the effective zone.
  - `tz` needs the resolved zone: thread `settings` (already in scope) + the live workspace's
    `operatingTimezone`. Use the workspace-context value (e.g. a new `operatingTimezone` from context, or
    read it off the same place `status`/`features` come from).
- Align secondary "today" derivations that feed user-facing day logic: `use-resource-planner.ts`
  `isoToday` and `use-bulk-operations.ts` -> take/derive `today` in the effective zone (thread the
  resolved tz in, or accept a `today` arg). Do NOT touch storage/export/codec date stamps
  (`browser-backend`, `csv/markdown/turso` codecs, `export*`) - those stay UTC.

### E. Settings + project UI
- `settings-view.tsx` General section:
  - Default-timezone `<select>` (labeled): first option "System default" (= clear the override ->
    `settings.timezone = undefined`); then zones from `Intl.supportedValuesOf("timeZone")`. Show the
    detected browser zone in the System-default label. Write via the settings setter (-> `writeSettings`).
  - Additional-timezones editor: a labeled add control (a `<select>` of zones + Add) + a removable list
    (row-unique remove labels). Stores `settings.additionalTimezones` (deduped, validated).
- Project create/edit form (`project-form-fields.tsx`): an optional "Operating timezone" field (same
  zone picker; empty = none). Wires into `ProjectMeta`/the create+edit drafts.
  ★ Confirm where `operatingTimezone` belongs: it is a WORKSPACE field, not `ProjectMeta` - so the project
  form sets it on the workspace/create path, not on `meta`. (If simpler to hang it on `ProjectMeta`,
  decide during planning; spec's intent: one operating tz per project workspace.)

### F. Error handling
- Invalid/unknown IANA anywhere (stored project value, stored setting, a hand-edited import) -> dropped by
  `sanitizeTimezone`/`isValidTimeZone` -> resolution falls back to the next candidate -> browser zone.
- `Intl.supportedValuesOf` is widely supported in current evergreen browsers (the app's target); if it is
  somehow unavailable, the picker degrades to a small curated fallback list + a free-text entry validated
  by `isValidTimeZone`. The app never crashes on a missing/odd zone.

## Testing (TDD)
Pure first:
- `todayInZone` - a `now` whose UTC date differs from the zone date (e.g. `2026-06-20T22:00:00Z` in
  `Pacific/Kiritimati` (+14) -> `2026-06-21`; and in `Pacific/Pago_Pago` (-11) -> `2026-06-20`); DST-safe
  for a zone like `America/New_York` across a transition.
- `isValidTimeZone` - accepts `"Asia/Kolkata"`, rejects `"Not/AZone"` + `""`.
- `resolveTimezone` - override wins; falls through project -> browser; skips an invalid stored value.
- `sanitizeTimezone` - valid kept, invalid/empty/non-string -> undefined.
Then:
- six-path round-trip for `operatingTimezone` (codec test + golden fixtures regenerated, byte-stable when
  absent); load normalizer drops a bad stored value.
- settings picker + additional-tz editor render; selecting "System default" clears the override; add/remove
  a zone; row-unique remove labels (Settings/General is in the axe `A11Y_VIEWS` -> labeled controls).
- project form operating-tz field round-trips into the created/edited workspace.
- a focused logic test: with `settings.timezone` set to a zone where "today" differs from UTC, an action's
  overdue/today classification follows the zone (drive the existing next-actions or due-dates engine with
  the tz-derived `today`).
- `npx tsc --noEmit` (EN/DE parity) after editing tests; axe gate for Settings/General after the picker lands.
- EN+DE i18n (DE via node UTF-8 write, real umlauts).

## i18n / release
- New EN+DE keys: "Timezone", "Default timezone", "System default" (with the detected zone), "Additional
  timezones", "Add timezone", "Operating timezone" (project), remove-label, and `versionHighlightTimezones`.
- Bump `version.ts` (0.113.0 + codename), append `versionHighlightTimezones` to `APP_HIGHLIGHT_KEYS`
  (+ EN/DE), add a `CHANGELOG.md` entry. No CSP change.

## File map
- `timezone.ts` (NEW pure) - `todayInZone`, `formatInZone`, `isValidTimeZone`, `browserTimeZone`, `resolveTimezone`.
- `types.ts` / `workspace.ts` - `Workspace.operatingTimezone`.
- `sanitize.ts` - `sanitizeTimezone`.
- Six persistence paths (`workspace.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, `turso-schema.ts`,
  `turso-tenant-schema.ts`, `browser-backend.ts`) + `__fixtures__/golden-*` + `sample-workspace-small.*`.
- `settings-types.ts` - `timezone`, `additionalTimezones`.
- `settings-view.tsx` - default picker + additional-tz editor.
- `project-form-fields.tsx` (+ create/edit wiring) - operating-tz field.
- `task-manager.tsx`, `use-resource-planner.ts`, `use-bulk-operations.ts` - effective-`today` wiring.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
