import { describe, expect, it } from "vitest";
import { KEY_FACT_IDS, keyFactCompleteness, type KeyFactId } from "./project-key-facts";
import { sanitizeProjectMeta } from "./sanitize-records";
import type { ProjectMeta } from "./types";

const FULL: ProjectMeta = {
  name: "Apollo",
  code: "APL-1",
  projectManager: "Dana PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "ACME Corp",
  naceSection: "C",
  identityTypes: [],
  products: "Widget",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "",
  profitCenter: "PC-9",
  contactPersons: [{ name: "Pat Contact", email: "", synced: false }],
  regulatory: ["GDPR / data protection regulation"],
};

const NAME_ONLY: ProjectMeta = {
  ...FULL,
  code: "",
  projectManager: "",
  customer: "",
  naceSection: "",
  products: "",
  deployment: "",
  startDate: "",
  profitCenter: "",
  contactPersons: [],
  regulatory: [],
};

describe("KEY_FACT_IDS", () => {
  it("lists the eleven facts O-1 de-mandated, in declaration order", () => {
    expect([...KEY_FACT_IDS]).toEqual([
      "name", "code", "projectManager", "customer", "products", "profitCenter",
      "naceSection", "deployment", "contactPersons", "regulatory", "startDate",
    ]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(KEY_FACT_IDS)).toBe(true);
  });
});

describe("keyFactCompleteness", () => {
  it("reports 11 of 11 with nothing missing for a complete project", () => {
    expect(keyFactCompleteness(FULL)).toEqual({ filled: 11, total: 11, missing: [] });
  });

  it("reports 1 of 11 for a name-only project, missing listed in declaration order", () => {
    expect(keyFactCompleteness(NAME_ONLY)).toEqual({
      filled: 1,
      total: 11,
      missing: KEY_FACT_IDS.filter((id) => id !== "name"),
    });
  });

  it("counts a partially filled project", () => {
    const r = keyFactCompleteness({ ...FULL, code: "", regulatory: [] });
    expect(r).toEqual({ filled: 9, total: 11, missing: ["code", "regulatory"] });
  });

  it("treats a whitespace-only string as missing", () => {
    expect(keyFactCompleteness({ ...FULL, customer: "   " }).missing).toEqual(["customer"]);
  });

  it("treats a blank deployment and a blank NACE section as missing (MR A made both valid)", () => {
    expect(keyFactCompleteness({ ...FULL, deployment: "", naceSection: "" }).missing).toEqual([
      "naceSection", "deployment",
    ]);
  });

  it("treats a blank name as missing (an in-memory draft can hold one)", () => {
    expect(keyFactCompleteness({ ...FULL, name: "" }).missing).toEqual(["name"]);
  });

  it("reads a field absent from an unsanitized record as missing instead of throwing", () => {
    // The shape a version restore can hand over: only the keys its payload carried.
    const partial = { name: "Seed", code: "SEED" } as unknown as ProjectMeta;
    expect(keyFactCompleteness(partial)).toEqual({
      filled: 2,
      total: 11,
      missing: KEY_FACT_IDS.filter((id) => id !== "name" && id !== "code"),
    });
  });
});

// Ruling 1: the model mirrors what the SANITIZER normalises to blank. A model
// that disagreed would render a meter contradicting what every backend stores.
describe("keyFactCompleteness mirrors sanitizeProjectMeta's blank rules", () => {
  const STRING_FACTS: KeyFactId[] = [
    "code", "projectManager", "customer", "products", "profitCenter", "naceSection", "deployment", "startDate",
  ];

  it.each(STRING_FACTS)("a whitespace %s survives sanitising as blank and reads missing", (id) => {
    const sanitized = sanitizeProjectMeta({ ...FULL, [id]: "   " });
    expect(sanitized).not.toBeNull();
    expect(keyFactCompleteness(sanitized!).missing).toEqual([id]);
  });

  it("an absent field reads the same before and after sanitising", () => {
    const partial = { name: "Seed", code: "SEED" };
    const sanitized = sanitizeProjectMeta(partial);
    expect(sanitized).not.toBeNull();
    expect(keyFactCompleteness(partial as unknown as ProjectMeta)).toEqual(keyFactCompleteness(sanitized!));
  });

  it("a contact person with a blank name is dropped by the sanitizer and reads missing", () => {
    const sanitized = sanitizeProjectMeta({ ...FULL, contactPersons: [{ name: "  ", email: "", synced: false }] });
    expect(keyFactCompleteness(sanitized!).missing).toEqual(["contactPersons"]);
  });

  it("an unknown regulatory entry is dropped by the sanitizer and reads missing", () => {
    const sanitized = sanitizeProjectMeta({ ...FULL, regulatory: ["not a real requirement"] });
    expect(keyFactCompleteness(sanitized!).missing).toEqual(["regulatory"]);
  });

  it("a complete project survives sanitising as 11 of 11", () => {
    expect(keyFactCompleteness(sanitizeProjectMeta(FULL)!).filled).toBe(11);
  });

  it("a blank name cannot be persisted — the sanitizer rejects the record, so a saved project floors at 1 of 11", () => {
    expect(sanitizeProjectMeta({ ...FULL, name: "   " })).toBeNull();
  });
});
