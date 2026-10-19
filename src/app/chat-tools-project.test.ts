import { describe, expect, it, vi } from "vitest";
import { entityToken } from "./ai-entity-token";
import { PROJECT_TOOL_DEFS } from "./chat-tool-defs-project";
import { NOT_PROJECT_TOOL, runProjectTool, type ProjectToolDispatcher } from "./chat-tools-project";
import { PROJECT_AI_EXCLUDED, PROJECT_AI_FIELDS } from "./project-ai-fields";
import type { ProjectMeta } from "./types";

const STORED: ProjectMeta = {
  name: "Apollo",
  code: "AP-1",
  description: "Moon programme",
  projectManager: "Pat",
  keyStakeholdersInternal: ["Kim"],
  keyStakeholdersExternal: ["Lee"],
  customer: "Acme",
  naceSection: "C",
  identityTypes: ["B2B"],
  products: "Rockets",
  deployment: "Cloud",
  startDate: "2030-01-01",
  endDate: "2030-12-31",
  profitCenter: "PC1",
  jiraUrl: "https://jira.example.com/browse/AP",
  contactPersons: [{ id: 1, name: "Dana", email: "dana@example.com" } as ProjectMeta["contactPersons"][number]],
  regulatory: [],
  knowledgeLinks: [],
};

function fake(stored: ProjectMeta | null = STORED) {
  return {
    getProjectMeta: vi.fn((): ProjectMeta | null => stored),
    updateProjectMeta: vi.fn(async (next: ProjectMeta) => next),
  } satisfies ProjectToolDispatcher;
}

/** The handled branch of `runProjectTool`, awaited; a name it does not own fails the test. */
async function call(name: string, input: Record<string, unknown>, d: ProjectToolDispatcher) {
  const result = runProjectTool(name, input, d);
  if (result === NOT_PROJECT_TOOL) throw new Error(`${name} was not routed`);
  return (await result) as Record<string, unknown>;
}

const TOKEN = entityToken("project", STORED);

describe("get_project", () => {
  it("get_project returns the offered fields and a token, never an excluded field", async () => {
    const result = await call("get_project", {}, fake());
    expect(Object.keys(result).sort()).toEqual([...PROJECT_AI_FIELDS, "expectedToken"].sort());
    expect(result.expectedToken).toBe(TOKEN);
    expect(result.customer).toBe("Acme");
    expect(result.identityTypes).toEqual(["B2B"]);
    for (const key of Object.keys(PROJECT_AI_EXCLUDED)) expect(result).not.toHaveProperty(key);
  });

  it("refuses when no project is open", async () => {
    await expect(call("get_project", {}, fake(null))).rejects.toThrow(/no project/i);
  });
});

describe("update_project", () => {
  it("update_project with a stale token is refused and nothing is written", async () => {
    const d = fake();
    await expect(call("update_project", { expectedToken: "stale", sponsor: "Sam" }, d)).rejects.toThrow(/expectedToken/);
    await expect(call("update_project", { sponsor: "Sam" }, d)).rejects.toThrow(/expectedToken/);
    expect(d.updateProjectMeta).not.toHaveBeenCalled();
  });

  it("update_project changes only the passed fields", async () => {
    const d = fake();
    const result = await call("update_project", { expectedToken: TOKEN, sponsor: "Sam" }, d);
    expect(d.updateProjectMeta).toHaveBeenCalledTimes(1);
    expect(d.updateProjectMeta.mock.calls[0][0]).toEqual({ ...STORED, sponsor: "Sam" });
    const project = result.project as Record<string, unknown>;
    expect(project.customer).toBe("Acme");
    expect(project.sponsor).toBe("Sam");
    expect(result.refused).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it("update_project keeps a refused field at its stored value and reports it", async () => {
    const d = fake();
    const result = await call("update_project", { expectedToken: TOKEN, sponsor: "Sam", jiraUrl: "javascript:x" }, d);
    expect(d.updateProjectMeta).toHaveBeenCalledTimes(1);
    expect(d.updateProjectMeta.mock.calls[0][0].jiraUrl).toBe(STORED.jiraUrl);
    expect(d.updateProjectMeta.mock.calls[0][0].sponsor).toBe("Sam");
    const refused = result.refused as { field: string; reason: string }[];
    expect(refused).toHaveLength(1);
    expect(refused[0].field).toBe("jiraUrl");
    expect(refused[0].reason).toMatch(/http/);
  });

  it("a patch with only refused fields writes nothing", async () => {
    const d = fake();
    const result = await call("update_project", { expectedToken: TOKEN, jiraUrl: "javascript:x" }, d);
    expect(d.updateProjectMeta).not.toHaveBeenCalled();
    expect((result.refused as unknown[]).length).toBeGreaterThan(0);
    expect((result.project as Record<string, unknown>).jiraUrl).toBe(STORED.jiraUrl);
  });

  it("reports keys that are not offered fields as ignored and never writes them", async () => {
    const d = fake();
    const result = await call(
      "update_project",
      { expectedToken: TOKEN, sponsor: "Sam", id: 4, contactPersons: [], knowledgeLinks: [{ url: "x" }] },
      d,
    );
    expect([...(result.ignored as string[])].sort()).toEqual(["contactPersons", "id", "knowledgeLinks"]);
    const written = d.updateProjectMeta.mock.calls[0][0];
    expect(written.contactPersons).toEqual(STORED.contactPersons);
    expect(written.knowledgeLinks).toEqual([]);
    expect(written).not.toHaveProperty("id");
    expect(written).not.toHaveProperty("expectedToken");
  });

  it("read-only window refuses update_project", async () => {
    const d = fake();
    d.updateProjectMeta.mockRejectedValueOnce(new Error("This window is read-only."));
    await expect(call("update_project", { expectedToken: TOKEN, sponsor: "Sam" }, d)).rejects.toThrow(
      "This window is read-only.",
    );
  });

  it("returns the project the dispatcher wrote, not the patch", async () => {
    const d = fake();
    d.updateProjectMeta.mockResolvedValueOnce({ ...STORED, sponsor: "Stored form" });
    const result = await call("update_project", { expectedToken: TOKEN, sponsor: "Sam" }, d);
    expect((result.project as Record<string, unknown>).sponsor).toBe("Stored form");
  });
});

describe("the project token", () => {
  // ★ It covers EVERY column, the hand-edited ones too: a human editing a contact person after Claude read the
  //   project makes the read stale, the safe direction. Excluding them would buy nothing, since Claude never writes them.
  it("moves when a field Claude cannot set changes, and when one it can", () => {
    expect(entityToken("project", { ...STORED, contactPersons: [] })).not.toBe(TOKEN);
    expect(entityToken("project", { ...STORED, sponsor: "Sam" })).not.toBe(TOKEN);
    expect(entityToken("project", { ...STORED })).toBe(TOKEN);
  });
});

describe("routing", () => {
  it("returns the sentinel for a name it does not own, without touching the dispatcher", () => {
    const d = fake();
    expect(runProjectTool("list_tasks", {}, d)).toBe(NOT_PROJECT_TOOL);
    expect(d.getProjectMeta).not.toHaveBeenCalled();
  });
});

describe("PROJECT_TOOL_DEFS", () => {
  const byName = new Map(PROJECT_TOOL_DEFS.map((def) => [def.name, def]));

  it("defines get_project and update_project, neither taking an id", () => {
    expect([...byName.keys()].sort()).toEqual(["get_project", "update_project"]);
    for (const def of PROJECT_TOOL_DEFS) {
      expect(Object.keys((def.input_schema as { properties?: object }).properties ?? {})).not.toContain("id");
    }
  });

  it("update_project advertises exactly the offered fields plus a required token", () => {
    const schema = byName.get("update_project")!.input_schema as { properties: object; required: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual([...PROJECT_AI_FIELDS, "expectedToken"].sort());
    expect(schema.required).toEqual(["expectedToken"]);
  });

  it("update_project says what it changes and what it cannot", () => {
    const text = byName.get("update_project")!.description;
    expect(text).toContain(
      "Only the fields you pass change. Contact persons, key-stakeholder lists and knowledge links are not editable here.",
    );
    for (const field of PROJECT_AI_FIELDS) expect(text).toContain(field);
  });
});
