import { describe, expect, test } from "vitest";
import { describeProposal, TOOL_ENTITY } from "./chat-proposal-describe";
import { isEntityWriteTool, type ProposedCall } from "./chat-proposal";
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

  // ★★ The resolution of the `update_resource` gap: `UPDATE_TARGET`
  // (`insights/recommend-tokens.ts`) has no `update_resource` row and
  // structurally cannot — its value type is `key: keyof RecommendPlanWorkspace`,
  // and that Pick has no `"resources"` — while `requireToken("resource", …)` is
  // live in `chat-tools.ts`. Stamping could never have supplied that token;
  // preserving the model's own one is what makes the row replayable.
  test("carries a resource call's own token through, which stamping could not supply", () => {
    const supplied = "resource-token-from-the-models-own-read";
    const rows = describeProposal(
      [call("update_resource", { id: 4, title: "Architect", expectedToken: supplied })],
      ws,
    );
    expect(rows[0].stamped.input.expectedToken).toBe(supplied);
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

describe("TOOL_ENTITY", () => {
  // Derived from INLINE_DESCRIPTORS rather than hand-typed, so it cannot drift
  // from the descriptor set. These two assertions pin the DERIVATION against the
  // gate's own reconciled write set, in both directions.
  test("names only tools the staging gate treats as entity writes", () => {
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
    for (const name of undescribable) {
      expect(isEntityWriteTool(name)).toBe(true);
      expect(name in TOOL_ENTITY).toBe(false);
    }
  });
});
