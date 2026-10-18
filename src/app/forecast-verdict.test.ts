import { describe, expect, it } from "vitest";
import { forecastVerdict, milestonesBelowTarget } from "./forecast-verdict";
import type { MilestoneChance } from "./forecast/milestones";

describe("forecastVerdict (§502 part 4)", () => {
  it("is an error below even odds", () => {
    expect(forecastVerdict(0.41, 80, 2, 5)).toEqual({ severity: "error", below: 2, total: 5 });
  });

  it("is a warning from even odds up to the target", () => {
    expect(forecastVerdict(0.64, 80, 1, 5)?.severity).toBe("warn");
  });

  it("is a warning AT even odds, not an error — the boundary is strict", () => {
    expect(forecastVerdict(0.5, 80, 1, 5)?.severity).toBe("warn");
  });

  it("is a success at or above the target", () => {
    expect(forecastVerdict(0.85, 80, 0, 5)?.severity).toBe("success");
    expect(forecastVerdict(0.8, 80, 0, 5)?.severity).toBe("success");
  });

  it("reads the target: 85% is short of a 95% goal", () => {
    expect(forecastVerdict(0.85, 95, 0, 5)?.severity).toBe("warn");
  });

  it("is null when there is no chance on time", () => {
    expect(forecastVerdict(null, 80, 0, 5)).toBeNull();
  });
});

describe("milestonesBelowTarget", () => {
  const chances: MilestoneChance[] = [
    { id: 1, state: "chance", chance: 0.31, chancePrioritised: 0.58 },
    { id: 2, state: "chance", chance: 0.64, chancePrioritised: 0.83 },
    { id: 3, state: "chance", chance: 0.88, chancePrioritised: 0.93 },
    { id: 4, state: "chance", chance: 0.8, chancePrioritised: 0.9 },
    { id: 5, state: "no-linked-tasks" },
  ];

  it("counts the chances under the goal against every milestone the run reports", () => {
    expect(milestonesBelowTarget(chances, 80)).toEqual({ below: 2, total: 5 });
    expect(milestonesBelowTarget(chances, 95)).toEqual({ below: 4, total: 5 });
    expect(milestonesBelowTarget(chances, 50)).toEqual({ below: 1, total: 5 });
  });
});
