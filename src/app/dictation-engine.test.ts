import { describe, it, expect } from "vitest";
import { appendDictation } from "./dictation-engine";
describe("appendDictation", () => {
  it("returns the segment for empty prev", () => { expect(appendDictation("", "hello")).toBe("hello"); });
  it("adds a space when prev has no trailing space", () => { expect(appendDictation("hello", "world")).toBe("hello world"); });
  it("keeps a single space when prev already ends with one", () => { expect(appendDictation("hello ", "world")).toBe("hello world"); });
  it("ignores an empty/whitespace segment", () => { expect(appendDictation("hello", "   ")).toBe("hello"); });
});
