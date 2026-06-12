import { describe, expect, it } from "vitest";
import { buildNewProjectWorkspace } from "./new-project-workspace";
import type { ProjectTemplate } from "./templates";
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
