// src/app/inline-ai-edit/plan.create-path-guards.test.ts
//
// ★★★ THE CREATE PATH IS NOT THE UPDATE PATH, and for one release it was the
// half of the write surface nothing watched. `plan.write-path-sweep.test.ts`
// drives `update_*` tools ONLY — its plumbing hardcodes
// `INLINE_DESCRIPTORS[entity].updateTool` — so every guard added at a merge
// site was, until §438, a guard on editing alone. A field the model was refused
// when EDITING was accepted when CREATING, silently, on six of the seven create
// tools.
//
// ★★ `createTool` WAS THERE THE WHOLE TIME, and saying otherwise overstates the
// work. It is a declared member of `EntityDescriptor` and all eight
// entities carry one (`grep -c 'createTool: "create_' entity-descriptor.ts` →
// 8); `chat-proposal-describe.ts` indexes `toolEntity[d.createTool]` off it.
// `sweepPlumbing` simply declines to read it. The same wrong sentence sat in
// §439 and is corrected there too.
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
// ★★ THIS IS A PIN, NOT A SWEEP. It asserts one refused field per entity rather
// than enumerating an axis, so it cannot replace a mechanical sweep and must not
// be read as create-path parity coverage. The axis-driven create relation it
// was waiting for is `plan.offered-surface-sweep.test.ts` (§439); what this file
// buys beside it is that the seven guards cannot be quietly removed from the
// create sites again.
//
// ★★★ "BESIDE" IS TRUE OF ONE PIN ONLY — DO NOT DELETE ANY OF THEM AS COVERED
// BY THAT SWEEP. Its Relation A never sends a VALID value, so it is blind to
// any field whose sanitizer rejects or reshapes an arbitrary one (§441 carries
// the detail and the fix). Each pin's status, per pin:
//  - `knowledgeLinks` (raid, change, milestone) — the ONLY create-path
//    detector for that field. Relation A's probe is `[{ trespass }]`, which
//    `sanitizeKnowledgeLinks` empties (no name/url) whatever the guard does.
//  - `exceptions` (calendarEvent) and `active` (resource) — the ONLY detector
//    for the create site's guard CALL. Measured 2026-09-11 (product code = main
//    at fe82d1db): removing `dropUnacceptedCalendarEventFields` or
//    `dropUnacceptedResourceFields` from its create call leaves the sweep at 0
//    failed / 74 and turns exactly this file's pin red. Relation A probes a
//    string `exceptions`, which `sanitizeExceptions` drops, and `active: true`,
//    which `sanitizeResource` never stores.
//  - `resourceId` (stakeholder) — genuinely BESIDE. Relation A probes 1004 off
//    the seeded 4 and would see it stored; measured the same day, removing the
//    `create_stakeholder` guard call reds this pin AND Relation A's stakeholder
//    create case.
//  - `JUNK_KEY` (absence) — detects NEITHER. Measured the same day: removing
//    `dropUnacceptedAbsenceFields` from the `create_absence` call leaves this
//    file AND the sweep green, because `sanitizeAbsence` builds its row from
//    named fields and drops an unnamed key on its own. It pins the OUTCOME's
//    shape, which holds without the allowlist; see that case below.
//
// ★★ ONE MORE THING LIVES HERE THAT IS NOT A GUARD PIN. The "§460" describe
// below is a card-vs-write DIFFERENTIAL on `attendeeResourceIds`, not a
// refused-field pin, and it is not covered by the "per pin" list above. It
// sits in this file rather than its own because this file already carries the
// dispatcher/`runTool` create harness a differential needs, and
// `plan.write-path.test.ts` — which runs that same differential shape — drives
// `update_*` tools only (verified: no `create_*` tool name appears in it).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import { JUNK_KEY, KNOWLEDGE_LINKS, seedResource, snapshot, type WsKey } from "../../test/inline-sweep-fixtures";
import { CREATE_BASE } from "../../test/offered-surface-axis";
import { TOKEN_EXCLUDED, type TokenEntity } from "../ai-entity-token";
import { TOOL_DEFS } from "../chat-tool-defs";
import { runTool } from "../chat-tools";
import { createInputWithoutId, patchWithoutId } from "../chat-tools-updates";
import { resetMintState } from "../id-mint-session";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { describeEntityCalls } from "./plan";

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
  /** A field the created row must have STORED for the probe to be able to land
   *  at all. Asserted before the refusal, so a trimmed `valid` payload fails
   *  loudly instead of leaving the pin green while it tests nothing. */
  precondition?: { field: string; why: string };
};

const CASES: CreateCase[] = [
  {
    entity: "raid",
    tool: "create_raid_item",
    wsKey: "raid",
    valid: CREATE_BASE.raid,
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "knowledgeLinks is in no tool schema, and the sanitizer rebuilds the field from the merged blob",
  },
  {
    entity: "change",
    tool: "create_change",
    wsKey: "changes",
    valid: CREATE_BASE.change,
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "same shape as raid",
  },
  {
    entity: "milestone",
    tool: "create_milestone",
    wsKey: "milestones",
    valid: CREATE_BASE.milestone,
    field: "knowledgeLinks",
    probe: KNOWLEDGE_LINKS,
    expected: undefined,
    because: "same shape as raid",
  },
  {
    entity: "stakeholder",
    tool: "create_stakeholder",
    wsKey: "stakeholders",
    valid: CREATE_BASE.stakeholder,
    field: "resourceId",
    probe: 9,
    expected: undefined,
    because: "an undisclosed FK, guarded on update — this is the half that was missed",
  },
  {
    entity: "resource",
    tool: "create_resource",
    wsKey: "resources",
    valid: CREATE_BASE.resource,
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
    valid: CREATE_BASE.absence,
    field: JUNK_KEY,
    probe: "should never land",
    expected: undefined,
    // ★ Absence is an ALLOWLIST whose table names exactly the seven fields its
    //  schema advertises, so there is no disclosed-but-refused field to probe
    //  with. A junk key is the honest probe for an allowlist: it asserts the
    //  shape itself — nothing unnamed survives — which is the property that
    //  makes the entry safe.
    //  ★★ BUT THE PROPERTY HOLDS WITHOUT THE ALLOWLIST, so this pin cannot see
    //   the allowlist go: `sanitizeAbsence` builds its row from named fields
    //   and drops a junk key on its own. Measured 2026-09-11 — removing the
    //   `create_absence` guard call leaves this case green (the header above
    //   records it). Do not read a green run here as the guard being present.
    because: "allowlist shape: a field the table does not name must not survive",
  },
  {
    entity: "calendarEvent",
    tool: "create_calendar_event",
    wsKey: "calendarEvents",
    // `sanitizeCalendarEvent` stores exceptions only when a recurrence is
    // present, so without it the probe cannot land and the assertion would pass
    // whatever the guard did. That is why `CREATE_BASE.calendarEvent` carries a
    // recurrence rather than being the bare `required` set — see its docstring.
    valid: CREATE_BASE.calendarEvent,
    field: "exceptions",
    probe: [{ date: "2026-06-08", kind: "skip" }],
    expected: undefined,
    because: "a live undisclosed write: in no write schema, while the read tool teaches the model its exact shape",
    // ★★ That dependency was prose until this line. `calendar-event.ts` keeps
    //  `exceptions: recurrence ? … : undefined`, so trimming the recurrence out
    //  of `CREATE_BASE.calendarEvent` left this pin green while it tested
    //  nothing — the positive control reads only `title`. Now it goes red.
    precondition: {
      field: "recurrence",
      why: "exceptions are stored only when a recurrence is present, so without it this pin cannot see the guard",
    },
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
    if (c.precondition) {
      expect(row?.[c.precondition.field], `${c.tool}: ${c.precondition.why}`).toBeDefined();
    }

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
  // §486 — the literal `true` is the one value the sanitizers keep, so it is
  //  the only probe that can land if a strip goes missing.
  calendarOptOut: true,
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

  /** ★★★ THE MIRROR OF `ai-entity-token.test.ts`'s "names every update tool that
   *  exists, so a new one cannot slip past", and the create side had no such
   *  case — which is precisely why an EIGHTH pass-through create that skipped
   *  `createInputWithoutId` would have been silent. Every case above is driven
   *  off `CASES`, so `CASES` is the vacuity surface: delete a row and that
   *  entity stops being probed, add a create tool and nothing notices. This
   *  closes both directions at once by comparing against what the tool
   *  DEFINITIONS declare.
   *
   *  ★★ IT ENUMERATES, IT DOES NOT FILTER, and the difference is the whole
   *  point. A predicate that quietly skipped anything unrecognised would let a
   *  new create tool through by default; an EQUALITY against
   *  (participants ∪ named non-participants) makes a new tool RED until someone
   *  decides which side it belongs on. That decision is the deliverable, not the
   *  green run.
   *
   *  ★★ `TOOL_DEFS` SPREADS `DOCUMENT_TOOL_DEFS` FROM A SECOND FILE
   *  (`chat-tool-defs-documents.ts`), so a grep over `chat-tool-defs.ts` alone
   *  under-counts — which is how `update_document` was missed when the update
   *  twin was specified. Reading the composed array is what makes
   *  `create_document` visible here at all. */
  const NOT_PASS_THROUGH_CREATES = [
    // Reads twelve NAMED fields off `input` into an object literal — an
    // allowlist, structurally the same guarantee `buildPatch` gives
    // `update_task` — so no undeclared key can reach the handler and a strip
    // would be unreachable code that READS as a guard.
    "create_task",
    // `d.createDocument(title, input.blocks)` — two explicit args, no spread,
    // so there is no `input` object for a strip to act on. A document is also a
    // meta-blob with no CSV projection, hence no `TokenEntity` row to look up.
    "create_document",
  ];

  it("names every create tool that exists, so a new one cannot slip past", () => {
    const defined = TOOL_DEFS.map((d) => d.name).filter((n) => n.startsWith("create_"));
    const covered = CASES.map((c) => c.tool).concat(NOT_PASS_THROUGH_CREATES).sort();
    expect(defined.slice().sort()).toEqual(covered);
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

// ────────────────────────────────────────────────────────────────────────────
// The two strip helpers, pinned to ONE key set.
//
// ★★★ `createInputWithoutId` IS A LINE-FOR-LINE DUPLICATE OF `patchWithoutId`
// — same three deletes, differing only in return type (`T` vs `Partial<T>`) —
// and its docstring states the goal in as many words: a reader deriving one
// helper from the other "cannot get a narrower strip than the code has". THAT
// WAS PROSE ONLY. Either function could gain or lose a `delete` with the other
// none the wiser, and the create half is the one with no independent alarm, so
// a silent narrowing there is the expensive direction.
//
// ★★ A TEST RATHER THAN AN EXTRACTION, deliberately. Folding seven duplicated
// lines into a shared private helper was the obvious alternative and was NOT
// taken: the two are deliberately separate READING SURFACES carrying different
// docstrings (one explains an address, the other a mint), and collapsing them
// would delete the explanation that makes each call site legible. A test pins
// the invariant without paying that. If they are ever merged, this block is
// what proves the merge lost nothing.

describe("the update and create strip helpers agree on exactly one key set", () => {
  /** A field NO `TOKEN_EXCLUDED` row names, so it must SURVIVE both helpers.
   *  ★★★ THIS IS THE ANTI-VACUITY HALF AND WITHOUT IT THE BLOCK IS A
   *  TAUTOLOGY: two helpers that stripped their input down to `{}` would agree
   *  perfectly on the empty key set and pass every equality below. The survivor
   *  is what makes "identical" mean "identically CORRECT" rather than merely
   *  "identically destructive". */
  const SURVIVOR = "zzFieldNoExclusionRowNames";

  const KINDS = Object.keys(TOKEN_EXCLUDED) as TokenEntity[];

  it.each(KINDS)("%s — both helpers strip id, expectedToken and every excluded field, and keep the rest", (kind) => {
    const input: Record<string, unknown> = {
      id: 42,
      expectedToken: "a-stale-token",
      [SURVIVOR]: "must survive",
    };
    for (const field of TOKEN_EXCLUDED[kind]) input[field] = EXCLUDED_PROBES[field] ?? "probe";

    // Sanity on the fixture itself: an input that never carried the excluded
    // fields would let a helper deleting NOTHING pass.
    expect(Object.keys(input).sort()).toEqual(
      ["id", "expectedToken", SURVIVOR].concat([...TOKEN_EXCLUDED[kind]]).sort(),
    );

    const patched = Object.keys(patchWithoutId(input, kind)).sort();
    const created = Object.keys(createInputWithoutId(input, kind)).sort();

    // The named invariant, asserted directly so a divergence names itself…
    expect(patched, `patchWithoutId and createInputWithoutId disagree on ${kind}`).toEqual(created);
    // …and the absolute key set, which is strictly stronger: it also catches
    // the case where BOTH helpers are wrong in the SAME way, which mutual
    // equality is structurally blind to.
    expect(created).toEqual([SURVIVOR]);
  });

  /** ★★ The `it.each` above is driven off `Object.keys(TOKEN_EXCLUDED)`, so it
   *  cannot under-run — but it also cannot notice if that table were emptied.
   *  `0 mismatch` is worthless without `N match`. */
  it("runs against every TokenEntity, and every one of them excludes something", () => {
    expect(KINDS.length).toBeGreaterThan(0);
    expect(KINDS.filter((k) => TOKEN_EXCLUDED[k].length === 0)).toEqual([]);
  });
});

// ★★★ §460 — THE CARD AND THE WRITE, DRIVEN BY ONE INPUT. `pushLinkDiffs`
//  once applied the link guard on the ROW path only, which was right while both
//  allow-list creates handed `input` straight to their sanitizer. Since
//  `68486cd4` `createCalendarEvent` runs `dropUnacceptedCalendarEventFields`
//  first, and `CALENDAR_EVENT_FIELD_GUARDS.attendeeResourceIds` refuses the
//  WHOLE array when any member is not a number — so `[4, "4"]` stored no
//  attendee while the card, coercing each element with `toNumber`, previewed
//  attendee 4. No other detector sees both halves: a create card's links are
//  disclosure only, and the offered-surface sweep drives the seeded all-numeric
//  `[4]`.
//
//  ★★ THE FIRST CASE IS THE ANTI-VACUITY HALF. Without it, a card that
//   dropped every link and a create that stored nothing would pass the second.
describe("a create card previews only the attendees the create stores (§460)", () => {
  async function cardAndWrite(attendeeResourceIds: unknown[]) {
    const { result } = renderHook(
      () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
      { wrapper: dispatcherWrapperWith({ resources: [seedResource()] }) },
    );
    const input = { ...CREATE_BASE.calendarEvent, attendeeResourceIds };
    const card = describeEntityCalls([{ type: "tool_use", name: "create_calendar_event", input }], {
      descriptor: INLINE_DESCRIPTORS.calendarEvent,
      // No item on a create: `describeEntityCalls` reads `item.id` only on the update branch.
      item: undefined as unknown as { id: number },
      ws: snapshot(result.current.ws),
    });
    await act(async () => {
      await runTool(result.current.d, "create_calendar_event", input);
    });
    return { card, rows: snapshot(result.current.ws).calendarEvents ?? [] };
  }

  it("previews and stores attendee 4 from an all-numeric list", async () => {
    const { card, rows } = await cardAndWrite([4]);
    expect(rows).toHaveLength(1);
    expect(rows[0].attendeeResourceIds).toEqual([4]);
    expect(card.links.map((l) => l.rawIds)).toEqual([[4]]);
  });

  it('previews no attendee from [4, "4"], because the create stores none', async () => {
    const { card, rows } = await cardAndWrite([4, "4"]);
    expect(rows, "the create stored no row, so this pin would pass for the wrong reason").toHaveLength(1);
    expect(rows[0].attendeeResourceIds ?? []).toEqual([]);
    expect(card.links).toEqual([]);
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
//
// ★★ TWO MORE, once the enumeration and the helper-parity block landed. The
// file's runtime test count is now 40, and both tallies sum to 40:
//   • A NINTH create tool (`create_zzprobe`, added to `DOCUMENT_TOOL_DEFS` so
//     the mutant also proves the composed `TOOL_DEFS` is what is being read)
//     → 1 failed / 39 passed, the failure being the enumeration ALONE. That is
//     the measurement behind this block's premise: no other test in this file,
//     and none in `ai-entity-token.test.ts`, notices a new create tool.
//   • Narrowing the strip — `delete create.expectedToken` removed from
//     `createInputWithoutId`, so it no longer matches `patchWithoutId`
//     → 8 failed / 32 passed, one per `TokenEntity`, ALL of them in the
//     helper-parity block. Every one of the 15 stored-row cases above went on
//     passing, because `expectedToken` never reaches a stored row — so the
//     parity block is the only detector for a divergence between the twins,
//     which is exactly the gap its opening ★★★ describes.
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
