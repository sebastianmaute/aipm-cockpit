import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { sanitizeDocumentLinks, encodeDocumentLinks, decodeDocumentLinks } from "./document-link";

const linkArb = fc.record({
  id: fc.string({ minLength: 1 }),
  name: fc.string({ minLength: 1 }).map((s) => s.trim()).filter((s) => s.length > 0),
  url: fc.webUrl(),
  kind: fc.constantFrom("file" as const, "folder" as const),
  driveId: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  itemId: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  mimeType: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  addedAt: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

describe("document-link properties", () => {
  test("sanitizeDocumentLinks never throws and always returns an array", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(Array.isArray(sanitizeDocumentLinks(input))).toBe(true);
      }),
    );
  });

  test("encode -> decode is a fixed point on sanitized input", () => {
    fc.assert(
      fc.property(fc.array(linkArb), (links) => {
        const clean = sanitizeDocumentLinks(links);
        expect(decodeDocumentLinks(encodeDocumentLinks(clean))).toEqual(clean);
      }),
    );
  });
});
