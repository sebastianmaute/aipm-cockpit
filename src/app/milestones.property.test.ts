import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { bucketMilestonesByHorizon, type MilestoneHorizon } from "./milestones";
import type { Milestone, Task } from "./types";

const dateArb = fc.integer({ min: Date.parse("2024-01-01T00:00:00Z"), max: Date.parse("2030-12-31T00:00:00Z") })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

const milestoneArb = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  name: fc.string(),
  date: dateArb,
  achievedDate: fc.option(dateArb, { nil: undefined }),
  linkedTaskIds: fc.constant([] as number[]),
}) as fc.Arbitrary<Milestone>;

const BUCKETS: MilestoneHorizon[] = ["overdue", "thisWeek", "next2Weeks", "later"];
const noTasks = new Map<number, Task>();
const hs = new Set<string>();

describe("bucketMilestonesByHorizon properties", () => {
  test("every non-achieved milestone lands in exactly one bucket; achieved in none", () => {
    fc.assert(fc.property(fc.uniqueArray(milestoneArb, { maxLength: 40, selector: (m) => m.id }), dateArb, (milestones, today) => {
      const b = bucketMilestonesByHorizon(milestones, noTasks, today, hs);
      const placed = BUCKETS.reduce((n, k) => n + b[k].length, 0);
      const nonAchieved = milestones.filter((m) => !m.achievedDate).length;
      expect(placed).toBe(nonAchieved);
      const ids = BUCKETS.flatMap((k) => b[k].map((e) => e.milestone.id));
      expect(new Set(ids).size).toBe(ids.length);
    }));
  });

  test("each bucket is sorted ascending by date", () => {
    fc.assert(fc.property(fc.array(milestoneArb, { maxLength: 40 }), dateArb, (milestones, today) => {
      const b = bucketMilestonesByHorizon(milestones, noTasks, today, hs);
      for (const k of BUCKETS) {
        const dates = b[k].map((e) => e.milestone.date);
        expect([...dates].sort((x, y) => x.localeCompare(y))).toEqual(dates);
      }
    }));
  });
});
