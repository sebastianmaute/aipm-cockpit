import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  sanitizeProjectDocuments,
  MAX_DOCUMENTS,
  MAX_BLOCKS_PER_DOC,
  MAX_TABLE_ROWS,
  MAX_TABLE_COLUMNS,
  MAX_BULLET_ITEMS,
  type DocTruncationDiag,
  type ProjectDocument,
} from "./document-model";

const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument => ({
  id: 1,
  title: "Status report",
  blocks: [{ type: "heading", level: 1, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  ...over,
});

describe("sanitizeProjectDocuments", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeProjectDocuments(null)).toEqual([]);
    expect(sanitizeProjectDocuments({})).toEqual([]);
    expect(sanitizeProjectDocuments("nope")).toEqual([]);
  });

  it("keeps a well-formed document unchanged", () => {
    expect(sanitizeProjectDocuments([doc()])).toEqual([doc()]);
  });

  it("drops a document with a non-positive or non-finite id", () => {
    expect(sanitizeProjectDocuments([doc({ id: 0 })])).toEqual([]);
    expect(sanitizeProjectDocuments([doc({ id: -3 })])).toEqual([]);
    expect(sanitizeProjectDocuments([doc({ id: Number.NaN })])).toEqual([]);
  });

  it("drops a document with a blank title", () => {
    expect(sanitizeProjectDocuments([doc({ title: "   " })])).toEqual([]);
  });

  it("drops a non-object entry", () => {
    expect(sanitizeProjectDocuments([null, 5, "x", [], doc()])).toEqual([doc()]);
  });

  it("drops unknown block types but keeps the surrounding blocks", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "heading", level: 2, text: "A" },
          { type: "bogus" } as never,
          { type: "pageBreak" },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([
      { type: "heading", level: 2, text: "A" },
      { type: "pageBreak" },
    ]);
  });

  it("drops a non-object block", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [null as never, "heading" as never, { type: "pageBreak" }] }),
    ]);
    expect(out[0].blocks).toEqual([{ type: "pageBreak" }]);
  });

  it("clamps a heading level outside 1..3", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "heading", level: 9 as never, text: "X" }] }),
    ]);
    expect(out[0].blocks[0]).toEqual({ type: "heading", level: 3, text: "X" });
  });

  it("clamps a heading level below 1 and defaults a non-numeric one", () => {
    const low = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "heading", level: 0 as never, text: "X" }] }),
    ]);
    expect(low[0].blocks[0]).toEqual({ type: "heading", level: 1, text: "X" });

    const junk = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "heading", level: "big" as never, text: "X" }] }),
    ]);
    expect(junk[0].blocks[0]).toEqual({ type: "heading", level: 1, text: "X" });
  });

  it("drops a heading whose text is blank or missing", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "heading", level: 1, text: "  " },
          { type: "heading", level: 1, text: 7 as never },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([]);
  });

  it("keeps a paragraph with visible text and drops an empty one", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: "<p>Delivery is <strong>green</strong></p>" },
          { type: "paragraph", html: "" },
          { type: "paragraph", html: 9 as never },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([
      { type: "paragraph", html: "<p>Delivery is <strong>green</strong></p>" },
    ]);
  });

  it("keeps bullets, trims blanks, and preserves the ordered flag", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "bullets", items: [" one ", "   ", "two", 3 as never] },
          { type: "bullets", ordered: true, items: ["a"] },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([
      { type: "bullets", items: ["one", "two"] },
      { type: "bullets", ordered: true, items: ["a"] },
    ]);
  });

  it("drops bullets with no usable items", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "bullets", items: "nope" as never },
          { type: "bullets", items: ["  ", ""] },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([]);
  });

  it("caps the bullet item count", () => {
    const items = Array.from({ length: MAX_BULLET_ITEMS + 10 }, (_, i) => `item ${i}`);
    const out = sanitizeProjectDocuments([doc({ blocks: [{ type: "bullets", items }] })]);
    expect((out[0].blocks[0] as { items: string[] }).items).toHaveLength(MAX_BULLET_ITEMS);
  });

  it("drops a dataSection whose key is not a real ExportSectionKey", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "dataSection", key: "not-a-section" as never }] }),
    ]);
    expect(out[0].blocks).toEqual([]);
  });

  it("drops a dataSection whose key is not a string", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "dataSection", key: 4 as never }] }),
    ]);
    expect(out[0].blocks).toEqual([]);
  });

  it("keeps a dataSection with a real key", () => {
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "dataSection", key: "raid" }] }),
    ]);
    expect(out[0].blocks).toEqual([{ type: "dataSection", key: "raid" }]);
  });

  it("pads short table rows to the column count and caps long ones", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "table", columns: ["A", "B"], rows: [["1"], ["1", "2", "3"]] },
        ],
      }),
    ]);
    expect(out[0].blocks[0]).toEqual({
      type: "table",
      columns: ["A", "B"],
      rows: [
        ["1", ""],
        ["1", "2"],
      ],
    });
  });

  it("keeps a trimmed table caption and coerces a non-array row", () => {
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          {
            type: "table",
            caption: "  Q1  ",
            columns: ["A"],
            rows: ["oops" as never],
          },
        ],
      }),
    ]);
    expect(out[0].blocks[0]).toEqual({
      type: "table",
      caption: "Q1",
      columns: ["A"],
      rows: [[""]],
    });
  });

  it("drops a table with no usable columns and defaults missing rows", () => {
    const dropped = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "table", columns: "A,B" as never, rows: [] },
          { type: "table", columns: [], rows: [] },
        ],
      }),
    ]);
    expect(dropped[0].blocks).toEqual([]);

    const noRows = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "table", columns: ["A"], rows: undefined as never }] }),
    ]);
    expect(noRows[0].blocks[0]).toEqual({ type: "table", columns: ["A"], rows: [] });
  });

  it("caps the table column count", () => {
    const columns = Array.from({ length: MAX_TABLE_COLUMNS + 5 }, (_, i) => `c${i}`);
    const out = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "table", columns, rows: [[]] }] }),
    ]);
    const table = out[0].blocks[0] as { columns: string[]; rows: string[][] };
    expect(table.columns).toHaveLength(MAX_TABLE_COLUMNS);
    expect(table.rows[0]).toHaveLength(MAX_TABLE_COLUMNS);
  });

  it("caps the document count, the block count and the table row count", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 10 }, (_, i) => doc({ id: i + 1 }));
    expect(sanitizeProjectDocuments(many)).toHaveLength(MAX_DOCUMENTS);

    const blocks = Array.from({ length: MAX_BLOCKS_PER_DOC + 10 }, () => ({
      type: "pageBreak" as const,
    }));
    expect(sanitizeProjectDocuments([doc({ blocks })])[0].blocks).toHaveLength(
      MAX_BLOCKS_PER_DOC,
    );

    const rows = Array.from({ length: MAX_TABLE_ROWS + 10 }, () => ["x"]);
    const capped = sanitizeProjectDocuments([
      doc({ blocks: [{ type: "table", columns: ["A"], rows }] }),
    ]);
    expect((capped[0].blocks[0] as { rows: string[][] }).rows).toHaveLength(MAX_TABLE_ROWS);
  });

  it("defaults missing blocks to an empty list", () => {
    const out = sanitizeProjectDocuments([doc({ blocks: undefined as never })]);
    expect(out[0].blocks).toEqual([]);
  });

  it("drops a duplicate id, keeping the first occurrence", () => {
    const out = sanitizeProjectDocuments([doc({ title: "first" }), doc({ title: "second" })]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("first");
  });

  it("blanks an unparseable timestamp and falls updatedAt back to createdAt", () => {
    const bad = sanitizeProjectDocuments([
      doc({ createdAt: "not-a-date", updatedAt: 5 as never }),
    ]);
    expect(bad[0].createdAt).toBe("");
    expect(bad[0].updatedAt).toBe("");

    const fallback = sanitizeProjectDocuments([
      doc({ createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "" }),
    ]);
    expect(fallback[0].updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("does not touch the DOM", () => {
    // Guard: this module must stay usable under bare node (the sample generator).
    // A source scan is the enforcement; see the comment-stripped check below.
    // ★ cwd-relative, NOT `new URL(..., import.meta.url)` — under vitest
    // `import.meta.url` is not a file: URL, so readFileSync throws
    // "The URL must be of scheme file". Matches the repo's other source scans
    // (calendar-events-persistence.test.ts).
    const src = readFileSync("src/app/document-model.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
  });

  it("never snapshots EXPORT_SECTION_KEYS at module-eval", () => {
    // ★★★ The section registry MUST be read at CALL time. A module-level
    // `new Set(EXPORT_SECTION_KEYS)` captures an uninitialized binding when this
    // module is reached through the settings-types -> workspace -> document-model
    // import cycle, yielding an empty set frozen for the process lifetime — every
    // dataSection block then silently dropped. That shipped once already.
    //
    // ★★ This scan and document-model.storage-cycle.test.ts are NOT redundant,
    // and neither replaces the other:
    //   - the storage-cycle test pins the CONSEQUENCE (a dataSection survives),
    //     but only while its `import "./storage"` stays first and the cycle exists;
    //   - this scan pins the SHAPE, and is order- and cycle-INDEPENDENT, so it
    //     bites deterministically — including here, in the file whose direct-import
    //     path can never reproduce the behaviour.
    // ★ The scan alone would NOT catch a DIFFERENT way of snapshotting early
    // (a lazily-memoized Set, an eval-time `.map`, a derived frozen array), which
    // is why the behavioural test stays.
    //
    // Comments are stripped first, so the prose in document-model.ts that names
    // this very pattern cannot false-positive. Measured, not assumed.
    const src = readFileSync("src/app/document-model.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/new Set\s*\(\s*EXPORT_SECTION_KEYS/);
  });

  it("counts entries the cap dropped into an optional diag", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => doc({ id: i + 1 }));
    const diag: DocTruncationDiag = {};
    expect(sanitizeProjectDocuments(many, diag)).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(5);
  });

  it("leaves the diag untouched when nothing is truncated", () => {
    const diag: DocTruncationDiag = {};
    sanitizeProjectDocuments([doc()], diag);
    expect(diag.truncatedEntries).toBeUndefined();
  });

  it("still truncates when no diag is passed", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, i) => doc({ id: i + 1 }));
    expect(sanitizeProjectDocuments(many)).toHaveLength(MAX_DOCUMENTS);
  });

  it("accumulates rather than overwriting, so one diag can span several calls", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 2 }, (_, i) => doc({ id: i + 1 }));
    const diag: DocTruncationDiag = {};
    sanitizeProjectDocuments(many, diag);
    sanitizeProjectDocuments(many, diag);
    expect(diag.truncatedEntries).toBe(4);
  });

  // ── a LIVE document's block loss, which used to be reported by nobody ──────
  // ★★★ VERSIONS DISCLOSED THEIR BLOCK LOSS AND THE DOCUMENTS THEY ARE VERSIONS
  // OF DID NOT. A 600-block document loaded as 500, the next save wrote those
  // 500 back across all six write paths, and the other 100 were gone — with no
  // count, no toast, and nothing for the §103 save guard to refuse. Measured
  // before the fix: `diag` came back `{}`.
  const overCapBlocks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ type: "heading" as const, level: 1 as const, text: `H${i}` }));

  it("counts blocks past the per-document cap on a LIVE document", () => {
    const diag: DocTruncationDiag = {};
    const out = sanitizeProjectDocuments([doc({ blocks: overCapBlocks(MAX_BLOCKS_PER_DOC + 100) })], diag);
    expect(out[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(diag.truncatedBlocks).toBe(100);
    // The DOCUMENT cap is a separate channel and must not be cross-contaminated.
    expect(diag.truncatedEntries).toBeUndefined();
  });

  it("does NOT count blocks from a document the dedup check discards", () => {
    // ★★★ The count used to sit inside `sanitizeDocument`, which runs BEFORE the
    // caller's `seen.has(doc.id)` check — so a duplicate-id document contributed
    // its block overflow while the document itself was thrown away, pausing
    // saving over blocks belonging to a document that never loaded. A duplicate
    // is dropped by every future load, so refusing to save cannot recover it:
    // exactly the reasoning that excludes invalid blocks two lines above.
    const diag: DocTruncationDiag = {};
    const out = sanitizeProjectDocuments(
      [
        doc({ id: 7, blocks: overCapBlocks(3) }),
        doc({ id: 7, blocks: overCapBlocks(MAX_BLOCKS_PER_DOC + 250) }),
      ],
      diag,
    );
    expect(out).toHaveLength(1);            // control: the duplicate really was dropped
    expect(diag.truncatedBlocks).toBeUndefined();
  });

  it("leaves truncatedBlocks undefined for an under-cap document", () => {
    // ★ CONTROL: without it, an implementation that never writes the key at all
    // would satisfy nothing, but one that writes 0 unconditionally would still
    // raise the sticky save guard on every clean load.
    const diag: DocTruncationDiag = {};
    sanitizeProjectDocuments([doc({ blocks: overCapBlocks(3) })], diag);
    expect(diag.truncatedBlocks).toBeUndefined();
  });

  // ★★★ INVALID BLOCKS ARE NOT TRUNCATION, and the distinction is what keeps
  // this counter from becoming a workspace-wide save lockout: any non-zero
  // count raises the sticky §103 flag, so counting dropped-as-invalid blocks
  // meant ONE unloadable block anywhere paused ALL saving. It is not a hostile
  // input either — a `dataSection` whose key leaves EXPORT_SECTION_KEYS in an
  // ordinary refactor is dropped by every load from then on, and refusing to
  // save can never recover it.
  it("does not count blocks the validator dropped as invalid", () => {
    const diag: DocTruncationDiag = {};
    const out = sanitizeProjectDocuments(
      [
        doc({
          blocks: [
            { type: "heading", level: 1, text: "Kept" },
            { type: "paragraph", html: "" },
            { type: "dataSection", key: "notARegisteredSectionKey" },
            null,
          ] as unknown as ProjectDocument["blocks"],
        }),
      ],
      diag,
    );
    // Control: the three really were dropped, so this is not a vacuous pass.
    expect(out[0].blocks).toHaveLength(1);
    expect(diag.truncatedBlocks).toBeUndefined();
  });
});
