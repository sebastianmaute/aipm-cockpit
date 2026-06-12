import { describe, expect, it } from "vitest";
import { complexityScore, suggestTemplate } from "./template-suggest";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import type { ProjectMeta } from "./types";

function meta(over: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    name: "P", code: "P", projectManager: "", keyStakeholdersInternal: [], keyStakeholdersExternal: [],
    customer: "", naceSection: "", identityTypes: [], products: "", deployment: "Cloud",
    startDate: "", endDate: "", profitCenter: "", contactPersons: [], regulatory: [], ...over,
  } as ProjectMeta;
}

describe("complexityScore", () => {
  it("sparse meta scores 0 with no reasons", () => {
    expect(complexityScore(meta()).score).toBe(0);
    expect(complexityScore(meta()).reasons).toEqual([]);
  });
  it("team 8+ adds 2 and a reason; 3-7 adds 1", () => {
    const big = meta({ keyStakeholdersInternal: ["a","b","c","d","e","f","g","h"] });
    expect(complexityScore(big).score).toBe(2);
    expect(complexityScore(big).reasons[0].key).toBe("suggestSignalTeam");
    const mid = meta({ keyStakeholdersInternal: ["a","b","c"] });
    expect(complexityScore(mid).score).toBe(1);
  });
  it("regulated only when a value other than 'Not applicable' present", () => {
    expect(complexityScore(meta({ regulatory: ["Not applicable"] })).score).toBe(0);
    expect(complexityScore(meta({ regulatory: ["DORA"] })).score).toBe(1);
  });
  it("deployment Hybrid +2, On-premise +1, Cloud +0", () => {
    expect(complexityScore(meta({ deployment: "Hybrid" })).score).toBe(2);
    expect(complexityScore(meta({ deployment: "On-premise" })).score).toBe(1);
    expect(complexityScore(meta({ deployment: "Cloud" })).score).toBe(0);
  });
  it("duration >12mo +2, 3-12mo +1, <3mo +0", () => {
    expect(complexityScore(meta({ startDate: "2026-01-01", endDate: "2027-06-01" })).score).toBe(2);
    expect(complexityScore(meta({ startDate: "2026-01-01", endDate: "2026-07-01" })).score).toBe(1);
    expect(complexityScore(meta({ startDate: "2026-01-01", endDate: "2026-02-01" })).score).toBe(0);
  });
  it("scale: identityCount above threshold +1", () => {
    expect(complexityScore(meta({ identityCount: 5000 })).score).toBe(1);
    expect(complexityScore(meta({ identityCount: 10 })).score).toBe(0);
  });
  it("PM + sponsor set but 0 stakeholders → score 0 (mandatory roles are not a size signal)", () => {
    const s = complexityScore(meta({ projectManager: "Alice", sponsor: "Bob" }));
    expect(s.score).toBe(0);
    expect(s.reasons).toEqual([]);
  });
});

describe("suggestTemplate", () => {
  it("sparse → simple → builtin-minimal, limited reason", () => {
    const s = suggestTemplate(meta(), BUILT_IN_TEMPLATES);
    expect(s.tier).toBe("simple");
    expect(s.templateId).toBe("builtin-minimal");
    expect(s.reasons[0].key).toBe("suggestSignalLimited");
  });
  it("high complexity → advanced → builtin-full", () => {
    const s = suggestTemplate(meta({
      keyStakeholdersInternal: ["a","b","c","d","e","f","g","h"], regulatory: ["DORA"],
      deployment: "Hybrid", startDate: "2026-01-01", endDate: "2027-06-01", identityCount: 9000,
    }), BUILT_IN_TEMPLATES);
    expect(s.tier).toBe("advanced");
    expect(s.templateId).toBe("builtin-full");
    expect(s.reasons.length).toBeGreaterThan(1);
  });
  it("mid complexity → modular → builtin-standard", () => {
    const s = suggestTemplate(meta({ keyStakeholdersInternal: ["a","b","c"], deployment: "On-premise" }), BUILT_IN_TEMPLATES);
    expect(s.tier).toBe("modular");
    expect(s.templateId).toBe("builtin-standard");
  });
  it("prefers a built-in of the target tier over a user template of that tier", () => {
    const user = { id: "u1", name: "U", features: [] as const, fieldVisibility: {} };
    const s = suggestTemplate(meta(), [user as never, ...BUILT_IN_TEMPLATES]);
    expect(s.templateId).toBe("builtin-minimal");
  });
});
