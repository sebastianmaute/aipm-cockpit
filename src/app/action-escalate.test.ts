import { describe, it, expect, beforeAll } from "vitest";
import { nextSeverity, planEscalation, applyEscalation, buildEscalationMail } from "./action-escalate";
import { loadI18n } from "./i18n";
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

describe("buildEscalationMail", () => {
  beforeAll(() => loadI18n("de"));
  const item = raid({ id: 7, title: "Vendor slip", category: "I", severity: "High" });

  it("builds an EN subject and includes the severity-raised line when raising", () => {
    const plan = planEscalation(item);
    const { subject, body } = buildEscalationMail("en-US", item, plan, "Apollo");
    expect(subject).toBe("Escalation: RAID #7 — Vendor slip");
    expect(body).toContain("RAID item #7 (Vendor slip) needs escalation.");
    expect(body).toContain("Severity raised from High to Critical.");
    expect(body).toContain("Project: Apollo");
    expect(body).toContain("Please advise on next steps.");
  });

  it("omits the severity-raised line for a notify-only (Risk) plan", () => {
    const riskItem = raid({ id: 8, title: "FX risk", category: "R", severity: "High" });
    const plan = planEscalation(riskItem);
    const { body } = buildEscalationMail("en-US", riskItem, plan, "Apollo");
    expect(body).not.toContain("Severity raised");
    expect(body).toContain("RAID item #8 (FX risk) needs escalation.");
  });

  it("renders in German", () => {
    const plan = planEscalation(item);
    const { subject, body } = buildEscalationMail("de", item, plan, "Apollo");
    expect(subject).toBe("Eskalation: RAID #7 — Vendor slip");
    expect(body).toContain("Schweregrad von High auf Critical erhöht.");
  });
});
