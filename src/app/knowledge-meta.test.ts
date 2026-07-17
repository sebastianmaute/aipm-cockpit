import { describe, it, expect } from "vitest";
import { hostLabel, fileTypeOf, filterDocs, sortDocs, sourceCounts, effectiveSourceFilter } from "./knowledge-meta";
import type { DocRef } from "./knowledge";

describe("hostLabel", () => {
  it("maps known SaaS hosts to stable labels", () => {
    expect(hostLabel("https://contoso.sharepoint.com/x")).toBe("SharePoint");
    expect(hostLabel("https://contoso-my.sharepoint.com/x")).toBe("OneDrive");
    expect(hostLabel("https://acme.atlassian.net/wiki/spaces/A/pages/1")).toBe("Confluence");
    expect(hostLabel("https://acme.atlassian.net/browse/ABC-1")).toBe("Jira");
    expect(hostLabel("https://github.com/o/r")).toBe("GitHub");
    expect(hostLabel("https://docs.google.com/d/1")).toBe("Google");
  });
  it("returns the bare hostname (www stripped) for unknown hosts", () => {
    expect(hostLabel("https://www.example.com/a")).toBe("example.com");
  });
  it("returns empty string for an unparseable url", () => {
    expect(hostLabel("not a url")).toBe("");
  });
});

describe("fileTypeOf", () => {
  it("uses the filename extension", () => {
    expect(fileTypeOf({ name: "a.pdf", kind: "file" }).labelKey).toBe("Pdf");
    expect(fileTypeOf({ name: "a.docx", kind: "file" }).labelKey).toBe("Word");
    expect(fileTypeOf({ name: "a.xlsx", kind: "file" }).labelKey).toBe("Excel");
    expect(fileTypeOf({ name: "a.pptx", kind: "file" }).labelKey).toBe("Ppt");
    expect(fileTypeOf({ name: "a.png", kind: "file" }).labelKey).toBe("Image");
  });
  it("treats folders as Folder", () => {
    expect(fileTypeOf({ name: "Docs", kind: "folder" }).labelKey).toBe("Folder");
  });
  it("falls back to mimeType when there is no extension", () => {
    expect(fileTypeOf({ name: "report", kind: "file", mimeType: "application/pdf" }).labelKey).toBe("Pdf");
  });
  it("uses Link when a hosted url has no file extension, else File", () => {
    expect(fileTypeOf({ name: "Wiki page", kind: "file", url: "https://acme.atlassian.net/wiki/x" }).labelKey).toBe("Link");
    expect(fileTypeOf({ name: "scratch", kind: "file" }).labelKey).toBe("File");
  });
  it("always returns a non-empty icon", () => {
    expect(fileTypeOf({ name: "a.pdf", kind: "file" }).icon).not.toBe("");
  });
  it("link kind wins over the file heuristics", () => {
    // a confluence page keeps its Confluence type even with a doc-looking name
    expect(fileTypeOf({ name: "Spec.pdf", kind: "file", linkKind: "confluence" }).labelKey).toBe("Confluence");
    // a plain web url is a Link, not File
    expect(fileTypeOf({ name: "scratch", kind: "file", linkKind: "url" }).labelKey).toBe("Link");
    // an explicit document falls back to the extension/mime logic
    expect(fileTypeOf({ name: "a.pdf", kind: "file", linkKind: "document" }).labelKey).toBe("Pdf");
  });
});

const ref = (over: Partial<DocRef["link"]>, kind: DocRef["source"]["kind"], sourceName = "S"): DocRef => ({
  link: { id: "x", name: "n", url: "https://example.com/n.pdf", kind: "file", ...over },
  source: { kind, id: 1, name: sourceName, view: "open-points" },
  index: 0,
});

describe("filterDocs", () => {
  const docs = [ref({ name: "Alpha.pdf" }, "task"), ref({ name: "Beta.docx" }, "raid")];
  it("keeps everything for 'all'", () => {
    expect(filterDocs(docs, "all", "")).toHaveLength(2);
  });
  it("narrows by source kind", () => {
    expect(filterDocs(docs, "raid", "")).toHaveLength(1);
  });
  it("substring-matches the name case-insensitively", () => {
    expect(filterDocs(docs, "all", "alph")).toHaveLength(1);
  });
});

describe("sortDocs", () => {
  it("sorts added newest-first with blanks last", () => {
    const docs = [
      ref({ name: "old", addedAt: "2026-01-01T00:00:00.000Z" }, "task"),
      ref({ name: "blank" }, "task"),
      ref({ name: "new", addedAt: "2026-06-01T00:00:00.000Z" }, "task"),
    ];
    expect(sortDocs(docs, "added").map((d) => d.link.name)).toEqual(["new", "old", "blank"]);
  });
  it("sorts by name A→Z", () => {
    const docs = [ref({ name: "Beta" }, "task"), ref({ name: "Alpha" }, "task")];
    expect(sortDocs(docs, "name").map((d) => d.link.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("sourceCounts", () => {
  it("counts per kind plus total", () => {
    const c = sourceCounts([ref({}, "task"), ref({}, "task"), ref({}, "raid")]);
    expect(c.all).toBe(3);
    expect(c.task).toBe(2);
    expect(c.raid).toBe(1);
    expect(c.milestone).toBe(0);
  });
});

describe("effectiveSourceFilter", () => {
  const counts = { all: 1, project: 0, milestone: 0, task: 1, raid: 0, change: 0, stakeholder: 0 };
  it("keeps a filter whose source still has docs", () => {
    expect(effectiveSourceFilter("task", counts)).toBe("task");
  });
  it("falls back to all when the selected source is empty", () => {
    expect(effectiveSourceFilter("raid", counts)).toBe("all");
  });
  it("passes 'all' through unchanged", () => {
    expect(effectiveSourceFilter("all", counts)).toBe("all");
  });
});

describe("sortDocs by type", () => {
  it("orders by the localized label when a resolver is given", () => {
    const docs = [ref({ name: "a.pdf" }, "task"), ref({ name: "b.xlsx" }, "task")];
    // Resolver maps PDF→"Zzz", Excel→"Aaa" so the xlsx sorts first — proving the
    // resolver (not the English labelKey "Excel" < "Pdf", which agrees) drives it.
    const label = (r: DocRef) => (r.link.name.endsWith(".pdf") ? "Zzz" : "Aaa");
    expect(sortDocs(docs, "type", label).map((d) => d.link.name)).toEqual(["b.xlsx", "a.pdf"]);
  });
  it("falls back to the labelKey when no resolver is given", () => {
    const docs = [ref({ name: "a.pdf" }, "task"), ref({ name: "b.xlsx" }, "task")];
    // labelKey: "Excel" < "Pdf" → xlsx first.
    expect(sortDocs(docs, "type").map((d) => d.link.name)).toEqual(["b.xlsx", "a.pdf"]);
  });
});
