import { describe, expect, test } from "vitest";
import { getBucketReminders } from "./budget-report";
import type { BudgetBucket } from "./types";

const b = (extra: Partial<BudgetBucket>): BudgetBucket =>
  ({ id: 1, name: "B", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-02-28", status: "open", allocations: [], ...extra });

describe("getBucketReminders", () => {
  test("flags open buckets whose end date is within the lead window", () => {
    const items = getBucketReminders([b({ endDate: "2026-02-10" })], 14, "2026-02-01");
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("soon");
  });
  test("flags overdue (past end date, still open)", () => {
    const items = getBucketReminders([b({ endDate: "2026-01-15" })], 14, "2026-02-01");
    expect(items[0].category).toBe("overdue");
  });
  test("ignores closed buckets and far-future ends", () => {
    expect(getBucketReminders([b({ status: "closed", endDate: "2026-02-02" })], 14, "2026-02-01")).toHaveLength(0);
    expect(getBucketReminders([b({ endDate: "2026-06-01" })], 14, "2026-02-01")).toHaveLength(0);
  });
});
