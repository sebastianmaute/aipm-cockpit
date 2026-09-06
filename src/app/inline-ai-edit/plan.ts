// src/app/inline-ai-edit/plan.ts
//
// Pure, i18n-free. Translate model tool-use blocks into a previewable EditPlan
// for the inline "Ask Claude" editor, for any entity. No React, no i18n, no
// side effects.
import { type Task } from "../types";
import { type Workspace } from "../workspace";
import { isValidEmail, sanitizeIsoDate, toNumber } from "../sanitize";
import { descriptionText } from "../rich-text-projection";
import { INLINE_DESCRIPTORS, validSetFor, defaultEnumFor, type EntityDescriptor, type InlineEntity } from "./entity-descriptor";
import { splitName } from "../resource-foundation";
import { resolveLinkTitles } from "./link-titles";
import { str } from "./str";

export type ToolUseLike = { type: string; id?: string; name?: string; input?: unknown };

/** `after` is PROJECTED for display; `raw` is the verbatim value that was
 *  accepted, present only on an explicit model-supplied diff.
 *
 *  ★★ The two must not be conflated. A rich field's preview is plain text while
 *  the value the confirm path replays is HTML — projecting the applied value
 *  would write plain text over the user's formatting. `raw` exists so that
 *  invariant is observable; without it, it rested on a comment and a mutation
 *  test proved nothing in the suite caught its removal.
 *
 *  ★ A sanitizer-INDUCED enum reset carries no `raw`: its `after` is a default
 *  enum value that was never projected in the first place. */
export interface FieldDiff { field: string; before: string; after: string; raw?: string }
export interface NewItem { entity: string; title: string; toolName: string; input: Record<string, unknown> }
export interface Deletion { entity: string; label: string; toolName: string; id: number }
export interface Rejected { toolName: string; reason: "unknown-id" | "bad-input" | "unsupported"; detail: string }
/** A relationship or FK change, rendered from RESOLVED TITLES rather than ids.
 *
 *  ★★★ THIS IS NOT A `FieldDiff` AND MUST NEVER BE PUT IN `plan.updates`.
 *   `use-inline-entity-edit.ts` rebuilds its write patch from `updates` with
 *   `patch[diff.field] = coerce(d, diff.field, diff.raw ?? diff.after)`. A link
 *   diff there would write the TITLE STRING into `linkedTaskIds`, and
 *   `sanitizeIdList` splits a string on `[.;]`, finds no integers and stores
 *   `[]` — wiping every link the row had.
 *
 *  ★★ WHAT THE TYPE SYSTEM DOES AND DOES NOT CATCH — measured with tsc, and
 *   THREE earlier wordings of this paragraph were wrong. The first claimed the
 *   wipe was "unreachable by construction"; the second over-swung to "the type
 *   system does not enforce this"; the third said the two types were MUTUALLY
 *   assignable. None is right, because it depends on the SHAPE and the
 *   DIRECTION of the mistake:
 *
 *   - Pushing an already-typed `LinkDiff` into `updates` COMPILES — `raw` is
 *     optional, so a `LinkDiff` satisfies `FieldDiff`. A merge site copying
 *     `links` into `updates` is this shape, and nothing stops it.
 *   - The REVERSE does not: `plan.links.push(someFieldDiff)` is `TS2345`,
 *     because `rawIds` is required. Measured with a standalone `--strict`
 *     probe carrying a deliberate control error, so the run could not be
 *     vacuous. The two types are ONE-directionally assignable, and stating it
 *     as symmetric overstated the exposure in the safe direction while leaving
 *     the real one sounding equally hypothetical.
 *   - Building a link diff INLINE into `updates` does NOT compile. Excess
 *     property checking on a fresh object literal rejects `rawIds` against
 *     `FieldDiff` — `TS2353`. Mutating the populator below from
 *     `plan.links.push({…rawIds})` to `plan.updates.push({…rawIds})` gives
 *     `tsc` exit 2 AND reddens 10 tests across two files. That mutation is the
 *     realistic defect, and it is caught twice.
 *
 *   So the compiler covers the inline shape and the CALL GRAPH plus the tests
 *   cover the aliased one: the populator writes only to `links`, the rebuild
 *   loop reads only `updates`. The separate array is still the right design —
 *   a marker flag on `FieldDiff` would leave the rebuild loop having to
 *   remember to check it. See the characterization test in
 *   `use-inline-entity-edit.test.tsx`.
 *
 *  ★★ `before`/`after` are RESOLVED TITLES for the human; `rawIds` is what the
 *   writer stores. They are separate members precisely because they must never
 *   be confused: the rebuild path applies `rawIds`, the card renders the
 *   titles. `rawIds` is already sanitized by THAT FIELD'S OWN writer rule
 *   (`sanitizeIdList` for raid/change, `sanitizeMilestoneTaskIds` for
 *   milestone — they differ on dedupe and on delimited strings), so what the
 *   preview shows and what the patch carries come from one computation. */
export interface LinkDiff { field: string; before: string; after: string; rawIds: number[] }
export interface EditPlan { updates: FieldDiff[]; creates: NewItem[]; deletes: Deletion[]; rejected: Rejected[]; links: LinkDiff[] }

// Any create_*/delete_* tool → its entity + workspace list key. Shared across
// entities (an inline edit on any row may create/delete related items).
const CREATE_TOOLS: Record<string, string> = {
  create_raid_item: "raid", create_change: "change",
  create_milestone: "milestone", create_stakeholder: "stakeholder", create_task: "task",
  create_resource: "resource",
};
const DELETE_TOOLS: Record<string, { entity: string; wsKey: keyof Workspace }> = {
  delete_task: { entity: "task", wsKey: "tasks" },
  delete_raid_item: { entity: "raid", wsKey: "raid" },
  delete_change: { entity: "change", wsKey: "changes" },
  delete_milestone: { entity: "milestone", wsKey: "milestones" },
  delete_stakeholder: { entity: "stakeholder", wsKey: "stakeholders" },
  delete_resource: { entity: "resource", wsKey: "resources" },
};

// Fields stored as rich HTML, keyed `${entity}.${field}`. Only the PREVIEW
// strings are projected — the values applied to the entity stay verbatim,
// because `applied[f]` feeds the incremental enum validation below and the
// confirm step replays the original tool calls.
//
// ★★ THE KEY MUST STAY ENTITY-QUALIFIED, and it must track the DESCRIPTOR's
// spelling of the field — `forPreview` looks up `${entity}.${field}` where
// `field` comes straight from `diffFields`, so the two are one unit. Renaming
// the task descriptor's `notes` to the live `description` without renaming the
// key here silently drops the task diff out of the set, and the preview renders
// raw HTML instead of projected text.
//
// The entity qualifier earns its keep independently: `notes` is ALSO the
// STAKEHOLDER descriptor's own field — and `Stakeholder.notes` is plain text
// (sanitizeText, plain textarea), deliberately outside slice B. A bare
// field-name set matched both, so an inline-AI edit to a stakeholder note
// previewed with its newlines collapsed by htmlToText: a field the design
// excluded, projected anyway.
//
// ★ Shared with descriptor-drift.test.ts, which asserts that exactly these
// fields come back UPGRADED from their sanitizer and every other diff field
// round-trips verbatim — so a wrong entry here (say "stakeholder.notes") fails
// that test rather than silently changing a preview.
export const RICH_FIELDS: ReadonlySet<string> = new Set([
  "task.description",
  "raid.description", "raid.mitigation",
  "change.description", "change.impactDescription", "change.resolutionNotes",
  "milestone.description",
]);

function forPreview(entity: InlineEntity, field: string, value: string): string {
  return RICH_FIELDS.has(`${entity}.${field}`) ? descriptionText(value) : value;
}

/** A person's display name from either shape `create_resource` accepts:
 *  firstName/lastName, or the single `name` the dispatcher splits. Empty when
 *  the object carries neither. */
function personName(o: Record<string, unknown>): string {
  const parts = `${str(o.firstName)} ${str(o.lastName)}`.trim();
  return parts || str(o.name);
}

/** The preview normalisation for a `numberFields` member.
 *
 *  ★★★ IT LIVES HERE RATHER THAN IN `fieldSanitizers`, AND THAT PLACEMENT IS
 *  THE POINT. `entity-descriptor.test.ts` asserts "keeps numberFields out of
 *  fieldSanitizers" because every entry in that map is a TEXT sanitizer, and a
 *  text sanitizer blanks a non-string to `""` — which `Number("")` then turns
 *  into `0`, slipping the int-range rejection below. Giving these fields a
 *  descriptor entry would close this divergence by reopening that one.
 *
 *  ★★ IT MIRRORS `toNumber` BECAUSE THE APPLY PATH IS `toNumber`.
 *  `sanitizeChangeItem` stores `toNumber(o.scheduleImpactDays)` when the result
 *  is finite and >= 0, and `toNumber("")` is `0` — so a `""` write (the "clear
 *  this field" value) STORES 0 while the old verbatim `str("")` preview showed
 *  `""`. The preview's own contract is that the string it shows is what apply
 *  would store, so it must coerce the same way. Pinned by the empty-string
 *  probe in `plan.sanitizer-parity.test.ts`.
 *
 *  ★ A NON-NUMERIC value falls back to the VERBATIM string rather than to
 *  `"NaN"`: the int-range guard rejects it either way (`Number("abc")` is NaN),
 *  and the rejection `detail` is more use to a reader carrying what the model
 *  actually sent. */
function numberPreview(v: unknown): string {
  const n = toNumber(v);
  return Number.isFinite(n) ? String(n) : str(v);
}

/** The normalisation a field's preview uses — the descriptor's own entry where
 *  it has one, the numeric coercion for a `numberFields` member, and otherwise
 *  `undefined` (previewed verbatim via `str`).
 *
 *  ★ Exported so `plan.sanitizer-parity.test.ts` can DELEGATE to it rather than
 *  restate the resolution order; a second copy of that order is exactly the
 *  preview/apply drift this module exists to prevent.
 *
 *  ★★★ THAT DELEGATION MEANS THE PARITY TEST CANNOT PIN THIS ORDER, and reading
 *  it as the protection is the trap. The test's `previewOf` CALLS this function,
 *  so reordering the `??` below moves the expectation with it and no mutant here
 *  can turn that file red. What actually makes the order safe is
 *  `entity-descriptor.test.ts`'s "keeps numberFields out of fieldSanitizers":
 *  the two sources are DISJOINT by assertion (with a population check so an
 *  empty set cannot read as a pass), so which one wins cannot matter. Delete
 *  that test and this `??` becomes unguarded — the delegation is for
 *  correctness, the disjointness test is for coverage, and they are not
 *  interchangeable. Flagged by cold review, which measured the tautology. */
export function previewNormalizerFor(
  d: EntityDescriptor,
  field: string,
): ((v: unknown) => string) | undefined {
  return d.fieldSanitizers[field] ?? (d.numberFields.has(field) ? numberPreview : undefined);
}

/** Entities whose display name is a PERSON rather than their `title` field.
 *
 *  ★★★ `title` on BOTH of these is a JOB TITLE, so the generic chain below
 *  labels the card with the job instead of the person — a create card reading
 *  "Engineer", and worse, a delete confirmation OFFERING TO DELETE "Engineer"
 *  when the row is a human being. That is a wrong-target prompt on an
 *  irreversible action: the user is asked to authorise a deletion against a
 *  name that is not the thing being deleted.
 *
 *  ★★ Both members are load-bearing and they arrive at the same place from
 *  different shapes — `resource` carries `firstName`/`lastName` (or the single
 *  `name` write alias the dispatcher splits), `stakeholder` carries `name`
 *  alone. `personName` handles both, which is why one set works.
 *
 *  ★ A THIRD mechanism already knows this and is not consulted here:
 *  `INLINE_DESCRIPTORS.stakeholder.titleOf` is `(i) => String(i.name ?? "")`.
 *  This function is deliberately descriptor-free because it also names
 *  CROSS-ENTITY creates, where no descriptor for that entity is in scope.
 *  Routing both through the descriptor would be the deeper fix and is not this
 *  one. */
const PERSON_ENTITIES: ReadonlySet<string> = new Set(["resource", "stakeholder"]);

function titleOf(entity: string, input: Record<string, unknown>): string {
  if (PERSON_ENTITIES.has(entity)) return personName(input) || entity;
  return str(input.title ?? input.taskName ?? input.name ?? input.description ?? entity);
}

interface EntityItem { id: number; [k: string]: unknown }

/** Build the plan for one entity. `ctx.item` is the row the popover opened on;
 *  `ctx.ws` the live workspace (id grounding + delete labels); `ctx.descriptor`
 *  drives which fields are diffable + how a value is validated so a previewed
 *  diff never diverges from what the sanitizer would persist. */
export function describeEntityCalls(
  blocks: readonly ToolUseLike[],
  ctx: { descriptor: EntityDescriptor; item: EntityItem; ws: Workspace },
): EditPlan {
  const { descriptor: d, item, ws } = ctx;
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [] };
  const ownIds = new Set((ws[d.wsKey] as ReadonlyArray<{ id: number }>).map((r) => r.id));

  for (const b of blocks) {
    if (b.type !== "tool_use" || typeof b.name !== "string") continue;
    const name = b.name;
    let input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;

    if (name === d.updateTool) {
      const id = Number(input.id);
      if (id !== item.id) {
        plan.rejected.push({ toolName: name, reason: ownIds.has(id) ? "unsupported" : "unknown-id", detail: str(input.id) });
        continue;
      }
      // ★★★ THE SPLIT MUST BE THE DISPATCHER'S OWN, AND SO MUST THE PREDICATE.
      //  `name` is a WRITE ALIAS, not a stored field, so it is correctly absent
      //  from `diffFields` — which left an alias-only rename previewing an EMPTY
      //  plan and then renaming the person. Projecting it here closes that.
      //  A second copy of the split rule is exactly how preview and apply
      //  diverge again, which is this whole slice's subject: the four conditions
      //  below mirror `updateResource` in `use-chat-dispatcher.ts` line for line,
      //  including the `typeof … !== "string"` part tests (a JSON `null` is
      //  neither a string nor `undefined`, and `=== undefined` there once
      //  dropped a rename AND wiped the first name).
      if (
        d.entity === "resource" &&
        typeof input.name === "string" &&
        input.name.trim() !== "" &&
        typeof input.firstName !== "string" &&
        typeof input.lastName !== "string"
      ) {
        input = { ...input, ...splitName(input.name) };
      }
      // ★★★ THE SANITIZER'S OWN FALLBACK — a SECOND leg, and modelling it as a
      //  suppression rather than a PROJECTION was a half-fix that shipped a
      //  worse card than the bug it replaced.
      //  `sanitizeResource` does not stop at the block above: after reading both
      //  parts it runs `if (!firstName && !lastName && typeof input.name ===
      //  "string") { …splitName… }` on the MERGED row. That fires precisely when
      //  the block above does NOT — an explicit part was supplied as a string,
      //  so the dispatcher's `renamed` is null and `name` reaches the sanitizer
      //  raw.
      //  Suppressing the rejection alone left the card saying `lastName: Bono →
      //  ""` while the write stored "Something", with the `firstName` change
      //  absent from the card entirely; and the inline consumer rebuilt
      //  `{lastName: ""}`, which makes the sanitizer return null and the writer
      //  THROW, costing the whole patch. Projecting instead puts both parts in
      //  the diff, so all three consumers see what the writer will store.
      //  ★ The parts are read through their own normalisers for the reason the
      //  group guard below gives: `sanitizeAssignee` blanks a NON-STRING, so a
      //  verbatim read would call `{firstName: 42}` populated and skip the leg
      //  the writer is about to take.
      if (d.entity === "resource" && typeof input.name === "string" && input.name.trim() !== "") {
        const partOf = (m: string): string => {
          const raw = m in input ? input[m] : item[m];
          const norm = previewNormalizerFor(d, m);
          return norm ? norm(raw) : str(raw);
        };
        if (partOf("firstName") === "" && partOf("lastName") === "") {
          input = { ...input, ...splitName(input.name) };
        }
      }
      // Accepted diffs so far — used both to validate a category-scoped enum
      // (RAID status) against a CO-CHANGED category and to compute the effective
      // item for the induced-reset pass below. Only VALID values land here.
      const applied: Record<string, string> = {};
      for (const f of d.diffFields) {
        if (!(f in input)) continue;
        // ★★★ WHICH NORMALISATION A FIELD GETS IS THE DESCRIPTOR'S CALL, and a
        // field it does not name is previewed VERBATIM. The inverse default —
        // "everything that is not a number is text" — ran `resource.isExternal`
        // through a text sanitizer that blanks a non-string to `""`; since
        // `raw` feeds the write patch in `use-inline-entity-edit.ts`, that
        // DROPPED the flag on apply, not merely in the card. The same blanking
        // would silently defeat the int-range rejection below for a number
        // field, because `Number("")` is `0`. An entry, where one exists, CALLS
        // the apply path's own sanitizer — never a copy of its cap, and never a
        // copy of its clipping algorithm. ★ A `numberFields` member gets its
        // coercion from `previewNormalizerFor` instead, for the reason that
        // function's docstring gives: it must NOT be in `fieldSanitizers`.
        //
        // ★★ BOTH SIDES GO THROUGH IT. Comparing a normalised `after` against a
        // raw `before` reports a change whenever the two spellings differ but
        // the stored outcome does not — `isExternal` is stored present-or-
        // absent, so `str(undefined)` ("") vs an incoming `false` made a no-op
        // render a diff. The sanitizers are idempotent on an already-stored
        // value, so normalising `before` costs nothing where the spellings
        // already agree.
        const normalize = previewNormalizerFor(d, f);
        const before = normalize ? normalize(item[f]) : str(item[f]);
        const after = normalize ? normalize(input[f]) : str(input[f]);
        if (before === after) continue;
        const bad = (detail: string) => plan.rejected.push({ toolName: name, reason: "bad-input", detail });
        // ★★★ A JOINT REQUIREMENT IS JUDGED ON THE MERGED ROW, NEVER ON THIS
        // FIELD ALONE, and the group takes PRECEDENCE over `requiredNonEmpty`
        // so the descriptor's "a member of a group is exempt" holds by
        // construction rather than by that set happening to be empty.
        // `sanitizeResource`'s gate is `if (!firstName && !lastName) return
        // null` — an OR over the row `updateResource` has already merged — so a
        // mononym rename is a legal write that stores `lastName: ""`. Judging
        // the halves separately previewed it as REJECTED while the write went
        // through: the two REPLAYING consumers resend the original tool input
        // and never read this plan (§384).
        const group = d.requiredNonEmptyGroups.find((g) => g.has(f));
        if (after === "") {
          if (group) {
            // ★★ EVERY MEMBER GOES THROUGH ITS OWN NORMALISER, never `str`.
            // The writer sees `sanitizeAssignee`, whose `clipText` returns ""
            // for a NON-STRING — so `{firstName: "", lastName: 42}` arrives as
            // two empty parts and THROWS, while a verbatim `str(42)` would read
            // "42", call the row survivable and preview a diff whose Apply
            // fails, taking every other field in the same patch with it.
            // ★ No `.trim()` here: the member's own sanitizer already trims
            // where the writer trims, and adding one would diverge for a future
            // group member whose sanitizer (like `sanitizeMultiline`) does not.
            // ★ The merge mirrors `updateResource`'s `{...existing, ...patch}`:
            // the model's input where it supplied the key, the stored row
            // otherwise. The `name` write alias is already projected onto the
            // parts above, exactly as the dispatcher spreads `splitName`.
            const members = [...group];
            const survives = members.some((m) => {
              // The field under judgement takes its NEW value — "" in this
              // branch, so it can never be the survivor.
              if (m === f) return after !== "";
              const raw = m in input ? input[m] : item[m];
              const norm = previewNormalizerFor(d, m);
              return (norm ? norm(raw) : str(raw)) !== "";
            });
            // ★★ The sanitizer has a THIRD leg — a fallback that splits `name` when
            //  both parts are empty — and it is modelled as a PROJECTION above,
            //  not here. Suppressing the rejection at this point was the first
            //  attempt and it was worse than the defect: the card then showed a
            //  clear for a field the write repopulated, and hid the other half
            //  of the rename entirely. Projecting means that by the time this
            //  guard runs, a rescued rename has already put both parts in
            //  `input`, so `survives` sees them and no special case is needed.
            if (!survives) { bad(`${members.join("+")}=empty`); continue; }
          } else if (d.requiredNonEmpty.has(f)) { bad(`${f}=empty`); continue; }
        }
        // Match the sanitizer EXACTLY — sanitizeIsoDate is format + year-range
        // (1900-2100), returning the input verbatim when valid and "" otherwise,
        // so a previewed date can never diverge from what apply persists.
        if (d.dateFields.has(f) && after !== "" && sanitizeIsoDate(after) !== after) { bad(`${f}=${after}`); continue; }
        // ★★ A THROW ON APPLY COSTS THE WHOLE PATCH, not just this field.
        // `buildTaskCleanPatch` throws "assigneeEmail is invalid" for an address
        // `isValidEmail` rejects, and the dispatcher surfaces that as a failed
        // tool call — so every OTHER field the same edit changed is lost with
        // it. Rejecting here keeps the bad value out of the patch and lets the
        // rest apply. Blank is exempt because the sanitizer's own guard is
        // `if (e && !isValidEmail(e))` — clearing an address is legal.
        if (d.emailFormatFields.has(f) && after !== "" && !isValidEmail(after)) { bad(`${f}=${after}`); continue; }
        const range = d.intRangeFields[f];
        if (range) {
          const n = Number(after);
          if (!Number.isInteger(n) || n < range[0] || n > range[1]) { bad(`${f}=${after}`); continue; }
        }
        if (f in d.enumFields && !validSetFor(d.entity, f, { ...item, ...applied }).has(after)) { bad(`${f}=${after}`); continue; }
        plan.updates.push({ field: f, before: forPreview(d.entity, f, before), after: forPreview(d.entity, f, after), raw: after });
        applied[f] = after;
      }
      // Relationship and FK inputs. Deliberately a SEPARATE bucket from
      // `updates` — see the `LinkDiff` docstring for the wipe this prevents.
      // ONE sanitize per side, reused for both the rendered title and the
      // applied value, so the card cannot promise something the patch omits.
      //
      // ★★ A FIELD THE MODEL DID NOT SEND EMITS NOTHING, and the `in` guard is
      // what holds that. These writes REPLACE, and the patch is rebuilt from
      // this bucket — so emitting an untouched field would wipe it. RAID has
      // three link fields; a model that sends one must not lose the other two.
      //
      // ★★★ THE SKIP COMPARES RENDERED TITLES, NOT IDS, AND THAT IS THE
      // DELIBERATE CHOICE. Two DIFFERENT id lists that render identically (two
      // rows sharing a title) emit nothing. Comparing `rawIds` instead would
      // write the swap behind a card reading "Review -> Review": a change the
      // user cannot see, on a disclosure surface whose whole purpose is that
      // they can. One comparison gates BOTH the card and the patch, which is
      // the invariant; a same-titled swap is the known, narrow price.
      //
      // ★★ WHAT THAT PRICE ACTUALLY IS, corrected in cold review. An earlier
      // wording said "no write happens either — the edit is silently dropped
      // rather than silently destructive". That is true ONLY of the REBUILDING
      // consumer, which reconstructs its patch from this plan. The two
      // REPLAYING consumers (`chat-proposal-apply.ts`,
      // `use-insight-recommendations.ts`) resend the original tool input and
      // never read the plan, so for them the swap IS written, behind a card
      // that showed no link line at all. The trade still stands — but the cost
      // is "undisclosed on two surfaces", not "dropped everywhere", and the
      // difference is the whole subject of this module. ★ It is narrow because a DANGLING id renders as `#<id>`
      // (`UNKNOWN_ID_MARKER`), so an unresolvable row stays distinguishable,
      // and a REORDER changes the joined string — neither collapses here.
      for (const [f, link] of Object.entries(d.linkFields)) {
        if (!(f in input)) continue;
        const beforeIds = link.sanitize(item[f]);
        const afterIds = link.sanitize(input[f]);
        const before = resolveLinkTitles(beforeIds, link, ws);
        const after = resolveLinkTitles(afterIds, link, ws);
        if (before === after) continue;
        plan.links.push({ field: f, before, after, rawIds: afterIds });
      }
      // Sanitizer-INDUCED enum resets: an enum field NOT explicitly (and validly)
      // changed, whose current value is no longer valid for the item as patched,
      // is silently reset by the sanitizer to the field's default (RAID status
      // follows a co-changed category). Surface it so the preview matches the
      // write instead of under-reporting a second field change.
      const effective = { ...item, ...applied };
      for (const f of Object.keys(d.enumFields)) {
        if (f in applied) continue;
        const cur = str(item[f]);
        if (!cur) continue;
        const valid = validSetFor(d.entity, f, effective);
        if (valid.size === 0 || valid.has(cur)) continue;
        const def = defaultEnumFor(d.entity, f, effective);
        if (def === undefined || def === cur) continue;
        plan.updates.push({ field: f, before: cur, after: def });
      }
      continue;
    }

    if (name in CREATE_TOOLS) {
      const entity = CREATE_TOOLS[name];
      plan.creates.push({ entity, title: titleOf(entity, input), toolName: name, input });
      continue;
    }

    if (name in DELETE_TOOLS) {
      const { entity, wsKey } = DELETE_TOOLS[name];
      const id = Number(input.id);
      // The row's OWN entity may only delete the row it was opened on; other
      // entities' deletes are allowed (cross-entity cleanup).
      if (name === d.deleteTool && id !== item.id) {
        plan.rejected.push({ toolName: name, reason: "unsupported", detail: str(input.id) });
        continue;
      }
      const rows = ws[wsKey] as ReadonlyArray<{ id: number; title?: string; taskName?: string; name?: string }>;
      const found = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
      if (!found) { plan.rejected.push({ toolName: name, reason: "unknown-id", detail: str(input.id) }); continue; }
      // ★★★ Same job-title collision as `titleOf` above, on the stored ROW
      // instead of the input — and this is the site where it does real harm,
      // because this label is what a DELETE confirmation shows. A resource
      // carries `title` ("Engineer") and no `name`; a stakeholder carries both,
      // and `title` wins the generic chain. Either way the user is offered a
      // deletion named after a job rather than the person.
      const label = PERSON_ENTITIES.has(entity)
        ? personName(found as Record<string, unknown>) || str(id)
        : str(found.title ?? found.taskName ?? found.name ?? id);
      plan.deletes.push({ entity, label, toolName: name, id });
      continue;
    }
  }
  return plan;
}

/** Task-bound wrapper preserving SP1's signature (its tests import this). */
export function describeToolCalls(blocks: readonly ToolUseLike[], ctx: { task: Task; ws: Workspace }): EditPlan {
  return describeEntityCalls(blocks, { descriptor: INLINE_DESCRIPTORS.task, item: ctx.task as unknown as EntityItem, ws: ctx.ws });
}

/** True when the plan would write nothing (used to disable Apply / show a note). */
export function isEmptyPlan(p: EditPlan): boolean {
  return p.updates.length === 0 && p.creates.length === 0 && p.deletes.length === 0 && p.links.length === 0;
}
