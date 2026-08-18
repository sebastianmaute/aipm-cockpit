import { describe, it, expect } from "vitest";
import {
  shouldCoalesce,
  COALESCE_WINDOW_MS,
  paragraphHasImage,
  blockChanged,
  replaceBlockOp,
} from "./document-editor-commit";
import type { DocVersion } from "./document-versions";
import type { DocBlock } from "./document-model";

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

  it("breaks a savedAt tie by the HIGHER id, not array order", () => {
    const shared = "2026-08-18T10:00:00.000Z";
    const higherId = version({ id: 2, documentId: 99, source: "ai", op: "rename", savedAt: shared });
    const lowerId = version({ id: 1, documentId: 7, source: "user", op: "update", savedAt: shared });
    // higherId is listed FIRST on purpose: "return the last array element" and
    // "return the higher id" must disagree here, or the fixture can't tell them
    // apart. Last-element would read lowerId (documentId 7, user/update — would
    // coalesce); the correct tie-break reads higherId (documentId 99 — does not).
    expect(shouldCoalesce([higherId, lowerId], 7, NOW)).toBe(false);
  });

  it("coalesces exactly at the window boundary (inclusive)", () => {
    const savedAt = "2026-08-18T10:00:00.000Z";
    const atBoundary = new Date(Date.parse(savedAt) + COALESCE_WINDOW_MS).toISOString();
    expect(shouldCoalesce([version({ savedAt })], 7, atBoundary)).toBe(true);
  });

  it("does not coalesce one millisecond past the window boundary", () => {
    const savedAt = "2026-08-18T10:00:00.000Z";
    const pastBoundary = new Date(Date.parse(savedAt) + COALESCE_WINDOW_MS + 1).toISOString();
    expect(shouldCoalesce([version({ savedAt })], 7, pastBoundary)).toBe(false);
  });

  it("exposes the window as a named constant", () => {
    expect(COALESCE_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe("paragraphHasImage", () => {
  it("detects an image element in stored paragraph HTML", () => {
    expect(paragraphHasImage('<p>a</p><img src="x.png">')).toBe(true);
    expect(paragraphHasImage('<p>a <img src="x.png"> b</p>')).toBe(true);
  });

  it("is false for HTML with no image", () => {
    expect(paragraphHasImage("<p>a</p>")).toBe(false);
    expect(paragraphHasImage("")).toBe(false);
  });

  it("does not match a word that merely starts with img", () => {
    // The tag boundary matters: "imgur" is not an <img>.
    expect(paragraphHasImage("<p>see imgur.com</p>")).toBe(false);
    expect(paragraphHasImage('<p><a href="https://imgur.com">x</a></p>')).toBe(false);
  });

  it("disagrees with a naive includes('<img') check on a longer tag name", () => {
    // "<imgcaption>" contains the literal substring "<img", so a naive
    // `.includes("<img")` would wrongly say yes. The real predicate requires
    // a tag BOUNDARY right after "img" (whitespace, "/" or ">") and correctly
    // says no — this fixture is where the two implementations disagree.
    const html = "<p>a <imgcaption> b</p>";
    expect(html.includes("<img")).toBe(true);
    expect(paragraphHasImage(html)).toBe(false);
  });

  it("does not match escaped text that only looks like a tag", () => {
    // Stored HTML is already sanitized, so this is literal text, not an element.
    expect(paragraphHasImage("<p>&lt;img&gt;</p>")).toBe(false);
  });

  it("matches a self-closing image tag", () => {
    expect(paragraphHasImage('<p>a</p><img src="x.png"/>')).toBe(true);
  });
});

describe("blockChanged", () => {
  it("is false for a block that was focused and left untouched", () => {
    const a: DocBlock = { type: "paragraph", html: "<p>x</p>" };
    expect(blockChanged(a, { type: "paragraph", html: "<p>x</p>" })).toBe(false);
  });

  it("is true when content differs", () => {
    const a: DocBlock = { type: "paragraph", html: "<p>x</p>" };
    expect(blockChanged(a, { type: "paragraph", html: "<p>y</p>" })).toBe(true);
  });

  it("compares nested content, not identity", () => {
    const a: DocBlock = { type: "bullets", items: ["one", "two"] };
    expect(blockChanged(a, { type: "bullets", items: ["one", "two"] })).toBe(false);
    expect(blockChanged(a, { type: "bullets", items: ["one", "three"] })).toBe(true);
  });

  it("treats an absent optional field and an omitted one as equal", () => {
    const a: DocBlock = { type: "bullets", items: ["one"] };
    expect(blockChanged(a, { type: "bullets", items: ["one"], ordered: undefined })).toBe(false);
  });

  it("catches a difference nested deep inside a table's rows", () => {
    const a: DocBlock = {
      type: "table",
      columns: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    };
    const sameShapeDifferentCell: DocBlock = {
      type: "table",
      columns: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "5"],
      ],
    };
    expect(blockChanged(a, { ...a, rows: a.rows.map((r) => [...r]) })).toBe(false);
    expect(blockChanged(a, sameShapeDifferentCell)).toBe(true);
  });
});

describe("replaceBlockOp", () => {
  it("builds a replace op at the given index", () => {
    const block: DocBlock = { type: "heading", level: 2, text: "H" };
    expect(replaceBlockOp(3, block)).toEqual({ op: "replace", index: 3, block });
  });
});
