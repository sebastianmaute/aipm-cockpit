import { describe, expect, it } from "vitest";
import { forecastVerdict } from "./forecast-verdict";
import { milestoneCounts } from "./forecast-milestone-rows";
import type { MilestoneChance } from "./forecast/milestones";

const counts = (below: number, total: number, overdue = 0) => ({ below, total, overdue });

describe("forecastVerdict (§502 part 4)", () => {
  it("is an error below even odds", () => {
    expect(forecastVerdict(0.41, 80, counts(2, 5))).toEqual({ severity: "error", below: 2, total: 5, overdue: 0 });
  });

  it("is a warning from even odds up to the target", () => {
    expect(forecastVerdict(0.64, 80, counts(1, 5))?.severity).toBe("warn");
  });

  it("is a warning AT even odds, not an error — the boundary is strict", () => {
    expect(forecastVerdict(0.5, 80, counts(1, 5))?.severity).toBe("warn");
  });

  it("is a success at or above the target", () => {
    expect(forecastVerdict(0.85, 80, counts(0, 5))?.severity).toBe("success");
    expect(forecastVerdict(0.8, 80, counts(0, 5))?.severity).toBe("success");
  });

  it("reads the target: 85% is short of a 95% goal", () => {
    expect(forecastVerdict(0.85, 95, counts(0, 5))?.severity).toBe("warn");
  });

  // Third review — a green "on target" must not hide an overdue milestone; an error stays an error.
  it("is at most a warning while any milestone is overdue", () => {
    expect(forecastVerdict(0.9, 80, counts(0, 3, 2))?.severity).toBe("warn");
    expect(forecastVerdict(0.3, 80, counts(0, 3, 2))?.severity).toBe("error");
    expect(forecastVerdict(0.9, 80, counts(0, 3, 0))?.severity).toBe("success");
  });

  it("is null when there is no chance on time", () => {
    expect(forecastVerdict(null, 80, counts(0, 5))).toBeNull();
  });
});

describe("milestoneCounts", () => {
  const chances: MilestoneChance[] = [
    { id: 1, state: "chance", chance: 0.31, chancePrioritised: 0.58 },
    { id: 2, state: "chance", chance: 0.64, chancePrioritised: 0.83 },
    { id: 3, state: "chance", chance: 0.88, chancePrioritised: 0.93 },
    { id: 4, state: "chance", chance: 0.8, chancePrioritised: 0.9 },
    { id: 5, state: "no-linked-tasks" },
    { id: 6, state: "overdue" },
  ];

  it("counts the chances under the goal against the milestones WITH a chance; overdue apart; unlinked in neither", () => {
    expect(milestoneCounts(chances, 80)).toEqual({ below: 2, total: 4, overdue: 1 });
    expect(milestoneCounts(chances, 95)).toEqual({ below: 4, total: 4, overdue: 1 });
    expect(milestoneCounts(chances, 50)).toEqual({ below: 1, total: 4, overdue: 1 });
  });
});
