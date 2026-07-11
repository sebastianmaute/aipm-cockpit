import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetMintStateForTests,
  mintId,
  mintIds,
  peekMintId,
  resetMintState,
  seedMintFromWorkspace,
  seedMintKind,
  type MintKind,
} from "./id-mint-session";

beforeEach(() => {
  __resetMintStateForTests();
});

describe("mintId", () => {
  it("returns list max + 1", () => {
    expect(mintId("task", [{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(4);
  });

  it("returns 1 for an empty list", () => {
    expect(mintId("task", [])).toBe(1);
  });

  it("is monotonic across successive calls on the same kind", () => {
    expect(mintId("raid", [{ id: 5 }])).toBe(6);
    expect(mintId("raid", [{ id: 5 }])).toBe(7);
    expect(mintId("raid", [{ id: 5 }])).toBe(8);
  });

  it("never reuses a deleted max id within the session", () => {
    // Mint over [1,2,3] -> 4, high-water advances to 4.
    expect(mintId("task", [{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(4);
    // Delete id 3 (list shrinks to [1,2]); next mint must stay above the
    // high-water (4), NOT fall back to reusing 3. max(4, 2) + 1 = 5.
    expect(mintId("task", [{ id: 1 }, { id: 2 }])).toBe(5);
  });

  it("tracks high-water independently per kind", () => {
    expect(mintId("task", [{ id: 10 }])).toBe(11);
    // A different kind is unaffected by task's high-water.
    expect(mintId("change", [{ id: 1 }])).toBe(2);
  });
});

describe("mintIds", () => {
  it("returns [] and does not advance the mark when count <= 0", () => {
    expect(mintIds("task", [{ id: 7 }], 0)).toEqual([]);
    expect(mintIds("task", [{ id: 7 }], -3)).toEqual([]);
    // Mark untouched: next single mint is still 8.
    expect(mintId("task", [{ id: 7 }])).toBe(8);
  });

  it("returns N sequential ids above the mark and advances it to the last", () => {
    expect(mintIds("milestone", [{ id: 4 }], 3)).toEqual([5, 6, 7]);
    // Mark advanced to 7; a subsequent single mint continues from 8.
    expect(mintId("milestone", [{ id: 4 }])).toBe(8);
  });

  it("stays above the session high-water even when the list shrinks", () => {
    expect(mintIds("resource", [{ id: 2 }, { id: 3 }], 2)).toEqual([4, 5]);
    // id 3 deleted; the next reservation must still exceed 5.
    expect(mintIds("resource", [{ id: 2 }], 2)).toEqual([6, 7]);
  });
});

describe("seedMintKind", () => {
  it("reset sets the mark to the list max", () => {
    seedMintKind("task", [{ id: 40 }, { id: 12 }], "reset");
    expect(mintId("task", [])).toBe(41);
  });

  it("reset with an empty list sets the mark to 0", () => {
    seedMintKind("task", [{ id: 99 }], "raise");
    seedMintKind("task", [], "reset");
    expect(mintId("task", [])).toBe(1);
  });

  it("raise never lowers an existing higher mark", () => {
    seedMintKind("role", [{ id: 100 }], "raise");
    // A lower list under raise must NOT lower the mark.
    seedMintKind("role", [{ id: 5 }], "raise");
    expect(mintId("role", [])).toBe(101);
  });

  it("raise lifts the mark when the list max exceeds it", () => {
    seedMintKind("role", [{ id: 5 }], "raise");
    seedMintKind("role", [{ id: 50 }], "raise");
    expect(mintId("role", [])).toBe(51);
  });
});

describe("seedMintFromWorkspace", () => {
  const ws = {
    tasks: [{ id: 3 }, { id: 7 }],
    raid: [{ id: 4 }],
    changes: [{ id: 5 }],
    stakeholders: [{ id: 6 }],
    milestones: [{ id: 8 }],
    resources: [{ id: 9 }],
    roles: [{ id: 10 }],
    disciplines: [{ id: 11 }],
    grades: [{ id: 12 }],
    absences: [{ id: 13 }],
    shifts: [{ id: 14 }],
    budgets: [{ id: 20 }, { id: 25 }],
  } as unknown as Parameters<typeof seedMintFromWorkspace>[0];

  it("seeds every kind so a subsequent mint exceeds the loaded max", () => {
    seedMintFromWorkspace(ws, "reset");
    const expected: Record<MintKind, number> = {
      task: 8,
      raid: 5,
      change: 6,
      stakeholder: 7,
      milestone: 9,
      resource: 10,
      role: 11,
      discipline: 12,
      grade: 13,
      absence: 14,
      shift: 15,
      budgetBucket: 26,
    };
    for (const [kind, next] of Object.entries(expected) as [MintKind, number][]) {
      expect(mintId(kind, [])).toBe(next);
    }
  });

  it("flat-maps nested budget buckets when present", () => {
    const nested = {
      budgets: [{ id: 1, buckets: [{ id: 30 }, { id: 42 }] }, { id: 2, buckets: [{ id: 31 }] }],
    } as unknown as Parameters<typeof seedMintFromWorkspace>[0];
    seedMintFromWorkspace(nested, "reset");
    expect(mintId("budgetBucket", [])).toBe(43);
  });

  it("guards missing arrays (empty workspace -> marks start at 0)", () => {
    seedMintFromWorkspace({}, "reset");
    expect(mintId("task", [])).toBe(1);
    expect(mintId("budgetBucket", [])).toBe(1);
  });

  it("raise mode never lowers marks below prior session state", () => {
    seedMintKind("task", [{ id: 500 }], "raise");
    seedMintFromWorkspace(ws, "raise");
    // ws.tasks max is 7; the prior mark (500) must survive.
    expect(mintId("task", [])).toBe(501);
  });

  it("reset-then-raise-reload never frees a deleted max id (load→delete→reload wiring)", () => {
    // Initial load: RESET to the loaded max (100).
    seedMintFromWorkspace(
      { tasks: [{ id: 1 }, { id: 100 }] } as unknown as Parameters<typeof seedMintFromWorkspace>[0],
      "reset",
    );
    expect(mintId("task", [{ id: 1 }, { id: 100 }])).toBe(101);
    // User deletes task 100; a same-project RELOAD reflects the shrunk set (max
    // 99). RAISE must keep the mark at 101's precursor — the freed id 100 is
    // never handed out again.
    seedMintFromWorkspace(
      { tasks: [{ id: 1 }, { id: 99 }] } as unknown as Parameters<typeof seedMintFromWorkspace>[0],
      "raise",
    );
    expect(mintId("task", [{ id: 1 }, { id: 99 }])).toBeGreaterThanOrEqual(101);
  });
});

describe("peekMintId", () => {
  it("returns the id the next mintId would hand out", () => {
    expect(peekMintId("task", [{ id: 4 }])).toBe(5);
    expect(mintId("task", [{ id: 4 }])).toBe(5);
  });

  it("does NOT advance the high-water mark (repeatable)", () => {
    expect(peekMintId("raid", [{ id: 7 }])).toBe(8);
    expect(peekMintId("raid", [{ id: 7 }])).toBe(8);
    // A real mint still yields the same next id after peeks.
    expect(mintId("raid", [{ id: 7 }])).toBe(8);
  });

  it("reflects a prior session mint above the list max", () => {
    mintId("change", [{ id: 3 }]); // mark -> 4
    // List shrank to max 2 (id 3 deleted); peek must still reflect the mark.
    expect(peekMintId("change", [{ id: 2 }])).toBe(5);
  });
});

describe("resetMintState", () => {
  it("clears all marks so a new project's ids start fresh", () => {
    mintId("task", [{ id: 500 }]); // mark -> 501 (prior project)
    resetMintState();
    // A brand-new (empty) project seed starts at 1.
    expect(mintIds("task", [], 2)).toEqual([1, 2]);
  });
});

describe("__resetMintStateForTests", () => {
  it("clears all high-water marks", () => {
    mintId("task", [{ id: 50 }]); // mark -> 51
    __resetMintStateForTests();
    // After reset, minting reads the list afresh from 0.
    expect(mintId("task", [{ id: 2 }])).toBe(3);
  });
});
