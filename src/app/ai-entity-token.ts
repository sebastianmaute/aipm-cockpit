// src/app/ai-entity-token.ts
// Optimistic-concurrency tokens for the AI write path. Pure: no React, no DOM,
// no i18n.
//
// ★★★ THE TOKEN IS DERIVED, NOT STAMPED, AND THAT IS THE WHOLE POINT. The
// obvious alternative is `Task.localModifiedAt` ("used for sync conflict
// detection"), and it was rejected: a stamp is only as good as the set of
// writers that set it, and a write path that forgets to stamp leaves the field
// UNCHANGED after a human edit. The guard then compares two identical values,
// concludes nothing moved, and permits the very overwrite it exists to stop —
// a false PERMIT, the dangerous direction. Measured 2026-09-03 at 68 stamp
// sites across 27 non-test files against 45 `setTasks(` call sites across 17,
// for tasks alone, one of six AI-updatable entities. Deriving from the
// entity's own content makes any change by any writer visible by construction,
// including write paths added years from now.
//
// ★★ IT RIDES THE BYTE-STABLE CSV SERIALIZERS ON PURPOSE. `golden-workspace.test`
// pins their exact output, so a silent change to what they emit fails CI. That
// is the property this module borrows; do not reimplement the projection.
//
// ★ CONSEQUENCE: adding a column to any `*_CSV_COLUMNS` array invalidates every
// outstanding token for that entity at once, because the projection they were
// derived from changed. That is the SAFE direction — a stale token is refused,
// never silently accepted — but it will look like a burst of spurious conflicts
// right after such a change, so it is worth recognising rather than debugging.
import {
  CSV_COLUMNS, fieldToString,
  RAID_CSV_COLUMNS, raidFieldToString,
  MILESTONES_CSV_COLUMNS, milestoneFieldToString,
  CHANGES_CSV_COLUMNS, changeFieldToString,
  STAKEHOLDERS_CSV_COLUMNS, stakeholderFieldToString,
  RESOURCES_CSV_COLUMNS, resourceFieldToString,
} from "./csv-codecs-core";
import type {
  ChangeItem, Milestone, RaidItem, Resource, Stakeholder, Task,
} from "./types";
import { hash } from "./token-hash";

export type TokenEntity =
  | "task" | "raid" | "milestone" | "change" | "stakeholder" | "resource";

/** Columns deliberately OUTSIDE the token, per entity.
 *
 *  ★★★ A FIELD MAY BE EXCLUDED ONLY IF NO `update_*` TOOL LETS THE MODEL
 *  CHOOSE ITS VALUE. Excluding a field the model can set reintroduces a false
 *  permit for exactly that field — two writers could both change it with
 *  neither detected. This is not a convention to remember:
 *  `ai-entity-token.test.ts` asserts the exclusion set is disjoint from what
 *  those tools ACCEPT (driving the real dispatch path, not the advertised
 *  schema), so a tool that starts forwarding an excluded field turns it red.
 *
 *  ★★★ "LETS THE MODEL CHOOSE" IS THE LOAD-BEARING PHRASE, AND EVERY SHORTER
 *  WORDING OF THIS RULE HAS BEEN FALSE. "No `update_*` tool can WRITE an
 *  excluded field" is refuted by the handlers themselves: all five stamp
 *  `localModifiedAt: new Date().toISOString()` over the patch —
 *  `updateRaid`/`updateChange`/`updateMilestone`/`updateStakeholder` in
 *  `use-register-tools.ts`, `updateResource` in `use-chat-dispatcher.ts`. That
 *  is the app choosing the value, which is precisely what an exclusion is for.
 *
 *  ★★ TWO CLASSES OF WRITE SIT OUTSIDE THE RULE, AND NAMING ONLY ONE MAKES THE
 *  CARVE-OUT READ AS COMPLETE WHEN IT IS NOT.
 *    (1) The `update_*` handlers' own stamps, above.
 *    (2) OTHER tools that write an excluded field: `send_inquiry` bumps
 *        `inquiriesSent: (row.inquiriesSent ?? 0) + 1`, and
 *        `set_task_dependencies` stamps `localModifiedAt` — the second being
 *        neither an `update_*` tool nor `send_inquiry`, which is why an
 *        enumeration by tool NAME cannot be trusted here.
 *  In both classes the EXCLUDED FIELD's value is computed by the app, never
 *  supplied by the model, so the token is deliberately blind to that field:
 *  what is at stake is a counter or a timestamp, so a lost concurrent bump
 *  costs an off-by-one in a "chased N times" figure, not an overwritten field
 *  of content.
 *
 *  ★★★ THAT LAST SENTENCE IS ABOUT THE FIELD, NOT ABOUT THE TOOL, AND READING
 *  IT AS A CLEARANCE FOR `set_task_dependencies` IS EXACTLY THE MISTAKE THIS
 *  CARVE-OUT ONCE INVITED. The tool ALSO writes `dependencies`, which is IN
 *  `CSV_COLUMNS`, is NOT excluded here, and comes STRAIGHT FROM MODEL INPUT as
 *  a whole-list replace. For a whole release this comment named the tool,
 *  accounted only for its stamp, and so read as protection while the tool
 *  itself carried no `requireToken` at all — a comment that stops an audit
 *  without earning it. It is guarded now (`requireTaskWriteToken`,
 *  `chat-tools-updates.ts`); the carve-out below concerns the STAMP alone.
 *
 *  Each entry is bookkeeping that moves without anyone editing the substance
 *  the model is acting on:
 *    localModifiedAt  self-referential — including it makes this the stamp
 *                     approach the header rejects
 *    lastSyncedAt     Jira sync bookkeeping
 *    outlookEventId   calendar write-back bookkeeping
 *    inquiriesSent    a counter bumped by sending a status inquiry
 *    noteLog          a dated append; adding a note does not invalidate an
 *                     edit to other fields */
export const TOKEN_EXCLUDED: Readonly<Record<TokenEntity, readonly string[]>> = {
  task: ["localModifiedAt", "lastSyncedAt", "outlookEventId", "inquiriesSent", "noteLog"],
  raid: ["localModifiedAt", "outlookEventId", "inquiriesSent", "noteLog"],
  milestone: ["localModifiedAt", "outlookEventId"],
  change: ["localModifiedAt", "outlookEventId", "noteLog"],
  stakeholder: ["localModifiedAt"],
  resource: ["localModifiedAt"],
};

/** A column list and a renderer BOUND TO THE SAME ENTITY TYPE.
 *
 *  ★★★ THIS TYPE CLOSES ONE MISPAIRING AND TSC IS ITS ONLY DETECTOR. Swapping
 *  a RENDERER against its columns — `{columns: RAID_CSV_COLUMNS, render:
 *  fieldToString}` — is rejected here (TS2322, "Type 'RaidItem' is missing the
 *  following properties from type 'Task'"). Measured: with that mutant in
 *  place `tsc --noEmit` exits 2 and the unit suite is 35/35 GREEN. The tests
 *  cannot see it, so do not weaken this type on the assumption that they
 *  would.
 *
 *  ★★★ THE OTHER MISPAIRING IS NOT CLOSED HERE, AND `PROJECTORS` IS WHY. That
 *  table is `Record<TokenEntity, ErasedProjector>`, so nothing ties a KEY to
 *  its `T`: `task: projector<RaidItem>({columns: RAID_CSV_COLUMNS, render:
 *  raidFieldToString})` is internally consistent and COMPILES (measured, tsc
 *  exits 0). Its only detector is the per-kind cases in the test file, which
 *  catch it 2 failed / 33 passed. The two guards are complementary — each is
 *  blind to exactly what the other catches — so neither may be dropped as
 *  redundant.
 *
 *  ★★ DO NOT REPEAT THE MECHANISM THIS COMMENT USED TO CLAIM. It said a
 *  mispaired renderer sends unknown columns through a switch's `default:
 *  return ""`, collapsing raid to a near-constant token. NEITHER renderer has
 *  a switch: both are short `if` chains ending in generic property access
 *  (`String(t[c] ?? "")`), so a mispaired renderer reads the field anyway and
 *  mostly AGREES. Measured over a fully-populated item: swapping the two
 *  changes 3 of RAID_CSV_COLUMNS' 23 columns (the `|`-joined id lists
 *  linkedTaskIds/causedByRaidIds/stakeholderIds, which degrade to `,`-joined)
 *  and 1 of CSV_COLUMNS' 28 (`labels`, the same way). That makes the defect
 *  SUBTLER than the old comment implied, not milder: a token that still moves
 *  for most fields is harder to notice than one that never moves. */
type Projector<T> = {
  readonly columns: readonly (keyof T)[];
  readonly render: (entity: T, column: keyof T) => string;
};

/** The type-erased shape stored in the lookup table, which is heterogeneous
 *  and so cannot itself carry `T`. The one unavoidable cast lives HERE, behind
 *  `projector`'s generic signature, so every CALL SITE stays checked. */
type ErasedProjector = {
  readonly columns: readonly string[];
  readonly render: (entity: object, column: string) => string;
};

function projector<T>(p: Projector<T>): ErasedProjector {
  return p as unknown as ErasedProjector;
}

const PROJECTORS: Readonly<Record<TokenEntity, ErasedProjector>> = {
  task: projector<Task>({ columns: CSV_COLUMNS, render: fieldToString }),
  raid: projector<RaidItem>({ columns: RAID_CSV_COLUMNS, render: raidFieldToString }),
  milestone: projector<Milestone>({ columns: MILESTONES_CSV_COLUMNS, render: milestoneFieldToString }),
  change: projector<ChangeItem>({ columns: CHANGES_CSV_COLUMNS, render: changeFieldToString }),
  stakeholder: projector<Stakeholder>({ columns: STAKEHOLDERS_CSV_COLUMNS, render: stakeholderFieldToString }),
  resource: projector<Resource>({ columns: RESOURCES_CSV_COLUMNS, render: resourceFieldToString }),
};

/** ★★★ EVERY DECLARED FIELD OF EVERY TOKENED ENTITY MUST BE IN THAT ENTITY'S
 *  `*_CSV_COLUMNS`, AND TSC IS THE ONLY DETECTOR. This closes the hazard the
 *  exclusion-set rule above CANNOT see, because the two say different things: a
 *  field in `TOKEN_EXCLUDED` was deliberately left out, whereas a field that is
 *  simply ABSENT from the column list was never projected at all — the token is
 *  blind to it, and a model write to it is a false PERMIT of exactly the kind
 *  this module exists to stop. `ai-entity-token.test.ts` asserts DISJOINTNESS
 *  (writable ∩ excluded = ∅), which is satisfied either way, so before this
 *  guard a field added to `Task` and not to `CSV_COLUMNS` went untokened with
 *  the whole suite GREEN.
 *
 *  Verified 2026-09-03 by diffing the declared fields of all six types against
 *  their column lists: exact match, both membership and count (task 28, raid
 *  23, milestone 9, change 21, stakeholder 13, resource 19). The check below is
 *  what keeps it that way; the counts are a snapshot and will move, the
 *  property will not.
 *
 *  ★ A NEW FIELD MUST BE ADDED TO THE COLUMN LIST, NOT SILENCED HERE. That is
 *  the same edit AGENTS.md's "new COLUMN on existing entity" rule already
 *  requires (CSV + Turso single/tenant derive from these arrays), so this guard
 *  costs a correctly-written change nothing. If a field genuinely must not
 *  persist, it does not belong on the entity type.
 *
 *  ★★★ IT DEPENDS ON THE COLUMN ARRAYS BEING `as const`, AND RESTORING THEIR
 *  OLD `: Array<keyof T>` ANNOTATION SILENTLY MAKES THIS VACUOUS — which is how
 *  it was first written. Under that annotation `typeof CSV_COLUMNS[number]`
 *  collapses from the literal member union to `keyof Task` itself, so the
 *  `Exclude` below is `Exclude<keyof Task, keyof Task>` = `never`
 *  UNCONDITIONALLY and every row passes no matter what the array contains. Five
 *  of the six were annotated that way (only `RESOURCES_CSV_COLUMNS` was already
 *  `as const`), so five of these six rows proved nothing until
 *  `csv-codecs-core.ts` was changed to `as const satisfies readonly (keyof
 *  T)[]` — which keeps the members visible AND keeps the every-member-is-a-key
 *  constraint the annotation was there for. Do not "tidy" it back.
 *
 *  ★★ MUTATION-PROVED IN THE DIRECTION THAT MATTERS, which is ADDING a field to
 *  the entity type without a column — not deleting a column. Both trip the same
 *  `Exclude`, but only the ADD direction is what this guard is for, and only it
 *  is invisible to everything else: adding `zzMutantProbeField?: string` to
 *  `Task` gives `tsc` exit 2 with exactly one error, `TS2322` at the `task` row,
 *  expected type `["field(s) missing from the CSV column list:",
 *  "zzMutantProbeField"]` — the tuple exists so the diagnostic NAMES the
 *  unprojected field rather than just rejecting `true` — while
 *  `golden-workspace`, `csv-codecs` and this module's own tests stay GREEN
 *  (71 passed). The column list drives the serializers, so a field with no
 *  column changes no emitted byte and no fixture can see it.
 *  ★★★ DO NOT RESTATE THIS AS "tsc is the only detector" FOR THE DELETE
 *  DIRECTION — an earlier version of this comment proved the guard by deleting
 *  `"labels"` from `CSV_COLUMNS` and asserted "the unit suite is unaffected
 *  either way", which is FALSE and was never run: `labels` is column 16 of the
 *  byte-pinned TASKS header in `__fixtures__/golden-workspace.csv`, so that
 *  mutant is killed by `golden-workspace.test` as well. Removing a column is
 *  doubly covered; adding an unprojected field is covered here and nowhere
 *  else. Reproduce the fixture half with:
 *  `head -2 src/app/__fixtures__/golden-workspace.csv | tail -1 | tr ',' '\n' | grep -n labels` */
type Unprojected<T, C extends readonly string[]> = Exclude<keyof T & string, C[number]>;
type Projected<T, C extends readonly string[]> = Unprojected<T, C> extends never
  ? true
  : ["field(s) missing from the CSV column list:", Unprojected<T, C>];

/** ★★★ `Assert` IS WHAT MAKES THE ROWS BELOW BITE. Without it the type merely
 *  COMPUTES each row's `Projected<…>` and discards it — a type alias asserts
 *  nothing by existing, so an unprojected field would produce a tuple that
 *  nothing rejects. That inert form was written first and looked identical. The
 *  `extends true` constraint IS the guard: a tuple does not extend `true`, so
 *  the row fails to satisfy it and tsc reports the tuple, which names the field.
 *  ★★ The rows are spelled out with CONCRETE types rather than mapped over
 *  `TokenEntity`, deliberately: under a mapped type the check type is generic,
 *  tsc cannot resolve it per-key, and it reports one unresolvable constraint
 *  error for ALL rows instead of naming the offending field. Exhaustiveness is
 *  bought separately, below. */
type Assert<T extends true> = T;

type ProjectedRows = {
  task: Assert<Projected<Task, typeof CSV_COLUMNS>>;
  raid: Assert<Projected<RaidItem, typeof RAID_CSV_COLUMNS>>;
  milestone: Assert<Projected<Milestone, typeof MILESTONES_CSV_COLUMNS>>;
  change: Assert<Projected<ChangeItem, typeof CHANGES_CSV_COLUMNS>>;
  stakeholder: Assert<Projected<Stakeholder, typeof STAKEHOLDERS_CSV_COLUMNS>>;
  resource: Assert<Projected<Resource, typeof RESOURCES_CSV_COLUMNS>>;
};

/** Fails compilation unless every `TokenEntity`'s declared fields are all
 *  projected, AND every `TokenEntity` member has a row above.
 *
 *  ★★★ THE SECOND HALF IS NOT DECORATION — without it a SEVENTH tokened entity
 *  gets no row and nothing complains, which is the exact moment the check is
 *  most needed (a new entity's column list is what a copy-paste is most likely
 *  to get wrong). `TOKEN_EXCLUDED` and `PROJECTORS` are both
 *  `Record<TokenEntity, …>` and so force a new member; `ProjectedRows` is a
 *  plain literal and does not, so the key set is tied to the union here instead.
 *  ★ The `[…]` tuple wrapping is load-bearing: a bare `TokenEntity extends
 *  keyof ProjectedRows` DISTRIBUTES over the union and would report only that
 *  some member failed. Wrapped, it compares the union as a whole.
 *
 *  Exported only so both are used bindings — these are types, so they cost zero
 *  runtime bytes; nothing should import this. */
export type ProjectionCoverage = ProjectedRows & {
  everyTokenEntityHasARow: Assert<[TokenEntity] extends [keyof ProjectedRows] ? true : false>;
};

/** The concurrency token for one entity. Equal tokens mean no covered field
 *  changed; different tokens mean at least one did. */
export function entityToken(kind: TokenEntity, entity: object): string {
  const { columns, render } = PROJECTORS[kind];
  const excluded = new Set(TOKEN_EXCLUDED[kind]);
  const parts: string[] = [];
  for (const column of columns) {
    if (excluded.has(column)) continue;
    // ★★ COERCED, because the renderers' `: string` return type is NOT a
    // runtime guarantee for a sparse row. `resourceFieldToString` returns
    // `r.firstName` / `r.lastName` / `r.utilizationMode` with no `?? ""`
    // fallback -- correct for a well-formed `Resource`, where those are
    // non-optional, but `undefined` for a partial or legacy row. This guard
    // runs inside a tool dispatch on the write path, so it must degrade to a
    // conservative token rather than throw: a throw here fails the user's
    // write outright, which is strictly worse than comparing "".
    // ★★ THIS IS A DELIBERATE DIVERGENCE FROM THE HEADER'S "rides the
    // byte-stable serializers" CLAIM, which should not be read as byte-for-byte
    // agreement with the CSV. For a missing field the CSV path emits the string
    // "undefined" and the token emits "", so the token maps "missing" and
    // "empty" together where the CSV separates them. Both mean "no value" and
    // both are unreachable for a well-formed entity; where they differ, the
    // token merges two states rather than splitting one, which can only cost a
    // missed distinction between two equally-absent values — never a missed
    // real edit. Conservative in the safe direction.
    const value = String(render(entity, column) ?? "");
    // ★★ LENGTH-PREFIXED, and the length is what makes the concatenation
    // unambiguous. Naming the column is NOT sufficient on its own: with
    // `column + " " + value`, the adjacent CSV_COLUMNS pair taskName/assignee
    // maps {taskName:"x", assignee:"assignee y"} and {taskName:"xassignee ",
    // assignee:"y"} to the SAME bytes and so the same token (measured). Two
    // entities differing in a covered field would compare equal — a false
    // PERMIT. A rendered value cannot contain its own length, so prefixing it
    // makes the encoding injective.
    parts.push(column + ":" + value.length + ":" + value);
  }
  return hash(parts.join(""));
}
