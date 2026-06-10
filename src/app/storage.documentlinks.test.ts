import { describe, expect, test } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv, csvToWorkspace,
  workspaceToMarkdown, markdownToWorkspace,
  workspaceToJson, jsonToWorkspace,
} from "./storage";
import type { DocumentLink } from "./document-link";
import type { Workspace } from "./storage";

const links: DocumentLink[] = [
  { id: "01", name: "Spec, v2.docx", url: "https://c.sharepoint.com/sites/p/Docs/Spec.docx", kind: "file", driveId: "b!d", itemId: "01" },
  { id: "02", name: "Evidence folder", url: "https://c.sharepoint.com/sites/p/Docs/Evidence", kind: "folder" },
];

function wsWithTaskLinks(): Workspace {
  const ws = emptyWorkspace();
  ws.tasks = [{
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "", dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01", priority: "Medium", blockers: "", notes: "",
    documentLinks: links,
  }];
  return ws;
}

describe("Task documentLinks round-trips", () => {
  test("CSV", () => {
    const back = csvToWorkspace(workspaceToCsv(wsWithTaskLinks()));
    expect(back.tasks[0].documentLinks).toEqual(links);
  });
  test("Markdown", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(wsWithTaskLinks()));
    expect(back.tasks[0].documentLinks).toEqual(links);
  });
  test("JSON", () => {
    const back = jsonToWorkspace(workspaceToJson(wsWithTaskLinks()));
    expect(back.tasks[0].documentLinks).toEqual(links);
  });
  test("empty documentLinks serializes to an empty cell (byte-stable)", () => {
    const ws = emptyWorkspace();
    ws.tasks = [{ id: 1, taskName: "T", assignee: "A", assigneeEmail: "", dueDate: "2026-01-01", lastUpdateDate: "2026-01-01", priority: "Medium", blockers: "", notes: "" }];
    const csv = workspaceToCsv(ws);
    expect(csv).toContain("documentLinks");
    // Byte-stability: an empty links array must serialize to an empty cell, never "[]".
    expect(csv).not.toContain("[]");
    const back = csvToWorkspace(csv);
    expect(back.tasks[0].documentLinks ?? []).toEqual([]);
  });
});
