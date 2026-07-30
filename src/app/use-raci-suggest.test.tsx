import { describe, expect, it } from "vitest";
import { foldCellsByStakeholder } from "./use-raci-suggest";
import type { Stakeholder } from "./types";

const sh = (id: number, raci: Record<string, "R" | "A" | "C" | "I"> = {}): Stakeholder =>
  ({ id, name: `S${id}`, category: "Internal", influence: "High", interest: "High", raci } as Stakeholder);

describe("foldCellsByStakeholder", () => {
  it("folds MULTIPLE cells for one stakeholder into a SINGLE save, keeping every role", () => {
    const out = foldCellsByStakeholder(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 1, milestoneId: 11, role: "C" },
      ] as never,
      [sh(1)],
    );
    expect(out).toHaveLength(1);
    expect(out[0].raci["10"]).toBe("R");
    expect(out[0].raci["11"]).toBe("C");
  });

  it("preserves roles the proposal did not touch", () => {
    const out = foldCellsByStakeholder(
      [{ stakeholderId: 1, milestoneId: 11, role: "C" }] as never,
      [sh(1, { "10": "A" })],
    );
    expect(out[0].raci["10"]).toBe("A");
    expect(out[0].raci["11"]).toBe("C");
  });

  it("returns one entry per stakeholder", () => {
    const out = foldCellsByStakeholder(
      [
        { stakeholderId: 1, milestoneId: 10, role: "R" },
        { stakeholderId: 2, milestoneId: 10, role: "C" },
      ] as never,
      [sh(1), sh(2)],
    );
    expect(out).toHaveLength(2);
  });

  it("skips a stakeholder that vanished between propose and confirm", () => {
    const out = foldCellsByStakeholder(
      [{ stakeholderId: 9, milestoneId: 10, role: "R" }] as never,
      [sh(1)],
    );
    expect(out).toEqual([]);
  });
});
