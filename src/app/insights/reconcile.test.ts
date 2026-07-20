import { describe, expect, it } from "vitest";
import { insightsMateriallyEqual, reconcileInsights } from "./reconcile";
import type { DetectedInsight, Insight } from "./insight";
import { MAX_INSIGHTS } from "./insight";

function detected(
  key: string,
  over: Partial<DetectedInsight> = {},
): DetectedInsight {
  return {
    key,
    type: "overdueTrend",
    severity: "medium",
    data: { count: 1 },
    ...over,
  };
}

function stored(key: string, over: Partial<Insight> = {}): Insight {
  return {
    id: 1,
    key,
    type: "overdueTrend",
    severity: "medium",
    data: { count: 1 },
    status: "active",
    firstSeenAt: "2026-01-01",
    lastSeenAt: "2026-01-01",
    occurrences: 1,
    ...over,
  };
}

describe("reconcileInsights", () => {
  it("creates a new active record for an unseen detection (id=max+1, timestamps=today, occurrences=1)", () => {
    const existing = stored("a", { id: 7 });
    const out = reconcileInsights([existing], [detected("a"), detected("b")], "2026-02-01");
    const created = out.find((i) => i.key === "b")!;
    expect(created).toBeDefined();
    expect(created.id).toBe(8); // max(7)+1
    expect(created.status).toBe("active");
    expect(created.firstSeenAt).toBe("2026-02-01");
    expect(created.lastSeenAt).toBe("2026-02-01");
    expect(created.occurrences).toBe(1);
  });

  it("mints id=1 when the store is empty", () => {
    const out = reconcileInsights([], [detected("x")], "2026-02-01");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it("re-detects an existing active key: bumps lastSeenAt/occurrences, refreshes severity+data, keeps id+status+firstSeenAt", () => {
    const existing = stored("a", {
      id: 5,
      severity: "low",
      data: { count: 1 },
      occurrences: 3,
      firstSeenAt: "2026-01-01",
      lastSeenAt: "2026-01-10",
    });
    const out = reconcileInsights(
      [existing],
      [detected("a", { severity: "high", data: { count: 9 } })],
      "2026-02-01",
    );
    const upserted = out.find((i) => i.key === "a")!;
    expect(upserted.id).toBe(5);
    expect(upserted.status).toBe("active");
    expect(upserted.firstSeenAt).toBe("2026-01-01");
    expect(upserted.lastSeenAt).toBe("2026-02-01");
    expect(upserted.occurrences).toBe(4);
    expect(upserted.severity).toBe("high");
    expect(upserted.data).toEqual({ count: 9 });
  });

  it("resolves a cleared record that had a user lifecycle event (actedAt set) and KEEPS it", () => {
    const existing = stored("a", {
      status: "acted",
      actedAt: "2026-01-15",
    });
    const out = reconcileInsights([existing], [], "2026-02-01");
    const rec = out.find((i) => i.key === "a")!;
    expect(rec).toBeDefined();
    expect(rec.status).toBe("resolved");
    expect(rec.resolvedAt).toBe("2026-02-01");
  });

  it("PRUNES a cleared auto-surfaced record with no user event", () => {
    const existing = stored("a", { status: "active" });
    const out = reconcileInsights([existing], [], "2026-02-01");
    expect(out.find((i) => i.key === "a")).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it("leaves a cleared dismissed record unchanged (still dismissed, still present)", () => {
    const existing = stored("a", {
      status: "dismissed",
      dismissedAt: "2026-01-20",
      dismissReason: "noise",
    });
    const out = reconcileInsights([existing], [], "2026-02-01");
    const rec = out.find((i) => i.key === "a")!;
    expect(rec).toBeDefined();
    expect(rec.status).toBe("dismissed");
    expect(rec.dismissedAt).toBe("2026-01-20");
    expect(rec.dismissReason).toBe("noise");
    expect(rec.resolvedAt).toBeUndefined();
  });

  it("re-fires a dismissed record back to active and clears dismissedAt/dismissReason", () => {
    const existing = stored("a", {
      status: "dismissed",
      dismissedAt: "2026-01-20",
      dismissReason: "noise",
      occurrences: 2,
    });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01");
    const rec = out.find((i) => i.key === "a")!;
    expect(rec.status).toBe("active");
    expect(rec.dismissedAt).toBeUndefined();
    expect(rec.dismissReason).toBeUndefined();
    expect(rec.lastSeenAt).toBe("2026-02-01");
    expect(rec.occurrences).toBe(3);
  });

  it("re-fires a resolved record back to active and clears resolvedAt", () => {
    const existing = stored("a", {
      status: "resolved",
      resolvedAt: "2026-01-25",
      occurrences: 4,
    });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01");
    const rec = out.find((i) => i.key === "a")!;
    expect(rec.status).toBe("active");
    expect(rec.resolvedAt).toBeUndefined();
    expect(rec.occurrences).toBe(5);
  });

  it("orders by severity desc, then lastSeenAt desc (stable)", () => {
    const s = [
      stored("low1", { id: 1, severity: "low", lastSeenAt: "2026-01-05" }),
      stored("high-old", { id: 2, severity: "high", lastSeenAt: "2026-01-01" }),
      stored("high-new", { id: 3, severity: "high", lastSeenAt: "2026-01-09" }),
      stored("med1", { id: 4, severity: "medium", lastSeenAt: "2026-01-03" }),
    ];
    // Detect all so nothing prunes; keep their severities/dates.
    const d = s.map((i) =>
      detected(i.key, { severity: i.severity, data: i.data }),
    );
    const out = reconcileInsights(s, d, "2026-01-09");
    // Upsert bumps lastSeenAt to today for all — so within a severity tier the
    // order falls back to stable insertion order. Use distinct stored dates by
    // detecting only a subset instead.
    expect(out.map((i) => i.severity)).toEqual(["high", "high", "medium", "low"]);
  });

  it("orders ties by lastSeenAt desc when dates differ", () => {
    const s = [
      stored("high-old", { id: 1, severity: "high", lastSeenAt: "2026-01-01" }),
      stored("high-new", { id: 2, severity: "high", lastSeenAt: "2026-01-09" }),
    ];
    // No detections → both cleared, but they had no user event → pruned.
    // Instead make them dismissed so they persist with their stored dates.
    const dismissed = s.map((i) => stored(i.key, { ...i, status: "dismissed", dismissedAt: "2025-12-01" }));
    const out = reconcileInsights(dismissed, [], "2026-02-01");
    expect(out.map((i) => i.key)).toEqual(["high-new", "high-old"]);
  });

  it("caps output at MAX_INSIGHTS", () => {
    const many: DetectedInsight[] = Array.from(
      { length: MAX_INSIGHTS + 25 },
      (_, i) => detected(`k${i}`),
    );
    const out = reconcileInsights([], many, "2026-02-01");
    expect(out).toHaveLength(MAX_INSIGHTS);
  });

  it("does not mutate the stored input array or its objects", () => {
    const existing = stored("a", {
      id: 5,
      severity: "low",
      occurrences: 3,
      status: "acted",
      actedAt: "2026-01-15",
    });
    const snapshot = structuredClone(existing);
    const arr = [existing];
    reconcileInsights(arr, [detected("a", { severity: "high" })], "2026-02-01");
    expect(existing).toEqual(snapshot);
    expect(arr).toHaveLength(1);
  });
});

describe("insightsMateriallyEqual", () => {
  it("is TRUE when two lists differ only in occurrences/lastSeenAt", () => {
    const a = [stored("a", { occurrences: 1, lastSeenAt: "2026-01-01" })];
    const b = [stored("a", { occurrences: 2, lastSeenAt: "2026-02-01" })];
    expect(insightsMateriallyEqual(a, b)).toBe(true);
  });

  it("is TRUE for the identical reference", () => {
    const a = [stored("a")];
    expect(insightsMateriallyEqual(a, a)).toBe(true);
  });

  it("is FALSE when status differs", () => {
    const a = [stored("a", { status: "active" })];
    const b = [stored("a", { status: "acknowledged" })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when severity differs", () => {
    const a = [stored("a", { severity: "medium" })];
    const b = [stored("a", { severity: "high" })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when a data value differs", () => {
    const a = [stored("a", { data: { count: 1 } })];
    const b = [stored("a", { data: { count: 2 } })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when the lengths differ (one pruned/added)", () => {
    const a = [stored("a"), stored("b", { id: 2, key: "b" })];
    const b = [stored("a")];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when entityRef differs", () => {
    const a = [stored("a", { entityRef: { view: "open-points", id: 1 } })];
    const b = [stored("a", { entityRef: { view: "open-points", id: 2 } })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
    const c = [stored("a", { entityRef: undefined })];
    expect(insightsMateriallyEqual(a, c)).toBe(false);
  });

  it("is FALSE when a dismissReason / timestamp differs", () => {
    const a = [stored("a", { status: "dismissed", dismissedAt: "2026-01-20", dismissReason: "noise" })];
    const b = [stored("a", { status: "dismissed", dismissedAt: "2026-01-20", dismissReason: "duplicate" })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
    const c = [stored("a", { status: "dismissed", dismissedAt: "2026-01-21", dismissReason: "noise" })];
    expect(insightsMateriallyEqual(a, c)).toBe(false);
  });
});
