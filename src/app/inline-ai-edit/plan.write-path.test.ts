// src/app/inline-ai-edit/plan.write-path.test.ts
//
// ★★★ THE DIFFERENTIAL AGAINST THE **REAL WRITE PATH**, not against a
// sanitizer. Every case previews with `describeEntityCalls` — the production
// path behind the chat review card and `insights/recommend-plan.ts` — and then
// REPLAYS the same tool input through `runTool` on a live `useChatDispatcher`
// mounted over `TestProviders`, reading the answer back out of the workspace
// the dispatcher actually wrote. Nothing about the write is mocked or
// re-implemented here: no fake dispatcher, no hand-rolled patch merge, no copy
// of a sanitizer rule. That is the whole value of the file — a differential
// against a MOCK of the write path would be worthless, because the mock would
// be written from the same reading of the code the preview already encodes.
//
// It exists for the structural limits `plan.sanitizer-parity.test.ts`
// records about itself, each of which is invisible to a sanitizer-level sweep:
//  (1) a DISPATCHER-level derivation. `updateResource` re-derives
//      `splitName(patch.name)` and spreads it over the patch; no sanitizer sees
//      that, because by the time `sanitizeResource` runs the parts are already
//      in the object.
//  (2) a JOINT guard. That sweep overrides exactly ONE key per probe, so
//      `requiredNonEmptyGroups` / `sanitizeResource`'s `!firstName && !lastName`
//      OR-gate is never exercised jointly.
//  (3) a WRITE ALIAS. `name` is absent from the resource descriptor's
//      `diffFields` (correctly — it is not a stored field), so no probe there
//      ever sets it and the alias is unexercised on either side.
//  (4) a MERGE-SITE GUARD. `updateRaid` filters the model's patch through
//      `dropUnacceptedRaidFields` before handing it to `sanitizeRaidItem`, so a
//      value the sanitizer alone would coerce, drop or reset to a default is
//      never merged at all. A sanitizer-level sweep reads the sanitizer, so it
//      is blind to whether the WRITER actually calls the guard — that wiring is
//      pinned here and nowhere else.
// Plus the relationship arrays, which replace rather than merge.
//
// THE CONTRACT, in two directions, both asserted per case:
//  • every field the write CHANGED must appear as a preview line (an `updates`
//    diff or a `links` diff) — "the card discloses what apply stores";
//  • no field the preview REJECTED may have changed in the stored row — "a
//    refusal in the card is a refusal in the write". §384 is the instance: a
//    mononym rename previewed `lastName` as rejected while the write stored
//    `""`, and the two REPLAYING consumers (`chat-proposal-apply.ts`,
//    `use-insight-recommendations.ts`) resend the original input and never read
//    the plan, so the refusal was decorative.
//
// ★★ THE REJECTED DIRECTION IS ASSERTED GENERALLY, not as a §384 spot check on
// the literal string `lastName=`. `Rejected.detail` is `${field}=${value}` or
// `${a}+${b}=empty` for a group, so the field names parse out of it and the
// property becomes "nothing the preview called rejected may appear as a change
// in the stored row" — which covers a field this file has not thought of.
//
// ★★ WHAT THIS FILE STILL CANNOT SEE. It replays whole tool inputs through the
// real dispatcher, so it is only ever as wide as `CASES`; it is a spot
// differential, NOT the enumerating sweep `plan.sanitizer-parity.test.ts` runs
// over every entity × every `diffField`. The two are complements: that one is
// exhaustive and shallow, this one is narrow and deep. Add a case here when a
// defect turns on the DISPATCHER doing something the sanitizer cannot show.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../../test/chat-dispatcher-fixture";
import { entityToken, type TokenEntity } from "../ai-entity-token";
import { runTool } from "../chat-tools";
import { resetMintState } from "../id-mint-session";
import { type TestSeed } from "../test-providers";
import { DEFAULT_TASK_STATUS, type RaidItem, type Resource, type Task } from "../types";
import { useChatDispatcher } from "../use-chat-dispatcher";
import { useWorkspace } from "../workspace-context";
import { emptyWorkspace, type Workspace } from "../workspace";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./entity-descriptor";
import { describeEntityCalls, type EditPlan } from "./plan";

/** A minimal VALID `Task`, mirroring `chat-proposal-apply.test.tsx`'s rule:
 *  every non-optional field of the type and nothing more, so a write is refused
 *  by the code under test rather than by a sanitizer rejecting a lazy fixture. */
function seedTask(id: number, taskName: string): Task {
  return {
    id,
    taskName,
    assignee: "M. Jordan",
    assigneeEmail: "",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    priority: "Medium",
    status: DEFAULT_TASK_STATUS,
    blockers: "",
    description: "",
  };
}

const LINKED_TASKS: Task[] = [seedTask(1, "First"), seedTask(2, "Second"), seedTask(3, "Third")];

function seedRaid(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 10,
    category: "R",
    title: "R",
    status: "Open",
    raisedDate: "2026-05-01",
    linkedTaskIds: [1, 2, 3],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

/** A RAID row whose every merge-site-guarded field carries a NON-DEFAULT value,
 *  so a reset-to-default is observable rather than indistinguishable from a
 *  preserved value: `category: "A"` is not `RAID_CATEGORIES[0]` and
 *  `status: "Validated"` is not `ASSUMPTION_STATUSES[0]`. A base row missing any
 *  of them would make the cases below pass for the wrong reason — a field that
 *  was already absent cannot be observed being cleared. */
function seedGuardedRaid(): RaidItem {
  return seedRaid({
    category: "A",
    status: "Validated",
    severity: "High",
    probability: 3,
    impact: 4,
    targetDate: "2026-06-30",
    closedDate: "2026-07-31",
  });
}

function seedResource(over: Partial<Resource> = {}): Resource {
  return {
    id: 4,
    firstName: "Cher",
    lastName: "Bono",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...over,
  };
}

/** The workspace slices this file writes to, and the key each case reads back
 *  through. Deliberately narrow — a case needing another slice adds it here so
 *  the read-back stays a lookup rather than a per-case cast. */
type WsKey = "raid" | "resources";

interface WriteCase {
  name: string;
  /** The chat write tool, exactly as the model would emit it. */
  tool: string;
  entity: InlineEntity;
  /** The `entityToken` kind — how the REPLAYING consumers stamp the token
   *  (`chat-proposal-apply.ts` calls `entityToken(source.kind, current)`). */
  kind: TokenEntity;
  wsKey: WsKey;
  id: number;
  seed: TestSeed;
  /** The model's tool input, WITHOUT `expectedToken`: production previews the
   *  model's own input and stamps the token only on the replay. */
  input: Record<string, unknown>;
  expectStored: Record<string, unknown>;
}

const CASES: WriteCase[] = [
  {
    // (1) + (2) + (3) at once, and §384's exact shape. `name` is a WRITE ALIAS
    // the dispatcher splits; the split makes `lastName` empty, which is legal
    // only because `firstName` survives — the JOINT guard.
    name: "mononym rename clears the surname",
    tool: "update_resource",
    entity: "resource",
    kind: "resource",
    wsKey: "resources",
    id: 4,
    seed: { resources: [seedResource()] },
    input: { id: 4, name: "Cher" },
    expectStored: { firstName: "Cher", lastName: "" },
  },
  {
    // A relationship array REPLACES — every dispatcher merges by object spread
    // and nothing reconstructs the dropped ids. The preview's job is to say so
    // before the user approves.
    name: "a link list REPLACES rather than merges",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, linkedTaskIds: [2] },
    expectStored: { linkedTaskIds: [2] },
  },
  {
    // ★★★ THE SINGLE-FK CASE, and the one a sanitizer-level sweep structurally
    // cannot reach: `roleId` is not in the resource descriptor's `diffFields`
    // (it is an FK, held in `linkFields`), so no `fieldSanitizers` probe ever
    // touches it. An id ARRAY is the trap — `sanitizeResource` coerces with
    // `toNumber`, which is NaN for an array (bare `Number` would accept `[3]`
    // as 3), so the write REMOVES the role rather than setting it. The preview
    // must disclose a removal, not a change to role #3.
    // ★★★ THE MERGE-SITE GUARD, and the shape §384 has in the RAID register:
    // `sanitizeRaidItem` REBUILDS a whole record, so a value it refuses is not
    // left alone — `severity`/`probability`/`impact` lose their key outright.
    // The preview refuses these three and shows the row as unchanged, so before
    // `dropUnacceptedRaidFields` the card promised "unchanged" while the replay
    // wiped all three. Driven through the REAL dispatcher, which is the only
    // place the guard and the sanitizer meet.
    name: "a refused severity and out-of-range scores leave the stored values alone",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, severity: "Sehr hoch", probability: 9, impact: 0 },
    expectStored: { severity: "High", probability: 3, impact: 4 },
  },
  {
    // ★★ THE COUPLED PAIR. `statusSetForCategory` is keyed off the category the
    // sanitizer's own fallback just chose, so an unrecognised category used to
    // reset to "R" AND drag the stored assumption status "Validated" to the
    // risk default "Open" — two fields wiped by one refused value, and `status`
    // is not even mentioned in the tool input, so no preview line could have
    // disclosed it.
    name: "a refused category leaves the coupled status alone",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, category: "Z" },
    expectStored: { category: "A", status: "Validated" },
  },
  {
    // `raisedDate` is written UNCONDITIONALLY by the sanitizer
    // (`raisedDate: sanitizeIsoDate(o.raisedDate)`), so an unparseable value
    // blanked it to ""; `targetDate`/`closedDate` lost their key instead. Three
    // shapes, one guard.
    name: "unparseable dates leave the stored dates alone",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, raisedDate: "02/01/2026", targetDate: "not a date", closedDate: "2026/07/31" },
    expectStored: { raisedDate: "2026-05-01", targetDate: "2026-06-30", closedDate: "2026-07-31" },
  },
  {
    // ★★★ THE OTHER DIRECTION, and the reason the guard carves `""` out rather
    // than demanding a parseable date: the preview's date rule is `after !== ""
    // && sanitizeIsoDate(after) !== after`, so an empty string is ACCEPTED and
    // DISCLOSED as a clear. A guard that refused it would make the card promise
    // a clear the write declined — the same disagreement, pointing the other
    // way. `expectStored` is `undefined` rather than `""` because the sanitizer
    // stores `targetDate` sparsely (`if (targetDate) item.targetDate = …`).
    name: "an explicitly empty date still clears the stored one",
    tool: "update_raid_item",
    entity: "raid",
    kind: "raid",
    wsKey: "raid",
    id: 10,
    seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS },
    input: { id: 10, targetDate: "" },
    expectStored: { targetDate: undefined },
  },
  {
    name: "an id ARRAY on a single-FK link REMOVES the role",
    tool: "update_resource",
    entity: "resource",
    kind: "resource",
    wsKey: "resources",
    id: 4,
    seed: { resources: [seedResource({ roleId: 2 })] },
    input: { id: 4, roleId: [3] },
    expectStored: { roleId: null },
  },
];

/** The live provider state as a `Workspace`, which is what `describeEntityCalls`
 *  takes. Read from `useWorkspace()` rather than rebuilt from the seed on
 *  purpose: a mirror fixture can drift from what the provider holds, and a
 *  preview grounded against a drifted workspace is not the preview production
 *  would render. */
function snapshot(ws: ReturnType<typeof useWorkspace>): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [...ws.tasks],
    raid: [...ws.raid],
    resources: [...ws.resources],
    roles: [...ws.roles],
    disciplines: [...ws.disciplines],
    grades: [...ws.grades],
    stakeholders: [...ws.stakeholders],
    milestones: [...ws.milestones],
    changes: [...ws.changes],
  };
}

type Row = Record<string, unknown> & { id: number };

function rowOf(ws: Workspace, c: WriteCase): Row {
  const rows = ws[c.wsKey] as ReadonlyArray<{ id: number }>;
  const found = rows.find((r) => r.id === c.id);
  // A missing row would make every assertion below vacuous in the passing
  // direction, so it is a hard error rather than a skipped case.
  if (!found) throw new Error(`fixture did not seed ${c.wsKey} #${c.id}`);
  return found as Row;
}

/** Preview the model's call, then REPLAY it through the real dispatcher and
 *  read the stored row back.
 *
 *  ★★ `expectedToken` is stamped from the STORED row, exactly as
 *  `chat-proposal-apply.ts` does it — that is the replay path this differential
 *  is about. Without it `requireToken` refuses the call and every read-back
 *  would compare a row against itself: green, and vacuous. */
async function previewAndWrite(c: WriteCase): Promise<{ plan: EditPlan; before: Row; stored: Row }> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith(c.seed) },
  );

  const wsBefore = snapshot(result.current.ws);
  const before = rowOf(wsBefore, c);

  const plan = describeEntityCalls([{ type: "tool_use", name: c.tool, input: c.input }], {
    descriptor: INLINE_DESCRIPTORS[c.entity],
    item: before,
    ws: wsBefore,
  });

  await act(async () => {
    await runTool(result.current.d, c.tool, {
      ...c.input,
      expectedToken: entityToken(c.kind, before),
    });
  });

  const stored = rowOf(snapshot(result.current.ws), c);
  return { plan, before, stored };
}

/** Every field name a `Rejected` entry blames. `detail` is `${field}=${value}`
 *  for a single field and `${a}+${b}=empty` for a group, so the names are the
 *  `+`-split of everything left of the FIRST `=` (a rejected value may itself
 *  contain one — an email, a date). */
function rejectedFields(plan: EditPlan): string[] {
  return plan.rejected.flatMap((r) => {
    const eq = r.detail.indexOf("=");
    return eq <= 0 ? [] : r.detail.slice(0, eq).split("+");
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

beforeEach(() => {
  // The minter is module-scoped; nothing here creates, but resetting keeps this
  // file order-independent under `npm run test:shuffle`.
  resetMintState();
});

describe.each(CASES)("write-path differential — $name", (c) => {
  it("previews every field the dispatcher actually stored", async () => {
    const { plan, before, stored } = await previewAndWrite(c);

    // Anti-vacuity: a refused write (a stale token, a thrown sanitizer) would
    // leave the row untouched and make every comparison below trivially true.
    expect(stored).not.toBe(before);

    for (const [field, value] of Object.entries(c.expectStored)) {
      expect(stored[field], `${field} was not stored as expected`).toEqual(value);
      const shown =
        plan.updates.some((d) => d.field === field) || plan.links.some((d) => d.field === field);
      const unchanged = same(before[field], stored[field]);
      // Either the preview disclosed the change, or there was no change.
      expect(shown || unchanged, `${field} changed with no preview line`).toBe(true);
    }
  });

  it("changes nothing the preview called rejected", async () => {
    const { plan, before, stored } = await previewAndWrite(c);
    for (const field of rejectedFields(plan)) {
      expect(
        same(before[field], stored[field]),
        `${field} was previewed as rejected and then written: ` +
          `${JSON.stringify(before[field])} -> ${JSON.stringify(stored[field])}`,
      ).toBe(true);
    }
  });
});

/** The stored task #1, read the way `rowOf` reads a `CASES` row and for the same
 *  reason: a missing row would make every assertion below vacuous in the passing
 *  direction, so it is a hard error rather than a silent `undefined`. */
function taskRow(ws: Workspace): Task {
  const found = ws.tasks.find((t) => t.id === 1);
  if (!found) throw new Error("fixture did not seed task #1");
  return found;
}

/** ★★★ THE REFUSAL SHAPE `CASES` STRUCTURALLY CANNOT HOLD, which is why this
 *  sits outside it rather than as a tenth entry. Every case above asserts a
 *  write that LANDS — `expect(stored).not.toBe(before)` is its anti-vacuity
 *  guard — so a tool call the dispatcher THROWS on cannot be expressed there:
 *  the row is untouched by construction and that very guard would go red for
 *  the right reason. The property is the same one the file is about, asserted
 *  from the other side: the preview refuses `taskName=empty`, so the REPLAY
 *  must refuse it too rather than storing "".
 *
 *  ★★ AND THE PARITY SWEEP CANNOT SEE THIS AT ALL. `plan.sanitizer-parity.
 *  test.ts` drives `buildTaskCleanPatch` directly; it can prove the FUNCTION
 *  throws, never that the throw survives `buildPatch`'s coercion, the token
 *  check and the dispatcher's merge to leave the stored row alone. That whole
 *  chain is what the replaying consumers (`chat-proposal-apply.ts`,
 *  `use-insight-recommendations.ts`) actually run.
 *
 *  ★★ `taskName: null` rather than `""` on purpose — it is the shape a model
 *  reaches the writer with, and the one that makes this non-exotic. `buildPatch`
 *  (chat-tools-updates.ts) gates on `input.taskName !== undefined` and then
 *  collapses ANY non-string to `""`, so a null buried in a multi-field patch
 *  arrives at `buildTaskCleanPatch` as a blank.
 *
 *  ★ The `priority` half is the blast-radius assertion, not decoration: a throw
 *  costs the WHOLE patch, so the co-supplied field must not land either. A guard
 *  that dropped the bad name and carried on would store the priority under a
 *  card that had promised a rename. */
describe("write-path differential — a preview refusal is a WRITE refusal", () => {
  it("refuses an empty taskName instead of blanking the stored one", async () => {
    const { result } = renderHook(
      () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
      { wrapper: dispatcherWrapperWith({ tasks: [seedTask(1, "First")] }) },
    );

    const wsBefore = snapshot(result.current.ws);
    const before = taskRow(wsBefore);
    const input = { id: 1, taskName: null, priority: "Urgent" };

    const plan = describeEntityCalls([{ type: "tool_use", name: "update_task", input }], {
      descriptor: INLINE_DESCRIPTORS.task,
      item: before,
      ws: wsBefore,
    });
    // Anti-vacuity for the whole test: were the preview to stop rejecting this,
    // the write-side assertions below would be about nothing in particular.
    expect(rejectedFields(plan)).toContain("taskName");

    await act(async () => {
      await expect(
        runTool(result.current.d, "update_task", {
          ...input,
          expectedToken: entityToken("task", before),
        }),
      ).rejects.toThrow(/taskName is required/);
    });

    const stored = taskRow(snapshot(result.current.ws));
    expect(stored.taskName).toBe("First");
    expect(stored.priority).toBe(before.priority);
  });
});
