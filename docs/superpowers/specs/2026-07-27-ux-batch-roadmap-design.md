# UX batch + owed calendar sync — 8-slice roadmap

_Opened 2026-07-27, against 0.203.0 "Czerneda". Decomposition of an 18-item UX request plus the two
Outlook-sync slices owed from the R5 calendar release._

★ **This file is gitignored** (`.gitignore:76:/docs/superpowers/`). It is local-only by explicit
decision — the risk (the same one that lost `r5-calendar-followups.md`, recoverable today only from
`docs/superpowers/_archive-slice-docs-2026-07-27.zip`) was raised and accepted.

★★ **MANDATORY per-slice step:** at the close of every slice in this roadmap, re-archive this whole
tree to `docs/superpowers/_archive-slice-docs-<YYYY-MM-DD>.zip` (decision 2026-07-27). The archive is
the only thing standing between this roadmap and the failure mode that already consumed its
predecessor. It is part of each slice's release chain, not an optional tidy-up.

★★★ **THE ARCHIVE MUST BE CUMULATIVE — zipping the working tree is NOT enough, and slice C's plan
got this wrong.** The working tree holds **36** files. The 2026-07-27 archive holds **334**: the tree
was pruned at some point, so ~298 historical plans/specs (May–July) exist *only* inside that zip. A
plain walk-the-tree zip therefore produces a NEWER archive that is a strict SUBSET of the older one —
and the moment anyone tidies up the older zip trusting the newer date, those 298 documents are gone.
That is the exact failure this rule exists to prevent, reintroduced by the rule's own implementation.

Merge the previous archive's unique entries into every new one (working tree wins on collision) and
**assert the superset property before trusting the result**:

```python
missing = set(old.namelist()) - set(new.namelist())
assert not missing
```

The 2026-07-28 archive was rebuilt this way: 298 carried forward + 36 from the tree = 334, verified.

---

## Ordering — locked

**C → D → F → A → E → S6 → S7 → B**

Rationale: C/D/F are near-zero-blast-radius fixes that ship fast. S6/S7 sit ahead of B because their
design is already done and verified, whereas B needs fresh design. **B is last regardless** — it is
the only item that changes a *persisted content shape* and opens a new XSS sink.

| Slice | Scope | Release |
|---|---|---|
| **C** | Timelog: ✕ affordance, picker-scope persistence, apply-bar sizing | **0.204.0 "Benford" — shipped** |
| **D** | Field affordances: app-wide ✕ audit *(scope reduced — see below)*, Knowledge linked-tasks sizing, linked-task wildcard | **0.205.0 "Griffith" — shipped, merged as !330** |
| **F** | Gantt: dedup button | **0.206.0 "Shawl" — shipped, merged as !331** |
| **A** | Budget↔task linking: bulk-op, task-modal field, Manual % column | TBD |
| **E** | Shell/settings: project-config → General, theme-gallery file picker, resizable-window height audit | TBD |
| **S6** | Outlook **push** for calendar events (incl. invitations + confirm) | TBD |
| **S7** | Outlook **pull** + exception reconciliation | TBD |
| **B** | Rich text: RAID/milestone description, description audit, task-modal inline note log | TBD |

Each slice gets its own spec → plan → release cycle. Codenames must be unique — grep `CHANGELOG.md`
before picking (~230 already used).

---

## Grounding corrections — verified against 0.203.0

Seven of the eighteen requested items were **not what the request assumed**. Recorded so they are not
re-derived per slice.

| Item | Requested as | Actual |
|---|---|---|
| Bulk-link tasks → budget buckets | a task field | No `Task.budgetBucketId` exists. The link is `BudgetBucket.taskIds` — the **bucket** owns tasks. Both the bulk op and the task-modal field write into `budgets`, not `tasks`. Tasks bulk edit is also a *bespoke* `BulkEditModal` (driven by `useTaskForm` context), **not** the data-driven `BulkEditPanel` the other four panels use |
| Task modal: notes log inline | missing | Modal already has a lean `RichTextEditor` description **and** a "Notes (N)" button. Delta is rendering the log entries inline |
| Timebookings project filter needs ✕ | missing filter | Filter exists **with wildcard** (`customerMatcher`, `*`). Only the ✕ is missing — and see slice C: the field is `type="search"`, so Chrome/Safari draw a native ✕ and Firefox draws none |
| Retain customer+project across F5 | missing persistence | Persistence exists but **only runs inside `handleFetchBookings`**. Selecting without fetching persists nothing |
| Linked tasks filterable + wildcard | not filterable | Already filterable via `useTaskPickerOptions(tasks, selectedIds, query)`. Delta is `*` wildcard only |
| Milestone modal resize like tasks | not resizable | Already draggable + resizable + reset via `EditModalShell`. The shell sets **width only** (`w-[560px] max-w-[95vw] resize`); `TaskFormModal` also pins height (`h-[900px] max-h-[95vh] min-h-[480px]`). Height is the missing axis — and it affects **all six** modals sharing the shell |
| RAID + milestone description → rich text | a component swap | Both are plain-text `Textarea` **stored as plain text**, with `CharCounter`/`TEXTAREA_MAX` and plain-text dictation append. Rich text is a content-shape change: a new XSS sink everywhere description renders (reports, exports, AI prompts) plus `sanitizeNoteFields`-class load-boundary guards. This is why B is last |

---

## S6 / S7 — provenance and state

Source spec: `specs/2026-07-26-r5-calendar-overhaul-design.md` **inside**
`docs/superpowers/_archive-slice-docs-2026-07-27.zip`. Both slices were scheduled for 0.203.0, which
instead shipped the Escape dismissal stack — so they are unstarted.

**Data model already shipped (S3, 0.202.0):** `CalendarEvent` carries `startTime`, `durationMinutes`,
`attendeeResourceIds`, `sendInvitations`, `outlookEventId`, all persisted across the six write paths.
No migration owed.

**Wiring is 100% absent — verified:**

| Needed | State |
|---|---|
| `graph-recurrence.ts` · `use-event-calendar-push.ts` · `calendar-event-pull.ts` · `use-event-calendar-pull.ts` | all four **missing** |
| `CalendarEntityType` (`settings-types.ts:493`) | `"task" \| "raid" \| "change" \| "absence"` — no `"event"` |
| `GraphEvent` (`outlook-calendar-write.ts:15`) | `isAllDay: true` and `timeZone: "UTC"` are **literal types** — a timed event is currently inexpressible |

**S6** — widen `GraphEvent`; bidirectional recurrence translation; push one **seriesMaster** per series
(not N events) under type-scoped `AIPM:<pid>:event`; reuse the module-scoped in-flight lock and the
404-on-PATCH self-heal. Timezone is the project's **effective** zone, not UTC.

**S7** — occurrence-level pull with its own baseline key
(`${projectId}:event:${seriesMasterId}:${originalDate}`) in a **sibling** pure module. The spec is
explicit that `planCalendarPull`'s date-only `PullEntity`/`PulledEvent` must **not** be widened — the
four shipped entities must not inherit occurrence semantics they do not have.

★ **Invitations are IN scope for S6, with the confirm** (user decision, 2026-07-27). This is the only
surface in the app that emails third parties: `sendInvitations` defaults false; enabling it shows a
confirm naming the resolved recipient count and addresses, and listing attendees with no email as
unreachable rather than silently skipping them. Only after that confirm does the field persist as
`true`. Route this through a security review.

---

## Slice C — what the plan got wrong (read before planning D)

Two things the written plan did not survive contact with. Both are the *class* of
thing that will recur, so they are recorded here rather than only in the plan file.

**1. The seeding ladder could not be a one-shot boolean.** The plan collapsed the panel's two
seed blocks behind a single `pickerSeeded` flag. That drops a documented behaviour: `timelogLinks`
is workspace data and hydrates asynchronously, and the existing block (1) gated on `!linksSeeded`
*only* — never on `autoResolved` — so links arriving after the customer directory **override** a
name auto-resolve. A boolean latches on the weaker seed and loses the links scope silently. Shipped
as a monotonic **rank** (`none 0 < auto 1 < links 2 < picker 3`) that re-seeds only on a strictly
higher source. Mutation-verified: reverting the comparison to a boolean fails the new test.

★ The plan also asserted `source: "none"` "only ever means the directory has not loaded yet". Its
own Task 3 test disproves that — a customer name matching nothing also returns `"none"`. So the
one-shot can stay armed forever, which is why the device-store read is now a `useMemo` keyed on the
project rather than a per-render `localStorage` hit.

**2. The size ratchet fired, and no plan in this roadmap accounts for it.** `timelog-panel.tsx` was
777 lines; slice C's additions took it to 856, over the 800 cap. Resolved by extracting
`use-timelog-picker-scope.ts` (panel → 721). ★ **Check the headroom of every file a slice touches
before planning it** — D and A both touch panels that are already large.

★ Worth noting for the coverage rule in the constraints below: that new `.ts` hook did **not** need
a `coverage.exclude` entry. The panel suite exercises it, and the gate passed with it measured. The
"exclude UI glue hooks" convention is a fallback, not the default.

## Slice D — scope already reduced by slice C

`TableFilter` (`report-table.tsx`, **17 call sites** across budget · budget-report · change-report ·
raid-report · reports-tables · resources-panel-toolbar · resources-report) was folded onto the shared
`ClearableSearchInput` in slice C and its labels qualified. Its button classes were byte-identical to
the primitive, so the DOM did not change — the pre-existing structural assertions still pass.

So the "app-wide ✕ audit" no longer needs to touch those seven panels. What remains for D: fields
that have **no** clear affordance at all, and any hand-rolled ✕ outside `TableFilter` (the timelog
scope filters and `ResourcePicker` are already done — ★ note `ResourcePicker`'s ✕ is deliberately
NOT this primitive: it clears a whole linked field, not a search string, and AGENTS.md documents its
dangling-link semantics).

★★ **Every field D adds a clear button to needs a QUALIFIED label**, for the reason in the lesson
below — and D is the slice most exposed to it, since it adds the same control to many views at once.

## Review lessons from slice C — apply to every later slice

★★ **The axe gate cannot see DUPLICATE accessible names, only missing ones.** Slice C shipped two
clear buttons on one scanned view, both announcing "Clear" (WCAG 2.4.6), and a full 5/5 axe pass said
nothing. AGENTS.md documents this for row controls; it applies equally to any view that gains a
SECOND instance of the same control. **Slice D is an app-wide ✕ audit — it will add clear buttons to
many views at once, so it must qualify every label and cannot lean on axe to catch collisions.**

★★ **Test the WRITE direction of anything persisted.** Slice C's read path was covered (seed the
store → assert restore) while nothing proved the panel ever wrote; removing both persistence calls
left the entire 8286-test suite green.

★ **`.focus()` does not prove focusability** — it succeeds on `tabIndex={-1}`. Use `userEvent.tab()`.

★★★ **A passing mutation test only proves SOME assertion fired, not the one the test is named for.**
Slice C recorded a test as mutation-verified when its headline assertion was unfalsifiable: the
fixture could not reach the branch, and a weaker assertion written ahead of it failed instead and
masked that. Two rules — **assert the headline claim FIRST**, and **read WHICH assertion failed**, not
just that the test went red. `expected '999' to be '667'` and `expected false to be true` are the
difference between a proven claim and a decorative one.

★★★ **Review subagents may return nothing.** All four spawned during slice C idled with
`idleReason:"available"` and never produced a report, twice each, including after being explicitly
asked. If that happens, stop them and review the diff yourself. Hash the tree before and after
regardless (`find … -exec sha256sum`) — that is what proved they had not written to it.

## Standing constraints that bite this roadmap

- **DE i18n** — `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts. Patch via a node utf8 write,
  then grep-verify.
- **Coverage gate** — a new pure `.ts` file is coverage-gated. Either test it properly or add it to
  `vitest.config.ts` `coverage.exclude` (only legitimate for pure UI glue hooks).
- **`dup:check` is blocking** — a copy-pasted control across two files fails CI. Extract first.
- **Axe gate** — `A11Y_VIEWS` covers 16 views. Time bookings, Open Points, RAID, Milestones, Reports,
  Resources, Settings and Insights are scanned; **Gantt is scanned**; Calendar, Knowledge, Chat, Help
  and the Kanban board are **not** — eye-verify those.
- **Release chain** — bump `src/app/version.ts` (APP_VERSION + milestone), add a `CHANGELOG.md` entry,
  append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN+DE strings.
