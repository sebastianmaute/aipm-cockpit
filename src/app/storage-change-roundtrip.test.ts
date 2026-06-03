import { describe, expect, it } from "vitest";
import { jsonToWorkspace, workspaceToJson, emptyWorkspace, CHANGES_CSV_COLUMNS, changeFieldToString, buildChangeFromObj } from "./storage";
import type { ChangeItem } from "./types";

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved",
  impact: "High", impactDescription: "2 sprints", scheduleImpactDays: 10, costImpact: 5000,
  requestedBy: "Ann", raisedDate: "2026-06-01", decisionBy: "Bob", decisionDate: "2026-06-09",
  resolutionNotes: "ok", linkedTaskIds: [3, 4], linkedRaidIds: [7], localModifiedAt: "2026-06-09T10:00:00.000Z",
};

describe("changes JSON round-trip", () => {
  it("survives workspaceToJson -> jsonToWorkspace (sanitized)", () => {
    const ws = { ...emptyWorkspace(), changes: [change] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.changes).toHaveLength(1);
    expect(back.changes?.[0]).toMatchObject({ id: 1, type: "Scope", status: "Approved", impact: "High", linkedTaskIds: [3, 4], linkedRaidIds: [7] });
  });
  it("drops malformed change rows on load", () => {
    const json = JSON.stringify({ ...emptyWorkspace(), changes: [{ title: "no id" }, change] });
    expect(jsonToWorkspace(json).changes).toHaveLength(1);
  });
});

describe("change CSV column encode/decode", () => {
  it("CHANGES_CSV_COLUMNS lists the canonical order", () => {
    expect(CHANGES_CSV_COLUMNS).toEqual([
      "id","title","description","type","status","impact","impactDescription","scheduleImpactDays",
      "costImpact","requestedBy","raisedDate","decisionBy","decisionDate","resolutionNotes",
      "linkedTaskIds","linkedRaidIds","localModifiedAt",
    ]);
  });
  it("changeFieldToString encodes id-lists pipe-joined; buildChangeFromObj round-trips", () => {
    const obj: Record<string, string> = {};
    for (const c of CHANGES_CSV_COLUMNS) obj[c] = changeFieldToString(change, c);
    expect(obj.linkedTaskIds).toBe("3|4");
    expect(obj.linkedRaidIds).toBe("7");
    const back = buildChangeFromObj(obj);
    expect(back).toMatchObject({ id: 1, title: "Widen scope", type: "Scope", status: "Approved", linkedTaskIds: [3, 4], linkedRaidIds: [7] });
  });
});
