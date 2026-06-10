import { describe, expect, it } from "vitest";
import {
  type Workspace,
  emptyWorkspace,
  workspaceToJson,
  jsonToWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
  encodeProjectList,
  decodeProjectList,
} from "./storage";
import type { ProjectMeta } from "./types";

/** A fully-populated, valid ProjectMeta. Includes special characters
 *  (pipe, comma, newline, backslash) in several fields to stress the
 *  serializers' escaping. */
function makeProjectMeta(): ProjectMeta {
  return {
    name: "Apollo | Re-platform",
    code: "APL-001",
    description: "Line one\nLine two, with comma | and pipe",
    sponsor: "Jane Sponsor",
    projectManager: "John PM",
    keyStakeholdersInternal: ["Alice Internal", "Bob | Internal"],
    keyStakeholdersExternal: ["Carol External", "Dave External"],
    customer: "Acme Corp",
    naceSection: "C",
    identityTypes: ["B2B", "B2C"],
    identityCount: 42,
    products: "Widget Suite",
    platform: "Azure",
    deployment: "Cloud",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    profitCenter: "PC-100",
    quotes: "Q-2026-001",
    salesforceUrl: "https://sf.example.com/a",
    sharepointUrl: "https://sp.example.com/b",
    confluenceUrl: "https://cf.example.com/c",
    contactPersons: [
      { name: "Eve | Contact", email: "eve@example.com", synced: true },
      { name: "Frank Contact", email: "frank@example.com", synced: false },
    ],
    docRepoLocation: "C:\\repos\\apollo",
    regulatory: ["GDPR / data protection regulation", "DORA"],
    notes: "Some notes\nwith a newline",
  };
}

function wsWithProject(): Workspace {
  return { ...emptyWorkspace(), project: makeProjectMeta() };
}

describe("ProjectMeta serializer round-trips", () => {
  it("JSON round-trips every field", () => {
    const ws = wsWithProject();
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.project).toEqual(ws.project);
  });

  it("CSV round-trips every field", () => {
    const ws = wsWithProject();
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.project).toEqual(ws.project);
  });

  it("Markdown round-trips every field", () => {
    const ws = wsWithProject();
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.project).toEqual(ws.project);
  });
});

describe("ProjectMeta dual-use safety (no project => no change)", () => {
  it("CSV: no project marker emitted and parse yields undefined", () => {
    const ws = emptyWorkspace();
    expect(ws.project).toBeUndefined();
    const csv = workspaceToCsv(ws);
    expect(csv).not.toContain("# PROJECT META");
    expect(csv).not.toContain("# PROJECT\r\n");
    expect(csvToWorkspace(csv).project).toBeUndefined();
  });

  it("MD: no project section emitted and parse yields undefined", () => {
    const ws = emptyWorkspace();
    expect(ws.project).toBeUndefined();
    const md = workspaceToMarkdown(ws);
    expect(md).not.toContain("Project Meta");
    expect(markdownToWorkspace(md).project).toBeUndefined();
  });

  it("CSV: a project's bytes are confined to its own block (rest unchanged)", () => {
    const withProj = wsWithProject();
    const noProj: Workspace = { ...withProj };
    delete noProj.project;
    const csvWith = workspaceToCsv(withProj);
    const csvWithout = workspaceToCsv(noProj);
    // Removing the project must not alter any byte of the other sections.
    expect(csvWith.includes(csvWithout)).toBe(true);
  });

  it("MD: a project's bytes are confined to its own section (rest unchanged)", () => {
    const withProj = wsWithProject();
    const noProj: Workspace = { ...withProj };
    delete noProj.project;
    const mdWith = workspaceToMarkdown(withProj);
    const mdWithout = workspaceToMarkdown(noProj);
    expect(mdWith.includes(mdWithout)).toBe(true);
  });
});

describe("ProjectMeta round-trip stability", () => {
  // Note: emptyWorkspace() seeds disciplines/grades only on the *parse* path
  // (via migration), so we first parse once to reach a fixpoint, then assert
  // that further serialize->parse->serialize cycles are byte-stable.
  it("CSV: serialize -> parse -> serialize is stable", () => {
    const seed = csvToWorkspace(workspaceToCsv(wsWithProject()));
    const a = workspaceToCsv(seed);
    const b = workspaceToCsv(csvToWorkspace(a));
    expect(b).toBe(a);
    expect(csvToWorkspace(a).project).toEqual(wsWithProject().project);
  });

  it("MD: serialize -> parse -> serialize is stable", () => {
    const seed = markdownToWorkspace(workspaceToMarkdown(wsWithProject()));
    const a = workspaceToMarkdown(seed);
    const b = workspaceToMarkdown(markdownToWorkspace(a));
    expect(b).toBe(a);
    expect(markdownToWorkspace(a).project).toEqual(wsWithProject().project);
  });
});

describe("encodeProjectList / decodeProjectList unit", () => {
  it("round-trips values containing newlines, pipes, and backslashes", () => {
    const input = ["a\nb", "c|d", "e\\f"];
    expect(decodeProjectList(encodeProjectList(input))).toEqual(input);
  });

  it("encoded string contains no raw newline or carriage-return characters", () => {
    const input = ["line1\nline2", "cr\rhere", "both\r\nhere"];
    const encoded = encodeProjectList(input);
    expect(encoded).not.toMatch(/\n/);
    expect(encoded).not.toMatch(/\r/);
  });

  it("round-trips an empty array", () => {
    expect(decodeProjectList(encodeProjectList([]))).toEqual([]);
  });

  it("round-trips a single element with all special chars combined", () => {
    const input = ["back\\slash | pipe\nnewline\rcarriage"];
    expect(decodeProjectList(encodeProjectList(input))).toEqual(input);
  });
});
