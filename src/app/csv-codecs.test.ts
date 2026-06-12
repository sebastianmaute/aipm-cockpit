// src/app/csv-codecs.test.ts
import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { emptyWorkspace } from "./workspace";

describe("csv fieldVisibility section", () => {
  it("emits no field-visibility section when undefined", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("field-visibility");
  });
  it("round-trips fieldVisibility through CSV", () => {
    const ws = { ...emptyWorkspace(), fieldVisibility: { task: { fields: ["taskName", "assignee"] } } };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.fieldVisibility?.task.fields).toEqual(["taskName", "assignee"]);
  });
});
