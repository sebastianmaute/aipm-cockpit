// src/app/knowledge-items-persistence.test.ts
// Round-trip tests for Workspace.knowledgeItems (standalone Knowledge-library
// items, optionally task-linked) across the three text codecs (JSON, CSV,
// Markdown) plus byte-stability checks (an items-less workspace must NOT emit
// the # KNOWLEDGE ITEMS / ## Knowledge Items sections).
//
// Unlike timelogLinks/steeringCommittee this field is EXPORTABLE, so it is also
// emitted on the document-export path when its export section is enabled.

import { describe, it, expect } from "vitest";
import { emptyWorkspace, workspaceToJson, jsonToWorkspace } from "./workspace";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { defaultExportConfig } from "./settings-types";
import type { KnowledgeItem } from "./document-link";

const SAMPLE_ITEMS: KnowledgeItem[] = [
  { id: "k1", name: "Design doc", url: "https://example.com/doc.docx", kind: "file", taskIds: [1, 3] },
  {
    id: "k2",
    name: "Architecture wiki",
    url: "https://acme.atlassian.net/wiki/spaces/AB/pages/1",
    kind: "file",
    linkKind: "confluence",
  },
  { id: "k3", name: "Vendor site", url: "https://vendor.example.com", kind: "file", linkKind: "url" },
];

function wsWithItems() {
  return { ...emptyWorkspace(), knowledgeItems: SAMPLE_ITEMS };
}

// --- JSON round-trip ----------------------------------------------------------

describe("JSON codec — knowledgeItems", () => {
  it("round-trips knowledgeItems incl. task links", () => {
    const restored = jsonToWorkspace(workspaceToJson(wsWithItems()));
    expect(restored.knowledgeItems).toEqual(SAMPLE_ITEMS);
  });

  it("items-less workspace has no knowledgeItems key in JSON output", () => {
    expect(workspaceToJson(emptyWorkspace())).not.toContain("knowledgeItems");
  });
});

// --- CSV round-trip -----------------------------------------------------------

describe("CSV codec — knowledgeItems", () => {
  it("round-trips knowledgeItems on the storage path", () => {
    const restored = csvToWorkspace(workspaceToCsv(wsWithItems()));
    expect(restored.knowledgeItems).toEqual(SAMPLE_ITEMS);
  });

  it("items-less workspace emits no # KNOWLEDGE ITEMS section", () => {
    expect(workspaceToCsv(emptyWorkspace())).not.toContain("# KNOWLEDGE ITEMS");
  });

  it("is EXPORTED when the export section is enabled, omitted when disabled", () => {
    const on = { ...defaultExportConfig, knowledgeItems: true };
    const off = { ...defaultExportConfig, knowledgeItems: false };
    expect(workspaceToCsv(wsWithItems(), on)).toContain("# KNOWLEDGE ITEMS");
    expect(workspaceToCsv(wsWithItems(), off)).not.toContain("# KNOWLEDGE ITEMS");
  });
});

// --- Markdown round-trip ------------------------------------------------------

describe("Markdown codec — knowledgeItems", () => {
  it("round-trips knowledgeItems on the storage path", () => {
    const restored = markdownToWorkspace(workspaceToMarkdown(wsWithItems()));
    expect(restored.knowledgeItems).toEqual(SAMPLE_ITEMS);
  });

  it("items-less workspace emits no ## Knowledge Items section", () => {
    expect(workspaceToMarkdown(emptyWorkspace())).not.toContain("## Knowledge Items");
  });

  it("is EXPORTED when the export section is enabled, omitted when disabled", () => {
    const on = { ...defaultExportConfig, knowledgeItems: true };
    const off = { ...defaultExportConfig, knowledgeItems: false };
    expect(workspaceToMarkdown(wsWithItems(), on)).toContain("## Knowledge Items");
    expect(workspaceToMarkdown(wsWithItems(), off)).not.toContain("## Knowledge Items");
  });
});

// --- Sanitizer guards ---------------------------------------------------------

describe("sanitizeKnowledgeItems via JSON round-trip", () => {
  it("drops unsafe-URL items and non-positive task ids", () => {
    const ws = {
      ...emptyWorkspace(),
      knowledgeItems: [
        { id: "bad", name: "XSS", url: "javascript:alert(1)", kind: "file" },
        { id: "ok", name: "Good", url: "https://ok.example.com", kind: "file", taskIds: [1, -2, 0, 1, 4] },
      ] as KnowledgeItem[],
    };
    const restored = jsonToWorkspace(workspaceToJson(ws));
    expect(restored.knowledgeItems).toEqual([
      { id: "ok", name: "Good", url: "https://ok.example.com", kind: "file", taskIds: [1, 4] },
    ]);
  });
});
