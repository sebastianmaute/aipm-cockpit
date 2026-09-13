// src/app/next-actions/providers/project-meta.test.ts
import { describe, expect, it } from "vitest";
import { projectMetaProvider, PROJECT_META_WEIGHT } from "./project-meta";
import { computeNextActions } from "../engine";
import { groupNextActions } from "../group";
import { overflowCtas, pickPrimaryCta, type ActionCaps } from "../action-cta";
import { TIER_NOW } from "../score";
import { BIAS_CAP } from "../../action-learning";
import { KEY_FACT_IDS } from "../../project-key-facts";
import type { ActionInput } from "../types";
import type { ProjectMeta } from "../../types";

const TODAY = "2026-09-13";

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
  code: "", projectManager: "", customer: "", naceSection: "", products: "",
  deployment: "", startDate: "", profitCenter: "", contactPersons: [], regulatory: [],
};

function input(over: Partial<ActionInput> = {}): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: {} as ActionInput["dashboard"],
    features: [],
    today: TODAY,
    now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 0,
    dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30,
    dismissed: new Set(),
    projectName: "Apollo",
    commsReminders: [],
    ...over,
  } as ActionInput;
}

const ALL_CAPS: ActionCaps = {
  assign: true, draft: true, escalate: true, rebaseline: true, snapshotActive: true,
  reschedule: true, markDone: true, clearBlocker: true, snooze: true, createTask: true,
};

describe("projectMetaProvider — absent input", () => {
  it("returns [] when projectMeta is absent", () => {
    expect(projectMetaProvider.provide(input({ projectId: "p1" }))).toEqual([]);
  });

  it("returns [] when projectId is absent", () => {
    expect(projectMetaProvider.provide(input({ projectMeta: NAME_ONLY }))).toEqual([]);
  });

  it("is core — it declares no moduleId", () => {
    expect(projectMetaProvider.moduleId).toBeUndefined();
  });
});

describe("projectMetaProvider — one action per missing fact", () => {
  it("returns [] for a complete project", () => {
    expect(projectMetaProvider.provide(input({ projectId: "p1", projectMeta: FULL }))).toEqual([]);
  });

  const acts = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: NAME_ONLY }));

  it("emits ten actions for a name-only project, none for name", () => {
    expect(acts.map((a) => a.id).sort()).toEqual(
      KEY_FACT_IDS.filter((id) => id !== "name").map((id) => `project-meta:p1:${id}`).sort(),
    );
  });

  it("never emits a name action, even for a blank in-memory name", () => {
    const blankName = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: { ...FULL, name: "" } }));
    expect(blankName).toEqual([]);
  });

  it("deep-links every action to the Projects view with the project id", () => {
    for (const a of acts) expect(a.cta).toEqual({ kind: "open", view: "projects", id: "p1" });
  });

  it("titles every action with the project's name and uses its own source", () => {
    for (const a of acts) {
      expect(a.source).toBe("project-meta");
      expect(a.title).toEqual({ key: "actionProjectMetaTitle", params: ["Apollo"] });
    }
  });

  it("gives every missing fact a distinct why key", () => {
    expect(new Set(acts.map((a) => a.why.key)).size).toBe(acts.length);
  });

  it("maps a single missing fact to its own why key", () => {
    const one = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: { ...FULL, customer: "" } }));
    expect(one).toHaveLength(1);
    expect(one[0].why).toEqual({ key: "actionProjectMetaWhyCustomer" });
  });
});

describe("projectMetaProvider — ranking", () => {
  const acts = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: NAME_ONLY }));

  it("collapses to ONE group whose primary is the project code and whose extras are the other nine", () => {
    const groups = groupNextActions(acts);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("projects:p1");
    expect(groups[0].primary.why.key).toBe("actionProjectMetaWhyCode");
    expect(groups[0].extra).toHaveLength(9);
  });

  it("leads with identity facts, then the start date, then the rest", () => {
    const w = PROJECT_META_WEIGHT;
    expect(w.code).toBeGreaterThan(w.projectManager);
    expect(w.projectManager).toBeGreaterThan(w.customer);
    expect(w.customer).toBeGreaterThan(w.startDate);
    for (const k of ["products", "profitCenter", "naceSection", "deployment", "contactPersons", "regulatory"] as const) {
      expect(w.startDate).toBeGreaterThan(w[k]);
    }
  });

  it("never reaches tier now from the provider", () => {
    for (const a of acts) expect(a.tier).not.toBe("now");
  });

  // Ruling 5: pinned THROUGH the engine, at the maximum learned bias.
  it("never reaches tier now through the engine even at +BIAS_CAP learned bias on every kind", () => {
    const learnedBias = Object.fromEntries(acts.map((a) => [`project-meta:${a.why.key}`, BIAS_CAP]));
    const ranked = computeNextActions(input({ projectId: "p1", projectMeta: NAME_ONLY, learnedBias }), [projectMetaProvider]);
    expect(ranked).toHaveLength(10);
    for (const a of ranked) expect(a.score).toBeLessThan(TIER_NOW);
  });

  it("attaches no task verbs: the primary is open, and the overflow holds no mark-done or draft", () => {
    for (const a of acts) {
      expect(pickPrimaryCta(a, ALL_CAPS)).toBe("open");
      expect(overflowCtas(a, ALL_CAPS)).not.toContain("markDone");
      expect(overflowCtas(a, ALL_CAPS)).not.toContain("draft");
    }
  });
});
