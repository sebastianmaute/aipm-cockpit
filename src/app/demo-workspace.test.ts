import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDemoWorkspace, DEMO_AS_OF } from "./demo-workspace";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("buildDemoWorkspace", () => {
  it("is unshifted on DEMO_AS_OF", () => {
    expect(buildDemoWorkspace(raw, DEMO_AS_OF).plan.startDate).toBe(raw.plan.startDate);
  });
  it("keeps today inside the plan window months later", () => {
    const today = "2027-03-10";
    const ws = buildDemoWorkspace(raw, today);
    expect(ws.plan.startDate < today && today < ws.plan.endDate).toBe(true);
  });
  // §502 — the master carries weekly forecast history up to DEMO_AS_OF.
  it("keeps the master's forecast history on DEMO_AS_OF", () => {
    const ws = buildDemoWorkspace(raw, DEMO_AS_OF);
    expect(ws.forecastHistory?.length).toBe(raw.forecastHistory.length);
    expect(ws.forecastHistory?.at(-1)?.date).toBe(DEMO_AS_OF);
  });
  it("drops forecast-history days the month shift moved past today", () => {
    // One month on, but on the 1st: the shift lands DEMO_AS_OF's day on the 18th, after today.
    const today = "2026-10-01";
    const ws = buildDemoWorkspace(raw, today);
    const dates = (ws.forecastHistory ?? []).map((e) => e.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThan(raw.forecastHistory.length);
    expect(dates.every((d) => d <= today)).toBe(true);
  });
  // Final-review finding: the shift moves completions too; none may land after today.
  it("clamps completions the month shift moved past today to today", () => {
    const today = "2026-10-01";
    const ws = buildDemoWorkspace(raw, today);
    const done = ws.tasks.filter((t) => t.completedDate);
    // Positive control: the master's 2026-09-15 completion lands on 10-15, so at least one task is clamped.
    expect(done.some((t) => t.completedDate === today)).toBe(true);
    expect(done.every((t) => t.completedDate! <= today)).toBe(true);
    expect(done.every((t) => t.status === "Done")).toBe(true);
  });
  it("keeps creation and last update in the past, so no task is finished before it was touched", () => {
    const today = "2026-10-01";
    const ws = buildDemoWorkspace(raw, today);
    // Positive controls: the shift moves at least one update and one creation past today, so both are clamped.
    expect(ws.tasks.some((t) => t.lastUpdateDate === today)).toBe(true);
    expect(ws.tasks.some((t) => t.createdDate === today)).toBe(true);
    expect(ws.tasks.every((t) => t.lastUpdateDate <= today && (t.createdDate ?? "") <= today)).toBe(true);
    // A clamp never adds a field the task did not have. Open tasks (no completedDate) get clamped too, so this
    // can fail. createdDate and startDate cannot be checked this way: every master task has a createdDate, and
    // no clamped task lacks a startDate.
    expect(ws.tasks.every((t) => !("completedDate" in t) || t.completedDate !== undefined)).toBe(true);
  });
  it("starts no finished task after it finished", () => {
    const today = "2026-10-01";
    const ws = buildDemoWorkspace(raw, today);
    const done = ws.tasks.filter((t) => t.completedDate && t.startDate);
    // Positive control: on the 1st, a clamped completion (today) meets a start shifted to the 2nd.
    expect(done.some((t) => t.startDate === t.completedDate && t.completedDate === today)).toBe(true);
    expect(done.every((t) => t.startDate! <= t.completedDate!)).toBe(true);
  });
  it("rejects a corrupt master loudly (strict decode)", () => {
    expect(() => buildDemoWorkspace({ tasks: 1 }, DEMO_AS_OF)).toThrow();
  });
});
