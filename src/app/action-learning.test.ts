import { describe, it, expect } from "vitest";
import {
  recordOutcome, decayStats, learnedBias, effectiveBias, buildBiasMap,
  BIAS_CAP, MIN_EVIDENCE, DECAY_HALF_LIFE_MS, normalizeLearningSnapshot, type OutcomeStats,
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

// §778 — stored rows and overrides written under a singular-count kind
// ("…One") merge into the plural sibling on read, so nothing learned is lost
// and an override keeps applying.
describe("normalizeLearningSnapshot (§778)", () => {
  const ONE = "task-due:actionTaskWhySoonOne";
  const MANY = "task-due:actionTaskWhySoon";
  const DAY = 24 * 60 * 60 * 1000;

  it("renames a singular-only row to its plural kind", () => {
    const s = { acted: 2, snoozed: 1, dismissed: 0, lastAt: 5 };
    const out = normalizeLearningSnapshot({ state: { [ONE]: s }, overrides: {} });
    expect(out.state).toEqual({ [MANY]: s });
  });

  it("combines both rows, decayed to the later lastAt, then summed", () => {
    const t0 = 10 * DAY;
    const older = { acted: 4, snoozed: 0, dismissed: 2, lastAt: t0 - DECAY_HALF_LIFE_MS };
    const newer = { acted: 1, snoozed: 1, dismissed: 0, lastAt: t0 };
    const out = normalizeLearningSnapshot({ state: { [ONE]: older, [MANY]: newer }, overrides: {} });
    expect(Object.keys(out.state)).toEqual([MANY]);
    expect(out.state[MANY]).toEqual({ acted: 3, snoozed: 1, dismissed: 1, lastAt: t0 });
  });

  it("keeps the plural row's explicit override, else takes the singular one", () => {
    expect(normalizeLearningSnapshot({ state: {}, overrides: { [ONE]: "suppress", [MANY]: "surface" } }).overrides)
      .toEqual({ [MANY]: "surface" });
    expect(normalizeLearningSnapshot({ state: {}, overrides: { [ONE]: "suppress", [MANY]: "auto" } }).overrides)
      .toEqual({ [MANY]: "suppress" });
    expect(normalizeLearningSnapshot({ state: {}, overrides: { [ONE]: "off" } }).overrides)
      .toEqual({ [MANY]: "off" });
  });

  it("is idempotent and leaves an already-canonical snapshot equal", () => {
    const snap = {
      state: { [ONE]: { acted: 1, snoozed: 0, dismissed: 0, lastAt: 3 }, "raid:actionRaidWhySeverity": { acted: 2, snoozed: 0, dismissed: 0, lastAt: 4 } },
      overrides: { [ONE]: "suppress" as const },
    };
    const once = normalizeLearningSnapshot(snap);
    expect(normalizeLearningSnapshot(once)).toEqual(once);
    const canonical = { state: { [MANY]: { acted: 1, snoozed: 0, dismissed: 0, lastAt: 3 } }, overrides: { [MANY]: "surface" as const } };
    expect(normalizeLearningSnapshot(canonical)).toEqual(canonical);
  });

  it("the merged override drives the bias of the plural kind", () => {
    const snap = normalizeLearningSnapshot({ state: {}, overrides: { [ONE]: "suppress" } });
    expect(buildBiasMap(snap.state, snap.overrides, 0)).toEqual({ [MANY]: -BIAS_CAP });
  });
});
