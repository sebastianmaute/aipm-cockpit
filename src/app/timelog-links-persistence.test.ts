// src/app/timelog-links-persistence.test.ts
// Round-trip tests for Workspace.timelogLinks across all three text codecs
// (JSON, CSV, Markdown) plus byte-stability checks (links-less workspace must
// NOT emit # TIMELOG LINKS or ## Timelog Links).

import { describe, it, expect } from "vitest";
import { emptyWorkspace, workspaceToJson, jsonToWorkspace } from "./workspace";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import type { TimelogLinks } from "./timelog-types";

const SAMPLE_LINKS: TimelogLinks = {
  userLinks: [{ timelogUserId: 11, resourceId: 2, manual: true }],
  projectLinks: [{ timelogProjectId: 99, bucketId: 5, manual: false }],
};

function wsWithLinks() {
  return { ...emptyWorkspace(), timelogLinks: SAMPLE_LINKS };
}

// --- JSON round-trip ----------------------------------------------------------

describe("JSON codec — timelogLinks", () => {
  it("round-trips timelogLinks", () => {
    const ws = wsWithLinks();
    const restored = jsonToWorkspace(workspaceToJson(ws));
    expect(restored.timelogLinks).toEqual(SAMPLE_LINKS);
  });

  it("links-less workspace has no timelogLinks key in JSON output", () => {
    const json = workspaceToJson(emptyWorkspace());
    expect(json).not.toContain("timelogLinks");
  });
});

// --- CSV round-trip -----------------------------------------------------------

describe("CSV codec — timelogLinks", () => {
  it("round-trips timelogLinks", () => {
    const ws = wsWithLinks();
    const restored = csvToWorkspace(workspaceToCsv(ws));
    expect(restored.timelogLinks).toEqual(SAMPLE_LINKS);
  });

  it("links-less workspace emits no # TIMELOG LINKS section", () => {
    const csv = workspaceToCsv(emptyWorkspace());
    expect(csv).not.toContain("# TIMELOG LINKS");
  });
});

// --- Markdown round-trip ------------------------------------------------------

describe("Markdown codec — timelogLinks", () => {
  it("round-trips timelogLinks", () => {
    const ws = wsWithLinks();
    const restored = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(restored.timelogLinks).toEqual(SAMPLE_LINKS);
  });

  it("links-less workspace emits no ## Timelog Links section", () => {
    const md = workspaceToMarkdown(emptyWorkspace());
    expect(md).not.toContain("## Timelog Links");
  });
});
