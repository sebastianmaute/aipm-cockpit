import { describe, it, expect } from "vitest";
import { IDENTITY_TYPES, DEPLOYMENTS, REGULATORY_REQUIREMENTS, REGULATORY_NOT_APPLICABLE } from "./project-options";
import { NACE_SECTIONS, NACE_SECTION_SET } from "./nace-sections";

describe("project option sets", () => {
  it("has the four identity types", () => {
    expect(IDENTITY_TYPES).toEqual(["B2E", "B2B", "B2C", "NHI"]);
  });
  it("has the three deployments", () => {
    expect(DEPLOYMENTS).toEqual(["Cloud", "On-premise", "Hybrid"]);
  });
  it("lists 'Not applicable' first and ten regulatory options total", () => {
    expect(REGULATORY_REQUIREMENTS[0]).toBe(REGULATORY_NOT_APPLICABLE);
    expect(REGULATORY_REQUIREMENTS).toHaveLength(10);
  });
  it("has 21 NACE sections A–U with unique codes", () => {
    expect(NACE_SECTIONS).toHaveLength(21);
    expect(NACE_SECTION_SET.size).toBe(21);
    expect(NACE_SECTIONS[0].code).toBe("A");
    expect(NACE_SECTIONS[20].code).toBe("U");
  });
});
