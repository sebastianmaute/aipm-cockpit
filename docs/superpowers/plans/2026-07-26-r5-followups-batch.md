# R5 follow-ups batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close follow-up items 1, 3, 7, 9 and 10 from `docs/superpowers/r5-calendar-followups.md` — give calendar events activity-log entries and undo, fix the empty-`localModifiedAt` bug in two sanitizers, drop a duplicate `addDays`, land four small calendar fixes, and correct AGENTS.md's stale `A11Y_VIEWS` count — and ship them as 0.202.1.

**Architecture:** Additive throughout. The activity/undo work follows the `useChangeLog` per-entity-hook convention exactly (optional callback args in, `captureFieldChanges` + `logActivityChanges` out), which is the convention `use-calendar-events.ts` was extracted to follow but never finished. Nothing new is persisted, so there is no six-write-path chore and no golden-fixture regeneration. Design doc: `docs/superpowers/specs/2026-07-26-r5-followups-batch-design.md`.

**Tech Stack:** TypeScript, Next.js 16, React, vitest + @testing-library/react, Playwright/axe, i18n EN+DE.

---

## Ground rules for this plan

Read these once before Task 1. They are the traps this specific batch walks into.

1. **`use-resource-planner.ts` is at 1037 lines against a 1038 baseline** (`docs/baselines/file-sizes.json`). Task 5 replaces exactly one line there with one longer line. **Never add a net line to that file** and never re-run the baseline writer — follow-up item 4 exists precisely because the last re-baseline made the size problem look solved.
   Other files in this batch are unconstrained: only 6 files are baselined (`chat-panel.tsx`, `task-manager.tsx`, `task-row.tsx`, `tasks-section.tsx`, `use-resource-planner.ts`, `workspace-section.tsx`), and both i18n dictionaries are `EXEMPT` in `scripts/check-file-sizes.mjs:9`.

2. **Never edit `src/app/i18n.de.ts` with the Edit tool.** It corrupts umlauts and curls double quotes. The file is CRLF, so a node patch anchored on `\n` silently no-ops. Every DE insertion in this plan ships as a node script that matches `\r\n` explicitly, writes `utf8`, and is grep-verified after. `src/app/i18n.ts` (EN) is safe to Edit.

3. **After any multi-edit task, check for NUL bytes** before committing — the Edit tool has turned a typed space into `\x00` before, and git then shows the file as binary:
   ```bash
   node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);if(b.includes(0))throw new Error('NUL byte in '+f);}console.log('no NUL bytes')" src/app/i18n.ts src/app/i18n.de.ts
   ```

4. **Commits carry no attribution trailers.** Attribution is disabled globally for this user, and the repo's history has none.

5. **Run `npx tsc --noEmit` after touching any test file.** `next build` does not typecheck `*.test.tsx` and vitest never typechecks, so a test-only type error passes locally and fails CI.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/app/sanitize-entities.ts` | Modify `:97-100`, `:184-187` | Absence/Shift validators — collapse the `localModifiedAt` arm onto the `sanitizeText(...) \|\| undefined` form |
| `src/app/gantt-engine.ts` | Modify `:249-251` | Stop redefining `addDays`; re-export `calendar-window`'s |
| `src/app/calendar-window.ts` | Modify comment `:25-31` | Comment no longer describes the duplicate as deferred |
| `src/app/recurrence.ts` | Modify `:235`, `:247` | Narrow `truncated` so a trailing-buffer stop isn't reported as hidden data |
| `src/app/resource-calendar-band.tsx` | Modify `:88` | Banner cell role `rowheader` → `gridcell` |
| `src/app/resource-calendar.tsx` | Modify `:170-173`, `:206`, `:285`, `:301`, `:526-527` | `justCancelled` carries which mode was cancelled |
| `src/app/activity-log.ts` | Modify `:12-59`, `:161-209` | Three new `ActivityKind` members + their key mappings |
| `src/app/undo/field-groups.ts` | Modify (append) | `CALENDAR_EVENT_UNDO_GROUPS` |
| `src/app/use-calendar-events.ts` | Modify throughout | Activity logging + undo capture for the entity |
| `src/app/use-resource-planner.ts` | Modify `:392` **one line for one line** | Thread the four callbacks it already receives |
| `src/app/calendar-event-modal.tsx` | Modify (add hint after `:262`) | Warn that turning repeat off discards exceptions |
| `src/app/i18n.ts` / `i18n.de.ts` | Add 5 keys | 3 activity strings, `calendarResizeModeCancelled`, `calendarEventExceptionsDiscarded` |
| `src/app/version.ts`, `CHANGELOG.md`, `AGENTS.md`, `docs/superpowers/r5-calendar-followups.md` | Modify | Release chores + doc corrections |

Test files touched: `sanitize.test.ts` (or the absence/shift sanitizer test file), `recurrence.test.ts`, `resource-calendar.test.tsx`, `resource-calendar-band.test.tsx`, `undo/field-groups.test.ts`, `use-calendar-events.test.tsx`, `calendar-event-modal.test.tsx`.

---

## Task 1: Absence + Shift `localModifiedAt` (follow-up item 3)

**Files:**
- Modify: `src/app/sanitize-entities.ts:97-100` and `:184-187`
- Test: `src/app/sanitize.test.ts`

Start here: it is pure, isolated, and its test is the one most likely to be written vacuously.

- [ ] **Step 1: Find the right test file**

Run: `ls src/app | grep -E '^sanitize.*test'`

Add the new tests to `src/app/sanitize.test.ts` if it exists; otherwise use whichever file already contains `sanitizeAbsence` tests (`grep -rln 'sanitizeAbsence' src/app/*.test.ts`).

- [ ] **Step 2: Write the failing tests**

Append to that file. Note the assertion form — this is the whole point of the test:

```ts
describe("localModifiedAt from an empty cell", () => {
  // Every CSV/MD cell decodes to a real "" — never undefined. The old form
  // (`typeof raw.localModifiedAt === "string" ? raw.localModifiedAt : undefined`)
  // therefore kept the empty string as a value.
  //
  // toBeUndefined() is discriminating here precisely BECAUSE the fixture passes
  // an explicit "": the old code returns that "", which is not undefined, so
  // this fails against it. (Note the key itself stays present either way — an
  // object-literal `x: undefined` still creates the key, so an `in` check would
  // NOT pass even with the fix. Absence of the key is not what we're asserting.)
  it("sanitizeAbsence does not keep an empty localModifiedAt as a value", () => {
    const result = sanitizeAbsence({
      id: 1, assignee: "Anna", startDate: "2026-06-01", endDate: "2026-06-02",
      type: "vacation", localModifiedAt: "",
    });
    expect(result).not.toBeNull();
    expect(result!.localModifiedAt).toBeUndefined();
  });

  it("sanitizeAbsence keeps a real localModifiedAt", () => {
    const result = sanitizeAbsence({
      id: 1, assignee: "Anna", startDate: "2026-06-01", endDate: "2026-06-02",
      type: "vacation", localModifiedAt: "2026-06-01T10:00:00.000Z",
    });
    expect(result!.localModifiedAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("sanitizeShift does not keep an empty localModifiedAt as a value", () => {
    const result = sanitizeShift({
      id: 1, assignee: "Anna", hoursPerWeekday: 8, localModifiedAt: "",
    });
    expect(result).not.toBeNull();
    expect(result!.localModifiedAt).toBeUndefined();
  });

  it("sanitizeShift keeps a real localModifiedAt", () => {
    const result = sanitizeShift({
      id: 1, assignee: "Anna", hoursPerWeekday: 8,
      localModifiedAt: "2026-06-01T10:00:00.000Z",
    });
    expect(result!.localModifiedAt).toBe("2026-06-01T10:00:00.000Z");
  });
});
```

If `sanitizeAbsence` / `sanitizeShift` are not already imported in that file, add them to the existing `import { ... } from "./sanitize";`.

- [ ] **Step 3: Run the tests to verify the two "omits" cases FAIL**

Run: `npx vitest run src/app/sanitize.test.ts -t "localModifiedAt from an empty cell"`

Expected: the two "omits ... when the cell is empty" tests FAIL with `expected true to be false` (the key is present, holding `""`). The two "keeps a real" tests PASS already — they are regression guards, not the new behaviour.

★ If the "omits" tests PASS here, stop: the anchors are wrong or the file was already fixed. Do not proceed.

- [ ] **Step 4: Fix `sanitizeAbsence`**

In `src/app/sanitize-entities.ts`, replace:

```ts
    localModifiedAt:
      typeof raw.localModifiedAt === "string"
        ? raw.localModifiedAt
        : undefined,
    resourceId: fkIdOrUndefined(raw.resourceId),
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
```

with:

```ts
    // `|| undefined`, not a bare typeof check: every CSV/MD cell decodes to a
    // real "" rather than undefined, so the typeof form kept the empty string
    // as a value. Same form calendar-event.ts uses.
    localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
    resourceId: fkIdOrUndefined(raw.resourceId),
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
```

- [ ] **Step 5: Fix `sanitizeShift`**

Replace:

```ts
    resourceId: fkIdOrUndefined(raw.resourceId),
    localModifiedAt:
      typeof raw.localModifiedAt === "string"
        ? raw.localModifiedAt
        : undefined,
  };
}
```

with:

```ts
    resourceId: fkIdOrUndefined(raw.resourceId),
    // See sanitizeAbsence above — an empty cell must not become a value.
    localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/sanitize.test.ts -t "localModifiedAt from an empty cell"`
Expected: 4 passed.

- [ ] **Step 7: Verify no serialized-byte change**

Run: `npx vitest run src/app/golden-workspace.test.ts`
Expected: PASS with no fixture regeneration. Both forms encode back to `""`, so a failure here means something else changed — investigate, do not regenerate fixtures.

- [ ] **Step 8: Run the full sanitizer suites**

Run: `npx vitest run src/app/sanitize.test.ts src/app/sanitize.property.test.ts`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/app/sanitize-entities.ts src/app/sanitize.test.ts
git commit -F - <<'EOF'
fix(sanitize): an empty localModifiedAt cell must not become a value

sanitizeAbsence and sanitizeShift kept a literal "" because they guarded with
a bare `typeof === "string"`. Every CSV/MD cell decodes to a real empty string,
never undefined, so an absence or shift loaded without a timestamp carried
localModifiedAt: "". Collapsed both onto the sanitizeText(...) || undefined
form calendar-event.ts already uses.

No serialized-byte change (both forms encode back to ""), so the golden
fixtures are the net rather than needing regeneration. Missed to date because
those entities' fixtures always populate the field — hence the
`"localModifiedAt" in result` assertion, which a toBeUndefined() check would
have passed against the old code.
EOF
```

---

## Task 2: Consolidate `addDays` (follow-up item 7)

**Files:**
- Modify: `src/app/gantt-engine.ts:249-251`
- Modify: `src/app/calendar-window.ts:25-31` (comment only)

No new test: this is a byte-identical function being deduplicated, and the existing gantt suites already cover every call site. Under jscpd's 50-token floor, so `dup:check` never flagged it and never will.

- [ ] **Step 1: Confirm the two implementations really are equivalent**

Run: `sed -n '249,251p' src/app/gantt-engine.ts && sed -n '32,34p' src/app/calendar-window.ts && grep -n 'DAY_MS\s*=\|MS_PER_DAY\s*=' src/app/gantt-engine.ts src/app/calendar-window.ts`

Expected: both bodies are `return new Date(d.getTime() + n * <CONST>);` and both constants equal `86400000`. If the constants differ, STOP — this is not a safe consolidation.

- [ ] **Step 2: Replace the gantt definition with a re-export**

In `src/app/gantt-engine.ts`, replace:

```ts
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
```

with:

```ts
// Re-exported, not redefined: calendar-window.ts owns the one implementation.
// Kept exported from here so gantt.tsx / gantt-chrome.tsx keep importing it
// from this module unchanged.
import { addDays } from "./calendar-window";
export { addDays };
```

★ Move the `import` up to the file's existing import block rather than leaving it mid-file — ESLint's import ordering will otherwise complain, and `--max-warnings=0` makes that fatal. Keep the `export { addDays };` where the function was, with the comment.

- [ ] **Step 3: Check `DAY_MS` is still used**

Run: `grep -n 'DAY_MS' src/app/gantt-engine.ts`

If `DAY_MS` now has no remaining references, delete its declaration too — an unused `const` is a fatal lint error under `--max-warnings=0`. If it still has references, leave it.

- [ ] **Step 4: Update the `calendar-window.ts` comment**

Replace:

```ts
// Exported: shared with recurrence.ts, which needs the same "date ± n days"
// step for rule stepping. gantt-engine.ts carries a byte-identical copy
// (DAY_MS instead of MS_PER_DAY) for the milestone ghost bars — left alone
// here; folding that in too would widen this fix into Gantt's files, a
// separate follow-up.
```

with:

```ts
// Exported: the single "date ± n days" step in the app. recurrence.ts uses it
// for rule stepping, and gantt-engine.ts re-exports it (rather than carrying
// the byte-identical copy it used to) so Gantt's own callers are unchanged.
```

- [ ] **Step 5: Verify no cycle and that everything still compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. `calendar-window.ts` imports nothing from gantt, so there is no cycle; a cycle would surface here or at build.

- [ ] **Step 6: Run the gantt + calendar suites**

Run: `npx vitest run src/app/gantt-engine.test.ts src/app/calendar-window.test.ts src/app/recurrence.test.ts`
Expected: all pass. (Skip any of those paths that does not exist — check with `ls src/app | grep -E 'gantt-engine|calendar-window'` first.)

- [ ] **Step 7: Commit**

```bash
git add src/app/gantt-engine.ts src/app/calendar-window.ts
git commit -F - <<'EOF'
refactor(gantt): re-export calendar-window's addDays instead of redefining it

gantt-engine.ts carried a byte-identical third copy (DAY_MS vs MS_PER_DAY).
Re-exporting keeps every import site — gantt-engine's own use, gantt.tsx,
gantt-chrome.tsx — unchanged, so there is no call-site or test churn.

The copy sat under jscpd's 50-token floor, so dup:check would never have
flagged it; calendar-window.ts's comment no longer describes it as deferred.
EOF
```

---

## Task 3: Truncation false-positive (follow-up item 9, fourth bullet)

**Files:**
- Modify: `src/app/recurrence.ts:235` (add `hasMoveException`) and `:247` (gate the flag)
- Test: `src/app/recurrence.test.ts`

`expandOccurrences` generates from `seriesStart` all the way to `windowEnd + GENERATION_BUFFER_DAYS`. A series old enough to burn `MAX_ITERATIONS` **after** passing `windowEnd` sets `truncated` while the visible window is fully covered — so the band's banner claims data is hidden when none is. A stop out in that trailing buffer can only ever hide a **moved** occurrence, because an unmoved candidate past `windowEnd` is excluded by the window test at `:263` regardless.

- [ ] **Step 1: Read the constants so the test can actually reach the cap**

Run: `grep -n 'MAX_ITERATIONS\s*=\|MAX_OCCURRENCES\s*=\|GENERATION_BUFFER_DAYS\s*=' src/app/recurrence.ts`

Expected: `MAX_ITERATIONS = 20000`, `MAX_OCCURRENCES = 1000`, `GENERATION_BUFFER_DAYS = 366`. Note the actual values — the test below sizes its fixture from them.

- [ ] **Step 2: Write the failing tests**

Append to `src/app/recurrence.test.ts`. The fixture uses a **1-day window** far from a very old series start, so the walk burns its iteration budget in the trailing buffer rather than inside the window:

```ts
describe("truncated does not fire for a fully-covered window", () => {
  // A daily series starting ~54 years before the window: the rule walk passes
  // windowEnd and then keeps stepping through the 366-day generation buffer,
  // burning MAX_ITERATIONS out there. The window itself is completely covered,
  // so nothing is hidden and the banner must not claim otherwise.
  const oldDaily = (exceptions?: CalendarEvent["exceptions"]): CalendarEvent => ({
    id: 1,
    title: "Standup",
    startDate: "1972-01-01",
    startTime: "09:00",
    durationMinutes: 15,
    recurrence: { freq: "daily", interval: 1 },
    exceptions,
  });

  it("reports truncated=false when the stop happens past windowEnd and there are no move exceptions", () => {
    const { occurrences, truncated } = expandOccurrences(oldDaily(), "2026-06-01", "2026-06-01");
    // The window IS covered — the single in-window occurrence is present.
    expect(occurrences.map((o) => o.date)).toEqual(["2026-06-01"]);
    expect(truncated).toBe(false);
  });

  it("still reports truncated=true past windowEnd when a move exception could have been hidden", () => {
    // With a move exception on the books, a stop in the buffer walk really can
    // hide an occurrence relocated INTO the window, so the flag is honest.
    const { truncated } = expandOccurrences(
      oldDaily([{ date: "2030-01-01", kind: "move", toDate: "2026-06-01" }]),
      "2026-06-01",
      "2026-06-01",
    );
    expect(truncated).toBe(true);
  });

  it("still reports truncated=true when the stop happens INSIDE the window", () => {
    // Window start is far enough past the series start that the budget runs out
    // before the walk reaches windowEnd — real incomplete coverage.
    const { truncated } = expandOccurrences(oldDaily(), "2026-06-01", "2036-06-01");
    expect(truncated).toBe(true);
  });
});
```

★ `CalendarEvent` and `expandOccurrences` are presumably already imported in this file; verify with `grep -n '^import' src/app/recurrence.test.ts` and add what is missing.

- [ ] **Step 3: Run the tests to verify the first one FAILS**

Run: `npx vitest run src/app/recurrence.test.ts -t "fully-covered window"`

Expected: test 1 FAILS (`expected true to be false`). Tests 2 and 3 PASS already — they pin the behaviour that must NOT change.

★ If test 1 passes, the fixture is not reaching `MAX_ITERATIONS` at all. Confirm by temporarily asserting `truncated` is `true` before the fix; if it is `false` for the wrong reason the test proves nothing. Widen `startDate` further back (or lengthen the window) until you have seen it fail for the right reason.

★ If test 3 fails, the window is large enough that `MAX_OCCURRENCES` fires instead of `MAX_ITERATIONS` — that is a different branch and this fix must not change it. Shrink the window until only the iteration cap is in play.

- [ ] **Step 4: Add the `hasMoveException` derivation**

In `expandOccurrences`, right after the existing `exceptionsByDate` line:

```ts
  const exceptionsByDate = new Map((event.exceptions ?? []).map((e) => [e.date, e] as const));
  // Whether the trailing buffer walk has anything to find: only a MOVED
  // occurrence can be relocated back into the window from a rule date past
  // windowEnd. Same bounded list exceptionsByDate is built from.
  const hasMoveException = (event.exceptions ?? []).some((e) => e.kind === "move");
```

- [ ] **Step 5: Gate the flag**

Replace:

```ts
    if (totalProcessed > MAX_ITERATIONS) { truncated = true; return "stop"; }
```

with:

```ts
    if (totalProcessed > MAX_ITERATIONS) {
      // A stop AFTER we walked past wEnd is inside the trailing buffer walk,
      // whose only purpose is finding occurrences MOVED back into the window —
      // an unmoved candidate out there is excluded by the window test below
      // regardless. So it is real truncation only when this event actually
      // carries a move exception; otherwise the window is fully covered and
      // reporting truncation would make the band's banner state something
      // false. Narrows the flag only — never newly sets it.
      if (candidate.getTime() <= wEndMs || hasMoveException) truncated = true;
      return "stop";
    }
```

- [ ] **Step 6: Run the tests to verify all three pass**

Run: `npx vitest run src/app/recurrence.test.ts -t "fully-covered window"`
Expected: 3 passed.

- [ ] **Step 7: Run the whole recurrence + calendar surface suites**

Run: `npx vitest run src/app/recurrence.test.ts src/app/recurrence.property.test.ts src/app/resource-calendar.test.tsx src/app/calendar-series-list.test.tsx`

Expected: all pass. The series list renders "Unknown (search limit reached)" off this same flag, so a regression there would surface here. (Skip any path that does not exist.)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/app/recurrence.ts src/app/recurrence.test.ts
git commit -F - <<'EOF'
fix(recurrence): don't report truncation when the window was fully covered

expandOccurrences generates from seriesStart out to windowEnd +
GENERATION_BUFFER_DAYS, so a series old enough to burn MAX_ITERATIONS AFTER
passing windowEnd set truncated while the visible window was complete — the
meetings band then showed its "truncated" banner with nothing actually hidden.

A stop in that trailing buffer can only hide a MOVED occurrence (an unmoved
candidate past windowEnd is excluded by the window test anyway), so the flag
is now gated on the stop being in-window or the event carrying a move
exception. This narrows the flag only and never newly sets it, so
nearestOccurrence and its documented `undefined && truncated` contract get
strictly more accurate. The MAX_OCCURRENCES branch is untouched.
EOF
```

---

## Task 4: Band cell role + `monthLabel` test + resize-cancel announcement (follow-up item 9, first three bullets)

**Files:**
- Modify: `src/app/resource-calendar-band.tsx:88`
- Modify: `src/app/resource-calendar.tsx:170-173`, `:206`, `:285`, `:301`, `:526-527`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one new key)
- Test: `src/app/resource-calendar-band.test.tsx`, `src/app/resource-calendar.test.tsx`

### 4a — banner cell role

- [ ] **Step 1: Write the failing test**

Append to `src/app/resource-calendar-band.test.tsx`. Match the file's existing render helper — check it first with `grep -n 'render(' src/app/resource-calendar-band.test.tsx | head -3`, and reuse whatever prop bag the neighbouring truncation test uses:

```tsx
it("the truncation banner cell is a gridcell, not a rowheader", () => {
  // rowheader asserts "this cell labels its row"; the full-width banner labels
  // nothing. The per-lane sticky first cell keeps rowheader — that one does.
  const { container } = render(
    <table>
      <CalendarBand
        lang="en-US"
        lanes={[]}
        days={[{ iso: "2026-06-01", dayOfMonth: 1, weekdayLabel: "Mon", isoWeek: 23, monthLabel: "Jun", isWeekend: false, isHoliday: false, isToday: false }]}
        eventsById={new Map()}
        truncated
      />
    </table>,
  );
  const banner = container.querySelector("[data-calendar-band] td");
  expect(banner).not.toBeNull();
  expect(banner!.getAttribute("role")).toBe("gridcell");
});
```

★ If `CalendarDay` has fields beyond those, copy the exact shape from the existing test's fixture rather than inventing one — `resource-calendar-shared.ts` is the type's home.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/resource-calendar-band.test.tsx -t "gridcell"`
Expected: FAIL — `expected 'rowheader' to be 'gridcell'`.

- [ ] **Step 3: Fix the role**

In `src/app/resource-calendar-band.tsx`, in the `{truncated && (` block, change the banner `<td>`:

```tsx
          <td
            role="gridcell"
            colSpan={1 + days.length}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/resource-calendar-band.test.tsx`
Expected: all pass (the whole file, to catch a neighbouring test that asserted the old role).

### 4b — `monthLabel` UTC test

- [ ] **Step 5: Write the test (no production change — this covers an existing fix)**

Add to `src/app/resource-calendar.test.tsx`, directly after the existing `America/New_York` weekday test that ends around `:235`. Use the SAME prop bag as that test:

```tsx
it("renders the UTC month label, not the runtime zone's", () => {
  // monthLabel got the same timeZone:"UTC" fix as weekdayLabel but no test.
  // 2026-07-01T00:00Z is still 2026-06-30 in America/New_York, so a label
  // derived in the local zone reads "Jun" while the day number says 1.
  const originalTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    render(
      <ResourceCalendar
        lang="en-US"
        rows={[{ key: "anna", display: "Anna", email: "" }]}
        absences={[]}
        today="2026-07-01"
        holidaySet={new Set()}
        onAddAbsence={() => {}}
        onEditAbsence={() => {}}
        resources={[]}
        onEditResource={() => {}}
        onAddResource={() => {}}
        startDate="2026-07-01"
        endDate="2026-07-01"
      />,
    );
    expect(screen.getByText("Jul")).toBeInTheDocument();
    expect(screen.queryByText("Jun")).not.toBeInTheDocument();
  } finally {
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
  }
});
```

- [ ] **Step 6: Run it — it must PASS immediately**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "UTC month label"`
Expected: PASS. This test documents an already-correct behaviour, so passing is right.

★ Prove it is not vacuous: temporarily delete `timeZone: "UTC"` from `resource-calendar.tsx:117`, re-run, confirm it FAILS, then restore. A test that passes with and without the fix is worthless — and this whole bullet exists because that fix shipped untested.

### 4c — resize-cancel announcement

- [ ] **Step 7: Add the EN string**

Edit `src/app/i18n.ts`, immediately after the `calendarResizeModeOn` line (~`:1527`):

```ts
  calendarResizeModeCancelled: "Resize cancelled",
```

- [ ] **Step 8: Add the DE string via a node heredoc (never the Edit tool)**

Run this with the Bash tool, from the repo root. The `\uXXXX` escapes are deliberate — they keep the
umlauts intact no matter what mangles the script text in transit, while the file receives real UTF-8:

```bash
node <<'EOF'
const { readFileSync, writeFileSync } = require("node:fs");
const p = "src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
if (s.includes("calendarResizeModeCancelled")) { console.log("already present"); process.exit(0); }

const anchor = "  calendarResizeModeOn:";
const i = s.indexOf(anchor);
if (i === -1) throw new Error("anchor not found");
const eol = s.indexOf("\r\n", i);
if (eol === -1) throw new Error("no CRLF after anchor — check line endings before patching");

// ö = o-umlaut, ß = sharp s  ->  "Gr__enanderung abgebrochen" with both.
const line = '\r\n  calendarResizeModeCancelled: "Größenänderung abgebrochen",';
writeFileSync(p, s.slice(0, eol) + line + s.slice(eol), "utf8");
console.log("inserted");
EOF
```

Expected: `inserted`

- [ ] **Step 9: Verify the DE bytes are real umlauts, not ASCII substitutes**

```bash
node -e "const l=require('fs').readFileSync('src/app/i18n.de.ts','utf8').match(/.*calendarResizeModeCancelled.*/)[0];console.log(JSON.stringify(l));if(!l.includes('ö')||!l.includes('ß'))throw new Error('umlauts corrupted');console.log('umlauts ok')"
```

Expected: the line printed with `ö`/`ß` intact, then `umlauts ok`. The `i18n-encoding` test bans ASCII substitutes like `oe`/`ss`, so a corrupted write fails CI.

- [ ] **Step 10: Write the failing announcement tests**

Add to `src/app/resource-calendar.test.tsx`. Reuse the file's existing keyboard-move helper if it has one (`grep -n 'Alt\|pendingMove\|move mode' src/app/resource-calendar.test.tsx`) so the key sequence matches how the component is actually driven:

```tsx
it("Escape from a keyboard RESIZE announces the resize cancellation, not the move one", () => {
  const { container } = render(
    <ResourceCalendar
      {...baseProps}
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 1, assignee: "Anna", startDate: "2026-06-10", endDate: "2026-06-11", type: "vacation" }]}
      resources={[]}
      startDate="2026-06-10"
      endDate="2026-06-12"
      onMoveAbsence={() => {}}
    />,
  );
  const grid = container.querySelector('[role="grid"]') as HTMLElement;
  const cell = container.querySelector("[data-cell]") as HTMLElement;
  cell.focus();
  // Enter resize mode, then abandon it.
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true, shiftKey: true });
  fireEvent.keyDown(grid, { key: "Escape" });
  const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
  expect(live.textContent).toBe("Resize cancelled");
});

it("Escape from a keyboard MOVE still announces the move cancellation", () => {
  const { container } = render(
    <ResourceCalendar
      {...baseProps}
      rows={[{ key: "anna", display: "Anna", email: "" }]}
      absences={[{ id: 1, assignee: "Anna", startDate: "2026-06-10", endDate: "2026-06-11", type: "vacation" }]}
      resources={[]}
      startDate="2026-06-10"
      endDate="2026-06-12"
      onMoveAbsence={() => {}}
    />,
  );
  const grid = container.querySelector('[role="grid"]') as HTMLElement;
  const cell = container.querySelector("[data-cell]") as HTMLElement;
  cell.focus();
  fireEvent.keyDown(grid, { key: "ArrowRight", altKey: true });
  fireEvent.keyDown(grid, { key: "Escape" });
  const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
  expect(live.textContent).toBe("Move cancelled");
});
```

★ The exact modifier combination that starts each mode must match the component — read `resource-calendar.tsx` around `:250-310` and use what it actually listens for. If a plain `Alt+Arrow` starts a *move* and `Alt+Shift+Arrow` starts a *resize* (as `calendarResizeModeOn`'s own text says), the above is right; verify rather than assume.

- [ ] **Step 11: Run to verify the resize test fails**

Run: `npx vitest run src/app/resource-calendar.test.tsx -t "cancellation"`
Expected: the RESIZE test FAILS (`expected 'Move cancelled' to be 'Resize cancelled'`); the MOVE test PASSES.

- [ ] **Step 12: Make `justCancelled` carry the mode**

In `src/app/resource-calendar.tsx`, replace the state declaration and its comment:

```tsx
  // Drives the aria-live announcement's cancellation flash after Escape;
  // cleared as soon as a fresh move starts so a stale cancellation can't
  // linger into the next one. Carries WHICH mode was abandoned so the
  // announcement can't tell a resizing user their move was cancelled.
  const [justCancelled, setJustCancelled] = useState<null | "move" | "resize">(null);
```

- [ ] **Step 13: Update the three setter sites**

At `:206` (the Escape branch inside `if (pendingMove)`), replace `setJustCancelled(true);` with:

```tsx
        setJustCancelled(pendingMove.kind === "resize" ? "resize" : "move");
```

At the two reset sites (`:285` and `:301`), replace `setJustCancelled(false);` with:

```tsx
        setJustCancelled(null);
```

★ `grep -n 'setJustCancelled' src/app/resource-calendar.tsx` should now show exactly four lines: the declaration plus three calls, none of them passing a boolean.

- [ ] **Step 14: Update the announcement**

Replace:

```tsx
          : justCancelled
            ? t(lang, "calendarMoveModeCancelled")
            : ""}
```

with:

```tsx
          : justCancelled
            ? t(lang, justCancelled === "resize" ? "calendarResizeModeCancelled" : "calendarMoveModeCancelled")
            : ""}
```

`null` is the empty state, so the surrounding truthiness check is unchanged.

- [ ] **Step 15: Run both announcement tests**

Run: `npx vitest run src/app/resource-calendar.test.tsx`
Expected: whole file passes.

- [ ] **Step 16: Typecheck (i18n key parity + the test edits)**

Run: `npx tsc --noEmit`
Expected: exit 0. This is what enforces EN/DE key parity — a missing DE key fails here.

- [ ] **Step 17: Check the i18n encoding guard and for NUL bytes**

```bash
npx vitest run src/app/i18n-encoding.test.ts
node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);if(b.includes(0))throw new Error('NUL byte in '+f);}console.log('no NUL bytes')" src/app/i18n.ts src/app/i18n.de.ts src/app/resource-calendar.tsx src/app/resource-calendar-band.tsx
```

Expected: PASS, then `no NUL bytes`.

- [ ] **Step 18: axe on a FRESH isolated server (the role change)**

```bash
PORT=3100 npm run dev
```
then in another shell:
```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"
PORT=3100 npm run stop
```

Expected: PASS. Note this proves no regression rather than proving the band correct — Resources is scanned but defaults to the **directory** sub-tab, so the Calendar surface (and this banner) is not in the scan. The banner change is eye-verified.

- [ ] **Step 19: Commit**

```bash
git add src/app/resource-calendar.tsx src/app/resource-calendar-band.tsx src/app/resource-calendar.test.tsx src/app/resource-calendar-band.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
fix(calendar): honest cancel announcement, accurate banner role, monthLabel test

Three small fixes on the calendar surface:

- Escape during a keyboard RESIZE announced "Move cancelled". justCancelled
  was a bare boolean, so the live region could only emit the move string even
  though the mode-on announcement already distinguished the two. It now
  carries which mode was abandoned; new calendarResizeModeCancelled string.
- The meetings-band truncation banner used role="rowheader", which asserts
  "this cell labels its row" — it labels nothing. gridcell is accurate. The
  per-lane sticky first cell keeps rowheader; that one does label its lane.
- monthLabel had the same timeZone:"UTC" fix as weekdayLabel but no test.
  Covered now, in the existing America/New_York block.

The Calendar sub-tab is not in A11Y_VIEWS (Resources defaults to the
directory), so the banner role is eye-verified; the axe run confirms no
regression elsewhere.
EOF
```

---

## Task 5: Calendar-event activity log + undo (follow-up item 1)

**Files:**
- Modify: `src/app/activity-log.ts` (union `:12-59`, map `:161-209`)
- Modify: `src/app/undo/field-groups.ts` (append)
- Modify: `src/app/use-calendar-events.ts` (args + both handlers + header comment)
- Modify: `src/app/use-resource-planner.ts:392` — **one line replaced by one line**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (three new keys)
- Test: `src/app/undo/field-groups.test.ts`, `src/app/use-calendar-events.test.tsx`

This is the batch's substance. `use-calendar-events.ts` is the only per-entity CRUD hook that neither logs nor captures undo, and its own header comment (`:15-18`) says so.

- [ ] **Step 1: Add the three `ActivityKind` members**

In `src/app/activity-log.ts`, in the union, after `"shift.deleted"`:

```ts
  | "calendarEvent.created"
  | "calendarEvent.updated"
  | "calendarEvent.deleted"
```

- [ ] **Step 2: Map them (tsc enforces this — it is an exhaustive Record)**

In `ACTIVITY_KIND_TO_KEY`, after the `"shift.deleted"` entry:

```ts
  "calendarEvent.created": "activityCalendarEventCreated",
  "calendarEvent.updated": "activityCalendarEventUpdated",
  "calendarEvent.deleted": "activityCalendarEventDeleted",
```

No `activityGroupOf` change: there is no `calendarEvent.` branch, so it falls through to `"general"` — the same bucket absence, shift, milestone and change already use. `ACTIVITY_KINDS` derives from this Record's keys, so the persisted-entry validator needs no edit.

- [ ] **Step 3: Add the EN strings**

Edit `src/app/i18n.ts`, after the `activityShiftDeleted` line (find it: `grep -n 'activityShiftDeleted' src/app/i18n.ts`):

```ts
  activityCalendarEventCreated: "Meeting #{0} created: {1}",
  activityCalendarEventUpdated: "Meeting #{0} updated: {1}",
  activityCalendarEventDeleted: "Meeting #{0} deleted: {1}",
```

- [ ] **Step 4: Add the DE strings via a node script**

DE noun is **Termin**, matching the shipped `calendarMeetings: "Termine"`. Run with the Bash tool from the repo root:

```bash
node <<'EOF'
const { readFileSync, writeFileSync } = require("node:fs");
const p = "src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
if (s.includes("activityCalendarEventCreated")) { console.log("already present"); process.exit(0); }

const anchor = "  activityShiftDeleted:";
const i = s.indexOf(anchor);
if (i === -1) throw new Error("anchor not found");
const eol = s.indexOf("\r\n", i);
if (eol === -1) throw new Error("no CRLF after anchor — check line endings before patching");

// ö in "gelöscht" is escaped for transit safety; the file gets real UTF-8.
const lines = [
  '  activityCalendarEventCreated: "Termin #{0} erstellt: {1}",',
  '  activityCalendarEventUpdated: "Termin #{0} aktualisiert: {1}",',
  '  activityCalendarEventDeleted: "Termin #{0} gelöscht: {1}",',
];
writeFileSync(p, s.slice(0, eol) + "\r\n" + lines.join("\r\n") + s.slice(eol), "utf8");
console.log("inserted 3");
EOF
```

Expected: `inserted 3`

- [ ] **Step 5: Verify the DE bytes**

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');for(const m of s.match(/.*activityCalendarEvent.*/g))console.log(JSON.stringify(m));if(!s.includes('gelöscht'))throw new Error('umlaut corrupted');console.log('ok')"
```
Expected: three lines printed with `gelöscht` intact, then `ok`.

- [ ] **Step 6: Write the failing undo-group test**

Append to `src/app/undo/field-groups.test.ts`:

```ts
describe("CALENDAR_EVENT_UNDO_GROUPS", () => {
  const base: CalendarEvent = {
    id: 1, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "daily", interval: 1 },
    exceptions: [{ date: "2026-06-03", kind: "skip" }],
  };

  it("emits ONE entry when de-recurring drops both recurrence and exceptions", () => {
    // sanitizeCalendarEvent clears exceptions whenever recurrence is gone, so
    // split entries would let undo restore the rule with its skips/moves lost.
    const next: CalendarEvent = { ...base, recurrence: undefined, exceptions: undefined };
    const out = changedFieldGroups(base, next, CALENDAR_EVENT_UNDO_GROUPS);
    expect(out).toHaveLength(1);
    expect(out[0].before).toEqual({
      startDate: "2026-06-01",
      recurrence: { freq: "daily", interval: 1 },
      exceptions: [{ date: "2026-06-03", kind: "skip" }],
    });
    expect(out[0].after).toEqual({
      startDate: "2026-06-01", recurrence: undefined, exceptions: undefined,
    });
  });

  it("emits ONE entry carrying all three keys when only startDate moved", () => {
    // sanitizeRecurrence cross-validates until >= startDate, so startDate has
    // to revert together with the rule or an undo lands on a row the next load
    // re-strips. The two unchanged values are written back identical.
    const out = changedFieldGroups(base, { ...base, startDate: "2026-07-01" }, CALENDAR_EVENT_UNDO_GROUPS);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0].before).sort()).toEqual(["exceptions", "recurrence", "startDate"]);
  });

  it("emits a separate single-key entry for an ungrouped field", () => {
    const out = changedFieldGroups(base, { ...base, title: "Renamed" }, CALENDAR_EVENT_UNDO_GROUPS);
    expect(out).toHaveLength(1);
    expect(out[0].before).toEqual({ title: "Standup" });
  });
});
```

Add to that file's imports: `CALENDAR_EVENT_UNDO_GROUPS` from `./field-groups` and `type CalendarEvent` from `../calendar-event`.

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run src/app/undo/field-groups.test.ts -t "CALENDAR_EVENT_UNDO_GROUPS"`
Expected: FAIL — `CALENDAR_EVENT_UNDO_GROUPS` is not exported.

- [ ] **Step 8: Add the group**

In `src/app/undo/field-groups.ts`, add the type import (separate line — `CalendarEvent` lives in `calendar-event.ts`, not `../types`):

```ts
import type { CalendarEvent } from "../calendar-event";
```

and append after `RESOURCE_UNDO_GROUPS`:

```ts
/** Two couplings, one group. sanitizeCalendarEvent clears `exceptions` whenever
 *  `recurrence` is absent, so reverting the rule must restore the skips/moves in
 *  the same step. And sanitizeRecurrence cross-validates `until >= startDate`, so
 *  a split entry could restore an `until` the next load strips again — the undo
 *  would appear to work and then not stick. Reverting a pure startDate move also
 *  rewrites two identical values; harmless. */
export const CALENDAR_EVENT_UNDO_GROUPS: readonly FieldGroup<CalendarEvent>[] = [
  ["startDate", "recurrence", "exceptions"],
];
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/app/undo/field-groups.test.ts`
Expected: whole file passes.

- [ ] **Step 10: Commit the foundation**

```bash
git add src/app/activity-log.ts src/app/undo/field-groups.ts src/app/undo/field-groups.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(activity): add calendarEvent activity kinds and undo field group

Groundwork for wiring the meeting-series hook into the activity log and undo
stack. Three new ActivityKind members with EN/DE strings (DE noun "Termin",
matching the shipped calendarMeetings), and CALENDAR_EVENT_UNDO_GROUPS
grouping startDate + recurrence + exceptions.

That grouping is load-bearing twice over: sanitizeCalendarEvent clears
exceptions when recurrence goes away, and sanitizeRecurrence cross-validates
until >= startDate — split entries would let an undo restore a row the next
load silently re-strips.
EOF
```

- [ ] **Step 11: Write the failing hook tests**

Append to `src/app/use-calendar-events.test.tsx`. The spy-based shape matches `use-resource-planner.undo.test.tsx`, which is this repo's convention for undo capture (the restore itself is covered generically by `undo/undo-stack.test.ts`):

```tsx
describe("useCalendarEvents — activity log + undo", () => {
  function renderWithSpies() {
    const logActivity = vi.fn();
    const logActivityChanges = vi.fn();
    const capture = vi.fn();
    const captureFieldEdit = vi.fn();
    const { result } = renderHook(
      () => useCalendarEvents({ today: "2026-06-20", logActivity, logActivityChanges, capture, captureFieldEdit }),
      { wrapper: Wrapper },
    );
    return { result, logActivity, logActivityChanges, capture, captureFieldEdit };
  }

  it("logs calendarEvent.created on a create", () => {
    const { result, logActivity } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent({ ...base, id: 5, title: "Kickoff" }, true); });
    expect(logActivity).toHaveBeenCalledWith("calendarEvent.created", 5, "Kickoff");
  });

  it("logs calendarEvent.updated with a field diff on an update", () => {
    const { result, logActivityChanges } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(logActivityChanges).toHaveBeenCalledWith(
      "calendarEvent.updated",
      expect.arrayContaining([{ field: "title", from: "Standup", to: "Renamed" }]),
      base.id,
      "Renamed",
    );
  });

  it("falls back to logActivity for an update when only logActivity is wired", () => {
    const logActivity = vi.fn();
    const { result } = renderHook(
      () => useCalendarEvents({ today: "2026-06-20", logActivity }),
      { wrapper: Wrapper },
    );
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(logActivity).toHaveBeenCalledWith("calendarEvent.updated", base.id, "Renamed");
  });

  it("captures a per-field undo entry on an update", () => {
    const { result, captureFieldEdit } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    captureFieldEdit.mockClear();
    act(() => { result.current.handleSaveCalendarEvent({ ...base, title: "Renamed" }, false); });
    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calendarEvent.updated",
        id: base.id,
        before: { title: "Standup" },
        after: { title: "Renamed" },
      }),
    );
  });

  // ★ The item's actual point: de-recurring silently discards every skip and
  // move. The capture must carry them so undo can put them back in ONE step.
  it("captures recurrence AND exceptions together when a series is de-recurred", () => {
    const { result, captureFieldEdit } = renderWithSpies();
    const series: CalendarEvent = {
      ...base,
      recurrence: { freq: "daily", interval: 1 },
      exceptions: [{ date: "2026-06-03", kind: "skip" }, { date: "2026-06-05", kind: "move", toDate: "2026-06-06" }],
    };
    act(() => { result.current.handleSaveCalendarEvent(series, true); });
    captureFieldEdit.mockClear();
    act(() => {
      result.current.handleSaveCalendarEvent({ ...series, recurrence: undefined, exceptions: undefined }, false);
    });
    expect(captureFieldEdit).toHaveBeenCalledTimes(1);
    const arg = captureFieldEdit.mock.calls[0][0];
    expect(arg.before.exceptions).toHaveLength(2);
    expect(arg.before.recurrence).toEqual({ freq: "daily", interval: 1 });
    expect(arg.after.recurrence).toBeUndefined();
    expect(arg.after.exceptions).toBeUndefined();
  });

  it("captures the doomed row and logs on a delete", () => {
    const { result, capture, logActivity } = renderWithSpies();
    act(() => { result.current.handleSaveCalendarEvent(base, true); });
    act(() => { result.current.handleDeleteCalendarEvent(base.id); });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "calendarEvent.deleted",
        removed: [expect.objectContaining({ id: base.id, title: "Standup" })],
        name: "Standup",
      }),
    );
    expect(logActivity).toHaveBeenCalledWith("calendarEvent.deleted", base.id, "Standup");
  });

  it("does not log or capture a delete for an id that isn't there", () => {
    const { result, capture, logActivity } = renderWithSpies();
    act(() => { result.current.handleDeleteCalendarEvent(999); });
    expect(capture).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
```

Add `vi` to the file's vitest import: `import { describe, expect, it, vi } from "vitest";`

- [ ] **Step 12: Run to verify they fail**

Run: `npx vitest run src/app/use-calendar-events.test.tsx -t "activity log"`
Expected: FAIL — the spies are never called (and tsc would reject the unknown args, which is why Step 13 comes next).

- [ ] **Step 13: Extend the hook's args**

In `src/app/use-calendar-events.ts`, add imports:

```ts
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { CALENDAR_EVENT_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";
```

and extend the args interface (all optional, so the existing test render sites keep working):

```ts
export interface UseCalendarEventsArgs {
  today: string;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  /** Capture a pre-op snapshot for undo (delete removes the row). */
  capture?: UndoStackApi["capture"];
  /** Capture per-field edits for undo (modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}
```

- [ ] **Step 14: Wire the save handler**

Replace the body of `handleSaveCalendarEvent` with:

```ts
  const handleSaveCalendarEvent = useCallback(
    (next: CalendarEvent, isNew?: boolean) => {
      const events = calendarEvents ?? [];
      const { create, id } = resolveEntitySave(events, next.id, isNew, () => mintId("calendarEvent", events));
      const sanitized = sanitizeCalendarEvent({ ...next, id });
      if (!sanitized) return;
      // Read the before-image as a VALUE from the pre-update array, never from
      // inside the updater below — capture and the activity diff both need it,
      // and reading it in there would make them a side effect of a React state
      // computation.
      const previous = create ? undefined : events.find((e) => e.id === id);
      // Functional updater so N saves in one tick (e.g. a drag-reschedule
      // landing in the same tick as a modal save) compose instead of the
      // second clobbering the first — the same landmine that already bit
      // RAID/Changes/Stakeholders.
      setCalendarEvents((prev) => {
        const list = prev ?? [];
        return create ? [...list, sanitized] : list.map((e) => (e.id === id ? sanitized : e));
      });
      if (create) {
        args.logActivity?.("calendarEvent.created", id, sanitized.title);
      } else if (previous) {
        captureFieldChanges(args.captureFieldEdit, {
          setter: setCalendarEvents, kind: "calendarEvent.updated", id,
          prev: previous, next: sanitized, groups: CALENDAR_EVENT_UNDO_GROUPS,
          stampField: "localModifiedAt", name: sanitized.title,
        });
        if (args.logActivityChanges) {
          args.logActivityChanges("calendarEvent.updated", diffFields(previous, sanitized), id, sanitized.title);
        } else {
          // Back-compat: a caller wiring only logActivity still records it.
          args.logActivity?.("calendarEvent.updated", id, sanitized.title);
        }
      }
      setEditingCalendarEvent(null);
    },
    [calendarEvents, setCalendarEvents, args],
  );
```

★ `args` joins the dep array (exhaustive-deps requires it), exactly as `useChangeLog` does. That makes the handler identity unstable per render, which is the documented convention for these hooks — see the note at the end of this task for why it costs nothing here.

★ `setCalendarEvents` is `Dispatch<SetStateAction<readonly CalendarEvent[] | undefined>>` if the workspace slice is optional. `captureFieldChanges` expects `Dispatch<SetStateAction<readonly T[]>>`. If tsc rejects the `setter` on that ground, do **not** cast it away — check how the workspace types the setter (`grep -n 'setCalendarEvents' src/app/workspace-context.tsx`) and report back before proceeding; silently casting would hand the undo stack a setter that can write `undefined`.

- [ ] **Step 15: Wire the delete handler**

Replace `handleDeleteCalendarEvent` (dropping its stale "no captureRef undo here" comment):

```ts
  const handleDeleteCalendarEvent = useCallback(
    (id: number) => {
      const events = calendarEvents ?? [];
      const doomed = events.find((e) => e.id === id);
      if (doomed) {
        args.capture?.({ setter: setCalendarEvents, kind: "calendarEvent.deleted", removed: [doomed], fromArray: events, name: doomed.title });
      }
      setCalendarEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
      if (doomed) args.logActivity?.("calendarEvent.deleted", id, doomed.title);
      setEditingCalendarEvent(null);
    },
    [calendarEvents, setCalendarEvents, args],
  );
```

- [ ] **Step 16: Replace the stale header comment**

The block at the top of the file (the paragraph beginning "No undo-capture/activity-log wiring yet") now asserts the opposite of the truth. Replace those final sentences with:

```ts
// Activity logging + undo capture are wired the same way useChangeLog does it:
// four OPTIONAL callback args in, captureFieldChanges + logActivityChanges out.
// The undo group (CALENDAR_EVENT_UNDO_GROUPS) deliberately binds startDate,
// recurrence and exceptions together — see its doc comment for the two
// sanitizer invariants that makes non-negotiable.
//
// The vanished-row guard useChangeLog carries (a toast when a concurrent
// writer deleted the row mid-edit) is deliberately NOT mirrored: it needs
// showToast + lang, which this hook does not take, and the silent map-replace
// no-op it guards is pre-existing behaviour, not something this wiring added.
```

- [ ] **Step 17: Run the hook tests**

Run: `npx vitest run src/app/use-calendar-events.test.tsx`
Expected: whole file passes, old tests included.

- [ ] **Step 18: Thread the callbacks — ONE line for ONE line**

In `src/app/use-resource-planner.ts`, replace line 392 exactly:

```ts
  const calendarEventsApi = useCalendarEvents({ today, logActivity: args.logActivity, logActivityChanges: args.logActivityChanges, capture: args.capture, captureFieldEdit: args.captureFieldEdit });
```

All four already exist on `UseResourcePlannerArgs` (`:67`, `:68`, `:77`, `:82`), so nothing new threads from `task-manager.tsx`.

★ Pass `args.*` directly — do NOT route through the `logActivityRef`/`captureRef` indirection at `:132-143`. Those exist so the planner's own `useCallback`s can omit callbacks from their deps; this hook already depends on the whole `args` object, so the refs would add nothing.

- [ ] **Step 19: Verify the line count did not move**

Run: `wc -l src/app/use-resource-planner.ts && npm run size:check`

Expected: **1037** lines and `size:check` passing. If the count went up, the edit added a line — collapse it back onto one. Do not re-baseline.

- [ ] **Step 20: Typecheck and run the broader suites**

```bash
npx tsc --noEmit
npx vitest run src/app/use-calendar-events.test.tsx src/app/use-resource-planner.test.tsx src/app/use-resource-planner.undo.test.tsx src/app/activity-log.test.ts src/app/undo/field-groups.test.ts
```
Expected: exit 0, all pass.

- [ ] **Step 21: Full suite + lint**

```bash
npm run test:run
npm run lint
```
Expected: both pass. `--max-warnings=0` makes an unused import fatal, so if any of Step 13's imports went unused, remove it.

- [ ] **Step 22: Commit**

```bash
git add src/app/use-calendar-events.ts src/app/use-calendar-events.test.tsx src/app/use-resource-planner.ts
git commit -F - <<'EOF'
feat(calendar): meetings now appear in the activity log and support undo

use-calendar-events.ts was the only per-entity CRUD hook that neither logged
its edits nor captured undo — its own header comment flagged it as a
deliberate follow-up. Wired the useChangeLog way: four optional callback args
in, captureFieldChanges + logActivityChanges out, before-image read as a value
from the pre-update array rather than from inside the state updater.

Notably this makes de-recurring a series reversible. sanitizeCalendarEvent
clears exceptions when the rule goes away, so converting a heavily-exception'd
series to non-recurring used to discard every skip and move irreversibly;
CALENDAR_EVENT_UNDO_GROUPS now brings all of it back in one undo.

use-resource-planner.ts:392 is replaced one line for one line — that file sits
at 1037 against a 1038 baseline and re-baselining it again is exactly what
follow-up item 4 objects to. All four callbacks already existed on its args,
so nothing new threads down from task-manager.
EOF
```

**Note for the reviewer, not a step:** these handlers reach the `memo()`'d `ResourcesPanel` as `onAddCalendarEvent`/`onEditCalendarEvent`/`onSaveCalendarEvent`, and adding `args` to the dep arrays makes their identity unstable per render. That costs nothing new: `task-manager.tsx:2047` computes `guardEdit` during render without memoization, so `guardEdit(handleOpenAddCalendarEvent)` at `:2194-2196` already minted fresh functions every render before this change. The memo was already bailing for these props. Task 6 records that as a new follow-up rather than fixing it here.

---

## Task 6: De-recurring hint, release chores, doc corrections

**Files:**
- Modify: `src/app/calendar-event-modal.tsx` (hint after `:262`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one new key)
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `AGENTS.md`, `docs/superpowers/r5-calendar-followups.md`
- Test: `src/app/calendar-event-modal.test.tsx`

### 6a — the hint

- [ ] **Step 1: Add the EN string**

Edit `src/app/i18n.ts`, near the other `calendarEvent*` keys:

```ts
  calendarEventExceptionsDiscarded: "Turning repeat off discards {0} adjusted occurrence(s); undo restores them.",
```

- [ ] **Step 2: Add the DE string via a node script**

Run with the Bash tool from the repo root:

```bash
node <<'EOF'
const { readFileSync, writeFileSync } = require("node:fs");
const p = "src/app/i18n.de.ts";
let s = readFileSync(p, "utf8");
if (s.includes("calendarEventExceptionsDiscarded")) { console.log("already present"); process.exit(0); }

const anchor = "  calendarEventRepeatNever:";
const i = s.indexOf(anchor);
if (i === -1) throw new Error("anchor not found — run: grep -n 'calendarEventRepeat' src/app/i18n.de.ts");
const eol = s.indexOf("\r\n", i);
if (eol === -1) throw new Error("no CRLF after anchor — check line endings before patching");

// ä in "angepasste", ü in "Rückgängig" — escaped for transit safety.
const line = '\r\n  calendarEventExceptionsDiscarded: "Das Ausschalten der Wiederholung verwirft {0} angepasste Termine; Rückgängig stellt sie wieder her.",';
writeFileSync(p, s.slice(0, eol) + line + s.slice(eol), "utf8");
console.log("inserted");
EOF
```

Expected: `inserted`. If it throws on the anchor, run the grep it names and re-run with a key that exists.

- [ ] **Step 3: Verify the DE bytes**

```bash
node -e "const l=require('fs').readFileSync('src/app/i18n.de.ts','utf8').match(/.*calendarEventExceptionsDiscarded.*/)[0];console.log(JSON.stringify(l));if(!l.includes('Rückgängig'))throw new Error('umlauts corrupted');console.log('ok')"
```
Expected: the line printed with `Rückgängig` intact, then `ok`.

- [ ] **Step 4: Write the failing tests**

Append to `src/app/calendar-event-modal.test.tsx`, reusing the file's existing render helper (check it: `grep -n 'function render\|render(' src/app/calendar-event-modal.test.tsx | head -5`):

```tsx
it("warns that turning repeat off will discard the series' exceptions", async () => {
  const series: CalendarEvent = {
    id: 1, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "daily", interval: 1 },
    exceptions: [{ date: "2026-06-03", kind: "skip" }, { date: "2026-06-05", kind: "move", toDate: "2026-06-06" }],
  };
  render(<CalendarEventModal lang="en-US" event={series} isNew={false} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />);
  // Nothing to warn about while the series is still recurring.
  expect(screen.queryByText(/discards/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Never" }));
  expect(screen.getByText(/discards 2 adjusted occurrence/i)).toBeInTheDocument();
});

it("does not warn when a de-recurred series has no exceptions", () => {
  const series: CalendarEvent = {
    id: 1, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15,
    recurrence: { freq: "daily", interval: 1 },
  };
  render(<CalendarEventModal lang="en-US" event={series} isNew={false} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Never" }));
  expect(screen.queryByText(/discards/i)).not.toBeInTheDocument();
});
```

★ Match the real prop names and the real component name from the modal's own signature and the file's existing tests — do not trust the shape above if it disagrees. Likewise, the repeat control is a `SegmentedControl`; if its "Never" option does not resolve as `getByRole("button", {name: "Never"})`, copy the interaction from whichever existing test in this file already switches repeat frequency.

- [ ] **Step 5: Run to verify the first test fails**

Run: `npx vitest run src/app/calendar-event-modal.test.tsx -t "discard"`
Expected: the first test FAILS at the `getByText(/discards 2/)` assertion; the second PASSES (nothing renders either way yet).

- [ ] **Step 6: Add the hint**

Import the primitive in `src/app/calendar-event-modal.tsx`:

```ts
import { FieldHint } from "./field-hint";
```

and inside the `isVisible("repeat")` block, between the closing `</div>` of the `SegmentedControl` wrapper and the `{repeating && (` branch:

```tsx
          {/* sanitizeCalendarEvent drops exceptions along with the rule, so
              this save really does discard them. Undo restores it in one step
              (CALENDAR_EVENT_UNDO_GROUPS), but silence is still wrong. A hint,
              not ModalFieldError — the save is legal, merely lossy. Reads the
              DRAFT because the repeat controls live in a separate recurrence
              state, so draft.exceptions survives until submit. */}
          {!repeating && (draft.exceptions?.length ?? 0) > 0 && (
            <FieldHint>
              {t(lang, "calendarEventExceptionsDiscarded", draft.exceptions?.length ?? 0)}
            </FieldHint>
          )}
```

- [ ] **Step 7: Run to verify both pass**

Run: `npx vitest run src/app/calendar-event-modal.test.tsx`
Expected: whole file passes.

### 6b — release chores

- [ ] **Step 8: Bump the version**

In `src/app/version.ts`:

```ts
export const APP_VERSION = "0.202.1";
export const APP_BUILD_DATE = "2026-07-26"; // 0.202.1: meetings in the activity log + undo, plus calendar and sanitizer fixes (Beukes)
```

`APP_MILESTONE` stays `"Beukes"` — a patch gets no new codename, so there is no `versionHighlight*` key and no `APP_HIGHLIGHT_KEYS` edit.

- [ ] **Step 9: Add the CHANGELOG entry**

At the top of the entries in `CHANGELOG.md`, matching the file's existing heading style:

```markdown
## 0.202.1 — 2026-07-26

Follow-ups from the 0.202.0 calendar overhaul.

- **Meetings now appear in the activity log and support undo/redo.** Creating,
  editing and deleting a meeting series records an activity entry, and edits are
  undoable like every other register. Notably this makes de-recurring a series
  reversible: turning repeat off discards the series' skipped and moved
  occurrences, which previously could not be recovered.
- The meeting editor now says so up front, showing how many adjusted occurrences
  turning repeat off will discard.
- Escape during a keyboard absence *resize* announced "Move cancelled"; it now
  announces the resize.
- The meetings band's "truncated" banner no longer appears when the visible
  window was in fact complete, and its cell no longer claims to label its row.
- Internal: an empty timestamp cell no longer decodes to an empty string for
  absences and shifts, and Gantt stopped carrying its own copy of `addDays`.
```

- [ ] **Step 10: Correct AGENTS.md's `A11Y_VIEWS` claim**

Find it: `grep -n 'A11Y_VIEWS. list' AGENTS.md`. Replace the sentence that says the list is 13 named views excluding chat/AI-Assistant with:

```
  `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is **16** named views — Dashboard · Open Points · Gantt ·
  Resources · Budget · RAID · Settings · Stakeholders · Changes · Milestones · Reports · Activity ·
  Time bookings · AI Assistant · Next actions · Insights — so a passing run reports 5 schemes × 16
  + 5 Kanban-board variants = **85** checks. It does NOT include Projects, Knowledge, or the
  Resources → **Calendar** sub-tab (Resources defaults to the directory), so controls only on those
  surfaces aren't scanned; anything in the always-present top bar IS (scanned via every view).
  ★★ Calendar being unscanned has already cost real bugs: 0.202.0 shipped an AA contrast failure
  there (`text-ui-pink` on `bg-surface-muted`, 4.05:1) that a full 85/85 axe pass said nothing
  about. Check contrast BY HAND for anything styled on that surface.
```

★ Keep the surrounding bullet's other sentences intact — only that claim is wrong.

- [ ] **Step 11: Note in AGENTS.md that the hook is now wired**

Run: `grep -n 'use-calendar-events\|calendarEvents' AGENTS.md`

Then add this bullet to the **"Resource calendar meetings"** section (replacing any sentence there that
says the hook carries no activity/undo wiring):

```
- **Meeting CRUD logs + undoes like every other entity.** `use-calendar-events.ts` takes the same four
  OPTIONAL callbacks `useChangeLog` does (`logActivity`/`logActivityChanges`/`capture`/`captureFieldEdit`),
  threaded from `use-resource-planner.ts` in ONE line — that file sits at its size-ratchet baseline, so
  keep it one line. Kinds: `calendarEvent.created`/`.updated`/`.deleted`.
  ★★ `CALENDAR_EVENT_UNDO_GROUPS` binds **startDate + recurrence + exceptions as ONE unit** and must stay
  that way: `sanitizeCalendarEvent` clears `exceptions` whenever `recurrence` is absent, and
  `sanitizeRecurrence` cross-validates `until >= startDate`. Split into separate entries, an undo can
  restore a rule whose exceptions are gone, or an `until` the very next load strips again — the undo looks
  like it worked and then doesn't. The editor also warns (`calendarEventExceptionsDiscarded`, a `FieldHint`)
  before a de-recurring save discards them.
```

- [ ] **Step 12: Update the follow-ups doc**

In `docs/superpowers/r5-calendar-followups.md`: remove items 1, 3, 7, 9 and 10, renumber what remains (the old 2, 4, 5, 6, 8), and update the header snapshot note to say which items shipped in 0.202.1. Then append a new entry for what this batch turned up:

```markdown
## N. `guardEdit` is recomputed every render, so `ResourcesPanel`'s memo never bails

**Where:** `task-manager.tsx:2047` (`makeEditGuard` called during render, unmemoized), consumed at
`:2128`, `:2135-2136`, `:2185-2196` and elsewhere.

`ResourcesPanel` is the app's only `memo()`'d panel, and AGENTS.md explains at length why keeping its
props reference-identical matters. But every `guardEdit(handler)` prop it receives — including
`onAddCalendarEvent`/`onEditCalendarEvent`/`onSaveCalendarEvent` — is a **fresh function on every
render**, so the memo already bails unconditionally. The optimization AGENTS.md describes is not
currently in effect.

Found while checking whether wiring undo into `use-calendar-events` would defeat that memo. It
cannot: it was already defeated. Left alone because the fix (memoizing `guardEdit`, or hoisting the
guard into the handlers) touches dozens of props across the whole orchestrator and wants measuring
first — but AGENTS.md's claim should not be trusted until it is either fixed or the claim is
softened.
```

- [ ] **Step 13: Full gate run**

```bash
npx tsc --noEmit
npm run test:run
npm run lint
npm run size:check
npm run dup:check
```
Expected: all pass. `size:check` must still report `use-resource-planner.ts` at 1037 against its 1038 baseline.

- [ ] **Step 14: NUL-byte check across everything touched**

```bash
node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);if(b.includes(0))throw new Error('NUL byte in '+f);}console.log('no NUL bytes')" src/app/i18n.ts src/app/i18n.de.ts src/app/calendar-event-modal.tsx src/app/use-calendar-events.ts src/app/activity-log.ts src/app/resource-calendar.tsx src/app/resource-calendar-band.tsx src/app/recurrence.ts src/app/sanitize-entities.ts src/app/gantt-engine.ts
```
Expected: `no NUL bytes`.

- [ ] **Step 15: Build + e2e**

```bash
npm run build
npm run e2e
```
Expected: both pass, axe reporting 85/85.

- [ ] **Step 16: Eye-verify the two visual changes**

```bash
PORT=3100 npm run dev
```
Check on Resources → Calendar: (a) open a recurring meeting with a skip or move, switch Repeat to Never, confirm the hint appears with the right count and reads correctly in DE; (b) the truncation banner still renders as one full-width banner. Then `PORT=3100 npm run stop`.

- [ ] **Step 17: Commit**

```bash
git add src/app/calendar-event-modal.tsx src/app/calendar-event-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/version.ts CHANGELOG.md AGENTS.md
git commit -F - <<'EOF'
release: 0.202.1 — de-recurring hint, plus docs and version chores

The meeting editor now warns how many adjusted occurrences turning repeat off
will discard, using the shared FieldHint (the save is legal, merely lossy, so
not ModalFieldError). It reads draft.exceptions, which survives until submit
because the repeat controls live in a separate recurrence draft.

Also corrects AGENTS.md's A11Y_VIEWS claim, which was wrong twice: the list is
16 views, not 13, and AI Assistant IS scanned. The corrected text keeps the
Calendar sub-tab's absence from the gate prominent — that gap already cost an
AA contrast failure shipped in 0.202.0.
EOF
```

★ `docs/superpowers/` is gitignored in this repo, so the follow-ups doc edit from Step 12 is intentionally **not** in that `git add`. It stays local, like the rest of the planning docs.

---

## Definition of done

- [ ] Creating, editing and deleting a meeting each produce an Activity entry, in EN and DE.
- [ ] De-recurring an exception-carrying series is undoable in ONE undo, and the editor warns first.
- [ ] `sanitizeAbsence`/`sanitizeShift` no longer keep an empty `localModifiedAt` as a value; golden fixtures unchanged.
- [ ] One `addDays` in the codebase (plus the unrelated test-local helper in `raid-report.test.ts`).
- [ ] The truncation banner appears only when something is genuinely hidden.
- [ ] Escape from a resize announces the resize; the banner cell is a `gridcell`; `monthLabel` has a test that fails without its fix.
- [ ] AGENTS.md says 16 views / 85 checks and keeps the Calendar-unscanned warning prominent.
- [ ] `wc -l src/app/use-resource-planner.ts` is **1037** and the baseline was not touched.
- [ ] `tsc --noEmit`, `test:run`, `lint`, `size:check`, `dup:check`, `build`, `e2e` all green.
- [ ] Version 0.202.1, CHANGELOG entry present, `APP_MILESTONE` still "Beukes".
