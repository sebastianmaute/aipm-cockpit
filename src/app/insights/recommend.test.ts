import { describe, expect, test } from "vitest";
import { parseRecommendation, ALLOWED_REC_TOOLS, RECOMMEND_TOOL } from "./recommend";
import { buildRecommendContext, buildRecommendSystemPrompt } from "./recommend-context";
import { buildGroundingIndex } from "../action-ai";

const index = buildGroundingIndex({
  tasks: [{ id: 12 }],
  raid: [{ id: 5 }],
  milestones: [],
  changes: [],
  stakeholders: [],
});

describe("parseRecommendation", () => {
  test("grounds a valid update_task call", () => {
    const out = parseRecommendation(
      { summary: "reschedule 12", calls: [{ name: "update_task", input: { id: 12, dueDate: "2026-08-01" } }] },
      index,
    );
    expect(out?.proposedCalls).toHaveLength(1);
    expect(out?.status).toBe("proposed");
  });

  test("drops a call whose id is not in the workspace", () => {
    expect(
      parseRecommendation({ summary: "x", calls: [{ name: "update_task", input: { id: 999 } }] }, index),
    ).toBeNull();
  });

  test("drops a call whose tool is not in the allow-set", () => {
    const out = parseRecommendation(
      {
        summary: "x",
        calls: [
          { name: "delete_all_tasks", input: {} },
          { name: "update_task", input: { id: 12 } },
        ],
      },
      index,
    );
    expect(out?.proposedCalls).toHaveLength(1);
    expect(out?.proposedCalls[0].name).toBe("update_task");
  });

  test("returns null on empty summary", () => {
    expect(
      parseRecommendation({ summary: "", calls: [{ name: "update_task", input: { id: 12 } }] }, index),
    ).toBeNull();
  });

  test("create_task needs no id grounding", () => {
    const out = parseRecommendation(
      { summary: "add", calls: [{ name: "create_task", input: { taskName: "New" } }] },
      index,
    );
    expect(out?.proposedCalls).toHaveLength(1);
  });

  test("grounds a valid update_raid_item call against the raid index", () => {
    const out = parseRecommendation(
      { summary: "close raid item", calls: [{ name: "update_raid_item", input: { id: 5, status: "Closed" } }] },
      index,
    );
    expect(out?.proposedCalls).toHaveLength(1);
  });

  test("drops a call with a non-numeric id", () => {
    expect(
      parseRecommendation({ summary: "x", calls: [{ name: "update_task", input: { id: "not-a-number" } }] }, index),
    ).toBeNull();
  });

  test("returns null when input is not an object", () => {
    expect(parseRecommendation(null, index)).toBeNull();
    expect(parseRecommendation("nope", index)).toBeNull();
  });

  test("returns null when calls is missing", () => {
    expect(parseRecommendation({ summary: "x" }, index)).toBeNull();
  });

  test("caps proposedCalls at INSIGHT_REC_MAX_CALLS", () => {
    const calls = Array.from({ length: 10 }, () => ({ name: "create_task", input: { taskName: "New" } }));
    const out = parseRecommendation({ summary: "many", calls }, index);
    expect(out?.proposedCalls.length).toBeLessThanOrEqual(5);
  });

  test("ALLOWED_REC_TOOLS are all real chat tools", async () => {
    const { TOOL_DEFS } = await import("../chat-tool-defs");
    const names = new Set((TOOL_DEFS as { name: string }[]).map((d) => d.name));
    for (const t of ALLOWED_REC_TOOLS) expect(names.has(t)).toBe(true);
  });

  test("RECOMMEND_TOOL exposes the allowed tool names in its schema enum", () => {
    const enumNames = RECOMMEND_TOOL.input_schema.properties.calls.items.properties.name.enum;
    expect(new Set(enumNames)).toEqual(ALLOWED_REC_TOOLS);
  });
});

describe("buildRecommendContext / buildRecommendSystemPrompt", () => {
  test("includes insight data and related task ids", () => {
    const out = buildRecommendContext({
      projectName: "Demo",
      today: "2026-07-20",
      insightType: "milestoneSlip",
      severity: "high",
      data: { daysLate: 3 },
      relatedTasks: [{ id: 12, title: "Fix the thing" }],
    });
    expect(out).toContain("daysLate: 3");
    expect(out).toContain("open-points#12");
    expect(out).toContain("milestoneSlip");
  });

  test("handles no linked entity and no related tasks", () => {
    const out = buildRecommendContext({
      projectName: "Demo",
      today: "2026-07-20",
      insightType: "raidAging",
      severity: "medium",
      data: {},
      relatedTasks: [],
    });
    expect(out).toContain("(no linked entity)");
    expect(out).toContain("(none)");
  });

  test("system prompt is a non-empty stable string mentioning the tool", () => {
    const p = buildRecommendSystemPrompt();
    expect(p).toContain("propose_insight_actions");
    expect(p.length).toBeGreaterThan(20);
  });
});
