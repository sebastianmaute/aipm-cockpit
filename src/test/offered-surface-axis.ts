// src/test/offered-surface-axis.ts
//
// ★★★ THE AXIS IS WHAT THE MODEL IS OFFERED, AND THAT IS THE WHOLE POINT.
// Every existing detector on this path derives its field set from something the
// guard tables control — `sweptFields` unions `diffFields`, `rawTypeGuards` and
// `linkFields`; `plan.model-writable-surface.test.ts` subtracts `AXIS_FIELDS`,
// same lineage. A field in none of them is unreachable by construction, which
// is how §438's nine undisclosed writes sat under a green sweep.
//
// `TOOL_DEFS` has no part in guarding. Measured 2026-09-08: an axis built from
// it rediscovers §438's entire field set cold — `stakeholder.resourceId`,
// `stakeholder.raci`, `resource.birthday`, `resource.utilization`,
// `resource.utilizationMode`, `resource.absenceOverride`, `resource.active`,
// `calendarEvent.exceptions` are all undeclared by any schema. That is the
// argument for this axis, and it is worth more than the reasoning above it.
//
// ★★★ READ `TOOL_DEFS` AT RUNTIME. NEVER REGEX-SCRAPE `chat-tool-defs.ts`.
// The spec's sizing probe used a regex and is explicitly not what ships, for a
// reason `ai-entity-token.test.ts` already records: `TOOL_DEFS` SPREADS
// `DOCUMENT_TOOL_DEFS` from a second file, so a grep over one source sees a
// strict subset of the real tool list and reports a smaller surface than the
// model is sent.
//
// ★★ SCOPE — `propose_project` IS OUT OF IT, AND NOT BY OVERSIGHT. This axis is
// `TOOL_DEFS`, and `propose_project`'s schema is not in it — it is
// `PROPOSAL_TOOL` in `ai-project-proposal.ts`; `chat-tool-defs.ts` names it
// only in a comment — so no relation built here can reach that surface. It IS a
// model-write path, and `proposalToSeed` runs no `dropUnacceptedChangeFields`:
// a seed rebuilds a whole register from an untrusted blob rather than
// transitioning a live row, so the guards that protect a prior value have no
// prior value to protect (`change-log.ts` records that exemption). What bounds
// it is `SEED_OFFERED_KEYS` (`2645debb`, 0.297.0), which drops every key the
// seed schema does not offer before the sanitizer runs, so `change.decisionDate`
// cannot land that way. This paragraph was written before that filter and said
// the hole was open. Nothing in this sweep tests the filter; do not read a green
// run here as covering it.
import { TOOL_DEFS } from "../app/chat-tool-defs";
import {
  ABSENCES_CSV_COLUMNS,
  CHANGES_CSV_COLUMNS,
  CSV_COLUMNS,
  EVENTS_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS,
  RAID_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS,
  STAKEHOLDERS_CSV_COLUMNS,
} from "../app/csv-codecs-core";
import { INLINE_DESCRIPTORS, type InlineEntity } from "../app/inline-ai-edit/entity-descriptor";

export const ENTITIES = Object.keys(INLINE_DESCRIPTORS) as InlineEntity[];

/** The persisted surface, from the CSV column lists.
 *
 *  ★★ THE RIGHT SOURCE, AND NOT BY CONVENIENCE. `ai-entity-token.ts`'s
 *  `ProjectedRows` (`Assert<Projected<T, typeof COLUMNS>>`) already makes tsc
 *  prove each array covers its entity type — so a field added to `types.ts` and
 *  persisted CANNOT fail to appear here, and this axis then forces a decision
 *  about it. A hand-written list would go stale in silence.
 *
 *  ★ Lifted out of `plan.model-writable-surface.test.ts`, which now imports it
 *  back. Two detectors reasoning about "the persisted surface" from two private
 *  copies is how they come to disagree about what was covered. */
export const PERSISTED_COLUMNS: Record<InlineEntity, readonly string[]> = {
  task: CSV_COLUMNS,
  raid: RAID_CSV_COLUMNS,
  change: CHANGES_CSV_COLUMNS,
  milestone: MILESTONES_CSV_COLUMNS,
  stakeholder: STAKEHOLDERS_CSV_COLUMNS,
  resource: RESOURCES_CSV_COLUMNS,
  absence: ABSENCES_CSV_COLUMNS,
  calendarEvent: EVENTS_CSV_COLUMNS,
};

type SchemaProperty = { type?: string; enum?: readonly string[]; description?: string };

function toolDef(name: string) {
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`offered-surface axis: no TOOL_DEFS entry named "${name}"`);
  return def;
}

/** Every property the named tool ADVERTISES, minus the two addressing fields.
 *
 *  ★★ `id` and `expectedToken` are subtracted because neither is a WRITTEN
 *  field: `create_*` mints the id and `update_*` addresses by it, and
 *  `expectedToken` is concurrency plumbing stripped by `patchWithoutId` before
 *  the patch reaches any writer. Leaving them in would put two fields on
 *  Relation B's axis that can never "land", producing two permanent findings
 *  per entity that are not defects.
 *
 *  ★ Measured 2026-09-08: create and update share ONE field bag per entity for
 *  all eight — `create_raid_item` declares `properties: raidFields` and
 *  `update_raid_item` declares `{ id, ...expectedTokenField, ...raidFields }`.
 *  So the two ops return the same set today. The `op` parameter exists so that
 *  a future divergence is expressible rather than silently averaged. */
export function declaredProperties(entity: InlineEntity, op: "create" | "update"): readonly string[] {
  const name = op === "create" ? INLINE_DESCRIPTORS[entity].createTool : INLINE_DESCRIPTORS[entity].updateTool;
  const props = (toolDef(name).input_schema as { properties?: Record<string, SchemaProperty> }).properties ?? {};
  return Object.keys(props)
    .filter((f) => f !== "id" && f !== "expectedToken")
    .sort();
}

/** The raw schema entry for one declared property, for probe derivation. */
export function schemaProperty(entity: InlineEntity, op: "create" | "update", field: string): SchemaProperty {
  const name = op === "create" ? INLINE_DESCRIPTORS[entity].createTool : INLINE_DESCRIPTORS[entity].updateTool;
  const props = (toolDef(name).input_schema as { properties?: Record<string, SchemaProperty> }).properties ?? {};
  const prop = props[field];
  if (!prop) throw new Error(`offered-surface axis: ${name} declares no property "${field}"`);
  return prop;
}

/** Persisted columns the model is offered by NO tool schema.
 *
 *  ★★★ THIS IS RELATION A'S AXIS, AND IT IS NOT AN EXEMPTION LIST. Everything
 *  here SHOULD be unwritable; the relation asserts it. `localModifiedAt` sits in
 *  all eight of these sets and `outlookEventId` in six (every entity but
 *  stakeholder and resource: `grep -c '"outlookEventId"' src/app/csv-codecs-core.ts`
 *  → 6, and no tool schema declares it) — both are legitimately
 *  written by THE WRITER, which is why the relation asserts on the PROBE VALUE
 *  rather than on the field's presence, and so needs no exemption for them.
 *
 *  ★★★ AN EARLIER REVISION OF THIS DOCSTRING ADDED "and neither is ever written
 *  to the MODEL'S value", AND RELATION A REFUTED IT ON ITS FIRST RUN. Measured
 *  2026-09-08, not reasoned: true on every update arm, FALSE on create for five
 *  entities — a trespass string supplied by the model lands verbatim in
 *  `localModifiedAt` on raid, change, milestone, stakeholder and resource, and
 *  in `outlookEventId` on raid, change and milestone. `task`, `absence` and
 *  `calendarEvent` guard it. That was the branch's code: on main the create strip
 *  (`createInputWithoutId` over `TOKEN_EXCLUDED`, `29744af1`, 0.297.0) removes
 *  each leaked field from the model's input on those five, so the Relation A
 *  create arm no longer reproduces it. The finding stands as the record of why
 *  that strip exists.
 *  The sentence was written as a REASON THE AXIS NEEDS NO EXEMPTION and would
 *  have read as a verified fact about the write path, which is the class of
 *  false claim that stops the next audit before it starts. */
export function undeclaredColumns(entity: InlineEntity): readonly string[] {
  const declared = declaredProperties(entity, "create");
  return PERSISTED_COLUMNS[entity].filter((f) => f !== "id" && !declared.includes(f)).sort();
}

/** Declared properties that are deliberately NOT persisted columns.
 *
 *  ★★ `resource.name` is a CONVENIENCE INPUT, not a field: the writer splits it
 *  into `firstName`/`lastName`, documented in `chat-tool-defs.ts` (`resourceFields`)
 *  and again on `ResourceInput.name` in `chat-tools.ts`. It is the only one in
 *  the tree as of 2026-09-08 — measured, not assumed.
 *
 *  ★★★ THIS IS FLOOR 3'S EXCEPTION LIST AND NOTHING ELSE READS IT. It is never
 *  subtracted from `declaredProperties`, so both relations still derive their
 *  axes from the TRUE offered surface and Relation B still probes
 *  `resource.name` on both arms. An exemption that reaches the relations is the
 *  shape that hid §438 inside §437's ratchet.
 *
 *  ★★★ THAT PROBE IS BLIND TO THE SPLIT. An earlier revision said a synthetic
 *  input that stops being split "stays visible to them", and for `name` it
 *  does not. Both arms compare `row.name` alone, which the writer never
 *  stores, and the resource descriptor has no `name` entry in
 *  `fieldSanitizers` — so the sweep's two ledger entries (`resource.name`
 *  `unchanged` on update, `dropped` on create) hold whether the split works,
 *  writes the wrong names or is deleted. (Only a `splitName` that empties
 *  BOTH parts moves one: the update then throws, which the arm reads as a
 *  refusal. Emptying both at the dispatcher's call site alone does not —
 *  `name` stays in the merged patch, so `sanitizeResource`'s both-empty
 *  fallback re-splits it and the rename lands.) On create the probe never
 *  even reaches it:
 *  `CREATE_BASE.resource` supplies both parts, and `sanitizeResource` splits
 *  `name` only when `firstName` and `lastName` are both empty. What the sweep
 *  DOES see is `name` starting to land under its own name: either arm then
 *  stops producing its kind and the ledger turns red. The split itself is
 *  pinned in `use-chat-dispatcher.test.tsx` — "createResource splits a full
 *  name when first/last aren't given" and "updateResource splits a `name` into
 *  first/last, the shape create already honoured" — and, preview and write
 *  together, by "mononym rename clears the surname" in
 *  `plan.write-path.test.ts`.
 *
 *  ★★★ BECAUSE NOTHING SUBTRACTS IT, RELATION B FIRES ON `resource.name`, AND
 *  THAT IS THE DECISION, not
 *  an oversight to repair: it is a declared field that cannot land under its own
 *  name, so a relation asserting "a declared field lands or is visibly refused"
 *  reports it. Do NOT add a skip, an allowlist entry or a
 *  `firstName`/`lastName` special case INSIDE the relations — they carry no
 *  exemptions at all, which is the property that makes this detector worth more
 *  than the sweep it sits beside. That is the only reason: it was never that
 *  the relations already cover the split. A split assertion belongs beside the
 *  dispatcher tests named above, not in the sweep. The finding is held in the
 *  sweep's `EXPECTED_FINDINGS`, citing this decision, not fixed in the code. */
export const SYNTHETIC_INPUTS: Partial<Record<InlineEntity, readonly string[]>> = {
  resource: ["name"],
};

/** The axis sizes measured on `origin/main` = 754e8129, 2026-09-08.
 *
 *  ★★ A RECORDED BASELINE, NOT A TARGET. A change here is legitimate whenever a
 *  schema or a CSV column list changes — but it must be a DECISION. The floor
 *  that reads this exists because every relation below iterates an axis, and an
 *  axis that silently collapsed makes them all pass.
 *
 *  ★★ `change` MOVED 16/4 -> 15/5 ON 2026-09-08, AND THAT IS A DECISION, NOT
 *  DRIFT. `decisionDate` was withdrawn from `changeFields` because it is
 *  DERIVED — `applyChangeStatus` owns the `status`/`decisionDate` pair for every
 *  TRANSITION in the app (the Outlook two-way pull writes the date alone, with no
 *  transition, so it does not own the FIELD) and the
 *  modal renders it read-only. It therefore LEFT the declared set and JOINED the
 *  undeclared one; the change's persisted column count did not move, which is
 *  why the two numbers trade one-for-one. Relation A now probes it on BOTH arms
 *  and asserts the model's value never lands.
 *  ★★★ THAT ASSERTION IS VACUOUS FOR THIS FIELD, AND THIS DOCSTRING USED TO
 *  CALL IT "a stronger guarantee than Relation B's finding". The trespass probe
 *  derived from a date seed is a non-date STRING (`trespassProbeFor` has no
 *  date branch), which `sanitizeIsoDate` rejects on its own — so the probe can
 *  never land, guard (`CHANGE_FIELD_GUARDS.decisionDate`) or no guard, and a
 *  green Relation A proves nothing about the guard. It is one instance of the
 *  general blind spot recorded at `trespassProbeFor` (§441). What still stands
 *  is the classification: the field is no longer offered, so Relation B no
 *  longer reports it as "offered and dropped". */
export const AXIS_BASELINE: Record<InlineEntity, { declared: number; undeclared: number }> = {
  task: { declared: 11, undeclared: 17 },
  raid: { declared: 16, undeclared: 6 },
  change: { declared: 15, undeclared: 5 },
  milestone: { declared: 5, undeclared: 3 },
  stakeholder: { declared: 8, undeclared: 4 },
  resource: { declared: 13, undeclared: 6 },
  absence: { declared: 7, undeclared: 2 },
  calendarEvent: { declared: 9, undeclared: 3 },
};

/** The minimum payload each `create_*` tool accepts, per entity.
 *
 *  ★★★ A CREATE THAT RETURNS NULL LEAVES NO ROW, AND EVERY REFUSAL ASSERTION
 *  OVER A MISSING ROW PASSES FOR THE WRONG REASON. That is why these are pinned
 *  by `create_*` schema `required` arrays below rather than trusted.
 *
 *  ★★ Seven of these were the `valid` member of each `CreateCase` in
 *  `plan.create-path-guards.test.ts` and now live here, with that file
 *  importing them back. Two detectors holding private ideas of "a valid create"
 *  is how they come to disagree about what was covered.
 *
 *  ★ `calendarEvent` carries a `recurrence` on purpose: `sanitizeCalendarEvent`
 *  stores `exceptions` only when a recurrence is present, so without it a probe
 *  aimed at `exceptions` cannot land and the assertion passes whatever the
 *  guard does. That reasoning is why this bag is not simply the `required`
 *  fields. */
export const CREATE_BASE: Record<InlineEntity, Record<string, unknown>> = {
  task: { taskName: "A task", assignee: "Ada Lovelace", dueDate: "2026-06-01" },
  raid: { title: "A risk" },
  change: { title: "A change" },
  milestone: { name: "A milestone", date: "2026-06-01" },
  stakeholder: { name: "Ada Lovelace" },
  resource: { firstName: "Grace", lastName: "Hopper" },
  absence: { assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" },
  calendarEvent: {
    title: "Weekly sync",
    startDate: "2026-06-01",
    startTime: "09:00",
    durationMinutes: 30,
    recurrence: { freq: "weekly", interval: 1 },
  },
};

/** Every field the `create_*` schema marks `required`, for the floor that pins
 *  `CREATE_BASE` against it. */
export function requiredForCreate(entity: InlineEntity): readonly string[] {
  const schema = toolDef(INLINE_DESCRIPTORS[entity].createTool).input_schema as { required?: readonly string[] };
  return [...(schema.required ?? [])].sort();
}
