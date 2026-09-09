// src/app/inline-ai-edit/plan.create-path-guards.test.ts
//
// ★★★ THE CREATE PATH IS NOT THE UPDATE PATH, and for one release it was the
// half of the write surface nothing watched. `plan.write-path-sweep.test.ts`
// drives `update_*` tools ONLY — its plumbing reads
// `INLINE_DESCRIPTORS[entity].updateTool` and there is no create relation to
// read — so every guard added at a merge site was, until §438, a guard on
// editing alone. A field the model was refused when EDITING was accepted when
// CREATING, silently, on six of the seven create tools.
//
// ★★★ THAT IS NOT HYPOTHETICAL AND THIS FILE EXISTS BECAUSE IT WAS MEASURED.
// `knowledgeLinks` was stored verbatim by create for raid, change and
// milestone while being refused one handler below.
// `create_stakeholder {resourceId: 9}` stored 9 — the very field guarded on
// update days earlier, so that fix was half a fix.
// `create_calendar_event` stored model-supplied `exceptions` (per-occurrence
// skip/move bookkeeping) which NO write schema advertises and no card
// discloses — while the READ tool's own description teaches the model the exact
// shape, so the model had been told how to build a value it was never told it
// could write.
//
// ★★ THIS IS A PIN, NOT A SWEEP. It asserts one refused field per entity
// rather than enumerating an axis, so it cannot replace the mechanical sweep
// and must not be read as create-path parity coverage. A real create relation —
// comparing the create CARD against the created ROW — is still owed; see §438.
// What this file buys is that the seven guards cannot be quietly removed from
// the create sites again.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import { JUNK_KEY, KNOWLEDGE_LINKS, snapshot, type WsKey } from "../../test/inline-sweep-fixtures";
import { TOKEN_EXCLUDED, type TokenEntity } from "../ai-entity-token";
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";

type CreateCase = {
  /** ★ `TokenEntity`, not `string`, so the `TOKEN_EXCLUDED` derivation below
   *  indexes the table with no cast — a cast there would let a typo'd entity
   *  name silently derive the empty field list and probe nothing. */
  entity: TokenEntity;
  tool: string;
  wsKey: WsKey;
  /** The minimum the sanitizer accepts. A create that returns null throws and
   *  leaves no row, against which every refusal assertion below would pass for
   *  the wrong reason. */
  valid: Record<string, unknown>;
  /** A field the UPDATE path already refuses. */
  field: string;
  probe: unknown;
  /** What the stored row must show. `undefined` means the key never landed; a
   *  value means the sanitizer's own default won instead of the model's. */
  expected: unknown;
  because: string;
};

const CASES: CreateCase[] = [
  {
    entity: "raid",
    tool: "create_raid_item",
    wsKey: "raid",
    valid: { title: "A risk" },
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "knowledgeLinks is in no tool schema, and the sanitizer rebuilds the field from the merged blob",
  },
  {
    entity: "change",
    tool: "create_change",
    wsKey: "changes",
    valid: { title: "A change" },
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "same shape as raid",
  },
  {
    entity: "milestone",
    tool: "create_milestone",
    wsKey: "milestones",
    valid: { name: "A milestone", date: "2026-06-01" },
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "same shape as raid",
  },
  {
    entity: "stakeholder",
    tool: "create_stakeholder",
    wsKey: "stakeholders",
    valid: { name: "Ada Lovelace" },
    field: "resourceId",
    probe: 9,
    expected: undefined,
    because: "an undisclosed FK, guarded on update — this is the half that was missed",
  },
  {
    entity: "resource",
    tool: "create_resource",
    wsKey: "resources",
    valid: { firstName: "Grace", lastName: "Hopper" },
    field: "active",
    probe: false,
    // ★★★ `undefined`, NOT `true`, and the first cut of this row asserted
    //  `true` on the reasoning that "absent means active, so the default must
    //  win". That was wrong and this test caught it: `sanitizeResource` writes
    //  `active` ONLY when the input is `false` or `"false"` — there is no
    //  positive default to observe, and ABSENCE IS the active state
    //  (`csv-codecs-core.ts` serialises it as `r.active === false ? "false" :
    //  ""`).
    //  ★★ `undefined` still discriminates, which was the worry behind the
    //  wrong version: an unguarded create stores `false`, and `false` is not
    //  `undefined`. The assertion fails on exactly the defect it is for.
    expected: undefined,
    because: "create_resource with active:false produced a resource soft-archived on arrival",
  },
  {
    entity: "absence",
    tool: "create_absence",
    wsKey: "absences",
    valid: { assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" },
    field: JUNK_KEY,
    probe: "should never land",
    expected: undefined,
    // ★ Absence is an ALLOWLIST whose table names exactly the seven fields its
    //  schema advertises, so there is no disclosed-but-refused field to probe
    //  with. A junk key is the honest probe for an allowlist: it asserts the
    //  shape itself — nothing unnamed survives — which is the property that
    //  makes the entry safe.
    because: "allowlist shape: a field the table does not name must not survive",
  },
  {
    entity: "calendarEvent",
    tool: "create_calendar_event",
    wsKey: "calendarEvents",
    valid: {
      title: "Weekly sync",
      startDate: "2026-06-01",
      startTime: "09:00",
      durationMinutes: 30,
      // `sanitizeCalendarEvent` stores exceptions only when a recurrence is
      // present, so without this the probe cannot land and the assertion would
      // pass whatever the guard did.
      recurrence: { freq: "weekly", interval: 1 },
    },
    field: "exceptions",
    probe: [{ date: "2026-06-08", kind: "skip" }],
    expected: undefined,
    because: "a live undisclosed write: in no write schema, while the read tool teaches the model its exact shape",
  },
];

async function createWith(c: CreateCase): Promise<Record<string, unknown> | undefined> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    // ★★ AN EMPTY `TestSeed`, NOT `emptyWorkspace()`. The two are different
    //  types and the mistake typechecks nowhere but runs fine — vitest never
    //  typechecks, so the first cut of this file passed 14/14 while `tsc`
    //  exited 2. `{}` is also the honest seed here: every case creates its row
    //  from nothing, so seeding any entity would only add a row for the
    //  `rows?.[0]` read to pick up by mistake.
    { wrapper: dispatcherWrapperWith({}) },
  );
  await act(async () => {
    await runTool(result.current.d, c.tool, { ...c.valid, [c.field]: c.probe });
  });
  const rows = snapshot(result.current.ws)[c.wsKey] as ReadonlyArray<Record<string, unknown>> | undefined;
  return rows?.[0];
}

describe("every create tool applies its entity's merge-site guard", () => {
  beforeEach(() => {
    resetMintState();
  });

  it.each(CASES)("$tool refuses $field — $because", async (c) => {
    const row = await createWith(c);

    // ★★★ ANTI-VACUITY FIRST. A create the sanitizer REJECTS returns null, the
    //  dispatcher throws, and no row lands — against which "the refused field
    //  is absent" passes for entirely the wrong reason. Prove the row exists
    //  before reading anything back off it.
    expect(row, `${c.tool} stored no row at all — its valid payload is not valid`).toBeDefined();
    expect(row?.id).toBeDefined();

    expect(row?.[c.field]).toEqual(c.expected);
  });

  /** ★★ THE POSITIVE CONTROL, because every assertion above is an absence and
   *  this repo's rule is that `0 mismatch` is worthless without `N match`
   *  beside it. If these create tools stored nothing useful at all — a broken
   *  fixture, a throw swallowed somewhere — every refusal assertion above would
   *  still pass. This proves the same call path DOES store what it must. */
  it.each(CASES)("$tool still stores what it IS allowed to store", async (c) => {
    const row = await createWith(c);
    const [key, value] = Object.entries(c.valid)[0];
    expect(row?.[key], `${c.tool} dropped ${key}, which it must accept`).toEqual(value);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// `createInputWithoutId` — the strip itself, per entity, per excluded field.
//
// ★★★ THE BLOCK ABOVE DOES NOT COVER THIS AND CANNOT BE MADE TO. It pins each
// entity's MERGE-SITE guard (`dropUnaccepted*Fields`), which is a different
// mechanism sitting one layer down: every field it probes is one those guards
// refuse on their own, so reverting a `createInputWithoutId` wrapping in
// `chat-tools.ts` leaves all fourteen assertions above GREEN. Measured, not
// reasoned — see the mutation record at the foot of this block.
//
// ★★★ AND THE TWIN'S ALARM DOES NOT REACH HERE EITHER. `patchWithoutId`'s
// docstring says "`ai-entity-token.test.ts` drives the real dispatch path per
// tool, so reverting this strip … turns that suite red" — true, and true of the
// UPDATE half alone: that file's ROUND_TRIP table is `update_*` only, so the
// create half had no equivalent. Reverting any of the seven create wrappings,
// or adding an eighth pass-through create that skips the strip, was silent.
//
// ★★ THE AXIS IS DERIVED FROM `TOKEN_EXCLUDED`, not retyped. Two reasons, and
// the second is the one that matters: a hand-copied list goes stale the moment
// a row gains a member, and `ai-entity-token.ts` states in as many words that
// adding a row there is THREE decisions — one of which is "what must a CREATE
// drop?", i.e. this. Deriving means a new member is probed the day it lands
// rather than the day someone remembers this file exists.

/** A value each excluded field's sanitizer WOULD store if the strip were
 *  removed — off every fallback, so "absent" and "refused" cannot be confused.
 *
 *  ★★ `noteLog` is the one member that is NOT load-bearing on this path and
 *  saying so is the honest form: `sanitizeRaidItem` / `sanitizeModelChangeItem`
 *  are DOM-free by contract and drop it outright (`change-log.ts` — a stored
 *  log is re-attached afterwards by `withStoredNoteLog`, and a create has no
 *  stored row to re-attach from), so its two rows below assert the uniform rule
 *  rather than catch a reachable write. The mutation record names which rows
 *  are which. Do NOT delete them on that ground — the whole point of the
 *  derived axis is that it does not editorialise about reachability, which is
 *  exactly the judgement that has been got wrong here before. */
const EXCLUDED_PROBES: Readonly<Record<string, unknown>> = {
  localModifiedAt: "2000-01-01T00:00:00.000Z",
  outlookEventId: "AAMkAGModelSuppliedOutlookId",
  inquiriesSent: 7,
  noteLog: [{ id: 1, timestamp: "2000-01-01T00:00:00.000Z", html: "<p>model note</p>", text: "model note" }],
};

const EXCLUDED_CASES: CreateCase[] = CASES.flatMap((c) =>
  TOKEN_EXCLUDED[c.entity].map((field) => ({
    ...c,
    field,
    probe: EXCLUDED_PROBES[field],
    // Every excluded field is stored SPARSELY by its sanitizer (`if (value)` /
    // `if (inq > 0)`), so there is no default to observe and absence is the
    // only correct expectation — the same reasoning the `resource`/`active` row
    // above records at length.
    expected: undefined,
    because: `TOKEN_EXCLUDED.${c.entity} names it, so no create may let the model choose it`,
  })),
);

describe("every pass-through create tool strips its entity's TOKEN_EXCLUDED fields", () => {
  beforeEach(() => {
    resetMintState();
  });

  /** ★★★ THE DERIVATION'S OWN ANTI-VACUITY, and without it the fifteen cases
   *  below can quietly become fewer. Two independent ways this axis goes hollow
   *  with every assertion still green: a `CASES` row deleted (that entity stops
   *  being probed at all), or a `TOKEN_EXCLUDED` member added with no
   *  `EXCLUDED_PROBES` entry (the probe is then `undefined`, the payload
   *  carries `{field: undefined}`, and `expect(undefined).toBeUndefined()`
   *  passes having tested nothing). `task` is the one deliberate absence:
   *  `create_task` reads named fields off `input` one at a time — an allowlist —
   *  so it is NOT routed through `createInputWithoutId` and a strip there would
   *  read as a guard while being unreachable. */
  it("probes every tokened entity that has a pass-through create, and every field it excludes", () => {
    const probed = CASES.map((c) => c.entity).sort();
    const passThrough = (Object.keys(TOKEN_EXCLUDED) as TokenEntity[]).filter((k) => k !== "task").sort();
    expect(probed).toEqual(passThrough);

    const unprobed = EXCLUDED_CASES.filter((c) => !(c.field in EXCLUDED_PROBES)).map((c) => `${c.entity}.${c.field}`);
    expect(unprobed, "add a value to EXCLUDED_PROBES — an undefined probe passes vacuously").toEqual([]);
    // `N match` beside the `0 mismatch`: the axis is non-empty and every row
    // carries a real value. A count is deliberately NOT asserted — it moves
    // whenever a TOKEN_EXCLUDED row does, which is the axis working.
    expect(EXCLUDED_CASES.length).toBeGreaterThan(CASES.length);
  });

  it.each(EXCLUDED_CASES)("$tool refuses a model-supplied $field", async (c) => {
    const row = await createWith(c);

    // ★★★ ANTI-VACUITY, per case, for the same reason the block above states
    //  it: a create the sanitizer REJECTS stores no row, and "the excluded
    //  field is absent" then passes for entirely the wrong reason.
    expect(row, `${c.tool} stored no row at all — its valid payload is not valid`).toBeDefined();
    expect(row?.id).toBeDefined();
    // …and the POSITIVE observable, folded in per case rather than left to a
    // sibling test: the same dispatch that refused the excluded field DID store
    // a declared one on the model's own value.
    const [key, value] = Object.entries(c.valid)[0];
    expect(row?.[key], `${c.tool} dropped ${key}, which it must accept`).toEqual(value);

    expect(row?.[c.field]).toBeUndefined();
  });
});

// ★★ MUTATION RECORD — 2026-09-09, at the CALL SITE in `chat-tools.ts`, one
// wrapping at a time reverted to the bare `input as TInput` this helper
// replaced. Each mutant was verified to have LANDED before its run, and the
// file's runtime test count was 30, so every tally below sums to 30:
//   `create_raid_item`       → 3 failed / 27 passed
//   `create_stakeholder`     → 1 failed / 29 passed
//   `create_calendar_event`  → 0 failed / 30 passed  ← SURVIVED, see below
// A fourth mutant was aimed at THIS FILE instead, to prove the coverage guard
// above is not decoration: deleting the `inquiriesSent` row from
// `EXCLUDED_PROBES` gives 1 failed / 29 passed, and the ONE failure is the
// guard. `create_raid_item refuses a model-supplied inquiriesSent` went on
// PASSING — vacuously, on `expect(undefined).toBeUndefined()` — which is
// precisely the hole the guard is the only detector for.
// Only rows in THIS block moved; the fourteen in the block above stayed green
// under all three, which is the measurement behind its opening ★★★.
// ★★★ THREE MUTANTS AT THREE DIFFERENT SHAPES, NOT ONE — raid excludes four
// fields, stakeholder one, and calendar-event is an ALLOWLIST entity. A single
// raid mutant would leave the one-field entities unproved and would say nothing
// about the allowlist half, and a reader could not then tell a working
// assertion from an unreachable one.
// ★★ THE SURVIVORS ARE NAMED BECAUSE A SILENT PASS IS THE THING THIS COMMENT
// EXISTS TO PREVENT, and both are EQUIVALENT MUTANTS rather than test gaps:
//   • Under the raid mutant `localModifiedAt`, `outlookEventId` and
//     `inquiriesSent` all went red; `noteLog` did NOT, because the sanitizer
//     drops the field before the strip could matter (see `EXCLUDED_PROBES`).
//   • `create_calendar_event` survived WHOLESALE. `createInputWithoutId`'s
//     docstring predicts exactly this — the two allowlist guards
//     (`dropUnacceptedCalendarEventFields`, `dropUnacceptedAbsenceFields`)
//     already drop both excluded fields, so reverting the strip there changes
//     no stored row. That prediction is now MEASURED rather than inherited.
// Those four allowlist rows are the backstop for the day an allowlist is
// widened — `ai-entity-token.ts` says the `absence`/`calendarEvent` exclusion
// rows are legitimate ONLY while those guards hold — not a live detector today.
