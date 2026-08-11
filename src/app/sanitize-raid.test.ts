import { describe, it, expect } from "vitest";
import { sanitizeRaidItem } from "./sanitize";

// Minimal valid input that should round-trip cleanly
const VALID: Record<string, unknown> = {
  id: 1,
  category: "R",
  title: "Risk of scope creep",
  description: "Could impact schedule",
  owner: "Jane Doe",
  ownerEmail: "jane@example.com",
  ownerResourceId: 42,
  severity: "High",
  probability: 3,
  impact: 4,
  status: "Open",
  mitigation: "Weekly review",
  linkedTaskIds: [10, 20],
  raisedDate: "2025-01-15",
  targetDate: "2025-06-30",
  closedDate: "",
  localModifiedAt: "2025-01-16",
  causedByRaidIds: [5],
  stakeholderIds: [7, 8],
};

describe("sanitizeRaidItem", () => {
  // --- null on invalid structure ---

  it("returns null when input is not an object", () => {
    // Arrange / Act / Assert
    expect(sanitizeRaidItem(null)).toBeNull();
    expect(sanitizeRaidItem(undefined)).toBeNull();
    expect(sanitizeRaidItem("string")).toBeNull();
    expect(sanitizeRaidItem(42)).toBeNull();
    expect(sanitizeRaidItem([])).toBeNull();
  });

  it("returns null when id is missing", () => {
    const input = { ...VALID, id: undefined };
    expect(sanitizeRaidItem(input)).toBeNull();
  });

  it("returns null when id is zero", () => {
    const input = { ...VALID, id: 0 };
    expect(sanitizeRaidItem(input)).toBeNull();
  });

  it("returns null when id is negative", () => {
    const input = { ...VALID, id: -5 };
    expect(sanitizeRaidItem(input)).toBeNull();
  });

  it("returns null when id is non-numeric", () => {
    const input = { ...VALID, id: "abc" };
    expect(sanitizeRaidItem(input)).toBeNull();
  });

  it("returns null when title is empty after trim", () => {
    const input = { ...VALID, title: "   " };
    expect(sanitizeRaidItem(input)).toBeNull();
  });

  it("returns null when title is missing", () => {
    const input = { ...VALID, title: undefined };
    expect(sanitizeRaidItem(input)).toBeNull();
  });

  // --- valid item round-trips ---

  it("round-trips a fully populated valid item", () => {
    // Arrange
    const input = { ...VALID };

    // Act
    const result = sanitizeRaidItem(input);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.category).toBe("R");
    expect(result!.title).toBe("Risk of scope creep");
    // description + mitigation are RICH-TEXT fields (slice B): a legacy plain
    // value is escaped and wrapped on the way in, so the round-trip normalises
    // them rather than preserving the bytes verbatim.
    expect(result!.description).toBe("<p>Could impact schedule</p>");
    expect(result!.owner).toBe("Jane Doe");
    expect(result!.ownerEmail).toBe("jane@example.com");
    expect(result!.ownerResourceId).toBe(42);
    expect(result!.severity).toBe("High");
    expect(result!.probability).toBe(3);
    expect(result!.impact).toBe(4);
    expect(result!.status).toBe("Open");
    expect(result!.mitigation).toBe("<p>Weekly review</p>");
    expect(result!.linkedTaskIds).toEqual([10, 20]);
    expect(result!.raisedDate).toBe("2025-01-15");
    expect(result!.targetDate).toBe("2025-06-30");
    expect(result!.localModifiedAt).toBe("2025-01-16");
    expect(result!.causedByRaidIds).toEqual([5]);
    expect(result!.stakeholderIds).toEqual([7, 8]);
  });

  it("floors a fractional id", () => {
    const input = { ...VALID, id: 3.9 };
    const result = sanitizeRaidItem(input);
    expect(result!.id).toBe(3);
  });

  // --- category defaulting ---

  it("defaults category to 'R' when category is invalid", () => {
    const input = { ...VALID, category: "X" };
    const result = sanitizeRaidItem(input);
    expect(result!.category).toBe("R");
  });

  it("defaults category to 'R' when category is missing", () => {
    const input = { ...VALID, category: undefined };
    const result = sanitizeRaidItem(input);
    expect(result!.category).toBe("R");
  });

  it("accepts all valid RAID categories", () => {
    for (const cat of ["R", "A", "I", "D"] as const) {
      const statusMap: Record<string, string> = {
        R: "Open",
        A: "Pending",
        I: "Open",
        D: "Open",
      };
      const input = { ...VALID, category: cat, status: statusMap[cat] };
      const result = sanitizeRaidItem(input);
      expect(result!.category).toBe(cat);
    }
  });

  // --- status defaulting per category ---

  it("defaults status to 'Open' for category R when status is invalid", () => {
    const input = { ...VALID, category: "R", status: "Pending" };
    const result = sanitizeRaidItem(input);
    expect(result!.status).toBe("Open");
  });

  it("defaults status to 'Pending' for category A when status is invalid", () => {
    const input = { ...VALID, category: "A", status: "Open" };
    const result = sanitizeRaidItem(input);
    expect(result!.status).toBe("Pending");
  });

  it("defaults status to 'Open' for category I when status is invalid", () => {
    const input = { ...VALID, category: "I", status: "Pending" };
    const result = sanitizeRaidItem(input);
    expect(result!.status).toBe("Open");
  });

  it("defaults status to 'Open' for category D when status is invalid", () => {
    const input = { ...VALID, category: "D", status: "Realized" };
    const result = sanitizeRaidItem(input);
    expect(result!.status).toBe("Open");
  });

  it("accepts valid status values for each category", () => {
    const cases: Array<[string, string]> = [
      ["R", "Mitigated"],
      ["R", "Realized"],
      ["R", "Closed"],
      ["A", "Validated"],
      ["A", "Invalidated"],
      ["I", "In Progress"],
      ["I", "Resolved"],
      ["I", "Closed"],
      ["D", "In Progress"],
      ["D", "Delivered"],
      ["D", "Blocked"],
    ];
    for (const [cat, status] of cases) {
      const input = { ...VALID, category: cat, status };
      const result = sanitizeRaidItem(input);
      expect(result!.status).toBe(status);
    }
  });

  // --- severity validation ---

  it("omits severity when value is invalid", () => {
    const input = { ...VALID, severity: "Extreme" };
    const result = sanitizeRaidItem(input);
    expect(result!.severity).toBeUndefined();
  });

  it("omits severity when missing", () => {
    const input = { ...VALID, severity: undefined };
    const result = sanitizeRaidItem(input);
    expect(result!.severity).toBeUndefined();
  });

  it("accepts all valid severity values", () => {
    for (const sev of ["Low", "Medium", "High", "Critical"] as const) {
      const input = { ...VALID, severity: sev };
      expect(sanitizeRaidItem(input)!.severity).toBe(sev);
    }
  });

  // --- probability and impact validation (1..5 integers only) ---

  it("omits probability when out of range", () => {
    expect(sanitizeRaidItem({ ...VALID, probability: 0 })!.probability).toBeUndefined();
    expect(sanitizeRaidItem({ ...VALID, probability: 6 })!.probability).toBeUndefined();
  });

  it("omits probability when non-integer", () => {
    expect(sanitizeRaidItem({ ...VALID, probability: 2.5 })!.probability).toBeUndefined();
  });

  it("omits impact when out of range", () => {
    expect(sanitizeRaidItem({ ...VALID, impact: 0 })!.impact).toBeUndefined();
    expect(sanitizeRaidItem({ ...VALID, impact: 6 })!.impact).toBeUndefined();
  });

  it("accepts probability and impact boundary values 1 and 5", () => {
    const result = sanitizeRaidItem({ ...VALID, probability: 1, impact: 5 });
    expect(result!.probability).toBe(1);
    expect(result!.impact).toBe(5);
  });

  // --- id-list fields default to [] ---

  it("defaults linkedTaskIds to [] when missing", () => {
    const input = { ...VALID, linkedTaskIds: undefined };
    expect(sanitizeRaidItem(input)!.linkedTaskIds).toEqual([]);
  });

  it("defaults causedByRaidIds to [] when missing", () => {
    const input = { ...VALID, causedByRaidIds: undefined };
    expect(sanitizeRaidItem(input)!.causedByRaidIds).toEqual([]);
  });

  it("defaults stakeholderIds to [] when missing", () => {
    const input = { ...VALID, stakeholderIds: undefined };
    expect(sanitizeRaidItem(input)!.stakeholderIds).toEqual([]);
  });

  it("filters non-positive values from id lists", () => {
    const input = { ...VALID, linkedTaskIds: [0, -1, 3, 7] };
    expect(sanitizeRaidItem(input)!.linkedTaskIds).toEqual([3, 7]);
  });

  // --- which SINK the rich fields classify against ---

  // ★★★ MUTATION-PROVED GAP: flipping all six rich-field sinks in
  // sanitize-records.ts from "template" to "note" left 299 tests green across
  // descriptor-drift.test.ts and seven sanitize/storage suites, because every
  // other fixture is PLAIN TEXT — an input every sink classifies identically.
  // Only a SEPARATING input pins the choice, and `<h1>` is one: it is on
  // RICH_ALLOWED_TAGS, so the "rich" sink passes the value through as live
  // markup, while any classifier that does not recognise it calls the whole
  // value plain text and escapes it (§107). `sanitizeRaidItem`'s destination is
  // `sanitizeRichHtml`, so "rich" is correct here.
  // ★★ THIS USED TO PIN A CHOICE BETWEEN TWO SINKS and no longer can — it was
  // "classifies at the template sink, not the note sink", separating an 11-tag
  // template list from an 8-tag note one. Both are retired and there is one rich
  // sink now, so what survives is the weaker but still load-bearing property
  // below: a leading `<h1>` reaches storage as MARKUP and is not escaped whole.
  it("classifies a RAID rich field at the rich sink: a leading <h1> stays markup", () => {
    const result = sanitizeRaidItem({ ...VALID, description: "<h1>Q3</h1><p>ok</p>" });
    expect(result!.description).toBe("<h1>Q3</h1><p>ok</p>");
    expect(result!.description).not.toContain("&lt;h1&gt;");
  });

  it("classifies a RAID mitigation at the template sink, not the note sink", () => {
    const result = sanitizeRaidItem({ ...VALID, mitigation: "<h1>Q3</h1><p>ok</p>" });
    expect(result!.mitigation).toBe("<h1>Q3</h1><p>ok</p>");
    expect(result!.mitigation).not.toContain("&lt;h1&gt;");
  });

  // --- optional fields omitted when empty ---

  it("omits description when empty", () => {
    const result = sanitizeRaidItem({ ...VALID, description: "" });
    expect(result!.description).toBeUndefined();
  });

  it("omits mitigation when empty", () => {
    const result = sanitizeRaidItem({ ...VALID, mitigation: "" });
    expect(result!.mitigation).toBeUndefined();
  });

  it("omits owner when empty", () => {
    const result = sanitizeRaidItem({ ...VALID, owner: "" });
    expect(result!.owner).toBeUndefined();
  });

  it("omits ownerEmail when empty", () => {
    const result = sanitizeRaidItem({ ...VALID, ownerEmail: "" });
    expect(result!.ownerEmail).toBeUndefined();
  });

  it("omits targetDate when empty or invalid", () => {
    expect(sanitizeRaidItem({ ...VALID, targetDate: "" })!.targetDate).toBeUndefined();
    expect(sanitizeRaidItem({ ...VALID, targetDate: "not-a-date" })!.targetDate).toBeUndefined();
  });

  it("omits closedDate when empty", () => {
    expect(sanitizeRaidItem({ ...VALID, closedDate: "" })!.closedDate).toBeUndefined();
  });

  it("omits localModifiedAt when empty", () => {
    const result = sanitizeRaidItem({ ...VALID, localModifiedAt: "" });
    expect(result!.localModifiedAt).toBeUndefined();
  });

  // --- raisedDate mirrors sanitizeChangeItem (empty string kept as-is) ---

  it("keeps raisedDate as empty string when missing or invalid", () => {
    expect(sanitizeRaidItem({ ...VALID, raisedDate: "" })!.raisedDate).toBe("");
    expect(sanitizeRaidItem({ ...VALID, raisedDate: undefined })!.raisedDate).toBe("");
    expect(sanitizeRaidItem({ ...VALID, raisedDate: "bad" })!.raisedDate).toBe("");
  });

  // --- ownerResourceId null passthrough ---

  it("sets ownerResourceId to null when input is null", () => {
    const result = sanitizeRaidItem({ ...VALID, ownerResourceId: null });
    expect(result!.ownerResourceId).toBeNull();
  });

  it("omits ownerResourceId when zero or negative", () => {
    expect(sanitizeRaidItem({ ...VALID, ownerResourceId: 0 })!.ownerResourceId).toBeUndefined();
    expect(sanitizeRaidItem({ ...VALID, ownerResourceId: -1 })!.ownerResourceId).toBeUndefined();
  });

  // --- knowledgeLinks ---

  it("omits knowledgeLinks when none provided", () => {
    const result = sanitizeRaidItem({ ...VALID, knowledgeLinks: undefined });
    expect(result!.knowledgeLinks).toBeUndefined();
  });

  it("includes knowledgeLinks when valid", () => {
    const input = {
      ...VALID,
      knowledgeLinks: [{ name: "Spec", url: "https://example.com/doc" }],
    };
    const result = sanitizeRaidItem(input);
    expect(result!.knowledgeLinks).toHaveLength(1);
    expect(result!.knowledgeLinks![0].url).toBe("https://example.com/doc");
  });

  // --- outlookEventId ---

  it("preserves outlookEventId (capped 1024)", () => {
    const base = { id: 1, title: "R", category: "R", raisedDate: "2026-01-01" };
    expect(sanitizeRaidItem({ ...base, outlookEventId: "EVT1" })?.outlookEventId).toBe("EVT1");
    expect(
      sanitizeRaidItem({ ...base, outlookEventId: "x".repeat(2000) })?.outlookEventId?.length,
    ).toBe(1024);
    expect(sanitizeRaidItem(base)?.outlookEventId).toBeUndefined();
  });

  // --- immutability ---

  it("returns a new object and does not mutate input", () => {
    const input = { ...VALID };
    const result = sanitizeRaidItem(input);
    expect(result).not.toBe(input);
  });
});
