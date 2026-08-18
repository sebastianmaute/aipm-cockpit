import { describe, it, expect } from "vitest";
import { shouldCoalesce, COALESCE_WINDOW_MS } from "./document-editor-commit";
import type { DocVersion } from "./document-versions";

const version = (over: Partial<DocVersion> = {}): DocVersion => ({
  id: 1,
  documentId: 7,
  title: "D",
  blocks: [],
  savedAt: "2026-08-18T10:00:00.000Z",
  source: "user",
  op: "update",
  ...over,
});

const NOW = "2026-08-18T10:00:30.000Z"; // 30s after the fixture's savedAt

describe("shouldCoalesce", () => {
  it("is false when the document has no versions — the first edit of a session always records", () => {
    expect(shouldCoalesce([], 7, NOW)).toBe(false);
  });

  it("is true when the newest version is a recent user update on the same document", () => {
    expect(shouldCoalesce([version()], 7, NOW)).toBe(true);
  });

  it("is false when the newest version belongs to a DIFFERENT document", () => {
    expect(shouldCoalesce([version({ documentId: 99 })], 7, NOW)).toBe(false);
  });

  // The three run-breaking cases. Each records a different actor's change, so
  // it is never the current session's start state.
  it("is false when the newest version is an AI write", () => {
    expect(shouldCoalesce([version({ source: "ai" })], 7, NOW)).toBe(false);
  });

  it("is false when the newest version is not an update", () => {
    for (const op of ["rename", "delete", "duplicate", "restored"] as const) {
      expect(shouldCoalesce([version({ op })], 7, NOW)).toBe(false);
    }
  });

  it("is false when the newest version is outside the window", () => {
    const stale = version({ savedAt: "2026-08-18T09:00:00.000Z" });
    expect(shouldCoalesce([stale], 7, NOW)).toBe(false);
  });

  it("reads the NEWEST version, not the last array element", () => {
    // A caller must not have to pre-sort. Newest here is the AI write, which
    // breaks the run — if this read the last element it would return true.
    const older = version({ id: 1, savedAt: "2026-08-18T10:00:20.000Z", source: "user" });
    const newer = version({ id: 2, savedAt: "2026-08-18T10:00:25.000Z", source: "ai" });
    expect(shouldCoalesce([newer, older], 7, NOW)).toBe(false);
  });

  it("is false on an unparseable savedAt rather than coalescing blindly", () => {
    expect(shouldCoalesce([version({ savedAt: "not a date" })], 7, NOW)).toBe(false);
  });

  it("exposes the window as a named constant", () => {
    expect(COALESCE_WINDOW_MS).toBeGreaterThan(0);
  });
});
