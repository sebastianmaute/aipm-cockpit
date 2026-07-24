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

  it("is null when every link is dangling", () => {
    expect(bucketPercentComplete({ taskIds: [99] }, [{ id: 1, status: "Done" }])).toBeNull();
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
