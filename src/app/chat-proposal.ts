// src/app/chat-proposal.ts — the staging gate for a chat turn's tool calls.
//
// Pure and i18n-free. Decides whether a turn's tool calls apply immediately or
// stage for review.
//
// ★ Deliberately knows nothing about React, the workspace or the dispatcher.
//   Everything here is a function of the CALL LIST alone, which is what makes
//   the gate testable without a fixture workspace. The one import is TYPE-ONLY
//   (`MintKind`), so nothing is pulled in at runtime and that property holds.
import type { MintKind } from "./id-mint-session";

/** One tool call the model emitted. Structurally identical to the insights
 *  pipeline's `InsightToolCall` (`insights/insight.ts`); kept as its own name
 *  because chat proposals are not insight recommendations and merging the two
 *  types would couple the register's persisted shape to the chat transcript's. */
export interface ProposedCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Tools that remove data. Any one of these stages the whole turn, regardless of
 *  how many calls it made — a single `delete_all_tasks` is one call and is the
 *  most destructive thing the model can do.
 *
 *  ★★ `delete_document` belongs here even though a deleted document leaves a
 *   restorable version (`deleteDocument` returns `restorableVersionId`). The
 *   recovery path is the Documents tombstone list, not the undo stack, and
 *   nothing on the chat surface points at it — so from the chat user's seat the
 *   delete is as final as the other seven. */
const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  "delete_task", "delete_all_tasks", "delete_raid_item", "delete_change",
  "delete_milestone", "delete_stakeholder", "delete_resource",
  "delete_document",
]);

/** Tools that write PROJECT ENTITY data.
 *
 *  ★ `set_language`, `set_filters` and `update_settings` are deliberately ABSENT.
 *   They change device-local preferences, not project data — verified:
 *   `setLanguage` and `updateSettings` write through `args.setSettings` only
 *   (`use-chat-dispatcher.ts`), touching no workspace setter and no `Workspace`
 *   slice, and persist via `writeSettings` into localStorage; `set_filters`
 *   routes to `applyFilters`, which writes the pane's filter state. None of them
 *   is in the undo stack either, so staging them would offer a review of
 *   something the rest of the app treats as ephemeral.
 *
 *  ★★★ `send_inquiry` IS here, and it is the non-obvious member. It reads like a
 *   send-an-email action, but its dispatcher handler increments
 *   `Task.inquiriesSent` through `setTasks` — a persisted `Workspace.tasks`
 *   write, with NO undo capture. Two of them is a bulk outbound action over
 *   project data, which is exactly what this gate exists to put in front of the
 *   user. ★★ CONSEQUENCE FOR WHOEVER APPLIES A STAGED TURN: its handler also
 *   calls `window.open` on a `mailto:` URL, so the mail client opens WHEN THE
 *   CALL RUNS. A staged turn must therefore be applied by RE-INVOKING the call,
 *   never by replaying a data diff — a diff-replay would bump the counter and
 *   silently send nothing.
 *
 *  ★★ The three document writes are here even though document writes take no
 *   undo capture at all (`use-document-tools.ts` says so at three sites) and
 *   rely on `documentVersions` instead. That argues for MORE staging, not less:
 *   the single-write exemption below is justified by undo, and documents have
 *   none, so the only thing standing between the model and an unreviewed
 *   multi-document rewrite is this gate. */
const ENTITY_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_task", "update_task", "set_task_dependencies", "send_inquiry",
  "create_raid_item", "update_raid_item",
  "create_change", "update_change",
  "create_milestone", "update_milestone",
  "create_stakeholder", "update_stakeholder",
  "create_resource", "update_resource",
  "create_document", "update_document",
  ...DESTRUCTIVE_TOOLS,
]);

/** Input fields OTHER than `id` through which a call can name a row that a
 *  create EARLIER IN THE SAME TURN will mint, per tool.
 *
 *  ★★★ WITHOUT THIS, A PROVISIONAL LINK IS STORED DANGLING AND NOTHING SAYS SO.
 *   Take `[create_task, create_raid_item({ linkedTaskIds: [<the minted id>] })]`.
 *   Row 1 is itself a create, so the `id`-based lookup below is skipped for it
 *   and it gets no dependency at all — refusing row 0 therefore leaves row 1
 *   selected, and it applies carrying a link to a task that will never exist.
 *   `sanitizeIdList` does no referential check, so the link is simply written.
 *   ★★ `set_task_dependencies`' `dependencies[].taskId` is the same shape and is
 *   BELIEVED to be the milder half — that tool is documented to refuse a link to
 *   a task that does not exist and report it in `rejected`, which would make it
 *   loud rather than silent. READ THAT AS UNPROVED AT THE IMPLEMENTATION: the
 *   evidence is the tool's own schema prose plus the `rejected: DepRejection[]`
 *   contract in `chat-tools.ts`, and the existence check itself lives behind the
 *   host-supplied `setTaskDependencies`, which nobody has traced. Both fields
 *   are covered here either way; do not let the word "milder" become a reason to
 *   drop one.
 *
 *  ★★ `mintedBy` NAMES A CREATE TOOL, NOT AN ENTITY, and it is load-bearing.
 *   Ids are PER-ENTITY sequences, so two creates in one turn very often mint the
 *   SAME NUMBER — resolving `linkedTaskIds` against every mint would hang the
 *   link off whichever create minted that number LAST.
 *
 *  ★★ THE FIELD SET WAS ENUMERATED FROM `idList(`, NOT TYPED FROM A LIST, and
 *   that distinction cost a defect: a review named `linkedTaskIds` and the
 *   dependency `taskId` from a narrower grep, which finds five rows and TWO
 *   fields and misses `causedByRaidIds`, `linkedRaidIds` and `stakeholderIds` —
 *   the same silent-dangling-link class, one entity over. Re-derive with the
 *   command below before adding or removing a member; never edit this table
 *   against a list somebody wrote out.
 *  ★ The first FOUR constants below are the whole id-list surface of the tool
 *   schemas — `grep -n "idList(" src/app/chat-tool-defs.ts` returns seven rows
 *   naming four distinct fields, all inside `raidFields`, `changeFields` and
 *   `milestoneFields` (`taskFields`, `stakeholderFields` and `resourceFields`
 *   carry none). Each of those three groups is spread into BOTH its entity's
 *   create and update tool, which is why every one of them appears twice in the
 *   table. `DEPENDENCY_TASKS` is the fifth and a different SHAPE — an array of
 *   objects, declared inline in `set_task_dependencies`' own schema rather than
 *   through `idList` — which is what `LinkField.key` exists for. */
interface LinkField {
  readonly field: string;
  /** For an array of OBJECTS, the property holding the id. Absent when the field
   *  is a flat array of ids. */
  readonly key?: string;
  /** The create tool whose minted ids this field can name. */
  readonly mintedBy: string;
}
const LINKED_TASKS: LinkField = { field: "linkedTaskIds", mintedBy: "create_task" };
const LINKED_RAIDS: LinkField = { field: "linkedRaidIds", mintedBy: "create_raid_item" };
const CAUSING_RAIDS: LinkField = { field: "causedByRaidIds", mintedBy: "create_raid_item" };
const LINKED_STAKEHOLDERS: LinkField = { field: "stakeholderIds", mintedBy: "create_stakeholder" };
const DEPENDENCY_TASKS: LinkField = { field: "dependencies", key: "taskId", mintedBy: "create_task" };

const LINK_FIELDS: Readonly<Record<string, readonly LinkField[]>> = {
  create_raid_item: [LINKED_TASKS, CAUSING_RAIDS, LINKED_STAKEHOLDERS],
  update_raid_item: [LINKED_TASKS, CAUSING_RAIDS, LINKED_STAKEHOLDERS],
  create_change: [LINKED_TASKS, LINKED_RAIDS, LINKED_STAKEHOLDERS],
  update_change: [LINKED_TASKS, LINKED_RAIDS, LINKED_STAKEHOLDERS],
  create_milestone: [LINKED_TASKS],
  update_milestone: [LINKED_TASKS],
  set_task_dependencies: [DEPENDENCY_TASKS],
};

/** The other half of the same mechanism: a tool whose OWN `input.id` addresses a
 *  row → the create tool that mints that id space. Read this table together with
 *  `LINK_FIELDS`; a new tool is one line in whichever of the two applies.
 *
 *  ★★★ WITHOUT THE SCOPING THIS PRODUCES A WRONG EDGE, WHICH IS WORSE THAN THE
 *   MISSING ONE `LINK_FIELDS` FIXES. The lookup used to be a single
 *   `Map<number, number>` keyed by the minted NUMBER alone. Ids are per-entity
 *   sequences, so two creates in one turn minting the same number is the COMMON
 *   case, not the exotic one — and the later create simply overwrote the key.
 *   `[create_task, create_raid_item, update_task({ id: N })]` with both minting
 *   N therefore pointed the update at the RAID create. A MISSING edge fails safe
 *   (a row does not cascade and the user sees it unchanged); a WRONG edge
 *   cascades the user's rejection onto an unrelated row, or marks the wrong row
 *   pending on the review card. Both fixture orders matter when testing this:
 *   with the creates the other way round the number-blind lookup is
 *   ACCIDENTALLY RIGHT, so such a fixture cannot express the defect at all.
 *
 *  ★★ THE THREE READS ARE DELIBERATE MEMBERS. `get_task`/`get_resource`/
 *   `get_document` address a row by id just as an update does, and a read of a
 *   row that will never be created is exactly as dead as a write to it. They are
 *   not entity writes, so they never affect `shouldStage`; they only cascade.
 *
 *  ★ EXPORTED FOR ITS DRIFT TEST, not as a tool allow-list — the same reason
 *   `insights/recommend-tokens.ts` exports `UPDATE_TARGET`. Omitting a tool here
 *   is SILENT: it simply never links, which is the "dependent linked to nothing"
 *   failure the cascade exists to prevent. `chat-proposal.test.ts` derives every
 *   tool declaring an `id` property from the live `TOOL_DEFS` and compares the
 *   set, so a new id-taking tool goes red until somebody classifies it. */
export const TARGET_MINTED_BY: Readonly<Record<string, string>> = {
  update_task: "create_task",
  delete_task: "create_task",
  set_task_dependencies: "create_task",
  send_inquiry: "create_task",
  get_task: "create_task",
  update_raid_item: "create_raid_item",
  delete_raid_item: "create_raid_item",
  update_change: "create_change",
  delete_change: "create_change",
  update_milestone: "create_milestone",
  delete_milestone: "create_milestone",
  update_stakeholder: "create_stakeholder",
  delete_stakeholder: "create_stakeholder",
  update_resource: "create_resource",
  delete_resource: "create_resource",
  get_resource: "create_resource",
  update_document: "create_document",
  delete_document: "create_document",
  get_document: "create_document",
};

/** The THIRD table of the same family: a create tool → the `id-mint-session`
 *  kind whose sequence its row is minted from. It exists so the STAGING caller
 *  can reserve one provisional id per create without re-deriving "which entity
 *  is `create_raid_item`?" — the derivation that, done twice, is how the two
 *  sides of this mechanism drift.
 *
 *  ★★ AN OMISSION IS SILENT IN THE SAME WAY `TARGET_MINTED_BY`'S IS, and one
 *   step worse: a create with no kind here cannot be minted for at all, so the
 *   caller either throws or skips the row, and a skipped mint makes
 *   `buildPlanRows` throw its `RangeError` on a plan the user never saw. The
 *   drift test in `chat-proposal.test.ts` derives the expected KEY SET from the
 *   live `TOOL_DEFS` (every tool `isCreateTool` accepts), so a new `create_*`
 *   tool goes red until somebody classifies it.
 *
 *  ★★★ MEMBERSHIP IS NOT ENOUGH — A WRONG KIND IS A WRONG SEQUENCE, and that is
 *   the failure `TARGET_MINTED_BY`'s own drift test cannot see for its table.
 *   Six of the seven VALUES here are therefore pinned per row against an
 *   INDEPENDENT source: `INLINE_DESCRIPTORS` already states each entity's
 *   `createTool` beside its `entity`, and the six `InlineEntity` spellings are
 *   exactly the six `MintKind` spellings the live minters use. `create_document`
 *   has no descriptor and is pinned against a literal alone — read that as the
 *   one unguarded row, not as covered. Re-derive the live minters with
 *   `grep -rn 'mintId("' src/app --include=*.ts --include=*.tsx`. */
export const CREATE_MINT_KIND: Readonly<Record<string, MintKind>> = {
  create_task: "task",
  create_raid_item: "raid",
  create_change: "change",
  create_milestone: "milestone",
  create_stakeholder: "stakeholder",
  create_resource: "resource",
  create_document: "document",
};

/** ★★ NAME-ONLY, AND THEREFORE NOT THE GATE'S OWN PREDICATE — `shouldStage`
 *   calls `isDestructiveCall`, which adds the one case a name cannot answer.
 *   Kept exported because the classification tests partition the LIVE tool
 *   surface by name, and because a name is all a card has to label a row with. */
export function isDestructiveTool(name: string): boolean {
  return DESTRUCTIVE_TOOLS.has(name);
}

export function isEntityWriteTool(name: string): boolean {
  return ENTITY_WRITE_TOOLS.has(name);
}

/** `update_document` ops that discard blocks the model never had to read.
 *
 *  ★★★ `replaceAll` IS THE ONLY OP REQUIRING NO `expectHash`, which is the whole
 *   reason it is singled out. `chat-tool-defs-documents.ts` names replace,
 *   delete and move as the ops whose `expectHash` is REQUIRED, and its own prose
 *   tells the model that replaceAll "discards every block you do not resend". So
 *   `update_document({ ops: [{ op: "replaceAll", blocks: [] }] })` empties a
 *   document while its NAME scores as one ordinary entity write.
 *
 *  ★★ KNOWN REMAINING GAP, DELIBERATELY NOT CLOSED HERE: a sweep of
 *   `{ op: "delete", index, expectHash }` ops in ONE call can empty a document
 *   too, and stays unstaged. The line drawn is EVIDENCE, not effect — a `delete`
 *   op's `expectHash` can only have come from a `get_document` read of that
 *   exact block, so the model demonstrably saw what it is removing, while
 *   `replaceAll` requires nothing and discards blocks it may never have read.
 *   Widening this to an op COUNT would stage a routine multi-block cleanup, at
 *   the cost described on `isDestructiveCall`. */
const DESTRUCTIVE_DOC_OPS: ReadonlySet<string> = new Set(["replaceAll"]);

/** True when this CALL removes data: the name-based set, plus the one case a
 *  name cannot answer.
 *
 *  ★★ `update_document` IS NOT IN `DESTRUCTIVE_TOOLS` ON PURPOSE. Putting it
 *   there would stage every benign single-block edit on the surface the
 *   assistant is expected to write to repeatedly, and a card the user clears
 *   reflexively is a card that stops being read — which degrades the gate for
 *   the deletes it exists for. The PAYLOAD is what separates the two.
 *
 *  ★ Malformed input must never throw: `ops` may be absent, a non-array, or hold
 *   non-objects, and all of it is model output. Anything unrecognised reads as
 *   NOT destructive — such a call still counts as an entity write, so it is not
 *   waved through, merely not escalated on its own. */
export function isDestructiveCall(call: ProposedCall): boolean {
  if (DESTRUCTIVE_TOOLS.has(call.name)) return true;
  if (call.name !== "update_document") return false;
  const ops = (call.input as { ops?: unknown }).ops;
  if (!Array.isArray(ops)) return false;
  return ops.some((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const op = (entry as { op?: unknown }).op;
    return typeof op === "string" && DESTRUCTIVE_DOC_OPS.has(op);
  });
}

/** True when this turn must be reviewed before anything is written: it removes
 *  something, or it writes more than one row.
 *
 *  ★★ THE SINGLE-WRITE EXEMPTION IS NOT UNIVERSALLY BACKED BY UNDO, and the
 *   wording here used to say it was ("relies on undo"). TWO live exceptions: the
 *   three document writes take no undo capture at all and rely on
 *   `documentVersions` instead (recorded on `ENTITY_WRITE_TOOLS` above); and
 *   `send_inquiry` has NEITHER — its handler in `use-chat-dispatcher.ts` calls
 *   `setTasks` and then `logActivityAs` with no `captureComposite` and no
 *   version history, so its `Task.inquiriesSent` increment is reversible by
 *   nothing in the app. It stays exempt as a SINGLE call deliberately: one
 *   inquiry is the user's own routine action, and two already stage as a bulk
 *   outbound. Reclassifying it is a product decision, not a correction to make
 *   while fixing a comment. */
export function shouldStage(calls: readonly ProposedCall[]): boolean {
  let writes = 0;
  for (const c of calls) {
    if (isDestructiveCall(c)) return true;
    if (isEntityWriteTool(c.name)) writes += 1;
  }
  return writes > 1;
}

/** True for a tool that MINTS a row rather than addressing an existing one.
 *
 *  ★ The prefix IS the whole rule — verified against the live `TOOL_DEFS`: all
 *   seven `create_*` tools are entity writes, and nothing else in the 45 is
 *   named `create_*`. `chat-proposal.test.ts` partitions the live array against
 *   a literal list of the seven, so a new `create_*` tool goes red there.
 *
 *  ★★ Exported because `buildPlanRows` consumes exactly one minted id per create
 *   and the CALLER has to mint that many. A caller re-deriving "is this a
 *   create?" independently is how the two sides drift; when they do drift, the
 *   symptom is a dependent silently linked to nothing — the very failure the
 *   cascade exists to prevent. Same predicate, one definition. */
export function isCreateTool(name: string): boolean {
  return name.startsWith("create_");
}

/** One row of a staged plan. `index` is its position in the emitted call list and
 *  is the row's stable identity — nothing here is keyed by array position after
 *  a filter, because a filtered index would shift under a deselect. */
export interface PlanRow {
  readonly index: number;
  readonly call: ProposedCall;
  /** Set on a staged create: the id minted for the row it will create. */
  readonly mintedId?: number;
  /** Index of the row whose `mintedId` this call's own `id` refers to — i.e. the
   *  row that will mint this call's TARGET. */
  readonly dependsOn?: number;
  /** EVERY staged row this call names: `dependsOn`, plus any row named through a
   *  LINK field. Ascending, deduplicated, and present only when non-empty.
   *
   *  ★ ASCENDING AND DEDUPLICATED ARE GUARANTEED, not incidental — a caller may
   *   rely on both. They are PINNED by a test whose fixture names one create
   *   twice and out of order, so dropping either the sort or the `Set` goes red;
   *   an unstated ordering property is one somebody depends on anyway.
   *
   *  ★★ SEPARATE FROM `dependsOn` BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS,
   *   and collapsing them would break a perfectly describable row. `dependsOn`
   *   means "my target does not exist yet", which is what `describeProposal`
   *   reads to tell a PENDING row from a genuine unknown id. A create that
   *   merely LINKS to another create has a real target of its own and grounds
   *   normally — folding its link into `dependsOn` would make the review card
   *   report that create as ungroundable.
   *  ★ `cascadeDeselect` walks THIS one: a link is just as dangling as a missing
   *   target once the row that would mint it is refused. */
  readonly dependsOnAll?: readonly number[];
}

/** Every staged row `call` names through a LINK field, resolved against the
 *  creates seen SO FAR (`mints`, keyed create-tool → minted id → row index).
 *
 *  ★ The finite-and-positive filter mirrors `sanitizeIdList`, the function that
 *   actually stores these lists, so the graph links exactly where the write
 *   would land — and a `null`/`""`/`[]` entry, which bare `Number()` turns into
 *   0, does not become a lookup for id 0.
 *  ★★ It does NOT mirror that function's delimited-STRING form (`"1;2"`), which
 *   `sanitizeIdList` also accepts. The tool schema advertises an array of
 *   numbers, so a string list is off-schema model output; reading it here would
 *   make this the one place in the module that guesses at a shape the model was
 *   never told to emit. A model sending one anyway would have its link stored
 *   and NOT cascaded — a recorded gap, not a covered case. */
function linkedRows(
  call: ProposedCall,
  mints: ReadonlyMap<string, ReadonlyMap<number, number>>,
): readonly number[] {
  const out: number[] = [];
  forEachLinkRef(call, (spec, id) => {
    const row = mints.get(spec.mintedBy)?.get(id);
    if (row !== undefined) out.push(row);
    return undefined;
  });
  return out;
}

/** The id a call names through its OWN `input.id`, read exactly as
 *  `chat-tools.ts` reads it at apply time (`Number(input.id)`, seven sites) —
 *  including a STRING id, which would reach the same row. `undefined` when the
 *  value is not a finite number.
 *
 *  ★ Extracted rather than inlined twice: `buildPlanRows` and
 *   `remapStagedCall` MUST resolve the same id from the same call, and two
 *   copies of `Number(...)` + a finiteness test is exactly the shape that drifts
 *   into "the graph linked here, the rewrite landed there". */
function targetIdOf(call: ProposedCall): number | undefined {
  const id = Number((call.input as { id?: unknown }).id);
  return Number.isFinite(id) ? id : undefined;
}

/** Walk every id `call` names through a LINK field, in field-then-entry order,
 *  handing each to `visit`. A `visit` returning a number REPLACES that id;
 *  returning `undefined` leaves the entry untouched. Returns the rewritten
 *  input, or `undefined` when nothing was replaced.
 *
 *  ★★ ONE WALK, THREE CALLERS. `linkedRows` (the dependency graph),
 *   `remapStagedCall` (the rewrite) and `namesPendingMint` (the refusal) must
 *   agree on WHICH values in a call are provisional ids; a second walk written
 *   to match this one is how a link gets graphed but not rewritten.
 *  ★ The finite-and-positive filter mirrors `sanitizeIdList`, the function that
 *   actually stores these lists, so the graph links — and the rewrite lands —
 *   exactly where the write would; a `null`/`""`/`[]` entry, which bare
 *   `Number()` turns into 0, does not become a lookup for id 0.
 *  ★★ It does NOT mirror that function's delimited-STRING form (`"1;2"`), which
 *   `sanitizeIdList` also accepts. The tool schema advertises an array of
 *   numbers, so a string list is off-schema model output; reading it here would
 *   make this the one place in the module that guesses at a shape the model was
 *   never told to emit. A model sending one anyway would have its link stored
 *   and NOT cascaded — a recorded gap, not a covered case. */
function forEachLinkRef(
  call: ProposedCall,
  visit: (spec: LinkField, id: number) => number | undefined,
): Record<string, unknown> | undefined {
  const specs = LINK_FIELDS[call.name];
  if (specs === undefined) return undefined;
  let patch: Record<string, unknown> | undefined;
  for (const spec of specs) {
    const raw = (call.input as Record<string, unknown>)[spec.field];
    if (!Array.isArray(raw)) continue;
    let changed = false;
    const next = raw.map((entry) => {
      const value =
        spec.key === undefined
          ? entry
          : entry !== null && typeof entry === "object"
            ? (entry as Record<string, unknown>)[spec.key]
            : undefined;
      const id = Number(value);
      if (!Number.isFinite(id) || id <= 0) return entry;
      const replacement = visit(spec, id);
      if (replacement === undefined) return entry;
      changed = true;
      // A NEW entry every time — the caller's `input` is never mutated, which
      // matters because the same staged call may be described, rendered and
      // replayed from one object.
      return spec.key === undefined
        ? replacement
        : { ...(entry as Record<string, unknown>), [spec.key]: replacement };
    });
    if (!changed) continue;
    patch = { ...(patch ?? {}), [spec.field]: next };
  }
  return patch;
}

/** Pair each call with its provisional id and its dependency.
 *  `mintedIds` supplies one id per CREATE call, in emission order.
 *
 *  ★★ THROWS when `mintedIds` is shorter than the plan's create count, rather
 *   than leaving a row without a `mintedId`. A create with no id resolves no
 *   dependents, so rejecting it would silently NOT cascade — a review card that
 *   looks correct and applies a call pointing at a row that will never exist.
 *   The caller mints from the same `isCreateTool` predicate, so the throw is an
 *   assertion on our own wiring, not a response to model output: it is
 *   unreachable while the two sides agree, and loud the moment they do not.
 *   A LONGER array is deliberately accepted — the surplus is unused and the
 *   pairing of the first N is unaffected.
 *
 *  ★ `Number(input.id)` mirrors `chat-tools.ts`, which addresses every row that
 *   way at apply time (`const id = Number(input.id)`, seven sites). The graph
 *   therefore links exactly where the dispatcher would write — including a
 *   string id, which would reach the created row.
 *
 *  ★★★ BOTH HALVES ARE ENTITY-SCOPED, and a tool in NEITHER table gets no edge
 *   at all. `TARGET_MINTED_BY` covers the `input.id` half, `LINK_FIELDS` the
 *   link half, and neither resolves a bare number against every mint — the
 *   wrong-edge failure recorded on `TARGET_MINTED_BY`. Because an omission from
 *   either table is SILENT, adding an id-taking tool means reading that table's
 *   drift-test note first. */
export function buildPlanRows(
  calls: readonly ProposedCall[],
  mintedIds: readonly number[],
): readonly PlanRow[] {
  // create tool → (minted id → row index). The ONE id map, and it is
  // entity-scoped: see TARGET_MINTED_BY for what a number-keyed one cost.
  const mints = new Map<string, Map<number, number>>();
  const rows: PlanRow[] = [];
  let mintCursor = 0;

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const isCreate = isCreateTool(call.name);

    let mintedId: number | undefined;
    if (isCreate) {
      if (mintCursor >= mintedIds.length) {
        throw new RangeError(
          `buildPlanRows: ran out of minted ids at call ${index} ("${call.name}") — ` +
            `${mintedIds.length} supplied, one is needed per create`,
        );
      }
      mintedId = mintedIds[mintCursor];
      mintCursor += 1;
      let byTool = mints.get(call.name);
      if (byTool === undefined) {
        byTool = new Map<number, number>();
        mints.set(call.name, byTool);
      }
      byTool.set(mintedId, index);
    }

    // A create cannot depend on its own id, so the lookup happens only for
    // non-creates. Ordering matters: `mints` is populated as we walk, so a
    // forward reference (a call naming an id minted LATER) resolves to
    // undefined rather than to the wrong row. That also makes every `dependsOn`
    // point STRICTLY BACKWARD, which is what keeps the cascade below acyclic.
    // ★ The id is resolved ONLY against the create tool that mints this tool's
    //   own id space — a bare number is ambiguous across entities.
    const targetSpace = isCreate ? undefined : TARGET_MINTED_BY[call.name];
    let dependsOn: number | undefined;
    if (targetSpace !== undefined) {
      const referenced = targetIdOf(call);
      if (referenced !== undefined) dependsOn = mints.get(targetSpace)?.get(referenced);
    }

    // Link edges are read from the SAME partially-built maps, so they point
    // strictly backward too and the graph stays acyclic. A create IS included
    // here — its own id cannot depend on anything, but the rows it LINKS to can
    // already have been minted.
    const all = new Set<number>();
    if (dependsOn !== undefined) all.add(dependsOn);
    // This row's own mint is already in `mints`, so a call naming the very
    // number it just minted (a `create_raid_item` listing its own id under
    // `causedByRaidIds`) would otherwise depend on ITSELF — a self-edge the
    // cascade cannot express. Dropped rather than reasoned away as impossible.
    for (const row of linkedRows(call, mints)) if (row !== index) all.add(row);
    const dependsOnAll = all.size > 0 ? [...all].sort((a, b) => a - b) : undefined;

    rows.push({ index, call, mintedId, dependsOn, dependsOnAll });
  }
  return rows;
}

/** Deselect `index` and, transitively, every row that depends on it. Pure —
 *  returns a new set and never mutates the one passed in.
 *
 *  ★★ The `next.delete(cur)` result GATES THE WALK, and that is BEHAVIOUR, not
 *   an optimisation — measured by mutation, not reasoned. Dropping the guard
 *   (`next.delete(cur) || true`) turns "deselecting a row already deselected
 *   leaves the rest alone" red: the walk runs on through that row's dependents
 *   and deselects them too. The walk therefore STOPS at the first row that was
 *   not selected. Both readings are defensible once the input state is already
 *   inconsistent (a selected row whose dependency is not selected) — which this
 *   function alone cannot produce — so a test pins the one we chose.
 *  ★ The guard also BOUNDS the walk on a HAND-BUILT `rows` array. Every edge in
 *   a `buildPlanRows` graph — `dependsOn` and `dependsOnAll` alike — points
 *   strictly backward, so no cycle is constructible there; a caller assembling
 *   rows by hand could write a two-row cycle that would otherwise re-enqueue
 *   forever. */
export function cascadeDeselect(
  rows: readonly PlanRow[],
  selected: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(selected);
  const drop: number[] = [index];

  let cur = drop.pop();
  while (cur !== undefined) {
    if (next.delete(cur)) {
      // ★ BOTH are checked, and neither is redundant. A `buildPlanRows` row's
      //   `dependsOn` is always inside its `dependsOnAll`, so the first test is
      //   dead weight there — but a HAND-BUILT row (the case the guard note
      //   below is about) may set `dependsOn` alone, and dropping the first test
      //   would silently stop cascading for it.
      for (const row of rows) {
        if (row.dependsOn === cur || row.dependsOnAll?.includes(cur)) drop.push(row.index);
      }
    }
    cur = drop.pop();
  }
  return next;
}

/** Rewrite every PROVISIONAL id in one staged call to the REAL id its create
 *  actually minted. `real` is create tool → (provisional id → real id).
 *
 *  ★★★ WITHOUT IT A STAGED PLAN'S SECOND ROW WRITES TO THE WRONG PLACE, OR TO
 *   NOWHERE. `applyProposal` re-invokes each row through `runTool`, so a create
 *   lands under whatever the real minter hands out — never the number
 *   `buildPlanRows` paired it with. `[create_task (#42), update_task({id: 42})]`
 *   therefore updated #42, which is either a stranger's row or no row at all.
 *   The dependency graph the review card cascades over was already correct; only
 *   the apply side was not reading it.
 *
 *  ★★ BOTH HALVES, ENTITY-SCOPED, EXACTLY AS `buildPlanRows` RESOLVES THEM: the
 *   `input.id` half through `TARGET_MINTED_BY`, every LINK field through
 *   `LINK_FIELDS` (including the `key`-bearing `dependencies[].taskId`, whose id
 *   sits inside an OBJECT). A number-blind rewrite would be the wrong-edge
 *   failure `TARGET_MINTED_BY` records, one layer later and now writing data:
 *   two creates in one plan minting the same number is the COMMON case.
 *
 *  ★ CREATES SKIP THE `input.id` HALF, mirroring `buildPlanRows` — a create's
 *   own id cannot refer to an earlier mint. No `create_*` tool is a key of
 *   `TARGET_MINTED_BY` today, so the guard is currently moot; it is here so the
 *   two sides cannot disagree if that table ever grows one.
 *
 *  ★★ IMMUTABLE, AND IT RETURNS THE SAME REFERENCE WHEN NOTHING CHANGED. The
 *   passed call and its `input` are never mutated (a staged call is described,
 *   rendered and replayed from ONE object); a call with no provisional id to
 *   rewrite comes back BY REFERENCE, so a caller may compare with `===` to ask
 *   "was anything remapped?". */
export function remapStagedCall(
  call: ProposedCall,
  real: ReadonlyMap<string, ReadonlyMap<number, number>>,
): ProposedCall {
  let patch: Record<string, unknown> | undefined;

  const targetSpace = isCreateTool(call.name) ? undefined : TARGET_MINTED_BY[call.name];
  if (targetSpace !== undefined) {
    const provisional = targetIdOf(call);
    const mapped = provisional === undefined ? undefined : real.get(targetSpace)?.get(provisional);
    if (mapped !== undefined) patch = { id: mapped };
  }

  const links = forEachLinkRef(call, (spec, id) => real.get(spec.mintedBy)?.get(id));
  if (links !== undefined) patch = { ...(patch ?? {}), ...links };

  if (patch === undefined) return call;
  return { name: call.name, input: { ...call.input, ...patch } };
}

/** True when `call` still names a provisional id whose create has NOT resolved
 *  to a real one. `pending` is create tool → the provisional ids still owed.
 *
 *  ★★★ IT IS THE APPLY-TIME COUNTERPART OF `cascadeDeselect`, AND A DIFFERENT
 *   CASE. The cascade handles a row the user REFUSED at review time. This
 *   handles a create that was selected and then did not produce a usable id —
 *   it threw, or its result carried none. Replaying its dependents anyway means
 *   writing to whatever row happens to hold the PROVISIONAL number: either
 *   nothing (a loud not-found) or a live row that has nothing to do with the
 *   plan (a silent write to a stranger). Refusing the dependent is the only
 *   outcome that is neither.
 *
 *  ★ Same walk as `remapStagedCall`, so the set of values it inspects cannot
 *   drift from the set that gets rewritten — a value the rewrite would have
 *   touched is exactly a value that must block when unresolved. */
export function namesPendingMint(
  call: ProposedCall,
  pending: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  let hit = false;
  const targetSpace = isCreateTool(call.name) ? undefined : TARGET_MINTED_BY[call.name];
  if (targetSpace !== undefined) {
    const provisional = targetIdOf(call);
    if (provisional !== undefined && pending.get(targetSpace)?.has(provisional) === true) {
      hit = true;
    }
  }
  // The visitor always returns `undefined`, so this walk rewrites nothing — it
  // is a probe over the same references the rewrite would touch.
  forEachLinkRef(call, (spec, id) => {
    if (pending.get(spec.mintedBy)?.has(id) === true) hit = true;
    return undefined;
  });
  return hit;
}
