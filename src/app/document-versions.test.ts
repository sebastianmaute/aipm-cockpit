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
import {
  MAX_BLOCKS_PER_DOC,
  type DocTruncationDiag,
  type ProjectDocument,
} from "./document-model";

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

  it("drops a version whose savedAt does not parse as a real timestamp", () => {
    expect(sanitizeDocumentVersions([v({ savedAt: "not-a-date-at-all" })])).toEqual([]);
  });

  it("drops a later duplicate id, keeping the first occurrence", () => {
    const first = v({ id: 1, documentId: 1, title: "First" });
    const second = v({ id: 1, documentId: 2, title: "Second", savedAt: "2026-08-02T09:00:00.000Z" });
    const out = sanitizeDocumentVersions([first, second]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("First");
    expect(out[0].documentId).toBe(1);
  });

  it("counts blocks the per-version cap dropped into an optional diag", () => {
    const blocks = Array.from({ length: MAX_BLOCKS_PER_DOC + 25 }, () => ({
      type: "paragraph" as const,
      html: "<p>x</p>",
    }));
    const diag: DocTruncationDiag = {};
    const out = sanitizeDocumentVersions([v({ blocks })], diag);
    expect(out[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(diag.truncatedBlocks).toBe(25);
  });

  it("leaves truncatedBlocks undefined for an under-cap version", () => {
    const diag: DocTruncationDiag = {};
    sanitizeDocumentVersions([v()], diag);
    expect(diag.truncatedBlocks).toBeUndefined();
  });

  // ★★★ THE COUNT IS MEASURED AGAINST THE CAP, NOT AGAINST THE SURVIVING
  // LENGTH. The difference-of-lengths form also counted every block the
  // validator dropped as INVALID, and because any non-zero count raises the
  // sticky §103 save guard, ONE unloadable block anywhere in version history
  // paused ALL saving for the whole workspace until the user clicked through
  // the banner. Refusing to save cannot recover such a block — every future
  // load drops it too — so it must not arm the guard.
  it("does not count blocks the validator dropped as invalid", () => {
    const diag: DocTruncationDiag = {};
    const out = sanitizeDocumentVersions(
      [
        v({
          blocks: [
            { type: "heading", level: 1, text: "Kept" },
            // Reachable without a hostile file: the load-boundary allow-list
            // (document-rich-fields.ts) runs AFTER the structural pass, so a
            // paragraph it empties is persisted as `html: ""` and dropped by the
            // load after that.
            { type: "paragraph", html: "" },
            { type: "dataSection", key: "notARegisteredSectionKey" },
          ] as unknown as DocVersion["blocks"],
        }),
      ],
      diag,
    );
    // Control: the two really were dropped, so the assertion below is not
    // satisfied by a version that failed validation as a whole.
    expect(out[0].blocks).toHaveLength(1);
    expect(diag.truncatedBlocks).toBeUndefined();
  });

  it("counts cap overflow even when invalid blocks sit alongside it", () => {
    // ★ The two causes must not cancel or compound: 3 entries past the cap plus
    // 2 unloadable ones is still 3. A difference-of-lengths count reports 5.
    const blocks = [
      ...Array.from({ length: MAX_BLOCKS_PER_DOC + 3 }, () => ({ type: "paragraph" as const, html: "<p>x</p>" })),
    ];
    blocks[0] = { type: "paragraph", html: "" };
    blocks[1] = { type: "paragraph", html: "" };
    const diag: DocTruncationDiag = {};
    const out = sanitizeDocumentVersions([v({ blocks })], diag);
    expect(out[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC - 2);
    expect(diag.truncatedBlocks).toBe(3);
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

  // ★★ DEDUP, closing an asymmetry with sanitizeDocumentVersions, which already
  // drops a repeated id. Unreachable through the engine (ids are minted
  // monotonically and every load path sanitizes), so this is a corrupted-input
  // property: trim must be idempotent over an array its sibling would have
  // cleaned. First occurrence wins, same rule as the sibling.
  it("drops a duplicate id rather than keeping both copies", () => {
    const first = v({ id: 1, title: "First" });
    const clone = v({ id: 1, title: "Second" });
    const out = trimVersions([first, clone], [1]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("First");
  });

  it("is IDEMPOTENT over an array carrying a duplicate", () => {
    // ★ The property the dedup buys: trimming twice must equal trimming once.
    const dup = [v({ id: 1 }), v({ id: 1 })];
    const once = trimVersions(dup, [1]);
    expect(trimVersions(once, [1])).toBe(once); // second pass is a no-op, by reference
  });

  it("still returns the SAME REFERENCE when every id is unique", () => {
    // ★★★ THE CONTROL THAT MATTERS MOST HERE. The dedup must be free on
    // well-formed input: Turso's dirty-table detection is reference equality, so
    // a rebuilt-but-equal array marks the table dirty and costs a full DELETE +
    // re-INSERT for a write that changed nothing.
    const clean = [v({ id: 1 }), v({ id: 2 }), v({ id: 3 })];
    expect(trimVersions(clean, [1])).toBe(clean);
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
    // ★★ `op: "delete"` is LOAD-BEARING in this fixture, not decoration: the
    // derivation now reports only genuine tombstones, so the default
    // `op: "update"` would make this return [] and the test would be asserting
    // against the wrong thing.
    const a = v({ id: 1, documentId: 10, savedAt: "2026-03-01T00:00:00.000Z", op: "delete" });
    const b = v({ id: 2, documentId: 20, savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
    const out = deletedDocumentVersions([a, b], []);
    expect(out.map((d) => d.id)).toEqual([1, 2]);
  });

  it("returns [] when there are no versions at all", () => {
    expect(deletedDocumentVersions([], [doc({ id: 1 })])).toEqual([]);
  });

  it("does not let an older version displace an already-found newer one", () => {
    const newer = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "delete" });
    const older = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
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

describe("restored marker", () => {
  it("hides an id from the deleted list once its newest version is a restored marker", () => {
    const tombstone = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
    const marker = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "restored" });
    expect(deletedDocumentVersions([tombstone], []).map((k) => k.documentId)).toEqual([99]);
    expect(deletedDocumentVersions([tombstone, marker], [])).toEqual([]);
  });

  // The marker records a moment, it does not permanently exempt an id.
  it("reports the id again when it is deleted a second time after restoring", () => {
    const tombstone = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
    const marker = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "restored" });
    const reDeleted = v({ id: 3, documentId: 99, savedAt: "2026-03-01T00:00:00.000Z", op: "delete" });
    expect(deletedDocumentVersions([tombstone, marker, reDeleted], []).map((k) => k.id)).toEqual([3]);
  });

  // ★ The leak fix. A tombstone is exempt from BOTH caps; a restored group
  // must NOT be, or every delete-restore cycle strands an unreclaimable row.
  it("releases a restored group from tombstone protection so it can be trimmed", () => {
    const marker = v({ id: 1, documentId: 99, savedAt: "2020-01-01T00:00:00.000Z", op: "restored" });
    const noise = Array.from({ length: MAX_TOTAL_VERSIONS }, (_, i) =>
      v({
        id: i + 2,
        documentId: 1 + Math.floor(i / MAX_VERSIONS_PER_DOC),
        savedAt: `2026-08-01T10:${String(i % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
      }),
    );
    const liveIds = [...new Set(noise.map((n) => n.documentId))];
    const kept = trimVersions([marker, ...noise], liveIds);
    // The marker is the globally oldest entry and is no longer protected, so
    // the global cap drops it. A `delete` in its place would survive.
    expect(kept.some((k) => k.id === 1)).toBe(false);
    expect(kept).toHaveLength(MAX_TOTAL_VERSIONS);
  });

  it("sanitizes restored through as a real op rather than falling back to update", () => {
    expect(sanitizeDocumentVersions([v({ op: "restored" })])[0].op).toBe("restored");
  });
});

describe("savedAt must be CANONICAL ISO, not merely parseable", () => {
  // ★★★ THE GAP A `Date.parse` CHECK LEFT OPEN, and the comment that claimed
  // otherwise was the dangerous half. Every consumer compares `savedAt` as a
  // RAW STRING, so the property they need is "lexicographic order equals
  // chronological order" — which only the canonical form has. Measured against
  // the old check: `"12/25/2026"` passed, was stored verbatim, and sorted as
  // the OLDEST entry, so `deletedDocumentVersions` named the wrong version as
  // the tombstone and `trimVersions` DROPPED the genuinely newest one.
  it("drops a US-format date that Date.parse happily accepts", () => {
    expect(Number.isFinite(Date.parse("12/25/2026"))).toBe(true); // the old check passed it
    expect(sanitizeDocumentVersions([v({ savedAt: "12/25/2026" })])).toEqual([]);
  });

  it.each([
    "2026-08-01T09:00:00Z", // no milliseconds
    "2026-08-01T09:00:00.000+02:00", // offset rather than Z
    "2026-08-01", // date only
    "2026-08-01 09:00:00", // space instead of T
  ])("drops the non-canonical form %s", (savedAt) => {
    expect(sanitizeDocumentVersions([v({ savedAt })])).toEqual([]);
  });

  it("keeps the canonical form every in-app write produces", () => {
    // ★★ THE CONTROL, and it is the one that matters most here: this check is
    // strict enough to be dangerous, so a regression that dropped EVERYTHING
    // would satisfy every case above while silently destroying all history.
    // `new Date().toISOString()` is what applyDocMutation writes.
    const savedAt = new Date().toISOString();
    const [out] = sanitizeDocumentVersions([v({ savedAt })]);
    expect(out?.savedAt).toBe(savedAt);
  });

  it("still keeps the fixture's own canonical timestamp", () => {
    expect(sanitizeDocumentVersions([v()])).toEqual([v()]);
  });

  // ★ The ordering this protects, asserted end to end rather than by proxy.
  it("leaves the surviving tombstone as the genuinely newest version", () => {
    const older = v({ id: 1, documentId: 7, title: "Older", savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
    const newest = v({ id: 2, documentId: 7, title: "Newest", savedAt: "2026-12-25T00:00:00.000Z", op: "delete" });
    const loaded = sanitizeDocumentVersions([older, newest]);
    expect(trimVersions(loaded, []).map((k) => k.title)).toEqual(["Newest"]);
  });
});

describe("deletedDocumentVersions reports DELETIONS, not merely absences", () => {
  // ★★★ THE CAP ASYMMETRY THIS CLOSES. `sanitizeProjectDocuments` breaks at
  // MAX_DOCUMENTS; `sanitizeDocumentVersions` has no count cap and structurally
  // cannot acquire one, because it delegates ONE version at a time. So a
  // 205-document file loads as 200 documents and 205 versions on every write
  // path, and the five orphans used to be reported as DELETED — each with a
  // Restore button that would mint a duplicate of a document still in the file.
  it("ignores an orphan whose newest version is an ordinary edit", () => {
    const orphan = v({ id: 1, documentId: 900, title: "Truncated away", op: "update" });
    expect(deletedDocumentVersions([orphan], [])).toEqual([]);
  });

  it.each(["update", "rename", "duplicate"] as const)(
    "ignores an orphan whose newest op is %s",
    (op) => {
      expect(deletedDocumentVersions([v({ id: 1, documentId: 900, op })], [])).toEqual([]);
    },
  );

  it("still reports a genuine tombstone alongside the orphans", () => {
    // ★★ THE CONTROL, and the fixture is doing the work: mixing a real delete
    // with three artifacts is what separates "requires op delete" from "returns
    // nothing at all", which would satisfy every exclusion case above while
    // removing the feature.
    const real = v({ id: 1, documentId: 900, title: "Really deleted", savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
    const artifacts = [
      v({ id: 2, documentId: 901, title: "Artifact A", savedAt: "2026-01-02T00:00:00.000Z", op: "update" }),
      v({ id: 3, documentId: 902, title: "Artifact B", savedAt: "2026-01-03T00:00:00.000Z", op: "rename" }),
      v({ id: 4, documentId: 903, title: "Artifact C", savedAt: "2026-01-04T00:00:00.000Z", op: "duplicate" }),
    ];
    const out = deletedDocumentVersions([real, ...artifacts], []);
    expect(out.map((k) => k.title)).toEqual(["Really deleted"]);
  });

  // ★★★ THE TWO FUNCTIONS MUST AGREE, and they had already drifted. Once the
  // derivation started requiring `op === "delete"`, retention still asked the
  // OLD question, so a truncation artifact was HIDDEN by one and PROTECTED
  // FOREVER by the other — measured at 50 of 50 artifacts surviving a run
  // already 50 rows past MAX_TOTAL_VERSIONS, because tombstones never enter
  // `keepable` and the global cap therefore does not bound them. Rows no
  // surface could reach and no mechanism could reclaim.
  it("does not PROTECT an artifact that it also refuses to LIST", () => {
    const artifact = v({ id: 2, documentId: 900, title: "Truncated away", op: "update" });
    expect(deletedDocumentVersions([artifact], [])).toEqual([]);
    // Retention must reach the same verdict: not a tombstone, so ordinary
    // retention applies and it is not pinned by the protection branch.
    const noise = Array.from({ length: MAX_TOTAL_VERSIONS }, (_, i) =>
      v({
        id: 1000 + i,
        documentId: 1 + Math.floor(i / MAX_VERSIONS_PER_DOC),
        savedAt: new Date(Date.parse("2026-06-01T00:00:00.000Z") + i * 60_000).toISOString(),
      }),
    );
    const liveIds = [...new Set(noise.map((n) => n.documentId))];
    // The artifact is the globally OLDEST entry, so an unprotected group loses
    // it to the global cap and a protected one keeps it past the cap.
    const kept = trimVersions([{ ...artifact, savedAt: "2020-01-01T00:00:00.000Z" }, ...noise], liveIds);
    expect(kept.some((k) => k.id === 2)).toBe(false);
    expect(kept).toHaveLength(MAX_TOTAL_VERSIONS);
  });

  it("STILL protects a real tombstone past both caps", () => {
    // ★★★ THE CONTROL, and without it "artifact dropped" and "everything
    // dropped" are indistinguishable — dropping real tombstones would make
    // deleted documents unrecoverable while satisfying the case above.
    const tombstone = v({ id: 2, documentId: 900, title: "Really deleted", savedAt: "2020-01-01T00:00:00.000Z", op: "delete" });
    const noise = Array.from({ length: MAX_TOTAL_VERSIONS }, (_, i) =>
      v({
        id: 1000 + i,
        documentId: 1 + Math.floor(i / MAX_VERSIONS_PER_DOC),
        savedAt: new Date(Date.parse("2026-06-01T00:00:00.000Z") + i * 60_000).toISOString(),
      }),
    );
    const liveIds = [...new Set(noise.map((n) => n.documentId))];
    const kept = trimVersions([tombstone, ...noise], liveIds);
    expect(kept.some((k) => k.id === 2)).toBe(true);
    expect(kept).toHaveLength(MAX_TOTAL_VERSIONS + 1);
    // And the derivation agrees it is a deletion.
    expect(deletedDocumentVersions([tombstone], liveIds.map((id) => doc({ id }))).map((k) => k.id)).toEqual([2]);
  });

  it("does not treat a LIVE document as deleted, even if its newest version is a delete", () => {
    // ★★★ THE OTHER HALF OF THE PREDICATE, and it needed its own case: dropping
    // the `!live.has(...)` check left every other test in this file GREEN
    // (mutation-measured). "Tombstone" means not-live AND deleted, and only a
    // fixture holding a live document whose newest version is a `delete` can
    // tell the two halves apart.
    //
    // ★★ Unreachable through the engine — a delete removes the document, and
    // ids are never reused, so a live id cannot inherit a deleted group. Same
    // class as the dedup above: a corrupted-state property, worth pinning
    // because the failure is silent HISTORY LOSS. Treated as a tombstone, this
    // group would be hard-trimmed to its single newest entry and every earlier
    // version of a document the user still has would be discarded.
    const older = v({ id: 1, documentId: 1, savedAt: "2026-01-01T00:00:00.000Z", op: "update" });
    const strayDelete = v({ id: 2, documentId: 1, savedAt: "2026-02-01T00:00:00.000Z", op: "delete" });
    const kept = trimVersions([older, strayDelete], [1]);
    expect(kept.map((k) => k.id)).toEqual([1, 2]); // ordinary retention, nothing discarded
    // And the derivation agrees the document is not deleted.
    expect(deletedDocumentVersions([older, strayDelete], [doc({ id: 1 })])).toEqual([]);
  });

  it("reads only the NEWEST entry, so an older delete under a later edit is not a tombstone", () => {
    // ★ A document deleted, restored under a new id, and then edited through
    // that new id leaves an old delete buried under newer entries. Reading the
    // whole group instead of its newest entry would resurrect it.
    const deleted = v({ id: 1, documentId: 99, savedAt: "2026-01-01T00:00:00.000Z", op: "delete" });
    const later = v({ id: 2, documentId: 99, savedAt: "2026-02-01T00:00:00.000Z", op: "update" });
    expect(deletedDocumentVersions([deleted, later], [])).toEqual([]);
    // ...and the same group with nothing newer IS a tombstone.
    expect(deletedDocumentVersions([deleted], []).map((k) => k.id)).toEqual([1]);
  });
});
