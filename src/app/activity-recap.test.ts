import { describe, expect, it } from "vitest";
import { buildActivityRecapBlock } from "./activity-recap";
import type { ActivitySummary } from "./history-search";

const s = (
  over: Partial<ActivitySummary["byActor"]>,
  total: number,
  latestAt = "2026-08-16T09:12:00.000Z",
): ActivitySummary => ({
  total,
  byActor: { user: 0, ai: 0, integration: 0, unknown: 0, ...over },
  latestAt,
});

describe("buildActivityRecapBlock", () => {
  it("returns an empty string for a null summary", () => {
    expect(buildActivityRecapBlock(null, "UTC")).toBe("");
  });

  it("omits the breakdown when only one bucket is non-zero", () => {
    const out = buildActivityRecapBlock(s({ user: 14 }, 14), "UTC");
    expect(out).toContain("14 changes in the last 7 days");
    expect(out).not.toContain("by the user");
    expect(out).toContain("search_history");
  });

  it("names each non-zero bucket when more than one is present", () => {
    const out = buildActivityRecapBlock(s({ user: 9, ai: 5 }, 14), "UTC");
    expect(out).toContain("9 by the user");
    expect(out).toContain("5 by the AI assistant");
    expect(out).not.toContain("integration");
  });

  it("renders the unknown bucket only when non-zero", () => {
    expect(buildActivityRecapBlock(s({ user: 2, unknown: 3 }, 5), "UTC")).toContain(
      "3 of unknown origin",
    );
    expect(buildActivityRecapBlock(s({ user: 2, ai: 3 }, 5), "UTC")).not.toContain(
      "unknown origin",
    );
  });

  // ★ The one assertion a UTC-only fixture cannot fail: 23:30Z on the 16th is
  //   01:30 on the 17th in Berlin, so a renderer that sliced the raw UTC stamp
  //   would still say "2026-08-16" here.
  it("renders latestAt in the PROJECT zone", () => {
    const out = buildActivityRecapBlock(
      s({ user: 1 }, 1, "2026-08-16T23:30:00.000Z"),
      "Europe/Berlin",
    );
    expect(out).toContain("2026-08-17");
  });

  // ★ ANTI-VACUITY for the fallback branch: `dayInZone` returns null on an
  //   unparseable instant, and the block must still name the tool rather than
  //   render "latest null" or throw.
  it("falls back to the raw latestAt when it cannot be parsed", () => {
    const out = buildActivityRecapBlock(s({ user: 1 }, 1, "whenever"), "UTC");
    expect(out).toContain("latest whenever");
    expect(out).toContain("Use search_history to read them.");
  });
});
