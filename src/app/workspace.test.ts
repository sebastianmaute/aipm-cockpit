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

describe("workspace features (per-project)", () => {
  it("omits features from JSON when undefined (byte-stability)", () => {
    expect(JSON.parse(workspaceToJson(emptyWorkspace()))).not.toHaveProperty("features");
  });
  it("round-trips a features array including explicit empty (Simple)", () => {
    const ws = { ...emptyWorkspace(), features: ["raid", "budget"] as const };
    // sanitizeFeatures returns ids in registry order (budget precedes raid).
    expect(jsonToWorkspace(workspaceToJson(ws)).features).toEqual(["budget", "raid"]);
    const simple = { ...emptyWorkspace(), features: [] as const };
    expect(jsonToWorkspace(workspaceToJson(simple)).features).toEqual([]); // empty preserved, NOT all
  });
  it("legacy JSON with no features key stays undefined (not all-modules)", () => {
    const json = JSON.stringify(JSON.parse(workspaceToJson(emptyWorkspace()))); // no features key
    expect(jsonToWorkspace(json).features).toBeUndefined();
  });
  it("sanitizes junk feature ids on read", () => {
    const raw = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), features: ["raid", "nope"] });
    expect(jsonToWorkspace(raw).features).toEqual(["raid"]);
  });
});
