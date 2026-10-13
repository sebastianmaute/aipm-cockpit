import { describe, expect, it } from "vitest";
import {
  addViewSwitchSend,
  classifySend,
  EMPTY_VIEW_SWITCH_STATS,
  normalizeViewSwitchBuckets,
  pruneLastSends,
  VIEW_SWITCH_CACHE_TTL_MS,
  weekViewSwitchStats,
  type SendFingerprint,
  type ViewSwitchBuckets,
} from "./ai-view-switch";

const T0 = new Date("2026-10-12T10:00:00").getTime();
const MIN = 60_000;

/** The previous send: its last request went out at T0. */
function prev(over: Partial<SendFingerprint> = {}): SendFingerprint {
  return {
    threadKey: "p1:t1",
    model: "claude-model-a",
    toolNames: "list_tasks,update_task",
    stableText: "STABLE",
    viewText: "VIEW-A",
    startedAt: T0 - 10_000,
    lastRequestAt: T0,
    priorTurns: 2,
    ...over,
  };
}

/** The next send: its first request went out one minute after `prev`'s last. */
function next(over: Partial<SendFingerprint> = {}): SendFingerprint {
  return prev({ startedAt: T0 + MIN, lastRequestAt: T0 + MIN + 10_000, priorTurns: 4, ...over });
}

describe("classifySend", () => {
  it("is a switch when only the view block changed, in the same thread, inside the cache window", () => {
    expect(classifySend(prev(), next({ viewText: "VIEW-B" }))).toBe("switch");
  });

  it("is warm when nothing in front of the transcript changed", () => {
    expect(classifySend(prev(), next())).toBe("warm");
  });

  it("is cold when there is no previous send in this thread", () => {
    expect(classifySend(undefined, next({ viewText: "VIEW-B" }))).toBe("cold");
  });

  it("is cold in a different thread", () => {
    expect(classifySend(prev(), next({ threadKey: "p1:t2", viewText: "VIEW-B" }))).toBe("cold");
  });

  it("is cold when the stable block changed too (the cache is rewritten either way)", () => {
    expect(classifySend(prev(), next({ stableText: "STABLE-2", viewText: "VIEW-B" }))).toBe("cold");
    expect(classifySend(prev(), next({ stableText: "STABLE-2" }))).toBe("cold");
  });

  it("is cold when the send starts a new conversation, which has no transcript to rewrite", () => {
    expect(classifySend(prev(), next({ viewText: "VIEW-B", priorTurns: 0 }))).toBe("cold");
  });

  it("is cold when the model changed, since every model keeps its own cache", () => {
    expect(classifySend(prev(), next({ model: "claude-model-b", viewText: "VIEW-B" }))).toBe("cold");
    expect(classifySend(prev(), next({ model: "claude-model-b" }))).toBe("cold");
  });

  it("is cold when the tool list changed, since tools come before system in the cache prefix", () => {
    expect(classifySend(prev(), next({ toolNames: "list_tasks", viewText: "VIEW-B" }))).toBe("cold");
    expect(classifySend(prev(), next({ toolNames: "list_tasks" }))).toBe("cold");
  });

  it("measures the cache window from the previous send's LAST REQUEST to this send's FIRST", () => {
    const at = (startedAt: number) => next({ viewText: "VIEW-B", startedAt, lastRequestAt: startedAt + 90_000 });
    expect(classifySend(prev(), at(T0 + VIEW_SWITCH_CACHE_TTL_MS - 1))).toBe("switch");
    expect(classifySend(prev(), at(T0 + VIEW_SWITCH_CACHE_TTL_MS))).toBe("cold");
  });

  it("still counts a switch whose own tool loop ran past the window", () => {
    // The previous send's last request went out at T0; this one went out at
    // 4:00 and its tool loop sent its last request at 5:30. The first request
    // was warm, so this is a switch.
    expect(
      classifySend(prev(), next({ viewText: "VIEW-B", startedAt: T0 + 4 * MIN, lastRequestAt: T0 + 5.5 * MIN })),
    ).toBe("switch");
  });

  it("counts the view block appearing or disappearing as a switch", () => {
    expect(classifySend(prev({ viewText: "" }), next())).toBe("switch");
    expect(classifySend(prev(), next({ viewText: "" }))).toBe("switch");
  });

  it("uses a five-minute window, Anthropic's default ephemeral cache lifetime", () => {
    expect(VIEW_SWITCH_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe("addViewSwitchSend", () => {
  const WED = new Date("2026-10-14T10:00:00");

  it("counts every send and its API requests, and keeps cache writes for switch and warm sends apart", () => {
    let b: ViewSwitchBuckets = {};
    b = addViewSwitchSend(b, WED, "cold", 20_000, 1);
    b = addViewSwitchSend(b, WED, "warm", 1_000, 3);
    b = addViewSwitchSend(b, WED, "switch", 9_000, 2);
    b = addViewSwitchSend(b, WED, "warm", 500, 1);
    expect(b["2026-10-14"]).toEqual({
      sends: 4,
      requests: 7,
      switches: 1,
      warmSends: 2,
      switchCacheWrite: 9_000,
      warmCacheWrite: 1_500,
    });
  });

  it("does not mutate the input buckets", () => {
    const b: ViewSwitchBuckets = {};
    addViewSwitchSend(b, WED, "switch", 1, 1);
    expect(b).toEqual({});
  });

  it("treats a non-finite cache write or request count as 0", () => {
    const b = addViewSwitchSend({}, WED, "switch", Number.NaN, Number.POSITIVE_INFINITY);
    expect(b["2026-10-14"]).toEqual({
      sends: 1,
      requests: 0,
      switches: 1,
      warmSends: 0,
      switchCacheWrite: 0,
      warmCacheWrite: 0,
    });
  });
});

const ZERO = { sends: 0, requests: 0, switches: 0, warmSends: 0, switchCacheWrite: 0, warmCacheWrite: 0 };

describe("EMPTY_VIEW_SWITCH_STATS", () => {
  it("is all zeros and frozen, so a shared default cannot be written through", () => {
    expect(EMPTY_VIEW_SWITCH_STATS).toEqual(ZERO);
    expect(Object.isFrozen(EMPTY_VIEW_SWITCH_STATS)).toBe(true);
  });
});

describe("pruneLastSends", () => {
  it("remembers the send under its thread and drops threads whose cache has expired", () => {
    const old = prev({ threadKey: "p1:old", lastRequestAt: T0 });
    const recent = prev({ threadKey: "p1:recent", lastRequestAt: T0 + 2 * MIN });
    const fp = next({ threadKey: "p1:t1", startedAt: T0 + VIEW_SWITCH_CACHE_TTL_MS });
    const before = new Map([
      [old.threadKey, old],
      [recent.threadKey, recent],
    ]);
    const after = pruneLastSends(before, fp);
    expect([...after.keys()].sort()).toEqual(["p1:recent", "p1:t1"]);
    expect(after.get("p1:t1")).toBe(fp);
    // Pure: the input map is untouched.
    expect([...before.keys()].sort()).toEqual(["p1:old", "p1:recent"]);
  });

  it("keeps a thread whose last request is just inside the window", () => {
    const edge = prev({ threadKey: "p1:edge", lastRequestAt: T0 });
    const fp = next({ threadKey: "p1:t1", startedAt: T0 + VIEW_SWITCH_CACHE_TTL_MS - 1 });
    expect(pruneLastSends(new Map([[edge.threadKey, edge]]), fp).has("p1:edge")).toBe(true);
  });
});

describe("weekViewSwitchStats", () => {
  it("sums Monday..now of the current week only", () => {
    let b: ViewSwitchBuckets = {};
    b = addViewSwitchSend(b, new Date("2026-10-11T10:00:00"), "switch", 100, 9); // previous Sunday — excluded
    b = addViewSwitchSend(b, new Date("2026-10-12T10:00:00"), "switch", 10, 2); // Monday
    b = addViewSwitchSend(b, new Date("2026-10-14T09:00:00"), "warm", 2, 3); // Wednesday
    expect(weekViewSwitchStats(b, new Date("2026-10-14T10:00:00"))).toEqual({
      sends: 2,
      requests: 5,
      switches: 1,
      warmSends: 1,
      switchCacheWrite: 10,
      warmCacheWrite: 2,
    });
  });

  it("is all zeros for no data", () => {
    expect(weekViewSwitchStats({}, new Date(T0))).toEqual(ZERO);
  });
});

describe("normalizeViewSwitchBuckets", () => {
  it("rebuilds every bucket field by field, defaulting missing or non-finite fields to 0", () => {
    expect(
      normalizeViewSwitchBuckets({ "2026-10-12": { sends: 2, requests: 4, switches: "x", switchCacheWrite: Infinity } }),
    ).toEqual({ "2026-10-12": { ...ZERO, sends: 2, requests: 4 } });
  });

  it("drops a bucket whose key is not a YYYY-MM-DD day, which no week filter could place", () => {
    expect(normalizeViewSwitchBuckets({ garbage: { sends: 5 }, "2026-10-12": { sends: 1 } })).toEqual({
      "2026-10-12": { ...ZERO, sends: 1 },
    });
  });

  it("returns an empty object for anything that is not a plain object", () => {
    expect(normalizeViewSwitchBuckets(null)).toEqual({});
    expect(normalizeViewSwitchBuckets([1, 2])).toEqual({});
    expect(normalizeViewSwitchBuckets("{}")).toEqual({});
  });
});
