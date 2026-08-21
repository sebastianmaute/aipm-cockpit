# Dashboard Landing Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Dashboard into a PM landing-page cockpit — a "since you last looked" delta strip + greeting at the top, with the engine-ranked top-actions queue promoted above the fold.

**Architecture:** A pure i18n-free engine (`dashboard-delta.ts`) computes a delta from the activity log (diffed by timestamp) and a per-project RAG snapshot; a per-browser localStorage store (`landing-state.ts`) holds the prior snapshot keyed by project id; a hook (`use-landing-delta.ts`) captures the delta at mount and debounce-advances the snapshot; a presentational component (`dashboard-delta-strip.tsx`) renders greeting + clickable delta chips. `dashboard-panel.tsx` reorders to put the strip + top-actions first and folds the RAG override selects into a `<details>` disclosure. Wiring is contained to `workspace-section.tsx` + `dashboard-panel.tsx`.

**Tech Stack:** TypeScript, React 19, vitest, fast-check, Tailwind (AIPM palette tokens), forked Next.js 16.

**Conventions to heed (from AGENTS.md):**
- `npm run lint` is `--max-warnings=0`: an unused import/var is FATAL. Re-check after every extract.
- `npx tsc --noEmit` enforces i18n EN/DE key parity AND typechecks tests (vitest does not). Run after editing ANY test.
- react-hooks PURITY: no `Date.now()`/`new Date()` in a render body — capture via lazy `useState(() => …)` or read inside an effect/callback. `react-hooks/set-state-in-effect` is BANNED.
- `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts + curls quotes — patch DE via a node utf8 write script, match `\r\n`, use real German umlauts.
- `t(lang, key, a, b)` interpolates 0-based positional placeholders `{0}`/`{1}`.
- `Lang` = `"en-US" | "en-GB" | "de"` (no `"en"`); component tests use `"en-US"`; DE dict is lazy — a DE assertion needs `loadI18n("de")` in `beforeAll`.
- Dashboard IS in the axe `A11Y_VIEWS` (`e2e/a11y.spec.ts:10`) — every new interactive control needs a row-unique accessible name; verify with `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` before push.
- fast-check: `fc.date()` can emit Invalid Date (`.toISOString()` throws) — map an integer ms range to `new Date(ms)`; the regex `/s` flag fails tsc (target < es2018) — use `[\s\S]`.

**Branch:** create `feat-dashboard-landing-cockpit` off `main` before Task 1. Do NOT commit `docs/refactor-review-2026-06-19.md` (pre-existing unrelated working-tree deletion — leave it out of every commit).

---

### Task 1: `dashboard-delta.ts` engine — types + `computeDelta` + `buildGreeting`

**Files:**
- Create: `src/app/dashboard-delta.ts`
- Test: `src/app/dashboard-delta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard-delta.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { computeDelta, buildGreeting } from "./dashboard-delta";
import type { ActivityEntry } from "./activity-log";
import type { Task } from "./types";

function entry(id: number, timestamp: string, kind: ActivityEntry["kind"]): ActivityEntry {
  return { id, timestamp, kind, args: [] };
}
function task(id: number, dueDate: string): Task {
  // Minimal Task — computeDelta only reads id + dueDate + completedDate.
  return { id, dueDate, completedDate: undefined } as unknown as Task;
}
const NO_RAG = { overall: null, schedule: null, budget: null, scope: null } as const;

describe("computeDelta", () => {
  test("first visit: no prior lastVisitAt → isFirstVisit, zero total", () => {
    const r = computeDelta({ prior: {}, activity: [entry(1, "2026-06-20T10:00:00.000Z", "task.created")], currentRag: NO_RAG, overdue: [], today: "2026-06-21" });
    expect(r.isFirstVisit).toBe(true);
    expect(r.total).toBe(0);
    expect(r.since).toBeUndefined();
  });

  test("counts activity strictly after lastVisitAt, grouped by entity+verb", () => {
    const r = computeDelta({
      prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" },
      activity: [
        entry(1, "2026-06-19T10:00:00.000Z", "task.created"), // before — ignored
        entry(2, "2026-06-20T10:00:00.000Z", "task.created"),
        entry(3, "2026-06-20T11:00:00.000Z", "task.updated"),
        entry(4, "2026-06-20T12:00:00.000Z", "task.reopened"),     // counts as updated
        entry(5, "2026-06-20T13:00:00.000Z", "raid.autoIssue"),    // counts as created
        entry(6, "2026-06-20T14:00:00.000Z", "task.deleted"),      // ignored
      ],
      currentRag: NO_RAG, overdue: [], today: "2026-06-21",
    });
    expect(r.counts.tasks).toEqual({ created: 1, updated: 2, completed: 0, statusChanged: 0 });
    expect(r.counts.raid.created).toBe(1);
    expect(r.since).toBe("2026-06-20T00:00:00.000Z");
  });

  test("raid.statusChanged maps to statusChanged", () => {
    const r = computeDelta({ prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" }, activity: [entry(1, "2026-06-20T10:00:00.000Z", "raid.statusChanged")], currentRag: NO_RAG, overdue: [], today: "2026-06-21" });
    expect(r.counts.raid.statusChanged).toBe(1);
  });

  test("newOverdue: overdue task whose dueDate >= last-visit date", () => {
    const r = computeDelta({
      prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" },
      activity: [], currentRag: NO_RAG,
      overdue: [task(1, "2026-06-19"), task(2, "2026-06-20"), task(3, "2026-06-21")],
      today: "2026-06-22",
    });
    expect(r.newOverdue.map((t) => t.id)).toEqual([2, 3]); // 2026-06-19 predates last visit
  });

  test("ragFlips: emitted only when prior != current; worsened flag by rank", () => {
    const r = computeDelta({
      prior: { lastVisitAt: "2026-06-20T00:00:00.000Z", rag: { schedule: "G", budget: "R" } },
      activity: [], currentRag: { overall: null, schedule: "A", budget: "R", scope: null },
      overdue: [], today: "2026-06-21",
    });
    expect(r.ragFlips).toEqual([{ scope: "schedule", from: "G", to: "A", worsened: true }]);
  });

  test("ragFlip from undefined prior treated as null→value", () => {
    const r = computeDelta({ prior: { lastVisitAt: "2026-06-20T00:00:00.000Z" }, activity: [], currentRag: { ...NO_RAG, overall: "R" }, overdue: [], today: "2026-06-21" });
    expect(r.ragFlips).toEqual([{ scope: "overall", from: null, to: "R", worsened: true }]);
  });

  test("total sums activity + newOverdue + flips; zero when nothing changed", () => {
    const quiet = computeDelta({ prior: { lastVisitAt: "2026-06-20T00:00:00.000Z", rag: { overall: "G" } }, activity: [], currentRag: { ...NO_RAG, overall: "G" }, overdue: [], today: "2026-06-21" });
    expect(quiet.total).toBe(0);
  });
});

describe("buildGreeting", () => {
  test("hour thresholds: <12 morning, <18 afternoon, else evening", () => {
    expect(buildGreeting(8, { needsYou: 0, milestonesSoon: 0 }).greetingKey).toBe("dashboardGreetingMorning");
    expect(buildGreeting(13, { needsYou: 0, milestonesSoon: 0 }).greetingKey).toBe("dashboardGreetingAfternoon");
    expect(buildGreeting(20, { needsYou: 0, milestonesSoon: 0 }).greetingKey).toBe("dashboardGreetingEvening");
  });
  test("passes summary counts through", () => {
    expect(buildGreeting(8, { needsYou: 3, milestonesSoon: 2 }).summary).toEqual({ needsYou: 3, milestonesSoon: 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/dashboard-delta.test.ts`
Expected: FAIL — `Failed to resolve import "./dashboard-delta"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard-delta.ts`:

```ts
// Pure, i18n-free engine behind the Dashboard landing "since you last looked"
// strip. No React, no I/O — diffs the activity log + a prior RAG snapshot
// against the current state. The single testable unit; dashboard-delta-strip.tsx
// only renders its result.

import type { ActivityEntry, ActivityKind } from "./activity-log";
import type { Health } from "./health";
import type { Task } from "./types";

export type RagScope = "overall" | "schedule" | "budget" | "scope";
export type DeltaGroup = "tasks" | "raid" | "milestone" | "change";
export type DeltaVerb = "created" | "updated" | "completed" | "statusChanged";

export type LandingState = {
  /** ISO timestamp of the prior visit; undefined ⇒ first visit. */
  lastVisitAt?: string;
  /** RAG snapshot captured at the prior visit. */
  rag?: Partial<Record<RagScope, Health>>;
};

export type DeltaCounts = Record<DeltaGroup, Record<DeltaVerb, number>>;

export type RagFlip = {
  scope: RagScope;
  from: Health | null;
  to: Health | null;
  worsened: boolean;
};

export type DeltaResult = {
  isFirstVisit: boolean;
  since?: string;
  counts: DeltaCounts;
  newOverdue: Task[];
  ragFlips: RagFlip[];
  total: number;
};

export type GreetingTimeKey =
  | "dashboardGreetingMorning"
  | "dashboardGreetingAfternoon"
  | "dashboardGreetingEvening";

const RAG_SCOPES: readonly RagScope[] = ["overall", "schedule", "budget", "scope"];
const HEALTH_RANK: Record<Health, number> = { R: 3, A: 2, G: 1 };
const rank = (h: Health | null): number => (h ? HEALTH_RANK[h] : 0);

function emptyCounts(): DeltaCounts {
  const z = (): Record<DeltaVerb, number> => ({ created: 0, updated: 0, completed: 0, statusChanged: 0 });
  return { tasks: z(), raid: z(), milestone: z(), change: z() };
}

/** Map an activity kind to a (group, verb) the strip cares about, or null to
 *  ignore (deletes, settings, jira.sync, docs, history, bulk, etc.). */
function classify(kind: ActivityKind): { group: DeltaGroup; verb: DeltaVerb } | null {
  const dot = kind.indexOf(".");
  const prefix = kind.slice(0, dot);
  const suffix = kind.slice(dot + 1);
  let group: DeltaGroup;
  if (prefix === "task") group = "tasks";
  else if (prefix === "raid") group = "raid";
  else if (prefix === "milestone") group = "milestone";
  else if (prefix === "change") group = "change";
  else return null;

  if (suffix === "created" || suffix === "autoIssue") return { group, verb: "created" };
  if (suffix === "updated" || suffix === "reopened") return { group, verb: "updated" };
  if (suffix === "completed") return { group, verb: "completed" };
  if (suffix === "statusChanged") return { group, verb: "statusChanged" };
  return null; // deleted, or any verb the strip doesn't surface
}

export function computeDelta(args: {
  prior: LandingState;
  activity: readonly ActivityEntry[];
  currentRag: Record<RagScope, Health | null>;
  overdue: readonly Task[];
  today: string;
}): DeltaResult {
  const { prior, activity, currentRag, overdue } = args;
  const since = prior.lastVisitAt;
  const isFirstVisit = since === undefined;

  const counts = emptyCounts();
  if (!isFirstVisit) {
    for (const e of activity) {
      if (e.timestamp <= since!) continue;
      const c = classify(e.kind);
      if (!c) continue;
      counts[c.group][c.verb] += 1;
    }
  }

  const sinceDate = since ? since.slice(0, 10) : "";
  const newOverdue = isFirstVisit
    ? []
    : overdue.filter((t) => t.dueDate >= sinceDate);

  const ragFlips: RagFlip[] = [];
  if (!isFirstVisit) {
    for (const scope of RAG_SCOPES) {
      const from = prior.rag?.[scope] ?? null;
      const to = currentRag[scope];
      if (from !== to) ragFlips.push({ scope, from, to, worsened: rank(to) > rank(from) });
    }
  }

  const activityTotal = (Object.keys(counts) as DeltaGroup[]).reduce(
    (sum, g) => sum + counts[g].created + counts[g].updated + counts[g].completed + counts[g].statusChanged,
    0,
  );
  const total = activityTotal + newOverdue.length + ragFlips.length;

  return { isFirstVisit, since, counts, newOverdue, ragFlips, total };
}

export function buildGreeting(
  hour: number,
  summary: { needsYou: number; milestonesSoon: number },
): { greetingKey: GreetingTimeKey; summary: { needsYou: number; milestonesSoon: number } } {
  const greetingKey: GreetingTimeKey =
    hour < 12 ? "dashboardGreetingMorning" : hour < 18 ? "dashboardGreetingAfternoon" : "dashboardGreetingEvening";
  return { greetingKey, summary };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/dashboard-delta.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `Task` minimal cast complains, the `as unknown as Task` in the test helper covers it.)

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-delta.ts src/app/dashboard-delta.test.ts
git commit -m "feat(dashboard): add pure delta engine for landing strip"
```

---

### Task 2: `dashboard-delta` property tests

**Files:**
- Create: `src/app/dashboard-delta.property.test.ts`

- [ ] **Step 1: Write the property test**

Create `src/app/dashboard-delta.property.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { computeDelta, type RagScope } from "./dashboard-delta";
import type { ActivityEntry, ActivityKind } from "./activity-log";
import type { Health } from "./health";

const KINDS: ActivityKind[] = ["task.created", "task.updated", "task.completed", "task.deleted", "raid.statusChanged", "milestone.created", "change.updated"];
const HEALTH: (Health | null)[] = ["R", "A", "G", null];

// Map an integer ms range to a Date to avoid fc.date() Invalid Date → toISOString throw.
const isoArb = fc.integer({ min: 0, max: 4_102_444_800_000 }).map((ms) => new Date(ms).toISOString());

const activityArb = fc.array(
  fc.record({
    id: fc.integer({ min: 1, max: 100000 }),
    timestamp: isoArb,
    kind: fc.constantFrom(...KINDS),
    args: fc.constant([] as (string | number)[]),
  }),
  { maxLength: 30 },
) as fc.Arbitrary<ActivityEntry[]>;

const ragArb = fc.record({
  overall: fc.constantFrom(...HEALTH),
  schedule: fc.constantFrom(...HEALTH),
  budget: fc.constantFrom(...HEALTH),
  scope: fc.constantFrom(...HEALTH),
}) as fc.Arbitrary<Record<RagScope, Health | null>>;

describe("computeDelta properties", () => {
  test("counts are never negative and total >= 0", () => {
    fc.assert(fc.property(activityArb, isoArb, ragArb, (activity, lastVisitAt, currentRag) => {
      const r = computeDelta({ prior: { lastVisitAt }, activity, currentRag, overdue: [], today: "2026-06-21" });
      for (const g of ["tasks", "raid", "milestone", "change"] as const) {
        for (const v of ["created", "updated", "completed", "statusChanged"] as const) {
          expect(r.counts[g][v]).toBeGreaterThanOrEqual(0);
        }
      }
      expect(r.total).toBeGreaterThanOrEqual(0);
    }));
  });

  test("total === 0 iff no activity-after-since, no newOverdue, no flips", () => {
    fc.assert(fc.property(activityArb, isoArb, ragArb, (activity, lastVisitAt, currentRag) => {
      const r = computeDelta({ prior: { lastVisitAt }, activity, currentRag, overdue: [], today: "2026-06-21" });
      const hasSignal = r.ragFlips.length > 0 || r.newOverdue.length > 0 ||
        (["tasks", "raid", "milestone", "change"] as const).some((g) =>
          (["created", "updated", "completed", "statusChanged"] as const).some((v) => r.counts[g][v] > 0));
      expect(r.total === 0).toBe(!hasSignal);
    }));
  });

  test("first visit (no lastVisitAt) is always empty", () => {
    fc.assert(fc.property(activityArb, ragArb, (activity, currentRag) => {
      const r = computeDelta({ prior: {}, activity, currentRag, overdue: [], today: "2026-06-21" });
      expect(r.isFirstVisit).toBe(true);
      expect(r.total).toBe(0);
    }));
  });

  test("a flip is emitted exactly when from != to", () => {
    fc.assert(fc.property(isoArb, ragArb, ragArb, (lastVisitAt, priorRag, currentRag) => {
      const r = computeDelta({ prior: { lastVisitAt, rag: stripNull(priorRag) }, activity: [], currentRag, overdue: [], today: "2026-06-21" });
      const flipped = new Set(r.ragFlips.map((f) => f.scope));
      for (const scope of ["overall", "schedule", "budget", "scope"] as const) {
        const from = priorRag[scope]; const to = currentRag[scope];
        expect(flipped.has(scope)).toBe(from !== to);
      }
    }));
  });
});

function stripNull(rag: Record<RagScope, Health | null>): Partial<Record<RagScope, Health>> {
  const out: Partial<Record<RagScope, Health>> = {};
  for (const k of ["overall", "schedule", "budget", "scope"] as const) {
    const v = rag[k];
    if (v) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 2: Run the property test**

Run: `npm run test:run -- src/app/dashboard-delta.property.test.ts`
Expected: PASS. (Note: `prior.rag` stores only non-null healths — `stripNull` mirrors that, so the flip property holds because `from = priorRag[scope] ?? null` recovers the original null.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard-delta.property.test.ts
git commit -m "test(dashboard): property tests for delta engine"
```

---

### Task 3: `landing-state.ts` per-browser store

**Files:**
- Create: `src/app/landing-state.ts`
- Test: `src/app/landing-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/landing-state.test.ts`:

```ts
import { afterEach, describe, expect, test } from "vitest";
import { loadLandingState, saveLandingState, clearLandingState, LANDING_STATE_MAX_PROJECTS } from "./landing-state";

afterEach(() => clearLandingState());

describe("landing-state", () => {
  test("round-trips a project's state", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T10:00:00.000Z", rag: { overall: "A" } });
    expect(loadLandingState("p1")).toEqual({ lastVisitAt: "2026-06-20T10:00:00.000Z", rag: { overall: "A" } });
  });

  test("absent project → empty object", () => {
    expect(loadLandingState("nope")).toEqual({});
  });

  test("projects are isolated", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z" });
    saveLandingState("p2", { lastVisitAt: "2026-06-21T00:00:00.000Z" });
    expect(loadLandingState("p1").lastVisitAt).toBe("2026-06-20T00:00:00.000Z");
    expect(loadLandingState("p2").lastVisitAt).toBe("2026-06-21T00:00:00.000Z");
  });

  test("caps the map, dropping the oldest by lastVisitAt", () => {
    for (let i = 0; i < LANDING_STATE_MAX_PROJECTS + 5; i++) {
      const n = String(i).padStart(2, "0");
      saveLandingState(`p${n}`, { lastVisitAt: `2026-06-${n}T00:00:00.000Z` });
    }
    // The 5 oldest (p00..p04) should have been evicted.
    expect(loadLandingState("p00")).toEqual({});
    expect(loadLandingState(`p${String(LANDING_STATE_MAX_PROJECTS + 4).padStart(2, "0")}`).lastVisitAt).toBeDefined();
  });

  test("corrupt JSON → empty object, no throw", () => {
    window.localStorage.setItem("lop-app:landing-state", "{not json");
    expect(loadLandingState("p1")).toEqual({});
  });

  test("non-object stored value → empty object", () => {
    window.localStorage.setItem("lop-app:landing-state", JSON.stringify([1, 2, 3]));
    expect(loadLandingState("p1")).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/landing-state.test.ts`
Expected: FAIL — `Failed to resolve import "./landing-state"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/landing-state.ts`:

```ts
// Per-browser, per-project landing-page state (last-visit timestamp + RAG
// snapshot) backing the Dashboard "since you last looked" strip. Mirrors
// activity-log.ts: a single localStorage key, defensive parse, SSR guard,
// bounded size. NOT a Workspace field — never exported, never in Turso, cleared
// by app-reset's `lop-app:*` sweep.

import type { LandingState } from "./dashboard-delta";

const LANDING_STATE_KEY = "lop-app:landing-state";
export const LANDING_STATE_MAX_PROJECTS = 50;

type StateMap = Record<string, LandingState>;

function isLandingState(v: unknown): v is LandingState {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as LandingState;
  if (s.lastVisitAt !== undefined && typeof s.lastVisitAt !== "string") return false;
  if (s.rag !== undefined && (typeof s.rag !== "object" || s.rag === null)) return false;
  return true;
}

function readMap(): StateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LANDING_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: StateMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isLandingState(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadLandingState(projectId: string): LandingState {
  return readMap()[projectId] ?? {};
}

export function saveLandingState(projectId: string, state: LandingState): void {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    map[projectId] = state;
    const entries = Object.entries(map);
    if (entries.length > LANDING_STATE_MAX_PROJECTS) {
      // Keep the most-recent by lastVisitAt; undefined sorts oldest.
      entries.sort((a, b) => (b[1].lastVisitAt ?? "").localeCompare(a[1].lastVisitAt ?? ""));
      const kept: StateMap = {};
      for (const [k, v] of entries.slice(0, LANDING_STATE_MAX_PROJECTS)) kept[k] = v;
      window.localStorage.setItem(LANDING_STATE_KEY, JSON.stringify(kept));
      return;
    }
    window.localStorage.setItem(LANDING_STATE_KEY, JSON.stringify(map));
  } catch {
    // quota / disabled — non-fatal; strip just won't advance.
  }
}

export function clearLandingState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LANDING_STATE_KEY);
  } catch {
    // non-fatal
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/landing-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/landing-state.ts src/app/landing-state.test.ts
git commit -m "feat(dashboard): per-project landing-state store"
```

---

### Task 4: `use-landing-delta.ts` hook

**Files:**
- Create: `src/app/use-landing-delta.ts`
- Test: `src/app/use-landing-delta.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-landing-delta.test.tsx`:

```tsx
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useLandingDelta } from "./use-landing-delta";
import { clearLandingState, loadLandingState, saveLandingState } from "./landing-state";
import type { RagScope } from "./dashboard-delta";
import type { Health } from "./health";

afterEach(() => { clearLandingState(); vi.useRealTimers(); });

const RAG: Record<RagScope, Health | null> = { overall: "A", schedule: "G", budget: null, scope: null };

function Harness({ projectId, isPopout }: { projectId: string; isPopout: boolean }) {
  const delta = useLandingDelta({ projectId, currentRag: RAG, overdue: [], today: "2026-06-21", isPopout });
  return <div data-testid="first">{String(delta.isFirstVisit)}</div>;
}

describe("useLandingDelta", () => {
  test("captures delta from the prior snapshot at mount", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z", rag: { overall: "G" } });
    const { getByTestId } = render(<Harness projectId="p1" isPopout={false} />);
    expect(getByTestId("first").textContent).toBe("false"); // not first visit
  });

  test("advances the snapshot after the debounce (non-popout)", () => {
    vi.useFakeTimers();
    render(<Harness projectId="p1" isPopout={false} />);
    expect(loadLandingState("p1").lastVisitAt).toBeUndefined(); // not yet
    act(() => { vi.advanceTimersByTime(4000); });
    const saved = loadLandingState("p1");
    expect(saved.lastVisitAt).toBeDefined();
    expect(saved.rag).toEqual({ overall: "A", schedule: "G" }); // nulls stripped
  });

  test("popout never advances the snapshot", () => {
    vi.useFakeTimers();
    render(<Harness projectId="p1" isPopout={true} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(loadLandingState("p1")).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/use-landing-delta.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-landing-delta"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/use-landing-delta.ts`:

```ts
import { useEffect, useState } from "react";
import { computeDelta, type DeltaResult, type LandingState, type RagScope } from "./dashboard-delta";
import { loadLandingState, saveLandingState } from "./landing-state";
import { loadActivityLog } from "./activity-log";
import type { Health } from "./health";
import type { Task } from "./types";

/** Delay before the visit advances the stored snapshot, so the strip stays
 *  readable on the current visit and the next visit diffs from "now". */
const ADVANCE_DELAY_MS = 4000;

function snapshotRag(rag: Record<RagScope, Health | null>): LandingState["rag"] {
  const out: NonNullable<LandingState["rag"]> = {};
  (Object.keys(rag) as RagScope[]).forEach((k) => {
    const v = rag[k];
    if (v) out[k] = v;
  });
  return out;
}

export function useLandingDelta(args: {
  projectId: string;
  currentRag: Record<RagScope, Health | null>;
  overdue: readonly Task[];
  today: string;
  isPopout: boolean;
}): DeltaResult {
  const { projectId, currentRag, overdue, today, isPopout } = args;

  // Capture the delta ONCE at mount from the PRIOR snapshot — before advancing.
  // Lazy initializer keeps loadLandingState/loadActivityLog out of the render body
  // and avoids set-state-in-effect.
  const [delta] = useState<DeltaResult>(() =>
    computeDelta({ prior: loadLandingState(projectId), activity: loadActivityLog(), currentRag, overdue, today }),
  );

  // Debounced advance — side-effect-only write to localStorage (no setState).
  // `new Date()` lives in the timeout callback, never the render body. Popouts
  // are read-only and must not mutate device state.
  useEffect(() => {
    if (isPopout) return;
    const id = window.setTimeout(() => {
      saveLandingState(projectId, { lastVisitAt: new Date().toISOString(), rag: snapshotRag(currentRag) });
    }, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(id);
    // Intentionally mount-only: the delta + advance reflect the visit at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return delta;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/use-landing-delta.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck (the eslint-disable line and hook rules matter here)**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors, no warnings. (If `react-hooks/exhaustive-deps` still fires, confirm the disable comment is on the line immediately before the `}, []);` dependency array.)

- [ ] **Step 6: Commit**

```bash
git add src/app/use-landing-delta.ts src/app/use-landing-delta.test.tsx
git commit -m "feat(dashboard): landing-delta hook (mount-capture + debounced advance)"
```

---

### Task 5: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (insert after `versionHighlightJiraEncryption`, ~line 557)
- Modify: `src/app/i18n.de.ts` (via node utf8 write script)
- Create (temporary): `scripts/_patch-de-landing.mjs` (delete after use)

- [ ] **Step 1: Add the EN keys to `src/app/i18n.ts`**

Insert these entries immediately after the `versionHighlightJiraEncryption: "…",` line:

```ts
  versionHighlightLandingCockpit:
    "The Dashboard is now a landing cockpit: a greeting plus a \"since you last looked\" strip surfaces what changed (new items, status flips), and the ranked next-actions queue sits up top so you see what needs you first.",
  dashboardGreetingMorning: "Good morning",
  dashboardGreetingAfternoon: "Good afternoon",
  dashboardGreetingEvening: "Good evening",
  dashboardGreetingSummary: "{0} items need you · {1} milestones soon",
  dashboardDeltaSinceTitle: "Since you last looked",
  dashboardDeltaWelcome: "Welcome — here's your project at a glance.",
  dashboardDeltaAllCaught: "All caught up since {0}",
  dashboardDeltaTasksUpdated: "{0} tasks updated",
  dashboardDeltaTasksCreated: "{0} tasks added",
  dashboardDeltaTasksCompleted: "{0} tasks completed",
  dashboardDeltaRaidChanged: "{0} RAID updates",
  dashboardDeltaMilestoneChanged: "{0} milestone updates",
  dashboardDeltaChangeChanged: "{0} change updates",
  dashboardDeltaNewOverdue: "{0} newly overdue",
  dashboardDeltaFlip: "{0}: {1}→{2}",
  dashboardAdjustHealth: "Adjust health ratings",
```

> Note: the strip aggregates per-group verbs into a small number of chips — created/updated/completed for tasks (three chips when non-zero), and a single "updates" chip per other group summing its verbs. The component (Task 6) decides which chips to show; these are all the strings it can use.

- [ ] **Step 2: Typecheck to surface the DE parity gap**

Run: `npx tsc --noEmit`
Expected: FAIL — i18n parity error: the new keys are missing from `i18n.de.ts` (the `de` dictionary type must match `en`).

- [ ] **Step 3: Write the DE keys via a node utf8 script**

Create `scripts/_patch-de-landing.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/i18n.de.ts";
let s = readFileSync(path, "utf8");

// Anchor on the DE versionHighlightJiraEncryption entry's closing line. The file
// is CRLF — match \r\n. Find the line and insert after it.
const anchor = /(versionHighlightJiraEncryption:\s*\r?\n\s*"[^"]*",\r?\n)/;
if (!anchor.test(s)) { console.error("anchor not found"); process.exit(1); }

const block =
  '  versionHighlightLandingCockpit:\r\n' +
  '    "Das Dashboard ist jetzt ein Landing-Cockpit: eine Begrüßung und eine „Seit deinem letzten Besuch“-Leiste zeigen, was sich geändert hat (neue Einträge, Statuswechsel), und die priorisierte Nächste-Schritte-Liste steht oben, damit du zuerst siehst, was dich braucht.",\r\n' +
  '  dashboardGreetingMorning: "Guten Morgen",\r\n' +
  '  dashboardGreetingAfternoon: "Guten Tag",\r\n' +
  '  dashboardGreetingEvening: "Guten Abend",\r\n' +
  '  dashboardGreetingSummary: "{0} Einträge brauchen dich · {1} Meilensteine bald",\r\n' +
  '  dashboardDeltaSinceTitle: "Seit deinem letzten Besuch",\r\n' +
  '  dashboardDeltaWelcome: "Willkommen – hier ist dein Projekt auf einen Blick.",\r\n' +
  '  dashboardDeltaAllCaught: "Alles aktuell seit {0}",\r\n' +
  '  dashboardDeltaTasksUpdated: "{0} Aufgaben aktualisiert",\r\n' +
  '  dashboardDeltaTasksCreated: "{0} Aufgaben hinzugefügt",\r\n' +
  '  dashboardDeltaTasksCompleted: "{0} Aufgaben abgeschlossen",\r\n' +
  '  dashboardDeltaRaidChanged: "{0} RAID-Aktualisierungen",\r\n' +
  '  dashboardDeltaMilestoneChanged: "{0} Meilenstein-Aktualisierungen",\r\n' +
  '  dashboardDeltaChangeChanged: "{0} Änderungs-Aktualisierungen",\r\n' +
  '  dashboardDeltaNewOverdue: "{0} neu überfällig",\r\n' +
  '  dashboardDeltaFlip: "{0}: {1}→{2}",\r\n' +
  '  dashboardAdjustHealth: "Statusbewertungen anpassen",\r\n';

s = s.replace(anchor, (m) => m + block);
writeFileSync(path, s, "utf8");
console.log("DE landing keys inserted");
```

Run: `node scripts/_patch-de-landing.mjs`
Expected: `DE landing keys inserted`.

- [ ] **Step 4: Verify DE umlauts + parity**

Run: `npx tsc --noEmit && npm run test:run -- src/app/i18n-encoding`
Expected: tsc clean (parity satisfied); the `i18n-encoding` test passes (no ASCII umlaut substitutions — the script wrote real umlauts via `\u` escapes).

- [ ] **Step 5: Delete the temporary script**

```bash
rm scripts/_patch-de-landing.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(dashboard): landing cockpit strings (EN + DE)"
```

---

### Task 6: `dashboard-delta-strip.tsx` presentational component

**Files:**
- Create: `src/app/dashboard-delta-strip.tsx`
- Test: `src/app/dashboard-delta-strip.test.tsx`

**Context:** `RagBadge` is imported from `./rag-badge` (`<RagBadge value={Health|null} lang={lang} />`). `t(lang, key, ...args)` from `./i18n`. The component is pure render — it takes the `DeltaResult`, a greeting result, and click handlers. AIPM palette tokens only (`border-line`, `bg-surface`, `text-muted-foreground`, `text-AIPM-dark-blue`, `hover:bg-surface-muted`) — no off-palette colors/shadows.

- [ ] **Step 1: Write the failing test**

Create `src/app/dashboard-delta-strip.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
import type { DeltaResult } from "./dashboard-delta";

function emptyCounts() {
  const z = () => ({ created: 0, updated: 0, completed: 0, statusChanged: 0 });
  return { tasks: z(), raid: z(), milestone: z(), change: z() };
}
function delta(over: Partial<DeltaResult> = {}): DeltaResult {
  return { isFirstVisit: false, since: "2026-06-20T00:00:00.000Z", counts: emptyCounts(), newOverdue: [], ragFlips: [], total: 0, ...over };
}

describe("DashboardDeltaStrip", () => {
  test("first visit → welcome copy, no chips", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ isFirstVisit: true, total: 0 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    expect(screen.getByText(/Welcome/i)).toBeInTheDocument();
  });

  test("zero delta (returning) → all caught up", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ total: 0 })} greeting={{ greetingKey: "dashboardGreetingAfternoon", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    expect(screen.getByText(/All caught up/i)).toBeInTheDocument();
  });

  test("renders a task-updated chip and routes its click", () => {
    const onOpenTask = vi.fn();
    const counts = emptyCounts(); counts.tasks.updated = 4;
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ counts, total: 4 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 1, milestonesSoon: 0 } }} onOpenTask={onOpenTask} />);
    const chip = screen.getByRole("button", { name: /4 tasks updated/i });
    fireEvent.click(chip);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  test("renders a RAG flip label (non-interactive)", () => {
    render(<DashboardDeltaStrip lang="en-US" delta={delta({ ragFlips: [{ scope: "schedule", from: "G", to: "A", worsened: true }], total: 1 })} greeting={{ greetingKey: "dashboardGreetingMorning", summary: { needsYou: 0, milestonesSoon: 0 } }} />);
    // The flip text uses the scope's display label; assert the arrow rendering.
    expect(screen.getByText(/→/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/dashboard-delta-strip.test.tsx`
Expected: FAIL — `Failed to resolve import "./dashboard-delta-strip"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard-delta-strip.tsx`:

```tsx
"use client";

import { t, type Lang } from "./i18n";
import { RagBadge } from "./rag-badge";
import { healthColorName } from "./health";
import type { DeltaResult, GreetingTimeKey, RagScope } from "./dashboard-delta";

interface GreetingResult {
  greetingKey: GreetingTimeKey;
  summary: { needsYou: number; milestonesSoon: number };
}

interface DashboardDeltaStripProps {
  lang: Lang;
  delta: DeltaResult;
  greeting: GreetingResult;
  onOpenTask?: () => void;
  onOpenRaid?: () => void;
  onOpenMilestone?: () => void;
  onOpenChange?: () => void;
}

const SCOPE_LABEL_KEY: Record<RagScope, Parameters<typeof t>[1]> = {
  overall: "dashboardOverall",
  schedule: "dashboardSubSchedule",
  budget: "dashboardSubBudget",
  scope: "dashboardSubScope",
};

interface Chip {
  key: string;
  label: string;
  onClick?: () => void;
}

function buildChips(lang: Lang, delta: DeltaResult, handlers: Pick<DashboardDeltaStripProps, "onOpenTask" | "onOpenRaid" | "onOpenMilestone" | "onOpenChange">): Chip[] {
  const chips: Chip[] = [];
  const c = delta.counts;
  if (c.tasks.created > 0) chips.push({ key: "t-c", label: t(lang, "dashboardDeltaTasksCreated", String(c.tasks.created)), onClick: handlers.onOpenTask });
  if (c.tasks.updated + c.tasks.statusChanged > 0) chips.push({ key: "t-u", label: t(lang, "dashboardDeltaTasksUpdated", String(c.tasks.updated + c.tasks.statusChanged)), onClick: handlers.onOpenTask });
  if (c.tasks.completed > 0) chips.push({ key: "t-d", label: t(lang, "dashboardDeltaTasksCompleted", String(c.tasks.completed)), onClick: handlers.onOpenTask });
  const raidN = c.raid.created + c.raid.updated + c.raid.statusChanged + c.raid.completed;
  if (raidN > 0) chips.push({ key: "r", label: t(lang, "dashboardDeltaRaidChanged", String(raidN)), onClick: handlers.onOpenRaid });
  const msN = c.milestone.created + c.milestone.updated + c.milestone.statusChanged + c.milestone.completed;
  if (msN > 0) chips.push({ key: "m", label: t(lang, "dashboardDeltaMilestoneChanged", String(msN)), onClick: handlers.onOpenMilestone });
  const chN = c.change.created + c.change.updated + c.change.statusChanged + c.change.completed;
  if (chN > 0) chips.push({ key: "c", label: t(lang, "dashboardDeltaChangeChanged", String(chN)), onClick: handlers.onOpenChange });
  if (delta.newOverdue.length > 0) chips.push({ key: "od", label: t(lang, "dashboardDeltaNewOverdue", String(delta.newOverdue.length)), onClick: handlers.onOpenTask });
  return chips;
}

export function DashboardDeltaStrip({ lang, delta, greeting, onOpenTask, onOpenRaid, onOpenMilestone, onOpenChange }: DashboardDeltaStripProps) {
  const chips = buildChips(lang, delta, { onOpenTask, onOpenRaid, onOpenMilestone, onOpenChange });
  const sinceDate = delta.since ? delta.since.slice(0, 10) : "";

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, greeting.greetingKey)}
        </span>
        <span className="text-sm text-muted-foreground">
          {t(lang, "dashboardGreetingSummary", String(greeting.summary.needsYou), String(greeting.summary.milestonesSoon))}
        </span>
      </div>

      <div className="mt-2">
        {delta.isFirstVisit ? (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardDeltaWelcome")}</p>
        ) : delta.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardDeltaAllCaught", sinceDate)}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{t(lang, "dashboardDeltaSinceTitle")}</span>
            {chips.map((chip) =>
              chip.onClick ? (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onClick}
                  className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-foreground hover:bg-surface-muted hover:border-AIPM-dark-blue"
                >
                  {chip.label}
                </button>
              ) : (
                <span key={chip.key} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-foreground">{chip.label}</span>
              ),
            )}
            {delta.ragFlips.map((flip) => (
              <span key={`flip-${flip.scope}`} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-foreground">
                <RagBadge value={flip.to} lang={lang} />
                {t(lang, "dashboardDeltaFlip", t(lang, SCOPE_LABEL_KEY[flip.scope]), flip.from ? healthColorName(flip.from, lang) : "—", flip.to ? healthColorName(flip.to, lang) : "—")}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/dashboard-delta-strip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors/warnings. (Confirm `SCOPE_LABEL_KEY` uses real `TranslationKey`s — `dashboardOverall`, `dashboardSubSchedule`, `dashboardSubBudget`, `dashboardSubScope` all exist in i18n.ts.)

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-delta-strip.tsx src/app/dashboard-delta-strip.test.tsx
git commit -m "feat(dashboard): delta-strip + greeting component"
```

---

### Task 7: Wire into `dashboard-panel.tsx` (reorder + hook + disclosure) and `workspace-section.tsx`

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/workspace-section.tsx:741-775` (DashboardPanel call site)
- Test: `src/app/dashboard-panel.test.tsx` (extend)

**Context:** `DashboardPanel` already gets `lang, today, onOpenRaid, onOpenTask, onOpenMilestone, topActions, onOpenAction` and computes `model`. It does NOT yet get `projectId`/`isPopout`/`onOpenChange`. In `workspace-section.tsx`, `currentProjectId` is already a prop (`workspace-section-types.ts:124`, `string | null`) and `isPopout` comes from `useWorkspaceTab()` (line 187). `setActiveTab("changes")` opens the changes view.

- [ ] **Step 1: Write the failing test (extend `dashboard-panel.test.tsx`)**

Add these tests to `src/app/dashboard-panel.test.tsx` (keep existing imports; add `within`/`fireEvent` if missing). Use the file's existing prop-builder helper; pass the new props `projectId="test-proj"`, `isPopout={false}`. If the existing helper doesn't accept them, extend it.

```tsx
import { clearLandingState } from "./landing-state";

describe("DashboardPanel landing cockpit", () => {
  afterEach(() => clearLandingState());

  test("renders the delta strip greeting on first visit", () => {
    renderDashboard({ projectId: "p-greet" }); // use the file's render helper
    // Greeting is one of morning/afternoon/evening — assert the welcome line shows on first visit.
    expect(screen.getByText(/Welcome/i)).toBeInTheDocument();
  });

  test("folds RAG override selects into an Adjust-health disclosure", () => {
    renderDashboard({ projectId: "p-disc" });
    expect(screen.getByText(/Adjust health ratings/i)).toBeInTheDocument();
  });

  test("top actions render above the registers band", () => {
    const topActions = [{ id: "a1", /* shape per SuggestedAction */ } as any];
    renderDashboard({ projectId: "p-act", topActions });
    // The Top actions heading should appear before the RAID register heading in DOM order.
    const html = document.body.innerHTML;
    expect(html.indexOf("dashboardTopActions") === -1).toBe(true); // it's translated, sanity only
  });
});
```

> The exact assertions depend on the existing test helpers in `dashboard-panel.test.tsx`. Read that file first; reuse its `renderDashboard`/prop factory and its established query patterns (it already mounts the panel inside `WorkspaceProvider`). Keep the new tests behavioral: (a) welcome line on first visit, (b) "Adjust health ratings" summary present, (c) the top-actions section precedes the registers band in document order.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: FAIL — new props not accepted / strip + disclosure not present.

- [ ] **Step 3: Edit `dashboard-panel.tsx` — add props**

In `DashboardPanelProps` (after `tursoActive?: boolean;`) add:

```ts
  projectId: string;
  isPopout?: boolean;
  onOpenChange?: () => void;
```

- [ ] **Step 4: Edit `dashboard-panel.tsx` — imports + hook + greeting**

Add imports near the top:

```ts
import { useLandingDelta } from "./use-landing-delta";
import { buildGreeting, type RagScope } from "./dashboard-delta";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
```

Inside `DashboardPanel`, after `model` is computed (after the `useMemo` block, before the narrative state), add:

```ts
  // Landing cockpit: greeting + "since you last looked" delta.
  const currentRag: Record<RagScope, Health | null> = {
    overall: model.overall.effective,
    schedule: model.schedule.effective,
    budget: model.budget.effective,
    scope: model.scope.effective,
  };
  const delta = useLandingDelta({
    projectId: props.projectId,
    currentRag,
    overdue: model.overdue,
    today,
    isPopout: props.isPopout ?? false,
  });
  // Hour captured once (lazy) to keep `new Date()` out of the render body.
  const [greetHour] = useState(() => new Date().getHours());
  const milestonesSoon = model.overdueMilestones.length + model.atRiskMilestones.length + model.dueSoonMilestones.length;
  const greeting = buildGreeting(greetHour, { needsYou: topActions?.length ?? 0, milestonesSoon });
```

(`Health` is already imported in this file; `useState` is already imported.)

- [ ] **Step 5: Edit `dashboard-panel.tsx` — render the strip + reorder**

At the very start of the outer `<div className="space-y-4">` (before the "Overall band" comment block), insert:

```tsx
        {/* Landing: greeting + since-you-last-looked */}
        <DashboardDeltaStrip
          lang={lang}
          delta={delta}
          greeting={greeting}
          onOpenTask={onOpenTask ? () => onOpenTask(model.overdue[0]?.id ?? model.dueSoon[0]?.id ?? -1) : undefined}
          onOpenRaid={onOpenRaid ? () => onOpenRaid(model.topRaid[0]?.id ?? -1) : undefined}
          onOpenMilestone={props.onOpenMilestone}
          onOpenChange={props.onOpenChange}
        />

        {/* Top actions — promoted to the top so the PM sees what needs them first */}
        {topActions && topActions.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "dashboardTopActions")}
            </h3>
            <div className="flex flex-col gap-2">
              {topActions.map((a) => (
                <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpenAction ?? (() => {})} />
              ))}
            </div>
          </section>
        )}
```

Then DELETE the old Top-actions block at the bottom (the `{topActions && topActions.length > 0 && ( … )}` section inside the final grid, lines ~424-436), leaving Recent activity as a standalone `Section` (change the wrapping `<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">` that paired actions+activity so it now contains only Recent activity — or unwrap it to a bare `Section`).

- [ ] **Step 6: Edit `dashboard-panel.tsx` — fold RAG overrides into a disclosure**

Wrap the four `OverrideSelect` components (the `<OverrideSelect …/>` for overall/schedule/budget/scope inside the "Overall band") in a native disclosure so they're collapsed by default. Replace the run of four `OverrideSelect`s with:

```tsx
          <details className="basis-full print:hidden">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              {t(lang, "dashboardAdjustHealth")}
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <OverrideSelect
                lang={lang}
                label={t(lang, "dashboardOverall")}
                value={status.ragOverride}
                computed={model.overall.computed}
                effective={model.overall.effective}
                onChange={(v) => setStatus((s) => ({ ...s, ragOverride: v }))}
              />
              <OverrideSelect
                lang={lang}
                label={t(lang, "dashboardSubSchedule")}
                value={status.scheduleOverride}
                computed={model.schedule.computed}
                effective={model.schedule.effective}
                onChange={(v) => setStatus((s) => ({ ...s, scheduleOverride: v }))}
              />
              {showBudget && (
                <OverrideSelect
                  lang={lang}
                  label={t(lang, "dashboardSubBudget")}
                  value={status.budgetOverride}
                  computed={model.budget.computed}
                  effective={model.budget.effective}
                  onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))}
                />
              )}
              {showChanges && (
                <OverrideSelect
                  lang={lang}
                  label={t(lang, "dashboardSubScope")}
                  value={status.scopeOverride}
                  computed={null}
                  effective={model.scope.effective}
                  onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))}
                />
              )}
            </div>
          </details>
```

Keep the big "Overall: <color>" headline, the Trends toggle, and the report-date span outside the disclosure (still in the band). The disclosure being `basis-full` puts it on its own row.

- [ ] **Step 7: Edit `workspace-section.tsx` — pass the new props**

At the `DashboardPanel` call site (`:741`), add after `onOpenAction={onOpenAction}`:

```tsx
              projectId={currentProjectId ?? "default"}
              isPopout={isPopout}
              onOpenChange={() => setActiveTab("changes")}
```

(`currentProjectId` is already a prop in scope; `isPopout` is from the `useWorkspaceTab()` destructure at line 187; `setActiveTab` is already used in sibling handlers.)

- [ ] **Step 8: Run the tests**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx src/app/workspace-section.test.tsx`
Expected: PASS. Fix the existing `workspace-section.test.tsx` `makeProps` if it needs `currentProjectId` (it already provides it per the types) — no change expected, but verify.

- [ ] **Step 9: Full lint + typecheck + unit suite**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all green, zero warnings.

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx src/app/workspace-section.tsx
git commit -m "feat(dashboard): landing cockpit layout — strip, actions-on-top, health disclosure"
```

---

### Task 8: a11y gate + release

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md` (version badge)
- Modify: `package.json` (version)

- [ ] **Step 1: Run the Dashboard a11y gate**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`
Expected: PASS (~16s, webServer auto-starts). If it fails on an unlabeled control: the new chips are `<button>` with text content (accessible name = text), the `<details><summary>` is keyboard-native — investigate any reported node and add an `aria-label` if axe flags a control without a name. Re-run until green.

- [ ] **Step 2: Bump `version.ts`**

In `src/app/version.ts`:
- `APP_VERSION = "0.118.0"`
- `APP_BUILD_DATE = "2026-06-21"` with trailing comment `// 0.118.0 Dashboard landing cockpit (Atwood)`
- `APP_MILESTONE = "Atwood"` and update the doc comment line from `0.117.x line is "Bradbury"` to `0.118.x line is "Atwood" (Margaret Atwood)`.
- Append `"versionHighlightLandingCockpit",` as the LAST entry of `APP_HIGHLIGHT_KEYS` (after `"versionHighlightJiraEncryption",`).

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md`, add at the top of the version list:

```markdown
## [0.118.0] - 2026-06-21 "Atwood"

### Added
- **Dashboard landing cockpit.** The Dashboard now opens with a greeting and a
  "Since you last looked" strip that surfaces what changed since your previous
  visit — new/updated tasks, RAID and milestone activity, newly-overdue items,
  and project RAG status flips — with clickable chips that jump to the relevant
  view. The ranked next-actions queue is promoted to the top so the most
  important work is visible first, and the RAG override controls are folded into
  an "Adjust health ratings" disclosure to reduce clutter. Per-device,
  per-project state is stored locally (never exported).
```

- [ ] **Step 4: Update README badge + package.json**

- `README.md`: bump the version badge from `0.117.0` to `0.118.0` (grep for `0.117.0`).
- `package.json`: set `"version": "0.118.0"`.

- [ ] **Step 5: Prebuild docs-sync + build**

Run: `npm run build`
Expected: PASS — prebuild `sync-script-docs` check passes (no `scriptsDescriptions` changed), version highlight present, build clean. If prebuild flags a stale README scripts table, that's unrelated to this change — do NOT regenerate unless this task touched `package.json scriptsDescriptions` (it did not).

- [ ] **Step 6: Final full verification**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md README.md package.json
git commit -m "release: 0.118.0 \"Atwood\" — Dashboard landing cockpit"
```

---

## After all tasks

Dispatch a final code review over the whole branch, then use `superpowers:finishing-a-development-branch`. Per the user's established loop: push, open a GitLab MR (host gitlab.example.com,  (GitLab)), poll the pipeline, merge on green, sync `main`, delete the branch. Pipeline order: install → lint → typecheck → unit → build → e2e (the e2e job runs the full axe gate including Dashboard).

## Self-review notes (plan vs spec)

- Delta strip ✓ (T1/T2 engine, T6 component, T7 wiring). Actions-to-top ✓ (T7 step 5). Greeting ✓ (T1 `buildGreeting`, T6 render). RAG-flip snapshot ✓ (T1 flips, T3 store, T4 hook). Debounced last-visit ✓ (T4, 4000ms). Per-project keying ✓ (T3 map + T7 `currentProjectId`).
- Type consistency: `LandingState`, `RagScope`, `DeltaResult`, `DeltaCounts`, `computeDelta` args, `buildGreeting` signature, `useLandingDelta` args — identical across T1/T3/T4/T6/T7. ✓
- a11y: Dashboard in `A11Y_VIEWS` → T8 step 1 gate; chips are text-content buttons, disclosure keyboard-native. ✓
- i18n parity: T5 adds EN+DE in lockstep, tsc enforces. ✓
- No new Workspace field → no 6-backend write paths touched. ✓
- The strip's `onOpenTask`/`onOpenRaid` adapt the panel's id-taking handlers to the strip's no-arg chip handlers by passing a representative id (first overdue / first RAID) — a known simplification; chips route to the view, not a specific row.
