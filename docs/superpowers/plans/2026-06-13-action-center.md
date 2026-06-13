# Action Center (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the SP1 next-actions engine — a core "Action Center" view (grouped Now/Soon/Monitor, whole-row clickable + Open), a Dashboard "Top 5" widget, and a `now`-tier nav badge.

**Architecture:** A pure `buildActionInput` assembles the engine input from existing workspace/dashboard/comms data; task-manager memoizes `computeNextActions` once and feeds all three surfaces. `ActionsPanel`/`ActionRow` render the queue; CTAs deep-link via the existing `requestOpen(view, Number(id))` (all entity ids are numeric — no deep-link infra change).

**Tech Stack:** Next.js 16, React 19, TS, Tailwind v4, Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-13-action-center-design.md`

**Pinned facts (verified):**
- All entity ids are `number`; `requestOpen(view, id: number)` + `parseHash → number` already numeric. CTA executor coerces `Number(cta.id)`. **No `workspace-tab-context.tsx` change.**
- `actions` is a CORE view: add to `AppView` + `NAV_GROUPS` Overview + `LABEL_KEYS` + `CORE_VIEWS` (NOT a `FEATURE_MODULES` entry).
- Engine public API: `computeNextActions(input)` and the types from `src/app/next-actions` (index.ts). `SuggestedAction = { id, source, moduleId?, title:{key,params?}, why:{key,params?}, score, tier:"now"|"soon"|"monitor", cta:{kind:"open",view,id} | {kind:"snooze",actionId} }`.
- `getStakeholderCommsItems(args: CommsArgs)` is already wired via `use-stakeholder-comms.ts`; reuse those args (flags from `isModuleEnabled`, `leadDaysByQuadrant` from settings).
- `t(lang, key, ...params)`; render `{key, params}` as `t(lang, x.key, ...(x.params ?? []))`.
- Tier brand tokens (AIPM palette): now=`AIPM-pink`, soon=`AIPM-purple`, monitor=`AIPM-medium-grey`.

**Conventions:** `npx vitest run <path>`; `npx tsc --noEmit`; `npx eslint <files> --max-warnings=0`. i18n EN/DE identical keys, real umlauts. Tests AAA.

---

## File Structure
- **New:** `next-actions-input.ts` (pure `buildActionInput`), `actions-panel.tsx` (`ActionsPanel`), `action-row.tsx` (`ActionRow`), + tests.
- **Modified:** `i18n.ts`/`i18n.de.ts`, `nav-config.ts`, `feature-modules.ts`, `settings-types.ts`, `workspace-section.tsx`, `task-manager.tsx`, `dashboard-panel.tsx`, `sidebar-nav.tsx`, `modern-shell.tsx`, `version.ts`, `CHANGELOG.md` (+ tests for changed surfaces).

---

## Task 1: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: Add EN keys** (after `snapshotNeedsTursoFirst`):
```ts
  // --- Action Center (SP2) ---
  navActions: "Next actions",
  actionCenterTitle: "Next actions",
  actionCenterSubtitle: "What to act on, ranked by priority",
  dashboardTopActions: "Top actions",
  actionsEmptyState: "You're all caught up — no actions right now.",
  actionOpen: "Open",
  actionTierNow: "Now",
  actionTierSoon: "Soon",
  actionTierMonitor: "Monitor",
  actionSourceTask: "Task",
  actionSourceRaid: "RAID",
  actionSourceChange: "Change",
  actionSourceMilestone: "Milestone",
  actionSourceBudget: "Budget",
  actionSourceComms: "Stakeholder",
  versionHighlightActionCenter: "Action Center: a ranked Now/Soon/Monitor queue of suggested next steps, plus a dashboard widget",
```
- [ ] **Step 2: Add matching DE keys** (real umlauts):
```ts
  // --- Action Center (SP2) ---
  navActions: "Nächste Schritte",
  actionCenterTitle: "Nächste Schritte",
  actionCenterSubtitle: "Worauf Sie reagieren sollten — nach Priorität sortiert",
  dashboardTopActions: "Wichtigste Schritte",
  actionsEmptyState: "Alles erledigt — derzeit keine offenen Schritte.",
  actionOpen: "Öffnen",
  actionTierNow: "Jetzt",
  actionTierSoon: "Bald",
  actionTierMonitor: "Beobachten",
  actionSourceTask: "Aufgabe",
  actionSourceRaid: "RAID",
  actionSourceChange: "Änderung",
  actionSourceMilestone: "Meilenstein",
  actionSourceBudget: "Budget",
  actionSourceComms: "Stakeholder",
  versionHighlightActionCenter: "Action Center: eine nach Jetzt/Bald/Beobachten sortierte Liste vorgeschlagener nächster Schritte plus Dashboard-Widget",
```
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS.
- [ ] **Step 4: Commit** `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: i18n keys for Action Center (EN/DE)"`

---

## Task 2: Register the `actions` core view

**Files:** Modify `src/app/nav-config.ts`, `src/app/feature-modules.ts`. Test: existing `nav-config`/`feature-modules` tests if present.

- [ ] **Step 1:** In `nav-config.ts` add `"actions"` to the `AppView` union (near `"dashboard"`):
```ts
  | "dashboard"
  | "actions"
```
- [ ] **Step 2:** Add the nav item to the **Overview** group's `items` (after `dashboard`):
```ts
    items: [{ view: "dashboard" }, { view: "actions" }, { view: "trends" }, { view: "history" }, { view: "open-points" }, { view: "chat" }],
```
- [ ] **Step 3:** Add to `LABEL_KEYS`:
```ts
  actions: "navActions",
```
- [ ] **Step 4:** In `feature-modules.ts`, add `"actions"` to `CORE_VIEWS`:
```ts
export const CORE_VIEWS: readonly AppView[] = [
  "actions",
  "open-points",
  "chat",
  "reports",
  "activity",
  "settings",
  "edit",
] as const;
```
- [ ] **Step 5: Add a test** `src/app/nav-config.actions.test.ts` (or append to an existing nav test):
```ts
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, parseHash, buildHash } from "./nav-config";
import { isViewEnabled } from "./feature-modules";
describe("actions view registration", () => {
  it("is in the Overview nav group", () => {
    const overview = NAV_GROUPS.find((g) => g.labelKey === "navGroupOverview")!;
    expect(overview.items.some((i) => i.view === "actions")).toBe(true);
  });
  it("is a core view (enabled regardless of features)", () => {
    expect(isViewEnabled("actions", [])).toBe(true);
  });
  it("round-trips through the hash", () => {
    expect(parseHash(buildHash("actions", 5))).toEqual({ view: "actions", itemId: 5 });
  });
});
```
- [ ] **Step 6:** `npx tsc --noEmit && npx vitest run src/app/nav-config.actions.test.ts && npx eslint src/app/nav-config.ts src/app/feature-modules.ts --max-warnings=0` → clean. (If `LABEL_KEYS` is `Record<Exclude<AppView,"edit">,…>`, tsc enforces the new key — make sure it's added.)
- [ ] **Step 7: Commit** `feat: register actions as a core nav view`.

---

## Task 3: `dueSoonWorkdays` setting

**Files:** Modify `src/app/settings-types.ts`. Test: `settings-types`/`use-settings` test.

Context: the engine's task-due/milestone providers take `dueSoonWorkdays`; the dashboard uses a default of 3. Add it to `NotificationsConfig` so it's configurable and matches.

- [ ] **Step 1:** Read `NotificationsConfig` in `settings-types.ts`. Add `dueSoonWorkdays?: number;` to the interface, add `dueSoonWorkdays: 3` to `defaultNotificationsConfig`, and in the notifications sanitizer coerce it (`Number.isFinite(x) && x > 0 ? Math.floor(x) : 3`). Mirror exactly how `reminderLeadDays`/`raidReviewIntervalDays` are typed+defaulted+sanitized in that file.
- [ ] **Step 2: Test** (append to the settings sanitizer test): a config with `dueSoonWorkdays: 5` round-trips; a missing/invalid one defaults to 3.
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run src/app/use-settings.test.ts && npx eslint src/app/settings-types.ts --max-warnings=0` → clean.
- [ ] **Step 4: Commit** `feat: configurable dueSoonWorkdays notification setting`.

---

## Task 4: `next-actions-input.ts` — pure `buildActionInput`

**Files:** Create `src/app/next-actions-input.ts`, `src/app/next-actions-input.test.ts`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { buildActionInput } from "./next-actions-input";

const base = {
  tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
  dashboard: { budget: { effective: "G" }, evm: { cpi: 1 } } as any,
  commsReminders: [], features: ["raid"] as const, projectName: "Demo",
  today: "2026-06-15", now: new Date("2026-06-15T00:00:00Z"),
  reminderLeadDays: 7, dueSoonWorkdays: 3, raidReviewIntervalDays: 14,
};

describe("buildActionInput", () => {
  it("maps args onto the ActionInput shape", () => {
    const input = buildActionInput(base);
    expect(input.projectName).toBe("Demo");
    expect(input.features).toEqual(["raid"]);
    expect(input.dueSoonWorkdays).toBe(3);
  });
  it("defaults dismissed to an empty set when omitted", () => {
    expect(buildActionInput(base).dismissed.size).toBe(0);
  });
  it("passes a provided dismissed set through", () => {
    const d = new Set(["x"]);
    expect(buildActionInput({ ...base, dismissed: d }).dismissed).toBe(d);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `src/app/next-actions-input.ts`**
```ts
// src/app/next-actions-input.ts
//
// Pure assembler: gathers the live workspace/dashboard/comms data into the
// ActionInput the next-actions engine consumes. Kept out of task-manager so it
// is unit-testable. No side effects.
import type { ActionInput } from "./next-actions/types";
import type { DashboardModel } from "./dashboard";
import type { StakeholderCommsReminder } from "./stakeholder-comms";
import type { FeatureModuleId } from "./feature-modules";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder } from "./types";

export interface BuildActionInputArgs {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  dashboard: DashboardModel;
  commsReminders: readonly StakeholderCommsReminder[];
  features: readonly FeatureModuleId[];
  projectName: string;
  today: string;
  now: Date;
  reminderLeadDays: number;
  dueSoonWorkdays: number;
  raidReviewIntervalDays: number;
  dismissed?: ReadonlySet<string>;
}

export function buildActionInput(a: BuildActionInputArgs): ActionInput {
  return {
    tasks: a.tasks,
    raid: a.raid,
    changes: a.changes,
    milestones: a.milestones,
    stakeholders: a.stakeholders,
    dashboard: a.dashboard,
    commsReminders: a.commsReminders,
    features: a.features,
    projectName: a.projectName,
    today: a.today,
    now: a.now,
    reminderLeadDays: a.reminderLeadDays,
    dueSoonWorkdays: a.dueSoonWorkdays,
    raidReviewIntervalDays: a.raidReviewIntervalDays,
    dismissed: a.dismissed ?? new Set<string>(),
  };
}
```
> Confirm `ActionInput` field names against `next-actions/types.ts` (it has exactly these fields). If `StakeholderCommsReminder`/the entity types import from a different module, fix the import.
- [ ] **Step 4:** Run → PASS. tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: pure buildActionInput assembler`.

---

## Task 5: `action-row.tsx` — one clickable action row

**Files:** Create `src/app/action-row.tsx`, `src/app/action-row.test.tsx`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ActionRow } from "./action-row";
import type { SuggestedAction } from "./next-actions/types";

const action: SuggestedAction = {
  id: "raid:1:severity", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "Server down"] },
  why: { key: "actionRaidWhySeverity", params: ["Critical"] },
  score: 30, tier: "soon", cta: { kind: "open", view: "raid", id: 1 },
};

describe("ActionRow", () => {
  it("clicking the row fires onOpen with the action", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} />);
    fireEvent.click(getByRole("button", { name: /Server down/i }));
    expect(onOpen).toHaveBeenCalledWith(action);
  });
  it("clicking the Open button fires onOpen exactly once (stopPropagation)", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} />);
    fireEvent.click(getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `src/app/action-row.tsx`**
```tsx
// src/app/action-row.tsx
"use client";
import { type Lang, t, type TranslationKey } from "./i18n";
import type { SuggestedAction, ActionSource, ActionTier } from "./next-actions/types";

const SOURCE_LABEL: Record<ActionSource, TranslationKey> = {
  "task-due": "actionSourceTask",
  raid: "actionSourceRaid",
  "change-pending": "actionSourceChange",
  milestone: "actionSourceMilestone",
  budget: "actionSourceBudget",
  "stakeholder-comms": "actionSourceComms",
};
const TIER_DOT: Record<ActionTier, string> = {
  now: "bg-AIPM-pink",
  soon: "bg-AIPM-purple",
  monitor: "bg-AIPM-medium-grey",
};

interface ActionRowProps {
  lang: Lang;
  action: SuggestedAction;
  onOpen: (action: SuggestedAction) => void;
}

export function ActionRow({ lang, action, onOpen }: ActionRowProps) {
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => onOpen(action)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(action); }
      }}
      className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green"
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TIER_DOT[action.tier]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, SOURCE_LABEL[action.source])}
          </span>
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{why}</span>
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(action); }}
        className="shrink-0 rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
      >
        {t(lang, "actionOpen")}
      </button>
    </div>
  );
}
```
> If `TranslationKey` is not exported from `./i18n`, import it from wherever the key union lives (check how other files type i18n keys). Confirm `bg-AIPM-pink`/`AIPM-purple`/`AIPM-medium-grey` exist in `globals.css` (they do — used elsewhere).
- [ ] **Step 4:** Run → PASS. tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: ActionRow (clickable + Open)`.

---

## Task 6: `actions-panel.tsx` — the Action Center view

**Files:** Create `src/app/actions-panel.tsx`, `src/app/actions-panel.test.tsx`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ActionsPanel } from "./actions-panel";
import type { SuggestedAction } from "./next-actions/types";

const mk = (id: string, tier: SuggestedAction["tier"]): SuggestedAction => ({
  id, source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, id] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: tier === "now" ? 60 : tier === "soon" ? 30 : 10, tier,
  cta: { kind: "open", view: "raid", id: 1 },
});

describe("ActionsPanel", () => {
  it("renders Now/Soon/Monitor section headings for present tiers, hides empty ones", () => {
    const { getByText, queryByText } = render(
      <ActionsPanel lang="en-US" actions={[mk("a", "now"), mk("b", "soon")]} onOpen={() => {}} />,
    );
    expect(getByText("Now")).toBeTruthy();
    expect(getByText("Soon")).toBeTruthy();
    expect(queryByText("Monitor")).toBeNull(); // no monitor action → section hidden
  });
  it("shows the empty state when there are no actions", () => {
    const { getByText } = render(<ActionsPanel lang="en-US" actions={[]} onOpen={() => {}} />);
    expect(getByText(/all caught up/i)).toBeTruthy();
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `src/app/actions-panel.tsx`**
```tsx
// src/app/actions-panel.tsx
"use client";
import { type Lang, t, type TranslationKey } from "./i18n";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";
import { ActionRow } from "./action-row";
import type { SuggestedAction, ActionTier } from "./next-actions/types";

const TIERS: { tier: ActionTier; labelKey: TranslationKey }[] = [
  { tier: "now", labelKey: "actionTierNow" },
  { tier: "soon", labelKey: "actionTierSoon" },
  { tier: "monitor", labelKey: "actionTierMonitor" },
];

interface ActionsPanelProps {
  lang: Lang;
  actions: readonly SuggestedAction[];
  onOpen: (action: SuggestedAction) => void;
}

export function ActionsPanel({ lang, actions, onOpen }: ActionsPanelProps) {
  return (
    <div className={VIEW_PANE_FILL_CLASS}>
      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "actionCenterTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t(lang, "actionCenterSubtitle")}</p>
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto">
          {TIERS.map(({ tier, labelKey }) => {
            const rows = actions.filter((a) => a.tier === tier);
            if (rows.length === 0) return null;
            return (
              <section key={tier}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {rows.map((a) => (
                    <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
```
- [ ] **Step 4:** Run → PASS. tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: ActionsPanel (grouped Now/Soon/Monitor + empty state)`.

---

## Task 7: Dashboard "Top actions" widget

**Files:** Modify `src/app/dashboard-panel.tsx`. Test: `dashboard-panel.test.tsx` (append).

Context: read `dashboard-panel.tsx` props + layout. Add an optional `topActions?: readonly SuggestedAction[]` + `onOpenAction?: (a) => void` + `lang` (likely already a prop) and render a "Top actions" card (reusing `ActionRow`) BELOW the RAG band, shown only when `topActions?.length`.

- [ ] **Step 1: Add a test** asserting: given `topActions` of 5 items, the card renders them and a row-click fires `onOpenAction`; given empty/undefined, the card is absent. (Match the existing dashboard-panel test harness — read it; if none, create a minimal render with the required props.)
- [ ] **Step 2: Implement.** Add the props; render:
```tsx
{topActions && topActions.length > 0 && (
  <section className="mt-4">
    <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "dashboardTopActions")}</h3>
    <div className="flex flex-col gap-2">
      {topActions.map((a) => <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpenAction ?? (() => {})} />)}
    </div>
  </section>
)}
```
Import `ActionRow` + the `SuggestedAction` type. Place it where the other dashboard sections render (after the RAG pills / progress).
- [ ] **Step 3:** Run the dashboard test + `npx tsc --noEmit && npx eslint src/app/dashboard-panel.tsx --max-warnings=0` → clean.
- [ ] **Step 4: Commit** `feat: dashboard Top-actions widget`.

---

## Task 8: Nav badge

**Files:** Modify `src/app/sidebar-nav.tsx`, `src/app/modern-shell.tsx`. Test: `sidebar-nav.test.tsx` (create/append).

Context: read `sidebar-nav.tsx` (how items render) + `modern-shell.tsx` (how `Sidebar`/`SidebarNav` is invoked). Add an optional `badges?: Partial<Record<AppView, number>>` prop down the chain; render a pill on a nav item when `badges?.[item.view]` > 0.

- [ ] **Step 1: Add a test** `sidebar-nav.test.tsx`: render `SidebarNav` with `badges={{ actions: 3 }}` → a pill showing "3" appears next to the Actions item; with `{ actions: 0 }` or absent → no pill. (Use the real nav groups; query by the badge text within the actions item.)
- [ ] **Step 2: Implement.** In `sidebar-nav.tsx` add `badges?: Partial<Record<AppView, number>>` to props; in the item render, after the label:
```tsx
{badges?.[item.view] ? (
  <span aria-hidden className="ml-auto inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white">
    {badges[item.view]}
  </span>
) : null}
```
(Adapt to the item layout — if items use a flex row, `ml-auto` pushes the badge right. Match the existing alerts-badge styling in app-header/top-bar.) Thread `badges` through `modern-shell.tsx` (add a `navBadges?` prop to `ModernShell`, pass to `<Sidebar>`/`<SidebarNav>`).
- [ ] **Step 3:** Run the test + tsc + eslint clean.
- [ ] **Step 4: Commit** `feat: sidebar nav badge (now-tier action count)`.

---

## Task 9: Wire it all in task-manager + workspace-section

**Files:** Modify `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`. Test: a focused integration test if practical, else rely on the component tests + manual smoke (record a concern).

- [ ] **Step 1: Compute the actions in task-manager.** At the existing `computeDashboard(...)` site (the snapshot `buildContext`), the dashboard `model` is computed inside a callback — hoist or recompute a `dashboardModel` available in render scope (read the file; `computeDashboard` may already be memoized elsewhere — reuse it; if only inside `buildContext`, add a render-scope `const dashboardModel = useMemo(() => computeDashboard({...}), [deps])` and use it for BOTH buildContext and the actions). Then:
```tsx
import { computeNextActions } from "./next-actions";
import { buildActionInput } from "./next-actions-input";
import { getStakeholderCommsItems } from "./stakeholder-comms";
import { isModuleEnabled } from "./feature-modules";

const commsReminders = useMemo(() => getStakeholderCommsItems({
  stakeholders, milestones, raid, changes, today,
  flags: {
    stakeholdersEnabled: isModuleEnabled("stakeholders", settings.features),
    milestonesEnabled: isModuleEnabled("milestones", settings.features),
    raidEnabled: isModuleEnabled("raid", settings.features),
    changesEnabled: isModuleEnabled("changes", settings.features),
  },
  leadDaysByQuadrant: settings.notifications?.leadDaysByQuadrant,
}), [stakeholders, milestones, raid, changes, today, settings.features, settings.notifications]);

const nextActions = useMemo(() => computeNextActions(buildActionInput({
  tasks, raid, changes, milestones, stakeholders,
  dashboard: dashboardModel, commsReminders,
  features: settings.features, projectName: project?.name ?? "",
  today, now: new Date(),
  reminderLeadDays: settings.notifications?.reminderLeadDays ?? 7,
  dueSoonWorkdays: settings.notifications?.dueSoonWorkdays ?? 3,
  raidReviewIntervalDays: settings.notifications?.raidReviewIntervalDays ?? 14,
})), [tasks, raid, changes, milestones, stakeholders, dashboardModel, commsReminders, settings.features, settings.notifications, project, today]);

const nowCount = nextActions.filter((a) => a.tier === "now").length;

const openAction = useCallback((a: SuggestedAction) => {
  if (a.cta.kind === "open") requestOpen(a.cta.view, Number(a.cta.id));
}, [requestOpen]);
```
> Read the file for the EXACT names in scope (`tasks`/`raid`/etc. from `useWorkspace()`; `project`; `today`; `requestOpen` from `useWorkspaceTab`; `settings`). Adapt. If `leadDaysByQuadrant` lives elsewhere in settings, pass the same value the existing comms path uses (lift it from `use-stakeholder-comms` usage). `getStakeholderCommsItems` must receive valid args — if `leadDaysByQuadrant` is optional, omitting it is fine.
- [ ] **Step 2: Pass to the three surfaces.** Thread `nextActions` to `WorkspaceSection` (for the ActionsPanel) and `nextActions.slice(0,5)` + `openAction` to the dashboard panel, and `navBadges={{ actions: nowCount }}` to `ModernShell`. Read how WorkspaceSection + dashboard panel receive props today and add these.
- [ ] **Step 3: Render the panel.** In `workspace-section.tsx`: dynamic-import `ActionsPanel` (mirror an existing `dynamic(() => import("./x").then(m => m.X), { ssr:false })`) and in the view switch add `if (activeTab === "actions") return <ActionsPanel lang={lang} actions={nextActions} onOpen={openAction} />;` (thread `nextActions`/`openAction`/`lang` as new WorkspaceSection props).
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx eslint src/app/task-manager.tsx src/app/workspace-section.tsx --max-warnings=0` → clean. Run the existing task-manager/workspace-section tests. Manual smoke is acceptable here; record exactly what you wired.
- [ ] **Step 5: Commit** `feat: wire Action Center into task-manager (view + dashboard widget + badge)`.

---

## Task 10: Docs + version + full sweep

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: Bump `version.ts`** `APP_VERSION` `"0.76.0"`→`"0.77.0"`; `APP_MILESTONE` `"Delany"`→`"Russ"`; update the `APP_BUILD_DATE` comment to `// 0.77.0 Action Center — ranked Now/Soon/Monitor suggested-actions queue + dashboard widget + nav badge`; append `"versionHighlightActionCenter",` to `APP_HIGHLIGHT_KEYS`. (The highlight i18n key was added in Task 1.)
- [ ] **Step 2: CHANGELOG** insert above `## [0.76.0]`:
```markdown
## [0.77.0] - 2026-06-13 "Russ"

### Added
- **Action Center.** A new "Next actions" view turns the project's signals
  (overdue tasks, open Critical/High RAID + reviews due, pending changes,
  overdue/at-risk milestones, budget overruns, stakeholder-comms due) into a
  ranked queue grouped Now / Soon / Monitor — click a row to jump straight to
  the item. Plus a "Top actions" card on the Dashboard and a nav badge counting
  the urgent ("now") items. (Consumes the next-actions engine.)
```
- [ ] **Step 3: FULL sweep** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0`. Report totals. All green.
- [ ] **Step 4: Commit** `git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md && git commit -m "docs: 0.77.0 Russ — Action Center"`

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green; `npx eslint src/app --max-warnings=0` clean.
- [ ] Manual smoke (dev server): the "Next actions" nav entry shows a badge with the now-count; the view lists Now/Soon/Monitor sections; clicking a row (and the Open button) deep-links to the entity and opens its editor (RAID/task); the Dashboard shows the Top-actions card; empty project → "all caught up".
- [ ] Use **superpowers:finishing-a-development-branch**.
