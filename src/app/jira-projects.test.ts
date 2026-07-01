import { describe, expect, it } from "vitest";
import {
  jiraProjectKeyOf,
  jiraProjectKeys,
  isReadOnlyIssue,
  sanitizeJiraExtraProjects,
} from "./jira-projects";
import { defaultJiraConfig, type JiraConfig } from "./settings-types";

function cfg(over: Partial<JiraConfig>): JiraConfig {
  return { ...defaultJiraConfig, ...over };
}

describe("jiraProjectKeyOf", () => {
  it("returns the substring before the first hyphen", () => {
    expect(jiraProjectKeyOf("OPS-123")).toBe("OPS");
    expect(jiraProjectKeyOf("ABC2-9")).toBe("ABC2");
  });
  it("returns the whole string when there is no hyphen", () => {
    expect(jiraProjectKeyOf("NOPE")).toBe("NOPE");
  });
});

describe("jiraProjectKeys", () => {
  it("returns just the primary when there are no extras", () => {
    expect(jiraProjectKeys(cfg({ projectKey: "LOP" }))).toEqual(["LOP"]);
  });
  it("unions primary + extras, deduped, empties dropped", () => {
    const c = cfg({
      projectKey: "LOP",
      extraProjects: [
        { key: "OPS", name: "Ops", readOnly: true },
        { key: "LOP", name: "dup", readOnly: false },
        { key: "", name: "blank", readOnly: true },
      ],
    });
    expect(jiraProjectKeys(c)).toEqual(["LOP", "OPS"]);
  });
  it("returns [] when the primary is blank and there are no extras", () => {
    expect(jiraProjectKeys(cfg({ projectKey: "" }))).toEqual([]);
  });
});

describe("isReadOnlyIssue", () => {
  const c = cfg({
    projectKey: "LOP",
    extraProjects: [
      { key: "OPS", name: "Ops", readOnly: true },
      { key: "DEV", name: "Dev", readOnly: false },
    ],
  });
  it("primary project is never read-only", () => {
    expect(isReadOnlyIssue("LOP-1", c)).toBe(false);
  });
  it("read-only extra project is read-only", () => {
    expect(isReadOnlyIssue("OPS-1", c)).toBe(true);
  });
  it("two-way extra project is not read-only", () => {
    expect(isReadOnlyIssue("DEV-1", c)).toBe(false);
  });
  it("unrecognized project defaults to read-only", () => {
    expect(isReadOnlyIssue("XXX-1", c)).toBe(true);
  });
});

describe("sanitizeJiraExtraProjects", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeJiraExtraProjects(undefined, "LOP")).toEqual([]);
    expect(sanitizeJiraExtraProjects("nope", "LOP")).toEqual([]);
  });
  it("keeps valid entries, defaults missing readOnly to true", () => {
    const out = sanitizeJiraExtraProjects([{ key: "OPS", name: "Ops" }], "LOP");
    expect(out).toEqual([{ key: "OPS", name: "Ops", readOnly: true }]);
  });
  it("coerces readOnly to a real boolean", () => {
    const out = sanitizeJiraExtraProjects([{ key: "OPS", name: "Ops", readOnly: false }], "LOP");
    expect(out[0].readOnly).toBe(false);
  });
  it("drops the primary, duplicates, blank/invalid keys", () => {
    const out = sanitizeJiraExtraProjects(
      [
        { key: "LOP", name: "primary", readOnly: true },
        { key: "OPS", name: "Ops", readOnly: true },
        { key: "OPS", name: "dup", readOnly: false },
        { key: "", name: "blank", readOnly: true },
        { key: "BAD KEY", name: "space", readOnly: true },
      ],
      "LOP",
    );
    expect(out).toEqual([{ key: "OPS", name: "Ops", readOnly: true }]);
  });
  it("caps the list at 20 entries", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `P${i}`, name: `p${i}`, readOnly: true }));
    expect(sanitizeJiraExtraProjects(many, "LOP")).toHaveLength(20);
  });
});
