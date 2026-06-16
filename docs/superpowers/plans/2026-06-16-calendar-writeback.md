# M365 Calendar Write-Back (Milestones → Outlook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manual "Push to Outlook" action that reconciles the current project's milestones into the user's Outlook calendar as all-day events (create/update/delete), one-way (app = source of truth).

**Architecture:** Pure `calendar-reconcile.ts` (create/update/delete plan) → token-pure `outlook-calendar-write.ts` Graph client (`Calendars.ReadWrite`, category-tagged all-day events) → `use-outlook-calendar-push.ts` hook (acquireToken → list → plan → execute → write event-ids back) → `Milestone.outlookEventId` (six write paths) → Milestones-view button + M365 settings toggle.

**Tech Stack:** TypeScript, React 19, Next.js (forked), Vitest + Testing Library, Microsoft Graph (`/me/events`), MSAL via `useMsAuth().acquireToken`.

**Spec:** `docs/superpowers/specs/2026-06-16-calendar-writeback-design.md` (committed `62c7249`).

**Branch:** `feat-calendar-writeback` (already checked out).

---

## File Structure

- **Create** `src/app/calendar-reconcile.ts` (+ `.test.ts`) — pure `planCalendarReconcile`.
- **Create** `src/app/outlook-calendar-write.ts` (+ `.test.ts`) — token-pure Graph client.
- **Create** `src/app/use-outlook-calendar-push.ts` (+ `.test.tsx`) — orchestration hook.
- **Modify** `src/app/types.ts` — `Milestone.outlookEventId?`.
- **Modify** `src/app/csv-codecs.ts` — add to `MILESTONES_CSV_COLUMNS` + `buildMilestoneFromObj` (covers CSV + Turso single + tenant).
- **Modify** `src/app/markdown-codecs.ts` — add the milestone column + parse map.
- **Modify** `src/app/sanitize.ts` — coerce `outlookEventId`.
- **Regenerate** `src/app/__fixtures__/golden-*` (new column = legit format change) + **update** curated `sample-workspace.md` / `.csv` milestone tables (append the empty column).
- **Modify** `src/app/settings-types.ts` — `M365IntegrationsSettings.outlookCalendarPush` + default + `sanitizeIntegrations`.
- **Modify** `src/app/settings-sections/integrations-section.tsx` — the toggle.
- **Modify** `src/app/milestones-panel.tsx` — the "Push to Outlook" button.
- **Modify** `src/app/task-manager.tsx` (+ the props chain to milestones-panel) — instantiate the hook, thread the button handler + gating.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- **Modify** `src/app/version.ts` + `CHANGELOG.md` + README/codemaps/runbook.

**Engineer context (read once):**
- `Lang = "en-US" | "en-GB" | "de"` (never `"en"`). `t(lang, key, ...params)` → 0-based `{0}`.
- `i18n.de.ts` is CRLF; the Edit tool corrupts umlauts there → node UTF-8 write, match `\r\n`.
- CI `--max-warnings=0`: unused import/var/param = FATAL. `Date.now()`/`new Date()` banned in `useMemo` AND component render bodies (react-hooks purity) → lazy `useState(() => Date.now())` or in effects/callbacks. `react-hooks/exhaustive-deps` rejects an `obj.member` dep → hoist to a const.
- **Graph host `graph.microsoft.com` is already in `src/proxy.ts` connect-src — NO CSP edit.**
- Graph-client precedent: `graph-mail.ts` (`GRAPH` base, scope consts, `GraphMailError`, `graphPost`). Token via `useMsAuth().acquireToken(scopes, { interactive: true })` (silent→popup incremental consent; returns `string | null`, may throw on denial).
- Serialization is column-driven: `MILESTONES_CSV_COLUMNS` (csv-codecs.ts:172) feeds CSV AND the Turso DDL/insert (turso-schema.ts:64,73-77). `milestoneFieldToString` handles generic fields via `String(m[c] ?? "")` — a plain string field needs NO special case there. `achievedDate` is the precedent optional string field.
- **golden-workspace byte-stability:** adding a milestone column changes every serialized milestone row — a *legitimate format change*, so regenerate `__fixtures__/golden-*` (do NOT mask). The curated `sample-workspace.md`/`.csv` are hand-authored source — append the new column (empty) to their milestone tables too (the markdown parser fills every row).

---

## Task 1: Pure `calendar-reconcile.ts`

**Files:** Create `src/app/calendar-reconcile.ts`, `src/app/calendar-reconcile.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/calendar-reconcile.test.ts
import { describe, it, expect } from "vitest";
import { planCalendarReconcile, type ExistingEvent } from "./calendar-reconcile";
import type { Milestone } from "./types";

function ms(id: number, over: Partial<Milestone> = {}): Milestone {
  return { id, name: `M${id}`, date: "2026-07-01", linkedTaskIds: [], ...over };
}
const ev = (id: string): ExistingEvent => ({ id });

describe("planCalendarReconcile", () => {
  it("creates a milestone with no outlookEventId", () => {
    const p = planCalendarReconcile([ms(1)], []);
    expect(p.create.map((m) => m.id)).toEqual([1]);
    expect(p.update).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("updates a milestone whose stored id exists in Outlook", () => {
    const p = planCalendarReconcile([ms(1, { outlookEventId: "e1" })], [ev("e1")]);
    expect(p.update).toEqual([{ milestone: ms(1, { outlookEventId: "e1" }), eventId: "e1" }]);
    expect(p.create).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("re-creates when the stored id is gone from Outlook (user deleted the event)", () => {
    const p = planCalendarReconcile([ms(1, { outlookEventId: "stale" })], []);
    expect(p.create.map((m) => m.id)).toEqual([1]);
    expect(p.delete).toEqual([]); // "stale" wasn't in existing, so nothing to delete
  });
  it("deletes an orphaned tagged event with no matching milestone", () => {
    const p = planCalendarReconcile([ms(1, { outlookEventId: "e1" })], [ev("e1"), ev("orphan")]);
    expect(p.update.map((u) => u.eventId)).toEqual(["e1"]);
    expect(p.delete).toEqual(["orphan"]);
  });
  it("empty milestones + existing events => delete all", () => {
    expect(planCalendarReconcile([], [ev("a"), ev("b")]).delete.sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm run test:run -- src/app/calendar-reconcile.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/app/calendar-reconcile.ts — pure milestone↔calendar reconcile (no Graph, no i18n).
import type { Milestone } from "./types";

export interface ExistingEvent { id: string; }

export interface ReconcilePlan {
  create: Milestone[];
  update: { milestone: Milestone; eventId: string }[];
  delete: string[];
}

export function planCalendarReconcile(
  milestones: readonly Milestone[],
  existing: readonly ExistingEvent[],
): ReconcilePlan {
  const existingIds = new Set(existing.map((e) => e.id));
  const keptIds = new Set<string>();
  const create: Milestone[] = [];
  const update: { milestone: Milestone; eventId: string }[] = [];
  for (const m of milestones) {
    if (m.outlookEventId && existingIds.has(m.outlookEventId)) {
      update.push({ milestone: m, eventId: m.outlookEventId });
      keptIds.add(m.outlookEventId);
    } else {
      create.push(m);
    }
  }
  const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
  return { create, update, delete: del };
}
```

- [ ] **Step 4: Run to verify pass** — all PASS. (`Milestone.outlookEventId` doesn't exist yet → tsc error in the TEST on `over: { outlookEventId }`. Add the field NOW as part of this task's typecheck: do Task 2 Step 1 first, OR add `outlookEventId?: string` to `Milestone` here and let Task 2 do the serialization. Recommended: add the field to `types.ts` in this task so the pure module typechecks; Task 2 wires the six paths.)
- [ ] **Step 5: Add the field** — in `src/app/types.ts` `Milestone`, after `localModifiedAt?: string;` add:
  ```ts
  /** Outlook calendar event id for this milestone (calendar write-back link). */
  outlookEventId?: string;
  ```
- [ ] **Step 6: Lint + typecheck** — `npm run lint && npx tsc --noEmit` → clean (the field is optional; no serializer needs it yet for tsc).
- [ ] **Step 7: Commit** — `git add src/app/calendar-reconcile.ts src/app/calendar-reconcile.test.ts src/app/types.ts && git commit -m "feat: pure calendar reconcile + Milestone.outlookEventId field"`

---

## Task 2: Thread `outlookEventId` through the six write paths

**Files:** Modify `src/app/csv-codecs.ts`, `src/app/markdown-codecs.ts`, `src/app/sanitize.ts`; regenerate `src/app/__fixtures__/golden-*`; update curated `sample-workspace.md` + `sample-workspace.csv`. Test: `src/app/storage-serialization.test.ts` (or the existing milestone round-trip test).

**Context:** `outlookEventId` is a plain optional string on `Milestone` — mirror `achievedDate` everywhere. CSV + Turso (single + tenant) are driven by `MILESTONES_CSV_COLUMNS`; only the markdown codec and sanitize need separate edits.

- [ ] **Step 1: Write the failing round-trip test** — add to the milestone serialization test file (find it: `grep -rln "buildMilestoneFromObj\|milestonesToCsv\|MILESTONES_CSV_COLUMNS" src/app/*.test.ts`). Add:

```ts
import { milestonesToCsv, milestonesFromCsv } from "./csv-codecs"; // adjust to the real exported names
it("round-trips outlookEventId through CSV", () => {
  const m = { id: 1, name: "Go-Live", date: "2026-08-01", linkedTaskIds: [], outlookEventId: "AAMk-evt-1" };
  const csv = milestonesToCsv([m as never], false);
  const back = milestonesFromCsv(csv); // adjust to the real parse entry
  expect(back[0].outlookEventId).toBe("AAMk-evt-1");
});
```
(Adjust import/function names to the file's actual exports — read `csv-codecs.ts` around `milestonesToCsv`/the milestone CSV parse path.) Run → FAIL (column not present → value dropped).

- [ ] **Step 2: CSV + Turso** — in `src/app/csv-codecs.ts` add `"outlookEventId"` to `MILESTONES_CSV_COLUMNS` (line ~172, after `"documentLinks"`):
  ```ts
  "id", "name", "date", "description", "achievedDate", "linkedTaskIds", "localModifiedAt", "documentLinks", "outlookEventId",
  ```
  `milestoneFieldToString` needs NO change (generic `String(m[c] ?? "")` handles it). In `buildMilestoneFromObj` (line ~366), after the `achievedDate`/`documentLinks` handling, add:
  ```ts
  if (obj.outlookEventId) m.outlookEventId = obj.outlookEventId;
  ```
  This auto-covers the Turso single + tenant backends (their DDL/insert derive from `MILESTONES_CSV_COLUMNS` via `turso-schema.ts`).

- [ ] **Step 3: Markdown** — in `src/app/markdown-codecs.ts`, add to the milestone column list (line ~403, after `{ key: "achievedDate", label: "Achieved" }` / the document-links column):
  ```ts
  { key: "outlookEventId", label: "OutlookEventId" },
  ```
  and to the parse map (line ~431, beside the `achieveddate` branch):
  ```ts
  else if (norm === "outlookeventid") mapped["outlookEventId"] = val;
  ```

- [ ] **Step 4: sanitize** — in `src/app/sanitize.ts`, in the milestone sanitizer (line ~900, beside `achievedDate`), add:
  ```ts
  const outlookEventId = typeof o.outlookEventId === "string" ? o.outlookEventId.slice(0, 300) : "";
  if (outlookEventId) m.outlookEventId = outlookEventId;
  ```
  (This covers the JSON import boundary + IndexedDB load, which both route through sanitize.)

- [ ] **Step 5: Run the round-trip test** — PASS. Then run the FULL serialization + golden suite: `npm run test:run -- csv-codecs markdown-codecs storage-serialization golden-workspace turso-schema sanitize`. The **golden-workspace** test will FAIL (the milestone CSV/MD now has an extra column → bytes changed). This is the EXPECTED legit format change.

- [ ] **Step 6: Regenerate golden fixtures** — regenerate from the unchanged `sample-workspace.json`: `npx vite-node scripts/generate-sample-workspace.ts` (or the repo's golden-fixture regen — check `package.json`/`golden-workspace.test` for the exact command; the AGENTS rule: regenerate `__fixtures__` only when the format legitimately changed, which it did). Re-run `npm run test:run -- golden-workspace` → PASS. Confirm `git diff --stat src/app/__fixtures__` shows ONLY the new `OutlookEventId`/`outlookEventId` empty column added to milestone rows (no other byte drift).

- [ ] **Step 7: Update curated sample files** — the hand-authored `sample-workspace.md` and `sample-workspace.csv` (repo root) milestone tables now lack the new column. Append the `OutlookEventId` header + an empty cell to every milestone row in both (so a round-trip stays byte-identical — the markdown parser fills every row). Verify: `npm run test:run -- sample` (or the test that loads the curated samples) → PASS. (Do NOT re-emit `sample-workspace.md` via a serializer — it's curated; hand-edit the column in.)

- [ ] **Step 8: Lint + typecheck** — clean.
- [ ] **Step 9: Commit** — `git add src/app/csv-codecs.ts src/app/markdown-codecs.ts src/app/sanitize.ts src/app/__fixtures__ sample-workspace.md sample-workspace.csv src/app/*serial*.test.ts && git commit -m "feat: persist Milestone.outlookEventId across all six backends"`

---

## Task 3: Graph client `outlook-calendar-write.ts`

**Files:** Create `src/app/outlook-calendar-write.ts`, `src/app/outlook-calendar-write.test.ts`.

**Context:** Token-pure Graph client mirroring `graph-mail.ts`. Read `graph-mail.ts` first for the exact `graphPost`/error shape.

- [ ] **Step 1: Write the failing mapping test**

```ts
// src/app/outlook-calendar-write.test.ts
import { describe, it, expect } from "vitest";
import { milestoneToGraphEvent, categoryFor } from "./outlook-calendar-write";
import type { Milestone } from "./types";

describe("milestoneToGraphEvent", () => {
  it("builds an all-day event with end = date + 1 day, category, subject", () => {
    const m: Milestone = { id: 1, name: "Go-Live", date: "2026-08-01", linkedTaskIds: [] };
    const e = milestoneToGraphEvent(m, "proj-42");
    expect(e.subject).toBe("Go-Live");
    expect(e.isAllDay).toBe(true);
    expect(e.start).toEqual({ dateTime: "2026-08-01T00:00:00", timeZone: "UTC" });
    expect(e.end).toEqual({ dateTime: "2026-08-02T00:00:00", timeZone: "UTC" });
    expect(e.categories).toEqual(["AIPM:proj-42"]);
  });
  it("categoryFor prefixes the project id", () => {
    expect(categoryFor("p1")).toBe("AIPM:p1");
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/app/outlook-calendar-write.ts — Microsoft Graph calendar write (events). Pure
// given an access token: no MSAL, no React. graph.microsoft.com is already CSP-allowlisted.
import type { Milestone } from "./types";
import type { ExistingEvent } from "./calendar-reconcile";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_PAGES = 100;

export const CALENDAR_READWRITE_SCOPE = ["Calendars.ReadWrite"] as const;

export const categoryFor = (projectId: string): string => `AIPM:${projectId}`;

export interface GraphEvent {
  subject: string;
  isAllDay: true;
  start: { dateTime: string; timeZone: "UTC" };
  end: { dateTime: string; timeZone: "UTC" };
  categories: string[];
  body: { contentType: "Text"; content: string };
}

export class GraphCalendarError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GraphCalendarError";
  }
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function milestoneToGraphEvent(m: Milestone, projectId: string): GraphEvent {
  return {
    subject: m.name,
    isAllDay: true,
    start: { dateTime: `${m.date}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(m.date)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId)],
    body: { contentType: "Text", content: "Managed by the AIPM PM Tracker." },
  };
}

async function graph(token: string, method: string, path: string, payload?: unknown): Promise<Response> {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 404) throw new GraphCalendarError(res.status, `Graph ${method} ${path} failed (${res.status})`);
  return res;
}

/** All project-tagged events (id only), paginated. */
export async function listProjectEvents(token: string, projectId: string): Promise<ExistingEvent[]> {
  const cat = categoryFor(projectId).replace(/'/g, "''"); // OData single-quote escape
  let url: string | null = `${GRAPH}/me/events?$filter=${encodeURIComponent(`categories/any(c:c eq '${cat}')`)}&$select=id&$top=100`;
  const out: ExistingEvent[] = [];
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new GraphCalendarError(res.status, `Graph list events failed (${res.status})`);
    const json: { value?: { id: string }[]; "@odata.nextLink"?: string } = await res.json();
    for (const e of json.value ?? []) out.push({ id: e.id });
    url = json["@odata.nextLink"] ?? null;
  }
  return out;
}

export async function createEvent(token: string, event: GraphEvent): Promise<string> {
  const res = await graph(token, "POST", "/me/events", event);
  const json: { id: string } = await res.json();
  return json.id;
}

export async function updateEvent(token: string, eventId: string, event: GraphEvent): Promise<void> {
  await graph(token, "PATCH", `/me/events/${eventId}`, event);
}

export async function deleteEvent(token: string, eventId: string): Promise<void> {
  await graph(token, "DELETE", `/me/events/${eventId}`); // 404 treated as success (already gone)
}
```

NOTE: `new Date()` here is given an argument (`new Date(\`${isoDate}T00:00:00Z\`)`) — that is allowed (the lint ban is on the *argless* `new Date()` / `Date.now()` in render/useMemo; this is a pure module, not a component). Confirm lint passes.

- [ ] **Step 3: Run** → mapping test PASS. Add a `listProjectEvents` URL test if easy (mock `fetch`, assert the `$filter` contains `categories/any`).
- [ ] **Step 4: Lint + typecheck** — clean.
- [ ] **Step 5: Commit** — `git add src/app/outlook-calendar-write.ts src/app/outlook-calendar-write.test.ts && git commit -m "feat: Outlook calendar Graph write client (events)"`

---

## Task 4: M365 settings — `outlookCalendarPush`

**Files:** Modify `src/app/settings-types.ts` (`M365IntegrationsSettings` + default + `sanitizeIntegrations`). Test: `settings`-related test (find the `sanitizeIntegrations` test).

- [ ] **Step 1: Failing test** — add to the integrations-sanitize test (grep `sanitizeIntegrations` in `*.test.ts`):
```ts
it("defaults outlookCalendarPush to false and coerces it", () => {
  expect(sanitizeIntegrations({ m365: {} }).m365!.outlookCalendarPush).toBe(false);
  expect(sanitizeIntegrations({ m365: { outlookCalendarPush: true } }).m365!.outlookCalendarPush).toBe(true);
});
```
Run → FAIL (property missing on the type).

- [ ] **Step 2: Implement** — in `settings-types.ts`:
  - `M365IntegrationsSettings` (line ~134): add `outlookCalendarPush: boolean;` after `outlookCalendar`.
  - `defaultM365Integrations` (line ~154): add `outlookCalendarPush: false,`.
  - `sanitizeIntegrations` (line ~177): add `outlookCalendarPush: typeof m365Raw?.outlookCalendarPush === "boolean" ? m365Raw.outlookCalendarPush : false,`.

- [ ] **Step 3: Run** test → PASS. `npx tsc --noEmit` → clean (if any test builds a full `M365IntegrationsSettings` literal, add `outlookCalendarPush: false` — required field).
- [ ] **Step 4: Lint** — clean.
- [ ] **Step 5: Commit** — `git add src/app/settings-types.ts src/app/*.test.ts && git commit -m "feat: outlookCalendarPush M365 setting (default off)"`

---

## Task 5: `use-outlook-calendar-push.ts` hook

**Files:** Create `src/app/use-outlook-calendar-push.ts`, `src/app/use-outlook-calendar-push.test.tsx`.

**Context:** Orchestrates the push. Takes the Graph fns + `acquireToken` + `showToast` injected (so the test can mock without MSAL). The hook itself reads `useMsAuth().acquireToken` and `useToastContext()` — but to keep it testable, accept them via args OR mock the modules. Plan: the hook reads `acquireToken` from `useMsAuth()` and `showToast` from `useToastContext()` internally, and takes data via args. The test mocks `./outlook-calendar-write`, `./use-ms-auth`, `./toast-context`.

- [ ] **Step 1: Failing test**

```tsx
// src/app/use-outlook-calendar-push.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const acquireToken = vi.fn(async () => "tok");
vi.mock("./use-ms-auth", () => ({ useMsAuth: () => ({ acquireToken }) }));
const showToast = vi.fn();
vi.mock("./toast-context", () => ({ useToastContext: () => showToast }));
const listProjectEvents = vi.fn(async () => [{ id: "orphan" }]);
const createEvent = vi.fn(async () => "new-evt");
const updateEvent = vi.fn(async () => {});
const deleteEvent = vi.fn(async () => {});
vi.mock("./outlook-calendar-write", () => ({
  CALENDAR_READWRITE_SCOPE: ["Calendars.ReadWrite"],
  milestoneToGraphEvent: (m: { id: number }) => ({ subject: `M${m.id}` }),
  listProjectEvents: (...a: unknown[]) => listProjectEvents(...a),
  createEvent: (...a: unknown[]) => createEvent(...a),
  updateEvent: (...a: unknown[]) => updateEvent(...a),
  deleteEvent: (...a: unknown[]) => deleteEvent(...a),
}));

import { useOutlookCalendarPush } from "./use-outlook-calendar-push";
import type { Milestone } from "./types";

const ms = (id: number, over: Partial<Milestone> = {}): Milestone => ({ id, name: `M${id}`, date: "2026-07-01", linkedTaskIds: [], ...over });

beforeEach(() => vi.clearAllMocks());

describe("useOutlookCalendarPush", () => {
  it("creates new, deletes orphans, and writes the new event id back", async () => {
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1)], projectId: "p", setMilestones, isPopout: false, lang: "en-US" }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(deleteEvent).toHaveBeenCalledWith("tok", "orphan");
    const updater = setMilestones.mock.calls.at(-1)![0];
    const next = typeof updater === "function" ? updater([ms(1)]) : updater;
    expect(next[0].outlookEventId).toBe("new-evt");
    expect(showToast).toHaveBeenCalled();
  });
  it("toasts and does nothing when no token", async () => {
    acquireToken.mockResolvedValueOnce(null);
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1)], projectId: "p", setMilestones, isPopout: false, lang: "en-US" }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(createEvent).not.toHaveBeenCalled();
    expect(setMilestones).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
  it("no-ops in a popout", async () => {
    const setMilestones = vi.fn();
    const { result } = renderHook(() =>
      useOutlookCalendarPush({ milestones: [ms(1)], projectId: "p", setMilestones, isPopout: true, lang: "en-US" }));
    await act(async () => { await result.current.pushToOutlook(); });
    expect(acquireToken).not.toHaveBeenCalled();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/app/use-outlook-calendar-push.ts
"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { planCalendarReconcile } from "./calendar-reconcile";
import {
  CALENDAR_READWRITE_SCOPE, milestoneToGraphEvent, listProjectEvents, createEvent, updateEvent, deleteEvent,
} from "./outlook-calendar-write";
import type { Milestone } from "./types";

interface Args {
  milestones: readonly Milestone[];
  projectId: string;
  setMilestones: (updater: (prev: Milestone[]) => Milestone[]) => void;
  isPopout: boolean;
  lang: Lang;
}

export function useOutlookCalendarPush({ milestones, projectId, setMilestones, isPopout, lang }: Args) {
  const { acquireToken } = useMsAuth();
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);

  const pushToOutlook = useCallback(async () => {
    if (isPopout) return;
    setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
      if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
      const existing = await listProjectEvents(token, projectId);
      const plan = planCalendarReconcile(milestones, existing);
      const newIds = new Map<number, string>();
      let failed = 0;
      for (const m of plan.create) {
        try { newIds.set(m.id, await createEvent(token, milestoneToGraphEvent(m, projectId))); }
        catch { failed++; }
      }
      for (const u of plan.update) {
        try { await updateEvent(token, u.eventId, milestoneToGraphEvent(u.milestone, projectId)); }
        catch { failed++; }
      }
      for (const id of plan.delete) {
        try { await deleteEvent(token, id); } catch { failed++; }
      }
      if (newIds.size > 0) {
        setMilestones((prev) => prev.map((m) => (newIds.has(m.id) ? { ...m, outlookEventId: newIds.get(m.id) } : m)));
      }
      showToast("info", t(lang, "calendarPushResult", plan.create.length, plan.update.length, plan.delete.length));
      if (failed > 0) showToast("error", t(lang, "calendarPushPartial", failed));
    } catch {
      showToast("error", t(lang, "calendarPushNoAccess"));
    } finally {
      setBusy(false);
    }
  }, [isPopout, acquireToken, showToast, lang, milestones, projectId, setMilestones]);

  return { pushToOutlook, busy };
}
```

- [ ] **Step 3: Run** → PASS. (i18n keys `calendarPushNoAccess`/`calendarPushResult`/`calendarPushPartial` are added in Task 7; if this runs before Task 7, `t()` returns the key string — the tests assert `expect.any(String)` / `toHaveBeenCalled`, so they pass regardless. The tsc check needs the keys to be valid `TranslationKey`s → **do Task 7 before Step 4's tsc**, or the 3 keys won't typecheck.)
- [ ] **Step 4: Lint + typecheck** — clean (after Task 7's keys exist). If tsc fails ONLY on the 3 calendar i18n keys, do Task 7 first.
- [ ] **Step 5: Commit** — `git add src/app/use-outlook-calendar-push.ts src/app/use-outlook-calendar-push.test.tsx && git commit -m "feat: useOutlookCalendarPush orchestration hook"`

---

## Task 6: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts` (CRLF, node write).

- [ ] **Step 1: EN keys** — add to `i18n.ts`:
```
calendarPush: "Push to Outlook",
calendarPushing: "Pushing…",
calendarPushResult: "Outlook calendar updated: {0} created, {1} updated, {2} removed.",
calendarPushPartial: "{0} event(s) could not be synced.",
calendarPushNoAccess: "Outlook calendar access was not granted.",
settingsOutlookCalendarPush: "Push milestones to my Outlook calendar",
settingsOutlookCalendarPushHint: "Adds a \"Push to Outlook\" button to the Milestones view. One-way: your milestones become all-day events; the app never reads your calendar changes back.",
versionHighlightCalendarPush: "Push project milestones into your Outlook calendar as all-day events.",
```

- [ ] **Step 2: DE keys** — via a temporary node UTF-8 CRLF script (Edit corrupts umlauts; file is CRLF), insert after an existing DE anchor (e.g. `versionHighlightLearning:`). German (real umlauts):
```
calendarPush: "An Outlook senden"
calendarPushing: "Wird gesendet…"
calendarPushResult: "Outlook-Kalender aktualisiert: {0} erstellt, {1} aktualisiert, {2} entfernt."
calendarPushPartial: "{0} Termin(e) konnten nicht synchronisiert werden."
calendarPushNoAccess: "Zugriff auf den Outlook-Kalender wurde nicht erteilt."
settingsOutlookCalendarPush: "Meilensteine in meinen Outlook-Kalender übertragen"
settingsOutlookCalendarPushHint: "Fügt der Meilenstein-Ansicht eine Schaltfläche „An Outlook senden" hinzu. Einseitig: Ihre Meilensteine werden zu ganztägigen Terminen; die App liest Ihre Kalenderänderungen nie zurück."
versionHighlightCalendarPush: "Projekt-Meilensteine als ganztägige Termine in Ihren Outlook-Kalender übertragen."
```
Delete the temp script after running.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (EN/DE parity) + `npm run test:run -- i18n-encoding` (real umlauts) → green. Visually confirm umlauts (übertragen, ganztägigen, Kalenderänderungen, konnten).
- [ ] **Step 4: Commit** — `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: i18n keys for calendar write-back (EN/DE)"`

---

## Task 7: Settings UI toggle

**Files:** Modify `src/app/settings-sections/integrations-section.tsx`.

- [ ] **Step 1: Failing test** — add to `integrations-section.test.tsx` (or create a focused test): with M365 enabled, the checkbox labeled `settingsOutlookCalendarPush` toggles `outlookCalendarPush`. (Mirror an existing M365 checkbox test in that file; if none, assert `getByLabelText(/Push milestones to my Outlook calendar/i)` toggles the integrations change handler.) Run → FAIL.

- [ ] **Step 2: Implement** — in `integrations-section.tsx`, in the M365 block (near the `outlookCalendar` checkbox), add a labeled checkbox bound to `integrations.m365.outlookCalendarPush`, calling the existing M365 patch handler with `{ ...m365, outlookCalendarPush: e.target.checked }`. Render it only when M365 is enabled (mirror the `outlookCalendar` checkbox's gating). Wrap input+text in a `<label>` (axe); add an `InfoTooltip` with `settingsOutlookCalendarPushHint`. Palette tokens only.

- [ ] **Step 3: Run** test → PASS. Lint + tsc → clean.
- [ ] **Step 4: Commit** — `git add src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx && git commit -m "feat: settings toggle for Outlook calendar push"`

---

## Task 8: Milestones-view button + wiring

**Files:** Modify `src/app/milestones-panel.tsx` (+ its props), `src/app/task-manager.tsx` (instantiate the hook + thread the handler/gating + projectId).

**Context:** `task-manager.tsx` owns `milestones`/`setMilestones`, `settings`, `isPopout`, `lang`. It must instantiate `useOutlookCalendarPush` and pass `onPushToOutlook` + a `canPushToOutlook` gate down to `milestones-panel`. The **`projectId`** = the current project's stable id used for Turso multi-tenancy / the registry — grep how the active project id is sourced (e.g. the value passed as `project_id` to the tenant backend, or the registry's active id; check `use-storage-backend.ts`/the multi-project registry). Use it; fall back to `ProjectMeta.code` then `"default"` if absent (the category just needs stability).

- [ ] **Step 1: Failing test** — add to `milestones-panel.test.tsx`: when `onPushToOutlook` is provided (and `canPush` true), a button labeled `calendarPush` renders and clicking it calls the handler. When `canPush` is false/handler absent, no button. Run → FAIL.

- [ ] **Step 2: Implement the button** — in `milestones-panel.tsx`, add optional props `onPushToOutlook?: () => void; calendarPushBusy?: boolean;`. When `onPushToOutlook` is set, render a button in the panel header: `t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")`, `disabled={calendarPushBusy}`, `onClick={onPushToOutlook}`. Labeled; palette tokens; spinner pattern like the Jira Sync button if present.

- [ ] **Step 3: Wire in task-manager** — instantiate the hook + resolve the gate + projectId:
```ts
import { useOutlookCalendarPush } from "./use-outlook-calendar-push";
// ... inside the component, where milestones/settings/isPopout/lang are in scope:
const calendarPushEnabled =
  !isPopout &&
  (settings.integrations?.m365?.enabled ?? false) &&
  (settings.integrations?.m365?.outlookCalendarPush ?? false);
const projectId = /* the stable active-project id resolved per Step-1 grep */;
const calendarPush = useOutlookCalendarPush({ milestones, projectId, setMilestones, isPopout, lang });
```
Pass into the milestones-panel render: `onPushToOutlook={calendarPushEnabled ? calendarPush.pushToOutlook : undefined}` and `calendarPushBusy={calendarPush.busy}`. Thread through any intermediate component (workspace-section/the milestones view host) following the existing prop path.

- [ ] **Step 4: Run** — `npm run test:run -- milestones-panel` → PASS. Then `npm run test:run` (full) → green. Patch any test that builds a `Settings`/integrations literal missing `outlookCalendarPush` (required field) — add `outlookCalendarPush: false`.
- [ ] **Step 5: Lint + typecheck** — clean (`useCallback`/imports; resolve any exhaustive-deps via a hoisted const).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: Push-to-Outlook button on the Milestones view + wiring"`

---

## Task 9: Release + docs

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*`, `docs/RUNBOOK.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION="0.96.0"`; `APP_BUILD_DATE="2026-06-16"` (comment `// 0.96.0 calendar write-back`); `APP_MILESTONE` = next unused sci-fi/fantasy author surname (controller picks, e.g. "Butler" taken — use e.g. "Okorafor" taken; pick a fresh one and update the codename doc-comment); append `"versionHighlightCalendarPush"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 2: CHANGELOG** — prepend:
```markdown
## [0.96.0] - 2026-06-16 "<codename>"

### Added
- **Outlook calendar write-back** — a "Push to Outlook" button on the Milestones view reconciles the
  current project's milestones into your Outlook calendar as all-day events (create / update / remove),
  tagged so a re-push stays idempotent. One-way (the app owns milestone dates); opt-in under
  Settings → Integrations → Microsoft 365. Requires M365 sign-in + Calendars.ReadWrite consent.
```
- [ ] **Step 3: README** — extend the Microsoft 365 integration table (the `### Microsoft 365` section) with a "Outlook calendar write-back" row: `Calendars.ReadWrite` | "Pushes project milestones into your Outlook calendar as all-day events (one-way, opt-in, manual button)". Keep existing rows intact.
- [ ] **Step 4: Codemaps + RUNBOOK** — `docs/CODEMAPS/frontend.md`: add `outlook-calendar-write.ts`, `calendar-reconcile.ts`, `use-outlook-calendar-push.ts`, the milestones button. `docs/CODEMAPS/data.md`: note `Milestone.outlookEventId` + the `AIPM:<projectId>` event category. `docs/RUNBOOK.md`: a "calendar write-back not syncing / re-consent" entry (toggle in Settings → Integrations; re-grant `Calendars.ReadWrite`; events are tagged `AIPM:<projectId>`).
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npm run test:run -- version` → green.
- [ ] **Step 6: Commit** — `git add src/app/version.ts CHANGELOG.md README.md docs/ && git commit -m "chore: release 0.96.0 calendar write-back + docs"`

---

## Task 10: Full green gate

- [ ] **Step 1:** `npm run lint && npx tsc --noEmit && npm run test:run` → all green.
- [ ] **Step 2:** `npm run build` → success.
- [ ] **Step 3:** Confirm `src/proxy.ts` unchanged (`git diff --stat main...HEAD -- src/proxy.ts` empty — `graph.microsoft.com` was already allowlisted) and golden fixtures changed ONLY by the new milestone column (`git diff --stat src/app/__fixtures__`).

---

## Self-Review (plan author)

**Spec coverage:** pure reconcile (Task 1) ✓; `outlookEventId` six paths + golden/sample regen (Task 2) ✓; Graph client all-day/category/list/create/update/delete (Task 3) ✓; settings `outlookCalendarPush` off-default (Task 4) ✓; orchestration hook with token-gate/partial-errors/write-back/popout (Task 5) ✓; i18n (Task 6) ✓; settings UI (Task 7) ✓; button + wiring + projectId (Task 8) ✓; release + README M365 row + codemaps/runbook (Task 9) ✓; no CSP host, one-way, category reconcile incl. orphan-delete all covered; gate (Task 10) ✓.

**Placeholder scan:** `<codename>` (Task 9) chosen at execution; the `projectId` source + the exact CSV/MD codec function names + the golden-regen command are flagged to resolve against the real files during implementation (each with a concrete grep). No vague "handle errors" — the hook's error/partial handling is spelled out.

**Type consistency:** `planCalendarReconcile(milestones, existing) → {create, update:{milestone,eventId}[], delete:string[]}`, `ExistingEvent {id}`, `GraphEvent`, `milestoneToGraphEvent(m, projectId)`, `categoryFor`, `CALENDAR_READWRITE_SCOPE`, `useOutlookCalendarPush({milestones, projectId, setMilestones, isPopout, lang}) → {pushToOutlook, busy}`, `Milestone.outlookEventId`, `M365IntegrationsSettings.outlookCalendarPush`, i18n keys `calendarPush*`/`settingsOutlookCalendarPush*`/`versionHighlightCalendarPush` — consistent across tasks.

**Ordering caveat:** Task 6 (i18n) must precede Task 5's tsc step and Tasks 7-8 (they assert/typecheck the keys). Recommended execution order: 1, 2, 3, 4, **6**, 5, 7, 8, 9, 10.
