# AI write safety and response cost — design

**Date:** 2026-09-03
**Status:** approved design, not yet planned
**Origin:** benchmarking OpenProject 17.8 (released 2026-09-02) against AI PM Cockpit. Two gaps in
their release were real gaps here; a third (`§346`, no MCP server) is filed separately as an
architecture decision, and `§347`/`§348` are sequenced after this slice.

## Goal

Make the AI write path safe and cheap: an assistant must not silently overwrite a concurrent human
edit, and reading the workspace must not spend the context window on bytes no model needs.

## Background — both gaps measured, not assumed

**Write safety.** `chat-tools.ts:544` — `update_task` takes an id and a patch, calls
`d.updateTask(id, patch)` and returns. There is no staleness check of any kind. An assistant that
reads a task, reasons for thirty seconds and writes back silently overwrites whatever a human
changed in the interval. The same shape holds for `update_raid_item`, `update_change`,
`update_milestone`, `update_stakeholder` and `update_resource`.

OpenProject 17.8 closed exactly this with a `lock_version` check on its new MCP write tools.

**Response cost.** `list_tasks` is `return d.listTasks()` — the whole array, with no total, no page
size and no cursor, and with every rich-HTML field serialized in full. OpenProject 17.8 added
pagination metadata (page size, total count) precisely so "how many work packages exist?" needs no
extra call, and stripped HTML renderings and action links from its responses. Cockpit has *seven*
rich-HTML fields feeding the same context window, so the same change is worth more here.

## Decision 1 — the concurrency token is DERIVED, not stamped

### Rejected: `Task.localModifiedAt`

The obvious candidate is `localModifiedAt` (`types.ts:95`), an ISO timestamp whose docstring says
"used for sync conflict detection". Ten entity types carry it, including all six the AI can update.

It was rejected, and the reason is the whole point of this section. **A stamp is only as good as the
set of writers that set it.** A write path that does not stamp leaves the field *unchanged* after a
human edit; the guard then compares two identical values, concludes nothing moved, and permits
exactly the overwrite it exists to prevent. That is a false *permit* — the dangerous direction.

Measured 2026-09-03: **68 stamp sites across 27 non-test files**, against **45 `setTasks(` call
sites across 17 non-test files** — for tasks alone, one of six AI-updatable entities. Reproduce:

```bash
grep -rn "localModifiedAt:" src/app --include=*.ts --include=*.tsx | grep -v "\.test\." | wc -l
grep -rn "setTasks(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\." | wc -l
```

Closing that gap means enumerating and fixing every write path across six entities, and then paying
a standing tax forever: every future write path must remember to stamp, with no gate watching. A
guard resting on an incompletely-stamped field reads as protection and stops anyone auditing it.

★ Note that "strict on absent" does NOT rescue this. Refusing when the stamp is missing covers only
never-touched rows. The dangerous case is *present but stale*, and no policy on the absent case
touches it.

### Chosen: a token derived from the entity's own serialized content

Cockpit already has byte-stable per-entity serializers, and they are already CI-gated —
`golden-workspace.test` pins their exact bytes, so a silent change to what they emit fails the build.

| Entity | Serializer | Column set |
|---|---|---|
| `Task` | `fieldToString` | `CSV_COLUMNS` |
| `RaidItem` | `raidFieldToString` | `RAID_CSV_COLUMNS` |
| `Milestone` | `milestoneFieldToString` | `MILESTONES_CSV_COLUMNS` |
| `ChangeItem` | `changeFieldToString` | `CHANGES_CSV_COLUMNS` |
| `Stakeholder` | `stakeholderFieldToString` | `STAKEHOLDERS_CSV_COLUMNS` |
| `Resource` | `resourceFieldToString` | `RESOURCES_CSV_COLUMNS` |

★★ `Task`'s serializer is the UNPREFIXED `fieldToString` over the UNPREFIXED `CSV_COLUMNS`; every
later entity got a prefixed name. A grep for `taskFieldToString` returns nothing and will make a
reader conclude tasks have no serializer. They do.

The token is a hash over that projection. Any change by any writer changes the token **by
construction** — no stamping discipline, no enumeration, no standing tax, and a write path added
next year is covered the day it lands.

### Token scope, and the invariant that keeps it honest

The projection is the entity's CSV columns MINUS an explicit exclusion set. Task has 28 columns, of
which five are bookkeeping that moves without anyone editing the substance the AI is acting on:

| Excluded | Why |
|---|---|
| `localModifiedAt` | self-referential — including it makes the token equivalent to the stamp approach this section rejects |
| `lastSyncedAt` | Jira sync bookkeeping |
| `outlookEventId` | calendar write-back bookkeeping |
| `inquiriesSent` | a counter bumped by sending a status inquiry, not a content edit |
| `noteLog` | a dated append; adding a note does not invalidate an edit to other fields |

Including them would produce false *refusals* — the safe direction, but noisy enough that a model
would be blocked by a background sync it cannot see.

★★★ **THE INVARIANT: a field may be excluded from the token ONLY IF no AI tool can write it.**
Excluding a field the AI can write reintroduces a false *permit* for exactly that field — two
assistants, or an assistant and a human, could both append to `noteLog` with neither detected. This
is checkable rather than aspirational, and the slice must pin it with a test asserting the exclusion
set is disjoint from the AI-writable field set. If a future tool gains the ability to write
`noteLog`, that test goes red and the exclusion must be removed.

### Semantics — strict

- Every AI read of a single entity (`get_task` and peers) returns the token alongside the record.
- Every AI `update_*` takes the token as a REQUIRED input.
- On write the tool re-derives the token from current state and compares.
- Mismatch → refuse with an error naming the entity and telling the model to re-read.
- **Token absent → refuse.** A model must not be able to skip the check by omitting the field.
- `create_*` is unaffected — there is nothing to be stale against. The existing
  `resolveEntitySave` id-mint race guard stays exactly as it is; it answers a different question
  (create-vs-update intent) and this token does not replace it.

## Decision 2 — pagination metadata and response slimming

**Pagination metadata.** `list_*` tools return an envelope carrying the rows plus `total` and, when
the caller passed one, the applied `limit`. "How many tasks exist?" is then answerable from one
call. `limit` is optional; omitting it preserves today's behaviour of returning everything, so no
existing prompt breaks.

**Slimming.** Rich-HTML fields are the dominant cost and a model reasons about their text, not their
markup. `list_*` responses project rich HTML through the existing DOM-free `htmlToPlainText`.

★ `get_*` (single entity) keeps full fidelity — an assistant about to EDIT a description needs the
markup it is editing. The saving is in the list path, which is where the volume is.

★★ This must be measured, not asserted. The slice records before/after serialized byte counts for a
seeded workspace in the commit message. A cost change nobody measured is a claim, not a result.

## Scope

**In:** the six `update_*` tools and their matching `get_*`/`list_*` reads; the token helper; the
exclusion-set invariant test; pagination envelope; list-path slimming.

**Out:** an MCP server (`§346`, needs an architecture decision first); time-entry guardrails
(`§347`); meeting↔task activity (`§348`); any change to `create_*` or to `resolveEntitySave`;
multiple target versions (Cockpit has no release-line concept, and its absence is not established
as a gap).

## Testing

- Token changes when any covered field changes; does NOT change when an excluded field changes.
  Both directions, per entity — a one-directional test passes against a constant.
- Stale write refused: read a token, mutate the entity by another path, attempt the AI update,
  assert refusal AND that the entity is unchanged. Asserting only the error message would pass
  against a tool that refused and wrote anyway.
- Missing token refused.
- Fresh write accepted — the control. Without it, a tool hardcoded to refuse passes every block
  above.
- The exclusion-set/AI-writable disjointness invariant.
- `list_*` envelope reports a `total` matching the row count, and the slimmed projection contains
  the text of a rich field but not its tags.
- Every guard mutation-proved: the assertion must fail against the code with the guard removed, and
  the run must report WHICH cases fail, not merely a non-zero exit.

## Risks

- **The exclusion set is a judgement call.** It is defensible per field and pinned by the
  disjointness invariant, but a sixth noisy field discovered later widens it, and each widening is a
  new false-permit surface. The invariant test is the thing that keeps this from drifting silently.
- **Required token is a breaking change to the tool contract.** Any saved prompt or scheduled job
  that calls `update_*` without one starts failing. That is the intended direction (fail closed),
  but the slice must check `use-ai-orchestration.ts`'s scheduled-job runner and the
  insight-recommendation replay path, both of which call tools without a human in the loop.
- **Hashing rich HTML is stable only while the serializer is.** That is exactly what
  `golden-workspace.test` gates, so the dependency is sound — but a deliberate serializer change
  will invalidate every outstanding token, which is correct behaviour and should be stated in the
  error text rather than discovered.
