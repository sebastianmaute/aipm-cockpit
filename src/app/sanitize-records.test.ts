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
  AMOUNT_MAX,
  toNumber,
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

  it("refuses a boolean probability rather than storing a fabricated 1", () => {
    // toNumber(true) is 1, which is inside [1,5] — so the old rule stored a
    // plausible score that feeds riskSeverityFromMatrix. toNumber(false) is 0
    // and was already out of range, so only one half of the pair was reachable.
    expect(acceptsRiskScale(true, "R")).toBe(false);
    expect(acceptsRiskScale(false, "R")).toBe(false);
    expect(acceptsRiskScale(3, "R")).toBe(true);
    expect(acceptsRiskScale("3", "R")).toBe(true);
  });
});

describe("delegate-never-restate: the change sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = [0, 1, 1.5, -1, "2", "abc", "", true, false, null, undefined, [], NaN, Infinity];

  // ★★★ THE PROPERTY THESE TWO SWEEPS ASSERT CHANGED SHAPE WITH THE §399
  //  REPAIR, and the old one is now FALSE. It read
  //  `"scheduleImpactDays" in item === acceptsScheduleDays(probe)`, which held
  //  while a refused value was simply DROPPED. The loader now REPAIRS a
  //  coercible one first, so a stored 1.5 loads as 2 — present, while the
  //  predicate refuses 1.5. Two weaker-looking but jointly STRONGER properties
  //  survive, and together they are what "delegate, never restate" now means
  //  here: the predicate still BOUNDS the loader's output, and it still governs
  //  every value that needs no repair.
  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "never stores a scheduleImpactDays acceptsScheduleDays would refuse (%s)",
    (_label, probe) => {
      const item = sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: probe });
      expect(item).not.toBeNull();
      const stored = item!.scheduleImpactDays;
      expect(stored === undefined || acceptsScheduleDays(stored)).toBe(true);
      // ★ Repair never touches a value the predicate ALREADY accepts, so where
      //  there is nothing to repair the loader and the merge-site guard agree
      //  exactly — which is what this sweep was originally for.
      if (acceptsScheduleDays(probe)) expect(stored).toBe(toNumber(probe));
    },
  );

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "never stores a costImpact acceptsCostAmount would refuse (%s)",
    (_label, probe) => {
      const item = sanitizeChangeItem({ id: 1, title: "t", costImpact: probe });
      expect(item).not.toBeNull();
      const stored = item!.costImpact;
      expect(stored === undefined || acceptsCostAmount(stored)).toBe(true);
      if (acceptsCostAmount(probe)) expect(stored).toBe(toNumber(probe));
    },
  );

  // ★★ THE SWEEPS ABOVE ARE VACUOUS IF NOTHING IS EVER STORED — a loader that
  //  dropped every value would satisfy both. These name the repaired values, so
  //  they are the only thing pinning that the repair HAPPENS.
  it("repairs a legacy out-of-precision value instead of destroying it", () => {
    // ★★★ THE DEFECT THIS CLOSES IS A SILENT LOAD-PATH CLEAR. Before the
    //  repair, tightening the predicate meant a `1.5` written by the pre-fix
    //  modal — whose `{ round: 0 }` clamp ran only on blur while Enter-submit
    //  skipped it — simply vanished on the next load, and nothing could report
    //  it: the JSON loader takes no diag, and the CSV/MD `ImportDiag` is
    //  ROW-level, so a dropped FIELD is invisible to it.
    expect(sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: 1.5 })!.scheduleImpactDays).toBe(2);
    expect(sanitizeChangeItem({ id: 1, title: "t", costImpact: 1500.555 })!.costImpact).toBe(1500.56);
    expect(sanitizeChangeItem({ id: 1, title: "t", costImpact: 5_000_000_000 })!.costImpact).toBe(AMOUNT_MAX);
  });

  it("leaves an already-valid value untouched", () => {
    expect(sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: 12 })!.scheduleImpactDays).toBe(12);
    expect(sanitizeChangeItem({ id: 1, title: "t", costImpact: 4500.25 })!.costImpact).toBe(4500.25);
  });

  it("still DROPS a boolean rather than repairing it into a fabricated number", () => {
    // ★★★ THE ONE VALUE WITH NO CORRECT REPAIR. `toNumber(true)` is 1, which is
    //  a plausible day count and a plausible cost — the §395 fabrication — so
    //  `isCoercibleNumber` gates the repair as well as the acceptance. Rounding
    //  it would be worse than dropping it: the number would look authored.
    expect("scheduleImpactDays" in sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: true })!).toBe(false);
    expect("costImpact" in sanitizeChangeItem({ id: 1, title: "t", costImpact: true })!).toBe(false);
    // ★ A NEGATIVE COST is dropped too, not clamped to 0 — `repairCostAmount`
    //  covers precision and the cap, never the floor, which is where
    //  `sanitizeAmount` puts it.
    expect("costImpact" in sanitizeChangeItem({ id: 1, title: "t", costImpact: -5 })!).toBe(false);
    // ★★★ THAT IS NOT A SYMMETRY ACROSS THE TWO AMOUNTS, and an earlier wording
    //  of this comment asserted one ("A NEGATIVE is dropped too", unqualified).
    //  It holds for `costImpact`, whose predicate has an explicit `n < 0`. It is
    //  FALSE for `scheduleImpactDays` over [-0.5, 0]: `repairScheduleDays` is
    //  `Math.round`, which returns `-0` there (JS rounds .5 toward +∞), and
    //  `Number.isInteger(-0)` and `-0 >= 0` are both true — so it is ACCEPTED
    //  and stored. The stored `-0` is harmless (it normalises to 0 on the next
    //  save) and rounding a near-zero negative to zero is arguably the right
    //  repair. The defect was the JUSTIFICATION, which claimed a floor rule the
    //  two fields do not share. Measured, not reasoned — these two probes are
    //  the measurement.
    const nearZero = sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.4 })!;
    expect(Object.is(nearZero.scheduleImpactDays, -0)).toBe(true);
    const halfDown = sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.5 })!;
    expect(Object.is(halfDown.scheduleImpactDays, -0)).toBe(true);
    // ★ The interval really is closed at BOTH ends — one step further out
    //  rounds to -1 and the floor rejects it, so the acceptance is bounded.
    expect("scheduleImpactDays" in sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.6 })!).toBe(false);
  });
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

// ★★★ THE TWO AMOUNT FIELDS DO NOT SHARE A PRECISION RULE, which is the whole
//  reason one `acceptsChangeAmount` had to become two. `change-edit-modal.tsx`
//  clamps `scheduleImpactDays` with `describeClamp(value, { min: 0, round: 0 })`
//  and `costImpact` with `{ min: 0, max: AMOUNT_MAX, round: 2 }` — so the two
//  move in OPPOSITE directions here (§399): the writer TIGHTENS for days, the
//  preview LOOSENS for money. These expectations are hardcoded rather than
//  derived from the predicates, so an always-accepts mutant cannot hide behind
//  the it.each sweeps above, which compute both sides from the predicate.
describe("change amount precision follows each field's own form control", () => {
  // ★★★ THE NAME USED TO READ "which round:0 cannot produce" AND THAT WAS
  //  FALSE. `describeClamp(value, { min: 0, round: 0 })` ran only in the
  //  field's `onBlur`, and Enter inside a text input submits WITHOUT firing
  //  blur — the modal's own comment says so — so the form produced `1.5`
  //  routinely until the commit before this one added the same clamp to
  //  `handleSubmit`. The predicate is right either way; the JUSTIFICATION was
  //  the false half, and it is why `repairScheduleDays` exists for the data
  //  already written.
  it("refuses a fractional schedule-impact day, which the form no longer produces", () => {
    expect(acceptsScheduleDays(1.5)).toBe(false);
    expect(acceptsScheduleDays(2)).toBe(true);
    expect(acceptsScheduleDays(0)).toBe(true);
  });

  it("accepts a two-decimal cost, which round:2 does produce", () => {
    expect(acceptsCostAmount(1500.5)).toBe(true);
    expect(acceptsCostAmount(1500.55)).toBe(true);
  });

  it("refuses a cost with more precision than the form can express", () => {
    expect(acceptsCostAmount(1500.555)).toBe(false);
  });

  it("refuses a cost above the cap the form clamps to", () => {
    // Neither the sanitizer nor the preview had an upper bound, so a model
    // could store a cost a thousand times larger than the form permits.
    expect(acceptsCostAmount(AMOUNT_MAX)).toBe(true);
    expect(acceptsCostAmount(AMOUNT_MAX + 1)).toBe(false);
  });

  it("refuses a boolean on both, for the same reason as the risk scale", () => {
    expect(acceptsScheduleDays(true)).toBe(false);
    expect(acceptsCostAmount(true)).toBe(false);
  });
});
