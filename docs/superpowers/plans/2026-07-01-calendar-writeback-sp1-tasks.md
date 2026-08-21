# Calendar Write-back SP1 (Shared Engine + Tasks) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reusable Outlook calendar write-back engine + two-level toggle, proven on Tasks (manual push + optional auto-sync).

**Architecture:** Type-scoped Graph categories (`AIPM:${projectId}:${type}`) so new entities never cross-delete milestone events. Generic `planEntityReconcile<T>` / `listEntityEvents` / `useEntityCalendarPush` clone the proven milestone path. `Task.outlookEventId` persists across all 6 backends. Per-device `settings.outlookCalendar` toggle surfaced in the tasks pane AND central Settings. Auto = a debounced, popout/M365-gated runner.

**Tech Stack:** Next.js (forked) + React + TS, MS Graph, Tailwind AIPM tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-calendar-writeback-sp1-tasks-design.md`

**Global constraints:** eslint `--max-warnings=0` (unused import = FATAL); `npx tsc --noEmit` after ANY test edit (i18n EN/DE parity enforced); `i18n.de.ts` is CRLF + real umlauts — edit via node utf8 write ONLY (Edit tool corrupts it), match `\r\n`; never log/echo a token or event body.

---

## Task 1: Type-scoped category + task event builder + typed list

**Files:**
- Modify: `src/app/outlook-calendar-write.ts`
- Test: `src/app/outlook-calendar-write.test.ts`

- [ ] **Step 1: Failing tests**

Add to `outlook-calendar-write.test.ts` (import the new symbols):
```ts
import { categoryFor, taskToGraphEvent, listEntityEvents } from "./outlook-calendar-write";
import type { Task } from "./types";

describe("categoryFor entityType", () => {
  it("is bare for milestones/committee (back-compat)", () => {
    expect(categoryFor("p1")).toBe("AIPM:p1");
  });
  it("is type-scoped for new entities", () => {
    expect(categoryFor("p1", "task")).toBe("AIPM:p1:task");
  });
});

describe("taskToGraphEvent", () => {
  const task = { id: 3, taskName: "Ship SP1", dueDate: "2026-07-10", status: "In Progress", assignee: "Alice" } as Task;
  it("builds an all-day event on the due date with the task-scoped category", () => {
    const e = taskToGraphEvent(task, "p1");
    expect(e.isAllDay).toBe(true);
    expect(e.subject).toBe("Ship SP1");
    expect(e.start.dateTime).toBe("2026-07-10T00:00:00");
    expect(e.end.dateTime).toBe("2026-07-11T00:00:00"); // next-day exclusive end
    expect(e.categories).toEqual(["AIPM:p1:task"]);
  });
});
```
Run: `npx vitest run src/app/outlook-calendar-write.test.ts -t "entityType|taskToGraphEvent"` → FAIL (not exported).

- [ ] **Step 2: Implement**

In `outlook-calendar-write.ts`:
```ts
export const categoryFor = (projectId: string, entityType?: string): string =>
  entityType ? `AIPM:${projectId}:${entityType}` : `AIPM:${projectId}`;

export function taskToGraphEvent(task: Task, projectId: string): GraphEvent {
  return {
    subject: task.taskName,
    isAllDay: true,
    start: { dateTime: `${task.dueDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(task.dueDate)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "task")],
    body: { contentType: "Text", content: [
      task.assignee ? `Owner: ${task.assignee}` : "",
      task.status ? `Status: ${task.status}` : "",
      "Managed by the AIPM PM Tracker.",
    ].filter(Boolean).join("\n") },
  };
}

/** Events tagged with a type-scoped category (id only), paginated. */
export async function listEntityEvents(token: string, projectId: string, entityType: string): Promise<ExistingEvent[]> {
  const cat = categoryFor(projectId, entityType).replace(/'/g, "''");
  let url: string | null = `${GRAPH}/me/events?$filter=${encodeURIComponent(`categories/any(c:c eq '${cat}')`)}&$select=id&$top=100`;
  const out: ExistingEvent[] = [];
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const json: { value?: { id: string }[]; "@odata.nextLink"?: string } = await graphGet(token, url);
    for (const e of json.value ?? []) out.push({ id: e.id });
    url = json["@odata.nextLink"] ?? null;
  }
  return out;
}
```
Add `import type { Task } from "./types";` to the existing type import line. `nextDay`, `GRAPH`, `MAX_PAGES`, `graphGet`, `GraphEvent`, `ExistingEvent` already exist. Change the existing single-arg `categoryFor` (line 11) to the two-arg version above — existing callers pass one arg, so output is unchanged.

- [ ] **Step 3: Verify**

- `npx vitest run src/app/outlook-calendar-write.test.ts` → all PASS (new + existing — the milestone/committee `categoryFor(projectId)` cases must stay green).
- `npx tsc --noEmit` → 0. `npx eslint src/app/outlook-calendar-write.ts src/app/outlook-calendar-write.test.ts --max-warnings=0` → 0.

- [ ] **Step 4: Commit**
```bash
git add src/app/outlook-calendar-write.ts src/app/outlook-calendar-write.test.ts
git commit -m "feat(calendar): type-scoped category + taskToGraphEvent + listEntityEvents"
```

---

## Task 2: Generic reconcile planner

**Files:**
- Modify: `src/app/calendar-reconcile.ts`
- Test: `src/app/calendar-reconcile.test.ts`

- [ ] **Step 1: Failing tests**

Add to `calendar-reconcile.test.ts`:
```ts
import { planEntityReconcile, type HasEventLink } from "./calendar-reconcile";

describe("planEntityReconcile", () => {
  type Row = HasEventLink & { name: string };
  it("creates items without an event id", () => {
    const plan = planEntityReconcile<Row>([{ id: 1, name: "a" }], []);
    expect(plan.create.map((i) => i.id)).toEqual([1]);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
  });
  it("updates linked items and deletes orphan existing events", () => {
    const items: Row[] = [{ id: 1, name: "a", outlookEventId: "E1" }];
    const plan = planEntityReconcile<Row>(items, [{ id: "E1" }, { id: "E2" }]);
    expect(plan.update).toEqual([{ item: items[0], eventId: "E1" }]);
    expect(plan.delete).toEqual(["E2"]);
    expect(plan.create).toEqual([]);
  });
});
```
Run: `npx vitest run src/app/calendar-reconcile.test.ts -t planEntityReconcile` → FAIL.

- [ ] **Step 2: Implement**

In `calendar-reconcile.ts`, add (keep the existing milestone `planCalendarReconcile` + its tests untouched):
```ts
export interface HasEventLink { id: number; outlookEventId?: string; }
export interface GenericReconcilePlan<T> {
  create: T[];
  update: { item: T; eventId: string }[];
  delete: string[];
}
export function planEntityReconcile<T extends HasEventLink>(
  items: readonly T[], existing: readonly ExistingEvent[],
): GenericReconcilePlan<T> {
  const keptIds = new Set<string>();
  const create: T[] = [];
  const update: { item: T; eventId: string }[] = [];
  for (const it of items) {
    if (it.outlookEventId) { update.push({ item: it, eventId: it.outlookEventId }); keptIds.add(it.outlookEventId); }
    else create.push(it);
  }
  const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
  return { create, update, delete: del };
}
```

- [ ] **Step 3: Verify** — `npx vitest run src/app/calendar-reconcile.test.ts` all PASS; `npx tsc --noEmit` 0; eslint 0 on both files.

- [ ] **Step 4: Commit**
```bash
git add src/app/calendar-reconcile.ts src/app/calendar-reconcile.test.ts
git commit -m "feat(calendar): generic planEntityReconcile over any outlookEventId-carrying entity"
```

---

## Task 3: Generic push hook

**Files:**
- Create: `src/app/use-entity-calendar-push.ts`
- Test: `src/app/use-entity-calendar-push.test.tsx`

- [ ] **Step 1: Failing test**

Model the test on `use-outlook-calendar-push` if a test exists; otherwise mock `./use-ms-auth`, `./toast-context`, and the Graph write functions. Assert:
- create → `setItems` writes back the new id onto the created item;
- 404 on `updateEvent` (throw `GraphCalendarError(404)`) → `setItems` clears that item's `outlookEventId`;
- `isPopout: true` → no Graph calls, no `setItems`.
```ts
import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
vi.mock("./use-ms-auth", () => ({ useMsAuth: () => ({ acquireToken: vi.fn().mockResolvedValue("tok") }) }));
vi.mock("./toast-context", () => ({ useToastContext: () => vi.fn() }));
vi.mock("./outlook-calendar-write", async (imp) => {
  const actual = await imp<typeof import("./outlook-calendar-write")>();
  return { ...actual,
    listEntityEvents: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockResolvedValue("NEW1"),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  };
});
import { useEntityCalendarPush } from "./use-entity-calendar-push";
import { taskToGraphEvent } from "./outlook-calendar-write";

it("writes back the created event id", async () => {
  let items = [{ id: 1, taskName: "A", dueDate: "2026-07-10" }];
  const setItems = vi.fn((u) => { items = u(items); });
  const { result } = renderHook(() => useEntityCalendarPush({
    items, entityType: "task", projectId: "p1", toGraphEvent: taskToGraphEvent,
    setItems, isPopout: false, lang: "en-US", enabled: true,
  }));
  await act(async () => { await result.current.pushToOutlook(); });
  expect(items[0].outlookEventId).toBe("NEW1");
});
```
Run → FAIL (module missing).

- [ ] **Step 2: Implement**

Create `use-entity-calendar-push.ts` — copy `use-outlook-calendar-push.ts` verbatim, then generalize: replace `Milestone` with a generic `T extends HasEventLink`, `milestoneToGraphEvent` with the injected `toGraphEvent`, `listProjectEvents` with `listEntityEvents(token, projectId, entityType)`, `planCalendarReconcile` with `planEntityReconcile`, `setMilestones`/`.milestone` with `setItems`/`.item`. Signature:
```ts
export function useEntityCalendarPush<T extends HasEventLink>({
  items, entityType, projectId, toGraphEvent, setItems, isPopout, lang, enabled,
}: {
  items: readonly T[]; entityType: string; projectId: string;
  toGraphEvent: (item: T, projectId: string) => GraphEvent;
  setItems: (updater: (prev: T[]) => T[]) => void;
  isPopout: boolean; lang: Lang; enabled: boolean;
}): { pushToOutlook: () => Promise<void>; busy: boolean }
```
Keep the exact toast keys (`calendarPushNoAccess`/`calendarPushResult`/`calendarPushPartial`) and the 404-on-PATCH → clear-id self-heal. `useCallback` deps: `[isPopout, acquireToken, showToast, lang, items, projectId, setItems, entityType, toGraphEvent]`.

- [ ] **Step 3: Verify** — test PASS; `npx tsc --noEmit` 0; `npx eslint src/app/use-entity-calendar-push.ts src/app/use-entity-calendar-push.test.tsx --max-warnings=0` 0.

- [ ] **Step 4: Commit**
```bash
git add src/app/use-entity-calendar-push.ts src/app/use-entity-calendar-push.test.tsx
git commit -m "feat(calendar): generic useEntityCalendarPush hook (parameterized milestone-push clone)"
```

---

## Task 4: Persist `Task.outlookEventId` (6 write paths + fixtures)

**Files:**
- Modify: `src/app/types.ts`, `src/app/csv-codecs-core.ts`, `src/app/csv-codecs-decode.ts`, `src/app/markdown-codecs-core.ts`, `src/app/sanitize.ts` (task validation path — locate the Task sanitizer/round-trip), `src/app/__fixtures__/golden-*`, `src/app/sample-workspace-small.csv`, `src/app/sample-workspace-small.md`
- Test: `src/app/golden-workspace.test.*` (regenerate), a storage round-trip test for tasks

- [ ] **Step 1: Add the field + failing round-trip test**

`types.ts` — add to the `Task` interface: `outlookEventId?: string;` (place near other optional string fields).

Add a round-trip test (find the existing task CSV/MD/JSON round-trip test; extend it) asserting a task with `outlookEventId: "E9"` survives `workspaceToCsv → csvToWorkspace`, `workspaceToMarkdown → markdownToWorkspace`, and JSON. Run → FAIL (field dropped by codecs).

- [ ] **Step 2: CSV**

`csv-codecs-core.ts:42` `CSV_COLUMNS` — append `"outlookEventId"`. Confirm `fieldToString` (`:440`) returns the string for an arbitrary `keyof Task` (if it has a default `String(t[c] ?? "")` arm it already works; else add a case). `csv-codecs-decode.ts:474` `buildTaskFromObj` — after building the task, `if (obj.outlookEventId) task.outlookEventId = obj.outlookEventId;` (mirror milestone `:355`). Turso single+tenant derive from `CSV_COLUMNS` automatically (DDL + insert) — no extra edit; `turso-migrate.ts` PRAGMA-diff ALTER-adds it to existing DBs (already generic).

- [ ] **Step 3: Markdown**

`markdown-codecs-core.ts` — the task table codec: add an `OutlookEventId` column to the task `*_MD_COLUMNS` and a decode arm `else if (norm === "outlookeventid") mapped["outlookEventId"] = val;` (mirror milestone `:419`/`:448`).

- [ ] **Step 4: Sanitize / IDB / JSON**

Locate how tasks are validated on load (grep `buildTaskFromObj`, `sanitizeTask`, task-validation). Ensure `outlookEventId` (string, cap 1024) is preserved on the load path; if a task sanitizer strips unknown fields, add the field (mirror `sanitize-records.ts:95-96`). IDB (`BrowserBackend`) + JSON persist the whole object — confirm no field allowlist drops it (grep the browser backend for a task field pick-list).

- [ ] **Step 5: Regenerate fixtures + sample**

- Append the empty `outlookEventId` column to every task row in `sample-workspace-small.csv` and the task table in `sample-workspace-small.md` (via the app codec round-trip for CSV per AGENTS — `csvToWorkspace`→`workspaceToCsv`; the `.md` by exact full-line edits or the sample generator). If the sample is generator-driven, run `npx vite-node scripts/generate-sample-workspace.ts`.
- Regenerate `__fixtures__/golden-*` via the serializers (the documented "legit new-column format change"). The ONLY byte diff must be the new empty column.

- [ ] **Step 6: Verify**

- `npx vitest run src/app/golden-workspace.test.* <task round-trip test>` → PASS.
- `npx tsc --noEmit` 0; eslint 0 on every modified `.ts`.
- `git status` — confirm changes are limited to the codec/type/fixture/sample files (no unrelated churn).

- [ ] **Step 7: Commit**
```bash
git add src/app/types.ts src/app/csv-codecs-core.ts src/app/csv-codecs-decode.ts src/app/markdown-codecs-core.ts src/app/sanitize.ts src/app/__fixtures__ src/app/sample-workspace-small.csv src/app/sample-workspace-small.md
git commit -m "feat(calendar): persist Task.outlookEventId across all six backends"
```

---

## Task 5: Settings model + `calendarSyncFor` helper

**Files:**
- Modify: `src/app/settings-types.ts` (or `settings.ts` where `Settings` + `sanitizeSettings` live — locate first), `src/app/use-settings.ts` if sanitize lives there
- Create: `src/app/calendar-sync-config.ts` (pure helper)
- Test: `src/app/calendar-sync-config.test.ts`, extend the settings sanitize test

- [ ] **Step 1: Failing tests**
```ts
import { calendarSyncFor, type CalendarEntityType } from "./calendar-sync-config";
it("defaults to disabled when unset", () => {
  expect(calendarSyncFor({} as never, "task")).toEqual({ enabled: false, auto: false });
});
it("reads a configured entry", () => {
  const s = { outlookCalendar: { task: { enabled: true, auto: true } } } as never;
  expect(calendarSyncFor(s, "task")).toEqual({ enabled: true, auto: true });
});
```
Run → FAIL.

- [ ] **Step 2: Types + helper**

In the settings types module add:
```ts
export type CalendarEntityType = "task" | "raid" | "change" | "absence";
export interface CalendarSyncEntry { enabled: boolean; auto: boolean; }
// on Settings:
outlookCalendar?: Partial<Record<CalendarEntityType, CalendarSyncEntry>>;
```
Create `calendar-sync-config.ts`:
```ts
import type { Settings, CalendarEntityType } from "./settings-types";
export function calendarSyncFor(s: Settings, type: CalendarEntityType): { enabled: boolean; auto: boolean } {
  const e = s.outlookCalendar?.[type];
  return { enabled: e?.enabled === true, auto: e?.enabled === true && e?.auto === true };
}
```
(Note: `auto` is only true when `enabled` is also true — auto is meaningless when disabled.)

- [ ] **Step 3: Sanitize on load**

In `sanitizeSettings` (locate), coerce `outlookCalendar` entries: for each known `CalendarEntityType`, `{ enabled: v.enabled === true, auto: v.auto === true }`; drop unknown keys. It rides the `writeSettings` spread (no allowlist edit needed — verify `writeSettings` spreads the whole settings object, like `dashboardDensity`).

- [ ] **Step 4: Verify** — tests PASS; `npx tsc --noEmit` 0; eslint 0.

- [ ] **Step 5: Commit**
```bash
git add src/app/settings-types.ts src/app/calendar-sync-config.ts src/app/calendar-sync-config.test.ts src/app/use-settings.ts
git commit -m "feat(calendar): per-device settings.outlookCalendar model + calendarSyncFor helper"
```

---

## Task 6: Central Settings → Integrations sub-section

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx` (locate the M365 block), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: extend the integrations section test if one exists

- [ ] **Step 1: i18n keys (EN via Edit, DE via node)**

EN keys in `i18n.ts`: `calendarSyncHeading` ("Calendar write-back"), `calendarSyncDesc`, `calendarSyncEntityTask` ("Tasks (due dates)"), `calendarSyncEnable` ("Add to Outlook calendar"), `calendarSyncAuto` ("Keep in sync automatically"). DE via node utf8 write (CRLF anchors, real umlauts) — mirror keys.

- [ ] **Step 2: Render the section (M365-gated)**

In the M365 area of `integrations-section.tsx`, when M365 is configured, render a `calendarSyncHeading` block with one row per entity (SP1: task only): an **Enable** checkbox/switch bound to `settings.outlookCalendar?.task?.enabled`, and an **Auto** switch bound to `.auto`, disabled until enabled. Row-unique `aria-label`s (e.g. `` `${t(lang,"calendarSyncEnable")} – ${t(lang,"calendarSyncEntityTask")}` ``) — Settings is axe-scanned. On change, `onChangeSettings({ ...settings, outlookCalendar: { ...settings.outlookCalendar, task: { enabled, auto } } })`. Use the existing Settings checkbox/`SegmentedControl` atoms (palette-safe, `FOCUS_RING`).

- [ ] **Step 3: Verify**

- `npx tsc --noEmit` 0; `npx eslint src/app/settings-sections/integrations-section.tsx --max-warnings=0` 0.
- Axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` (or the exact Integrations view label in `A11Y_VIEWS`) → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/app/settings-sections/integrations-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): central Settings toggle for task calendar write-back (enable + auto)"
```

---

## Task 7: Tasks pane — enable toggle + push button

**Files:**
- Modify: `src/app/tasks-section.tsx` (+ its props type in `tasks-section` / `task-manager.tsx` to thread `projectId`, `setTasks`, `isPopout`, `settings`, M365-configured flag if not already present), `src/app/i18n.ts`, `src/app/i18n.de.ts` (only if new pane strings needed — prefer reusing `calendarPush`/`calendarPushing` + `calendarSyncEnable`)
- Test: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Failing test**

Add to `tasks-section.test.tsx`: with M365 configured and `settings.outlookCalendar.task.enabled = true`, the toolbar renders a "Push to Outlook" button (`getByRole("button", { name: t("en-US","calendarPush") })`); with enable off, it does not. (Stub the M365-configured flag + settings via the existing `stubSettings`.)

- [ ] **Step 2: Wire the pane**

In the tasks toolbar (the single flat header row), when M365 is configured:
- An **enable** toggle (checkbox `label`, `text-xs`, row-unique `aria-label`) bound to `calendarSyncFor(settings,"task").enabled`, writing `settings.outlookCalendar.task.enabled` via `setSettings`→`writeSettings` (same setting as central).
- When enabled, a **Push to Outlook** button (mirror the milestone panel button; `iconOnly` to match the compact bar) calling `useEntityCalendarPush({ items: pushableTasks, entityType: "task", projectId, toGraphEvent: taskToGraphEvent, setItems: setTasks, isPopout, lang, enabled: true })` where `pushableTasks = tasks.filter(x => !isTaskFinished(x) && !!x.dueDate)`.
- Thread any missing props (`projectId`, `setTasks`, `isPopout`, M365-configured boolean) from `task-manager.tsx` → `WorkspaceSection`/`TasksSection`. `setTasks` is the workspace setter; `isPopout` already threaded elsewhere.
- Gate everything on M365 configured (hidden otherwise), like the milestone push button's `onPushToOutlook` gating.

- [ ] **Step 3: Verify**

- `npx vitest run src/app/tasks-section.test.tsx` → PASS.
- `npx tsc --noEmit` 0; `npx eslint src/app/tasks-section.tsx --max-warnings=0` 0.
- Axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` → PASS (new toggle/button labelled).

- [ ] **Step 4: Commit**
```bash
git add src/app/tasks-section.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(calendar): tasks pane enable toggle + Push to Outlook button"
```

---

## Task 8: Auto-sync runner

**Files:**
- Create: `src/app/use-calendar-auto-sync.ts`
- Modify: `src/app/task-manager.tsx` (mount the runner above the view, where tasks + setTasks live)
- Test: `src/app/use-calendar-auto-sync.test.tsx`

- [ ] **Step 1: Failing test**

With fake timers, assert: when `enabled && auto && m365Configured && !isPopout`, a change to the filtered task list (add a task with a due date) fires the injected push once after the debounce; when `auto` is false or `isPopout` true, it never fires; a second identical render (same content hash) does not re-fire.
```ts
import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useCalendarAutoSync } from "./use-calendar-auto-sync";
// inject a mock push fn; drive `items` + flags via rerender; advance timers.
```

- [ ] **Step 2: Implement**

`use-calendar-auto-sync.ts`:
```ts
"use client";
import { useEffect, useRef } from "react";
export function useCalendarAutoSync({
  enabled, auto, m365Configured, isPopout, contentKey, push,
}: {
  enabled: boolean; auto: boolean; m365Configured: boolean; isPopout: boolean;
  contentKey: string;                 // hash of the filtered pushable list
  push: () => Promise<void>;          // silent background push (no interactive prompt)
}): void {
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!(enabled && auto && m365Configured && !isPopout)) return;
    if (contentKey === lastKey.current) return;
    const handle = setTimeout(() => {
      lastKey.current = contentKey;      // advance BEFORE awaiting → fail-once-per-change
      void push().catch((err) => console.warn("calendar auto-sync failed", err));
    }, 4000);
    return () => clearTimeout(handle);
  }, [enabled, auto, m365Configured, isPopout, contentKey, push]);
}
```
Mount in `task-manager.tsx` (above the view, like `use-scheduled-job-runner`): compute `pushableTasks` + `contentKey` (join of `id|dueDate|taskName|status`), build a **silent** push variant. The manual `useEntityCalendarPush` prompts interactively; for auto, pass a push that acquires the token with `{ interactive: false }` (add an `interactive?: boolean` option to `useEntityCalendarPush`, default true; auto passes false so a missing consent is a silent no-op). Popout branch: do not mount / pass `isPopout: true`.

- [ ] **Step 3: Verify** — test PASS; `npx tsc --noEmit` 0; eslint 0 on both files. Confirm no `react-hooks/exhaustive-deps` warning (all deps listed; `push` must be stable/memoized at the call site — wrap in `useCallback`).

- [ ] **Step 4: Commit**
```bash
git add src/app/use-calendar-auto-sync.ts src/app/task-manager.tsx src/app/use-calendar-auto-sync.test.tsx
git commit -m "feat(calendar): debounced auto-sync runner for tasks (popout/M365-gated, fail-once)"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1:** `npx tsc --noEmit` → 0.
- [ ] **Step 2:** `npx eslint src/app --max-warnings=0` (or the repo lint script `npm run lint`) → 0.
- [ ] **Step 3:** `npm run test:run` (full vitest) → all PASS (esp. golden-workspace, storage round-trip, settings, the new calendar tests).
- [ ] **Step 4:** Axe for the two scanned surfaces touched: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` and `-g "Settings"` → PASS.
- [ ] **Step 5:** Manual smoke (dev): with M365 connected, enable task calendar write-back in Settings AND the tasks pane (confirm they mirror), click Push to Outlook, verify events appear only for unfinished tasks with due dates; finish a task + push again → its event is deleted; toggle auto on, edit a due date → event updates after ~4s; confirm popout shows no toggle/button.
- [ ] **Step 6:** Confirm no unintended fixture/codec drift beyond Task's new column (`git diff --stat main..HEAD`).
