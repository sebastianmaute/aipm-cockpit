import { describe, expect, test } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";
import {
  buildPlanRows,
  cascadeDeselect,
  isCreateTool,
  isDestructiveTool,
  isEntityWriteTool,
  shouldStage,
  type ProposedCall,
} from "./chat-proposal";

const call = (name: string, input: Record<string, unknown> = {}): ProposedCall => ({ name, input });

describe("shouldStage", () => {
  test.each([
    ["no calls",                       [],                                                   false],
    ["reads only",                     [call("list_tasks"), call("get_task", { id: 1 })],     false],
    ["one create",                     [call("create_task")],                                false],
    ["one update",                     [call("update_task", { id: 1 })],                     false],
    ["one update plus reads",          [call("list_tasks"), call("update_task", { id: 1 })],  false],
    ["two writes",                     [call("create_task"), call("update_task", { id: 1 })], true],
    ["one delete",                     [call("delete_task", { id: 1 })],                     true],
    ["delete plus a read",             [call("list_tasks"), call("delete_task", { id: 1 })],  true],
    ["delete_all_tasks alone",         [call("delete_all_tasks")],                           true],
    ["settings are not entity writes", [call("set_language"), call("set_filters")],           false],
    // Added in task 7 after reconciling against the live TOOL_DEFS array.
    ["update_settings is not an entity write", [call("update_settings"), call("set_language")], false],
    ["one send_inquiry",               [call("send_inquiry", { id: 1 })],                    false],
    ["two send_inquiry",               [call("send_inquiry", { id: 1 }), call("send_inquiry", { id: 2 })], true],
    ["one create_document",            [call("create_document")],                            false],
    ["one update_document",            [call("update_document", { id: 1 })],                 false],
    ["two document writes",            [call("create_document"), call("update_document", { id: 1 })], true],
    ["one delete_document",            [call("delete_document", { id: 1 })],                 true],
  ])("%s -> %s", (_label, calls, expected) => {
    expect(shouldStage(calls as ProposedCall[])).toBe(expected);
  });
});

// ★★ The three lists below are LITERALS, deliberately NOT derived from the
//    module under test — deriving them would make every assertion here
//    tautological. They are the second, independent copy of the classification,
//    so a typo in either copy shows up as a red row naming the tool.
const DESTRUCTIVE_NAMES = [
  "delete_task", "delete_all_tasks", "delete_resource", "delete_raid_item",
  "delete_change", "delete_milestone", "delete_stakeholder", "delete_document",
];

const NON_DESTRUCTIVE_WRITE_NAMES = [
  "create_task", "update_task", "set_task_dependencies", "send_inquiry",
  "create_resource", "update_resource",
  "create_raid_item", "update_raid_item",
  "create_change", "update_change",
  "create_milestone", "update_milestone",
  "create_stakeholder", "update_stakeholder",
  "create_document", "update_document",
];

const NON_WRITE_NAMES = [
  "list_tasks", "get_task", "set_filters", "set_language", "get_app_state",
  "get_dashboard_snapshot", "list_raid", "list_changes", "list_milestones",
  "list_stakeholders", "list_resources", "list_allocations",
  "list_knowledge_items", "list_calendar_events", "list_budget_buckets",
  "search_history", "search_chats", "get_resource", "update_settings",
  "list_documents", "get_document",
];

describe("the classification covers the live tool surface", () => {
  test.each(DESTRUCTIVE_NAMES)("%s stages on its own", (name) => {
    expect(isDestructiveTool(name)).toBe(true);
    expect(shouldStage([call(name)])).toBe(true);
  });

  test.each(NON_DESTRUCTIVE_WRITE_NAMES)("%s counts as a write but does not stage alone", (name) => {
    expect(isDestructiveTool(name)).toBe(false);
    expect(isEntityWriteTool(name)).toBe(true);
    expect(shouldStage([call(name)])).toBe(false);
    expect(shouldStage([call(name), call(name)])).toBe(true);
  });

  test.each(NON_WRITE_NAMES)("%s is not an entity write", (name) => {
    expect(isEntityWriteTool(name)).toBe(false);
    expect(shouldStage([call(name), call(name)])).toBe(false);
  });

  // ★★★ THE GUARD THAT MATTERS. A tool added to `TOOL_DEFS` later and left out
  //     of `chat-proposal.ts` is invisible to every row above — its writes would
  //     silently never count toward the gate. This partitions the LIVE array
  //     against the three literals, so a new tool fails here until somebody
  //     classifies it.
  test("every live tool is classified exactly once", () => {
    const live = (TOOL_DEFS as ReadonlyArray<{ name: string }>).map((d) => d.name);
    const classified = [...DESTRUCTIVE_NAMES, ...NON_DESTRUCTIVE_WRITE_NAMES, ...NON_WRITE_NAMES];
    expect([...classified].sort()).toEqual([...live].sort());
  });
});

// ---------------------------------------------------------------------------
// Task 8 — the provisional-id dependency graph the review card cascades over.

describe("isCreateTool", () => {
  // ★★ A LITERAL, deliberately not derived from the module — same rule as the
  //    three lists above. `buildPlanRows` consumes one minted id per create, so
  //    a new `create_*` tool landing in TOOL_DEFS with nobody minting for it is
  //    a cascade that silently never links. This row goes red until somebody
  //    looks at it.
  const CREATE_NAMES = [
    "create_task", "create_raid_item", "create_change", "create_milestone",
    "create_stakeholder", "create_resource", "create_document",
  ];

  test("matches exactly the live create tools", () => {
    const live = (TOOL_DEFS as ReadonlyArray<{ name: string }>).map((d) => d.name);
    expect(live.filter((n) => isCreateTool(n)).sort()).toEqual([...CREATE_NAMES].sort());
  });
});

describe("provisional-id dependencies", () => {
  test("a call referencing an earlier create's minted id depends on it", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),
        call("set_task_dependencies", { id: 101, dependencies: [] }),
        call("update_task", { id: 55 }),
      ],
      [101], // ids minted for the creates, in order
    );

    expect(rows[0].mintedId).toBe(101);
    expect(rows[1].dependsOn).toBe(0);          // references the create at index 0
    expect(rows[2].dependsOn).toBeUndefined();  // #55 is a pre-existing row
  });

  test("deselecting a create deselects everything that depends on it", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),
        call("set_task_dependencies", { id: 101, dependencies: [] }),
        call("update_task", { id: 55 }),
      ],
      [101],
    );

    const next = cascadeDeselect(rows, new Set([0, 1, 2]), 0);
    expect(next.has(0)).toBe(false);
    expect(next.has(1)).toBe(false); // cascaded
    expect(next.has(2)).toBe(true);  // independent, untouched
  });

  test("cascade is transitive", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),
        call("update_task", { id: 101 }),
        call("set_task_dependencies", { id: 101 }),
      ],
      [101],
    );
    const next = cascadeDeselect(rows, new Set([0, 1, 2]), 0);
    expect(next.size).toBe(0);
  });

  // `Number(undefined)` is NaN, and a NaN Map lookup would find nothing anyway —
  // but only because nothing can mint NaN. Pinned so a future "default the id to
  // 0" cannot quietly hang every id-less call off row 0.
  test("a call carrying no id at all depends on nothing", () => {
    const rows = buildPlanRows([call("create_task"), call("delete_all_tasks")], [101]);
    expect(rows[1].dependsOn).toBeUndefined();
  });

  // ★★★ The row that fails a two-pass implementation. Resolving against a fully
  //     built id map would hang this update off the create BELOW it — a rejected
  //     create that cascades backwards into a call the user never linked to it.
  test("a forward reference resolves to nothing, not to the wrong row", () => {
    const rows = buildPlanRows(
      [call("update_task", { id: 101 }), call("create_task")],
      [101],
    );
    expect(rows[0].dependsOn).toBeUndefined();
    expect(rows[1].mintedId).toBe(101);
  });

  test("a create never depends on an earlier create, even when it carries an id", () => {
    const rows = buildPlanRows(
      [call("create_task"), call("create_task", { id: 101 })],
      [101, 102],
    );
    expect(rows[1].mintedId).toBe(102);
    expect(rows[1].dependsOn).toBeUndefined();
  });

  test("two creates each cascade to their own dependent only", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),                // 0 -> mints 101
        call("create_task"),                // 1 -> mints 102
        call("update_task", { id: 101 }),   // 2 -> depends on 0
        call("update_task", { id: 102 }),   // 3 -> depends on 1
      ],
      [101, 102],
    );
    expect(rows.map((r) => r.mintedId)).toEqual([101, 102, undefined, undefined]);
    expect(rows.map((r) => r.dependsOn)).toEqual([undefined, undefined, 0, 1]);

    const next = cascadeDeselect(rows, new Set([0, 1, 2, 3]), 0);
    expect([...next].sort()).toEqual([1, 3]);
  });

  // ★ Deliberate: `chat-tools.ts` addresses every row with `Number(input.id)`,
  //   so a string id WOULD reach the created row at apply time. The graph links
  //   exactly where the dispatcher would write.
  test("a string id links, because the dispatcher coerces the same way", () => {
    const rows = buildPlanRows([call("create_task"), call("update_task", { id: "101" })], [101]);
    expect(rows[1].dependsOn).toBe(0);
  });

  test("cascadeDeselect does not mutate the set it is given", () => {
    const rows = buildPlanRows([call("create_task"), call("update_task", { id: 101 })], [101]);
    const selected = new Set([0, 1]);
    const next = cascadeDeselect(rows, selected, 0);

    expect([...selected].sort()).toEqual([0, 1]);
    expect(next.size).toBe(0);
  });

  // ★★ THIS ROW IS THE ONE THAT DISCRIMINATES `cascadeDeselect`'s delete-guard,
  //    and the plan predicted the guard was an equivalent mutant. It is not:
  //    without it the walk runs past an already-deselected row into that row's
  //    dependents. Do not delete this test as redundant — it is the whole
  //    statement that the cascade stops where the deselection stops.
  test("deselecting a row already deselected leaves the rest alone", () => {
    const rows = buildPlanRows([call("create_task"), call("update_task", { id: 101 })], [101]);
    const next = cascadeDeselect(rows, new Set([1]), 0);
    expect([...next]).toEqual([1]);
  });

  // ★★ The alternative is a row with no `mintedId`, whose dependents then link to
  //    nothing — the exact silent failure the cascade exists to prevent.
  test("fewer minted ids than creates throws rather than silently unlinking", () => {
    expect(() => buildPlanRows([call("create_task"), call("create_task")], [101])).toThrow(
      /minted id/i,
    );
  });
});
