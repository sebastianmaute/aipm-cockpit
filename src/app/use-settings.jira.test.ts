import { describe, expect, it } from "vitest";
import { sanitizeJiraExtraProjects } from "./jira-projects";

// The load path applies sanitizeJiraExtraProjects to the merged jira config.
// This test pins that a corrupt stored array is cleaned against the primary key.
describe("jira extraProjects load sanitization", () => {
  it("drops the primary-colliding + invalid entries", () => {
    const raw = [
      { key: "LOP", name: "primary", readOnly: true },
      { key: "OPS", name: "Ops" },
      { key: "x y", name: "bad", readOnly: true },
    ];
    expect(sanitizeJiraExtraProjects(raw, "LOP")).toEqual([
      { key: "OPS", name: "Ops", readOnly: true },
    ]);
  });
});
