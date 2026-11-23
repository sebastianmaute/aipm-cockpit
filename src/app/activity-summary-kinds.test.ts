import { describe, expect, it } from "vitest";
import { ACTIVITY_KIND_TO_KEY, type ActivityKind } from "./activity-log";
import { activityMessage } from "./activity-message";
import { kindsThatCouldWrite } from "./activity-summary-kinds";

const KINDS = Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[];

describe("kindsThatCouldWrite", () => {
  // The safety property: the kind that wrote a summary is always among the answers, whatever its arguments and
  // whichever plural form it took. Missing it could keep a detail its own entity withholds.
  it.each([
    ["counts of one", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    ["counts of many", [7, 7, 7, 7, 7, 7, 7, 7, 7, 7]],
    ["names", ["Ada — x", "B (c) [d]", "$&", "{1}", "2026-07-01", "e.f*g", "h?i", "j|k", "l^m", "n+o"]],
  ] as const)("names the kind that wrote every kind's English summary (%s)", (_label, args) => {
    const missed = KINDS.filter((kind) => !kindsThatCouldWrite(activityMessage("en-US", kind, [...args])).includes(kind));
    expect(missed).toEqual([]);
  });

  it("names only meeting kinds for a meeting edit, so a withheld stakeholder field is not applied to it", () => {
    const kinds = kindsThatCouldWrite("Meeting #4 updated: Kick-off");
    expect(kinds).toContain("calendarEvent.updated");
    expect(kinds.some((k) => k.startsWith("stakeholder.") || k.startsWith("resource.") || k.startsWith("absence."))).toBe(false);
  });

  it("names none for text no template writes", () => {
    expect(kindsThatCouldWrite("~~ nothing like a summary ~~")).toEqual([]);
  });
});
