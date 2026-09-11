// src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
//
// ★★★ THE DETECTOR THE SWEEP COULD NOT BE, IN BOTH DIRECTIONS.
// `plan.write-path-sweep.test.ts` drives `update_*` tools only and derives its
// field axis from `[...diffFields, ...rawTypeGuards, ...linkFields]` unioned
// with the seed row's keys — every term downstream of the guard tables under
// test. So it could not have found §438 (seven create sites with no guard), and
// §436 measured that narrowing an allowlist row leaves its per-entity violation
// counts BYTE-IDENTICAL to a clean run.
//
// This file takes its axis from `TOOL_DEFS` instead — what the model is
// actually offered — and states one property in two halves:
//
//   Relation A  an UNDECLARED field must never land on the model's value,
//               on create or on update.
//   Relation B  a DECLARED field must land, or be visibly refused.
//
// Together: OFFERED ⟺ WRITABLE.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import {
  rejectedFields,
  same,
  snapshot,
  SWEEP,
  type SweepEntity,
  type WsKey,
} from "../../test/inline-sweep-fixtures";
import {
  AXIS_BASELINE,
  CREATE_BASE,
  declaredProperties,
  ENTITIES,
  PERSISTED_COLUMNS,
  requiredForCreate,
  schemaProperty,
  SYNTHETIC_INPUTS,
  undeclaredColumns,
} from "../../test/offered-surface-axis";
import { entityToken } from "../ai-entity-token";
import { TOKEN_ROW_SOURCE } from "../chat-proposal-apply";
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import { describeEntityCalls, type EditPlan, previewNormalizerFor } from "./plan";

describe("the offered-surface axis", () => {
  // ★★★ FLOOR 1 — the axis has not silently collapsed. Every assertion in both
  //  relations iterates an axis, and an EMPTY axis satisfies all of them. A
  //  schema refactor that renamed a field bag would empty one entity's declared
  //  set and turn that entity's whole Relation B green while proving nothing.
  //  Tied to a RECORDED baseline rather than to `> 0`, because `> 0` cannot see
  //  an axis that shrank from eleven to one.
  it.each(ENTITIES)("%s: the axis is the size it was measured at", (entity) => {
    expect({
      declared: declaredProperties(entity, "create").length,
      undeclared: undeclaredColumns(entity).length,
    }).toEqual(AXIS_BASELINE[entity]);
  });

  // ★★★ FLOOR 3 — EVERY PROPERTY THE MODEL IS OFFERED IS EITHER A PERSISTED
  //  COLUMN OR A RECORDED CONVENIENCE INPUT. That is the whole claim; it is
  //  STRUCTURAL, which is why it is worth keeping beside floor 1 rather than
  //  folded into it. Floor 1 compares against a HARDCODED baseline a human
  //  re-records by hand, so a wrong re-baseline silences it outright; this one
  //  needs no re-recording to stay true.
  //
  //  ★★ `resource.name` is the only member of `SYNTHETIC_INPUTS` today — the
  //   writer splits it into `firstName`/`lastName` and stores neither under that
  //   name. A NEW synthetic input has to be added there DELIBERATELY; nothing
  //   here absorbs one silently, and nothing else in the file reads that list.
  //
  //  ★★ `id` is subtracted on purpose and on BOTH sides: `create_*` mints it and
  //   `update_*` addresses by it, so it is never a written field. Subtracting it
  //   here rather than inside the two helpers keeps the helpers' own outputs
  //   honest about what the schema says.
  it.each(ENTITIES)("%s: every offered property is a persisted column or a recorded synthetic input", (entity) => {
    const synthetic = SYNTHETIC_INPUTS[entity] ?? [];
    const offered = declaredProperties(entity, "create").filter((f) => !synthetic.includes(f));
    const union = [...offered, ...undeclaredColumns(entity)].sort();
    const columns = PERSISTED_COLUMNS[entity].filter((f) => f !== "id").sort();
    expect(union).toEqual(columns);
  });

  // ★ Non-vacuity for floor 3 itself: an empty minuend makes the equality above
  //  hold trivially. Nine is the smallest persisted column list (milestone, at
  //  9 including `id`), so a floor of 8 post-`id` is the honest one.
  it.each(ENTITIES)("%s: the union check has something to check", (entity) => {
    expect(PERSISTED_COLUMNS[entity].length).toBeGreaterThan(8);
  });

  // ★★★ A CREATE BASE MISSING A REQUIRED FIELD IS A SILENT VACUITY ENGINE. The
  //  tool throws, no row is stored, and every "the probe did not land"
  //  assertion in Relation A passes because there is nothing to have landed in.
  //  Pinned against the schema's OWN `required` array so a newly-required field
  //  turns this red rather than quietly hollowing out an entity's whole arm.
  it.each(ENTITIES)("%s: the create base satisfies every schema-required field", (entity) => {
    const missing = requiredForCreate(entity).filter((f) => !(f in CREATE_BASE[entity]));
    expect(missing, `${entity}: create base omits required ${missing.join(", ")}`).toEqual([]);
  });

  // ★ The base must also be made of DECLARED fields only — a base carrying an
  //  undeclared key would put Relation A's own probe value into every create,
  //  which is the shape it exists to detect.
  it.each(ENTITIES)("%s: the create base names only declared fields", (entity) => {
    const declared = declaredProperties(entity, "create");
    const stray = Object.keys(CREATE_BASE[entity]).filter((f) => !declared.includes(f));
    expect(stray, `${entity}: create base carries undeclared ${stray.join(", ")}`).toEqual([]);
  });

  // ★ `EXPECTED_FINDINGS`, beside Relation B, is keyed `entity:arm`. A mistyped
  //  key ledgers nothing, silently, in the direction where its finding has
  //  already been fixed: the real key expects nothing and gets nothing, while
  //  the stale entry is never compared. tsc rejects one; vitest does not.
  //
  //  ★ The entries get the same check, and here it improves the ERROR rather
  //   than preventing a silent pass. A subject filed under the WRONG entity's
  //   key, or a kind outside `FINDING_KINDS`, can never be emitted, so that
  //   arm's verdict already goes red — but with "a missing one was fixed",
  //   which sends the reader to close a register row over what is a typo.
  //   This names the typo instead. `subject` is a plain string, so tsc checks
  //   neither half.
  it("every expected-findings ledger entry names a real entity, arm, subject and kind", () => {
    const stray = Object.entries(EXPECTED_FINDINGS).flatMap(([key, entries]) => {
      const [entity, arm, ...rest] = key.split(":");
      if (rest.length > 0 || !ENTITIES.some((e) => e === entity) || !(arm === "create" || arm === "update")) {
        return [`${key} (no such entity:arm)`];
      }
      return (entries ?? [])
        .filter(
          (f) =>
            !(f.subject === entity || f.subject.startsWith(`${entity}.`)) ||
            !FINDING_KINDS.some((k) => k === f.kind),
        )
        .map((f) => `${key} → ${f.subject}:${f.kind}`);
    });
    expect(stray, `ledger entries naming no real entity:arm, subject or kind: ${stray.join(", ")}`).toEqual([]);
  });
});

type Row = Record<string, unknown>;

const SEED_BY_ENTITY = new Map<InlineEntity, SweepEntity>(SWEEP.map((s) => [s.entity, s]));

function seedFor(entity: InlineEntity): SweepEntity {
  const s = SEED_BY_ENTITY.get(entity);
  if (!s) throw new Error(`no SWEEP fixture for "${entity}" — the relations below cannot run`);
  return s;
}

/** The seeded row as the fixture literal declares it — the right source for
 *  CHOOSING a probe, because a probe needs only the field's TYPE and the type
 *  survives the sanitizer. Never the right source for JUDGING a write: every
 *  comparison below reads `before` out of `updateWith`, which is the provider's
 *  own post-write row. Judging against this literal would compare the stored row
 *  to something the provider never held. */
function snapshotSeedRow(s: SweepEntity): Row | undefined {
  const wsKey = INLINE_DESCRIPTORS[s.entity].wsKey as WsKey;
  const rows = (s.seed as Record<string, ReadonlyArray<Row>>)[wsKey];
  return rows?.find((r) => r.id === s.id);
}

/** The `TokenEntity` kind for an entity's update tool, for `entityToken`. */
function kindOf(entity: InlineEntity) {
  const tool = INLINE_DESCRIPTORS[entity].updateTool;
  const source = TOKEN_ROW_SOURCE[tool];
  if (!source) throw new Error(`no TOKEN_ROW_SOURCE entry for "${tool}"`);
  return source.kind;
}

/** Drive one `create_*` call and return the row it produced, or undefined.
 *
 *  ★★ `resetMintState()` runs in `beforeEach`, not here: the minter is
 *  module-scoped and resetting mid-file would let two creates in one test mint
 *  the same id. */
async function createWith(
  entity: InlineEntity,
  extra: Record<string, unknown>,
): Promise<{ row: Row | undefined; plan: EditPlan; threw?: string }> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith({}) },
  );
  const tool = INLINE_DESCRIPTORS[entity].createTool;
  const input = { ...CREATE_BASE[entity], ...extra };
  const wsBefore = snapshot(result.current.ws);

  const plan = describeEntityCalls([{ type: "tool_use", name: tool, input }], {
    descriptor: INLINE_DESCRIPTORS[entity],
    // ★ There is no item on a create, and `describeEntityCalls` reads `item.id`
    //  ONLY inside its `name === d.updateTool` branch, which a `create_*` call
    //  never enters. The cast says exactly that; widening the parameter in
    //  production code to please one test would be the tail wagging the dog.
    item: undefined as unknown as { id: number },
    ws: wsBefore,
  });

  // ★★★ A THROW IS AN OUTCOME, NOT AN ERROR. Several writers refuse a bad value
  //  loudly rather than dropping it, and letting the exception escape would
  //  crash the whole entity's arm at its first strict field and never reach the
  //  rest of the axis. Captured so the relations can tell "refused loudly" from
  //  "accepted silently".
  let threw: string | undefined;
  await act(async () => {
    try {
      await runTool(result.current.d, tool, input);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
  });

  const wsKey = INLINE_DESCRIPTORS[entity].wsKey as WsKey;
  const rows = snapshot(result.current.ws)[wsKey] as ReadonlyArray<Row> | undefined;
  return { row: rows?.[0], plan, threw };
}

/** Drive one `update_*` call against the shared seed and return before/after. */
async function updateWith(
  entity: InlineEntity,
  field: string,
  probe: unknown,
): Promise<{ before: Row; stored: Row; plan: EditPlan; threw?: string }> {
  const s = seedFor(entity);
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith(s.seed) },
  );
  const tool = INLINE_DESCRIPTORS[entity].updateTool;
  const wsKey = INLINE_DESCRIPTORS[entity].wsKey as WsKey;

  const wsBefore = snapshot(result.current.ws);
  const before = (wsBefore[wsKey] as ReadonlyArray<Row> | undefined)?.find((r) => r.id === s.id);
  if (!before) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);

  const input: Record<string, unknown> = { id: s.id, [field]: probe };
  const plan = describeEntityCalls([{ type: "tool_use", name: tool, input }], {
    descriptor: INLINE_DESCRIPTORS[entity],
    item: before as { id: number },
    ws: wsBefore,
  });

  // ★★ `expectedToken` stamped from the STORED row, exactly as
  //  `chat-proposal-apply.ts` does it. Without it `requireToken` refuses every
  //  call, each read-back compares a row against itself, and the whole relation
  //  reports perfect agreement having written nothing.
  let threw: string | undefined;
  await act(async () => {
    try {
      await runTool(result.current.d, tool, { ...input, expectedToken: entityToken(kindOf(entity), before) });
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
  });

  const stored = (snapshot(result.current.ws)[wsKey] as ReadonlyArray<Row> | undefined)?.find((r) => r.id === s.id);
  if (!stored) throw new Error(`${wsKey} #${s.id} vanished during the replay`);
  return { before, stored, plan, threw };
}

/** A value that differs from anything a writer would produce for this field, so
 *  "did the model's value land" is answerable.
 *
 *  ★★★ RELATION A ASSERTS ON THIS VALUE, NEVER ON THE FIELD'S PRESENCE, AND
 *  THAT IS THE PROPERTY THAT KEEPS IT FREE OF AN EXEMPTION LIST.
 *  `localModifiedAt` is on all eight undeclared axes and `outlookEventId` on
 *  six (every entity but stakeholder and resource — `grep -c '"outlookEventId"'
 *  src/app/csv-codecs-core.ts` → 6, and no tool schema declares it); both are
 *  legitimately written by the writer on every call, and neither is EVER
 *  written to the model's value. A presence-based assertion would need all of
 *  them exempted, and an exemption list is exactly how §437's ratchet came to
 *  hide a live undisclosed write.
 *
 *  ★★★ DERIVED FROM THE SEEDED VALUE'S TYPE, NOT A FIXED STRING. A guard
 *  written `typeof v === "number"` refuses a string for the RIGHT reason, so a
 *  string-only probe cannot tell a working guard from a type mismatch and would
 *  report a clean run over a field it never actually reached. Where the seed
 *  carries no value the string is the honest fallback — there is nothing to
 *  derive from.
 *
 *  ★★★ BUT A TRESPASS PROBE IS NEVER A VALID VALUE, AND THAT MAKES A WHOLE
 *  CLASS OF FIELDS INVISIBLE TO THIS RELATION (§441). It asserts the stored
 *  value is not SAME as the probe; so for ANY undeclared field whose sanitizer
 *  rejects or reshapes an arbitrary value, the probe can never be stored as
 *  sent — guard or no guard — and the relation passes over the field GREEN
 *  whatever the guard does. Verified instances, traced from source; this is
 *  AT LEAST these, not an enumeration of the axis:
 *   - `knowledgeLinks` — where seeded (raid, change, milestone, stakeholder)
 *     the probe is `[{ trespass }]`, elsewhere the string;
 *     `sanitizeKnowledgeLinks` returns `[]` for a non-array, drops every
 *     element without a name and url, and mints an id on any it keeps.
 *   - `calendarEvent.exceptions` — unseeded, so the probe is the string;
 *     `sanitizeExceptions` drops a non-array outright. So removing the
 *     `create_calendar_event` guard outright leaves this file green: the other
 *     two undeclared columns are stripped by `createInputWithoutId` anyway.
 *   - `stakeholder.raci` — seeded as an object, and there is no object branch
 *     below, so the probe is the string; `coerceRaciMap` turns it into `{}`.
 *   - `resource.utilizationMode` — seed `"hours"`, so the probe is the string;
 *     `sanitizeUtilizationMode` maps anything but `"hours"` to `"percent"`.
 *   - `resource.utilization` / `resource.absenceOverride` — object seeds, so
 *     the probe is the string; `coercePeriodMap` returns an object, never it.
 *   - `resource.birthday` — the string probe fails `BIRTHDAY_RE` and
 *     `sanitizeBirthday` drops it.
 *   - `resource.active` — seed `false`, so the probe is `true`;
 *     `sanitizeResource` stores the key only when it is `false`.
 *   - `change.decisionDate` — a date seed, but there is no date branch below,
 *     so the probe is the string; `sanitizeIsoDate` rejects it.
 *  Where a guard on those fields is caught at all, something else catches it:
 *  `plan.create-path-guards.test.ts` pins `knowledgeLinks` (raid, change,
 *  milestone), `exceptions` and `resource.active` on create; stakeholder's
 *  create guard CALL is covered there by its `resourceId` pin, and its
 *  `knowledgeLinks` row by `plan.write-path-sweep.test.ts` on update, which
 *  shares the table (measured 2026-09-11: that row admitting everything reds
 *  the write-path sweep's stakeholder case and leaves this file green). `raci`
 *  has no create pin and needs none — `create_stakeholder` writes `raci: {}`
 *  AFTER spreading the guarded input (`use-register-tools.ts`) — and on update
 *  it is `plan.write-path-sweep.test.ts` that drives it. The probes stay as
 *  they are for now; §441 carries the fix. */
const TRESPASS_STRING = "TRESPASS-offered-surface-sweep";

function trespassProbeFor(current: unknown): unknown {
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1000;
  if (Array.isArray(current)) return [{ trespass: "offered-surface-sweep" }];
  return TRESPASS_STRING;
}

/** A VALID value for a declared field, different from what is stored.
 *
 *  ★★★ RELATION B NEEDS A VALID PROBE WHERE RELATION A NEEDS AN INVALID ONE,
 *  AND CONFUSING THE TWO INVERTS THE RESULT. Relation A asks "can the model
 *  write something it was never offered", so any distinguishable value serves.
 *  Relation B asks "does the field the model WAS offered actually work", so a
 *  value the sanitizer legitimately rejects would report a lost capability
 *  where the guard is simply doing its job.
 *
 *  Resolution order, most specific first:
 *   1. the schema's own `enum` — pick a member the seed does not already hold;
 *   2. the SEED row's current value, mutated in kind (a date +1 day, a number
 *      +1, a boolean flipped, a string suffixed). This is what makes dates work
 *      without a format table: a valid date mutated by a day is still valid.
 *   3. the declared `type`, for a field the seed does not carry.
 *
 *  ★★ Step 2 is why there is no per-field override map here. A map of "this
 *  field wants a date, that one wants an email" is a maintenance surface that
 *  rots silently and, worse, is one rename away from becoming an exemption
 *  list. Deriving from a value the fixture already proved valid cannot rot in
 *  that direction.
 *
 *  ★ `op` is threaded rather than hardcoded to `"update"`. The two ops share one
 *  field bag per entity today, so it makes no difference — but a create-only
 *  property would make a hardcoded `"update"` lookup THROW inside the create
 *  arm, which reads as a broken harness rather than as the schema divergence it
 *  would be. */
function validProbeFor(
  entity: InlineEntity,
  op: "create" | "update",
  field: string,
  current: unknown,
): unknown {
  const prop = schemaProperty(entity, op, field);
  if (prop.enum && prop.enum.length > 0) {
    const other = prop.enum.find((v) => v !== current);
    return other ?? prop.enum[0];
  }
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1;
  if (typeof current === "string" && /^\d{4}-\d{2}-\d{2}$/.test(current)) {
    const d = new Date(`${current}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (typeof current === "string" && /^\d{2}:\d{2}$/.test(current)) {
    return current === "09:00" ? "10:00" : "09:00";
  }
  if (typeof current === "string" && current.length > 0) return `${current} probed`;
  // ★★★ THE ARRAY PROBE DROPS A KNOWN-GOOD ELEMENT; IT DOES NOT APPEND A NEW
  //  ONE. The old shape was `[...current, "probed"]`, which appends a STRING to
  //  what is usually a list of NUMERIC ids. A sanitizer that drops the
  //  non-numeric entry and keeps the valid ones stores an array equal to the
  //  original, and the relation reads that as "a valid value changed nothing" —
  //  so the LANDING half measured the probe, not the product. It is the same
  //  defect `trespassProbeFor` already avoids by deriving from the seeded
  //  value's type: a probe a guard refuses for the RIGHT reason cannot tell a
  //  working guard from a type mismatch, and reports a capability lost where
  //  the guard is simply doing its job.
  //
  //  ★★ DROPPING is the strongest probe available here, because every element
  //  that REMAINS is a value the store already holds. No type guard and no
  //  foreign-key check can legitimately refuse it, so a failure to land is
  //  unambiguously a SILENT DROP rather than a probe artifact. Appending would
  //  need a plausible NEW element, and a fabricated id CAN be legitimately
  //  refused — which reintroduces the exact ambiguity this removes.
  //
  //  ★ A SINGLE element yields the EMPTY array. A `requiredNonEmptyGroups` rule
  //  will refuse that, correctly — and Relation B accepts a refusal the card
  //  DISCLOSES, so that path is an answer rather than a finding.
  //
  //  ★★ AN EMPTY seed returns the array UNCHANGED and lands in the relation's
  //  `dead` category BY DESIGN. There is nothing to derive an element type from
  //  — `SchemaProperty` carries no `items` — so any element would be invented,
  //  and a loud "the derived probe cannot move this field" is the honest
  //  outcome. Do NOT close it with a per-field override map or an exemption.
  if (Array.isArray(current)) {
    if (current.length >= 2) return current.slice(1);
    if (current.length === 1) return [];
    return current;
  }
  if (prop.type === "number") return 7;
  if (prop.type === "boolean") return true;
  if (prop.type === "array") return ["probed"];
  // ★★★ THERE IS NO OBJECT BRANCH, AND ONE FIELD FALLS THROUGH IT TO A
  //  VACUOUS PASS (§441). `calendarEvent.recurrence` is schema type `object`
  //  and seeded as one, so it reaches this line and gets `"probed"`. On create
  //  the guard (`CALENDAR_EVENT_FIELD_GUARDS.recurrence`, `isPlainObject`)
  //  drops it and the row stores no recurrence, and `recurrenceText` — the
  //  field's preview normaliser — projects both the probe and that missing rule
  //  to `""`. So the create arm reads it as LANDED having moved nothing, and it
  //  counts toward that entity's floor 2. Recorded, not fixed here; §441
  //  carries the fix.
  return "probed";
}

/** One side of a landing comparison, projected the way the card renders it.
 *
 *  ★★ THE THREE CREATE-ARM COMPARISONS MUST AGREE ON THIS PROJECTION OR THE ARM
 *  CONTRADICTS ITSELF. The control test ("is this probe distinguishable from
 *  what the base create produces?"), the re-derivation's own difference test,
 *  and the landing test ("did the value arrive?") all ask the same question
 *  about the same value. Two spellings of it would let a probe be judged
 *  DIFFERENT from the control by one rule and EQUAL to the created row by
 *  another, which reads as a silent drop on a field that worked. */
function normalizedAs(
  value: unknown,
  row: Row,
  normalize: ((v: unknown, row: Record<string, unknown>) => string) | undefined,
): string {
  return normalize ? normalize(value, row as Record<string, unknown>) : String(value ?? "");
}

/** ★★★ THE ONE FIELD WHOSE PROBE IS NOT DERIVED, AND THE ONLY REASON IS MAIL.
 *  `calendarEvent.sendInvitations` is stored PRESENT-ONLY-WHEN-TRUE
 *  (`sanitizeCalendarEvent`), so an unsupplied create leaves it `undefined` and
 *  rule 2 below — negate the CONTROL — yields exactly `true`. That is the value
 *  `sendsInvitations` keys on in `chat-proposal.ts`, the one write in this app
 *  that leaves the building.
 *
 *  ★★★ THIS IS A SAFETY EXCLUSION, NOT AN EXEMPTION, AND THE DIFFERENCE IS
 *   OBSERVABLE: the field stays classified `dead` and still emits its finding
 *   line, so it is reported as UNMEASURED rather than silently waved through.
 *   An exemption would remove it from the axis; this leaves it on the axis and
 *   admits the probe cannot reach it safely.
 *
 *  ★★ IT IS ASSERTED, NOT TRUSTED — the standalone mail guard below pins that
 *   `probeAgainstControl` returns `undefined` here, so deleting this entry
 *   turns that test red BEFORE any probe runs. The pre-existing half of that
 *   guard reads `validProbeFor` and is structurally blind to this derivation,
 *   which is why it needed a second assertion rather than being relied upon.
 *
 *  ★ Do NOT widen this set to make a red run green. Every other member of the
 *   axis is measurable by construction (see the safety argument on
 *   `probeAgainstControl`); a second entry here would be the exemption list
 *   this file exists to do without. */
const MAIL_UNSAFE_BOOLEANS: ReadonlySet<string> = new Set(["calendarEvent.sendInvitations"]);

/** A create probe derived against the CONTROL ROW rather than against the seed.
 *
 *  ★★★ WHY A SECOND DERIVATION EXISTS AT ALL. `validProbeFor` derives from the
 *  SEEDED value, and the create arm JUDGES against the control — the row the
 *  base payload produces on its own. Those are two different reference points,
 *  so a probe that moves the seeded value can still land on precisely the value
 *  the writer would have produced anyway, and the arm can prove nothing with
 *  it. Measured 2026-09-08: 16 of 85 declared create probes came out `dead`
 *  that way — 19% of the surface this file exists to measure, unmeasured.
 *
 *  ★★★ THE SAFETY ARGUMENT, WHICH IS THE WHOLE REASON THESE THREE CASES AND NO
 *  OTHERS. The create arm has NO REFUSAL CHANNEL (the create branch of
 *  `describeEntityCalls` emits no `rejected` entries at all), so a guard
 *  correctly refusing a bad value is indistinguishable from a lost capability.
 *  Every value produced here is therefore one nothing can legitimately refuse:
 *
 *   1. ENUM — a member of the schema's OWN `enum`, so the tool advertised it as
 *      acceptable for this very field. Picked to differ from the CONTROL's
 *      value, not the seed's. A single-member enum yields nothing and the field
 *      stays honestly `dead`.
 *   2. BOOLEAN — `!control`. A boolean field accepts both booleans by
 *      definition; the guard tables spell this one `typeof v === "boolean"`.
 *      Negating the CONTROL rather than the seed is the entire point: negating
 *      the seed is what produced the control's own value in the dead cases.
 *   3. ARRAY — the FULL seeded array, used only when the existing derivation
 *      (which DROPS an element) collapsed onto the control. The fixture already
 *      proved that literal acceptable to this entity's sanitizer for this
 *      field, so it is type-correct by demonstration rather than by assumption.
 *
 *  ★★★ NOTHING HERE IS FABRICATED, AND THAT IS THE LOAD-BEARING PROPERTY. No
 *  invented foreign key, no enum member the schema does not declare, no string
 *  in a numeric list. A made-up value CAN be legitimately refused, and on an arm
 *  with no refusal channel that manufactures a finding — the failure direction
 *  that wastes the most time. If none of the three cases applies (a string, a
 *  number, a date), `undefined` comes back and the caller keeps the seed-derived
 *  probe, so the field stays `dead` and says so. That is the honest outcome; do
 *  NOT close it with a per-field override map, which `validProbeFor`'s own
 *  docstring forbids for the reason it rots into an exemption list.
 *
 *  ★★ APPLIED ONLY WHERE THE SEED-DERIVED PROBE WOULD BE DEAD. A live probe is
 *  left exactly as it was, so findings from before this existed stay
 *  comparable — a re-derivation that moved an already-working probe could
 *  change what `EXPECTED_FINDINGS` holds for a reason that is not the product. */
function probeAgainstControl(
  entity: InlineEntity,
  field: string,
  seedValue: unknown,
  controlRow: Row,
  normalize: ((v: unknown, row: Record<string, unknown>) => string) | undefined,
): unknown {
  const asControl = normalizedAs(controlRow[field], controlRow, normalize);
  const differs = (candidate: unknown) => normalizedAs(candidate, controlRow, normalize) !== asControl;

  const prop = schemaProperty(entity, "create", field);
  if (prop.enum && prop.enum.length > 0) return prop.enum.find(differs);

  if (prop.type === "boolean" || typeof seedValue === "boolean") {
    if (MAIL_UNSAFE_BOOLEANS.has(`${entity}.${field}`)) return undefined;
    const flipped = controlRow[field] !== true;
    return differs(flipped) ? flipped : undefined;
  }

  if (Array.isArray(seedValue)) return differs(seedValue) ? seedValue : undefined;

  return undefined;
}

beforeEach(() => {
  // The id minter is module-scoped. Resetting keeps this file order-independent
  // under `npm run test:shuffle`, which runs the whole suite at a pinned seed.
  resetMintState();
});

describe.each(ENTITIES)("Relation A — %s: an undeclared field must not land", (entity) => {
  // ★★★ THE RELATION §438 NEEDED AND NOBODY HAD. Seven create sites spread raw
  //  model input while their update siblings were guarded, mutation-proved and
  //  watched by a green sweep — because every detector asked only about
  //  editing. This asks about both.
  it("create: the created row carries none of the model's undeclared values", async () => {
    const findings: string[] = [];
    let probed = 0;
    const seedRow = (snapshotSeedRow(seedFor(entity)) ?? {}) as Row;

    for (const field of undeclaredColumns(entity)) {
      // Typed from the SEEDED value where there is one, so a `typeof v ===
      // "number"` guard is actually reached rather than refusing a string for
      // the right reason and reading as clean.
      const probe = trespassProbeFor(seedRow[field]);
      probed += 1;
      const { row, threw } = await createWith(entity, { [field]: probe });
      // A loud refusal is agreement: the field did not land, and the writer said
      // so. Only a SILENT acceptance is a finding.
      if (threw !== undefined) continue;
      if (!row) {
        findings.push(`${entity}.${field}: the create stored no row at all — the base payload is not valid`);
        continue;
      }
      if (same(row[field], probe)) {
        findings.push(`${entity}.${field}: create stored the model's undeclared value ${JSON.stringify(probe)}`);
      }
    }

    expect(probed, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    expect(findings, `${findings.length} undeclared create writes`).toEqual([]);
  });

  it("update: an undeclared field does not move", async () => {
    const s = seedFor(entity);
    const findings: string[] = [];
    let probed = 0;

    const seedRow = (snapshotSeedRow(s) ?? {}) as Row;

    for (const field of undeclaredColumns(entity)) {
      const probe = trespassProbeFor(seedRow[field]);
      const { before, stored, threw } = await updateWith(entity, field, probe);
      probed += 1;
      if (threw !== undefined) continue;
      // ★★ The comparison is against the PROBE, not against "did the field
      //  change". `localModifiedAt` changes on every single replay — all eight
      //  writers stamp it unconditionally — so a movement test would fire on
      //  every entity and bury every real finding. Asserting the model's value
      //  did not land is sound for a writer-stamped field and for a guarded one
      //  alike.
      if (same(stored[field], probe)) {
        findings.push(
          `${entity}.${field}: update stored the model's undeclared value (was ${JSON.stringify(before[field])})`,
        );
      }
    }

    expect(probed, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    // ★★ No positive observable of this arm's own: a replay that wrote nothing
    //  passes every line here, and only Relation B's floor 2 — a SIBLING test,
    //  on the same `updateWith` harness — shows that the harness writes at all.
    expect(findings, `${findings.length} undeclared update writes`).toEqual([]);
    // Non-vacuity: the seed must actually exist, or every read-back above
    // compared undefined against a string and agreed.
    expect(Object.keys(s.seed).length, `${entity}: the SWEEP fixture seeds nothing`).toBeGreaterThan(0);
  });
});

// ★★★ THE ONE PROBE IN THIS FILE WITH A REAL-WORLD SIDE EFFECT.
//  `calendarEvent.sendInvitations` is DECLARED — it is in `calendarEventFields`
//  — so Relation B drives it, and `CALENDAR_EVENT_FIELD_GUARDS` accepts it. A
//  strict `true` trips `shouldStage` in `chat-proposal.ts`, which in production
//  mails the attendees. Whether a unit-test replay can actually send that mail
//  has NEVER BEEN ESTABLISHED — it is UNKNOWN, not known-safe, and the
//  difference is not worth finding out by accident.
//
//  ★★★ `validProbeFor` DERIVES THE BOOLEAN BRANCH AS `!current`, SO THE SAFETY
//   IS CONTINGENT ON A SEED VALUE IN ANOTHER FILE. `seedGuardedCalendarEvent`
//   holds `sendInvitations: true`, making the probe `false`. Flip that seed —
//   a one-token edit made for reasons having nothing to do with mail — and the
//   same loop drives `true` through the real dispatcher. This turns that
//   contingency into an assertion.
//
//  ★★ SITED OUTSIDE THE RELATION LOOP DELIBERATELY. A guard inside it would run
//   only on the iterations that reached this field, i.e. exactly the runs that
//   did not need protecting.
//
//  ★ Do NOT make a red run here green by special-casing the field in
//   `validProbeFor`. That un-sweeps it, trading a loud question for a silent
//   hole. Settle the mail question instead.
it("no Relation B probe drives calendarEvent.sendInvitations true", () => {
  const declared = declaredProperties("calendarEvent", "update");
  expect(
    declared,
    "`sendInvitations` left the declared surface — either it is genuinely unwritable now, or the schema narrowed and this guard has gone vacuous",
  ).toContain("sendInvitations");
  const seed = seedFor("calendarEvent");
  const row = (seed.seed as Record<string, ReadonlyArray<Row>>).calendarEvents?.find((r) => r.id === seed.id);
  expect(row, "the calendarEvent fixture no longer seeds the row this guard reads").toBeDefined();
  expect(
    validProbeFor("calendarEvent", "update", "sendInvitations", row!.sendInvitations),
    "a Relation B probe would drive calendarEvent.sendInvitations TRUE through the real dispatcher — the one write in this file that leaves the building. If the seed just changed, that is why you are reading this.",
  ).not.toBe(true);

  // ★★★ THE SECOND DERIVATION, WHICH THE ASSERTION ABOVE IS STRUCTURALLY BLIND
  //  TO. `validProbeFor` is the UPDATE arm's; the create arm re-derives through
  //  `probeAgainstControl` against the CONTROL row, and the control leaves this
  //  flag `undefined` — the writer stores it present-only-when-true — so the
  //  boolean rule `!control` yields exactly `true`. `MAIL_UNSAFE_BOOLEANS` is
  //  what stops it, and this line is what stops `MAIL_UNSAFE_BOOLEANS` from
  //  being deleted as dead weight: remove the entry and this goes red before
  //  any probe reaches the dispatcher.
  //
  //  ★★ `toBeUndefined`, not `not.toBe(true)`. `undefined` is the signal that
  //   the field keeps its seed-derived probe and stays classified `dead`; a
  //   `false` here would read as safe while quietly re-deriving the field.
  //
  //  ★ The control row is a LITERAL, not a dispatcher call. `probeAgainstControl`
  //   is pure, so pinning it needs no create — and a guard that had to run a
  //   create to prove a create is safe would be the wrong shape.
  expect(
    probeAgainstControl(
      "calendarEvent",
      "sendInvitations",
      row!.sendInvitations,
      { sendInvitations: undefined },
      previewNormalizerFor(INLINE_DESCRIPTORS.calendarEvent, "sendInvitations"),
    ),
    "the create arm's control-aware derivation would drive calendarEvent.sendInvitations TRUE — `MAIL_UNSAFE_BOOLEANS` is the only thing standing between this file and a real invitation",
  ).toBeUndefined();
});

/** What a Relation B finding can SAY, one member per finding template below.
 *  `dead` is shared by both arms: the derived probe cannot move the field. The
 *  update arm adds `unchanged` (a valid probe changed nothing and the card said
 *  nothing). The create arm adds `threw`, `no-row` and `dropped` for a probed
 *  field, and `control-threw` / `control-no-row` for the base create itself —
 *  the only two whose subject is the bare entity rather than `entity.field`.
 *
 *  ★ A `const` array and not only a union, so the ledger test in "the
 *  offered-surface axis" can check a kind at RUNTIME — vitest never typechecks,
 *  so a union alone would guard nothing while the suite runs. */
const FINDING_KINDS = ["control-threw", "control-no-row", "dead", "unchanged", "threw", "no-row", "dropped"] as const;
type FindingKind = (typeof FINDING_KINDS)[number];

/** One Relation B finding. `subject` + `kind` is all the verdict compares;
 *  `detail` is the full line a red run prints, and nothing compares it. */
type Finding = { subject: string; kind: FindingKind; detail: string };
type LedgerEntry = Pick<Finding, "subject" | "kind">;

/** Builds a finding whose `detail` is `${subject}: ${text}` — the exact line
 *  each template printed before the ledger was re-keyed. */
function finding(subject: string, kind: FindingKind, text: string): Finding {
  return { subject, kind, detail: `${subject}: ${text}` };
}

/**
 * ★★★ AN EXPECTED-FINDINGS LEDGER, CHECKED IN BOTH DIRECTIONS — AND NOT AN
 *  EXEMPTION LIST. Relation B compares the findings it computes against the
 *  entries here instead of against the empty list.
 *
 * ★★ WHY IT EXISTS. This sweep reports every field it cannot measure, or has
 *  recorded a decision about, as a FINDING rather than dropping it from the
 *  axis. On main that made it permanently red — measured 2026-09-11 at
 *  87566496: 73 tests, 5 failed, 6 finding lines, every one in Relation B and
 *  none of them a write-path defect — and `unit-tests` is a blocking CI job.
 *
 * ★★★ AN ENTRY IS A SUBJECT AND A KIND, NEVER A MESSAGE. `subject` is
 *  `entity.field` (the bare entity for the two control kinds) and `kind` is a
 *  member of `FINDING_KINDS`; the verdict compares `subject:kind` tokens and
 *  nothing else. The full line — the thrown message, the "sent X, stored Y" —
 *  is the `detail`, which the failure text prints and no assertion reads. The
 *  first cut of this ledger (eef92310) held those lines VERBATIM, so rewording
 *  a production error message (`use-chat-dispatcher.ts`'s "assigneeEmail is
 *  invalid") or editing a seed in `src/test/inline-sweep-fixtures.ts` turned
 *  the case red — and the cheap repair, pasting the new output in, is the
 *  exact reflex this ledger exists to refuse.
 *
 * ★★★ BOTH DIRECTIONS TURN THE CASE RED.
 *  - A finding NOT in the ledger. Treat it as a finding and take it to a
 *    go/cut; never add it here to make a run green.
 *  - A ledgered finding that STOPS firing. Delete its entry, and close or amend
 *    the register row it cites.
 *  So an entry stays while the same subject keeps producing the same KIND. A
 *  change of wording or of seed value does not move it; a change of kind does
 *  — `dropped` becoming `threw` on the same field is a different outcome and
 *  reds exactly as a new finding would. That is what stops this rotting into
 *  an exemption list: a fixed field cannot linger here unseen.
 *
 * ★★ WHAT IT DOES NOT CHANGE. Every field stays on the axis, is probed, and
 *  has its finding computed exactly as before; only the VERDICT reads the
 *  ledger. The exact `probed + dead` bound and floor 2 are untouched. Both
 *  sides are sorted before comparing, so finding order is irrelevant.
 *
 * ★★ EVERY ENTRY CITES A REGISTER ROW OR A RECORDED DECISION BESIDE IT. An
 *  entry with no citation is an exemption — delete it or give it one.
 *
 * ★ Keyed `entity:arm`, and `Partial` because most pairs expect nothing. The
 *  key type makes a typo a tsc error, but vitest does not typecheck, so "the
 *  offered-surface axis" repeats that check at runtime — for the key, for each
 *  entry's subject belonging to that key's entity, and for each kind.
 */
const EXPECTED_FINDINGS: Readonly<Partial<Record<`${InlineEntity}:${"create" | "update"}`, readonly LedgerEntry[]>>> = {
  "task:create": [
    // §459 — the string probe suffixes the seed email, which is then invalid; create refuses it loudly.
    { subject: "task.assigneeEmail", kind: "threw" },
  ],
  "resource:update": [
    // The recorded decision in `SYNTHETIC_INPUTS` (offered-surface-axis.ts): a convenience input the writer splits.
    { subject: "resource.name", kind: "unchanged" },
  ],
  "resource:create": [
    // The recorded decision in `SYNTHETIC_INPUTS` (offered-surface-axis.ts): a convenience input the writer splits.
    { subject: "resource.name", kind: "dropped" },
  ],
  "absence:create": [
    // §459 — the create-arm probe is derived from the SEED start, later than CREATE_BASE's end, so sanitizeAbsence swaps the two.
    { subject: "absence.startDate", kind: "dropped" },
  ],
  "calendarEvent:create": [
    // §443 — unmeasured by policy: a strict true would stage a real invitation.
    { subject: "calendarEvent.sendInvitations", kind: "dead" },
    // §443 — dead by construction: the HH:MM probe equals CREATE_BASE's own startTime.
    { subject: "calendarEvent.startTime", kind: "dead" },
  ],
};

function expectedFindings(entity: InlineEntity, arm: "create" | "update"): readonly LedgerEntry[] {
  return EXPECTED_FINDINGS[`${entity}:${arm}`] ?? [];
}

const tokenOf = (f: LedgerEntry): string => `${f.subject}:${f.kind}`;

/** The verdict both Relation B arms end on: sorted `subject:kind` tokens,
 *  compared in both directions. ★★ The message carries every actual finding's
 *  full `detail` — the only place the thrown message or the "sent X, stored Y"
 *  still appears — because a red run that printed tokens alone would send the
 *  reader to re-run the sweep by hand to learn what happened. */
function expectLedgerAgrees(entity: InlineEntity, arm: "create" | "update", findings: readonly Finding[]): void {
  const expected = expectedFindings(entity, arm).map(tokenOf).sort();
  const actualLines = findings.length > 0 ? findings.map((f) => `  [${f.kind}] ${f.detail}`) : ["  (none)"];
  expect(
    findings.map(tokenOf).sort(),
    [
      `${entity} ${arm}: findings differ from EXPECTED_FINDINGS — a new subject:kind is a finding (go/cut, never ledger it to go green); a missing one was fixed (delete its entry, close its register row)`,
      "actual findings:",
      ...actualLines,
      `expected: ${expected.length > 0 ? expected.join(", ") : "(none)"}`,
    ].join("\n"),
  ).toEqual(expected);
}

describe.each(ENTITIES)("Relation B — %s: a declared field must land or be visibly refused", (entity) => {
  // ★★★ THIS ARM IS NOT §436'S DETECTOR, AND AN EARLIER REVISION OF THIS
  //  COMMENT SAID IT WAS — "this relation reads the SCHEMA, which that table
  //  cannot move". The AXIS comes from the schema; the VERDICT does not. For
  //  `absence` and `calendarEvent` the descriptor's `rawTypeGuards` IS the
  //  write-side table (`ABSENCE_FIELD_GUARDS` / `CALENDAR_EVENT_FIELD_GUARDS`,
  //  the same object, `entity-descriptor.ts`), so narrowing a row there makes
  //  the PREVIEW reject the probe too, and this arm reads that disclosed
  //  refusal as agreement (the `refused` line below). It stays green over the
  //  very mutant §436 measured. The create arm is what catches it — the comment
  //  above that test says why, and what would take that away.
  it("update: every declared field moves, or the card says why not", async () => {
    const findings: Finding[] = [];
    let landed = 0;
    let probed = 0;
    let dead = 0;
    const seedRow = (snapshotSeedRow(seedFor(entity)) ?? {}) as Row;

    for (const field of declaredProperties(entity, "update")) {
      const probe = validProbeFor(entity, "update", field, seedRow[field]);
      if (same(probe, seedRow[field])) {
        dead += 1;
        findings.push(
          finding(`${entity}.${field}`, "dead", "the derived probe equals the stored value — it cannot move the field"),
        );
        continue;
      }
      probed += 1;
      const { before, stored, plan, threw } = await updateWith(entity, field, probe);

      // A refusal the card DISCLOSES is agreement — the guard worked and the
      // user was told. A throw is the loud form of the same thing.
      //
      // ★★ `rejectedFields` IS REUSED FROM THE FIXTURES MODULE RATHER THAN
      //  RE-DERIVED, and that matters: a rejection detail is not always
      //  `${field}=${value}` — a joint `requiredNonEmptyGroups` refusal is
      //  spelled `${a}+${b}=empty`, so a naive `startsWith(field + "=")` misses
      //  it. A MISSED rejection does not read as "no outcome" here; it reads as
      //  a field that was offered and silently did nothing, which is a
      //  fabricated finding in the direction that wastes the most time.
      const refused = threw !== undefined || rejectedFields(plan).includes(field);
      if (refused) continue;

      if (same(before[field], stored[field])) {
        findings.push(
          finding(
            `${entity}.${field}`,
            "unchanged",
            `declared and offered, but a valid ${JSON.stringify(probe)} changed nothing and the card said nothing`,
          ),
        );
        continue;
      }
      landed += 1;
    }

    // ★ EXACT, not a `>=` slack bound: `probed + dead` must account for every
    //  declared field. A slack bound cannot tell "the axis shrank" from "two
    //  probes came out dead", and those want opposite responses — the first is a
    //  schema change to investigate, the second a `validProbeFor` shape to fix.
    expect(probed + dead, `${entity}: Relation B did not reach every declared field`).toBe(
      AXIS_BASELINE[entity].declared,
    );
    // ★★★ FLOOR 2 — A POSITIVE OBSERVABLE PER ENTITY. Every branch above is
    //  satisfied by a replay that writes NOTHING: a missing `expectedToken`, a
    //  renamed tool, a wrapper that never mounts the provider each turn the
    //  whole entity green while proving nothing. This demands that some declared
    //  field, driven by some probe, actually moved.
    expect(landed, `${entity}: no declared field landed — the harness wrote nothing`).toBeGreaterThan(0);
    expectLedgerAgrees(entity, "update", findings);
  });

  // ★★★ THE CREATE ARM HAS NO REJECTION BRANCH, AND WRITING IT AS THOUGH IT DID
  //  IS THE TRAP THIS COMMENT EXISTS FOR. The create branch of
  //  `describeEntityCalls` pushes link diffs and a `plan.creates` entry and
  //  emits NO `rejected` entries whatever — `plan.rejected.push` appears five
  //  times in `plan.ts` and not one of them is in it. So there is nothing for a
  //  "or the card refused it" disjunct to fall through to, and this arm asserts
  //  LANDING ONLY.
  //
  //  ★★ THAT MAKES THE PROBE'S VALIDITY LOAD-BEARING in a way the update arm's
  //   is not. With no refusal channel, a guard correctly rejecting a bad value
  //   is indistinguishable from a lost capability. `validProbeFor` derives from
  //   the seed's own value for exactly this reason.
  //
  //  ★★★ IT IS ALSO WHY THIS ARM, AND ONLY THIS ARM, IS THE DETECTOR §436 ASKED
  //   FOR, in its own words: "something that asserts each allow-list still
  //   ADMITS the fields the tool schema advertises". §436 measured that
  //   narrowing `ABSENCE_FIELD_GUARDS.note` to `() => false` leaves
  //   `plan.write-path-sweep.test.ts` GREEN with per-entity violation counts
  //   byte-identical to a clean run, while the model loses the ability to write
  //   an absence note at all. The preview reads the same table object via
  //   `rawTypeGuards`, so both sides move together — which is why that sweep
  //   certifies itself, and why this relation's UPDATE arm does too (it counts
  //   the preview's refusal as a disclosed one; see the comment above it). On
  //   create the narrowed row drops the note, the card has no way to say so,
  //   and the field reads `dropped`. Measured 2026-09-11 against this file on
  //   the landing branch (product code = main at fe82d1db): 1 failed / 73, the
  //   absence create case only; the absence update case stays green.
  //
  //  ★★ SO THE DETECTOR RESTS ON A MISSING FEATURE. If the create card ever
  //   gains a refusal channel (§440), a narrowed allowlist row becomes a
  //   disclosed refusal on this arm too, and §436 has no detector left in this
  //   file — unless a "refused a valid probe" kind is added to `FINDING_KINDS`
  //   in the same change. Close §440 without that and this goes quietly green.
  //
  //  ★★★ SO THE PROBE IS DERIVED FROM THE SEEDED ROW OF THIS ENTITY, NOT FROM
  //   NOTHING, and passing `undefined` here would be the same defect the array
  //   branch of `validProbeFor` already records. A create has no CURRENT value
  //   by construction, so with `undefined` every array-typed declared field
  //   falls past that branch to the terminal `prop.type === "array"` fallback
  //   and gets `["probed"]` — a STRING in what is usually a list of numeric
  //   ids. A sanitizer that drops the non-numeric entry stores the array the
  //   writer would have stored anyway, and this arm reads that as "the create
  //   was offered the field and dropped it": a fabricated finding, and on the
  //   arm with no refusal channel to explain it away.
  //
  //   A seeded value cannot do that. It is type-correct because the fixture
  //   already proved it so, and referentially valid because every id inside it
  //   already exists in the store — so nothing can legitimately refuse it, and
  //   a failure to land is unambiguous. The rule is general: no per-field map,
  //   which would rot silently and is one rename from being an exemption list.
  //
  //  ★★ WHERE THE SEED CARRIES NO VALUE the derivation is left exactly as it is
  //   — a fabricated FOREIGN KEY is the one thing that must never be invented
  //   here, because a made-up id CAN be legitimately refused and that
  //   reintroduces the ambiguity above. If the fallback then yields a probe the
  //   created row would have held anyway, the honest outcome is that the field
  //   is DEAD to this arm and emits a `dead` finding — held in
  //   `EXPECTED_FINDINGS` with a citation, or turning this case red against it
  //   — not a value made up to move it.
  //
  //  ★★★ THE COMPARISON GOES THROUGH `previewNormalizerFor`, NOT AGAINST THE
  //   RAW PROBE. That is the production resolution order (descriptor entry →
  //   numeric coercion → verbatim), the same one the card renders with. A raw
  //   comparison reports a violation on every CORRECT write of a normalised
  //   field, which on the first cut of the update sweep was 6 of 35 "findings"
  //   — the harness, not the product.
  it("create: every declared field lands on the created row", async () => {
    const findings: Finding[] = [];
    let landed = 0;
    let probed = 0;
    let dead = 0;
    const s = seedFor(entity);
    const seedRow = (snapshotSeedRow(s) ?? {}) as Row;

    // ★★★ THE CONTROL CREATE — WHY THIS ARM NEEDS ONE AND THE UPDATE ARM DOES
    //  NOT. The update arm can ask `same(probe, seedRow[field])` and call the
    //  field DEAD when the probe equals the value already stored, because an
    //  update HAS a prior value for the probe to be indistinguishable from. A
    //  create has none by construction. So if the probe happens to equal the
    //  value the writer would have produced from `CREATE_BASE` ALONE, the
    //  landing comparison below agrees against a row the probe never moved, and
    //  the field reads as LANDED having proved nothing — the arm's own version
    //  of the vacuity `dead` exists to make visible.
    //
    //  ★★ THAT IS LIVE, NOT THEORETICAL — `calendarEvent.startTime` in
    //   `EXPECTED_FINDINGS` is exactly this. The seed holds "14:00", the HH:MM
    //   rule in `validProbeFor` maps anything but "09:00" onto "09:00", and
    //   `CREATE_BASE.calendarEvent` already supplies "09:00". A boolean negated
    //   off the SEED can land on the writer's own default the same way, which
    //   is what `probeAgainstControl` exists to re-derive. Nothing in this arm
    //   could tell that apart from a working write before this control
    //   existed, which is why every previously-clean verdict here was only as
    //   good as the probes behind it.
    //   ★ An earlier revision gave `""` as the example ("wherever the seed
    //    carries `""` the derived probe is `""`"), which is false:
    //    `validProbeFor` on an empty string falls through its type branches to
    //    `"probed"` for a string field.
    //
    //  ★★★ `dead` IS AN HONEST OUTCOME, NOT A FAILURE OF THE PRODUCT. It says
    //   the DERIVED PROBE cannot distinguish a working field from a broken one
    //   here — the same verdict `validProbeFor`'s array branch already records
    //   for an empty seed. Do NOT close one by inventing a value: a fabricated
    //   foreign key CAN be legitimately refused, and this arm has no refusal
    //   channel to explain that away. It is a `dead` finding, held in or
    //   turning red against `EXPECTED_FINDINGS`, exactly as the block comment
    //   above this test says it should be.
    //
    //  ★★ A THROWING CONTROL IS REPORTED, NEVER SWALLOWED. With no control row
    //   nothing can be classified `dead`, so every field stays `probed`, the
    //   exact bound below still holds, and the arm degrades — loudly — to what
    //   it was before this control existed.
    const control = await createWith(entity, {});
    if (control.threw !== undefined) {
      findings.push(
        finding(entity, "control-threw", `the control create THREW on the base payload alone — ${control.threw}`),
      );
    } else if (!control.row) {
      findings.push(finding(entity, "control-no-row", "the control create stored no row from the base payload alone"));
    }
    const controlRow = control.row;

    for (const field of declaredProperties(entity, "create")) {
      const normalize = previewNormalizerFor(INLINE_DESCRIPTORS[entity], field);
      const seeded = validProbeFor(entity, "create", field, seedRow[field]);

      // ★★ THROUGH THE SAME NORMALISER THE LANDING COMPARISON USES, and each
      //  side against ITS OWN row. A raw comparison here would let a probe the
      //  write path normalises ONTO the control's value count as live, so the
      //  field would "land" by agreeing with a value it never moved — the exact
      //  vacuity this control exists to close, reintroduced one layer up.
      //
      // ★★★ THE SECOND DERIVATION FIRES HERE AND NOWHERE ELSE — only once the
      //  seed-derived probe has been SHOWN dead against this entity's control.
      //  `probeAgainstControl` carries the rule and its safety argument; the
      //  one thing to keep in mind at this call site is that it returns
      //  `undefined` when it has nothing safe to offer, and the field then
      //  falls through to the `dead` branch below with its finding intact.
      const asBase = controlRow ? normalizedAs(controlRow[field], controlRow, normalize) : "";
      const probe =
        controlRow && normalizedAs(seeded, controlRow, normalize) === asBase
          ? (probeAgainstControl(entity, field, seedRow[field], controlRow, normalize) ?? seeded)
          : seeded;

      const subject = `${entity}.${field}`;
      if (controlRow && normalizedAs(probe, controlRow, normalize) === asBase) {
        dead += 1;
        findings.push(
          finding(
            subject,
            "dead",
            "the derived probe equals what the base create produces on its own — a landing here would prove nothing",
          ),
        );
        continue;
      }

      probed += 1;
      const { row, threw } = await createWith(entity, { [field]: probe });
      if (threw !== undefined) {
        findings.push(finding(subject, "threw", `create THREW on a valid ${JSON.stringify(probe)} — ${threw}`));
        continue;
      }
      if (!row) {
        findings.push(finding(subject, "no-row", "the create stored no row at all"));
        continue;
      }
      const shown = normalizedAs(probe, row, normalize);
      const actual = normalizedAs(row[field], row, normalize);
      if (shown !== actual) {
        findings.push(
          finding(
            subject,
            "dropped",
            `create was offered the field and dropped it — sent ${JSON.stringify(shown)}, stored ${JSON.stringify(actual)}`,
          ),
        );
        continue;
      }
      landed += 1;
    }

    // ★ EXACT, not a `>=` slack bound, mirroring the update arm. `probed + dead`
    //  must account for every declared field: a slack bound cannot tell "the
    //  axis shrank" from "two probes came out dead", and those want opposite
    //  responses — the first is a schema change to investigate, the second a
    //  `validProbeFor` shape or a `CREATE_BASE` that already supplies the value.
    expect(probed + dead, `${entity}: Relation B's create arm did not reach every declared field`).toBe(
      AXIS_BASELINE[entity].declared,
    );
    // Floor 2 again, for this arm. Every branch above is satisfied by a create
    // that stores nothing, and `!row` would then be the only signal — which
    // "the create base satisfies every schema-required field", in "the
    // offered-surface axis" above, already rules out for a different reason.
    expect(landed, `${entity}: no declared field landed on a created row`).toBeGreaterThan(0);
    expectLedgerAgrees(entity, "create", findings);
  });
});
