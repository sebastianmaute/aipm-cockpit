import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  sanitizeProjectDocuments,
  MAX_DOCUMENTS,
  MAX_BLOCKS_PER_DOC,
  MAX_TABLE_ROWS,
  MAX_TABLE_COLUMNS,
  MAX_BULLET_ITEMS,
  MAX_TITLE_CHARS,
  MAX_HTML_TEXT_CHARS,
  type DocBlock,
  type ProjectDocument,
} from "./document-model";
import { htmlTextLength } from "./rich-text-plain";
import { EXPORT_SECTION_KEYS } from "./settings-types";

// ★ fc.date() can emit an Invalid Date whose .toISOString() throws — that
// passes vitest's type check but fails at runtime. Map an integer ms range.
const isoArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

const blockArb: fc.Arbitrary<DocBlock> = fc.oneof(
  fc.record({
    type: fc.constant("heading" as const),
    level: fc.constantFrom(1 as const, 2 as const, 3 as const),
    text: fc.string({ minLength: 1, maxLength: 40 }),
  }),
  // ★ The plan omitted `paragraph`. It is the ONLY block whose sanitize is a
  // non-trivial transform (capHtmlText projects HTML to text, truncates at a
  // surrogate-safe boundary, re-wraps via plainToHtml, which ESCAPES & < >), so
  // leaving it out pointed the property away from the one place a fixed-point
  // violation could plausibly hide. Short values here; the over-cap path gets
  // its own property below so the round-trip suite stays cheap.
  fc.record({
    type: fc.constant("paragraph" as const),
    html: fc.string({ minLength: 1, maxLength: 40 }).map((s) => `<p>${s}</p>`),
  }),
  fc.record({
    type: fc.constant("bullets" as const),
    items: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
      minLength: 1,
      maxLength: 5,
    }),
  }),
  fc.record({
    type: fc.constant("table" as const),
    columns: fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
      minLength: 1,
      maxLength: 4,
    }),
    rows: fc.array(fc.array(fc.string({ maxLength: 10 }), { maxLength: 4 }), {
      maxLength: 5,
    }),
  }),
  fc.record({
    type: fc.constant("dataSection" as const),
    key: fc.constantFrom("tasks" as const, "raid" as const),
  }),
  fc.record({ type: fc.constant("pageBreak" as const) }),
);

const docArb = fc.record({
  id: fc.integer({ min: 1, max: 10_000 }),
  title: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim() !== ""),
  blocks: fc.array(blockArb, { maxLength: 12 }),
  createdAt: isoArb,
  updatedAt: isoArb,
});

describe("document JSON round-trip", () => {
  it("survives JSON.stringify/parse with no change after sanitize", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 8 }), (docs) => {
        const once = sanitizeProjectDocuments(docs);
        const twice = sanitizeProjectDocuments(JSON.parse(JSON.stringify(once)));
        // ★★ toStrictEqual, NOT toEqual. `once` is a pure JSON structure, so
        // JSON.parse(JSON.stringify(once)) is the identity on it — which makes
        // this test a DUPLICATE of the idempotence one below under toEqual. The
        // single thing a JSON round-trip can actually destroy is a key whose
        // value is `undefined` (stringify drops it), and toEqual deliberately
        // ignores undefined-valued properties, so it cannot see that either.
        // toStrictEqual does. It is what makes this property distinct: emit
        // `ordered: undefined` instead of omitting the key and this test fails
        // while the idempotence test still passes.
        expect(twice).toStrictEqual(once);
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 8 }), (docs) => {
        const once = sanitizeProjectDocuments(docs);
        expect(sanitizeProjectDocuments(once)).toStrictEqual(once);
      }),
    );
  });
});

/** A well-formed pair iterates as ONE code point above 0xFFFF, so anything left
 *  in the surrogate range is a LONE surrogate. Written as an iteration rather
 *  than a regex on purpose: the lookbehind form needs an ES2018 target and
 *  fails tsc here, the same way the /s (dotAll) flag does. */
function hasLoneSurrogate(s: string): boolean {
  return [...s].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c >= 0xd800 && c <= 0xdfff;
  });
}

const UNITS = ["abcdef", "ghijkl", "mnopqr", "stuvwx"] as const;

// ★ Fixed alphabet on purpose. A random fc.string() body would let whitespace
// collapsing (\s+ -> " ") or a stray "<" shrink the projected text back UNDER
// the cap, and the property would then silently stop testing the truncate path
// it exists to test.
const overCapParagraphArb = fc
  .record({
    // "" vs "a" flips the parity at the cut, so the emoji case exercises BOTH
    // the clean pair boundary and the lone-high-surrogate backoff.
    prefix: fc.constantFrom("", "a"),
    unit: fc.constantFrom(...UNITS),
    astral: fc.boolean(),
  })
  .map(({ prefix, unit, astral }) => {
    const body = astral ? "\u{1F600}".repeat(11_000) : unit.repeat(4_000);
    return `<p>${prefix}${body}</p>`;
  });

describe("over-cap paragraph", () => {
  it("truncates without splitting a surrogate pair and is still a fixed point", () => {
    fc.assert(
      fc.property(overCapParagraphArb, (html) => {
        const once = sanitizeProjectDocuments([
          {
            id: 1,
            title: "t",
            blocks: [{ type: "paragraph", html }],
            createdAt: "",
            updatedAt: "",
          },
        ]);
        expect(once[0].blocks).toHaveLength(1);
        const block = once[0].blocks[0] as { type: "paragraph"; html: string };

        // Anti-vacuity: prove the cap actually ENGAGED. Without this the whole
        // property passes on an untouched under-cap value.
        expect(block.html).not.toBe(html);

        expect(htmlTextLength(block.html)).toBeLessThanOrEqual(MAX_HTML_TEXT_CHARS);
        expect(hasLoneSurrogate(block.html)).toBe(false);

        const twice = sanitizeProjectDocuments(JSON.parse(JSON.stringify(once)));
        expect(twice).toStrictEqual(once);
      }),
      // Each case builds a ~25k-char string; 20 runs is ample and keeps this
      // suite off the machine-saturation timeout path.
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Adversarial input -> output invariants.
//
// ★★ This is the property the round-trip pair CANNOT give us. Feeding malformed
// input to the round-trip property adds almost nothing: its subject is
// `once = sanitize(x)`, and malformed parts of x are DROPPED, so junk shrinks
// the output rather than reaching output states well-formed input cannot. What
// malformed input DOES buy is a different and much stronger claim — that the
// sanitizer's OUTPUT always satisfies the model's invariants no matter what
// came in. That is what protects the six write paths from a hostile or corrupt
// import, and it is highly falsifiable.
// ---------------------------------------------------------------------------

const junk: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.boolean(),
  fc.string({ maxLength: 8 }),
  fc.array(fc.string({ maxLength: 4 }), { maxLength: 3 }),
  fc.constant({}),
);

const KNOWN_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "bullets",
  "table",
  "dataSection",
  "pageBreak",
]);

// Structurally plausible but field-wise corrupt. A pure fc.anything() would
// almost never clear `positive id AND non-blank title`, so the invariants would
// be asserted over an empty array nearly every run — vacuous. These near-misses
// survive often enough to actually exercise the sanitizer.
const corruptBlockArb: fc.Arbitrary<unknown> = fc.oneof(
  blockArb,
  junk,
  fc.record({
    type: fc.constantFrom(
      "heading",
      "paragraph",
      "bullets",
      "table",
      "dataSection",
      "pageBreak",
      "bogus",
      "",
    ),
    level: fc.oneof(fc.integer({ min: -5, max: 9 }), junk),
    text: fc.oneof(fc.string({ maxLength: 10 }), junk),
    html: fc.oneof(fc.string({ maxLength: 20 }).map((s) => `<p>${s}</p>`), junk),
    items: fc.oneof(
      fc.array(fc.oneof(fc.string({ maxLength: 5 }), junk), { maxLength: 6 }),
      junk,
    ),
    columns: fc.oneof(
      fc.array(fc.oneof(fc.string({ maxLength: 5 }), junk), { maxLength: 6 }),
      junk,
    ),
    rows: fc.oneof(
      fc.array(
        fc.oneof(
          fc.array(fc.oneof(fc.string({ maxLength: 5 }), junk), { maxLength: 6 }),
          junk,
        ),
        { maxLength: 6 },
      ),
      junk,
    ),
    key: fc.oneof(fc.constantFrom("tasks", "raid", "not-a-section", ""), junk),
    caption: fc.oneof(fc.string({ maxLength: 5 }), junk),
    ordered: fc.oneof(fc.boolean(), junk),
  }),
);

const corruptDocArb: fc.Arbitrary<unknown> = fc.oneof(
  docArb,
  junk,
  fc.record({
    // A narrow id range on purpose: it forces DUPLICATE ids across the array,
    // which is how the uniqueness invariant gets exercised at all.
    id: fc.oneof(
      fc.integer({ min: -3, max: 6 }),
      fc.constant(Number.NaN),
      fc.double(),
      junk,
    ),
    title: fc.oneof(fc.string({ maxLength: 12 }), fc.constant("   "), junk),
    blocks: fc.oneof(fc.array(corruptBlockArb, { maxLength: 8 }), junk),
    createdAt: fc.oneof(isoArb, fc.string({ maxLength: 10 }), junk),
    updatedAt: fc.oneof(isoArb, fc.string({ maxLength: 10 }), junk),
  }),
);

function assertBlockInvariants(b: DocBlock): void {
  expect(KNOWN_BLOCK_TYPES.has(b.type)).toBe(true);
  switch (b.type) {
    case "heading":
      expect([1, 2, 3]).toContain(b.level);
      expect(b.text.trim()).not.toBe("");
      break;
    case "paragraph":
      expect(htmlTextLength(b.html)).toBeGreaterThan(0);
      expect(htmlTextLength(b.html)).toBeLessThanOrEqual(MAX_HTML_TEXT_CHARS);
      break;
    case "bullets":
      expect(b.items.length).toBeGreaterThan(0);
      expect(b.items.length).toBeLessThanOrEqual(MAX_BULLET_ITEMS);
      for (const i of b.items) expect(i.trim()).not.toBe("");
      break;
    case "table":
      expect(b.columns.length).toBeGreaterThan(0);
      expect(b.columns.length).toBeLessThanOrEqual(MAX_TABLE_COLUMNS);
      expect(b.rows.length).toBeLessThanOrEqual(MAX_TABLE_ROWS);
      // The invariant every renderer depends on: no ragged rows.
      for (const r of b.rows) expect(r).toHaveLength(b.columns.length);
      break;
    case "dataSection":
      expect(EXPORT_SECTION_KEYS).toContain(b.key);
      break;
    case "pageBreak":
      break;
  }
}

function assertDocInvariants(out: readonly ProjectDocument[], seenTypes: Set<string>): number {
  expect(out.length).toBeLessThanOrEqual(MAX_DOCUMENTS);
  const ids = new Set<number>();
  let blocks = 0;
  for (const d of out) {
    expect(Number.isInteger(d.id)).toBe(true);
    expect(d.id).toBeGreaterThan(0);
    expect(ids.has(d.id)).toBe(false);
    ids.add(d.id);
    expect(d.title.trim()).not.toBe("");
    expect(d.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(typeof d.createdAt).toBe("string");
    expect(typeof d.updatedAt).toBe("string");
    expect(d.blocks.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_DOC);
    for (const b of d.blocks) {
      assertBlockInvariants(b);
      seenTypes.add(b.type);
      blocks += 1;
    }
  }
  return blocks;
}

describe("sanitize under adversarial input", () => {
  it("always yields a valid document array, and stays a fixed point", () => {
    const seenTypes = new Set<string>();
    let docsSurvived = 0;
    let blocksSurvived = 0;

    fc.assert(
      fc.property(fc.array(corruptDocArb, { maxLength: 10 }), (raw) => {
        const once = sanitizeProjectDocuments(raw);
        blocksSurvived += assertDocInvariants(once, seenTypes);
        docsSurvived += once.length;
        // Cleaning already-clean input must change nothing, even when the first
        // pass had to repair a lot.
        expect(sanitizeProjectDocuments(once)).toStrictEqual(once);
      }),
    );

    // ★★ Anti-vacuity, and the reason the generator is near-miss rather than
    // fc.anything(): an invariant check over a mostly-empty output would pass
    // no matter what the sanitizer did. These assert the generator actually
    // reached the code under test.
    // Measured 2026-08-06 over a default 100-run assert: 169 documents and 767
    // blocks survived, all 6 block types seen. The floors below are far under
    // that on purpose — they must catch a generator that has DEGENERATED, not
    // wobble when fast-check draws a different seed.
    expect(docsSurvived).toBeGreaterThan(0);
    expect(blocksSurvived).toBeGreaterThan(0);
    expect(seenTypes.size).toBeGreaterThanOrEqual(4);
  });
});
