import { describe, expect, test } from "vitest";
import { adfToText, textToAdf } from "./adf";

// ---------------------------------------------------------------------------
// textToAdf — plain text → ADF document structure
// ---------------------------------------------------------------------------

describe("textToAdf", () => {
  describe("empty / whitespace-only input", () => {
    test("empty string produces empty doc", () => {
      const doc = textToAdf("");
      expect(doc.type).toBe("doc");
      expect(doc.version).toBe(1);
      expect(doc.content).toEqual([]);
    });

    test("whitespace-only string produces empty doc", () => {
      const doc = textToAdf("   \t  ");
      expect(doc.content).toEqual([]);
    });

    test("newlines-only string produces empty doc", () => {
      const doc = textToAdf("\n\n\n");
      expect(doc.content).toEqual([]);
    });

    test("null-ish coercion via empty string still returns valid doc shape", () => {
      // textToAdf takes string; passing "" is the boundary.
      const doc = textToAdf("");
      expect(doc).toHaveProperty("type", "doc");
      expect(doc).toHaveProperty("version", 1);
      expect(Array.isArray(doc.content)).toBe(true);
    });
  });

  describe("single paragraph", () => {
    test("single line becomes one paragraph with one text node", () => {
      const doc = textToAdf("hello");
      expect(doc.content).toHaveLength(1);
      expect(doc.content[0].type).toBe("paragraph");
      expect(doc.content[0].content).toEqual([{ type: "text", text: "hello" }]);
    });

    test("single line with leading/trailing spaces is preserved verbatim", () => {
      const doc = textToAdf("  hello world  ");
      const para = doc.content[0];
      expect(para.content![0]).toEqual({ type: "text", text: "  hello world  " });
    });
  });

  describe("hard breaks within a paragraph", () => {
    test("two lines in one block produce text/hardBreak/text sequence", () => {
      const doc = textToAdf("line one\nline two");
      expect(doc.content).toHaveLength(1);
      const inline = doc.content[0].content!;
      expect(inline).toEqual([
        { type: "text", text: "line one" },
        { type: "hardBreak" },
        { type: "text", text: "line two" },
      ]);
    });

    test("three lines produce two hardBreaks", () => {
      const doc = textToAdf("a\nb\nc");
      const inline = doc.content[0].content!;
      expect(inline).toEqual([
        { type: "text", text: "a" },
        { type: "hardBreak" },
        { type: "text", text: "b" },
        { type: "hardBreak" },
        { type: "text", text: "c" },
      ]);
    });

    test("trailing newline within a paragraph adds hardBreak but no empty text node", () => {
      // "a\n" splits into ["a", ""] — the empty string line should not produce
      // a text node, only the preceding hardBreak.
      const doc = textToAdf("a\n");
      const inline = doc.content[0].content!;
      // Should be: text "a", hardBreak — no trailing empty text node
      expect(inline).toEqual([
        { type: "text", text: "a" },
        { type: "hardBreak" },
      ]);
    });
  });

  describe("multiple paragraphs (blank-line splitting)", () => {
    test("two blank-line-separated blocks produce two paragraphs", () => {
      const doc = textToAdf("first\n\nsecond");
      expect(doc.content).toHaveLength(2);
      expect(doc.content[0].content).toEqual([{ type: "text", text: "first" }]);
      expect(doc.content[1].content).toEqual([{ type: "text", text: "second" }]);
    });

    test("three paragraphs are all captured", () => {
      const doc = textToAdf("one\n\ntwo\n\nthree");
      expect(doc.content).toHaveLength(3);
      expect(doc.content[2].content).toEqual([{ type: "text", text: "three" }]);
    });

    test("multiple consecutive blank lines still split into two paragraphs", () => {
      const doc = textToAdf("alpha\n\n\n\nbeta");
      expect(doc.content).toHaveLength(2);
    });
  });

  describe("Windows line endings normalisation", () => {
    test("CRLF is treated the same as LF for in-paragraph breaks", () => {
      const doc = textToAdf("line one\r\nline two");
      const inline = doc.content[0].content!;
      expect(inline).toEqual([
        { type: "text", text: "line one" },
        { type: "hardBreak" },
        { type: "text", text: "line two" },
      ]);
    });

    test("CRLF blank line separates paragraphs", () => {
      const doc = textToAdf("first\r\n\r\nsecond");
      expect(doc.content).toHaveLength(2);
    });

    test("CR-only line endings are normalised", () => {
      const doc = textToAdf("a\rb");
      const inline = doc.content[0].content!;
      expect(inline).toEqual([
        { type: "text", text: "a" },
        { type: "hardBreak" },
        { type: "text", text: "b" },
      ]);
    });
  });

  describe("doc shape invariants", () => {
    test("type is always 'doc'", () => {
      expect(textToAdf("anything").type).toBe("doc");
    });

    test("version is always 1", () => {
      expect(textToAdf("anything").version).toBe(1);
    });

    test("all top-level nodes are paragraphs", () => {
      const doc = textToAdf("one\n\ntwo\n\nthree");
      for (const node of doc.content) {
        expect(node.type).toBe("paragraph");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// adfToText — ADF → plain text
// ---------------------------------------------------------------------------

describe("adfToText", () => {
  describe("null / invalid input", () => {
    test("null returns empty string", () => {
      expect(adfToText(null)).toBe("");
    });

    test("undefined returns empty string", () => {
      expect(adfToText(undefined)).toBe("");
    });

    test("primitive number returns empty string", () => {
      expect(adfToText(42)).toBe("");
    });

    test("empty string returns empty string", () => {
      expect(adfToText("")).toBe("");
    });

    test("object without content array returns empty string", () => {
      expect(adfToText({ type: "doc", version: 1 })).toBe("");
    });

    test("object with non-array content returns empty string", () => {
      expect(adfToText({ type: "doc", version: 1, content: "bad" })).toBe("");
    });
  });

  describe("empty doc", () => {
    test("doc with empty content array returns empty string", () => {
      expect(adfToText({ type: "doc", version: 1, content: [] })).toBe("");
    });
  });

  describe("paragraph nodes", () => {
    test("single paragraph with one text node returns the text", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "hello world" }],
          },
        ],
      };
      expect(adfToText(adf)).toBe("hello world");
    });

    test("two paragraphs are joined with a blank line", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "first" }] },
          { type: "paragraph", content: [{ type: "text", text: "second" }] },
        ],
      };
      expect(adfToText(adf)).toBe("first\n\nsecond");
    });

    test("paragraph with hardBreak inline node produces a newline in output", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "line one" },
              { type: "hardBreak" },
              { type: "text", text: "line two" },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("line one\nline two");
    });

    test("paragraph with no content returns empty and is filtered out", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [] },
          { type: "paragraph", content: [{ type: "text", text: "kept" }] },
        ],
      };
      // The empty paragraph produces "" and is filtered; only "kept" remains.
      expect(adfToText(adf)).toBe("kept");
    });
  });

  describe("heading nodes", () => {
    test("heading text is extracted as plain text (no prefix)", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "My Heading" }],
          },
        ],
      };
      expect(adfToText(adf)).toBe("My Heading");
    });
  });

  describe("codeBlock nodes", () => {
    test("codeBlock text is extracted as-is", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "codeBlock",
            content: [{ type: "text", text: "const x = 1;" }],
          },
        ],
      };
      expect(adfToText(adf)).toBe("const x = 1;");
    });
  });

  describe("rule node", () => {
    test("horizontal rule becomes '---'", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [{ type: "rule" }],
      };
      expect(adfToText(adf)).toBe("---");
    });

    test("rule between paragraphs is separated by blank lines", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "before" }] },
          { type: "rule" },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      };
      expect(adfToText(adf)).toBe("before\n\n---\n\nafter");
    });
  });

  describe("blockquote nodes", () => {
    test("blockquote paragraph lines are prefixed with '> '", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "blockquote",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "quoted text" }] },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("> quoted text");
    });

    test("multi-line blockquote prefixes every line", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "line one" },
                  { type: "hardBreak" },
                  { type: "text", text: "line two" },
                ],
              },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("> line one\n> line two");
    });
  });

  describe("bulletList nodes", () => {
    test("bullet list items are prefixed with '- '", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "item one" }] },
                ],
              },
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "item two" }] },
                ],
              },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("- item one\n- item two");
    });
  });

  describe("orderedList nodes", () => {
    test("ordered list items are prefixed with 1. 2. etc.", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "first" }] },
                ],
              },
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "second" }] },
                ],
              },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("1. first\n2. second");
    });
  });

  describe("mention inline node", () => {
    test("mention with attrs.text renders that text", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { text: "@alice", id: "u1" } },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("@alice");
    });

    test("mention without attrs renders empty string", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention" },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("");
    });
  });

  describe("emoji inline node", () => {
    test("emoji with attrs.text renders that text", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "emoji", attrs: { text: "😀", shortName: ":grinning:" } },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("😀");
    });

    test("emoji falls back to shortName when text is absent", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "emoji", attrs: { shortName: ":tada:" } },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe(":tada:");
    });

    test("emoji without any attrs renders empty string", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "emoji" }],
          },
        ],
      };
      expect(adfToText(adf)).toBe("");
    });
  });

  describe("unknown / malformed nodes", () => {
    test("unknown block node with text content falls back to inline extraction", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "unknownBlock",
            content: [{ type: "text", text: "fallback text" }],
          },
        ],
      };
      expect(adfToText(adf)).toBe("fallback text");
    });

    test("null node inside content array is skipped gracefully", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          null,
          { type: "paragraph", content: [{ type: "text", text: "ok" }] },
        ],
      };
      // Should not throw; null block is skipped (blockToText returns "")
      expect(adfToText(adf)).toBe("ok");
    });

    test("inline node that is not an object is skipped", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              null,
              "not-an-object",
              { type: "text", text: "valid" },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("valid");
    });

    test("text node with missing text property renders empty string", () => {
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text" }],
          },
        ],
      };
      // text node with no .text → falls back to "" via nullish coalescing
      // empty paragraph is filtered out → whole result is ""
      expect(adfToText(adf)).toBe("");
    });

    test("inline node with nested content is recursively extracted", () => {
      // e.g. a marks wrapper or an unknown inline wrapper
      const adf = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "unknownInline",
                content: [{ type: "text", text: "nested" }],
              },
            ],
          },
        ],
      };
      expect(adfToText(adf)).toBe("nested");
    });
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests — text → ADF → text should reproduce the original
// ---------------------------------------------------------------------------

describe("round-trip: textToAdf → adfToText", () => {
  test("single-line text round-trips exactly", () => {
    const original = "Hello, world!";
    expect(adfToText(textToAdf(original))).toBe(original);
  });

  test("multi-paragraph text round-trips exactly", () => {
    const original = "Paragraph one.\n\nParagraph two.";
    expect(adfToText(textToAdf(original))).toBe(original);
  });

  test("in-paragraph line breaks round-trip exactly", () => {
    const original = "line one\nline two\nline three";
    expect(adfToText(textToAdf(original))).toBe(original);
  });

  test("mixed multi-paragraph with internal breaks round-trips", () => {
    const original = "intro line one\nintro line two\n\nbody paragraph\n\nfooter";
    expect(adfToText(textToAdf(original))).toBe(original);
  });

  test("empty string round-trips to empty string", () => {
    expect(adfToText(textToAdf(""))).toBe("");
  });

  test("whitespace-only round-trips to empty string (intentional collapse)", () => {
    expect(adfToText(textToAdf("   "))).toBe("");
  });

  test("text with special characters round-trips exactly", () => {
    const original = "Cost: $100 (50% off)\nSee <https://example.com>";
    expect(adfToText(textToAdf(original))).toBe(original);
  });

  test("CRLF input round-trips to LF-normalised output", () => {
    // CRLF is normalised to LF, so result uses LF
    const input = "line one\r\nline two";
    const expected = "line one\nline two";
    expect(adfToText(textToAdf(input))).toBe(expected);
  });
});
