import { describe, it, expect } from "vitest";
import { computeEvm, projectBlendedInternalRate } from "./evm";
import type { Role, Task } from "./types";

function task(o: Partial<Task> = {}): Task {
  return {
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-06-10", lastUpdateDate: "2026-06-01", status: "To Do", priority: "Medium",
    blockers: "", description: "", ...o,
  };
}
function role(internalRate: number, id = 1): Role {
  return { id, disciplineId: 1, gradeId: 1, internalRate, externalRate: internalRate * 2 };
}
const today = "2026-06-15";

describe("projectBlendedInternalRate", () => {
  it("averages role internal rates", () => {
    expect(projectBlendedInternalRate([role(100, 1), role(60, 2)])).toBe(80);
  });
  it("is 0 when there are no roles", () => {
    expect(projectBlendedInternalRate([])).toBe(0);
  });
});

describe("computeEvm — worked example", () => {
  const tasks = [
    task({ id: 1, originalEstimateMinutes: 2400, dueDate: "2026-06-01", completedDate: "2026-05-30", timeSpentMinutes: 2700 }),
    task({ id: 2, originalEstimateMinutes: 1440, dueDate: "2026-06-10", completedDate: "2026-06-12", timeSpentMinutes: 1200 }),
    task({ id: 3, originalEstimateMinutes: 960, dueDate: "2026-06-12", timeSpentMinutes: 600 }),
    task({ id: 4, originalEstimateMinutes: 2400, dueDate: "2026-06-30", timeSpentMinutes: 0 }),
  ];
  it("computes PV/EV/AC in hours", () => {
    const e = computeEvm(tasks, today);
    expect(e.pv).toBe(80);
    expect(e.ev).toBe(64);
    expect(e.ac).toBe(75);
  });
  it("derives SPI/CPI/SV/CV", () => {
    const e = computeEvm(tasks, today);
    expect(e.spi).toBe(0.8);
    expect(e.cpi).toBeCloseTo(0.8533, 4);
    expect(e.sv).toBe(-16);
    expect(e.cv).toBe(-11);
  });
  it("money overlay scales absolutes by the rate; ratios unchanged", () => {
    const e = computeEvm(tasks, today, { blendedRate: 80 });
    expect(e.money).toEqual({ pv: 6400, ev: 5120, ac: 6000, sv: -1280, cv: -880 });
    expect(e.spi).toBe(0.8);
  });
  it("reports coverage", () => {
    expect(computeEvm(tasks, today).coverage).toEqual({ withEstimate: 4, total: 4 });
  });
});

describe("computeEvm — edge cases", () => {
  it("SPI null when nothing is due yet; CPI null when no time spent", () => {
    const e = computeEvm([task({ originalEstimateMinutes: 600, dueDate: "2026-12-01", timeSpentMinutes: 0 })], today);
    expect(e.pv).toBe(0);
    expect(e.spi).toBeNull();
    expect(e.cpi).toBeNull();
    expect(e.money).toBeNull();
  });
  it("excludes tasks without an estimate from PV/EV/AC and coverage", () => {
    const e = computeEvm([
      task({ id: 1, dueDate: "2026-06-01", completedDate: "2026-06-01", timeSpentMinutes: 600 }),
      task({ id: 2, originalEstimateMinutes: 600, dueDate: "2026-06-01", completedDate: "2026-06-01", timeSpentMinutes: 600 }),
    ], today);
    expect(e.ac).toBe(10);
    expect(e.coverage).toEqual({ withEstimate: 1, total: 2 });
  });
  it("a completed future-due task earns EV but is not in PV (ahead of schedule)", () => {
    const e = computeEvm([task({ originalEstimateMinutes: 600, dueDate: "2026-12-01", completedDate: "2026-06-01", timeSpentMinutes: 300 })], today);
    expect(e.pv).toBe(0);
    expect(e.ev).toBe(10);
    expect(e.spi).toBeNull();
    expect(e.cpi).toBe(2);
  });
  it("empty workspace → zeros and nulls", () => {
    expect(computeEvm([], today)).toEqual({ pv: 0, ev: 0, ac: 0, spi: null, cpi: null, sv: 0, cv: 0, money: null, coverage: { withEstimate: 0, total: 0 } });
  });
});
