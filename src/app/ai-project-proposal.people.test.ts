// AI people protection, Task 6 (R4): a "Use AI" project proposal carries no person when the project
// protects its people — the seeded tasks and risks are applied without their assignees and owners.
import { describe, it, expect } from "vitest";
import { parseProposal, proposalToDraftPatch, proposalToSeed, withoutProposalPeople, type ProjectProposal } from "./ai-project-proposal";

const TODAY = "2026-10-30";

function proposal(): ProjectProposal {
  return parseProposal({
    meta: { name: "CRM rollout", sponsor: "Zelda Quartz", projectManager: "Yuri Pell", customer: "Acme" },
    features: [],
    seed: {
      tasks: [{ taskName: "Kick-off", dueDate: "2026-11-05", assignee: "Yuri Pell" }],
      raid: [{ title: "Vendor late", category: "R", owner: "Zelda Quartz", ownerEmail: "zq@acme.io" }],
      stakeholders: [{ name: "Zelda Quartz", title: "Sponsor" }],
      resources: [{ firstName: "Yuri", lastName: "Pell" }],
      milestones: [{ name: "Go-live", date: "2026-12-01" }],
    },
  })!;
}

describe("withoutProposalPeople", () => {
  it("applies the seeded items without their people, and seeds no people records", () => {
    const p = withoutProposalPeople(proposal(), true);
    const seed = proposalToSeed(p, TODAY)!;
    expect(seed.tasks?.map((t) => [t.taskName, t.assignee])).toEqual([["Kick-off", ""]]);
    expect(seed.raid?.map((r) => [r.title, r.owner ?? "", r.ownerEmail ?? ""])).toEqual([["Vendor late", "", ""]]);
    expect(seed.stakeholders).toBeUndefined();
    expect(seed.resources).toBeUndefined();
    expect(seed.milestones).toHaveLength(1); // the rest applies
    const draft = proposalToDraftPatch(p);
    expect(draft).not.toHaveProperty("sponsor");
    expect(draft).not.toHaveProperty("projectManager");
    expect(draft).toMatchObject({ name: "CRM rollout", customer: "Acme" });
  });

  it("never mutates the proposal it is given", () => {
    const p = proposal();
    withoutProposalPeople(p, true);
    expect(p.meta.sponsor).toBe("Zelda Quartz");
    expect((p.seed!.tasks![0] as { assignee: string }).assignee).toBe("Yuri Pell");
  });

  // The positive control: allowed, the people come through as proposed.
  it("protection off: the proposal is unchanged", () => {
    const p = proposal();
    expect(withoutProposalPeople(p, false)).toBe(p);
    const seed = proposalToSeed(p, TODAY)!;
    expect(seed.tasks?.[0]?.assignee).toBe("Yuri Pell");
    expect(seed.raid?.[0]?.owner).toBe("Zelda Quartz");
    expect(seed.stakeholders).toHaveLength(1);
    expect(seed.resources).toHaveLength(1);
    expect(proposalToDraftPatch(p)).toMatchObject({ sponsor: "Zelda Quartz", projectManager: "Yuri Pell" });
  });
});
