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
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";

type CreateCase = {
  entity: string;
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
