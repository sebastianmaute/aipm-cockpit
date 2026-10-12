import { describe, expect, it } from "vitest";
import {
  addViewSwitchSend,
  isWarmViewSwitch,
  normalizeViewSwitchBuckets,
  VIEW_SWITCH_CACHE_TTL_MS,
  weekViewSwitchStats,
  type SendFingerprint,
  type ViewSwitchBuckets,
} from "./ai-view-switch";

const T0 = new Date("2026-10-12T10:00:00").getTime();

function fp(over: Partial<SendFingerprint> = {}): SendFingerprint {
  return { threadKey: "p1:t1", stableText: "STABLE", viewText: "VIEW-A", at: T0, priorTurns: 2, ...over };
}

describe("isWarmViewSwitch", () => {
  it("is a switch when only the view block changed, in the same thread, inside the cache window", () => {
    expect(isWarmViewSwitch(fp(), fp({ viewText: "VIEW-B", at: T0 + 60_000 }))).toBe(true);
  });

  it("is not a switch when there is no previous send", () => {
    expect(isWarmViewSwitch(null, fp())).toBe(false);
  });

  it("is not a switch when the view block is unchanged", () => {
    expect(isWarmViewSwitch(fp(), fp({ at: T0 + 60_000 }))).toBe(false);
  });

  it("is not a switch in a different thread", () => {
    expect(isWarmViewSwitch(fp(), fp({ threadKey: "p1:t2", viewText: "VIEW-B", at: T0 + 60_000 }))).toBe(false);
  });

  it("is not a switch when the stable block changed too (the cache is rewritten either way)", () => {
    expect(isWarmViewSwitch(fp(), fp({ stableText: "STABLE-2", viewText: "VIEW-B", at: T0 + 60_000 }))).toBe(false);
  });

  it("is not a switch once the cache window has passed", () => {
    expect(isWarmViewSwitch(fp(), fp({ viewText: "VIEW-B", at: T0 + VIEW_SWITCH_CACHE_TTL_MS }))).toBe(false);
    expect(isWarmViewSwitch(fp(), fp({ viewText: "VIEW-B", at: T0 + VIEW_SWITCH_CACHE_TTL_MS - 1 }))).toBe(true);
  });

  it("is not a switch when the send starts a new conversation, which has no transcript to rewrite", () => {
    expect(isWarmViewSwitch(fp(), fp({ viewText: "VIEW-B", at: T0 + 60_000, priorTurns: 0 }))).toBe(false);
  });

  it("counts the view block appearing or disappearing as a switch", () => {
    expect(isWarmViewSwitch(fp({ viewText: "" }), fp({ at: T0 + 1 }))).toBe(true);
    expect(isWarmViewSwitch(fp(), fp({ viewText: "", at: T0 + 1 }))).toBe(true);
  });

  it("uses a five-minute window, Anthropic's default ephemeral cache lifetime", () => {
    expect(VIEW_SWITCH_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe("addViewSwitchSend", () => {
  const WED = new Date("2026-10-14T10:00:00");

  it("counts sends and splits cache writes by whether the send was a switch", () => {
    let b: ViewSwitchBuckets = {};
    b = addViewSwitchSend(b, WED, false, 1000);
    b = addViewSwitchSend(b, WED, true, 9000);
    b = addViewSwitchSend(b, WED, false, 500);
    expect(b["2026-10-14"]).toEqual({ sends: 3, switches: 1, switchCacheWrite: 9000, otherCacheWrite: 1500 });
  });

  it("does not mutate the input buckets", () => {
    const b: ViewSwitchBuckets = {};
    addViewSwitchSend(b, WED, true, 1);
    expect(b).toEqual({});
  });

  it("treats a non-finite cache write as 0", () => {
    const b = addViewSwitchSend({}, WED, true, Number.NaN);
    expect(b["2026-10-14"]).toEqual({ sends: 1, switches: 1, switchCacheWrite: 0, otherCacheWrite: 0 });
  });
});

describe("weekViewSwitchStats", () => {
  it("sums Monday..now of the current week only", () => {
    let b: ViewSwitchBuckets = {};
    b = addViewSwitchSend(b, new Date("2026-10-11T10:00:00"), true, 100); // previous Sunday — excluded
    b = addViewSwitchSend(b, new Date("2026-10-12T10:00:00"), true, 10); // Monday
    b = addViewSwitchSend(b, new Date("2026-10-14T09:00:00"), false, 2); // Wednesday
    expect(weekViewSwitchStats(b, new Date("2026-10-14T10:00:00"))).toEqual({
      sends: 2,
      switches: 1,
      switchCacheWrite: 10,
      otherCacheWrite: 2,
    });
  });

  it("is all zeros for no data", () => {
    expect(weekViewSwitchStats({}, new Date(T0))).toEqual({ sends: 0, switches: 0, switchCacheWrite: 0, otherCacheWrite: 0 });
  });
});

describe("normalizeViewSwitchBuckets", () => {
  it("rebuilds every bucket field by field, defaulting missing or non-finite fields to 0", () => {
    expect(
      normalizeViewSwitchBuckets({ "2026-10-12": { sends: 2, switches: "x", switchCacheWrite: Infinity } }),
    ).toEqual({ "2026-10-12": { sends: 2, switches: 0, switchCacheWrite: 0, otherCacheWrite: 0 } });
  });

  it("returns an empty object for anything that is not a plain object", () => {
    expect(normalizeViewSwitchBuckets(null)).toEqual({});
    expect(normalizeViewSwitchBuckets([1, 2])).toEqual({});
    expect(normalizeViewSwitchBuckets("{}")).toEqual({});
  });
});
