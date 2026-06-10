import { describe, it, expect } from "vitest";
import { sanitizeProjectMeta } from "./sanitize";

const valid = {
  name: "Apollo", code: "APL-1", projectManager: "Jane",
  keyStakeholdersInternal: ["Bob"], keyStakeholdersExternal: ["Cara"],
  customer: "Acme", naceSection: "C", identityTypes: ["B2B", "NHI"],
  identityCount: 1200, products: "Widget", deployment: "Cloud",
  startDate: "2026-01-01", endDate: "2026-12-31", profitCenter: "PC-9",
  contactPersons: [{ name: "Dee", email: "dee@acme.test", synced: true }],
  regulatory: ["GDPR / data protection regulation", "NIS2"],
};

describe("sanitizeProjectMeta", () => {
  it("accepts a fully valid object", () => {
    const m = sanitizeProjectMeta(valid);
    expect(m?.name).toBe("Apollo");
    expect(m?.identityTypes).toEqual(["B2B", "NHI"]);
    expect(m?.contactPersons[0].synced).toBe(true);
  });
  it("returns null when a required field is missing", () => {
    expect(sanitizeProjectMeta({ ...valid, name: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, customer: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, naceSection: "ZZ" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, deployment: "Quantum" })).toBeNull();
  });
  it("drops unknown enum members and de-dupes identity types", () => {
    const m = sanitizeProjectMeta({ ...valid, identityTypes: ["B2B", "B2B", "junk"] });
    expect(m?.identityTypes).toEqual(["B2B"]);
  });
  it("collapses regulatory to ['Not applicable'] when present with others", () => {
    const m = sanitizeProjectMeta({ ...valid, regulatory: ["Not applicable", "DORA"] });
    expect(m?.regulatory).toEqual(["Not applicable"]);
  });
  it("coerces identityCount to a non-negative integer or drops it", () => {
    expect(sanitizeProjectMeta({ ...valid, identityCount: -5 })?.identityCount).toBeUndefined();
    expect(sanitizeProjectMeta({ ...valid, identityCount: "1200" })?.identityCount).toBe(1200);
  });
  it("keeps only well-formed contact persons", () => {
    const m = sanitizeProjectMeta({ ...valid, contactPersons: [
      { name: "Ok", email: "ok@x.test", synced: false },
      { name: "", email: "bad", synced: true },
    ]});
    expect(m?.contactPersons).toHaveLength(1);
    expect(m?.contactPersons[0].synced).toBe(false);
  });
  it("returns null for non-objects", () => {
    expect(sanitizeProjectMeta(null)).toBeNull();
    expect(sanitizeProjectMeta("x")).toBeNull();
  });
});
