import { describe, expect, test } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv, csvToWorkspace,
  workspaceToMarkdown, markdownToWorkspace,
  workspaceToJson, jsonToWorkspace,
} from "./storage";
import type { DocumentLink } from "./document-link";
import type { Workspace } from "./storage";
import type { RaidItem, ChangeItem } from "./types";

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

describe("RaidItem documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const r: RaidItem = {
      id: 1, category: "R", title: "Risk", status: "Open",
      linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      documentLinks: links,
    };
    w.raid = [r];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).raid[0].documentLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).raid[0].documentLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).raid[0].documentLinks).toEqual(links); });
  test("empty RAID documentLinks → empty cell (no [])", () => {
    const w = emptyWorkspace();
    w.raid = [{ id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01" }];
    expect(workspaceToCsv(w)).not.toContain("[]");
  });
});

describe("ChangeItem documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const c: ChangeItem = {
      id: 1, title: "C", description: "d", type: "Scope", status: "Proposed",
      linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      documentLinks: links,
    };
    w.changes = [c];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).changes![0]!.documentLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).changes![0]!.documentLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).changes![0]!.documentLinks).toEqual(links); });
  test("empty Change documentLinks → no []", () => {
    const w = emptyWorkspace();
    w.changes = [{ id: 1, title: "C", description: "d", type: "Scope", status: "Proposed", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01" }];
    expect(workspaceToCsv(w)).not.toContain("[]");
  });
});
