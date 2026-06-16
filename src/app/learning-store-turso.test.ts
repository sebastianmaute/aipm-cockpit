import { describe, it, expect } from "vitest";
import { TABLE_NAMES } from "./turso-schema";
import { LEARNING_DDL, learningSelect, learningUpsert, rowsToSnapshot } from "./learning-schema";

describe("learning-schema", () => {
  it("keeps action_learning OUT of TABLE_NAMES (workspace save must not wipe it)", () => {
    expect(TABLE_NAMES).not.toContain("action_learning");
  });
  it("DDL creates the table", () => {
    expect(LEARNING_DDL.join(" ")).toMatch(/CREATE TABLE IF NOT EXISTS action_learning/);
    expect(learningSelect().length).toBe(1);
  });
  it("upsert binds ints as strings", () => {
    const stmts = learningUpsert("raid:wk", { acted: 2, snoozed: 0, dismissed: 1, lastAt: 9 }, "auto");
    expect(JSON.stringify(stmts)).toContain("\"2\"");
  });
  it("rowsToSnapshot rebuilds state + overrides", () => {
    const fakeResult = {
      type: "ok" as const,
      response: {
        type: "execute",
        result: {
          cols: [{ name: "kind" }, { name: "acted" }, { name: "snoozed" }, { name: "dismissed" }, { name: "last_at" }, { name: "override" }],
          rows: [[{ value: "raid:wk" }, { value: "2" }, { value: "0" }, { value: "1" }, { value: "9" }, { value: "surface" }]],
        },
      },
    };
    const snap = rowsToSnapshot(fakeResult);
    expect(snap.state["raid:wk"]).toEqual({ acted: 2, snoozed: 0, dismissed: 1, lastAt: 9 });
    expect(snap.overrides["raid:wk"]).toBe("surface");
  });
  it("rowsToSnapshot ignores an absent or auto override", () => {
    const fakeResult = {
      type: "ok" as const,
      response: {
        type: "execute",
        result: {
          cols: [{ name: "kind" }, { name: "acted" }, { name: "snoozed" }, { name: "dismissed" }, { name: "last_at" }, { name: "override" }],
          rows: [[{ value: "raid:wk" }, { value: "2" }, { value: "0" }, { value: "1" }, { value: "9" }, { value: "auto" }]],
        },
      },
    };
    const snap = rowsToSnapshot(fakeResult);
    expect(snap.overrides["raid:wk"]).toBeUndefined();
  });
});
