import { describe, expect, it } from "vitest";

import { TOKEN_EXCLUDED } from "../ai-entity-token";
import { AXIS_FIELDS } from "../../test/inline-sweep-fixtures";
import { PERSISTED_COLUMNS } from "../../test/offered-surface-axis";
import { type InlineEntity } from "./entity-descriptor";
import { RICH_FIELDS } from "./plan";

/** THE RATCHET THE SWEEP CANNOT BE. `plan.write-path-sweep.test.ts` compares
 *  the preview against the write for every field on its AXIS, and that axis is
 *  the entity descriptor UNION the seed row's own keys (`sweptFields`). So the
 *  sweep is definitionally blind to a field nobody put in either place: it
 *  reports what it looked at, never what exists.
 *
 *  ★★★ THAT BLINDNESS COST A REAL DEFECT, which is why this file exists.
 *  `Stakeholder.resourceId` — the FK to a Resource — was in no tool schema, no
 *  `TOKEN_EXCLUDED` row, no merge-site guard, no descriptor and no seed, while
 *  `sanitizeStakeholder` happily stored it. The sweep read
 *  `Tests 37 passed (37)` over it. Seeding the field turned it into three
 *  violations at once, the worst being `4 -> undefined` on a negative number:
 *  a SILENT UNLINK behind a card that disclosed nothing. It was found by a cold
 *  review doing this subtraction BY HAND, one entity beyond its brief.
 *
 *  So this file does that subtraction mechanically, forever, from a source the
 *  sweep does not control: the CSV column lists, read as `PERSISTED_COLUMNS`
 *  from `src/test/offered-surface-axis.ts`, which it shares with
 *  `plan.offered-surface-sweep.test.ts`. `PERSISTED_COLUMNS`'s docstring there
 *  carries the reason the CSV column lists are the right source:
 *  `ai-entity-token.ts`'s `ProjectedRows` already makes tsc prove each array
 *  covers its entity type, so a persisted field cannot fail to appear and this
 *  file then forces a decision about it.
 *
 *  ★★ IT IS A SET RATCHET, NOT A COUNT, for the reason `AXIS_FIELDS` is: a
 *  count is blind to substitution. Adding a field and dropping another leaves
 *  any tally unmoved.
 *
 *  ★★ THE TWO DETECTORS ASK DIFFERENT QUESTIONS AND NEITHER REPLACES THE OTHER.
 *  This file is STATIC accounting at zero runtime cost — "is every persisted
 *  column accounted for by the write-path sweep's axis?" — and it catches a new
 *  column arriving unswept before anyone writes a probe for it.
 *  `plan.offered-surface-sweep.test.ts` is BEHAVIOURAL — "does an undeclared
 *  field actually land, and does a declared one actually work?" — and it costs a
 *  dispatcher mount per field. Deleting either leaves a hole the other does not
 *  cover.
 *
 *  ★ This file's axis is deliberately NOT re-based on `declaredProperties`,
 *  because `update_task` uses a genuine whitelist (`buildPatch`) — reasoning
 *  the schema axis does not reproduce. ★★ That whitelist is why
 *  `UNSWEPT_BY_DESIGN.task` was ever long; it is one name now, and NOT because
 *  the reasoning changed — the 2026-09-12 `AXIS_FIELDS` re-measurement put
 *  eleven of those columns on the sweep's own axis. Do not read the short list
 *  as the whitelist having been retired. */

/** Persisted fields the sweep deliberately does NOT cover, with the reason.
 *
 *  ★★★ A NEW ENTRY HERE IS A DECISION, NOT A FORMALITY. Every field listed is
 *  one the model could reach if the reason below ever stopped holding. Adding a
 *  name to this list to make a red run green — without checking the reason
 *  applies to THAT field — reintroduces exactly the defect this file exists to
 *  catch. The honest alternatives are: seed it (so the sweep covers it), guard
 *  it (`dropUnaccepted*Fields`), or token-exclude it.
 *
 *  ★★ A REMOVAL FROM THIS LIST CAN BE A COVERAGE GAIN, AND ON 2026-09-12 TWELVE
 *  OF THEM WERE — which is the only shape a removal is allowed to have. This
 *  branch widened the sweep seeds, `AXIS_FIELDS`
 *  (`src/test/inline-sweep-fixtures.ts`) was re-measured against them, and
 *  eleven `task` columns plus `calendarEvent.exceptions` joined the real sweep
 *  axis: the FIRST of the three alternatives above, taken. The red run that
 *  followed was this ledger reporting a record that had stopped being true.
 *  ★★★ The inverse move — deleting a name because the assertion is
 *  inconvenient, or because the field merely stopped appearing — is the defect
 *  this file exists to catch, seen from the other side. Before removing a name,
 *  confirm it is now on `AXIS_FIELDS`, in `TOKEN_EXCLUDED` or in `RICH_FIELDS`;
 *  if it left `PERSISTED_COLUMNS` instead, the column was dropped and that is a
 *  different commit. */
const UNSWEPT_BY_DESIGN: Record<InlineEntity, readonly string[]> = {
  /** ★★ `jiraKey` IS EXEMPT ON TWO COUNTS AND BOTH MUST KEEP HOLDING — one
   *  explains why the sweep does not reach it, the other why that is safe.
   *
   *  OFF THE AXIS: `seedGuardedTask` (`src/test/inline-sweep-fixtures.ts`)
   *  leaves it BLANK deliberately, so no seed key puts it on `AXIS_FIELDS`. A
   *  `jiraKey` makes the row Jira-synced and `assertJiraManagedUnchanged`
   *  (`chat-task-patch.ts`) then throws on every `status`/`assignee` change,
   *  which would turn the sweeps' probes on both into refusals — so seeding it
   *  to buy coverage here would cost coverage there (§467, where
   *  `plan.offered-surface-sweep.test.ts` ledgers it `dead` on both arms).
   *
   *  NOT MODEL-WRITABLE: `update_task` does NOT go through `patchWithoutId`; it
   *  goes through `buildPatch` (`chat-tools-updates.ts`), which names each field
   *  it copies and drops everything else, and `jiraKey` is not among them.
   *  ★ If `buildPatch` is ever replaced by a `patchWithoutId` call this name
   *  becomes live in one commit — this comment is the tripwire, since no test
   *  can see the swap.
   *
   *  ★★★ DO NOT GENERALISE THE WHITELIST INTO "no task field is model-writable
   *  without appearing in `buildPatch`". An earlier revision of this comment
   *  made that flat claim about the whole list and it was false, refuted by a
   *  cold review with a command; the commit message that shipped it repeated the
   *  error. `set_task_dependencies` (`chat-tools.ts`) takes the model's array
   *  and hands it straight to the writer with no `buildPatch`, reachable from
   *  chat, inline AI edit and insight-recommendation replay. ★★ `dependencies`
   *  is no longer listed here — the 2026-09-12 axis re-measurement swept it —
   *  but the warning stays: a reader who believes the flat claim will miss the
   *  next tool of this shape. */
  task: ["jiraKey"],
  raid: [],
  change: [],
  milestone: [],
  stakeholder: [],
  resource: [],
  absence: [],
  /** ★★ EMPTY BECAUSE `exceptions` IS NOW SWEPT, not because it stopped
   *  mattering — it was the one entry here, exempted by SHAPE (calendar events
   *  use the ALLOWLIST guard `dropUnacceptedCalendarEventFields`, which builds a
   *  fresh object and copies only fields its table names, so a field with no
   *  table entry is dropped by construction rather than by anybody remembering
   *  it). That reasoning still describes the guard; it is simply no longer the
   *  thing standing between the model and this field. ★★ It is also the OPPOSITE
   *  of the five denylist entities above, where an unnamed field passes straight
   *  through — which is why their lists must stay empty on their own merits and
   *  not by borrowing this one's argument.
   *
   *  ★★★ AND IT WAS THE RIGHT ENTRY TO LOSE, because as originally written it
   *  was FALSE. The allowlist reached the UPDATE path alone;
   *  `create_calendar_event` spread raw input, so model-supplied
   *  `exceptions` — a field no write
   *  schema advertises, whose exact shape the READ tool's description teaches —
   *  reached storage with nothing to refuse it (§438). The exemption was a
   *  suppression hiding a live undisclosed write, in the file whose stated
   *  purpose is to stop suppressions, three lines under a preamble warning
   *  against exactly that. Caught by cold review, with the stored value
   *  measured.
   *
   *  ★★ WHAT REPLACES IT IS STRICTLY STRONGER, and that is the only reason this
   *  list may be empty: `seedGuardedCalendarEvent` now carries two `exceptions`
   *  entries, so the field is on `AXIS_FIELDS` and
   *  `plan.write-path-sweep.test.ts` probes it directly, while
   *  `plan.offered-surface-sweep.test.ts` carries NO `calendarEvent` row in
   *  `EXPECTED_UNDECLARED_FINDINGS` — i.e. Relation A probes this undeclared
   *  column on both arms and ledgers it neither `dead` nor `unmeasured`, which
   *  is the measurement that it lands nowhere.
   *  ★★ READ THE RIGHT LEDGER: `EXPECTED_FINDINGS` above it DOES carry two
   *  `calendarEvent` rows, and they are Relation B's on `sendInvitations`
   *  (§443, mail-safety) — nothing to do with this field. A grep for
   *  `"calendarEvent:` finds them and refutes the sentence above if you stop
   *  there. `plan.create-path-guards.test.ts` still pins the create half.
   *  Un-seeding the field would take all of that away in silence; restoring an
   *  entry here is not the repair for that. */
  calendarEvent: [],
};

const ENTITIES = Object.keys(PERSISTED_COLUMNS) as InlineEntity[];

/** The subtraction itself: persisted, minus the identifier, minus what the
 *  sweep covers, minus what `patchWithoutId` strips, minus rich HTML (which the
 *  sweep filters and `AI_RICH_FIELDS` guards separately). */
function unsweptFields(entity: InlineEntity): string[] {
  const excluded = (TOKEN_EXCLUDED as Record<string, readonly string[]>)[entity] ?? [];
  const axis = AXIS_FIELDS[entity];
  return PERSISTED_COLUMNS[entity]
    .filter((f) => f !== "id")
    .filter((f) => !axis.includes(f))
    .filter((f) => !excluded.includes(f))
    .filter((f) => !RICH_FIELDS.has(`${entity}.${f}`))
    .sort();
}

describe("the model-writable surface is fully accounted for", () => {
  it.each(ENTITIES)(
    "%s: every persisted field is swept, token-excluded, rich, or recorded as unswept by design",
    (entity) => {
      expect(unsweptFields(entity)).toEqual([...UNSWEPT_BY_DESIGN[entity]].sort());
    },
  );

  /** ★★★ THE ANTI-VACUITY HALF, and it is not decoration. Every assertion above
   *  is a subtraction, and a subtraction over an EMPTY minuend passes for free —
   *  a mis-wired import that yielded `[]` for `PERSISTED_COLUMNS` would make the
   *  whole suite green while checking nothing. This is the repo's
   *  `absence-tests-need-a-positive-observable` rule: `0 mismatch` is worthless
   *  without `N match` beside it. */
  it.each(ENTITIES)("%s: the subtraction has something to subtract from", (entity) => {
    expect(PERSISTED_COLUMNS[entity].length).toBeGreaterThan(5);
    expect(AXIS_FIELDS[entity].length).toBeGreaterThan(4);
    expect(PERSISTED_COLUMNS[entity]).toContain("id");
  });

  /** ★ A guard on the recorded list itself: a name here that the entity does
   *  not actually persist is dead text, and dead text in an allowlist is how a
   *  stale exemption outlives the field it exempted. */
  it.each(ENTITIES)("%s: every recorded exemption names a field that exists", (entity) => {
    for (const field of UNSWEPT_BY_DESIGN[entity]) {
      expect(PERSISTED_COLUMNS[entity], `${entity}.${field} is exempted but not persisted`).toContain(field);
    }
  });
});
