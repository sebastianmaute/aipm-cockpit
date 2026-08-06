import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_VERSIONS_PER_DOC,
  MAX_TOTAL_VERSIONS,
  sanitizeDocumentVersions,
  trimVersions,
  deletedDocumentVersions,
  type DocVersion,
} from "./document-versions";
import type { ProjectDocument } from "./document-model";

const v = (over: Partial<DocVersion> = {}): DocVersion => ({
  id: 1,
  documentId: 1,
  title: "Status report",
  blocks: [{ type: "heading", level: 1, text: "Week 12" }],
  savedAt: "2026-08-01T09:00:00.000Z",
  source: "ai",
  op: "update",
  ...over,
});

const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument => ({
  id: 1,
  title: "Status report",
  blocks: [],
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  ...over,
});

describe("sanitizeDocumentVersions", () => {
  it("keeps a well-formed version", () => {
    expect(sanitizeDocumentVersions([v()])).toEqual([v()]);
  });

  it("drops a version with an unusable documentId", () => {
    expect(sanitizeDocumentVersions([v({ documentId: 0 })])).toEqual([]);
    expect(sanitizeDocumentVersions([v({ documentId: "3" as unknown as number })])).toEqual([]);
  });

  it("drops unknown block types rather than passing them through", () => {
    const dirty = v({ blocks: [{ type: "video", src: "x" }] as unknown as DocVersion["blocks"] });
    expect(sanitizeDocumentVersions([dirty])[0].blocks).toEqual([]);
  });

  it("falls back to a known source and op", () => {
    const [out] = sanitizeDocumentVersions([
      v({ source: "robot" as unknown as DocVersion["source"], op: "explode" as unknown as DocVersion["op"] }),
    ]);
    expect(out.source).toBe("user");
    expect(out.op).toBe("update");
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeDocumentVersions(null)).toEqual([]);
    expect(sanitizeDocumentVersions({ 0: v() })).toEqual([]);
  });

  it("skips a non-object entry inside an otherwise-valid array", () => {
    expect(sanitizeDocumentVersions([null, undefined, 5, v()])).toEqual([v()]);
  });

  it("drops a version with a blank savedAt", () => {
    expect(sanitizeDocumentVersions([v({ savedAt: "" })])).toEqual([]);
  });

  it("drops a version whose title is blank after trimming", () => {
    expect(sanitizeDocumentVersions([v({ title: "   " })])).toEqual([]);
  });
});

describe("trimVersions", () => {
  it("keeps the newest MAX_VERSIONS_PER_DOC for a live document", () => {
    const many = Array.from({ length: MAX_VERSIONS_PER_DOC + 5 }, (_, i) =>
      v({ id: i + 1, savedAt: `2026-08-01T09:${String(i).padStart(2, "0")}:00.000Z` }),
    );
    const kept = trimVersions(many, [1]);
    expect(kept).toHaveLength(MAX_VERSIONS_PER_DOC);
    expect(kept[0].id).toBe(6); // the five oldest went
  });

  it("breaks an exact savedAt tie by id, higher id sorting as newer", () => {
    // Two entries share a savedAt; everything else is strictly newer than
    // that timestamp, so the tied pair are the two globally-oldest entries
    // and exactly one — the loser of the tie-break — is the one cut.
    const tiedOld = v({ id: 1, savedAt: "2026-08-01T09:00:00.000Z" });
    const tiedAlsoOld = v({ id: 2, savedAt: "2026-08-01T09:00:00.000Z" });
    const rest = Array.from({ length: MAX_VERSIONS_PER_DOC - 1 }, (_, i) =>
      v({ id: i + 3, savedAt: `2026-08-01T09:${String(i + 1).padStart(2, "0")}:00.000Z` }),
    );
    const kept = trimVersions([tiedOld, tiedAlsoOld, ...rest], [1]);
    expect(kept).toHaveLength(MAX_VERSIONS_PER_DOC);
    expect(kept.some((k) => k.id === 1)).toBe(false); // lower id: tie-break loser, dropped
    expect(kept.some((k) => k.id === 2)).toBe(true); // higher id: tie-break winner, kept
  });

  // ★ The whole delete-restore feature rests on this one.
  it("never trims the newest version of a document that no longer exists", () => {
    // ★★★ The GLOBAL cap must be the binding constraint, or this test is
    // VACUOUS — a single-live-document fixture never gets there, because the
    // PER-DOC cap (20) always fires first and the global cap (500) is never
    // reached. Mutation-tested: deleting the tombstone-protection branch in
    // trimVersions left an earlier version of this test green (17/18 still
    // passed). So: 30 live documents × MAX_VERSIONS_PER_DOC versions each =
    // 600, comfortably over MAX_TOTAL_VERSIONS (500) even after every
    // document's own per-doc cap is applied — and every one of those 600 is
    // dated AFTER the tombstone, so the tombstone is unconditionally the
    // globally-oldest entry and is the first thing an unprotected global cut
    // would drop.
    const tombstone = v({ id: 1, documentId: 999, savedAt: "2000-01-01T00:00:00.000Z", op: "delete" });
    const liveDocCount = 30;
    const liveIds = Array.from({ length: liveDocCount }, (_, i) => i + 1);
    const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
    const liveVersions = liveIds.flatMap((documentId) =>
      Array.from({ length: MAX_VERSIONS_PER_DOC }, (_, i) => {
        const minute = documentId * MAX_VERSIONS_PER_DOC + i;
        return v({
          id: 1000 + minute,
          documentId,
          savedAt: new Date(baseMs + minute * 60_000).toISOString(),
        });
      }),
    );
    // Sanity on the fixture itself, not the function under test.
    expect(liveVersions).toHaveLength(600);
    expect(liveVersions.length).toBeGreaterThan(MAX_TOTAL_VERSIONS);

    const kept = trimVersions([tombstone, ...liveVersions], liveIds);

    // The tombstone survives regardless of the global cap...
    expect(kept.some((k) => k.id === tombstone.id)).toBe(true);
    // ...and the cap actually engaged: exactly MAX_TOTAL_VERSIONS live
    // versions survive alongside it (100 of the 600 were dropped). Without
    // tombstone protection the tombstone itself — being globally oldest —
    // is what gets cut, and this length would read MAX_TOTAL_VERSIONS (500)
    // with the tombstone missing, not present at 501.
    expect(kept).toHaveLength(MAX_TOTAL_VERSIONS + 1);
  });

  it("keeps only the newest tombstone per deleted document", () => {
    const older = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z" });
    const newer = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "delete" });
    const kept = trimVersions([older, newer], []);
    expect(kept.map((k) => k.id)).toEqual([2]);
  });

  it("returns the same reference when nothing needs trimming", () => {
    const list = [v()];
    expect(trimVersions(list, [1])).toBe(list);
  });
});

describe("deletedDocumentVersions", () => {
  it("returns the newest version of a document absent from the live list", () => {
    const older = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z" });
    const newer = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "delete" });
    const out = deletedDocumentVersions([older, newer], []);
    expect(out.map((d) => d.id)).toEqual([2]);
  });

  it("excludes versions of a document that is still live", () => {
    const version = v({ documentId: 1 });
    expect(deletedDocumentVersions([version], [doc({ id: 1 })])).toEqual([]);
  });

  it("returns one tombstone per deleted document, newest first", () => {
    const a = v({ id: 1, documentId: 10, savedAt: "2026-03-01T00:00:00.000Z" });
    const b = v({ id: 2, documentId: 20, savedAt: "2026-01-01T00:00:00.000Z" });
    const out = deletedDocumentVersions([a, b], []);
    expect(out.map((d) => d.id)).toEqual([1, 2]);
  });

  it("returns [] when there are no versions at all", () => {
    expect(deletedDocumentVersions([], [doc({ id: 1 })])).toEqual([]);
  });

  it("does not let an older version displace an already-found newer one", () => {
    const newer = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z" });
    const older = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z" });
    // Deliberately processed newer-first so the update branch is exercised
    // with an already-set `current` that must NOT be replaced.
    const out = deletedDocumentVersions([newer, older], []);
    expect(out.map((d) => d.id)).toEqual([2]);
  });
});

describe("DOM-free contract", () => {
  it("never calls DOMPurify", () => {
    // ★ cwd-relative, NOT `new URL(..., import.meta.url)` — under vitest
    // `import.meta.url` is not a file: URL, so readFileSync throws
    // "The URL must be of scheme file". Mirrors document-model.test.ts.
    const src = readFileSync("src/app/document-versions.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
  });
});
