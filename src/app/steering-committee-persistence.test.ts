import { describe, expect, it } from "vitest";
import { jsonToWorkspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./storage";

const wsJson = JSON.stringify({
  tasks: [], raid: [],
  steeringCommittee: { name: "Board", memberResourceIds: [1], meetings: [{ id: 1, date: "2026-07-10", title: "July" }], infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }] },
});
describe("steeringCommittee persistence", () => {
  it("round-trips through JSON load", () => { expect(jsonToWorkspace(wsJson).steeringCommittee?.name).toBe("Board"); });
  it("round-trips through CSV", () => { expect(csvToWorkspace(workspaceToCsv(jsonToWorkspace(wsJson))).steeringCommittee?.meetings[0].title).toBe("July"); });
  it("round-trips through Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(jsonToWorkspace(wsJson))).steeringCommittee?.infoSchedules[0].leadDays).toBe(3); });
  it("a committee-less workspace stays committee-undefined through CSV+MD", () => {
    const bare = jsonToWorkspace(JSON.stringify({ tasks: [], raid: [] }));
    expect(csvToWorkspace(workspaceToCsv(bare)).steeringCommittee).toBeUndefined();
    expect(markdownToWorkspace(workspaceToMarkdown(bare)).steeringCommittee).toBeUndefined();
  });
});
