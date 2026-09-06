import { describe, it, expect } from "vitest";
import {
  sanitizeSteeringCommittee,
  sanitizeRaidItem,
  sanitizeMilestone,
  sanitizeMilestoneTaskIds,
  sanitizeChangeItem,
  sanitizeStakeholder,
  acceptsRiskScale,
  acceptsScheduleDays,
  acceptsCostAmount,
  acceptsStakeholderCategory,
  acceptsInfluenceInterest,
  sanitizeIsoDate,
} from "./sanitize";

/** Distinguishable test-case labels. `JSON.stringify` maps null, NaN and
 *  Infinity all to "null", so three probes would otherwise share a name and a
 *  failure could not be attributed to the value that caused it. */
const probeLabel = (v: unknown): string =>
  typeof v === "number" ? String(v) : (JSON.stringify(v) ?? String(v));

const baseRaid = {
  id: 1,
  category: "R" as const,
  title: "Vendor risk",
  status: "Open" as const,
  raisedDate: "2026-01-01",
};

describe("sanitizeRaidItem — inquiriesSent", () => {
  it("keeps a positive integer count", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: 4 })?.inquiriesSent).toBe(4);
  });
  it("floors a fractional count", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: 2.9 })?.inquiriesSent).toBe(2);
  });
  it("drops a negative count (sparse undefined)", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: -3 })?.inquiriesSent).toBeUndefined();
  });
  it("drops zero / absent (sparse undefined)", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: 0 })?.inquiriesSent).toBeUndefined();
    expect(sanitizeRaidItem({ ...baseRaid })?.inquiriesSent).toBeUndefined();
  });
});

describe("sanitizeSteeringCommittee — per-meeting report", () => {
  it("round-trips a valid meeting report (html/updatedAt/sentAt preserved)", () => {
    const out = sanitizeSteeringCommittee({
      name: "Board",
      memberResourceIds: [],
      meetings: [
        {
          id: 1,
          date: "2026-07-11",
          title: "Kickoff",
          report: {
            html: "<p>Status is green.</p>",
            updatedAt: "2026-07-11T10:00:00.000Z",
            sentAt: "2026-07-11T11:00:00.000Z",
          },
        },
      ],
      infoSchedules: [],
    })!;
    expect(out.meetings[0].report).toEqual({
      html: "<p>Status is green.</p>",
      updatedAt: "2026-07-11T10:00:00.000Z",
      sentAt: "2026-07-11T11:00:00.000Z",
    });
  });

  it("drops a report with no html", () => {
    const out = sanitizeSteeringCommittee({
      name: "Board",
      memberResourceIds: [],
      meetings: [
        { id: 1, date: "2026-07-11", title: "Kickoff", report: { updatedAt: "2026-07-11T10:00:00.000Z" } },
      ],
      infoSchedules: [],
    })!;
    expect(out.meetings[0].report).toBeUndefined();
  });

  it("caps an oversized report body to 100_000 chars", () => {
    const out = sanitizeSteeringCommittee({
      name: "Board",
      memberResourceIds: [],
      meetings: [
        {
          id: 1,
          date: "2026-07-11",
          title: "Kickoff",
          report: { html: "x".repeat(200_000), updatedAt: "2026-07-11T10:00:00.000Z" },
        },
      ],
      infoSchedules: [],
    })!;
    expect(out.meetings[0].report?.html).toHaveLength(100_000);
  });
});

describe("entity rich-field sink regression (open-followups §143)", () => {
  // Same probe as narrative-html: RICH_ALLOWED_TAGS and DOCUMENT_ALLOWED_TAGS
  // differ by exactly "img". Measured: swapping "rich" -> "document" at these
  // six call sites left every owning suite (151/151) green before this test
  // existed.
  const IMG_INPUT = '<img src="x.png">Status';

  it("sanitizeMilestone escapes an <img>-leading description", () => {
    const m = sanitizeMilestone({ id: 1, name: "M1", date: "2026-01-01", description: IMG_INPUT });
    expect(m?.description).toContain("&lt;img");
    expect(m?.description).not.toContain("<img");
  });

  it("sanitizeChangeItem escapes <img>-leading description/impactDescription/resolutionNotes", () => {
    const c = sanitizeChangeItem({
      id: 1,
      title: "C1",
      description: IMG_INPUT,
      impactDescription: IMG_INPUT,
      resolutionNotes: IMG_INPUT,
    });
    expect(c?.description).toContain("&lt;img");
    expect(c?.description).not.toContain("<img");
    expect(c?.impactDescription).toContain("&lt;img");
    expect(c?.impactDescription).not.toContain("<img");
    expect(c?.resolutionNotes).toContain("&lt;img");
    expect(c?.resolutionNotes).not.toContain("<img");
  });

  it("sanitizeRaidItem escapes <img>-leading description/mitigation", () => {
    const r = sanitizeRaidItem({ id: 1, title: "R1", description: IMG_INPUT, mitigation: IMG_INPUT });
    expect(r?.description).toContain("&lt;img");
    expect(r?.description).not.toContain("<img");
    expect(r?.mitigation).toContain("&lt;img");
    expect(r?.mitigation).not.toContain("<img");
  });
});

describe("sanitizeMilestoneTaskIds", () => {
  it("keeps positive integers in order and does NOT dedupe", () => {
    expect(sanitizeMilestoneTaskIds([3, 1, 3])).toEqual([3, 1, 3]);
  });

  it("yields [] for a delimited string, unlike sanitizeIdList", () => {
    // The asymmetry is deliberate to PRESERVE, not to fix here: this pins it so
    // the preview can mirror it exactly. Filed separately in open-followups.
    expect(sanitizeMilestoneTaskIds("1;2")).toEqual([]);
  });

  it("drops zero, negatives and non-numbers", () => {
    expect(sanitizeMilestoneTaskIds([0, -1, "x", 2])).toEqual([2]);
  });
});

describe("delegate-never-restate: the raid sanitizer and its merge-site guard", () => {
  // ★★ This is a PROPERTY over the two, not a hand-picked row. The it.each
  //  tables in sanitize-raid-patch.test.ts cannot catch a divergence, because
  //  they assert chosen values against BOTH sides at once; a rule that drifted
  //  in the same direction on both would pass. Enumerating over a value set
  //  that straddles every boundary is what makes the delegation checkable.
  const PROBES: unknown[] = [
    1, 3, 5, 0, 6, -1, 2.5, "3", "abc", "", true, false, null, undefined, [], {}, NaN, Infinity,
  ];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "stores probability %s exactly when acceptsRiskScale admits it",
    (_label, probe) => {
      const item = sanitizeRaidItem({ id: 1, title: "t", category: "R", probability: probe });
      expect(item).not.toBeNull();
      expect("probability" in item!).toBe(acceptsRiskScale(probe, "R"));
    },
  );
});

describe("delegate-never-restate: the change sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = [0, 1, 1.5, -1, "2", "abc", "", true, false, null, undefined, [], NaN, Infinity];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "stores scheduleImpactDays %s exactly when acceptsScheduleDays admits it",
    (_label, probe) => {
      const item = sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: probe });
      expect(item).not.toBeNull();
      expect("scheduleImpactDays" in item!).toBe(acceptsScheduleDays(probe));
    },
  );

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "stores costImpact %s exactly when acceptsCostAmount admits it",
    (_label, probe) => {
      const item = sanitizeChangeItem({ id: 1, title: "t", costImpact: probe });
      expect(item).not.toBeNull();
      expect("costImpact" in item!).toBe(acceptsCostAmount(probe));
    },
  );
});

describe("delegate-never-restate: the milestone sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = ["2026-01-01", "not-a-date", "", "1899-01-01", 42, true, null, undefined, [], {}];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "keeps achievedDate %s only when the stored value is a real date",
    (_label, probe) => {
      const m = sanitizeMilestone({ id: 1, name: "n", date: "2026-01-01", achievedDate: probe });
      expect(m).not.toBeNull();
      // The guard's clear-carve-out admits values the sanitizer stores nothing
      // for, so the two are NOT equivalent here — assert the sanitizer's own
      // rule and let acceptsPatchDate stay the guard's business.
      expect("achievedDate" in m!).toBe(sanitizeIsoDate(probe) !== "");
    },
  );
});

describe("delegate-never-restate: the stakeholder sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = ["Sponsor", "Other", "Nonsense", "", 42, true, null, undefined, [], {}];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "keeps category %s verbatim exactly when acceptsStakeholderCategory admits it",
    (_label, probe) => {
      const s = sanitizeStakeholder({ id: 1, name: "n", category: probe });
      expect(s).not.toBeNull();
      // A REFUSED value is reset to the hardcoded fallback, which is the defect
      // class the merge-site guard exists to stop. Assert the RESET, not a
      // missing key: this sanitizer always emits the field.
      expect(s!.category === probe).toBe(acceptsStakeholderCategory(probe));
    },
  );

  // influence/interest share acceptsInfluenceInterest and had no property
  // coverage of their own — the category sweep above cannot stand in for
  // them, since a divergence specific to this predicate would pass unseen.
  const INFLUENCE_PROBES: unknown[] = [
    "Low", "Medium", "High", "Nonsense", "", 42, true, null, undefined, [], {},
  ];

  it.each(INFLUENCE_PROBES.map((v) => [probeLabel(v), v] as const))(
    "keeps influence/interest %s verbatim exactly when acceptsInfluenceInterest admits it",
    (_label, probe) => {
      const s = sanitizeStakeholder({ id: 1, name: "n", influence: probe, interest: probe });
      expect(s).not.toBeNull();
      // "Medium" plays the same role here that "Other" plays for category: it
      // equals the fallback, so it is the probe that would catch a delegation
      // that always refuses. Keep it in the probe set.
      const admits = acceptsInfluenceInterest(probe);
      expect(s!.influence === probe).toBe(admits);
      expect(s!.interest === probe).toBe(admits);
    },
  );

  // ★★ The two it.each sweeps above compute their expectation by CALLING the
  //  predicate, so both sides move together — a predicate that accepted (or
  //  refused) EVERYTHING would keep the whole table green either way. These
  //  expectations are hardcoded on purpose: they are the only thing here that
  //  pins WHICH values are legal, independent of the predicate under test.
  it("names the accepted enum members, so an always-accepts mutant cannot hide", () => {
    expect(acceptsStakeholderCategory("Sponsor")).toBe(true);
    expect(acceptsStakeholderCategory("Nonsense")).toBe(false);
    expect(acceptsInfluenceInterest("Medium")).toBe(true);
    expect(acceptsInfluenceInterest("Nonsense")).toBe(false);
  });
});
