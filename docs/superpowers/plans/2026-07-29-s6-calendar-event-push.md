# S6 — Outlook push for calendar events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push each `CalendarEvent` series to Outlook as one recurring seriesMaster — including its local move/skip exceptions and, on explicit opt-in, its attendees as real invitations.

**Architecture:** Three new pure modules (recurrence translation, attendee resolution, Graph event + exception planning) plus one new presentational field component. All wiring reuses the existing `useEntityCalendarPush`, extended with two optional, default-inert hooks: a `freeze` predicate (so background auto-push can hold invitation series without deleting them) and an `afterPush` callback (so exception replay runs inside the same lock, with the same token and the freshly-written event ids).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Vitest + Testing Library, Microsoft Graph (`/me/events`), MSAL via `useMsAuth`.

**Spec:** `docs/superpowers/specs/2026-07-29-s6-calendar-event-push-design.md`

---

## Read this before Task 1

Facts verified against the working tree. Do not re-derive them; do not assume the opposite.

- `graph()` in `outlook-calendar-write.ts:201` is **module-private**. New Graph calls must be added
  *in that file*, not from a new one.
- `task-manager.tsx` is **2973 lines against a 2974 baseline** (`docs/baselines/file-sizes.json`).
  It has one line of headroom. Task 13 makes it **shrink** — do not add lines there any other way,
  and do not run `check-file-sizes.mjs --update`.
- `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts in it. Every DE edit in this plan uses
  a node utf8 write with `\r\n` anchors, then greps to verify.
- `npx tsc --noEmit` after **any** test edit — `next build` does not typecheck tests and vitest never
  typechecks.
- Lint runs with `--max-warnings=0`. An unused import or an `obj.member` expression in a hook dep
  array is a **fatal** error, not a warning.

## File structure

**Create**

| File | Responsibility |
|---|---|
| `src/app/graph-recurrence.ts` | `toGraphRecurrence(rule, startDate)` — our `RecurrenceRule` → Graph `{pattern, range}`. Pure, one-directional |
| `src/app/graph-recurrence.test.ts` | its tests |
| `src/app/calendar-event-attendees.ts` | `resolveAttendees(ids, resources)` → reachable / unreachable / dangling. The single source both the confirm dialog and the push read |
| `src/app/calendar-event-attendees.test.ts` | its tests |
| `src/app/calendar-event-graph.ts` | `eventToGraphEvent(...)` + `exceptionPlan(event, instances)`. Pure |
| `src/app/calendar-event-graph.test.ts` | its tests |
| `src/app/calendar-event-exception-push.ts` | `replayExceptions(token, events, links, timeZone)` — the Graph I/O loop driven by `exceptionPlan` |
| `src/app/calendar-event-exception-push.test.ts` | its tests (Graph helpers mocked) |
| `src/app/calendar-event-attendees-field.tsx` | presentational attendee picker + invitations toggle. Props-only, no context |
| `src/app/calendar-event-attendees-field.test.tsx` | its tests |

**Modify**

| File | Change |
|---|---|
| `src/app/outlook-calendar-write.ts` | widen `GraphEvent`; add `listEventInstances` / `updateEventInstance` / `deleteEventInstance` |
| `src/app/calendar-reconcile.ts` | `planEntityReconcile` gains optional `freeze` |
| `src/app/use-entity-calendar-push.ts` | forwards `freeze`; gains optional `afterPush` |
| `src/app/settings-types.ts` | `"event"` in `CalendarEntityType` + `CALENDAR_ENTITY_TYPES` |
| `src/app/settings-sections/integrations-section.tsx` | one more `CalendarSyncEntityRow` |
| `src/app/calendar-sync-controls.tsx` | entity-qualify the Push/Pull accessible names |
| `src/app/use-calendar-integrations.ts` | the event block; move the absence bag in; return both bags |
| `src/app/task-manager.tsx` | net **−4 lines** (Task 13) |
| `src/app/workspace-section-types.ts` | `eventCalendar?: EntityCalendarProps` |
| `src/app/workspace-section.tsx` | thread it to `ResourcesPanel` |
| `src/app/resources-panel.tsx` | second `CalendarSyncControls`, calendar sub-tab only |
| `src/app/app-modals.tsx` | thread `resources` into `CalendarEventModal` |
| `src/app/calendar-event-modal.tsx` | mount the attendee field; invitation-aware delete confirm |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | new keys |
| `src/app/version.ts` / `CHANGELOG.md` | release |

---

## Task 1: `graph-recurrence.ts`

**Files:**
- Create: `src/app/graph-recurrence.ts`
- Test: `src/app/graph-recurrence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/graph-recurrence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toGraphRecurrence } from "./graph-recurrence";

describe("toGraphRecurrence", () => {
  it("maps daily with an interval and no terminator to noEnd", () => {
    expect(toGraphRecurrence({ freq: "daily", interval: 3 }, "2026-03-02")).toEqual({
      pattern: { type: "daily", interval: 3 },
      range: { type: "noEnd", startDate: "2026-03-02" },
    });
  });

  it("maps weekly with explicit byDay", () => {
    expect(
      toGraphRecurrence({ freq: "weekly", interval: 1, byDay: ["MO", "WE"] }, "2026-03-02"),
    ).toEqual({
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday"] },
      range: { type: "noEnd", startDate: "2026-03-02" },
    });
  });

  it("defaults weekly with no byDay to the start date's own weekday", () => {
    // 2026-03-02 is a Monday.
    expect(toGraphRecurrence({ freq: "weekly", interval: 2 }, "2026-03-02")).toEqual({
      pattern: { type: "weekly", interval: 2, daysOfWeek: ["monday"] },
      range: { type: "noEnd", startDate: "2026-03-02" },
    });
  });

  it("maps monthly day-of-month to absoluteMonthly", () => {
    expect(
      toGraphRecurrence({ freq: "monthly", interval: 1, byMonthDay: 15 }, "2026-03-02"),
    ).toEqual({
      pattern: { type: "absoluteMonthly", interval: 1, dayOfMonth: 15 },
      range: { type: "noEnd", startDate: "2026-03-02" },
    });
  });

  it("maps monthly nth-weekday to relativeMonthly, including last", () => {
    expect(
      toGraphRecurrence(
        { freq: "monthly", interval: 1, byDay: { ordinal: -1, day: "FR" } },
        "2026-03-02",
      ),
    ).toEqual({
      pattern: { type: "relativeMonthly", interval: 1, daysOfWeek: ["friday"], index: "last" },
      range: { type: "noEnd", startDate: "2026-03-02" },
    });
  });

  it("maps each ordinal to its Graph index word", () => {
    const idx = ([1, 2, 3, 4] as const).map(
      (ordinal) =>
        toGraphRecurrence(
          { freq: "monthly", interval: 1, byDay: { ordinal, day: "TU" } },
          "2026-03-02",
        ).pattern,
    );
    expect(idx.map((p) => (p as { index: string }).index)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("maps until to an endDate range", () => {
    expect(
      toGraphRecurrence({ freq: "daily", interval: 1, until: "2026-06-30" }, "2026-03-02").range,
    ).toEqual({ type: "endDate", startDate: "2026-03-02", endDate: "2026-06-30" });
  });

  it("maps count to a numbered range", () => {
    expect(
      toGraphRecurrence({ freq: "daily", interval: 1, count: 12 }, "2026-03-02").range,
    ).toEqual({ type: "numbered", startDate: "2026-03-02", numberOfOccurrences: 12 });
  });

  it("prefers until when a rule somehow carries both", () => {
    // sanitizeCalendarEvent drops one, but this module must not depend on that.
    expect(
      toGraphRecurrence(
        { freq: "daily", interval: 1, until: "2026-06-30", count: 12 },
        "2026-03-02",
      ).range,
    ).toEqual({ type: "endDate", startDate: "2026-03-02", endDate: "2026-06-30" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/graph-recurrence.test.ts`
Expected: FAIL — `Failed to resolve import "./graph-recurrence"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/graph-recurrence.ts`:

```ts
// Our RecurrenceRule → Microsoft Graph recurrence. Pure, i18n-free, clock-free.
//
// ONE DIRECTION ONLY. S7 pulls by mapping the master's *instances* to
// exceptions and never re-reads its rule, so a fromGraph* inverse has no
// caller — building it now would be speculative generality.
import type { RecurrenceRule, Weekday } from "./calendar-event";

export type GraphRecurrencePattern =
  | { type: "daily"; interval: number }
  | { type: "weekly"; interval: number; daysOfWeek: string[] }
  | { type: "absoluteMonthly"; interval: number; dayOfMonth: number }
  | { type: "relativeMonthly"; interval: number; daysOfWeek: string[]; index: string };

export type GraphRecurrenceRange =
  | { type: "noEnd"; startDate: string }
  | { type: "endDate"; startDate: string; endDate: string }
  | { type: "numbered"; startDate: string; numberOfOccurrences: number };

export interface GraphRecurrence {
  pattern: GraphRecurrencePattern;
  range: GraphRecurrenceRange;
}

const DAY_NAME: Record<Weekday, string> = {
  MO: "monday",
  TU: "tuesday",
  WE: "wednesday",
  TH: "thursday",
  FR: "friday",
  SA: "saturday",
  SU: "sunday",
};

const ORDINAL_INDEX: Record<1 | 2 | 3 | 4 | -1, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

/** Weekday of an ISO date, read in UTC so no local zone can shift it. */
function weekdayOf(isoDate: string): Weekday {
  const idx = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const order: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return order[idx];
}

function rangeOf(rule: RecurrenceRule, startDate: string): GraphRecurrenceRange {
  // `until` wins over `count` — the same precedence sanitizeCalendarEvent
  // applies, repeated here so this module is correct for any input, not only
  // for already-sanitized ones.
  if (rule.until) return { type: "endDate", startDate, endDate: rule.until };
  if (rule.count) return { type: "numbered", startDate, numberOfOccurrences: rule.count };
  return { type: "noEnd", startDate };
}

export function toGraphRecurrence(rule: RecurrenceRule, startDate: string): GraphRecurrence {
  const range = rangeOf(rule, startDate);

  if (rule.freq === "daily") {
    return { pattern: { type: "daily", interval: rule.interval }, range };
  }

  if (rule.freq === "weekly") {
    // Absent byDay means "recur on the start date's own weekday" — the same
    // implicit default recurrence.ts expands, spelled out for Graph, which
    // requires daysOfWeek explicitly.
    const days = rule.byDay?.length ? rule.byDay : [weekdayOf(startDate)];
    return {
      pattern: { type: "weekly", interval: rule.interval, daysOfWeek: days.map((d) => DAY_NAME[d]) },
      range,
    };
  }

  if (rule.byDay) {
    return {
      pattern: {
        type: "relativeMonthly",
        interval: rule.interval,
        daysOfWeek: [DAY_NAME[rule.byDay.day]],
        index: ORDINAL_INDEX[rule.byDay.ordinal],
      },
      range,
    };
  }

  return {
    pattern: {
      type: "absoluteMonthly",
      interval: rule.interval,
      // sanitizeCalendarEvent always fills byMonthDay on the monthly/dom
      // branch; the fallback keeps this total for an unsanitized rule.
      dayOfMonth: rule.byMonthDay ?? Number(startDate.slice(8, 10)),
    },
    range,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/graph-recurrence.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/graph-recurrence.ts src/app/graph-recurrence.test.ts
git commit -m "feat(calendar): translate a recurrence rule to a Graph recurrence"
```

---

## Task 2: `calendar-event-attendees.ts`

**Files:**
- Create: `src/app/calendar-event-attendees.ts`
- Test: `src/app/calendar-event-attendees.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-event-attendees.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAttendees } from "./calendar-event-attendees";
import type { Resource } from "./types";

function res(id: number, firstName: string, lastName: string, email?: string): Resource {
  return {
    id,
    firstName,
    lastName,
    email,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  } as Resource;
}

const RESOURCES: Resource[] = [
  res(1, "Ada", "Lovelace", "ada@example.com"),
  res(2, "Grace", "Hopper"), // no email
  res(3, "Alan", "Turing", "alan@example.com"),
];

describe("resolveAttendees", () => {
  it("splits ids into reachable, unreachable and dangling", () => {
    expect(resolveAttendees([1, 2, 99], RESOURCES)).toEqual({
      reachable: [{ address: "ada@example.com", name: "Ada Lovelace" }],
      unreachable: [{ name: "Grace Hopper" }],
      dangling: [99],
    });
  });

  it("returns empty buckets for no ids", () => {
    expect(resolveAttendees(undefined, RESOURCES)).toEqual({
      reachable: [],
      unreachable: [],
      dangling: [],
    });
  });

  it("preserves the caller's id order", () => {
    const out = resolveAttendees([3, 1], RESOURCES);
    expect(out.reachable.map((r) => r.address)).toEqual(["alan@example.com", "ada@example.com"]);
  });

  it("treats a blank or whitespace email as unreachable, not reachable", () => {
    const out = resolveAttendees([4], [res(4, "Blank", "Mail", "   ")]);
    expect(out.reachable).toEqual([]);
    expect(out.unreachable).toEqual([{ name: "Blank Mail" }]);
  });

  it("trims the address it hands to Graph", () => {
    const out = resolveAttendees([5], [res(5, "Padded", "Mail", "  p@example.com ")]);
    expect(out.reachable).toEqual([{ address: "p@example.com", name: "Padded Mail" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-attendees.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-event-attendees"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-event-attendees.ts`:

```ts
// Resolves a CalendarEvent's attendeeResourceIds against the resource
// directory. Pure, i18n-free.
//
// ★★ This is the SINGLE source both the invitation confirm dialog and the push
// read. Two separate resolutions would let the dialog name one set of people
// and Graph mail another — and this is the only surface in the app that emails
// third parties, so that divergence is the one bug class that must be
// impossible by construction.
import type { Resource } from "./types";

export interface ResolvedAttendees {
  /** Has a usable address — these become Graph `attendees`. */
  reachable: { address: string; name: string }[];
  /** Resolved to a real resource that carries no email. Shown to the user as
   *  unreachable rather than silently skipped. */
  unreachable: { name: string }[];
  /** Ids with no matching resource (deleted after being invited). Kept on the
   *  model per the CalendarEvent contract; surfaced, never dropped. */
  dangling: number[];
}

function displayName(r: Resource): string {
  return `${r.firstName} ${r.lastName}`.trim();
}

export function resolveAttendees(
  ids: readonly number[] | undefined,
  resources: readonly Resource[],
): ResolvedAttendees {
  const out: ResolvedAttendees = { reachable: [], unreachable: [], dangling: [] };
  if (!ids?.length) return out;
  const byId = new Map(resources.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      out.dangling.push(id);
      continue;
    }
    const address = r.email?.trim();
    if (address) out.reachable.push({ address, name: displayName(r) });
    else out.unreachable.push({ name: displayName(r) });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/calendar-event-attendees.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/calendar-event-attendees.ts src/app/calendar-event-attendees.test.ts
git commit -m "feat(calendar): resolve meeting attendees into reachable, unreachable and dangling"
```

---

## Task 3: Widen `GraphEvent` and add the instance helpers

**Files:**
- Modify: `src/app/outlook-calendar-write.ts:15-25` (the interface) and the end of the file (new calls)
- Test: `src/app/outlook-calendar-write.test.ts` (existing — must stay green untouched)

- [ ] **Step 1: Run the existing suite to record the green baseline**

Run: `npx vitest run src/app/outlook-calendar-write.test.ts`
Expected: PASS. Note the test count — it must be identical after this task.

- [ ] **Step 2: Widen the interface**

In `src/app/outlook-calendar-write.ts`, replace the `GraphEvent` interface (lines 15–25) with:

```ts
export interface GraphEvent {
  subject: string;
  /** Was the literal `true`. Widened for timed meetings (calendar events);
   *  the five all-day builders below still pass `true` and are unchanged. */
  isAllDay: boolean;
  /** timeZone was the literal "UTC". Widened so a meeting can be expressed in
   *  the project's effective zone — Graph interprets `dateTime` in it. */
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  categories: string[];
  body: { contentType: "Text"; content: string };
  /** Free/busy status shown in Outlook. Optional — only entity types that
   *  care about availability (absences) set it; others omit it. */
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere";
  /** Populated ONLY when the user opted into invitations. Omitted entirely
   *  otherwise, which makes the push a personal calendar entry. */
  attendees?: { emailAddress: { address: string; name?: string }; type: "required" }[];
  /** Present ⇒ Graph creates a recurring seriesMaster rather than a single event. */
  recurrence?: { pattern: GraphRecurrencePattern; range: GraphRecurrenceRange };
}
```

Add to the import block at the top of the file (after the `outlook-graph` import on line 5):

```ts
import type { GraphRecurrencePattern, GraphRecurrenceRange } from "./graph-recurrence";
```

- [ ] **Step 3: Verify the five existing builders still typecheck and pass**

Run: `npx tsc --noEmit && npx vitest run src/app/outlook-calendar-write.test.ts`
Expected: tsc exits 0; the suite passes with the **same test count** as Step 1. Widening a literal
type to its base can only accept more, so no builder needed a change.

- [ ] **Step 4: Write the failing test for the instance helpers**

Append to `src/app/outlook-calendar-write.test.ts`:

```ts
describe("event instance helpers", () => {
  const OK = { ok: true, status: 200, json: async () => ({}) } as Response;

  it("lists instances over a window and pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          value: [{ id: "i1", start: { dateTime: "2026-03-02T09:00:00.0000000" } }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          value: [
            {
              id: "i2",
              start: { dateTime: "2026-03-12T09:00:00.0000000" },
              originalStart: "2026-03-09T09:00:00.0000000Z",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listEventInstances("tok", "master-1", "2026-03-01", "2026-03-31");

    expect(out).toEqual([
      { id: "i1", startDateTime: "2026-03-02T09:00:00.0000000", originalStart: undefined },
      {
        id: "i2",
        startDateTime: "2026-03-12T09:00:00.0000000",
        originalStart: "2026-03-09T09:00:00.0000000Z",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("patches an instance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK);
    vi.stubGlobal("fetch", fetchMock);
    await updateEventInstance("tok", "i1", {
      start: { dateTime: "2026-03-05T09:00:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2026-03-05T10:00:00", timeZone: "Europe/Berlin" },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events/i1");
    expect((init as RequestInit).method).toBe("PATCH");
    vi.unstubAllGlobals();
  });

  it("treats a 404 on instance delete as success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteEventInstance("tok", "gone")).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
```

Extend that file's existing import from `./outlook-calendar-write` with
`listEventInstances, updateEventInstance, deleteEventInstance`, and make sure `describe`, `it`,
`expect` and `vi` are imported from `vitest` at the top (they already are).

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/app/outlook-calendar-write.test.ts`
Expected: FAIL — `listEventInstances is not a function`.

- [ ] **Step 6: Implement the helpers**

Append to `src/app/outlook-calendar-write.ts`:

```ts
/** One expanded occurrence of a seriesMaster, as Graph returns it. */
export interface GraphEventInstance {
  id: string;
  /** Local wall-clock start Graph reports for this occurrence. */
  startDateTime: string;
  /** Present ONLY on a modified occurrence: where the RULE originally put it.
   *  ★★ This — not `startDateTime` — is the identity of an occurrence. A moved
   *  instance is returned at its NEW time, so matching on the start would make
   *  a second push mistake it for whichever occurrence originally lived there
   *  and move the wrong one. */
  originalStart?: string;
}

/** Expanded occurrences of one seriesMaster over a window, paginated. */
export async function listEventInstances(
  token: string,
  seriesMasterId: string,
  startDate: string,
  endDate: string,
): Promise<GraphEventInstance[]> {
  const qs = new URLSearchParams({
    startDateTime: `${startDate}T00:00:00`,
    endDateTime: `${endDate}T23:59:59`,
    $select: "id,start,originalStart",
    $top: "100",
  });
  let url: string | null = `${GRAPH}/me/events/${seriesMasterId}/instances?${qs.toString()}`;
  const out: GraphEventInstance[] = [];
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const json: {
      value?: { id: string; start?: { dateTime?: string }; originalStart?: string }[];
      "@odata.nextLink"?: string;
    } = await graphGet(token, url);
    for (const e of json.value ?? []) {
      out.push({
        id: e.id,
        startDateTime: e.start?.dateTime ?? "",
        originalStart: e.originalStart,
      });
    }
    url = json["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Moves ONE occurrence. A PATCH on an instance id creates a Graph exception
 *  occurrence without disturbing the rest of the series. */
export async function updateEventInstance(
  token: string,
  instanceId: string,
  patch: { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } },
): Promise<void> {
  await graph(token, "PATCH", `/me/events/${instanceId}`, patch);
}

/** Cancels ONE occurrence. 404 is success — already cancelled. */
export async function deleteEventInstance(token: string, instanceId: string): Promise<void> {
  await graph(token, "DELETE", `/me/events/${instanceId}`);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/app/outlook-calendar-write.test.ts`
Expected: PASS — the original tests plus 3 new.

- [ ] **Step 8: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/outlook-calendar-write.ts src/app/outlook-calendar-write.test.ts
git commit -m "feat(calendar): allow timed Graph events and reach series instances"
```

---

## Task 4: `eventToGraphEvent`

**Files:**
- Create: `src/app/calendar-event-graph.ts`
- Test: `src/app/calendar-event-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-event-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eventToGraphEvent } from "./calendar-event-graph";
import type { CalendarEvent } from "./calendar-event";

const BASE: CalendarEvent = {
  id: 7,
  title: "Weekly sync",
  startDate: "2026-03-02",
  startTime: "09:30",
  durationMinutes: 60,
};

const TZ = "Europe/Berlin";

describe("eventToGraphEvent", () => {
  it("builds a timed, type-scoped, non-all-day event in the given zone", () => {
    const g = eventToGraphEvent(BASE, "p1", { timeZone: TZ, attendees: [] });
    expect(g.isAllDay).toBe(false);
    expect(g.subject).toBe("Weekly sync");
    expect(g.start).toEqual({ dateTime: "2026-03-02T09:30:00", timeZone: TZ });
    expect(g.end).toEqual({ dateTime: "2026-03-02T10:30:00", timeZone: TZ });
    expect(g.categories).toEqual(["AIPM:p1:event"]);
  });

  it("rolls the date over when the duration crosses midnight", () => {
    const g = eventToGraphEvent(
      { ...BASE, startTime: "23:30", durationMinutes: 90 },
      "p1",
      { timeZone: TZ, attendees: [] },
    );
    expect(g.end).toEqual({ dateTime: "2026-03-03T01:00:00", timeZone: TZ });
  });

  it("omits attendees entirely when invitations are off", () => {
    const g = eventToGraphEvent(BASE, "p1", {
      timeZone: TZ,
      attendees: [{ address: "ada@example.com", name: "Ada Lovelace" }],
    });
    // sendInvitations is absent on BASE.
    expect(g.attendees).toBeUndefined();
  });

  it("includes attendees when invitations are on", () => {
    const g = eventToGraphEvent({ ...BASE, sendInvitations: true }, "p1", {
      timeZone: TZ,
      attendees: [{ address: "ada@example.com", name: "Ada Lovelace" }],
    });
    expect(g.attendees).toEqual([
      { emailAddress: { address: "ada@example.com", name: "Ada Lovelace" }, type: "required" },
    ]);
  });

  it("omits attendees when invitations are on but nobody is reachable", () => {
    const g = eventToGraphEvent({ ...BASE, sendInvitations: true }, "p1", {
      timeZone: TZ,
      attendees: [],
    });
    expect(g.attendees).toBeUndefined();
  });

  it("omits recurrence for a one-off meeting", () => {
    expect(eventToGraphEvent(BASE, "p1", { timeZone: TZ, attendees: [] }).recurrence)
      .toBeUndefined();
  });

  it("carries the translated recurrence for a series", () => {
    const g = eventToGraphEvent(
      { ...BASE, recurrence: { freq: "weekly", interval: 1, byDay: ["MO"] } },
      "p1",
      { timeZone: TZ, attendees: [] },
    );
    expect(g.recurrence).toEqual({
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "noEnd", startDate: "2026-03-02" },
    });
  });

  it("puts location and notes in the body", () => {
    const g = eventToGraphEvent(
      { ...BASE, location: "Room 4", notes: "Bring the deck" },
      "p1",
      { timeZone: TZ, attendees: [] },
    );
    expect(g.body.content).toContain("Location: Room 4");
    expect(g.body.content).toContain("Bring the deck");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-graph.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-event-graph"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-event-graph.ts`:

```ts
// CalendarEvent → Microsoft Graph. Pure, i18n-free, clock-free.
import type { CalendarEvent } from "./calendar-event";
import { toGraphRecurrence } from "./graph-recurrence";
import { categoryFor, type GraphEvent, type GraphEventInstance } from "./outlook-calendar-write";

export interface EventGraphContext {
  /** The project's EFFECTIVE timezone — resolveTimezone(settings.timezone,
   *  project?.operatingTimezone). Never UTC: a meeting is a wall-clock
   *  commitment in a place, and Graph interprets `dateTime` in this zone. */
  timeZone: string;
  /** Already resolved by resolveAttendees — only the reachable ones. */
  attendees: readonly { address: string; name: string }[];
}

/**
 * Adds minutes to a `YYYY-MM-DD` + `HH:mm` wall clock, rolling the date over.
 *
 * ★ NAIVE ON PURPOSE. It does not consult the timezone, so a fixed-duration
 * meeting spanning a DST transition keeps its stated duration in wall-clock
 * terms rather than in absolute terms — which is exactly what Outlook itself
 * does for such a meeting, and what a user who typed "60 minutes" means.
 */
export function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const rem = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayShift);
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return { date: d.toISOString().slice(0, 10), time: `${hh}:${mm}` };
}

export function eventToGraphEvent(
  event: CalendarEvent,
  projectId: string,
  ctx: EventGraphContext,
): GraphEvent {
  const end = addMinutes(event.startDate, event.startTime, event.durationMinutes);
  // Invitations are strictly opt-in: without the flag the attendees array is
  // omitted entirely and the push writes a personal calendar entry, identical
  // in blast radius to every other entity's push.
  const invite = event.sendInvitations === true && ctx.attendees.length > 0;
  return {
    subject: event.title,
    isAllDay: false,
    start: { dateTime: `${event.startDate}T${event.startTime}:00`, timeZone: ctx.timeZone },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: ctx.timeZone },
    categories: [categoryFor(projectId, "event")],
    body: {
      contentType: "Text",
      content: [
        event.location ? `Location: ${event.location}` : "",
        event.notes ?? "",
        "Managed by the AIPM PM Tracker.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...(event.recurrence
      ? { recurrence: toGraphRecurrence(event.recurrence, event.startDate) }
      : {}),
    ...(invite
      ? {
          attendees: ctx.attendees.map((a) => ({
            emailAddress: { address: a.address, name: a.name },
            type: "required" as const,
          })),
        }
      : {}),
  };
}

// exceptionPlan lands in Task 5.
export type { GraphEventInstance };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/calendar-event-graph.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/calendar-event-graph.ts src/app/calendar-event-graph.test.ts
git commit -m "feat(calendar): build a timed Graph event from a meeting series"
```

---

## Task 5: `exceptionPlan`

**Files:**
- Modify: `src/app/calendar-event-graph.ts`
- Test: `src/app/calendar-event-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/calendar-event-graph.test.ts`:

```ts
import { exceptionPlan, exceptionWindow } from "./calendar-event-graph";

const SERIES: CalendarEvent = {
  id: 7,
  title: "Weekly sync",
  startDate: "2026-03-02",
  startTime: "09:30",
  durationMinutes: 60,
  recurrence: { freq: "weekly", interval: 1, byDay: ["MO"] },
};

describe("exceptionWindow", () => {
  it("is null for a series with no exceptions — no Graph call is needed", () => {
    expect(exceptionWindow(SERIES)).toBeNull();
  });

  it("spans from the earliest exception date to the latest move target, padded", () => {
    const w = exceptionWindow({
      ...SERIES,
      exceptions: [
        { date: "2026-03-09", kind: "skip" },
        { date: "2026-03-16", kind: "move", toDate: "2026-03-19" },
      ],
    });
    // 1 day of padding either side.
    expect(w).toEqual({ startDate: "2026-03-08", endDate: "2026-03-20" });
  });
});

describe("exceptionPlan", () => {
  const instances = [
    { id: "i-0302", startDateTime: "2026-03-02T09:30:00" },
    { id: "i-0309", startDateTime: "2026-03-09T09:30:00" },
    { id: "i-0316", startDateTime: "2026-03-16T09:30:00" },
  ];

  it("deletes the instance behind a skip", () => {
    const plan = exceptionPlan(
      { ...SERIES, exceptions: [{ date: "2026-03-09", kind: "skip" }] },
      instances,
      "Europe/Berlin",
    );
    expect(plan.delete).toEqual(["i-0309"]);
    expect(plan.patch).toEqual([]);
  });

  it("patches the instance behind a move to its new start and end", () => {
    const plan = exceptionPlan(
      { ...SERIES, exceptions: [{ date: "2026-03-16", kind: "move", toDate: "2026-03-19" }] },
      instances,
      "Europe/Berlin",
    );
    expect(plan.patch).toEqual([
      {
        instanceId: "i-0316",
        start: { dateTime: "2026-03-19T09:30:00", timeZone: "Europe/Berlin" },
        end: { dateTime: "2026-03-19T10:30:00", timeZone: "Europe/Berlin" },
      },
    ]);
    expect(plan.delete).toEqual([]);
  });

  it("honours a move's own toTime over the series start time", () => {
    const plan = exceptionPlan(
      {
        ...SERIES,
        exceptions: [{ date: "2026-03-16", kind: "move", toDate: "2026-03-19", toTime: "14:00" }],
      },
      instances,
      "Europe/Berlin",
    );
    expect(plan.patch[0].start.dateTime).toBe("2026-03-19T14:00:00");
    expect(plan.patch[0].end.dateTime).toBe("2026-03-19T15:00:00");
  });

  it("matches an ALREADY-MOVED instance by originalStart, not by its current start", () => {
    // The 03-16 occurrence was moved to 03-19 by a previous push. Graph returns
    // it at 03-19 with originalStart 03-16. Matching on start would pick
    // nothing here — or worse, in a denser series, the wrong occurrence.
    const moved = [
      { id: "i-0302", startDateTime: "2026-03-02T09:30:00" },
      {
        id: "i-0316",
        startDateTime: "2026-03-19T09:30:00",
        originalStart: "2026-03-16T09:30:00.0000000",
      },
    ];
    const plan = exceptionPlan(
      { ...SERIES, exceptions: [{ date: "2026-03-16", kind: "move", toDate: "2026-03-23" }] },
      moved,
      "Europe/Berlin",
    );
    expect(plan.patch.map((p) => p.instanceId)).toEqual(["i-0316"]);
  });

  it("skips a move whose instance already sits at the target", () => {
    // ★ With invitations on, a redundant PATCH re-mails every attendee.
    const already = [
      {
        id: "i-0316",
        startDateTime: "2026-03-19T09:30:00",
        originalStart: "2026-03-16T09:30:00.0000000",
      },
    ];
    const plan = exceptionPlan(
      { ...SERIES, exceptions: [{ date: "2026-03-16", kind: "move", toDate: "2026-03-19" }] },
      already,
      "Europe/Berlin",
    );
    expect(plan.patch).toEqual([]);
    expect(plan.delete).toEqual([]);
  });

  it("is a no-op for a skip whose instance is already gone", () => {
    const plan = exceptionPlan(
      { ...SERIES, exceptions: [{ date: "2026-03-09", kind: "skip" }] },
      [{ id: "i-0302", startDateTime: "2026-03-02T09:30:00" }],
      "Europe/Berlin",
    );
    expect(plan).toEqual({ patch: [], delete: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-graph.test.ts`
Expected: FAIL — `exceptionPlan is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/app/calendar-event-graph.ts`, replace the trailing line
`// exceptionPlan lands in Task 5.` and the `export type { GraphEventInstance };` with:

```ts
/** How far either side of the exception dates the instance fetch reaches. */
const WINDOW_PAD_DAYS = 1;

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The instance window an exception replay needs, or null when the series has
 * no exceptions.
 *
 * Derived from the exceptions THEMSELVES rather than from an arbitrary horizon
 * or from the UI's calendar window: an exception can sit anywhere in a series,
 * and a clean series must cost ZERO extra Graph calls.
 */
export function exceptionWindow(
  event: CalendarEvent,
): { startDate: string; endDate: string } | null {
  const list = event.exceptions ?? [];
  if (list.length === 0) return null;
  const dates = list.flatMap((e) => (e.kind === "move" ? [e.date, e.toDate] : [e.date]));
  const sorted = [...dates].sort();
  return {
    startDate: shiftDate(sorted[0], -WINDOW_PAD_DAYS),
    endDate: shiftDate(sorted[sorted.length - 1], WINDOW_PAD_DAYS),
  };
}

export interface ExceptionPlan {
  patch: {
    instanceId: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  }[];
  delete: string[];
}

/**
 * Maps a series' local skip/move exceptions onto the Graph instances that
 * express them.
 *
 * ★★★ Occurrence identity is `originalStart`, NOT `startDateTime`. Graph
 * returns a modified occurrence at its NEW time and keeps the rule's original
 * position in `originalStart`. Matching on the current start would make the
 * second push treat a moved occurrence as whichever occurrence originally
 * lived on that date, and move the wrong one. Unmodified instances carry no
 * `originalStart`, so they fall back to their start.
 */
export function exceptionPlan(
  event: CalendarEvent,
  instances: readonly GraphEventInstance[],
  timeZone: string,
): ExceptionPlan {
  const plan: ExceptionPlan = { patch: [], delete: [] };
  const byOriginalDate = new Map<string, GraphEventInstance>();
  for (const inst of instances) {
    const key = (inst.originalStart ?? inst.startDateTime).slice(0, 10);
    byOriginalDate.set(key, inst);
  }

  for (const exc of event.exceptions ?? []) {
    const inst = byOriginalDate.get(exc.date);
    // Already cancelled in Outlook (or outside the window) — nothing to do.
    // Not an error: a skip whose instance is absent is exactly the state we want.
    if (!inst) continue;

    if (exc.kind === "skip") {
      plan.delete.push(inst.id);
      continue;
    }

    const time = exc.toTime ?? event.startTime;
    const start = `${exc.toDate}T${time}:00`;
    // ★★ Already at the target ⇒ no PATCH. With invitations on, a redundant
    // PATCH mails every attendee an update for a change that did not happen.
    if (inst.startDateTime.slice(0, 16) === start.slice(0, 16)) continue;

    const end = addMinutes(exc.toDate, time, event.durationMinutes);
    plan.patch.push({
      instanceId: inst.id,
      start: { dateTime: start, timeZone },
      end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
    });
  }

  return plan;
}

export type { GraphEventInstance };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-event-graph.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Mutation-check the `originalStart` claim**

Temporarily change the key line in `exceptionPlan` from

```ts
    const key = (inst.originalStart ?? inst.startDateTime).slice(0, 10);
```

to

```ts
    const key = inst.startDateTime.slice(0, 10);
```

Run: `npx vitest run src/app/calendar-event-graph.test.ts`
Expected: FAIL, and the failing test must be
**"matches an ALREADY-MOVED instance by originalStart, not by its current start"**.
★ Read WHICH test failed. If a different one fails, the headline claim is untested — fix the test
before restoring. Then restore the line and re-run to green.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/calendar-event-graph.ts src/app/calendar-event-graph.test.ts
git commit -m "feat(calendar): plan Outlook instance edits from a series' own exceptions"
```

---

## Task 6: `freeze` and `afterPush` on the shared reconcile

**Files:**
- Modify: `src/app/calendar-reconcile.ts:45-62`
- Modify: `src/app/use-entity-calendar-push.ts`
- Test: `src/app/calendar-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/calendar-reconcile.test.ts`:

```ts
describe("planEntityReconcile freeze", () => {
  const items = [
    { id: 1, outlookEventId: "ev-1" },
    { id: 2, outlookEventId: "ev-2" }, // this one is frozen
    { id: 3 },                          // frozen and unlinked
  ];
  const existing = [{ id: "ev-1" }, { id: "ev-2" }, { id: "ev-orphan" }];

  it("HOLDS a frozen item's event out of the delete set", () => {
    // ★★★ THE headline clause. Without it, every background auto-sync deletes
    // the invitation series in Outlook and mails a cancellation to every
    // attendee — the exact outcome the freeze exists to prevent.
    const plan = planEntityReconcile(items, existing, (i) => i.id === 2 || i.id === 3);
    expect(plan.delete).toEqual(["ev-orphan"]);
  });

  it("never updates a frozen item", () => {
    const plan = planEntityReconcile(items, existing, (i) => i.id === 2);
    expect(plan.update.map((u) => u.item.id)).toEqual([1]);
  });

  it("never creates a frozen, unlinked item", () => {
    const plan = planEntityReconcile(items, existing, (i) => i.id === 3);
    expect(plan.create).toEqual([]);
  });

  it("is byte-identical to the unfrozen plan when no predicate is passed", () => {
    expect(planEntityReconcile(items, existing)).toEqual(
      planEntityReconcile(items, existing, () => false),
    );
  });

  it("still deletes a genuinely orphaned event when nothing is frozen", () => {
    expect(planEntityReconcile(items, existing).delete).toEqual(["ev-orphan"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-reconcile.test.ts`
Expected: FAIL — the first test reports `expected [ 'ev-2', 'ev-orphan' ] to deeply equal
[ 'ev-orphan' ]` (the third argument is ignored today, so the frozen event is deleted).

- [ ] **Step 3: Implement `freeze`**

In `src/app/calendar-reconcile.ts`, replace `planEntityReconcile` (lines 42–62) with:

```ts
// Generic form of planCalendarReconcile: reconciles ANY entity carrying an
// outlookEventId (tasks, RAID, changes, absences, meeting series) with the
// SAME logic — present id → update + keep, absent → create, any unkept
// existing id → delete.
//
// ★★★ THE PLAN IS LIST-BASED: `items` is the DESIRED FULL STATE, and anything
// category-tagged in Outlook but absent from it is DELETED. So a caller that
// wants to leave some items alone must NOT filter them out of `items` — that
// deletes them. It passes `freeze` instead, which holds them: never created,
// never updated, and their event ids kept out of `delete`.
export function planEntityReconcile<T extends HasEventLink>(
  items: readonly T[],
  existing: readonly ExistingEvent[],
  freeze?: (item: T) => boolean,
): GenericReconcilePlan<T> {
  const keptIds = new Set<string>();
  const create: T[] = [];
  const update: { item: T; eventId: string }[] = [];
  for (const it of items) {
    if (freeze?.(it)) {
      // Held, not omitted. Adding the id to keptIds is the whole point: it is
      // what keeps the event out of the delete list below.
      if (it.outlookEventId) keptIds.add(it.outlookEventId);
      continue;
    }
    if (it.outlookEventId) {
      update.push({ item: it, eventId: it.outlookEventId });
      keptIds.add(it.outlookEventId);
    } else {
      create.push(it);
    }
  }
  const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
  return { create, update, delete: del };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-reconcile.test.ts`
Expected: PASS — existing tests plus 5 new.

- [ ] **Step 5: Mutation-check the delete clause**

Temporarily delete the line `if (it.outlookEventId) keptIds.add(it.outlookEventId);` inside the
`freeze?.(it)` branch.

Run: `npx vitest run src/app/calendar-reconcile.test.ts`
Expected: FAIL, and the failing test must be
**"HOLDS a frozen item's event out of the delete set"**.
★ Read WHICH test failed — "never updates a frozen item" still passes with this bug present, so a
red run alone proves nothing. Restore the line and re-run to green.

- [ ] **Step 6: Forward `freeze` and add `afterPush` in the hook**

In `src/app/use-entity-calendar-push.ts`, add to `interface Args<T>` after `interactive?: boolean;`:

```ts
  /** Items to HOLD: never created, never updated, and never deleted. Default
   *  undefined ⇒ every code path is byte-identical to before. See
   *  planEntityReconcile — filtering `items` instead would DELETE them. */
  freeze?: (item: T) => boolean;
  /** Runs inside the same lock, after the plan is applied, with the token and
   *  the FULL id → eventId map (pre-existing links plus the ones just
   *  created, minus the stale ones). Returns how many of its own operations
   *  failed, which is folded into the partial-failure toast.
   *
   *  ★ It has to live here rather than in a follow-up call by the caller:
   *  `setItems` is React state, so a caller chaining a second pass would read
   *  the OLD list and miss every event id the push just minted. */
  afterPush?: (ctx: { token: string; links: ReadonlyMap<number, string> }) => Promise<number>;
```

Add `freeze` and `afterPush` to the destructured parameter list on the function signature line:

```ts
export function useEntityCalendarPush<T extends HasEventLink>(
  { items, entityType, projectId, toGraphEvent, setItems, isPopout, lang, enabled, interactive = true, freeze, afterPush }: Args<T>,
) {
```

Replace the `const plan = …` line with:

```ts
      const plan = planEntityReconcile(items, existing, freeze);
```

Immediately after the `for (const id of plan.delete) { … }` loop and BEFORE the
`if (newIds.size > 0 || staleIds.size > 0)` block, insert:

```ts
      if (afterPush) {
        // Full picture of what is linked right now: what was already linked,
        // plus what this push just created, minus what turned out stale.
        const links = new Map<number, string>();
        for (const it of items) {
          if (it.outlookEventId && !staleIds.has(it.id)) links.set(it.id, it.outlookEventId);
        }
        for (const [id, eventId] of newIds) links.set(id, eventId);
        try {
          failed += await afterPush({ token, links });
        } catch (err) {
          failed++;
          logDiag("warn", "calendar.afterPushFailed", { entityType, message: err instanceof Error ? err.message : String(err) });
        }
      }
```

Add `freeze` and `afterPush` to the `useCallback` dependency array (last line of the callback):

```ts
  }, [isPopout, acquireToken, showToast, lang, items, projectId, setItems, entityType, toGraphEvent, interactive, freeze, afterPush]);
```

- [ ] **Step 7: Verify the four shipped entities are unaffected**

Run: `npx vitest run src/app/use-entity-calendar-push.test.tsx src/app/calendar-reconcile.test.ts`
Expected: PASS, with the pre-existing push tests unchanged — they pass no `freeze` and no
`afterPush`, so both new branches are skipped entirely.

- [ ] **Step 8: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/calendar-reconcile.ts src/app/calendar-reconcile.test.ts src/app/use-entity-calendar-push.ts
git commit -m "feat(calendar): let a push hold items and run a follow-up pass"
```

---

## Task 7: `replayExceptions`

**Files:**
- Create: `src/app/calendar-event-exception-push.ts`
- Test: `src/app/calendar-event-exception-push.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-event-exception-push.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CalendarEvent } from "./calendar-event";

vi.mock("./outlook-calendar-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./outlook-calendar-write")>();
  return {
    ...actual,
    listEventInstances: vi.fn(),
    updateEventInstance: vi.fn(),
    deleteEventInstance: vi.fn(),
  };
});

import {
  listEventInstances,
  updateEventInstance,
  deleteEventInstance,
  GraphCalendarError,
} from "./outlook-calendar-write";
import { replayExceptions } from "./calendar-event-exception-push";

const SERIES: CalendarEvent = {
  id: 7,
  title: "Weekly sync",
  startDate: "2026-03-02",
  startTime: "09:30",
  durationMinutes: 60,
  recurrence: { freq: "weekly", interval: 1, byDay: ["MO"] },
  exceptions: [{ date: "2026-03-09", kind: "skip" }],
};

const LINKS = new Map([[7, "master-7"]]);

beforeEach(() => {
  vi.mocked(listEventInstances).mockReset();
  vi.mocked(updateEventInstance).mockReset();
  vi.mocked(deleteEventInstance).mockReset();
});

describe("replayExceptions", () => {
  it("makes NO Graph call for a series with no exceptions", async () => {
    const failed = await replayExceptions(
      "tok",
      [{ ...SERIES, exceptions: undefined }],
      LINKS,
      "Europe/Berlin",
    );
    expect(failed).toBe(0);
    expect(listEventInstances).not.toHaveBeenCalled();
  });

  it("makes NO Graph call for a series that is not linked yet", async () => {
    const failed = await replayExceptions("tok", [SERIES], new Map(), "Europe/Berlin");
    expect(failed).toBe(0);
    expect(listEventInstances).not.toHaveBeenCalled();
  });

  it("deletes the instance behind a skip", async () => {
    vi.mocked(listEventInstances).mockResolvedValue([
      { id: "i-0309", startDateTime: "2026-03-09T09:30:00" },
    ]);
    const failed = await replayExceptions("tok", [SERIES], LINKS, "Europe/Berlin");
    expect(failed).toBe(0);
    expect(deleteEventInstance).toHaveBeenCalledWith("tok", "i-0309");
  });

  it("patches the instance behind a move", async () => {
    vi.mocked(listEventInstances).mockResolvedValue([
      { id: "i-0316", startDateTime: "2026-03-16T09:30:00" },
    ]);
    const moved: CalendarEvent = {
      ...SERIES,
      exceptions: [{ date: "2026-03-16", kind: "move", toDate: "2026-03-19" }],
    };
    await replayExceptions("tok", [moved], LINKS, "Europe/Berlin");
    expect(updateEventInstance).toHaveBeenCalledWith("tok", "i-0316", {
      start: { dateTime: "2026-03-19T09:30:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2026-03-19T10:30:00", timeZone: "Europe/Berlin" },
    });
  });

  it("counts a 404 on an instance as skipped, not failed", async () => {
    vi.mocked(listEventInstances).mockResolvedValue([
      { id: "i-0309", startDateTime: "2026-03-09T09:30:00" },
    ]);
    vi.mocked(deleteEventInstance).mockRejectedValue(new GraphCalendarError(404, "gone"));
    const failed = await replayExceptions("tok", [SERIES], LINKS, "Europe/Berlin");
    expect(failed).toBe(0);
  });

  it("counts a non-404 error as a failure and keeps going", async () => {
    vi.mocked(listEventInstances).mockResolvedValue([
      { id: "i-0309", startDateTime: "2026-03-09T09:30:00" },
    ]);
    vi.mocked(deleteEventInstance).mockRejectedValue(new GraphCalendarError(500, "boom"));
    const failed = await replayExceptions("tok", [SERIES, SERIES], LINKS, "Europe/Berlin");
    expect(failed).toBe(2);
  });

  it("counts a failed instance LIST as one failure for that series", async () => {
    vi.mocked(listEventInstances).mockRejectedValue(new GraphCalendarError(500, "boom"));
    const failed = await replayExceptions("tok", [SERIES], LINKS, "Europe/Berlin");
    expect(failed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-exception-push.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-event-exception-push"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-event-exception-push.ts`:

```ts
// Replays a meeting series' local skip/move exceptions onto its Outlook
// seriesMaster instances. Async I/O only — every decision is made by the pure
// `exceptionPlan` / `exceptionWindow` in calendar-event-graph.ts.
//
// Without this, the app and Outlook disagree the moment a user drags one
// occurrence, and S7's pull would raise the same conflict on every run forever.
import type { CalendarEvent } from "./calendar-event";
import { exceptionPlan, exceptionWindow } from "./calendar-event-graph";
import { logDiag } from "./diagnostics";
import {
  listEventInstances,
  updateEventInstance,
  deleteEventInstance,
  GraphCalendarError,
} from "./outlook-calendar-write";

/** A 404 means the instance is already gone/cancelled — the desired state, not a failure. */
function isGone(err: unknown): boolean {
  return err instanceof GraphCalendarError && err.status === 404;
}

/**
 * @returns how many operations FAILED (404s excluded). The caller folds this
 * into its partial-failure toast.
 */
export async function replayExceptions(
  token: string,
  events: readonly CalendarEvent[],
  links: ReadonlyMap<number, string>,
  timeZone: string,
): Promise<number> {
  let failed = 0;

  for (const event of events) {
    const window = exceptionWindow(event);
    const masterId = links.get(event.id);
    // No exceptions ⇒ nothing to express, and a clean series must cost ZERO
    // extra Graph calls. Not linked ⇒ the master push failed; retry next push.
    if (!window || !masterId) continue;

    let instances;
    try {
      instances = await listEventInstances(token, masterId, window.startDate, window.endDate);
    } catch (err) {
      failed++;
      logDiag("warn", "calendar.eventInstancesFailed", {
        id: event.id,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const plan = exceptionPlan(event, instances, timeZone);

    for (const p of plan.patch) {
      try {
        await updateEventInstance(token, p.instanceId, { start: p.start, end: p.end });
      } catch (err) {
        if (isGone(err)) continue;
        failed++;
        logDiag("warn", "calendar.eventExceptionFailed", {
          id: event.id, op: "patch",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const instanceId of plan.delete) {
      try {
        await deleteEventInstance(token, instanceId);
      } catch (err) {
        if (isGone(err)) continue;
        failed++;
        logDiag("warn", "calendar.eventExceptionFailed", {
          id: event.id, op: "delete",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return failed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-event-exception-push.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/calendar-event-exception-push.ts src/app/calendar-event-exception-push.test.ts
git commit -m "feat(calendar): replay a series' exceptions onto its Outlook instances"
```

---

## Task 8: `"event"` as a calendar entity type

**Files:**
- Modify: `src/app/settings-types.ts:493` and `:502-507`
- Test: `src/app/settings-types.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/settings-types.test.ts`:

```ts
describe("calendar entity types — event", () => {
  it("includes event in the roster", () => {
    expect(CALENDAR_ENTITY_TYPES).toContain("event");
  });

  it("sanitizes an event entry like every other type", () => {
    expect(sanitizeOutlookCalendar({ event: { enabled: true, auto: true } })).toEqual({
      event: { enabled: true, auto: true },
    });
  });

  it("still drops unknown keys", () => {
    expect(sanitizeOutlookCalendar({ nope: { enabled: true, auto: true } })).toBeUndefined();
  });
});
```

Make sure the file imports `CALENDAR_ENTITY_TYPES` and `sanitizeOutlookCalendar` from
`./settings-types`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/settings-types.test.ts`
Expected: FAIL — `expected [ 'task', 'raid', 'change', 'absence' ] to contain 'event'`.

- [ ] **Step 3: Implement**

In `src/app/settings-types.ts`, replace line 493:

```ts
export type CalendarEntityType = "task" | "raid" | "change" | "absence" | "event";
```

and the array at lines 502–507:

```ts
export const CALENDAR_ENTITY_TYPES: readonly CalendarEntityType[] = [
  "task",
  "raid",
  "change",
  "absence",
  "event",
];
```

`sanitizeOutlookCalendar` iterates that array, so it needs no edit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/settings-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0. (tsc will not complain about `CalendarSyncEntityRow` — its `entityType` prop
is typed `CalendarEntityType`, which merely widened.)

```bash
git add src/app/settings-types.ts src/app/settings-types.test.ts
git commit -m "feat(settings): add meeting series as a calendar sync entity type"
```

---

## Task 9: i18n strings (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, immediately after line 2058
(`calendarSyncEntityAbsence: "Resource absences (vacation/training dates)",`) insert:

```ts
  calendarSyncEntityEvent: "Meeting series (recurring meetings)",
  calendarEventAttendees: "Attendees",
  calendarEventAttendeesSearch: "Search people to invite",
  calendarEventAttendeesPlaceholder: "Type a name…",
  calendarEventAttendeeRemove: "Remove attendee",
  calendarEventAttendeeClear: "Clear",
  calendarEventSendInvitations: "Send Outlook invitations to attendees",
  calendarEventInviteConfirmTitle: "Send invitations?",
  calendarEventInviteConfirmBody:
    "Turning this on means Outlook emails a meeting invitation to {0} attendee(s) the next time this series is pushed:",
  calendarEventInviteConfirmUnreachable:
    "{0} attendee(s) have no email address and will NOT receive an invitation:",
  calendarEventInviteConfirmNobody:
    "None of the attendees has an email address, so nobody would be invited.",
  calendarEventConfirmDeleteInvited:
    "Delete this meeting series? Outlook will send a cancellation to {0} invited attendee(s).",
  calendarEventPushUnreachable:
    "{0} attendee(s) had no email address and were not invited.",
```

- [ ] **Step 2: Typecheck to see the DE parity failure**

Run: `npx tsc --noEmit`
Expected: FAIL — `i18n.de.ts` is missing the 13 new keys. This is the parity gate doing its job.

- [ ] **Step 3: Add the DE keys via a node utf8 write**

★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it. Use this script — note the `\r\n`
anchor, without which the replace silently no-ops.

Create and run `scripts/tmp-s6-de.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/i18n.de.ts";
const src = readFileSync(path, "utf8");

const anchor = '  calendarSyncEntityAbsence: "Ressourcen-Abwesenheiten (Urlaubs-/Schulungstermine)",\r\n';
if (!src.includes(anchor)) {
  console.error("anchor not found — check the exact DE string and its CRLF line ending");
  process.exit(1);
}

const added = [
  '  calendarSyncEntityEvent: "Besprechungsserien (wiederkehrende Termine)",',
  '  calendarEventAttendees: "Teilnehmer",',
  '  calendarEventAttendeesSearch: "Personen zum Einladen suchen",',
  '  calendarEventAttendeesPlaceholder: "Name eingeben…",',
  '  calendarEventAttendeeRemove: "Teilnehmer entfernen",',
  '  calendarEventAttendeeClear: "Leeren",',
  '  calendarEventSendInvitations: "Outlook-Einladungen an Teilnehmer senden",',
  '  calendarEventInviteConfirmTitle: "Einladungen senden?",',
  '  calendarEventInviteConfirmBody:',
  '    "Wenn Sie dies aktivieren, sendet Outlook beim nächsten Übertragen dieser Serie eine Besprechungseinladung an {0} Teilnehmer:",',
  '  calendarEventInviteConfirmUnreachable:',
  '    "{0} Teilnehmer haben keine E-Mail-Adresse und erhalten KEINE Einladung:",',
  '  calendarEventInviteConfirmNobody:',
  '    "Keiner der Teilnehmer hat eine E-Mail-Adresse, es würde also niemand eingeladen.",',
  '  calendarEventConfirmDeleteInvited:',
  '    "Diese Besprechungsserie löschen? Outlook sendet eine Absage an {0} eingeladene Teilnehmer.",',
  '  calendarEventPushUnreachable:',
  '    "{0} Teilnehmer hatten keine E-Mail-Adresse und wurden nicht eingeladen.",',
].join("\r\n") + "\r\n";

writeFileSync(path, src.replace(anchor, anchor + added), "utf8");
console.log("DE keys written");
```

Run:

```bash
node scripts/tmp-s6-de.mjs && rm scripts/tmp-s6-de.mjs
```

Expected: `DE keys written`.

- [ ] **Step 4: Verify the umlauts survived**

Run:

```bash
grep -c "Übertragen\|löschen\|würde" src/app/i18n.de.ts
```

Expected: `3` or more. If you see `Uebertragen`, `loeschen` or a mojibake sequence, revert the file
(`git checkout src/app/i18n.de.ts`) and re-run the script — do **not** hand-fix it with Edit.

- [ ] **Step 5: Run the encoding guard and typecheck**

Run: `npx vitest run src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: both pass — the ASCII-substitution ban is satisfied and EN/DE key sets match.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: strings for meeting-series calendar sync and invitations"
```

---

## Task 10: Settings row for meeting series

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx:408-414`
- Test: `src/app/settings-sections/integrations-section.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/settings-sections/integrations-section.test.tsx`, inside its existing top-level
`describe`:

```ts
it("renders an enable checkbox for the meeting-series entity", () => {
  renderIntegrations({ /* use the file's existing helper + M365-enabled settings */ });
  expect(
    screen.getByRole("checkbox", { name: "Enable Outlook sync – Meeting series (recurring meetings)" }),
  ).toBeInTheDocument();
});
```

★ Match the file's existing render helper and the exact EN wording of `calendarSyncEnable` — read a
neighbouring absence-row assertion in the same file and copy its shape rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/settings-sections/integrations-section.test.tsx`
Expected: FAIL — unable to find a checkbox with that name.

- [ ] **Step 3: Implement**

In `src/app/settings-sections/integrations-section.tsx`, immediately after the absence
`<CalendarSyncEntityRow …/>` (which ends at line 414) insert:

```tsx
            <CalendarSyncEntityRow
              lang={lang}
              settings={settings}
              onChange={onChange}
              entityType="event"
              labelKey="calendarSyncEntityEvent"
            />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/settings-sections/integrations-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the axe gate on Settings**

★ Use a FRESH isolated server, never the long-running one:

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
PORT=3100 npm run stop
```

Expected: PASS. `CalendarSyncEntityRow` already labels both checkboxes, so this is a confirmation,
not a fix.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx
git commit -m "feat(settings): expose meeting-series Outlook sync"
```

---

## Task 11: Entity-qualify the Push/Pull accessible names

**Files:**
- Modify: `src/app/calendar-sync-controls.tsx:62-63` and `:75-76`
- Test: `src/app/calendar-sync-controls.test.tsx` plus any caller test that queries by those names

★ Why: the Calendar sub-tab is about to render a SECOND `CalendarSyncControls` (absences + meeting
series). Only the enable checkbox is entity-qualified today, so both Push buttons would announce
"Push to Outlook" — a WCAG 2.4.6 collision the axe gate cannot see, because axe detects missing
names, never duplicate ones.

- [ ] **Step 1: Find every test that queries these names**

Run:

```bash
grep -rn "calendarPush\|Push to Outlook\|Pull from Outlook" src/app --include=*.test.tsx
```

Expected: a list of assertions to update in Step 4. Note them before changing anything.

- [ ] **Step 2: Write the failing test**

Append to `src/app/calendar-sync-controls.test.tsx`:

```tsx
it("qualifies the push and pull names with the entity, so two instances never collide", () => {
  render(
    <>
      <CalendarSyncControls
        lang="en-US"
        entityLabelKey="calendarSyncEntityAbsence"
        m365Configured
        calendarEnabled
        onToggleCalendar={() => {}}
        onPushCalendar={() => {}}
      />
      <CalendarSyncControls
        lang="en-US"
        entityLabelKey="calendarSyncEntityEvent"
        m365Configured
        calendarEnabled
        onToggleCalendar={() => {}}
        onPushCalendar={() => {}}
      />
    </>,
  );
  const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("Push to Outlook – Meeting series (recurring meetings)");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-sync-controls.test.tsx`
Expected: FAIL — `expected 1 to be 2` (both buttons carry the identical name today).

- [ ] **Step 4: Implement**

In `src/app/calendar-sync-controls.tsx`, add right after the `if (!(m365Configured …)) return null;`
guard:

```tsx
  // The VISIBLE text stays the short verb; only the accessible name is
  // qualified, so a pane rendering two of these (Calendar: absences + meeting
  // series) gives screen-reader users two distinct names. axe cannot see a
  // duplicate name, so this is the only thing standing between us and a
  // WCAG 2.4.6 failure nothing would report.
  const entity = t(lang, entityLabelKey);
```

Change the push button's `aria-label` (line 62) to:

```tsx
          aria-label={`${t(lang, "calendarPush")} – ${entity}`}
```

and the pull button's `aria-label` (line 75) to:

```tsx
          aria-label={`${t(lang, "calendarPull")} – ${entity}`}
```

Leave both `title` attributes as the short unqualified label — the same split
`EntityLinkPicker`'s remove button uses.

- [ ] **Step 5: Fix the caller tests found in Step 1**

For each hit, change the expected name from `"Push to Outlook"` to
`"Push to Outlook – <entity label>"` (likewise for Pull). Queries that match the visible **text**
rather than the accessible name are unaffected and must not be touched.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:run`
Expected: PASS, no regressions.

- [ ] **Step 7: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/calendar-sync-controls.tsx src/app/calendar-sync-controls.test.tsx
git commit -m "fix(a11y): name the Outlook push and pull buttons by entity"
```

---

## Task 12: Wire the event push in `use-calendar-integrations`

**Files:**
- Modify: `src/app/use-calendar-integrations.ts`

★ This file is in `vitest.config.ts` `coverage.exclude` — it is render-scope UI glue. Its behaviour
is covered by the pure modules Tasks 1–7 already tested plus the task-manager characterization
suite. Do not add a unit test for it, and do not remove its exclude entry.

- [ ] **Step 1: Extend the deps interface**

In `src/app/use-calendar-integrations.ts`, add to `CalendarIntegrationDeps` after `setAbsences`:

```ts
  calendarEvents: readonly CalendarEvent[];
  setCalendarEvents: Dispatch<SetStateAction<readonly CalendarEvent[] | undefined>>;
  resources: readonly Resource[];
```

Add to the imports at the top:

```ts
import type { Resource } from "./types";
import type { CalendarEvent } from "./calendar-event";
import { eventToGraphEvent } from "./calendar-event-graph";
import { resolveAttendees } from "./calendar-event-attendees";
import { replayExceptions } from "./calendar-event-exception-push";
import { resolveTimezone } from "./timezone";
import type { EntityCalendarProps } from "./workspace-section-types";
```

(`Resource` joins the existing `./types` import — merge it into that line rather than adding a
second import from the same module, which lint flags.)

Add `calendarEvents`, `setCalendarEvents` and `resources` to the destructuring block that starts at
line 62.

- [ ] **Step 2: Add the event block**

Insert immediately before the `// --- Background auto-pull (two-way SP5)` comment:

```ts
  // --- Meeting-series calendar write-back (S6) ---
  //
  // Unlike the four date-only entities, a series pushes as ONE recurring
  // seriesMaster carrying a Graph recurrence, and its local skip/move
  // exceptions are replayed onto that master's instances in `afterPush`.
  const eventSync = calendarSyncFor(settings, "event");
  const calendarEventEnabled = eventSync.enabled && m365Enabled && !isPopout;
  const eventAutoSyncActive = eventSync.auto && m365Enabled && !isPopout;
  // Every series is pushable — a series always has a startDate.
  const pushableEvents = useMemo(() => calendarEvents ?? [], [calendarEvents]);
  // EXCLUDES outlookEventId — an OUTPUT the push writes back. Includes the
  // recurrence, the exceptions and the attendee set, because all three change
  // what Graph must be told.
  const eventAutoSyncKey = useMemo(
    () => pushableEvents
      .map((e) => [
        e.id, e.title, e.startDate, e.startTime, e.durationMinutes,
        e.location ?? "", e.notes ?? "",
        JSON.stringify(e.recurrence ?? null),
        JSON.stringify(e.exceptions ?? null),
        JSON.stringify(e.attendeeResourceIds ?? null),
        e.sendInvitations === true ? "1" : "0",
      ].join("|"))
      .join(";"),
    [pushableEvents],
  );
  const setEventsForCalendar = useCallback(
    (updater: (prev: CalendarEvent[]) => CalendarEvent[]) =>
      setCalendarEvents((prev) => updater([...(prev ?? [])])),
    [setCalendarEvents],
  );
  // The project's EFFECTIVE zone (TZ-1), never UTC: a meeting is a wall-clock
  // commitment in a place.
  const eventTimeZone = resolveTimezone(settings.timezone, project?.operatingTimezone);
  // ★ MUST be memoized: useEntityCalendarPush lists toGraphEvent in its
  // useCallback deps, so an unstable identity would churn pushToOutlook every
  // render.
  const eventToGraph = useCallback(
    (e: CalendarEvent, pid: string) =>
      eventToGraphEvent(e, pid, {
        timeZone: eventTimeZone,
        attendees: resolveAttendees(e.attendeeResourceIds, resources).reachable,
      }),
    [eventTimeZone, resources],
  );
  const replayEventExceptions = useCallback(
    ({ token, links }: { token: string; links: ReadonlyMap<number, string> }) =>
      replayExceptions(token, pushableEvents, links, eventTimeZone),
    [pushableEvents, eventTimeZone],
  );
  const { pushToOutlook: pushEventsToOutlook, busy: calendarEventPushBusy } =
    useEntityCalendarPush<CalendarEvent>({
      items: pushableEvents, entityType: "event", projectId: calendarProjectId,
      toGraphEvent: eventToGraph, setItems: setEventsForCalendar,
      afterPush: replayEventExceptions,
      isPopout, lang, enabled: calendarEventEnabled,
    });
  // ★★★ The background instance FREEZES invitation series — it does NOT filter
  // them out of `items`. planEntityReconcile is list-based, so omitting them
  // would DELETE their Outlook events and mail a cancellation to every
  // attendee. Freezing holds them: untouched, and kept out of the delete set.
  // Net effect: a series with invitations on is manual-push only, so a third
  // party is never emailed without a click.
  const { pushToOutlook: autoPushEvents } = useEntityCalendarPush<CalendarEvent>({
    items: pushableEvents, entityType: "event", projectId: calendarProjectId,
    toGraphEvent: eventToGraph, setItems: setEventsForCalendar,
    afterPush: replayEventExceptions,
    freeze: (e) => e.sendInvitations === true,
    isPopout, lang, enabled: eventAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: eventAutoSyncActive, contentKey: eventAutoSyncKey, push: autoPushEvents, staggerMs: AUTO_SYNC_STAGGER_STEP_MS * 4 });
  const onToggleCalendarEvent = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        event: { enabled, auto: enabled ? (s.outlookCalendar?.event?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
```

- [ ] **Step 2b: Report unreachable attendees after a manual push**

Spec §7: unreachable attendees are *reported*, never silently dropped. The confirm says it once at
opt-in; the push must say it again, because the directory can change between the two.

Add `import { useToastContext } from "./toast-context";` and, near the top of
`useCalendarIntegrations`, `const showToast = useToastContext();`
(★ check first — if the hook already calls it, reuse that binding; a second call is harmless but
lint flags the unused one.)

Then wrap the manual push. Place this directly after the `useEntityCalendarPush` call that produces
`pushEventsToOutlook`, and rename that binding to `pushEventSeries`:

```ts
  // Reported, not dropped: someone the user believes is invited but who has no
  // address is a fact about the push, so it is said at push time and not only
  // in the opt-in confirm — the directory can change in between.
  const unreachableCount = useMemo(
    () => pushableEvents
      .filter((e) => e.sendInvitations === true)
      .reduce((n, e) => n + resolveAttendees(e.attendeeResourceIds, resources).unreachable.length, 0),
    [pushableEvents, resources],
  );
  const pushEventsToOutlook = useCallback(async () => {
    await pushEventSeries();
    if (unreachableCount > 0) {
      showToast("info", t(lang, "calendarEventPushUnreachable", unreachableCount));
    }
  }, [pushEventSeries, unreachableCount, showToast, lang]);
```

★ Only the MANUAL push reports. The background instance stays fully silent, like every other
background auto-sync in this file.

- [ ] **Step 3: Build both pane bags here and return them**

Replace the `// absence` group at the end of the `return` block (lines 393–398) with:

```ts
    // absence
    calendarAbsenceEnabled,
    onToggleCalendarAbsence,
    pushAbsenceToOutlook,
    calendarAbsencePushBusy,
    absencePull,
    // Pane bags, assembled HERE rather than in task-manager: this hook already
    // owns every value they are made of, and task-manager sits at its
    // file-size ratchet with no room to grow.
    absenceCalendar: {
      enabled: calendarAbsenceEnabled,
      onToggle: onToggleCalendarAbsence,
      onPush: pushAbsenceToOutlook,
      pushBusy: calendarAbsencePushBusy,
      onPull: calendarAbsenceEnabled ? absencePull.pull : undefined,
      pullBusy: calendarAbsenceEnabled ? absencePull.busy : undefined,
    } satisfies EntityCalendarProps,
    // meeting series (S6): push only — pull is S7, so no onPull/pullBusy.
    eventCalendar: {
      enabled: calendarEventEnabled,
      onToggle: onToggleCalendarEvent,
      onPush: pushEventsToOutlook,
      pushBusy: calendarEventPushBusy,
    } satisfies EntityCalendarProps,
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc FAILS on `task-manager.tsx` — it does not yet pass the three new deps. That is
expected and Task 13 fixes it. Lint should be clean for this file.

- [ ] **Step 5: Commit (with Task 13 — this does not compile alone)**

Do not commit yet. Continue straight to Task 13.

---

## Task 13: Thread the bag to the Resources pane

**Files:**
- Modify: `src/app/task-manager.tsx` (net **−4** lines)
- Modify: `src/app/workspace-section-types.ts`
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/resources-panel.tsx`

- [ ] **Step 1: Record the ratchet baseline**

Run: `node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"`
Expected: `2973`. The baseline is 2974, so the file may end at **2974 or fewer** lines. It will end
lower.

- [ ] **Step 2: `task-manager.tsx` — pass the three new deps**

In the `useCalendarIntegrations({ … })` argument object (starts line 2087), add after `setAbsences,`:

```ts
    calendarEvents,
    setCalendarEvents,
    resources,
```

(`calendarEvents` and `setCalendarEvents` already exist in scope from `useWorkspace()`; `resources`
likewise. If any is missing, read the surrounding destructuring and add it there — do NOT introduce
a new `useWorkspace()` call.)

- [ ] **Step 3: `task-manager.tsx` — take the bags from the hook**

In the destructuring block (lines 2063–2086), add two lines after `absencePull,`:

```ts
    absenceCalendar,
    eventCalendar,
```

- [ ] **Step 4: `task-manager.tsx` — replace the inline absence bag and add the event bag**

Replace the eight lines at 2153–2160:

```ts
    absenceCalendar: {
      enabled: calendarAbsenceEnabled,
      onToggle: onToggleCalendarAbsence,
      onPush: pushAbsenceToOutlook,
      pushBusy: calendarAbsencePushBusy,
      onPull: calendarAbsenceEnabled ? absencePull.pull : undefined,
      pullBusy: calendarAbsenceEnabled ? absencePull.busy : undefined,
    },
```

with two:

```ts
    absenceCalendar,
    eventCalendar,
```

Net for the file: `+3 (deps) +2 (destructure) −8 +2 = −1` … recount against the real file and
confirm below.

- [ ] **Step 5: Verify the file shrank**

Run: `node scripts/check-file-sizes.mjs`
Expected: `file-size ratchet ok`.

Run: `node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"`
Expected: **2972** (2973 + 3 + 2 − 8 + 2). If it reads 2975 or more, the ratchet will fail — remove
the now-unused `calendarAbsenceEnabled` / `onToggleCalendarAbsence` / `pushAbsenceToOutlook` /
`calendarAbsencePushBusy` names from the destructuring block **only if** a repo-wide
`grep -n "calendarAbsenceEnabled" src/app/task-manager.tsx` shows no other use. Never run
`check-file-sizes.mjs --update`.

- [ ] **Step 6: `workspace-section-types.ts` — declare the prop**

Find `absenceCalendar` in `WorkspaceSectionProps` and add directly beneath it:

```ts
  /** Meeting-series Outlook write-back (S6). Push only — pull is S7. Absent in popouts. */
  eventCalendar?: EntityCalendarProps;
```

- [ ] **Step 7: `workspace-section.tsx` — thread it**

Add `eventCalendar,` to the props destructuring beside `absenceCalendar,` (line 211).

In the `<ResourcesPanel … />` block, after `calendarPullBusy={absenceCalendar?.pullBusy}`
(line 548), add:

```tsx
              eventCalendar={eventCalendar}
```

- [ ] **Step 8: `resources-panel.tsx` — accept and render it**

Add to the props interface, right after `calendarPullBusy?: boolean;` (line 141):

```ts
  /** Meeting-series Outlook write-back (S6). Rendered on the calendar sub-tab
   *  only — that is the sub-tab meeting series exist on. */
  eventCalendar?: EntityCalendarProps;
```

Add `eventCalendar,` to the component's destructured parameters beside `calendarPullBusy,`.

Add the import:

```ts
import type { EntityCalendarProps } from "./workspace-section-types";
```

In `headerActions`, immediately after the existing absence `<CalendarSyncControls … />` block
(which closes at line 470), add:

```tsx
      {view === "calendar" && eventCalendar && (
        <CalendarSyncControls
          lang={lang}
          entityLabelKey="calendarSyncEntityEvent"
          m365Configured={m365Configured}
          isPopout={isPopout}
          calendarEnabled={eventCalendar.enabled}
          onToggleCalendar={eventCalendar.onToggle}
          onPushCalendar={eventCalendar.onPush}
          calendarPushBusy={eventCalendar.pushBusy}
        />
      )}
```

- [ ] **Step 9: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npm run test:run`
Expected: all three clean. The task-manager characterization suite must still pass —
`absenceCalendar` reaches `WorkspaceSection` with an identical shape, only built elsewhere.

- [ ] **Step 10: Commit**

```bash
git add src/app/use-calendar-integrations.ts src/app/task-manager.tsx src/app/workspace-section-types.ts src/app/workspace-section.tsx src/app/resources-panel.tsx
git commit -m "feat(calendar): push meeting series to Outlook from the calendar sub-tab"
```

---

## Task 14: The attendee field

**Files:**
- Create: `src/app/calendar-event-attendees-field.tsx`
- Test: `src/app/calendar-event-attendees-field.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-event-attendees-field.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarEventAttendeesField } from "./calendar-event-attendees-field";
import type { Resource } from "./types";

function res(id: number, firstName: string, lastName: string, email?: string): Resource {
  return { id, firstName, lastName, email, roleId: null, utilizationMode: "percent", utilization: {} } as Resource;
}

const RESOURCES = [
  res(1, "Ada", "Lovelace", "ada@example.com"),
  res(2, "Grace", "Hopper"),
];

function setup(over: Partial<React.ComponentProps<typeof CalendarEventAttendeesField>> = {}) {
  const onChangeAttendees = vi.fn();
  const onRequestInvitations = vi.fn();
  render(
    <CalendarEventAttendeesField
      lang="en-US"
      resources={RESOURCES}
      attendeeResourceIds={[1]}
      sendInvitations={false}
      onChangeAttendees={onChangeAttendees}
      onRequestInvitations={onRequestInvitations}
      {...over}
    />,
  );
  return { onChangeAttendees, onRequestInvitations };
}

describe("CalendarEventAttendeesField", () => {
  it("renders a chip per attendee", () => {
    setup();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("gives each remove button a row-unique name", () => {
    setup({ attendeeResourceIds: [1, 2] });
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((n): n is string => !!n && n.startsWith("Remove attendee"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("routes turning invitations ON through the confirm request, not straight to state", () => {
    const { onRequestInvitations, onChangeAttendees } = setup();
    return userEvent
      .click(screen.getByRole("checkbox", { name: "Send Outlook invitations to attendees" }))
      .then(() => {
        expect(onRequestInvitations).toHaveBeenCalledWith(true);
        expect(onChangeAttendees).not.toHaveBeenCalled();
      });
  });

  it("turning invitations OFF needs no confirm ceremony", async () => {
    const { onRequestInvitations } = setup({ sendInvitations: true });
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Send Outlook invitations to attendees" }),
    );
    expect(onRequestInvitations).toHaveBeenCalledWith(false);
  });

  it("names unreachable attendees so nobody is silently skipped", () => {
    setup({ attendeeResourceIds: [1, 2], sendInvitations: true });
    expect(screen.getByText(/Grace Hopper/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-attendees-field.test.tsx`
Expected: FAIL — `Failed to resolve import "./calendar-event-attendees-field"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-event-attendees-field.tsx`:

```tsx
"use client";

// Attendee picker + invitations toggle for the meeting-series editor.
// Presentational and props-only — it holds the search query and nothing else,
// so it unit-tests without any provider.
//
// ★ The toggle NEVER writes sendInvitations itself. Turning it on has to pass
// through the parent's confirm, because this is the only surface in the app
// that emails third parties and a push must not be the first time the user
// learns it will.
import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import type { Resource } from "./types";
import { resolveAttendees } from "./calendar-event-attendees";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import { Checkbox } from "./form-controls";
import { FieldHint } from "./field-hint";

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  attendeeResourceIds: readonly number[] | undefined;
  sendInvitations: boolean;
  onChangeAttendees: (ids: number[]) => void;
  /** Asks the PARENT to change the flag. On `true` the parent confirms first. */
  onRequestInvitations: (next: boolean) => void;
}

function initials(r: Resource): string {
  return `${r.firstName.charAt(0)}${r.lastName.charAt(0)}`.toUpperCase();
}

function entryOf(r: Resource): LinkPickerEntry {
  return { id: r.id, code: initials(r), label: `${r.firstName} ${r.lastName}`.trim() };
}

export function CalendarEventAttendeesField({
  lang,
  resources,
  attendeeResourceIds,
  sendInvitations,
  onChangeAttendees,
  onRequestInvitations,
}: Props) {
  const [query, setQuery] = useState("");
  const ids = useMemo(() => attendeeResourceIds ?? [], [attendeeResourceIds]);

  const selected = useMemo(() => {
    const byId = new Map(resources.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id);
      // A dangling id is KEPT and shown as unresolved — the CalendarEvent
      // contract, and the honest thing to render for someone who was invited
      // before their record was deleted.
      return r ? entryOf(r) : { id, code: `#${id}`, label: `#${id}` };
    });
  }, [ids, resources]);

  // The picker takes ALREADY-filtered options: it owns the keyboard, the
  // caller owns which entities are linkable.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(ids);
    return resources
      .filter((r) => !taken.has(r.id))
      .filter((r) => `${r.firstName} ${r.lastName} ${r.email ?? ""}`.toLowerCase().includes(q))
      .map(entryOf);
  }, [query, resources, ids]);

  const resolved = resolveAttendees(ids, resources);

  return (
    <div className="flex flex-col gap-2 text-sm sm:col-span-2">
      <span className="font-medium text-foreground">{t(lang, "calendarEventAttendees")}</span>
      <EntityLinkPicker
        selected={selected}
        options={options}
        query={query}
        onQueryChange={setQuery}
        onAdd={(id) => {
          onChangeAttendees([...ids, id]);
          setQuery("");
        }}
        onRemove={(id) => onChangeAttendees(ids.filter((x) => x !== id))}
        searchLabel={t(lang, "calendarEventAttendeesSearch")}
        placeholder={t(lang, "calendarEventAttendeesPlaceholder")}
        removeLabel={t(lang, "calendarEventAttendeeRemove")}
        clearLabel={t(lang, "calendarEventAttendeeClear")}
      />

      <label className="flex items-center gap-2">
        <Checkbox
          checked={sendInvitations}
          aria-label={t(lang, "calendarEventSendInvitations")}
          onChange={(e) => onRequestInvitations(e.target.checked)}
        />
        <span>{t(lang, "calendarEventSendInvitations")}</span>
      </label>

      {sendInvitations && resolved.unreachable.length > 0 && (
        <FieldHint>
          {t(lang, "calendarEventInviteConfirmUnreachable", resolved.unreachable.length)}{" "}
          {resolved.unreachable.map((u) => u.name).join(", ")}
        </FieldHint>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-event-attendees-field.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

```bash
git add src/app/calendar-event-attendees-field.tsx src/app/calendar-event-attendees-field.test.tsx
git commit -m "feat(calendar): pick meeting attendees and opt into invitations"
```

---

## Task 15: Mount the field, the confirm, and the invitation-aware delete

**Files:**
- Modify: `src/app/calendar-event-modal.tsx`
- Modify: `src/app/app-modals.tsx`
- Test: `src/app/calendar-event-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/calendar-event-modal.test.tsx`:

```tsx
describe("attendees and invitations", () => {
  const RESOURCES = [
    { id: 1, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", roleId: null, utilizationMode: "percent", utilization: {} },
  ] as unknown as Resource[];

  it("persists sendInvitations only after the confirm is accepted", async () => {
    const onSave = vi.fn();
    // The file's existing helper renders inside ConfirmProvider; reuse it.
    renderModal({
      resources: RESOURCES,
      event: { ...BASE_EVENT, attendeeResourceIds: [1] },
      onSave,
    });

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Send Outlook invitations to attendees" }),
    );
    // The confirm names the recipient count and the address.
    expect(await screen.findByText(/ada@example\.com/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /confirm|ok|yes/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sendInvitations: true }),
      expect.anything(),
    );
  });

  it("leaves sendInvitations unset when the confirm is cancelled", async () => {
    const onSave = vi.fn();
    renderModal({
      resources: RESOURCES,
      event: { ...BASE_EVENT, attendeeResourceIds: [1] },
      onSave,
    });

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Send Outlook invitations to attendees" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel|no/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sendInvitations: undefined }),
      expect.anything(),
    );
  });

  it("turning invitations OFF asks for no confirm", async () => {
    const onSave = vi.fn();
    renderModal({
      resources: RESOURCES,
      event: { ...BASE_EVENT, attendeeResourceIds: [1], sendInvitations: true },
      onSave,
    });
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Send Outlook invitations to attendees" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sendInvitations: undefined }),
      expect.anything(),
    );
  });
});
```

★ Adapt `renderModal` / `BASE_EVENT` to whatever the file already defines, and read the
`ConfirmProvider` dialog's real button labels before writing the `/confirm|ok|yes/i` matcher —
guessing them is how this test goes vacuous.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/calendar-event-modal.test.tsx`
Expected: FAIL — no checkbox named "Send Outlook invitations to attendees".

- [ ] **Step 3: Add the `resources` prop and mount the field**

In `src/app/calendar-event-modal.tsx`:

Replace the stale header comment at lines 29–31:

```
// NO attendees field: attendeeResourceIds/sendInvitations stay on the model
// and persist untouched, but get no UI until the Outlook invitations that
// give them purpose ship (0.203.0).
```

with:

```
// Attendees live in calendar-event-attendees-field.tsx (S6). The invitations
// flag NEVER flips straight from the checkbox — turning it on routes through a
// confirm that names the resolved recipients and lists anyone unreachable,
// because this is the only surface in the app that emails third parties.
```

Add imports:

```ts
import type { Resource } from "./types";
import { CalendarEventAttendeesField } from "./calendar-event-attendees-field";
import { resolveAttendees } from "./calendar-event-attendees";
```

Add to `interface Props`:

```ts
  /** Directory used to resolve attendees to names and addresses. */
  resources: readonly Resource[];
```

Add `resources` to the destructured parameters on line 121.

Add this handler beside `handleDeleteClick`:

```tsx
  async function handleRequestInvitations(next: boolean) {
    if (!draft) return;
    // Off needs no ceremony — removing people from a mailing list is not the
    // dangerous direction.
    if (!next) {
      setDraft((prev) => (prev ? { ...prev, sendInvitations: undefined } : prev));
      return;
    }
    const resolved = resolveAttendees(draft.attendeeResourceIds, resources);
    const lines = [
      resolved.reachable.length > 0
        ? `${t(lang, "calendarEventInviteConfirmBody", resolved.reachable.length)}\n${resolved.reachable.map((r) => `${r.name} <${r.address}>`).join("\n")}`
        : t(lang, "calendarEventInviteConfirmNobody"),
      resolved.unreachable.length > 0
        ? `${t(lang, "calendarEventInviteConfirmUnreachable", resolved.unreachable.length)}\n${resolved.unreachable.map((u) => u.name).join("\n")}`
        : "",
    ].filter(Boolean);
    if (await confirm({ message: lines.join("\n\n") })) {
      setDraft((prev) => (prev ? { ...prev, sendInvitations: true } : prev));
    }
  }
```

Render the field immediately before `{error && <ModalFieldError error={error} />}`:

```tsx
      {isVisible("attendees") && (
        <CalendarEventAttendeesField
          lang={lang}
          resources={resources}
          attendeeResourceIds={draft.attendeeResourceIds}
          sendInvitations={draft.sendInvitations === true}
          onChangeAttendees={(ids) =>
            setDraft((prev) => (prev ? { ...prev, attendeeResourceIds: ids.length ? ids : undefined } : prev))
          }
          onRequestInvitations={handleRequestInvitations}
        />
      )}
```

★ `isVisible("attendees")` requires an `attendees` entry in this modal's `MODAL_FIELDS` row. Add it
in `src/app/modal-fields.ts` beside the existing `calendarEvent` fields (`title`, `occurrence`,
`location`, `repeat`) — a missing entry is not a type error here, it just makes the field
permanently hidden.

- [ ] **Step 4: Make the delete confirm invitation-aware**

Replace `handleDeleteClick`'s body:

```tsx
  async function handleDeleteClick() {
    if (!draft) return;
    const invited =
      draft.sendInvitations === true
        ? resolveAttendees(draft.attendeeResourceIds, resources).reachable.length
        : 0;
    // Deleting cancels the Outlook meeting, which mails every invitee. The
    // existing confirm is the right place to say so — a SECOND dialog on a
    // path the user already confirmed just trains dismissal.
    const message =
      invited > 0
        ? t(lang, "calendarEventConfirmDeleteInvited", invited)
        : t(lang, "calendarEventConfirmDelete");
    if (await confirm({ message })) {
      onDelete(draft.id);
    }
  }
```

- [ ] **Step 5: Thread `resources` from `app-modals.tsx`**

In `src/app/app-modals.tsx`, add `resources: readonly Resource[];` to its props interface (import
`Resource` from `./types` if it is not already imported), add `resources,` to the destructuring, and
pass it at line 225:

```tsx
        <CalendarEventModal
          resources={resources}
```

Then in `task-manager.tsx`, add `resources={resources}` to the `<AppModals … />` call around line
2708. ★ That is **+1 line** to a file the ratchet has −2 lines of slack for after Task 13 (2972 vs
2974). Re-run `node scripts/check-file-sizes.mjs` and confirm `ok`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/app/calendar-event-modal.test.tsx`
Expected: PASS.

- [ ] **Step 7: Full suite, typecheck, lint**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/calendar-event-modal.tsx src/app/calendar-event-modal.test.tsx src/app/app-modals.tsx src/app/task-manager.tsx src/app/modal-fields.ts
git commit -m "feat(calendar): invite attendees to a meeting series behind a confirm"
```

---

## Task 16: Security review of the invitation path

**Files:** none — this is a review gate.

- [ ] **Step 1: Run the security reviewer over the invitation surface**

Use the `ecc:security-reviewer` agent (or `/security-review`) scoped to:

```
src/app/calendar-event-attendees.ts
src/app/calendar-event-attendees-field.tsx
src/app/calendar-event-graph.ts
src/app/calendar-event-exception-push.ts
src/app/calendar-event-modal.tsx
src/app/use-calendar-integrations.ts
```

Ask specifically:
1. Can `sendInvitations` become `true` on any path that does not pass the confirm?
2. Can an email address reach `logDiag`, a toast, or an error message?
3. Can the background auto-push ever mail a third party?

- [ ] **Step 2: Verify no address reaches diagnostics**

Run:

```bash
grep -n "logDiag" src/app/calendar-event-exception-push.ts src/app/use-calendar-integrations.ts
```

Expected: every call passes only ids, counts, an op name, and an error message — **no** `address`,
`email`, `attendees` or `reachable` field. The diagnostics ring is user-exportable and addresses
are PII. Fix any that does before continuing.

- [ ] **Step 3: Address CRITICAL and HIGH findings, then commit**

```bash
git add -A
git commit -m "fix(calendar): address security review findings on the invitation path"
```

(If there are no findings, skip the commit and record that in the task notes.)

---

## Task 17: Release chain

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Confirm the codename is still unused**

Run: `grep -ci "Bodard" CHANGELOG.md`
Expected: `0`. If it is not 0, use `Samatar` (also verified 0 at planning time) and re-check.

- [ ] **Step 2: Bump the version**

In `src/app/version.ts` set `APP_VERSION = "0.209.0"` and the milestone to `"Bodard"`.

- [ ] **Step 3: Add the highlight key**

In `src/app/i18n.ts` add:

```ts
  versionHighlight0209: "Meeting series now push to Outlook as one recurring event — including moved and skipped occurrences, and with optional attendee invitations.",
```

Append `"versionHighlight0209"` to `APP_HIGHLIGHT_KEYS`.

Add the DE string with the same node-script technique as Task 9 (anchor on the previous
`versionHighlight*` DE line, `\r\n`, then grep-verify):

```ts
  versionHighlight0209: "Besprechungsserien werden jetzt als ein wiederkehrender Outlook-Termin übertragen – inklusive verschobener und ausgelassener Termine sowie optionaler Teilnehmereinladungen.",
```

- [ ] **Step 4: CHANGELOG entry**

Add at the top of `CHANGELOG.md`, matching the file's existing format:

```markdown
## 0.209.0 "Bodard"

- Meeting series push to Outlook as a single recurring event under a type-scoped category, so a
  milestone or committee push can never touch them.
- Local moved and skipped occurrences are replayed onto the Outlook series, so the app and the
  calendar agree occurrence by occurrence.
- Attendees can be picked on a series and, on explicit opt-in behind a confirm that names every
  recipient and every unreachable person, receive real Outlook invitations.
- Background auto-sync holds invitation series instead of pushing them, so no third party is ever
  emailed without a click.
```

- [ ] **Step 5: Full gate run**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run test:coverage
npm run dup:check
npm run size:check
npm run build
```

Expected: all pass. ★ If `npm run lint` reports errors in `playwright-report/`, a failed e2e run left
minified vendor files behind — delete `playwright-report/` and re-run before believing it.

- [ ] **Step 6: axe on a FRESH isolated server**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium
PORT=3100 npm run stop
```

Expected: full pass. Never reuse the long-running dev server for this.

- [ ] **Step 7: Eye-verify what the gate cannot see**

The Calendar sub-tab is **not** in `A11Y_VIEWS`. Check by hand, at ~375px and at desktop width:

1. Two `CalendarSyncControls` on the calendar sub-tab, whose Push buttons read
   "Push to Outlook – Resource absences…" and "Push to Outlook – Meeting series…" (inspect the
   accessible names, not the visible text — both still read "Push to Outlook").
2. `Tab` through the attendee field: every chip's × is reachable and announces a distinct name.
3. Turn invitations on with attendees present → the confirm names the addresses; cancel → the
   checkbox returns to off.
4. Contrast of the unreachable `FieldHint` on `bg-surface-muted` — Calendar has shipped an AA
   failure before precisely because it is unscanned.

- [ ] **Step 8: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(release): 0.209.0 Bodard"
```

- [ ] **Step 9: Re-archive the superpowers tree — CUMULATIVE**

★★★ A walk-the-tree zip is a strict SUBSET of the existing archives (the tree was pruned; ~298
historical documents live only inside them). Merge every prior archive and assert the superset
property before trusting the result.

```python
# scripts/tmp-archive.py — delete after running
import zipfile, glob, os

olds = sorted(glob.glob("docs/superpowers/_archive-slice-docs-*.zip"), key=os.path.getmtime, reverse=True)
new_path = "docs/superpowers/_archive-slice-docs-2026-07-29.zip"

seen = {}
for root, _, files in os.walk("docs/superpowers"):
    for f in files:
        if f.endswith(".zip"): continue
        p = os.path.join(root, f)
        seen[os.path.relpath(p, "docs/superpowers").replace("\\", "/")] = open(p, "rb").read()

for old in olds:                      # newest first; working tree already wins
    with zipfile.ZipFile(old) as z:
        for n in z.namelist():
            seen.setdefault(n, z.read(n))

with zipfile.ZipFile(new_path, "w", zipfile.ZIP_DEFLATED) as out:
    for n, data in sorted(seen.items()):
        out.writestr(n, data)

with zipfile.ZipFile(new_path) as new:
    names = set(new.namelist())
    for old in olds:
        with zipfile.ZipFile(old) as z:
            missing = set(z.namelist()) - names
            assert not missing, f"{old} has {len(missing)} entries the new archive lost"
print(f"archive ok: {len(names)} entries, superset of all {len(olds)} priors")
```

★ Do **not** use `sorted(glob)[-1]`: `-` (0x2D) sorts before `.` (0x2E), so
`_archive-...-2026-07-28-slice-d.zip` sorts after `_archive-...-2026-07-28.zip` and the
lexicographic last is not the newest. This script merges **all** of them, so the ordering only
decides collision precedence.

Run it, then:

```bash
git add -f docs/superpowers/_archive-slice-docs-2026-07-29.zip
git commit -m "docs: cumulative superpowers archive for slice S6"
```

Expected output: `archive ok: 342 entries, superset of all 6 priors` (or more).

---

## Notes carried from the spec

- `docs/superpowers/` is **gitignored** by explicit project decision. The spec and this plan are
  local-only; only the archive zip is force-added. Do not `git add -f` the markdown.
- `use-calendar-integrations.ts` stays in `coverage.exclude`. The three new pure modules and
  `calendar-event-exception-push.ts` are **coverage-gated** — do not add them to the exclude list.
- S7 (pull) is out of scope. It gets a sibling `calendar-event-pull.ts` with a per-occurrence
  baseline key; `planCalendarPull`'s date-only `PullEntity`/`PulledEvent` must not be widened.
