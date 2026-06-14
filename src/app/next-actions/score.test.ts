import { describe, expect, it } from "vitest";
import { scoreAction, bandTier, ACTION_WEIGHTS } from "./score";

describe("next-actions scoring", () => {
  it("sums the supplied factors", () => {
    expect(scoreAction({ urgency: 40, risk: 30, impact: 20, quickWin: 10, staleness: 5 })).toBe(105);
  });
  it("treats omitted factors as 0", () => {
    expect(scoreAction({ risk: 15 })).toBe(15);
  });
  it("bands tiers at the boundaries", () => {
    expect(bandTier(60)).toBe("now");
    expect(bandTier(59)).toBe("soon");
    expect(bandTier(30)).toBe("soon");
    expect(bandTier(29)).toBe("monitor");
    expect(bandTier(0)).toBe("monitor");
  });
  it("exposes tunable weights as named constants", () => {
    expect(ACTION_WEIGHTS.urgencyOverdue).toBe(40);
    expect(ACTION_WEIGHTS.riskCritical).toBe(30);
  });
});

describe("hybrid confidence factors", () => {
  it("adds clarity as a positive term", () => {
    expect(scoreAction({ risk: 30, clarity: 15 })).toBe(45);
  });
  it("subtracts staticPenalty", () => {
    expect(scoreAction({ risk: 30, staticPenalty: 25 })).toBe(5);
  });
  it("never returns below zero", () => {
    expect(scoreAction({ staticPenalty: 25 })).toBe(0);
  });
  it("keeps the base sum unchanged when neither is set", () => {
    expect(scoreAction({ risk: 30, urgency: 15 })).toBe(45);
  });
  it("exposes the three new weights with the spec defaults", () => {
    expect(ACTION_WEIGHTS.clarityBonus).toBe(15);
    expect(ACTION_WEIGHTS.semiClarityBonus).toBe(7);
    expect(ACTION_WEIGHTS.staticPenalty).toBe(25);
  });
  it("worked example: clear medium (60) outranks vague red (45)", () => {
    const clearMedium = scoreAction({ risk: 30, urgency: 15, clarity: 15 });
    const vagueRed = scoreAction({ risk: 30, urgency: 40, staticPenalty: 25 });
    expect(clearMedium).toBeGreaterThan(vagueRed);
  });
});
