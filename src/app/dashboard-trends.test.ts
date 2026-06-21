import { describe, expect, test } from "vitest";
import { computeMetricTrends } from "./dashboard-trends";

describe("computeMetricTrends", () => {
  test("complete with prior lower is direction up and improved true", () => {
    // Arrange
    const prior = { complete: 3, overdue: 0, openRaid: 0 };
    const current = { complete: 5, overdue: 0, openRaid: 0 };

    // Act
    const trends = computeMetricTrends(prior, current);

    // Assert
    expect(trends.complete).toEqual({
      value: 5,
      delta: 2,
      direction: "up",
      improved: true,
    });
  });

  test("complete with prior higher is direction down and improved false", () => {
    // Arrange
    const prior = { complete: 8, overdue: 0, openRaid: 0 };
    const current = { complete: 5, overdue: 0, openRaid: 0 };

    // Act
    const trends = computeMetricTrends(prior, current);

    // Assert
    expect(trends.complete).toEqual({
      value: 5,
      delta: -3,
      direction: "down",
      improved: false,
    });
  });

  test("overdue increasing is direction up and improved false (higher overdue is worse)", () => {
    // Arrange
    const prior = { complete: 0, overdue: 2, openRaid: 0 };
    const current = { complete: 0, overdue: 6, openRaid: 0 };

    // Act
    const trends = computeMetricTrends(prior, current);

    // Assert
    expect(trends.overdue).toEqual({
      value: 6,
      delta: 4,
      direction: "up",
      improved: false,
    });
  });

  test("overdue decreasing is direction down and improved true", () => {
    // Arrange
    const prior = { complete: 0, overdue: 6, openRaid: 0 };
    const current = { complete: 0, overdue: 2, openRaid: 0 };

    // Act
    const trends = computeMetricTrends(prior, current);

    // Assert
    expect(trends.overdue).toEqual({
      value: 2,
      delta: -4,
      direction: "down",
      improved: true,
    });
  });

  test("openRaid increasing is improved false and decreasing is improved true", () => {
    // Arrange
    const prior = { complete: 0, overdue: 0, openRaid: 4 };
    const increasing = { complete: 0, overdue: 0, openRaid: 7 };
    const decreasing = { complete: 0, overdue: 0, openRaid: 1 };

    // Act
    const up = computeMetricTrends(prior, increasing);
    const down = computeMetricTrends(prior, decreasing);

    // Assert
    expect(up.openRaid).toEqual({
      value: 7,
      delta: 3,
      direction: "up",
      improved: false,
    });
    expect(down.openRaid).toEqual({
      value: 1,
      delta: -3,
      direction: "down",
      improved: true,
    });
  });

  test("exactly equal prior and current is direction flat improved false delta zero", () => {
    // Arrange
    const prior = { complete: 5, overdue: 5, openRaid: 5 };
    const current = { complete: 5, overdue: 5, openRaid: 5 };

    // Act
    const trends = computeMetricTrends(prior, current);

    // Assert
    for (const key of ["complete", "overdue", "openRaid"] as const) {
      expect(trends[key]).toEqual({
        value: 5,
        delta: 0,
        direction: "flat",
        improved: false,
      });
    }
  });

  test("prior undefined yields null delta flat direction null improved for every metric", () => {
    // Arrange
    const current = { complete: 5, overdue: 3, openRaid: 2 };

    // Act
    const trends = computeMetricTrends(undefined, current);

    // Assert
    expect(trends.complete).toEqual({ value: 5, delta: null, direction: "flat", improved: null });
    expect(trends.overdue).toEqual({ value: 3, delta: null, direction: "flat", improved: null });
    expect(trends.openRaid).toEqual({ value: 2, delta: null, direction: "flat", improved: null });
  });

  test("prior present but missing one key treats that key as no prior and computes others", () => {
    // Arrange
    const prior = { complete: 2 };
    const current = { complete: 5, overdue: 3, openRaid: 2 };

    // Act
    const trends = computeMetricTrends(prior, current);

    // Assert
    expect(trends.complete).toEqual({ value: 5, delta: 3, direction: "up", improved: true });
    expect(trends.overdue).toEqual({ value: 3, delta: null, direction: "flat", improved: null });
    expect(trends.openRaid).toEqual({ value: 2, delta: null, direction: "flat", improved: null });
  });
});
