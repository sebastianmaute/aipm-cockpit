import { describe, it, expect } from "vitest";
import {
  sanitizeSteeringCommittee,
  sanitizeRaidItem,
  sanitizeMilestone,
  sanitizeMilestoneTaskIds,
  sanitizeChangeItem,
} from "./sanitize";

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
