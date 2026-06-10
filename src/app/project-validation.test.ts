import { describe, it, expect } from "vitest";
import { validateProjectMeta, hasProjectErrors, type ProjectDraft } from "./project-validation";

const ok: ProjectDraft = {
  name: "A", code: "C1", projectManager: "PM",
  keyStakeholdersInternal: ["x"], keyStakeholdersExternal: ["y"],
  customer: "Cust", naceSection: "C", products: "P", deployment: "Cloud",
  startDate: "2026-01-01", endDate: "2026-02-01", profitCenter: "PC",
  regulatory: ["DORA"], identityTypes: [], contactPersons: [],
  salesforceUrl: "", sharepointUrl: "", confluenceUrl: "",
};

describe("validateProjectMeta", () => {
  it("passes a valid draft", () => {
    expect(hasProjectErrors(validateProjectMeta(ok))).toBe(false);
  });
  it("flags every missing required field", () => {
    const e = validateProjectMeta({ ...ok, name: "", customer: "", products: "",
      profitCenter: "", projectManager: "", code: "", naceSection: "",
      keyStakeholdersInternal: [], keyStakeholdersExternal: [], regulatory: [] });
    expect(e.name).toBe("errorProjectNameRequired");
    expect(e.code).toBe("errorProjectCodeRequired");
    expect(e.regulatory).toBe("errorRegulatoryRequired");
    expect(e.keyStakeholdersInternal).toBeDefined();
  });
  it("flags endDate before startDate", () => {
    expect(validateProjectMeta({ ...ok, endDate: "2025-01-01" }).endDate).toBe("errorEndBeforeStart");
  });
  it("flags a malformed URL but allows blank", () => {
    expect(validateProjectMeta({ ...ok, salesforceUrl: "not a url" }).salesforceUrl).toBe("errorInvalidUrl");
    expect(validateProjectMeta({ ...ok, salesforceUrl: "https://x.test" }).salesforceUrl).toBeUndefined();
  });
});
