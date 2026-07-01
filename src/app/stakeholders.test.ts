import { describe, expect, it } from "vitest";
import {
  nextStakeholderId, quadrantFor, buildRaciMatrix, accountableCountByMilestone,
  raciWarningFor, compareStakeholder, setRaciRole, applyQuadrantMove,
} from "./stakeholders";
import type { Milestone, Stakeholder } from "./types";

function mkS(over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 1, name: "Alex", category: "Internal", influence: "High", interest: "High",
    raci: {}, ...over,
  };
}
function mkM(id: number, name = `M${id}`): Milestone {
  return { id, name, date: "2026-01-01", linkedTaskIds: [] };
}

describe("nextStakeholderId", () => {
  it("returns 1 for empty and max+1 otherwise", () => {
    expect(nextStakeholderId([])).toBe(1);
    expect(nextStakeholderId([mkS({ id: 3 }), mkS({ id: 7 })])).toBe(8);
  });
});

describe("quadrantFor", () => {
  it("maps only High to the high bucket; Medium folds to Low", () => {
    expect(quadrantFor({ influence: "High", interest: "High" })).toBe("manage-closely");
    expect(quadrantFor({ influence: "High", interest: "Medium" })).toBe("keep-satisfied");
    expect(quadrantFor({ influence: "Medium", interest: "High" })).toBe("keep-informed");
    expect(quadrantFor({ influence: "Low", interest: "Low" })).toBe("monitor");
  });
});

describe("buildRaciMatrix", () => {
  it("rows are milestones, cells pull each stakeholder's letter (null when unset)", () => {
    const s1 = mkS({ id: 1, raci: { "10": "A" } });
    const s2 = mkS({ id: 2, raci: { "10": "R", "99": "C" } });
    const rows = buildRaciMatrix([s1, s2], [mkM(10)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual([
      { stakeholderId: 1, role: "A" },
      { stakeholderId: 2, role: "R" },
    ]);
  });
});

describe("accountableCountByMilestone + raciWarningFor", () => {
  it("counts A's and classifies the warning", () => {
    const s = [mkS({ id: 1, raci: { "10": "A" } }), mkS({ id: 2, raci: { "10": "A" } })];
    expect(accountableCountByMilestone(s, 10)).toBe(2);
    expect(raciWarningFor(0)).toBe("missing");
    expect(raciWarningFor(1)).toBe("none");
    expect(raciWarningFor(2)).toBe("multiple");
  });
});

describe("setRaciRole", () => {
  it("sets and clears immutably", () => {
    const s = mkS({ raci: { "5": "C" } });
    const set = setRaciRole(s, 7, "A");
    expect(set).not.toBe(s);
    expect(set.raci).toEqual({ "5": "C", "7": "A" });
    const cleared = setRaciRole(set, 5, null);
    expect(cleared.raci).toEqual({ "7": "A" });
  });
});

describe("compareStakeholder", () => {
  it("ranks influence Low<Medium<High and respects direction", () => {
    const lo = mkS({ id: 1, influence: "Low" });
    const hi = mkS({ id: 2, influence: "High" });
    expect(compareStakeholder(lo, hi, "influence", "asc")).toBeLessThan(0);
    expect(compareStakeholder(lo, hi, "influence", "desc")).toBeGreaterThan(0);
  });
});

describe("applyQuadrantMove", () => {
  it("sets both axes High for manage-closely", () => {
    const moved = applyQuadrantMove(mkS({ influence: "Low", interest: "Low" }), "manage-closely");
    expect(moved).not.toBeNull();
    expect(moved!.influence).toBe("High");
    expect(moved!.interest).toBe("High");
  });

  it("keep-satisfied: High influence, interest untouched when already Medium", () => {
    const moved = applyQuadrantMove(mkS({ influence: "Low", interest: "Medium" }), "keep-satisfied");
    expect(moved!.influence).toBe("High");
    expect(moved!.interest).toBe("Medium");
  });

  it("keep-satisfied: interest Low preserved (not flattened) on the low side", () => {
    const moved = applyQuadrantMove(mkS({ influence: "Low", interest: "Low" }), "keep-satisfied");
    expect(moved!.influence).toBe("High");
    expect(moved!.interest).toBe("Low");
  });

  it("keep-informed: raises interest, demotes High influence — catches an axis swap", () => {
    const moved = applyQuadrantMove(mkS({ influence: "High", interest: "Low" }), "keep-informed");
    expect(moved!.influence).toBe("Medium");
    expect(moved!.interest).toBe("High");
  });

  it("demotes High to Medium when dragged out of the high band", () => {
    const moved = applyQuadrantMove(mkS({ influence: "High", interest: "High" }), "monitor");
    expect(moved!.influence).toBe("Medium");
    expect(moved!.interest).toBe("Medium");
  });

  it("returns null on a no-op drop (same quadrant, nothing to demote)", () => {
    expect(applyQuadrantMove(mkS({ influence: "Medium", interest: "Low" }), "monitor")).toBeNull();
  });

  it("round-trip is not identity (Low -> keep-satisfied -> monitor yields Medium)", () => {
    const up = applyQuadrantMove(mkS({ influence: "Low", interest: "Low" }), "keep-satisfied");
    expect(up!.influence).toBe("High");
    expect(up!.interest).toBe("Low");
    const back = applyQuadrantMove(up!, "monitor");
    expect(back!.influence).toBe("Medium");
  });

  it("does not mutate the input", () => {
    const s = mkS({ influence: "Low", interest: "Low" });
    applyQuadrantMove(s, "manage-closely");
    expect(s.influence).toBe("Low");
    expect(s.interest).toBe("Low");
  });
});
