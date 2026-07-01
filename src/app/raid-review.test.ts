import { describe, expect, test } from "vitest";
import { getRaidReviewItems, summarizeRaidReview, isRaidActiveForReview } from "./raid-review";
import type { RaidItem } from "./types";

function raid(partial: Partial<RaidItem>): RaidItem {
  return {
    id: 1, category: "R", title: "x", status: "Open",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
    ...partial,
  };
}
const TODAY = "2026-06-04";

describe("getRaidReviewItems", () => {
  test("flags an open item past its target date as overdue", () => {
    const out = getRaidReviewItems([raid({ id: 1, targetDate: "2026-05-01", localModifiedAt: "2026-06-03T00:00:00Z" })], TODAY, 14);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("overdue");
    expect(out[0].daysOverdue).toBeGreaterThan(0);
  });
  test("flags an untouched open item as stale", () => {
    const out = getRaidReviewItems([raid({ id: 2, raisedDate: "2026-01-01" })], TODAY, 14);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("stale");
  });
  test("recently-touched, no target = not flagged", () => {
    const out = getRaidReviewItems([raid({ id: 3, localModifiedAt: "2026-06-02T00:00:00Z" })], TODAY, 14);
    expect(out).toHaveLength(0);
  });
  test("overdue wins when both apply", () => {
    const out = getRaidReviewItems([raid({ id: 4, targetDate: "2026-05-01", raisedDate: "2026-01-01" })], TODAY, 14);
    expect(out[0].reason).toBe("overdue");
  });
  test("excludes closed / terminal items", () => {
    const closed = raid({ id: 5, status: "Closed", closedDate: "2026-05-01", targetDate: "2026-01-01" });
    const resolved = raid({ id: 6, status: "Resolved", targetDate: "2026-01-01" });
    expect(getRaidReviewItems([closed, resolved], TODAY, 14)).toHaveLength(0);
  });
  test("interval boundary: exactly interval days untouched is flagged", () => {
    const out = getRaidReviewItems([raid({ id: 7, raisedDate: "2026-05-21" })], TODAY, 14);
    expect(out).toHaveLength(1);
  });
  test("sorts overdue before stale, most overdue first", () => {
    const items = [
      raid({ id: 10, raisedDate: "2026-01-01" }),
      raid({ id: 11, targetDate: "2026-05-20" }),
      raid({ id: 12, targetDate: "2026-03-01" }),
    ];
    const out = getRaidReviewItems(items, TODAY, 14);
    expect(out.map((o) => o.item.id)).toEqual([12, 11, 10]);
  });
  test("empty input -> empty", () => {
    expect(getRaidReviewItems([], TODAY, 14)).toEqual([]);
  });
});

describe("isRaidActiveForReview", () => {
  test("isRaidActiveForReview is false for closed or terminal items", () => {
    expect(isRaidActiveForReview({ closedDate: "2026-01-01", status: "Open" } as RaidItem)).toBe(false);
    expect(isRaidActiveForReview({ status: "Closed" } as RaidItem)).toBe(false);
    expect(isRaidActiveForReview({ status: "Open" } as RaidItem)).toBe(true);
  });
});

describe("summarizeRaidReview", () => {
  test("counts overdue and stale", () => {
    const items = getRaidReviewItems(
      [raid({ id: 1, targetDate: "2026-01-01" }), raid({ id: 2, raisedDate: "2026-01-01" })],
      TODAY, 14,
    );
    expect(summarizeRaidReview(items)).toEqual({ overdue: 1, stale: 1 });
  });
});
