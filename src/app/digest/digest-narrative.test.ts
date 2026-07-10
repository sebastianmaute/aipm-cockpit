import { describe, it, expect } from "vitest";
import { buildDigestNarrativePrompt, parseDigestNarrative } from "./digest-narrative";
import type { DigestModel } from "./digest-model";

const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 1, name: "M1", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

describe("digest narrative", () => {
  it("prompt summarizes the facts without leaking a key", () => {
    const p = buildDigestNarrativePrompt(MODEL, "en-US");
    expect(p).toContain("Red");
    expect(p).toContain("2");
    expect(p).not.toMatch(/sk-ant/);
  });
  it("parseDigestNarrative strips control chars and caps length", () => {
    expect(parseDigestNarrative("Project slipped. ")).toBe("Project slipped.");
    const long = "x".repeat(5000);
    expect(parseDigestNarrative(long).length).toBeLessThanOrEqual(2000);
  });
  it("parseDigestNarrative returns '' for non-string", () => {
    expect(parseDigestNarrative(undefined as unknown as string)).toBe("");
  });
});
