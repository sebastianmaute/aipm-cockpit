import { describe, it, expect } from "vitest";
import {
  recordOutcome, decayStats, learnedBias, effectiveBias, buildBiasMap,
  BIAS_CAP, MIN_EVIDENCE, DECAY_HALF_LIFE_MS, type OutcomeStats,
} from "./action-learning";

const empty = (): OutcomeStats => ({ acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 });

describe("recordOutcome", () => {
  it("increments the given type immutably and sets lastAt", () => {
    const s0 = {};
    const s1 = recordOutcome(s0, "raid:why", "acted", 1000);
    expect(s0).toEqual({});
    expect(s1["raid:why"]).toEqual({ acted: 1, snoozed: 0, dismissed: 0, lastAt: 1000 });
  });
  it("accumulates across calls", () => {
    let s = recordOutcome({}, "k", "acted", 1000);
    s = recordOutcome(s, "k", "snoozed", 1000);
    expect(s.k.acted).toBe(1);
    expect(s.k.snoozed).toBe(1);
  });
});

describe("decayStats", () => {
  it("halves counts after one half-life", () => {
    const s = { acted: 4, snoozed: 0, dismissed: 0, lastAt: 0 };
    const d = decayStats(s, DECAY_HALF_LIFE_MS);
    expect(d.acted).toBeCloseTo(2, 5);
    expect(d.lastAt).toBe(DECAY_HALF_LIFE_MS);
  });
  it("no decay when lastAt is 0/now equal", () => {
    expect(decayStats(empty(), 0)).toEqual(empty());
  });
});

describe("learnedBias", () => {
  it("returns 0 below the min-evidence floor", () => {
    expect(learnedBias({ acted: 2, snoozed: 0, dismissed: 0, lastAt: 0 })).toBe(0);
    expect(MIN_EVIDENCE).toBe(3);
  });
  it("positive when acted dominates, clamped to +CAP", () => {
    expect(learnedBias({ acted: 100, snoozed: 0, dismissed: 0, lastAt: 0 })).toBe(BIAS_CAP);
  });
  it("negative when dismissed dominates, clamped to -CAP", () => {
    expect(learnedBias({ acted: 0, snoozed: 0, dismissed: 100, lastAt: 0 })).toBe(-BIAS_CAP);
  });
  it("snooze weighs half a dismiss", () => {
    expect(learnedBias({ acted: 0, snoozed: 4, dismissed: 0, lastAt: 0 })).toBe(Math.round(-BIAS_CAP / 2));
  });
});

describe("effectiveBias", () => {
  const s = { acted: 100, snoozed: 0, dismissed: 0, lastAt: 0 };
  it("override surface/suppress/off pin the value", () => {
    expect(effectiveBias(s, "surface")).toBe(BIAS_CAP);
    expect(effectiveBias(s, "suppress")).toBe(-BIAS_CAP);
    expect(effectiveBias(s, "off")).toBe(0);
  });
  it("auto delegates to learnedBias", () => {
    expect(effectiveBias(s, "auto")).toBe(learnedBias(s));
  });
});

describe("buildBiasMap", () => {
  it("omits zero entries and applies overrides", () => {
    const state = { hot: { acted: 100, snoozed: 0, dismissed: 0, lastAt: 0 }, cold: { acted: 1, snoozed: 0, dismissed: 0, lastAt: 0 } };
    const map = buildBiasMap(state, { forced: "surface" }, 0);
    expect(map.hot).toBe(BIAS_CAP);
    expect(map.cold).toBeUndefined();
    expect(map.forced).toBe(BIAS_CAP);
  });
});
