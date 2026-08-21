# Dashboard Bento Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `dashboard-panel.tsx` from a flat 12-section vertical stack into a 3-tier bento layout (context banner / needs-you hero / detail bento / folded tier) to cut scroll, use wide-screen width, and strengthen hierarchy — with no change to data, engine, or public props.

**Architecture:** Layout-only refactor. Extract two cohesive blocks into `dashboard-sections/` presentational slices (`dashboard-narrative.tsx`, `dashboard-hero.tsx`); regroup the rest inline into tier wrappers + one bento grid. `dashboard-panel.tsx` stays the orchestrator (all hooks/derivation unchanged). `DashboardPanelProps` is unchanged, so the ~30 caller/test render sites need no edits.

**Tech Stack:** React 19 / TS / Tailwind v4 (forked Next.js 16). vitest + @testing-library/react. Playwright axe gate.

**Spec:** `docs/superpowers/specs/2026-06-28-dashboard-bento-layout-design.md`

---

## Conventions (read before every task)

- **Lint is fatal** (`--max-warnings=0`): an unused/orphaned import after moving JSX FAILS CI. After each task run `npm run lint` and delete now-unused imports from `dashboard-panel.tsx`.
- **tsc after any test edit:** `npx tsc --noEmit` (test-only type errors pass vitest+build but fail CI).
- **Spacing via `dc.*` only** (`dc.outer`/`dc.kpiGap`/`dc.cardPad`/`dc.sectionGap`) — never a literal `gap-*`/`space-y-*`/`p-*` on a cockpit slice (compact mode ignores literals).
- **`set-state-in-effect` is BANNED.** The narrative draft re-seed uses the render-time reconcile (`if (stored !== prev) { setPrev(...); setDraft(...) }`), NOT a useEffect.
- **Dashboard ∈ axe `A11Y_VIEWS`.** New `<details>`/`<summary>` need visible text (they have it). No `aria-label` on a bare non-interactive `<div>` (dead-label landmine).
- **Run a step's test BEFORE its implementation** to watch it fail (TDD).
- Test command for one file: `npm run test:run -- src/app/<file>`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/dashboard-sections/dashboard-narrative.tsx` | `NarrativeSummary` (Tier 0 read-only) + `NarrativeEditor` (Tier 3 folded editor; owns draft state/autogrow/reconcile) | **Create** |
| `src/app/dashboard-sections/dashboard-narrative.test.tsx` | Unit tests for the two narrative components | **Create** |
| `src/app/dashboard-sections/dashboard-hero.tsx` | Tier 1: compact Overall RAG band + Adjust-health `<details>` + KPI strip + Top-actions card. `OverrideSelect` moves here | **Create** |
| `src/app/dashboard-sections/dashboard-hero.test.tsx` | Unit tests for the hero | **Create** |
| `src/app/dashboard-panel.tsx` | Orchestrator; renders the 4 tiers; Tier-2 bento grid inline | **Modify** |
| `src/app/dashboard-panel.test.tsx` | Migrate narrative tests out; add tier-order + bento tests | **Modify** |
| `src/app/dashboard-sections/registers-band.tsx` | — | Unchanged |

---

## Task 1: Narrative slice (read-only summary + folded editor)

Pull the narrative state + JSX out of `dashboard-panel.tsx` into a new slice. Read-only summary renders at the top; the editor folds into a `<details>`.

**Files:**
- Create: `src/app/dashboard-sections/dashboard-narrative.tsx`
- Create: `src/app/dashboard-sections/dashboard-narrative.test.tsx`
- Modify: `src/app/dashboard-panel.tsx` (remove narrative state/handlers/effect + the inline `<Section>` narrative block; render `<NarrativeSummary>` and `<NarrativeEditor>`)
- Modify: `src/app/dashboard-panel.test.tsx` (remove the panel-level narrative describe blocks — they move to the slice test)

- [ ] **Step 1: Write the failing slice test**

Create `src/app/dashboard-sections/dashboard-narrative.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ProjectStatus } from "../types";
import { NarrativeSummary, NarrativeEditor } from "./dashboard-narrative";

describe("NarrativeSummary", () => {
  it("renders the saved narrative text + updated date", () => {
    render(
      <NarrativeSummary
        lang="en-US"
        status={{ narrative: "All on track", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("renders nothing when the narrative is empty", () => {
    const { container } = render(<NarrativeSummary lang="en-US" status={{}} />);
    expect(container.firstChild).toBeNull();
  });
});

// A host that owns ProjectStatus state so the editor's commit/clear + the
// render-time reconcile run against a real setState (mirrors WorkspaceProvider).
function EditorHost({ initial = "" }: { initial?: string }) {
  const [status, setStatus] = useState<ProjectStatus>({ narrative: initial });
  return <NarrativeEditor lang="en-US" status={status} setStatus={setStatus} />;
}

describe("NarrativeEditor", () => {
  it("renders the editor inside a foldable details with the Status summary label", () => {
    render(<EditorHost />);
    const summary = screen.getByText("Status summary");
    expect(summary.closest("details")).not.toBeNull();
  });

  it("commits via Save and Clear empties the textarea", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    // Open the disclosure so the editor is interactive.
    await user.click(screen.getByText("Status summary"));
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Weekly note");
    await user.click(screen.getByRole("button", { name: /save/i }));
    const clear = screen.getByRole("button", { name: /clear/i });
    expect(clear).not.toBeDisabled();
    await user.click(clear);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("grows the textarea to scrollHeight on input (autogrow)", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 173 });
    await user.type(textarea, "a\nb\nc");
    expect(textarea.style.height).toBe("173px");
  });

  it("Clear is disabled when the narrative is already empty", () => {
    render(<EditorHost />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:run -- src/app/dashboard-sections/dashboard-narrative.test.tsx`
Expected: FAIL — `Cannot find module './dashboard-narrative'`.

- [ ] **Step 3: Create the slice**

Create `src/app/dashboard-sections/dashboard-narrative.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { TRANSITION, FOCUS_RING, INTERACTIVE } from "../interaction-styles";
import type { ProjectStatus } from "../types";

/** Read-only exec-summary of the saved status narrative (Tier 0). Renders null
 *  when empty so a blank project shows nothing up top. Plain text — no
 *  aria-label on the wrapper (dead-label landmine). */
export function NarrativeSummary({ lang, status }: { lang: Lang; status: ProjectStatus }) {
  const text = (status.narrative ?? "").trim();
  if (!text) return null;
  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
      <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
      {status.narrativeUpdatedAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
        </p>
      ) : null}
    </div>
  );
}

/** Folded status-summary editor (Tier 3). Owns the draft + autogrow + the
 *  render-time reconcile that re-seeds the draft when an external workspace
 *  reload changes status.narrative (NOT a useEffect — set-state-in-effect is
 *  banned). */
export function NarrativeEditor({
  lang, status, setStatus,
}: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
}) {
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(status.narrative ?? "");
  const [draftNarrative, setDraftNarrative] = useState(status.narrative ?? "");

  const storedNarrative = status.narrative ?? "";
  if (storedNarrative !== prevStoredNarrative) {
    setPrevStoredNarrative(storedNarrative);
    setDraftNarrative(storedNarrative);
  }

  const narrativeRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeNarrative = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    if (narrativeRef.current) resizeNarrative(narrativeRef.current);
  }, [draftNarrative]);

  const commitNarrative = () => {
    const trimmed = draftNarrative.trim();
    if (trimmed === (status.narrative ?? "")) return;
    setStatus((s) => ({ ...s, narrative: trimmed, narrativeUpdatedAt: new Date().toISOString() }));
  };

  const clearNarrative = () => {
    setDraftNarrative("");
    if ((status.narrative ?? "") !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    }
    if (narrativeRef.current) resizeNarrative(narrativeRef.current);
  };

  return (
    <details className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)] print:hidden">
      <summary className={`cursor-pointer text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey ${FOCUS_RING}`}>
        {t(lang, "dashboardStatusSummary")}
      </summary>
      <div className="mt-2">
        <textarea
          ref={narrativeRef}
          className={`min-h-24 w-full resize-none rounded-md border border-line bg-surface p-2 text-sm ${TRANSITION} ${FOCUS_RING}`}
          placeholder={t(lang, "dashboardNarrativePlaceholder")}
          value={draftNarrative}
          onChange={(e) => setDraftNarrative(e.target.value)}
          onInput={(e) => resizeNarrative(e.currentTarget)}
          onBlur={commitNarrative}
        />
        <div className="mt-2 flex justify-end gap-2 print:hidden">
          <button
            type="button"
            onClick={commitNarrative}
            disabled={draftNarrative.trim() === (status.narrative ?? "")}
            className={`rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "dashboardStatusSave")}
          </button>
          <button
            type="button"
            onClick={clearNarrative}
            onMouseDown={(e) => e.preventDefault()}
            disabled={(status.narrative ?? "") === "" && draftNarrative === ""}
            className={`rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            {t(lang, "dashboardStatusClear")}
          </button>
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run slice test — expect PASS**

Run: `npm run test:run -- src/app/dashboard-sections/dashboard-narrative.test.tsx`
Expected: PASS (all 6).

- [ ] **Step 5: Wire into the panel + remove old narrative code**

In `src/app/dashboard-panel.tsx`:

1. Add import near the other `dashboard-sections` imports:
   ```tsx
   import { NarrativeSummary, NarrativeEditor } from "./dashboard-sections/dashboard-narrative";
   ```
2. DELETE the narrative state/handlers/effect block — these lines:
   ```tsx
   const [prevStoredNarrative, setPrevStoredNarrative] = useState(status.narrative ?? "");
   const [draftNarrative, setDraftNarrative] = useState(status.narrative ?? "");
   const storedNarrative = status.narrative ?? "";
   if (storedNarrative !== prevStoredNarrative) { ... }
   const narrativeRef = useRef<HTMLTextAreaElement | null>(null);
   const resizeNarrative = (el) => { ... };
   useEffect(() => { if (narrativeRef.current) resizeNarrative(narrativeRef.current); }, [draftNarrative]);
   const commitNarrative = () => { ... };
   const clearNarrative = () => { ... };
   ```
3. Add `<NarrativeSummary lang={lang} status={status} />` immediately AFTER `<DashboardDeltaStrip … />` (Tier 0).
4. REPLACE the entire `{/* Narrative */} <Section title={t(lang, "dashboardStatusSummary")}> … </Section>` block with:
   ```tsx
   {/* Narrative editor (folded) */}
   <NarrativeEditor lang={lang} status={status} setStatus={setStatus} />
   ```
   (Final tier placement happens in Task 4; leaving it in-place here keeps this task's diff focused.)
5. Remove now-unused imports flagged by lint (likely `useRef`, `useEffect` may still be used by completion-trend? No — completion-trend uses `useMemo`; check. `Section` is still used elsewhere. Run lint to see.)

- [ ] **Step 6: Migrate panel narrative tests**

In `src/app/dashboard-panel.test.tsx`, DELETE these describe blocks (now covered by the slice test):
- `describe("DashboardPanel status narrative layout (Task 2)", …)`
- `describe("DashboardPanel status narrative Clear button", …)`

And from `describe("DashboardPanel RAG polish (Task 3)", …)` DELETE the test `it("commits the narrative via the Save button and shows the updated label", …)` (its Save/commit path is covered by the slice test, and the editor is now folded so the textarea is not open at render).

- [ ] **Step 7: Run the panel test + lint + tsc**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: PASS (remaining describes green).
Run: `npm run lint` → 0 warnings. Run: `npx tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard-sections/dashboard-narrative.tsx src/app/dashboard-sections/dashboard-narrative.test.tsx src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "refactor(dashboard): extract narrative summary + folded editor slice"
```

---

## Task 2: Extract the Tier-1 hero (Overall RAG band + KPIs + Top actions)

Move the Overall-RAG band, the Adjust-health `<details>`, the KPI strip, and the Top-actions card into one presentational slice. `OverrideSelect` moves with it. Keep the Overall-band markup byte-identical (a panel test asserts the report-date `previousElementSibling` chain).

**Files:**
- Create: `src/app/dashboard-sections/dashboard-hero.tsx`
- Create: `src/app/dashboard-sections/dashboard-hero.test.tsx`
- Modify: `src/app/dashboard-panel.tsx`

- [ ] **Step 1: Write the failing hero test**

Create `src/app/dashboard-sections/dashboard-hero.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ProjectStatus } from "../types";
import { computeDashboard, buildDashboardInput } from "../dashboard";
import { densityClasses } from "../dashboard-density";
import { computeMetricTrends } from "../dashboard-trends";
import { DashboardHero } from "./dashboard-hero";

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" };

function model() {
  return computeDashboard(
    buildDashboardInput(
      { tasks: [], raid: [], budgets: [], plan, roles: [], resources: [], absences: [], milestones: [], changes: [] },
      { workdayHours: 8, holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02" },
    ),
  );
}

const trends = computeMetricTrends(undefined, { complete: 0, overdue: 0, openRaid: 0 });

function Host(props: { topActions?: never[] }) {
  const [status, setStatus] = useState<ProjectStatus>({});
  return (
    <DashboardHero
      lang="en-US"
      today="2026-06-02"
      model={model()}
      trends={trends}
      status={status}
      setStatus={setStatus}
      topActions={props.topActions}
      onOpenAction={vi.fn()}
      onNavigate={vi.fn()}
      showBudget
      showChanges
      dc={densityClasses("comfortable")}
    />
  );
}

describe("DashboardHero", () => {
  it("renders the Overall band, the 3 KPI tiles, and the Adjust-health disclosure", () => {
    render(<Host />);
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Complete – Open the tasks list/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open RAID –/ })).toBeInTheDocument();
    expect(screen.getByText("Adjust health ratings").closest("details")).not.toBeNull();
  });

  it("writes an override via the Overall select", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByText("Adjust health ratings"));
    // The Overall override select is the first combobox in the disclosure.
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    await user.selectOptions(select, "R");
    // setStatus drove status.ragOverride; OverrideSelect reads value from props.status,
    // so the controlled select now reflects "R" (proves the write path is wired).
    expect(select.value).toBe("R");
  });

  it("renders the Top actions heading only when topActions has items", () => {
    const { rerender } = render(<Host />);
    expect(screen.queryByText("Top actions")).toBeNull();
    rerender(<Host topActions={[]} />);
    expect(screen.queryByText("Top actions")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:run -- src/app/dashboard-sections/dashboard-hero.test.tsx`
Expected: FAIL — `Cannot find module './dashboard-hero'`.

- [ ] **Step 3: Create the hero slice**

Create `src/app/dashboard-sections/dashboard-hero.tsx`. Move the `OverrideSelect` helper from `dashboard-panel.tsx` verbatim, then assemble the Tier-1 JSX (lifted verbatim from the current panel: the Overall band at panel lines ~422–480, the KPI strip ~343–367, and the Top-actions section ~408–420):

```tsx
"use client";

import type { Dispatch, SetStateAction } from "react";
import { KpiGradientBar, Tile } from "../report-table";
import { type Lang, t } from "../i18n";
import { healthColorName, healthText, type Health } from "../health";
import { RagBadge } from "../rag-badge";
import { ActionRow } from "../action-row";
import { TrendArrow } from "../trend-arrow";
import { TRANSITION, FOCUS_RING } from "../interaction-styles";
import type { DashboardModel } from "../dashboard";
import type { MetricKey, MetricTrend } from "../dashboard-trends";
import type { ProjectStatus } from "../types";
import type { SuggestedAction } from "../next-actions/types";
import type { DensityClasses } from "../dashboard-density";
import type { AppView } from "../nav-config";
import type { SettingsSectionId } from "../dashboard-coaching";

function OverrideSelect({
  lang, label, value, computed, effective, onChange,
}: {
  lang: Lang;
  label: string;
  value: "R" | "A" | "G" | undefined;
  computed: Health | null;
  effective: Health | null;
  onChange: (v: "R" | "A" | "G" | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <RagBadge value={effective} lang={lang} title={`${label}: ${effective ? healthColorName(effective, lang) : "—"}`} />
      <span className="font-medium">{label}</span>
      <select
        className={`rounded border border-line bg-surface px-1.5 py-0.5 text-sm print:hidden ${TRANSITION} ${FOCUS_RING}`}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as "R" | "A" | "G" | undefined)}
      >
        <option value="">{computed ? t(lang, "dashboardComputedHint", healthColorName(computed, lang)) : t(lang, "dashboardScopeUnset")}</option>
        <option value="R">{healthColorName("R", lang)}</option>
        <option value="A">{healthColorName("A", lang)}</option>
        <option value="G">{healthColorName("G", lang)}</option>
      </select>
      <span className="hidden text-muted-foreground print:inline">
        {effective ? healthColorName(effective, lang) : "—"}
      </span>
    </label>
  );
}

export interface DashboardHeroProps {
  lang: Lang;
  today: string;
  model: DashboardModel;
  trends: Record<MetricKey, MetricTrend>;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  onNavigate?: (view: AppView, section?: SettingsSectionId) => void;
  showBudget: boolean;
  showChanges: boolean;
  dc: DensityClasses;
}

export function DashboardHero(props: DashboardHeroProps) {
  const { lang, today, model, trends, status, setStatus, topActions, onOpenAction, onNavigate, showBudget, showChanges, dc } = props;
  return (
    <div className={dc.outer}>
      {/* Overall band */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 text-2xl font-bold">
          <RagBadge value={model.overall.effective} lang={lang} />
          {t(lang, "dashboardOverall")}:{" "}
          <span className={model.overall.effective ? healthText[model.overall.effective] : ""}>
            {healthColorName(model.overall.effective, lang)}
          </span>
        </div>
        <span className="ml-auto text-sm text-muted-foreground">{t(lang, "dashboardReportDate", today)}</span>
        <details className="basis-full print:hidden">
          <summary className={`cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground ${TRANSITION} ${FOCUS_RING}`}>
            {t(lang, "dashboardAdjustHealth")}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <OverrideSelect lang={lang} label={t(lang, "dashboardOverall")} value={status.ragOverride} computed={model.overall.computed} effective={model.overall.effective} onChange={(v) => setStatus((s) => ({ ...s, ragOverride: v }))} />
            <OverrideSelect lang={lang} label={t(lang, "dashboardSubSchedule")} value={status.scheduleOverride} computed={model.schedule.computed} effective={model.schedule.effective} onChange={(v) => setStatus((s) => ({ ...s, scheduleOverride: v }))} />
            {showBudget && (
              <OverrideSelect lang={lang} label={t(lang, "dashboardSubBudget")} value={status.budgetOverride} computed={model.budget.computed} effective={model.budget.effective} onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))} />
            )}
            {showChanges && (
              <OverrideSelect lang={lang} label={t(lang, "dashboardSubScope")} value={status.scopeOverride} computed={null} effective={model.scope.effective} onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))} />
            )}
          </div>
        </details>
        <p className="basis-full text-xs text-muted-foreground">{t(lang, "dashboardRagThresholds")}</p>
      </div>

      {/* KPI strip + Top actions side-by-side on lg */}
      <div className={`grid grid-cols-1 lg:grid-cols-2 ${dc.sectionGap} items-start`}>
        <div className={`grid grid-cols-1 sm:grid-cols-3 ${dc.kpiGap}`}>
          <Tile
            label={t(lang, "dashboardKpiComplete")}
            value={`${model.progress.percent}%`}
            bar={<KpiGradientBar percent={model.progress.percent} label={t(lang, "dashboardKpiComplete")} />}
            trend={<TrendArrow trend={trends.complete} metricLabel={t(lang, "dashboardKpiComplete")} unit="%" lang={lang} />}
            onActivate={onNavigate ? () => onNavigate("open-points") : undefined}
            activateLabel={`${t(lang, "dashboardKpiComplete")} – ${t(lang, "dashboardOpenTasksView")}`}
          />
          <Tile
            label={t(lang, "dashboardKpiOverdue")}
            value={String(model.overdue.length)}
            trend={<TrendArrow trend={trends.overdue} metricLabel={t(lang, "dashboardKpiOverdue")} lang={lang} />}
            onActivate={onNavigate ? () => onNavigate("open-points") : undefined}
            activateLabel={`${t(lang, "dashboardKpiOverdue")} – ${t(lang, "dashboardOpenTasksView")}`}
          />
          <Tile
            label={t(lang, "dashboardKpiOpenRaid")}
            value={String(model.openRaidCount)}
            trend={<TrendArrow trend={trends.openRaid} metricLabel={t(lang, "dashboardKpiOpenRaid")} lang={lang} />}
            onActivate={onNavigate ? () => onNavigate("raid") : undefined}
            activateLabel={`${t(lang, "dashboardKpiOpenRaid")} – ${t(lang, "dashboardOpenRaidView")}`}
          />
        </div>

        {topActions && topActions.length > 0 ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "dashboardTopActions")}</h3>
            <div className="flex flex-col gap-2">
              {topActions.map((a) => (
                <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpenAction ?? (() => {})} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
```

NOTE: the hero KPI grid keeps its own `sm:grid-cols-3 ${dc.kpiGap}` exactly as today; the new `lg:grid-cols-2` wrapper places KPIs beside Top actions. When `topActions` is empty the right cell is absent and the KPI grid keeps its full width — acceptable.

- [ ] **Step 4: Run hero test — expect PASS**

Run: `npm run test:run -- src/app/dashboard-sections/dashboard-hero.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire hero into the panel + delete moved code**

In `src/app/dashboard-panel.tsx`:
1. Import: `import { DashboardHero } from "./dashboard-sections/dashboard-hero";`
2. DELETE the local `OverrideSelect` function (lines ~86–115).
3. DELETE the inline KPI strip (`{/* At-a-glance KPI strip … */}` grid), the Top-actions `<section>` (`{/* Top actions … */}`), and the Overall band `<div>` (`{/* Overall band */}` … through its closing `</div>` incl. the Adjust-health `<details>` and the thresholds `<p>`).
4. In their place (Tier-1 position, after the coaching card) render:
   ```tsx
   <DashboardHero
     lang={lang}
     today={today}
     model={model}
     trends={trends}
     status={status}
     setStatus={setStatus}
     topActions={topActions}
     onOpenAction={onOpenAction}
     onNavigate={props.onNavigate}
     showBudget={showBudget}
     showChanges={showChanges}
     dc={dc}
   />
   ```
5. Remove now-unused panel imports flagged by lint: `KpiGradientBar`, `TrendArrow`, `ActionRow`, `OverrideSelect`'s deps that are no longer used in the panel (`healthColorName` is still used? check — it's used only by OverrideSelect/band; if no other use, remove). Keep `RagBadge`, `healthText` (still used by progress/changes/burn tiles). Run lint to get the exact list.
6. The completion-sparkline block stays where it is for now (moves to the bento in Task 3).

- [ ] **Step 6: Run the panel test + lint + tsc**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: PASS — including `places the report-date text on the same row as the Overall label`, `renders the Trends toggle … NOT in the Overall band`, `renders the density toggle …`, the KPI click-through tests, and the Top-actions tests (markup preserved).
Run: `npm run lint` → 0. Run: `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard-sections/dashboard-hero.tsx src/app/dashboard-sections/dashboard-hero.test.tsx src/app/dashboard-panel.tsx
git commit -m "refactor(dashboard): extract Tier-1 hero (overall band + KPIs + top actions)"
```

---

## Task 3: Tier-2 detail bento (full-width Registers + one grid)

Collapse the two separate 2-col grids (Progress+Budget, Milestones+Changes) and the between-band into: a full-width `RegistersBand`, then ONE bento grid containing Progress · Budget burn · Milestones · Changes · Sparkline in that order.

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Add the failing bento test**

Append to `src/app/dashboard-panel.test.tsx`:

```tsx
describe("DashboardPanel Tier-2 bento", () => {
  it("renders Progress, Milestones, and Changes inside one lg:grid-cols-2 bento", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    const progress = screen.getByText("Progress");
    // Walk up to the bento grid container.
    const bento = progress.closest("div.lg\\:grid-cols-2");
    expect(bento).not.toBeNull();
    // Milestones + Changes live in the SAME bento grid.
    expect(bento!.textContent).toContain("Milestones");
    expect(bento!.textContent).toContain("Changes");
  });

  it("renders RegistersBand (Top open RAID) BEFORE the bento grid in DOM order", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    const registers = screen.getByText("Top open RAID");
    const progress = screen.getByText("Progress");
    expect(registers.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx -t "Tier-2 bento"`
Expected: FAIL — today Progress sits in a `md:grid-cols-2` (not `lg:`) and Milestones/Changes are in a separate grid.

- [ ] **Step 3: Restructure Tier 2 in the panel**

In `src/app/dashboard-panel.tsx`, replace the current sequence — the `{/* Progress + Budget burn */}` grid, the `<RegistersBand …/>`, and the `{/* Milestones + Changes … */}` grid — with this order (RegistersBand first, then one bento). Each card's inner JSX is MOVED unchanged from its current location in the same file (cut/paste, do not rewrite). Current source anchors to lift verbatim:
- Progress `<Section>` body — panel lines ~523–547
- Budget-burn `<Section>` body — panel lines ~548–597
- Milestones `<Section>` (the `<MilestoneHorizonStrip/>`) — panel lines ~613–617
- Changes `<Section>` body — panel lines ~618–656
- Completion-sparkline IIFE — panel lines ~370–406 (relocated DOWN into the bento)

Resulting structure (wrappers/order change only):

```tsx
{/* Tier 2 — operational core, full width */}
<RegistersBand
  lang={lang}
  topRaid={model.topRaid}
  overdue={model.overdue}
  dueSoon={model.dueSoon}
  onOpenRaid={onOpenRaid}
  onOpenTask={onOpenTask}
  showRaid={showRaid}
/>

{/* Tier 2 — detail bento */}
<div className={`grid grid-cols-1 lg:grid-cols-2 ${dc.sectionGap} items-start`}>
  <Section title={t(lang, "dashboardProgress")} boxed>
    {/* …existing Progress card body verbatim… */}
  </Section>
  {showBudget && (
    <Section title={t(lang, "dashboardBudgetBurn")} boxed>
      {/* …existing Budget-burn card body verbatim… */}
    </Section>
  )}
  {showMilestones && (
    <Section title={t(lang, "dashboardMilestones")} boxed>
      <MilestoneHorizonStrip lang={lang} buckets={milestoneBuckets} onOpenMilestone={props.onOpenMilestone} />
    </Section>
  )}
  {showChanges && (
    <Section title={t(lang, "dashboardChangesHeading")} boxed>
      {/* …existing Changes card body verbatim… */}
    </Section>
  )}
  {completionSeries.length >= 2 && (() => {
    {/* …existing completion-sparkline IIFE body verbatim (returns the button/div)… */}
  })()}
</div>
```

Notes:
- Move the completion-sparkline IIFE (currently above Top actions) DOWN into the bento as the last cell. Its body is unchanged; it already returns a single element. Wrap with `dc.cardPad` as today.
- The old `md:grid-cols-2` Progress+Budget grid and the `lg:grid-cols-2` Milestones+Changes grid are gone — both pairs now live in the single bento.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: PASS — the new Tier-2 tests + all module-gate tests (`Budget burn`, `Top open RAID`, `Milestones`, `Changes` still resolve by text), and `renders Top actions above the RAID registers band` (hero is above Tier 2).

- [ ] **Step 5: lint + tsc**

Run: `npm run lint` → 0. Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat(dashboard): Tier-2 detail bento (full-width registers + one grid)"
```

---

## Task 4: Tier assembly + fold Recent activity

Finalize tier order and fold Recent activity into a `<details>`. Move the `<NarrativeEditor>` to Tier 3.

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Add the failing fold test**

Append to `src/app/dashboard-panel.test.tsx`:

```tsx
describe("DashboardPanel Tier-3 folds", () => {
  it("folds Recent activity into a details disclosure", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    const heading = screen.getByText(t("en-US", "dashboardRecentActivity"));
    expect(heading.closest("details")).not.toBeNull();
  });

  it("renders the narrative editor (Status summary) AFTER the bento Progress card", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    const progress = screen.getByText("Progress");
    const editor = screen.getByText("Status summary");
    expect(progress.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx -t "Tier-3 folds"`
Expected: FAIL — Recent activity is currently a `<Section>` (no `<details>`), and the editor is above the bento (from Task 1's in-place placement).

- [ ] **Step 3: Reorder Tier 3 + fold Recent activity**

In `src/app/dashboard-panel.tsx`:
1. MOVE the `<NarrativeEditor lang={lang} status={status} setStatus={setStatus} />` from its Task-1 position down to the start of Tier 3 (after the Tier-2 bento).
2. REPLACE the `{/* Recent activity … */} <Section title={t(lang, "dashboardRecentActivity")} boxed> … </Section>` with a folded disclosure that keeps the same inner list:
   ```tsx
   <details className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
     <summary className={`cursor-pointer text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey ${TRANSITION} ${FOCUS_RING}`}>
       {t(lang, "dashboardRecentActivity")}
     </summary>
     <div className="mt-2">
       {/* …existing recent-activity body verbatim (EmptyState OR the <ul>)… */}
     </div>
   </details>
   ```
3. Confirm the final body order is: `<DashboardDeltaStrip/>` · `<NarrativeSummary/>` · `<DashboardCoachingCard/>` · `<DashboardHero/>` · `<RegistersBand/>` · bento grid · `<NarrativeEditor/>` · Recent-activity `<details>` · Trends widget.
4. Ensure `TRANSITION`/`FOCUS_RING` are still imported (used by the new summary).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: PASS — including the activity click-through tests (`task.created` row still found inside the closed `<details>`; jsdom keeps closed-details children in the DOM/role tree).

- [ ] **Step 5: lint + tsc**

Run: `npm run lint` → 0. Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat(dashboard): final tier order + fold Recent activity"
```

---

## Task 5: Full verification (suite + tsc + lint + axe)

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm run test:run`
Expected: PASS, no regressions vs the pre-change count.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → 0 warnings.

- [ ] **Step 3: axe gate for the Dashboard (real browser)**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`
Expected: PASS (covers AIPM-light, AIPM-dark, Mockup-light). The unit suite never runs Playwright, so this is the only place axe regressions surface locally.

- [ ] **Step 4: Eye-check responsive + density (not axe-scanned at narrow width)**

Run `npm run dev`, open the Dashboard, and verify at ~375px width (cards collapse to one column), at ≥1024px (hero KPIs beside Top actions; bento two-up), and toggling Compact (tiers + bento tighten — no literal-gap card stays loose). Verify Print preview shows the narrative summary + all Tier 1/2 data and hides the folded editor.

- [ ] **Step 5: Commit (if any eye-check tweaks were needed)**

```bash
git add -A
git commit -m "chore(dashboard): bento layout verification tweaks"
```

---

## Release (separate, when shipping — NOT part of the layout tasks)

Per AGENTS.md release rules: bump `src/app/version.ts` (APP_VERSION + milestone + APP_BUILD_DATE), add a `CHANGELOG.md` entry, append a new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` and add its EN + DE strings in `i18n.ts`/`i18n.de.ts` (DE via node utf8 write — Edit corrupts umlauts; keys must stay identical or tsc fails). Do this only when cutting the release, on the release branch.

## Out of scope

- No `computeDashboard`/engine change. No new persisted `Workspace`/`settings` field. No widget added or removed — only arrangement + fold state.
- Optional follow-up: a `globals.css @media print` rule to force-expand a `details.print-expand` so Recent activity prints. Left out by default.
