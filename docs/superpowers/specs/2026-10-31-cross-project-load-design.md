# Plan with AI sees a person's load in other projects (§785, #921) — design

Status: draft for owner approval, 2026-10-31.

## Intent

Since §769, *Plan with AI* (Resources → Planning) sees the tasks, milestones, RACI and rates of the project it runs in,
but only that project. A person at 60 % here may be fully booked in another project, so a proposal can hand work to
someone with no room. The owner wants Plan with AI, and the person's entry, to know where else a person works and how
many hours they are planned for there.

Owner's words on record: §769 request (2026-10-23) listed "**other projects**: load a person carries elsewhere" among
what Plan with AI does not see; §769 decision 5 (2026-10-30): "Other projects are out (follow-up)".

## Owner decisions (2026-10-31)

1. **What counts as "booked elsewhere": the other projects' Planning grid hours** for the same person, in the periods
   Plan with AI shows. They feed the elsewhere figure, the percentage and the over-capacity warning. The person's open
   tasks in other projects are a **hint for Claude only** (count and remaining hours), never added to the percentage.
2. **Matching across projects:** the same email (primary `email` or any of `emails`, case-insensitive, trimmed) is the
   same person, automatically. A person without a usable email on either side is matched **by first and last name
   only after the user confirms** it; until confirmed, a name match is a *suggestion* and adds no hours.
3. **Confirm in both places:** in the person's entry (resource edit modal) next to the "Works in project" line, and in
   Plan with AI's review window when an unconfirmed suggestion would change the figures. Either saves the same answer.
4. **"Not the same person" is remembered too**, so the suggestion stops coming back. **Both answers are reversible**
   from the person's entry.
5. **Help:** a help entry and a tooltip at the elsewhere figure explain how people are related across projects and the
   matching rule.
6. **Notice in the person's entry:** "Works in project <name>" for each other project the person is matched in
   (by email or confirmed name); suggestions show separately with Confirm / Not the same.
7. **Fresh, not cached:** other projects are loaded when needed (opening Plan with AI or the person's entry), with a
   loading state; no background summary.
8. **Approach A** (below): the answers live in one shared Turso table beside the projects.

## Goals

- Plan with AI's digest gives each person an "elsewhere" figure per period, per other project, and the model is told
  to treat it as booked time.
- The review window's over-capacity warning counts elsewhere hours: a proposed value is over capacity when
  this-project hours + elsewhere hours exceed the person's available hours in that period.
- The person's entry shows where else they work, with the suggestions to confirm or reject.
- Other projects are read, never written. Only the link table is written.

## Non-goals

- Moving or editing work in other projects. Moves and hour edits stay in this project.
- Cross-project matching in file, IndexedDB or single-project Turso modes (they hold one project). There, nothing loads
  and the digest says "other projects cannot be seen in this storage mode"; the entry shows no notice.
- Merging resources or syncing their fields across projects.
- A cache or background refresh of other projects.

## Anti-goals

- **Hours added to the wrong person:** an unconfirmed name match, or a "not the same" pair, must never add hours.
- **Double counting:** the elsewhere figure is never mixed into this project's planned hours; it is shown and counted
  as its own number.
- **A failing project blocking the feature:** one project that fails to load is skipped and named ("Project B could not
  be read"); the rest still count.
- **Writing into another project.**

## Approaches considered

- **A. A shared Turso table for person links (chosen, owner 2026-10-31).** One row per pair of resources in two projects
  with a verdict (same / not the same), who decided and when. Lives in the shared database beside the projects, outside
  every project's workspace, like `chat_threads` and snapshots. Both projects read the same row; one answer holds for
  both and for every user.
- **B. A link list on each project's resource.** Rejected: confirming in one project would write into the other, and it
  adds a persisted field to all six write paths for a Turso-only feature.
- **C. Browser-only storage.** Rejected: an answer would not reach colleagues or other devices.

## Design

### 1. Where it is available

Only when the open project is one of several Turso projects in the same database (portfolio mode with a live
`tursoConfig`: the same condition Portfolio health uses; projects are read with `new TursoBackend(tursoConfig, projectId)`,
sequentially, as `use-portfolio-health.ts` does). Elsewhere the feature is off and says so where a figure would appear.

### 2. The link table

`person_links`, created with `CREATE TABLE IF NOT EXISTS`, kept OUT of `TABLE_NAMES` (the guard test enforces it, so a
workspace save never deletes it). One row per unordered pair: `(project_a, resource_a, project_b, resource_b)` stored in
a canonical order (lower project id first) so the same pair has one row; `verdict` `same` | `different`; `decided_at`;
`decided_by` (the app's actor label where one exists, else blank). Reversing an answer deletes the row (back to
"suggested") or flips the verdict. Email matches need no row; a row with verdict `different` overrides an email match
too (the user said they are not the same person).

### 3. Matching (pure, i18n-free)

For each resource in this project and each resource in another project:
1. A `different` row for the pair → not matched.
2. A `same` row → matched.
3. Overlapping email (primary or `emails`, case-insensitive, trimmed) → matched.
4. Otherwise, neither side has a usable email and first + last name are equal (case-insensitive, trimmed, non-empty)
   → **suggestion**.
5. Else no relation.
A resource matched to two resources in the same other project counts the hours of both (they are both "them" there);
the builder may instead treat that as ambiguous — see Left to the builder.

### 4. Elsewhere hours

For a matched resource in another project, its planned grid hours per that project's period (`Resource.utilization`, periodKey → percent or hours by
`utilizationMode`, converted to hours the way that project's Planning grid does) are mapped
onto this project's periods by overlapping workdays (holidays and weekends excluded), so a monthly plan elsewhere and a
weekly plan here line up. Only this project's plan window (the periods Plan with AI shows) is computed.

Tasks hint: per matched person and other project, the count of open tasks they own (`resourceId` match, else typed
name equal to their display name, mirroring the elsewhere match) and their remaining hours. Counts and hours only, no
task titles.

### 5. Plan with AI

- Opening Plan with AI starts the load (with a loading state on the elsewhere figures); the run waits for it to finish,
  or for its failure, before sending.
- The digest gains, per person, an ELSEWHERE line: per other project, hours per period, plus the tasks hint. The project
  names are sent; no other data from other projects.
- The system prompt says elsewhere hours are booked time the proposal must respect and cannot change.
- The review window shows the elsewhere figure beside "X h of Y h available" with the tooltip, and the over-capacity
  warning (`alternativeEffect` / `OverCapacity`) uses this-project + elsewhere hours.
- When an unconfirmed name suggestion exists for a person in the proposal, the review window shows it with Confirm /
  Not the same; confirming recomputes the figures.

### 6. The person's entry

The resource edit modal loads the other projects when opened (loading state) and shows:
- "Works in project <name>" per matched project (by email, or confirmed by name — the latter marked as confirmed, with
  an Undo);
- suggestions with Confirm / Not the same;
- rejected pairs ("Not the same as <name> in <project>") with Undo.
Nothing shows outside multi-project Turso.

### 7. Help

A help entry (concepts or features group, EN/DE) explaining: people are separate entries per project; the app links
them by email automatically and by name only after confirmation; "not the same" is remembered; both are reversible;
other projects are only read. A tooltip at the elsewhere figure and at the "Works in project" line says the same in
one or two sentences and links to the entry.

## Constraints

- i18n EN/DE with real umlauts; `i18n.de.ts` only via node utf8 script.
- a11y: Confirm / Not the same / Undo controls have row-unique accessible names; the tooltip is reachable by keyboard.
- People protection (#925): when it is on, Plan with AI already withholds people tools and redacts names; elsewhere
  lines carry only names already known in this project (the matched person) and project names, so they go through the
  same redaction. The builder confirms the redaction dictionary covers them.
- Load hold (§548) and scope epoch: the cross-project load is a background awaiting reader; it must drop its result if
  the project or scope changed meanwhile (`getScopeEpoch` / `dropStaleScopeWrite`).
- Pure logic (matching, period mapping) i18n-free in `alloc-plan/` or a new module; hooks and UI translate.
- The CSP needs no new host (same Turso database).

## Settled after the builder check (designer's calls, 2026-10-31)

1. **Absolute hours.** The elsewhere figure is hours, not a share. A percent value elsewhere becomes hours with that
   project's own capacity for the person (`periodCapacityHours` over that project's plan, absences and the app's
   `workdayHours`/holidays, which are app settings, not per project). Over capacity compares hours: this project's
   hours + elsewhere hours against this project's available hours for the person.
2. **Grid source.** "Grid hours" means `Resource.utilization` with `utilizationMode` (the Planning grid), over the
   other project's `ResourcePlan` periods (`startDate`, `endDate`, `granularity`). Not `plan.allocations` (that is
   budget data). A project with no stored plan contributes nothing and is named as such.
3. **Re-minted ids.** A link row also stores both sides' first name and last name at decision time (no e-mail addresses are stored). A row
   applies only while both resources still carry the same first + last name (case-insensitive, trimmed); otherwise it
   is ignored as stale, so a re-minted id can never inherit an old answer. No write from any delete path.
4. **Stale rows.** Rows naming a project no longer in the registry, or a resource id no longer present, are ignored.
   No cleanup job.
5. **DDL.** `person_links` follows the `chat-threads` pattern (`CHAT_THREADS_DDL` + `chat-threads-store.ts`): a DDL
   list plus a store that runs `CREATE TABLE IF NOT EXISTS` ahead of each read or write. No `turso-migrate`
   self-healing is needed for a new table; a later column change would need it.
6. **When a name suggestion appears.** When the names are equal and email cannot decide: at least one side has no
   usable email. Two usable emails that differ mean different people: no suggestion.
7. **Usable email.** Trimmed, non-empty and containing "@".
8. **Who is included.** Every resource, external or inactive, matches and contributes its grid hours; planned hours are
   booked time whoever holds them.
9. **Which projects.** Every other project in the registry (there is no archived state); the open project excluded.
10. **Read-only, precisely.** Loading another project runs `TursoBackend.load()`, which executes
    `CREATE TABLE IF NOT EXISTS` DDL, as Portfolio health already does. "Never written" means no project data is
    written; the only data write is to `person_links`.
11. **Over-capacity display.** `alternativeEffect` gets the elsewhere hours as a new input and `OverCapacity` carries
    the elsewhere figure so the review window can show it.

### As built

- Task 1 rulings. The link row stores first name and last name separately for each side (`first_a`, `last_a`, `first_b`,
  `last_b`), so re-splitting a name ("Mary Ann"/"Lee" into "Mary"/"Ann Lee") makes a `same` row stale. Item 3 above
  applies to `same` rows only: a `different` row applies whatever the names are now, because a rejection can only
  remove a relation; the cost is that a re-minted id inherits it until the user presses Undo.
- Two resources in one other project matching the same person: both count and their hours are summed (the builder's
  choice under "Left to the builder"; `figureFor` in `cross-project/elsewhere-hours.ts`).
- `decided_by` is left blank: the hook accepts an actor label but the app does not pass one yet.
- Archived projects are not loaded: item 9 said there is no archived state, but the app keeps archived projects in a
  separate list (`tursoArchived`) and the loader reads only `tursoProjects`, so an archived project never contributes
  hours or suggestions.
- The `person_links` table keeps NO e-mail columns (`emails_a` / `emails_b` were dropped before the table shipped: nothing read them, and only names decide staleness).
- Dropped by owner decision 2026-11-01: the per-row elsewhere figure beside each person and the percentage fed by elsewhere
  hours. Elsewhere hours count in the over-capacity warning (which carries them) and in the digest.
- People protection of the OTHER projects (owner decision 2026-11-01): a loaded project whose people are protected (the
  default: `isPeopleProtected(ws.settingsOverrides)`) is left out of every elsewhere figure, task count and suggestion
  (`figureOthers` in `use-cross-project-people.ts`); the digest and the window name those projects
  (`protectedProjects`, only when someone there is matched or suggested). The person's entry still lists such a project
  under "Works in project": that is local UI, not an AI send. The AI data disclosure (version 3) describes what is sent.
- An e-mail match can be marked "not the same person" from the person's entry (`reject` writes a `different` row, which
  already overrides an e-mail match; Undo restores it).
- A load requested during the load hold is remembered (`wantedRef` in `use-cross-project-people.ts`) and started when
  the hold ends; Plan with AI does not send while the status is `idle` without `loadFailed`.
- A single-project Turso portfolio reports `singleProject`, and the digest says there are no other projects.
- A link write made during a reload is kept in `runWritesRef` and re-applied over the reloaded links.
- The over-capacity line reads "<here> h + <elsewhere> h elsewhere of <available> h" when elsewhere hours exist.
- Run (Propose) is REFUSED while the other projects load rather than queuing the send: the button is disabled while
  loading; when idle without a failure a click re-requests and sends nothing, with the "not loaded" hint.
- A project hard delete removes `person_links` rows naming the project on either side (`PROJECT_SCOPED_SIDE_TABLES`
  entry with `columns`), and the §204 guard now checks every `project_<letter>` column.
- The review window lists a name suggestion only when the suggested person has hours in the plan's periods
  (`suggestionHours`, summed over the whole plan window), as decision 3 says; the Resource entry lists all suggestions.
- The person's entry is not offered in a popout (`crossProject` is `undefined` there).
- A reload whose `person_links` read fails drops the earlier result for that project (status `idle`, `loadFailed`), so
  Plan with AI never sends old figures while saying the hours are not counted.
- The help link beside the tooltip is a `HelpIconButton` that opens the entry in place; an `InfoTooltip` cannot carry a link.

## Left to the builder

- The exact module layout and names.
- How `decided_by` is filled (actor label source) or left blank.
- Two resources in one other project matching the same person: sum both, or treat as ambiguous and surface it as a
  suggestion; pick one, document it, test it.
- Loading-state and failure wording, within the anti-goals.
- Help group and tooltip component, following `docs/AGENTS/ui-shell.md`.
