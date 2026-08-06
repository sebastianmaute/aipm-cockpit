// ★★★ THIS FILE'S IMPORT ORDER IS THE TEST. Do not reorder or "tidy" it.
//
// `sanitizeProjectDocuments` reads EXPORT_SECTION_KEYS to ground a dataSection
// block's key against the real registry. That read used to happen at MODULE-EVAL
// (`const SECTION_KEYS = new Set(EXPORT_SECTION_KEYS)`), and there is a runtime
// import cycle around it:
//
//   settings-types.ts imports `defaultStorageConfig` — a VALUE — from ./workspace
//   workspace.ts      imports ./document-model
//   document-model.ts imports EXPORT_SECTION_KEYS back from ./settings-types
//
// Entered through ./storage, document-model evaluates while settings-types is
// still mid-evaluation, so the binding is not initialized yet and the snapshot
// captured nothing — every dataSection block was then silently dropped for the
// life of the process. Entered DIRECTLY (as document-model.test.ts does),
// settings-types finishes first and the snapshot is correct.
//
// ★★★ That asymmetry is why this needs its own file: an assertion written in
// document-model.test.ts CANNOT FAIL, because that file imports the model
// directly — the one path where the bug does not reproduce. That is exactly how
// this shipped past 28 green tests. The bare `import "./storage"` below
// establishes the cycle the way production does, and MUST come first.
import "./storage";

import { describe, it, expect } from "vitest";
import { sanitizeProjectDocuments } from "./document-model";
import { EXPORT_SECTION_KEYS } from "./settings-types";

const BASE = {
  id: 1,
  title: "Doc",
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

describe("sanitizeProjectDocuments — under the storage import cycle", () => {
  it("CONTROL: the section registry is populated on this import path", () => {
    // If this fails, the test below proves nothing about the sanitizer — the
    // registry itself never loaded and every key would fail for a second reason.
    expect(EXPORT_SECTION_KEYS.length).toBeGreaterThan(0);
    expect(EXPORT_SECTION_KEYS).toContain("tasks");
  });

  it("KEEPS a dataSection block (this is the regression)", () => {
    const out = sanitizeProjectDocuments([
      { ...BASE, blocks: [{ type: "dataSection", key: "tasks" }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].blocks).toEqual([{ type: "dataSection", key: "tasks" }]);
  });

  it("keeps a dataSection for EVERY key in the registry", () => {
    // ★ Guards the partial-failure shape too: a fix that resolved only the first
    // key, or that matched on a stale hardcoded subset, passes the test above.
    const blocks = EXPORT_SECTION_KEYS.map((key) => ({ type: "dataSection", key }));
    const out = sanitizeProjectDocuments([{ ...BASE, blocks }]);
    expect(out[0].blocks).toHaveLength(EXPORT_SECTION_KEYS.length);
  });

  it("still REJECTS an unknown section key on this path", () => {
    // ★★ The other half, and the one a careless fix breaks: making dataSection
    // survive by deleting the registry check would pass every test above while
    // letting a hallucinated key reach buildExportSections. Grounding must stay.
    const out = sanitizeProjectDocuments([
      { ...BASE, blocks: [{ type: "dataSection", key: "not-a-real-section" }] },
    ]);
    // The only block was invalid, so it is dropped — leaving a blockless doc.
    expect(out[0].blocks).toEqual([]);
  });

  it("does not disturb the other block types", () => {
    const out = sanitizeProjectDocuments([
      {
        ...BASE,
        blocks: [
          { type: "heading", level: 2, text: "H" },
          { type: "dataSection", key: "raid" },
          { type: "pageBreak" },
        ],
      },
    ]);
    expect(out[0].blocks).toEqual([
      { type: "heading", level: 2, text: "H" },
      { type: "dataSection", key: "raid" },
      { type: "pageBreak" },
    ]);
  });
});
