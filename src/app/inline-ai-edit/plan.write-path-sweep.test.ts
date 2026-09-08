// src/app/inline-ai-edit/plan.write-path-sweep.test.ts
//
// THE MECHANICAL SWEEP over the inline-AI-edit write path, and the deliberate
// sibling of `plan.write-path.test.ts`.
//
// ★★★ THE TWO ARE NOT MERGED, AND MERGING THEM BACK IS A REGRESSION. That file
// is narrow and DEEP: each of its cases names a specific defect, and that name
// is what a red run tells you ("a refused category leaves the coupled status
// alone"). This file is broad and MECHANICAL: it names nothing and enumerates
// everything, so a red run here says an ENTITY's coverage moved rather than
// which behaviour broke. Folded together they would trade a legible failure for
// a uniform one — a case-shaped assertion buried in a `describe.each` over eight
// entities reads as "the sweep is red" and costs a bisect to get back the name
// the split gives away for free.
//
// ★★ THE COST WAS PAID KNOWINGLY. A third `environment: "jsdom"` test file is
// roughly 25-30s of environment setup that the merged file did not pay, and it
// was accepted in exchange for headroom: the combined file stood at 1354 lines
// against the 1600 `LIMIT` in `scripts/check-file-sizes.mjs` (it is not
// baselined, so the limit alone governs it) with a probe layer and three parity
// relations still to land. Do not "helpfully" re-merge them to win the setup
// back — the next slice would immediately breach the ratchet, and the ratchet is
// the thing that forced this split in the first place.
//
// It exists for the gap between the two detectors that already existed:
// `plan.sanitizer-parity.test.ts` is exhaustive and shallow (it compares the
// preview against each field's SANITIZER, so it cannot see a merge-site guard
// it does not compose), and the `CASES` in `plan.write-path.test.ts` are narrow
// and deep. The gap is a divergence at a layer the sanitizer cannot show, in a
// field nobody wrote a case for — which is `docs/open-followups.md` §394 and
// §418.
//
// ★ Everything it drives lives in `src/test/inline-sweep-fixtures.ts`, shared
// with its sibling so the two suites cannot seed different rows and disagree
// about what was covered. The docstrings there are load-bearing; read them
// before touching a seeded value.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import {
  AXIS_FIELDS,
  JUNK_KEY,
  type Row,
  same,
  snapshot,
  SWEEP,
  type SweepEntity,
  sweepPlumbing,
  sweptFields,
} from "../../test/inline-sweep-fixtures";
import { entityToken, TOKEN_EXCLUDED } from "../ai-entity-token";
import { TOKEN_ROW_SOURCE } from "../chat-proposal-apply";
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";
import { emptyWorkspace, type Workspace } from "../workspace";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { describeEntityCalls, type EditPlan } from "./plan";

describe("the sweep's own coverage", () => {
  // ★★ THE ONE MAINTAINED THING IN THE SWEEP, AND ITS GUARD. A new FIELD is
  //  covered the moment it exists, because the axis is derived at runtime. A new
  //  ENTITY is not — nothing would enumerate it — so the table is asserted exact
  //  rather than merely non-empty. `plan.sanitizer-parity.test.ts` uses the same
  //  trick on its own CASES; copying it is deliberate.
  it("has a row for every INLINE_DESCRIPTORS entity, and no others", () => {
    expect(SWEEP.map((s) => s.entity).sort()).toEqual(Object.keys(INLINE_DESCRIPTORS).sort());
  });

  // ★★★ THE GUARD AGAINST A FABRICATED CLEAN, and it is not hypothetical: the
  //  first cut of this table carried `id: 7` for the resource row against a
  //  seed that mints 4. Nothing consumed it yet, so every gate was green. Had
  //  the sweep landed on top of it, that entity would have reported perfect
  //  preview/write agreement over a row the fixture never wrote — the sweep
  //  would have certified itself across one of eight entities.
  //  An id is the ONE column production code cannot supply, so it is the one
  //  that needs a positive observable rather than a derivation.
  it("seeds the row each entity claims to drive", () => {
    const missing = SWEEP.filter((s) => {
      const { wsKey } = sweepPlumbing(s.entity);
      const rows = (s.seed as Record<string, readonly { id: number }[] | undefined>)[wsKey];
      return !rows?.some((r) => r.id === s.id);
    }).map((s) => `${s.entity}#${s.id}`);
    expect(missing).toEqual([]);
    // Anti-vacuity: prove the check above ran over a non-empty set, so a seed
    // shape change that silently emptied SWEEP could not read as agreement.
    expect(SWEEP.length).toBe(Object.keys(INLINE_DESCRIPTORS).length);
  });

  // ★★★ THE GENERAL FORM OF THE SEED HOLE, across all eight entities. A probe
  //  on a field the seed left absent or blank compares the refusal against
  //  nothing and scores AGREEMENT — the sweep would certify the very divergence
  //  it exists to find. `seedGuardedTask` was written because the task row had
  //  this hole in `group` and `labels`; this assertion is what stops the next
  //  entity from acquiring it silently.
  //
  //  ★★★ IT ITERATES THE WHOLE `sweptFields` AXIS, NOT `diffFields`. That is not
  //   a widening at the margin: `diffFields` and `linkFields` are DISJOINT by
  //   construction, so the narrow form could not see a single FK or relationship
  //   array on any entity, nor anything reaching the axis through the §418
  //   stored-row half. Every hole it was silent on fell in exactly those two
  //   classes — the FKs (`resource.roleId` null, `absence.resourceId` absent),
  //   the id lists (`[]` on raid, change, milestone and the meeting's
  //   attendees) and the maps (`stakeholder.raci`, `resource.utilization`, both
  //   `{}`). NO TALLY IS QUOTED: every seed edit moves it. Reproduce by
  //   reverting a seed value and reading the names this test prints.
  //
  //  ★★★ AN EMPTY ARRAY IS A HOLE, AND THE COMMENT THAT SAID OTHERWISE WAS HALF
  //   RIGHT. It read: "a link list that starts empty still distinguishes refused
  //   from stored, because a successful write makes it non-empty." That is true
  //   of the ACCEPT direction and FALSE of the CLEAR direction — every id list
  //   here is assigned UNCONDITIONALLY (`sanitizeIdList`, `sanitizeMilestone-
  //   TaskIds`, `sanitizeAttendees(v) ?? []`), so a REFUSED clear stores `[]`,
  //   which against an empty seed is the value already there. The seeds now
  //   carry non-empty lists instead of the blind spot being recorded.
  //  ★★ `{}` is the same argument for a MAP (`raci`, `utilization`,
  //   `absenceOverride`): `coerceRaciMap`/`coercePeriodMap` return `{}` for
  //   anything unrecognised, so an empty seed is the refusal's own output.
  //
  //  ★★ WHAT THIS CANNOT SEE, and it is not a small residue: an ENUM or a
  //   SCALAR sitting on its sanitizer's fallback is a hole of exactly the same
  //   kind and is indistinguishable from a legitimate value here — nothing in
  //   this loop knows that `"percent"` is `sanitizeUtilizationMode`'s default or
  //   that `"Other"` is `sanitizeStakeholder`'s. Those are held by hand, in each
  //   `seedGuarded*` docstring, and `resource.utilizationMode` was one of them.
  it("seeds a distinguishable value for every swept field", () => {
    const holes: string[] = [];
    for (const s of SWEEP) {
      const { wsKey } = sweepPlumbing(s.entity);
      const rows = (s.seed as Record<string, readonly Record<string, unknown>[] | undefined>)[wsKey];
      const row = rows?.find((r) => r.id === s.id);
      if (!row) continue; // the seeded-row test above owns that failure
      for (const field of sweptFields(s.entity, row)) {
        const v = row[field];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
        if (empty) holes.push(`${s.entity}.${field}`);
      }
    }
    expect(holes).toEqual([]);
  });

  // Every entity must be REPLAYABLE. `sweepPlumbing` throws on a tool with no
  // TOKEN_ROW_SOURCE entry, so this is the assertion that turns "we never ran
  // it" into a red rather than into silence.
  it("derives replayable plumbing for every entity from production declarations", () => {
    for (const s of SWEEP) {
      const { tool, kind, wsKey } = sweepPlumbing(s.entity);
      expect(tool).toBe(INLINE_DESCRIPTORS[s.entity].updateTool);
      expect(wsKey).toBe(INLINE_DESCRIPTORS[s.entity].wsKey);
      expect(TOKEN_ROW_SOURCE[tool].kind).toBe(kind);
    }
  });

  // ★★ WHAT THIS FORBIDS IS A SWEEP OVER A STARVED AXIS, which passes
  //  everything it does not run. The recorded sets are PER ENTITY so one rich
  //  entity cannot carry a narrowed one, and each names its members rather than
  //  counting them — see `AXIS_FIELDS` for why a count and a flat floor were
  //  both rejected.
  it.each(SWEEP)("$entity sweeps every field its recorded axis names", ({ entity, id, seed }) => {
    // `wsKey` is DERIVED — it is not a field on SweepEntity. See sweepPlumbing.
    const { wsKey } = sweepPlumbing(entity);
    const ws = { ...emptyWorkspace(), ...seed } as unknown as Workspace;
    const rows = ws[wsKey] as ReadonlyArray<{ id: number }> | undefined;
    const before = rows?.find((r) => r.id === id);
    expect(before, `fixture did not seed ${wsKey} #${id}`).toBeDefined();
    const fields = sweptFields(entity, before as unknown as Record<string, unknown>);
    // A SUBSET check, so growth is free and only a shrink is red. Reported as
    // the missing NAMES rather than as two numbers: a count says an axis moved,
    // a name says which field stopped being swept.
    const dropped = AXIS_FIELDS[entity].filter((f) => !fields.includes(f));
    expect(
      dropped,
      `${entity} no longer sweeps ${dropped.join(", ")} — a SHRINKING axis un-sweeps fields silently`,
    ).toEqual([]);
    expect(fields).not.toContain("id");
    expect(fields).not.toContain(JUNK_KEY);
  });
});

// --- the probe layer --------------------------------------------------------

/** The seeded row exactly as the fixture LITERAL declares it — before any
 *  sanitizer has touched it.
 *
 *  ★★ RIGHT SOURCE FOR CHOOSING A PROBE, WRONG ONE FOR JUDGING A WRITE, and the
 *  split is the same one `AXIS_FIELDS` documents about itself. A probe only
 *  needs the field's TYPE, which survives the sanitizer; every read-back
 *  comparison below instead reads `before` out of `replayOneField`, which is the
 *  provider's own post-write row. Judging a write against this literal would
 *  compare the stored row to something the provider never held. */
function seedRowOf(s: SweepEntity): Row {
  const { wsKey } = sweepPlumbing(s.entity);
  const ws = { ...emptyWorkspace(), ...s.seed } as unknown as Workspace;
  const rows = ws[wsKey] as ReadonlyArray<{ id: number }> | undefined;
  const found = rows?.find((r) => r.id === s.id);
  if (!found) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);
  return found as Row;
}

/** The value probes for one field, DERIVED from its stored value's type rather
 *  than listed per field — so a new field is probed the moment it exists and
 *  nothing has to be maintained when a descriptor or a seed grows.
 *
 *  ★★ DELIBERATELY NARROWER THAN `plan.sanitizer-parity.test.ts`'s ten-probe
 *  list, and the reason is cost, not principle: every probe here is a full
 *  `renderHook` mount plus an `act`, where that file's is a function call. The
 *  breadth over TEXT shapes (surrogate straddles, length caps, CRLF) is that
 *  sweep's job at the sanitizer layer. This one exists for the LAYER, not the
 *  value space — so it probes each type just widely enough to move the field,
 *  plus one wrong-type probe to reach the merge-site guard.
 *
 *  ★★★ EVERY PROBE MUST DIFFER FROM THE STORED VALUE, AND MOST OF THEM HOLD
 *  THAT BY ASSERTION RATHER THAN BY CONSTRUCTION. A probe equal to what is
 *  already stored cannot move the field, so every parity relation over it is
 *  trivially satisfiable — a green that means nothing ran. "every probe can move
 *  the field it is aimed at" below is what enforces it against the fixed
 *  literals here, and it is not theoretical: the plan this table came from
 *  shipped TWO dead probes, and both were found by running that assertion, not
 *  by reading the table.
 *   • the `null` branch returned `{ label: "an explicit null", value: null }`
 *     for a field whose stored value IS `null`. An explicit null is a good CLEAR
 *     probe against a NON-null field and a dead one here; if it is wanted, it
 *     belongs in the other branches.
 *   • the number branch led with the literal `3`, and `seedGuardedRaid` seeds
 *     `probability: 3`. That one is now derived from the stored value, because a
 *     collision a seed can reintroduce at any time is better closed by
 *     construction than re-caught by a test.
 *
 *  ★ `-1` and the string literals stay literal on purpose. Deriving everything
 *  would leave the assertion above with nothing live to guard, and a guard that
 *  cannot fire reads as protection while being none. No seed carries them today;
 *  the day one does, the assertion names the field. */
function probesFor(current: unknown): ReadonlyArray<{ label: string; value: unknown }> {
  if (typeof current === "boolean") {
    return [
      { label: "the opposite boolean", value: !current },
      { label: "a non-boolean string", value: "yes" },
    ];
  }
  if (typeof current === "number") {
    return [
      { label: "one more than the stored number", value: current + 1 },
      { label: "a negative number", value: -1 },
      { label: "a numeric string", value: "7" },
    ];
  }
  if (Array.isArray(current)) {
    return [
      { label: "an empty array", value: [] },
      { label: "a non-array string", value: "nope" },
    ];
  }
  if (current === null) {
    return [
      { label: "a plain number", value: 1 },
      { label: "a plain string", value: "nope" },
    ];
  }
  // string, undefined, or an object-valued field (recurrence).
  return [
    { label: "a padded string", value: "  padded  " },
    { label: "the empty string", value: "" },
    { label: "the number 42", value: 42 },
  ];
}

/** Preview ONE field's probe and REPLAY it through the real dispatcher.
 *
 *  ★★ A near-copy of `previewAndWrite` in `plan.write-path.test.ts`, and
 *  deliberately not folded into it: that one takes a whole hand-written case
 *  with an `expectStored` map, this one takes one field and returns raw rows for
 *  the caller to relate. Merging them would need a union parameter and would
 *  make the hand-written cases harder to read, which is the thing they are for.
 *
 *  ★★★ IT RETURNS THE ROWS RAW AND FILTERS NOTHING, WHICH IS THE POINT OF THE
 *  SHAPE. `localModifiedAt` is stamped unconditionally by all eight writers and
 *  is `TOKEN_EXCLUDED` on all eight, so it moves on every single replay while
 *  the model's patch can never carry it — a caller relating "moved" to
 *  "previewed" has to subtract the writer-stamped set itself. Doing that
 *  subtraction HERE would hide a real undisclosed write behind a helper nobody
 *  re-reads, so the helper hands back `before` and `stored` untouched and each
 *  caller states which fields it excluded and why.
 *
 *  ★★ `expectedToken` is stamped from the STORED row, exactly as
 *  `chat-proposal-apply.ts` does it. Without it `requireToken` refuses the call,
 *  every read-back compares a row against itself, and the sweep reports perfect
 *  agreement while never having written anything. */
async function replayOneField(
  s: SweepEntity,
  field: string,
  probe: unknown,
): Promise<{ plan: EditPlan; before: Row; stored: Row }> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith(s.seed) },
  );

  // `tool`, `kind` and `wsKey` are DERIVED, never fields on `s` — see the
  // `sweepPlumbing` docstring for why hand-copying them is banned.
  const { tool, kind, wsKey } = sweepPlumbing(s.entity);

  const wsBefore = snapshot(result.current.ws);
  const rowsBefore = wsBefore[wsKey] as ReadonlyArray<{ id: number }> | undefined;
  const before = rowsBefore?.find((r) => r.id === s.id) as Row | undefined;
  if (!before) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);

  const input: Record<string, unknown> = { id: s.id, [field]: probe };

  const plan = describeEntityCalls([{ type: "tool_use", name: tool, input }], {
    descriptor: INLINE_DESCRIPTORS[s.entity],
    item: before,
    ws: wsBefore,
  });

  await act(async () => {
    await runTool(result.current.d, tool, { ...input, expectedToken: entityToken(kind, before) });
  });

  const wsAfter = snapshot(result.current.ws);
  const rowsAfter = wsAfter[wsKey] as ReadonlyArray<{ id: number }> | undefined;
  const stored = rowsAfter?.find((r) => r.id === s.id) as Row | undefined;
  if (!stored) throw new Error(`${wsKey} #${s.id} vanished during the replay`);

  return { plan, before, stored };
}

beforeEach(() => {
  // The minter is module-scoped; nothing here creates, but resetting keeps this
  // file order-independent under `npm run test:shuffle`.
  resetMintState();
});

describe("the probe layer", () => {
  // ★★★ THE PROBE SET'S OWN ANTI-VACUITY GUARD, and the reason `probesFor` is
  //  allowed to hold fixed literals at all. A probe equal to the value already
  //  stored cannot move the field, and a field that never moves satisfies every
  //  parity relation the sweep will build on top of it — so a dead probe does
  //  not weaken a finding, it manufactures a clean one. Both dead probes this
  //  caught are named in the `probesFor` docstring; neither was visible by
  //  reading the table.
  //
  //  ★★ IT READS THE SEED LITERAL, NOT A READ-BACK, which is sound here and
  //   would not be for a write assertion: a probe is chosen by the field's TYPE
  //   and the type survives the sanitizer. `seedRowOf` carries the split.
  it.each(SWEEP)("$entity — every probe can move the field it is aimed at", (s) => {
    const row = seedRowOf(s);
    const dead: string[] = [];
    const starved: string[] = [];
    let examined = 0;
    for (const field of sweptFields(s.entity, row)) {
      const probes = probesFor(row[field]);
      examined += probes.length;
      // TWO is the design floor, not a round number: each branch owes at least
      // one probe that moves the field plus one wrong-type probe that reaches
      // the merge-site guard. A branch cut to one silently drops one of those.
      if (probes.length < 2) starved.push(`${s.entity}.${field} (${probes.length})`);
      for (const p of probes) {
        if (same(p.value, row[field])) dead.push(`${s.entity}.${field} <- ${p.label}`);
      }
    }
    expect(
      dead,
      `a probe equal to the stored value cannot move the field, so every relation over it is trivially satisfiable: ${dead.join(", ")}`,
    ).toEqual([]);
    expect(starved, `a field probed fewer than twice has lost a branch: ${starved.join(", ")}`).toEqual([]);
    // Anti-vacuity: both lists above are empty over an EMPTY axis too. Tied to
    // the recorded axis rather than to `> 0`, so a scan that silently narrowed
    // to a couple of fields is red rather than green.
    expect(examined, `${s.entity}: the probe scan ran over a starved axis`).toBeGreaterThanOrEqual(
      2 * AXIS_FIELDS[s.entity].length,
    );
  });

  // ★★★ THE ONE PROBE VALUE IN THIS FILE WITH A REAL-WORLD SIDE EFFECT, AND THE
  //  ASSERTION THAT KEEPS IT UNSENT. `calendarEvent.sendInvitations` is a LIVE
  //  target of the replay loop below: it is NOT token-excluded
  //  (`TOKEN_EXCLUDED.calendarEvent` is `localModifiedAt` and `outlookEventId`
  //  only) and `CALENDAR_EVENT_FIELD_GUARDS` actively accepts it, so that loop's
  //  skip does not cover it. A strict `true` is what trips `shouldStage` in
  //  `chat-proposal.ts`, which in production mails the attendees. Whether a
  //  unit-test replay can actually send that mail has NEVER BEEN ESTABLISHED —
  //  it is UNKNOWN, not known-safe, and this guard exists because the difference
  //  is not worth finding out by accident.
  //
  //  ★★★ IT WAS CONTINGENT ON A SEED VALUE AND IS NOW ENFORCED, which is the
  //   whole reason this test exists rather than a comment. `probesFor` derives
  //   the boolean branch as `!current`, and `seedGuardedCalendarEvent` happens to
  //   hold `sendInvitations: true` — so the probe is `false` and the wrong-type
  //   probe is the string `"yes"`, which the guard rejects. Flip that seed to
  //   `false` and the same loop drives `true` through the real dispatcher. That
  //   is a one-token edit in another file, made for reasons having nothing to do
  //   with mail, and nothing would have gone red.
  //
  //  ★★ IT IS SITED OUTSIDE THE REPLAY LOOP DELIBERATELY. That loop `break`s at
  //   the first field that moves, so on a good day it never reaches this field
  //   at all — a guard placed inside it would protect only the runs that did not
  //   need protecting.
  //
  //  ★ Do NOT make a red run here green by narrowing `probesFor` for this field.
  //   That un-sweeps it, trading a loud question for a silent hole. Settle the
  //   mail question instead.
  it("no probe drives calendarEvent.sendInvitations true — the one write that leaves the building", () => {
    const s = SWEEP.find((e) => e.entity === "calendarEvent");
    if (!s) throw new Error("the sweep no longer carries a calendarEvent entity, so this guard protects nothing");
    const row = seedRowOf(s);
    // Non-vacuity: the guard means something only while the field is still on
    // the axis the replay loop walks. A field that left the axis is the event
    // worth a human look, so it is RED here rather than quietly unguarded.
    expect(
      sweptFields("calendarEvent", row),
      "`sendInvitations` left the swept axis — either it is genuinely unwritable now, or the axis narrowed and this guard has gone vacuous",
    ).toContain("sendInvitations");
    const drives = probesFor(row.sendInvitations)
      .filter((p) => p.value === true)
      .map((p) => p.label);
    expect(
      drives,
      `a probe would drive calendarEvent.sendInvitations TRUE through the real dispatcher (${drives.join(", ")}). ` +
        "That is the one write in this file with a real-world side effect — `true` trips `shouldStage` and mails the " +
        "attendees in production — and whether a unit-test replay can send that mail has never been established. " +
        "The safety was previously CONTINGENT on `seedGuardedCalendarEvent` holding `true` rather than enforced, " +
        "which is what this assertion replaced; if that seed just changed, that is why you are reading this.",
    ).toEqual([]);
  });

  // ★★★ THE FLOOR THE WHOLE SWEEP RESTS ON. Everything Task 5 relates —
  //  "previewed ⇒ stored", "rejected ⇒ unchanged" — is satisfied by a replay
  //  that writes NOTHING. A missing `expectedToken`, a renamed tool, a wrapper
  //  that never mounts the provider: each one turns the sweep green across all
  //  eight entities while proving nothing, and no other assertion in either file
  //  can tell that apart from real agreement. This one demands a POSITIVE
  //  observable per entity: some swept field, driven by some probe, actually
  //  changed in the row the provider holds.
  //
  //  ★★ TOKEN-EXCLUDED FIELDS ARE SKIPPED, and skipping them is what makes the
  //   observation mean anything. `patchWithoutId` strips them from every model
  //   patch, so the writer cannot move them THROUGH THE PATCH — while
  //   `localModifiedAt`, which every writer stamps unconditionally, changes on
  //   every replay regardless. Left in, the first field tried would "move" on
  //   all eight entities and this floor would certify a sweep that writes
  //   nothing, which is precisely the failure it exists to prevent.
  //
  //  ★★★ `calendarEvent.sendInvitations` IS A LIVE PROBE TARGET OF THIS LOOP,
  //   AND IT IS THE ONE FIELD HERE WITH A REAL-WORLD SIDE EFFECT — the skip
  //   above does not cover it. What keeps this loop from driving the mailing
  //   value is the test IMMEDIATELY ABOVE ("no probe drives
  //   calendarEvent.sendInvitations true"), not anything in this block and no
  //   longer a seed value that happens to cooperate. Read that test's comment
  //   before changing `probesFor`, this loop's field order, or the calendar
  //   seed.
  //
  //  ★★ THE JUNK-KEY HALF IS AN ABSENCE CLAIM AND IS DELIBERATELY IN THE SAME
  //   TEST AS THE POSITIVE ONE. "a key no schema declares never lands" passes
  //   just as well when the replay wrote nothing at all, so it is worthless
  //   standing alone; pairing it with the moved-field observation for the same
  //   entity is what turns it into evidence. This is the control the `JUNK_KEY`
  //   docstring in `inline-sweep-fixtures.ts` asks for and did not have.
  it.each(SWEEP)(
    "$entity — the replay moves a real field, and a key no schema declares never lands",
    async (s) => {
      const { kind } = sweepPlumbing(s.entity);
      const row = seedRowOf(s);
      const excluded = new Set(TOKEN_EXCLUDED[kind]);

      let moved: string | undefined;
      for (const field of sweptFields(s.entity, row)) {
        if (excluded.has(field)) continue;
        for (const p of probesFor(row[field])) {
          const { before, stored } = await replayOneField(s, field, p.value);
          if (!same(before[field], stored[field])) {
            moved = `${field} <- ${p.label}`;
            break;
          }
        }
        if (moved) break;
      }
      expect(
        moved,
        `${s.entity}: no probe on any swept field moved the stored row — the replay is not reaching the writer, and every parity relation built on it would be vacuous`,
      ).toBeDefined();

      const junk = await replayOneField(s, JUNK_KEY, "landed");
      expect(
        junk.stored[JUNK_KEY],
        `${s.entity}: "${JUNK_KEY}" reached the stored row — the write path accepts a key no schema declares`,
      ).toBeUndefined();
    },
    // Raised from the 20s default because the RED path is the slow one: an
    // entity whose replay writes nothing tries every probe on every swept
    // field. A timeout there would report "slow" where the assertion above
    // reports "the replay is not reaching the writer".
    60_000,
  );
});
