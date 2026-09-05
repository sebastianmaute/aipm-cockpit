// Pure tests for the chat staging helpers. Every guard here has a named mutant
// in the slice report; none of them needs the panel rendered.
import { describe, it, expect, beforeEach } from "vitest";
import {
  isCascadedRow,
  liveRowTitle,
  mintProvisionalIds,
  proposalTitles,
  stagedToolResult,
  STAGED_TOOL_RESULT,
} from "./chat-proposal-stage";
import { buildPlanRows, type PlanRow, type ProposedCall } from "./chat-proposal";
import { peekMintId, resetMintState } from "./id-mint-session";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { DescribedRow } from "./chat-proposal-describe";

function ws(over: Partial<Workspace> = {}): Workspace {
  return { ...emptyWorkspace(), ...over };
}

// The minter's high-water mark is MODULE state shared by every test in the
// process, so a test asserting an absolute id must start from a known mark.
// Without this the "reads the live list" test below passes for the wrong
// reason on any run where an earlier test already lifted the mark past 900.
beforeEach(() => resetMintState());

describe("mintProvisionalIds", () => {
  it("mints one id per create, in emission order, and nothing for a non-create", () => {
    const calls: ProposedCall[] = [
      { name: "create_task", input: { taskName: "a" } },
      { name: "update_task", input: { id: 1 } },
      { name: "create_task", input: { taskName: "b" } },
    ];
    const ids = mintProvisionalIds(calls, ws());
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0] + 1);
  });

  it("ADVANCES the session mark, so the id apply mints is strictly higher", () => {
    // ★ THE `peekMintId` MUTANT. Swap `mintIds` for `peekMintId` inside
    //   mintProvisionalIds and the mark does not move: `peekMintId` afterwards
    //   equals the provisional id instead of exceeding it, so the remap that
    //   reconciles a provisional id with the real one would be a NO-OP for the
    //   first create of every plan and live for the rest.
    const before = peekMintId("task", []);
    const [provisional] = mintProvisionalIds(
      [{ name: "create_task", input: { taskName: "a" } }],
      ws(),
    );
    expect(provisional).toBe(before);
    expect(peekMintId("task", [])).toBeGreaterThan(provisional);
  });

  it("clears the LIVE rows even when the session mark was never seeded", () => {
    // ★ THE EMPTY-LIST MUTANT. Replace `mintListFor(name, ws)` with `[]` and
    //   this returns 1 over a workspace whose highest task id is 900 — the
    //   unseeded-mark hazard `seedMintFromWorkspace` normally covers from a
    //   completely different module.
    const [id] = mintProvisionalIds(
      [{ name: "create_task", input: { taskName: "a" } }],
      ws({ tasks: [{ id: 900 }] as unknown as Workspace["tasks"] }),
    );
    expect(id).toBe(901);
  });

  it("keeps each entity's sequence separate", () => {
    const ids = mintProvisionalIds(
      [
        { name: "create_task", input: {} },
        { name: "create_milestone", input: {} },
      ],
      ws({
        tasks: [{ id: 40 }] as unknown as Workspace["tasks"],
        milestones: [{ id: 7 }] as unknown as Workspace["milestones"],
      }),
    );
    expect(ids).toEqual([41, 8]);
  });

  it("mints a document create from the documents slice", () => {
    const [id] = mintProvisionalIds(
      [{ name: "create_document", input: { title: "d" } }],
      ws({ documents: [{ id: 12 }] as unknown as Workspace["documents"] }),
    );
    expect(id).toBe(13);
  });

  it("throws on a create tool with no CREATE_MINT_KIND entry", () => {
    expect(() => mintProvisionalIds([{ name: "create_widget", input: {} }], ws())).toThrow(
      /CREATE_MINT_KIND/,
    );
  });

  it("pairs its output with buildPlanRows without a RangeError", () => {
    const calls: ProposedCall[] = [
      { name: "create_task", input: {} },
      { name: "create_raid_item", input: {} },
      { name: "delete_task", input: { id: 3 } },
    ];
    const rows = buildPlanRows(calls, mintProvisionalIds(calls, ws()));
    expect(rows.map((r) => r.mintedId !== undefined)).toEqual([true, true, false]);
  });
});

describe("stagedToolResult", () => {
  it("is the bare notice for a call that mints nothing", () => {
    expect(stagedToolResult(undefined)).toBe(STAGED_TOOL_RESULT);
  });

  it("discloses the provisional id for a create, and calls it provisional", () => {
    const text = stagedToolResult(42);
    expect(text).toContain("id 42");
    expect(text).toContain("provisional");
    // The "do not re-issue" half must survive on BOTH branches — a model told
    // only that nothing happened re-calls the tool and stages a duplicate row.
    expect(text).toContain("Do not call this tool again");
  });
});

describe("isCascadedRow", () => {
  const rows: PlanRow[] = [
    { index: 0, call: { name: "create_task", input: {} }, mintedId: 5 },
    {
      index: 1,
      call: { name: "update_task", input: { id: 5 } },
      dependsOn: 0,
      dependsOnAll: [0],
    },
    { index: 2, call: { name: "update_task", input: { id: 99 } } },
  ];

  it("is false for a row the user kept", () => {
    expect(isCascadedRow(rows[1], new Set([0, 1]))).toBe(false);
  });

  it("is true for an unselected row whose dependency is unselected", () => {
    expect(isCascadedRow(rows[1], new Set([2]))).toBe(true);
  });

  it("is false for an unselected row the user simply unticked", () => {
    // Row 2 depends on nothing, so unticking it is the user's own choice and
    // must stay re-tickable. ★ Mutant: return `!selected.has(row.index)` and
    // this goes red — every unticked row would lock itself out.
    expect(isCascadedRow(rows[2], new Set([0, 1]))).toBe(false);
  });

  it("reads dependsOn even when dependsOnAll is absent (hand-built row)", () => {
    // ★ Mutant: drop the `dependsOn` branch. `buildPlanRows` always mirrors it
    //   into dependsOnAll, so only a hand-built row can tell the two apart —
    //   the same asymmetry `cascadeDeselect` guards against.
    const handBuilt: PlanRow = {
      index: 1,
      call: { name: "update_task", input: { id: 5 } },
      dependsOn: 0,
    };
    expect(isCascadedRow(handBuilt, new Set<number>())).toBe(true);
  });

  it("reads dependsOnAll even when dependsOn is absent (a link-only edge)", () => {
    // ★ Mutant: drop the dependsOnAll branch. A create that only LINKS to
    //   another create has no `dependsOn` by design — see PlanRow's docstring.
    const linkOnly: PlanRow = {
      index: 1,
      call: { name: "create_raid_item", input: { linkedTaskIds: [5] } },
      mintedId: 9,
      dependsOnAll: [0],
    };
    expect(isCascadedRow(linkOnly, new Set<number>())).toBe(true);
  });
});

describe("liveRowTitle", () => {
  const workspace = ws({
    tasks: [{ id: 7, taskName: "Migrate the billing job" }] as unknown as Workspace["tasks"],
  });

  it("resolves an update's target id to the live row's own title", () => {
    expect(liveRowTitle({ name: "update_task", input: { id: 7 } }, workspace)).toBe(
      "Migrate the billing job",
    );
  });

  it("is null for a create, which addresses no existing row", () => {
    expect(liveRowTitle({ name: "create_task", input: { taskName: "x" } }, workspace)).toBeNull();
  });

  it("is null when the id names no live row", () => {
    expect(liveRowTitle({ name: "update_task", input: { id: 404 } }, workspace)).toBeNull();
  });

  it("is null for a tool with no descriptor entity", () => {
    expect(liveRowTitle({ name: "update_document", input: { id: 7 } }, workspace)).toBeNull();
  });

  it("is null when the live row's title is blank, so the caller can fall back", () => {
    const blank = ws({ tasks: [{ id: 7, taskName: "  " }] as unknown as Workspace["tasks"] });
    expect(liveRowTitle({ name: "update_task", input: { id: 7 } }, blank)).toBeNull();
  });
});

describe("proposalTitles", () => {
  it("prefers the live row and falls back per row", () => {
    const workspace = ws({
      tasks: [{ id: 7, taskName: "Live name" }] as unknown as Workspace["tasks"],
    });
    const rows = [
      { call: { name: "update_task", input: { id: 7 } } },
      { call: { name: "create_document", input: { title: "New doc" } } },
    ] as unknown as DescribedRow[];
    expect(proposalTitles(rows, workspace, (r) => `fallback:${r.call.name}`)).toEqual([
      "Live name",
      "fallback:create_document",
    ]);
  });
});
