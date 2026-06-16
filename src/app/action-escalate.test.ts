import { describe, it, expect } from "vitest";
import { nextSeverity, planEscalation, applyEscalation } from "./action-escalate";
import type { RaidItem } from "./types";

function raid(partial: Partial<RaidItem>): RaidItem {
  return { id: 1, category: "I", title: "X", status: "Open", severity: "High", ...partial } as RaidItem;
}

describe("nextSeverity", () => {
  it("steps one level up", () => {
    expect(nextSeverity("Low")).toBe("Medium");
    expect(nextSeverity("Medium")).toBe("High");
    expect(nextSeverity("High")).toBe("Critical");
  });
  it("returns null at the top", () => {
    expect(nextSeverity("Critical")).toBeNull();
  });
});

describe("planEscalation", () => {
  it("raises severity for a High Issue", () => {
    expect(planEscalation(raid({ category: "I", severity: "High" }))).toEqual({
      raisesSeverity: true, from: "High", to: "Critical",
    });
  });
  it("raises a Medium Dependency to High", () => {
    expect(planEscalation(raid({ category: "D", severity: "Medium" }))).toEqual({
      raisesSeverity: true, from: "Medium", to: "High",
    });
  });
  it("is notify-only for Risks (matrix-derived)", () => {
    expect(planEscalation(raid({ category: "R", severity: "High" }))).toEqual({
      raisesSeverity: false, reason: "risk",
    });
  });
  it("is notify-only for an already-Critical Issue", () => {
    expect(planEscalation(raid({ category: "I", severity: "Critical" }))).toEqual({
      raisesSeverity: false, reason: "max",
    });
  });
  it("is notify-only when severity is missing", () => {
    expect(planEscalation(raid({ category: "A", severity: undefined }))).toEqual({
      raisesSeverity: false, reason: "max",
    });
  });
});

describe("applyEscalation", () => {
  it("raises the matched item immutably", () => {
    const before = [raid({ id: 1, severity: "High" }), raid({ id: 2, severity: "High" })];
    const after = applyEscalation(before, 1, "Critical");
    expect(after[0].severity).toBe("Critical");
    expect(after[1].severity).toBe("High");
    expect(after).not.toBe(before);
    expect(before[0].severity).toBe("High");
  });
  it("returns the same ref when no item matches", () => {
    const before = [raid({ id: 1 })];
    expect(applyEscalation(before, 99, "Critical")).toBe(before);
  });
});
