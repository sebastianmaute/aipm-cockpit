# Inline Action Chips (SP4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface up-to-3 now/soon action chips inline on each data view header and each extra Reports section (click → open the entity; `+N more` → Action Center). Pure consumer of the existing `nextActions`; no engine change.

**Architecture:** A presentational `action-chips.tsx` (`ActionChips` + a pure `chipsForView` filter). One strip injected at the top of `workspace-section.tsx`'s `#workspace-panels` (filtered by `cta.view === activeTab`); per-section chips in `reports.tsx`'s `visibleExtra.map` (filtered by report→source view). Works in classic + modern (both route through `WorkspaceSection`). No nav badge (classic already shows `nowCount` on the SP3 bell; modern on the SP2 sidebar).

**Tech Stack:** Next.js 16, React 19, TS, Tailwind v4, Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-14-inline-action-chips.md`

**Pinned facts (verified):**
- `SuggestedAction` (`next-actions/types.ts`): `tier: "now"|"soon"|"monitor"`, `cta: {kind:"open",view:AppView,id} | {kind:"snooze",actionId}`, `title: {key,params?}`. Engine already score-sorts output.
- `workspace-section.tsx`: `useWorkspaceTab()` → `{activeTab, setActiveTab}`; props already include `nextActions`, `onOpenAction`; `#workspace-panels` container at the `<div id="workspace-panels" …>` (just before `id="panel-chat"`). `ReportsPanel` rendered at `activeTab === "reports"`.
- `reports.tsx` `ReportsPanel`: extra reports render in `visibleExtra.map((id)=>…)` — each is a `<div key={id}>` with an `<h3>` header row then `{body}` (`renderEmbedded(id)`). Report ids: `raid-report`,`budget-report`,`resource-report`,`stakeholder-report`.
- `nowCount` is task-manager-local; NOT needed here.
- AIPM palette: tier dot `now`=`bg-AIPM-pink`, `soon`=`bg-AIPM-purple` (from `action-row.tsx`). Conventions: `npx vitest run <path>`, `npx tsc --noEmit`, `npx eslint <files> --max-warnings=0`. i18n EN/DE parity + real umlauts.

---

## Task 1: i18n keys

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: EN** — add after `versionHighlightSnoozeActions` (the SP3 block):
```ts
  // --- Inline action chips (SP4) ---
  actionChipsLabel: "Suggested actions",
  actionChipsMore: "+{0} more",
  versionHighlightActionChips: "The next action now shows inline on each view and report — click a chip to jump straight to the item",
```
- [ ] **Step 2: DE** (real umlauts) at the matching position:
```ts
  // --- Inline-Aktionschips (SP4) ---
  actionChipsLabel: "Vorgeschlagene Schritte",
  actionChipsMore: "+{0} weitere",
  versionHighlightActionChips: "Der nächste Schritt erscheint jetzt direkt in jeder Ansicht und jedem Bericht — Chip anklicken, um zum Eintrag zu springen",
```
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS. Grep DE for `nächste`/`Vorgeschlagene` → real umlauts intact (if Edit mangled them, rewrite via a node UTF-8 write).
- [ ] **Step 4: Commit** `feat: i18n keys for inline action chips (EN/DE)`.

---

## Task 2: `action-chips.tsx` (component + pure filter)

**Files:** Create `src/app/action-chips.tsx`, `src/app/action-chips.test.tsx`.

- [ ] **Step 1: Write the failing test** `src/app/action-chips.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ActionChips, chipsForView } from "./action-chips";
import type { SuggestedAction } from "./next-actions/types";

function mk(id: string, tier: SuggestedAction["tier"]): SuggestedAction {
  return {
    id, source: "raid", moduleId: "raid",
    title: { key: "actionRaidTitle", params: [1, `Item ${id}`] },
    why: { key: "actionRaidWhySeverity", params: ["Critical"] },
    score: 50, tier, cta: { kind: "open", view: "raid", id: 1 },
  };
}

describe("chipsForView", () => {
  it("keeps only open-CTA actions whose cta.view matches", () => {
    const a: SuggestedAction = { ...mk("a", "now"), cta: { kind: "open", view: "raid", id: 1 } };
    const b: SuggestedAction = { ...mk("b", "now"), cta: { kind: "open", view: "budget", id: 0 } };
    expect(chipsForView([a, b], "raid")).toEqual([a]);
  });
});

describe("ActionChips", () => {
  it("renders nothing when there are no now/soon actions", () => {
    const { container } = render(<ActionChips lang="en-US" actions={[mk("a", "monitor")]} onOpen={() => {}} onShowMore={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it("caps at 3 chips and shows +N more for the remaining now/soon (monitor excluded)", () => {
    const actions = [mk("1","now"),mk("2","now"),mk("3","soon"),mk("4","soon"),mk("5","soon"),mk("6","monitor")];
    const onShowMore = vi.fn();
    const { getAllByRole, getByText } = render(<ActionChips lang="en-US" actions={actions} onOpen={() => {}} onShowMore={onShowMore} />);
    expect(getAllByRole("button")).toHaveLength(4); // 3 chips + the "more" button
    fireEvent.click(getByText("+2 more"));          // 5 now/soon − 3 shown = 2
    expect(onShowMore).toHaveBeenCalled();
  });
  it("clicking a chip fires onOpen with that action", () => {
    const a = mk("x", "now");
    const onOpen = vi.fn();
    const { getByText } = render(<ActionChips lang="en-US" actions={[a]} onOpen={onOpen} onShowMore={() => {}} />);
    fireEvent.click(getByText(/Item x/));
    expect(onOpen).toHaveBeenCalledWith(a);
  });
});
```
- [ ] **Step 2:** Run `npx vitest run src/app/action-chips.test.tsx` → FAIL (module missing).
- [ ] **Step 3: Write `src/app/action-chips.tsx`**:
```tsx
// src/app/action-chips.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";

const TIER_DOT: Record<"now" | "soon", string> = {
  now: "bg-AIPM-pink",
  soon: "bg-AIPM-purple",
};
const MAX_CHIPS = 3;

/** Open-CTA actions targeting `view` (used by the data-view strip + report cards). */
export function chipsForView(actions: readonly SuggestedAction[], view: AppView): SuggestedAction[] {
  return actions.filter((a) => a.cta.kind === "open" && a.cta.view === view);
}

interface ActionChipsProps {
  lang: Lang;
  actions: readonly SuggestedAction[];
  onOpen: (action: SuggestedAction) => void;
  onShowMore: () => void;
  className?: string;
}

export function ActionChips({ lang, actions, onOpen, onShowMore, className }: ActionChipsProps) {
  const ranked = actions.filter((a) => a.tier === "now" || a.tier === "soon");
  if (ranked.length === 0) return null;
  const shown = ranked.slice(0, MAX_CHIPS);
  const extra = ranked.length - shown.length;
  return (
    <div
      role="group"
      aria-label={t(lang, "actionChipsLabel")}
      className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}
    >
      {shown.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onOpen(action)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-muted"
        >
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIER_DOT[action.tier as "now" | "soon"]}`} />
          <span className="max-w-[16rem] truncate">
            {t(lang, action.title.key, ...(action.title.params ?? []))}
          </span>
        </button>
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="inline-flex items-center rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted"
        >
          {t(lang, "actionChipsMore", extra)}
        </button>
      )}
    </div>
  );
}
```
- [ ] **Step 4:** Run the test → PASS. `npx tsc --noEmit` + `npx eslint src/app/action-chips.tsx src/app/action-chips.test.tsx --max-warnings=0` → clean.
- [ ] **Step 5: Commit** `feat: ActionChips inline component + chipsForView filter`.

---

## Task 3: Data-view strip in `workspace-section.tsx`

**Files:** Modify `src/app/workspace-section.tsx`.

- [ ] **Step 1:** Add imports near the other local imports:
```ts
import { ActionChips, chipsForView } from "./action-chips";
```
- [ ] **Step 2:** Inject the strip as the FIRST child of `#workspace-panels` (immediately inside `<div id="workspace-panels" …>`, before `<div id="panel-chat" …>`):
```tsx
      <div
        id="workspace-panels"
        hidden={!isPopout && !fullBleed && workspaceCollapsed}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ActionChips
          lang={lang}
          actions={chipsForView(nextActions, activeTab)}
          onOpen={onOpenAction}
          onShowMore={() => setActiveTab("actions")}
          className="mb-2 shrink-0"
        />
        <div
          id="panel-chat"
          …
```
(`ActionChips` returns `null` for any view with no now/soon actions, so the strip self-hides on dashboard/actions/reports/settings/etc.)
- [ ] **Step 3: Verify** `npx tsc --noEmit && npx eslint src/app/workspace-section.tsx --max-warnings=0` → clean. `npx vitest run src/app/workspace-section.test.tsx` → still PASS (strip renders null without seeded now/soon actions, so existing assertions are unaffected). The chip logic itself is covered by `action-chips.test.tsx`.
- [ ] **Step 4: Commit** `feat: inline action-chips strip on data views`.

---

## Task 4: Per-section chips in the Reports view

**Files:** Modify `src/app/reports.tsx`, `src/app/workspace-section.tsx` (thread 3 props).

- [ ] **Step 1: `workspace-section.tsx`** — pass three props to the `<ReportsPanel …>` render (at `activeTab === "reports"`):
```tsx
              nextActions={nextActions}
              onOpenAction={onOpenAction}
              onShowActions={() => setActiveTab("actions")}
```
- [ ] **Step 2: `reports.tsx`** — add imports:
```ts
import { ActionChips, chipsForView } from "./action-chips";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
```
- [ ] **Step 3: `reports.tsx`** — extend the `ReportsPanel` destructure + prop type with three optionals:
```ts
  // in the destructured params:
  nextActions = [], onOpenAction, onShowActions,
  // in the prop type object:
  nextActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  onShowActions?: () => void;
```
- [ ] **Step 4: `reports.tsx`** — add a report→source-view map ABOVE `renderEmbedded`:
```ts
  const REPORT_SOURCE_VIEW: Partial<Record<AddableReportId, AppView>> = {
    "raid-report": "raid",
    "budget-report": "budget",
    "stakeholder-report": "stakeholders",
    // resource-report: Resources is not an action source → no chips
  };
```
- [ ] **Step 5: `reports.tsx`** — render chips inside `visibleExtra.map`, between the `<h3>` header `</div>` and `{body}`:
```tsx
            {(() => {
              const src = REPORT_SOURCE_VIEW[id];
              if (!src || !onOpenAction || !onShowActions) return null;
              return (
                <ActionChips
                  lang={lang}
                  actions={chipsForView(nextActions, src)}
                  onOpen={onOpenAction}
                  onShowMore={onShowActions}
                  className="mb-2"
                />
              );
            })()}
            {body}
```
- [ ] **Step 6: Verify** `npx tsc --noEmit && npx eslint src/app/reports.tsx src/app/workspace-section.tsx --max-warnings=0` → clean. `npx vitest run src/app/reports.test.tsx` (if present) → PASS; the new props are optional so existing callers/tests are unaffected.
- [ ] **Step 7: Commit** `feat: inline action-chips on Reports sections`.

---

## Task 5: Version + CHANGELOG + full sweep

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION` `"0.78.0"`→`"0.79.0"`; `APP_MILESTONE` `"Hopkinson"`→`"Willis"`; update the `APP_BUILD_DATE` comment to `// 0.79.0 inline next-action chips on views + reports`; append `"versionHighlightActionChips",` to `APP_HIGHLIGHT_KEYS` (key added in Task 1).
- [ ] **Step 2: CHANGELOG** above `## [0.78.0]`:
```markdown
## [0.79.0] - 2026-06-14 "Willis"

### Added
- **Inline action chips:** the most urgent next action(s) for a view now appear
  as compact chips at the top of that view (RAID, Open Points, Budget, …) and on
  each Reports section. Click a chip to jump straight to the item; `+N more` opens
  the Action Center. Completes the "suggested next actions" feature.
```
- [ ] **Step 3: FULL sweep** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → all green. Report totals.
- [ ] **Step 4: Commit** `git add src/app/version.ts CHANGELOG.md && git commit -m "docs: 0.79.0 Willis — inline action chips"`.

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green; `npx eslint src/app --max-warnings=0` clean.
- [ ] Manual smoke (dev server): RAID/Open-Points/Budget/Milestones/Changes/Stakeholders views show a chip strip when they have now/soon actions, hidden otherwise; a chip click opens the entity; `+N more` navigates to the Action Center; the Reports view shows per-section chips on RAID/Budget/Stakeholder reports; chips appear in BOTH classic and modern layouts.
- [ ] e2e/a11y green (the snooze-menu + chip buttons are plain buttons; the a11y gate is deterministic after `2b5ab22`).
- [ ] Use **superpowers:finishing-a-development-branch**.
