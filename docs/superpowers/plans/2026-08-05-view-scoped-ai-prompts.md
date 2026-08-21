# View-Scoped AI Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI assistant aware of which window the user is on — a purpose line for all 34 views, on-screen state for 4, concrete starter prompts for 26, and read tools for three data sets it currently cannot see.

**Architecture:** A new pure registry (`view-ai-scope.ts`) keyed by `AppView`, formatted by a pure block builder, injected into `buildSystemPrompt` with **no signature change** (it derives everything from the `snapshot` it already receives). A sparse digest registry contributes on-screen state for four views via `getSnapshot().viewDigest`. Deliberately separate from the user-authored `OperatingGuide` store so `settings.ai.groundInGuides` cannot switch shipped behavior off.

**Tech Stack:** TypeScript, React 19, Next.js 16, vitest 4.1.8, Playwright + axe.

---

## Spec

`docs/superpowers/specs/2026-08-05-view-scoped-ai-prompts-design.md`

## Two corrections to the spec, made during planning

**1. The split target changed.** The spec proposed extracting the `list_*`/`get_*` handlers from `use-chat-dispatcher.ts`. Those are one-liners over refs (`listRaid: () => raidRef.current.map(toRaidSummary)`); extracting every one frees ~10 lines and we need ~25. The real seam is `updateSettings`, whose ~58-line body is a pure `(patch, current) → { changes, applied }` computation with ref/setter writes only at the very end. Phase 0 extracts that instead. Same goal, working seam.

**2. `OperatingGuide` already carries `builtIn: boolean`.** We are deliberately **not** using it. Routing built-in view scope through the guide store is exactly the approach the spec rejected, because `settings.ai.groundInGuides` gates the whole guide block. Leave the field alone; a comment in `view-ai-scope.ts` records why.

## File structure

| File | Responsibility | Status |
|---|---|---|
| `src/app/chat-settings-patch.ts` | Pure `computeSettingsPatch` extracted from the dispatcher | Create (Phase 0) |
| `src/app/chat-settings-patch.test.ts` | Its unit tests | Create (Phase 0) |
| `src/app/use-chat-dispatcher.ts` | Loses the settings-patch body; gains 3 read handlers + `viewDigest` | Modify |
| `src/app/chat-tools.ts` | `ToolDispatcher` contract, `runTool` routing, summary mappers | Modify |
| `src/app/chat-tool-defs.ts` | Three new tool schemas | Modify |
| `src/app/view-ai-scope.ts` | The registry: `Record<AppView, ViewScope>` | Create (Phase 2) |
| `src/app/view-ai-scope-block.ts` | Formats registry entry + digest into prompt text | Create (Phase 2) |
| `src/app/view-ai-digest.ts` | Sparse `Partial<Record<AppView, DigestFn>>`, 4 views | Create (Phase 3) |
| `src/app/chat-api.ts` | Two new blocks in `buildSystemPrompt`; signature unchanged | Modify (Phase 2) |
| `src/app/ask-claude-prompts.ts` | 12 new view entries | Modify (Phase 4) |
| `src/app/i18n.ts` / `i18n.de.ts` | 48 keys × 2 languages | Modify (Phase 4) |
| `src/app/settings-sections/ai-view-scope-disclosure.tsx` | Read-only Settings surface | Create (Phase 5) |

**Size discipline.** `task-manager.tsx` (2972) and `chat-panel.tsx` (977) are baselined and **may not grow by one line**. Nothing in this plan touches either — that is why `buildSystemPrompt` keeps its signature and the digest is computed inside the dispatcher. Re-verify after every phase with `node scripts/check-file-sizes.mjs`.

---

## Phase 0 — Refactor-only: free headroom in the dispatcher

**Ships as its own commit. No version bump** (refactor-only, per the repo release rule).

### Task 0.1: Extract `computeSettingsPatch`

**Files:**
- Create: `src/app/chat-settings-patch.ts`
- Create: `src/app/chat-settings-patch.test.ts`
- Modify: `src/app/use-chat-dispatcher.ts` (the `updateSettings:` method)

- [ ] **Step 1: Write the failing test**

Create `src/app/chat-settings-patch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSettingsPatch } from "./chat-settings-patch";
import type { Settings } from "./types";

function baseSettings(): Settings {
  // Minimal shape the function reads. Cast is safe: computeSettingsPatch only
  // touches dashboardDensity, showViewHints, tasksViewMode, hideExternalTasks,
  // features and nextActions.
  return {
    dashboardDensity: "comfortable",
    showViewHints: true,
    tasksViewMode: "table",
    hideExternalTasks: false,
    features: [],
    nextActions: undefined,
  } as unknown as Settings;
}

describe("computeSettingsPatch", () => {
  it("returns empty changes for an empty patch", () => {
    const { changes, applied } = computeSettingsPatch({}, baseSettings());
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });

  it("accepts a valid dashboardDensity and reports it as applied", () => {
    const { changes, applied } = computeSettingsPatch(
      { dashboardDensity: "compact" },
      baseSettings(),
    );
    expect(changes.dashboardDensity).toBe("compact");
    expect(applied.dashboardDensity).toBe("compact");
  });

  it("ignores an invalid dashboardDensity rather than storing it", () => {
    const { changes, applied } = computeSettingsPatch(
      { dashboardDensity: "cosy" } as never,
      baseSettings(),
    );
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });

  it("accepts all three tasksViewMode values", () => {
    for (const mode of ["table", "board", "swimlane"] as const) {
      const { applied } = computeSettingsPatch({ tasksViewMode: mode }, baseSettings());
      expect(applied.tasksViewMode).toBe(mode);
    }
  });

  it("drops unknown module ids via sanitizeFeatures", () => {
    const { applied } = computeSettingsPatch(
      { enabledModules: ["budget", "not-a-module"] } as never,
      baseSettings(),
    );
    expect(applied.enabledModules).not.toContain("not-a-module");
  });

  it("ignores unknown nextActionsWeights keys and applies nothing for them", () => {
    const { changes, applied } = computeSettingsPatch(
      { nextActionsWeights: { bogusKey: 5 } } as never,
      baseSettings(),
    );
    expect(changes.nextActions).toBeUndefined();
    expect(applied.nextActionsWeights).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/chat-settings-patch.test.ts --reporter=dot
```

Expected: FAIL — `Failed to resolve import "./chat-settings-patch"`.

> `--reporter=basic` does not exist in vitest 4.1.8 and errors at startup. Use `--reporter=dot`.

- [ ] **Step 3: Create the module**

Create `src/app/chat-settings-patch.ts`. Move the body verbatim out of `use-chat-dispatcher.ts`'s `updateSettings`, changing only the ref reads into parameters:

```ts
// src/app/chat-settings-patch.ts
// Pure settings-patch computation for the AI `update_settings` tool. Extracted
// from use-chat-dispatcher so the hook stays under the 800-line ratchet and so
// the validation is unit-testable without React. No refs, no setters, no clock.
import { sanitizeFeatures } from "./feature-modules";
import { resolveNextActionsConfig, NEXT_ACTIONS_FIELD_COERCE } from "./next-actions-config";
import type { NextActionsConfig } from "./next-actions/types";
import type { Settings } from "./types";
import type { SettingsUpdateInput } from "./chat-tools";

export interface SettingsPatchResult {
  /** Only the CHANGED top-level fields, so the caller's functional setter merges
   *  onto the live `prev` and a concurrent non-AI edit keeps its own fields. */
  changes: Partial<Settings>;
  /** What to report back to the model as actually applied. */
  applied: Record<string, unknown>;
}

export function computeSettingsPatch(
  patch: SettingsUpdateInput,
  cur: Settings,
): SettingsPatchResult {
  const changes: Partial<Settings> = {};
  const applied: Record<string, unknown> = {};

  if (patch.dashboardDensity === "comfortable" || patch.dashboardDensity === "compact") {
    changes.dashboardDensity = patch.dashboardDensity;
    applied.dashboardDensity = patch.dashboardDensity;
  }
  if (typeof patch.showViewHints === "boolean") {
    changes.showViewHints = patch.showViewHints;
    applied.showViewHints = patch.showViewHints;
  }
  if (
    patch.tasksViewMode === "table" ||
    patch.tasksViewMode === "board" ||
    patch.tasksViewMode === "swimlane"
  ) {
    changes.tasksViewMode = patch.tasksViewMode;
    applied.tasksViewMode = patch.tasksViewMode;
  }
  if (typeof patch.hideExternalTasks === "boolean") {
    changes.hideExternalTasks = patch.hideExternalTasks;
    applied.hideExternalTasks = patch.hideExternalTasks;
  }
  if (patch.enabledModules !== undefined) {
    // sanitizeFeatures drops any unknown/invalid module id — a hallucinated id
    // can never enable a non-existent module.
    const feats = sanitizeFeatures(patch.enabledModules);
    changes.features = feats;
    applied.enabledModules = feats;
  }
  if (patch.nextActionsWeights && typeof patch.nextActionsWeights === "object") {
    const curCfg = resolveNextActionsConfig(cur.nextActions);
    const cfg: NextActionsConfig = { ...curCfg };
    const appliedWeights: Record<string, number> = {};
    for (const [k, v] of Object.entries(patch.nextActionsWeights as Record<string, unknown>)) {
      // Only known tuning fields, each clamped by its own coercer — the SAME
      // validators the settings UI uses. Unknown keys are ignored.
      if (Object.prototype.hasOwnProperty.call(NEXT_ACTIONS_FIELD_COERCE, k)) {
        const key = k as keyof NextActionsConfig;
        const coerced = NEXT_ACTIONS_FIELD_COERCE[key](v, curCfg[key]);
        cfg[key] = coerced;
        appliedWeights[k] = coerced;
      }
    }
    if (Object.keys(appliedWeights).length > 0) {
      changes.nextActions = cfg;
      applied.nextActionsWeights = appliedWeights;
    }
  }

  return { changes, applied };
}
```

> Before writing the imports, confirm where `sanitizeFeatures`, `resolveNextActionsConfig` and `NEXT_ACTIONS_FIELD_COERCE` are imported from in `use-chat-dispatcher.ts` and copy those exact paths. The paths above are the expected ones; grep to confirm rather than assume:
> `grep -n "sanitizeFeatures\|resolveNextActionsConfig\|NEXT_ACTIONS_FIELD_COERCE" src/app/use-chat-dispatcher.ts`

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/chat-settings-patch.test.ts --reporter=dot
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Replace the dispatcher body with a call**

In `src/app/use-chat-dispatcher.ts`, replace the whole `updateSettings:` method with:

```ts
      updateSettings: (patch: SettingsUpdateInput) => {
        if (args.isReadOnly) throw readOnlyError();
        const cur = settingsRef.current;
        const { changes, applied } = computeSettingsPatch(patch, cur);
        if (Object.keys(applied).length > 0) {
          // Ref kept in sync (like the entity setters) so a back-to-back tool
          // call reads the just-applied settings; persistence + writeSettings
          // run in the settings-save effect, exactly as for setLanguage.
          settingsRef.current = { ...cur, ...changes };
          args.setSettings((prev) => ({ ...prev, ...changes }));
        }
        return applied;
      },
```

Add the import, and **delete any imports that are now unused** — CI runs `eslint --max-warnings=0`, where an unused import is fatal:

```ts
import { computeSettingsPatch } from "./chat-settings-patch";
```

- [ ] **Step 6: Verify the whole suite, lint, types, and the size ratchet**

Run each unpiped and read its own exit code. **Never pipe a gate** — you get the pipe's status, not the command's.

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
```

Expected: all `EXIT=0`. `use-chat-dispatcher.ts` should now be ~750 lines — confirm with `wc -l src/app/use-chat-dispatcher.ts`; it must be under 800 with at least 25 lines to spare.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-settings-patch.ts src/app/chat-settings-patch.test.ts src/app/use-chat-dispatcher.ts
git commit -m "refactor(chat): extract computeSettingsPatch from the dispatcher

Frees headroom under the 800-line ratchet for the view-scope work and makes
the update_settings validation unit-testable without React. Behavior-identical:
the body moved verbatim, only ref reads became parameters."
```

No version bump — refactor-only.

---

## Phase 1 — Three read tools

### Task 1.1: Summary mappers and dispatcher contract

**Files:**
- Modify: `src/app/chat-tools.ts` (types, `ToolDispatcher`, mappers, `runTool`)
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-tools.test.ts`:

```ts
describe("read-tool summary mappers", () => {
  it("projects a knowledge item's rich description to plain text", () => {
    const summary = toKnowledgeSummary({
      id: 1,
      title: "Charter",
      description: "<p>Signed <strong>2026-01-05</strong></p>",
    } as never);
    expect(summary.description).toBe("Signed 2026-01-05");
    expect(summary.description).not.toContain("<");
  });

  it("returns a calendar event's series definition rather than an expansion", () => {
    const summary = toCalendarEventSummary({
      id: 7,
      title: "Weekly sync",
      start: "2026-02-02T09:00",
      recurrence: { freq: "weekly", interval: 1 },
    } as never);
    expect(summary.recurrence).toEqual({ freq: "weekly", interval: 1 });
    expect(Array.isArray((summary as Record<string, unknown>).occurrences)).toBe(false);
  });

  it("maps a budget bucket to id, label and its period hours", () => {
    const summary = toBudgetBucketSummary({
      id: 3,
      label: "Delivery",
      roleId: 2,
      periods: { "2026-01": 40 },
    } as never);
    expect(summary.id).toBe(3);
    expect(summary.label).toBe("Delivery");
  });
});
```

Add `toKnowledgeSummary`, `toCalendarEventSummary`, `toBudgetBucketSummary` to the file's existing import from `./chat-tools`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/chat-tools.test.ts --reporter=dot
```

Expected: FAIL — the three mappers are not exported.

- [ ] **Step 3: Add the mappers**

In `src/app/chat-tools.ts`, beside the existing `toRaidSummary` / `toChangeSummary` family. First read the real field names — do **not** guess:

```bash
grep -n "KnowledgeItem\b" -A 20 src/app/knowledge.ts | head -30
grep -n "CalendarEvent = \|type CalendarEvent" -A 20 src/app/*.ts | head -30
grep -n "BudgetBucket = " -A 20 src/app/types.ts | head -25
```

Then write mappers in the shape of the existing ones. The rich-text rule is non-negotiable — descriptions go through `descriptionText`, never raw:

```ts
import { descriptionText } from "./rich-text-projection";

export interface KnowledgeSummary {
  id: number;
  title: string;
  /** PLAIN text. A raw HTML dump floods the model's context and hands it markup
   *  it will echo back — the model may return either shape. */
  description: string;
}

export function toKnowledgeSummary(item: KnowledgeItem): KnowledgeSummary {
  return {
    id: item.id,
    title: item.title ?? "",
    description: descriptionText(item.description ?? ""),
  };
}
```

Write `toCalendarEventSummary` and `toBudgetBucketSummary` the same way, using the field names the greps above reported. The calendar mapper returns the `recurrence` object as stored and never expands occurrences.

- [ ] **Step 4: Extend the `ToolDispatcher` contract**

In the `export type ToolDispatcher = {` block:

```ts
  listKnowledgeItems(): KnowledgeSummary[];
  listCalendarEvents(): CalendarEventSummary[];
  listBudgetBuckets(): BudgetBucketSummary[];
```

- [ ] **Step 5: Route them in `runTool`**

Beside `case "list_allocations":`:

```ts
    case "list_knowledge_items":
      return d.listKnowledgeItems();

    case "list_calendar_events":
      return d.listCalendarEvents();

    case "list_budget_buckets":
      return d.listBudgetBuckets();
```

- [ ] **Step 6: Run the test — it should pass**

```bash
npx vitest run src/app/chat-tools.test.ts --reporter=dot
```

Expected: PASS. `tsc` will still fail until Task 1.3 implements the three methods — that is expected at this step.

### Task 1.2: Tool schemas

**Files:**
- Modify: `src/app/chat-tool-defs.ts` (`TOOL_DEFS`)

- [ ] **Step 1: Add the three definitions**

Append inside `TOOL_DEFS`, matching the existing read-tool style:

```ts
  {
    name: "list_knowledge_items",
    description:
      "List the standalone Knowledge-library items (documents, Confluence pages, URLs) with id, title, and a plain-text description. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_calendar_events",
    description:
      "List resource-calendar meetings with id, title, start, end, attendees, and the recurrence rule. Recurring events are returned ONCE as their series definition, not expanded per occurrence — compute occurrences yourself from the rule. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_budget_buckets",
    description:
      "List budget planner buckets with id, label, role, and per-period planned hours. This is PER-BUCKET detail. For project-level totals (hours, value, cost, margin, EV, CPI) call get_dashboard_snapshot instead — do NOT sum these buckets to derive a rollup, and do not report both as if they were independent figures. Read-only.",
    input_schema: { type: "object", properties: {} },
  },
```

> The negative instruction in `list_budget_buckets` is deliberate and follows the precedent set by `get_dashboard_snapshot`, which already tells the model not to back-derive cost from EV/CPI. Without it the model calls both tools and reconciles two views of the same money.

- [ ] **Step 2: Verify the schemas parse and nothing else broke**

```bash
npx vitest run src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: `EXIT=0`.

### Task 1.3: Implement the three dispatcher methods

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts`

- [ ] **Step 1: Write the failing test**

In `src/app/use-chat-dispatcher.test.tsx`, following the file's existing harness for rendering the hook:

```ts
it("lists knowledge items with plain-text descriptions", async () => {
  const { dispatcher } = renderDispatcher({
    knowledgeItems: [{ id: 1, title: "Charter", description: "<p>Signed</p>" }],
  });
  const items = await runTool(dispatcher, "list_knowledge_items", {});
  expect(items).toEqual([{ id: 1, title: "Charter", description: "Signed" }]);
});

it("returns an empty list when the workspace has no calendar events", async () => {
  const { dispatcher } = renderDispatcher({});
  await expect(runTool(dispatcher, "list_calendar_events", {})).resolves.toEqual([]);
});
```

> Match `renderDispatcher` to whatever helper that test file already uses; read the top of the file first. If the workspace fixture is built elsewhere, seed `knowledgeItems` there.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot
```

Expected: FAIL — `d.listKnowledgeItems is not a function`.

- [ ] **Step 3: Implement**

The three collections are all optional on `Workspace`, so each defaults to `[]`. Add refs alongside the existing entity refs (follow how `raidRef` is declared and kept in sync), then beside `listResources:`:

```ts
      listKnowledgeItems: () => (knowledgeItemsRef.current ?? []).map(toKnowledgeSummary),
      listCalendarEvents: () => (calendarEventsRef.current ?? []).map(toCalendarEventSummary),
      listBudgetBuckets: () => (budgetsRef.current ?? []).map(toBudgetBucketSummary),
```

`knowledgeItems`, `calendarEvents` and `budgets` all come from `useWorkspace()` — no new hook argument, so `task-manager.tsx` is untouched.

- [ ] **Step 4: Run the tests — they should pass**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx src/app/chat-tools.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 5: Verify the size ratchet still passes**

```bash
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
wc -l src/app/use-chat-dispatcher.ts src/app/chat-tools.ts src/app/chat-tool-defs.ts
```

Expected: `EXIT=0`, all three files under 800.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-tools.ts src/app/chat-tools.test.ts src/app/chat-tool-defs.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx
git commit -m "feat(ai): add read tools for knowledge items, calendar events and budget buckets

Three workspace-resident collections the assistant previously could not see.
Descriptions are projected to plain text via descriptionText; calendar events
return the series definition rather than an expansion; list_budget_buckets
points at get_dashboard_snapshot for rollups so the model does not reconcile
two views of the same money."
```

---

## Phase 2 — The view-scope registry and prompt block

### Task 2.1: The registry

**Files:**
- Create: `src/app/view-ai-scope.ts`
- Create: `src/app/view-ai-scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/view-ai-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import { TOOL_DEFS } from "./chat-tool-defs";

const TOOL_NAMES = new Set(TOOL_DEFS.map((d) => d.name));

describe("VIEW_AI_SCOPE", () => {
  it("gives every view a non-empty purpose", () => {
    for (const [view, scope] of Object.entries(VIEW_AI_SCOPE)) {
      expect(scope.purpose, `${view} has no purpose`).toBeTruthy();
    }
  });

  // The dead-hint guard. A hint naming a tool that does not exist tells the
  // model to call something that will throw — and the deferred timelog and
  // activity tools are exactly the names a future editor would reach for.
  it("only names tools that actually exist in TOOL_DEFS", () => {
    for (const [view, scope] of Object.entries(VIEW_AI_SCOPE)) {
      for (const hint of scope.toolHints ?? []) {
        expect(TOOL_NAMES.has(hint), `${view} hints at unknown tool "${hint}"`).toBe(true);
      }
    }
  });

  it("does not hint at the deferred timelog or activity tools", () => {
    const all = Object.values(VIEW_AI_SCOPE).flatMap((s) => s.toolHints ?? []);
    expect(all).not.toContain("list_timelog_entries");
    expect(all).not.toContain("list_activity");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/view-ai-scope.test.ts --reporter=dot
```

Expected: FAIL — cannot resolve `./view-ai-scope`.

- [ ] **Step 3: Create the registry**

Create `src/app/view-ai-scope.ts`. All 34 views, total by type:

```ts
// src/app/view-ai-scope.ts
// Pure, i18n-free registry describing each app view to the AI assistant.
// ENGLISH ONLY and deliberately so: the whole system prompt is English
// regardless of UI language (see `stableInstructions` in chat-api.ts); the
// model is told the active language code and answers in the user's language.
//
// ★ This is NOT an OperatingGuide and must never become one. OperatingGuide
//   carries a `builtIn` flag that makes routing built-ins through the guide
//   store look natural — but the whole guide block is gated by
//   `settings.ai.groundInGuides`, so doing that would let a user preference
//   silently switch off shipped product behavior. Keep these separate.
import type { AppView } from "./nav-config";

export interface ViewScope {
  /** What this surface is and what it shows. One or two sentences. */
  purpose: string;
  /** Tools most relevant here. Every entry MUST name a real tool in TOOL_DEFS
   *  — pinned by view-ai-scope.test.ts. */
  toolHints?: string[];
  /** Domain gloss: how to read what the view displays. */
  reading?: string;
}

/** Total by construction: adding an AppView is a typecheck error until it is
 *  described here. That is why there is no "every view is present" test — it
 *  could not fail. */
export const VIEW_AI_SCOPE: Record<AppView, ViewScope> = {
  projects: {
    purpose:
      "Projects lists every project in the portfolio and lets the user switch which one is active.",
    reading: "All other views show the ACTIVE project only. Tools read the active project's data.",
  },
  "portfolio-health": {
    purpose: "Portfolio health compares RAG status and progress across all projects.",
    toolHints: ["get_dashboard_snapshot"],
  },
  dashboard: {
    purpose:
      "Dashboard is the landing cockpit: RAG status, completion progress, earned-value metrics, KPI tiles and the delta strip.",
    toolHints: ["get_dashboard_snapshot", "list_tasks"],
    reading:
      "When a money figure is null, costUnknownReason says why. Report it as unknown, never as zero.",
  },
  actions: {
    purpose:
      "Next actions ranks what to do now, grouped into Now / Soon / Monitor tiers with a reason per signal.",
    toolHints: ["list_tasks", "list_raid"],
    reading: "Tier reflects urgency; the why-line explains which signal fired.",
  },
  insights: {
    purpose:
      "Insights shows detected project signals and their lifecycle (detected, reconciled, recommended, resolved).",
    toolHints: ["list_tasks", "list_raid"],
  },
  trends: {
    purpose: "Trends charts KPI movement over time from stored snapshots. Turso-only.",
    toolHints: ["get_dashboard_snapshot"],
    reading: "A trend needs at least two snapshots; with one the direction is unknown, not flat.",
  },
  history: {
    purpose: "Version history lists prior saved versions of the workspace. Turso-only.",
  },
  chat: {
    purpose: "The chat surface itself — the user is talking to you directly here.",
  },
  gantt: {
    purpose:
      "Gantt shows the schedule as bars over a date axis, with dependencies, the critical path, baselines and milestones.",
    toolHints: ["list_tasks", "list_milestones"],
    reading:
      "A dependency arrow means finish-to-start unless stated. Critical path = zero slack.",
  },
  milestones: {
    purpose: "Milestones is the register of key dates and their sign-off state.",
    toolHints: ["list_milestones"],
    reading: "A milestone is achieved only when achievedDate is set.",
  },
  resources: {
    purpose: "Resources is the people area: directory, workload, calendar, planning and roles.",
    toolHints: ["list_resources"],
  },
  directory: {
    purpose: "Directory is the roster of people with role, discipline, grade and contact details.",
    toolHints: ["list_resources", "get_resource"],
    reading:
      "Assigning a task to a name does NOT add that person here — the directory is its own register.",
  },
  workload: {
    purpose: "Workload shows capacity versus allocation per person over time.",
    toolHints: ["list_resources", "list_allocations"],
    reading:
      "Overload = allocated exceeds capacity. periodCapacityHours is hours ALREADY ALLOCATED, not hours available.",
  },
  calendar: {
    purpose: "Resource calendar shows meetings and absences on a date grid.",
    toolHints: ["list_calendar_events", "list_resources"],
    reading: "Recurring events are stored once as a series; occurrences are derived from the rule.",
  },
  planning: {
    purpose: "Planning is the allocation grid: planned hours per person per period.",
    toolHints: ["list_allocations", "list_resources"],
  },
  "manage-roles": {
    purpose: "Manage roles maintains the role, discipline and grade reference data.",
    toolHints: ["list_resources"],
  },
  budget: {
    purpose:
      "Budget is the planner: buckets of planned hours per role per period, with cost and margin.",
    toolHints: ["list_budget_buckets", "get_dashboard_snapshot"],
    reading:
      "list_budget_buckets is per-bucket detail; get_dashboard_snapshot is the project rollup. Do not sum buckets to derive a rollup.",
  },
  "budget-report": {
    purpose: "Budget report summarizes planned versus actual spend and earned value.",
    toolHints: ["get_dashboard_snapshot", "list_budget_buckets"],
  },
  raid: {
    purpose:
      "RAID is the register of Risks, Assumptions, Issues and Dependencies, each with an owner and a category-specific status.",
    toolHints: ["list_raid"],
    reading: "Status must match the category. Severity and the probability×impact score drive ranking.",
  },
  "raid-report": {
    purpose: "RAID report aggregates the register by category, severity and owner.",
    toolHints: ["list_raid"],
  },
  changes: {
    purpose: "Changes is the change-control register: requests, their impact and their decisions.",
    toolHints: ["list_changes"],
  },
  "change-report": {
    purpose: "Change report aggregates change requests by state, type and impact.",
    toolHints: ["list_changes"],
  },
  stakeholders: {
    purpose:
      "Stakeholders is the register of people and organizations with influence and interest levels.",
    toolHints: ["list_stakeholders"],
  },
  raci: {
    purpose:
      "RACI maps stakeholders to milestones as Responsible, Accountable, Consulted or Informed.",
    toolHints: ["list_stakeholders", "list_milestones"],
    reading: "Exactly one Accountable per milestone is the norm; more than one is a finding.",
  },
  "stakeholder-map": {
    purpose:
      "Stakeholder map plots stakeholders on an influence-versus-interest grid to show engagement strategy.",
    toolHints: ["list_stakeholders"],
    reading: "High influence + high interest = manage closely; low/low = monitor.",
  },
  knowledge: {
    purpose:
      "Knowledge is the library of standalone documents, Confluence pages and URLs, optionally cross-linked to tasks.",
    toolHints: ["list_knowledge_items"],
  },
  reports: {
    purpose: "Reports summarizes tasks by group, label and assignee with completion statistics.",
    toolHints: ["list_tasks", "get_dashboard_snapshot"],
    reading:
      "Cancelled work is a third bucket: neither open nor completed, and never overdue.",
  },
  activity: {
    purpose: "Activity is the audit log of recent changes made in the app.",
    reading: "You cannot read this log — there is no tool for it. Say so rather than guessing.",
  },
  "open-points": {
    purpose:
      "Open Points is the main task table: every task with status, assignee, due date, priority, blockers, group and labels.",
    toolHints: ["list_tasks", "get_task"],
    reading:
      "Done and Cancelled are both closed, but only Done counts as delivered. Cancelled is never overdue.",
  },
  settings: {
    purpose: "Settings configures the app: modules, appearance, storage, integrations and AI.",
    toolHints: ["get_app_state"],
  },
  help: {
    purpose: "Help explains what the app does and how to use it.",
  },
  "learning-insights": {
    purpose:
      "Learning insights shows what the next-actions engine has learned from the user's accept and dismiss decisions.",
  },
  "steering-committee": {
    purpose:
      "Steering committee holds board membership, meeting cadence and the information-pack schedule.",
    toolHints: ["list_stakeholders", "list_milestones"],
  },
  timelog: {
    purpose: "Timelog links external time-tracking entries to resources and budget buckets.",
    reading:
      "You cannot read booked time entries — there is no tool for it. Say so rather than estimating.",
  },
};
```

> The `activity` and `timelog` `reading` lines are load-bearing. Those are the two deferred tools; without an explicit "you cannot read this", the model invents plausible numbers.

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/view-ai-scope.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`. If `tsc` reports a missing key, the `AppView` union has a member the registry lacks — add it; that error is the totality guarantee doing its job.

### Task 2.2: The block builder

**Files:**
- Create: `src/app/view-ai-scope-block.ts`
- Create: `src/app/view-ai-scope-block.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildViewScopeBlock, buildViewStateBlock } from "./view-ai-scope-block";

describe("buildViewScopeBlock", () => {
  it("names the view and states its purpose", () => {
    const text = buildViewScopeBlock("workload");
    expect(text).toContain("workload");
    expect(text).toContain("capacity versus allocation");
  });

  it("lists tool hints when the view has them", () => {
    expect(buildViewScopeBlock("workload")).toContain("list_allocations");
  });

  it("omits the tools line entirely for a view with no hints", () => {
    const text = buildViewScopeBlock("help");
    expect(text).not.toContain("Relevant tools");
  });

  it("states that user guides win on conflict", () => {
    expect(buildViewScopeBlock("dashboard").toLowerCase()).toContain("operating guide");
  });
});

describe("buildViewStateBlock", () => {
  it("returns an empty string when there is no digest", () => {
    expect(buildViewStateBlock(undefined)).toBe("");
  });

  it("wraps a digest in a labelled block", () => {
    const text = buildViewStateBlock("3 people over capacity");
    expect(text).toContain("VIEW STATE");
    expect(text).toContain("3 people over capacity");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/view-ai-scope-block.test.ts --reporter=dot
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/view-ai-scope-block.ts
// Pure formatting of a ViewScope (and optional digest) into system-prompt text.
// Split from the registry so the registry stays data and the wording stays
// independently testable. English-only, same reason as view-ai-scope.ts.
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import type { AppView } from "./nav-config";

/** The CACHED-prefix block: what this surface is. Call-invariant for a view. */
export function buildViewScopeBlock(view: AppView): string {
  const scope = VIEW_AI_SCOPE[view];
  const lines = [
    `VIEW SCOPE — the user is looking at the "${view}" view.`,
    scope.purpose,
  ];
  if (scope.reading) lines.push(scope.reading);
  if (scope.toolHints && scope.toolHints.length > 0) {
    lines.push(`Relevant tools here: ${scope.toolHints.join(", ")}.`);
  }
  // Precedence, stated so the model can act on it. This is the INVERSE of the
  // guide-vs-guide rule in assembleGuideBlock ("earlier wins"), so it has to be
  // said out loud — a reader will otherwise assume that rule extends here.
  lines.push(
    "This describes the surface. An operating guide describes how the user wants you to work; where the two conflict, the operating guide wins.",
  );
  return lines.join("\n");
}

/** The VOLATILE-suffix block: what is currently ON that surface. */
export function buildViewStateBlock(digest: string | undefined): string {
  if (!digest) return "";
  return [
    "VIEW STATE — what is currently on the user's screen, after their filters and sorting.",
    "Prefer this over a tool call when the question is about what they can see.",
    digest,
  ].join("\n");
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/view-ai-scope-block.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: `EXIT=0`.

### Task 2.3: Wire both blocks into `buildSystemPrompt`

**Files:**
- Modify: `src/app/chat-api.ts` (`buildSystemPrompt`)
- Modify: `src/app/chat-tools.ts` (`getSnapshot` return type)
- Create: `src/app/chat-api.system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

`chat-api.ts` currently has **no** `buildSystemPrompt` coverage at all, so this is new ground. Create `src/app/chat-api.system-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./chat-api";

function snapshot(over: Record<string, unknown> = {}) {
  return {
    today: "2026-08-05",
    language: "en-US",
    holidayCountries: [],
    storageKind: "indexeddb",
    taskCount: 3,
    knownGroups: [],
    knownLabels: [],
    mode: "advanced",
    enabledModules: [],
    currentView: "workload",
    insights: [],
    ...over,
  } as never;
}

describe("buildSystemPrompt view scoping", () => {
  it("puts the view scope in the CACHED block", () => {
    const [stable] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(stable.text).toContain("VIEW SCOPE");
    expect(stable.text).toContain("capacity versus allocation");
  });

  // THE test of this feature. Moving the digest into the cached prefix breaks
  // nothing visible — it just invalidates the cache on every filter change and
  // silently raises cost. Nothing else would catch that.
  it("puts the digest in the UNCACHED block, never the cached one", () => {
    const [stable, volatile] = buildSystemPrompt(
      "en-US",
      snapshot({ viewDigest: "3 people over capacity" }),
      [],
      false,
    );
    expect(stable.text).not.toContain("3 people over capacity");
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(volatile.cache_control).toBeUndefined();
    expect(volatile.text).toContain("VIEW STATE");
    expect(volatile.text).toContain("3 people over capacity");
  });

  it("omits the VIEW STATE block when the view contributes no digest", () => {
    const [, volatile] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(volatile.text).not.toContain("VIEW STATE");
  });

  it("keeps the view scope when groundInGuides is off", () => {
    const [stable] = buildSystemPrompt("en-US", snapshot(), [], false);
    expect(stable.text).toContain("VIEW SCOPE");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/chat-api.system-prompt.test.ts --reporter=dot
```

Expected: FAIL — `stable.text` does not contain "VIEW SCOPE".

- [ ] **Step 3: Add `viewDigest` to the snapshot type**

In `src/app/chat-tools.ts`, inside `getSnapshot(): { … }`:

```ts
    /** Compact text describing what is currently ON the active view, after the
     *  user's filters. Only 4 views contribute one; absent elsewhere. Lands in
     *  the VOLATILE prompt suffix — see buildSystemPrompt. */
    viewDigest?: string;
```

- [ ] **Step 4: Wire the blocks in — no signature change**

In `buildSystemPrompt`, add the import and two insertions. **Do not add a parameter**: the call site is `chat-panel.tsx`, which is baselined and may not grow.

```ts
import { buildViewScopeBlock, buildViewStateBlock } from "./view-ai-scope-block";
```

Then, where `stableText` is assembled, insert the scope block between the fixed instructions and the guide block:

```ts
  const viewScopeBlock = buildViewScopeBlock(snapshot.currentView);
  const stableText = [stableInstructions, viewScopeBlock, guideBlock].filter(Boolean).join("\n\n");
```

And in the volatile list, after `appContext`:

```ts
  const viewStateBlock = buildViewStateBlock(snapshot.viewDigest);
  const volatileText = [
    `Today is ${snapshot.today}. UI language is ${snapshot.language}. Respond in the user's language. Storage backend: ${snapshot.storageKind}. Current task count: ${snapshot.taskCount}.`,
    `Known groups: ${groups}. Known labels: ${labels}. When the user mentions a category, prefer reusing an existing group or label rather than creating near-duplicates.`,
    appContext,
    viewStateBlock,
    insightsBlock,
  ]
    .filter(Boolean)
    .join("\n");
```

> `viewScopeBlock` is **not** gated by `groundInGuides`. That flag governs user guides only — the fourth test pins this.

- [ ] **Step 5: Run the tests — they should pass**

```bash
npx vitest run src/app/chat-api.system-prompt.test.ts src/app/chat-panel.test.tsx --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`. If `chat-panel.test.tsx` fails on a system-prompt string assertion, the added block changed text it pins — read the assertion and update it to match the new content rather than removing the block.

- [ ] **Step 6: Commit**

```bash
git add src/app/view-ai-scope.ts src/app/view-ai-scope.test.ts src/app/view-ai-scope-block.ts src/app/view-ai-scope-block.test.ts src/app/chat-api.ts src/app/chat-api.system-prompt.test.ts src/app/chat-tools.ts
git commit -m "feat(ai): describe every view to the assistant in the system prompt

Adds a total Record<AppView, ViewScope> registry and a VIEW SCOPE block in the
cached prefix, plus a VIEW STATE block in the volatile suffix for the digest
that lands next. buildSystemPrompt keeps its signature — both blocks derive
from the snapshot it already receives, so chat-panel.tsx is untouched.

Deliberately NOT routed through the OperatingGuide store: that block is gated
by settings.ai.groundInGuides, which would let a user preference switch off
shipped behavior."
```

---

## Phase 3 — On-screen digests for four views

### Task 3.1: The digest registry

**Files:**
- Create: `src/app/view-ai-digest.ts`
- Create: `src/app/view-ai-digest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { VIEW_AI_DIGEST, digestForView } from "./view-ai-digest";

describe("view digests", () => {
  it("covers exactly the four intended views", () => {
    expect(Object.keys(VIEW_AI_DIGEST).sort()).toEqual([
      "budget",
      "gantt",
      "open-points",
      "workload",
    ]);
  });

  it("returns undefined for a view with no digest", () => {
    expect(digestForView("raid", { tasks: [], resources: [] } as never)).toBeUndefined();
  });

  it("reports the visible task count and the active filters for open-points", () => {
    const text = digestForView("open-points", {
      tasks: [
        { id: 1, taskName: "A", status: "To Do", assignee: "Ana", dueDate: "2026-08-10" },
        { id: 2, taskName: "B", status: "Done", assignee: "Bo", dueDate: "2026-08-01" },
      ],
      filters: { assignee: "Ana", group: "__all__", label: "__all__" },
    } as never);
    expect(text).toContain("2");
    expect(text).toContain("Ana");
  });

  it("is clock-free: the same input yields the same output", () => {
    const input = { tasks: [], filters: {} } as never;
    expect(digestForView("open-points", input)).toBe(digestForView("open-points", input));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/view-ai-digest.test.ts --reporter=dot
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/view-ai-digest.ts
// Pure, i18n-free, CLOCK-FREE digests of what is currently on screen for the
// four views where the visible state IS the question. Deliberately Partial:
// the other 30 views cost nothing and nobody should fill them in for symmetry.
//
// Output lands in the VOLATILE prompt suffix. Keep each digest SHORT — it is
// paid on every message sent from that view.
import type { AppView } from "./nav-config";

export interface DigestInput {
  tasks: readonly { id: number; taskName: string; status: string; assignee: string; dueDate: string }[];
  filters?: Record<string, string>;
  resources?: readonly { id: number; firstName: string; lastName: string }[];
  allocations?: unknown;
  budgets?: readonly { id: number; label: string }[];
  milestones?: readonly { id: number; name: string; targetDate: string }[];
  /** Today, passed IN. Never read a clock here — a clock makes the digest
   *  untestable and breaks byte-stability. */
  today: string;
}

export type DigestFn = (input: DigestInput) => string;

const FILTER_ALL = "__all__";

function activeFilters(filters: Record<string, string> | undefined): string[] {
  if (!filters) return [];
  return Object.entries(filters)
    .filter(([, v]) => v && v !== FILTER_ALL)
    .map(([k, v]) => `${k}=${v}`);
}

const openPoints: DigestFn = (i) => {
  const filters = activeFilters(i.filters);
  const lines = [`${i.tasks.length} task(s) visible in the table.`];
  if (filters.length > 0) {
    lines.push(`Active filters: ${filters.join(", ")}. Rows outside these filters are NOT shown.`);
  } else {
    lines.push("No filters active — the table shows every task.");
  }
  const sample = i.tasks.slice(0, 15).map((t) => `#${t.id} ${t.taskName} [${t.status}]`);
  if (sample.length > 0) lines.push(`Visible rows: ${sample.join("; ")}`);
  if (i.tasks.length > sample.length) {
    lines.push(`(${i.tasks.length - sample.length} further visible rows not listed.)`);
  }
  return lines.join("\n");
};

const workload: DigestFn = (i) => {
  const people = (i.resources ?? []).length;
  return `Workload grid for ${people} resource(s). Capacity and allocation figures are in the grid; call list_allocations for the numbers.`;
};

const gantt: DigestFn = (i) =>
  `Gantt showing ${i.tasks.length} task(s) and ${(i.milestones ?? []).length} milestone(s).`;

const budget: DigestFn = (i) =>
  `Budget planner with ${(i.budgets ?? []).length} bucket(s). Call list_budget_buckets for per-bucket detail and get_dashboard_snapshot for the rollup.`;

export const VIEW_AI_DIGEST: Partial<Record<AppView, DigestFn>> = {
  "open-points": openPoints,
  workload,
  gantt,
  budget,
};

export function digestForView(view: AppView, input: DigestInput): string | undefined {
  const fn = VIEW_AI_DIGEST[view];
  return fn ? fn(input) : undefined;
}
```

> The 15-row cap is a real truncation and the digest says so on the next line. A silent cap reads as "these are all the rows", which is the failure mode this whole feature exists to remove.

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/app/view-ai-digest.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: `EXIT=0`.

### Task 3.2: Feed the digest through the dispatcher snapshot

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (`getSnapshot`)
- Modify: `src/app/use-chat-dispatcher.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it("includes a viewDigest on a digest view and omits it elsewhere", () => {
  const onWorkload = renderDispatcher({ currentView: "workload" });
  expect(onWorkload.dispatcher.getSnapshot().viewDigest).toBeTruthy();

  const onRaid = renderDispatcher({ currentView: "raid" });
  expect(onRaid.dispatcher.getSnapshot().viewDigest).toBeUndefined();
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=dot
```

Expected: FAIL — `viewDigest` is `undefined` on the workload case.

- [ ] **Step 3: Implement**

In `getSnapshot()`, alongside `currentView: viewRef.current`:

```ts
          viewDigest: digestForView(viewRef.current, {
            tasks: tasksRef.current,
            filters: effectiveFilters,
            resources: resourcesRef.current,
            budgets: budgetsRef.current ?? [],
            milestones: milestonesRef.current ?? [],
            today: todayRef.current,
          }),
```

Add the import. `effectiveFilters` comes from the existing `useWorkspace()` destructure at the top of the hook — add it there if it is not already pulled.

> This is computed inside `getSnapshot()`, which runs at message-send time, not per render — the same laziness the file already documents for `getBudgetRollup` and `getAllocationsSnapshot`. No new hook argument, so `task-manager.tsx` stays untouched.

- [ ] **Step 4: Run the tests and the ratchet**

```bash
npx vitest run src/app/use-chat-dispatcher.test.tsx src/app/chat-api.system-prompt.test.ts --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
```

Expected: all `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/view-ai-digest.ts src/app/view-ai-digest.test.ts src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx
git commit -m "feat(ai): hand the assistant the on-screen state for four views

open-points, workload, gantt and budget contribute a short digest of what is
currently visible after the user's filters. Lands in the volatile prompt suffix
so it never invalidates the cached prefix. Clock-free and computed at send time
inside getSnapshot, so no new dispatcher argument and no task-manager change."
```

---

## Phase 4 — Chips and i18n

### Task 4.1: Add the 12 view entries

**Files:**
- Modify: `src/app/ask-claude-prompts.ts` (`ASK_CLAUDE_PROMPTS`)
- Modify: `src/app/ask-claude-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/ask-claude-prompts.test.ts`:

```ts
  it("offers on-page prompts for every view that has the tools to answer them", () => {
    const expected = [
      "actions", "budget", "budget-report", "calendar", "change-report", "changes",
      "dashboard", "directory", "gantt", "insights", "knowledge", "manage-roles",
      "milestones", "open-points", "planning", "portfolio-health", "raci", "raid",
      "raid-report", "reports", "resources", "stakeholder-map", "stakeholders",
      "steering-committee", "trends", "workload",
    ];
    expect(Object.keys(ASK_CLAUDE_PROMPTS).sort()).toEqual(expected);
  });

  // Dead prompts are the failure this feature exists to remove: a chip that
  // asks a question no tool can answer.
  it("has no chips for the views whose read tools are deferred", () => {
    expect(ASK_CLAUDE_PROMPTS.timelog).toBeUndefined();
    expect(ASK_CLAUDE_PROMPTS.activity).toBeUndefined();
  });

  it("every chipped view has tool hints or a digest behind it", () => {
    for (const view of Object.keys(ASK_CLAUDE_PROMPTS) as AppView[]) {
      const hasHints = (VIEW_AI_SCOPE[view].toolHints ?? []).length > 0;
      const hasDigest = VIEW_AI_DIGEST[view] !== undefined;
      expect(hasHints || hasDigest, `${view} has chips but no capability`).toBe(true);
    }
  });
```

Add to the imports:

```ts
import { VIEW_AI_SCOPE } from "./view-ai-scope";
import { VIEW_AI_DIGEST } from "./view-ai-digest";
import type { AppView } from "./nav-config";
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/ask-claude-prompts.test.ts --reporter=dot
```

Expected: FAIL — the key list has 14 entries, not 26.

- [ ] **Step 3: Add the 12 entries**

In `ASK_CLAUDE_PROMPTS`, add:

```ts
  insights: [
    { labelKey: "aiPromptInsTopLabel", bodyKey: "aiPromptInsTopBody" },
    { labelKey: "aiPromptInsActLabel", bodyKey: "aiPromptInsActBody" },
  ],
  directory: [
    { labelKey: "aiPromptDirGapsLabel", bodyKey: "aiPromptDirGapsBody" },
    { labelKey: "aiPromptDirUnlinkedLabel", bodyKey: "aiPromptDirUnlinkedBody" },
  ],
  workload: [
    { labelKey: "aiPromptWlOverloadLabel", bodyKey: "aiPromptWlOverloadBody" },
    { labelKey: "aiPromptWlRebalanceLabel", bodyKey: "aiPromptWlRebalanceBody" },
  ],
  calendar: [
    { labelKey: "aiPromptCalWeekLabel", bodyKey: "aiPromptCalWeekBody" },
    { labelKey: "aiPromptCalClashLabel", bodyKey: "aiPromptCalClashBody" },
  ],
  planning: [
    { labelKey: "aiPromptPlanGapsLabel", bodyKey: "aiPromptPlanGapsBody" },
    { labelKey: "aiPromptPlanRampLabel", bodyKey: "aiPromptPlanRampBody" },
  ],
  "manage-roles": [
    { labelKey: "aiPromptRolesUnusedLabel", bodyKey: "aiPromptRolesUnusedBody" },
    { labelKey: "aiPromptRolesCoverLabel", bodyKey: "aiPromptRolesCoverBody" },
  ],
  "budget-report": [
    { labelKey: "aiPromptBrVarianceLabel", bodyKey: "aiPromptBrVarianceBody" },
    { labelKey: "aiPromptBrForecastLabel", bodyKey: "aiPromptBrForecastBody" },
  ],
  "raid-report": [
    { labelKey: "aiPromptRrConcentrationLabel", bodyKey: "aiPromptRrConcentrationBody" },
    { labelKey: "aiPromptRrAgeingLabel", bodyKey: "aiPromptRrAgeingBody" },
  ],
  "change-report": [
    { labelKey: "aiPromptCrPendingLabel", bodyKey: "aiPromptCrPendingBody" },
    { labelKey: "aiPromptCrImpactLabel", bodyKey: "aiPromptCrImpactBody" },
  ],
  raci: [
    { labelKey: "aiPromptRaciGapsLabel", bodyKey: "aiPromptRaciGapsBody" },
    { labelKey: "aiPromptRaciOverloadLabel", bodyKey: "aiPromptRaciOverloadBody" },
  ],
  "stakeholder-map": [
    { labelKey: "aiPromptSmapCloseLabel", bodyKey: "aiPromptSmapCloseBody" },
    { labelKey: "aiPromptSmapNeglectLabel", bodyKey: "aiPromptSmapNeglectBody" },
  ],
  "portfolio-health": [
    { labelKey: "aiPromptPhWorstLabel", bodyKey: "aiPromptPhWorstBody" },
    { labelKey: "aiPromptPhCompareLabel", bodyKey: "aiPromptPhCompareBody" },
  ],
```

- [ ] **Step 4: Run — the key-set test passes, the i18n test now fails**

```bash
npx vitest run src/app/ask-claude-prompts.test.ts --reporter=dot
```

Expected: the key-set and coherence tests PASS; "every label/body key resolves in EN and DE" FAILS with 48 unresolved keys. That is the next task.

### Task 4.2: The 48 English strings

**Files:**
- Modify: `src/app/i18n.ts`

- [ ] **Step 1: Add the keys**

Insert beside the existing `aiPrompt*` block (near `aiPromptRaidTopLabel`):

```ts
  aiPromptInsTopLabel: "Top signals",
  aiPromptInsTopBody: "Summarize the most important open insights and what triggered each one.",
  aiPromptInsActLabel: "What to act on",
  aiPromptInsActBody: "Which of these insights should I act on first, and what is the concrete next step for each?",
  aiPromptDirGapsLabel: "Missing details",
  aiPromptDirGapsBody: "Which people in the directory are missing a role, discipline, grade or email?",
  aiPromptDirUnlinkedLabel: "Unlinked assignees",
  aiPromptDirUnlinkedBody: "Which task assignees are not linked to a person in the directory, and should they be added?",
  aiPromptWlOverloadLabel: "Who is overloaded",
  aiPromptWlOverloadBody: "Which people are allocated above their capacity, in which periods, and by how much?",
  aiPromptWlRebalanceLabel: "Rebalance",
  aiPromptWlRebalanceBody: "Suggest how to rebalance work from overloaded people to those with spare capacity.",
  aiPromptCalWeekLabel: "This week",
  aiPromptCalWeekBody: "What meetings and absences fall in the next seven days?",
  aiPromptCalClashLabel: "Find clashes",
  aiPromptCalClashBody: "Are any people booked into overlapping meetings, or into a meeting during an absence?",
  aiPromptPlanGapsLabel: "Unstaffed work",
  aiPromptPlanGapsBody: "Which periods have planned work with no one allocated to deliver it?",
  aiPromptPlanRampLabel: "Ramp-up risk",
  aiPromptPlanRampBody: "Where does the plan ramp up sharply between periods, and is that staffing realistic?",
  aiPromptRolesUnusedLabel: "Unused roles",
  aiPromptRolesUnusedBody: "Which roles, disciplines or grades are defined but not used by anyone?",
  aiPromptRolesCoverLabel: "Coverage",
  aiPromptRolesCoverBody: "Which roles are held by only one person, leaving no cover if they are unavailable?",
  aiPromptBrVarianceLabel: "Explain variance",
  aiPromptBrVarianceBody: "Explain the variance between planned and actual spend, and what is driving it.",
  aiPromptBrForecastLabel: "Forecast",
  aiPromptBrForecastBody: "Based on the cost performance so far, what is the likely outturn against budget?",
  aiPromptRrConcentrationLabel: "Concentration",
  aiPromptRrConcentrationBody: "Is the RAID register concentrated on any one owner, category or area of the project?",
  aiPromptRrAgeingLabel: "Ageing items",
  aiPromptRrAgeingBody: "Which RAID items have been open longest without a status change, and why might that be?",
  aiPromptCrPendingLabel: "Awaiting decision",
  aiPromptCrPendingBody: "Which change requests are still awaiting a decision, and which are holding up delivery?",
  aiPromptCrImpactLabel: "Biggest impact",
  aiPromptCrImpactBody: "Which approved changes had the largest impact on scope, cost or schedule?",
  aiPromptRaciGapsLabel: "RACI gaps",
  aiPromptRaciGapsBody: "Which milestones have no Accountable stakeholder, or more than one?",
  aiPromptRaciOverloadLabel: "Overcommitted",
  aiPromptRaciOverloadBody: "Which stakeholders are Accountable for many milestones at once?",
  aiPromptSmapCloseLabel: "Manage closely",
  aiPromptSmapCloseBody: "Which stakeholders have both high influence and high interest, and how should I engage them?",
  aiPromptSmapNeglectLabel: "Being neglected",
  aiPromptSmapNeglectBody: "Which high-influence stakeholders have had little engagement, and what should I do about it?",
  aiPromptPhWorstLabel: "Worst performing",
  aiPromptPhWorstBody: "Which projects in the portfolio are in the worst health, and what is driving each one?",
  aiPromptPhCompareLabel: "Compare projects",
  aiPromptPhCompareBody: "Compare the projects on progress, budget performance and open risks.",
```

- [ ] **Step 2: Verify the EN half resolves**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: **FAIL** — `tsc` enforces EN/DE key parity, so 48 keys missing from `i18n.de.ts` is a type error. That is the gate working. The next task fixes it.

### Task 4.3: The 48 German strings

**Files:**
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Read the landmines before touching this file**

`i18n.de.ts` is **CRLF**. The Edit tool corrupts umlauts and curls double quotes there — including in umlaut-free strings. Patch it with a node utf8 write anchored on `\r\n`, never with an LF anchor (an LF-anchored replace silently no-ops and reports success).

- [ ] **Step 2: Write the keys via a node script**

Save as `scratch-de-keys.mjs` outside the repo (or in the scratchpad), run it, then delete it:

```js
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "src/app/i18n.de.ts";
const ANCHOR = "  aiPromptRaidTopLabel:";           // an existing key line
const BLOCK = [
  '  aiPromptInsTopLabel: "Wichtigste Signale",',
  '  aiPromptInsTopBody: "Fasse die wichtigsten offenen Insights zusammen und nenne den jeweiligen Auslöser.",',
  '  aiPromptInsActLabel: "Woran zuerst arbeiten",',
  '  aiPromptInsActBody: "Welche dieser Insights sollte ich zuerst angehen, und was ist jeweils der konkrete nächste Schritt?",',
  '  aiPromptDirGapsLabel: "Fehlende Angaben",',
  '  aiPromptDirGapsBody: "Bei welchen Personen im Verzeichnis fehlen Rolle, Disziplin, Stufe oder E-Mail-Adresse?",',
  '  aiPromptDirUnlinkedLabel: "Nicht verknüpfte Zuständige",',
  '  aiPromptDirUnlinkedBody: "Welche Aufgaben-Zuständigen sind mit keiner Person im Verzeichnis verknüpft, und sollten sie ergänzt werden?",',
  '  aiPromptWlOverloadLabel: "Wer ist überlastet",',
  '  aiPromptWlOverloadBody: "Welche Personen sind über ihrer Kapazität eingeplant, in welchen Perioden und um wie viel?",',
  '  aiPromptWlRebalanceLabel: "Neu verteilen",',
  '  aiPromptWlRebalanceBody: "Schlage vor, wie Arbeit von überlasteten Personen zu Personen mit freier Kapazität verlagert werden kann.",',
  '  aiPromptCalWeekLabel: "Diese Woche",',
  '  aiPromptCalWeekBody: "Welche Termine und Abwesenheiten fallen in die nächsten sieben Tage?",',
  '  aiPromptCalClashLabel: "Konflikte finden",',
  '  aiPromptCalClashBody: "Sind Personen in überlappende Termine gebucht oder während einer Abwesenheit eingeplant?",',
  '  aiPromptPlanGapsLabel: "Unbesetzte Arbeit",',
  '  aiPromptPlanGapsBody: "In welchen Perioden ist Arbeit geplant, für die niemand eingeplant ist?",',
  '  aiPromptPlanRampLabel: "Hochlauf-Risiko",',
  '  aiPromptPlanRampBody: "Wo steigt der Plan zwischen Perioden stark an, und ist diese Besetzung realistisch?",',
  '  aiPromptRolesUnusedLabel: "Ungenutzte Rollen",',
  '  aiPromptRolesUnusedBody: "Welche Rollen, Disziplinen oder Stufen sind definiert, werden aber von niemandem genutzt?",',
  '  aiPromptRolesCoverLabel: "Abdeckung",',
  '  aiPromptRolesCoverBody: "Welche Rollen hält nur eine Person, sodass es bei Ausfall keine Vertretung gibt?",',
  '  aiPromptBrVarianceLabel: "Abweichung erklären",',
  '  aiPromptBrVarianceBody: "Erkläre die Abweichung zwischen geplanten und tatsächlichen Kosten und ihre Treiber.",',
  '  aiPromptBrForecastLabel: "Prognose",',
  '  aiPromptBrForecastBody: "Wie fällt das voraussichtliche Endergebnis gegenüber dem Budget aus, ausgehend von der bisherigen Kostenentwicklung?",',
  '  aiPromptRrConcentrationLabel: "Häufung",',
  '  aiPromptRrConcentrationBody: "Häuft sich das RAID-Register bei einem Verantwortlichen, einer Kategorie oder einem Projektbereich?",',
  '  aiPromptRrAgeingLabel: "Alte Einträge",',
  '  aiPromptRrAgeingBody: "Welche RAID-Einträge sind am längsten ohne Statusänderung offen, und woran könnte das liegen?",',
  '  aiPromptCrPendingLabel: "Offene Entscheidungen",',
  '  aiPromptCrPendingBody: "Welche Änderungsanträge warten noch auf eine Entscheidung, und welche blockieren die Lieferung?",',
  '  aiPromptCrImpactLabel: "Größte Auswirkung",',
  '  aiPromptCrImpactBody: "Welche genehmigten Änderungen hatten die größte Auswirkung auf Umfang, Kosten oder Termine?",',
  '  aiPromptRaciGapsLabel: "RACI-Lücken",',
  '  aiPromptRaciGapsBody: "Für welche Meilensteine gibt es keinen oder mehr als einen Accountable?",',
  '  aiPromptRaciOverloadLabel: "Übercommittet",',
  '  aiPromptRaciOverloadBody: "Welche Stakeholder sind gleichzeitig für viele Meilensteine accountable?",',
  '  aiPromptSmapCloseLabel: "Eng begleiten",',
  '  aiPromptSmapCloseBody: "Welche Stakeholder haben hohen Einfluss und hohes Interesse, und wie sollte ich sie einbinden?",',
  '  aiPromptSmapNeglectLabel: "Vernachlässigt",',
  '  aiPromptSmapNeglectBody: "Welche einflussreichen Stakeholder wurden bisher kaum eingebunden, und was sollte ich tun?",',
  '  aiPromptPhWorstLabel: "Schlechteste Projekte",',
  '  aiPromptPhWorstBody: "Welche Projekte im Portfolio sind am schlechtesten aufgestellt, und was treibt das jeweils?",',
  '  aiPromptPhCompareLabel: "Projekte vergleichen",',
  '  aiPromptPhCompareBody: "Vergleiche die Projekte nach Fortschritt, Kostenentwicklung und offenen Risiken.",',
].join("\r\n");

const src = readFileSync(PATH, "utf8");
const idx = src.indexOf(ANCHOR);
if (idx === -1) throw new Error(`anchor not found: ${ANCHOR}`);   // fail loud, never no-op
writeFileSync(PATH, src.slice(0, idx) + BLOCK + "\r\n" + src.slice(idx), "utf8");
console.log("inserted 48 DE keys");
```

Run it:

```bash
node scratch-de-keys.mjs
```

Expected: `inserted 48 DE keys`. If it throws on the anchor, **stop** — do not weaken the anchor; find the real text first.

- [ ] **Step 3: Verify the umlauts survived and line endings are intact**

```bash
grep -c $'\r' src/app/i18n.de.ts; echo "CR lines above"
grep -n "Auslöser\|überlastet\|Häufung\|Größte" src/app/i18n.de.ts | head
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: CR count equals the file's line count (still CRLF throughout); the umlaut greps hit; `EXIT=0`. The encoding test bans ASCII substitutes (`fuer`) **and** `\u00XX` escapes — real umlauts only.

- [ ] **Step 4: Run the full check**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/ask-claude-prompts.test.ts --reporter=dot; echo "EXIT=$?"
```

Expected: both `EXIT=0`. `tsc` passing is the EN/DE parity proof — `test:run` alone would not catch a missing DE key.

- [ ] **Step 5: Delete the scratch script and commit**

```bash
rm scratch-de-keys.mjs
git add src/app/ask-claude-prompts.ts src/app/ask-claude-prompts.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(ai): add starter prompts for twelve more views

Chips now cover 26 of 34 views. The eight without them are deliberate: chat
duplicates itself, settings/help/projects have nothing to ask, activity and
history have no read tool, learning-insights is a deep-link target, and timelog
would be a dead prompt until its deferred tool lands. A new test pins that every
chipped view has tool hints or a digest behind it."
```

---

## Phase 5 — Settings disclosure

### Task 5.1: The read-only disclosure

**Files:**
- Create: `src/app/settings-sections/ai-view-scope-disclosure.tsx`
- Create: `src/app/settings-sections/ai-view-scope-disclosure.test.tsx`
- Modify: `src/app/settings-sections/ai-section.tsx` (mount only)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (3 chrome keys)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiViewScopeDisclosure } from "./ai-view-scope-disclosure";
import { loadI18n } from "../i18n";

describe("AiViewScopeDisclosure", () => {
  beforeAll(async () => { await loadI18n("de"); });

  it("lists every view", () => {
    render(<AiViewScopeDisclosure lang="en-US" />);
    expect(screen.getAllByRole("button", { name: /show/i }).length).toBe(34);
  });

  // N identical "Show" buttons is a WCAG 2.4.6 failure that axe can pass when
  // only one row renders at scan time. Row-unique names are the fix.
  it("gives every toggle a row-unique accessible name", () => {
    render(<AiViewScopeDisclosure lang="en-US" />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("reveals the purpose text when a row is expanded", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    await user.click(screen.getByRole("button", { name: /workload/i }));
    expect(screen.getByText(/capacity versus allocation/i)).toBeInTheDocument();
  });

  it("is reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<AiViewScopeDisclosure lang="en-US" />);
    await user.tab();
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});
```

> `.focus()` never proves focusability — `userEvent.tab()` does. That is why the last test tabs.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/settings-sections/ai-view-scope-disclosure.test.tsx --reporter=dot
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
"use client";
// Read-only disclosure of what the app tells the AI about each view. Its own
// file because ai-section.tsx sits at 779 lines against an 800-line ratchet.
//
// The prompt text shown here is ENGLISH even in a German UI, and that is
// correct: the whole system prompt is English (see stableInstructions in
// chat-api.ts). Only the chrome around it is translated.
import { useState } from "react";
import { VIEW_AI_SCOPE } from "../view-ai-scope";
import { VIEW_AI_DIGEST } from "../view-ai-digest";
import { ToggleButton } from "../toggle-button";
import { navLabelKey } from "../nav-config";
import { t, type Lang } from "../i18n";
import type { AppView } from "../nav-config";

export function AiViewScopeDisclosure({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState<Set<AppView>>(new Set());
  const views = Object.keys(VIEW_AI_SCOPE) as AppView[];

  function toggle(view: AppView) {
    // Immutable update — never mutate the Set in place.
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(view)) next.delete(view);
      else next.add(view);
      return next;
    });
  }

  return (
    <div>
      <h3 className="font-medium">{t(lang, "aiViewScopeTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t(lang, "aiViewScopeIntro")}</p>
      <ul>
        {views.map((view) => {
          const scope = VIEW_AI_SCOPE[view];
          const label = view === "learning-insights" ? view : t(lang, navLabelKey(view));
          const isOpen = open.has(view);
          return (
            <li key={view}>
              <ToggleButton
                lang={lang}
                pressed={isOpen}
                onToggle={() => toggle(view)}
                // Row-UNIQUE name. N identical "Show" labels is a WCAG 2.4.6
                // failure the axe gate can pass when one row renders.
                ariaLabel={`${t(lang, "show")} – ${label}`}
              >
                {label}
              </ToggleButton>
              {isOpen && (
                <div className="text-sm">
                  <p>{scope.purpose}</p>
                  {scope.reading && <p>{scope.reading}</p>}
                  {scope.toolHints && scope.toolHints.length > 0 && (
                    <p><code>{scope.toolHints.join(", ")}</code></p>
                  )}
                  {VIEW_AI_DIGEST[view] && <p>{t(lang, "aiViewScopeDigest")}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

> `navLabelKey` throws for `learning-insights` — `LABEL_KEYS` excludes it. The ternary handles that; confirm the real behavior with `grep -n "navLabelKey" -A 8 src/app/nav-config.ts` and adjust if it returns a fallback instead of throwing.

- [ ] **Step 4: Add the three chrome keys**

`i18n.ts`:

```ts
  aiViewScopeTitle: "What Claude knows about each view",
  aiViewScopeIntro: "Claude is told what the view you are on is for. This text is sent in English regardless of your interface language.",
  aiViewScopeDigest: "Also receives a summary of what is currently on screen.",
```

`i18n.de.ts` — via the same node-write approach as Task 4.3, never the Edit tool:

```
  aiViewScopeTitle: "Was Claude über die einzelnen Ansichten weiß",
  aiViewScopeIntro: "Claude erfährt, wofür die aktuelle Ansicht da ist. Dieser Text wird unabhängig von der Oberflächensprache auf Englisch gesendet.",
  aiViewScopeDigest: "Erhält zusätzlich eine Zusammenfassung des aktuell Sichtbaren.",
```

- [ ] **Step 5: Mount it in the AI section**

In `src/app/settings-sections/ai-section.tsx`, below the operating-guides block:

```tsx
      <AiViewScopeDisclosure lang={lang} />
```

plus the import. That is **two lines** into a 779-line file — verify the ratchet immediately.

- [ ] **Step 6: Run the tests and every gate**

```bash
npx vitest run src/app/settings-sections/ai-view-scope-disclosure.test.tsx src/app/settings-sections/ai-section.test.tsx --reporter=dot; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
wc -l src/app/settings-sections/ai-section.tsx
```

Expected: all `EXIT=0`, `ai-section.tsx` under 800.

- [ ] **Step 7: Verify accessibility by hand**

`Settings` is in `A11Y_VIEWS` but the gate scans **General**, so the AI section is never reached by axe. Check contrast and labels by eye — the Calendar sub-tab shipped an AA contrast failure under a full 85/85 axe pass for exactly this reason.

```bash
PORT=3100 npm run dev
# open http://localhost:3100 → Settings → AI, expand several rows,
# check contrast in both light and dark schemes, tab through the toggles
PORT=3100 npm run stop
```

- [ ] **Step 8: Commit**

```bash
git add src/app/settings-sections/ai-view-scope-disclosure.tsx src/app/settings-sections/ai-view-scope-disclosure.test.tsx src/app/settings-sections/ai-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(settings): disclose what Claude is told about each view

Read-only list of all 34 views. Own file because ai-section.tsx has 21 lines of
headroom against the ratchet. Toggles carry row-unique accessible names — N
identical Show labels is a WCAG 2.4.6 failure the axe gate can pass when only
one row renders."
```

---

## Phase 6 — Full gates and docs

### Task 6.1: Run every gate serially

- [ ] **Step 1: Run them one at a time**

**Serially.** Running `dup:check` alongside `test:coverage` produced a worker start timeout that exited 1 with every test passing.

```bash
npm run lint > /tmp/lint.log 2>&1; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
```

> `npm run lint` is bare `eslint` with no `--max-warnings`, so it exits 0 even with warnings. The second command is the actual CI gate.
> Never read a gate's exit code through a pipe — you get the pipe's status. Redirect, check unpiped, then read the file.

Expected: every `EXIT=0`.

- [ ] **Step 2: If `dup:check` fails**

The 26 chip literals and 34 registry entries are structurally similar and jscpd is per-format and blocking. If it trips, restructure the duplicated shape — do **not** raise the threshold. A defeated gate reports success.

- [ ] **Step 3: If `test:coverage` fails on the new engines**

`view-ai-scope.ts`, `view-ai-scope-block.ts`, `view-ai-digest.ts` and `chat-settings-patch.ts` are coverage-gated (global lines 92 / funcs 91 / branch 80). Add tests for the uncovered branches. The disclosure `.tsx` is already excluded by the `.tsx` rule.

- [ ] **Step 4: Run the a11y gate on a fresh isolated server**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"; echo "EXIT=$?"
```

Expected: `EXIT=0`. If anything in `globals.css` changed, use a fresh `PORT=3100` server rather than a long-running one — Playwright's `reuseExistingServer` attaches to a stale `:3000` whose Tailwind has not regenerated, producing phantom failures.

### Task 6.2: Update the docs

**Files:**
- Modify: `docs/AGENTS/ai-assistant.md`
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Document the subsystem**

Add to `docs/AGENTS/ai-assistant.md` a section covering: the registry is total by type; the scope block is **not** gated by `groundInGuides` and **not** counted in `GUIDE_CHAR_BUDGET`; the digest must stay in the volatile suffix; `VIEW_AI_DIGEST` is `Partial` on purpose; and the chip↔capability rule.

Put the reproduce command beside any count you write — counts rot and no gate sees them:

```
26 of 34 views carry chips (2026-08-05, reproduce:
`node -e "import('./src/app/ask-claude-prompts.ts')"` or count the keys in ASK_CLAUDE_PROMPTS).
```

- [ ] **Step 2: Record the two deferred tools**

Append two numbered entries to `docs/open-followups.md` — read the file first and continue its numbering:

```markdown
### §NN — AI cannot read timelog entries
`Workspace` holds only `timelogLinks` (user→resource, project→bucket); real entries come over
the `/api/timelog` proxy, SSRF-guarded and authenticated with the device-sealed `timelogApiToken`.
A read tool means the model triggers a live authenticated external call — a different risk class
and a different failure mode (upstream timeout, already hit once). `VIEW_AI_SCOPE.timelog.reading`
tells the model it cannot read them, so it says so rather than estimating. `ASK_CLAUDE_PROMPTS`
deliberately has no `timelog` entry — chips there would be dead prompts.

### §NN+1 — AI cannot read the activity log
`activity-log-context.tsx` exposes a WRITER only (`LogActivityFn`); the log is not in `Workspace`.
Reading it needs wiring through `task-manager.tsx`, which is baselined at 2972 lines and may not
grow. Same handling as §NN: the scope entry says it cannot be read, and there are no chips.
```

- [ ] **Step 3: Verify the symbol gate**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
```

Expected: `EXIT=0`. Every backticked symbol you just wrote must exist in `src`.

- [ ] **Step 4: Commit**

```bash
git add docs/AGENTS/ai-assistant.md docs/open-followups.md
git commit -m "docs: record view-scoped AI prompts and the two deferred read tools"
```

### Task 6.3: Release

- [ ] **Step 1: Bump the version in all six places**

Only `version.ts` and `CHANGELOG.md` are conventionally remembered; **five more carry the version and no gate checks any of them**:

1. `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, milestone codename
2. `CHANGELOG.md` — new entry
3. `package.json` — `version`
4. `package-lock.json` — **two** occurrences (root `version` and `packages[""]`)
5. `README.md` — shields badge (version **and** codename)
6. `docs/CODEMAPS/*.md` — the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five

Pick a codename not already used — grep `CHANGELOG.md` first; codenames are unique.

- [ ] **Step 2: Register the highlight key**

If the release adds a `versionHighlight*` key, append it to `APP_HIGHLIGHT_KEYS` and add the EN/DE strings.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
grep -rn "0\.216\.0" package.json package-lock.json README.md docs/CODEMAPS/ src/app/version.ts | head
```

Expected: `EXIT=0` and hits in every file listed.

```bash
git add -A
git commit -m "release: 0.216.0 \"<codename>\""
```

- [ ] **Step 4: Stop**

Do **not** push, open an MR, or merge. Those happen only on an explicit instruction, and a merge happens only after the pipeline is green — never with auto-merge.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: the module split → Phase 0 (target corrected); registry + block builder + prompt wiring → Phase 2; digest → Phase 3; the three read tools → Phase 1; chips + i18n → Phase 4; disclosure → Phase 5; testing and gates → Phase 6. The four spec-named tests all appear: cache-boundary (Task 2.3), no-dead-hints (Task 2.1), chip↔capability (Task 4.1), digest determinism (Task 3.1). The deliberately-absent totality test is documented as absent in both the registry comment and Task 2.1.

**Type consistency.** `ViewScope` (`purpose` / `toolHints` / `reading`) is used identically in Tasks 2.1, 2.2 and 5.1. `viewDigest?: string` is declared in Task 2.3, produced in Task 3.2, consumed in Task 2.3. `digestForView(view, input)` is defined in Task 3.1 and called in Task 3.2. `computeSettingsPatch(patch, cur) → { changes, applied }` is defined in Task 0.1 Step 3 and called in Step 5 with matching destructuring.

**Deliberate gaps, flagged rather than guessed.** Three places tell the implementer to grep before writing, because the exact shapes were not read during planning: the import paths in Task 0.1 Step 3, the entity field names in Task 1.1 Step 3, and `navLabelKey`'s behavior for `learning-insights` in Task 5.1 Step 3. Each names the grep. These are verification instructions, not placeholders — the surrounding code is complete.

**One risk the plan cannot remove.** `chat-panel.test.tsx` may pin system-prompt text that Task 2.3 changes. Step 5 of that task says to update the assertion to match rather than drop the block.
