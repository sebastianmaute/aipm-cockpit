import { describe, expect, test } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";
import {
  buildPlanRows,
  cascadeDeselect,
  isCreateTool,
  isDestructiveCall,
  isDestructiveTool,
  isEntityWriteTool,
  shouldStage,
  TARGET_MINTED_BY,
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
// A payload-destructive call the NAME cannot classify.

describe("isDestructiveCall", () => {
  const replaceAll = (): ProposedCall =>
    call("update_document", { id: 5, ops: [{ op: "replaceAll", blocks: [] }] });

  // ★★★ THE ROW THE NAME-ONLY GATE MISSED. `update_document` is an ordinary
  //     entity write by name, so a single `replaceAll` scored `writes = 1` and
  //     a total document rewrite was never reviewed. The first two assertions
  //     are the anti-vacuity half: they state that the NAME still classifies it
  //     as benign, so the third can only be true because the PAYLOAD was read.
  test("a lone replaceAll stages, though the tool name is an ordinary write", () => {
    expect(isDestructiveTool("update_document")).toBe(false);
    expect(isEntityWriteTool("update_document")).toBe(true);
    expect(isDestructiveCall(replaceAll())).toBe(true);
    expect(shouldStage([replaceAll()])).toBe(true);
  });

  test("a targeted append does not stage", () => {
    const append = call("update_document", {
      id: 5,
      ops: [{ op: "append", block: { type: "pageBreak" } }],
    });
    expect(isDestructiveCall(append)).toBe(false);
    expect(shouldStage([append])).toBe(false);
  });

  // Not only the first op: the model may prepend an innocuous edit.
  test("a replaceAll anywhere in the op list stages", () => {
    const mixed = call("update_document", {
      id: 5,
      ops: [{ op: "append", block: { type: "pageBreak" } }, { op: "replaceAll", blocks: [] }],
    });
    expect(isDestructiveCall(mixed)).toBe(true);
  });

  // ★★ The op is read off `op`, never matched anywhere in the input — otherwise
  //    a document whose TITLE mentions the word would stage every edit to it.
  test("the op name is read from `op`, not matched across the input", () => {
    const titled = call("update_document", {
      id: 5,
      title: "replaceAll",
      ops: [{ op: "append", block: { type: "pageBreak" } }],
    });
    expect(isDestructiveCall(titled)).toBe(false);
  });

  // Every shape below is reachable — `input` is model output, not our own value.
  // ★ The table is TYPED rather than inferred: an inferred heterogeneous
  //   `test.each` array widens to a union that includes `string`, and an
  //   `input as Record<string, unknown>` against such a union is a tsc error
  //   (neither side is comparable to the other). vitest never typechecks, so
  //   that failure surfaces only in CI.
  const MALFORMED_DOC_INPUTS: [string, Record<string, unknown>][] = [
    ["ops absent",         { id: 5 }],
    ["ops is a string",    { id: 5, ops: "replaceAll" }],
    ["ops is an object",   { id: 5, ops: { op: "replaceAll" } }],
    ["ops holds a string", { id: 5, ops: ["replaceAll"] }],
    ["ops holds null",     { id: 5, ops: [null] }],
    ["ops holds an array", { id: 5, ops: [["replaceAll"]] }],
    ["op is not a string", { id: 5, ops: [{ op: 7 }] }],
    ["op is absent",       { id: 5, ops: [{ index: 0 }] }],
    ["input is empty",     {}],
  ];
  test.each(MALFORMED_DOC_INPUTS)(
    "malformed input (%s) neither throws nor stages",
    (_label, input) => {
      const c = call("update_document", input);
      expect(() => isDestructiveCall(c)).not.toThrow();
      expect(isDestructiveCall(c)).toBe(false);
      expect(shouldStage([c])).toBe(false);
    },
  );

  test("the name-based set still classifies at the call level", () => {
    expect(isDestructiveCall(call("delete_document", { id: 5 }))).toBe(true);
    expect(isDestructiveCall(call("delete_all_tasks"))).toBe(true);
    expect(isDestructiveCall(call("create_task"))).toBe(false);
  });

  // ★★★ A RECORDED GAP PINNED AS TODAY'S BEHAVIOUR — NOT A DESIRED PROPERTY.
  //     A sweep of `delete` ops in ONE call can empty a document and does not
  //     stage. The line drawn is EVIDENCE, not effect: `delete` requires an
  //     `expectHash` the model can only have got from a `get_document` read of
  //     that exact block, while `replaceAll` requires nothing. If this row is
  //     ever deliberately flipped, flip it here and rewrite this comment —
  //     do not delete the row as "wrong".
  test("a delete sweep that empties a document does NOT stage (recorded gap)", () => {
    const sweep = call("update_document", {
      id: 5,
      ops: [
        { op: "delete", index: 0, expectHash: "h0" },
        { op: "delete", index: 0, expectHash: "h1" },
      ],
    });
    expect(isDestructiveCall(sweep)).toBe(false);
    expect(shouldStage([sweep])).toBe(false);
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

// ---------------------------------------------------------------------------
// Provisional ids named through a field OTHER than `input.id`.

describe("link-field dependencies", () => {
  // ★★★ THE EXACT INPUT THAT APPLIED A DANGLING LINK. Row 1 is a CREATE, so the
  //     `input.id` lookup is skipped for it and it used to carry no dependency
  //     at all: refusing row 0 left row 1 selected, and `sanitizeIdList` stores
  //     a link to a task that will never exist without any referential check.
  test("a create linking an earlier create's minted task id cascades", () => {
    const rows = buildPlanRows(
      [call("create_task"), call("create_raid_item", { title: "R", linkedTaskIds: [101] })],
      [101, 7],
    );
    // Its OWN target is real, so it is not pending on anything — only linked.
    expect(rows[1].dependsOn).toBeUndefined();
    expect(rows[1].dependsOnAll).toEqual([0]);

    const next = cascadeDeselect(rows, new Set([0, 1]), 0);
    expect([...next]).toEqual([]);
  });

  // The milder half: `set_task_dependencies` refuses a link to a task that does
  // not exist and reports it in `rejected`, so this one was loud rather than
  // silent — but it is the same missing edge and is closed by the same table.
  test("a dependency's taskId links, not only the tool's own id", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),
        call("set_task_dependencies", { id: 55, dependencies: [{ taskId: 101, type: "FS" }] }),
      ],
      [101],
    );
    expect(rows[1].dependsOn).toBeUndefined(); // #55 is a pre-existing row
    expect(rows[1].dependsOnAll).toEqual([0]);
  });

  // ★★★ THE ROW THAT DISCRIMINATES ENTITY SCOPING, AND THE ORDER IS THE POINT.
  //     Ids are per-entity sequences, so both creates below mint 101. A lookup
  //     keyed by NUMBER alone returns the LAST writer of that key — the task
  //     create at index 1 — which is the wrong row. Reversing this fixture's
  //     first two calls would make a number-blind lookup accidentally right.
  test("a linked RAID id resolves to the RAID create, not a task minting the same number", () => {
    const rows = buildPlanRows(
      [
        call("create_raid_item", { title: "R" }), // 0 mints raid 101
        call("create_task"),                      // 1 mints task 101
        call("create_change", { title: "C", linkedRaidIds: [101] }),
      ],
      [101, 101, 55],
    );
    expect(rows[2].dependsOnAll).toEqual([0]);
  });

  test("a linked task id resolves to the task create, not a RAID minting the same number", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),                      // 0 mints task 101
        call("create_raid_item", { title: "R" }), // 1 mints raid 101
        call("create_milestone", { name: "M", date: "2026-10-01", linkedTaskIds: [101] }),
      ],
      [101, 101, 55],
    );
    expect(rows[2].dependsOnAll).toEqual([0]);
  });

  // ★★ `linkedTaskIds` is an ARRAY, so multi-dependency is its NORMAL case —
  //    unlike `input.id`, which can only ever name one row. A single-valued
  //    `dependsOn` would cascade from one create and silently leave the link to
  //    the other dangling.
  test("a row naming two creates depends on both, and either one cascades it", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),
        call("create_task"),
        call("update_change", { id: 9, linkedTaskIds: [101, 102] }),
      ],
      [101, 102],
    );
    expect(rows[2].dependsOnAll).toEqual([0, 1]);
    expect([...cascadeDeselect(rows, new Set([0, 1, 2]), 0)]).toEqual([1]);
    expect([...cascadeDeselect(rows, new Set([0, 1, 2]), 1)]).toEqual([0]);
  });

  // ★ `update_task` deliberately is NOT the fixture here: `taskFields` carries no
  //   id-list field, so it has no LINK_FIELDS row and could not exercise this.
  //   `update_milestone` can name a provisional milestone by `id` AND a
  //   provisional task by `linkedTaskIds` in one call.
  test("dependsOnAll carries the target dependency too, so one walk covers both", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),                                     // 0 mints task 101
        call("create_milestone", { name: "M" }),                 // 1 mints milestone 7
        call("update_milestone", { id: 7, linkedTaskIds: [101] }),
      ],
      [101, 7],
    );
    expect(rows[2].dependsOn).toBe(1);
    expect(rows[2].dependsOnAll).toEqual([0, 1]);
  });

  test("a link to an id nobody mints is not a dependency", () => {
    const rows = buildPlanRows(
      [call("create_task"), call("create_milestone", { name: "M", linkedTaskIds: [999] })],
      [101, 7],
    );
    expect(rows[1].dependsOnAll).toBeUndefined();
  });

  // Forward references stay unlinked here for the same reason they do for `id`:
  // the maps are read as the walk builds them, so every edge points backward.
  test("a link to an id minted LATER resolves to nothing", () => {
    const rows = buildPlanRows(
      [call("create_milestone", { name: "M", linkedTaskIds: [101] }), call("create_task")],
      [7, 101],
    );
    expect(rows[0].dependsOnAll).toBeUndefined();
  });

  // A create listing the very number it just minted would otherwise depend on
  // ITSELF — an edge the cascade cannot express.
  test("a create naming its own minted id does not depend on itself", () => {
    const rows = buildPlanRows(
      [call("create_raid_item", { title: "R", causedByRaidIds: [101] })],
      [101],
    );
    expect(rows[0].dependsOnAll).toBeUndefined();
  });

  // Typed rather than inferred, for the tsc reason recorded on
  // MALFORMED_DOC_INPUTS above.
  const MALFORMED_LINKS: [string, Record<string, unknown>][] = [
    ["field absent",            {}],
    ["field is a string",       { linkedTaskIds: "101" }],
    ["field holds null",        { linkedTaskIds: [null] }],
    ["field holds an object",   { linkedTaskIds: [{ id: 101 }] }],
    ["field holds an empty []", { linkedTaskIds: [[]] }],
    ["field holds 0",           { linkedTaskIds: [0] }],
  ];
  test.each(MALFORMED_LINKS)(
    "malformed link payload (%s) neither throws nor links",
    (_label, input) => {
      const rows = buildPlanRows(
        [call("create_task"), call("create_milestone", { name: "M", ...input })],
        [101, 7],
      );
      expect(rows[1].dependsOnAll).toBeUndefined();
    },
  );

  const MALFORMED_DEPS: [string, Record<string, unknown>][] = [
    ["a non-object dependency entry", { id: 55, dependencies: ["101"] }],
    ["a dependency with no taskId",   { id: 55, dependencies: [{ type: "FS" }] }],
    ["dependencies not an array",     { id: 55, dependencies: { taskId: 101 } }],
  ];
  test.each(MALFORMED_DEPS)(
    "malformed dependency payload (%s) neither throws nor links",
    (_label, input) => {
      const rows = buildPlanRows([call("create_task"), call("set_task_dependencies", input)], [101]);
      expect(rows[1].dependsOnAll).toBeUndefined();
    },
  );

  // ★ A tool with no LINK_FIELDS entry is untouched, so the table is the whole
  //   rule — a same-named field on another tool is not read by accident.
  test("a tool outside the link table ignores an id-list field", () => {
    const rows = buildPlanRows(
      [call("create_task"), call("update_stakeholder", { id: 9, linkedTaskIds: [101] })],
      [101],
    );
    expect(rows[1].dependsOnAll).toBeUndefined();
  });

  // ★★ Both properties in ONE fixture, and each mutant dies on its own: the
  //    linked ids name row 1 before row 0 and name row 1 TWICE. Without the
  //    sort the result is [2,1,0]; without the `Set` it is [0,1,1] once sorted.
  //    Neither equals [0,1,2].
  test("dependsOnAll is ascending and deduplicated", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),                                            // 0 mints task 101
        call("create_task"),                                            // 1 mints task 102
        call("create_milestone", { name: "M" }),                        // 2 mints milestone 7
        call("update_milestone", { id: 7, linkedTaskIds: [102, 101, 102] }),
      ],
      [101, 102, 7],
    );
    expect(rows[3].dependsOn).toBe(2);
    expect(rows[3].dependsOnAll).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// The `input.id` half is entity-scoped too — a bare number is ambiguous.

describe("target-id dependencies are scoped to the minting entity", () => {
  // ★★★ THE FIXTURE ORDER IS THE WHOLE TEST. Ids are per-entity sequences, so
  //     both creates below mint 101. A number-keyed map takes the LAST writer of
  //     that key — the RAID create at index 1 — and points the task update at
  //     it, cascading the user's rejection onto an unrelated row. Swap the two
  //     creates and a number-blind lookup is ACCIDENTALLY RIGHT, so that
  //     fixture cannot express the defect at all.
  test("an update_task resolves to the task create, not a later raid create minting the same id", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),                      // 0 mints task 101
        call("create_raid_item", { title: "R" }), // 1 mints raid 101
        call("update_task", { id: 101 }),
      ],
      [101, 101, 55],
    );
    expect(rows[2].dependsOn).toBe(0);

    // And the consequence the wrong edge would have had: refusing the RAID
    // create must leave the task update alone.
    expect([...cascadeDeselect(rows, new Set([0, 1, 2]), 1)].sort()).toEqual([0, 2]);
    expect([...cascadeDeselect(rows, new Set([0, 1, 2]), 0)].sort()).toEqual([1]);
  });

  // The mirror, so the fix cannot be "always prefer create_task".
  test("an update_raid_item resolves to the raid create, not a later task create", () => {
    const rows = buildPlanRows(
      [
        call("create_raid_item", { title: "R" }), // 0 mints raid 101
        call("create_task"),                      // 1 mints task 101
        call("update_raid_item", { id: 101 }),
      ],
      [101, 101, 55],
    );
    expect(rows[2].dependsOn).toBe(0);
  });

  test("a delete resolves in its own id space", () => {
    const rows = buildPlanRows(
      [
        call("create_milestone", { name: "M" }), // 0 mints milestone 101
        call("create_change", { title: "C" }),   // 1 mints change 101
        call("delete_milestone", { id: 101 }),
      ],
      [101, 101, 55],
    );
    expect(rows[2].dependsOn).toBe(0);
  });

  // ★★ A READ of a row that will never be created is exactly as dead as a write
  //    to it, which is why the three `get_*` tools are in the table. They are
  //    still not entity writes, so they must not move the staging decision.
  test("a read of a provisional id cascades, without counting as a write", () => {
    const rows = buildPlanRows([call("create_task"), call("get_task", { id: 101 })], [101]);
    expect(rows[1].dependsOn).toBe(0);
    expect(isEntityWriteTool("get_task")).toBe(false);
    expect(shouldStage([call("create_task"), call("get_task", { id: 101 })])).toBe(false);
  });

  // ★★★ THE GUARD THAT MATTERS FOR THIS TABLE, and it is the same shape as
  //     "every live tool is classified exactly once" above. Omitting a tool from
  //     TARGET_MINTED_BY is SILENT — the tool simply never links, which is the
  //     "dependent linked to nothing" failure the cascade exists to prevent, and
  //     no other test in this file would notice. The expected set is DERIVED
  //     from the live schemas rather than typed out, so a new id-taking tool
  //     names itself in the diff.
  test("every live tool that addresses a row by id is in the target table", () => {
    // `input_schema?: unknown` keeps this cast trivially legal whatever shape
    // the defs infer to; the property walk narrows locally instead.
    const live = TOOL_DEFS as ReadonlyArray<{ name: string; input_schema?: unknown }>;
    const takesId = live
      .filter((d) => {
        const schema = d.input_schema as { properties?: Record<string, unknown> } | undefined;
        return schema?.properties !== undefined && "id" in schema.properties;
      })
      .map((d) => d.name);
    // Anti-vacuity: an empty derivation would pass a set comparison against an
    // empty table, and both halves are code under test here.
    expect(takesId.length).toBeGreaterThan(10);
    expect([...takesId].sort()).toEqual(Object.keys(TARGET_MINTED_BY).sort());
  });

  test("every id space names a live create tool", () => {
    const liveCreates = new Set(
      (TOOL_DEFS as ReadonlyArray<{ name: string }>).map((d) => d.name).filter(isCreateTool),
    );
    const unknown = Object.values(TARGET_MINTED_BY).filter((n) => !liveCreates.has(n));
    expect(unknown).toEqual([]);
  });
});
