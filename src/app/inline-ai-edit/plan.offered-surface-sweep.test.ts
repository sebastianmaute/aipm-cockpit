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
  SYNTHETIC_INPUTS,
  undeclaredColumns,
} from "../../test/offered-surface-axis";
import { type Arm, type Compare, probeFor, type Row } from "../../test/sweep-probes";
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
    const stray = (["A", "B"] as const).flatMap((relation) =>
      Object.entries(LEDGERS[relation]).flatMap(([key, entries]) => {
        const [entity, arm, ...rest] = key.split(":");
        if (rest.length > 0 || !ENTITIES.some((e) => e === entity) || !(arm === "create" || arm === "update")) {
          return [`${relation} ${key} (no such entity:arm)`];
        }
        return (entries ?? [])
          .filter(
            (f) =>
              !(f.subject === entity || f.subject.startsWith(`${entity}.`)) ||
              !FINDING_KINDS.some((k) => k === f.kind),
          )
          .map((f) => `${relation} ${key} → ${f.subject}:${f.kind}`);
      }),
    );
    expect(stray, `ledger entries naming no real entity:arm, subject or kind: ${stray.join(", ")}`).toEqual([]);
  });
});

const SEED_BY_ENTITY = new Map<InlineEntity, SweepEntity>(SWEEP.map((s) => [s.entity, s]));

function seedFor(entity: InlineEntity): SweepEntity {
  const s = SEED_BY_ENTITY.get(entity);
  if (!s) throw new Error(`no SWEEP fixture for "${entity}" — the relations below cannot run`);
  return s;
}

/** The seeded row as the PROVIDER holds it after load — the reference both
 *  update arms derive against and judge against, and the seed both create arms
 *  fall back to. ★★ Never the fixture literal: the provider's load path can
 *  reshape a seeded value, and a probe derived from the literal would then be
 *  judged against a row the provider never held. */
function loadedSeedRow(entity: InlineEntity): Row {
  const s = seedFor(entity);
  const { result } = renderHook(() => useWorkspace(), { wrapper: dispatcherWrapperWith(s.seed) });
  const wsKey = INLINE_DESCRIPTORS[entity].wsKey as WsKey;
  const row = (snapshot(result.current)[wsKey] as ReadonlyArray<Row> | undefined)?.find((r) => r.id === s.id);
  if (!row) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);
  return row;
}

/** Relation B's comparison: through the card's own normaliser, so a correct
 *  write of a normalised field is not read as a change or a drop. */
function viaPreview(normalize: ((v: unknown, row: Record<string, unknown>) => string) | undefined): Compare {
  return (a, b, row) => normalizedAs(a, row, normalize) === normalizedAs(b, row, normalize);
}

/** Relation A's comparison: the model's LITERAL value, never its presence —
 *  which is what keeps the relation free of an exemption list for a column the
 *  writer itself fills. The two such columns are NOT alike, and which passes a
 *  guard removal could turn red differs:
 *  ★★ `localModifiedAt` is STAMPED — but on UPDATE only. All eight `update_*`
 *   writers put `localModifiedAt: new Date().toISOString()` LAST in their merge
 *   literal (`use-register-tools.ts`, `use-chat-dispatcher.ts`), so it
 *   overwrites whatever came before it; the update arm's pass on it therefore
 *   cannot go red under ANY guard removal, and certifies nothing. No `create_*`
 *   writer stamps it, so on the create arm it is held off by the
 *   `createInputWithoutId` strip (`chat-tools-updates.ts`) on five entities,
 *   by the allow-list guards on absence and calendarEvent, and by `createTask`
 *   naming its fields — and that pass CAN go red.
 *  ★★ `outlookEventId` is NOT stamped by any writer here (the Outlook push owns
 *   it). On raid, change and milestone it is never forwarded only because
 *   `patchWithoutId` / `createInputWithoutId` strip it, and their sanitizers
 *   keep whatever reaches them — so removing that strip turns Relation A red,
 *   on either arm. (Task never reaches either strip — `buildPatch` and
 *   `createTask` name their fields — and on absence and calendarEvent the
 *   allow-list guards drop it as well.) Measured on the create arm, with the
 *   trespass probes this file used before `probeFor`: the note above
 *   `createInputWithoutId` records that reverting the strip at any of its five
 *   deny-list call sites took this file to 1 failed, that entity's Relation A
 *   create case. ★ That names the CASE, not the field: on raid, change and
 *   milestone `localModifiedAt` lands through the same revert. The update arm
 *   is read from the code, not measured by mutant. */
const sameAt: Compare = (a, b) => same(a, b);

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
    const findings: Finding[] = [];
    let probed = 0;
    let skipped = 0;
    const control = await createWith(entity, {});
    const reference: Row = control.row ?? CREATE_BASE[entity];
    const seedRow = loadedSeedRow(entity);

    for (const field of undeclaredColumns(entity)) {
      const subject = `${entity}.${field}`;
      // ★★★ A PROBE THE COLUMN CAN HOLD, NOT A TRESPASS STRING. The relation
      //  asks whether the GUARD stops the model's value; a value the sanitizer
      //  refuses on its own proves nothing either way (§441). `probeFor` admits
      //  the probe through the create writer's sanitizer first, and a field it
      //  cannot admit is `unmeasured` — named in the ledger, never judged green.
      const outcome = probeFor({ entity, arm: "create", field, declared: false, reference, seedRow, compare: sameAt });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
      probed += 1;
      const { row, threw } = await createWith(entity, { [field]: probe });
      // A loud refusal is agreement: the field did not land, and the writer said so.
      if (threw !== undefined) continue;
      if (!row) {
        findings.push(finding(subject, "no-row", "the create stored no row at all — the base payload is not valid"));
        continue;
      }
      if (same(row[field], probe)) {
        findings.push(finding(subject, "stored", `create stored the model's undeclared value ${JSON.stringify(probe)}`));
      }
    }

    expect(probed + skipped, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    expectLedgerAgrees("A", entity, "create", findings);
  });

  it("update: an undeclared field does not move", async () => {
    const s = seedFor(entity);
    const findings: Finding[] = [];
    let probed = 0;
    let skipped = 0;
    const reference = loadedSeedRow(entity);

    for (const field of undeclaredColumns(entity)) {
      const subject = `${entity}.${field}`;
      const outcome = probeFor({ entity, arm: "update", field, declared: false, reference, seedRow: reference, compare: sameAt });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
      probed += 1;
      const { before, stored, threw } = await updateWith(entity, field, probe);
      if (threw !== undefined) continue;
      // ★★ The comparison is against the PROBE, not against "did the field
      //  change". `localModifiedAt` changes on every single replay — all eight
      //  writers stamp it unconditionally — so a movement test would fire on
      //  every entity and bury every real finding.
      if (same(stored[field], probe)) {
        findings.push(
          finding(subject, "stored", `update stored the model's undeclared value (was ${JSON.stringify(before[field])})`),
        );
      }
    }

    expect(probed + skipped, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    // ★★ No positive observable of this arm's own: a replay that wrote nothing
    //  passes every line here, and only Relation B's floor 2 — a SIBLING test,
    //  on the same `updateWith` harness — shows that the harness writes at all.
    expectLedgerAgrees("A", entity, "update", findings);
    // Non-vacuity: the seed must actually exist, or every read-back above
    // compared undefined against a string and agreed.
    expect(Object.keys(s.seed).length, `${entity}: the SWEEP fixture seeds nothing`).toBeGreaterThan(0);
  });
});

// ★★★ THE ONE PROBE IN THIS FILE WITH A REAL-WORLD SIDE EFFECT.
//  `calendarEvent.sendInvitations` is DECLARED, so Relation B would drive it,
//  and a strict `true` trips `shouldStage` in `chat-proposal.ts`, which in
//  production mails the attendees. Whether a unit-test replay can send that
//  mail has NEVER BEEN ESTABLISHED, and is not worth finding out by accident.
//
//  ★★★ STATED OVER THE ONE DERIVATION, AT EVERY REFERENCE A ROW CAN HOLD.
//   Only Relation B can reach a declared field — Relation A iterates
//   `undeclaredColumns` alone — and both of Relation B's arms take their
//   probe from `probeFor` and nothing else, so this covers every path a
//   probe of this field can take to the dispatcher — the hand-kept list of
//   derivations §443 warned about no longer exists to fall out of date. The
//   three references are the three states the flag can be stored in:
//   present-only-when-true means `undefined` is the create control's value.
//
//  ★★ SITED OUTSIDE THE RELATION LOOPS, so it runs even when no loop reaches
//   the field.
it("no probe drives calendarEvent.sendInvitations true", () => {
  expect(
    declaredProperties("calendarEvent", "update"),
    "`sendInvitations` left the declared surface — either it is genuinely unwritable now, or the schema narrowed and this guard has gone vacuous",
  ).toContain("sendInvitations");
  const seedRow = loadedSeedRow("calendarEvent");
  for (const arm of ["create", "update"] as const) {
    for (const sendInvitations of [undefined, false, true]) {
      const outcome = probeFor({
        entity: "calendarEvent",
        arm,
        field: "sendInvitations",
        declared: true,
        reference: { ...seedRow, sendInvitations },
        seedRow,
        compare: viaPreview(previewNormalizerFor(INLINE_DESCRIPTORS.calendarEvent, "sendInvitations")),
      });
      expect(
        outcome.kind,
        `a ${arm} probe at sendInvitations=${String(sendInvitations)} would reach the dispatcher — the one write in this file that leaves the building`,
      ).toBe("dead");
    }
  }
});

/** What a finding can SAY. `dead` — the harness cannot derive a
 *  distinguishable probe (nothing to derive from, it equals the reference, or
 *  mail safety). `unmeasured` — a probe was derived but the writer's sanitizer
 *  will not hold it unchanged, so neither relation may judge the field. Both
 *  are shared by every arm. Relation B's update arm adds `unchanged`; its
 *  create arm adds `threw`, `no-row` and `dropped` for a probed field and
 *  `control-threw` / `control-no-row` for the base create — the only two whose
 *  subject is the bare entity. Relation A adds `stored`: the model's
 *  undeclared value landed, which is a defect to FIX (plan Task 6), never to
 *  ledger.
 *
 *  ★ A `const` array and not only a union, so the ledger test in "the
 *  offered-surface axis" can check a kind at RUNTIME — vitest never typechecks,
 *  so a union alone would guard nothing while the suite runs. */
const FINDING_KINDS = [
  "control-threw",
  "control-no-row",
  "dead",
  "unmeasured",
  "unchanged",
  "threw",
  "no-row",
  "dropped",
  "stored",
] as const;
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
type LedgerKey = `${InlineEntity}:${Arm}`;
type Ledger = Readonly<Partial<Record<LedgerKey, readonly LedgerEntry[]>>>;

const EXPECTED_FINDINGS: Ledger = {
  "resource:update": [
    // §463 — a synthetic input (`SYNTHETIC_INPUTS.resource`, offered-surface-axis.ts): `sanitizeResource`
    // (sanitize-entities.ts) stores it as firstName/lastName, so no loaded row carries a `name` to derive a probe from.
    { subject: "resource.name", kind: "dead" },
  ],
  "resource:create": [
    // §463 — a synthetic input (`SYNTHETIC_INPUTS.resource`, offered-surface-axis.ts): `sanitizeResource`
    // (sanitize-entities.ts) stores it as firstName/lastName, so no loaded row carries a `name` to derive a probe from.
    { subject: "resource.name", kind: "dead" },
  ],
  "calendarEvent:update": [
    // mail-safety policy (§443); `probeFor` reports it dead.
    { subject: "calendarEvent.sendInvitations", kind: "dead" },
  ],
  "calendarEvent:create": [
    // mail-safety policy (§443); `probeFor` reports it dead.
    { subject: "calendarEvent.sendInvitations", kind: "dead" },
  ],
};

/** Relation A's ledger — the same both-directions contract as
 *  `EXPECTED_FINDINGS`, for the undeclared axis. It holds `dead` and
 *  `unmeasured` entries only: a `stored` finding is a live undeclared write,
 *  and is fixed rather than ledgered. Filled by plan Task 5 from a measured
 *  run (2026-09-11) — every entry below is `dead` or `unmeasured`; that run
 *  found no live undeclared write.
 *
 *  ★★ SHORT BECAUSE THE SEEDS CARRY THE COLUMNS. `probeFor` never invents a
 *  value, so a column the SWEEP seed left blank was `dead`: 72 of the 92
 *  undeclared field-and-arm pairs went unprobed, measured the same day, 63 of
 *  them `dead` and 9 `unmeasured`. Every sweep seed in
 *  `src/test/inline-sweep-fixtures.ts` now carries a value its entity's
 *  sanitizer holds unchanged for each undeclared column, bar the three named
 *  below as "not seeded", each with the reason a value would be unsafe or
 *  unholdable. Every remaining `unmeasured` entry is a probe SHAPE the seed
 *  cannot fix, or the task oracle's own envelope. Measured on the run that
 *  landed the seeds: no live undeclared write.
 *  ★★ Read task's 15 probed pairs per arm as a DIFFERENT guarantee from the
 *  other entities': no merge-site guard stands behind them. `createTask` and
 *  `update_task`'s `buildPatch` → `buildTaskCleanPatch` are allow-list writers,
 *  protected by the ABSENCE of code forwarding these columns — `seedGuardedTask`'s docstring in
 *  `src/test/inline-sweep-fixtures.ts` says so. */
const EXPECTED_UNDECLARED_FINDINGS: Ledger = {
  "task:create": [
    // §463 — not seeded: a `jiraKey` makes the seed task Jira-synced, and
    // `assertJiraManagedUnchanged` (chat-task-patch.ts) then throws on every
    // `status`/`assignee` change Relation B probes. Blank on the control row too.
    { subject: "task.jiraKey", kind: "dead" },
    // §463 — a harness limit, not the column: the task oracle's one-row
    // `jsonToWorkspace` envelope (`taskAtRest`, sweep-probes.ts) carries no
    // resources, so `migrateWorkspaceV5` backfills one from the assignee and
    // restamps `resourceId` to its minted id (sent 4, held 1).
    { subject: "task.resourceId", kind: "unmeasured" },
  ],
  "task:update": [
    // §463 — not seeded, for the create arm's reason above.
    { subject: "task.jiraKey", kind: "dead" },
    // §463 — the create arm's oracle-envelope restamp (sent 5, held 1).
    { subject: "task.resourceId", kind: "unmeasured" },
  ],
  "raid:create": [
    // §463 — not seeded, because no value is one the column can hold through
    // this oracle: `sanitizeRaidItem` stores no `noteLog` at all (the update
    // writer re-applies the stored log after it, §49). Seeding one would only
    // turn this `dead` into `unmeasured`. Blank on the control row too.
    { subject: "raid.noteLog", kind: "dead" },
  ],
  "raid:update": [
    // §463 — not seeded, for the create arm's reason above.
    { subject: "raid.noteLog", kind: "dead" },
  ],
  "change:create": [
    // §463 — not seeded, for raid's reason: `sanitizeChangeItem` stores no
    // `noteLog` (the update writer re-applies the stored log through
    // `withStoredNoteLog`). Blank on the control row too.
    { subject: "change.noteLog", kind: "dead" },
  ],
  "change:update": [
    // §463 — not seeded, for the create arm's reason above.
    { subject: "change.noteLog", kind: "dead" },
  ],
  "stakeholder:update": [
    // §463 — a probe SHAPE, not a seed: the derived probe changes the seeded
    // RACI code's own string leaf ("A" → "A probed"), which is not one of the
    // closed codes `coerceRaciMap` accepts, so `sanitizeStakeholder` reshapes
    // the map to `{}`. The enum branch of `probeFor` runs for a DECLARED
    // field's schema enum only, and `raci` is undeclared; a probe holding
    // another genuine RACI code (e.g. "R") would be held unchanged.
    { subject: "stakeholder.raci", kind: "unmeasured" },
  ],
  "resource:create": [
    // §463 — a probe SHAPE, not a seed: the control row's `utilizationMode` is
    // the "percent" default, so the derived probe is "percent probed", outside
    // the closed pair `sanitizeUtilizationMode` accepts; it maps anything but
    // "hours" to "percent". No schema enum exists to draw "hours" from.
    { subject: "resource.utilizationMode", kind: "unmeasured" },
  ],
  "resource:update": [
    // §463 — a probe SHAPE, not a seed: the seeded `active` is `false`, the
    // only value `sanitizeResource` stores (an absent key IS active), so the
    // one differing probe is `true`, which it never stores. Seeding `true`
    // instead is not a fix — it stores nothing, leaving the column blank and
    // the field `dead`.
    { subject: "resource.active", kind: "unmeasured" },
    // §463 — a probe SHAPE: the seeded "hours" becomes "hours probed", which
    // `sanitizeUtilizationMode` maps to "percent" (the create arm's reason).
    { subject: "resource.utilizationMode", kind: "unmeasured" },
  ],
};

const LEDGERS = { A: EXPECTED_UNDECLARED_FINDINGS, B: EXPECTED_FINDINGS } as const;

function expectedFindings(relation: "A" | "B", entity: InlineEntity, arm: Arm): readonly LedgerEntry[] {
  return LEDGERS[relation][`${entity}:${arm}`] ?? [];
}

const tokenOf = (f: LedgerEntry): string => `${f.subject}:${f.kind}`;

/** The verdict both Relation B arms end on: sorted `subject:kind` tokens,
 *  compared in both directions. ★★ The message carries every actual finding's
 *  full `detail` — the only place the thrown message or the "sent X, stored Y"
 *  still appears — because a red run that printed tokens alone would send the
 *  reader to re-run the sweep by hand to learn what happened. */
function expectLedgerAgrees(relation: "A" | "B", entity: InlineEntity, arm: Arm, findings: readonly Finding[]): void {
  const expected = expectedFindings(relation, entity, arm).map(tokenOf).sort();
  const actualLines = findings.length > 0 ? findings.map((f) => `  [${f.kind}] ${f.detail}`) : ["  (none)"];
  const ledgerName = relation === "A" ? "EXPECTED_UNDECLARED_FINDINGS" : "EXPECTED_FINDINGS";
  expect(
    findings.map(tokenOf).sort(),
    [
      `Relation ${relation} — ${entity} ${arm}: findings differ from ${ledgerName} — a new subject:kind is a finding (go/cut, never ledger it to go green); a missing one was fixed (delete its entry, close its register row)`,
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
    let skipped = 0;
    const reference = loadedSeedRow(entity);

    for (const field of declaredProperties(entity, "update")) {
      const subject = `${entity}.${field}`;
      const outcome = probeFor({
        entity,
        arm: "update",
        field,
        declared: true,
        reference,
        seedRow: reference,
        compare: viaPreview(previewNormalizerFor(INLINE_DESCRIPTORS[entity], field)),
      });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
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
            subject,
            "unchanged",
            `declared and offered, but a valid ${JSON.stringify(probe)} changed nothing and the card said nothing`,
          ),
        );
        continue;
      }
      landed += 1;
    }

    // ★ EXACT, not a `>=` slack bound: `probed + skipped` must account for every
    //  declared field. A slack bound cannot tell "the axis shrank" from "two
    //  probes came out dead", and those want opposite responses — the first is a
    //  schema change to investigate, the second a probe shape to fix or a column
    //  to decide.
    expect(probed + skipped, `${entity}: Relation B did not reach every declared field`).toBe(
      AXIS_BASELINE[entity].declared,
    );
    // ★★★ FLOOR 2 — A POSITIVE OBSERVABLE PER ENTITY. Every branch above is
    //  satisfied by a replay that writes NOTHING: a missing `expectedToken`, a
    //  renamed tool, a wrapper that never mounts the provider each turn the
    //  whole entity green while proving nothing. This demands that some declared
    //  field, driven by some probe, actually moved.
    expect(landed, `${entity}: no declared field landed — the harness wrote nothing`).toBeGreaterThan(0);
    expectLedgerAgrees("B", entity, "update", findings);
  });

  // ★★★ THE CREATE ARM HAS NO REJECTION BRANCH, AND WRITING IT AS THOUGH IT DID
  //  IS THE TRAP THIS COMMENT EXISTS FOR. The create branch of
  //  `describeEntityCalls` pushes link diffs and a `plan.creates` entry and
  //  emits NO `rejected` entries whatever. A grep count cannot certify that
  //  (§440): one `plan.rejected.push` sits in `pushLinkDiffs`, which the create
  //  branch DOES call. It stays silent there because the create call passes
  //  no `toolName`: since §460 the guard itself runs on a create too, so a
  //  refused link is OMITTED from the card rather than reported. So there is
  //  nothing for a "or the card refused it" disjunct to fall through to, and
  //  this arm asserts LANDING ONLY.
  //
  //  ★★ THAT MAKES THE PROBE'S VALIDITY LOAD-BEARING in a way the update arm's
  //   is not. With no refusal channel, a guard correctly rejecting a bad value
  //   is indistinguishable from a lost capability. `probeFor` derives from
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
  //  ★★★ SO EVERY PROBE IS ADMITTED BEFORE IT IS JUDGED. `probeFor` puts the
  //   probe through this entity's create-writer sanitizer first
  //   (`ADMISSION_ORACLE`, `src/test/sweep-probes.ts`); a probe the sanitizer
  //   would not hold unchanged is `unmeasured` and never reaches this arm's
  //   verdict. So a `dropped` here is a value the column CAN hold and the create
  //   did not keep — never a probe the sanitizer was always going to refuse.
  //   Nothing is invented: a field with no value to derive from is `dead`.
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
    let skipped = 0;
    const seedRow = loadedSeedRow(entity);

    // ★★★ THE CONTROL CREATE — WHY THIS ARM NEEDS ONE AND THE UPDATE ARM DOES
    //  NOT. The update arm's `probeFor` call derives against the very row it
    //  will judge against and calls the field DEAD when the derived probe
    //  equals it, because an update HAS a prior value for the probe to be
    //  indistinguishable from. A create has none by construction. So if the
    //  probe happens to equal the value the writer would have produced from
    //  `CREATE_BASE` ALONE, the landing comparison below agrees against a row
    //  the probe never moved, and the field reads as LANDED having proved
    //  nothing — the arm's own version of the vacuity `dead` exists to make
    //  visible.
    //
    //  ★★ `probeFor` derives against THIS row and judges against it, so a probe
    //   can no longer be derived against the seed and land on a value the base
    //   payload already produces — which is how `calendarEvent.startTime` and
    //   `absence.startDate` sat in the ledger until the typed-probe slice.
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
    // The reference the probe is derived and judged against. With no control
    // row (already reported above) the base payload is the nearest honest
    // stand-in, so derivation and admission still mean something.
    const reference: Row = controlRow ?? CREATE_BASE[entity];

    for (const field of declaredProperties(entity, "create")) {
      const normalize = previewNormalizerFor(INLINE_DESCRIPTORS[entity], field);
      const subject = `${entity}.${field}`;
      const outcome = probeFor({
        entity,
        arm: "create",
        field,
        declared: true,
        reference,
        seedRow,
        compare: viaPreview(normalize),
      });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
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

    // ★ EXACT, not a `>=` slack bound, mirroring the update arm. `probed +
    //  skipped` must account for every declared field: a slack bound cannot
    //  tell "the axis shrank" from "two probes came out dead", and those want
    //  opposite responses — the first is a schema change to investigate, the
    //  second a probe shape to fix or a column to decide.
    expect(probed + skipped, `${entity}: Relation B's create arm did not reach every declared field`).toBe(
      AXIS_BASELINE[entity].declared,
    );
    // Floor 2 again, for this arm. Every branch above is satisfied by a create
    // that stores nothing, and `!row` would then be the only signal — which
    // "the create base satisfies every schema-required field", in "the
    // offered-surface axis" above, already rules out for a different reason.
    expect(landed, `${entity}: no declared field landed on a created row`).toBeGreaterThan(0);
    expectLedgerAgrees("B", entity, "create", findings);
  });
});
