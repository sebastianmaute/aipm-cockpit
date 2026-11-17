import { describe, it, expect } from "vitest";
import { AI_MARK_HEADER, AI_SOURCE_TYPE_URI, isAiMarked, omitAiMark } from "./ai-content-mark";

describe("ai-content-mark", () => {
  it("pins the IPTC digital source type URI and the header name", () => {
    expect(AI_SOURCE_TYPE_URI).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
    );
    expect(AI_MARK_HEADER).toBe("X-AI-Generated");
  });

  it("isAiMarked is true only for aiGenerated: true", () => {
    expect(isAiMarked({ aiGenerated: true })).toBe(true);
    expect(isAiMarked({})).toBe(false);
    expect(isAiMarked(undefined)).toBe(false);
  });

  it("omitAiMark drops the key, keeps everything else and leaves the input alone", () => {
    const marked = { id: 1, title: "T", aiGenerated: true as const };
    const out = omitAiMark(marked);
    expect("aiGenerated" in out).toBe(false);
    expect(out).toEqual({ id: 1, title: "T" });
    expect(marked.aiGenerated).toBe(true);
    const plain = { id: 2, title: "U" };
    expect(omitAiMark(plain)).toEqual(plain);
  });
});
