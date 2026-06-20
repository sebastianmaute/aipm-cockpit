# Timezone Display + Per-Window Switcher (TZ-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render instant-timestamp displays (activity log, version history, trends) in a session-chosen display timezone via one shared ephemeral top-bar switcher, defaulting to TZ-1's effective zone, with the zone shown.

**Architecture:** A `DisplayTimezoneContext` (ephemeral session override over TZ-1's `effectiveTz`) provided above all views; a shared `formatDisplayTimestamp` wrapping TZ-1's `formatInZone` (with a zone label); a top-bar `<select>` switcher; the three timestamp panels route through the hook + formatter.

**Tech Stack:** Next.js 16 (forked) / React 19 / TS, vitest, Playwright axe gate. Reuses TZ-1 `timezone.ts` (`formatInZone`, `resolveTimezone`) — NO new dep. AIPM tokens only. EN/DE parity (tsc).

---

## Conventions (read once)
- Lint fatal (`--max-warnings=0`): no unused imports. tsc enforces EN/DE key parity + typechecks tests.
- DE edits via node UTF-8 CRLF-aware write (Edit corrupts umlauts); verify no `fuer`/`ae` subs.
- No `new Date()`/`Date.now()` in a render body — the formatter takes `iso`; the context override is plain state.
- No `set-state-in-effect`. AIPM tokens only. `Lang`=`"en-US"|"en-GB"|"de"`; DE assertions call `loadI18n("de")` in `beforeAll`.
- TZ-1 is merged on main: `timezone.ts` exports `formatInZone(iso,tz,opts,locale)`, `resolveTimezone(override,projectTz)`, `tzZones()`, `browserTimeZone()`, `isValidTimeZone`. `task-manager` already computes `const effectiveTz = resolveTimezone(settings.timezone, project?.operatingTimezone)` (line ~313).

## File Structure
- `tz-display.ts` (NEW) — `formatDisplayTimestamp`.
- `display-timezone-context.tsx` (NEW) — context + `useDisplayTimezone`.
- `display-tz-switcher.tsx` (NEW) — top-bar switcher.
- `task-manager.tsx` — provider (both return branches) + switcher (both headers).
- `activity-log-panel.tsx`, `history-panel.tsx`, `trends-panel.tsx` — route timestamps.
- `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md`.

---

## Task 1: `tz-display.ts` — shared formatter

**Files:** Create `src/app/tz-display.ts`, Test `src/app/tz-display.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it } from "vitest";
import { formatDisplayTimestamp } from "./tz-display";

describe("formatDisplayTimestamp", () => {
  it("renders an instant in the given zone with a zone label", () => {
    const out = formatDisplayTimestamp("2026-06-20T22:00:00Z", "Asia/Kolkata", "en-GB");
    expect(out).toContain("03:30");          // 22:00Z + 5:30
    expect(out).toMatch(/GMT\+5:30|IST/);    // zone label present
  });
  it("renders UTC", () => {
    expect(formatDisplayTimestamp("2026-06-20T22:00:00Z", "UTC", "en-GB")).toContain("22:00");
  });
  it("returns the raw input on an unparseable date", () => {
    expect(formatDisplayTimestamp("not-a-date", "UTC", "en-GB")).toBe("not-a-date");
  });
});
```
Run `npm run test:run -- tz-display` → FAIL.

- [ ] **Step 2: Implement `src/app/tz-display.ts`**
```ts
// src/app/tz-display.ts — localized instant + zone label, in a display zone.
// Reuses TZ-1's formatInZone (Intl-based, no dep). Used by the timestamp panels.
import { formatInZone } from "./timezone";
import { localeFor } from "./date-format";
import type { Lang } from "./i18n";

const TS_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", timeZoneName: "short",
};

/** Format an ISO instant in `tz` for display, with the zone label. Bad iso/zone
 *  falls back via formatInZone (returns the raw iso on an unparseable date). */
export function formatDisplayTimestamp(iso: string, tz: string, lang: Lang): string {
  return formatInZone(iso, tz, TS_OPTS, localeFor(lang));
}
```
(Confirm `localeFor` is exported from `date-format.ts` — it is.)
Run `npm run test:run -- tz-display` → PASS. (If the zone-label regex is too strict for the runner's ICU, relax to `expect(out.length).toBeGreaterThan("03:30".length)` after confirming the label renders — report the actual output.)

- [ ] **Step 3: Verify + commit**
`npx tsc --noEmit` → 0; `npm run lint` → clean.
```bash
git add src/app/tz-display.ts src/app/tz-display.test.ts
git commit -m "feat(tz-2): formatDisplayTimestamp (instant + zone label in a display zone)"
```

---

## Task 2: `display-timezone-context.tsx`

**Files:** Create `src/app/display-timezone-context.tsx`, Test `src/app/display-timezone-context.test.tsx`

- [ ] **Step 1: Failing test**
```tsx
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DisplayTimezoneProvider, useDisplayTimezone } from "./display-timezone-context";

const wrap = (effectiveTz: string) => ({ children }: { children: React.ReactNode }) =>
  <DisplayTimezoneProvider effectiveTz={effectiveTz}>{children}</DisplayTimezoneProvider>;

describe("display-timezone-context", () => {
  it("defaults displayTz to effectiveTz, not overridden", () => {
    const { result } = renderHook(() => useDisplayTimezone(), { wrapper: wrap("Europe/Berlin") });
    expect(result.current.displayTz).toBe("Europe/Berlin");
    expect(result.current.isOverridden).toBe(false);
  });
  it("setDisplayOverride switches displayTz + marks overridden; reset clears", () => {
    const { result } = renderHook(() => useDisplayTimezone(), { wrapper: wrap("Europe/Berlin") });
    act(() => result.current.setDisplayOverride("UTC"));
    expect(result.current.displayTz).toBe("UTC");
    expect(result.current.isOverridden).toBe(true);
    act(() => result.current.resetDisplayTz());
    expect(result.current.displayTz).toBe("Europe/Berlin");
    expect(result.current.isOverridden).toBe(false);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `src/app/display-timezone-context.tsx`**
```tsx
"use client";

// Ephemeral session display timezone: an in-memory override over TZ-1's effective
// zone. NOT persisted — resets on reload. Provided above all views (+ popouts) by
// task-manager; the top-bar switcher sets the override; timestamp panels read it.
import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface DisplayTimezoneValue {
  displayTz: string;
  effectiveTz: string;
  isOverridden: boolean;
  setDisplayOverride: (tz: string | undefined) => void;
  resetDisplayTz: () => void;
}

const Ctx = createContext<DisplayTimezoneValue | null>(null);

export function DisplayTimezoneProvider({ effectiveTz, children }: { effectiveTz: string; children: React.ReactNode }) {
  const [override, setOverride] = useState<string | undefined>(undefined);
  const setDisplayOverride = useCallback((tz: string | undefined) => setOverride(tz), []);
  const resetDisplayTz = useCallback(() => setOverride(undefined), []);
  const value = useMemo<DisplayTimezoneValue>(() => ({
    displayTz: override ?? effectiveTz,
    effectiveTz,
    isOverridden: override !== undefined,
    setDisplayOverride,
    resetDisplayTz,
  }), [override, effectiveTz, setDisplayOverride, resetDisplayTz]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDisplayTimezone(): DisplayTimezoneValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDisplayTimezone must be used within DisplayTimezoneProvider");
  return v;
}
```
Run → PASS.

- [ ] **Step 3: Verify + commit**
`npx tsc --noEmit` → 0; `npm run lint` → clean.
```bash
git add src/app/display-timezone-context.tsx src/app/display-timezone-context.test.tsx
git commit -m "feat(tz-2): ephemeral display-timezone context"
```

---

## Task 3: `display-tz-switcher.tsx` + i18n

**Files:** Create `src/app/display-tz-switcher.tsx`, Test `src/app/display-tz-switcher.test.tsx`; Modify `i18n.ts`/`i18n.de.ts`

- [ ] **Step 1: i18n keys**
EN (`i18n.ts`, near other `tz*` keys): `displayTzLabel: "Display timezone"`, `displayTzDefault: "Default"`.
DE (`i18n.de.ts`, node UTF-8 CRLF write, real umlauts): `displayTzLabel: "Anzeige-Zeitzone"`, `displayTzDefault: "Standard"`.

- [ ] **Step 2: Failing test `display-tz-switcher.test.tsx`**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DisplayTzSwitcher } from "./display-tz-switcher";
import { t } from "./i18n";

function renderWith(over: { displayTz?: string; isOverridden?: boolean } = {}) {
  const setDisplayOverride = vi.fn();
  const ctx = {
    displayTz: over.displayTz ?? "Europe/Berlin", effectiveTz: "Europe/Berlin",
    isOverridden: over.isOverridden ?? false, setDisplayOverride, resetDisplayTz: () => setDisplayOverride(undefined),
  };
  render(<DisplayTzSwitcher lang="en-US" ctx={ctx} additionalTimezones={["America/New_York"]} />);
  return { setDisplayOverride };
}

describe("DisplayTzSwitcher", () => {
  it("is labeled and lists Default + UTC + additional zones", () => {
    renderWith();
    const sel = screen.getByLabelText(t("en-US", "displayTzLabel")) as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("");            // Default
    expect(opts).toContain("UTC");
    expect(opts).toContain("America/New_York");
  });
  it("selecting a zone sets the override; selecting Default clears it", () => {
    const { setDisplayOverride } = renderWith();
    const sel = screen.getByLabelText(t("en-US", "displayTzLabel"));
    fireEvent.change(sel, { target: { value: "UTC" } });
    expect(setDisplayOverride).toHaveBeenCalledWith("UTC");
    fireEvent.change(sel, { target: { value: "" } });
    expect(setDisplayOverride).toHaveBeenCalledWith(undefined);
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement `src/app/display-tz-switcher.tsx`**
```tsx
"use client";

// Top-bar switcher for the session display timezone (TZ-2). Controlled by the
// DisplayTimezoneContext value (passed as `ctx` so it is trivially testable).
import { type Lang, t } from "./i18n";

interface DisplayTzCtx {
  displayTz: string;
  effectiveTz: string;
  isOverridden: boolean;
  setDisplayOverride: (tz: string | undefined) => void;
}

interface DisplayTzSwitcherProps {
  lang: Lang;
  ctx: DisplayTzCtx;
  additionalTimezones: readonly string[];
}

export function DisplayTzSwitcher({ lang, ctx, additionalTimezones }: DisplayTzSwitcherProps) {
  // Default + UTC + the per-device additional zones (deduped, minus UTC/effective dups).
  const extras = additionalTimezones.filter((z) => z !== "UTC" && z !== ctx.effectiveTz);
  return (
    <select
      aria-label={t(lang, "displayTzLabel")}
      value={ctx.isOverridden ? ctx.displayTz : ""}
      onChange={(e) => ctx.setDisplayOverride(e.target.value || undefined)}
      className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
    >
      <option value="">{`${t(lang, "displayTzDefault")} (${ctx.effectiveTz})`}</option>
      <option value="UTC">UTC</option>
      {extras.map((z) => (
        <option key={z} value={z}>{z}</option>
      ))}
    </select>
  );
}
```
Run → PASS.

- [ ] **Step 4: Verify + commit**
`npx tsc --noEmit` → 0 (EN/DE parity); `npm run lint` → clean.
```bash
git add src/app/display-tz-switcher.tsx src/app/display-tz-switcher.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(tz-2): display-timezone top-bar switcher + i18n"
```

---

## Task 4: Wire provider + switcher into task-manager

**Files:** Modify `src/app/task-manager.tsx`

Verify by full suite + tsc + lint (integration; no new unit test, don't break existing).

- [ ] **Step 1: Imports + switcher element**
- Import `DisplayTimezoneProvider, useDisplayTimezone` and `DisplayTzSwitcher`.
- Build the switcher element near `askClaudeEl` (~line 2002). It needs the live context — but the context is provided OUTSIDE `TaskManagerInner`'s return. Simplest: render `<DisplayTzSwitcher>` as a SMALL inline wrapper component that calls `useDisplayTimezone()` itself, so the header just drops `<DisplayTzSwitcherConnected lang={lang} additionalTimezones={settings.additionalTimezones ?? []} />`. Add this connected wrapper at the bottom of the file (module scope) OR inline:
```tsx
function DisplayTzSwitcherConnected({ lang, additionalTimezones }: { lang: Lang; additionalTimezones: readonly string[] }) {
  const ctx = useDisplayTimezone();
  return <DisplayTzSwitcher lang={lang} ctx={ctx} additionalTimezones={additionalTimezones} />;
}
```
  (Place it as a module-level component — the `static-components` rule wants sub-components at module level.)

- [ ] **Step 2: Render the switcher in BOTH header sites**
- Modern `topBarMenus` (~line 2010, in the `<ActionMenus>` cluster) — add `<DisplayTzSwitcherConnected lang={lang} additionalTimezones={settings.additionalTimezones ?? []} />`.
- Classic `AppHeader` cluster — find where `askClaudeEl`/ActionMenus are wired into the classic header and add the same element (dual-header rule). The popout `legacyTree` has NO header → no switcher there (correct; popouts still convert via the provider/effective default).

- [ ] **Step 3: Wrap BOTH return branches with the provider**
`TaskManagerInner` returns in (at least) two places — the popout branch (~line 2298) and the main branch. `effectiveTz` (line ~313) is in scope in both. Wrap the returned tree in each with `<DisplayTimezoneProvider effectiveTz={effectiveTz}>...</DisplayTimezoneProvider>`:
- Popout branch (~2299): wrap the `<ActivityLogProvider>…</ActivityLogProvider>` content (or place the provider just inside it) so popout timestamps convert.
- Main branch (the modern/empty-state return): wrap the returned shell similarly.
Place `DisplayTimezoneProvider` INSIDE the existing provider stack (it only needs `effectiveTz`, already computed). Keep it high enough that ActivityLog/History/Trends panels are descendants.

- [ ] **Step 4: Verify**
`npx tsc --noEmit` → 0; `npm run lint` → clean (no unused; `static-components`: the connected wrapper is module-level); `npm run test:run` → green.

- [ ] **Step 5: Commit**
```bash
git add src/app/task-manager.tsx
git commit -m "feat(tz-2): mount display-tz provider + top-bar switcher (both shells)"
```

---

## Task 5: Route the three timestamp panels

**Files:** Modify `src/app/activity-log-panel.tsx`, `src/app/history-panel.tsx`, `src/app/trends-panel.tsx`; extend their tests.

- [ ] **Step 1: activity-log-panel.tsx**
- Import `useDisplayTimezone` + `formatDisplayTimestamp`. In the component, `const { displayTz } = useDisplayTimezone();`.
- Replace the local `formatTimestamp(iso, lang)` (the `toLocaleString` one) with `formatDisplayTimestamp(iso, displayTz, lang)` at its call site(s). Remove the now-unused local `formatTimestamp` + its `localeFor` import IF nothing else uses them (grep; keep otherwise).

- [ ] **Step 2: history-panel.tsx**
- `const { displayTz } = useDisplayTimezone();` in the component.
- Replace each `new Date(v.capturedAt).toLocaleString()` (the display label at line ~45 `labelOf`, ~199 aria-label, ~205, ~227) with `formatDisplayTimestamp(v.capturedAt, displayTz, lang)`. Keep the `localeCompare` SORT at line ~88 as-is (that's ordering on the raw ISO — correct, do NOT convert).

- [ ] **Step 3: trends-panel.tsx**
- `const { displayTz } = useDisplayTimezone();`.
- Replace the raw `s.capturedAt.slice(0, 16).replace("T", " ")` display (~line 230) with `formatDisplayTimestamp(s.capturedAt, displayTz, lang)`. The aria-label at ~227 (`snapshotSelectRow`, capturedAt.slice) may stay as a stable raw key, or also convert — convert it for consistency if it reads as a user-facing time; otherwise leave. Report choice.

- [ ] **Step 4: Tests**
Extend each panel's test to assert a converted timestamp. Since the panels now call `useDisplayTimezone()`, wrap renders in `<DisplayTimezoneProvider effectiveTz="UTC">` (import it) — or a non-UTC zone to prove conversion. Example for activity-log:
```tsx
// wrap the existing render in: <DisplayTimezoneProvider effectiveTz="Asia/Kolkata">…</DisplayTimezoneProvider>
// then assert a known entry's timestamp renders in IST (contains the +5:30 shifted time).
```
If a panel test renders without the provider and now throws (hook outside provider), wrap it. Run each panel's test → PASS.

- [ ] **Step 5: Verify**
`npx tsc --noEmit` → 0; `npm run lint` → clean; `npm run test:run` (FULL) → green.

- [ ] **Step 6: Commit**
```bash
git add src/app/activity-log-panel.tsx src/app/history-panel.tsx src/app/trends-panel.tsx src/app/*.test.tsx
git commit -m "feat(tz-2): render activity/history/trends timestamps in the display timezone"
```

---

## Task 6: Release v0.114.0 + axe

**Files:** Modify `src/app/version.ts`, `i18n.ts`, `i18n.de.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version + highlight key** — `version.ts`: `APP_VERSION = "0.114.0"`; update build-date comment; `APP_MILESTONE` = an unused sci-fi author codename (e.g. `"Liu"` is taken (0.85) — use `"Wilson"` (Robert Charles Wilson) or `"Bacigalupi"`; pick one not already in CHANGELOG). Append `"versionHighlightTimezoneDisplay"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Highlight i18n** — EN: `versionHighlightTimezoneDisplay: "Timezone display: timestamps (activity log, version history, trends) now render in a display timezone you pick from the top bar - defaulting to your configured zone - with the zone shown. The choice is per session."`. DE (node UTF-8 write, real umlauts): `"Zeitzonen-Anzeige: Zeitstempel (Aktivitätsprotokoll, Versionsverlauf, Trends) erscheinen jetzt in einer oben wählbaren Anzeige-Zeitzone - standardmäßig Ihre konfigurierte Zone - mit Zonenangabe. Die Auswahl gilt pro Sitzung."`. Verify parity + umlauts.

- [ ] **Step 3: CHANGELOG** — prepend above the top entry:
```markdown
## [0.114.0] - <date> "<codename>"

### Added
- Timezone display: timestamps in the activity log, version history, and trends now render in a display timezone you choose from a top-bar switcher (Default / UTC / your additional zones), with the zone shown next to each time. The choice applies for the session and resets on reload; the underlying data is unchanged.
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → 0; `npm run lint` → clean; `npm run test:run` → green; `npm run build` → succeeds; `npx playwright test e2e/a11y.spec.ts --project=chromium` → 12/12 (the new top-bar switcher is labeled — must not introduce an axe violation in any scanned view).

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(tz-2): release v0.114.0 (timezone display + switcher)"
```

---

## Final steps (after all tasks)
1. Final whole-branch review (focus: provider wraps both shells incl. popouts; switcher labeled in both headers; only instant-timestamp displays converted — sort keys + date-only + storage stamps untouched; ephemeral override resets on reload; EN/DE parity; a11y).
2. Use superpowers:finishing-a-development-branch.
3. Branch `timezones-tz2` is off clean main — MR diffs to just TZ-2.

## Self-review notes (resolved)
- **Spec coverage:** formatter (T1), context (T2), switcher+i18n (T3), wiring both shells (T4), 3-panel routing (T5), release+axe (T6). Shared-ephemeral model + zone-label + scope (activity/history/trends only) all covered.
- **Type consistency:** `formatDisplayTimestamp(iso,tz,lang)`, `useDisplayTimezone()` → `{displayTz,effectiveTz,isOverridden,setDisplayOverride,resetDisplayTz}`, `DisplayTzSwitcher` `ctx` prop shape — consistent T1→T5.
- **Sort untouched:** history-panel `capturedAt.localeCompare` ordering stays on raw ISO (T5 Step 2) — converting it would be a bug.
- **Popouts:** provider wraps them (convert via effective default), no switcher control (no header) — T4 Step 2/3.
