import { describe, expect, it } from "vitest";
import { workspaceToCsv, csvToWorkspace, workspaceToMarkdown, markdownToWorkspace, emptyWorkspace } from "./storage";
import type { ChangeItem } from "./types";

const change: ChangeItem = {
  id: 1, title: "Widen scope", description: "add module", type: "Scope", status: "Approved",
  impact: "High", raisedDate: "2026-06-01", linkedTaskIds: [3], linkedRaidIds: [7],
};

describe("changes CSV round-trip", () => {
  it("survives CSV write/read", () => {
    const ws = { ...emptyWorkspace(), changes: [change] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.changes?.[0]).toMatchObject({ id: 1, type: "Scope", status: "Approved", linkedTaskIds: [3], linkedRaidIds: [7] });
  });
});

describe("changes Markdown round-trip", () => {
  it("survives Markdown write/read", () => {
    const ws = { ...emptyWorkspace(), changes: [change] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.changes?.[0]).toMatchObject({ id: 1, title: "Widen scope", linkedRaidIds: [7] });
  });
});
