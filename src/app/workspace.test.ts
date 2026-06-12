import { describe, expect, it } from "vitest";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./workspace";

describe("workspace fieldVisibility envelope", () => {
  it("omits fieldVisibility from JSON when undefined (byte-stability)", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(JSON.parse(json)).not.toHaveProperty("fieldVisibility");
  });
  it("round-trips a fieldVisibility config", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { milestone: { fields: ["name", "targetDate"] } } };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.fieldVisibility?.milestone.fields).toEqual(["name", "targetDate"]);
  });
  it("sanitizes junk fieldVisibility on read to undefined", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), fieldVisibility: "bad" });
    expect(jsonToWorkspace(raw).fieldVisibility).toBeUndefined();
  });
});
