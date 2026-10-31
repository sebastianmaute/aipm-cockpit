// §715 — a Claude edit of the project record is ALWAYS a "Proposed changes" card, and its rows equal what
// the write stores: accepted and normalised fields show the stored value, refused fields show the stored value
// with the refusal, and the replayed call carries only what the card showed as landing.
import { describe, expect, it, vi } from "vitest";
import { entityToken } from "./ai-entity-token";
import { applyProposal } from "./chat-proposal-apply";
import { describeProjectCall, describeProposal, projectFieldText } from "./chat-proposal-describe";
import { shouldStage } from "./chat-proposal";
import type { ToolDispatcher } from "./chat-tools";
import { stripRejectedFields } from "./inline-ai-edit/plan";
import { applyProjectPatch } from "./project-ai-fields";
import { BUDGET_NAME_MAX } from "./sanitize-entities";
import type { ProjectMeta } from "./types";
import { emptyWorkspace, type Workspace } from "./workspace";

const STORED: ProjectMeta = {
  name: "Apollo",
  code: "AP-1",
  description: "Moon programme",
  projectManager: "Pat",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme",
  naceSection: "C",
  identityTypes: ["B2B"],
  products: "Rockets",
  deployment: "Cloud",
  startDate: "2030-03-01",
  endDate: "2030-12-31",
  profitCenter: "PC1",
  contactPersons: [],
  regulatory: [],
  knowledgeLinks: [],
};
const TOKEN = entityToken("project", STORED);
const LONG_NAME = "N".repeat(BUDGET_NAME_MAX + 40);
// A truncatable name, an endDate before the stored start (refused), a whitespace-padded sponsor
// (normalised), a clean customer change (accepted) and a key that is not a project field.
const PATCH = {
  expectedToken: TOKEN,
  name: LONG_NAME,
  endDate: "2030-01-15",
  sponsor: "  Sam  ",
  customer: "Globex",
  contactPersons: [],
};

const wsWith = (project: ProjectMeta | undefined): Workspace => ({ ...emptyWorkspace(), project }) as Workspace;

function fakeDispatcher(initial: ProjectMeta) {
  let live = initial;
  const updateProjectMeta = vi.fn(async (next: ProjectMeta) => {
    live = next;
    return next;
  });
  const d = { getProjectMeta: () => live, updateProjectMeta, isPeopleProtected: () => false } as unknown as ToolDispatcher;
  return { d, updateProjectMeta, setLive: (m: ProjectMeta) => { live = m; } };
}

const batch = { runBatched: async <T,>(fn: () => Promise<T>) => fn() };

describe("update_project always stages", () => {
  it("a lone update_project stages", () => {
    expect(shouldStage([{ name: "update_project", input: { sponsor: "x" } }])).toBe(true);
  });
});

describe("describeProjectCall", () => {
  it("card parity: refused and truncated rows", () => {
    const { rows } = describeProjectCall(PATCH, STORED);
    const refused = rows.filter((r) => r.state === "refused").map((r) => r.field);
    expect(refused).toEqual(["endDate"]);
    // What the write stores for the call the card sends: the patch minus the refused fields.
    const sent = Object.fromEntries(Object.entries(PATCH).filter(([k]) => !refused.includes(k as never)));
    const { next } = applyProjectPatch(STORED, sent);
    for (const row of rows) {
      const stored = row.state === "refused" ? STORED[row.field] : next[row.field];
      expect({ field: row.field, after: row.after }).toEqual({ field: row.field, after: projectFieldText(stored) });
      expect(row.before).toBe(projectFieldText(STORED[row.field]));
    }
    const byField = new Map(rows.map((r) => [r.field, r]));
    expect(byField.get("name")?.state).toBe("normalised");
    expect(byField.get("name")?.after).toHaveLength(BUDGET_NAME_MAX);
    expect(byField.get("sponsor")).toMatchObject({ state: "normalised", after: "Sam" });
    expect(byField.get("customer")).toMatchObject({ state: "change", before: "Acme", after: "Globex" });
    expect(byField.get("endDate")).toMatchObject({ state: "refused", before: "2030-12-31", after: "2030-12-31" });
    expect(rows.map((r) => r.field)).not.toContain("contactPersons");
  });

  it("re-judges the call that is sent: a start accepted only beside a refused end is refused too", () => {
    // Pass 1 judges the start against no end (the patch passes one), the end is refused against the new
    // start; the stripped call then judges the start against the STORED end. The card must show the
    // verdicts of the stripped call, which is the call the write receives.
    const input = { startDate: "2031-02-01", endDate: "2031-01-01" };
    const { rows } = describeProjectCall(input, STORED);
    const refused = rows.filter((r) => r.state === "refused").map((r) => r.field);
    const sent = Object.fromEntries(Object.entries(input).filter(([k]) => !refused.includes(k as never)));
    const { next, rows: written } = applyProjectPatch(STORED, sent);
    expect(written.every((r) => r.verdict.kind !== "refused")).toBe(true);
    for (const row of rows) {
      if (row.state !== "refused") expect(row.after).toBe(projectFieldText(next[row.field]));
    }
  });
});

describe("describeProposal — update_project", () => {
  it("puts changed rows in updates and refused/ignored fields in rejected, so the strip matches the card", () => {
    const [row] = describeProposal([{ name: "update_project", input: PATCH }], wsWith(STORED));
    expect(row.plan.updates.map((u) => u.field).sort()).toEqual(["customer", "name", "sponsor"]);
    expect(row.plan.rejected.map((r) => r.field).sort()).toEqual(["contactPersons", "endDate"]);
    // The detail is the bare reason: the card names the field itself, in the form's label (§715).
    expect(row.plan.rejected.find((r) => r.field === "endDate")?.detail).not.toMatch(/^endDate:/);
    const sent = stripRejectedFields(row.stamped.input, row.plan);
    expect(sent.writesNothing).toBe(false);
    const { next } = applyProjectPatch(STORED, sent.input);
    for (const u of row.plan.updates) expect(u.after).toBe(projectFieldText(next[u.field as keyof ProjectMeta]));
    expect(next.endDate).toBe(STORED.endDate);
  });

  it("stamps a missing token from the staged project and preserves a supplied one", () => {
    const [stamped] = describeProposal([{ name: "update_project", input: { sponsor: "x" } }], wsWith(STORED));
    expect(stamped.stamped.input.expectedToken).toBe(TOKEN);
    const [kept] = describeProposal([{ name: "update_project", input: { sponsor: "x", expectedToken: "m" } }], wsWith(STORED));
    expect(kept.stamped.input.expectedToken).toBe("m");
  });

  it("with no project open the row is rejected as a whole and no field is described", () => {
    const [row] = describeProposal([{ name: "update_project", input: { sponsor: "x" } }], wsWith(undefined));
    expect(row.plan.updates).toEqual([]);
    expect(row.plan.rejected).toHaveLength(1);
    expect(row.plan.rejected[0].field).toBeUndefined();
  });
});

describe("applying a staged update_project", () => {
  it("stale token at apply refuses update_project", async () => {
    const rows = describeProposal([{ name: "update_project", input: PATCH }], wsWith(STORED));
    const { d, updateProjectMeta, setLive } = fakeDispatcher(STORED);
    setLive({ ...STORED, customer: "Changed after the preview" });
    const result = await applyProposal({ dispatcher: d, rows, selected: new Set([0]), batch });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ index: 0, ok: false, stale: true });
    expect(updateProjectMeta).not.toHaveBeenCalled();
  });

  it("a non-stale staged update_project applies what the card showed and never resends a refused field", async () => {
    const rows = describeProposal([{ name: "update_project", input: PATCH }], wsWith(STORED));
    const { d, updateProjectMeta } = fakeDispatcher(STORED);
    const result = await applyProposal({ dispatcher: d, rows, selected: new Set([0]), batch });
    expect(result.rows).toEqual([{ index: 0, ok: true }]);
    expect(updateProjectMeta).toHaveBeenCalledTimes(1);
    const written = updateProjectMeta.mock.calls[0][0];
    const { rows: shown } = describeProjectCall(PATCH, STORED);
    for (const r of shown) {
      expect({ field: r.field, stored: projectFieldText(written[r.field]) }).toEqual({ field: r.field, stored: r.after });
    }
  });

  it("a call whose every field is refused is not sent", async () => {
    const rows = describeProposal(
      [{ name: "update_project", input: { expectedToken: TOKEN, jiraUrl: "javascript:alert(1)" } }],
      wsWith(STORED),
    );
    const { d, updateProjectMeta } = fakeDispatcher(STORED);
    const result = await applyProposal({ dispatcher: d, rows, selected: new Set([0]), batch });
    expect(result.rows[0].ok).toBe(false);
    expect(updateProjectMeta).not.toHaveBeenCalled();
  });
});
