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
        description: "",
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

const HOSTILE = "<p>ok</p><script>alert(1)</script>";

/** A seed shaped like one `proposalToSeed` returns, carrying a hostile rich
 *  field on each of the three entities that reach the workspace without an
 *  allow-list pass today (§288) — the AI-seed branch of
 *  `buildNewProjectWorkspace` runs `appendSeed(ws, remapSeed(ws, opts.aiSeed))`
 *  directly, never through `applyTemplate`, which is the only place the four
 *  allow-list passes (`allowListRich`/`allowListRaid`/`allowListChange`/the
 *  milestone one) live. */
function hostileSeed() {
  return {
    raid: [{ id: 1, title: "R", description: HOSTILE, mitigation: HOSTILE }],
    changes: [{ id: 1, title: "C", description: HOSTILE, impactDescription: HOSTILE, resolutionNotes: HOSTILE }],
    milestones: [{ id: 1, name: "M", description: HOSTILE }],
  } as never;
}

describe("buildNewProjectWorkspace — the AI-seed branch is allow-listed (§288)", () => {
  it("strips a script element from a seeded RAID description", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.raid[0].description).not.toContain("<script");
  });

  it("strips a script element from a seeded RAID mitigation", () => {
    // ★ SEPARATE it() ON PURPOSE. vitest aborts at the first failing hard
    // assertion, so a second expect in the block above would be UNPROVED on a
    // tree where the first one fails — which is exactly the tree this suite is
    // written against.
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.raid[0].mitigation).not.toContain("<script");
  });

  it("strips a script element from a seeded change's three rich fields", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    const c = ws.changes![0];
    expect([c.description, c.impactDescription, c.resolutionNotes].join("")).not.toContain("<script");
  });

  it("strips a script element from a seeded milestone description", () => {
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.milestones![0].description).not.toContain("<script");
  });

  it("seeds the rows at all (anti-vacuity)", () => {
    // ★★ WITHOUT THIS, every assertion above passes on an empty workspace. A
    // seed branch that silently dropped all three entities would satisfy
    // "does not contain <script>" perfectly.
    const ws = buildNewProjectWorkspace(meta, { features: [], includeSeed: true, aiSeed: hostileSeed() });
    expect(ws.raid).toHaveLength(1);
    expect(ws.changes).toHaveLength(1);
    expect(ws.milestones).toHaveLength(1);
  });
});
