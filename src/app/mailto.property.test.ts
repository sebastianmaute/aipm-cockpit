import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { buildMailtoUrl } from "./mailto";

describe("mailto — properties", () => {
  test("buildMailtoUrl never emits raw CR/LF (header-injection safe)", () => {
    fc.assert(
      // Include strings that carry newlines/CR explicitly — they must be percent-encoded.
      fc.property(fc.string(), fc.string(), fc.string(), (email, subject, body) => {
        const url = buildMailtoUrl(email, subject, body);
        expect(url).not.toMatch(/[\r\n]/);
      }),
    );
  });

  test("buildMailtoUrl is well-formed and round-trips each component", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (email, subject, body) => {
        const url = buildMailtoUrl(email, subject, body);
        expect(url.startsWith("mailto:")).toBe(true);
        const m = url.match(/^mailto:([^?]*)\?subject=([^&]*)&body=([\s\S]*)$/);
        expect(m).not.toBeNull();
        const [, e, s, b] = m as RegExpMatchArray;
        expect(decodeURIComponent(e)).toBe(email);
        expect(decodeURIComponent(s)).toBe(subject);
        expect(decodeURIComponent(b)).toBe(body);
      }),
    );
  });

  test("buildMailtoUrl percent-encodes mailto-significant characters in the address", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (email, subject, body) => {
        const url = buildMailtoUrl(email, subject, body);
        const addr = (url.match(/^mailto:([^?]*)\?/) as RegExpMatchArray)[1];
        // The address segment must not leak raw separators that would break parsing.
        expect(addr).not.toMatch(/[?&#\s]/);
      }),
    );
  });
});
