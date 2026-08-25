import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  sanitizeProjectDocuments,
  MAX_DOCUMENTS,
  MAX_BLOCKS_PER_DOC,
  MAX_TABLE_ROWS,
  MAX_TABLE_COLUMNS,
  MAX_BULLET_ITEMS,
  MAX_TEXT_CHARS,
  MAX_HTML_TEXT_CHARS,
  exceedsStorageCaps,
  normalizeBlockForStorage,
  type DocBlock,
  type DocTruncationDiag,
  type ProjectDocument,
} from "./document-model";
import { EXPORT_SECTION_KEYS } from "./settings-types";

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

  it("keeps a paragraph whose only content is an asset image", () => {
    // ★★★ REGRESSION: the visible-text check ALONE dropped every image-only
    // paragraph on EVERY load path — the image rendered in the authoring
    // session and was gone after reload, with no error and no diagnostic.
    // `<img>` contributes no text and `alt` is not projected, so an
    // image-only paragraph measures 0. Silent data loss, backend-independent.
    const imageOnly = '<p><img data-asset-id="a1B_2-x" alt="Burn-up chart"></p>';
    const captioned = '<p><img data-asset-id="a1B_2-x" alt="chart">Figure 1</p>';
    // ★ Upper-case reaches this validator verbatim: the HTML allow-list that
    // lower-cases tag and attribute names runs AFTER it on every load path
    // (`sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)`), so a
    // hand-edited or imported document must survive long enough to be
    // normalised. Also pins that two image paragraphs in ONE document both
    // survive — a `/g` regex would carry `lastIndex` and drop the second.
    const upper = '<P><IMG DATA-ASSET-ID="a1B_2-x" ALT="chart"></P>';
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: imageOnly },
          { type: "paragraph", html: captioned },
          { type: "paragraph", html: upper },
          { type: "paragraph", html: "<p>Plain</p>" },
        ],
      }),
    ]);
    // Assert the SHAPES, not a surviving-block count — a count passes against a
    // mutant that keeps the wrong three blocks.
    expect(out[0].blocks).toEqual([
      { type: "paragraph", html: imageOnly },
      { type: "paragraph", html: captioned },
      { type: "paragraph", html: upper },
      { type: "paragraph", html: "<p>Plain</p>" },
    ]);
  });

  it("keeps an image-only paragraph when an earlier attribute value contains > and <", () => {
    // ★★★ REGRESSION, and it was LIVE data loss: a genuine <img> carrying a
    // genuine data-asset-id was deleted on load whenever an attribute BEFORE it
    // held a `>` followed by tag-like text. Both halves of the drop condition
    // read `[^>]*` and both truncated at that `>` — `htmlPlainProjection` ate
    // the remainder as if it were a tag (projection 0) and ASSET_IMG_TEST_RE
    // never reached the attribute (no image). Both false, block gone, on all
    // six write paths, with nothing in the truncation diag.
    //
    // ★★★ ATTRIBUTE ORDER IS THE WHOLE DISCRIMINATOR, so a fixture that puts
    // data-asset-id FIRST passes against the unfixed code. That is exactly why
    // this shipped: the app's own insert path writes the id first, and the two
    // callers that do NOT control order are the AI document tool and workspace
    // import. Each alt below must therefore keep the poison BEFORE the id.
    //
    // ★★ Not catchable in document-asset-patterns.test.ts. That file asserts
    // one pattern at a time, and each was individually "correct" — the loss
    // only appears when the two are composed by the real guard. A `>` alone is
    // NOT enough either (`alt="a>b"` leaves visible text, so the && short-
    // circuits and the block survives): the tail after the `>` has to look like
    // a tag. Both shapes are listed so a fix that only handles one goes red.
    const survivesOnFirstTerm = '<p><img alt="a>b" data-asset-id="a1B_2-x"></p>';
    const tagLikeTail = '<p><img alt="><c d" data-asset-id="a1B_2-x"></p>';
    const closingTail = '<p><img alt="></b" data-asset-id="a1B_2-x"></p>';
    const idFirst = '<p><img data-asset-id="a1B_2-x" alt="><c d"></p>';
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: survivesOnFirstTerm },
          { type: "paragraph", html: tagLikeTail },
          { type: "paragraph", html: closingTail },
          { type: "paragraph", html: idFirst },
        ],
      }),
    ]);
    // Shapes, not a count — a count passes against a mutant keeping the wrong
    // subset, and "the wrong subset" is precisely what the bug produced.
    expect(out[0].blocks).toEqual([
      { type: "paragraph", html: survivesOnFirstTerm },
      { type: "paragraph", html: tagLikeTail },
      { type: "paragraph", html: closingTail },
      { type: "paragraph", html: idFirst },
    ]);
  });

  it("keeps a paragraph whose only image reference is a decoy in an attribute value", () => {
    // ★★★ THIS TEST ASSERTED THE OPPOSITE ONE ROUND AGO, and the flip is the
    // whole lesson of open-followups §250. It was written to pin a narrowing as
    // a deliberate improvement: a quote-aware predicate answers `false` here,
    // the decoy `data-asset-id=` inside the alt no longer counts, and the block
    // joins the non-asset images this loader already drops. That reasoning was
    // sound in isolation and wrong about the sink. The predicate is one term of
    // a DELETE condition, so every narrowing is a candidate data-loss bug, and
    // the same narrowing destroyed four paragraphs carrying REAL attributes
    // (pinned in document-asset-patterns.test.ts and by the sibling test
    // above). The union keeps this block instead — a source-less image, exactly
    // what the stored html describes.
    // ★ The plain image alongside is the CONTROL: it shows the loader really
    // does drop an image-only paragraph with no asset reference, so this
    // assertion cannot pass merely because nothing is ever dropped.
    const decoyInAlt = '<p><img alt="data-asset-id=x"></p>';
    const plainImage = '<p><img src="https://example.test/a.png"></p>';
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: decoyInAlt },
          { type: "paragraph", html: plainImage },
          { type: "paragraph", html: "<p>Kept</p>" },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([
      { type: "paragraph", html: decoyInAlt },
      { type: "paragraph", html: "<p>Kept</p>" },
    ]);
  });

  it("keeps the malformed-but-real image paragraphs a narrowed predicate deleted", () => {
    // ★★★ THE §250 REGRESSION, END TO END. Each html below carries a REAL
    // `data-asset-id` — an HTML parser recovers from the malformation and
    // yields the attribute — and each projects to zero visible text, so the
    // predicate is the ONLY thing standing between it and deletion. The fix
    // round that closed §250 narrowed that predicate three ways at once and
    // silently deleted all of these on every load path.
    // ★ Listed one per BLOCK rather than folded into one fixture: a single
    // string would go green again the moment any one of the narrowings came
    // back, since the others would still be covered.
    const shapes = [
      '<p><img alt="x"data-asset-id="real"></p>', // missing separator, dq
      "<p><img alt='x'data-asset-id=\"real\"></p>", // missing separator, sq
      "<p><img alt=it's data-asset-id=\"real\"></p>", // unpaired quote
    ];
    const out = sanitizeProjectDocuments([
      doc({ blocks: shapes.map((html) => ({ type: "paragraph" as const, html })) }),
    ]);
    expect(out[0].blocks).toEqual(shapes.map((html) => ({ type: "paragraph", html })));
  });

  it("drops an image paragraph whose attribute value contains a bare `<`", () => {
    // ★★★ A KNOWN, ACCEPTED LOSS — asserted so it cannot be reintroduced by
    // accident in either direction. `<img alt=a<b data-asset-id="real">` is a
    // real attribute to a parser, but recovering it requires a predicate branch
    // that scans past `<`, and such a branch is quadratic on input that reaches
    // this guard unbounded: `"<img ".repeat(n) + ">"` projects to zero, so the
    // `&&` does not short-circuit and the predicate runs on the whole string.
    // That spelling shipped once and measured SLOWER than the one it replaced.
    // ★ If a future change makes this block survive, check what it did to the
    // adversarial timing before calling it a fix.
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: '<p><img alt=a<b data-asset-id="real"></p>' },
          { type: "paragraph", html: "<p>Kept</p>" },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([{ type: "paragraph", html: "<p>Kept</p>" }]);
  });

  it("keeps an image-only paragraph whatever quoting style the attribute uses", () => {
    // ★★★ REGRESSION: the exemption's own docstring justified its `/i` flag on
    // "a hand-edited or imported `<IMG DATA-ASSET-ID>`" — but the pattern read
    // only DOUBLE-quoted values, so the very input class the flag was there to
    // survive was still deleted on load if it happened to spell the attribute
    // `id='x'` or bare `id=x`. Both are valid HTML5, both measure zero visible
    // text, and the drop is silent. Each of these is a SEPARATE alternative in
    // the pattern, so they are listed one per line rather than folded into one
    // fixture: a single string would go green again the moment any one branch
    // survived a mutation.
    const single = "<p><img data-asset-id='a1B_2-x' alt='Burn-up chart'></p>";
    const unquoted = "<p><img data-asset-id=a1B_2-x alt=chart></p>";
    const upperSingle = "<P><IMG DATA-ASSET-ID='a1B_2-x'></P>";
    const upperUnquoted = "<P><IMG DATA-ASSET-ID=a1B_2-x></P>";
    // Spaces around `=` are legal too, and `\s*=\s*` is what admits them.
    const spaced = '<p><img alt="chart" data-asset-id = "a1B_2-x"></p>';
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: single },
          { type: "paragraph", html: unquoted },
          { type: "paragraph", html: upperSingle },
          { type: "paragraph", html: upperUnquoted },
          { type: "paragraph", html: spaced },
        ],
      }),
    ]);
    // Shapes, not a count — a count stays green against a mutant that keeps the
    // wrong subset, which for a five-way alternation is the likely mutant.
    expect(out[0].blocks).toEqual([
      { type: "paragraph", html: single },
      { type: "paragraph", html: unquoted },
      { type: "paragraph", html: upperSingle },
      { type: "paragraph", html: upperUnquoted },
      { type: "paragraph", html: spaced },
    ]);
  });

  it("still drops a text-free paragraph that references no asset image", () => {
    // The behaviour the exemption must NOT regress. Every entry here projects
    // to no visible text AND can render nothing: the document allow-list gives
    // `img` only `alt` and `data-asset-id` (no `src`), and every renderer keys
    // off a NON-EMPTY `data-asset-id` — so each of these would load back as a
    // blank paragraph the user cannot see, edit or repair.
    const out = sanitizeProjectDocuments([
      doc({
        blocks: [
          { type: "paragraph", html: "" },
          { type: "paragraph", html: "<p></p>" },
          { type: "paragraph", html: "<p><br></p>" },
          { type: "paragraph", html: "<p><img alt='no id'></p>" },
          { type: "paragraph", html: '<p><img data-asset-id=""></p>' },
          // ★★ The widening to single-quoted and UNQUOTED values must not
          // swallow the empty ones with it. The unquoted branch therefore
          // excludes `"` and `'` rather than just whitespace and `>`: with a
          // bare `[^\s>]+` the two characters of `""` ARE a non-empty unquoted
          // value and every one of these would be kept.
          { type: "paragraph", html: "<p><img data-asset-id=''></p>" },
          { type: "paragraph", html: "<p><img data-asset-id=></p>" },
          { type: "paragraph", html: "<p><img data-asset-id></p>" },
          { type: "paragraph", html: 9 as never },
          { type: "paragraph", html: '<p><img data-asset-id="kept"></p>' },
        ],
      }),
    ]);
    expect(out[0].blocks).toEqual([
      { type: "paragraph", html: '<p><img data-asset-id="kept"></p>' },
    ]);
  });

  it("keeps an image-only paragraph on the COMMIT path too", () => {
    // `normalizeBlockForStorage` is the hand-editor's normaliser and delegates
    // to the same validator — pinned separately so an extraction that splits
    // them cannot leave the commit path dropping what the loader keeps.
    const block: DocBlock = {
      type: "paragraph",
      html: '<p><img data-asset-id="a1" alt="chart"></p>',
    };
    expect(normalizeBlockForStorage(block)).toEqual(block);
    expect(normalizeBlockForStorage({ type: "paragraph", html: "<p></p>" })).toBeNull();
    // No cap is exceeded, so the reconcile must not re-seed the draft from
    // storage over an image (exceedsStorageCaps measures VISIBLE text, which an
    // image-only paragraph has none of).
    expect(exceedsStorageCaps(block)).toBe(false);
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

describe("sanitizeProjectDocuments — linkedEntities", () => {
  const base = { id: 1, title: "Doc", blocks: [], createdAt: "2026-01-01T00:00:00.000Z" };

  it("round-trips a valid reference through the load path", () => {
    const [doc] = sanitizeProjectDocuments([{ ...base, linkedEntities: [{ kind: "task", id: 7, label: "Kickoff" }] }]);
    expect(doc.linkedEntities).toEqual([{ kind: "task", id: 7, label: "Kickoff" }]);
  });

  it("omits the field entirely when there are no valid references", () => {
    const [doc] = sanitizeProjectDocuments([{ ...base, linkedEntities: [{ kind: "nope", id: 7 }] }]);
    expect("linkedEntities" in doc).toBe(false);
  });

  it("omits the field when it was absent", () => {
    const [doc] = sanitizeProjectDocuments([base]);
    expect("linkedEntities" in doc).toBe(false);
  });
});

// ★★★ EVERY ARM, BECAUSE THE ONE CONSUMER TEST REACHES EXACTLY ONE OF THEM.
//  `exceedsStorageCaps` is called from a single site (the block editor's
//  reconcile), and the test there is a table that trips the COLUMN arm and
//  short-circuits. A review measured the consequence: deleting `case "bullets"`
//  outright left the whole suite green. These pin each arm against the
//  normaliser it mirrors, in BOTH directions — at the cap is not over it.
//  ★★ The pairing with `sanitizeBlock` is what actually matters and nothing
//   gates it, so each case asserts the PREDICATE and the normaliser's own
//   observable effect, rather than the predicate alone.
describe("exceedsStorageCaps", () => {
  const truncates = (b: DocBlock): boolean => {
    const out = normalizeBlockForStorage(b);
    return out !== null && JSON.stringify(out) !== JSON.stringify(b);
  };

  it("is false for the kinds that carry no capped content", () => {
    expect(exceedsStorageCaps({ type: "pageBreak" })).toBe(false);
    expect(exceedsStorageCaps({ type: "dataSection", key: EXPORT_SECTION_KEYS[0] })).toBe(false);
  });

  it("catches an over-cap heading and clears one exactly at the cap", () => {
    const at: DocBlock = { type: "heading", level: 1, text: "x".repeat(MAX_TEXT_CHARS) };
    const over: DocBlock = { type: "heading", level: 1, text: "x".repeat(MAX_TEXT_CHARS + 1) };
    expect(exceedsStorageCaps(at)).toBe(false);
    expect(exceedsStorageCaps(over)).toBe(true);
    expect(truncates(over)).toBe(true);
  });

  it("measures a paragraph by VISIBLE text, not markup length", () => {
    // ★★ The markup must be OVER the cap while the visible text is UNDER it,
    //  or the case cannot tell `htmlTextLength` from a `html.length` mutant —
    //  both answer "false" for any input short enough in both measures. A first
    //  cut used 100 repeats (1 807 html chars) and was vacuous in exactly that
    //  way, on top of asserting a ">" that was not true.
    const marked = "<p>" + "<strong>x</strong>".repeat(2_000) + "</p>";
    expect(marked.length).toBeGreaterThan(MAX_HTML_TEXT_CHARS);
    expect(exceedsStorageCaps({ type: "paragraph", html: marked })).toBe(false);
    const over: DocBlock = { type: "paragraph", html: "<p>" + "x".repeat(MAX_HTML_TEXT_CHARS + 1) + "</p>" };
    expect(exceedsStorageCaps(over)).toBe(true);
    expect(truncates(over)).toBe(true);
  });

  it("catches both bullet arms — too many items, and one item too long", () => {
    const many: DocBlock = { type: "bullets", items: Array(MAX_BULLET_ITEMS + 1).fill("a") };
    const long: DocBlock = { type: "bullets", items: ["a", "x".repeat(MAX_TEXT_CHARS + 1)] };
    const fine: DocBlock = { type: "bullets", items: Array(MAX_BULLET_ITEMS).fill("a") };
    expect(exceedsStorageCaps(many)).toBe(true);
    expect(exceedsStorageCaps(long)).toBe(true);
    expect(exceedsStorageCaps(fine)).toBe(false);
    expect(truncates(many)).toBe(true);
    expect(truncates(long)).toBe(true);
  });

  it("catches every table arm — columns, rows, header text, cell text, caption", () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
    const fine: DocBlock = { type: "table", columns: cols(2), rows: [["a", "b"]] };
    expect(exceedsStorageCaps(fine)).toBe(false);

    const wide: DocBlock = { type: "table", columns: cols(MAX_TABLE_COLUMNS + 1), rows: [] };
    const tall: DocBlock = { type: "table", columns: cols(1), rows: Array(MAX_TABLE_ROWS + 1).fill(["a"]) };
    const longHeader: DocBlock = { type: "table", columns: ["x".repeat(MAX_TEXT_CHARS + 1)], rows: [] };
    const longCell: DocBlock = { type: "table", columns: cols(1), rows: [["x".repeat(MAX_TEXT_CHARS + 1)]] };
    const longCaption: DocBlock = { type: "table", caption: "x".repeat(MAX_TEXT_CHARS + 1), columns: cols(1), rows: [] };
    for (const b of [wide, tall, longHeader, longCell, longCaption]) {
      expect(exceedsStorageCaps(b)).toBe(true);
      expect(truncates(b)).toBe(true);
    }
  });

  // ★ A ragged row (more cells than headers) IS truncated — `sanitizeBlock`
  //  slices each row to the header count — so the predicate must say so.
  it("catches a row carrying more cells than there are columns", () => {
    const ragged: DocBlock = { type: "table", columns: ["a"], rows: [["one", "two"]] };
    expect(exceedsStorageCaps(ragged)).toBe(true);
    expect(truncates(ragged)).toBe(true);
  });
});
