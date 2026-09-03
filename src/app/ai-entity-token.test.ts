import { describe, expect, it } from "vitest";
import { entityToken, TOKEN_EXCLUDED, type TokenEntity } from "./ai-entity-token";
import { TOOL_DEFS } from "./chat-tool-defs";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Ship it",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "<p>original</p>",
    ...overrides,
  } as Task;
}

describe("entityToken", () => {
  it("is stable for an unchanged entity", () => {
    expect(entityToken("task", task())).toBe(entityToken("task", task()));
  });

  it("changes when a COVERED field changes", () => {
    // The positive direction. Without it a constant would pass every other case.
    expect(entityToken("task", task({ description: "<p>edited</p>" })))
      .not.toBe(entityToken("task", task()));
    expect(entityToken("task", task({ status: "Done" })))
      .not.toBe(entityToken("task", task()));
  });

  it("does NOT change when an EXCLUDED field changes", () => {
    // The negative direction, and the reason the exclusion set exists: a Jira
    // sync stamp or a note append must not refuse an unrelated edit.
    for (const field of TOKEN_EXCLUDED.task) {
      const mutated = task({ [field]: "2031-01-01" } as Partial<Task>);
      expect(entityToken("task", mutated)).toBe(entityToken("task", task()));
    }
  });
});

describe("the exclusion set is disjoint from what the AI can write", () => {
  // ★★★ EXCLUDING A WRITABLE FIELD REINTRODUCES A FALSE PERMIT for exactly that
  //   field: two writers could both change it with neither detected. This test
  //   is the only thing standing between that rule and good intentions.
  const UPDATE_TOOLS: Record<string, TokenEntity> = {
    update_task: "task",
    update_raid_item: "raid",
    update_milestone: "milestone",
    update_change: "change",
    update_stakeholder: "stakeholder",
    update_resource: "resource",
  };

  /** `update_*` tools deliberately outside the token, each because the thing it
   *  writes has no CSV projection to derive a token FROM — not because it is
   *  safe to overwrite. Both are meta-blob or config slices.
   *    update_settings  app config, not workspace entity data
   *    update_document  a `ProjectDocument` persists as a meta-blob (one JSON
   *                     row in `meta`); `PROJECTORS` has no entry for it, so
   *                     `entityToken` structurally cannot cover it. Guarding
   *                     documents needs its own mechanism. */
  const NOT_TOKEN_GUARDED = ["update_settings", "update_document"];

  it("names every update tool that exists, so a new one cannot slip past", () => {
    // Anti-vacuity: without this, deleting a row from UPDATE_TOOLS above would
    // silently shrink the check to nothing and still pass. ★ TOOL_DEFS spreads
    // DOCUMENT_TOOL_DEFS from a SECOND file, so a grep over chat-tool-defs.ts
    // alone under-counts the update tools -- which is how update_document was
    // missed when this test was specified.
    const defined = TOOL_DEFS.map((d) => d.name).filter((n) => n.startsWith("update_"));
    const covered = Object.keys(UPDATE_TOOLS).concat(NOT_TOKEN_GUARDED).sort();
    expect(defined.slice().sort()).toEqual(covered);
  });

  it.each(Object.entries(UPDATE_TOOLS))("%s writes no excluded field", (toolName, kind) => {
    const def = TOOL_DEFS.find((d) => d.name === toolName);
    expect(def, `${toolName} must exist`).toBeDefined();
    const writable = Object.keys(
      (def!.input_schema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    const overlap = writable.filter((f) => TOKEN_EXCLUDED[kind].includes(f));
    expect(overlap).toEqual([]);
  });
});
