# Outlook Calendar Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in Microsoft 365 user import time-away events from their own Outlook calendar (Graph `/me/calendarView`) into lop-app as `Absence` records, via a preview-and-pick dialog with a per-row absence-type selector.

**Architecture:** A pure core (`outlook-calendar.ts`) filters/maps Graph events and merges them into absences; a hook (`use-outlook-calendar.ts`) does the paged fetch; a presentational modal (`outlook-calendar-import-modal.tsx`) drives selection + per-row type; `task-manager.tsx` coordinates and a Calendar-tab button triggers it. Reuses M1's `useMsAuth` and the 0.23.1 interactive-consent `acquireToken`. Mirrors the M3 (Outlook contacts) structure.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / Vitest. `@azure/msal-browser` (existing). Microsoft Graph `GET /me/calendarView` (`Calendars.Read`).

**Spec:** `docs/superpowers/specs/2026-05-29-outlook-calendar-import-design.md`

**Branch:** `feat/0.24.0-outlook-calendar` (already created and checked out).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/outlook-calendar.ts` | Pure core: time-away filter, Graph→app event mapping, event→absence merge, dedupe key | Create |
| `src/app/outlook-calendar.test.ts` | Unit tests for the core | Create |
| `src/app/use-outlook-calendar.ts` | Hook: token + paged `/me/calendarView` fetch + typed errors | Create |
| `src/app/use-outlook-calendar.test.tsx` | Unit tests for the hook | Create |
| `src/app/outlook-calendar-import-modal.tsx` | Preview dialog with per-row absence-type select | Create |
| `src/app/outlook-calendar-import-modal.test.tsx` | Unit tests for the modal | Create |
| `src/app/use-resource-planner.ts` | Add `handleImportAbsences` (batch merge into absences) | Modify |
| `src/app/task-manager.tsx` | Wire auth + hook + state + handlers + modal + button gating | Modify |
| `src/app/resources-panel.tsx` | Calendar-tab "Import from Outlook" button | Modify |
| `src/app/settings-menu.tsx` | Flip Outlook calendar sub-toggle interactive | Modify |
| `src/app/settings-menu.test.tsx` | Update calendar sub-toggle tests | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys (EN + DE) | Modify |
| `src/app/version.ts` | Bump to 0.24.0 + highlight key | Modify |
| `CHANGELOG.md` | 0.24.0 entry | Modify |

**Reference facts (verified — do not re-derive):**
- `Absence` (`types.ts:195`): `{ id:number; assignee:string; assigneeEmail?:string; startDate:string; endDate:string; type:AbsenceType; note?:string; localModifiedAt?:string; resourceId?:number }`. Dates `"YYYY-MM-DD"` inclusive.
- `AbsenceType` (`types.ts:187`): `"vacation" | "sick" | "training" | "other"`; `ABSENCE_TYPES` array exported from `types.ts`.
- Absence id scheme (`use-resource-planner.ts:172`): `absences.length > 0 ? Math.max(...absences.map(a => a.id)) + 1 : 1`.
- `isoAddDays(iso: string, delta: number): string` — exported from `due-dates.ts` (re-export at line 126). Input `"YYYY-MM-DD"` → `"YYYY-MM-DD"`.
- `resourceDisplayName(r): string` — from `resource-foundation.ts`.
- `useMsAuth(enabled)` → `{ account, acquireToken, ... }`; `acquireToken(scopes, { interactive?: boolean })` (0.23.1). `account.username` = UPN/email, `account.name` = display name.
- `showToast(kind: "info" | "error", text: string)` — available in `task-manager.tsx`.
- `<Modal>` (`modal.tsx`): `open`, `onClose`, `ariaLabel`, `align?`, `zIndex?`, `children`.
- `t(lang, key, ...args)` — positional `{0}` substitution.
- Resources panel toolbar: the header (`resources-panel.tsx` ~line 290–306) holds Manage Roles / Open Report / Add Absence; `view` (`"directory"|"workload"|"calendar"|"planning"`) is in scope there. The Calendar tab renders `<ResourceCalendar>` at ~line 595.

---

## Task 1: Pure core — `outlook-calendar.ts`

**Files:**
- Create: `src/app/outlook-calendar.ts`
- Test: `src/app/outlook-calendar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/outlook-calendar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isTimeAway,
  mapGraphEvent,
  eventsToAbsences,
  dedupeKey,
  type GraphEvent,
  type OutlookEvent,
} from "./outlook-calendar";
import type { Absence } from "./types";

const allDay: GraphEvent = {
  id: "e1",
  subject: "Vacation",
  start: { dateTime: "2026-06-01T00:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-04T00:00:00.0000000", timeZone: "UTC" },
  isAllDay: true,
  showAs: "oof",
};
const oofTimed: GraphEvent = {
  id: "e2",
  subject: "Doctor",
  start: { dateTime: "2026-06-10T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-10T12:00:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  showAs: "oof",
};
const busyMeeting: GraphEvent = {
  id: "e3",
  subject: "Standup",
  start: { dateTime: "2026-06-10T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-10T09:30:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  showAs: "busy",
};

describe("isTimeAway", () => {
  it("accepts all-day and oof, rejects busy/free", () => {
    expect(isTimeAway(allDay)).toBe(true);
    expect(isTimeAway(oofTimed)).toBe(true);
    expect(isTimeAway(busyMeeting)).toBe(false);
    expect(isTimeAway({ isAllDay: false, showAs: "free" })).toBe(false);
  });
});

describe("mapGraphEvent", () => {
  it("maps an all-day event with exclusive-end correction", () => {
    expect(mapGraphEvent(allDay, 0)).toEqual<OutlookEvent>({
      sourceId: "e1",
      subject: "Vacation",
      startDate: "2026-06-01",
      endDate: "2026-06-03", // Graph end 06-04 is exclusive → inclusive 06-03
      isAllDay: true,
      showAs: "oof",
    });
  });
  it("maps an oof timed event to a single day", () => {
    const m = mapGraphEvent(oofTimed, 1)!;
    expect(m.startDate).toBe("2026-06-10");
    expect(m.endDate).toBe("2026-06-10");
    expect(m.isAllDay).toBe(false);
  });
  it("drops non-time-away events", () => {
    expect(mapGraphEvent(busyMeeting, 2)).toBeNull();
  });
  it("drops events with no start", () => {
    expect(mapGraphEvent({ isAllDay: true }, 3)).toBeNull();
  });
  it("falls back sourceId and blank subject", () => {
    const m = mapGraphEvent(
      { start: { dateTime: "2026-07-01T00:00:00" }, end: { dateTime: "2026-07-02T00:00:00" }, isAllDay: true },
      7,
    )!;
    expect(m.sourceId).toBe("event-7");
    expect(m.subject).toBe("");
  });
});

describe("dedupeKey", () => {
  it("normalizes assignee case", () => {
    expect(dedupeKey("Alex Doe", "2026-06-01", "2026-06-03")).toBe(
      dedupeKey("alex doe", "2026-06-01", "2026-06-03"),
    );
  });
});

describe("eventsToAbsences", () => {
  const ev: OutlookEvent = {
    sourceId: "e1", subject: "Vacation", startDate: "2026-06-01", endDate: "2026-06-03",
    isAllDay: true, showAs: "oof",
  };
  const target = { assignee: "Alex Doe", assigneeEmail: "alex@x.com", resourceId: 3 };
  const STAMP = "2026-05-29T10:00:00.000Z";

  it("creates a typed absence carrying target + subject note", () => {
    const out = eventsToAbsences([{ event: ev, type: "vacation" }], [], target, STAMP);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 1,
      assignee: "Alex Doe",
      assigneeEmail: "alex@x.com",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      type: "vacation",
      note: "Vacation",
      resourceId: 3,
      localModifiedAt: STAMP,
    });
  });
  it("assigns ids from max(existing)+1 incrementing", () => {
    const existing: Absence[] = [{ id: 9, assignee: "X", startDate: "2026-01-01", endDate: "2026-01-01", type: "other" }];
    const out = eventsToAbsences(
      [
        { event: { ...ev, sourceId: "a" }, type: "vacation" },
        { event: { ...ev, sourceId: "b", startDate: "2026-08-01", endDate: "2026-08-02" }, type: "sick" },
      ],
      existing,
      target,
      STAMP,
    );
    expect(out.map((a) => a.id)).toEqual([9, 10, 11]);
    expect(out[2].type).toBe("sick");
  });
  it("dedups against an existing absence with same assignee+dates", () => {
    const existing: Absence[] = [
      { id: 1, assignee: "alex doe", startDate: "2026-06-01", endDate: "2026-06-03", type: "vacation" },
    ];
    const out = eventsToAbsences([{ event: ev, type: "vacation" }], existing, target, STAMP);
    expect(out).toHaveLength(1); // unchanged — duplicate skipped
  });
  it("omits note when subject is blank", () => {
    const out = eventsToAbsences([{ event: { ...ev, subject: "" }, type: "other" }], [], target, STAMP);
    expect(out[0].note).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/outlook-calendar.test.ts`
Expected: FAIL — "Cannot find module './outlook-calendar'".

- [ ] **Step 3: Write the implementation**

Create `src/app/outlook-calendar.ts`:

```ts
// src/app/outlook-calendar.ts
//
// Pure core for the Outlook calendar import (M4). No React, no window, no
// fetch — the Graph token + I/O live in use-outlook-calendar.ts. Filters
// /me/calendarView events to "time away" and merges the selected ones into
// Absence records on the resource calendar.

import type { Absence, AbsenceType } from "./types";
import { isoAddDays } from "./due-dates";

/** Raw Graph /me/calendarView item (subset we $select). */
export interface GraphEvent {
  id?: string;
  subject?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  isAllDay?: boolean | null;
  showAs?: string | null;
}

/** Normalized event, already filtered to time-away. */
export interface OutlookEvent {
  sourceId: string;
  subject: string;
  startDate: string; // "YYYY-MM-DD" inclusive
  endDate: string;   // "YYYY-MM-DD" inclusive
  isAllDay: boolean;
  showAs: string;
}

/** Time-away = an all-day block or an explicit Out-of-Office event. */
export function isTimeAway(raw: GraphEvent): boolean {
  return raw.isAllDay === true || raw.showAs === "oof";
}

function dateSlice(dt?: string | null): string | null {
  if (typeof dt !== "string") return null;
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function mapGraphEvent(raw: GraphEvent, index: number): OutlookEvent | null {
  if (!isTimeAway(raw)) return null;
  const startDate = dateSlice(raw.start?.dateTime);
  if (!startDate) return null;
  const isAllDay = raw.isAllDay === true;
  const endRaw = dateSlice(raw.end?.dateTime) ?? startDate;
  // Graph all-day `end` is exclusive (one-day event ends next midnight) →
  // pull it back a day to an inclusive end. Timed OOF events use the slice.
  let endDate = isAllDay ? isoAddDays(endRaw, -1) : endRaw;
  if (endDate < startDate) endDate = startDate; // defensive clamp
  return {
    sourceId: (typeof raw.id === "string" && raw.id) ? raw.id : `event-${index}`,
    subject: (raw.subject ?? "").trim(),
    startDate,
    endDate,
    isAllDay,
    showAs: typeof raw.showAs === "string" ? raw.showAs : "",
  };
}

/** Stable dedupe key: normalized assignee + date range. */
export function dedupeKey(assignee: string, startDate: string, endDate: string): string {
  return `${assignee.trim().toLowerCase()}|${startDate}|${endDate}`;
}

export interface AbsenceImportTarget {
  assignee: string;
  assigneeEmail?: string;
  resourceId?: number;
}

/**
 * Merge selected events (with their chosen types) into the absence list,
 * attributed to `target` (the signed-in user). Dedups against existing
 * absences by assignee+date-range. New ids continue from max(existing)+1.
 * Pure: the caller passes the `localModifiedAt` stamp. Immutable.
 */
export function eventsToAbsences(
  rows: readonly { event: OutlookEvent; type: AbsenceType }[],
  existing: readonly Absence[],
  target: AbsenceImportTarget,
  stamp: string,
): Absence[] {
  const seen = new Set(existing.map((a) => dedupeKey(a.assignee, a.startDate, a.endDate)));
  let nextId = existing.length > 0 ? Math.max(...existing.map((a) => a.id)) + 1 : 1;
  const created: Absence[] = [];
  for (const { event, type } of rows) {
    const key = dedupeKey(target.assignee, event.startDate, event.endDate);
    if (seen.has(key)) continue;
    seen.add(key);
    const absence: Absence = {
      id: nextId++,
      assignee: target.assignee,
      startDate: event.startDate,
      endDate: event.endDate,
      type,
      localModifiedAt: stamp,
    };
    if (target.assigneeEmail) absence.assigneeEmail = target.assigneeEmail;
    if (event.subject) absence.note = event.subject;
    if (target.resourceId !== undefined) absence.resourceId = target.resourceId;
    created.push(absence);
  }
  return [...existing, ...created];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/outlook-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/outlook-calendar.ts src/app/outlook-calendar.test.ts
git commit -m "feat(m4): Outlook calendar event mapping + absence merge core"
```

---

## Task 2: Fetch hook — `use-outlook-calendar.ts`

**Files:**
- Create: `src/app/use-outlook-calendar.ts`
- Test: `src/app/use-outlook-calendar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-outlook-calendar.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOutlookCalendar } from "./use-outlook-calendar";

const WINDOW = { startDateTime: "2026-05-01T00:00:00Z", endDateTime: "2026-11-01T00:00:00Z" };

describe("useOutlookCalendar", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  function jsonRes(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }
  const allDay = {
    id: "1", subject: "Vac",
    start: { dateTime: "2026-06-01T00:00:00" }, end: { dateTime: "2026-06-02T00:00:00" },
    isAllDay: true, showAs: "oof",
  };
  const meeting = {
    id: "2", subject: "Standup",
    start: { dateTime: "2026-06-01T09:00:00" }, end: { dateTime: "2026-06-01T09:30:00" },
    isAllDay: false, showAs: "busy",
  };

  it("fetches with the right params/headers, follows nextLink, filters time-away", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy
      .mockResolvedValueOnce(jsonRes({ value: [allDay, meeting], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=100" }))
      .mockResolvedValueOnce(jsonRes({ value: [] }));
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    const events = await result.current.fetchEvents(WINDOW);

    expect(events).toHaveLength(1); // meeting filtered out
    expect(events[0].startDate).toBe("2026-06-01");
    expect(acquireToken).toHaveBeenCalledWith(["Calendars.Read"], { interactive: true });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/me/calendarView");
    expect(url).toContain("startDateTime=");
    expect(url).toContain("endDateTime=");
    expect(url).toContain("%24select=");
    expect(url).toContain("%24orderby=");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      Prefer: 'outlook.timezone="UTC"',
    });
  });

  it("throws outlookSignInRequired when token is null", async () => {
    const acquireToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookSignInRequired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to keys", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    for (const [status, key] of [
      [401, "outlookSignInExpired"],
      [403, "outlookCalendarPermissionDenied"],
      [500, "outlookCalendarFetchFailed"],
    ] as const) {
      fetchSpy.mockResolvedValueOnce(jsonRes({}, status));
      const { result } = renderHook(() => useOutlookCalendar(acquireToken));
      await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow(key);
    }
  });

  it("maps a thrown acquireToken to outlookSignInExpired", async () => {
    const acquireToken = vi.fn().mockRejectedValue(new Error("popup closed"));
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookSignInExpired");
  });

  it("rejects an off-Graph nextLink", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy.mockResolvedValueOnce(jsonRes({ value: [], "@odata.nextLink": "https://evil.example.com/x" }));
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookCalendarFetchFailed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-outlook-calendar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/use-outlook-calendar.ts`:

```ts
// src/app/use-outlook-calendar.ts
"use client";

import { useCallback } from "react";
import { mapGraphEvent, type GraphEvent, type OutlookEvent } from "./outlook-calendar";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "id,subject,start,end,isAllDay,showAs";
const MAX_PAGES = 100;

export interface CalendarWindow {
  startDateTime: string; // ISO 8601
  endDateTime: string;   // ISO 8601
}

interface GraphPage {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
}

export interface UseOutlookCalendarResult {
  /** Fetch + normalize time-away events in `window`. Throws an Error whose
   *  message is an i18n key for the caller to translate. */
  fetchEvents: (window: CalendarWindow) => Promise<OutlookEvent[]>;
}

export function useOutlookCalendar(
  acquireToken: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>,
): UseOutlookCalendarResult {
  const fetchEvents = useCallback(async (window: CalendarWindow): Promise<OutlookEvent[]> => {
    let token: string | null;
    try {
      // Interactive: importing is an explicit user action, so first-time
      // consent for Calendars.Read may surface an interactive popup.
      token = await acquireToken(["Calendars.Read"], { interactive: true });
    } catch {
      throw new Error("outlookSignInExpired");
    }
    if (!token) throw new Error("outlookSignInRequired");

    const params = new URLSearchParams({
      startDateTime: window.startDateTime,
      endDateTime: window.endDateTime,
      $select: SELECT,
      $top: "100",
      $orderby: "start/dateTime",
    });
    let url: string | undefined = `${GRAPH}/me/calendarView?${params.toString()}`;

    const out: OutlookEvent[] = [];
    let index = 0;
    let pages = 0;
    while (url) {
      if (++pages > MAX_PAGES) throw new Error("outlookCalendarFetchFailed");
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
        });
      } catch {
        throw new Error("outlookCalendarFetchFailed");
      }
      if (res.status === 401) throw new Error("outlookSignInExpired");
      if (res.status === 403) throw new Error("outlookCalendarPermissionDenied");
      if (!res.ok) throw new Error("outlookCalendarFetchFailed");
      let page: GraphPage;
      try {
        page = (await res.json()) as GraphPage;
      } catch {
        throw new Error("outlookCalendarFetchFailed");
      }
      for (const raw of page.value ?? []) {
        const mapped = mapGraphEvent(raw, index++);
        if (mapped) out.push(mapped);
      }
      const next = page["@odata.nextLink"];
      if (next && !next.startsWith("https://graph.microsoft.com/")) {
        throw new Error("outlookCalendarFetchFailed");
      }
      url = next;
    }
    return out;
  }, [acquireToken]);

  return { fetchEvents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-outlook-calendar.test.tsx`
Expected: PASS. (Note: `URLSearchParams` encodes `$` as `%24` — the test asserts `%24select`/`%24orderby`, matching.)

- [ ] **Step 5: Type-check & lint** — `npx tsc --noEmit && npm run lint` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-outlook-calendar.ts src/app/use-outlook-calendar.test.tsx
git commit -m "feat(m4): paged Outlook /me/calendarView fetch hook"
```

---

## Task 3: Preview modal — `outlook-calendar-import-modal.tsx`

**Files:**
- Create: `src/app/outlook-calendar-import-modal.tsx`
- Test: `src/app/outlook-calendar-import-modal.test.tsx`

First add the i18n keys this task references to BOTH dictionaries (Task 6 verifies the full set). In `src/app/i18n.ts` (EN object):
```ts
outlookCalImportTitle: "Import Outlook calendar",
outlookCalImportLoading: "Loading events…",
outlookCalImportEmpty: "No time-away events found.",
outlookCalImportExisting: "already in calendar",
outlookCalImportNoSubject: "(no subject)",
outlookCalImportSelectAll: "Select all",
outlookCalImportSelectedN: "{0} selected",
outlookCalImportConfirm: "Import ({0})",
outlookCalImportCancel: "Cancel",
outlookCalImportType: "Type",
```
In `src/app/i18n.de.ts` (DE object):
```ts
outlookCalImportTitle: "Outlook-Kalender importieren",
outlookCalImportLoading: "Termine werden geladen…",
outlookCalImportEmpty: "Keine Abwesenheits-Termine gefunden.",
outlookCalImportExisting: "bereits im Kalender",
outlookCalImportNoSubject: "(kein Betreff)",
outlookCalImportSelectAll: "Alle auswählen",
outlookCalImportSelectedN: "{0} ausgewählt",
outlookCalImportConfirm: "Importieren ({0})",
outlookCalImportCancel: "Abbrechen",
outlookCalImportType: "Typ",
```
Confirm the absence-type label keys used by the per-row select. Grep `ABSENCE_TYPES` in `absence-edit-modal.tsx` to find the exact key names its `<option>` labels use, and set `TYPE_LABEL_KEY` (below) to those. The keys are expected to be `absenceTypeVacation` / `absenceTypeSick` / `absenceTypeTraining` / `absenceTypeOther`; if the real ones differ, use the real ones (they already exist in both dictionaries — no new keys needed for the type labels).

- [ ] **Step 1: Write the failing test**

Create `src/app/outlook-calendar-import-modal.test.tsx`:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OutlookCalendarImportModal } from "./outlook-calendar-import-modal";
import { dedupeKey, type OutlookEvent } from "./outlook-calendar";

const events: OutlookEvent[] = [
  { sourceId: "1", subject: "Vacation", startDate: "2026-06-01", endDate: "2026-06-03", isAllDay: true, showAs: "oof" },
  { sourceId: "2", subject: "", startDate: "2026-07-10", endDate: "2026-07-10", isAllDay: true, showAs: "oof" },
];

function base(overrides = {}) {
  return {
    lang: "en-US" as const,
    open: true,
    loading: false,
    error: null as string | null,
    events,
    targetAssignee: "",
    existingKeys: new Set<string>(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("OutlookCalendarImportModal", () => {
  it("pre-checks events and shows a per-row type select defaulting to vacation", () => {
    render(<OutlookCalendarImportModal {...base()} />);
    const rowChecks = screen.getAllByRole("checkbox");
    expect(rowChecks.length).toBe(3); // 2 rows + select-all
    rowChecks.forEach((c) => expect(c).toBeChecked());
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect((selects[0] as HTMLSelectElement).value).toBe("vacation");
    expect(screen.getByText(/\(no subject\)/i)).toBeInTheDocument();
  });

  it("confirm passes checked rows with their chosen types", () => {
    const onConfirm = vi.fn();
    render(<OutlookCalendarImportModal {...base({ onConfirm })} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "training" } });
    fireEvent.click(screen.getByRole("button", { name: /Import \(2\)/i }));
    const rows = onConfirm.mock.calls[0][0] as { event: OutlookEvent; type: string }[];
    expect(rows).toHaveLength(2);
    const vac = rows.find((r) => r.event.sourceId === "1")!;
    expect(vac.type).toBe("training");
  });

  it("badges + unchecks events already in the calendar", () => {
    const existingKeys = new Set([dedupeKey("Alex", "2026-06-01", "2026-06-03")]);
    render(<OutlookCalendarImportModal {...base({ existingKeys, targetAssignee: "Alex" })} />);
    expect(screen.getByText(/already in calendar/i)).toBeInTheDocument();
  });

  it("renders loading, empty, error states", () => {
    const { rerender } = render(<OutlookCalendarImportModal {...base({ loading: true })} />);
    expect(screen.getByText(/Loading events/i)).toBeInTheDocument();
    rerender(<OutlookCalendarImportModal {...base({ events: [] })} />);
    expect(screen.getByText(/No time-away events found/i)).toBeInTheDocument();
    rerender(<OutlookCalendarImportModal {...base({ error: "Permission denied" })} />);
    expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/app/outlook-calendar-import-modal.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/app/outlook-calendar-import-modal.tsx`:

```tsx
// src/app/outlook-calendar-import-modal.tsx
"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { dedupeKey, type OutlookEvent } from "./outlook-calendar";
import { ABSENCE_TYPES, type AbsenceType } from "./types";

export interface OutlookCalendarImportModalProps {
  lang: Lang;
  open: boolean;
  loading: boolean;
  error: string | null;
  events: OutlookEvent[];
  /** Display name the imported absences will be attributed to (for dedupe-key match). */
  targetAssignee: string;
  /** dedupeKey(assignee,start,end) of the target user's current absences. */
  existingKeys: ReadonlySet<string>;
  onConfirm: (rows: { event: OutlookEvent; type: AbsenceType }[]) => void;
  onClose: () => void;
}

// Label key per absence type — reuse the absence edit modal's option labels.
// Confirm these key names against absence-edit-modal.tsx; adjust if different.
const TYPE_LABEL_KEY: Record<AbsenceType, string> = {
  vacation: "absenceTypeVacation",
  sick: "absenceTypeSick",
  training: "absenceTypeTraining",
  other: "absenceTypeOther",
};

export function OutlookCalendarImportModal({
  lang,
  open,
  loading,
  error,
  events,
  targetAssignee,
  existingKeys,
  onConfirm,
  onClose,
}: OutlookCalendarImportModalProps) {
  const allIds = useMemo(() => events.map((e) => e.sourceId).join("|"), [events]);

  function defaultChecked(): Set<string> {
    return new Set(
      events
        .filter((e) => !existingKeys.has(dedupeKey(targetAssignee, e.startDate, e.endDate)))
        .map((e) => e.sourceId),
    );
  }
  function defaultTypes(): Record<string, AbsenceType> {
    return Object.fromEntries(events.map((e) => [e.sourceId, "vacation" as AbsenceType]));
  }

  const [prevIds, setPrevIds] = useState(allIds);
  const [checked, setChecked] = useState<Set<string>>(defaultChecked);
  const [types, setTypes] = useState<Record<string, AbsenceType>>(defaultTypes);
  if (prevIds !== allIds) {
    setPrevIds(allIds);
    setChecked(defaultChecked());
    setTypes(defaultTypes());
  }

  const selectedCount = checked.size;
  const allChecked = events.length > 0 && events.every((e) => checked.has(e.sourceId));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setChecked(() => (allChecked ? new Set() : new Set(events.map((e) => e.sourceId))));
  }
  function setType(id: string, type: AbsenceType) {
    setTypes((prev) => ({ ...prev, [id]: type }));
  }
  function confirm() {
    onConfirm(
      events
        .filter((e) => checked.has(e.sourceId))
        .map((e) => ({ event: e, type: types[e.sourceId] ?? "vacation" })),
    );
  }

  const dateRange = (e: OutlookEvent) =>
    e.startDate === e.endDate ? e.startDate : `${e.startDate} – ${e.endDate}`;

  return (
    <Modal open={open} onClose={onClose} ariaLabel={t(lang, "outlookCalImportTitle")} align="center" zIndex={50}>
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "outlookCalImportTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "outlookCalImportCancel")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t(lang, "outlookCalImportLoading")}</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-AIPM-pink">{error}</p>
          ) : events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t(lang, "outlookCalImportEmpty")}</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 border-b border-line pb-2 text-sm font-medium text-foreground">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" />
                <span>{t(lang, "outlookCalImportSelectAll")}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(lang, "outlookCalImportSelectedN", selectedCount)}
                </span>
              </label>
              <ul className="space-y-1">
                {events.map((e) => {
                  const exists = existingKeys.has(dedupeKey(targetAssignee, e.startDate, e.endDate));
                  const label = e.subject || t(lang, "outlookCalImportNoSubject");
                  return (
                    <li key={e.sourceId} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        aria-label={`${label} ${dateRange(e)}`}
                        checked={checked.has(e.sourceId)}
                        onChange={() => toggle(e.sourceId)}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={label}>{label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{dateRange(e)}</span>
                      <select
                        aria-label={`${t(lang, "outlookCalImportType")} ${label}`}
                        value={types[e.sourceId] ?? "vacation"}
                        onChange={(ev) => setType(e.sourceId, ev.target.value as AbsenceType)}
                        className="shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 text-xs"
                      >
                        {ABSENCE_TYPES.map((ty) => (
                          <option key={ty} value={ty}>{t(lang, TYPE_LABEL_KEY[ty])}</option>
                        ))}
                      </select>
                      {exists && (
                        <span className="shrink-0 text-xs italic text-AIPM-purple">{t(lang, "outlookCalImportExisting")}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted">
            {t(lang, "outlookCalImportCancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selectedCount === 0 || loading || !!error}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "outlookCalImportConfirm", selectedCount)}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/app/outlook-calendar-import-modal.test.tsx` → PASS. (If `absenceType*` label keys differ, fix `TYPE_LABEL_KEY` to the real keys from `absence-edit-modal.tsx`. If `text-AIPM-pink`/`text-AIPM-purple` aren't valid, they are used elsewhere — keep.)

- [ ] **Step 5: Type-check & lint** — `npx tsc --noEmit && npm run lint` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/outlook-calendar-import-modal.tsx src/app/outlook-calendar-import-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(m4): Outlook calendar preview modal with per-row absence type"
```

---

## Task 4: Wire the import flow

**Files:**
- Modify: `src/app/use-resource-planner.ts`
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/resources-panel.tsx`

### 4a. `use-resource-planner.ts` — batch absence import

- [ ] **Step 1:** Add imports at top: `import { eventsToAbsences, type AbsenceImportTarget, type OutlookEvent } from "./outlook-calendar";` and ensure `import type { AbsenceType } from "./types";` is present (add if missing).
- [ ] **Step 2:** After `handleOpenAddAbsence` (near the other absence handlers), add:
```ts
const handleImportAbsences = useCallback(
  (
    rows: readonly { event: OutlookEvent; type: AbsenceType }[],
    target: AbsenceImportTarget,
  ): void => {
    if (rows.length === 0) return;
    const stamp = new Date().toISOString();
    setAbsences((prev) => eventsToAbsences(rows, prev, target, stamp));
  },
  [setAbsences],
);
```
- [ ] **Step 3:** Add `handleImportAbsences` to the hook's returned object.
- [ ] **Step 4:** `npx tsc --noEmit` → 0 errors. (`setAbsences` is the absences setter in scope — used by `handleSaveAbsence`/`handleDeleteAbsence`.)

### 4b. `resources-panel.tsx` — calendar-tab button

- [ ] **Step 5:** Add `onImportOutlookCalendar?: () => void;` to the panel `Props`; destructure it. In the header toolbar (the block with the "Add absence" button, ~line 299–306), add (gated to the calendar view):
```tsx
{view === "calendar" && onImportOutlookCalendar && (
  <button
    type="button"
    onClick={onImportOutlookCalendar}
    className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
  >
    {t(lang, "outlookCalImportButton")}
  </button>
)}
```
Add i18n key to BOTH files: `i18n.ts` → `outlookCalImportButton: "Import from Outlook",` ; `i18n.de.ts` → `outlookCalImportButton: "Aus Outlook importieren",`.
- [ ] **Step 6:** `npx tsc --noEmit` → 0 errors.

### 4c. `task-manager.tsx` — coordinate

- [ ] **Step 7:** Add imports (avoid duplicates — `useMsAuth`, `resourceDisplayName` are already imported from M3 wiring; check):
```ts
import { useOutlookCalendar } from "./use-outlook-calendar";
import { OutlookCalendarImportModal } from "./outlook-calendar-import-modal";
import { dedupeKey, type OutlookEvent, type AbsenceImportTarget } from "./outlook-calendar";
import { isoAddDays } from "./due-dates";
import type { AbsenceType } from "./types";
```
- [ ] **Step 8:** Add `handleImportAbsences` to the `useResourcePlanner(...)` destructuring. Add state + handlers after the existing M3 import block (where `msAuth`, `m365Enabled`, `resources`, `absences`, `today`, `showToast`, `settings`, `lang` are in scope):
```ts
const outlookCalendarEnabled =
  m365Enabled && (settings.integrations?.m365?.outlookCalendar ?? false);
const { fetchEvents: fetchOutlookEvents } = useOutlookCalendar(msAuth.acquireToken);

const [calImportOpen, setCalImportOpen] = useState(false);
const [calImportLoading, setCalImportLoading] = useState(false);
const [calImportError, setCalImportError] = useState<string | null>(null);
const [calImportEvents, setCalImportEvents] = useState<OutlookEvent[]>([]);

const calendarTarget = useMemo<AbsenceImportTarget>(() => {
  const email = (msAuth.account?.username ?? "").trim();
  const lower = email.toLowerCase();
  const match = email
    ? resources.find((r) => (r.email ?? "").trim().toLowerCase() === lower)
    : undefined;
  return {
    assignee: match ? resourceDisplayName(match) : (msAuth.account?.name ?? email),
    assigneeEmail: email || undefined,
    resourceId: match?.id,
  };
}, [msAuth.account, resources]);

const calendarExistingKeys = useMemo(() => {
  const key = calendarTarget.assignee.trim().toLowerCase();
  return new Set(
    absences
      .filter((a) => a.assignee.trim().toLowerCase() === key)
      .map((a) => dedupeKey(a.assignee, a.startDate, a.endDate)),
  );
}, [absences, calendarTarget.assignee]);

const handleOpenCalendarImport = useCallback(async () => {
  const knownKeys = [
    "outlookSignInRequired",
    "outlookSignInExpired",
    "outlookCalendarPermissionDenied",
    "outlookCalendarFetchFailed",
  ] as const;
  setCalImportOpen(true);
  setCalImportError(null);
  setCalImportEvents([]);
  setCalImportLoading(true);
  try {
    const events = await fetchOutlookEvents({
      startDateTime: `${isoAddDays(today, -30)}T00:00:00Z`,
      endDateTime: `${isoAddDays(today, 180)}T00:00:00Z`,
    });
    setCalImportEvents(events);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const key = (knownKeys as readonly string[]).includes(msg)
      ? (msg as (typeof knownKeys)[number])
      : "outlookCalendarFetchFailed";
    setCalImportError(t(lang, key));
  } finally {
    setCalImportLoading(false);
  }
}, [fetchOutlookEvents, today, lang]);

const handleConfirmCalendarImport = useCallback(
  (rows: { event: OutlookEvent; type: AbsenceType }[]) => {
    handleImportAbsences(rows, calendarTarget);
    setCalImportOpen(false);
    showToast("info", t(lang, "outlookCalImportedN", rows.length));
  },
  [handleImportAbsences, calendarTarget, showToast, lang],
);
```
- [ ] **Step 9:** On the `<ResourcesPanel>` render, add the gated button handler:
```tsx
onImportOutlookCalendar={
  outlookCalendarEnabled && msAuth.account
    ? guardEdit(() => { void handleOpenCalendarImport(); })
    : undefined
}
```
- [ ] **Step 10:** Render the modal near the other modals / `<OutlookImportModal>`:
```tsx
<OutlookCalendarImportModal
  lang={lang}
  open={calImportOpen}
  loading={calImportLoading}
  error={calImportError}
  events={calImportEvents}
  targetAssignee={calendarTarget.assignee}
  existingKeys={calendarExistingKeys}
  onConfirm={handleConfirmCalendarImport}
  onClose={() => setCalImportOpen(false)}
/>
```
Add i18n key to BOTH files: `i18n.ts` → `outlookCalImportedN: "Imported {0} absences",` ; `i18n.de.ts` → `outlookCalImportedN: "{0} Abwesenheiten importiert",`.
- [ ] **Step 11:** Full suite + gates: `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0.
- [ ] **Step 12: Commit**
```bash
git add src/app/use-resource-planner.ts src/app/task-manager.tsx src/app/resources-panel.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(m4): wire Outlook calendar import (calendar-tab button + modal + merge)"
```

---

## Task 5: Make the Outlook calendar sub-toggle interactive

**Files:**
- Modify: `src/app/settings-menu.tsx`
- Test: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: Update tests.** In `src/app/settings-menu.test.tsx`, replace the test "Outlook calendar sub-toggle is still disabled (M4 not yet shipped)" with:
```ts
it("Outlook calendar sub-toggle is interactive (M4 shipped)", () => {
  const settings = makeSettings({ integrations: m365EnabledIntegrations });
  render(<SettingsMenu {...makeProps({ settings })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  const cal = screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookCalendar") });
  expect(cal).not.toBeDisabled();
});

it("toggling Outlook calendar persists settings.integrations.m365.outlookCalendar", () => {
  const onChange = vi.fn();
  const settings = makeSettings({ integrations: m365EnabledIntegrations });
  render(<SettingsMenu {...makeProps({ settings, onChange })} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
  fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "integrationsOutlookCalendar") }));
  expect(onChange).toHaveBeenCalled();
  const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Settings;
  expect(lastCall.integrations?.m365?.outlookCalendar).toBe(true);
});
```
(The `m365EnabledIntegrations` fixture has `outlookCalendar: false`; after click → `true`. Verify and keep. If any other existing test asserts the calendar toggle is disabled, remove/replace it.)
- [ ] **Step 2: Run** → FAIL (toggle still disabled).
- [ ] **Step 3: Implement.** In `settings-menu.tsx` change the tuple `["integrationsOutlookCalendar", "outlookCalendar", true]` → `["integrationsOutlookCalendar", "outlookCalendar", false]`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx
git commit -m "feat(m4): make Outlook calendar sub-toggle interactive"
```

---

## Task 6: i18n completeness (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`

Tasks 3–4 added the `outlookCal*` UI keys. This task adds the remaining error/highlight keys and verifies parity.

- [ ] **Step 1: Ensure each key exists in BOTH files.** Add (if missing):
```ts
// EN (i18n.ts)
outlookCalendarPermissionDenied: "Permission denied. Grant calendar access.",
outlookCalendarFetchFailed: "Could not load Outlook calendar.",
versionHighlightOutlookCalendar:
  "Import time-away events from your Outlook calendar as absences: sign in with Microsoft, then pull all-day and Out-of-Office events into the resource calendar from Resources › Calendar.",
```
```ts
// DE (i18n.de.ts)
outlookCalendarPermissionDenied: "Zugriff verweigert. Kalenderzugriff gewähren.",
outlookCalendarFetchFailed: "Outlook-Kalender konnte nicht geladen werden.",
versionHighlightOutlookCalendar:
  "Abwesenheits-Termine aus dem Outlook-Kalender importieren: mit Microsoft anmelden und ganztägige sowie Abwesenheits-Termine unter Ressourcen › Kalender in den Ressourcenkalender übernehmen.",
```
(`outlookSignInRequired` / `outlookSignInExpired` already exist from M3 — reused, do not duplicate.)
- [ ] **Step 2:** Run `npx vitest run src/app` → green. Confirm every EN key above has a DE counterpart.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` → 0 errors.
- [ ] **Step 4: Commit**
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(m4): EN/DE strings for Outlook calendar import"
```

---

## Task 7: Release 0.24.0 "Jemisin"

**Files:** Modify `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: version.ts.**
  - Add at the very top (above the `0.23.1` comment):
```ts
// 0.24.0 adds Outlook calendar import (M4) — sign in with Microsoft, then pull
// time-away events (all-day + Out-of-Office) from your Outlook calendar into the
// resource calendar as absences. Preview-and-pick dialog from Resources ›
// Calendar with a per-row absence-type selector. Completes the M365 integration
// suite (auth, SharePoint storage, Outlook contacts, Outlook calendar).
```
  - `export const APP_VERSION = "0.23.1";` → `export const APP_VERSION = "0.24.0";`
  - Keep `APP_BUILD_DATE = "2026-05-29"; // Jemisin milestone`.
  - Append as the LAST `APP_HIGHLIGHT_KEYS` entry (after `"versionHighlightOutlookContacts"`): `"versionHighlightOutlookCalendar",`
- [ ] **Step 2: CHANGELOG.md.** Add above `## [0.23.1]` (match the existing `## [x.y.z] — YYYY-MM-DD "Codename"` heading style):
```markdown
## [0.24.0] — 2026-05-29 "Jemisin"

### Added
- **Outlook calendar import (M4).** With Microsoft 365 enabled and signed in, an **Import from Outlook** button on Resources › Calendar fetches your time-away events (all-day and Out-of-Office) from your Outlook calendar (Microsoft Graph `/me/calendarView`, `Calendars.Read`). A preview dialog lets you pick events and set each one's absence type (vacation / sick / training / other); selected events become absences on the resource calendar, attributed to your account. Events already present (matched by date range) are skipped.

### Changed
- The **Outlook calendar** sub-toggle in Settings → Integrations is now interactive — **all Microsoft 365 integrations (auth, SharePoint storage, Outlook contacts, Outlook calendar) are now live.**
```
- [ ] **Step 3: Final gates.** `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0. Optional: `npm run test:coverage` ≥ current.
- [ ] **Step 4: Commit**
```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.24.0 Jemisin — Outlook calendar import"
```

---

## Final Review Checklist

After all tasks, review the whole branch diff (`git diff main...HEAD`):
- [ ] All spec requirements present (time-away filter, all-day exclusive-end, per-row type, dedup, both target paths, interactive consent, calendar-tab button, interactive toggle, i18n, release).
- [ ] No token in any URL — Bearer header only; `Prefer: outlook.timezone="UTC"` present.
- [ ] Import button hidden unless `outlookCalendarEnabled && msAuth.account`, and wrapped in `guardEdit` (no mutation in read-only popout).
- [ ] EN/DE key parity; no duplicate keys.
- [ ] `tsc` 0, lint 0, full suite green.
- [ ] `eslint.config.mjs` NOT modified.

---

## Self-Review (plan vs spec)

**1. Spec coverage:** time-away filter + all-day exclusive-end + event mapping → Task 1; paged calendarView fetch + interactive `Calendars.Read` + Prefer UTC + nextLink guard + typed errors → Task 2; preview modal + per-row type + dedup badge → Task 3; coordinator + target mapping + window + calendar-tab button + guardEdit gating + `handleImportAbsences` → Task 4; interactive toggle → Task 5; i18n EN/DE → Tasks 3/4/6; release 0.24.0 → Task 7. Edge cases (exclusive end, OOF timed, no subject, re-import dedup, no-matching-resource, token null) covered by Task 1 logic + Task 2 errors, tested in Tasks 1–3.

**2. Placeholder scan:** no "TBD"/"handle errors"/"similar to" — full code in every code step. The two confirm-then-use notes (`absenceType*` label keys, `m365EnabledIntegrations` fixture) are verifications, not placeholders.

**3. Type consistency:** `GraphEvent`/`OutlookEvent`/`AbsenceImportTarget` defined in Task 1, imported identically in Tasks 2–4. `eventsToAbsences(rows, existing, target, stamp)` (Task 1) called via `handleImportAbsences` (Task 4a) → called in Task 4c. `fetchEvents(window)` consistent. `dedupeKey(assignee,start,end)` used in Tasks 1/3/4. i18n keys referenced match those added. `useOutlookCalendar(acquireToken)` matches the widened `acquireToken` (0.23.1). Toast key `outlookCalImportedN` consistent (Tasks 4 + 6).
