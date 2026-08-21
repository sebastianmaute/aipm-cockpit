# Tech Debt Phase 3 — Decomposition + Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `task-manager.tsx` (2,840 lines) into five bounded modules, split `workspace-section.tsx` and `raid-panel.tsx`, and consolidate the top duplication families — behind the Phase 2 characterization net.

**Architecture:** Every extraction is MOVE-ONLY (no logic edits in the same MR). Extracted hooks follow the proven `use-storage-file-ops.ts` pattern: a `use*`-named factory called unconditionally before the single return, taking a typed `deps` object of live render-scope values, returning NON-memoized handlers. Pane-boundary prop contracts (`workspace-section-types.ts`) are frozen except the one deliberate calendar-bag consolidation (its own task, additively migrated).

**Tech Stack:** React 19 hooks under the repo's react-hooks purity/exhaustive-deps rules; vitest characterization suites as the tripwire.

**Entry gate (HARD):** Phase 2 exit checklist complete; both characterization suites green on main.

**Sequencing constraint:** Tasks 1–5 (task-manager extractions) are SERIAL — same file, no parallel agents. Tasks 6–11 parallelize by file-disjointness after Task 5.

**Ground rules (from AGENTS.md — the landmines this phase exists to survive):**
- Extracted factories MUST NOT be memoized (they read live render-scope state every call).
- Factories are named `use*` and called UNCONDITIONALLY (purity rule rejects passing refs into plain fns during render).
- `react-hooks/exhaustive-deps` rejects `obj.member` deps — hoist to scalar locals.
- No `Date.now()`/`new Date()`/`Math.random()` in render bodies.
- Every entity save handler stays a FUNCTIONAL setter (`setX(prev => …)`).
- Golden fixtures byte-frozen; `workspace-section-types.ts` frozen except Task 8.

---

### Task 1: Extract `use-calendar-integrations.ts` (biggest win, ~500+ lines out)

**Files:**
- Create: `src/app/use-calendar-integrations.ts`
- Modify: `src/app/task-manager.tsx`
- Test: move/adapt the relevant assertions in `src/app/task-manager.characterization.test.tsx` only if names change (they should not)

- [ ] **Step 1: Green baseline**

```bash
npx vitest run src/app/task-manager.characterization.test.tsx src/app/use-entity-calendar-pull.test.tsx src/app/use-calendar-auto-pull.test.tsx
```
Expected: PASS. Record run time (regression tripwire).

- [ ] **Step 2: Map the move set**

In `task-manager.tsx`, locate and list line ranges for: the 4× `useEntityCalendarPush` instances (task/raid/change/absence), 4× `useEntityCalendarPull` + `use-milestone-calendar-pull`, `useCalendarAutoSync` instances, the `use-calendar-auto-pull` runner mount, the `set*ForCalendar` functional bridges, `pushableAbsences`/`*AutoSyncKey` derivations, and the `onToggleCalendar*` handlers.
Run: `grep -n "Calendar\|calendar" src/app/task-manager.tsx | head -80` to build the map. Everything on the map moves; nothing else does.

- [ ] **Step 3: Create the hook shell**

```ts
// use-calendar-integrations.ts — all Outlook push/pull/auto-sync wiring for
// task/raid/change/absence + milestone pull. Follows the use-storage-file-ops
// deps-object pattern: called unconditionally; returned handlers are NOT
// memoized (they read live render-scope state each call).
import type { /* entity + settings types — copy exact imports from the moved code */ } from "./types";

export interface CalendarIntegrationDeps {
  // the live closure values the moved code reads: tasks/raid/changes/absences +
  // their setters, settings, isPopout, logActivity, projectId, m365Configured.
  // Derive the exact field list from Step 2's map — every identifier the moved
  // block references that is declared OUTSIDE the block becomes a deps field.
}

export function useCalendarIntegrations(deps: CalendarIntegrationDeps) {
  // moved code goes here verbatim (Step 4)
  return {
    // one bag per entity, pre-shaped for the pane boundary:
    // { taskCalendar, raidCalendar, changeCalendar, absenceCalendar, milestonePull, summaryModalsState }
  };
}
```

- [ ] **Step 4: Move the code verbatim**

Cut the Step 2 line ranges from `task-manager.tsx` into the hook body. Replace out-of-scope identifier reads with `deps.<field>` ONLY where the identifier is a deps field; hoist any `deps.obj.member` used in a dep array to a scalar local first (exhaustive-deps rule).

- [ ] **Step 5: Wire the call site**

In `task-manager.tsx`, before the single return, unconditionally:

```ts
const calendar = useCalendarIntegrations({ /* deps */ });
```
Thread `calendar.raidCalendar.enabled` etc. into the exact same props as before — child-visible names unchanged (characterization suite enforces this).

- [ ] **Step 6: Verify — the tripwire run**

```bash
npm run lint && npx tsc --noEmit && npm run test:run
```
Expected: ALL green, characterization suite untouched-and-passing. Any characterization failure = the extraction changed observable behavior → fix the extraction, never the test (this is the one context where the test is right by definition).

- [ ] **Step 7: Size check + commit**

```bash
node scripts/check-file-sizes.mjs --update && node scripts/check-file-sizes.mjs
git add -A src scripts docs/baselines
git commit -m "refactor: extract use-calendar-integrations from task-manager (move-only)"
```
(`--update` shrinks the recorded task-manager baseline — ratchet tightens as we go.)

---

### Task 2: Extract `use-action-center-handlers.ts`

**Files:**
- Create: `src/app/use-action-center-handlers.ts`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Map the move set**

Handler cluster: assign-owner, mark-done (`applyStatusChange` route), clear-blocker, reschedule, escalate, rebaseline — the functional-`setTasks`/`setRaid` handlers guarded on `cta.view`. Run: `grep -n "handleAssign\|handleMarkDone\|handleClearBlocker\|handleReschedule\|handleEscalate\|handleRebaseline" src/app/task-manager.tsx` (adjust names to actual grep hits).

- [ ] **Step 2: Create hook with the existing `ActionHandlers` contract**

```ts
import type { ActionHandlers } from "./action-cta-controls";

export interface ActionCenterHandlerDeps { /* setters + snapshots per Step 1 map */ }

export function useActionCenterHandlers(deps: ActionCenterHandlerDeps): ActionHandlers {
  // moved handlers verbatim; every setter call stays setX(prev => …)
}
```
Return type is the EXISTING exported `ActionHandlers` type — if the moved cluster doesn't match it exactly, the type mismatch is a finding: reconcile by widening the local shape, not by editing `action-cta-controls.tsx` in this MR.

- [ ] **Step 3: Wire, verify, commit**

```bash
npm run lint && npx tsc --noEmit && npm run test:run
git add -A src && git commit -m "refactor: extract use-action-center-handlers from task-manager (move-only)"
```

---

### Task 3: Extract `use-ai-orchestration.ts`

**Files:**
- Create: `src/app/use-ai-orchestration.ts`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Map the move set**

`use-action-analysis` mount, `use-scheduled-job-runner` mount, weight-suggestion wiring, `use-chat-dispatcher` assembly, the `isPopout ? undefined : bundle` gates. Grep: `grep -n "useActionAnalysis\|useScheduledJobRunner\|useChatDispatcher\|useWeightSuggestions" src/app/task-manager.tsx`.

- [ ] **Step 2: Create + move**

```ts
export interface AiOrchestrationDeps { /* workspace refs+setters, settings, isPopout, logActivity */ }

export function useAiOrchestration(deps: AiOrchestrationDeps) {
  // moved verbatim. PRESERVE the popout contract exactly:
  // every returned bundle is `deps.isPopout ? undefined : …` where it was before.
  return { aiBundle, actionAnalysis, dispatcher };
}
```
CRITICAL preserved invariant: these hooks live ABOVE the view so results survive view remounts — the extraction keeps them mounted in task-manager (via this hook), NOT moved into any view component.

- [ ] **Step 3: Wire, verify, commit**

```bash
npm run lint && npx tsc --noEmit && npm run test:run
git add -A src && git commit -m "refactor: extract use-ai-orchestration from task-manager (move-only)"
```

---

### Task 4: Extract `use-shell-chrome.ts` (dual-header assembly)

**Files:**
- Create: `src/app/use-shell-chrome.tsx` (returns elements → `.tsx`)
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Map the move set**

`appHeaderEl` construction (classic `AppHeader`), modern `topBarMenus` slot assembly, `displayTzSwitcherEl` + its `settings.showDisplayTzSwitcher` gate, `GlobalSearchConnected` mounts. Grep: `grep -n "appHeaderEl\|topBarMenus\|displayTzSwitcher" src/app/task-manager.tsx`.

- [ ] **Step 2: Create + move**

```tsx
// use-shell-chrome.tsx — builds BOTH header mounts from one input set, making
// the "wire BOTH headers or the control is invisible in one layout" landmine
// structural: a control added here appears in classic AND modern automatically.
export function useShellChrome(deps: ShellChromeDeps): {
  appHeaderEl: ReactNode;
  topBarMenus: ReactNode;
} { /* moved verbatim */ }
```
File naming landmine check first: `ls src/app/use-shell-chrome.*` must be empty (a bare `.ts` sibling would shadow `.tsx` — documented resolution-order trap).

- [ ] **Step 3: Wire, verify (BOTH layouts), commit**

```bash
npm run lint && npx tsc --noEmit && npm run test:run
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"
```
The a11y single-view run (~16s) verifies the top bar (scanned in every view) still carries its labeled controls in the modern layout.

```bash
git add -A src && git commit -m "refactor: extract use-shell-chrome — single assembly for both header mounts"
```

---

### Task 5: Extract `calendar-summary-modals.tsx` + final task-manager slim

**Files:**
- Create: `src/app/calendar-summary-modals.tsx`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Move the 4 pull-summary modal mounts**

Props-only component: takes the 4 modal-state slices + resolve callbacks from `useCalendarIntegrations`'s return (Task 1 already grouped them as `summaryModalsState`). Renders in the shared non-popout `modalsBlock` position — preserve the "shows in BOTH classic + modern" mount point exactly.

- [ ] **Step 2: Measure the end state**

```bash
wc -l src/app/task-manager.tsx
```
Target ≤ 800 (stretch 600). If still > 800: the remainder is view-routing glue — acceptable only if a further extraction would create a pass-through module with no cohesion (YAGNI); document the residual in the debt register instead of force-splitting.

- [ ] **Step 3: Verify + replace characterization pins**

```bash
npm run test:run && npx tsc --noEmit
```
Now write focused unit tests for each extracted hook (one test file per hook: deps in → expected bag shape/handler behavior out, mirroring `use-storage-file-ops` tests if they exist) and DELETE the now-redundant assertions from the characterization suite (keep the suite file with the routing-level pins that still add value).

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "refactor: extract calendar summary modals; replace characterization pins with focused hook tests"
```

---

### Task 6: Split `workspace-section.tsx` (1,009 lines)

**Files:**
- Create: `src/app/workspace-section-chrome.tsx`
- Modify: `src/app/workspace-section.tsx`

- [ ] **Step 1: Split routing from chrome**

`workspace-section.tsx` keeps: the tabpanel switch (view router). Moves out to `workspace-section-chrome.tsx`: the ActionChips strip mount, ViewCallout mount (with its `activeTab !== "open-points"` double-render guard — move the guard WITH it), TzClockStrip calendar-only mount, provider wrappers that are chrome-scoped.
Constraint: `WorkspaceSectionProps` re-export and the `workspace-panels.tsx` import surface unchanged.

- [ ] **Step 2: Verify — routing characterization suite is the tripwire**

```bash
npx vitest run src/app/workspace-section.characterization.test.tsx && npm run test:run && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add -A src && git commit -m "refactor: split workspace-section chrome from view routing (move-only)"
```

---

### Task 7: Split `raid-panel.tsx` (905 lines) — gantt/reports pattern

**Files:**
- Create: `src/app/raid-panel-rows.tsx`, `src/app/raid-panel-toolbar.tsx`
- Modify: `src/app/raid-panel.tsx`

- [ ] **Step 1: Apply the in-repo template**

Mirror the documented gantt split (`gantt.tsx` orchestrator / `gantt-rows.tsx` / `gantt-chrome.tsx`): rows + toolbar become PURE presentational components taking data/handlers as props; `raid-panel.tsx` keeps state + derivation. RAID is axe-scanned: row-unique aria-labels move verbatim.

- [ ] **Step 2: Verify incl. targeted axe run**

```bash
npm run test:run && npx tsc --noEmit
npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"
```

- [ ] **Step 3: Commit**

```bash
git add -A src && git commit -m "refactor: split raid-panel into orchestrator/rows/toolbar (gantt pattern)"
```

---

### Task 8: Calendar prop-bag consolidation (the ONE pane-contract change)

**Files:**
- Modify: `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx`, `src/app/task-manager.tsx`, the four panes (`raid-panel.tsx`, `change-panel.tsx`, `resources-panel.tsx`, milestones pull button site), their tests

- [ ] **Step 1: Introduce the bag type ADDITIVELY**

```ts
// workspace-section-types.ts
export interface EntityCalendarProps {
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
  onPush?: () => void;
  onPull?: () => void;
  pushBusy?: boolean;
  pullBusy?: boolean;
}
```
Add `raidCalendar?: EntityCalendarProps` (etc.) BESIDE the existing five flat props per entity; mark flat ones `/** @deprecated migrate to <entity>Calendar bag */`.

- [ ] **Step 2: Migrate mechanically, one entity per commit**

Per entity: thread the bag task-manager → workspace-section → pane; pane destructures the bag into its existing internals; delete the flat props for that entity in the SAME commit (types force-find all ~30 test render sites — fix each by wrapping its existing values into the bag literal, no value changes).

```bash
npx tsc --noEmit    # the migration driver — zero errors = all sites found
npm run test:run
git commit -m "refactor: consolidate <entity> calendar props into EntityCalendarProps bag"
```

- [ ] **Step 3: Final sweep**

```bash
grep -rn "calendarRaidEnabled\|calendarPushBusy" src | grep -v Calendar   # expect empty
```
Update characterization suite prop-name pins to the bag names (this is the sanctioned update case).

---

### Task 9: `EntityToolbar` dedup (toolbar family)

**Files:**
- Create: `src/app/entity-toolbar.tsx`
- Modify: `raid-panel-toolbar.tsx` (Task 7 output), `change-panel.tsx`, `stakeholder` panel, `milestones-panel.tsx` toolbar sites

- [ ] **Step 1: Extract the shared composition**

From the documented shared shape (flat wrapping row, `flex flex-wrap items-center gap-2`, search input `flex-1`, saved-views control, print, trailing add):

```tsx
export interface EntityToolbarProps {
  search: { value: string; onChange: (v: string) => void; placeholder: string; ariaLabel: string };
  savedViews?: ReactNode;   // each panel's *-views-control instance
  leading?: ReactNode;      // panel-specific filters
  trailing?: ReactNode;     // add button, print, calendar controls
}
export function EntityToolbar(p: EntityToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.leading}
      <input className={/* copy EXACT classes from the tasks toolbar — byte-match, no restyle */}
        aria-label={p.search.ariaLabel} /* … */ />
      {p.savedViews}
      {p.trailing}
    </div>
  );
}
```
Migrate one panel per commit; screenshot-free verification = each panel's existing tests + the axe views.

- [ ] **Step 2: Measure the dedup**

```bash
npm run dup:check
```
Record % vs `docs/baselines/jscpd-2026-07.json`.

- [ ] **Step 3: Commit per panel**

```bash
git commit -m "refactor: adopt shared EntityToolbar in <panel> (dedup)"
```

---

### Task 10: `makeEntityCrudHandlers` factory + persistence-registry test

**Files:**
- Create: `src/app/entity-crud-handlers.ts`, `src/app/entity-persistence-registry.test.ts`
- Modify: `src/app/task-manager.tsx` (the 6× handleSaveX/handleDeleteX cluster)

- [ ] **Step 1: Write the factory test FIRST (this one is new logic, not move-only)**

```ts
import { describe, expect, test, vi } from "vitest";
import { makeEntityCrudHandlers } from "./entity-crud-handlers";

describe("makeEntityCrudHandlers", () => {
  test("N saves in one tick all land (functional-setter invariant)", () => {
    let items: Array<{ id: number; name: string }> = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const setItems = vi.fn((fn: (prev: typeof items) => typeof items) => { items = fn(items); });
    const log = vi.fn();
    const h = makeEntityCrudHandlers(setItems, log, "raid");
    h.save({ id: 1, name: "a2" });
    h.save({ id: 2, name: "b2" });          // same tick — the documented landmine
    expect(items).toEqual([{ id: 1, name: "a2" }, { id: 2, name: "b2" }]);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to fail, implement minimal factory, run to pass**

```ts
export function makeEntityCrudHandlers<T extends { id: number }>(
  setItems: (fn: (prev: T[]) => T[]) => void,
  logActivity: (kind: string, id: number) => void,
  kind: string,
) {
  return {
    save(item: T) {
      setItems((prev) => prev.some((p) => p.id === item.id)
        ? prev.map((p) => (p.id === item.id ? item : p))
        : [...prev, item]);
      logActivity(`${kind}.updated`, item.id);
    },
    remove(id: number) {
      setItems((prev) => prev.filter((p) => p.id !== id));
      logActivity(`${kind}.deleted`, id);
    },
  };
}
```
Then adapt to the REAL handler shape found in task-manager (localModifiedAt stamps, sanitize calls, activity-kind strings) — the factory must reproduce each entity's existing behavior exactly; where entities diverge, take a per-entity config arg rather than forcing uniformity.

- [ ] **Step 3: Migrate the 6 entities one commit each; characterization suite green after each**

- [ ] **Step 4: Persistence-registry knowledge test**

```ts
// entity-persistence-registry.test.ts — turns "miss one of six write paths"
// from silent data-drop into a red test.
import { MILESTONES_CSV_COLUMNS /* … */ } from "./csv-codecs-core";
import { MILESTONES_MD_COLUMNS /* … */ } from "./markdown-codecs-core";

const REGISTRY = [
  { entity: "milestone", field: "outlookEventId", csv: MILESTONES_CSV_COLUMNS, md: MILESTONES_MD_COLUMNS },
  // …one row per entity × recently-added persisted field (task/raid/change/absence outlookEventId at minimum)
];

test.each(REGISTRY)("$entity.$field present in CSV and MD column registries", ({ field, csv, md }) => {
  expect(csv).toContain(field);
  expect(md).toContain(field);
});
```
Verify real export names first: `grep -n "_CSV_COLUMNS" src/app/csv-codecs-core.ts | head`.

- [ ] **Step 5: Commit**

```bash
git add -A src && git commit -m "refactor: entity CRUD handler factory + persistence-registry guard test"
```

---

### Task 11: Consolidate proxy `_helpers` (security-sensitive — pin first)

**Files:**
- Create: `src/app/api/_shared/proxy-helpers.ts`
- Modify: `src/app/api/jira/_helpers.ts`, `src/app/api/timelog/_helpers.ts`, `src/app/api/confluence/page/route.ts`

- [ ] **Step 1: Pin current behavior (BEFORE any change)**

Ensure per-route tests cover: allowed-host pass, disallowed-host 4xx, private-IP block, `..`/CRLF/`#` rejection, `:`/`@` host rejection, path-allowlist rejection, timeout, 429. Phase 1 Task 8 + existing tests should cover most; fill gaps NOW while behavior is unquestionably correct.

- [ ] **Step 2: Extract parameterized core**

```ts
export interface ProxyConfig {
  allowedHostSuffix: string;        // ".atlassian.net" | ".timelog.com"
  pathAllowlist: RegExp[];          // e.g. [/^\/v1\//]
  rateLimitScope: string;           // "jira" | "timelog" | "confluence"
  authHeader: (secrets: ProxySecrets) => string;  // Basic vs Bearer
  timeoutMs: number;
}
export function createProxyHelpers(cfg: ProxyConfig) { /* moved guard chain verbatim */ }
```
Each `_helpers.ts` becomes a thin `createProxyHelpers(cfg)` instantiation re-exporting its existing names (route files unchanged).

- [ ] **Step 3: Diff-prove identical behavior**

```bash
npx vitest run src/app/api && npx tsc --noEmit
```
ALL pinned tests green, zero test edits in this commit. Reviewer requirement per roadmap: security-lead reviews this MR.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api && git commit -m "refactor(security): parameterize shared proxy guard chain (behavior pinned by route tests)"
```

---

## Phase exit checklist
- [ ] `task-manager.tsx` ≤ 800 lines; no non-dictionary file > 1,000 (run `node scripts/check-file-sizes.mjs --update` + inspect).
- [ ] `npm run dup:check` ≤ 50% of the Phase 1 baseline percentage.
- [ ] Zero golden-fixture diffs (`git diff <phase-start>...HEAD --stat | grep __fixtures__` empty).
- [ ] Pane contract changed ONLY by Task 8's bag consolidation.
- [ ] Characterization pins replaced by focused hook tests.
- [ ] Full CI green incl. e2e + all 39 axe passes.
