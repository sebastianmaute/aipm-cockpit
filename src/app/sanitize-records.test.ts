import { describe, it, expect } from "vitest";
import { sanitizeSteeringCommittee, sanitizeRaidItem } from "./sanitize";

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
