// src/app/timelog-links-persistence.test.ts
// Round-trip tests for Workspace.timelogLinks across all three text codecs
// (JSON, CSV, Markdown) plus byte-stability checks (links-less workspace must
// NOT emit # TIMELOG LINKS or ## Timelog Links).

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// --- Autosave wiring -----------------------------------------------------------
// Regression guard: codecs round-trip timelogLinks correctly, but the fetched
// customer/project scope only reaches the codecs if use-storage-backend.ts
// actually threads timelogLinks into every backend.save(...)/currentWorkspace()
// literal AND the autosave effect's dependency array. Miss one and a Timelog
// fetch updates memory (ws.setTimelogLinks) but is silently never written to
// disk — on reload the picker comes back blank. Source-scan guard, mirroring
// the proven `insights-autosave.test.ts` pattern (same landmine class), rather
// than a full render+fetch+reload integration test.
describe("use-storage-backend autosave wiring — timelogLinks", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src/app/use-storage-backend.ts"),
    "utf8",
  );

  // Every workspace tuple that persists knowledgeItems must also persist
  // timelogLinks — covers the three save literals, the outgoing snapshot, the
  // currentWorkspace() return, and (critically) the autosave-effect deps array.
  const tupleLines = SRC.split(/\r?\n/).filter(
    (line) => line.includes("knowledgeItems") && line.includes("settingsOverrides"),
  );

  it("has the shared workspace tuple in more than one place (sanity)", () => {
    // Guards against the scan silently matching nothing (e.g. after a rename)
    // and passing vacuously. There are 4 save/return literals + 1 deps array.
    expect(tupleLines.length).toBeGreaterThanOrEqual(5);
  });

  it("carries `timelogLinks` in every knowledgeItems/settingsOverrides tuple (incl. the deps array)", () => {
    const missing = tupleLines.filter((line) => !line.includes("timelogLinks"));
    expect(
      missing,
      `timelogLinks missing from ${missing.length} workspace tuple(s) — a save literal or the autosave DEPS array dropped it (silent data-loss on reload):\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("applyWorkspace restores timelogLinks on load", () => {
    expect(SRC).toMatch(/setTimelogLinks\(workspace\.timelogLinks\)/);
  });
});
