import { describe, expect, it } from "vitest";
import { bucketKey, detectGaps, expectedBuckets } from "./snapshot";
import type { SnapshotRecord } from "./snapshot";

function snap(capturedAt: string, bucket: string): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket, cadence: "weekly", trigger: "auto",
    isBaseline: false, remainingHours: null, remainingCost: null, pctComplete: 0,
    forecastEndDate: "", planEndDate: "", spi: null, cpi: null,
    overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

describe("bucketKey", () => {
  it("formats a daily bucket as YYYY-MM-DD", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "daily")).toBe("2026-06-03");
  });
  it("formats a monthly bucket as YYYY-MM", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "monthly")).toBe("2026-06");
  });
  it("formats a weekly bucket as ISO year-week", () => {
    // 2026-06-03 is a Wednesday in ISO week 23.
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "weekly")).toBe("2026-W23");
  });
  it("uses the ISO week-year at a year boundary (2027-01-01 is in week 53 of 2026)", () => {
    expect(bucketKey(new Date("2027-01-01T10:00:00Z"), "weekly")).toBe("2026-W53");
  });
});

describe("expectedBuckets", () => {
  it("enumerates inclusive weekly buckets across a year boundary", () => {
    const out = expectedBuckets(new Date("2026-12-21T00:00:00Z"), new Date("2027-01-04T00:00:00Z"), "weekly");
    expect(out).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  });
  it("enumerates inclusive daily buckets", () => {
    expect(expectedBuckets(new Date("2026-06-01T00:00:00Z"), new Date("2026-06-03T00:00:00Z"), "daily"))
      .toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
  it("enumerates inclusive monthly buckets", () => {
    expect(expectedBuckets(new Date("2026-05-15T00:00:00Z"), new Date("2026-07-02T00:00:00Z"), "monthly"))
      .toEqual(["2026-05", "2026-06", "2026-07"]);
  });
});

describe("detectGaps", () => {
  it("returns no gaps when every expected bucket has a snapshot", () => {
    const snaps = [snap("2026-06-01T00:00:00Z", "2026-W23"), snap("2026-06-08T00:00:00Z", "2026-W24")];
    expect(detectGaps(snaps, "weekly", new Date("2026-06-08T00:00:00Z"))).toEqual([]);
  });
  it("flags an interior missing bucket", () => {
    const snaps = [snap("2026-06-01T00:00:00Z", "2026-W23"), snap("2026-06-15T00:00:00Z", "2026-W25")];
    expect(detectGaps(snaps, "weekly", new Date("2026-06-15T00:00:00Z"))).toEqual(["2026-W24"]);
  });
  it("returns [] for an empty history", () => {
    expect(detectGaps([], "weekly", new Date("2026-06-15T00:00:00Z"))).toEqual([]);
  });
});
