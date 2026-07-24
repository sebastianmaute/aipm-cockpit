import { describe, expect, test } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv, csvToWorkspace,
  workspaceToMarkdown, markdownToWorkspace,
  workspaceToJson, jsonToWorkspace,
} from "./storage";
import type { KnowledgeLink } from "./document-link";
import type { Workspace } from "./storage";
import type { RaidItem, ChangeItem, Stakeholder, Milestone, ProjectMeta } from "./types";

const links: KnowledgeLink[] = [
  { id: "01", name: "Spec, v2.docx", url: "https://c.sharepoint.com/sites/p/Docs/Spec.docx", kind: "file", driveId: "b!d", itemId: "01" },
  { id: "02", name: "Evidence folder", url: "https://c.sharepoint.com/sites/p/Docs/Evidence", kind: "folder" },
];

function wsWithTaskLinks(): Workspace {
  const ws = emptyWorkspace();
  ws.tasks = [{
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "", dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "",
    knowledgeLinks: links,
  }];
  return ws;
}

describe("Task knowledgeLinks round-trips", () => {
  test("CSV", () => {
    const back = csvToWorkspace(workspaceToCsv(wsWithTaskLinks()));
    expect(back.tasks[0].knowledgeLinks).toEqual(links);
  });
  test("Markdown", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(wsWithTaskLinks()));
    expect(back.tasks[0].knowledgeLinks).toEqual(links);
  });
  test("JSON", () => {
    const back = jsonToWorkspace(workspaceToJson(wsWithTaskLinks()));
    expect(back.tasks[0].knowledgeLinks).toEqual(links);
  });
  test("empty knowledgeLinks serializes to an empty cell (byte-stable)", () => {
    const ws = emptyWorkspace();
    ws.tasks = [{ id: 1, taskName: "T", assignee: "A", assigneeEmail: "", dueDate: "2026-01-01", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "" }];
    const csv = workspaceToCsv(ws);
    expect(csv).toContain("knowledgeLinks");
    // Byte-stability: an empty links array must serialize to an empty cell, never "[]".
    expect(csv).not.toContain("[]");
    const back = csvToWorkspace(csv);
    expect(back.tasks[0].knowledgeLinks ?? []).toEqual([]);
  });
});

describe("RaidItem knowledgeLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const r: RaidItem = {
      id: 1, category: "R", title: "Risk", status: "Open",
      linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      knowledgeLinks: links,
    };
    w.raid = [r];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).raid[0].knowledgeLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).raid[0].knowledgeLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).raid[0].knowledgeLinks).toEqual(links); });
  test("empty RAID knowledgeLinks → empty cell (no [])", () => {
    const w = emptyWorkspace();
    w.raid = [{ id: 1, category: "R", title: "Risk", status: "Open", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01" }];
    expect(workspaceToCsv(w)).not.toContain("[]");
  });
});

describe("ChangeItem knowledgeLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const c: ChangeItem = {
      id: 1, title: "C", description: "d", type: "Scope", status: "Proposed",
      linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      knowledgeLinks: links,
    };
    w.changes = [c];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).changes![0]!.knowledgeLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).changes![0]!.knowledgeLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).changes![0]!.knowledgeLinks).toEqual(links); });
  test("empty Change knowledgeLinks → no []", () => {
    const w = emptyWorkspace();
    w.changes = [{ id: 1, title: "C", description: "d", type: "Scope", status: "Proposed", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01" }];
    expect(workspaceToCsv(w)).not.toContain("[]");
  });
});

describe("Stakeholder knowledgeLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const s: Stakeholder = {
      id: 1, name: "S", category: "Internal", influence: "Low", interest: "Low",
      raci: {}, knowledgeLinks: links,
    };
    w.stakeholders = [s];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).stakeholders![0]!.knowledgeLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).stakeholders![0]!.knowledgeLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).stakeholders![0]!.knowledgeLinks).toEqual(links); });
  test("empty Stakeholder knowledgeLinks → no []", () => {
    const w = emptyWorkspace();
    w.stakeholders = [{ id: 1, name: "S", category: "Internal", influence: "Low", interest: "Low", raci: {} }];
    expect(workspaceToCsv(w)).not.toContain("[]");
  });
});

describe("Milestone knowledgeLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const m: Milestone = { id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [], knowledgeLinks: links };
    w.milestones = [m];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).milestones![0].knowledgeLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).milestones![0].knowledgeLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).milestones![0].knowledgeLinks).toEqual(links); });
  test("empty Milestone knowledgeLinks → no []", () => {
    const w = emptyWorkspace();
    w.milestones = [{ id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [] }];
    expect(workspaceToCsv(w)).not.toContain("[]");
  });
});

describe("ProjectMeta knowledgeLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const p: ProjectMeta = {
      name: "Proj", code: "PRJ-1", projectManager: "PM",
      keyStakeholdersInternal: ["Alice"], keyStakeholdersExternal: ["Bob"],
      customer: "Acme", naceSection: "C", identityTypes: [], products: "Widget",
      deployment: "Cloud", startDate: "2026-01-01", endDate: "2026-12-31",
      profitCenter: "PC-1", contactPersons: [], regulatory: ["Not applicable"],
      knowledgeLinks: links,
    };
    w.project = p;
    return w;
  }
  test("Markdown (project block)", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(ws()));
    expect(back.project?.knowledgeLinks).toEqual(links);
  });
  test("JSON", () => {
    const back = jsonToWorkspace(workspaceToJson(ws()));
    expect(back.project?.knowledgeLinks).toEqual(links);
  });
});

// DATA SAFETY: the wire field was renamed documentLinks → knowledgeLinks. An
// existing on-disk file (CSV/MD/JSON) written by an OLD build still carries the
// legacy name; loading it MUST preserve the links under the new field, never
// silently drop them. These simulate an old file by rewriting the header/key of
// a freshly-serialized workspace back to the legacy name, then loading it.
describe("legacy documentLinks back-compat on load (no data loss)", () => {
  test("old-format CSV header `documentLinks` loads into knowledgeLinks", () => {
    const legacyCsv = workspaceToCsv(wsWithTaskLinks()).split("knowledgeLinks").join("documentLinks");
    expect(legacyCsv).toContain("documentLinks");
    expect(legacyCsv).not.toContain("knowledgeLinks");
    const back = csvToWorkspace(legacyCsv);
    expect(back.tasks[0].knowledgeLinks).toEqual(links);
  });

  test("old-format Markdown header `DocumentLinks` loads into knowledgeLinks", () => {
    const legacyMd = workspaceToMarkdown(wsWithTaskLinks()).split("KnowledgeLinks").join("DocumentLinks");
    expect(legacyMd).toContain("DocumentLinks");
    expect(legacyMd).not.toContain("KnowledgeLinks");
    const back = markdownToWorkspace(legacyMd);
    expect(back.tasks[0].knowledgeLinks).toEqual(links);
  });

  test("old JSON workspace with `documentLinks` keys preserves links (task)", () => {
    const legacyJson = workspaceToJson(wsWithTaskLinks()).split('"knowledgeLinks"').join('"documentLinks"');
    expect(legacyJson).toContain('"documentLinks"');
    expect(legacyJson).not.toContain('"knowledgeLinks"');
    const back = jsonToWorkspace(legacyJson);
    expect(back.tasks[0].knowledgeLinks).toEqual(links);
  });

  test("old JSON with `documentLinks` on ProjectMeta preserves links", () => {
    const w = emptyWorkspace();
    w.project = {
      name: "Proj", code: "PRJ-1", projectManager: "PM",
      keyStakeholdersInternal: ["Alice"], keyStakeholdersExternal: ["Bob"],
      customer: "Acme", naceSection: "C", identityTypes: [], products: "Widget",
      deployment: "Cloud", startDate: "2026-01-01", endDate: "2026-12-31",
      profitCenter: "PC-1", contactPersons: [], regulatory: ["Not applicable"],
      knowledgeLinks: links,
    };
    const legacyJson = workspaceToJson(w).split('"knowledgeLinks"').join('"documentLinks"');
    const back = jsonToWorkspace(legacyJson);
    expect(back.project?.knowledgeLinks).toEqual(links);
  });

  test("legacy JSON RAID item keeps its links", () => {
    const w = emptyWorkspace();
    w.raid = [{
      id: 5, category: "R", title: "Risk", status: "Open", raisedDate: "2026-01-01",
      linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], knowledgeLinks: links,
    } as RaidItem];
    const legacyJson = workspaceToJson(w).split('"knowledgeLinks"').join('"documentLinks"');
    const back = jsonToWorkspace(legacyJson);
    expect(back.raid[0].knowledgeLinks).toEqual(links);
  });
});
