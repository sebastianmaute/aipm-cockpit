import { describe, expect, it } from "vitest";
import { jsonToWorkspace } from "./workspace";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { markdownToWorkspace, workspaceToMarkdown } from "./storage";

// `jsonToWorkspace` runs `sanitizeProjectMeta`, which drops a project meta that
// is missing required fields. Use a complete valid meta (mirrors the validBase
// in sanitize.test.ts) so the round-trip genuinely carries `operatingTimezone`.
const validProject = {
  name: "P", code: "P", projectManager: "M", customer: "X", products: "Y",
  profitCenter: "Z", naceSection: "A", deployment: "Cloud",
  identityTypes: [], identityCount: "0", regulatory: ["Not applicable"],
  keyStakeholdersInternal: [], keyStakeholdersExternal: [],
  startDate: "2026-01-01", endDate: "2026-02-01", contactPersons: [],
  operatingTimezone: "Asia/Kolkata",
};

const ws = jsonToWorkspace(JSON.stringify({
  tasks: [], raid: [], project: validProject,
}));

describe("operatingTimezone persistence", () => {
  it("round-trips through CSV", () => {
    expect(csvToWorkspace(workspaceToCsv(ws)).project?.operatingTimezone).toBe("Asia/Kolkata");
  });
  it("round-trips through Markdown", () => {
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).project?.operatingTimezone).toBe("Asia/Kolkata");
  });
  it("a project without operatingTimezone stays undefined", () => {
    const bareProject = { ...validProject, operatingTimezone: undefined };
    const bare = jsonToWorkspace(JSON.stringify({ tasks: [], raid: [], project: bareProject }));
    expect(csvToWorkspace(workspaceToCsv(bare)).project?.operatingTimezone).toBeUndefined();
  });
});
