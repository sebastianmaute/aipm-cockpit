import { describe, it, expect } from "vitest";
import { sanitizeProjectMeta } from "./sanitize";
import { csvToProject } from "./csv-codecs-config";
import { markdownToProject } from "./markdown-codecs-core";

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
  it("rejects only a blank name, and garbage in the two enum fields", () => {
    expect(sanitizeProjectMeta({ ...valid, name: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, naceSection: "ZZ" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, deployment: "Quantum" })).toBeNull();
  });
  it("keeps a project whose only non-blank field is its name (O-1 data-loss pin)", () => {
    const m = sanitizeProjectMeta({ name: "Solo" });
    expect(m).not.toBeNull();
    expect(m).toMatchObject({
      name: "Solo", code: "", projectManager: "", customer: "", products: "",
      profitCenter: "", naceSection: "", deployment: "", startDate: "", endDate: "",
      keyStakeholdersInternal: [], keyStakeholdersExternal: [], identityTypes: [],
      contactPersons: [], regulatory: [],
    });
  });
  it("keeps every key fact blank when they arrive as empty strings", () => {
    const m = sanitizeProjectMeta({
      ...valid, code: "", projectManager: "", customer: "", products: "", profitCenter: "",
      naceSection: "", deployment: "", startDate: "", regulatory: [], contactPersons: [],
    });
    expect(m?.name).toBe("Apollo");
    expect(m?.naceSection).toBe("");
    expect(m?.deployment).toBe("");
    expect(m?.startDate).toBe("");
    expect(m?.regulatory).toEqual([]);
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
  it("keeps a positive contact-person resourceId and drops non-positive ones", () => {
    const m = sanitizeProjectMeta({ ...valid, contactPersons: [
      { name: "Linked", email: "l@x.test", synced: false, resourceId: 7 },
      { name: "Zero", email: "z@x.test", synced: false, resourceId: 0 },
      { name: "Neg", email: "n@x.test", synced: false, resourceId: -1 },
    ]});
    expect(m?.contactPersons[0].resourceId).toBe(7);
    expect(m?.contactPersons[1].resourceId).toBeUndefined();
    expect(m?.contactPersons[2].resourceId).toBeUndefined();
  });
});

describe("project text decoders keep a name-only project (O-1)", () => {
  it("CSV", () => {
    const m = csvToProject("field,value\nname,Solo\n");
    expect(m?.name).toBe("Solo");
    expect(m?.code).toBe("");
  });
  it("Markdown", () => {
    const m = markdownToProject("- name: Solo\n");
    expect(m?.name).toBe("Solo");
    expect(m?.deployment).toBe("");
  });
});
