# Backlog Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix ten register entries and close an eleventh as a record, each fix pinned by a test that was red against the unfixed code for the predicted reason.

**Architecture:** Ten independent tasks, ordered so the one shared dependency lands first. Task 1 extracts `isRealCalendarDate`, and Task 2 consumes it. Every other task stands alone. Each fix task closes its own register entry in its own commit.

**Tech Stack:** TypeScript, React, vitest + RTL (jsdom), fake-indexeddb, Next 16.

**Spec:** `docs/superpowers/specs/2026-09-21-backlog-sweep-design.md`

## Spec corrections made by this plan

Reading every edit site before writing code turned up five places where the approved spec was
wrong or incomplete. The spec is corrected in the same commit as this plan. The binding version
is the one below.

1. **§542 — the existing load readers cannot be reused.** `requiredIsoDateOnLoad` and
   `optionalIsoDateOnLoad` both judge through `sanitizeIsoDate`, which carries a 1900–2100 bound
   calendar events never had. So a stored meeting dated 2200 would read as `""` and be
   **dropped**. Worse, the optional reader **blanks** a non-calendar value, and for recurrence
   `until` a blank means **no end date**: a bounded series would load as an **unbounded** one.
   Task 2 therefore adds a calendar-specific load reader, `calendarEventDateOnLoad`.
2. **§542 — there is a third path: updates.** An AI update rebuilds `{...stored, ...patch}`
   through the sanitizer. With a strict sanitizer, a stored `2026-02-30` that the patch never
   touches makes **every** update of that event fail. Milestones hit exactly this and solved it
   with `requiredIsoDateOnUpdate`. Task 2 adds `sanitizeCalendarEventForUpdate`, which carries an
   unchanged stored date verbatim, and routes the three update call sites through it.
3. **§565 — there is no correct Turso clear to mirror.** Recon called one Turso site correct, but
   that site is `handleTokenLockToggle`, which switches the **wrap mode** and answers a different
   question. The pattern Task 5 prescribes comes from the AI-key section instead: empty means
   `removeSealed` and the stored flag goes false. `commitTurso`'s passphrase branch also seals an
   empty token, and is fixed with the rest.
4. **§564 — a better real negative.** A long camelCase i18n key such as
   `integrationsTursoTokenPlaceholder` (33 characters, mixed case, no digit) is protected by the
   digit requirement alone. It is a more realistic survivor than a German compound word, and the
   test uses both.
5. **§566 and §570 — the suite currently pins both bugs.** `_helpers.test.ts` asserts
   `expect.any(Error)`, which **requires** the raw object to be logged. `chart-readout.test.tsx`
   asserts the comma form. Both assertions must change **as part of** the fix. An implementer
   who "repairs" either test back to its old assertion has reverted the fix.

## Global Constraints

- **Branch:** `fix/backlog-sweep`. **Version:** 1.12.7, milestone "Child" unchanged.
- **New register entries**, if a task finds a defect: **§605 and above only**. §596–§604 belong
  to a concurrent branch. File it with its own GitLab issue; do not fix it here unless it blocks
  one of the eleven.
- **Files owned by the concurrent branch — never touch:** `chat-panel.tsx`,
  `workspace-section.tsx`, `workspace-section-types.ts`, `use-storage-backend.ts`,
  `task-manager.tsx`, `chat-api.ts`.
- **Line endings.** Every `src/` file this plan touches is `i/lf w/crlf`. Run
  `git ls-files --eol <file>` before and after each edit; `w/lf` afterwards means the edit
  re-lined the file. **Never `sed -i`.** `docs/open-followups.md` and `CHANGELOG.md` are LF.
  **No task touches `src/app/i18n.de.ts`.**
- **Cite symbols, never line numbers,** in any doc or register text. `npm run docs:claims:check`
  is a ratchet that fails on a new `path:LINE` citation.
- **Never read an exit code through a pipe.** Redirect to a file, `echo "EXIT=$?"`, then read the
  file. `$SCRATCH` in the commands below means the session scratchpad directory; never `/tmp`,
  which a concurrent session shares.
- **vitest:** one run at a time, scoped to files,
  `npx vitest run <files> --maxWorkers=1 --reporter=dot`. Check the printed `Test Files N` count
  against the number of files you passed: a mistyped path is dropped silently and still exits 0.
- **After every task:** `npx tsc --noEmit` and `npx eslint --max-warnings=0 <touched files>`,
  both unpiped. A task that adds or reorders tests also runs `npm run test:shuffle`.
- **Git:** never `git add -A` or `git add .`. Commit with
  `git commit --only <paths> -F <msgfile>`, writing the message file to the session scratchpad.
  **Never `--amend`.** `git checkout --` and `git restore` are deny-blocked: revert by writing the
  original bytes back, then prove `git diff --stat` is empty. End every commit message with
  `Claude-Session: https://[session link removed]`.
  Commit messages cite `§N`, never `#N` and never "closes".
- **Mutants:** predict each one's result **in writing, before running it**. Run each one **on
  its own**. Restore by writing the original bytes back, and prove `git diff --stat` is clean
  before the next mutant. Report predicted against actual, **including any mismatch**.
- **The size ratchet:** check touched files against `LIMIT` in `scripts/check-file-sizes.mjs`.
  The script counts `wc -l` + 1.

### The closure recipe (every fix task ends with this, for its own entry)

Run it in the **same commit** as the fix, from that task's own diff and mutant results.

1. Read the entry's `**Work item:** #NN` line and **note NN**, because step 3 deletes it and the
   release task needs it.
2. Change the heading `## N. <title> — OPEN` to `## N. <title> — CLOSED <today>`, where
   `<today>` is `date +%F`.
3. **Delete** the entry's `**Work item:**` line. A closed entry must not carry one.
4. Add a `**Status:**` line naming: the branch; the test; each mutant, with predicted and actual
   result; and **every place the shipped fix departs from the entry's own fix-shape line, and
   why.** Write it from the diff, then read the entry's title last and check the Status line
   answers it.
5. In the index table, the row `| [§N](#<slug>) | <title> — OPEN | … | open |` becomes
   `| [§N](#<slug>) | <title> — CLOSED <today> | … | closed |`. **Derive the new slug; never
   type it.** A ` — ` in a heading becomes a **double** hyphen in the slug, so
   `— CLOSED 2026-09-21` ends the slug with `--closed-2026-09-21`. Run a positive control first:
   feed the derivation the OLD heading and confirm it reproduces the slug already in the row.
6. Run each of these, unpiped, and read each exit code:
   `npm run followups:index:check`, `npm run followups:workitems:check`,
   `npm run followups:status:check`. All three must be 0.

## Review Focus

These five failure modes are the ones most likely to hurt a real user. Each one is pinned by a
test in the task named.

1. **A stored recurring meeting with a calendar-invalid `until` loads as a series that never
   ends.** Expected: `until` is kept as stored and the series stays bounded. Pinned in Task 2,
   step 1, case (b2).
2. **Editing any field of a stored meeting whose date is calendar-invalid is refused.** Expected:
   an edit that leaves the date alone saves, while an edit that changes the date to another
   invalid one is refused. Pinned in Task 2, step 1, case (d), and at the AI-update call site in
   step 8.
3. **A stored meeting dated outside 1900–2100 disappears on load.** Expected: it loads exactly as
   before, because calendar events never had a year bound. Pinned in Task 2, step 1, cases (a4)
   and (b3).
4. **A user clears the Turso token and then types a new one.** Expected: the Remove button
   disappears on the clear and comes back once the new token is sealed. Pinned in Task 5, step 1.
5. **A diagnostic that reports an entity id arrives with the id redacted.** Expected: UUIDs, GUIDs,
   commit SHAs, i18n keys and stack frames survive unchanged. Pinned in Task 6, step 1.

---

### Task 1: Extract `isRealCalendarDate`; TimeLog dated predicate (§544)

**Files:**
- Modify: `src/app/sanitize-core.ts` (add `isRealCalendarDate`, rewire `sanitizeIsoDate`)
- Modify: `src/app/timelog-actuals.ts` (`aggregateActuals` only)
- Test: `src/app/sanitize-core.test.ts` (create if absent; check with `ls` first), `src/app/timelog-actuals.test.ts`
- Modify: `docs/open-followups.md` (close §544)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isRealCalendarDate(value: string): boolean` in `src/app/sanitize-core.ts`. Task 2 imports it.

★★ **Do not touch `buildDailyRoll`.** The same file carries a capitalised warning against adding a
date guard there: one was added before, and it turned a freeze into a fabricated clean.
`aggregateActuals` is the only consumer of this check.

- [ ] **Step 1: Write the failing tests.**

In `sanitize-core.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isRealCalendarDate, sanitizeIsoDate } from "./sanitize-core";

describe("isRealCalendarDate (§544, §542)", () => {
  it.each(["2024-02-29", "2026-12-31", "2026-01-01", "2200-06-15"])("accepts the real date %s", (d) => {
    expect(isRealCalendarDate(d)).toBe(true);
  });
  it.each(["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01", ""])(
    "refuses %s", (d) => {
      expect(isRealCalendarDate(d)).toBe(false);
    },
  );
  // ★ NO YEAR BOUND: that is `sanitizeIsoDate`'s own policy, kept there.
  it("has no year bound, while sanitizeIsoDate keeps its own", () => {
    expect(isRealCalendarDate("2200-06-15")).toBe(true);
    expect(sanitizeIsoDate("2200-06-15")).toBe("");
  });
});
```

In `timelog-actuals.test.ts`, next to `"reports undated hours as a strict subset of unattributed"`,
using that file's own `item` helper and `links` fixture:

```ts
  // §544: shape-valid but not a real day. Before the fix this row counted as DATED, so the month
  // key filed it under February and the ISO-week key under March.
  it("routes a calendar-invalid day to undated instead of any period", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "2026-02-30", 3)],
      links,
    );
    expect(out.undated).toEqual({ hours: 3, billableHours: 3 });
    expect(out.unattributed).toEqual({ hours: 3, billableHours: 3 });
    // Presence half: the VALID row still reached a period. A predicate that refused every row
    // would also produce undated = 3 if the valid row were dropped from the fixture.
    const attributed = Object.values(out.byResource).reduce((s, c) => s + c.hours, 0);
    expect(attributed).toBe(4);
    expect(Object.keys(out.byBucketDay ?? {}).join(",")).not.toContain("2026-02-30");
  });
```

- [ ] **Step 2: Run them and watch them fail.**

```bash
npx vitest run src/app/sanitize-core.test.ts src/app/timelog-actuals.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"
```

Expected: the helper tests fail because `isRealCalendarDate` is not exported. The TimeLog test
fails on `out.undated` being `{ hours: 0, … }`. **Read the message**: if the TimeLog test fails
on anything else, for instance `links` undefined, the fixture is broken, not the code.

- [ ] **Step 3: Implement.** In `sanitize-core.ts`, directly above `sanitizeIsoDate`:

```ts
/** §544 / §542: whether `value` is a REAL calendar date — the `YYYY-MM-DD` shape AND a
 *  `Date.UTC` round trip that gives back the same year, month and day, so "2026-02-30" and
 *  "2026-04-31" are refused where `Date.parse` would silently roll them into the next month.
 *  ★ NO YEAR BOUND: that is `sanitizeIsoDate`'s own policy, and neither calendar events nor
 *  TimeLog rows ever had one. ★ Years 0000–0099 read as non-calendar (`Date.UTC` maps them to
 *  19xx) — far below any date this app stores. One spelling of the check; its callers are
 *  `sanitizeIsoDate`, the calendar-event date readers and `aggregateActuals`. */
export function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}
```

Replace the body of `sanitizeIsoDate`, keeping its docstring. The accepted set is unchanged,
because only the order of the two checks moves:

```ts
export function sanitizeIsoDate(s: unknown): string {
  if (typeof s !== "string" || !isRealCalendarDate(s)) return "";
  const y = Number(s.slice(0, 4));
  return y >= 1900 && y <= 2100 ? s : "";
}
```

In `timelog-actuals.ts`, import `isRealCalendarDate` from `./sanitize-core` and change the
`dated` line in `aggregateActuals` to:

```ts
    // §544: shape AND a real calendar day. Shape alone let "2026-02-30" count as dated, so the
    // month key filed it under February while the ISO-week key's Date rolled it into March.
    const dated = ISO_DAY_RE.test(it.date) && isRealCalendarDate(it.date);
```

- [ ] **Step 4: Run the tests, then everything that exercises `sanitizeIsoDate`.**

```bash
npx vitest run src/app/sanitize-core.test.ts src/app/timelog-actuals.test.ts src/app/sanitize-load-date.test.ts src/app/sanitize.property.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t1b.log" 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/sanitize-core.ts src/app/timelog-actuals.ts src/app/sanitize-core.test.ts src/app/timelog-actuals.test.ts; echo "EXIT=$?"
```

Expected: all 0, with `Test Files 4 passed`.

- [ ] **Step 5: Mutants, each predicted in writing first and run on its own.**

| # | Mutant | Prediction |
|---|---|---|
| 1a | `isRealCalendarDate` returns `ISO_DATE_RE.test(value)` (no round trip) | RED: the helper's refusal cases for `2026-02-30`, `2026-04-31` and `2026-02-29` |
| 1b | the `dated` line back to `ISO_DAY_RE.test(it.date)` alone | RED: the TimeLog test on `out.undated` |

- [ ] **Step 6: Close §544** with the closure recipe from Global Constraints. The Status line
records that the helper was extracted rather than a third copy written, and that
`buildDailyRoll` was deliberately left alone.

- [ ] **Step 7: Commit** `src/app/sanitize-core.ts`, `src/app/timelog-actuals.ts`, both test
files and `docs/open-followups.md`, with `git commit --only … -F`.

---

### Task 2: Calendar events: separate load, create and update date rules (§542)

**Files:**
- Modify: `src/app/sanitize-load-date.ts` (add `calendarEventDateOnLoad`)
- Modify: `src/app/calendar-event.ts` (reader factory, three public sanitizers, `acceptsEventDate`, three comments)
- Modify (load sites): `src/app/browser-backend.ts`, `src/app/workspace.ts`, `src/app/csv-codecs-core.ts`
- Modify (update sites): `src/app/use-register-tools.ts`, `src/app/use-calendar-events.ts`, `src/app/calendar-event-modal.tsx`
- Modify (comments only): `src/app/inline-ai-edit/entity-descriptor.ts`, `src/app/inline-ai-edit/plan.ts`
- Test: `src/app/calendar-event.test.ts`, `src/app/browser-backend.test.ts`, `src/app/calendar-event-modal.test.tsx`, and the AI-update test file found in step 8
- Modify: `docs/open-followups.md` (close §542)

**Interfaces:**
- Consumes: `isRealCalendarDate(value: string): boolean` from `./sanitize-core` (Task 1).
- Produces:
  - `sanitizeCalendarEvent(input: unknown): CalendarEvent | null`: **strict**, for creates. The signature is unchanged.
  - `sanitizeLoadedCalendarEvent(input: unknown): CalendarEvent | null`: **new**, for load funnels.
  - `sanitizeCalendarEventForUpdate(input: unknown, stored: CalendarEvent): CalendarEvent | null`: **new**, for updates. ★ **Two arguments: never pass it point-free** (`.map(sanitizeCalendarEventForUpdate)` would receive the array INDEX as `stored`).
  - `calendarEventDateOnLoad(value: unknown, id: unknown, field: string): string | undefined` in `sanitize-load-date.ts`.

**The rule for each path**, which is the whole design:

| Path | Date rule | Why |
|---|---|---|
| **create** | a real calendar date, **any year** | new data must be right; calendar events never had a year bound |
| **load** | **exactly what loaded before §542** (ISO shape + `Date.parse` field range, any year); a kept non-calendar value is **reported** | no stored event may be dropped, no stored `until` blanked into an unbounded series |
| **update** | a date equal to the **stored** one for that field is carried **verbatim**; any other date must be a real calendar date | editing a title must not fail because of an old date the edit never touched |

**Every call site**, from `git grep -n "sanitizeCalendarEvent"`:

| Site | Kind | Becomes |
|---|---|---|
| `BrowserBackend.load` (`browser-backend.ts`) | load, IndexedDB | `sanitizeLoadedCalendarEvent` |
| `jsonToWorkspace` (`workspace.ts`) | load, JSON | `sanitizeLoadedCalendarEvent` |
| `buildCalendarEventFromObj` (`csv-codecs-core.ts`) | load: CSV, Markdown, both Turso layouts | `sanitizeLoadedCalendarEvent` |
| `createCalendarEvent` in `use-register-tools.ts` | create, AI | `sanitizeCalendarEvent` (unchanged) |
| `updateCalendarEvent` in `use-register-tools.ts` | update, AI | `sanitizeCalendarEventForUpdate(merged, existing)` |
| `handleSaveCalendarEvent` (`use-calendar-events.ts`) | create **or** update | strict on create; `ForUpdate` on update |
| `handleSubmit` (`calendar-event-modal.tsx`) | create **or** update | strict when `isNew`; `ForUpdate` otherwise |
| `src/test/sweep-probes.ts` | harness | unchanged (strict) |

- [ ] **Step 1: Write the failing sanitizer tests** in `calendar-event.test.ts`:

```ts
import { beforeEach } from "vitest";
import {
  sanitizeCalendarEvent, sanitizeLoadedCalendarEvent, sanitizeCalendarEventForUpdate,
  type CalendarEvent,
} from "./calendar-event";
import { buildCalendarEventFromObj } from "./csv-codecs-core";
import { __resetNonCalendarDateReportsForTests } from "./sanitize-load-date";
import { clearDiagLog, readDiagLog } from "./diagnostics";
const kept = () => readDiagLog().filter((e) => e.code === "storage.nonCalendarDateKept").map((e) => e.fields);

const ev = (over: Record<string, unknown> = {}) => ({
  id: 7, title: "Standup", startDate: "2026-03-02", startTime: "09:00", durationMinutes: 15, ...over,
});
const weekly = (until: string) => ({ freq: "weekly", interval: 1, until });

describe("§542 date rules — create, load and update each have their own", () => {
  beforeEach(() => { __resetNonCalendarDateReportsForTests(); clearDiagLog(); });

  // (a) CREATE: a real calendar date, any year.
  it("(a1) refuses a calendar-invalid startDate", () => {
    expect(sanitizeCalendarEvent(ev({ startDate: "2026-02-30" }))).toBeNull();
  });
  it("(a2) omits a calendar-invalid until and keeps the rule", () => {
    const out = sanitizeCalendarEvent(ev({ recurrence: weekly("2026-04-31") }));
    expect(out?.recurrence).toBeDefined();
    expect(out?.recurrence?.until).toBeUndefined();
  });
  it("(a3) drops an exception with an invalid date, and degrades a move with an invalid toDate to a skip", () => {
    const out = sanitizeCalendarEvent(ev({
      recurrence: weekly("2026-06-30"),
      exceptions: [
        { date: "2026-02-30", kind: "skip" },
        { date: "2026-03-09", kind: "move", toDate: "2026-04-31" },
      ],
    }));
    expect(out?.exceptions).toEqual([{ date: "2026-03-09", kind: "skip" }]);
  });
  it("(a4) has no year bound: 2200 is accepted on create", () => {
    expect(sanitizeCalendarEvent(ev({ startDate: "2200-01-05" }))?.startDate).toBe("2200-01-05");
  });

  // (b) LOAD: everything that loaded before §542 still loads, unchanged.
  it("(b1) keeps a stored calendar-invalid startDate, and reports it", () => {
    const out = sanitizeLoadedCalendarEvent(ev({ startDate: "2026-02-30" }));
    expect(out?.startDate).toBe("2026-02-30");
    expect(kept()).toEqual([{ source: "workspace", entity: "calendarEvent", id: 7, field: "startDate" }]);
  });
  it("(b1b) reports nothing for a real date", () => {
    sanitizeLoadedCalendarEvent(ev());
    expect(kept()).toEqual([]); // absence: paired with (b1), which proves the probe can see one
  });
  it("(b2) keeps a stored calendar-invalid until, so the series stays BOUNDED", () => {
    const out = sanitizeLoadedCalendarEvent(ev({ recurrence: weekly("2026-04-31") }));
    expect(out?.recurrence?.until).toBe("2026-04-31");
  });
  it("(b3) keeps a stored event outside 1900–2100", () => {
    expect(sanitizeLoadedCalendarEvent(ev({ startDate: "2200-01-05" }))?.startDate).toBe("2200-01-05");
  });
  it("(b4) still drops what was always dropped: a month outside 01–12", () => {
    expect(sanitizeLoadedCalendarEvent(ev({ startDate: "2026-13-01" }))).toBeNull();
  });
  it("(b5) the CSV / Markdown / Turso funnel keeps it too", () => {
    const out = buildCalendarEventFromObj({
      id: "7", title: "Standup", startDate: "2026-02-30", startTime: "09:00", durationMinutes: "15",
      recurrence: JSON.stringify(weekly("2026-04-31")), exceptions: "", attendeeResourceIds: "",
    });
    expect(out?.startDate).toBe("2026-02-30");
    expect(out?.recurrence?.until).toBe("2026-04-31");
  });

  // (d) UPDATE: an untouched stored date is carried; a changed one must be real.
  const stored: CalendarEvent = {
    id: 7, title: "Standup", startDate: "2026-02-30", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "weekly", interval: 1, until: "2026-04-31" },
  };
  it("(d1) saves a title-only edit of an event whose stored dates are calendar-invalid", () => {
    const out = sanitizeCalendarEventForUpdate({ ...stored, title: "Daily" }, stored);
    expect(out?.title).toBe("Daily");
    expect(out?.startDate).toBe("2026-02-30");
    expect(out?.recurrence?.until).toBe("2026-04-31");
  });
  it("(d2) refuses a CHANGE to another calendar-invalid date", () => {
    expect(sanitizeCalendarEventForUpdate({ ...stored, startDate: "2026-04-31" }, stored)).toBeNull();
  });
  it("(d3) accepts a change to a real date", () => {
    expect(sanitizeCalendarEventForUpdate({ ...stored, startDate: "2026-03-02" }, stored)?.startDate)
      .toBe("2026-03-02");
  });
});
```

★★ A `2026-02-30` case is **vacuous against today's code by itself**: today's rule accepts it.
The file's own header warns about this, and one such test already survived its mutant. Cases
(a1)–(a3) are red **today** because they expect a refusal the old rule never makes. Cases
(b1)–(b5) are green today and after the fix. They are the **regression guard**, and they turn red
under mutants 2c–2f. Say so in a comment above them.

- [ ] **Step 2: Run and watch them fail.**

```bash
npx vitest run src/app/calendar-event.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"
```

Expected: failures on the missing exports. Once stubbed, (a1)–(a3) fail on the old rule
accepting. Read the messages.

- [ ] **Step 3: Add the load reader** to `sanitize-load-date.ts`. Extend its import to
`import { isRealCalendarDate, sanitizeIsoDate, type RequiredDateReader } from "./sanitize-core";`,
then add:

```ts
/** §542: calendar events' load reader, for EVERY date field (startDate, recurrence `until`,
 *  exception `date` / `toDate`). ★★ NOT `requiredIsoDateOnLoad` / `optionalIsoDateOnLoad`, for
 *  two measured reasons: both judge through `sanitizeIsoDate`, whose 1900–2100 bound calendar
 *  events never had, so a stored meeting in 2200 would read as "" and be DROPPED; and the
 *  optional reader BLANKS a non-calendar value, which for recurrence `until` means NO END — a
 *  bounded series would load as an unbounded one. So this keeps exactly what calendar events
 *  loaded before §542 (the ISO shape plus `Date.parse`'s field-range check, any year) and
 *  reports a kept non-calendar value. Returns undefined exactly where the old rule refused. */
export function calendarEventDateOnLoad(value: unknown, id: unknown, field: string): string | undefined {
  if (typeof value !== "string" || !ISO_DATE_SHAPE_RE.test(value)) return undefined;
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return undefined;
  if (!isRealCalendarDate(value)) {
    reportOnce("storage.nonCalendarDateKept", "workspace", value, "calendarEvent", id, field);
  }
  return value;
}
```

- [ ] **Step 4: Refactor `calendar-event.ts`.** Import `isRealCalendarDate` from
`./sanitize-core` and `calendarEventDateOnLoad` from `./sanitize-load-date`, **directly**, never
through the `./sanitize` barrel. ★ Every helper below is a **`function` declaration**, never a
`const` arrow, for the barrel-cycle reason already written on `acceptsEventDuration`.

```ts
/** Which date a reader judges — named so a load diagnostic and an update's carry-set say which. */
type EventDateField = "startDate" | "recurrence.until" | "exceptions.date" | "exceptions.toDate";
/** How `calendarEventWithDateReader` reads each date: the stored string, or undefined. */
type EventDateReader = (value: unknown, field: EventDateField, id: number) => string | undefined;

/** CREATE (§542): a real calendar date, any year. */
function strictEventDate(value: unknown): string | undefined {
  return typeof value === "string" && isRealCalendarDate(value) ? value : undefined;
}
function readStrictEventDate(value: unknown): string | undefined {
  return strictEventDate(value);
}
/** LOAD (§542): what loaded before, reported when it is not a real day. */
function readEventDateOnLoad(value: unknown, field: EventDateField, id: number): string | undefined {
  return calendarEventDateOnLoad(value, id, field);
}
/** UPDATE (§542): carry a date equal to the STORED one for that field verbatim; judge any
 *  other strictly. Same stance as `requiredIsoDateOnUpdate` for milestones — without it an AI
 *  edit of a title failed on a stored "2026-02-30" the edit never touched. */
function carryStoredEventDates(stored: CalendarEvent): EventDateReader {
  const carried: Record<EventDateField, ReadonlySet<string>> = {
    startDate: new Set([stored.startDate]),
    "recurrence.until": new Set(stored.recurrence?.until ? [stored.recurrence.until] : []),
    "exceptions.date": new Set((stored.exceptions ?? []).map((e) => e.date)),
    "exceptions.toDate": new Set(
      (stored.exceptions ?? []).flatMap((e) => (e.kind === "move" ? [e.toDate] : [])),
    ),
  };
  return function readForUpdate(value, field) {
    return typeof value === "string" && carried[field].has(value) ? value : strictEventDate(value);
  };
}
```

Delete `isoDateOrUndefined`. Rewrite its long docstring as the header of the reader block above:
keep the `Date.parse` field-range explanation and the vacuous-test warning, and replace
"Stated, not fixed" with the three-path design. Then thread the reader through:

- `sanitizeRecurrence(raw, startDate, readDate: EventDateReader, id: number)`: read `until` with `readDate(r.until, "recurrence.until", id)`.
- `sanitizeExceptions(raw, readDate: EventDateReader, id: number)`: read `e.date` with `"exceptions.date"` and `e.toDate` with `"exceptions.toDate"`.
- Rename today's `sanitizeCalendarEvent` body to `function calendarEventWithDateReader(input: unknown, readDate: EventDateReader): CalendarEvent | null`, read `startDate` with `readDate(raw.startDate, "startDate", id)`, and pass `readDate, id` down.

Then the three public forms:

```ts
/** CREATE. ONE argument, so safe point-free. */
export function sanitizeCalendarEvent(input: unknown): CalendarEvent | null {
  return calendarEventWithDateReader(input, readStrictEventDate);
}
/** LOAD funnels only (IndexedDB, JSON, and `buildCalendarEventFromObj` for CSV / Markdown / Turso). */
export function sanitizeLoadedCalendarEvent(input: unknown): CalendarEvent | null {
  return calendarEventWithDateReader(input, readEventDateOnLoad);
}
/** UPDATE of `stored`. ★ TWO arguments — never pass it point-free. */
export function sanitizeCalendarEventForUpdate(input: unknown, stored: CalendarEvent): CalendarEvent | null {
  return calendarEventWithDateReader(input, carryStoredEventDates(stored));
}
```

`acceptsEventDate` becomes `return strictEventDate(v) !== undefined;`. Rewrite its docstring:
the preview now asks the **create** rule, which is a real calendar date with no year bound. The
year-bound reasoning still holds, because `sanitizeIsoDate` has one and this does not. Remove the
sentence saying the rollover direction is still open.

- [ ] **Step 5: Rewire the call sites** exactly as the table says.
  - `browser-backend.ts` and `workspace.ts`: `.map((e) => sanitizeLoadedCalendarEvent(e))`.
  - `buildCalendarEventFromObj`: call `sanitizeLoadedCalendarEvent`, and add a line to its docstring saying it is load-only.
  - `use-register-tools.ts` `updateCalendarEvent`: `sanitizeCalendarEventForUpdate({ ...existing, ...dropUnacceptedCalendarEventFields(patch), id, localModifiedAt: new Date().toISOString() }, existing)`.
  - `use-calendar-events.ts` `handleSaveCalendarEvent`: move the `previous` lookup **above** the sanitize, then `const sanitized = previous ? sanitizeCalendarEventForUpdate({ ...next, id }, previous) : sanitizeCalendarEvent({ ...next, id });`. The existing comment about reading the before-image as a value still applies; keep it.
  - `calendar-event-modal.tsx` `handleSubmit`: `const sanitized = isNew || !event ? sanitizeCalendarEvent(raw) : sanitizeCalendarEventForUpdate(raw, event);`. Check the modal's prop names first: `event` must be the **stored** event being edited.
  - Rewrite the gap comments in `inline-ai-edit/entity-descriptor.ts` and `inline-ai-edit/plan.ts` to describe the three-path design, and the `calendar-event.ts` header note likewise. A rewritten comment names the mechanism; do not simply delete it.

- [ ] **Step 6: Add the funnel tests.**

In `browser-backend.test.ts`, beside `"save → fresh load round-trips calendar events"`:

```ts
  it("§542: a stored calendar-invalid meeting survives a fresh IndexedDB load", async () => {
    const ws = {
      ...emptyWorkspace(),
      calendarEvents: [{
        id: 4, title: "Retro", startDate: "2026-02-30", startTime: "09:00", durationMinutes: 30,
        recurrence: { freq: "weekly" as const, interval: 1, until: "2026-04-31" },
      }],
    };
    await new BrowserBackend().save(ws);
    const loaded = await new BrowserBackend().load();
    expect(loaded.calendarEvents).toHaveLength(1);
    expect(loaded.calendarEvents?.[0]).toMatchObject({ id: 4, startDate: "2026-02-30" });
    expect(loaded.calendarEvents?.[0].recurrence?.until).toBe("2026-04-31");
  });
```

In `calendar-event.test.ts`, the JSON funnel:

```ts
import { emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./workspace";

  it("(b6) the JSON funnel keeps it too", () => {
    const text = workspaceToJson({ ...emptyWorkspace(), calendarEvents: [stored] });
    expect(text).toContain("2026-02-30"); // presence: the fixture really reached the stored form
    const out = jsonToWorkspace(text);
    expect(out.calendarEvents?.[0]?.startDate).toBe("2026-02-30");
    expect(out.calendarEvents?.[0]?.recurrence?.until).toBe("2026-04-31");
  });
```

If `workspaceToJson` itself sanitizes and strips the date, the `toContain` line fails. In that
case build the JSON text by hand from `workspaceToJson`'s output and say so in a comment.

- [ ] **Step 7: Add the modal call-site test** in `calendar-event-modal.test.tsx`, using that
file's render helper. Render the modal for an **existing** event whose stored `startDate` is
`"2026-02-30"`, change only the title, submit, and assert `onSave` was called once with that
title and `startDate: "2026-02-30"`. Before the fix the strict sanitizer returned null and the
modal showed the title-required error. So also assert the error text is **absent**.

- [ ] **Step 8: Add the AI-update call-site test.** Find the file that drives
`updateCalendarEvent` through `useRegisterTools`:

```bash
git grep -n "updateCalendarEvent(" -- 'src/**/*.test.*'
```

In it, seed a calendar event whose stored `startDate` is `"2026-02-30"`, call
`updateCalendarEvent(id, { title: "Daily" })`, and assert it **does not throw** and the stored
row's title changed. If no test file drives the real hook, say so in the task report. The
sanitizer-level case (d1) then stands alone, and mutant 2h is reported as unpinned at the call
site. Do not leave that silent.

- [ ] **Step 9: Run everything that exercises calendar events.**

```bash
npx vitest run src/app/calendar-event.test.ts src/app/browser-backend.test.ts src/app/calendar-event-modal.test.tsx src/app/use-calendar-events.test.tsx src/app/calendar-recurrence-text.test.ts src/app/sanitize-calendar-event-patch.test.ts src/app/recurrence.property.test.ts src/app/undo/field-groups.test.ts src/app/inline-ai-edit/descriptor-drift.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.write-path.test.ts src/app/sanitize-load-date.test.ts src/app/sanitize-point-free.guard.test.ts src/app/use-resource-planner.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t2b.log" 2>&1; echo "EXIT=$?"
```

Expected: `Test Files 16 passed`. Add step 8's file if it is not already in the list.
`plan.sanitizer-parity.test.ts` checks the preview against the writer, so a failure there means
`acceptsEventDate` and the create rule disagree. Fix the code, not the test. Then run `tsc`,
`eslint` over every touched file, `npm run test:shuffle` and the size check.

- [ ] **Step 10: Mutants, each predicted first and run on its own.**

| # | Mutant | Prediction |
|---|---|---|
| 2a | `strictEventDate` uses today's old rule (shape + `Date.parse`) | RED: (a1), (a2), (a3) |
| 2b | `strictEventDate` also requires `sanitizeIsoDate(value) !== ""` (adds the year bound) | RED: (a4) |
| 2c | `BrowserBackend.load` back on `sanitizeCalendarEvent` | RED: the IndexedDB funnel test |
| 2d | `jsonToWorkspace` back on `sanitizeCalendarEvent` | RED: (b6) |
| 2e | `buildCalendarEventFromObj` back on `sanitizeCalendarEvent` | RED: (b5) |
| 2f | `calendarEventDateOnLoad` returns undefined when `!isRealCalendarDate(value)` (blank instead of keep) | RED: (b1), (b2), (b5), (b6) |
| 2g | `sanitizeCalendarEventForUpdate` uses `readStrictEventDate` (no carry) | RED: (d1) |
| 2h | `updateCalendarEvent` back on `sanitizeCalendarEvent` | RED: the step-8 test (or report it unpinned) |
| 2i | modal `handleSubmit` back on `sanitizeCalendarEvent` for an update | RED: the step-7 test |

- [ ] **Step 11: Close §542** with the closure recipe. The Status line must say plainly: a stored
calendar-invalid date is **kept and reported, not repaired**, and it still rolls over when
rendered. New bad dates are stopped at every create and update path. It must also record both
departures from the entry: the load path needed its own reader, and the update path needed a
carry reader.

- [ ] **Step 12: Commit** every touched file with `git commit --only … -F`.

---

### Task 3: Stakeholder editor: one normalizer per field, used by blur and submit (§541)

**Files:**
- Modify: `src/app/stakeholder-edit-modal.tsx`
- Test: `src/app/stakeholder-edit-modal.test.tsx`
- Modify: `docs/open-followups.md` (close §541)

**Interfaces:** consumes nothing; produces nothing other tasks use.

The blur handlers normalize three different ways today, and the submit path must match each
one exactly:

| Field | Blur normalization today | Limit |
|---|---|---|
| `name` | cap, trim; stays a string | `BUDGET_NAME_MAX` |
| `organization`, `title` | cap, trim, `\|\| undefined` | `BUDGET_NAME_MAX` |
| `notes` | cap, **no trim** (multiline), `\|\| undefined` | `TEXTAREA_MAX` |

- [ ] **Step 1: Write the failing tests** in `stakeholder-edit-modal.test.tsx`. Add
`BUDGET_NAME_MAX, TEXTAREA_MAX` to the `./sanitize` import. The modal is controlled, so a
`draft` prop that already holds an over-long value is exactly the state left by typing and then
pressing Enter without blurring.

```tsx
describe("§541: Enter-submit applies the same normalization as blur", () => {
  const submit = () => fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);

  it.each([
    ["name", BUDGET_NAME_MAX],
    ["organization", BUDGET_NAME_MAX],
    ["title", BUDGET_NAME_MAX],
    ["notes", TEXTAREA_MAX],
  ] as const)("caps %s on submit without a blur", (field, max) => {
    const p = setup({ draft: { ...draft, [field]: "x".repeat(max + 50) } });
    submit();
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onSave.mock.calls[0][0][field]).toHaveLength(max);
  });

  // Presence half: a value under the cap arrives unchanged, so the normalizer is not simply
  // blanking fields.
  it.each(["organization", "title", "notes"] as const)("passes an under-cap %s through", (field) => {
    const p = setup({ draft: { ...draft, [field]: "Head of PMO" } });
    submit();
    expect(p.onSave.mock.calls[0][0][field]).toBe("Head of PMO");
  });

  // Blur and submit must agree on TRIMMING too, not only on length: short fields trim, notes
  // (multiline) do not.
  it("trims organization and title but not notes, as blur does", () => {
    const p = setup({ draft: { ...draft, organization: "  Acme  ", title: "  CFO  ", notes: "  line  " } });
    submit();
    const saved = p.onSave.mock.calls[0][0];
    expect(saved.organization).toBe("Acme");
    expect(saved.title).toBe("CFO");
    expect(saved.notes).toBe("  line  ");
  });
});
```

- [ ] **Step 2: Run and watch them fail.** The cap tests fail with a length of `max + 50`. The
trim test fails on `"  Acme  "`.

- [ ] **Step 3: Implement.** Add module-level helpers in `stakeholder-edit-modal.tsx`:

```ts
/** §541: ONE normalizer per field shape, called by BOTH the field's blur handler and
 *  `handleSubmit`. The caps used to run only on blur, so typing and pressing Enter without
 *  leaving the field saved an uncapped value while the toast claimed fields were adjusted. */
function normalizeStakeholderName(value: string): string {
  return describeTextCap(value, BUDGET_NAME_MAX).value.trim();
}
function normalizeStakeholderShortText(value: string | undefined): string | undefined {
  return describeTextCap(value ?? "", BUDGET_NAME_MAX).value.trim() || undefined;
}
/** Notes are multiline, so they are capped but NOT trimmed — exactly as their blur did. */
function normalizeStakeholderNotes(value: string | undefined): string | undefined {
  return describeTextCap(value ?? "", TEXTAREA_MAX).value || undefined;
}
```

Route the four blur handlers through them. For example, the organization blur becomes
`update("organization", normalizeStakeholderShortText(e.target.value));`, and the name blur
becomes `onChange({ ...draft, name: normalizeStakeholderName(e.target.value), resourceId: draft.resourceId });`.
In `handleSubmit`, replace the final `onSave(...)` with:

```ts
    // M-C4: store the judged value, not the raw draft. An absent email stays absent.
    onSave({
      ...draft,
      name: normalizeStakeholderName(draft.name),
      organization: normalizeStakeholderShortText(draft.organization),
      title: normalizeStakeholderShortText(draft.title),
      notes: normalizeStakeholderNotes(draft.notes),
      ...(draft.email === undefined ? {} : { email: cappedEmail || undefined }),
    });
```

- [ ] **Step 4: Run** the file, plus `src/app/use-stakeholders.test.ts*` if it exists. Then
`tsc`, `eslint` and `test:shuffle`.

- [ ] **Step 5: Mutants: four, one per field, each run on its own.** In `handleSubmit`, put the
raw `draft.<field>` back for `name`, then `organization`, then `title`, then `notes`. Predict
that each turns its own `it.each` row red. A fifth mutant swaps `normalizeStakeholderNotes` for
`normalizeStakeholderShortText` on notes. Predict that the trim test turns red on `"  line  "`.

- [ ] **Step 6: Close §541** with the closure recipe. The Status line records the departure from
the entry: the entry prescribed capping in `handleSubmit`, and the fix shares one normalizer
with blur, so trimming agrees too. It also records the caveat that `name` already carried a
native `maxLength`, so only organization, title and notes had no DOM cap.

- [ ] **Step 7: Commit.**

---

### Task 4: TimeLog threshold: widen `min`, add `step="any"` (§365)

**Files:**
- Modify: `src/app/timelog-settings.tsx` (`thresholdField`)
- Test: `src/app/timelog-settings.test.tsx`
- Modify: `docs/open-followups.md` (close §365)

**Interfaces:** none.

The code accepts `0 < x ≤ MAX_HOURS_PER_DAY` in three places: `parseCap`, `isCap` in
`timelog-policy.ts`, and `sanitizeTimelogPolicy` in `timelog-sanitize.ts`. The i18n notice
`timelogThresholdNeeded` says "above 0". The input declares `min={1}` and **no `step`**. HTML
takes the step base from `min`, so a real browser's valid set is 1, 2 … 24, and `8.5` is a
`stepMismatch` today. ★★ **The entry's `min={0.5}` is wrong.** With the default step, the valid
set would become 0.5, 1.5 …, and the ordinary `8` would be invalid.

- [ ] **Step 1: Write the failing test** in `timelog-settings.test.tsx`, inside the describe
block that defines `renderControlled`, next to `"refuses to persist a threshold that is %s"`:

```tsx
  // §365: the attributes must describe the window the code accepts (0 < x ≤ 24, fractional).
  // ★ jsdom enforces neither min nor step, so these attribute assertions are the ONLY automated
  // pin: the real consequence (8 or 8.5 flagged invalid by the browser) no test here can see.
  it("declares a threshold input the browser will not flag for a valid fractional cap", () => {
    const { field } = renderControlled({ timelogCapPerDay: { enabled: true } });
    expect(field()).toHaveAttribute("min", "0");
    expect(field()).toHaveAttribute("step", "any");
    expect(field()).toHaveAttribute("max", String(MAX_HOURS_PER_DAY));
  });

  // Characterization, NOT a reproduction: these persist TODAY. They guard the window the
  // attributes now describe, so a later "tidy" that narrows parseCap to >= 1 fails here.
  it.each(["0.5", "8.5"])("persists the fractional threshold %s", (typed) => {
    const { field, links } = renderControlled({ timelogCapPerDay: { enabled: true } });
    fireEvent.change(field(), { target: { value: typed } });
    expect(links().policy).toEqual({ timelogCapPerDay: { enabled: true, threshold: Number(typed) } });
  });
```

- [ ] **Step 2: Run it.** The attribute test fails on `min` being `"1"` and `step` being absent.

- [ ] **Step 3: Implement.** In `thresholdField`, replace `min={1}` with:

```tsx
        // §365: the window is 0 < x ≤ MAX_HOURS_PER_DAY, fractional (parseCap / isCap /
        // sanitizeTimelogPolicy agree, and the notice says "above 0"). HTML cannot express an
        // exclusive bound, so min is 0 and parseCap refuses 0 with that notice. ★ step="any"
        // is load-bearing: the step base is `min`, so the default step of 1 flagged 8.5 as
        // invalid, and a min of 0.5 would have flagged 8.
        min={0}
        step="any"
```

Update the docstring above `parseCap` if it still says the attribute and the code disagree.

- [ ] **Step 4: Run** the file, then `tsc` and `eslint`.

- [ ] **Step 5: Mutants, each on its own.** (4a) remove `step="any"`: predict RED on the `step`
assertion. (4b) set `min={0.5}` with `step="any"` kept: predict RED on the `min` assertion.

- [ ] **Step 6: Close §365.** The Status line records that the entry named only `min`, that the
missing `step` was the larger half, and that the entry's `min={0.5}` would have invalidated 8.
It also records honestly that no automated test can see the browser consequence.

- [ ] **Step 7: Commit.**

---

### Task 5: Clearing a token removes the sealed secret, at all four sites (§565)

**Files:**
- Modify: `src/app/jira-settings.tsx` (`handleApiTokenChange`)
- Modify: `src/app/timelog-settings.tsx` (`handleToken`)
- Modify: `src/app/settings-sections/integrations-section.tsx` (`commitTurso`, `confirmPortfolioModeSwitch`)
- Test: `src/app/jira-settings.test.tsx`, `src/app/timelog-settings.test.tsx`, `src/app/settings-sections/integrations-section.drafts.test.tsx`
- Modify: `docs/open-followups.md` (close §565)

**Interfaces:** none. `removeSealed(id: SecretId): void` already exists in `src/app/secrets-store.ts`.

**The rule**, taken from the AI-key section's clear path: **a blank token (`value.trim() === ""`)
calls `removeSealed(id)` and never seals `""`**; a non-blank token seals as before. Where a
stored-token flag exists, a blank also sets it false.

- [ ] **Step 1: Write the failing tests.**

`timelog-settings.test.tsx` already mocks `./use-secrets` and imports it as `secrets`. Add
`vi.mock("./secrets-store", async (importActual) => ({ ...(await importActual<object>()), removeSealed: vi.fn() }))`
and `import * as secretsStore from "./secrets-store";`, then, beside
`"seals the token via saveSecretValue on input"`:

```tsx
  it("§565: clearing the token removes the sealed secret instead of sealing an empty one", () => {
    let cfg = { ...defaultTimelogConfig, enabled: true, apiToken: "tok123" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={(n) => (cfg = n)} />);
    fireEvent.change(screen.getByLabelText(t("en-US", "timelogToken")), { target: { value: "" } });
    expect(secretsStore.removeSealed).toHaveBeenCalledWith("timelogApiToken");
    expect(secrets.saveSecretValue).not.toHaveBeenCalledWith("timelogApiToken", "", "device");
  });
```

In `jira-settings.test.tsx`, add the same two mocks (`./use-secrets` with
`saveSecretValue: vi.fn().mockResolvedValue(undefined)`, and `./secrets-store` with
`removeSealed`), then:

```tsx
  it("§565: clearing the API token removes the sealed secret instead of sealing an empty one", () => {
    const config = { ...defaultJiraConfig, enabled: true, apiToken: "ATATT-token" };
    render(<JiraSettingsSection lang="en-US" config={config} onChange={vi.fn()} alwaysOpen />);
    fireEvent.change(screen.getByLabelText(t("en-US", "jiraApiToken")), { target: { value: "" } });
    expect(secretsStore.removeSealed).toHaveBeenCalledWith("jiraApiToken");
    expect(secrets.saveSecretValue).not.toHaveBeenCalledWith("jiraApiToken", "", "device");
  });
```

Use whatever default-config constant the Jira test file already builds its `config` from; if
it spells the config inline, copy that literal and set `apiToken`.

In `integrations-section.drafts.test.tsx`, which uses the **real** `secrets-store`, add:

```tsx
  // §565: off Turso storage every keystroke commits, and a clear used to seal "" AND set the
  // stored flag, so the "Remove" button appeared right after the user removed the token.
  it("§565: clearing the token off Turso removes the seal and hides Remove; retyping restores both", async () => {
    const user = userEvent.setup();
    renderModal(settingsWith(URL_A, "tok", BROWSER));
    const remove = () => screen.queryByRole("button", { name: t("en-US", "secretPassphraseRemove") });
    await user.clear(tokenField());
    expect(remove()).toBeNull();
    expect(saveSecretValue).not.toHaveBeenCalledWith("tursoAuthToken", "", "device");
    await user.type(tokenField(), "tok2");
    expect(saveSecretValue).toHaveBeenLastCalledWith("tursoAuthToken", "tok2", "device");
    expect(await screen.findByRole("button", { name: t("en-US", "secretPassphraseRemove") })).toBeInTheDocument();
  });
```

★ The last two lines are the presence half. Without them, a fix that simply never showed the
button would pass. If the modal's Remove button is not rendered in this configuration, find the
configuration where it is (check which condition wraps the `tokenStored &&` block) and use that.
Do **not** weaken the assertion. Add a second case for `confirmPortfolioModeSwitch` using the
file's existing mode-switch test setup: clear the token, confirm the switch, and assert
`saveSecretValue` was not called with `""`.

- [ ] **Step 2: Run and watch them fail.** Each fails on `saveSecretValue` having been called
with `""`, or on the Remove button being present.

- [ ] **Step 3: Implement.**

`timelog-settings.tsx`, importing `removeSealed` from `./secrets-store`:

```ts
  function handleToken(value: string) {
    set({ apiToken: value, tokenInvalidAt: undefined });
    // §565: a blank token REMOVES the sealed record. Sealing "" left a ciphertext that
    // decrypts to nothing — a presence check would read it as a stored token.
    if (value.trim() === "") removeSealed("timelogApiToken");
    else void saveSecretValue("timelogApiToken", value, "device");
  }
```

Apply the same change to `jira-settings.tsx` `handleApiTokenChange` with `"jiraApiToken"`.

`integrations-section.tsx` `commitTurso`: put a blank-token branch **first**, ahead of both the
device and the passphrase branches, because the passphrase branch seals `""` too:

```ts
    if (tokenChanged && tokenValue.trim() === "") {
      // §565: a cleared token REMOVES the seal and the flag, in either wrap mode. Sealing ""
      // (device OR passphrase) left a record that decrypts to nothing and turned the Remove
      // button ON right after the user cleared the field.
      removeSealed("tursoAuthToken");
      setTokenStored(false);
    } else if (tokenChanged && tokenWrap === "device") {
```

The remaining branches stay as they are. `confirmPortfolioModeSwitch`: the same blank-first
branch, ahead of its two sealing branches, using `(tursoToken ?? "").trim() === ""`.

- [ ] **Step 4: Run** the three test files, then `tsc`, `eslint` and `test:shuffle`.

- [ ] **Step 5: Mutants: four, one per site, each on its own.** Revert that site to its original
unconditional seal. Predict each turns its own test red. For `commitTurso` the prediction is
two failing assertions: `saveSecretValue` called with `""`, and the Remove button present.

- [ ] **Step 6: Close §565.** The Status line records that the entry undercounted (four sites,
not two), that the Turso site was **visible** in the UI (the Remove button appeared after a
clear), and that recon had wrongly named `handleTokenLockToggle` as the pattern to follow.

- [ ] **Step 7: Commit.**

---

### Task 6: Diagnostics redactor: a mixed-class catch-all (§564)

**Files:**
- Modify: `src/app/diagnostics-redact.ts` (`SECRET_VALUE_PATTERNS`)
- Test: `src/app/diagnostics-redact.test.ts`
- Modify: `docs/open-followups.md` (close §564)

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests** in `diagnostics-redact.test.ts`:

```ts
describe("§564: an opaque token with no vendor prefix is redacted, legitimate ids survive", () => {
  const TOKEN = "aB3xQ9zK7mP2wR8tL4vN6yH1sJ5dF0gC"; // 32, lower + upper + digit
  it("redacts a bare mixed-class token inside free text", () => {
    const out = redactFields({ message: `upstream said ${TOKEN} was rejected` });
    expect(out?.message).toBe("upstream said [redacted] was rejected");
  });
  // ★ Every one of these is a real shape that flows through logDiag in this app. A redaction
  // test with only the positive half proves nothing about what it costs.
  it.each([
    ["a lowercase UUID (crypto.randomUUID ids)", "f47ac10b-58cc-4372-a567-0e02b2c3d479"],
    ["an uppercase GUID (MSAL client / tenant ids)", "F47AC10B-58CC-4372-A567-0E02B2C3D479"],
    ["a 40-char commit SHA", "0fa7cc72a4b1c8e9d2f3a6b5c4d3e2f1a0b9c8d7"],
    ["a long camelCase i18n key", "integrationsTursoTokenPlaceholder"],
    ["a German compound word", "Datenschutzgrundverordnungsbeauftragter"],
    ["a stack frame", "at jsonToWorkspace (webpack-internal:///./src/app/workspace.ts:787:14)"],
    ["a 31-char mixed-class run (one under the floor)", "aB3xQ9zK7mP2wR8tL4vN6yH1sJ5dF0g"],
  ])("leaves %s untouched", (_label, value) => {
    expect(redactFields({ id: value })?.id).toBe(value);
  });
});
```

- [ ] **Step 2: Run it.** The positive case fails because the token survives. Every negative
passes today. That is expected: they are the guard, and mutants 6a–6d are what give them teeth.

- [ ] **Step 3: Implement.** Append to `SECRET_VALUE_PATTERNS`:

```ts
  // §564: an opaque token with no vendor prefix and no `key=` frame. A run of 32+ from the
  // token alphabet that mixes lowercase, uppercase AND a digit. The mix is what keeps real ids
  // readable: canonical UUIDs and commit SHAs are single-case hex, MSAL GUIDs are upper-only,
  // i18n keys and German words carry no digit, and stack frames break into short runs at
  // `/ : ( .`. The lookaheads cannot see past the run, because their class excludes every
  // separator. ★ Known miss: a token that is entirely single-case hex is NOT caught, which is
  // the price of keeping UUIDs and SHAs in diagnostics.
  /(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/g,
```

★ Do **not** add a separate UUID-shape exclusion. With the class rule in place, removing one
would change no output on any canonical UUID, so it would be a guard with no killing mutant. Do
not use a lookbehind either: the tsconfig target rejects it, as it rejects the `/s` flag.

- [ ] **Step 4: Run** the file, then `tsc` and `eslint`.

- [ ] **Step 5: Mutants, each on its own.**

| # | Mutant | Prediction |
|---|---|---|
| 6a | drop the `[A-Z]` lookahead | RED: the lowercase UUID and the commit SHA are redacted |
| 6b | drop the `[a-z]` lookahead | RED: the uppercase GUID is redacted |
| 6c | drop the `\d` lookahead | RED: the i18n key and the German word are redacted |
| 6d | `{32,}` becomes `{31,}` | RED: the 31-char row is redacted |

- [ ] **Step 6: Close §564.** The Status line records the known miss (single-case hex tokens),
and why no UUID exclusion ships: it had no mutant that could kill it.

- [ ] **Step 7: Commit.**

---

### Task 7: Jira proxy logs `{ message, cause }`, at both sites (§566)

**Files:**
- Modify: `src/app/api/jira/_helpers.ts`
- Test: `src/app/api/jira/_helpers.test.ts`
- Modify: `docs/open-followups.md` (close §566)

**Interfaces:** none.

★★ The existing test asserts
`toHaveBeenCalledWith("Jira upstream fetch failed:", expect.any(Error))`. That assertion
**requires** the raw object, so it pins the defect. It changes as part of this task. Its
fixture, a plain `Error("ECONNREFUSED")`, is also not the real shape: Node's `fetch` always
rejects with `TypeError("fetch failed", { cause })`.

- [ ] **Step 1: Fix the fixture first, then write the failing assertions.** In
`"returns a 502 envelope (not an unhandled throw) when the upstream fetch fails"`:

```ts
    // The REAL undici shape: `fetch` always rejects with "fetch failed" and puts the reason in
    // `cause`. A plain Error("ECONNREFUSED") fixture could not tell a logged cause from a lost one.
    const cause = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause }));
    // ...existing 502 assertions unchanged...
    // §566: log a plain object carrying the cause, never the raw error object.
    const [label, payload] = errSpy.mock.calls[0];
    expect(label).toBe("Jira upstream fetch failed:");
    expect(payload).not.toBeInstanceOf(Error);
    expect(payload).toEqual({ message: "fetch failed", cause: "connect ECONNREFUSED 10.0.0.1:443", code: "ECONNREFUSED" });
```

Add a test for the redirect body-cancel log, next to
`"refuses an upstream 3xx rather than following it to an unvalidated host"`. That test's
`new Response(null, …)` has no body, so `cancel` never runs there. This one hand-builds a
response whose body cancel rejects:

```ts
  it("§566: logs the redirect body-cancel failure as a plain object with its cause", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "https://evil.example/" }),
      body: { cancel: () => Promise.reject(new TypeError("terminated", { cause })) },
    } as unknown as Response);
    const res = await callWith("https://acme.atlassian.net");
    expect(res.status).toBe(502);
    await new Promise((r) => setTimeout(r, 0)); // the cancel is deliberately not awaited
    const call = errSpy.mock.calls.find(([label]) => label === "Jira upstream redirect body cancel failed:");
    expect(call).toBeDefined(); // presence: the cancel path really ran
    expect(call![1]).not.toBeInstanceOf(Error);
    expect(call![1]).toEqual({ message: "terminated", cause: "socket hang up", code: "ECONNRESET" });
    errSpy.mockRestore();
  });
```

- [ ] **Step 2: Run and watch it fail.** It fails on `payload` being an `Error` instance.

- [ ] **Step 3: Implement** in `_helpers.ts`:

```ts
/** §566: what the proxy logs for an upstream failure — a plain object, never the raw error.
 *  ★★ NOT `err.message` alone: Node's `fetch` ALWAYS rejects with `TypeError("fetch failed",
 *  { cause })`, so the message is the same literal for DNS, refused, TLS and timeout alike, and
 *  the reason lives in `cause`. Never the object itself: nothing in it is a credential today,
 *  but its shape is undici's to change. */
function describeUpstreamError(err: unknown): { message: string; cause?: string; code?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const c = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (c === undefined) return { message };
  const code = typeof (c as { code?: unknown })?.code === "string" ? (c as { code: string }).code : undefined;
  return { message, cause: c instanceof Error ? c.message : String(c), ...(code ? { code } : {}) };
}
```

Both `console.error` calls pass `describeUpstreamError(err)` instead of `err`.

- [ ] **Step 4: Run** the file, then `tsc` and `eslint`.

- [ ] **Step 5: Mutants, each on its own.** (7a) `describeUpstreamError` returns `{ message }`
only: predict RED on the `toEqual` (cause lost). (7b) the fetch-failure site passes raw `err`
again: predict RED on `not.toBeInstanceOf(Error)`. (7c) the cancel site passes raw `err`: predict
RED on the cancel test.

- [ ] **Step 6: Close §566.** The Status line records that the entry's prescribed `err.message`
would have logged `"fetch failed"` for every failure, that the old test fixture could not show
it, and that the second site, which the entry did not name, is fixed too.

- [ ] **Step 7: Commit.**

---

### Task 8: Chart readout: full-stop join (§570) and clamp boundary (§571)

Two commits, one per entry, each closing its own entry.

**Files:**
- Modify: `src/app/chart-readout.tsx` (`rowText`), `src/app/use-chart-readout.ts` (`anchorFor`)
- Test: `src/app/chart-readout.test.tsx`, `src/app/use-chart-readout.test.tsx`
- Modify: `docs/open-followups.md` (close §570, then §571)

**Interfaces:** none.

#### §570

- [ ] **Step 1: Update the pinning assertion and write the new test.** In
`"speaks each row's explanation after its value"`, change the two expectations to
`"Planned: 80 EUR. What the plan expected to be spent by this date."` and
`"At current pace: 60 EUR, forecast. Where spending lands if it continues at the recent daily average."`.
★ The old comma form **is the bug**. Then add a test that reads the tips off the rendered box, so
the German strings are never hand-copied, and so the capitalised German forecast flag
`, Prognose` (a noun, correctly capitalised) is never matched:

```tsx
import { loadI18n } from "./i18n";

describe("§570: each spoken explanation starts its own sentence", () => {
  it.each(["en-US", "de"] as const)("joins every row's tip with a full stop in %s", async (lang) => {
    if (lang === "de") await loadI18n("de");
    render(<ChartReadout lang={lang} readout={full} anchor={{ top: 10, left: 20 }} fmt={fmt} locale={lang} />);
    const tips = screen.getAllByRole("listitem", { hidden: true })
      .map((li) => li.lastElementChild?.textContent ?? "");
    expect(tips).toHaveLength(10);                  // presence: ten tips read, not zero
    expect(tips.every((tip) => tip.length > 0)).toBe(true);
    const text = readoutSentence(lang, full, fmt, lang);
    for (const tip of tips) {
      expect(text).toContain(`. ${tip}`);
      expect(text).not.toContain(`, ${tip}`);
    }
  });
});
```

First confirm that each list item's **last element child** is the tip span. If it is not,
select the tip by the span `ChartReadout` renders for `ROW[row.kind].tip`.

- [ ] **Step 2: Run and watch it fail.** The `. ${tip}` assertion fails in both languages.

- [ ] **Step 3: Implement.** In `rowText`, `` return `${flagged}. ${t(lang, ROW[row.kind].tip)}`; ``,
and add a sentence to its docstring: the tip is its own sentence because every tip starts with a
capital, and a future German tip may begin with a noun that must keep one.

- [ ] **Step 4: Run** the file, then `tsc` and `eslint`. **Mutant 8a:** revert to `, `. Predict
RED in both languages.

- [ ] **Step 5: Close §570** and **commit.** The Status line notes that no i18n change was needed,
and that the existing test had pinned the comma.

#### §571

- [ ] **Step 6: Write the failing test** in `use-chart-readout.test.tsx`, beside the narrow-chart
cases, using that file's `stubRect` and `anchorAt`:

```tsx
    // §571: the boundary. At exactly the box's width (352) the clamp range collapses to one
    // point, the chart's centre, and the box fits exactly. Home's raw x is
    // left + 64 × width/640 = 335 at both widths; the chart centre is 300 + 176 = 476.
    const rectOf = (left: number, width: number) =>
      ({ left, top: 50, width, height: 240, right: left + width, bottom: 290, x: left, y: 50, toJSON: () => ({}) }) as DOMRect;

    it("clamps into the chart when the chart is exactly as wide as the box", async () => {
      stubRect(rectOf(300, 352));
      expect(await anchorAt("{Home}")).toBe("58/476");
    });

    it("leaves the stop raw one pixel below the boundary", async () => {
      stubRect(rectOf(300, 351));
      expect(await anchorAt("{Home}")).toBe("58/335");
    });
```

★ The 351 case cannot be asserted by its distance from the centre: the clamped value there
(475.5) rounds to the same 476. It is pinned by the raw position instead.

- [ ] **Step 7: Run and watch the 352 case fail** with `58/335`. The 351 case passes today.

- [ ] **Step 8: Implement.** In `anchorFor`, change `rect.width > HALF * 2` to
`rect.width >= HALF * 2`, and add to the docstring: at equality the clamp range is a single
point, the centre, where the box fits exactly.

- [ ] **Step 9: Run** the file. **Mutant 8b:** revert to `>`. Predict RED on the 352 case.

- [ ] **Step 10: Close §571** and **commit.** The Status line records the decision that 352 is
clamped, and why.

---

### Task 9: FX rates: EUR first on every decode (§576)

**Files:**
- Modify: `src/app/sanitize-entities.ts` (`fxRatesWithDateReader`)
- Test: `src/app/sanitize-budget.test.ts`
- Modify: `docs/open-followups.md` (close §576)

**Interfaces:** none. ★ **Do not touch `sample-workspace-small.json`.** Its FX block already
carries EUR, and the goldens already read `EUR=1|USD=1.1|GBP=0.85`.

- [ ] **Step 1: Write the failing test** in `sanitize-budget.test.ts`:

```ts
import { sanitizeFxRates, sanitizeLoadedFxRates } from "./sanitize";

describe("§576: FX rate key order is stable across decodes", () => {
  const input = { base: "EUR", date: "2026-09-01", fetchedAt: "2026-09-01T12:00:00Z", rates: { USD: 1.1, GBP: 0.85 } };
  // ★ toEqual ignores key order, which is how three suites missed this. Compare Object.keys.
  it.each([["strict", sanitizeFxRates], ["load", sanitizeLoadedFxRates]] as const)(
    "gives the same key order on a first and a second decode (%s)", (_label, decode) => {
      const first = decode(input);
      expect(first).not.toBeNull(); // presence: a null decode would make the comparison vacuous
      const second = decode(JSON.parse(JSON.stringify(first)));
      expect(Object.keys(first!.rates)).toEqual(["EUR", "USD", "GBP"]);
      expect(Object.keys(second!.rates)).toEqual(Object.keys(first!.rates));
    },
  );
  it("still gives a missing currency no key", () => {
    const out = sanitizeFxRates({ ...input, rates: { USD: 1.1 } });
    expect(Object.keys(out!.rates)).toEqual(["EUR", "USD"]);
  });
});
```

- [ ] **Step 2: Run it.** It fails with `["USD","GBP","EUR"]` on the first decode.

- [ ] **Step 3: Implement.** In `fxRatesWithDateReader`, replace the loop and the trailing
`rates.EUR = 1;` with:

```ts
  // §576: EUR is assigned AT ITS POSITION in SUPPORTED_CURRENCIES, unconditionally. It used to
  // be patched in after the loop, so an input WITHOUT EUR (a raw ECB fetch) came out
  // USD,GBP,EUR and re-decoded as EUR,USD,GBP: not byte-stable through a JSON round trip.
  for (const code of SUPPORTED_CURRENCIES) {
    if (code === "EUR") { rates.EUR = 1; continue; }
    const n = toNumber((ratesIn as Record<string, unknown>)[code]);
    if (Number.isFinite(n) && n > 0) rates[code] = Math.round(n * 1e6) / 1e6;
  }
```

- [ ] **Step 4: Run** the new test **and the byte-pinned goldens**:

```bash
npx vitest run src/app/sanitize-budget.test.ts src/app/golden-workspace.test.ts src/app/sanitize-branches.test.ts src/app/sanitize-load-date.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t9.log" 2>&1; echo "EXIT=$?"
git diff --stat -- src/app/__fixtures__/ sample-workspace-small.json; echo "(must be empty)"
```

The golden test passing **with no fixture diff** is the presence half: the fix changed nothing
that was already stable. Then run `tsc` and `eslint`.

- [ ] **Step 5: Mutant 9a:** restore the post-loop `rates.EUR = 1` and skip EUR in the loop.
Predict RED on the key-order assertion.

- [ ] **Step 6: Close §576.** The Status line **corrects the entry's causal story**: the
instability depends on whether EUR is **present**, not on its position, so no golden regen was
needed. Include the four-line reproduce output from the spec. Note that §597's
regenerate-and-diff ratchet is not blocked by this on current data, and cite §597 by number.

- [ ] **Step 7: Commit.**

---

### Task 10: Close §391 as a record, and release 1.12.7

**Files:**
- Modify: `src/app/chat-proposal-block.tsx` (header comment only)
- Modify: `docs/open-followups.md` (close §391)
- Modify: `src/app/version.ts`, `CHANGELOG.md`, and the satellites `npm run version:sync` writes

**Interfaces:** consumes the §-numbers and GitLab issue numbers noted in each earlier task's
closure step 1.

- [ ] **Step 1: Rewrite the stale comment.** In `chat-proposal-block.tsx`, the `★★★ EVERY STAGED
CALL GETS A ROW` paragraph lists `set_task_dependencies` as an empty-plan tool, which it is not
(it has its own describer), and omits `escalate_raid_item`. Replace the list with a pointer to
the test that pins it, so the comment cannot drift from the set again:

```ts
// ★★★ EVERY STAGED CALL GETS A ROW, INCLUDING ONE THE DESCRIPTOR ENGINE CANNOT
// DIFF. `describeProposal` emits an EMPTY plan for the stageable write tools that have no
// `INLINE_DESCRIPTORS` entity and no hand-written describer. The authoritative list is the test
// "omits exactly the stageable write tools the descriptor engine cannot diff" in
// `chat-proposal-describe.test.ts` — read it there rather than restating it here; a copy of
// that list in this comment went stale once already (it named a tool that had since gained
// a describer). Those rows carry only `call.name` and `call.input`, and they are the rows
// that most need to be VISIBLE: ...
```

Keep the rest of the paragraph, from "document writes take no undo capture" on, verbatim.

- [ ] **Step 2: Close §391 as a record** with the closure recipe. The Status line: the defect was
already fixed by a dedicated `set_task_dependencies` branch ahead of the empty-plan fallback,
pinned by the named test; the remaining empty-plan tools are empty by design; this closure also
corrects the stale comment. Commit it.

- [ ] **Step 3: Release.** Set `APP_VERSION = "1.12.7"` and `APP_BUILD_DATE` to today in
`src/app/version.ts`, move the old 1.12.5 build-date comment into the history lines below it the
way earlier releases did, and write the new line's summary. Then:

```bash
npm run version:sync > "$SCRATCH/vs.log" 2>&1; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```

Add `## [1.12.7] - <today> "Child"` to `CHANGELOG.md` above the newest entry, with one bullet per
closed entry under `### Fixed`, citing `§N`. **No session URL anywhere in the CHANGELOG.** If the
concurrent branch's 1.12.6 has landed on `origin/main` by now, merge `origin/main` first and put
1.12.7 above 1.12.6.

- [ ] **Step 4: Final register check,** all unpiped:

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run followups:workitems:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
grep -cE "^## (365|391|541|542|544|564|565|566|570|571|576)\..* — CLOSED" docs/open-followups.md   # expect 11
```

- [ ] **Step 5: Commit** the version files and the CHANGELOG. Write the MR description's closing
block now and keep it in the scratchpad: one `Closes #NN` **per line** for the eleven issue
numbers noted in each closure step 1. Pushing and opening the MR happen only on the owner's say.
