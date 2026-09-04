import { describe, expect, test } from "vitest";
import { TOOL_DEFS } from "./chat-tool-defs";
import { isDestructiveTool, isEntityWriteTool, shouldStage, type ProposedCall } from "./chat-proposal";

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
