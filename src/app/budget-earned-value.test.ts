import { describe, expect, it } from "vitest";
import { bucketPercentComplete, earnedValueFor } from "./budget-earned-value";

describe("bucketPercentComplete", () => {
  it("is null with neither a manual value nor links", () => {
    expect(bucketPercentComplete({ taskIds: [] }, [])).toBeNull();
  });

  it("derives from the share of finished linked tasks", () => {
    const tasks = [
      { id: 1, status: "Done" },
      { id: 2, status: "To Do" },
      { id: 3, status: "Cancelled" },
      { id: 4, status: "In Progress" },
    ];
    // Done + Cancelled are both finished => 2 of 4.
    expect(bucketPercentComplete({ taskIds: [1, 2, 3, 4] }, tasks)).toBe(50);
  });

  it("lets a manual value win over the derivation", () => {
    const tasks = [{ id: 1, status: "Done" }];
    expect(bucketPercentComplete({ taskIds: [1], percentComplete: 20 }, tasks)).toBe(20);
  });

  it("treats a manual 0% as a real value that wins over derived progress", () => {
    // percentComplete: 0 is a PM's explicit 'nothing done', not an absent field —
    // it must return 0, not fall through to the finished/linked derivation.
    const tasks = [{ id: 1, status: "Done" }];
    expect(bucketPercentComplete({ taskIds: [1], percentComplete: 0 }, tasks)).toBe(0);
  });

  it("is null when every link is dangling", () => {
    expect(bucketPercentComplete({ taskIds: [99] }, [{ id: 1, status: "Done" }])).toBeNull();
  });

  // ★ A closed bucket's work is over, so with no other signal it is 100 % —
  //   rather than null, which blanks the project's whole EV (one bucket missing
  //   a percent withholds it). It fills ONLY the null case: a manual value and
  //   resolvable links both still win, so a closed bucket whose linked tasks are
  //   unfinished keeps reporting that, not a flattering 100.
  describe("closed bucket", () => {
    it("is 100 with neither a manual value nor links", () => {
      expect(bucketPercentComplete({ taskIds: [], status: "closed" }, [])).toBe(100);
      expect(bucketPercentComplete({ status: "closed" }, [])).toBe(100);
    });

    it("is 100 when every link is dangling", () => {
      expect(bucketPercentComplete({ taskIds: [99], status: "closed" }, [{ id: 1, status: "Done" }])).toBe(100);
    });

    it("still lets a manual value win, including 0", () => {
      expect(bucketPercentComplete({ status: "closed", percentComplete: 40 }, [])).toBe(40);
      expect(bucketPercentComplete({ status: "closed", percentComplete: 0 }, [])).toBe(0);
    });

    it("still derives from resolvable links", () => {
      const tasks = [{ id: 1, status: "Done" }, { id: 2, status: "To Do" }];
      expect(bucketPercentComplete({ taskIds: [1, 2], status: "closed" }, tasks)).toBe(50);
    });

    it("stays null for an OPEN bucket with no signal (control)", () => {
      expect(bucketPercentComplete({ taskIds: [], status: "open" }, [])).toBeNull();
    });
  });
});

describe("earnedValueFor", () => {
  it("is null when progress is unknown", () => {
    expect(earnedValueFor(1000, null)).toBeNull();
  });

  it("is the budgeted cost scaled by progress", () => {
    expect(earnedValueFor(1000, 40)).toBe(400);
  });
});
