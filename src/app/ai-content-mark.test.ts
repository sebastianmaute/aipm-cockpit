import { describe, it, expect } from "vitest";
import { AI_MARK_HEADER, AI_SOURCE_TYPE_URI, isAiMarked } from "./ai-content-mark";

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
});
