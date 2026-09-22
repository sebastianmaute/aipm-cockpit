# Forecast switch, RAG badge and the Budget report forecast row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two forecast readings stop competing side by side: the reader picks one with a switch (a device setting), sees its health as a RAG badge, and reads it beside the chart it explains, in one merged "Forecast" section of the Budget report.

**Architecture:** A new device setting `budgetForecastView` ("pace" | "efficiency"), validated on load exactly like `budgetChartView`. `ForecastCards` renders a `SegmentedControl` above exactly one card and puts a `RagBadge` (from `paceVacHealth` over that card's own VAC) in the card title. `ForecastSection` reads/writes the setting and owns a new row: card column (30% from `xl`) beside a `chart` slot the report fills, with a `belowRow` slot under it. `BurndownChartPanel` gains `detachChangeTable`, and a new exported `BurndownChangeTableBlock` renders the same table from the same rule, so the report can put the recorded-change table full width below the row. The dashboard passes neither and is unchanged.

**Tech Stack:** TypeScript, React 19 (Next 16), Tailwind v4 tokens, vitest + @testing-library/react, Playwright (axe + visual), i18n EN/DE dictionaries.

**Spec:** `docs/superpowers/specs/2026-09-17-forecast-switch-and-budget-report-row-design.md`

## Global Constraints

- Read `AGENTS.md` before the first edit. It is always loaded for you; its "Hard constraints" section gates merges.
- `src/app/**` is CRLF in the working tree (`git ls-files --eol` shows `i/lf w/crlf`). Prefer the Edit tool (it preserves line endings). Where a step gives a WHOLE file, write it with the Write tool and then run the CRLF normaliser given in that step, and confirm with `git ls-files --eol <file>` that it shows `w/crlf`. Never `sed -i` a source file.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical — `npx tsc --noEmit` enforces it. DE must use real umlauts. **Edit `i18n.de.ts` only via a small Node script** that writes UTF-8 and anchors on `\r\n`, saved to a file in your scratchpad directory and run with `node <path>` (never inline `node -e`, whose quoting eats backslashes). Never with the Edit tool — it corrupts umlauts and curls quotes even in umlaut-free strings.
- `Lang` is `"en-US" | "en-GB" | "de"`. Use `"en-US"` in tests; a DE assertion must `await loadI18n("de")` first (the cards test already does, in `beforeAll`).
- Palette: only sanctioned tokens. This plan adds no colours; `RagBadge` brings its own health tokens.
- Accessibility: never hand-roll a control a primitive covers — the switch is `SegmentedControl` (radiogroup, roving tabindex, non-colour check marker). Its group needs an accessible name ("Forecast reading"); each radio's name must contain its visible text (WCAG 2.5.3). The badge is `RagBadge` with NO `title`, so its accessible name is the health word.
- Layout classes are the spec's, exactly: row `flex flex-col gap-3 xl:flex-row`, card column `xl:w-[30%]`, chart column `min-w-0 flex-1`; the switch wrapper is `print:hidden`.
- Never read a gate's exit code through a pipe. Run `cmd > /tmp/fsw-x.log 2>&1; echo "EXIT=$?"` then grep the file. Use the `fsw-` prefix on every log name: `/tmp` is shared with other sessions.
- Never run two vitest processes at once. Each task runs ONE `npx vitest run <files>` over only its own test files. **No `npm run test:run`, `test:shuffle` or `test:coverage` anywhere in this plan** — the user runs the whole suite at the end, on their say.
- Run `npx tsc --noEmit` after editing ANY test file (vitest never typechecks). Pass = exit 0 with ZERO errors in total, not "zero in src/".
- Lint with `npx eslint --max-warnings=0 <paths>`; every warning is fatal. `react-hooks/set-state-in-effect` is banned. No `Date.now()`/`new Date()`/`Math.random()` in a render body.
- Commit messages: conventional prefix, no `#` followed by digits anywhere, and end with the session trailer line.
- Stage by explicit path: `git add <paths>`. Never `git add -A`, never `git add .`, never `git commit --amend`, never `git stash`, never `git checkout --`/`git restore`. Never open, read or stage `not-in-use.env.local.bak`.
- Size ratchet: `LIMIT` in `scripts/check-file-sizes.mjs` is 1600 and counts `split("\n").length` (one more than `wc -l`). Every file this plan touches is far below it (largest non-exempt touched file: `use-settings.test.ts` at about 790; `i18n*.ts` are exempt), so no split is needed — Task 5 runs `size:check` once to prove it.
- Mutation checks: every task has one. Revert each mutant with the Edit tool (inverse of the mutation), then prove `git diff --stat` shows only the task's intended files before committing. Never leave a mutant in the tree.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/settings-types.ts` (modify) | The `budgetForecastView?: "pace" \| "efficiency"` field and its `"pace"` default. |
| `src/app/use-settings.ts` (modify) | Load-time validation of `budgetForecastView`, beside `budgetChartView`. |
| `src/app/use-settings.test.ts` (modify) | Default, junk rejection, persistence and round-trip tests. |
| `src/app/budget-forecast-cards.tsx` (modify) | `ForecastView` type; the switch above ONE card; `VacBadge` in each card title. |
| `src/app/budget-forecast-cards.test.tsx` (rewrite) | Every existing test migrated to one-card-at-a-time, plus switch and badge tests. |
| `src/app/budget-forecast-section.tsx` (modify, twice) | Task 2: reads/writes the setting. Task 4: the row, the `chart` and `belowRow` slots. |
| `src/app/budget-forecast-section.test.tsx` (rewrite, twice) | Setting wiring (Task 2); row composition (Task 4). |
| `src/app/burndown-chart-panel.tsx` (modify) | `detachChangeTable` prop, the shared `changeTableFor` rule, exported `BurndownChangeTableBlock`. |
| `src/app/burndown-chart-panel.test.tsx` (modify) | Detached panel, default placement unchanged, the block. |
| `src/app/budget-report-panel.tsx` (modify) | Drops the Burn-down `Section`; fills the forecast row's `chart` and `belowRow`. |
| `src/app/budget-report-panel.test.tsx` (modify) | One Forecast section, row order, table below the row, caption under the chart. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` (modify) | Add `forecastViewLabel` (Task 2); remove the now-dead `budgetBurndownTitle` (Task 4). |
| `docs/AGENTS/dashboard.md` (modify) | One bullet recording the row, the switch placement rule and the detached table. |
| `e2e/visual.spec.ts` (modify, comment only) | The Reports budget comment no longer says the panel places the table beside the chart. |
| `e2e/visual.spec.ts-snapshots/reports-budget-history-visual-win32.png`, `…/reports-budget-changes-visual-win32.png` (regenerate) | Refreshed deliberately after eyeballing. |

---

## Task 1: The `budgetForecastView` device setting

**Files:**
- Modify: `src/app/settings-types.ts`, `src/app/use-settings.ts`
- Test: `src/app/use-settings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Settings.budgetForecastView?: "pace" | "efficiency"`, with `defaultSettings.budgetForecastView === "pace"`; on load any value other than the exact string `"efficiency"` becomes `"pace"`. Tasks 2 and 4 read it as `settings.budgetForecastView ?? "pace"` and write it with `setSettings((s) => ({ ...s, budgetForecastView: v }))`.

- [ ] **Step 1: Write the failing tests**

In `src/app/use-settings.test.ts`, directly after the test `"budget chart settings keep strictly valid persisted values"` (inside the same `describe`), add with the Edit tool:

```ts
    it("budgetForecastView defaults to pace, in the defaults and when absent from the persisted blob", async () => {
      expect(defaultSettings.budgetForecastView).toBe("pace");
      const legacy: Record<string, unknown> = { ...defaultSettings };
      delete legacy.budgetForecastView;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.budgetForecastView).toBe("pace");
    });

    it("budgetForecastView coerces anything but the exact string 'efficiency' to pace", async () => {
      for (const junk of ["garbage", 7, null, "Efficiency", ["efficiency"]]) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetForecastView: junk }));
        const { result, unmount } = renderHook(() => useSettings());
        await act(async () => {});
        expect(result.current.settings.budgetForecastView, String(junk)).toBe("pace");
        unmount();
      }
    });

    it("budgetForecastView keeps a persisted 'efficiency' through writeSettings -> load", async () => {
      writeSettings({ ...defaultSettings, budgetForecastView: "efficiency" });
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.budgetForecastView).toBe("efficiency");
    });

    it("budgetForecastView persists when set", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      act(() => {
        result.current.setSettings((s) => ({ ...s, budgetForecastView: "efficiency" }));
      });
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { budgetForecastView?: string };
        expect(stored.budgetForecastView).toBe("efficiency");
      });
    });
```

`act`, `renderHook`, `waitFor`, `defaultSettings`, `SETTINGS_KEY`, `useSettings` and `writeSettings` are all already imported by this file.

- [ ] **Step 2: Run them and watch the right ones fail**

```bash
npx vitest run src/app/use-settings.test.ts > /tmp/fsw-t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✗|×|FAIL" /tmp/fsw-t1.log | head -20
```
Expected: EXIT=1. The "defaults to pace" test fails (`undefined`, the field exists nowhere yet) and the junk test fails on `"garbage"` (the loader's `...parsed` spread passes it straight through). The round-trip and persistence tests may already PASS — the spread carries a valid value today; they pin that the new validation does not break it. `npx tsc --noEmit` also fails now (the field is not on `Settings`); that is expected until Step 3.

- [ ] **Step 3: Add the field, the default and the load validation**

In `src/app/settings-types.ts`, with the Edit tool, replace

```ts
  /** Per-device burn-down chart unit. Default "eur". */
  budgetChartUnit?: "eur" | "hours";
```

with

```ts
  /** Per-device burn-down chart unit. Default "eur". */
  budgetChartUnit?: "eur" | "hours";
  /** Per-device forecast reading: which forecast card the Budget report shows
   *  ("At current pace" or "At current efficiency"). Default "pace". Printing
   *  shows the chosen card (forecast-switch spec B, Decision 2). */
  budgetForecastView?: "pace" | "efficiency";
```

and replace

```ts
  budgetChartUnit: "eur",
```

with

```ts
  budgetChartUnit: "eur",
  budgetForecastView: "pace",
```

In `src/app/use-settings.ts`, with the Edit tool, replace

```ts
            budgetChartUnit:
              (parsed as Record<string, unknown>).budgetChartUnit === "hours" ? "hours" : "eur",
```

with

```ts
            budgetChartUnit:
              (parsed as Record<string, unknown>).budgetChartUnit === "hours" ? "hours" : "eur",
            budgetForecastView:
              (parsed as Record<string, unknown>).budgetForecastView === "efficiency" ? "efficiency" : "pace",
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/use-settings.test.ts > /tmp/fsw-t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t1.log
npx tsc --noEmit > /tmp/fsw-tsc1.log 2>&1; echo "TSC_EXIT=$?"; tail -5 /tmp/fsw-tsc1.log
npx eslint --max-warnings=0 src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts; echo "LINT_EXIT=$?"
```
Expected: EXIT=0 with `Test Files  1 passed (1)`; TSC_EXIT=0 with no error lines; LINT_EXIT=0.

- [ ] **Step 5: Mutation-check the validation**

With the Edit tool change `=== "efficiency" ? "efficiency" : "pace"` in `use-settings.ts` to `=== "pace" ? "pace" : "efficiency"`. Re-run the vitest command from Step 4: expected EXIT=1 (the default and junk tests fail). Revert with the inverse Edit, re-run: EXIT=0. Then:

```bash
git diff --stat
```
Expected: exactly `src/app/settings-types.ts`, `src/app/use-settings.ts`, `src/app/use-settings.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts
git commit -F - <<'EOF'
feat(settings): add the budgetForecastView device setting

Which forecast card the Budget report shows, "pace" or "efficiency",
defaulting to pace. Validated on load beside budgetChartView: anything but
the exact string "efficiency" reads as pace, so junk in a stored blob can
never select a card that does not exist.
EOF
```

---

## Task 2: One card at a time, the switch and the RAG badge

**Files:**
- Modify: `src/app/budget-forecast-cards.tsx`, `src/app/budget-forecast-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Rewrite: `src/app/budget-forecast-cards.test.tsx`, `src/app/budget-forecast-section.test.tsx`
- Modify (one test migrated): `src/app/budget-report-panel.test.tsx`

**Interfaces:**
- Consumes: `Settings.budgetForecastView` (Task 1); `SegmentedControl` (`segmented-control.tsx`: `value`, `options: {value,label}[]`, `onChange`, `ariaLabel`); `RagBadge` (`rag-badge.tsx`: `value`, `lang`, optional `title` — omitted here); `paceVacHealth(vac, bac): "R" | "A" | "G" | null` (`budget-forecast.ts`).
- Produces:
  ```ts
  export type ForecastView = "pace" | "efficiency";
  export function ForecastCards(props: {
    lang: Lang; forecast: BudgetForecast;
    view: ForecastView; onViewChange: (view: ForecastView) => void;
    hours?: BudgetForecast | null; mix?: RateMix | null; history?: BudgetHistorySummary | null;
  }): ReactNode;
  // i18n key: forecastViewLabel — EN "Forecast reading", DE "Prognosegrundlage".
  ```
  `ForecastSection`'s props are unchanged in this task; it now reads and writes the setting itself.

**Why the option labels reuse `forecastPaceTitle` / `forecastEfficiencyTitle` (no new option keys):** the spec's two option labels are word for word the card titles ("At current pace", "At current efficiency" / DE "Beim aktuellen Tempo", "Bei aktueller Effizienz"). Reusing the keys means the switch can never disagree with the card it selects, and — with no `optionAriaLabel` — each radio's accessible name IS its visible text, so WCAG 2.5.3 label-in-name holds by construction. The radio and the card region share a name but differ in role, which is not a duplicate-name defect. Only the group label is new.

**Why the switch sits above the card, not inside it (a ruling on spec Decision 1, "in the card's header"):** `PaceCard` and `EfficiencyCard` are different components. A switch rendered inside either would unmount on every change, and `SegmentedControl`'s arrow-key handler focuses a radio of the OLD tree — keyboard focus would drop to `<body>` on every arrow press. The switch therefore heads the card COLUMN, rendered by `ForecastCards` itself, which keeps it mounted. Step 1 pins this with a focus test.

- [ ] **Step 1: Write the failing cards test (whole file)**

Replace `src/app/budget-forecast-cards.test.tsx` entirely with the content below (Write tool), then normalise it to CRLF:

```bash
node -e "const f=process.argv[1];const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" src/app/budget-forecast-cards.test.tsx
git ls-files --eol src/app/budget-forecast-cards.test.tsx   # expect i/lf w/crlf
```

Every pre-existing test is kept; the migration of each is noted in its comment where the one-card rule changed it.

```tsx
import { useState, type ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ForecastCards, type ForecastView } from "./budget-forecast-cards";
import { ForecastFactsRow } from "./budget-forecast-facts";
import { formatCurrency } from "./resource-cost";
import { formatHours, formatSignedPercent } from "./forecast-format";
import { loadI18n, localeFor, t } from "./i18n";
import { formatDayMonthYear } from "./forecast-format";
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateMixExplanation } from "./budget-rate-mix-text";
import type { BudgetForecast, PaceForecast, PaceUnavailable, EfficiencyUnavailable } from "./budget-forecast";
import type { BudgetHistorySummary } from "./budget-history";

const locale = localeFor("en-US");
const money = (n: number) => formatCurrency(n, "EUR", locale);
const PACE = t("en-US", "forecastPaceTitle");
const EFF = t("en-US", "forecastEfficiencyTitle");
const VIEWS: readonly ForecastView[] = ["pace", "efficiency"];

beforeAll(async () => {
  await loadI18n("de");
});

// §5.6 worked example, mirrored exactly (Contract €240,000; today 2026-09-14; plan end 2026-12-18).
// Pace VAC −21,150 is 8.8% of BAC (Amber); efficiency VAC −30,968 is 12.9% (Red) —
// DIFFERENT bands on purpose, so a badge reading the other card's VAC is caught.
const AVAILABLE: BudgetForecast = {
  facts: { bac: 240000, ac: 168000, remaining: 72000, ev: 148800, percentComplete: 62 },
  pace: {
    burnRatePerDay: 1350, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
    spreadPeriodHoursUsed: false, workingDaysLeft: 69,
    etc: 93150, eac: 261150, vac: -21150, runOutDate: "2026-11-27", daysBeforePlannedEnd: 21,
  },
  efficiency: {
    pv: 176000, cpi: 148800 / 168000, spi: 148800 / 176000,
    etc: 102968, eac: 270968, vac: -30968,
  },
  gap: { eacDifference: 9818, percentOfBac: 9818 / 240000, severity: "info", extraWorkingDays: 8 },
  hasFixedPrice: false,
};

function withPaceUnavailable(pace: PaceUnavailable): BudgetForecast {
  return { ...AVAILABLE, pace, gap: null };
}
function withEfficiencyUnavailable(efficiency: EfficiencyUnavailable): BudgetForecast {
  return { ...AVAILABLE, efficiency, gap: null };
}

type CardsProps = Omit<ComponentProps<typeof ForecastCards>, "view" | "onViewChange"> & { view?: ForecastView };
const noop = () => undefined;
/** ForecastCards at a FIXED view — for tests about a card's content. The
 *  switch's own behaviour is pinned through `SwitchHarness` below. */
function Cards({ view = "pace", ...rest }: CardsProps) {
  return <ForecastCards view={view} onViewChange={noop} {...rest} />;
}
/** ForecastCards with real state behind the switch, as `ForecastSection` wires it. */
function SwitchHarness(props: Omit<CardsProps, "view">) {
  const [view, setView] = useState<ForecastView>("pace");
  return <ForecastCards {...props} view={view} onViewChange={setView} />;
}
const paceRegion = () => screen.queryByRole("region", { name: PACE });
const effRegion = () => screen.queryByRole("region", { name: EFF });

describe("ForecastCards — the reading switch (spec B)", () => {
  it("renders both options in a group named Forecast reading, the chosen one checked", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const group = screen.getByRole("radiogroup", { name: "Forecast reading" });
    expect(within(group).getByRole("radio", { name: PACE })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "false");
  });

  it("label-in-name: each option's accessible name contains its visible text", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    for (const radio of screen.getAllByRole("radio")) {
      const visible = (radio.textContent ?? "").trim();
      expect(visible.length).toBeGreaterThan(0);
      expect(radio).toHaveAccessibleName(expect.stringContaining(visible));
    }
  });

  it("renders only the chosen card's body", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(paceRegion()).not.toBeNull();
    expect(effRegion()).toBeNull();
    expect(screen.getByText(money(261150))).toBeInTheDocument();
    expect(screen.queryByText(money(270968))).toBeNull();
    unmount();

    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(effRegion()).not.toBeNull();
    expect(paceRegion()).toBeNull();
    expect(screen.getByText(money(270968))).toBeInTheDocument();
    expect(screen.queryByText(money(261150))).toBeNull();
  });

  it("reports a click on the other option through onViewChange", () => {
    const onViewChange = vi.fn();
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} view="pace" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(onViewChange).toHaveBeenCalledWith("efficiency");
  });

  it("keeps keyboard focus on the switch when an arrow key changes the card", () => {
    // Pins the ruling that the switch sits ABOVE the card: inside the swapped
    // card it would unmount and focus would fall to <body>.
    render(<SwitchHarness lang="en-US" forecast={AVAILABLE} />);
    const pace = screen.getByRole("radio", { name: PACE });
    act(() => pace.focus());
    fireEvent.keyDown(pace, { key: "ArrowRight" });
    const eff = screen.getByRole("radio", { name: EFF });
    expect(eff).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(eff);
    expect(effRegion()).not.toBeNull();
  });

  it("an unavailable forecast still opens: choosing efficiency with nothing earned shows the card's reason", () => {
    render(<SwitchHarness lang="en-US" forecast={withEfficiencyUnavailable({ unavailable: "no-earned-value" })} />);
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(screen.getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "true");
    expect(within(effRegion()!).getByText("Nothing earned yet")).toBeInTheDocument();
  });

  it("does not print the switch", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const group = screen.getByRole("radiogroup", { name: "Forecast reading" });
    expect(group.parentElement).toHaveClass("print:hidden");
  });
});

describe("ForecastCards — RAG badge on the chosen card (spec B)", () => {
  const BADGE = /^(Red|Amber|Green|—)$/;

  it("shows Amber on the pace card for the worked example (VAC 8.8% of BAC)", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const badge = within(paceRegion()!).getByRole("img", { name: "Amber" });
    // Never colour-only: the letter is in the glyph and the word is the name.
    expect(badge).toHaveTextContent("A");
  });

  it("shows Red on the efficiency card, from ITS OWN VAC (12.9% of BAC)", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(within(effRegion()!).getByRole("img", { name: "Red" })).toHaveTextContent("R");
  });

  it("shows Green when the chosen card's VAC is not negative", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), vac: 1000 };
    const { unmount } = render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace }} />);
    expect(within(paceRegion()!).getByRole("img", { name: "Green" })).toHaveTextContent("G");
    unmount();
    const efficiency = { ...AVAILABLE.efficiency, vac: 0 } as BudgetForecast["efficiency"];
    render(<Cards lang="en-US" view="efficiency" forecast={{ ...AVAILABLE, efficiency }} />);
    expect(within(effRegion()!).getByRole("img", { name: "Green" })).toBeInTheDocument();
  });

  it("shows no badge when the rule yields null (BAC ≤ 0)", () => {
    const zeroBac: BudgetForecast = { ...AVAILABLE, facts: { ...AVAILABLE.facts, bac: 0 } };
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={zeroBac} />);
      const region = (view === "pace" ? paceRegion() : effRegion())!;
      expect(region).not.toBeNull();
      expect(within(region).queryByRole("img", { name: BADGE })).toBeNull();
      unmount();
    }
  });

  it("shows no badge when the chosen forecast is unavailable", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null,
    })} />);
    expect(within(paceRegion()!).queryByRole("img", { name: BADGE })).toBeNull();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({ unavailable: "no-actual-cost" })} />);
    expect(within(effRegion()!).queryByRole("img", { name: BADGE })).toBeNull();
  });
});

describe("ForecastCards — pace card (§5.6 worked example)", () => {
  it("shows the EAC, VAC, ETC, burn rate and run-out", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText(money(261150))).toBeInTheDocument();
    expect(screen.getByText(`${money(-21150)} (${formatSignedPercent(-21150 / 240000, locale, 1)})`)).toBeInTheDocument();
    expect(screen.getByText(`${money(1350)}/day`)).toBeInTheDocument();
    expect(screen.getByText("Nov 27, 2026, 21 days before plan end")).toBeInTheDocument();
  });

  it("shows the burn-rate window line", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText("Burn rate from Aug 17 – Sep 11 (20 working days)")).toBeInTheDocument();
  });

  it("renders the reason when not enough bookings exist", () => {
    render(<Cards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null,
    })} />);
    expect(screen.getByText("Not enough recent bookings")).toBeInTheDocument();
  });

  it("renders the reason when there is no recent burn", () => {
    render(<Cards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null,
    })} />);
    expect(screen.getByText("No recent bookings")).toBeInTheDocument();
  });

  // Finding 8: the other three run-out variants — the worked example only
  // exercises "before plan end".
  it("run-out: renders the after-plan-end variant when the run-out date falls past plan end", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: "2027-01-05", daysBeforePlannedEnd: -5 };
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutAfter", formatDayMonthYear("2027-01-05", locale), "5"))).toBeInTheDocument();
  });

  it("run-out: renders the on-plan-end variant when daysBeforePlannedEnd is exactly 0", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: "2026-12-18", daysBeforePlannedEnd: 0 };
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutOnEnd", formatDayMonthYear("2026-12-18", locale)))).toBeInTheDocument();
  });

  it("run-out: renders \"Already used up\" when runOutDate is null", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: null, daysBeforePlannedEnd: null };
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutAlready"))).toBeInTheDocument();
  });
});

// Migrated: each render now asks for the efficiency card explicitly.
describe("ForecastCards — efficiency card (§5.6 worked example)", () => {
  it("shows CPI, SPI and EAC", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByText("0.89")).toBeInTheDocument();
    expect(screen.getByText("0.85")).toBeInTheDocument();
    expect(screen.getByText(money(270968))).toBeInTheDocument();
  });

  it("shows a dash for SPI when it is null", () => {
    const noSpi: BudgetForecast = {
      ...AVAILABLE,
      efficiency: { pv: 0, cpi: 148800 / 168000, spi: null, etc: 102968, eac: 270968, vac: -30968 },
    };
    render(<Cards lang="en-US" view="efficiency" forecast={noSpi} />);
    expect(within(effRegion()!).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the reason when the efficiency forecast needs a percent complete, with a Needs tooltip", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({
      unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }],
    })} />);
    expect(screen.getByText(/Needs linked tasks or a % complete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What does Needs mean?" })).toBeInTheDocument();
  });

  it("renders the reason when nothing has been spent yet", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({ unavailable: "no-actual-cost" })} />);
    expect(screen.getByText("Nothing spent yet")).toBeInTheDocument();
  });

  it("renders the reason when nothing has been earned yet", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({ unavailable: "no-earned-value" })} />);
    expect(screen.getByText("Nothing earned yet")).toBeInTheDocument();
  });
});

describe("ForecastCards — fixed-price note", () => {
  const FIXED = "Fixed price: the overrun is internal effort; the client price does not change.";

  // Migrated from "appears on both cards": one card renders, so the note
  // appears once, on whichever card is chosen.
  it("appears on the chosen card, whichever it is, when hasFixedPrice", () => {
    const fp: BudgetForecast = { ...AVAILABLE, hasFixedPrice: true };
    const { unmount } = render(<Cards lang="en-US" forecast={fp} />);
    expect(screen.getAllByText(FIXED)).toHaveLength(1);
    expect(within(paceRegion()!).getByText(FIXED)).toBeInTheDocument();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={fp} />);
    expect(screen.getAllByText(FIXED)).toHaveLength(1);
    expect(within(effRegion()!).getByText(FIXED)).toBeInTheDocument();
  });

  it("is absent when no bucket is fixed-price", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.queryByText(/Fixed price:/)).toBeNull();
  });
});

describe("ForecastCards — gap line (conditions unchanged)", () => {
  it("renders the info sentence as a plain paragraph without a role", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const text = screen.getByText(/The forecasts differ by/);
    expect(text.tagName).toBe("P");
    expect(text.getAttribute("role")).toBeNull();
    expect(text.textContent).toContain("8 working days beyond the planned end");
  });

  it("renders under the efficiency card too — it compares both forecasts whichever card shows", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByText(/The forecasts differ by/)).toBeInTheDocument();
  });

  it("hides the extra-days clause when extraWorkingDays is null", () => {
    const noExtra: BudgetForecast = {
      ...AVAILABLE,
      gap: { eacDifference: 9818, percentOfBac: 9818 / 240000, severity: "info", extraWorkingDays: null },
    };
    render(<Cards lang="en-US" forecast={noExtra} />);
    const text = screen.getByText(/The forecasts differ by/);
    expect(text.textContent).not.toContain("working days beyond the planned end");
  });

  it("renders the warning sentence with role=status and a leading Warning:", () => {
    const warn: BudgetForecast = {
      ...AVAILABLE,
      gap: { eacDifference: 50000, percentOfBac: 50000 / 240000, severity: "warning", extraWorkingDays: null },
    };
    render(<Cards lang="en-US" forecast={warn} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/^Warning:/);
  });

  it("renders nothing when gap is null", () => {
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, gap: null }} />);
    expect(screen.queryByText(/The forecasts differ by/)).toBeNull();
  });

  it("renders nothing when either forecast is unavailable, in either view", () => {
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={{ ...withEfficiencyUnavailable({ unavailable: "no-actual-cost" }), gap: AVAILABLE.gap }} />);
      expect(screen.queryByText(/The forecasts differ by/)).toBeNull();
      unmount();
    }
  });
});

describe("ForecastCards + ForecastFactsRow — accessibility", () => {
  // Migrated: run once per view, since only one card is in the DOM at a time.
  it("every tooltip trigger has a unique accessible name, in either view", () => {
    for (const view of VIEWS) {
      const { unmount } = render(
        <div>
          <ForecastFactsRow lang="en-US" forecast={AVAILABLE} />
          <Cards lang="en-US" view={view} forecast={AVAILABLE} />
        </div>,
      );
      const labels = Array.from(document.querySelectorAll("[data-info-tooltip-trigger]")).map((el) => el.getAttribute("aria-label"));
      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels).size).toBe(labels.length);
      unmount();
    }
  });

  it("label-in-name: the EAC tooltip label contains its visible term", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByRole("button", { name: "What is EAC at current pace?" })).toBeInTheDocument();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByRole("button", { name: "What is EAC at current efficiency?" })).toBeInTheDocument();
  });

  // Finding 2: each card's `aria-labelledby` points at an inner <span> holding
  // ONLY the title text — so neither the tooltip glyph nor the new badge joins
  // the region's name, which stays the exact EN title.
  it("the chosen card is a region with the exact EN title as its accessible name", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByRole("region", { name: PACE })).toBeInTheDocument();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
  });
});

describe("ForecastCards — In hours (MR 3)", () => {
  it("renders no hours line without hours", () => {
    render(<Cards lang="en-US" forecast={EUR_FORECAST} />);
    expect(screen.queryByText("In hours")).toBeNull();
  });

  // Migrated from one two-card test: the pace figures on the pace card…
  it("shows EAC, VAC and run-out in hours on the pace card", () => {
    render(<Cards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
    expect(screen.getByText("2,209 h")).toBeInTheDocument();
    expect(screen.getByText("Nov 23, 2026")).toBeInTheDocument();
    expect(screen.queryByText("CPI (hours)")).toBeNull();
  });

  // …and the efficiency figures on the efficiency card.
  it("shows EAC in hours and CPI (hours) on the efficiency card", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
    expect(screen.getByText("2,339 h")).toBeInTheDocument();
    expect(screen.getByText("CPI (hours)")).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
  });

  it("shows the chosen card's chip when the mix triggers, explained by the shared sentence", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    const pace = screen.getByRole("button", { name: "Effort worse than € at current pace — why?" });
    expect(screen.queryByRole("button", { name: "Effort worse than € at current efficiency — why?" })).toBeNull();
    expect(pace).toHaveTextContent("Effort worse than €");
    act(() => pace.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      rateMixExplanation("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE),
    );
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    expect(screen.getByRole("button", { name: "Effort worse than € at current efficiency — why?" })).toBeInTheDocument();
  });

  it("shows no chip when the mix does not trigger, in either view", () => {
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
      expect(screen.queryByRole("button", { name: /why\?$/ })).toBeNull();
      unmount();
    }
  });

  it("hides the pace hours line when the hours pace forecast is unavailable, leaving the efficiency one", () => {
    const hours: BudgetForecast = { ...HOURS_FORECAST_HOURS_WORSE, pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null } };
    const { unmount } = render(<Cards lang="en-US" forecast={EUR_FORECAST} hours={hours} mix={MIX_ON_PLAN} />);
    expect(screen.queryByText("In hours")).toBeNull();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={EUR_FORECAST} hours={hours} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });
});

// Task 11: three-part variance split (performance / added scope / unattributed)
// beneath the VAC row, in € always and in hours whenever the hours line shows.
// `pace.eac` and `efficiency.eac` are deliberately DIFFERENT on both fixtures
// below (1440 vs 1300 hours; 144000 vs 130000 €) so a mutant that has the
// efficiency card read the pace card's EAC is caught by a distinct expected
// figure per card, not by a coincidentally-equal one.
describe("ForecastCards — three-part variance split (task 11)", () => {
  const signedText = (base: string, n: number) => (n > 0 ? `+${base}` : base);

  const HISTORY: BudgetHistorySummary = {
    baselineDate: "2026-01-05",
    baseline: { hours: 1200, value: 120000 },
    attributed: { hours: 500, value: 50000 },
    changes: [],
  };

  function hoursSplitForecast(bac: number): BudgetForecast {
    return {
      facts: { bac, ac: 1200, remaining: bac - 1200, ev: 1100, percentComplete: 64.7 },
      pace: {
        burnRatePerDay: 20, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
        spreadPeriodHoursUsed: false, workingDaysLeft: 12,
        etc: 240, eac: 1440, vac: bac - 1440, runOutDate: null, daysBeforePlannedEnd: null,
      },
      efficiency: { pv: 1150, cpi: 1100 / 1200, spi: 1100 / 1150, etc: 100, eac: 1300, vac: bac - 1300 },
      gap: null,
      hasFixedPrice: false,
    };
  }

  function eurSplitForecast(bac: number): BudgetForecast {
    return {
      facts: { bac, ac: 120000, remaining: bac - 120000, ev: 110000, percentComplete: 64.7 },
      pace: {
        burnRatePerDay: 2000, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
        spreadPeriodHoursUsed: false, workingDaysLeft: 12,
        etc: 24000, eac: 144000, vac: bac - 144000, runOutDate: null, daysBeforePlannedEnd: null,
      },
      efficiency: { pv: 115000, cpi: 110000 / 120000, spi: 110000 / 115000, etc: 10000, eac: 130000, vac: bac - 130000 },
      gap: null,
      hasFixedPrice: false,
    };
  }

  // Migrated: the two cards' halves are now two renders.
  it("shows performance and added-scope in hours, with no unattributed row, when the recorded change covers the whole BAC move", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1700)} history={HISTORY} />);
    const pace = paceRegion()!;
    expect(within(pace).getByText(signedText(formatHours(-240, locale), -240))).toBeInTheDocument();
    expect(within(pace).getByText(signedText(formatHours(500, locale), 500))).toBeInTheDocument();
    expect(within(pace).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
    unmount();

    render(<Cards lang="en-US" view="efficiency" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1700)} history={HISTORY} />);
    const eff = effRegion()!;
    expect(within(eff).getByText(signedText(formatHours(-100, locale), -100))).toBeInTheDocument();
    expect(within(eff).getByText(signedText(formatHours(500, locale), 500))).toBeInTheDocument();
    expect(within(eff).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
  });

  it("shows the unattributed row and its tooltip once the recorded change no longer covers the whole BAC move", () => {
    render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1760)} history={HISTORY} />);
    const pace = paceRegion()!;
    expect(within(pace).getByText(signedText(formatHours(60, locale), 60))).toBeInTheDocument();
    const trigger = within(pace).getByRole("button", {
      name: `${t("en-US", "forecastTipSplitNameUnattributed")} – ${PACE} – ${t("en-US", "forecastInHours")}`,
    });
    act(() => trigger.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(t("en-US", "forecastTipSplitUnattributed"));
  });

  it("shows the unattributed row exactly at the 0.5 threshold (boundary for the >= check)", () => {
    render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1700.5)} history={HISTORY} />);
    expect(within(paceRegion()!).getByText(t("en-US", "forecastSplitUnattributed"))).toBeInTheDocument();
  });

  it("renders the split rows in € the same way, with the baseline-date caption", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} history={HISTORY} />);
    const pace = paceRegion()!;
    expect(within(pace).getByText(t("en-US", "forecastSplitSince", formatDayMonthYear("2026-01-05", locale)))).toBeInTheDocument();
    expect(within(pace).getByText(signedText(money(-24000), -24000))).toBeInTheDocument();
    expect(within(pace).getByText(signedText(money(50000), 50000))).toBeInTheDocument();
    expect(within(pace).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
    unmount();

    render(<Cards lang="en-US" view="efficiency" forecast={eurSplitForecast(170000)} history={HISTORY} />);
    const eff = effRegion()!;
    expect(within(eff).getByText(signedText(money(-10000), -10000))).toBeInTheDocument();
    expect(within(eff).getByText(signedText(money(50000), 50000))).toBeInTheDocument();
    expect(within(eff).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
  });

  it("shows the no-history note once, on the chosen card, when history is null", () => {
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={EUR_FORECAST} />);
      expect(screen.getAllByText(t("en-US", "forecastSplitNoHistory"))).toHaveLength(1);
      unmount();
    }
  });

  // Migrated: the four unattributed names (2 cards × 2 units) are collected
  // across the two views; they must stay distinct from each other, since the
  // card title is what tells a screen-reader user which reading they are in.
  it("keeps every unattributed-variance tooltip's accessible name unique across both cards and both units", () => {
    const collect = (view: ForecastView) => {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={eurSplitForecast(176000)} hours={hoursSplitForecast(1760)} history={HISTORY} />);
      const labels = Array.from(document.querySelectorAll("[data-info-tooltip-trigger]")).map((el) => el.getAttribute("aria-label"));
      unmount();
      return labels;
    };
    const pace = collect("pace");
    const eff = collect("efficiency");
    for (const labels of [pace, eff]) expect(new Set(labels).size).toBe(labels.length);
    const unattributed = [...pace, ...eff].filter((l) => l?.includes(t("en-US", "forecastTipSplitNameUnattributed")));
    expect(unattributed).toHaveLength(4);
    expect(new Set(unattributed).size).toBe(4);
  });

  it("renders the DE added-scope label", () => {
    render(<Cards lang="de" forecast={eurSplitForecast(170000)} history={HISTORY} />);
    expect(screen.getAllByText("Zusätzlicher Umfang").length).toBeGreaterThan(0);
  });
});
```

★ The Write tool writes this file as UTF-8; it contains "Zusätzlicher", "€", "—" and "–". After the normaliser, confirm they survived: `grep -c "Zusätzlicher Umfang" src/app/budget-forecast-cards.test.tsx` → 1.

- [ ] **Step 2: Migrate the section test (whole file) and the one report test the default view breaks**

Replace `src/app/budget-forecast-section.test.tsx` entirely (Write tool, then the same normaliser command with this path):

```tsx
import { beforeEach, describe, it, expect } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForecastSection } from "./budget-forecast-section";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import { BUNDLE_HOURS_WORSE } from "../test/forecast-fixtures";

const PACE = t("en-US", "forecastPaceTitle");
const EFF = t("en-US", "forecastEfficiencyTitle");

describe("ForecastSection", () => {
  beforeEach(() => localStorage.clear());

  it("opens the role mix from the banner and focuses its summary", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("does not move focus when the role mix disappears and comes back after a live edit", () => {
    // The section keeps its focus nonce while `mix` goes null; when the mix
    // returns, the details remount and must not grab focus without a click.
    const { container, rerender } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(document.activeElement).toBe(container.querySelector("summary"));
    rerender(<ForecastSection lang="en-US" bundle={{ ...BUNDLE_HOURS_WORSE, mix: null }} granularity="month" />);
    expect(container.querySelector("summary")).toBeNull();
    rerender(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(document.activeElement).not.toBe(summary);
  });

  // Migrated from "renders the cards with their hours lines" (2): one card now.
  it("renders the chosen card with its hours line", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });

  it("defaults to the pace card and persists a switch to efficiency as the device setting", async () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: PACE })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: PACE })).toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { budgetForecastView?: string };
      expect(stored.budgetForecastView).toBe("efficiency");
    });
  });

  it("opens on a persisted efficiency choice", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetForecastView: "efficiency" }));
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "true");
  });
});
```

In `src/app/budget-report-panel.test.tsx`, the test `"shows the facts row and forecast cards inside their own Forecast section"` asserts BOTH regions, which the one-card rule breaks (MIGRATE). Replace that whole `it(...)` block with the Edit tool (old_string = from its `it(` line through its closing `});`) with:

```tsx
  it("shows the reading switch and the chosen card inside their own Forecast section", () => {
    renderPanel();
    const forecastHeading = screen.getByRole("heading", { name: t("en-US", "forecastTitle") });
    // Finding 7: `within` the actual Forecast section, not a bare "exists
    // somewhere on the page" check — the heading's parent IS the `Section`
    // wrapper (`report-table.tsx`'s `Section` renders `<h3>{title}</h3>` as a
    // sibling of its children inside one wrapping `<div>`).
    const forecastSection = forecastHeading.parentElement as HTMLElement;
    expect(within(forecastSection).getByRole("radiogroup", { name: t("en-US", "forecastViewLabel") })).toBeInTheDocument();
    // Finding 2: the region's accessible name is the exact EN title.
    expect(within(forecastSection).getByRole("region", { name: t("en-US", "forecastPaceTitle") })).toBeInTheDocument();
    // One card at a time; pace is the default device reading
    // (vitest.setup.ts clears localStorage after every test).
    expect(within(forecastSection).queryByRole("region", { name: t("en-US", "forecastEfficiencyTitle") })).toBeNull();
  });
```

Breakage sweep for this task (grep repo-wide, each hit labelled): `grep -rn "<ForecastCards\|ForecastCards(" src e2e` → `budget-forecast-section.tsx` MIGRATE (Step 5), `budget-forecast-cards.test.tsx` MIGRATE (Step 1), no dashboard consumer (`dashboard-tile-bodies.tsx` does not import it). `grep -rn "forecastEfficiencyTitle\|At current efficiency" src e2e --include=*.test.tsx --include=*.spec.ts`: `budget-report-panel.test.tsx` MIGRATE (above); `burndown-chart.test.tsx` and `chart-readout.test.tsx` KEEP (they are about the chart legend/readout, which still draw both lines — spec Decision 5); `burndown-chart-panel.test.tsx` KEEP (no cards there). `grep -rn "In hours" src/app/*.test.tsx` → only the two rewritten files.

- [ ] **Step 3: Run the tests and watch them fail**

```bash
npx vitest run src/app/budget-forecast-cards.test.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx > /tmp/fsw-t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t2.log
```
Expected: EXIT=1. The switch tests fail (no radiogroup), every "only the chosen card" assertion fails (both cards still render), the badge tests fail (no `img` named Amber/Red/Green). Tests that do not depend on the new behaviour stay green.

- [ ] **Step 4: Add the EN and DE key**

In `src/app/i18n.ts`, with the Edit tool, replace

```ts
  forecastTitle: "Forecast",
```

with

```ts
  forecastTitle: "Forecast",
  forecastViewLabel: "Forecast reading",
```

For `src/app/i18n.de.ts`, save this script as `de-forecast-view-label.mjs` in your scratchpad directory and run `node <that path>`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const p = "C:/Projects/aipm-cockpit/src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
if (s.includes("forecastViewLabel")) { console.log("ALREADY PRESENT"); process.exit(1); }
const anchor = "\r\n  forecastWhatIs:";
const i = s.indexOf(anchor);
if (i < 0 || s.indexOf(anchor, i + 1) >= 0) { console.log("ANCHOR", i); process.exit(1); }
s = s.slice(0, i) + '\r\n  forecastViewLabel: "Prognosegrundlage",' + s.slice(i);
writeFileSync(p, s, "utf8");
console.log("bare LF count (must be 0):", (s.match(/(?<!\r)\n/g) || []).length);
```

The anchor begins with `\r\n`, so it cannot match on an LF file and silently no-op: a miss prints `ANCHOR -1` and exits 1. It inserts directly after `forecastTitle: "Prognose",`. Then verify:

```bash
git ls-files --eol src/app/i18n.de.ts                     # expect i/lf w/crlf
grep -n "forecastViewLabel" src/app/i18n.ts src/app/i18n.de.ts   # expect one line in each
grep -c "Prognose\"," src/app/i18n.de.ts                  # expect 1 (the neighbouring line untouched)
```

- [ ] **Step 5: Implement the switch, the single card and the badge**

All edits in `src/app/budget-forecast-cards.tsx` use the Edit tool.

(a) Header comment — replace

```tsx
// Forecast method cards (spec §6.1, §6.2): "At current pace" and "At current
// efficiency", each with a question subtitle, its EAC as the large figure, a
// <dl> of VAC/ETC plus method-specific rows, and the gap line below both.
```

with

```tsx
// Forecast method cards (spec §6.1, §6.2): "At current pace" and "At current
// efficiency", each with a question subtitle, its EAC as the large figure, a
// <dl> of VAC/ETC plus method-specific rows. ONE card shows at a time, chosen
// by a SegmentedControl above it (forecast-switch spec B); the chosen card's
// title carries a RagBadge over its own VAC, and the gap line sits below.
```

(b) Imports — replace

```tsx
import { type Lang, t, localeFor } from "./i18n";
```

with

```tsx
import { type Lang, t, localeFor } from "./i18n";
import { SegmentedControl } from "./segmented-control";
import { RagBadge } from "./rag-badge";
```

and replace

```tsx
  isPaceAvailable, isEfficiencyAvailable, BURN_RATE_WINDOW_WORKING_DAYS,
```

with

```tsx
  isPaceAvailable, isEfficiencyAvailable, paceVacHealth, BURN_RATE_WINDOW_WORKING_DAYS,
```

(c) The view type and the badge — replace

```tsx
type Money = (n: number) => string;
type Facts = BudgetForecast["facts"];
```

with

```tsx
type Money = (n: number) => string;
type Facts = BudgetForecast["facts"];

/** Which forecast card shows — the device setting `budgetForecastView`. */
export type ForecastView = "pace" | "efficiency";

/** The card's health at a glance (spec B, Decision 3): `paceVacHealth` over
 *  THIS card's own VAC. ★ No `title` on purpose — `RagBadge` then names the
 *  health in words ("Amber"), so the badge is never colour-only; a `title`
 *  would REPLACE that word with the title text. Nothing renders when the rule
 *  yields null (BAC ≤ 0); the caller renders nothing for an unavailable card. */
function VacBadge({ lang, vac, bac }: { lang: Lang; vac: number; bac: number }) {
  const health = paceVacHealth(vac, bac);
  if (health === null) return null;
  return <span className="ml-1.5 inline-flex"><RagBadge value={health} lang={lang} /></span>;
}
```

(d) Pace card title — replace

```tsx
        <span id={titleId}>{paceTitle}</span>
        <TermTooltip lang={lang} term={paceTitle} means tip={t(lang, "forecastTipPace", String(BURN_RATE_WINDOW_WORKING_DAYS))} />
```

with

```tsx
        <span id={titleId}>{paceTitle}</span>
        {isPaceAvailable(pace) && <VacBadge lang={lang} vac={pace.vac} bac={facts.bac} />}
        <TermTooltip lang={lang} term={paceTitle} means tip={t(lang, "forecastTipPace", String(BURN_RATE_WINDOW_WORKING_DAYS))} />
```

(e) Efficiency card title — replace

```tsx
        <span id={titleId}>{effTitle}</span>
        <TermTooltip lang={lang} term={effTitle} means tip={t(lang, "forecastTipEfficiency")} />
```

with

```tsx
        <span id={titleId}>{effTitle}</span>
        {isEfficiencyAvailable(efficiency) && <VacBadge lang={lang} vac={efficiency.vac} bac={facts.bac} />}
        <TermTooltip lang={lang} term={effTitle} means tip={t(lang, "forecastTipEfficiency")} />
```

(f) `ForecastCards` — replace the whole exported function (from `export function ForecastCards({` to the end of the file) with:

```tsx
export function ForecastCards({
  lang, forecast, view, onViewChange, hours = null, mix = null, history = null,
}: {
  lang: Lang; forecast: BudgetForecast;
  /** Which card shows. The caller owns it (`ForecastSection` reads the device setting). */
  view: ForecastView;
  onViewChange: (view: ForecastView) => void;
  hours?: BudgetForecast | null; mix?: RateMix | null;
  history?: BudgetHistorySummary | null;
}) {
  const locale = localeFor(lang);
  const money: Money = (n) => formatCurrency(n, "EUR", locale);
  const { pace, efficiency, gap, facts, hasFixedPrice } = forecast;
  return (
    <div>
      {/* ★ The switch heads the card COLUMN, never the card: PaceCard and
          EfficiencyCard are different components, so a switch inside either
          would unmount on every change and an arrow key would drop keyboard
          focus to <body>. The options reuse the cards' own titles, so each
          radio's accessible name IS its visible text (WCAG 2.5.3). The switch
          does not print; the chosen card does. */}
      <div className="mb-2 print:hidden">
        <SegmentedControl<ForecastView>
          value={view}
          options={[
            { value: "pace", label: t(lang, "forecastPaceTitle") },
            { value: "efficiency", label: t(lang, "forecastEfficiencyTitle") },
          ]}
          onChange={onViewChange}
          ariaLabel={t(lang, "forecastViewLabel")}
        />
      </div>
      {view === "pace" ? (
        <PaceCard lang={lang} pace={pace} facts={facts} money={money} locale={locale} hasFixedPrice={hasFixedPrice} eur={forecast} hours={hours} mix={mix} history={history} />
      ) : (
        <EfficiencyCard lang={lang} efficiency={efficiency} facts={facts} money={money} locale={locale} hasFixedPrice={hasFixedPrice} eur={forecast} hours={hours} mix={mix} history={history} />
      )}
      {/* The gap line compares BOTH forecasts, so it shows under whichever card
          is chosen; its conditions are unchanged. */}
      {gap && isPaceAvailable(pace) && isEfficiencyAvailable(efficiency) && (
        <GapLine lang={lang} gap={gap} pace={pace} efficiency={efficiency} money={money} locale={locale} />
      )}
    </div>
  );
}
```

(g) Wire the setting in `src/app/budget-forecast-section.tsx`. Replace the file's content with the following (Write tool, then the normaliser with this path):

```tsx
"use client";

// Forecast section body (MR 3): banners, the role-mix disclosure and the cards.
// Owns the disclosure's open state and the focus nonce the banner action bumps,
// so the Budget report panel stays an orchestrator (plan Ruling 10). Also reads
// and writes the device setting that picks the card (forecast-switch spec B),
// through `useSettings` with a FUNCTIONAL setter, as `BurndownChartPanel` does
// for the chart's two switches.
import { useState } from "react";
import type { Lang } from "./i18n";
import type { PlanGranularity } from "./types";
import type { ForecastBundle } from "./budget-forecast-bundle";
import { useSettings } from "./use-settings";
import { ForecastBanners } from "./budget-forecast-banner";
import { ForecastCards, type ForecastView } from "./budget-forecast-cards";
import { RateMixDetails } from "./budget-rate-mix-details";

export function ForecastSection({ lang, bundle, granularity }: { lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity }) {
  const [mixOpen, setMixOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const { settings, setSettings } = useSettings();
  const view: ForecastView = settings.budgetForecastView ?? "pace";
  const { eur, hours, mix, history } = bundle;
  const showMix = () => {
    setMixOpen(true);
    setFocusNonce((n) => n + 1);
  };
  return (
    <div className="space-y-3">
      <ForecastBanners lang={lang} forecast={eur} hours={hours} mix={mix} granularity={granularity} onShowMix={mix ? showMix : undefined} />
      {mix ? (
        <RateMixDetails lang={lang} mix={mix} eur={eur} hours={hours} open={mixOpen} onToggle={setMixOpen} focusNonce={focusNonce} />
      ) : null}
      <ForecastCards
        lang={lang} forecast={eur} hours={hours} mix={mix} history={history}
        view={view}
        onViewChange={(v) => setSettings((s) => ({ ...s, budgetForecastView: v }))}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and the gates**

```bash
npx vitest run src/app/budget-forecast-cards.test.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx src/app/i18n-encoding.test.ts src/app/i18n.test.ts > /tmp/fsw-t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t2.log
npx tsc --noEmit > /tmp/fsw-tsc2.log 2>&1; echo "TSC_EXIT=$?"; tail -5 /tmp/fsw-tsc2.log
npx eslint --max-warnings=0 src/app/budget-forecast-cards.tsx src/app/budget-forecast-cards.test.tsx src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts; echo "LINT_EXIT=$?"
git ls-files --eol src/app/budget-forecast-cards.tsx src/app/budget-forecast-cards.test.tsx src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/i18n.de.ts
```
Expected: EXIT=0 with `Test Files  5 passed (5)`; TSC_EXIT=0 (it also proves EN/DE key parity); LINT_EXIT=0; every file `i/lf w/crlf`. `i18n-encoding.test.ts` bans ASCII umlaut substitutes. If the "In hours" figures `2,209 h` / `2,339 h` land on the other card than the test says, stop and report it — do not move an assertion to make it pass (both were derived from `HOURS_FORECAST_HOURS_WORSE`: pace ETC 11 h/day × 69 working days + AC 1,450 = 2,209; efficiency (2,000 − 1,240) ÷ (1,240 ÷ 1,450) + 1,450 ≈ 2,339).

- [ ] **Step 7: Mutation-check the badge and the switch placement**

1. In `VacBadge`, change `const health = paceVacHealth(vac, bac);` to `const health = paceVacHealth(vac * 0.5, bac);`. Run the Step 6 vitest command: expected EXIT=1 — the efficiency card now reads Amber (6.45% of BAC), not Red. (The pace card stays Amber either way, which is why the two fixture VACs sit in different bands.) Revert with the inverse Edit.
2. In `ForecastCards`, change `<div className="mb-2 print:hidden">` to `<div key={view} className="mb-2 print:hidden">`. The key forces the switch to remount on every change — exactly what a switch inside the swapped card would do. Run: expected EXIT=1 on "keeps keyboard focus on the switch when an arrow key changes the card". Revert with the inverse Edit. (Do not use "move the switch into both branches as a fragment" as the mutant: React matches the fragment's first child by position and type and keeps it mounted, so that mutant survives for a reason unrelated to the test.)

Then `git diff --stat` — expected: exactly the seven files in this task's **Files** block.

- [ ] **Step 8: Commit**

```bash
git add src/app/budget-forecast-cards.tsx src/app/budget-forecast-cards.test.tsx src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(forecast): one forecast card at a time, chosen by a switch, with a RAG badge

A SegmentedControl named "Forecast reading" above the card picks pace or
efficiency and writes the budgetForecastView device setting; only the chosen
card renders, and its title carries a RagBadge from paceVacHealth over that
card's own VAC (no badge when the rule yields null or the forecast is
unavailable). The switch heads the column rather than the card so an arrow
key never unmounts the radio that holds focus. The options reuse the cards'
titles, so label-in-name holds by construction; only the group label is new.
The gap line still compares both forecasts under whichever card shows.
EOF
```

---

## Task 3: `BurndownChartPanel` can hand its change table to the caller

**Files:**
- Modify: `src/app/burndown-chart-panel.tsx`
- Test: `src/app/burndown-chart-panel.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // burndown-chart-panel.tsx
  export function BurndownChartPanel(props: { /* existing props */ ...; detachChangeTable?: boolean }): ReactNode;
  export function BurndownChangeTableBlock(props: {
    lang: Lang; series: BurndownSeries;
    bundle: Pick<ForecastBundle, "eur" | "hours" | "evHistory" | "history"> | null;
    currency: string;
  }): ReactNode;
  ```
  `detachChangeTable` defaults to `false`: every existing caller (the dashboard tile passes `compact`; nothing passes the new prop) renders exactly as before.

**Why a detached table rather than the spec's "prop that keeps the table below" (a ruling on the spec's Components table):** the spec wants the table **full width below the row** (Decisions 6 and 7, and its Layout sketch), but the panel will sit inside the row's 70% chart column. A prop that only swaps `2xl:flex-row` for a stacked layout would still keep the table inside that 70% column. So the panel gains `detachChangeTable` (it builds no table) and exports `BurndownChangeTableBlock`, which the report mounts below the row. Both call ONE private `changeTableFor` rule — no budget in either unit, no history, or no change after the baseline all mean no table — so the detached table can never appear where the inline one would not, and it reads the chart unit from the same device setting, so the two always show one unit.

- [ ] **Step 1: Write the failing tests**

In `src/app/burndown-chart-panel.test.tsx`, change the import line

```tsx
import { BurndownChartPanel } from "./burndown-chart-panel";
```

to

```tsx
import { BurndownChartPanel, BurndownChangeTableBlock } from "./burndown-chart-panel";
```

Add this helper directly after the `renderPanel` function:

```tsx
/** jsdom has no layout, so placement is pinned by the classes that produce it. */
function ancestorWithClass(el: Element, cls: string): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) if (n.classList.contains(cls)) return n;
  return null;
}
```

Inside `describe("BurndownChartPanel", …)`, after the test `"renders no change table when nothing has been recorded"`, add:

```tsx
  it("keeps the table beside the chart from 2xl when not detached (every existing caller's behaviour)", async () => {
    render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR"
      />,
    );
    await act(async () => {});
    const region = screen.getByRole("region", { name: /Budget changes/ });
    expect(ancestorWithClass(region, "2xl:w-[30rem]")).not.toBeNull();
    expect(ancestorWithClass(region, "2xl:flex-row")).not.toBeNull();
  });

  it("renders no change table when detached, while keeping the chart and both switches", async () => {
    const { container } = render(
      <BurndownChartPanel
        lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }}
        today="2026-02-14" planEnd="2026-03-31" currency="EUR" detachChangeTable
      />,
    );
    await act(async () => {});
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Chart orientation" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Chart unit" })).toBeInTheDocument();
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
  });
```

After the closing `});` of that `describe`, add a new one:

```tsx
describe("BurndownChangeTableBlock", () => {
  beforeEach(() => localStorage.clear());

  it("renders the change table in the chart's displayed unit, and follows the panel's unit switch", async () => {
    const withHistory = { ...bundle, history: HISTORY };
    render(
      <>
        <BurndownChartPanel
          lang="en-US" series={CHART_SERIES} bundle={withHistory}
          today="2026-02-14" planEnd="2026-03-31" currency="EUR" detachChangeTable
        />
        <BurndownChangeTableBlock lang="en-US" series={CHART_SERIES} bundle={withHistory} currency="EUR" />
      </>,
    );
    await act(async () => {});
    const perf = () => within(within(screen.getByRole("table", { name: /Budget changes/ }))
      .getByRole("rowheader", { name: "Performance" }).closest("tr") as HTMLElement);
    // CHART_FORECAST: BAC 9,000, pace EAC 10,000 → performance = baseline 9,000 − 10,000.
    expect(perf().getByText("-€1,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    // The two components are separate useSettings instances; the settings
    // listener registry carries the panel's write to the block.
    await waitFor(() => expect(perf().getByText("-10 h")).toBeInTheDocument());
  });

  it("renders nothing without a recorded change, or when neither unit has a budget — the panel's own rule", async () => {
    const { container, rerender } = render(
      <BurndownChangeTableBlock lang="en-US" series={CHART_SERIES} bundle={bundle} currency="EUR" />,
    );
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    rerender(
      <BurndownChangeTableBlock
        lang="en-US" series={{ ...CHART_SERIES, totalBudgetValue: 0, totalBudgetHours: 0 }}
        bundle={{ ...bundle, history: HISTORY }} currency="EUR"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    // Positive control: the same history with a budget does render — so the
    // two empty results above are the rule, not a broken block.
    rerender(<BurndownChangeTableBlock lang="en-US" series={CHART_SERIES} bundle={{ ...bundle, history: HISTORY }} currency="EUR" />);
    expect(screen.getByRole("table", { name: /Budget changes/ })).toBeInTheDocument();
  });
});
```

Existing tests in this file: all KEEP — `"renders no change table when compact (dashboard tile), while the same props non-compact do"` is the dashboard's unchanged-behaviour pin and must stay green untouched.

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/app/burndown-chart-panel.test.tsx > /tmp/fsw-t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t3.log
```
Expected: EXIT=1 — the detached test finds a table (the prop is ignored), and both block tests fail with an invalid element type (the export does not exist). The new "keeps the table beside the chart" test already passes: it pins today's behaviour so the refactor cannot move it.

- [ ] **Step 3: Implement**

All edits in `src/app/burndown-chart-panel.tsx` with the Edit tool.

(a) Replace

```tsx
import { useMemo } from "react";
```

with

```tsx
import { useMemo, type ReactNode } from "react";
```

(b) Replace

```tsx
export function BurndownChartPanel({
  lang, series, bundle, today, planEnd, currency, compact = false,
}: {
  lang: Lang; series: BurndownSeries; bundle: Pick<ForecastBundle, "eur" | "hours" | "evHistory" | "history"> | null;
```

with

```tsx
type PanelBundle = Pick<ForecastBundle, "eur" | "hours" | "evHistory" | "history">;

/** Either unit has a budget to draw. With neither, the switches could not reach
 *  a drawable chart, so only the "no budget" hint renders (the twin charts' rule). */
function hasAnyBudget(series: BurndownSeries): boolean {
  return series.totalBudgetValue > 0 || series.totalBudgetHours > 0;
}

/**
 * The recorded-change table in the displayed unit, or null when it has nothing
 * to show: no budget in either unit, no recorded history, or no change after the
 * baseline. ONE rule for the panel and `BurndownChangeTableBlock`, so a detached
 * table can never appear where the inline one would not.
 * The footer takes the PACE forecast's split, in the displayed unit (controller
 * ruling): the cards' primary figure, and the one the chart's own pace line
 * draws. Null when that forecast is unavailable — the recorded rows still stand
 * on their own.
 */
function changeTableFor({
  lang, series, bundle, unit, currency,
}: {
  lang: Lang; series: BurndownSeries; bundle: PanelBundle | null; unit: ChartUnit; currency: string;
}): ReactNode {
  const history = bundle ? bundle.history : null;
  if (!hasAnyBudget(series) || history === null || history.changes.length === 0) return null;
  const forecast = bundle ? bundle[unit] : null;
  const split = forecast !== null && isPaceAvailable(forecast.pace)
    ? splitVariance(
      unit === "eur" ? history.baseline.value : history.baseline.hours,
      unit === "eur" ? history.attributed.value : history.attributed.hours,
      forecast.facts.bac, forecast.pace.eac,
    )
    : null;
  return <BudgetChangeTable lang={lang} history={history} split={split} unit={unit} currency={currency} />;
}

export function BurndownChartPanel({
  lang, series, bundle, today, planEnd, currency, compact = false, detachChangeTable = false,
}: {
  lang: Lang; series: BurndownSeries; bundle: PanelBundle | null;
```

(c) Replace

```tsx
  compact?: boolean;
}) {
```

with

```tsx
  compact?: boolean;
  /** True when the CALLER places the recorded-change table itself, through
   *  `BurndownChangeTableBlock`. The Budget report does: the panel sits in its
   *  forecast row's 70% column, where the `2xl` side-by-side placement below is
   *  unreachable, and the spec puts the table full width under the whole row
   *  (forecast-switch spec B, Decisions 6 and 7). Default false — the dashboard
   *  tile (`compact`) and any other caller are unchanged. */
  detachChangeTable?: boolean;
}) {
```

(d) Replace the block from the footer comment through the no-budget guard:

```tsx
  // The footer takes the PACE forecast's split, in the displayed unit
  // (controller ruling): the cards' primary figure, and the one the chart's own
  // pace line draws. Null when that forecast is unavailable — the recorded rows
  // still stand on their own.
  const forecast = bundle ? bundle[unit] : null;
  const split = history !== null && forecast !== null && isPaceAvailable(forecast.pace)
    ? splitVariance(
      unit === "eur" ? history.baseline.value : history.baseline.hours,
      unit === "eur" ? history.attributed.value : history.attributed.hours,
      forecast.facts.bac, forecast.pace.eac,
    )
    : null;
  // Spec §5.2: headline only in the tile — see the `compact` prop doc.
  const changeTable = !compact && history !== null && history.changes.length > 0
    ? <BudgetChangeTable lang={lang} history={history} split={split} unit={unit} currency={currency} />
    : null;
  // No budget in EITHER unit: the switches could not reach a drawable chart,
  // so only the "no budget" hint renders (the twin charts' rule). With one unit
  // empty the switches stay, so the other unit remains reachable.
  if (!(series.totalBudgetValue > 0) && !(series.totalBudgetHours > 0)) {
```

with

```tsx
  // Spec §5.2: headline only in the tile — see the `compact` prop doc. A
  // detached table is the caller's to place — see `detachChangeTable`.
  const changeTable = compact || detachChangeTable
    ? null
    : changeTableFor({ lang, series, bundle, unit, currency });
  // No budget in EITHER unit: only the "no budget" hint renders. With one unit
  // empty the switches stay, so the other unit remains reachable.
  if (!hasAnyBudget(series)) {
```

(e) In the long placement comment above the row, replace

```tsx
          No `compact` branch here: a compact panel builds no `changeTable` at
          all, so the row holds the chart alone and the breakpoint has nothing
          to place beside it. */}
```

with

```tsx
          No `compact` or `detachChangeTable` branch here: either builds no
          `changeTable` at all, so the row holds the chart alone and the
          breakpoint has nothing to place beside it. */}
```

(f) Append at the end of the file:

```tsx

/**
 * The recorded-change table on its own, for a caller that places it outside the
 * panel — the Budget report mounts it full width below its forecast row, with the
 * panel's `detachChangeTable` set. Reads the chart unit from the same device
 * setting as the panel's unit switch, so the two always show one unit.
 */
export function BurndownChangeTableBlock({
  lang, series, bundle, currency,
}: {
  lang: Lang; series: BurndownSeries; bundle: PanelBundle | null; currency: string;
}) {
  const { settings } = useSettings();
  const unit: ChartUnit = settings.budgetChartUnit ?? "eur";
  return changeTableFor({ lang, series, bundle, unit, currency });
}
```

After (d), `history` is still used by `buildChartModel` above it; `isPaceAvailable` and `splitVariance` are now used only inside `changeTableFor`, which keeps both imports live.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/app/burndown-chart-panel.test.tsx src/app/dashboard-panel.test.tsx src/app/budget-report-panel.test.tsx > /tmp/fsw-t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t3.log
npx tsc --noEmit > /tmp/fsw-tsc3.log 2>&1; echo "TSC_EXIT=$?"; tail -5 /tmp/fsw-tsc3.log
npx eslint --max-warnings=0 src/app/burndown-chart-panel.tsx src/app/burndown-chart-panel.test.tsx; echo "LINT_EXIT=$?"
```
Expected: EXIT=0 with `Test Files  3 passed (3)`; TSC_EXIT=0; LINT_EXIT=0. `dashboard-panel.test.tsx` is the dashboard suite that mounts the `burn` tile (there is no `dashboard-tile-bodies` test file), so it re-checks the `compact` caller through the refactor; the report test re-checks the only other caller.

- [ ] **Step 5: Mutation-check the detach and the shared rule**

1. Change `compact || detachChangeTable` to `compact`. Run the Step 4 vitest command: expected EXIT=1 on "renders no change table when detached". Revert.
2. In `changeTableFor`, delete `!hasAnyBudget(series) || `. Run: expected EXIT=1 on the block's "renders nothing … neither unit has a budget" test. Revert.

Then `git diff --stat` — expected: exactly the two files in this task.

- [ ] **Step 6: Commit**

```bash
git add src/app/burndown-chart-panel.tsx src/app/burndown-chart-panel.test.tsx
git commit -F - <<'EOF'
feat(chart): let the burn-down panel hand its change table to the caller

detachChangeTable makes the panel build no recorded-change table, and the new
BurndownChangeTableBlock renders that table on its own, reading the chart
unit from the same device setting. Both go through one changeTableFor rule
(no budget in either unit, no history, or no change after the baseline all
mean no table), so a detached table can never appear where the inline one
would not. The default is unchanged, so the dashboard tile keeps its
behaviour.
EOF
```

---

## Task 4: The merged Forecast section and its row

**Files:**
- Modify: `src/app/budget-forecast-section.tsx`, `src/app/budget-report-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `docs/AGENTS/dashboard.md`
- Rewrite: `src/app/budget-forecast-section.test.tsx`
- Test: `src/app/budget-report-panel.test.tsx`

**Interfaces:**
- Consumes: `ForecastView`, the `view`/`onViewChange` wiring (Task 2); `detachChangeTable`, `BurndownChangeTableBlock` (Task 3).
- Produces:
  ```ts
  export function ForecastSection(props: {
    lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity;
    /** The chart column's content; the caller keeps owning the chart's data wiring. */
    chart: ReactNode;
    /** Full-width content under the row (the report's recorded-change table). */
    belowRow?: ReactNode;
  }): ReactNode;
  ```
  The i18n key `budgetBurndownTitle` is removed from both dictionaries (its only reader was the Burn-down `Section` this task deletes).

**Rulings on the spec for this task:**
- **Caption position.** Decision 6's list puts "the existing caption" after the table; the Layout sketch, the Components table ("keeps the caption under the chart") and the Testing section ("the caption still under the chart") put it in the chart column. Three of four say under the chart, and the caption explains the chart, so it goes at the bottom of the chart column, above the full-width table.
- **Chain warning.** The spec does not place `BurndownChainWarning`. It warns about the chart's time frame, so it heads the chart column — the dashboard tile already mounts it immediately above its `BurndownChartPanel`.
- **Dead key.** With the Burn-down `Section` gone, `budgetBurndownTitle` has no reader (`grep -rn budgetBurndownTitle src e2e` lists only the two dictionaries and the report panel and its test). It is removed rather than left to rot; no gate would flag it.

- [ ] **Step 1: Write the failing section test (whole file)**

Replace `src/app/budget-forecast-section.test.tsx` entirely (Write tool, then the Task 2 normaliser command with this path). Every render now passes `chart` (MIGRATE: the prop is required), and three row tests are added:

```tsx
import { beforeEach, describe, it, expect } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForecastSection } from "./budget-forecast-section";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import { BUNDLE_HOURS_WORSE } from "../test/forecast-fixtures";

const PACE = t("en-US", "forecastPaceTitle");
const EFF = t("en-US", "forecastEfficiencyTitle");
const CHART = <div data-testid="chart-slot">chart</div>;

/** The row is the chart slot's grandparent: row > chart column > slot. */
const rowOf = () => screen.getByTestId("chart-slot").parentElement!.parentElement as HTMLElement;

describe("ForecastSection", () => {
  beforeEach(() => localStorage.clear());

  it("opens the role mix from the banner and focuses its summary", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("does not move focus when the role mix disappears and comes back after a live edit", () => {
    // The section keeps its focus nonce while `mix` goes null; when the mix
    // returns, the details remount and must not grab focus without a click.
    const { container, rerender } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(document.activeElement).toBe(container.querySelector("summary"));
    rerender(<ForecastSection lang="en-US" bundle={{ ...BUNDLE_HOURS_WORSE, mix: null }} granularity="month" chart={CHART} />);
    expect(container.querySelector("summary")).toBeNull();
    rerender(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(document.activeElement).not.toBe(summary);
  });

  it("renders the chosen card with its hours line", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });

  it("defaults to the pace card and persists a switch to efficiency as the device setting", async () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: PACE })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: PACE })).toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { budgetForecastView?: string };
      expect(stored.budgetForecastView).toBe("efficiency");
    });
  });

  it("opens on a persisted efficiency choice", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetForecastView: "efficiency" }));
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "true");
  });

  // jsdom has no layout: the 30/70 split and the xl breakpoint are pinned by
  // the classes that produce them (spec B, Layout and Decision 8).
  it("puts the card column (30% from xl) and the chart side by side from xl, card first, stacking below xl", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const row = rowOf();
    expect(row).toHaveClass("flex", "flex-col", "gap-3", "xl:flex-row");
    expect(row.children).toHaveLength(2);
    const [cardCol, chartCol] = Array.from(row.children) as HTMLElement[];
    expect(cardCol).toHaveClass("xl:w-[30%]");
    expect(cardCol).toContainElement(screen.getByRole("region", { name: PACE }));
    expect(cardCol).toContainElement(screen.getByRole("radiogroup", { name: t("en-US", "forecastViewLabel") }));
    expect(chartCol).toHaveClass("min-w-0", "flex-1");
    expect(chartCol).toContainElement(screen.getByTestId("chart-slot"));
  });

  it("keeps the banners and the role-mix note above the row", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const row = rowOf();
    const banner = screen.getByRole("button", { name: "Where the hours went" });
    const details = container.querySelector("details")!;
    expect(banner.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.contains(details)).toBe(false);
  });

  it("renders belowRow after the row, outside it, at the section's full width", () => {
    render(
      <ForecastSection
        lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART}
        belowRow={<div data-testid="below-row" />}
      />,
    );
    const row = rowOf();
    const below = screen.getByTestId("below-row");
    expect(row.contains(below)).toBe(false);
    expect(row.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(below.parentElement).toBe(row.parentElement);
  });
});
```

- [ ] **Step 2: Migrate and extend the report test**

In `src/app/budget-report-panel.test.tsx`:

(a) Add `import type { BudgetHistoryEntry } from "./budget-history";` after the `SnapshotRecord` import.

(b) MIGRATE the test `"renders the burn-down section with its chart switches"` — replace the whole `it(...)` block with:

```tsx
  it("renders the chart and its switches inside the Forecast section, with no Burn-down section of its own", () => {
    renderPanel();
    const forecastSection = screen.getByRole("heading", { name: t("en-US", "forecastTitle") }).parentElement as HTMLElement;
    // Spec B, Decision 6: the two sections merged into one.
    expect(screen.queryByRole("heading", { name: "Burn-down" })).toBeNull();
    expect(within(forecastSection).getByRole("radio", { name: "Burn-down" })).toBeInTheDocument();
    expect(within(forecastSection).getByRole("radio", { name: "Hours" })).toBeInTheDocument();
    // The default device view (vitest.setup.ts clears localStorage after every test).
    expect(within(forecastSection).getByText("Budget remaining")).toBeInTheDocument();
  });
```

(c) MIGRATE the test `"orders sections Project total, Forecast, Burn-down, By bucket, Earned value"` — replace its title and its `sectionTitles` list so it reads:

```tsx
  it("orders sections Project total, Forecast, By bucket, Earned value", () => {
    renderPanel();
    // Only the report's own SECTION headings — every `Section` title is an
    // h3; the forecast card title is an h4 (nested under the Forecast
    // section's h3, not a sibling of it), so a bare heading-role query would
    // still pick it up. Filtering to the known, distinct Section title
    // texts keeps this scoped to sections regardless of level. The
    // Burn-down section no longer exists: its chart lives in Forecast.
    const sectionTitles = [
      t("en-US", "budgetReportProjectTotal"),
      t("en-US", "forecastTitle"),
      t("en-US", "budgetReportByBucket"),
      // Pinned via the live key (currently "Earned value · effort"), not a
      // hardcoded literal, so a future rename of the heading text keeps this
      // assertion valid.
      t("en-US", "evmTitle"),
    ];
    const headingTexts = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const found = headingTexts.filter((text) => sectionTitles.includes(text));
    expect(found).toEqual(sectionTitles);
  });
```

(d) Append a new `describe` at the end of the file:

```tsx
// Spec B: one Forecast section — banners, rate-mix note, then a row holding the
// chosen card (30%) and the chart (70%), then the recorded-change table at full
// width below the row. jsdom has no layout, so placement is pinned by structure
// and by the classes that produce it.
describe("BudgetReportPanel — the forecast row (spec B)", () => {
  // Default fixture: 230 budget hours worth 37,500 € at external rates; the
  // history records a baseline and one later change, so the table has a row.
  const HISTORY: BudgetHistoryEntry[] = [
    {
      id: "h1", at: "2026-01-01T00:00:00.000Z", date: "2026-01-01", kind: "baseline",
      bucketId: null, bucketName: "", projectBacHours: 200, projectBacValue: 33000, deltaHours: 0, deltaValue: 0,
    },
    {
      id: "h2", at: "2026-01-10T09:00:00.000Z", date: "2026-01-10", kind: "updated",
      bucketId: 3, bucketName: "Gamma", projectBacHours: 230, projectBacValue: 37500, deltaHours: 30, deltaValue: 4500,
    },
  ];
  const forecastSectionOf = () =>
    screen.getByRole("heading", { name: t("en-US", "forecastTitle") }).parentElement as HTMLElement;
  const ancestorWithClass = (el: Element, cls: string): HTMLElement | null => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.classList.contains(cls)) return n;
    return null;
  };
  const rowIn = (section: HTMLElement) => {
    const card = within(section).getByRole("region", { name: t("en-US", "forecastPaceTitle") });
    const row = ancestorWithClass(card, "xl:flex-row");
    expect(row).not.toBeNull();
    return row!;
  };

  it("puts the chosen card beside the chart in one row, card first, with the caption under the chart", () => {
    renderPanel();
    const row = rowIn(forecastSectionOf());
    const [cardCol, chartCol] = Array.from(row.children) as HTMLElement[];
    expect(row.children).toHaveLength(2);
    expect(cardCol).toHaveClass("xl:w-[30%]");
    expect(cardCol).toContainElement(screen.getByRole("region", { name: t("en-US", "forecastPaceTitle") }));
    expect(chartCol).toHaveClass("min-w-0", "flex-1");
    const orientation = within(chartCol).getByRole("radiogroup", { name: "Chart orientation" });
    const caption = within(chartCol).getByText(t("en-US", "dashboardBurnCaption"));
    expect(orientation.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chartCol.lastElementChild).toBe(caption);
  });

  it("puts the recorded-change table full width below the row, never beside the chart", () => {
    renderPanel({ budgetHistory: HISTORY });
    const section = forecastSectionOf();
    const row = rowIn(section);
    const tables = within(section).getAllByRole("region", { name: /Budget changes/ });
    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(row.contains(table)).toBe(false);
    expect(row.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The panel's own 2xl side-by-side slot is not used in the report.
    expect(ancestorWithClass(table, "2xl:flex-row")).toBeNull();
    // The caption stays with the chart, above the table.
    const caption = within(section).getByText(t("en-US", "dashboardBurnCaption"));
    expect(caption.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

Breakage sweep for this task (each hit labelled): `grep -rn "budgetBurndownTitle" src e2e` → `i18n.ts`, `i18n.de.ts` DELETE (Step 4); `budget-report-panel.tsx` DELETE (Step 3); `budget-report-panel.test.tsx` MIGRATE (b, c above). `grep -rn "<ForecastSection" src` → `budget-report-panel.tsx` MIGRATE (Step 3), `budget-forecast-section.test.tsx` MIGRATE (Step 1). `grep -rn "\"Burn-down\"" e2e` → no hits (e2e selects the chart by the "Chart orientation" radiogroup, KEEP). `e2e/visual.spec.ts`'s Reports budget test and its two baselines: MIGRATE in Task 5 (the chart column narrows to 70%).

- [ ] **Step 3: Run the tests and watch them fail**

```bash
npx vitest run src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx > /tmp/fsw-t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t4.log
```
Expected: EXIT=1 — the section ignores `chart`, so `chart-slot` is missing; the report still has a Burn-down heading and no forecast row.

- [ ] **Step 4: Implement**

(a) Replace `src/app/budget-forecast-section.tsx` entirely (Write tool, then the normaliser with this path):

```tsx
"use client";

// Forecast section body (MR 3; forecast-switch spec B): banners, the role-mix
// disclosure, then the forecast ROW — the chosen card (30% from `xl`) beside the
// chart column the caller passes in — and whatever the caller mounts under the
// row at full width. Owns the disclosure's open state, the focus nonce the
// banner action bumps, and the device setting that picks the card (read and
// written through `useSettings` with a FUNCTIONAL setter, as the chart's own
// switches are), so the Budget report panel stays an orchestrator (plan
// Ruling 10) and keeps owning the chart's data wiring.
// Below `xl` (1280px) the row stacks card-then-chart in one column.
import { useState, type ReactNode } from "react";
import type { Lang } from "./i18n";
import type { PlanGranularity } from "./types";
import type { ForecastBundle } from "./budget-forecast-bundle";
import { useSettings } from "./use-settings";
import { ForecastBanners } from "./budget-forecast-banner";
import { ForecastCards, type ForecastView } from "./budget-forecast-cards";
import { RateMixDetails } from "./budget-rate-mix-details";

export function ForecastSection({
  lang, bundle, granularity, chart, belowRow = null,
}: {
  lang: Lang; bundle: ForecastBundle; granularity: PlanGranularity;
  /** The chart column's content; the caller keeps owning the chart's data wiring. */
  chart: ReactNode;
  /** Full-width content under the row (the Budget report's recorded-change table). */
  belowRow?: ReactNode;
}) {
  const [mixOpen, setMixOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const { settings, setSettings } = useSettings();
  const view: ForecastView = settings.budgetForecastView ?? "pace";
  const { eur, hours, mix, history } = bundle;
  const showMix = () => {
    setMixOpen(true);
    setFocusNonce((n) => n + 1);
  };
  return (
    <div className="space-y-3">
      <ForecastBanners lang={lang} forecast={eur} hours={hours} mix={mix} granularity={granularity} onShowMix={mix ? showMix : undefined} />
      {mix ? (
        <RateMixDetails lang={lang} mix={mix} eur={eur} hours={hours} open={mixOpen} onToggle={setMixOpen} focusNonce={focusNonce} />
      ) : null}
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="xl:w-[30%]">
          <ForecastCards
            lang={lang} forecast={eur} hours={hours} mix={mix} history={history}
            view={view}
            onViewChange={(v) => setSettings((s) => ({ ...s, budgetForecastView: v }))}
          />
        </div>
        <div className="min-w-0 flex-1">{chart}</div>
      </div>
      {belowRow}
    </div>
  );
}
```

(b) In `src/app/budget-report-panel.tsx`, with the Edit tool, replace

```tsx
import { BurndownChartPanel } from "./burndown-chart-panel";
```

with

```tsx
import { BurndownChartPanel, BurndownChangeTableBlock } from "./burndown-chart-panel";
```

and replace the two sections (from `      <Section title={t(lang, "forecastTitle")}>` through the closing `</Section>` of the `budgetBurndownTitle` section — the block that ends with the `dashboardBurnCaption` paragraph and `      </Section>`) with:

```tsx
      {/* Spec B, Decision 6: ONE Forecast section — banners, the rate-mix note,
          a row with the chosen card (30%) beside the chart (70%), then the
          recorded-change table at full width below the row. */}
      <Section title={t(lang, "forecastTitle")}>
        <ForecastSection
          lang={lang}
          bundle={bundle}
          granularity={plan.granularity}
          chart={
            <>
              <BurndownChainWarning lang={lang} chain={bucketChain} />
              {/* ★★ EUR, not `plan.currency`: `computeBurndownSeries` builds every
                  value as `budgetHours × role.rates.external` and converts NOTHING,
                  and the engine's money unit is EUR (a fixed-price bucket's contract
                  amount is converted to EUR at `computeBucketReport`'s one read). The
                  `money` helper above already hardcodes EUR for the cost/EVM tiles,
                  which are rate-derived in exactly the same way — this chart was the
                  one figure in the file still labelled otherwise (open-followups
                  §465). ★ Contrast `budget-panel.tsx`'s per-bucket tiles, which
                  convert EUR→bucket currency BEFORE labelling and so correctly use
                  the bucket's own currency.
                  The change table is DETACHED: at 70% of even a wide viewport the
                  chart is near its 640px floor, so the panel's `2xl` side-by-side
                  placement is unreachable here, and the table goes full width
                  below the row instead (spec B, Decision 7). */}
              <BurndownChartPanel lang={lang} series={burndown} bundle={bundle} today={today} planEnd={plan.endDate} currency="EUR" detachChangeTable />
              <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
            </>
          }
          belowRow={<BurndownChangeTableBlock lang={lang} series={burndown} bundle={bundle} currency="EUR" />}
        />
      </Section>
```

(c) Remove `budgetBurndownTitle`. In `src/app/i18n.ts`, with the Edit tool, replace

```ts
  budgetPeopleFigureHint: "Booked / planned hours",
  budgetBurndownTitle: "Burn-down",
```

with

```ts
  budgetPeopleFigureHint: "Booked / planned hours",
```

For `src/app/i18n.de.ts`, save as `de-drop-burndown-title.mjs` in your scratchpad directory and run `node <that path>`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const p = "C:/Projects/aipm-cockpit/src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
const line = '\r\n  budgetBurndownTitle: "Burn-down",';
const i = s.indexOf(line);
if (i < 0 || s.indexOf(line, i + 1) >= 0) { console.log("ANCHOR", i); process.exit(1); }
s = s.slice(0, i) + s.slice(i + line.length);
writeFileSync(p, s, "utf8");
console.log("bare LF count (must be 0):", (s.match(/(?<!\r)\n/g) || []).length);
```

Verify:

```bash
grep -rn "budgetBurndownTitle" src e2e; echo "GREP_EXIT=$?"   # expect no lines, GREP_EXIT=1
git ls-files --eol src/app/i18n.de.ts src/app/i18n.ts src/app/budget-forecast-section.tsx   # expect w/crlf
grep -c "Verbleibende Stunden" src/app/i18n.de.ts             # expect 1 (the next line survived)
```

(d) Document it. In `docs/AGENTS/dashboard.md`, directly after the paragraph that begins `★ **Chart/table split and EV availability (§549):**` (and before the one that begins `★ **The chart's hover/keyboard readout:**`), add this paragraph with the Edit tool:

```markdown
★ **The Budget report's forecast row (forecast-switch spec B):** the report has ONE Forecast section.
`ForecastSection` reads the device setting `budgetForecastView` (validated on load in `use-settings.ts`
beside `budgetChartView`) and `ForecastCards` renders ONE card, picked by a `SegmentedControl` that heads
the card COLUMN — never the card itself, because the two cards are different components and a switch inside
either would unmount on every change, dropping keyboard focus to `<body>`. The chosen card's title carries
a `RagBadge` from `paceVacHealth` over that card's own VAC, with NO `title` prop, so its accessible name is
the health word. The report passes the chart column in as `chart`, with `BurndownChartPanel`'s
`detachChangeTable` set, and mounts `BurndownChangeTableBlock` as `belowRow`, so the recorded-change table
spans the section under the row; both go through one `changeTableFor` rule. The dashboard tile passes
neither prop and is unchanged. ★ jsdom has no layout: the 30/70 split and the `xl` breakpoint are pinned
only by class assertions in `budget-forecast-section.test.tsx` and `budget-report-panel.test.tsx`; the
geometry itself is checked by eye and by the two Reports visual baselines.
```

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.test.tsx src/app/budget-forecast-cards.test.tsx src/app/burndown-chart-panel.test.tsx src/app/i18n-encoding.test.ts src/app/i18n.test.ts > /tmp/fsw-t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/fsw-t4.log
npx tsc --noEmit > /tmp/fsw-tsc4.log 2>&1; echo "TSC_EXIT=$?"; tail -5 /tmp/fsw-tsc4.log
npx eslint --max-warnings=0 src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts; echo "LINT_EXIT=$?"
npm run docs:symbols:check > /tmp/fsw-ds.log 2>&1; echo "DOCS_SYM_EXIT=$?"; tail -3 /tmp/fsw-ds.log
npm run docs:claims:check > /tmp/fsw-dc.log 2>&1; echo "DOCS_CLAIM_EXIT=$?"; tail -3 /tmp/fsw-dc.log
```
Expected: EXIT=0 with `Test Files  6 passed (6)`; TSC_EXIT=0 (also proves the DE deletion kept key parity); LINT_EXIT=0; both docs gates EXIT=0 (every backticked mixed-case name in the new paragraph exists in `src` after Tasks 1–3; the paragraph cites no `path:LINE`).

- [ ] **Step 6: Mutation-check the row**

1. In `ForecastSection`, swap the two row children (chart column first, card column second). Run the Step 5 vitest command: expected EXIT=1 on the "card first" tests in both files. Revert.
2. Move `{belowRow}` inside the row, after the chart column. Run: expected EXIT=1 on "renders belowRow after the row" and on the report's "full width below the row". Revert.

Then `git diff --stat` — expected: exactly the seven files in this task's **Files** block.

- [ ] **Step 7: Commit**

```bash
git add src/app/budget-forecast-section.tsx src/app/budget-forecast-section.test.tsx src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts docs/AGENTS/dashboard.md
git commit -F - <<'EOF'
feat(budget-report): merge forecast and burn-down into one Forecast section

The section now reads banners, the rate-mix note, then a row with the chosen
card at 30% beside the chart at 70% from xl (stacking below it), then the
recorded-change table at full width below the row. The chart column keeps
the chain warning above the chart and the caption under it. The report
keeps owning the chart's data wiring and passes it in; the panel's table is
detached and mounted below the row instead. The Burn-down section and its
now-unread heading key are gone. The dashboard subsystem doc records the
switch placement rule and the detached table.
EOF
```

---

## Task 5: Browser verification and the Reports visual baselines

**Files:**
- Modify (comment only): `e2e/visual.spec.ts`
- Regenerate: `e2e/visual.spec.ts-snapshots/reports-budget-history-visual-win32.png`, `e2e/visual.spec.ts-snapshots/reports-budget-changes-visual-win32.png`

**Interfaces:** consumes the finished feature from Tasks 1–4; produces nothing new.

- [ ] **Step 1: Run the Reports axe scans and the two e2e specs that drive this surface**

One Playwright invocation (chaining separate invocations can attach to a dev server the previous one is still releasing, which reads as `Received: 0`):

```bash
npx playwright test e2e/a11y.spec.ts e2e/budget-chart-readout.spec.ts e2e/seed-content.spec.ts --project=chromium -g "Reports|budget chart" --workers=1 > /tmp/fsw-e1.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/fsw-e1.log
```
Expected: EXIT=0. This is a superset of `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports" --workers=1`: it adds the chart readout spec (the chart it hovers is now 70% wide) and the seeded-history spec (the change table it reads now sits below the row). Confirm the log lists the Reports a11y tests by name as passed — a `-g` that matched nothing also exits 0. A local timeout is contention, not a violation (`--workers=1` is already set); a real violation names its axe rule. If a scan fails on the new radiogroup or badge, the fix belongs in Task 2's code — fix it there, re-run Task 2's gates, and commit it as its own `fix(forecast): …` commit.

- [ ] **Step 2: Correct the stale comment in the visual spec**

In `e2e/visual.spec.ts`, with the Edit tool, replace

```ts
// e2e/seed.ts authors. At this 1440px viewport the table sits BELOW the chart
// (`BurndownChartPanel` places it beside the chart only from `2xl`).
```

with

```ts
// e2e/seed.ts authors. The Budget report puts the table full width BELOW its
// forecast row (card 30% beside chart 70% from `xl`, so side by side at this
// 1440px viewport), not inside `BurndownChartPanel` — the report sets its
// `detachChangeTable` and mounts `BurndownChangeTableBlock` under the row.
```

- [ ] **Step 3: Watch the two Reports baselines fail, and look at why**

```bash
npx playwright test --project=visual -g "Reports budget history" > /tmp/fsw-v1.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/fsw-v1.log
```
Expected: EXIT=1 with both `reports-budget-history.png` and `reports-budget-changes.png` differing — the chart column narrowed to 70% and the table's container moved. Open the `*-actual.png` and `*-diff.png` files the log names under `test-results/` (the Read tool shows images) and check by eye, against the spec's Layout sketch:
- the chart capture shows the same series, markers and labels as the old baseline, only narrower, with no clipped labels and no text below about 8px;
- the table capture shows every row and split row, no truncated figures, no horizontal scroll bar.

If either fails the eye check, stop: that is a defect in Tasks 2–4, not a baseline to refresh.

- [ ] **Step 4: Refresh the two baselines deliberately, then prove the others did not move**

```bash
npx playwright test --project=visual -g "Reports budget history" --update-snapshots > /tmp/fsw-v2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/fsw-v2.log
npx playwright test --project=visual > /tmp/fsw-v3.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/fsw-v3.log
git status --porcelain e2e/visual.spec.ts-snapshots
```
Expected: both EXIT=0. The full visual run re-checks the dashboard, Gantt and Open Points baselines UNCHANGED — the dashboard does not render `ForecastCards` and passes neither new prop, so a dashboard diff is a defect. `git status` lists exactly the two Reports PNGs as modified. Re-open the two refreshed PNGs once more before staging.

- [ ] **Step 5: Run the remaining cheap gates**

```bash
npm run size:check > /tmp/fsw-size.log 2>&1; echo "SIZE_EXIT=$?"; tail -3 /tmp/fsw-size.log
npm run dup:check > /tmp/fsw-dup.log 2>&1; echo "DUP_EXIT=$?"; tail -3 /tmp/fsw-dup.log
npm run docs:symbols:check > /tmp/fsw-ds2.log 2>&1; echo "DOCS_SYM_EXIT=$?"
npm run docs:claims:check > /tmp/fsw-dc2.log 2>&1; echo "DOCS_CLAIM_EXIT=$?"
npx eslint --max-warnings=0 e2e/visual.spec.ts; echo "LINT_EXIT=$?"
```
Expected: every EXIT=0. The whole-repo unit gates (`npm run test:run`, `npm run test:shuffle`, `npm run test:coverage`) are deliberately NOT run here — they run once, at the end, when the user says so.

- [ ] **Step 6: Confirm the tree, then commit**

```bash
git status --porcelain
git diff --stat
```
Expected: `not-in-use.env.local.bak` untracked (never opened or staged) and, modified, only `e2e/visual.spec.ts` and the two Reports PNGs.

```bash
git add e2e/visual.spec.ts e2e/visual.spec.ts-snapshots/reports-budget-history-visual-win32.png e2e/visual.spec.ts-snapshots/reports-budget-changes-visual-win32.png
git commit -F - <<'EOF'
test(visual): refresh the Reports budget baselines for the forecast row

The chart now sits in the forecast row's 70% column and the change table
below the whole row, so both Reports captures change; both were checked by
eye before the refresh, and the dashboard, Gantt and Open Points baselines
were re-run unchanged. The spec comment no longer says the chart panel
places the table.
EOF
```

- [ ] **Step 7: Report**

Quote every EXIT above, the Test Files counts from Tasks 1–4, the mutation outcomes, and the eye-check notes for both PNGs. Do not push, tag or open a merge request — those wait for an explicit instruction.

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Decision 1 — one card at a time, `SegmentedControl`, no hand-rolled control | Task 2 (placed at the column head, not inside the card — ruling in Task 2) |
| Decision 2 — `settings.budgetForecastView`, default `"pace"`, beside the chart-view setting; print shows the chosen card | Task 1 (type, default, load validation); Task 2 (section reads/writes it; switch `print:hidden`, card prints) |
| Decision 3 — `RagBadge` after the title from `paceVacHealth` over the card's own VAC; none when null or unavailable | Task 2 (`VacBadge`, five badge tests, mutation 1) |
| Decision 4 — an unavailable forecast still opens | Task 2 ("an unavailable forecast still opens" + the migrated efficiency-reason tests) |
| Decision 5 — chart keeps both forecast lines | No code change; Task 2's breakage sweep KEEPs the chart/readout tests that assert both lines |
| Decision 6 — one Forecast section: banners → rate mix → row (card 30 / chart 70) → gap line under the card → table full width → caption | Task 4 (caption ruling: under the chart, three of the spec's four statements); gap line under the card is Task 2 (`ForecastCards` renders it in the card column) |
| Decision 7 — table never beside the row | Task 3 (`detachChangeTable`, `BurndownChangeTableBlock`); Task 4 (`belowRow`, report test) |
| Decision 8 — row stacks below `xl` | Task 4 (`flex flex-col … xl:flex-row` class pin) |
| Decision 9 — dashboard untouched | Task 3 (default `false`; compact test KEEP); Task 5 Step 4 (dashboard visual baseline unchanged) |
| Layout classes `xl:w-[30%]` / `min-w-0 flex-1` | Task 4 (section and report tests pin both) |
| Components — `settings-types.ts` + sanitiser | Task 1 (validation lives in `use-settings.ts`, per the verified correction) |
| Components — i18n group label + two option labels | Task 2 (`forecastViewLabel` new; options reuse `forecastPaceTitle`/`forecastEfficiencyTitle`, justified there) |
| Accessibility — group name, label-in-name, badge in words, `TermTooltip`s as siblings, switch `print:hidden` | Task 2 (group/label-in-name/print tests; badge by name; `TermTooltip` markup untouched and the tooltip-uniqueness tests migrated per view) |
| Testing — cards: both options, only chosen body, badge G/A/R + null, unavailable efficiency, gap unchanged | Task 2 Step 1 |
| Testing — settings round-trip (default, persistence, junk) | Task 1 Step 1 |
| Testing — report: one Forecast section, row order, table below, caption under chart | Task 4 Step 2 |
| Testing — panel stacked-only prop + dashboard default unchanged | Task 3 Step 1 |
| Testing — toolbar-order helper where buttons are involved | Not applicable: no toolbar or trailing Print/reset group is touched; the new control is a radiogroup, whose order is pinned by the row tests |
| Testing — axe on Reports | Task 5 Step 1 |
| Testing — both Reports visual baselines refreshed deliberately, eyeballed | Task 5 Steps 3–4 |
| Out of scope — arithmetic, thresholds, what the chart draws, the dashboard | No task touches `budget-forecast.ts`, `burndown-geometry.ts`, `burndown-chart.tsx` or any dashboard file |

**Placeholders:** none — every code step carries its code and every run step its command and expected result. None is conditional.

**Type consistency:** `ForecastView` (Task 2, exported from `budget-forecast-cards.tsx`) is the type `ForecastSection` uses in Tasks 2 and 4 and matches `Settings.budgetForecastView`'s literal union from Task 1. `ForecastCards`' `view`/`onViewChange` (Task 2) are what the section passes in both versions. `detachChangeTable` and `BurndownChangeTableBlock` (Task 3) are the names the report uses in Task 4 and the doc paragraph names. `forecastViewLabel` (Task 2) is the key the Task 2 and Task 4 tests read. `budgetBurndownTitle` is removed in Task 4 in the same commit as its last two readers.

**Rulings where the spec was false or ambiguous:**
1. The Components table puts validation in a `settings-types.ts` sanitiser; it lives in `use-settings.ts` (verified correction) — Task 1 follows the code.
2. "A prop that keeps the table below" cannot deliver Decisions 6–7, because the panel sits in the 70% column — Task 3 detaches the table instead.
3. "Switch in the card's header" would unmount the focused radio on every change — Task 2 puts it at the head of the card column, pinned by a focus test.
4. The caption's position disagrees between Decision 6 and the rest of the spec — Task 4 keeps it under the chart.
5. `RagBadge`'s "own label states the health in words" holds only without a `title` (a `title` replaces the word) — Task 2 passes none, and says why in the code.
6. `BurndownChainWarning`'s place is unspecified — Task 4 heads the chart column with it, as the dashboard tile does.
