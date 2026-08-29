import { describe, it, expect } from "vitest";
import { evaluateSaveGuard } from "./save-guard";

describe("evaluateSaveGuard", () => {
  const base = { prevCollections: 3, prevRecords: 100, curCollections: 3, curRecords: 100, allowDestructive: false };

  it("allows an ordinary save", () => {
    expect(evaluateSaveGuard(base)).toEqual({ refuse: false, forensic: false });
  });

  it("refuses a full wipe of a multi-collection project", () => {
    expect(evaluateSaveGuard({ ...base, curCollections: 0, curRecords: 0 }))
      .toEqual({ refuse: true, forensic: false });
  });

  it("refuses an unexplained mass deletion", () => {
    // 100 -> 4 removes 96 (>= the floor of 5) and leaves 4 (<= 10% of 100).
    expect(evaluateSaveGuard({ ...base, curRecords: 4 }))
      .toEqual({ refuse: true, forensic: false });
  });

  it("lets an explicit destructive action through", () => {
    expect(evaluateSaveGuard({ ...base, curCollections: 0, curRecords: 0, allowDestructive: true }))
      .toEqual({ refuse: false, forensic: false });
  });

  it("flags a single-collection full-empty for the forensic trail without refusing", () => {
    expect(evaluateSaveGuard({ ...base, prevCollections: 1, prevRecords: 2, curCollections: 0, curRecords: 0 }))
      .toEqual({ refuse: false, forensic: true });
  });
});
