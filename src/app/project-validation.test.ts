import { describe, it, expect } from "vitest";
import { validateProjectMeta, hasProjectErrors, type ProjectDraft } from "./project-validation";

const ok: ProjectDraft = {
  name: "A", code: "C1", projectManager: "PM",
  keyStakeholdersInternal: ["x"], keyStakeholdersExternal: ["y"],
  customer: "Cust", naceSection: "C", products: "P", deployment: "Cloud",
  startDate: "2026-01-01", endDate: "2026-02-01", profitCenter: "PC",
  regulatory: ["DORA"], identityTypes: [],
  contactPersons: [{ name: "Pat", email: "", synced: false }],
  salesforceUrl: "", sharepointUrl: "", confluenceUrl: "", jiraUrl: "",
};

describe("validateProjectMeta", () => {
  it("passes a valid draft", () => {
    expect(hasProjectErrors(validateProjectMeta(ok))).toBe(false);
  });
  it("flags a blank name and nothing else when every key fact is blank (O-1)", () => {
    const e = validateProjectMeta({
      ...ok, name: "", code: "", projectManager: "", customer: "", naceSection: "",
      products: "", deployment: "", startDate: "", endDate: "", profitCenter: "",
      contactPersons: [], regulatory: [],
    });
    expect(e).toEqual({ name: "errorProjectNameRequired" });
  });
  it("accepts a draft carrying a name alone (O-1)", () => {
    const e = validateProjectMeta({
      ...ok, name: "Solo", code: "", projectManager: "", customer: "", naceSection: "",
      products: "", deployment: "", startDate: "", endDate: "", profitCenter: "",
      contactPersons: [], regulatory: [],
    });
    expect(hasProjectErrors(e)).toBe(false);
  });
  it("does not flag end-before-start while the start date is blank", () => {
    expect(validateProjectMeta({ ...ok, startDate: "", endDate: "2025-01-01" }).endDate).toBeUndefined();
  });
  it("flags endDate before startDate", () => {
    expect(validateProjectMeta({ ...ok, endDate: "2025-01-01" }).endDate).toBe("errorEndBeforeStart");
  });
  it("treats end date as optional (no error when blank)", () => {
    expect(validateProjectMeta({ ...ok, endDate: "" }).endDate).toBeUndefined();
  });
  it("a complete draft with no end date has no errors (Next enabled)", () => {
    expect(hasProjectErrors(validateProjectMeta({ ...ok, endDate: "" }))).toBe(false);
  });
  it("flags a malformed URL but allows blank", () => {
    expect(validateProjectMeta({ ...ok, salesforceUrl: "not a url" }).salesforceUrl).toBe("errorInvalidUrl");
    expect(validateProjectMeta({ ...ok, salesforceUrl: "https://x.test" }).salesforceUrl).toBeUndefined();
  });
});
