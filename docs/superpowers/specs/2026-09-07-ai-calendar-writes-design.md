# AI calendar writes — absences and events — design

**Date:** 2026-09-07
**Branch:** `feat/preview-write-path-parity-sweep` (this slice rides the same branch; see the
parity-sweep spec beside it for what else it carries)
**Requested:** "ai assistant needs to be able to write calendar, for example absences and other events."
**Scope approved:** absences **and** calendar events, fully integrated. Recurrence **included**.
`sendInvitations` **model-writable but always staged**.

---

## The gap, measured

`grep -oE '"(create|update|delete|list|get)_[a-z_]+"' src/app/chat-tool-defs.ts` returns 39 tools.
Among them:

- **`calendarEvents`** — `list_calendar_events` and nothing else. No create, update or delete.
- **`absences`** — nothing at all. The assistant cannot read them, let alone write them.

Neither entity has an `INLINE_DESCRIPTORS` entry, so a staged write of one would render on the review
card with its tool name and no diff — the shape `chat-proposal-block.tsx`'s own header calls "the rows
that most need to be VISIBLE".

Persistence needs no work: both entities already ride the six write paths (`calendarEvents` is
AGENTS.md's own worked example for an `ENTITY_SPECS` row; absences predate it). `sanitizeAbsence`
(`sanitize-entities.ts`) and `sanitizeCalendarEvent` (`calendar-event.ts`) both exist and are used by
the load paths.

---

## Surface

Seven new tools, mirroring the stakeholder five exactly:

| tool | notes |
|---|---|
| `list_absences` | the read half that does not exist today |
| `create_absence` · `update_absence` · `delete_absence` | |
| `create_calendar_event` · `update_calendar_event` · `delete_calendar_event` | `list_calendar_events` already exists |

Dispatcher methods mirror `listStakeholders` / `createStakeholder` / `updateStakeholder` /
`deleteStakeholder` in shape and error behaviour (a delete that finds nothing THROWS, so the model is
told rather than silently succeeding). Writes go through functional setters — the bulk-edit landmine —
and creates mint through the session minter.

---

## Readability: two `INLINE_DESCRIPTORS` entries

Without these the review card cannot describe what it is asking the user to approve.

**absence** — `diffFields`: `assignee`, `assigneeEmail`, `startDate`, `endDate`, `type`, `note`.
`enumFields`: `type` over `ABSENCE_TYPES`. `dateFields`: `startDate`, `endDate`.
`requiredNonEmpty`: `assignee`, `startDate`, `endDate`.

**calendarEvent** — `diffFields`: `title`, `startDate`, `startTime`, `durationMinutes`, `location`,
`notes`, `attendeeResourceIds`, `sendInvitations`, `recurrence`. `dateFields`: `startDate`.
`numberFields`: `durationMinutes`. `arrayFields`: `attendeeResourceIds`.

`fieldSanitizers` mirror each entity's real sanitizer per field, read off the sanitizer rather than
guessed — the parity sweep specced beside this one exists precisely because those two can drift.

### Recurrence is the expensive half, and it was chosen deliberately

`RecurrenceRule` is a discriminated union of three shapes (`daily` / `weekly` / `monthly`), and
`monthly` nests `byDay: { ordinal, day }`. The descriptor engine renders a `FieldDiff` as before/after
STRINGS, so recurrence needs a human projection — "Weekly on Mon, Wed until 2026-12-01" — rather than
a JSON blob. That projection is a pure function with its own tests; a blob on the review card would
defeat the card.

★ `exceptions` (`EventException[]`) stays OUT of the model's writable surface. It is per-occurrence
bookkeeping produced by the UI when a user skips or moves one instance, and there is no phrasing a
model could use for it that a reviewer could check at a glance.

---

## Safety: the merge-site guards are not optional here

`patchWithoutId(input, kind)` forwards **whatever the model emitted** minus `id`, `expectedToken` and
`TOKEN_EXCLUDED[kind]` — open-followups §418 records that this is structural, not an omission. So a
hallucinated field lands unless a guard drops it.

Both entities therefore get a `dropUnaccepted*Fields` table beside the four that exist
(`MILESTONE_` / `CHANGE_` / `RAID_` / `STAKEHOLDER_FIELD_GUARDS` in `sanitize-records.ts`), and both
must drop:

- **`outlookEventId`** — the sync link to a real Outlook event. A model-written value would re-point
  or orphan a calendar item outside this app.
- **`localModifiedAt`** — the conflict-detection stamp. Model-supplied, it lies to sync about when a
  row last changed.

★★ **`sendInvitations` is deliberately NOT dropped**, per the scope decision, and it is the one field
here with a side effect outside the app: it mails attendees. It is admitted, and the staging rule
below is what makes that safe.

---

## Staging: a payload rule, mirroring `update_document`

`shouldStage` stages a turn when any call is destructive or when more than one entity write is
proposed. A single `create_calendar_event({sendInvitations: true})` is neither, so it would apply
unreviewed — and unlike every other write in the app, its effect leaves the building and cannot be
undone by the undo engine.

The precedent is already in the file: `isDestructiveCall` special-cases `update_document` because
"the PAYLOAD is what separates the two", and `DESTRUCTIVE_DOC_OPS` is how a name-based set is
extended by one payload test. This slice adds the same shape — a call that sets `sendInvitations`
truthy always stages, regardless of how many writes the turn carries.

★★ It is NOT added to `DESTRUCTIVE_TOOLS`. That set drives the card's own destructive labelling, and
an event invitation is not a deletion; conflating them would mislabel the row.

★ Write-concurrency tokens: both `update_*` and `delete_*` tools join `TOKEN_REQUIRED_TOOLS` with a
`TOKEN_ROW_SOURCE` entry each, so a staged row applied after the underlying record moved is refused
rather than clobbering it — the same protection the other six updates carry.

---

## Known ripple

`chat-proposal.test.ts` partitions the LIVE `TOOL_DEFS` against a literal list of **seven** `create_*`
tools, and its own comment says a new `create_*` tool goes red there. Two are added here, so that test
must be updated as part of this slice — deliberately, and not by relaxing the partition, which is the
assertion that keeps `isCreateTool`'s prefix rule honest.

`ENTITY_WRITE_TOOLS` and `DESTRUCTIVE_TOOLS` both gain the new names; the delete tools belong in the
destructive set for the same reason every other delete does.

---

## Testing

- **Dispatcher**: create/update/delete round-trips per entity through the real dispatcher fixture,
  including a delete of a missing row (must throw) and an update of a row a concurrent writer moved
  (must be refused by the token).
- **Guards**: `outlookEventId` and `localModifiedAt` dropped from a model patch; `sendInvitations`
  NOT dropped. The negative half matters as much as the positive — a guard that drops everything
  would pass a positive-only test.
- **Staging**: a single `create_calendar_event` with `sendInvitations: true` stages; the same call
  without it does not. That pair is the whole rule, and either half alone is satisfiable by a
  stage-everything mutant.
- **Recurrence projection**: one case per `freq`, plus `until` and `count`, plus the nested monthly
  `byDay`. Pure function, no DOM.
- **Descriptors**: both entities join the existing `plan.sanitizer-parity.test.ts` sweep automatically
  — it enumerates over `INLINE_DESCRIPTORS`, so the new entries are covered the moment they are
  declared. That is the point of enumerating rather than listing.

Every behavioural claim is mutation-proved, recorded as `N failed / M passed` with the sum equal to
the file's runtime test count, and each mutant reverted by an anchored inverse write.

---

## Out of scope

- **`exceptions`** — see above.
- **`shifts`** — the third calendar-adjacent entity. Same shape, no request behind it; YAGNI.
- **Outlook push** — writing an absence does not push it to Outlook. That path exists
  (`outlook-calendar.ts`) and is user-driven; wiring the model into it is a separate decision about
  outward-facing side effects, and this slice deliberately does not take it.
