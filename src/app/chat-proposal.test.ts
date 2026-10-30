import { describe, expect, test } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";
import { INLINE_DESCRIPTORS, type EntityDescriptor } from "./inline-ai-edit/entity-descriptor";
import {
  buildPlanRows,
  cascadeDeselect,
  CREATE_MINT_KIND,
  isCreateTool,
  isDestructiveCall,
  isDestructiveTool,
  isEntityWriteCall,
  isEntityWriteTool,
  namesPendingMint,
  remapStagedCall,
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
    // §515 review flow: ONE AI escalation applies immediately (undoable, pinned by
    // the `escalateRaid` undo site); two or more in a turn go to the review card.
    ["one escalate_raid_item",         [call("escalate_raid_item", { id: 1 })],              false],
    ["two escalate_raid_item",         [call("escalate_raid_item", { id: 1 }), call("escalate_raid_item", { id: 2 })], true],
    ["escalate + update_raid_item",    [call("update_raid_item", { id: 1 }), call("escalate_raid_item", { id: 1 })], true],
    ["one create_document",            [call("create_document")],                            false],
    ["one update_document",            [call("update_document", { id: 1 })],                 false],
    ["two document writes",            [call("create_document"), call("update_document", { id: 1 })], true],
    ["one delete_document",            [call("delete_document", { id: 1 })],                 true],
  ])("%s -> %s", (_label, calls, expected) => {
    expect(shouldStage(calls as ProposedCall[])).toBe(expected);
  });
});

// §773 — a lone date write that clashes with an absence stages, so the user sees the warning before it lands.
describe("shouldStage — an absence clash (§773)", () => {
  const trusted = { appliedWrites: 0, untrusted: false, staged: false };
  const lone = [call("update_task", { id: 1, dueDate: "2026-11-05" })];

  test("a lone write the predicate flags stages", () => {
    expect(shouldStage(lone, trusted, () => true)).toBe(true);
    expect(shouldStage(lone, undefined, () => true)).toBe(true);
  });

  test("a lone write the predicate clears applies, as today", () => {
    expect(shouldStage(lone, trusted, () => false)).toBe(false);
  });

  test("no predicate keeps today's behaviour", () => {
    expect(shouldStage(lone, trusted)).toBe(false);
    expect(shouldStage(lone)).toBe(false);
  });

  test("the predicate is asked only about entity writes", () => {
    const asked: string[] = [];
    const hasClash = (c: ProposedCall) => { asked.push(c.name); return true; };
    expect(shouldStage([call("list_tasks"), call("set_language", { language: "de" })], trusted, hasClash)).toBe(false);
    expect(asked).toEqual([]);
  });

  test("a predicate that flags only one call of a turn still stages the turn", () => {
    const calls = [call("list_tasks"), call("update_task", { id: 2, dueDate: "2026-11-05" })];
    expect(shouldStage(calls, trusted, (c) => c.input.id === 2)).toBe(true);
  });
});

// AI-02 — the send record: the write count runs across the whole send, and an attachment anywhere in
// the history stages every risky write.
describe("shouldStage — with a send record", () => {
  const trusted = { appliedWrites: 0, untrusted: false, staged: false };
  const untrusted = { appliedWrites: 0, untrusted: true, staged: false };

  test("a write after one already applied in this send stages", () => {
    expect(shouldStage([call("update_task", { id: 1 })], { ...trusted, appliedWrites: 1 })).toBe(true);
  });

  test("a lone write with nothing applied before it does not stage", () => {
    expect(shouldStage([call("update_task", { id: 1 })], trusted)).toBe(false);
  });

  // Owner decision (AI-02): with an attachment in the history every change stages, a lone tokened update included.
  test("a lone tokened update stages in an untrusted send", () => {
    expect(shouldStage([call("update_task", { id: 1 })], untrusted)).toBe(true);
  });

  test("a lone create stages in an untrusted send", () => {
    expect(shouldStage([call("create_task")], untrusted)).toBe(true);
    expect(shouldStage([call("create_task")], trusted)).toBe(false);
  });

  test("set_language stages in an untrusted send and applies in a trusted one", () => {
    expect(shouldStage([call("set_language", { language: "de" })], untrusted)).toBe(true);
    expect(shouldStage([call("set_language", { language: "de" })], trusted)).toBe(false);
  });

  test("reads never stage, trusted or not", () => {
    expect(shouldStage([call("list_tasks"), call("get_task", { id: 1 })], untrusted)).toBe(false);
  });
});

// ★★ The four lists below are LITERALS, deliberately NOT derived from the
//    module under test — deriving them would make every assertion here
//    tautological. They are the second, independent copy of the classification,
//    so a typo in either copy shows up as a red row naming the tool.
const DESTRUCTIVE_NAMES = [
  "delete_task", "delete_all_tasks", "delete_resource", "delete_raid_item",
  "delete_change", "delete_milestone", "delete_stakeholder", "delete_document",
  "delete_absence", "delete_calendar_event",
  // §502 part 4 — undoable like the other deletes, and staged like them.
  "delete_forecast_scenario",
];

// ★★ `create_calendar_event`/`update_calendar_event`'s "does not stage alone"
//    row below is CONDITIONALLY true, not unconditionally: with
//    `sendInvitations: true` they DO stage alone (see the "shouldStage —
//    invitations" describe block). The row only keeps passing because `call()`
//    with no third argument passes no payload — this list asserts a property of
//    the NAME, and the payload-driven exception is tested separately.
const NON_DESTRUCTIVE_WRITE_NAMES = [
  "create_task", "update_task", "set_task_dependencies", "send_inquiry",
  "create_resource", "update_resource",
  "create_raid_item", "update_raid_item", "escalate_raid_item",
  "create_change", "update_change",
  "create_milestone", "update_milestone",
  "create_stakeholder", "update_stakeholder",
  "create_document", "update_document",
  "create_absence", "update_absence",
  "create_calendar_event", "update_calendar_event",
  "create_forecast_scenario", "update_forecast_scenario",
  // §502 part 4 — project data on `settingsOverrides` (not device preferences like `update_settings`), so they
  // count as writes; not undoable, logged only.
  "set_forecast_proposal", "set_forecast_target_confidence",
];

// §715 — writes that are not deletions and still stage ALONE (owner decision A): the project record
// (`ProjectMeta`) is one per project, so a Claude edit of it is always shown as a card with Apply.
const ALWAYS_STAGED_WRITE_NAMES = ["update_project"];

const NON_WRITE_NAMES = [
  "get_forecast",
  "get_project",
  "optimize_wbs",
  "list_tasks", "get_task", "set_filters", "set_language", "get_app_state",
  "get_dashboard_snapshot", "list_raid", "list_changes", "list_milestones",
  "list_stakeholders", "list_resources", "list_allocations",
  "list_knowledge_items", "list_calendar_events", "list_budget_buckets",
  "search_history", "search_chats", "get_resource", "update_settings",
  "list_documents", "get_document", "list_absences", "get_contact_email",
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

  test.each(ALWAYS_STAGED_WRITE_NAMES)("%s counts as a write and stages alone", (name) => {
    expect(isDestructiveTool(name)).toBe(false);
    expect(isEntityWriteTool(name)).toBe(true);
    expect(shouldStage([call(name)])).toBe(true);
    // Beside a read it still stages: the rule is about the call, not the count.
    expect(shouldStage([call("list_tasks"), call(name)])).toBe(true);
  });

  test.each(NON_WRITE_NAMES)("%s is not an entity write", (name) => {
    expect(isEntityWriteTool(name)).toBe(false);
    expect(shouldStage([call(name), call(name)])).toBe(false);
  });

  // ★★★ THE GUARD THAT MATTERS. A tool added to `TOOL_DEFS` later and left out
  //     of `chat-proposal.ts` is invisible to every row above — its writes would
  //     silently never count toward the gate. This partitions the LIVE array
  //     against the four literals, so a new tool fails here until somebody
  //     classifies it.
  test("every live tool is classified exactly once", () => {
    const live = (TOOL_DEFS as ReadonlyArray<{ name: string }>).map((d) => d.name);
    const classified = [
      ...DESTRUCTIVE_NAMES, ...NON_DESTRUCTIVE_WRITE_NAMES, ...ALWAYS_STAGED_WRITE_NAMES, ...NON_WRITE_NAMES,
    ];
    expect([...classified].sort()).toEqual([...live].sort());
  });
});

// ---------------------------------------------------------------------------
// A lone calendar-event write that would email attendees — the one write in
// the app whose effect leaves the building and that undo cannot reverse.

describe("shouldStage — invitations", () => {
  // ★★★ A SINGLE EVENT WRITE IS NOT OTHERWISE STAGED. It is neither destructive
  // nor a second write, so without this rule it applies unreviewed — and unlike
  // every other write in the app its effect leaves the building: it mails the
  // attendees, and the undo engine cannot recall a sent invitation.
  test("stages a lone event write that would send invitations", () => {
    expect(
      shouldStage([call("create_calendar_event", { title: "X", sendInvitations: true })]),
    ).toBe(true);
  });

  // ★★ THE OTHER HALF, and it is what stops a stage-everything mutant passing.
  // A rule that staged every calendar write would satisfy the test above while
  // making the review card routine — and a card the user clears reflexively
  // stops being read, which is the reasoning `isDestructiveCall` already
  // records for update_document.
  test("does not stage the same write without invitations", () => {
    expect(shouldStage([call("create_calendar_event", { title: "X" })])).toBe(false);
    expect(
      shouldStage([call("create_calendar_event", { title: "X", sendInvitations: false })]),
    ).toBe(false);
  });

  test("also stages an UPDATE that would send invitations", () => {
    expect(
      shouldStage([call("update_calendar_event", { id: 1, sendInvitations: true })]),
    ).toBe(true);
  });

  test("survives a malformed payload rather than throwing", () => {
    expect(() =>
      shouldStage([call("create_calendar_event", { sendInvitations: "yes" })]),
    ).not.toThrow();
    expect(shouldStage([call("create_calendar_event", { sendInvitations: "yes" })])).toBe(false);
  });

  // Name-only, not payload-driven: no other tool's `sendInvitations` field (if
  // one existed) could trip this — the check is gated on the tool NAME first.
  test("a non-calendar tool carrying the same field name never stages alone", () => {
    expect(shouldStage([call("create_task", { sendInvitations: true })])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §779 — `update_settings` carrying `enabledModules` writes the project's saved
// functions (`Workspace.features`), so it counts as a write. Owner decision
// 2026-10-24 ("Count it"). Every other `update_settings` call stays exempt.

describe("shouldStage — update_settings { enabledModules } (§779)", () => {
  // Mutation: dropping the `enabledModules` branch from `isEntityWriteCall` turns
  // this red (the pair counts one write and applies at once, unreviewed).
  test("an update_task plus switching every function off goes to review", () => {
    expect(
      shouldStage([call("update_task", { id: 1 }), call("update_settings", { enabledModules: [] })]),
    ).toBe(true);
  });

  test("a non-empty functions list beside a task write goes to review too", () => {
    expect(
      shouldStage([call("update_task", { id: 1 }), call("update_settings", { enabledModules: ["raid"] })]),
    ).toBe(true);
  });

  // Mutation: putting `update_settings` in `ALWAYS_STAGED_TOOLS` turns this red.
  test("a lone functions change applies at once", () => {
    expect(shouldStage([call("update_settings", { enabledModules: ["dashboard", "raid"] })])).toBe(false);
    expect(shouldStage([call("update_settings", { enabledModules: [] })])).toBe(false);
  });

  // Mutation: counting every `update_settings` by name turns this red.
  test("a device setting beside a task write still applies at once, as before", () => {
    expect(shouldStage([call("update_task", { id: 1 }), call("update_settings", { showViewHints: false })])).toBe(false);
  });

  test("the predicate reads the key, not the value", () => {
    expect(isEntityWriteCall(call("update_settings", { enabledModules: [] }))).toBe(true);
    expect(isEntityWriteCall(call("update_settings", { enabledModules: "raid" }))).toBe(true);
    expect(isEntityWriteCall(call("update_settings", { showViewHints: false }))).toBe(false);
    expect(isEntityWriteCall(call("update_settings"))).toBe(false);
    // Name-gated: the same key on another non-write tool counts for nothing.
    expect(isEntityWriteCall(call("set_language", { enabledModules: [] }))).toBe(false);
    expect(isEntityWriteCall(call("update_task", { id: 1 }))).toBe(true);
    expect(isEntityWriteCall(call("list_tasks"))).toBe(false);
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
    "create_absence", "create_calendar_event", "create_forecast_scenario",
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
    // `get_contact_email` takes `{entity, id}` across FIVE id spaces, which this
    // one-create-per-tool table cannot express (mapping it to one would draw a
    // WRONG edge). It is a pure read of a stored address, so it is exempt by name.
    const MULTI_ENTITY_READS = ["get_contact_email"];
    expect(takesId.filter((n) => !MULTI_ENTITY_READS.includes(n)).sort()).toEqual(
      Object.keys(TARGET_MINTED_BY).sort(),
    );
    expect(takesId).toContain("get_contact_email");
  });

  test("every id space names a live create tool", () => {
    const liveCreates = new Set(
      (TOOL_DEFS as ReadonlyArray<{ name: string }>).map((d) => d.name).filter(isCreateTool),
    );
    const unknown = Object.values(TARGET_MINTED_BY).filter((n) => !liveCreates.has(n));
    expect(unknown).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §378 — rewriting a staged plan's provisional ids to the ids the real minter
// actually handed out.

describe("CREATE_MINT_KIND", () => {
  // ★★★ THE MEMBERSHIP HALF, and it is the same shape as `TARGET_MINTED_BY`'s
  //     own drift test: an omission here is SILENT at every layer that does not
  //     mint. The expected set is DERIVED from the live schemas, so a new
  //     `create_*` tool names itself in the diff rather than shipping unminted.
  test("covers exactly the live create tools", () => {
    const liveCreates = (TOOL_DEFS as ReadonlyArray<{ name: string }>)
      .map((d) => d.name)
      .filter(isCreateTool);
    // Anti-vacuity: an empty derivation would pass a set comparison against an
    // empty table, and both halves are code under test here.
    expect(liveCreates.length).toBeGreaterThan(5);
    expect([...liveCreates].sort()).toEqual(Object.keys(CREATE_MINT_KIND).sort());
  });

  // ★★★ THE VALUE HALF — the one `TARGET_MINTED_BY`'s test cannot do for its own
  //     table. Membership alone is blind to a create mapped to the WRONG kind,
  //     which mints from a different entity's sequence and hands the plan an id
  //     that collides with a live row of another type. Every row but
  //     `create_document` is therefore checked against an INDEPENDENT source:
  //     `INLINE_DESCRIPTORS` already states each entity's `createTool` beside its
  //     `entity`, and those `InlineEntity` spellings are exactly the `MintKind`
  //     spellings the live minters pass (grep for the mintId call sites under
  //     src/app).
  //     ★★ NO ROW COUNT IS QUOTED. This said "six of the seven rows" and
  //     "those six `InlineEntity` spellings"; both went stale when `absence` and
  //     `calendarEvent` gained descriptors, and neither was load-bearing — the
  //     loop covers whatever the map holds.
  test("maps each descriptor's create tool to that descriptor's OWN entity", () => {
    const descriptors = Object.values(INLINE_DESCRIPTORS) as EntityDescriptor[];
    // Anti-vacuity: an empty descriptor map would make the loop below assert
    // nothing at all, and this test would still be green. A FLOOR rather than an
    // exact count, matching the sibling test above — the number is not the
    // claim, and pinning it makes every union widening chase this file.
    expect(descriptors.length).toBeGreaterThan(5);
    for (const d of descriptors) {
      expect(CREATE_MINT_KIND[d.createTool]).toBe(d.entity);
    }
  });

  // ★ AN UNGUARDED ROW (one of two; the other follows), stated rather than hidden. `create_document`
  //   has no `INLINE_DESCRIPTORS` entry, so nothing independent can confirm its
  //   kind — this pins the literal, which catches a typo and not a wrong
  //   decision. The live minter is `workspace-context.tsx`'s `mintDocId`.
  //   ★★ TWO SIBLINGS WERE REMOVED HERE, not lost: `create_absence` and
  //   `create_calendar_event` had their own literal-pinning tests under the same
  //   "no `INLINE_DESCRIPTORS` entry either" reasoning, and that reasoning
  //   stopped being true the moment both entities gained descriptors. The loop
  //   above now makes exactly those two assertions against an INDEPENDENT
  //   source, which is strictly stronger than the literals were — keeping them
  //   would have left two tests whose stated justification was false.
  test("create_document mints from the document sequence", () => {
    expect(CREATE_MINT_KIND.create_document).toBe("document");
  });

  // ★ The second literal-only row, for the same reason: forecast scenarios have no `INLINE_DESCRIPTORS`
  //   entry. The live minters are `use-forecast-scenarios.ts` and `use-forecast-tools.ts`.
  test("create_forecast_scenario mints from the forecastScenario sequence", () => {
    expect(CREATE_MINT_KIND.create_forecast_scenario).toBe("forecastScenario");
  });
});

describe("remapStagedCall", () => {
  /** create tool -> (provisional id -> real id). */
  const realMap = (entries: Record<string, Record<number, number>>) =>
    new Map(
      Object.entries(entries).map(([tool, ids]) => [
        tool,
        new Map(Object.entries(ids).map(([k, v]) => [Number(k), v])),
      ]),
    );

  test("rewrites the input.id half through TARGET_MINTED_BY", () => {
    const out = remapStagedCall(
      call("update_task", { id: 101, taskName: "After" }),
      realMap({ create_task: { 101: 7 } }),
    );
    expect(out.input).toEqual({ id: 7, taskName: "After" });
  });

  test("reads a STRING id the way chat-tools does", () => {
    // `chat-tools.ts` addresses every row with `Number(input.id)`, so a string
    // id reaches the created row — the rewrite has to resolve it the same way or
    // the graph and the write disagree about which row this call names.
    const out = remapStagedCall(
      call("update_task", { id: "101" }),
      realMap({ create_task: { 101: 7 } }),
    );
    expect(out.input.id).toBe(7);
  });

  test("rewrites a FLAT link array", () => {
    const out = remapStagedCall(
      call("create_raid_item", { title: "R", linkedTaskIds: [101, 55] }),
      realMap({ create_task: { 101: 7 } }),
    );
    // 55 is a pre-existing row and must survive untouched — a rewrite that
    // rebuilt the array from the map alone would drop it.
    expect(out.input).toEqual({ title: "R", linkedTaskIds: [7, 55] });
  });

  test("rewrites a KEY-BEARING entry and keeps the entry's other fields", () => {
    // `dependencies[].taskId` is the one link shape whose id sits inside an
    // OBJECT. A rewrite that replaced the whole entry would silently drop `type`.
    const out = remapStagedCall(
      call("set_task_dependencies", {
        id: 55,
        dependencies: [{ taskId: 101, type: "FS" }, { taskId: 9, type: "SS" }],
      }),
      realMap({ create_task: { 101: 7 } }),
    );
    expect(out.input.dependencies).toEqual([
      { taskId: 7, type: "FS" },
      { taskId: 9, type: "SS" },
    ]);
    // The id half of the SAME call is untouched: #55 is a live row, not a mint.
    expect(out.input.id).toBe(55);
  });

  test("rewrites BOTH halves of one call", () => {
    const out = remapStagedCall(
      call("update_raid_item", { id: 101, linkedTaskIds: [202] }),
      realMap({ create_raid_item: { 101: 7 }, create_task: { 202: 8 } }),
    );
    expect(out.input).toEqual({ id: 7, linkedTaskIds: [8] });
  });

  // ★★★ THE FIXTURE THAT PROVES THE SCOPING, and the reason this whole family of
  //     tables is keyed by CREATE TOOL rather than by number. Ids are per-entity
  //     sequences, so two creates in one plan minting the SAME number is the
  //     common case. A number-keyed map resolves both #101s to whichever create
  //     was recorded LAST — a WRONG write, which is worse than a missing one.
  test("is ENTITY-SCOPED: two entities minting the same number do not cross", () => {
    const real = realMap({ create_task: { 101: 7 }, create_raid_item: { 101: 9 } });
    expect(remapStagedCall(call("update_task", { id: 101 }), real).input.id).toBe(7);
    expect(remapStagedCall(call("update_raid_item", { id: 101 }), real).input.id).toBe(9);
    // Same collision through a LINK field: `linkedTaskIds` names the TASK space
    // even on a RAID-adjacent call, and `linkedRaidIds` the RAID one.
    const linked = remapStagedCall(
      call("create_change", { linkedTaskIds: [101], linkedRaidIds: [101] }),
      real,
    );
    expect(linked.input).toEqual({ linkedTaskIds: [7], linkedRaidIds: [9] });
  });

  test("leaves an id no create minted alone", () => {
    const out = remapStagedCall(
      call("update_task", { id: 55 }),
      realMap({ create_task: { 101: 7 } }),
    );
    expect(out.input.id).toBe(55);
  });

  test("returns the SAME reference when there is nothing to rewrite", () => {
    // Documented behaviour a caller may rely on with `===` to ask "was anything
    // remapped?" — so it is pinned rather than left to the implementation.
    const original = call("update_task", { id: 55 });
    expect(remapStagedCall(original, realMap({ create_task: { 101: 7 } }))).toBe(original);
    expect(remapStagedCall(original, new Map())).toBe(original);
  });

  test("never mutates the call it is given", () => {
    const input = { id: 101, dependencies: [{ taskId: 101, type: "FS" }] };
    const entry = input.dependencies[0];
    const original = call("set_task_dependencies", input);
    const out = remapStagedCall(original, realMap({ create_task: { 101: 7 } }));

    expect(out).not.toBe(original);
    expect(input.id).toBe(101);
    expect(input.dependencies[0]).toBe(entry);
    expect(entry.taskId).toBe(101);
  });

  test("skips a link entry the write itself would drop", () => {
    // Mirrors `sanitizeIdList`'s finite-and-positive filter, the function that
    // actually stores these lists: a `null`/`""`/`[]` entry is 0 under bare
    // `Number()`, and must not become a lookup for a minted id 0.
    const out = remapStagedCall(
      call("create_milestone", { linkedTaskIds: [null, "", 0, -1, 101] }),
      realMap({ create_task: { 0: 4, 101: 7 } }),
    );
    expect(out.input.linkedTaskIds).toEqual([null, "", 0, -1, 7]);
  });

  test("a create's OWN id is never rewritten", () => {
    const original = call("create_task", { id: 101, taskName: "T" });
    // A create's own id can never name an earlier mint, so the id half is
    // skipped for it exactly as `buildPlanRows` skips it.
    expect(remapStagedCall(original, realMap({ create_task: { 101: 7 } }))).toBe(original);
  });
});

describe("namesPendingMint", () => {
  const pendingMap = (entries: Record<string, number[]>) =>
    new Map(Object.entries(entries).map(([tool, ids]) => [tool, new Set(ids)]));

  test("blocks a row whose target is still owed", () => {
    expect(
      namesPendingMint(call("update_task", { id: 101 }), pendingMap({ create_task: [101] })),
    ).toBe(true);
  });

  test("blocks a row whose LINK is still owed, including a key-bearing one", () => {
    expect(
      namesPendingMint(
        call("create_raid_item", { linkedTaskIds: [101] }),
        pendingMap({ create_task: [101] }),
      ),
    ).toBe(true);
    expect(
      namesPendingMint(
        call("set_task_dependencies", { id: 55, dependencies: [{ taskId: 101 }] }),
        pendingMap({ create_task: [101] }),
      ),
    ).toBe(true);
  });

  test("is ENTITY-SCOPED", () => {
    // An owed TASK #101 must not block a RAID call naming its own live #101 —
    // a number-blind check refuses a write that was always safe.
    expect(
      namesPendingMint(call("update_raid_item", { id: 101 }), pendingMap({ create_task: [101] })),
    ).toBe(false);
  });

  test("does not block once nothing is owed", () => {
    expect(namesPendingMint(call("update_task", { id: 101 }), new Map())).toBe(false);
    expect(
      namesPendingMint(call("update_task", { id: 55 }), pendingMap({ create_task: [101] })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §502 — a forecast scenario names milestones and people INSIDE its `changes[]`
// rows: `milestoneId` on a scope row, `who.resourceId` on an addPeople row. A
// staged create of either is a link like any other: graphed, cascaded, refused
// while owed and rewritten to the real id at apply time.

describe("ids nested in a scenario's changes[] are links (§502)", () => {
  const scope = (milestoneId: unknown) => ({ kind: "scope", tasks: 3, on: "2026-06-15", milestoneId });
  const added = (resourceId: unknown) => ({
    kind: "addPeople", who: { resourceId, hoursPerWeek: 20 }, from: "2026-06-01", until: "", rampWeeks: 4,
  });

  test.each(["create_forecast_scenario", "update_forecast_scenario"])(
    "%s: a scope row's milestoneId depends on the milestone create, and refusing it cascades",
    (tool) => {
      const rows = buildPlanRows(
        [call("create_milestone", { name: "M" }), call(tool, { id: 9, name: "S", changes: [scope(101)] })],
        [101, 900],
      );
      expect(rows[1].dependsOnAll).toEqual([0]);
      expect([...cascadeDeselect(rows, new Set([0, 1]), 0)]).toEqual([]);
    },
  );

  test.each(["create_forecast_scenario", "update_forecast_scenario"])(
    "%s: an addPeople row's who.resourceId depends on the resource create, and refusing it cascades",
    (tool) => {
      const rows = buildPlanRows(
        [call("create_resource", { name: "Ada" }), call(tool, { id: 9, name: "S", changes: [added(101)] })],
        [101, 900],
      );
      expect(rows[1].dependsOnAll).toEqual([0]);
      expect([...cascadeDeselect(rows, new Set([0, 1]), 0)]).toEqual([]);
    },
  );

  // ★★ Entity-scoped like every other link: a TASK create minting 101 is not the
  //    milestone a scope row names, and the field is read only on the row kind
  //    whose parser reads it, so an availability row carrying a stray milestoneId
  //    or a scope row carrying a `who` graphs nothing.
  test("links only to the right create, and only on the row kind that carries the field", () => {
    const rows = buildPlanRows(
      [
        call("create_task"),
        call("create_milestone", { name: "M" }),
        call("create_resource", { name: "Ada" }),
        call("create_forecast_scenario", {
          name: "S",
          changes: [
            scope(101),
            { kind: "availability", percent: 120, from: "2026-06-01", until: "", milestoneId: 7 },
            { ...scope(undefined), who: { resourceId: 7 } },
          ],
        }),
      ],
      [101, 7, 7, 900],
    );
    expect(rows[3].dependsOnAll).toBeUndefined();
  });

  test("an existing milestone or person is not a dependency", () => {
    const rows = buildPlanRows(
      [call("create_milestone", { name: "M" }), call("create_forecast_scenario", { name: "S", changes: [scope(55), added(56)] })],
      [101, 900],
    );
    expect(rows[1].dependsOnAll).toBeUndefined();
  });

  const realMap = (entries: Record<string, Record<number, number>>) =>
    new Map(Object.entries(entries).map(([tool, ids]) => [tool, new Map(Object.entries(ids).map(([k, v]) => [Number(k), v]))]));

  // ★★ BOTH specs walk the SAME `changes` array, so the second must build on the
  //    first's rewrite rather than on the original list, or it silently undoes it.
  test("rewrites both nested ids in one call and leaves every other field and row alone", () => {
    const changes = [scope(101), added(202), scope(55), added(56)];
    const out = remapStagedCall(
      call("create_forecast_scenario", { name: "S", changes }),
      realMap({ create_milestone: { 101: 7 }, create_resource: { 202: 8 } }),
    );
    expect(out.input).toEqual({ name: "S", changes: [scope(7), added(8), scope(55), added(56)] });
    // Never mutated.
    expect(changes).toEqual([scope(101), added(202), scope(55), added(56)]);
  });

  test("is entity-scoped: a task create minting the same number is not rewritten in", () => {
    const original = call("update_forecast_scenario", { id: 3, changes: [scope(101), added(101)] });
    expect(remapStagedCall(original, realMap({ create_task: { 101: 7 } }))).toBe(original);
  });

  test("an owed milestone or person refuses the row at apply time", () => {
    const owed = (tool: string) => new Map([[tool, new Set([101])]]);
    expect(namesPendingMint(call("create_forecast_scenario", { changes: [scope(101)] }), owed("create_milestone"))).toBe(true);
    expect(namesPendingMint(call("update_forecast_scenario", { id: 3, changes: [added(101)] }), owed("create_resource"))).toBe(true);
    expect(namesPendingMint(call("create_forecast_scenario", { changes: [scope(101)] }), owed("create_resource"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §502 part 4 — `set_forecast_proposal`'s `id` names a scenario, which a create
// earlier in the plan can mint; `delete_forecast_scenario`'s id too.

describe("the decision writes name a scenario the plan creates (§502 part 4)", () => {
  const real = new Map([["create_forecast_scenario", new Map([[900, 4]])]]);

  test("set_forecast_proposal(provisional) depends on the create, is rewritten to the real id, and is refused while owed", () => {
    const plan = [call("create_forecast_scenario", { name: "S", changes: [] }), call("set_forecast_proposal", { id: 900 })];
    const rows = buildPlanRows(plan, [900]);
    expect(rows[1].dependsOn).toBe(0);
    expect([...cascadeDeselect(rows, new Set([0, 1]), 0)]).toEqual([]);
    expect(remapStagedCall(plan[1], real).input).toEqual({ id: 4 });
    expect(namesPendingMint(plan[1], new Map([["create_forecast_scenario", new Set([900])]]))).toBe(true);
  });

  test("set_forecast_proposal(null) clears: it names no row, so nothing is rewritten or owed", () => {
    const clear = call("set_forecast_proposal", { id: null });
    // ★ A provisional id of 0 is the one a null would have read as before `targetIdOf` checked for it.
    const zero = new Map([["create_forecast_scenario", new Map([[0, 4]])]]);
    expect(remapStagedCall(clear, zero)).toBe(clear);
    expect(namesPendingMint(clear, new Map([["create_forecast_scenario", new Set([0])]]))).toBe(false);
  });

  test("delete_forecast_scenario of a scenario the plan creates depends on that create", () => {
    const rows = buildPlanRows(
      [call("create_forecast_scenario", { name: "S", changes: [] }), call("delete_forecast_scenario", { id: 900 })],
      [900],
    );
    expect(rows[1].dependsOn).toBe(0);
  });
});
