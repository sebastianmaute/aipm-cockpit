import { describe, expect, it } from "vitest";
import {
  parseProposal,
  PROPOSAL_TOOL,
  proposalToDraftPatch,
  proposalToSeed,
  seedHasContent,
  SEED_CAP_PER_ENTITY,
} from "./ai-project-proposal";
import { ALL_MODULE_IDS } from "./feature-modules";

describe("parseProposal", () => {
  it("returns null for a non-object or missing name", () => {
    expect(parseProposal(null)).toBeNull();
    expect(parseProposal({ meta: {}, features: [] })).toBeNull();
    expect(parseProposal({ meta: { name: "   " }, features: [] })).toBeNull();
  });

  it("keeps a valid proposal and drops unknown feature ids", () => {
    const p = parseProposal({
      meta: { name: "CRM Migration", products: "Salesforce" },
      features: [ALL_MODULE_IDS[0], "not-a-module", ALL_MODULE_IDS[1]],
      seed: { milestones: [{ name: "Go-live", date: "2026-12-01" }] },
    });
    expect(p).not.toBeNull();
    expect(p!.meta.name).toBe("CRM Migration");
    expect(p!.features).toEqual([ALL_MODULE_IDS[0], ALL_MODULE_IDS[1]]);
    expect(p!.seed?.milestones?.length).toBe(1);
  });
});

describe("PROPOSAL_TOOL", () => {
  it("forces a single structured tool named propose_project", () => {
    expect(PROPOSAL_TOOL.name).toBe("propose_project");
    expect(PROPOSAL_TOOL.input_schema.type).toBe("object");
    expect(PROPOSAL_TOOL.input_schema.properties.meta).toBeDefined();
    expect(PROPOSAL_TOOL.input_schema.properties.features).toBeDefined();
  });
});

const TODAY = "2026-06-19";

describe("proposalToDraftPatch", () => {
  it("maps known meta fields to draft string fields", () => {
    const patch = proposalToDraftPatch({
      meta: { name: "Alpha", products: "Widget", customer: "ACME", startDate: "2026-07-01" },
      features: [],
    });
    expect(patch.name).toBe("Alpha");
    expect(patch.products).toBe("Widget");
    expect(patch.customer).toBe("ACME");
    expect(patch.startDate).toBe("2026-07-01");
    // Unsupplied fields are absent (not "")
    expect("jiraUrl" in patch).toBe(false);
  });

  it("keeps a safe http(s) jiraUrl but drops a javascript: URL from model output", () => {
    expect(
      proposalToDraftPatch({ meta: { name: "X", jiraUrl: "https://acme.atlassian.net" }, features: [] }).jiraUrl,
    ).toBe("https://acme.atlassian.net");
    const unsafe = proposalToDraftPatch({ meta: { name: "X", jiraUrl: "javascript:alert(1)" }, features: [] });
    expect("jiraUrl" in unsafe).toBe(false);
  });
});

describe("proposalToSeed", () => {
  it("validates, assigns ids, and caps each list", () => {
    const many = Array.from({ length: SEED_CAP_PER_ENTITY + 4 }, (_, i) => ({ title: `Risk ${i}`, category: "R" }));
    const seed = proposalToSeed({ meta: { name: "x" }, features: [], seed: { raid: many } }, TODAY);
    expect(seed?.raid?.length).toBe(SEED_CAP_PER_ENTITY);
    expect(seed?.raid?.every((r) => r.id > 0)).toBe(true);
  });

  it("drops records that fail sanitization (e.g. milestone without a date)", () => {
    const seed = proposalToSeed(
      { meta: { name: "x" }, features: [], seed: { milestones: [{ name: "No date" }, { name: "Good", date: "2026-08-01" }] } },
      TODAY,
    );
    expect(seed?.milestones?.length).toBe(1);
    expect(seed?.milestones?.[0]?.name).toBe("Good");
  });

  it("builds seed tasks with today's lastUpdateDate", () => {
    const seed = proposalToSeed({ meta: { name: "x" }, features: [], seed: { tasks: [{ taskName: "Kickoff" }] } }, TODAY);
    expect(seed?.tasks?.[0]?.taskName).toBe("Kickoff");
    expect(seed?.tasks?.[0]?.lastUpdateDate).toBe(TODAY);
  });

  it("returns undefined when there is no usable seed content", () => {
    expect(proposalToSeed({ meta: { name: "x" }, features: [] }, TODAY)).toBeUndefined();
    expect(seedHasContent(undefined)).toBe(false);
  });
});
