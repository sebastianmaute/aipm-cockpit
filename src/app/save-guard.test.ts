import { describe, it, expect } from "vitest";
import { evaluateSaveGuard } from "./save-guard";

describe("evaluateSaveGuard", () => {
  const base = { prevCollections: 3, prevRecords: 100, curCollections: 3, curRecords: 100, allowDestructive: false };

  it("allows an ordinary save", () => {
    expect(evaluateSaveGuard(base)).toEqual({ refuse: false, forensic: false, refusedBy: null });
  });

  it("refuses a full wipe of a multi-collection project", () => {
    expect(evaluateSaveGuard({ ...base, curCollections: 0, curRecords: 0 }))
      .toEqual({ refuse: true, forensic: false, refusedBy: "full-wipe" });
  });

  it("refuses an unexplained mass deletion", () => {
    // 100 -> 4 removes 96 (>= the floor of 5) and leaves 4 (<= 10% of 100).
    expect(evaluateSaveGuard({ ...base, curRecords: 4 }))
      .toEqual({ refuse: true, forensic: false, refusedBy: "mass-delete" });
  });

  it("lets an explicit destructive action through", () => {
    expect(evaluateSaveGuard({ ...base, curCollections: 0, curRecords: 0, allowDestructive: true }))
      .toEqual({ refuse: false, forensic: false, refusedBy: null });
  });

  it("flags a single-collection full-empty for the forensic trail without refusing", () => {
    expect(evaluateSaveGuard({ ...base, prevCollections: 1, prevRecords: 2, curCollections: 0, curRecords: 0 }))
      .toEqual({ refuse: false, forensic: true, refusedBy: null });
  });

  it("names a full wipe as the refusing invariant", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 0, curRecords: 0, allowDestructive: false });
    expect(v.refuse).toBe(true);
    expect(v.refusedBy).toBe("full-wipe");
  });

  it("names a mass deletion as the refusing invariant", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 3, curRecords: 2, allowDestructive: false });
    expect(v.refuse).toBe(true);
    expect(v.refusedBy).toBe("mass-delete");
  });

  // ★ A full wipe of a multi-collection project is ALSO a mass deletion, so both
  // predicates hold. "full-wipe" must win: it is the larger loss and it selects
  // the heavier confirm tier, so reporting "mass-delete" here would silently
  // downgrade the friction on the one case that most needs it.
  it("reports full-wipe, not mass-delete, when both invariants hold", () => {
    const v = evaluateSaveGuard({ prevCollections: 4, prevRecords: 200, curCollections: 0, curRecords: 0, allowDestructive: false });
    expect(v.refusedBy).toBe("full-wipe");
  });

  it("reports no refusing invariant when the save is allowed", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 3, curRecords: 88, allowDestructive: false });
    expect(v.refuse).toBe(false);
    expect(v.refusedBy).toBeNull();
  });

  it("reports no refusing invariant when an armed bypass lets a wipe through", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 0, curRecords: 0, allowDestructive: true });
    expect(v.refuse).toBe(false);
    expect(v.refusedBy).toBeNull();
  });
});
