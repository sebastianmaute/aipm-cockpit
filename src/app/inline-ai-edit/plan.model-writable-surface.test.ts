import { describe, expect, it } from "vitest";

import { TOKEN_EXCLUDED } from "../ai-entity-token";
import {
  ABSENCES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  CSV_COLUMNS,
  EVENTS_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS,
  STAKEHOLDERS_CSV_COLUMNS,
} from "../csv-codecs-core";
import { AXIS_FIELDS } from "../../test/inline-sweep-fixtures";
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
 *  sweep does not control: the CSV column lists. Those are the right source
 *  because `ai-entity-token.ts`'s `ProjectedRows` already makes tsc prove each
 *  array covers its entity type — so a field added to `types.ts` and persisted
 *  cannot fail to appear here, and this test then forces a DECISION about it.
 *
 *  ★★ IT IS A SET RATCHET, NOT A COUNT, for the reason `AXIS_FIELDS` is: a
 *  count is blind to substitution. Adding a field and dropping another leaves
 *  any tally unmoved. */
const PERSISTED_COLUMNS: Record<InlineEntity, readonly string[]> = {
  task: CSV_COLUMNS,
  raid: RAID_CSV_COLUMNS,
  change: CHANGES_CSV_COLUMNS,
  milestone: MILESTONES_CSV_COLUMNS,
  stakeholder: STAKEHOLDERS_CSV_COLUMNS,
  resource: RESOURCES_CSV_COLUMNS,
  absence: ABSENCES_CSV_COLUMNS,
  calendarEvent: EVENTS_CSV_COLUMNS,
};

/** Persisted fields the sweep deliberately does NOT cover, with the reason.
 *
 *  ★★★ A NEW ENTRY HERE IS A DECISION, NOT A FORMALITY. Every field listed is
 *  one the model could reach if the reason below ever stopped holding. Adding a
 *  name to this list to make a red run green — without checking the reason
 *  applies to THAT field — reintroduces exactly the defect this file exists to
 *  catch. The honest alternatives are: seed it (so the sweep covers it), guard
 *  it (`dropUnaccepted*Fields`), or token-exclude it. */
const UNSWEPT_BY_DESIGN: Record<InlineEntity, readonly string[]> = {
  /** ★★ TASK IS THE ONE ENTITY WITH A REAL WHITELIST, and that is the whole
   *  reason this list is long rather than alarming. `update_task` does NOT go
   *  through `patchWithoutId`; it goes through `buildPatch`
   *  (`chat-tools-updates.ts`), which names each field it copies and drops
   *  everything else. So none of these is model-writable, and the sweep would
   *  find nothing to compare. ★ If `buildPatch` is ever replaced by a
   *  `patchWithoutId` call, EVERY name below becomes live in one commit — this
   *  comment is the tripwire for that, since no test can see the swap. */
  task: [
    "completedDate",
    "createdDate",
    "dependencies",
    "healthOverride",
    "jiraIssueType",
    "jiraKey",
    "knowledgeLinks",
    "originalEstimateMinutes",
    "remainingEstimateMinutes",
    "resourceId",
    "startDate",
    "timeSpentMinutes",
  ],
  raid: [],
  change: [],
  milestone: [],
  stakeholder: [],
  resource: [],
  absence: [],
  /** ★★ `exceptions` is safe by SHAPE, not by omission. Calendar events use the
   *  ALLOWLIST guard (`dropUnacceptedCalendarEventFields` builds a fresh object
   *  and copies only fields its table names), so a field with no table entry is
   *  dropped by construction rather than by anybody remembering it. That is the
   *  opposite of the five denylist entities, where an unnamed field passes
   *  straight through — which is why their lists above must stay empty. */
  calendarEvent: ["exceptions"],
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
