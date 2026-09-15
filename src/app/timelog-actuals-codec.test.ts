import { describe, expect, it } from "vitest";
import { aggregateActuals } from "./timelog-actuals";
import {
  fromStoredAggregate,
  isPackedBucketDays,
  packBucketDays,
  toStoredAggregate,
  unpackBucketDays,
  type StoredAggregate,
} from "./timelog-actuals-codec";
import type { TimelogLinks, TimelogTimeItem } from "./timelog-types";

const links: TimelogLinks = {
  userLinks: [
    { timelogUserId: 1, resourceId: 10, manual: true },
    { timelogUserId: 2, resourceId: 1726000000020, manual: true },
  ],
  projectLinks: [
    { timelogProjectId: 9, bucketId: 7, manual: true },
    { timelogProjectId: 8, bucketId: 3, manual: true },
  ],
};

const item = (userId: number, projectId: number, date: string, hours: number, billableHours: number): TimelogTimeItem => ({
  timeRegistrationId: 1, userId, projectId, projectName: "", projectNo: "", taskId: 0, date, hours, billableHours, isBillable: billableHours > 0,
});

/** Decimal sums (0.1 + 0.2 is 0.30000000000000004), a credit correction, a
 *  resource id past 2^32 and a shape-valid NON-date (2026-02-30), because
 *  `aggregateActuals` admits any YYYY-MM-DD-shaped key. */
const dated = () =>
  aggregateActuals(
    [
      item(1, 9, "2026-06-10", 0.1, 0.1),
      item(1, 9, "2026-06-10", 0.2, 0),
      item(2, 9, "2026-06-10", 7.25, 7.25),
      item(2, 9, "2026-06-11", -1.5, -1.5),
      item(1, 8, "2026-02-30", 3, 3),
      item(2, 8, "2026-12-31", 8, 8),
    ],
    links,
  );

describe("timelog actuals codec", () => {
  it("round-trips the aggregate through JSON exactly", () => {
    const agg = dated();
    const stored = JSON.parse(JSON.stringify(toStoredAggregate(agg))) as StoredAggregate;
    expect(stored.byBucketDay).toBeUndefined();
    expect(isPackedBucketDays(stored.dayCells)).toBe(true);
    expect(fromStoredAggregate(stored)).toEqual(agg);
  });

  it("omits a billable column that equals its hours column, and keeps one that does not", () => {
    const allBillable = packBucketDays(aggregateActuals([item(1, 9, "2026-06-10", 2, 2)], links).byBucketDay ?? {});
    expect(allBillable.b["7"].hb).toBeUndefined();
    expect(allBillable.b["7"].tb).toBeUndefined();
    const mixed = packBucketDays(dated().byBucketDay ?? {});
    expect(mixed.b["7"].hb).toEqual([0.1, 7.25, -1.5]);
    expect(mixed.b["7"].tb).toEqual([7.35, -1.5]);
  });

  it("passes a legacy period-keyed aggregate through both ways by identity", () => {
    const legacy = { byBucket: { 7: { "2026-06": { hours: 1, billableHours: 1 } } }, byResource: {}, unattributed: { hours: 0, billableHours: 0 } };
    expect(toStoredAggregate(legacy)).toBe(legacy);
    expect(fromStoredAggregate(legacy)).toBe(legacy);
  });

  it("loads a verbose byBucketDay aggregate from an earlier build by identity", () => {
    const verbose = dated();
    expect(fromStoredAggregate(verbose)).toBe(verbose);
  });

  it("packs a year of day cells to well under a third of the verbose size", () => {
    // Measured 2026-09-14: this fixture is 186,408 chars verbose and 48,538
    // packed (ratio 0.260). The bound leaves room for fixture drift, not for a
    // codec that stopped packing.
    const items: TimelogTimeItem[] = [];
    for (let b = 0; b < 10; b += 1) {
      for (let day = 0; day < 250; day += 1) {
        for (let p = 0; p < 4; p += 1) {
          const hours = (((day * 7 + p * 3 + b) % 31) + 1) / 4;
          const date = `2026-${String((day % 12) + 1).padStart(2, "0")}-${String((day % 28) + 1).padStart(2, "0")}`;
          items.push(item(p + 1, b + 1, date, hours, (day + p) % 3 === 0 ? 0 : hours));
        }
      }
    }
    const bigLinks: TimelogLinks = {
      userLinks: [1, 2, 3, 4].map((u) => ({ timelogUserId: u, resourceId: u * 10, manual: true })),
      projectLinks: Array.from({ length: 10 }, (_, b) => ({ timelogProjectId: b + 1, bucketId: b + 100, manual: true })),
    };
    const agg = aggregateActuals(items, bigLinks);
    const ratio = JSON.stringify(toStoredAggregate(agg)).length / JSON.stringify(agg).length;
    expect(ratio).toBeLessThan(0.35);
  });

  it("admits and unpacks an empty payload", () => {
    const empty = { v: 1 as const, days: [], res: [], b: {} };
    expect(isPackedBucketDays(empty)).toBe(true);
    expect(unpackBucketDays(empty)).toEqual({});
  });

  describe("rejects a malformed payload", () => {
    const good = packBucketDays(dated().byBucketDay ?? {});
    const col = good.b["7"];
    const cases: [string, unknown][] = [
      ["an unknown version", { ...good, v: 2 }],
      ["a day that is not YYYY-MM-DD", { ...good, days: ["06/10/2026", ...good.days.slice(1)] }],
      ["a day index past the day table", { ...good, b: { ...good.b, 7: { ...col, d: [99, ...col.d.slice(1)] } } }],
      ["a repeated day in one bucket", { ...good, b: { ...good.b, 7: { ...col, d: [col.d[0], 0] } } }],
      ["a resource index past the resource table", { ...good, b: { ...good.b, 7: { ...col, r: [5, ...col.r.slice(1)] } } }],
      ["a resource row missing its hours", { ...good, b: { ...good.b, 7: { ...col, h: col.h.slice(1) } } }],
      ["a null day total", { ...good, b: { ...good.b, 7: { ...col, t: [null, ...col.t.slice(1)] } } }],
      ["a negative row count", { ...good, b: { ...good.b, 7: { ...col, n: [-1, ...col.n.slice(1)] } } }],
      ["a string resource id", { ...good, res: ["10", ...good.res.slice(1)] }],
      ["bucket columns held in an array", { ...good, b: [] }],
      ["a null bucket", { ...good, b: { ...good.b, 7: null } }],
      ["a number", 5],
      ["null", null],
    ];
    it.each(cases)("%s", (_name, payload) => {
      expect(isPackedBucketDays(payload)).toBe(false);
    });

    it("accepts the unmodified payload (control)", () => {
      expect(isPackedBucketDays(JSON.parse(JSON.stringify(good)))).toBe(true);
    });
  });
});
