import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { __resetMintStateForTests } from "./id-mint-session";
import {
  riskSeverityFromMatrix,
  compareRaid,
  countByCategory,
  nextRaidId,
  buildRaidByTaskIndex,
  type RaidSortKey,
} from "./raid";
import type { RaidItem, RaidSeverity, RaidStatus, RiskScale } from "./types";

const SEVERITY_RANK: Record<RaidSeverity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

const isoDateArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const riskScaleArb = fc.constantFrom<RiskScale>(1, 2, 3, 4, 5);

const raidItemArb: fc.Arbitrary<RaidItem> = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  category: fc.constantFrom("R" as const, "A" as const, "I" as const, "D" as const),
  title: fc.string(),
  status: fc.constantFrom<RaidStatus>("Open", "Closed", "Resolved", "Mitigated"),
  severity: fc.option(fc.constantFrom<RaidSeverity>("Low", "Medium", "High", "Critical"), { nil: undefined }),
  owner: fc.option(fc.string(), { nil: undefined }),
  targetDate: fc.option(isoDateArb, { nil: undefined }),
  linkedTaskIds: fc.array(fc.integer({ min: 1, max: 500 }), { maxLength: 5 }),
  raisedDate: isoDateArb,
  causedByRaidIds: fc.constant<number[]>([]),
  stakeholderIds: fc.constant<number[]>([]),
});

const sortKeyArb = fc.constantFrom<RaidSortKey>(
  "id", "category", "title", "severity", "status", "owner", "targetDate",
);
const dirArb = fc.constantFrom("asc" as const, "desc" as const);

describe("raid — properties", () => {
  test("riskSeverityFromMatrix always yields one of the four levels", () => {
    fc.assert(
      fc.property(riskScaleArb, riskScaleArb, (p, i) => {
        expect(["Low", "Medium", "High", "Critical"]).toContain(riskSeverityFromMatrix(p, i));
      }),
    );
  });

  test("riskSeverityFromMatrix is monotonic non-decreasing in probability × impact", () => {
    fc.assert(
      fc.property(riskScaleArb, riskScaleArb, riskScaleArb, riskScaleArb, (p1, i1, p2, i2) => {
        if (p1 * i1 <= p2 * i2) {
          expect(SEVERITY_RANK[riskSeverityFromMatrix(p1, i1)]).toBeLessThanOrEqual(
            SEVERITY_RANK[riskSeverityFromMatrix(p2, i2)],
          );
        }
      }),
    );
  });

  test("compareRaid is reflexive (cmp(a,a) === 0)", () => {
    fc.assert(
      fc.property(raidItemArb, sortKeyArb, dirArb, (a, key, dir) => {
        // `=== 0` treats signed zero as zero (desc negates 0 → -0).
        expect(compareRaid(a, a, key, dir) === 0).toBe(true);
      }),
    );
  });

  test("compareRaid is antisymmetric (sign(cmp(a,b)) === -sign(cmp(b,a)))", () => {
    // Sign helper that never returns -0, so the zero case compares cleanly.
    const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
    fc.assert(
      fc.property(raidItemArb, raidItemArb, sortKeyArb, dirArb, (a, b, key, dir) => {
        expect(sign(compareRaid(a, b, key, dir)) === -sign(compareRaid(b, a, key, dir))).toBe(true);
      }),
    );
  });

  test("sorting with compareRaid never throws and preserves length", () => {
    fc.assert(
      fc.property(fc.array(raidItemArb, { maxLength: 30 }), sortKeyArb, dirArb, (items, key, dir) => {
        const sorted = [...items].sort((a, b) => compareRaid(a, b, key, dir));
        expect(sorted.length).toBe(items.length);
      }),
    );
  });

  test("targetDate sort always places missing dates last (both directions)", () => {
    const withDate = fc.array(raidItemArb, { maxLength: 20 });
    fc.assert(
      fc.property(withDate, dirArb, (items, dir) => {
        const sorted = [...items].sort((a, b) => compareRaid(a, b, "targetDate", dir));
        const firstMissing = sorted.findIndex((i) => !i.targetDate);
        if (firstMissing === -1) return;
        // Everything after the first missing must also be missing.
        for (let i = firstMissing; i < sorted.length; i++) {
          expect(sorted[i].targetDate == null || sorted[i].targetDate === "").toBe(true);
        }
      }),
    );
  });

  test("countByCategory partitions the input (sum === length)", () => {
    fc.assert(
      fc.property(fc.array(raidItemArb, { maxLength: 40 }), (items) => {
        const counts = countByCategory(items);
        expect(counts.R + counts.A + counts.I + counts.D).toBe(items.length);
        for (const c of ["R", "A", "I", "D"] as const) expect(counts[c]).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test("nextRaidId is strictly greater than every existing id", () => {
    __resetMintStateForTests();
    fc.assert(
      fc.property(fc.array(raidItemArb, { maxLength: 40 }), (items) => {
        const next = nextRaidId(items);
        expect(next).toBeGreaterThanOrEqual(1);
        for (const i of items) expect(next).toBeGreaterThan(i.id);
      }),
    );
  });

  test("buildRaidByTaskIndex total entries === sum of linkedTaskIds", () => {
    fc.assert(
      fc.property(fc.array(raidItemArb, { maxLength: 30 }), (items) => {
        const idx = buildRaidByTaskIndex(items);
        let total = 0;
        for (const list of idx.values()) total += list.length;
        const expected = items.reduce((acc, i) => acc + i.linkedTaskIds.length, 0);
        expect(total).toBe(expected);
      }),
    );
  });
});
