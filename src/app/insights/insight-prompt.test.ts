import { describe, it, expect } from "vitest";
import type { Insight, InsightSeverity, InsightStatus, InsightType } from "./insight";
import {
  buildInsightsPromptBlock,
  MAX_PROMPT_INSIGHTS,
  MAX_PROMPT_OUTCOMES,
} from "./insight-prompt";

function make(
  id: number,
  type: InsightType,
  severity: InsightSeverity,
  status: InsightStatus,
  data: Insight["data"],
): Insight {
  return {
    id,
    key: `k${id}`,
    type,
    severity,
    data,
    status,
    firstSeenAt: "2026-07-01",
    lastSeenAt: "2026-07-01",
    occurrences: 1,
  };
}

/** An acted-on insight carrying a measured outcome. Builds on `make` rather
 *  than duplicating it — only the outcome is new. */
function acted(id: number, outcome?: Insight["outcome"]): Insight {
  return {
    ...make(id, "stalledWork", "high", "acted", { count: 4 }),
    outcome: outcome ?? {
      direction: "improved",
      baseline: 9,
      current: 3,
      // ★ delta is `baseline − current` and POSITIVE means better (every
      //   insight metric is lower-is-better) — see InsightOutcome.
      delta: 6,
      measuredAt: "2026-08-10",
    },
  };
}

describe("buildInsightsPromptBlock", () => {
  it("returns empty string when there are no insights", () => {
    expect(buildInsightsPromptBlock([])).toBe("");
  });

  it("returns empty string when no insight is active/acknowledged", () => {
    const insights = [
      make(1, "stalledWork", "high", "dismissed", { count: 4 }),
      make(2, "stalledWork", "high", "resolved", { count: 4 }),
      make(3, "stalledWork", "high", "acted", { count: 4 }),
    ];
    expect(buildInsightsPromptBlock(insights)).toBe("");
  });

  it("lists active and acknowledged insights with a header", () => {
    const insights = [
      make(1, "milestoneSlip", "high", "active", { name: "M12", daysOverdue: 5, date: "2026-07-10" }),
      make(2, "stalledWork", "medium", "acknowledged", { count: 4 }),
    ];
    const block = buildInsightsPromptBlock(insights);
    expect(block).toContain("Current project insights");
    expect(block).toContain('- [high] Milestone "M12" slipped, 5d overdue');
    expect(block).toContain("- [medium] 4 tasks stalled or blocked");
  });

  it("excludes dismissed and resolved insights from the listing", () => {
    const insights = [
      make(1, "milestoneSlip", "high", "active", { name: "Keep", daysOverdue: 5, date: "2026-07-10" }),
      make(2, "milestoneSlip", "high", "dismissed", { name: "Drop", daysOverdue: 9, date: "2026-07-10" }),
    ];
    const block = buildInsightsPromptBlock(insights);
    expect(block).toContain("Keep");
    expect(block).not.toContain("Drop");
  });

  it("sorts by severity (high before medium before low)", () => {
    const insights = [
      make(1, "stalledWork", "low", "active", { count: 1 }),
      make(2, "stalledWork", "high", "active", { count: 2 }),
      make(3, "stalledWork", "medium", "active", { count: 3 }),
    ];
    const block = buildInsightsPromptBlock(insights);
    const hi = block.indexOf("[high]");
    const med = block.indexOf("[medium]");
    const lo = block.indexOf("[low]");
    expect(hi).toBeGreaterThan(-1);
    expect(hi).toBeLessThan(med);
    expect(med).toBeLessThan(lo);
  });

  it("caps to the top-N by severity", () => {
    const insights: Insight[] = [];
    for (let i = 0; i < MAX_PROMPT_INSIGHTS + 5; i++) {
      insights.push(make(i, "stalledWork", "medium", "active", { count: i }));
    }
    const block = buildInsightsPromptBlock(insights);
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(MAX_PROMPT_INSIGHTS);
  });

  it("is deterministic (same input → same output)", () => {
    const insights = [
      make(1, "budgetVariance", "high", "active", { name: "Dev", variancePct: 22, buckets: 3 }),
      make(2, "raidAging", "medium", "active", { name: "R7", daysSinceUpdate: 30, targetDate: "2026-06-01" }),
      make(3, "overdueTrend", "low", "active", { current: 8, prior: 5, delta: 3 }),
    ];
    expect(buildInsightsPromptBlock(insights)).toBe(buildInsightsPromptBlock(insights));
  });
});

// ★★★ THE THREE NUMBERS MUST ALL DIFFER, for the same reason `insight-text.test.ts`
// says they must there: the four guardrail fact lines interleave `count`,
// `threshold` and `worstHours` positionally, and two of them render the threshold
// BEFORE the peak ("over the 8h cap, worst 12h"). Transposing a pair yields a
// perfectly fluent sentence carrying the WRONG numbers — tsc only enforces that the
// switch is exhaustive, never which number lands where, and this text rides every
// AI turn. A fixture where any two of these coincide is VACUOUS against exactly
// that defect. Values match the sibling file so the two read as one convention.
const G_COUNT = 2;
const G_WORST_HOURS = 12;
const G_THRESHOLD = 8;

/** A guardrail insight. `severity` is uniformly "medium" (see `detect.ts`). */
function guardrail(id: number, type: InsightType): Insight {
  return make(id, type, "medium", "active", {
    person: "Ada",
    count: G_COUNT,
    worstHours: G_WORST_HOURS,
    threshold: G_THRESHOLD,
  });
}

describe("guardrail fact lines", () => {
  // ★ WHOLE rendered lines, never substrings — a substring match on "12h" cannot
  // tell the peak from the threshold, so it would pass against the transposition.
  const CASES: readonly (readonly [InsightType, string])[] = [
    [
      "timelogCapPerEntry",
      "- [medium] TimeLog: Ada has 2 day(s) with a single entry over the 8h cap, worst 12h",
    ],
    [
      "timelogCapPerDay",
      "- [medium] TimeLog: Ada has 2 day(s) over the 8h daily cap, worst 12h (fetched projects only)",
    ],
    ["timelogNonWorkingDay", "- [medium] TimeLog: Ada booked time on 2 non-working day(s), worst 12h"],
    [
      "timelogWorkingHours",
      "- [medium] TimeLog: Ada booked over defined hours on 2 day(s), worst 12h",
    ],
  ];

  for (const [type, line] of CASES) {
    it(`renders the ${type} fact line with each number in its own slot`, () => {
      const block = buildInsightsPromptBlock([guardrail(1, type)]);
      // Equality against the extracted line, not `toContain`: a `toContain` would
      // still pass if the builder appended stray text to the same line.
      const lines = block.split("\n").filter((l) => l.startsWith("- "));
      expect(lines).toEqual([line]);
    });
  }

  // ★ `timelogNonWorkingDay` is the one guardrail whose sentence reads NO
  // threshold — a booking on a non-working day is a violation at any number of
  // hours, and `timelog-policy.ts` records the threshold as a literal 0. Pinning
  // the absence stops a future edit "completing the pattern" by interpolating a
  // threshold that means nothing there.
  it("omits the threshold from the non-working-day line", () => {
    const block = buildInsightsPromptBlock([guardrail(1, "timelogNonWorkingDay")]);
    expect(block).not.toContain(`${G_THRESHOLD}h`);
    // Not vacuous: the SAME fixture does render the threshold for a rule that has one.
    expect(buildInsightsPromptBlock([guardrail(1, "timelogCapPerDay")])).toContain(
      `${G_THRESHOLD}h daily cap`,
    );
  });
});

describe("recent outcomes section", () => {
  it("surfaces acted insights that carry an outcome, with the measured move", () => {
    const out = buildInsightsPromptBlock([acted(1)]);
    expect(out).toContain("Recent outcomes");
    expect(out).toContain("- 4 tasks stalled or blocked → acted, improved (9 → 3, +6)");
  });

  // ★ Pins BOTH members of the status set: dropping "resolved" loses the first
  //   line, and dropping the status check altogether admits the dismissed one.
  it("includes a resolved insight with an outcome and excludes a dismissed one", () => {
    const out = buildInsightsPromptBlock([
      { ...acted(1), status: "resolved", data: { count: 7 } },
      { ...acted(2), status: "dismissed", data: { count: 8 } },
    ]);
    expect(out).toContain("7 tasks stalled");
    expect(out).not.toContain("8 tasks stalled");
  });

  it("renders both sections when active and acted insights coexist", () => {
    const out = buildInsightsPromptBlock([
      make(1, "stalledWork", "high", "active", { count: 2 }),
      acted(2),
    ]);
    expect(out).toContain("Current project insights");
    expect(out).toContain("Recent outcomes");
    // The two sections are separated by a blank line.
    expect(out).toContain("\n\nRecent outcomes");
  });

  it("omits the section entirely when no outcome exists", () => {
    expect(buildInsightsPromptBlock([])).toBe("");
    const activeOnly = buildInsightsPromptBlock([
      make(1, "stalledWork", "high", "active", { count: 4 }),
    ]);
    expect(activeOnly).not.toContain("Recent outcomes");
  });

  // ★ 'unchanged' must be INCLUDED: a tried-it-and-nothing-moved result is what
  //   stops the assistant re-recommending the same action. Filtering it would
  //   bias the model's view toward things that worked.
  it("includes unchanged outcomes", () => {
    const out = buildInsightsPromptBlock([
      acted(1, { direction: "unchanged", baseline: 5, measuredAt: "2026-08-10" }),
    ]);
    expect(out).toContain("unchanged");
    // No `current`/`delta` measured (the detector is threshold-gated), so no
    // magnitude is claimed.
    expect(out).toContain("- 4 tasks stalled or blocked → acted, unchanged");
    expect(out).not.toContain("(5 →");
  });

  // ★ TEST-VALIDITY NOTE: `measuredAt` never appears in the rendered line, so
  //   asserting on the date would be VACUOUS — it would pass whatever the sort
  //   does. The fixture varies `count`, which DOES render ("N tasks stalled"),
  //   so ordering is observable.
  it("caps at MAX_PROMPT_OUTCOMES, newest measuredAt first", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...make(i + 1, "stalledWork", "high", "acted", { count: i + 1 }),
      outcome: {
        direction: "improved" as const,
        baseline: 1,
        measuredAt: `2026-08-0${i + 1}`,
      },
    }));
    const block = buildInsightsPromptBlock(many);
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(MAX_PROMPT_OUTCOMES);
    // measuredAt 08-09 → 08-05 survive, i.e. counts 9 down to 5; count 4 is cut.
    expect(lines[0]).toContain("9 tasks stalled");
    expect(lines[4]).toContain("5 tasks stalled");
    expect(block).not.toContain("4 tasks stalled");
  });

  // ★ Two outcomes measured on the SAME day must not order arbitrarily — the
  //   comparator falls back to `id`, which keeps the block byte-stable.
  // ★★ TEST-VALIDITY: asserting one fixed input's order is VACUOUS here, and
  //   measurably so — a comparator that never returns 0 was mutated in and the
  //   single-input version stayed GREEN, because V8 happens to reverse a
  //   two-element pair under it, which matched the expected id order by luck.
  //   The real property is INPUT-ORDER INDEPENDENCE, so both permutations are
  //   fed in: a no-tiebreak comparator (`0`, stable) preserves each input order
  //   and a never-0 one reverses each, and both then disagree across the two.
  it("breaks a measuredAt tie by id, independent of input order", () => {
    const same = (id: number, count: number): Insight => ({
      ...make(id, "stalledWork", "high", "acted", { count }),
      outcome: { direction: "improved" as const, baseline: 1, measuredAt: "2026-08-10" },
    });
    const linesOf = (input: readonly Insight[]) =>
      buildInsightsPromptBlock(input)
        .split("\n")
        .filter((l) => l.startsWith("- "));
    const descending = linesOf([same(9, 91), same(2, 22)]);
    const ascending = linesOf([same(2, 22), same(9, 91)]);
    expect(descending).toEqual(ascending);
    expect(descending[0]).toContain("22 tasks stalled");
    expect(descending[1]).toContain("91 tasks stalled");
  });

  it("ignores acted insights with no outcome measured yet", () => {
    const noOutcome = { ...make(1, "stalledWork", "high", "acted", { count: 4 }) };
    expect(buildInsightsPromptBlock([noOutcome])).not.toContain("Recent outcomes");
  });
});
