import { describe, expect, it } from "vitest";
import { buildNewProjectWorkspace } from "./new-project-workspace";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { ProjectMeta } from "./types";

const tpl: ProjectTemplate = {
  id: "t",
  name: "T",
  features: ["raid"],
  fieldVisibility: { task: { fields: ["taskName"] } },
  seed: {
    tasks: [
      {
        id: 1,
        taskName: "S",
        assignee: "",
        assigneeEmail: "",
        dueDate: "",
        lastUpdateDate: "",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
        dependencies: [],
      },
    ],
  },
};

const meta: ProjectMeta = {
  name: "P",
  code: "P-1",
  projectManager: "PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "C",
  naceSection: "C",
  identityTypes: [],
  products: "",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "PC",
  contactPersons: [],
  regulatory: [],
};

describe("buildNewProjectWorkspace", () => {
  it("applies template field-visibility + seed + configured features", () => {
    const ws = buildNewProjectWorkspace(meta, {
      template: tpl,
      features: ["raid", "budget"],
      includeSeed: true,
    });
    expect(ws.project).toEqual(meta);
    expect(ws.fieldVisibility?.task.fields).toEqual(["taskName"]); // from template
    expect(ws.tasks).toHaveLength(1); // seed appended
    expect(ws.features).toEqual(["raid", "budget"]); // configured (overrides template's)
  });

  it("blank: no template → default field-visibility, configured features, no seed", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: false });
    expect(ws.fieldVisibility).toBeUndefined();
    expect(ws.features).toEqual([]);
    expect(ws.tasks).toHaveLength(0);
  });

  it("no opts → today's behavior (no features override)", () => {
    const ws = buildNewProjectWorkspace(meta, {});
    expect(ws.features).toBeUndefined();
    expect(ws.fieldVisibility).toBeUndefined();
  });
});

const aiSeed: TemplateSeed = {
  milestones: [{ id: 1, name: "Go-live", date: "2026-12-01", linkedTaskIds: [] }],
};

describe("buildNewProjectWorkspace aiSeed", () => {
  it("appends aiSeed when Blank + includeSeed", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(true);
  });

  it("ignores aiSeed when includeSeed is false", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: false, aiSeed });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(false);
  });

  it("ignores aiSeed when a template is chosen (template seed wins)", () => {
    const ws = buildNewProjectWorkspace(meta, {
      template: { id: "t", name: "T", features: [], fieldVisibility: {} } as never,
      features: [],
      includeSeed: true,
      aiSeed,
    });
    expect(ws.milestones?.some((m) => m.name === "Go-live")).toBe(false);
  });
});
