# Dashboard density toggle — design

**Date:** 2026-06-21
**Slice:** Landing-cockpit Tier-2 #8
**Version target:** 0.123.0

## Goal

Per-device Comfortable/Compact density for the Dashboard. Compact tightens the
cockpit's vertical rhythm + KPI gap + cockpit card padding so power users fit
more above the fold. Spacing-only — no font-size or palette change.

## Model

`settings.dashboardDensity?: "comfortable" | "compact"` — per-device, default
`"comfortable"`. Persisted via `setSettings` → `writeSettings` (spreads the whole
object; NO allowlist edit, mirrors `tasksViewMode`/`tourSeen`). Out of workspace
backends (it's a device setting, not project data).

## Pure engine — `dashboard-density.ts` (i18n-free, testable)

```ts
export type DashboardDensity = "comfortable" | "compact";
export interface DensityClasses { outer: string; kpiGap: string; cardPad: string; }
export function densityClasses(d: DashboardDensity): DensityClasses;
```

- `comfortable` → `{ outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3" }` (current values, unchanged — comfortable is a no-op refactor)
- `compact`     → `{ outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2" }`

Total function, no clock, no I/O. Unknown input is impossible (typed union) but
the impl defaults to the comfortable branch defensively.

## DashboardPanel

New optional props:
- `density?: DashboardDensity` (default `"comfortable"` — back-compat with the ~30 test render sites).
- `onToggleDensity?: (d: DashboardDensity) => void`.

Apply classes:
- `densityClasses(density).outer` replaces the literal `space-y-4` on the panel container (currently line 260).
- `.kpiGap` replaces `gap-2` on the KPI grid (`grid grid-cols-3 gap-2`, line 283).
- `.cardPad` replaces `p-3` on the sparkline card (line 303).

On-panel toggle: a button in the overall-band control cluster beside the Trends
toggle. Mirrors the Trends toggle exactly — `aria-pressed`, `title`, text label
= accessible name. Clicking flips comfortable↔compact via `onToggleDensity`.
Rendered only when `onToggleDensity` is provided (popouts don't pass it →
no toggle, but the panel still honours the `density` prop). `print:hidden`.

## Settings control

A third `SegmentedControl<DashboardDensity>` in `AppearanceSection` (Settings →
General hosts Appearance). Same `dashboardDensity` setting → single source of
truth, on-panel + settings always in sync. `SegmentedControl`'s `ariaLabel`
covers the axe gate (Settings→General is axe-scanned; SegmentedControl is a
known-good labeled control).

## Wiring

`workspace-section.tsx` Dashboard render:
```tsx
density={settings.dashboardDensity ?? "comfortable"}
onToggleDensity={(d) => setSettings((s) => ({ ...s, dashboardDensity: d }))}
```

## i18n (EN + DE)

- `dashboardDensityLabel` — "Density" / "Dichte"
- `dashboardDensityComfortable` — "Comfortable" / "Komfortabel"
- `dashboardDensityCompact` — "Compact" / "Kompakt"
- `dashboardDensityToggle` — on-panel button label/aria, e.g. "Compact view" / "Kompakte Ansicht" (or pair with a "Comfortable view" variant — match the Trends toggle's show/hide-label pattern)
- `versionHighlightDashboardDensity` — release highlight, EN + DE.

DE via node utf8 write (CRLF `\r\n` anchors, real umlauts).

## Versioning

`version.ts` APP_VERSION "0.123.0" + new milestone; append
`versionHighlightDashboardDensity` to `APP_HIGHLIGHT_KEYS`; CHANGELOG entry;
README badge; package.json.

## Tests

- `dashboard-density.test.ts` — both branches return expected class strings.
- `dashboard-panel.test.tsx` — compact density applies `space-y-2` to the
  container; toggle button present when `onToggleDensity` given, fires with the
  flipped value; absent when prop omitted.
- `appearance-section.test.tsx` (if exists) or general-section — density
  SegmentedControl renders + calls onChange. (No test file for appearance-section
  currently → add a focused one or fold into general-section test.)

## a11y

Dashboard + Settings→General are both in axe `A11Y_VIEWS`. On-panel toggle: text
label = accessible name + `aria-pressed`. Settings: `SegmentedControl ariaLabel`.
No new unlabeled control. Verify with
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` and
`-g "Settings"` before push.

## Out of scope (YAGNI)

Global/tasks-table density, font-size scaling, palette/contrast changes,
per-widget density.
