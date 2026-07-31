import { describe, expect, it } from "vitest";
import {
  buildRaciContext,
  cellKey,
  groundRaciCells,
  parseRaciProposal,
  MAX_RACI_CELLS,
  MAX_CONTEXT_STAKEHOLDERS,
  MAX_CONTEXT_MILESTONES,
} from "./raci-suggest";
import type { Milestone, Stakeholder } from "../types";

const sh = (id: number, name: string, extra: Partial<Stakeholder> = {}): Stakeholder => ({
  id, name, category: "Internal", influence: "High", interest: "High",
  stakeholderIds: [] as never, raci: {}, ...extra,
} as Stakeholder);

const ms = (id: number, name: string): Milestone =>
  ({ id, name, date: "2026-03-01" } as Milestone);

const stakeholders = [sh(1, "Ada", { title: "Sponsor" }), sh(2, "Bo", { title: "Lead" })];
const milestones = [ms(10, "Design freeze"), ms(11, "Go live")];

describe("parseRaciProposal", () => {
  it("returns no cells for a malformed payload instead of throwing", () => {
    expect(parseRaciProposal({}).cells).toEqual([]);
    expect(parseRaciProposal({ cells: "nope" }).cells).toEqual([]);
    expect(parseRaciProposal(null).cells).toEqual([]);
  });

  it("keeps well-formed cells", () => {
    const out = parseRaciProposal({ cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }] });
    expect(out.cells).toHaveLength(1);
  });

  it("drops individually malformed entries within an otherwise-valid array", () => {
    const out = parseRaciProposal({
      cells: [
        null,
        "not an object",
        { stakeholderId: "nope", milestoneId: 10, role: "A" },
        { stakeholderId: 1, milestoneId: "nope", role: "A" },
        { stakeholderId: 1, milestoneId: 10, role: "Z" },
        { stakeholderId: 1, milestoneId: 10, role: "A" },
      ],
    });
    expect(out.cells).toEqual([{ stakeholderId: 1, milestoneId: 10, role: "A" }]);
  });

  it("reports truncation when the model exceeds the cap", () => {
    const cells = Array.from({ length: MAX_RACI_CELLS + 5 }, (_, i) => ({
      stakeholderId: 1, milestoneId: i, role: "C",
    }));
    const out = parseRaciProposal({ cells });
    expect(out.cells).toHaveLength(MAX_RACI_CELLS);
    expect(out.truncated).toBe(true);
  });
});

describe("groundRaciCells", () => {
  it("drops a hallucinated stakeholder id", () => {
    const g = groundRaciCells([{ stakeholderId: 99, milestoneId: 10, role: "R" }], stakeholders, milestones);
    expect(g.cells).toEqual([]);
    // Assert the REASON, not just the count: the modal buckets by reason and
    // shows a different explanation per bucket, so a cell landing in the wrong
    // one is a user-visible wrong answer that a length-only assertion misses.
    expect(g.skipped[0].reason).toBe("unknown-stakeholder");
  });

  it("drops a hallucinated milestone id AND reports why", () => {
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 99, role: "R" }], stakeholders, milestones);
    expect(g.cells).toEqual([]);
    // Asserting `cells` alone would pass if the cell were dropped SILENTLY (a
    // bare `continue` in place of the skipped.push), so the count is unreported
    // and the user is never told the model named a milestone that isn't there.
    expect(g.skipped).toHaveLength(1);
    expect(g.skipped[0].reason).toBe("unknown-milestone");
  });

  it("rejects a letter outside RACI_ROLES", () => {
    const g = groundRaciCells(
      [{ stakeholderId: 1, milestoneId: 10, role: "X" as never }],
      stakeholders, milestones,
    );
    expect(g.cells).toEqual([]);
  });

  it("dedupes repeated cells for the same stakeholder and milestone", () => {
    const g = groundRaciCells(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 10, role: "C" },
      ],
      stakeholders, milestones,
    );
    expect(g.cells).toHaveLength(1);
  });

  it("refuses a second Accountable for a milestone that already has one", () => {
    const withA = [sh(1, "Ada", { raci: { "10": "A" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 2, milestoneId: 10, role: "A" }], withA, milestones);
    expect(g.cells).toEqual([]);
    expect(g.skipped[0].reason).toBe("duplicate-accountable");
  });

  it("does not treat the current Accountable re-asserting itself as a duplicate", () => {
    // It is dropped, but as a NO-OP, not rejected as a duplicate — the two
    // outcomes look alike from `cells` alone, so assert on `skipped`.
    const withA = [sh(1, "Ada", { raci: { "10": "A" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "A" }], withA, milestones);
    expect(g.skipped).toEqual([]);
    expect(g.cells).toEqual([]);
  });


  it("refuses two proposed Accountables for the same milestone within one proposal", () => {
    const g = groundRaciCells(
      [
        { stakeholderId: 1, milestoneId: 10, role: "A" },
        { stakeholderId: 2, milestoneId: 10, role: "A" },
      ],
      stakeholders, milestones,
    );
    expect(g.cells).toHaveLength(1);
    expect(g.skipped).toHaveLength(1);
  });

  it("carries the current role so the modal can show current -> proposed", () => {
    const withR = [sh(1, "Ada", { raci: { "10": "C" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "R" }], withR, milestones);
    expect(g.cells[0].currentRole).toBe("C");
    expect(g.cells[0].role).toBe("R");
  });

  it("drops a no-op cell whose proposed role already matches, and COUNTS it", () => {
    const withR = [sh(1, "Ada", { raci: { "10": "R" } }), sh(2, "Bo")];
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "R" }], withR, milestones);
    expect(g.cells).toEqual([]);
    // The count is what lets the caller distinguish "the model proposed
    // nothing" from "the model proposed what you already have". Without it the
    // hook told the user the former, which is false and is the ORDINARY result
    // of re-running against a populated matrix.
    expect(g.noOp).toBe(1);
    expect(g.skipped).toEqual([]);
  });

  it("reports noOp as 0 when every cell is a real change", () => {
    const g = groundRaciCells([{ stakeholderId: 1, milestoneId: 10, role: "R" }], stakeholders, milestones);
    expect(g.noOp).toBe(0);
  });

  it("omits EXISTING ASSIGNMENTS for milestones outside the shown slice", () => {
    // The prompt must not disclose an id the MILESTONES block never listed —
    // otherwise the model is invited to reason about a row it cannot see.
    const manyMs = Array.from({ length: MAX_CONTEXT_MILESTONES + 2 }, (_, i) => ms(2000 + i, `X${i}`));
    const hidden = String(2000 + MAX_CONTEXT_MILESTONES); // first id past the cap
    const shown = "2000";
    const withBoth = [sh(1, "Ada", { raci: { [hidden]: "A", [shown]: "C" } })];
    const ctx = buildRaciContext(withBoth, manyMs);
    expect(ctx.text).toContain(`1 | ${shown} | C`);
    expect(ctx.text).not.toContain(`1 | ${hidden} | A`);
  });
});

describe("buildRaciContext", () => {
  it("includes the fields the model reasons over", () => {
    const ctx = buildRaciContext(stakeholders, milestones);
    expect(ctx.text).toContain("Ada");
    expect(ctx.text).toContain("Sponsor");
    expect(ctx.text).toContain("Design freeze");
    expect(ctx.truncated).toBe(false);
  });

  it("actually caps BOTH lists, not just the flag", () => {
    // The flag and the slicing are independent: removing either `.slice(...)`
    // leaves `truncated` correct while the prompt silently carries every row,
    // which is the token blowup the caps exist to prevent. Assert the CONTENT.
    const many = Array.from({ length: MAX_CONTEXT_STAKEHOLDERS + 3 }, (_, i) => sh(i + 1, `P${i}`));
    const manyMs = Array.from({ length: MAX_CONTEXT_MILESTONES + 3 }, (_, i) => ms(i + 1000, `M${i}`));
    const ctx = buildRaciContext(many, manyMs);
    expect(ctx.text).toContain(`P${MAX_CONTEXT_STAKEHOLDERS - 1}`);
    expect(ctx.text).not.toContain(`P${MAX_CONTEXT_STAKEHOLDERS}`);
    expect(ctx.text).toContain(`M${MAX_CONTEXT_MILESTONES - 1}`);
    expect(ctx.text).not.toContain(`M${MAX_CONTEXT_MILESTONES}`);
  });

  it("flags truncation from the MILESTONE arm too", () => {
    // The stakeholder arm is covered below; without this, hardcoding the
    // milestone half of the `||` to false passes the whole suite.
    const manyMs = Array.from({ length: MAX_CONTEXT_MILESTONES + 1 }, (_, i) => ms(i + 1000, `M${i}`));
    expect(buildRaciContext(stakeholders, manyMs).truncated).toBe(true);
  });

  it("flags truncation rather than silently dropping rows", () => {
    const many = Array.from({ length: 500 }, (_, i) => sh(i + 1, `P${i}`));
    expect(buildRaciContext(many, milestones).truncated).toBe(true);
  });

  it("lists existing assignments so the model does not re-propose them", () => {
    const withAssignments = [sh(1, "Ada", { raci: { "10": "A" } }), sh(2, "Bo")];
    const ctx = buildRaciContext(withAssignments, milestones);
    expect(ctx.text).toContain("1 | 10 | A");
  });
});

describe("cellKey", () => {
  it("is unique per stakeholder and milestone", () => {
    expect(cellKey({ stakeholderId: 1, milestoneId: 10 } as never))
      .not.toBe(cellKey({ stakeholderId: 1, milestoneId: 11 } as never));
  });
});
