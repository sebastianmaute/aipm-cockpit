# Two-way calendar sync SP1 — Milestone date-reschedule pull — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a manual "Pull from Outlook" action to the Milestones view that applies Outlook date reschedules onto milestone `date`, flagging conflicts (app-wins) and deletions, never silently overwriting a local edit.

**Architecture:** New pure engine `calendar-pull.ts` (`planCalendarPull` → applies/conflicts/deletions) + read helper `outlook-calendar-read.ts` (`fetchProjectEventDates`) over a shared graph leaf `outlook-graph.ts`; per-device baseline store `calendar-sync-baseline.ts`; a summary modal; wiring in task-manager + milestones-panel. Spec: `docs/superpowers/specs/2026-07-01-calendar-twoway-sp1-milestone-pull-design.md`.

**Tech Stack:** Next.js (forked)/React 19/TypeScript, vitest, Microsoft Graph, Tailwind v4 AIPM tokens.

**Baseline-write refinement (vs spec):** the sync baseline is written on PULL only (apply / conflict-resolve / no-op self-heal), NOT on push — same safety, no push-path change.

**Execution order:** Wave A (parallel, file-disjoint): Task 1 (graph leaf), Task 3 (engine+types), Task 4 (baseline store), Task 5 (modal). Wave B: Task 2 (read — needs Task 1's leaf + Task 3's `PulledEvent` type). Then Task 6 (wiring — needs 2,3,4,5), Task 7 (release). Never run Task 6/7 i18n edits concurrently.

---

### Task 1: Extract shared Graph leaf `outlook-graph.ts`

**Files:** Create `src/app/outlook-graph.ts`; Modify `src/app/outlook-calendar-write.ts` (import the leaf, drop local consts).

`outlook-calendar-write.ts` currently defines module-private `const GRAPH = "https://graph.microsoft.com/v1.0"` (line 6), `const MAX_PAGES = 100` (line 7), and `async function graphGet<T>(token, url)` (line 226). Extract them so the read side can share them without a read→write dependency.

- [ ] **Step 1:** Create `src/app/outlook-graph.ts`:

```ts
// Shared low-level Microsoft Graph plumbing used by the calendar write + read
// paths. Kept dependency-light so both sides import it without a cycle.
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const MAX_PAGES = 100;

export async function graphGet<T>(token: string, url: string): Promise<T> {
  // COPY THE EXACT CURRENT BODY of graphGet from outlook-calendar-write.ts
  // (lines ~226-232) verbatim — do not alter behavior.
}
```

Open `outlook-calendar-write.ts` and copy the real `graphGet` body (headers, error handling) exactly.

- [ ] **Step 2:** In `outlook-calendar-write.ts`, delete the local `GRAPH`, `MAX_PAGES`, and `graphGet` definitions and add `import { GRAPH, MAX_PAGES, graphGet } from "./outlook-graph";`. If `graphGet` was not exported before, ensure nothing else imported it from here (grep `from "./outlook-calendar-write"` for `graphGet` — none expected).

- [ ] **Step 3:** Verify no behavior change: `npx tsc --noEmit` (PASS) and `npm run test:run -- outlook-calendar-write.test.ts outlook-calendar.test.ts` (PASS).

- [ ] **Step 4:** Commit:
```bash
git add src/app/outlook-graph.ts src/app/outlook-calendar-write.ts
git commit -m "refactor(calendar): extract shared outlook-graph leaf (GRAPH/graphGet/MAX_PAGES)"
```

---

### Task 3: Pure pull engine `calendar-pull.ts`

**Files:** Create `src/app/calendar-pull.ts`, `src/app/calendar-pull.test.ts`.

(Owns the shared types `PulledEvent`, `PullEntity`, `PullPlan`.)

- [ ] **Step 1: Write the failing test** `src/app/calendar-pull.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planCalendarPull, type PulledEvent } from "./calendar-pull";

const ev = (id: string, date: string | null, isCancelled = false): PulledEvent => ({ id, date, isCancelled });

describe("planCalendarPull", () => {
  it("applies an Outlook move when the entity is unchanged since last sync", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: { e1: "2026-02-01" },
    });
    expect(plan.applies).toEqual([{ id: 1, eventId: "e1", newDate: "2026-02-10" }]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.deletions).toEqual([]);
  });
  it("flags a conflict when both sides changed", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-05", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: { e1: "2026-02-01" },
    });
    expect(plan.applies).toEqual([]);
    expect(plan.conflicts).toEqual([{ id: 1, eventId: "e1", appDate: "2026-02-05", outlookDate: "2026-02-10" }]);
  });
  it("flags a conflict (not an apply) when there is no baseline (bootstrap safety)", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-05", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-10")],
      baseline: {},
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.applies).toEqual([]);
  });
  it("flags a deletion for a missing or cancelled or null-date event", () => {
    const args = (events: PulledEvent[]) => planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }], events, baseline: { e1: "2026-02-01" },
    });
    expect(args([]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
    expect(args([ev("e1", "2026-02-01", true)]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
    expect(args([ev("e1", null)]).deletions).toEqual([{ id: 1, eventId: "e1" }]);
  });
  it("is a no-op when dates already match", () => {
    const plan = planCalendarPull({
      entities: [{ id: 1, date: "2026-02-01", outlookEventId: "e1" }],
      events: [ev("e1", "2026-02-01")],
      baseline: {},
    });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
  });
  it("ignores entities without an outlookEventId", () => {
    const plan = planCalendarPull({ entities: [{ id: 1, date: "2026-02-01" }], events: [], baseline: {} });
    expect(plan).toEqual({ applies: [], conflicts: [], deletions: [] });
  });
});
```

- [ ] **Step 2:** Run `npm run test:run -- calendar-pull.test.ts` → FAIL (module missing).

- [ ] **Step 3:** Implement `src/app/calendar-pull.ts`:

```ts
// Pure, i18n-free engine: diff the app's pushed milestone dates against their
// current Outlook events and classify each into apply / conflict / deletion.
// App-wins: only auto-apply an Outlook move when the entity has NOT changed
// locally since the last sync (baseline). No baseline for a moved event => the
// safe default is a conflict, never a silent apply.

export interface PulledEvent {
  id: string;
  date: string | null; // all-day start as YYYY-MM-DD; null if missing/malformed
  isCancelled: boolean;
}

export interface PullEntity {
  id: number;
  date: string; // current entity anchor date, YYYY-MM-DD
  outlookEventId?: string;
}

export interface PullPlan {
  applies: { id: number; eventId: string; newDate: string }[];
  conflicts: { id: number; eventId: string; appDate: string; outlookDate: string }[];
  deletions: { id: number; eventId: string }[];
}

export function planCalendarPull(args: {
  entities: readonly PullEntity[];
  events: readonly PulledEvent[];
  baseline: Readonly<Record<string, string>>;
}): PullPlan {
  const { entities, events, baseline } = args;
  const byId = new Map(events.map((e) => [e.id, e]));
  const plan: PullPlan = { applies: [], conflicts: [], deletions: [] };
  for (const ent of entities) {
    const eventId = ent.outlookEventId;
    if (!eventId) continue;
    const ev = byId.get(eventId);
    if (!ev || ev.isCancelled || ev.date === null) {
      plan.deletions.push({ id: ent.id, eventId });
      continue;
    }
    if (ev.date === ent.date) continue; // in sync
    if (baseline[eventId] === ent.date) {
      plan.applies.push({ id: ent.id, eventId, newDate: ev.date });
    } else {
      plan.conflicts.push({ id: ent.id, eventId, appDate: ent.date, outlookDate: ev.date });
    }
  }
  return plan;
}
```

- [ ] **Step 4:** Run `npm run test:run -- calendar-pull.test.ts` → PASS. `npx tsc --noEmit` → PASS.

- [ ] **Step 5:** Commit:
```bash
git add src/app/calendar-pull.ts src/app/calendar-pull.test.ts
git commit -m "feat(calendar): pure planCalendarPull diff/conflict engine (two-way SP1)"
```

---

### Task 4: Per-device baseline store `calendar-sync-baseline.ts`

**Files:** Create `src/app/calendar-sync-baseline.ts`, `src/app/calendar-sync-baseline.test.ts`.
Mirror `src/app/landing-state.ts` (single key, defensive parse, SSR guard) — OPEN it first.

- [ ] **Step 1: Write the failing test** `calendar-sync-baseline.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { readBaselineDate, writeBaselineDate, removeBaselineEntry, loadBaseline } from "./calendar-sync-baseline";

beforeEach(() => window.localStorage.clear());

describe("calendar-sync-baseline", () => {
  it("writes and reads a date by project/entity/event", () => {
    writeBaselineDate("p1", "milestone", "e1", "2026-03-01");
    expect(readBaselineDate("p1", "milestone", "e1")).toBe("2026-03-01");
  });
  it("returns undefined for an unknown key", () => {
    expect(readBaselineDate("p1", "milestone", "nope")).toBeUndefined();
  });
  it("removes an entry", () => {
    writeBaselineDate("p1", "milestone", "e1", "2026-03-01");
    removeBaselineEntry("p1", "milestone", "e1");
    expect(readBaselineDate("p1", "milestone", "e1")).toBeUndefined();
  });
  it("loadBaseline returns an eventId->date slice for a project+entity", () => {
    writeBaselineDate("p1", "milestone", "e1", "2026-03-01");
    writeBaselineDate("p1", "milestone", "e2", "2026-03-05");
    writeBaselineDate("p2", "milestone", "e3", "2026-03-09");
    expect(loadBaseline("p1", "milestone")).toEqual({ e1: "2026-03-01", e2: "2026-03-05" });
  });
  it("tolerates malformed storage (returns empty)", () => {
    window.localStorage.setItem("lop-app:calendar-sync-baseline", "{not json");
    expect(readBaselineDate("p1", "milestone", "e1")).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Implement `calendar-sync-baseline.ts` (full map key = `${projectId}:${entityType}:${eventId}`; `loadBaseline(projectId, entityType)` returns the `eventId->date` slice the engine needs):

```ts
// Per-device sync baseline for two-way calendar pull: the last-agreed date for
// each pushed event, so the pull engine can tell whether the ENTITY changed
// locally since the last sync (app-wins conflict rule). Per-BROWSER, per-project;
// NOT workspace data — out of exports/Turso, cleared by clearAppConfig's lop-app:* sweep.
const KEY = "lop-app:calendar-sync-baseline";

function loadMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota/SSR — ignore */
  }
}

const keyFor = (projectId: string, entityType: string, eventId: string) => `${projectId}:${entityType}:${eventId}`;

export function readBaselineDate(projectId: string, entityType: string, eventId: string): string | undefined {
  return loadMap()[keyFor(projectId, entityType, eventId)];
}

export function writeBaselineDate(projectId: string, entityType: string, eventId: string, date: string): void {
  const map = loadMap();
  map[keyFor(projectId, entityType, eventId)] = date;
  saveMap(map);
}

export function removeBaselineEntry(projectId: string, entityType: string, eventId: string): void {
  const map = loadMap();
  delete map[keyFor(projectId, entityType, eventId)];
  saveMap(map);
}

export function loadBaseline(projectId: string, entityType: string): Record<string, string> {
  const prefix = `${projectId}:${entityType}:`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(loadMap())) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}
```

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit:
```bash
git add src/app/calendar-sync-baseline.ts src/app/calendar-sync-baseline.test.ts
git commit -m "feat(calendar): per-device sync-baseline store for two-way pull (SP1)"
```

---

### Task 2: Read helper `outlook-calendar-read.ts`

**Files:** Create `src/app/outlook-calendar-read.ts`, `src/app/outlook-calendar-read.test.ts`. Depends on Task 1 (leaf) + Task 3 (`PulledEvent`).

Model on `listProjectEvents` in `outlook-calendar-write.ts` (bare category, paging), but widen `$select` and map to `PulledEvent`.

- [ ] **Step 1: Write the failing test** `outlook-calendar-read.test.ts` — mock `./outlook-graph`'s `graphGet` and assert mapping + paging:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./outlook-graph", () => ({
  GRAPH: "https://graph.microsoft.com/v1.0",
  MAX_PAGES: 100,
  graphGet: vi.fn(),
}));
import { graphGet } from "./outlook-graph";
import { fetchProjectEventDates } from "./outlook-calendar-read";

describe("fetchProjectEventDates", () => {
  it("maps all-day start to a date-only string and surfaces isCancelled", async () => {
    (graphGet as any).mockResolvedValueOnce({
      value: [
        { id: "e1", start: { dateTime: "2026-04-01T00:00:00.0000000" }, isCancelled: false },
        { id: "e2", start: { dateTime: "2026-04-05T00:00:00" }, isCancelled: true },
        { id: "e3", start: null, isCancelled: false },
      ],
    });
    const out = await fetchProjectEventDates("tok", "proj-1");
    expect(out).toEqual([
      { id: "e1", date: "2026-04-01", isCancelled: false },
      { id: "e2", date: "2026-04-05", isCancelled: true },
      { id: "e3", date: null, isCancelled: false },
    ]);
  });
  it("follows @odata.nextLink paging", async () => {
    (graphGet as any)
      .mockResolvedValueOnce({ value: [{ id: "e1", start: { dateTime: "2026-04-01T00:00:00" }, isCancelled: false }], "@odata.nextLink": "https://next" })
      .mockResolvedValueOnce({ value: [{ id: "e2", start: { dateTime: "2026-04-02T00:00:00" }, isCancelled: false }] });
    const out = await fetchProjectEventDates("tok", "proj-1");
    expect(out.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Implement `outlook-calendar-read.ts`:

```ts
import { GRAPH, MAX_PAGES, graphGet } from "./outlook-graph";
import { categoryFor } from "./outlook-calendar-write";
import type { PulledEvent } from "./calendar-pull";

interface RawEvent {
  id: string;
  start: { dateTime?: string } | null;
  isCancelled?: boolean;
}

function toDate(raw: RawEvent): string | null {
  const dt = raw.start?.dateTime;
  if (typeof dt !== "string" || dt.length < 10) return null;
  const d = dt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Fetch the current date + cancel state of every event tagged with the project's
 *  bare category. Milestones share this category with committee events; the caller
 *  matches by stored outlookEventId, so non-milestone events simply don't match. */
export async function fetchProjectEventDates(token: string, projectId: string): Promise<PulledEvent[]> {
  const cat = categoryFor(projectId).replace(/'/g, "''");
  let url: string | null =
    `${GRAPH}/me/events?$filter=${encodeURIComponent(`categories/any(c:c eq '${cat}')`)}&$select=id,start,isCancelled&$top=100`;
  const out: PulledEvent[] = [];
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const json: { value?: RawEvent[]; "@odata.nextLink"?: string } = await graphGet(token, url);
    for (const e of json.value ?? []) out.push({ id: e.id, date: toDate(e), isCancelled: e.isCancelled === true });
    url = json["@odata.nextLink"] ?? null;
  }
  return out;
}
```

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit:
```bash
git add src/app/outlook-calendar-read.ts src/app/outlook-calendar-read.test.ts
git commit -m "feat(calendar): fetchProjectEventDates read helper (two-way SP1)"
```

---

### Task 5: Summary modal `calendar-pull-summary-modal.tsx`

**Files:** Create `src/app/calendar-pull-summary-modal.tsx`, `src/app/calendar-pull-summary-modal.test.tsx`. Uses the shared `Modal` (`./modal`) + i18n. Presentational, PROPS-only (no context) — the i18n keys are added in Task 6, so this task adds them too if run first; to keep Task 5 standalone, add the i18n keys HERE (EN in `i18n.ts`, DE via node in `i18n.de.ts`) as Step 0.

Props:
```ts
interface CalendarPullSummaryModalProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  applied: { id: number; name: string; newDate: string }[];
  conflicts: { id: number; eventId: string; name: string; appDate: string; outlookDate: string }[];
  deletions: { id: number; name: string }[];
  onKeepApp: (c: { id: number; eventId: string; appDate: string }) => void;
  onTakeOutlook: (c: { id: number; eventId: string; outlookDate: string }) => void;
}
```
(The caller resolves milestone `name` from ids before passing.)

- [ ] **Step 0: Add i18n keys** (EN `i18n.ts`, DE `i18n.de.ts` via node utf8 write — Edit tool corrupts umlauts):
`calendarPull` = "Pull from Outlook" / "Aus Outlook abrufen";
`calendarPulling` = "Pulling…" / "Wird abgerufen…";
`calendarPullSummaryTitle` = "Outlook calendar changes" / "Outlook-Kalenderänderungen";
`calendarPullApplied` = "Dates updated" / "Termine aktualisiert";
`calendarPullConflicts` = "Conflicts (choose which date to keep)" / "Konflikte (Termin auswählen)";
`calendarPullDeletions` = "Removed in Outlook" / "In Outlook entfernt";
`calendarPullKeepApp` = "Keep app date" / "App-Termin behalten";
`calendarPullTakeOutlook` = "Take Outlook date" / "Outlook-Termin übernehmen";
`calendarPullInSync` = "Already in sync with Outlook" / "Bereits mit Outlook synchron";
`calendarPullEventRemoved` = "Its Outlook event was removed" / "Der Outlook-Termin wurde entfernt".
(Use the DE node-write pattern from prior tasks; verify umlaut bytes: `ä`=U+00E4, `ö`=U+00F6.)

- [ ] **Step 1: Write the failing test** `calendar-pull-summary-modal.test.tsx` (open when `open`; lists applied/conflicts/deletions; conflict buttons fire callbacks with row-unique names). Use `t("en-US", …)`; `loadI18n("de")` not needed. Assert e.g. `getByText(t("en-US","calendarPullSummaryTitle"))`, and clicking the "Keep app date" button for a conflict row calls `onKeepApp` with that row's `{id,eventId,appDate}`.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Implement the modal. Render `<Modal open={open} onClose={onClose} title={t(lang,"calendarPullSummaryTitle")}>` with three sections (each rendered only when non-empty): Applied (read-only `<li>` "name → newDate"), Conflicts (each row: "name" + appDate vs outlookDate + two buttons using `INTERACTIVE`, each button `aria-label` qualified with the milestone name for row-uniqueness — WCAG 2.4.6), Deletions (read-only `<li>` "name — calendarPullEventRemoved"). Buttons call `onKeepApp`/`onTakeOutlook` with the row payload. No off-palette colors; use `--rag-*`/surface tokens only.

- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`, `npm run lint` → PASS.
- [ ] **Step 5:** Commit:
```bash
git add src/app/calendar-pull-summary-modal.tsx src/app/calendar-pull-summary-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): pull-summary modal + i18n (two-way SP1)"
```

---

### Task 6: Wire the milestone pull through task-manager → milestones-panel

**Files:** Modify `src/app/task-manager.tsx`, `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx`, `src/app/milestones-panel.tsx`, `src/app/milestones-panel.test.tsx`. Depends on Tasks 2,3,4,5.

- [ ] **Step 1:** In `task-manager.tsx`, near the milestone push hook (`useOutlookCalendarPush`, ~line 1741), add a pull hook. Create `src/app/use-milestone-calendar-pull.ts` (keeps task-manager lean) OR inline; recommended a hook file:

```ts
// use-milestone-calendar-pull.ts
import { useCallback, useState } from "react";
import type { Milestone } from "./types";
import { fetchProjectEventDates } from "./outlook-calendar-read";
import { planCalendarPull, type PullPlan } from "./calendar-pull";
import { loadBaseline, writeBaselineDate } from "./calendar-sync-baseline";

export interface MilestonePullResult { plan: PullPlan; ranAt: number; }

export function useMilestoneCalendarPull(args: {
  milestones: readonly Milestone[];
  projectId: string;
  acquireToken: (scopes: string[], opts?: { interactive?: boolean }) => Promise<string | null>;
  setMilestones: (updater: (prev: Milestone[]) => Milestone[]) => void;
  isPopout: boolean;
  enabled: boolean;
}) {
  const { milestones, projectId, acquireToken, setMilestones, isPopout, enabled } = args;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MilestonePullResult | null>(null);

  const applyMove = useCallback((id: number, eventId: string, newDate: string) => {
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, date: newDate } : m)));
    writeBaselineDate(projectId, "milestone", eventId, newDate);
  }, [setMilestones, projectId]);

  const keepApp = useCallback((c: { id: number; eventId: string; appDate: string }) => {
    // resolve conflict in the app's favour: refresh baseline so it stops conflicting
    writeBaselineDate(projectId, "milestone", c.eventId, c.appDate);
  }, [projectId]);

  const pull = useCallback(async () => {
    if (!enabled || isPopout) return;
    setBusy(true);
    try {
      const token = await acquireToken(["Calendars.Read"], { interactive: true });
      if (!token) return;
      const events = await fetchProjectEventDates(token, projectId);
      const baseline = loadBaseline(projectId, "milestone");
      const plan = planCalendarPull({
        entities: milestones.map((m) => ({ id: m.id, date: m.date, outlookEventId: m.outlookEventId })),
        events,
        baseline,
      });
      // auto-apply non-conflicting moves; self-heal baseline for in-sync events
      for (const a of plan.applies) applyMove(a.id, a.eventId, a.newDate);
      for (const m of milestones) {
        if (m.outlookEventId) {
          const ev = events.find((e) => e.id === m.outlookEventId);
          if (ev && ev.date === m.date && baseline[m.outlookEventId] !== m.date) {
            writeBaselineDate(projectId, "milestone", m.outlookEventId, m.date);
          }
        }
      }
      setResult({ plan, ranAt: 1 }); // ranAt sentinel; no Date.now() in render path
    } finally {
      setBusy(false);
    }
  }, [enabled, isPopout, acquireToken, projectId, milestones, applyMove]);

  return { pull, busy, result, clearResult: () => setResult(null), keepApp, applyMove };
}
```

Wire it in `task-manager.tsx`: `const milestonePull = useMilestoneCalendarPull({ milestones, projectId: calendarProjectId, acquireToken: msAuth.acquireToken, setMilestones: setMilestonesForPush, isPopout, enabled: calendarPushEnabled });`. Compute `applied`/`conflicts`/`deletions` display rows (resolve milestone `name` by id) and pass to the summary modal rendered in task-manager's modal area. Thread `onPullCalendar={milestonePull.pull}` + `calendarPullBusy={milestonePull.busy}` into `workspaceProps`.

- [ ] **Step 2:** `workspace-section-types.ts` — add `onPullCalendar?: () => void;` and `calendarPullBusy?: boolean;` to the milestones-relevant props.

- [ ] **Step 3:** `workspace-section.tsx` — at the `<MilestonesPanel>` mount (~line 799) pass `onPullFromOutlook={onPullCalendar}` and `calendarPullBusy={calendarPullBusy}` (destructure the two new props).

- [ ] **Step 4:** `milestones-panel.tsx` — add `onPullFromOutlook?: () => void;` + `calendarPullBusy?: boolean;` to `MilestonesPanelProps` + destructure; render a "Pull from Outlook" button right after the existing push button (line ~268-277), gated `onPullFromOutlook`:

```tsx
        {onPullFromOutlook ? (
          <button
            type="button"
            onClick={onPullFromOutlook}
            disabled={calendarPullBusy}
            className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60 ${INTERACTIVE}`}
          >
            {t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
          </button>
        ) : null}
```

- [ ] **Step 5:** `milestones-panel.test.tsx` — add: pull button renders when `onPullFromOutlook` given, hidden otherwise, disabled while `calendarPullBusy`, click fires `onPullFromOutlook`. Use the file's existing render helper.

- [ ] **Step 6:** Run `npm run test:run -- milestones-panel.test.tsx calendar-pull-summary-modal.test.tsx`, `npx tsc --noEmit`, `npm run lint`, and the Milestones axe gate: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Milestones"`. All PASS.

- [ ] **Step 7:** Commit:
```bash
git add src/app/task-manager.tsx src/app/use-milestone-calendar-pull.ts src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/milestones-panel.tsx src/app/milestones-panel.test.tsx
git commit -m "feat(calendar): wire milestone Pull-from-Outlook + summary modal (two-way SP1)"
```

---

### Task 7: Release

**Files:** `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `src/app/i18n.ts`/`i18n.de.ts` (highlight key), `AGENTS.md`, memory.

- [ ] **Step 1:** Confirm current main version (should be 0.159.x). Bump to the next MINOR (feature): `APP_VERSION = "0.160.0"`, new unused milestone codename (verify via `grep -c '"<Name>"' CHANGELOG.md` = 0), update `APP_BUILD_DATE` comment + `APP_MILESTONE`, append `"versionHighlightCalendarPull"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 2:** `package.json` → `0.160.0`.
- [ ] **Step 3:** i18n `versionHighlightCalendarPull` — EN "Outlook date reschedules pull back into milestones" / DE (node write) "Outlook-Terminverschiebungen werden in Meilensteine zurückgespielt".
- [ ] **Step 4:** `CHANGELOG.md` `## [0.160.0]` entry describing the milestone Pull-from-Outlook (date reschedule pull, app-wins conflicts, deletion notices, manual button; milestones only; SP1 of two-way sync).
- [ ] **Step 5:** `AGENTS.md` — add a "Two-way calendar sync (SP1, v0.160+)" bullet under the calendar section: read leaf `outlook-graph.ts`, `outlook-calendar-read.ts` `fetchProjectEventDates`, pure `calendar-pull.ts` `planCalendarPull` (app-wins, no-baseline⇒conflict), per-device `calendar-sync-baseline.ts` (pull-only writes), manual Milestones "Pull from Outlook" + summary modal; milestones ONLY; SP2 tasks/SP3 raid+change/SP4 absences(range)/SP5 auto-pull+deletion-semantics remain.
- [ ] **Step 6:** Memory — new `calendar-twoway-roadmap.md` + `MEMORY.md` pointer.
- [ ] **Step 7:** `npx tsc --noEmit`, `npm run test:run` (full), then commit `chore(release): 0.160.0 "<Codename>" — milestone two-way calendar pull (SP1)`.
- [ ] **Step 8:** Full release chain — only on the "release" trigger.

---

## Self-review
- **Spec coverage:** read infra (T1+T2), pure engine (T3), baseline store (T4), apply hook (T6), summary modal (T5), UI wiring (T6), i18n (T5+T7), release (T7), testing (each task). Baseline-on-push simplified to pull-only (documented refinement). All covered.
- **Type consistency:** `PulledEvent {id,date,isCancelled}`, `PullEntity {id,date,outlookEventId?}`, `PullPlan {applies,conflicts,deletions}`, `planCalendarPull({entities,events,baseline})`, baseline `(projectId, entityType, eventId, date)` — consistent across T2/T3/T4/T6. Modal props match the plan the hook produces.
- **Placeholders:** none — Task 1's `graphGet` body is an explicit "copy the exact current body" instruction (the real bytes live in the file the implementer opens).
- **Sequencing:** independent of the unreleased `feat-absence-sync-polish` branch except the no-behavior `outlook-graph` extraction in `outlook-calendar-write.ts` (trivial rebase if polish lands first).
