// src/app/insights/recommend-schema.test.ts
import { describe, test, expect } from "vitest";
import { TOOL_DEFS } from "../chat-tool-defs";
import { RECOMMEND_TOOL } from "./recommend";
import { ALLOWED_REC_TOOLS } from "./insight";
import { REC_TOOL_INPUT_SCHEMAS, recommendationCallProblem } from "./recommend-schema";

type Schema = { properties?: Record<string, unknown>; required?: readonly string[] };
type Def = { name: string; input_schema: Schema };
type Branch = { properties: { name: { enum: readonly string[] }; input: Schema }; required: readonly string[] };

const chatDef = (name: string): Def => {
  const def = (TOOL_DEFS as unknown as readonly Def[]).find((d) => d.name === name);
  if (!def) throw new Error(`no chat tool ${name}`);
  return def;
};
const branches = (): readonly Branch[] =>
  (RECOMMEND_TOOL.input_schema.properties.calls.items as unknown as { anyOf: readonly Branch[] }).anyOf;

// §782 — the model was sent `input: {type:"object"}` with no argument names, so
// it proposed a create_task without `taskName`/`assignee` that runTool refused.
describe("§782 — propose_insight_actions carries the chat tools' own input schemas", () => {
  test("one branch per allowed tool, and no other tool", () => {
    const names = branches().map((b) => b.properties.name.enum);
    expect(names.every((n) => n.length === 1)).toBe(true);
    expect(new Set(names.map((n) => n[0]))).toEqual(ALLOWED_REC_TOOLS);
    expect(names).toHaveLength(ALLOWED_REC_TOOLS.size);
  });

  test("each branch's input is the chat schema minus the token the store stamps", () => {
    for (const b of branches()) {
      const name = b.properties.name.enum[0];
      const chat = chatDef(name).input_schema;
      const chatProps = Object.fromEntries(Object.entries(chat.properties ?? {}).filter(([k]) => k !== "expectedToken"));
      expect(b.properties.input.properties, name).toEqual(chatProps);
      expect(b.properties.input.required, name).toEqual((chat.required ?? []).filter((k) => k !== "expectedToken"));
      expect(b.required).toEqual(["name", "input"]);
    }
  });

  test("create_task tells the model its three required arguments", () => {
    expect(REC_TOOL_INPUT_SCHEMAS.create_task.required).toEqual(["taskName", "assignee", "dueDate"]);
    expect(REC_TOOL_INPUT_SCHEMAS.update_task.required).toEqual(["id"]);
  });

  // (f) Deriving must not edit the chat definitions in place: chat calls keep
  // the token requirement and every field they accept today.
  test("the chat tool definitions are left exactly as they were", () => {
    expect(chatDef("update_task").input_schema.required).toEqual(["id", "expectedToken"]);
    expect(chatDef("update_task").input_schema.properties).toHaveProperty("expectedToken");
    expect(chatDef("create_task").input_schema.required).toEqual(["taskName", "assignee", "dueDate"]);
  });
});

describe("§782 — recommendationCallProblem judges what the dispatcher requires", () => {
  test("a create_task without taskName and assignee is named, with the missing fields", () => {
    const problem = recommendationCallProblem({ name: "create_task", input: { title: "Review T&M burn", dueDate: "2026-09-25" } });
    expect(problem).toBe("create_task: taskName, assignee required");
  });

  test("a complete create_task has no problem", () => {
    expect(
      recommendationCallProblem({ name: "create_task", input: { taskName: "Review T&M burn", assignee: "Dana Ortiz", dueDate: "2026-09-25" } }),
    ).toBeNull();
  });

  test("blank strings count as missing, as the writers' trims do", () => {
    expect(
      recommendationCallProblem({ name: "create_task", input: { taskName: "  ", assignee: "Dana Ortiz", dueDate: "2026-09-25" } }),
    ).toBe("create_task: taskName required");
  });

  test("a required date that is not YYYY-MM-DD is named", () => {
    expect(
      recommendationCallProblem({ name: "create_task", input: { taskName: "X", assignee: "Dana Ortiz", dueDate: "next Friday" } }),
    ).toBe("create_task: dueDate must be YYYY-MM-DD");
    expect(recommendationCallProblem({ name: "create_milestone", input: { name: "Go-live", targetDate: "2026-10-01" } })).toBe(
      "create_milestone: date required",
    );
    expect(recommendationCallProblem({ name: "create_milestone", input: { name: "Go-live", date: "2026-10-01" } })).toBeNull();
  });

  test("each register create names its own required field", () => {
    expect(recommendationCallProblem({ name: "create_raid_item", input: { description: "overrun" } })).toBe("create_raid_item: title required");
    expect(recommendationCallProblem({ name: "create_change", input: { title: "Budget change" } })).toBeNull();
    expect(recommendationCallProblem({ name: "create_stakeholder", input: {} })).toBe("create_stakeholder: name required");
  });

  // An update's only required argument after the stamp is its id, which runTool
  // reads with Number(); a numeric string is accepted there, so here too.
  test("an update needs only an id runTool can read", () => {
    expect(recommendationCallProblem({ name: "update_task", input: { id: 42, status: "Done" } })).toBeNull();
    expect(recommendationCallProblem({ name: "update_task", input: { id: "42", status: "Done" } })).toBeNull();
    expect(recommendationCallProblem({ name: "update_task", input: { status: "Done" } })).toBe("update_task: id required");
  });

  test("a tool outside the allow-set is a problem, never a pass", () => {
    expect(recommendationCallProblem({ name: "delete_task", input: { id: 42 } })).toBe("delete_task: not allowed");
  });
});
