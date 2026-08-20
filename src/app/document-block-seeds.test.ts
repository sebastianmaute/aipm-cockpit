import { describe, it, expect, beforeAll } from "vitest";
import { blockSeed, ADDABLE_BLOCK_TYPES } from "./document-block-seeds";
import { normalizeBlockForStorage } from "./document-model";
import { loadI18n } from "./i18n";

describe("blockSeed", () => {
  beforeAll(async () => { await loadI18n("de"); });

  it("offers all six block kinds", () => {
    expect([...ADDABLE_BLOCK_TYPES]).toEqual([
      "paragraph", "heading", "bullets", "table", "dataSection", "pageBreak",
    ]);
  });

  // ★★★ THE POINT OF THIS FILE. document-model.ts DROPS an empty heading, a
  //  paragraph with no visible text, a bullets list with no non-empty item and
  //  a table with no columns — so an empty seed renders now and is GONE on the
  //  next load. This asks the REAL loader rather than restating its rules.
  it.each([...ADDABLE_BLOCK_TYPES])("seeds a %s that survives a load", (type) => {
    expect(normalizeBlockForStorage(blockSeed("en-US", type))).not.toBeNull();
  });

  it.each([...ADDABLE_BLOCK_TYPES])("seeds a German %s that survives a load", (type) => {
    expect(normalizeBlockForStorage(blockSeed("de", type))).not.toBeNull();
  });

  // ★ Named, never EXPORT_SECTION_KEYS[0]: reordering that registry must not
  //  silently change what hand-insertion produces.
  it("seeds a dataSection with a named key", () => {
    expect(blockSeed("en-US", "dataSection")).toEqual({ type: "dataSection", key: "tasks" });
  });

  it("seeds a paragraph as HTML, not as escaped plain text", () => {
    const seed = blockSeed("en-US", "paragraph");
    expect(seed).toEqual({ type: "paragraph", html: "<p>New paragraph</p>" });
  });
});
