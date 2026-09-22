# AI Calendar Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI assistant read and write absences and calendar events, with every write readable on the staged review card and every dangerous field guarded.

**Architecture:** Seven new tools mirroring the stakeholder five end to end — schema in `chat-tool-defs.ts`, dispatch case in `chat-tools.ts`, writer in `use-register-tools.ts`. Two `INLINE_DESCRIPTORS` entries make staged rows readable, two `dropUnaccepted*Fields` guards keep sync-owned fields out of model patches, and one payload rule in `shouldStage` forces any invitation-sending write through the review card.

**Tech Stack:** TypeScript, React 19, Next 16, vitest. No new dependencies.

**Branch:** `feat/preview-write-path-parity-sweep`, at `826b8206`, based on `origin/main` = `02d67e15` (0.291.1 "Hoban").

**NO release and NO version bump in this plan.** Do not touch `src/app/version.ts`, `CHANGELOG.md`, `package.json` or any version satellite.

---

## Ground rules for every task

These are repo-wide and cost real time when forgotten. Read once, apply throughout.

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports `tail`'s status. Always:
   ```bash
   npx vitest run --maxWorkers=1 <files> > "$SP/out.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/out.log"
   ```
   where `SP` is the session scratchpad directory. `$TMPDIR` is UNSET in this Git Bash — `"$TMPDIR/x"` collapses to `/x` and fails with "Permission denied", writing nothing.

2. **Every `src/app/*.ts(x)` file is CRLF.** Use the Edit tool, never `sed -i` (it silently re-lines the whole file to LF). A node/python anchored write must match `\r\n`, not `\n`, or it is a guaranteed no-op.

3. **Never edit `src/app/i18n.de.ts` with the Edit tool** — it corrupts umlauts and curls quotes. Patch it with an anchored node UTF-8 write using real umlaut characters, then assert `bare LF === 0`.

4. **`npx tsc --noEmit` after editing ANY test.** `next build` does not typecheck test files and vitest never typechecks, so a test-only type error passes both and fails CI. It exits **2** on diagnostics, not 1.

5. **Never run two vitest processes at once.** `Failed to start forks worker` is machine contention, not a broken suite.

6. **Mutation-prove every behavioural claim.** Record it as `N failed / M passed`, and the sum MUST equal the file's runtime test count. Revert each mutant with an anchored inverse write that asserts uniqueness in BOTH directions, and end on an empty `git diff --stat`.

7. **Never `git add -A` or `git add .`** Commit with `git commit --only <explicit paths>`. The working tree carries `sample-workspace-huge.json` (modified by another session) and `not-in-use.env.local.bak` (untracked, holds live credentials). Never stage, open or print either.

8. **Never `--amend`** — this worktree is shared.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/calendar-recurrence-text.ts` | Pure projection of `RecurrenceRule` → one human-readable line | **Create** |
| `src/app/calendar-recurrence-text.test.ts` | Its tests | **Create** |
| `src/app/chat-tools.ts` | `AbsenceInput` / `CalendarEventInput` / summary types, dispatcher method signatures, seven dispatch cases | Modify |
| `src/app/chat-tool-defs.ts` | Seven tool schemas | Modify |
| `src/app/use-register-tools.ts` | Eight writer implementations over workspace setters | Modify |
| `src/app/sanitize-records.ts` | `ABSENCE_FIELD_GUARDS` + `CALENDAR_EVENT_FIELD_GUARDS` and their two `dropUnaccepted*Fields` | Modify |
| `src/app/ai-entity-token.ts` | `TokenEntity` gains two members; `TOKEN_EXCLUDED` gains two rows | Modify |
| `src/app/chat-proposal-apply.ts` | `TOKEN_ROW_SOURCE` gains two entries | Modify |
| `src/app/chat-proposal.ts` | `ENTITY_WRITE_TOOLS`, `DESTRUCTIVE_TOOLS`, and the `sendInvitations` payload rule | Modify |
| `src/app/inline-ai-edit/entity-descriptor.ts` | Two `INLINE_DESCRIPTORS` entries | Modify |
| `src/app/task-manager.tsx` | Thread absences + calendar events into `useRegisterTools` | Modify |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | Field labels for the new diff fields | Modify |

**Order matters.** Tasks 1–3 are leaves with no dependants. Task 4 (token registry) must precede Task 6 (dispatch cases), because `requireToken` will not compile for an entity `TokenEntity` does not name.

---

## Task 1: The recurrence projection

The review card renders a `FieldDiff` as before/after STRINGS. `RecurrenceRule` is a three-shape union, so without this a staged recurrence change shows a JSON blob on the one surface meant to make writes refusable.

**Files:**
- Create: `src/app/calendar-recurrence-text.ts`
- Create: `src/app/calendar-recurrence-text.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/calendar-recurrence-text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { recurrenceText } from "./calendar-recurrence-text";

describe("recurrenceText", () => {
  it("describes a plain daily rule", () => {
    expect(recurrenceText({ freq: "daily", interval: 1 })).toBe("Every day");
  });

  it("uses the interval when it is not 1", () => {
    expect(recurrenceText({ freq: "daily", interval: 3 })).toBe("Every 3 days");
  });

  it("names the weekdays of a weekly rule", () => {
    expect(recurrenceText({ freq: "weekly", interval: 1, byDay: ["MO", "WE"] })).toBe(
      "Every week on MO, WE",
    );
  });

  it("describes a monthly rule by day of month", () => {
    expect(recurrenceText({ freq: "monthly", interval: 2, byMonthDay: 15 })).toBe(
      "Every 2 months on day 15",
    );
  });

  it("describes a monthly rule by ordinal weekday", () => {
    expect(
      recurrenceText({ freq: "monthly", interval: 1, byDay: { ordinal: -1, day: "FR" } }),
    ).toBe("Every month on the last FR");
  });

  it("appends an until date", () => {
    expect(recurrenceText({ freq: "daily", interval: 1, until: "2026-12-01" })).toBe(
      "Every day until 2026-12-01",
    );
  });

  it("appends an occurrence count", () => {
    expect(recurrenceText({ freq: "daily", interval: 1, count: 10 })).toBe(
      "Every day, 10 times",
    );
  });

  // ★★ THE NEGATIVE CONTROL. This function is fed by a MODEL patch, so it will
  // meet shapes the type says are impossible. Returning "" for those is what
  // lets the descriptor fall back to its own empty rendering instead of
  // printing "undefined" onto the review card.
  it("returns an empty string for anything that is not a rule", () => {
    expect(recurrenceText(null)).toBe("");
    expect(recurrenceText(undefined)).toBe("");
    expect(recurrenceText({ freq: "hourly", interval: 1 } as never)).toBe("");
    expect(recurrenceText({ interval: 2 } as never)).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
npx vitest run --maxWorkers=1 src/app/calendar-recurrence-text.test.ts > "$SP/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find" "$SP/t1.log"
```
Expected: EXIT=1, "Cannot find module './calendar-recurrence-text'".

- [ ] **Step 3: Write the implementation**

Create `src/app/calendar-recurrence-text.ts`:

```ts
// src/app/calendar-recurrence-text.ts — one human line for a RecurrenceRule.
//
// ★★★ IT EXISTS FOR THE REVIEW CARD. `describeEntityCalls` renders a FieldDiff
// as before/after STRINGS, so without this a staged recurrence change reaches
// the card as a JSON blob — on the one surface whose whole job is letting a
// user refuse a write they understand.
//
// ★★ DOM-FREE AND i18n-FREE BY CONTRACT, like every engine under this app's
// pure-module convention. It is fed by a MODEL patch, so it must accept
// `unknown` and answer "" rather than throwing: the descriptor then renders its
// own empty state instead of the string "undefined".

import type { RecurrenceRule } from "./calendar-event";

const FREQ_UNIT: Readonly<Record<string, [string, string]>> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

function isRule(v: unknown): v is RecurrenceRule {
  if (typeof v !== "object" || v === null) return false;
  const freq = (v as { freq?: unknown }).freq;
  return typeof freq === "string" && freq in FREQ_UNIT;
}

/** `Every day` · `Every 2 weeks on MO, WE` · `Every month on the last FR`,
 *  with an optional ` until <date>` or `, N times` tail. "" for a non-rule. */
export function recurrenceText(rule: unknown): string {
  if (!isRule(rule)) return "";
  const r = rule as RecurrenceRule & {
    byDay?: unknown;
    byMonthDay?: unknown;
    until?: unknown;
    count?: unknown;
  };
  const interval = typeof r.interval === "number" && r.interval > 1 ? r.interval : 1;
  const [one, many] = FREQ_UNIT[r.freq];
  let out = interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;

  if (r.freq === "weekly" && Array.isArray(r.byDay) && r.byDay.length > 0) {
    out += ` on ${r.byDay.join(", ")}`;
  }
  if (r.freq === "monthly") {
    if (typeof r.byMonthDay === "number") {
      out += ` on day ${r.byMonthDay}`;
    } else if (typeof r.byDay === "object" && r.byDay !== null) {
      const { ordinal, day } = r.byDay as { ordinal?: unknown; day?: unknown };
      if (typeof day === "string" && typeof ordinal === "number") {
        const which = ordinal === -1 ? "last" : `${ordinal}`;
        out += ` on the ${which} ${day}`;
      }
    }
  }

  if (typeof r.until === "string" && r.until !== "") return `${out} until ${r.until}`;
  if (typeof r.count === "number") return `${out}, ${r.count} times`;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --maxWorkers=1 src/app/calendar-recurrence-text.test.ts > "$SP/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/t1.log"
```
Expected: EXIT=0, `Tests 8 passed (8)`.

- [ ] **Step 5: Mutation-prove the interval branch**

Change `interval > 1` to `interval > 0` in `calendar-recurrence-text.ts`, re-run, and record `N failed / M passed`. Expected: the "Every day" and "Every week on MO, WE" cases red. Then revert with an anchored inverse write and confirm `git diff --stat` is empty for that file.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"
git commit --only src/app/calendar-recurrence-text.ts src/app/calendar-recurrence-text.test.ts -F <message file>
```
Message subject: `feat(calendar): a human line for a recurrence rule`.

---

## Task 2: The merge-site guards

`patchWithoutId(input, kind)` forwards **whatever the model emitted** minus `id`, `expectedToken` and `TOKEN_EXCLUDED[kind]` (open-followups §418 — structural, not an omission). Without a guard, a hallucinated `outlookEventId` re-points a real Outlook item and a model-written `localModifiedAt` lies to sync.

**Files:**
- Modify: `src/app/sanitize-records.ts`
- Test: `src/app/sanitize-absence-patch.test.ts` (**Create**), `src/app/sanitize-calendar-event-patch.test.ts` (**Create**)

Read `dropUnacceptedStakeholderFields` and `STAKEHOLDER_FIELD_GUARDS` in `src/app/sanitize-records.ts` first — the new tables mirror their shape exactly.

- [ ] **Step 1: Write the failing tests**

Create `src/app/sanitize-absence-patch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dropUnacceptedAbsenceFields } from "./sanitize-records";

describe("dropUnacceptedAbsenceFields", () => {
  it("keeps the fields a model may legitimately set", () => {
    const patch = {
      assignee: "Ada",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      type: "vacation",
      note: "Leave",
    };
    expect(dropUnacceptedAbsenceFields({ ...patch })).toEqual(patch);
  });

  // ★★★ THE POINT OF THE GUARD. Both fields are sync bookkeeping: a
  // model-written outlookEventId re-points or orphans a real Outlook item, and
  // a model-written localModifiedAt lies to conflict detection about when this
  // row last changed.
  it("drops the sync-owned fields", () => {
    const out = dropUnacceptedAbsenceFields({
      assignee: "Ada",
      outlookEventId: "AAMkAD",
      localModifiedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(out).toEqual({ assignee: "Ada" });
  });

  it("drops an unrecognised absence type rather than letting the sanitizer reset it", () => {
    expect(dropUnacceptedAbsenceFields({ type: "sabbatical" })).toEqual({});
    expect(dropUnacceptedAbsenceFields({ type: "sick" })).toEqual({ type: "sick" });
  });
});
```

Create `src/app/sanitize-calendar-event-patch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dropUnacceptedCalendarEventFields } from "./sanitize-records";

describe("dropUnacceptedCalendarEventFields", () => {
  it("keeps the fields a model may legitimately set", () => {
    const patch = {
      title: "Kickoff",
      startDate: "2026-06-01",
      startTime: "09:00",
      durationMinutes: 60,
      location: "Room 1",
      notes: "Bring the plan",
      attendeeResourceIds: [1, 2],
    };
    expect(dropUnacceptedCalendarEventFields({ ...patch })).toEqual(patch);
  });

  it("drops the sync-owned fields", () => {
    const out = dropUnacceptedCalendarEventFields({
      title: "Kickoff",
      outlookEventId: "AAMkAD",
      localModifiedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(out).toEqual({ title: "Kickoff" });
  });

  // ★★★ THE DELIBERATE NON-DROP, and it is as load-bearing as the drops. The
  // user's scope decision is that the model MAY set sendInvitations — mailing
  // attendees is a real outward effect — and that safety comes from
  // `shouldStage` forcing such a call through the review card instead. A guard
  // that quietly dropped it would make that staging rule unreachable and the
  // feature silently inert.
  it("keeps sendInvitations, which the staging rule covers instead", () => {
    expect(dropUnacceptedCalendarEventFields({ sendInvitations: true })).toEqual({
      sendInvitations: true,
    });
  });

  it("drops exceptions, which are per-occurrence bookkeeping the UI owns", () => {
    expect(
      dropUnacceptedCalendarEventFields({ exceptions: [{ date: "2026-06-02", kind: "skip" }] }),
    ).toEqual({});
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

```bash
npx vitest run --maxWorkers=1 src/app/sanitize-absence-patch.test.ts src/app/sanitize-calendar-event-patch.test.ts > "$SP/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find|is not a function" "$SP/t2.log"
```
Expected: EXIT=1, the two exports missing.

- [ ] **Step 3: Implement the guards**

Add to `src/app/sanitize-records.ts`, beside the four existing guard tables. Import `ABSENCE_TYPES` from `./types` if it is not already imported.

```ts
/** Which model-supplied absence fields survive the merge.
 *
 *  ★★★ IT EXISTS BECAUSE `patchWithoutId` FORWARDS EVERYTHING. The model's
 *   patch reaches the writer with only `id`, `expectedToken` and the token
 *   exclusions removed (open-followups §418), so any key absent from this table
 *   is a key the model can write. `outlookEventId` and `localModifiedAt` are
 *   owned by sync and are the reason this table is not optional.
 *
 *  ★★ `type` is dropped rather than corrected when unrecognised. `sanitizeAbsence`
 *   RESETS an unknown type to a fallback, and a reset is invisible on the review
 *   card — the same silent-demotion shape `dropUnacceptedStakeholderFields`
 *   exists for. */
const ABSENCE_FIELD_GUARDS: Readonly<Record<string, (v: unknown) => boolean>> = {
  assignee: (v) => typeof v === "string",
  assigneeEmail: (v) => typeof v === "string",
  startDate: (v) => typeof v === "string",
  endDate: (v) => typeof v === "string",
  type: (v) => typeof v === "string" && (ABSENCE_TYPES as readonly string[]).includes(v),
  note: (v) => typeof v === "string",
  resourceId: (v) => typeof v === "number" || v === null,
};

export function dropUnacceptedAbsenceFields<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    const accepts = ABSENCE_FIELD_GUARDS[field];
    if (accepts && accepts(value)) out[field] = value;
  }
  return out as T;
}

/** Which model-supplied calendar-event fields survive the merge.
 *
 *  ★★★ `sendInvitations` IS DELIBERATELY PRESENT. It mails attendees — the one
 *   effect here that leaves the building — and the user's scope decision was to
 *   allow it and force any such call through the staged review card
 *   (`shouldStage`). Dropping it here would make that staging rule unreachable.
 *
 *  ★★ `exceptions` is ABSENT on purpose: per-occurrence skip/move bookkeeping
 *   the UI writes when a user edits one instance. There is no phrasing a model
 *   could use for it that a reviewer could check at a glance. */
const CALENDAR_EVENT_FIELD_GUARDS: Readonly<Record<string, (v: unknown) => boolean>> = {
  title: (v) => typeof v === "string",
  startDate: (v) => typeof v === "string",
  startTime: (v) => typeof v === "string",
  durationMinutes: (v) => typeof v === "number" && Number.isFinite(v),
  location: (v) => typeof v === "string",
  notes: (v) => typeof v === "string",
  attendeeResourceIds: (v) => Array.isArray(v) && v.every((n) => typeof n === "number"),
  sendInvitations: (v) => typeof v === "boolean",
  recurrence: (v) => typeof v === "object" && v !== null,
};

export function dropUnacceptedCalendarEventFields<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    const accepts = CALENDAR_EVENT_FIELD_GUARDS[field];
    if (accepts && accepts(value)) out[field] = value;
  }
  return out as T;
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run --maxWorkers=1 src/app/sanitize-absence-patch.test.ts src/app/sanitize-calendar-event-patch.test.ts > "$SP/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/t2.log"
```
Expected: EXIT=0, `Tests 7 passed (7)`.

- [ ] **Step 5: Mutation-prove the guard is doing the work**

Add `outlookEventId: () => true` to `CALENDAR_EVENT_FIELD_GUARDS`, re-run, record `N failed / M passed` (expect the drop test red). Revert with an anchored inverse write, then confirm `git diff --stat` shows only the intended file.

- [ ] **Step 6: Typecheck and commit**

`npx tsc --noEmit` → EXIT=0. Commit the three files. Subject: `feat(calendar): guard the model's absence and event patches`.

---

## Task 3: The i18n field labels

`fieldLabel` falls back to the raw property name when a field has no key, so the card would read "durationMinutes" rather than "Duration".

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/inline-ai-edit/field-labels.ts`

- [ ] **Step 1: Read how an existing entity's field labels are keyed**

```bash
grep -n "fieldLabel" -A 30 src/app/inline-ai-edit/field-labels.ts | head -40
```
Note the exact key naming convention in use, and follow it rather than inventing one.

- [ ] **Step 2: Add the EN keys**

Add to `src/app/i18n.ts` with the Edit tool, following the convention Step 1 established. The fields needing labels: `assignee`, `startDate`, `endDate`, `type`, `note`, `title`, `startTime`, `durationMinutes`, `location`, `notes`, `attendeeResourceIds`, `sendInvitations`, `recurrence`. Reuse an existing key wherever one already covers the field (several do — `title`, `notes`, `location` are likely present already); only add what is genuinely missing.

- [ ] **Step 3: Add the DE keys by anchored node write**

Never the Edit tool for `i18n.de.ts`. Use a script with real umlaut characters that asserts, before and after: anchor count is exactly 1, the key is not already present, and `bare LF === 0`.

- [ ] **Step 4: Verify parity and encoding**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"
npx vitest run --maxWorkers=1 src/app/i18n-encoding.test.ts src/app/i18n.test.ts > "$SP/i18n.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/i18n.log"
```
`tsc` enforces EN/DE key parity; the encoding test bans ASCII substitutions like `ue` for `ü`.

- [ ] **Step 5: Commit.** Subject: `feat(calendar): field labels for the new diff fields`.

---

## Task 4: The token registry

`requireToken` will not compile for an entity `TokenEntity` does not name, so this must land before the dispatch cases in Task 6.

**Files:**
- Modify: `src/app/ai-entity-token.ts`
- Modify: `src/app/chat-proposal-apply.ts`

- [ ] **Step 1: Extend `TokenEntity`**

In `src/app/ai-entity-token.ts`:

```ts
export type TokenEntity =
  | "task" | "raid" | "milestone" | "change" | "stakeholder" | "resource"
  | "absence" | "calendarEvent";
```

- [ ] **Step 2: Add the two `TOKEN_EXCLUDED` rows**

```ts
  absence: ["localModifiedAt", "outlookEventId"],
  calendarEvent: ["localModifiedAt", "outlookEventId"],
```

★★★ Read the rule on that constant before changing it: **a field may be excluded only if no `update_*` tool lets the model choose its value.** Both exclusions are legitimate precisely because Task 2's guards drop those two fields from every model patch. `ai-entity-token.test.ts` asserts the exclusion set is disjoint from what the tools actually accept, driving the real dispatch path — so if Task 2 were skipped, this step would correctly go red.

- [ ] **Step 3: Add the `TOKEN_ROW_SOURCE` entries**

In `src/app/chat-proposal-apply.ts`, beside the existing rows:

```ts
  update_absence: { kind: "absence", getRow: (d, id) => d.getAbsenceRow(id) },
  update_calendar_event: { kind: "calendarEvent", getRow: (d, id) => d.getCalendarEventRow(id) },
```

These reference dispatcher methods added in Task 5; expect `tsc` to fail here until Task 5 lands. That ordering is deliberate — the alternative is a stub that typechecks and does nothing.

- [ ] **Step 4: Run the token suite**

```bash
npx vitest run --maxWorkers=1 src/app/ai-entity-token.test.ts > "$SP/t4.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |×" "$SP/t4.log"
```
Expected after Task 5: EXIT=0.

- [ ] **Step 5: Commit** together with Task 5, since Tasks 4 and 5 do not typecheck apart. Subject: `feat(calendar): token identity for absences and events`.

---

## Task 5: Dispatcher types and writers

**Files:**
- Modify: `src/app/chat-tools.ts` (types + interface methods)
- Modify: `src/app/use-register-tools.ts` (implementations)
- Modify: `src/app/task-manager.tsx` (thread the deps)

- [ ] **Step 1: Add the input and summary types**

In `src/app/chat-tools.ts`, beside `StakeholderInput`:

```ts
/** Loose write-tool inputs: the model supplies these, the dispatcher routes
 *  them through the entity sanitizer which enforces enums/caps/required fields
 *  and fills defaults. Only the human-required fields are non-optional here. */
export type AbsenceInput = {
  assignee: string;
  startDate: string;
  endDate: string;
  assigneeEmail?: string;
  type?: string;
  note?: string;
  resourceId?: number;
};

export type AbsenceSummary = {
  id: number;
  assignee: string;
  startDate: string;
  endDate: string;
  type: string;
  note?: string;
};

export type CalendarEventInput = {
  title: string;
  startDate: string;
  startTime?: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
  attendeeResourceIds?: number[];
  sendInvitations?: boolean;
  recurrence?: unknown;
};

export type CalendarEventSummary = {
  id: number;
  title: string;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  location?: string;
  recurrence?: string;
};
```

★ `CalendarEventSummary.recurrence` is the `recurrenceText` STRING, not the rule — a summary is what the model reads back, and a rendered line is what it can repeat to the user.

- [ ] **Step 2: Add the dispatcher methods to the `ToolDispatcher` interface**

```ts
  getAbsenceRow(id: number): Absence | null;
  listAbsences(): AbsenceSummary[];
  createAbsence(input: AbsenceInput): AbsenceSummary;
  updateAbsence(id: number, patch: Partial<AbsenceInput>): AbsenceSummary | null;
  deleteAbsence(id: number): boolean;

  getCalendarEventRow(id: number): CalendarEvent | null;
  createCalendarEvent(input: CalendarEventInput): CalendarEventSummary;
  updateCalendarEvent(id: number, patch: Partial<CalendarEventInput>): CalendarEventSummary | null;
  deleteCalendarEvent(id: number): boolean;
```

- [ ] **Step 3: Implement the writers**

In `src/app/use-register-tools.ts`, mirroring `createStakeholder` / `updateStakeholder` / `deleteStakeholder` exactly. Every one of these properties is load-bearing and copied deliberately:

- `if (isReadOnly) throw readOnlyError();` first in every writer;
- create mints via `mintId("absence", absencesRef.current)` and routes through `sanitizeAbsence`, throwing when it returns null;
- update merges `{ ...existing, ...dropUnacceptedAbsenceFields(patch), id, localModifiedAt: new Date().toISOString() }`;
- update and delete both `captureComposite` for undo, passing the **STORED** row as `edited`, never the merged one;
- both maintain `absencesRef.current` alongside the setter, because later calls in the same turn read the ref;
- `logActivityAs?.("ai", "absence.created", item.id, item.assignee)` and the matching updated/deleted events.

Repeat the same shape for calendar events against `calendarEventsRef` / `setCalendarEvents` / `sanitizeCalendarEvent`.

- [ ] **Step 4: Thread the new deps from `task-manager.tsx`**

`setAbsences` and `setCalendarEvents` are already in scope there (`task-manager.tsx:271` and `:304`). Add them plus the arrays to the `useRegisterTools` deps object, following exactly how `stakeholders` / `setStakeholders` are already passed.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"; grep "error TS" "$SP/tsc.log" | head
```
Expected: EXIT=0, including the Task 4 entries that could not compile before.

- [ ] **Step 6: Commit Tasks 4 and 5 together.**

---

## Task 6: Tool schemas and dispatch cases

**Files:**
- Modify: `src/app/chat-tool-defs.ts`
- Modify: `src/app/chat-tools.ts` (the `switch`)

- [ ] **Step 1: Add the seven schemas**

In `src/app/chat-tool-defs.ts`, mirroring the stakeholder block at `:717`. Define `absenceFields` and `calendarEventFields` property bags beside the existing `stakeholderFields`, then:

- `list_absences` — no required input.
- `create_absence` — `required: ["assignee", "startDate", "endDate"]`.
- `update_absence` — `properties: { id: { type: "number" }, ...expectedTokenField, ...absenceFields }`, `required: ["id", "expectedToken"]`.
- `delete_absence` — `required: ["id"]`.
- `create_calendar_event` — `required: ["title", "startDate"]`.
- `update_calendar_event` — `required: ["id", "expectedToken"]`.
- `delete_calendar_event` — `required: ["id"]`.

★★ The `expectedToken` in the two update schemas is what puts them in `TOKEN_REQUIRED_TOOLS` — that set is DERIVED from `TOOL_DEFS` by filtering on `required.includes("expectedToken")`, so there is no separate registry to edit and no way to forget one half.

★ `sendInvitations` gets an explicit description saying it emails attendees, so the model does not set it casually.

- [ ] **Step 2: Add the seven dispatch cases**

In `src/app/chat-tools.ts`, mirroring `:763-780` exactly:

```ts
    case "create_absence":
      return d.createAbsence(input as AbsenceInput);

    case "update_absence": {
      const id = requireId(input);
      const current = d.getAbsenceRow(id);
      if (!current) throw new Error(`absence #${id} not found`);
      requireToken("absence", current, input, `absence #${id}`);
      const updated = d.updateAbsence(id, patchWithoutId(input, "absence"));
      if (!updated) throw new Error(`absence #${id} not found`);
      return updated;
    }

    case "delete_absence": {
      const id = requireId(input);
      if (!d.deleteAbsence(id)) throw new Error(`absence #${id} not found`);
      return { deleted: id };
    }
```

and the three calendar-event equivalents against `calendarEvent`, plus `case "list_absences": return d.listAbsences();`.

- [ ] **Step 3: Typecheck and run the tool suites**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "EXIT=$?"
npx vitest run --maxWorkers=1 src/app/chat-tools.test.ts src/app/chat-tool-defs.test.ts > "$SP/t6.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |×" "$SP/t6.log"
```

- [ ] **Step 4: Commit.** Subject: `feat(calendar): seven tools for absences and events`.

---

## Task 7: Staging — the classification ripple and the invitation rule

**Files:**
- Modify: `src/app/chat-proposal.ts`
- Modify: `src/app/chat-proposal.test.ts`

- [ ] **Step 1: Run the classification suite FIRST, to see the expected red**

```bash
npx vitest run --maxWorkers=1 src/app/chat-proposal.test.ts > "$SP/t7a.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |×" "$SP/t7a.log"
```
Expected: RED. That file partitions the live `TOOL_DEFS` against a literal list of **seven** `create_*` tools, and two new ones landed in Task 6. This is the known ripple the spec records — the assertion working, not breaking.

- [ ] **Step 2: Update the partition, without weakening it**

Add `"create_absence"` and `"create_calendar_event"` to the literal list. **Do not** replace the list with a prefix filter: it exists to catch a `create_*` tool that is not an entity write, and deriving it from the same prefix `isCreateTool` uses would make it tautological.

- [ ] **Step 3: Add the new names to the two sets**

In `src/app/chat-proposal.ts`: `ENTITY_WRITE_TOOLS` gains all six write tools; `DESTRUCTIVE_TOOLS` gains `delete_absence` and `delete_calendar_event`.

- [ ] **Step 4: Write the failing test for the invitation rule**

Add to `src/app/chat-proposal.test.ts`:

```ts
describe("shouldStage — invitations", () => {
  const call = (name: string, input: Record<string, unknown>) => ({ name, input, useId: "t1" });

  // ★★★ A SINGLE EVENT WRITE IS NOT OTHERWISE STAGED. It is neither destructive
  // nor a second write, so without this rule it applies unreviewed — and unlike
  // every other write in the app its effect leaves the building: it mails the
  // attendees, and the undo engine cannot recall a sent invitation.
  it("stages a lone event write that would send invitations", () => {
    expect(shouldStage([call("create_calendar_event", { title: "X", sendInvitations: true })])).toBe(
      true,
    );
  });

  // ★★ THE OTHER HALF, and it is what stops a stage-everything mutant passing.
  // A rule that staged every calendar write would satisfy the test above while
  // making the review card routine — and a card the user clears reflexively
  // stops being read, which is the reasoning `isDestructiveCall` already
  // records for update_document.
  it("does not stage the same write without invitations", () => {
    expect(shouldStage([call("create_calendar_event", { title: "X" })])).toBe(false);
    expect(
      shouldStage([call("create_calendar_event", { title: "X", sendInvitations: false })]),
    ).toBe(false);
  });

  it("survives a malformed payload rather than throwing", () => {
    expect(shouldStage([call("create_calendar_event", { sendInvitations: "yes" })])).toBe(false);
  });
});
```

- [ ] **Step 5: Implement the payload rule**

In `src/app/chat-proposal.ts`, mirroring how `isDestructiveCall` special-cases `update_document`:

```ts
/** True when this call would email attendees.
 *
 *  ★★★ A PAYLOAD TEST, NOT A NAME TEST, and the precedent is `isDestructiveCall`
 *   above: the tool NAME cannot answer it, because the same tool is harmless
 *   without this one field. Sending an invitation is the only effect in the app
 *   that leaves the building and that the undo engine cannot reverse, so it is
 *   forced through the review card however few writes the turn carries.
 *
 *  ★★ NOT added to `DESTRUCTIVE_TOOLS`: that set drives the card's destructive
 *   LABELLING, and an invitation is not a deletion. Conflating them would
 *   mislabel the row. */
function sendsInvitations(call: ProposedCall): boolean {
  if (call.name !== "create_calendar_event" && call.name !== "update_calendar_event") return false;
  return (call.input as { sendInvitations?: unknown }).sendInvitations === true;
}
```

and in `shouldStage`, inside the loop, beside the destructive check:

```ts
    if (sendsInvitations(c)) return true;
```

- [ ] **Step 6: Run to verify green**

```bash
npx vitest run --maxWorkers=1 src/app/chat-proposal.test.ts > "$SP/t7b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/t7b.log"
```

- [ ] **Step 7: Mutation-prove the rule**

Replace `=== true` with `!== undefined`, re-run, record `N failed / M passed` (the `sendInvitations: "yes"` and `false` cases go red). Revert with an anchored inverse write asserting uniqueness both directions; end on an empty `git diff --stat`.

- [ ] **Step 8: Commit.** Subject: `feat(calendar): stage any write that would email attendees`.

---

## Task 8: The two descriptor entries

Without these the review card renders a staged calendar write as a bare tool name — the rows `chat-proposal-block.tsx`'s header calls "the rows that most need to be VISIBLE".

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`

- [ ] **Step 1: Read the stakeholder entry**

```bash
grep -n 'entity: "stakeholder"' -A 25 src/app/inline-ai-edit/entity-descriptor.ts
```

- [ ] **Step 2: Add the absence entry**

```ts
  absence: {
    entity: "absence", updateTool: "update_absence", deleteTool: "delete_absence",
    createTool: "create_absence", wsKey: "absences",
    diffFields: ["assignee", "assigneeEmail", "startDate", "endDate", "type", "note"],
    requiredNonEmpty: new Set(["assignee", "startDate", "endDate"]),
    requiredNonEmptyGroups: [],
    dateFields: new Set(["startDate", "endDate"]),
    numericFields: {},
    stringOnlyFields: new Set(),
    enumFields: { type: constSet(ABSENCE_TYPES) },
    emailFormatFields: new Set(["assigneeEmail"]),
    arrayFields: new Set(),
    numberFields: new Set(["resourceId"]),
    // Mirrors `sanitizeAbsence` (sanitize-entities.ts). Read that function for
    // each cap rather than assuming a family from the field name — the repo has
    // already been bitten by `notes` being trimmed where a sibling was not.
    fieldSanitizers: { /* per-field, read off sanitizeAbsence */ },
  },
```

★ Fill `fieldSanitizers` by reading `sanitizeAbsence` field by field. Do not copy another entity's caps: the parity sweep specced beside this plan exists precisely because descriptor and sanitizer drift.

- [ ] **Step 3: Add the calendar-event entry**

Same shape, with `wsKey: "calendarEvents"`, `dateFields: new Set(["startDate"])`, `numberFields: new Set(["durationMinutes"])`, `arrayFields: new Set(["attendeeResourceIds"])`, and `recurrence` projected through `recurrenceText` from Task 1 so the card shows a sentence rather than a blob.

- [ ] **Step 4: Run the parity sweep**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > "$SP/t8.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |×" "$SP/t8.log"
```

★★★ **CORRECTED — THIS SENTENCE WAS FALSE.** That sweep does NOT enumerate `INLINE_DESCRIPTORS`; its `CASES` is a hardcoded array whose floors are computed FROM `CASES`, so an absent entity shrinks the denominator with it and nothing reds. Both entities needed rows added by hand, which landed in `e38c0719` along with a completeness assertion against `Object.keys(INLINE_DESCRIPTORS)` so the NEXT entity reds by name. A red run here means a `fieldSanitizers` entry disagrees with the real sanitizer, which is a REAL defect in this task's own work, not a test to adjust.

- [ ] **Step 5: Commit.** Subject: `feat(calendar): describe staged absence and event writes`.

---

## Task 9: End-to-end write-path coverage

**Files:**
- Modify: `src/app/inline-ai-edit/plan.write-path.test.ts`

- [ ] **Step 1: Add two `CASES` entries**

One `update_absence` and one `update_calendar_event`, following the existing rows. `dispatcherWrapperWith` seeds through `TestSeed`, which today covers tasks, resources, raid, changes, milestones and stakeholders — **absences and calendar events are not seedable**. Extend `TestSeed` in `src/app/test-providers.tsx` with `absences` and `calendarEvents`, mirroring the existing guarded `if (seed.x?.length) setX(seed.x)` lines exactly, including the comment about why each is guarded on non-empty.

- [ ] **Step 2: Run the write-path differential**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/t9.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |×" "$SP/t9.log"
```

- [ ] **Step 3: Mutation-prove the guard wiring at the seam**

Delete `dropUnacceptedCalendarEventFields(patch)` at its call site in `use-register-tools.ts`, replacing it with the bare `patch`, and require the write-path differential to go RED. Record `N failed / M passed`. This is the exact probe open-followups §394 records the SANITIZER-level sweep being blind to — a merge-site guard is invisible to a reader that calls the sanitizer directly, so if only that sweep is green here, the coverage is not real. Revert the mutant.

- [ ] **Step 4: Commit.** Subject: `test(calendar): pin the write path for absences and events`.

---

## Task 10: Full gates

- [ ] **Step 1: Run every gate, unpiped**

```bash
npx tsc --noEmit > "$SP/g1.log" 2>&1; echo "TSC=$?"
npx eslint --max-warnings=0 src; echo "ESLINT=$?"
npm run test:run > "$SP/g2.log" 2>&1; echo "UNIT=$?"; grep -E "Test Files|Tests " "$SP/g2.log"
npm run test:shuffle > "$SP/g3.log" 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " "$SP/g3.log"
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
```

★ `test:shuffle` is the only local reproduction of the blocking `unit-tests-shuffled` job, and this slice adds several test files — run it.

★ `size:check` counts `wc -l` **+ 1** against a LIMIT of 1600. `use-register-tools.ts` and `chat-tools.ts` both grow here; check their headroom with:
```bash
node -e "console.log(require('fs').readFileSync('src/app/use-register-tools.ts','utf8').split('\n').length)"
```

- [ ] **Step 2: Verify the working tree is clean of foreign files**

```bash
git status --porcelain
```
Expected: only ` M sample-workspace-huge.json` and `?? not-in-use.env.local.bak`, neither ever staged.

- [ ] **Step 3: Review before release**

Dispatch a cold code review over `git diff origin/main...HEAD` before any push. Per the standing rule, **no push, no MR and no merge without the user's explicit say-so.**

---

## Self-review notes

**Spec coverage:** seven tools (Task 6) · dispatcher writers (Task 5) · two descriptors (Task 8) · two merge-site guards (Task 2) · recurrence projection (Task 1) · `sendInvitations` staging rule (Task 7) · tokens (Task 4) · the `chat-proposal.test.ts` ripple (Task 7, Step 1) · i18n labels (Task 3) · write-path coverage (Task 9). Every spec section maps to a task.

**Known gap, stated rather than hidden:** Task 8 Step 2 leaves `fieldSanitizers` to be filled by reading `sanitizeAbsence`, and Task 3 leaves the exact i18n key names to the convention discovered in its Step 1. Both are deliberate: inventing either here would put a guess in a plan that reads as verified, and both have a command attached that produces the real answer. Everything else is complete code.

**Out of scope (from the spec):** `exceptions`, `shifts`, and any Outlook push.
