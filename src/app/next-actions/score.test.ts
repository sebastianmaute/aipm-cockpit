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
