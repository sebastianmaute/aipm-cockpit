import { describe, expect, test } from "vitest";
import { describeProposal, TOOL_ENTITY } from "./chat-proposal-describe";
import { buildPlanRows, isEntityWriteTool, type ProposedCall } from "./chat-proposal";
import { TOOL_DEFS } from "./chat-tool-defs";
import { entityToken } from "./ai-entity-token";
import type { Workspace } from "./workspace";

// ★★ THE THREE TASK ROWS CARRY DISTINCT IDS ON PURPOSE. `describeEntityCalls`
// is bound to ONE `ctx.item` and rejects any update whose `input.id` differs,
// so a fixture whose rows shared an id would let a once-for-the-whole-plan
// implementation pass — the exact mutant the first test below exists to kill.
const task1 = { id: 1, taskName: "A", status: "To Do", dueDate: "2026-08-12" };
const task2 = { id: 2, taskName: "B", status: "To Do", dueDate: "2026-08-13" };
const task3 = { id: 3, taskName: "C", status: "To Do", dueDate: "2026-08-14" };
const milestone9 = { id: 9, name: "Go live", date: "2026-09-01", linkedTaskIds: [] };
// `resources` is the slice `RecommendPlanWorkspace` omits — see the regression
// pin below.
const resource4 = { id: 4, firstName: "Ada", lastName: "Lovelace", title: "Engineer" };

const ws = {
  tasks: [task1, task2, task3],
  raid: [],
  changes: [],
  milestones: [milestone9],
  stakeholders: [],
  resources: [resource4],
} as unknown as Workspace;

const call = (name: string, input: Record<string, unknown>): ProposedCall => ({ name, input });

describe("describeProposal", () => {
  test("describes a plan spanning three different task rows", () => {
    // THE point of this test. describeEntityCalls is bound to ONE ctx.item and
    // rejects any update whose input.id differs — so an implementation that
    // calls it ONCE for the whole plan describes row one and rejects the other
    // two. A single-row fixture cannot see that.
    const rows = describeProposal(
      [
        call("update_task", { id: 1, taskName: "A2" }),
        call("update_task", { id: 2, taskName: "B2" }),
        call("update_task", { id: 3, taskName: "C2" }),
      ],
      ws,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.plan.rejected.length === 0)).toBe(true);
    expect(rows.flatMap((r) => r.plan.updates)).toHaveLength(3);
    // Each row must describe ITS OWN target, not row one's, three times over.
    expect(rows.map((r) => r.plan.updates[0].after)).toEqual(["A2", "B2", "C2"]);
  });

  test("describes a plan spanning two different entities", () => {
    const rows = describeProposal(
      [
        call("update_task", { id: 1, taskName: "A2" }),
        call("update_milestone", { id: 9, name: "Go live (revised)" }),
      ],
      ws,
    );
    expect(rows).toHaveLength(2);
    expect(rows.flatMap((r) => r.plan.rejected)).toEqual([]);
    expect(rows[0].plan.updates).toEqual([
      { field: "taskName", before: "A", after: "A2", raw: "A2" },
    ]);
    expect(rows[1].plan.updates).toEqual([
      { field: "name", before: "Go live", after: "Go live (revised)", raw: "Go live (revised)" },
    ]);
  });

  // ★★ EQUALITY, NOT PRESENCE. A stamper attaching a constant, "" or the id
  // would satisfy `toHaveProperty("expectedToken")` and then be REFUSED by
  // `requireToken` at apply — a green test over a replay that can never commit.
  test("stamps a concurrency token on each update", () => {
    const rows = describeProposal([call("update_task", { id: 1, taskName: "A2" })], ws);
    expect(rows[0].stamped.input).toHaveProperty("expectedToken");
    expect(rows[0].stamped.input.expectedToken).toBe(entityToken("task", task1));
    // Non-mutating: the caller's own call object is untouched.
    expect(rows[0].call.input).not.toHaveProperty("expectedToken");
  });

  // ★★★ THE DIRECTION IS THE POINT, NOT THE PRESENCE. The model's token comes
  // from its OWN `get_*` read (T0) and so covers T0→confirm; one minted at stage
  // time (T1) covers only T1→confirm. Restamping therefore drops T0→T1 and stops
  // catching a concurrent writer who moved the row between the model's read and
  // the staging. `expectedToken` is present either way, so a presence assertion
  // cannot see the regression — this compares the VALUE, and the second
  // assertion is the anti-vacuity guard: it proves the fixture's token differs
  // from what a restamp would produce, so a restamp cannot pass by coincidence.
  test("preserves a model-supplied token instead of restamping it", () => {
    const supplied = "token-from-the-models-own-read";
    expect(supplied).not.toBe(entityToken("task", task1));
    const rows = describeProposal(
      [call("update_task", { id: 1, taskName: "A2", expectedToken: supplied })],
      ws,
    );
    expect(rows[0].stamped.input.expectedToken).toBe(supplied);
    expect(rows[0].stamped).toEqual(rows[0].call);
  });

  // A malformed token is preserved too. `requireToken` refuses a non-string, so
  // keeping it costs a loud refusal the user can retry; overwriting it would
  // turn that refusal into a PERMIT — the direction with no recovery.
  test("preserves even a malformed token rather than overwriting the refusal", () => {
    const rows = describeProposal(
      [call("update_task", { id: 1, taskName: "A2", expectedToken: 17 })],
      ws,
    );
    expect(rows[0].stamped.input.expectedToken).toBe(17);
  });

  // ★★★ THIS ROW CANNOT WITNESS TOKEN PRESERVATION, AND ITS TITLE USED TO CLAIM
  // IT DID. `UPDATE_TARGET` (`insights/recommend-tokens.ts`) has no
  // `update_resource` row and structurally cannot — its value type is
  // `key: keyof RecommendPlanWorkspace`, and that Pick has no `"resources"` —
  // so `stampCall` returns this call UNCHANGED. Replacing the `supplied != null`
  // conditional in `chat-proposal-describe.ts` with an unconditional
  // `stampCall(call, ws)` therefore leaves this row byte-identical and every
  // assertion below green; a title promising preservation over a body that
  // cannot fail on it is what stops the next audit. That mutant is killed by
  // the `update_task` test above, which compares the VALUE against the token a
  // restamp would produce.
  //
  // ★★ What this row uniquely pins is the OTHER half, and it is the half that
  // makes preservation matter here: nothing is minted for this entity at all,
  // while `requireToken("resource", …)` is live in `chat-tools.ts` — so a
  // resource row carrying no model token is a row that can never be applied.
  test("leaves a resource call unstamped, so only the model's own token can carry it", () => {
    // The discriminating assertion. A stamper that invented a placeholder for
    // an entity it has no target for — the constant/`""` hazard the token test
    // above names — goes red HERE, instead of surfacing as an unretryable
    // `requireToken` refusal at apply time.
    const bare = describeProposal([call("update_resource", { id: 4, title: "Architect" })], ws);
    expect(bare[0].stamped.input).not.toHaveProperty("expectedToken");
    const supplied = "resource-token-from-the-models-own-read";
    const rows = describeProposal(
      [call("update_resource", { id: 4, title: "Architect", expectedToken: supplied })],
      ws,
    );
    expect(rows[0].stamped.input.expectedToken).toBe(supplied);
    // The extra input key does not abort grounding — the row is still described.
    expect(rows[0].plan.updates).toHaveLength(1);
  });

  // ★★★ THE CASE A `{ id: NaN }` DELETE SEED WOULD HAVE BROKEN SILENTLY.
  // `describeEntityCalls`' own-entity delete guard compares `id !== item.id`,
  // and NaN compares unequal to everything — so a NaN sentinel rejects EVERY
  // own-entity delete as "unsupported" and the deletion never reaches the card.
  test("describes a delete row instead of rejecting it", () => {
    const rows = describeProposal([call("delete_task", { id: 2 })], ws);
    expect(rows).toHaveLength(1);
    expect(rows[0].plan.rejected).toEqual([]);
    expect(rows[0].plan.deletes).toEqual([
      { entity: "task", label: "B", toolName: "delete_task", id: 2 },
    ]);
  });

  // ★ The literal is DERIVED, not assumed: seeding the call's own id makes the
  // self-guard a trivial pass, so the row-lookup miss below is what rejects —
  // and that branch reports "unknown-id". (The "unsupported" literal is what
  // the self-guard reports, which this path deliberately never reaches.)
  test("rejects a delete for an id that no longer exists", () => {
    const rows = describeProposal([call("delete_task", { id: 999 })], ws);
    expect(rows[0].plan.deletes).toEqual([]);
    expect(rows[0].plan.rejected).toEqual([
      { toolName: "delete_task", reason: "unknown-id", detail: "999" },
    ]);
  });

  // ★★★ THE REASON, NOT THE REJECTION, IS WHAT THIS PINS — the row was rejected
  // either way. `seedItem` hands the delete branch the call's own id, and an
  // absent id makes that NaN; `describeEntityCalls`' own-entity guard is
  // `id !== item.id`, and NaN compares unequal to everything, so the guard
  // fired and reported "unsupported" — a reason meaning "this tool cannot
  // address that row from here". No seed value can rescue it (nothing is
  // `!== NaN`-false), so `describeProposal` intercepts the case and emits what
  // the engine's OWN row lookup would have produced. Swap the expectation below
  // to "unsupported" and the pre-fix code passes; that is the mutant.
  test("an id-less delete rejects as an unknown id, not as unsupported", () => {
    const rows = describeProposal([call("delete_task", {})], ws);
    expect(rows[0].plan.deletes).toEqual([]);
    expect(rows[0].plan.rejected).toEqual([
      { toolName: "delete_task", reason: "unknown-id", detail: "" },
    ]);
  });

  // The `detail` echoes what the model actually sent, exactly as `plan.ts`'s own
  // `str` would — so the reason a row was refused is readable from the card.
  test("a non-numeric delete id rejects as an unknown id and echoes what was sent", () => {
    const rows = describeProposal([call("delete_task", { id: "not-a-number" })], ws);
    expect(rows[0].plan.rejected).toEqual([
      { toolName: "delete_task", reason: "unknown-id", detail: "not-a-number" },
    ]);
  });

  // ★ Anti-vacuity for the pair above: a NUMERIC id that simply misses still
  //   travels the engine's own path, so the interception cannot have swallowed
  //   the normal case. (`{ id: "2" }` coerces to a live row and is described.)
  test("a numeric-string delete id still grounds against the live row", () => {
    const rows = describeProposal([call("delete_task", { id: "2" })], ws);
    expect(rows[0].plan.rejected).toEqual([]);
    expect(rows[0].plan.deletes).toEqual([
      { entity: "task", label: "B", toolName: "delete_task", id: 2 },
    ]);
  });

  test("describes a create row with no target row present", () => {
    const rows = describeProposal(
      [call("create_task", { taskName: "New thing", dueDate: "2026-10-01" })],
      ws,
    );
    expect(rows[0].plan.rejected).toEqual([]);
    expect(rows[0].plan.creates).toHaveLength(1);
    expect(rows[0].plan.creates[0]).toMatchObject({ entity: "task", title: "New thing" });
  });

  // ★★★ REGRESSION PIN FOR TAKING THE FULL `Workspace`. `RecommendPlanWorkspace`
  // (`insights/recommend-plan.ts`) is a Pick of five slices with NO `resources`,
  // and `describeEntityCalls` builds `ownIds` from `ws[d.wsKey]` UNGUARDED —
  // so reusing that type here would THROW on this call rather than yield a plan.
  test("grounds a resource call, the entity RecommendPlanWorkspace omits", () => {
    const rows = describeProposal([call("update_resource", { id: 4, title: "Architect" })], ws);
    expect(rows[0].plan.rejected).toEqual([]);
    expect(rows[0].plan.updates).toEqual([
      { field: "title", before: "Engineer", after: "Architect", raw: "Architect" },
    ]);
  });

  // A row the user cannot see is a row they cannot reject. The descriptor engine
  // has no `document` entity, so the plan is empty — but the ROW still exists.
  test("still produces a row for a tool with no descriptor", () => {
    const rows = describeProposal(
      [call("create_document", { title: "Kickoff" }), call("delete_document", { id: 5 })],
      ws,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.call.name)).toEqual(["create_document", "delete_document"]);
    for (const r of rows) {
      expect(r.plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
      // Nothing is invented for it — the call is forwarded verbatim.
      expect(r.stamped).toEqual(r.call);
    }
  });

  test("returns rows in the same order as the input calls", () => {
    const calls = [
      call("create_task", { taskName: "New", dueDate: "2026-10-01" }),
      call("update_milestone", { id: 9, name: "Go live (revised)" }),
      call("delete_task", { id: 2 }),
      call("update_task", { id: 3, taskName: "C2" }),
    ];
    const rows = describeProposal(calls, ws);
    expect(rows.map((r) => r.call.name)).toEqual([
      "create_task", "update_milestone", "delete_task", "update_task",
    ]);
    expect(rows.map((r) => r.call)).toEqual(calls);
    expect(rows.flatMap((r) => r.plan.rejected)).toEqual([]);
    expect(rows[0].plan.creates).toHaveLength(1);
    expect(rows[1].plan.updates).toHaveLength(1);
    expect(rows[2].plan.deletes).toHaveLength(1);
    expect(rows[3].plan.updates).toHaveLength(1);
  });

  test("leaves the caller's calls untouched", () => {
    const input = { id: 1, taskName: "A2" };
    const calls = [call("update_task", input)];
    describeProposal(calls, ws);
    expect(input).toEqual({ id: 1, taskName: "A2" });
  });
});

// ---------------------------------------------------------------------------
// Rows whose target will be minted by a create staged EARLIER in the same turn.

describe("rows pending on a staged create", () => {
  const newTask = () => call("create_task", { taskName: "New thing", dueDate: "2026-10-01" });

  // ★★★ THE TWO HALVES USED TO DESCRIBE ONE CALL INCOMPATIBLY. `buildPlanRows`
  // makes this update a first-class applyable dependency (`dependsOn: 0`), while
  // grounding it against the LIVE workspace misses the provisional id and
  // reports `{ reason: "unknown-id" }` — so the card would have rendered "will
  // not be applied" over a row the design intends to apply after the remap.
  test("an update addressing a provisional id is pending, not rejected", () => {
    const calls = [newTask(), call("update_task", { id: 101, taskName: "Renamed" })];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));

    expect(rows[1].pendingOn).toBe(0);
    expect(rows[1].plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
    // The create itself is still described normally.
    expect(rows[0].pendingOn).toBeUndefined();
    expect(rows[0].plan.creates).toHaveLength(1);
  });

  // ★★★ THE ANTI-VACUITY HALF, and without it the row above proves nothing: it
  // would pass equally against an implementation that simply stopped rejecting
  // unknown ids. The SAME call, described with no plan rows, must still produce
  // the genuine rejection — so `pendingOn` can only come from the plan rows.
  test("the same call without plan rows still reports the genuine unknown id", () => {
    const rows = describeProposal([call("update_task", { id: 101, taskName: "Renamed" })], ws);
    expect(rows[0].pendingOn).toBeUndefined();
    expect(rows[0].plan.rejected).toEqual([
      { toolName: "update_task", reason: "unknown-id", detail: "101" },
    ]);
  });

  // The rejection this fix must NOT weaken: 999 is minted by nobody.
  test("a genuine unknown id stays rejected even when plan rows are supplied", () => {
    const calls = [newTask(), call("update_task", { id: 999, taskName: "Renamed" })];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));
    expect(rows[1].pendingOn).toBeUndefined();
    expect(rows[1].plan.rejected).toEqual([
      { toolName: "update_task", reason: "unknown-id", detail: "999" },
    ]);
  });

  // ★★ A FORWARD reference is a genuine unknown id, and this is why the pending
  // test reads `PlanRow.dependsOn` rather than a flat set of provisional ids.
  // `buildPlanRows` links only BACKWARD, so an update emitted BEFORE the create
  // that mints its id really will not be applyable — a flat-set implementation
  // would call it pending and hide that.
  test("an update emitted before its create is a genuine unknown id, not pending", () => {
    const calls = [call("update_task", { id: 101, taskName: "Renamed" }), newTask()];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));
    expect(rows[0].pendingOn).toBeUndefined();
    expect(rows[0].plan.rejected).toEqual([
      { toolName: "update_task", reason: "unknown-id", detail: "101" },
    ]);
  });

  test("a delete addressing a provisional id is pending, not an unknown id", () => {
    const calls = [newTask(), call("delete_task", { id: 101 })];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));
    expect(rows[1].pendingOn).toBe(0);
    expect(rows[1].plan.rejected).toEqual([]);
    expect(rows[1].plan.deletes).toEqual([]);
  });

  // ★★★ A CREATE THAT MERELY LINKS TO ANOTHER CREATE IS NOT PENDING. Its own
  // target is real and describable; only `PlanRow.dependsOn` (the TARGET edge)
  // marks a row pending, never `dependsOnAll` (which also carries link edges).
  // Collapsing the two would blank this row on the card.
  test("a create that only LINKS a provisional id is still described", () => {
    const calls = [newTask(), call("create_raid_item", { title: "R", linkedTaskIds: [101] })];
    const planRows = buildPlanRows(calls, [101, 7]);
    expect(planRows[1].dependsOnAll).toEqual([0]); // it IS linked...
    const rows = describeProposal(calls, ws, planRows);
    expect(rows[1].pendingOn).toBeUndefined();     // ...but not pending
    expect(rows[1].plan.creates).toHaveLength(1);
  });

  // A pending row cannot be tokenised against a row that does not exist yet, and
  // a token the model supplied is preserved through the pending branch too.
  test("a pending row is forwarded verbatim, model token and all", () => {
    const calls = [newTask(), call("update_task", { id: 101, expectedToken: "t" })];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));
    expect(rows[1].stamped).toEqual(rows[1].call);
    expect(rows[1].stamped.input.expectedToken).toBe("t");
  });

  test("misaligned plan rows throw rather than describing against the wrong row", () => {
    expect(() => describeProposal([call("update_task", { id: 1 })], ws, [])).toThrow(/plan rows/i);
  });
});

describe("TOOL_ENTITY", () => {
  // Derived from INLINE_DESCRIPTORS rather than hand-typed, so it cannot drift
  // from the descriptor set. The two TESTS below pin that derivation against the
  // gate's own reconciled write set in both directions over the live tool
  // surface: this one checks every derived key IS a write, the next that every
  // write is either derived or knowingly undescribable. (The claim used to sit
  // on the two ASSERTIONS in this test alone, neither of which checks the second
  // direction — a tool the gate stages with no descriptor passed both.)
  test("names only tools the staging gate treats as entity writes", () => {
    // Anti-vacuity: with no count, an empty TOOL_ENTITY passes the filter below.
    expect(Object.keys(TOOL_ENTITY).length).toBe(18);
    const notWrites = Object.keys(TOOL_ENTITY).filter((n) => !isEntityWriteTool(n));
    expect(notWrites).toEqual([]);
  });

  test("omits exactly the stageable write tools the descriptor engine cannot diff", () => {
    // These reach the card as rows with an empty plan (see the no-descriptor
    // test above). Listing them here makes a NEW undescribable tool visible
    // rather than letting it appear as a silently blank row.
    const undescribable = [
      "create_document", "update_document", "delete_document",
      "delete_all_tasks", "send_inquiry", "set_task_dependencies",
    ];
    // ★★★ THE DIRECTION IS THE WHOLE POINT. Iterating that literal and asserting
    // each member is a write absent from TOOL_ENTITY checks the LITERAL against
    // the code and NEVER the code against the literal — so a tool added to
    // `TOOL_DEFS` and to `ENTITY_WRITE_TOOLS` with no descriptor satisfies every
    // such assertion and still reaches the card as the silently blank row this
    // test claims to make visible. The COMPLEMENT is therefore derived from the
    // live tool surface and compared as a set: a new undescribable tool makes it
    // longer than the literal and names itself in the diff. The literal stays as
    // the human-readable record of what is knowingly undescribable.
    // ★ `TOOL_DEFS` is the right universe because `chat-proposal.test.ts`'s
    // "every live tool is classified exactly once" pins that array as the whole
    // live surface. RESIDUAL GAP: `ENTITY_WRITE_TOOLS` is not exported, so a
    // name added to that set and to NO tool schema stays invisible here — it is
    // equally unreachable by the model, so it cannot reach the card either.
    const derived = (TOOL_DEFS as ReadonlyArray<{ name: string }>)
      .map((d) => d.name)
      .filter((n) => isEntityWriteTool(n) && !(n in TOOL_ENTITY));
    expect(derived.sort()).toEqual([...undescribable].sort());
  });
});

// ---------------------------------------------------------------------------
// §378 — the provisional id a create row was paired with, carried through so the
// apply path can learn which id the real minter replaces.

describe("mintedId is carried onto the described row", () => {
  const newTask = () => call("create_task", { taskName: "New thing", dueDate: "2026-10-01" });

  test("a create row carries its provisional id and a non-create carries none", () => {
    const calls = [newTask(), call("update_task", { id: 101, taskName: "Renamed" })];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));

    expect(rows[0].mintedId).toBe(101);
    // The dependent names 101 through its `input.id`, so a `mintedId` here would
    // make `applyProposal` record the UPDATE as the row that minted it.
    expect(rows[1].mintedId).toBeUndefined();
  });

  // ★★★ THE ANTI-VACUITY HALF: without plan rows there is no provisional id to
  // carry, so the field must be absent. Otherwise the assertion above would pass
  // against an implementation that read the id from the CALL's own input.
  test("no plan rows means no mintedId", () => {
    const rows = describeProposal([newTask()], ws);
    expect(rows[0].mintedId).toBeUndefined();
  });

  // ★★ EVERY BRANCH CARRIES IT, and this is the one that is easy to miss:
  // `create_document` has no `INLINE_DESCRIPTORS` entry, so it takes the
  // empty-plan branch rather than the descriptor branch. A create whose
  // `mintedId` were dropped there would never be recorded at apply time, and its
  // dependents would all refuse.
  test("a descriptor-less create still carries it", () => {
    const calls = [call("create_document", { title: "Doc" })];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [55]));
    expect(rows[0].plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
    expect(rows[0].mintedId).toBe(55);
  });

  // A create and a pending row in one plan: both branches, one assertion, so a
  // patch that added the field to only the branch it was testing goes red.
  test("a create's id and a pending row's absence come from the same plan", () => {
    const calls = [
      newTask(),
      call("create_raid_item", { title: "R" }),
      call("update_raid_item", { id: 7, title: "Renamed" }),
    ];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101, 7]));
    expect(rows.map((r) => r.mintedId)).toEqual([101, 7, undefined]);
    expect(rows[2].pendingOn).toBe(1);
  });
});
