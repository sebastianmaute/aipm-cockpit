# Suggested Next-Actions Engine (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, framework-free engine that turns the app's existing signals into a ranked, deduplicated `SuggestedAction[]` — the testable foundation for the Action Center (SP2) and reminder consolidation (SP3).

**Architecture:** A `src/app/next-actions/` folder: `types.ts` (the value object + provider interface + input), `score.ts` (additive explainable scoring → tier band), `engine.ts` (`computeNextActions(input, providers)` — gate by module, dedup by id, sort, filter dismissed), six per-domain providers under `providers/`, and `index.ts` (assembles the real provider array + the public `computeNextActions`). Providers REUSE existing signal logic (`getAlertableTasks`, `getRaidReviewItems`, `partitionMilestones`, change-log helpers, `getStakeholderCommsItems`, budget-health) — no duplicated thresholds. No React, no `t`/i18n, no localStorage, no DOM. No persisted data.

**Tech Stack:** TypeScript, Vitest 4. Pure module — no UI.

**Spec:** `docs/superpowers/specs/2026-06-13-next-actions-engine-design.md`

**Spec refinements pinned from real signatures (apply these):**
- `FeatureModuleId` real values: `dashboard | trends | gantt | milestones | resources | budget | raid | changes | stakeholders | history`. The spec's `"schedule"`/`"scope"`/`"stakeholder-comms"` were placeholders.
- `SuggestedAction.moduleId` is **OPTIONAL** (`FeatureModuleId | undefined`). Core providers with no gate (task-due) omit it → always run. Mapping: task-due→(none), raid→`raid`, change-pending→`changes`, milestone→`milestones`, budget→`budget`, stakeholder-comms→`stakeholders`.
- `AppView` is from `./nav-config`. Milestone `id` is a **number**; RAID/change ids per their types.

**Conventions:** `npx vitest run <path>`; `npx tsc --noEmit`; `npx eslint <files> --max-warnings=0`. i18n: EN (`i18n.ts`) + DE (`i18n.de.ts`) identical key sets, real umlauts (encoding test). Tests AAA. SP1 ships NO version bump / CHANGELOG (no user-visible change — that lands in SP2).

---

## File Structure
- `src/app/i18n.ts` / `i18n.de.ts` — add action title/why keys (Task 1).
- `src/app/next-actions/types.ts` — `SuggestedAction`, `ActionCta`, `I18nText`, `ActionTier`, `ActionSource`, `ActionInput`, `ActionProvider` (Task 2).
- `src/app/next-actions/score.ts` — `ACTION_WEIGHTS`, factor fns, `scoreAction`, `bandTier` (Task 2).
- `src/app/next-actions/engine.ts` — `computeNextActions(input, providers)` (Task 3).
- `src/app/next-actions/providers/{task-due,raid,change-pending,milestone,budget,stakeholder-comms}.ts` (Tasks 4-9).
- `src/app/next-actions/index.ts` — `ALL_PROVIDERS` + public `computeNextActions(input)` (Task 10).
- `.test.ts` beside each.

---

## Task 1: i18n keys for action titles + reasons

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`. Run `i18n-encoding.test.ts`.

These keys are the copy the engine emits as `{key, params}`. They must exist so `I18nText.key: TranslationKey` type-checks (SP2 renders them).

- [ ] **Step 1: Add EN keys to `src/app/i18n.ts`** (after `snapshotNeedsTursoFirst`, same object/indentation):

```ts
  // --- Suggested next actions (engine SP1) ---
  actionTaskTitle: "Task: {0}",
  actionTaskWhyOverdue: "Overdue by {0} working day(s)",
  actionTaskWhyToday: "Due today",
  actionTaskWhySoon: "Due in {0} working day(s)",
  actionRaidTitle: "RAID {0}: {1}",
  actionRaidWhySeverity: "{0} severity, still open",
  actionRaidWhyReviewOverdue: "Review {0} day(s) overdue",
  actionRaidWhyReviewStale: "Not reviewed in {0} days",
  actionChangeAggTitle: "{0} changes awaiting decision",
  actionChangeAggWhy: "Pending changes push Scope to {0}",
  actionChangeItemTitle: "Change: {0}",
  actionChangeItemWhy: "{0} impact, awaiting decision",
  actionMilestoneTitle: "Milestone: {0}",
  actionMilestoneWhyOverdue: "Overdue",
  actionMilestoneWhyAtRisk: "At risk — a blocking task is red or the date slipped",
  actionBudgetTitle: "Budget: {0}",
  actionBudgetWhyOver: "Spend at {0}% of budget",
  actionBudgetWhyCpi: "Cost performance below target (CPI {0})",
  actionCommsTitle: "Update stakeholder: {0}",
  actionCommsWhy: "{0} update due",
  actionRagRed: "Red",
  actionRagAmber: "Amber",
```

- [ ] **Step 2: Add matching DE keys to `src/app/i18n.de.ts`** (real umlauts):

```ts
  // --- Vorgeschlagene nächste Schritte (Engine SP1) ---
  actionTaskTitle: "Aufgabe: {0}",
  actionTaskWhyOverdue: "Überfällig seit {0} Arbeitstag(en)",
  actionTaskWhyToday: "Heute fällig",
  actionTaskWhySoon: "Fällig in {0} Arbeitstag(en)",
  actionRaidTitle: "RAID {0}: {1}",
  actionRaidWhySeverity: "Schweregrad {0}, weiterhin offen",
  actionRaidWhyReviewOverdue: "Überprüfung {0} Tag(e) überfällig",
  actionRaidWhyReviewStale: "Seit {0} Tagen nicht überprüft",
  actionChangeAggTitle: "{0} Änderungen warten auf Entscheidung",
  actionChangeAggWhy: "Offene Änderungen setzen den Umfang auf {0}",
  actionChangeItemTitle: "Änderung: {0}",
  actionChangeItemWhy: "Auswirkung {0}, wartet auf Entscheidung",
  actionMilestoneTitle: "Meilenstein: {0}",
  actionMilestoneWhyOverdue: "Überfällig",
  actionMilestoneWhyAtRisk: "Gefährdet — eine blockierende Aufgabe ist rot oder das Datum verschoben",
  actionBudgetTitle: "Budget: {0}",
  actionBudgetWhyOver: "Ausgaben bei {0}% des Budgets",
  actionBudgetWhyCpi: "Kostenleistung unter Ziel (CPI {0})",
  actionCommsTitle: "Stakeholder informieren: {0}",
  actionCommsWhy: "{0}-Update fällig",
  actionRagRed: "Rot",
  actionRagAmber: "Gelb",
```

- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS (parity + real umlauts).

- [ ] **Step 4: Commit**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: i18n keys for next-actions engine (EN/DE)"
```

---

## Task 2: Types + scoring

**Files:** Create `src/app/next-actions/types.ts`, `src/app/next-actions/score.ts`, `src/app/next-actions/score.test.ts`.

- [ ] **Step 1: Write `src/app/next-actions/types.ts`**

```ts
// src/app/next-actions/types.ts
import type { Lang, TranslationKey } from "../i18n";
import type { AppView } from "../nav-config";
import type { FeatureModuleId } from "../feature-modules";
import type { Task } from "../types";
import type { RaidItem } from "../types";
import type { ChangeItem } from "../types";
import type { Milestone } from "../types";
import type { Stakeholder } from "../stakeholders";
import type { DashboardModel } from "../dashboard";

export type ActionTier = "now" | "soon" | "monitor";
export type ActionSource =
  | "task-due" | "raid" | "change-pending" | "milestone" | "budget" | "stakeholder-comms";

/** Translated by the surface (SP2); the engine stays i18n-free. */
export interface I18nText {
  key: TranslationKey;
  params?: (string | number)[];
}

/** A serializable description of the primary action — the surface executes it. */
export type ActionCta =
  | { kind: "open"; view: AppView; id: string | number } // deep-link to the entity
  | { kind: "snooze"; actionId: string };

export interface SuggestedAction {
  id: string;                  // stable: `${source}:${entityId}:${reason}`
  source: ActionSource;
  moduleId?: FeatureModuleId;  // undefined = always-on (core)
  title: I18nText;
  why: I18nText;
  score: number;
  tier: ActionTier;
  cta: ActionCta;
}

/** Read-only slice the providers consume. The surface (SP2) builds this. */
export interface ActionInput {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  dashboard: DashboardModel;          // existing computed model — reused, not recomputed
  features: readonly FeatureModuleId[];
  today: string;                      // ISO yyyy-mm-dd
  now: Date;
  reminderLeadDays: number;
  dueSoonWorkdays: number;
  raidReviewIntervalDays: number;
  dismissed: ReadonlySet<string>;     // snoozed/dismissed action ids (injected; SP3 wires the store)
}

export interface ActionProvider {
  moduleId?: FeatureModuleId;         // skipped if set and the module is disabled
  provide(input: ActionInput): SuggestedAction[];
}

export type { Lang };
```
> If any imported type name differs (e.g. `Stakeholder` is exported elsewhere, or `RaidItem`/`ChangeItem`/`Milestone` live in a different module), read the real export site and fix the import — do NOT invent. Confirm `DashboardModel` is exported from `../dashboard` and `AppView` from `../nav-config`.

- [ ] **Step 2: Write the failing test `src/app/next-actions/score.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { scoreAction, bandTier, ACTION_WEIGHTS } from "./score";

describe("next-actions scoring", () => {
  it("sums the supplied factors", () => {
    expect(scoreAction({ urgency: 40, risk: 30, impact: 20, quickWin: 10, staleness: 5 })).toBe(105);
  });
  it("treats omitted factors as 0", () => {
    expect(scoreAction({ risk: 15 })).toBe(15);
  });
  it("bands tiers at the boundaries", () => {
    expect(bandTier(60)).toBe("now");
    expect(bandTier(59)).toBe("soon");
    expect(bandTier(30)).toBe("soon");
    expect(bandTier(29)).toBe("monitor");
    expect(bandTier(0)).toBe("monitor");
  });
  it("exposes tunable weights as named constants", () => {
    expect(ACTION_WEIGHTS.urgencyOverdue).toBe(40);
    expect(ACTION_WEIGHTS.riskCritical).toBe(30);
  });
});
```

- [ ] **Step 3:** `npx vitest run src/app/next-actions/score.test.ts` → FAIL (module missing).

- [ ] **Step 4: Write `src/app/next-actions/score.ts`**

```ts
// src/app/next-actions/score.ts
import type { ActionTier } from "./types";

/** All ranking weights in one place — tune here. */
export const ACTION_WEIGHTS = {
  urgencyOverdue: 40,
  urgencyToday: 30,
  urgencySoon: 15,
  riskCritical: 30, // Critical / Red RAG
  riskHigh: 15,     // High / Amber
  impactBlocksMilestone: 20,
  impactScopePending: 15,
  quickWin: 10,
  stalenessPerDay: 1,
  stalenessCap: 15,
} as const;

export const TIER_NOW = 60;
export const TIER_SOON = 30;

export interface ScoreFactors {
  urgency?: number;
  risk?: number;
  impact?: number;
  quickWin?: number;
  staleness?: number;
}

export function scoreAction(f: ScoreFactors): number {
  return (f.urgency ?? 0) + (f.risk ?? 0) + (f.impact ?? 0) + (f.quickWin ?? 0) + (f.staleness ?? 0);
}

export function bandTier(score: number): ActionTier {
  if (score >= TIER_NOW) return "now";
  if (score >= TIER_SOON) return "soon";
  return "monitor";
}

/** Staleness contribution: +1/day capped. */
export function stalenessScore(days: number): number {
  return Math.min(Math.max(0, Math.floor(days)) * ACTION_WEIGHTS.stalenessPerDay, ACTION_WEIGHTS.stalenessCap);
}
```

- [ ] **Step 5:** `npx vitest run src/app/next-actions/score.test.ts` → PASS. Then `npx tsc --noEmit && npx eslint src/app/next-actions/types.ts src/app/next-actions/score.ts src/app/next-actions/score.test.ts --max-warnings=0` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/app/next-actions/types.ts src/app/next-actions/score.ts src/app/next-actions/score.test.ts
git commit -m "feat: next-actions types + explainable additive scoring"
```

---

## Task 3: The engine (`computeNextActions`)

**Files:** Create `src/app/next-actions/engine.ts`, `src/app/next-actions/engine.test.ts`.

- [ ] **Step 1: Write the failing test `src/app/next-actions/engine.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { computeNextActions } from "./engine";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

function mkAction(id: string, score: number, moduleId?: SuggestedAction["moduleId"]): SuggestedAction {
  return {
    id, source: "raid", moduleId,
    title: { key: "actionRaidTitle", params: [id, id] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score, tier: "soon", cta: { kind: "open", view: "raid", id },
  };
}
const baseInput = { features: ["raid", "changes"], dismissed: new Set<string>() } as unknown as ActionInput;
const provider = (acts: SuggestedAction[], moduleId?: SuggestedAction["moduleId"]): ActionProvider =>
  ({ moduleId, provide: () => acts });

describe("computeNextActions", () => {
  it("sorts by score descending with id tiebreak and re-bands tier from score", () => {
    const p = provider([mkAction("b", 70), mkAction("a", 70), mkAction("c", 10)]);
    const out = computeNextActions(baseInput, [p]);
    expect(out.map((a) => a.id)).toEqual(["a", "b", "c"]); // 70,70 → id asc; then 10
    expect(out[0].tier).toBe("now");   // 70 → now (re-banded, ignoring the stub "soon")
    expect(out[2].tier).toBe("monitor"); // 10 → monitor
  });
  it("skips a provider whose moduleId is disabled", () => {
    const p = provider([mkAction("x", 50)], "stakeholders"); // not in features
    expect(computeNextActions(baseInput, [p])).toEqual([]);
  });
  it("runs a provider with no moduleId (core/always-on)", () => {
    const p = provider([mkAction("core", 50)], undefined);
    expect(computeNextActions(baseInput, [p]).map((a) => a.id)).toEqual(["core"]);
  });
  it("dedups by id (first provider wins)", () => {
    const out = computeNextActions(baseInput, [provider([mkAction("dup", 80)]), provider([mkAction("dup", 10)])]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(80);
  });
  it("filters out dismissed ids", () => {
    const input = { ...baseInput, dismissed: new Set(["gone"]) } as ActionInput;
    const out = computeNextActions(input, [provider([mkAction("gone", 90), mkAction("keep", 40)])]);
    expect(out.map((a) => a.id)).toEqual(["keep"]);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/app/next-actions/engine.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write `src/app/next-actions/engine.ts`**

```ts
// src/app/next-actions/engine.ts
import { isModuleEnabled } from "../feature-modules";
import { bandTier } from "./score";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

/** Run enabled providers, dedup by id (first wins), drop dismissed, sort by
 *  score desc (id asc tiebreak), and re-band each action's tier from its score
 *  (single source of truth for tier). */
export function computeNextActions(
  input: ActionInput,
  providers: readonly ActionProvider[],
): SuggestedAction[] {
  const byId = new Map<string, SuggestedAction>();
  for (const p of providers) {
    if (p.moduleId && !isModuleEnabled(p.moduleId, input.features)) continue;
    for (const a of p.provide(input)) {
      if (input.dismissed.has(a.id)) continue;
      if (!byId.has(a.id)) byId.set(a.id, { ...a, tier: bandTier(a.score) });
    }
  }
  return [...byId.values()].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}
```
> Confirm `isModuleEnabled(id, features)` exists in `../feature-modules` (it does — `feature-modules.ts:86`).

- [ ] **Step 4:** `npx vitest run src/app/next-actions/engine.test.ts` → PASS. `npx tsc --noEmit && npx eslint src/app/next-actions/engine.ts src/app/next-actions/engine.test.ts --max-warnings=0` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/next-actions/engine.ts src/app/next-actions/engine.test.ts
git commit -m "feat: next-actions engine (gate, dedup, dismiss, rank, re-band)"
```

---

## Task 4: `task-due` provider (core, always-on)

**Files:** Create `src/app/next-actions/providers/task-due.ts`, `.test.ts`.

Context: `getAlertableTasks(tasks, reminderLeadDays, dueSoonWorkdays, today, holidaySet?, absences?)` → `AlertableTask[]` = `{ task, category: "overdue"|"today"|"soon", workDaysLeft }`. **Read its exact parameter list in `due-dates.ts:38` first** and pass the matching args from `ActionInput` (the input carries `tasks`, `reminderLeadDays`, `dueSoonWorkdays`, `today`; if `getAlertableTasks` needs holiday/absence args, pass `undefined`/empty — they only refine the workday math and are not essential for SP1). `Task` has `id` (number) and `taskName`. Target view = `"tasks"` (confirm in `nav-config` AppView).

- [ ] **Step 1: Write the failing test `providers/task-due.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { taskDueProvider } from "./task-due";
import type { ActionInput } from "../types";
import { ACTION_WEIGHTS } from "../score";

function input(tasks: any[]): ActionInput {
  return {
    tasks, raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: {} as any, features: [], today: "2026-06-15", now: new Date("2026-06-15T00:00:00Z"),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
  } as ActionInput;
}

describe("taskDueProvider", () => {
  it("emits an overdue task action with overdue urgency and an open CTA", () => {
    const acts = taskDueProvider.provide(input([{ id: 7, taskName: "Ship", dueDate: "2026-06-10", status: "todo" }]));
    expect(acts).toHaveLength(1);
    const a = acts[0];
    expect(a.id).toBe("task-due:7:overdue");
    expect(a.source).toBe("task-due");
    expect(a.title).toEqual({ key: "actionTaskTitle", params: ["Ship"] });
    expect(a.cta).toEqual({ kind: "open", view: "tasks", id: 7 });
    expect(a.score).toBeGreaterThanOrEqual(ACTION_WEIGHTS.urgencyOverdue);
  });
  it("returns nothing when no tasks are due", () => {
    expect(taskDueProvider.provide(input([]))).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run → FAIL (module missing).

- [ ] **Step 3: Write `providers/task-due.ts`**

```ts
// src/app/next-actions/providers/task-due.ts
import { getAlertableTasks } from "../../due-dates";
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const taskDueProvider: ActionProvider = {
  // no moduleId → core, always runs
  provide(input: ActionInput): SuggestedAction[] {
    const alerts = getAlertableTasks(input.tasks, input.reminderLeadDays, input.dueSoonWorkdays, input.today);
    return alerts.map((al): SuggestedAction => {
      const urgency =
        al.category === "overdue" ? W.urgencyOverdue : al.category === "today" ? W.urgencyToday : W.urgencySoon;
      const why =
        al.category === "overdue"
          ? { key: "actionTaskWhyOverdue" as const, params: [al.workDaysLeft] }
          : al.category === "today"
            ? { key: "actionTaskWhyToday" as const }
            : { key: "actionTaskWhySoon" as const, params: [al.workDaysLeft] };
      const score = scoreAction({ urgency });
      return {
        id: `task-due:${al.task.id}:${al.category}`,
        source: "task-due",
        title: { key: "actionTaskTitle", params: [al.task.taskName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "tasks", id: al.task.id },
      };
    });
  },
};
```
> If `getAlertableTasks`'s real signature takes a different arg order/count, adapt the call (the test pins the behavior). If the overdue task's `workDaysLeft` is 0 (it is, per the type), `actionTaskWhyOverdue` shows 0 — acceptable; the surface can refine later. Confirm AppView includes `"tasks"`; if the tasks view id differs, use the correct one.

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit && npx eslint src/app/next-actions/providers/task-due.ts src/app/next-actions/providers/task-due.test.ts --max-warnings=0` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/next-actions/providers/task-due.ts src/app/next-actions/providers/task-due.test.ts
git commit -m "feat: next-actions task-due provider"
```

---

## Task 5: `raid` provider

**Files:** Create `providers/raid.ts`, `.test.ts`. Gate: `moduleId: "raid"`.

Context: open Critical/High RAID items AND review-due items. Use `getRaidReviewItems(raid, raidReviewIntervalDays, today)` → `RaidReviewItem[]` = `{ item, reason: "overdue"|"stale", daysOverdue, daysSinceReview }` (read `raid-review.ts:37`). For severity use `severityRag(item.severity)` (`raid.ts:76` → `Health "R"|"A"|"G"`) and skip terminal items via `isTerminalStatus` (`raid.ts:58`). `RaidItem` has a string `id` (e.g. "R-12"), `title`, `category`, `severity`, `status`. Target view `"raid"`.

- [ ] **Step 1: Write the failing test `providers/raid.test.ts`** (Arrange a Critical open item + a review-overdue item; assert two actions with ids `raid:R-1:severity` and `raid:R-2:overdue`, the Critical one scoring ≥ `riskCritical`, review one carrying staleness, both `cta.view==="raid"`, both `moduleId==="raid"`). Mirror Task 4's test shape; read the real `RaidItem`/`getRaidReviewItems` shapes first and build minimal fixtures.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Write `providers/raid.ts`** — `provider.moduleId = "raid"`. In `provide`:
  - For each non-terminal `item` with `severityRag(item.severity)` of `"R"` or `"A"`: emit `id=\`raid:${item.id}:severity\``, `title={key:"actionRaidTitle",params:[item.id, item.title]}`, `why={key:"actionRaidWhySeverity",params:[item.severity]}`, `score=scoreAction({ risk: rag==="R"?W.riskCritical:W.riskHigh })`, `cta={kind:"open",view:"raid",id:item.id}`.
  - For each `getRaidReviewItems(...)` result: emit `id=\`raid:${r.item.id}:${r.reason}\``, `why={key: r.reason==="overdue"?"actionRaidWhyReviewOverdue":"actionRaidWhyReviewStale", params:[r.reason==="overdue"?r.daysOverdue:r.daysSinceReview]}`, `score=scoreAction({ staleness: stalenessScore(r.reason==="overdue"?r.daysOverdue:r.daysSinceReview), urgency: r.reason==="overdue"?W.urgencyOverdue:0 })`, same title/cta pattern.
  - Dedup is by `id` at the engine; a severity action and a review action for the same item have DIFFERENT ids (`:severity` vs `:overdue`) → both kept (intentional; they're distinct nudges). Use `bandTier(score)` for `tier`. Import `severityRag`, `isTerminalStatus` from `../../raid`, `getRaidReviewItems` from `../../raid-review`, `stalenessScore`,`scoreAction`,`bandTier`,`ACTION_WEIGHTS` from `../score`.

- [ ] **Step 4:** Run → PASS; tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: next-actions raid provider`.

---

## Task 6: `change-pending` provider

**Files:** `providers/change-pending.ts`, `.test.ts`. Gate: `moduleId: "changes"`.

Context: `isPendingChange(status)` (`change-log.ts:15`), `changeImpactRag(impact)` (`change-log.ts:23`). Threshold for the aggregate (Scope→Red) is the dashboard's scope-pending constant — read it (`SCOPE_PENDING_RED`, in dashboard/change-log; the Explore map cited `SCOPE_PENDING_RED=5`). `ChangeItem` has id, title, status, impact. Target view `"changes"`.

Behavior:
- Count pending changes. If `count >= SCOPE_PENDING_RED`: emit ONE aggregate action `id="change-pending:all:aggregate"`, `title={key:"actionChangeAggTitle",params:[count]}`, `why={key:"actionChangeAggWhy",params:[<rag label key resolved? no — pass a translated-RAG? engine is i18n-free>]}`. To keep the engine i18n-free, pass the RAG as a literal token the surface maps: use `params:["Red"]` and let `actionChangeAggWhy` interpolate the word — OR reuse the `actionRagRed`/`actionRagAmber` keys at the SURFACE. Simplest for SP1: `params:["Red"]` (English token); SP2 may localize later. `score=scoreAction({ risk:W.riskCritical, impact:W.impactScopePending })`, `cta={kind:"open",view:"changes",id:0}` (0 = the changes list; SP2 may special-case aggregate CTAs).
- ALSO emit a per-item action for each pending change whose `changeImpactRag(impact)==="R"`: `id=\`change-pending:${c.id}:item\``, `title={key:"actionChangeItemTitle",params:[c.title]}`, `why={key:"actionChangeItemWhy",params:[c.impact]}`, `score=scoreAction({ risk:W.riskCritical })`, `cta={kind:"open",view:"changes",id:c.id}`.

- [ ] Steps 1-5: TDD as in Task 4 (test: 6 pending changes → aggregate action present with count 6; a Red-impact change → its per-item action present; below-threshold + no Red → empty). Read `ChangeItem`/`SCOPE_PENDING_RED` first. Commit `feat: next-actions change-pending provider`.

---

## Task 7: `milestone` provider

**Files:** `providers/milestone.ts`, `.test.ts`. Gate: `moduleId: "milestones"`.

Context: `partitionMilestones(milestones, tasks, today, dueSoonWorkdays)` → `{ overdue, atRisk, dueSoon }` (read `milestones.ts:46` for the exact params — it likely needs the tasks list + health to decide at-risk; pass `input.tasks`, `input.today`, `input.dueSoonWorkdays`). `Milestone` has numeric `id`, `name`, `date`. Target view `"milestones"`.

Behavior (emit for overdue + atRisk only; dueSoon is low-priority/monitor — skip in SP1 to avoid noise):
- overdue milestone → `id=\`milestone:${m.id}:overdue\``, `title={key:"actionMilestoneTitle",params:[m.name]}`, `why={key:"actionMilestoneWhyOverdue"}`, `score=scoreAction({ urgency:W.urgencyOverdue, impact:W.impactBlocksMilestone })`, `cta={kind:"open",view:"milestones",id:m.id}`.
- atRisk milestone → `id=\`milestone:${m.id}:at-risk\``, `why={key:"actionMilestoneWhyAtRisk"}`, `score=scoreAction({ risk:W.riskHigh, impact:W.impactBlocksMilestone })`, same title/cta.

- [ ] Steps 1-5: TDD (test: an overdue milestone → action with overdue urgency + blocks-milestone impact; an at-risk one → at-risk action; on-track/dueSoon → none). Read `partitionMilestones` real params first. Commit `feat: next-actions milestone provider`.

---

## Task 8: `budget` provider

**Files:** `providers/budget.ts`, `.test.ts`. Gate: `moduleId: "budget"`.

Context: SP1 reads budget health from the EXISTING `input.dashboard` model rather than recomputing. **Read `DashboardModel` in `dashboard.ts:183` first** to find the budget RAG + any per-bucket health/overrun it already exposes (e.g. a `budget` pill health, CPI, bucket list). Use what's there:
- If the dashboard budget RAG is `"R"` or there's an overrun: emit `id="budget:overall:over"` (or per-bucket if the model exposes buckets — prefer per-bucket: `id=\`budget:${bucket.id}:over\``), `title={key:"actionBudgetTitle",params:[bucketNameOrProject]}`, `why={key:"actionBudgetWhyOver",params:[pct]}` (or `actionBudgetWhyCpi` with the CPI value), `score=scoreAction({ risk: rag==="R"?W.riskCritical:W.riskHigh, quickWin: 0 })`, `cta={kind:"open",view:"budget",id:bucketIdOr0}`.
- If the model does NOT expose bucket-level detail, emit a single project-level budget action from the budget RAG. Keep it to Red/Amber only (no action when Green).

- [ ] Steps 1-5: TDD (construct a minimal `DashboardModel` with a Red budget signal → one budget action; Green → none). Because this depends on the real `DashboardModel` shape, READ IT FIRST and shape the test fixture + provider to the actual fields; report the exact fields used. Commit `feat: next-actions budget provider`.

---

## Task 9: `stakeholder-comms` provider

**Files:** `providers/stakeholder-comms.ts`, `.test.ts`. Gate: `moduleId: "stakeholders"`.

Context: `getStakeholderCommsItems(...)` in `stakeholder-comms.ts` → `StakeholderCommsReminder[]` = `{ ..., itemKind: "milestone"|"raid"|"change", ... }` (read the exported function's exact signature at `stakeholder-comms.ts` ~line 109/141 and the `StakeholderCommsReminder` interface at line 17 — it carries the stakeholder + the source item). Pass the args it needs from `ActionInput` (milestones/raid/changes/stakeholders/policy/today). Target view: the stakeholders view (confirm the AppView id, likely `"stakeholders"`).

Behavior: for each reminder → `id=\`stakeholder-comms:${reminder.stakeholderId}:${reminder.itemKind}\`` (use whatever stable id fields the reminder exposes), `title={key:"actionCommsTitle",params:[stakeholderName]}`, `why={key:"actionCommsWhy",params:[reminder.itemKind]}`, `score=scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh })` (comms are time-sensitive but rarely Critical), `cta={kind:"open",view:"<stakeholders view>",id:reminder.stakeholderId}`.

- [ ] Steps 1-5: TDD (one comms reminder → one action with the right id/title/cta + `moduleId:"stakeholders"`). Read the real `getStakeholderCommsItems` signature + `StakeholderCommsReminder` fields first; build a minimal fixture. Commit `feat: next-actions stakeholder-comms provider`.

---

## Task 10: Assemble the registry + integration

**Files:** Create `src/app/next-actions/index.ts`, `src/app/next-actions/index.test.ts`.

- [ ] **Step 1: Write `src/app/next-actions/index.ts`**

```ts
// src/app/next-actions/index.ts
//
// Public entry for the suggested-next-actions engine. SP2 imports
// `computeNextActions` + the types from here.
import { computeNextActions as run } from "./engine";
import { taskDueProvider } from "./providers/task-due";
import { raidProvider } from "./providers/raid";
import { changePendingProvider } from "./providers/change-pending";
import { milestoneProvider } from "./providers/milestone";
import { budgetProvider } from "./providers/budget";
import { stakeholderCommsProvider } from "./providers/stakeholder-comms";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

/** The real provider set, in a deterministic order. */
export const ALL_PROVIDERS: readonly ActionProvider[] = [
  taskDueProvider,
  raidProvider,
  changePendingProvider,
  milestoneProvider,
  budgetProvider,
  stakeholderCommsProvider,
];

/** Compute the ranked suggested actions from the app's current signals. */
export function computeNextActions(input: ActionInput): SuggestedAction[] {
  return run(input, ALL_PROVIDERS);
}

export type { SuggestedAction, ActionInput, ActionTier, ActionSource, ActionCta } from "./types";
```
> Each provider must be exported under the name used here (`raidProvider`, `changePendingProvider`, `milestoneProvider`, `budgetProvider`, `stakeholderCommsProvider`). If you named one differently in Tasks 5-9, fix the export name to match.

- [ ] **Step 2: Write `src/app/next-actions/index.test.ts`** — an integration test: build a realistic `ActionInput` with all `features` enabled, a known set of signals (1 overdue task, 1 Critical RAID, 6 pending changes, 1 overdue milestone), and assert: (a) actions from multiple sources appear, (b) they are ordered by score desc, (c) disabling a module (e.g. drop `"raid"` from `features`) removes that source's actions, (d) the highest item is tier `"now"`.

```ts
import { describe, expect, it } from "vitest";
import { computeNextActions } from "./index";
import type { ActionInput } from "./types";
// Build `base` ActionInput with all module ids enabled + the fixtures above.
// (Construct minimal Task/RaidItem/ChangeItem/Milestone fixtures matching their real types.)
describe("computeNextActions (integration)", () => {
  it("ranks actions across sources and respects module gating", () => {
    // Arrange base input (all features) → Act → Assert ordering + a 'now' tier at the top
    // Then: const noRaid = { ...base, features: base.features.filter(f => f !== "raid") };
    // expect(computeNextActions(noRaid).every(a => a.source !== "raid")).toBe(true);
  });
});
```
Fill in the fixtures from the real types (the per-provider tests already establish the minimal shapes — reuse them).

- [ ] **Step 3:** `npx vitest run src/app/next-actions/` → all green. `npx tsc --noEmit && npx eslint src/app/next-actions --max-warnings=0` → clean.

- [ ] **Step 4: Full sweep** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → all green (report totals). SP1 adds no UI and touches no existing module, so the rest of the suite must be unaffected.

- [ ] **Step 5: Commit**
```bash
git add src/app/next-actions/index.ts src/app/next-actions/index.test.ts
git commit -m "feat: assemble next-actions provider registry + integration test"
```

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green; `npx eslint src/app --max-warnings=0` clean.
- [ ] Engine is pure: `grep -rE "from \"react\"|localStorage|\\bt\\(lang" src/app/next-actions` returns NOTHING (no React, no localStorage, no `t()` in the engine).
- [ ] No existing file modified except `i18n.ts`/`i18n.de.ts` (SP1 is additive). `git diff --stat main..HEAD` confirms.
- [ ] Use **superpowers:finishing-a-development-branch** (SP1 merges as an internal engine; SP2 surfaces it with the version bump + CHANGELOG).
