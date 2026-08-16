import { describe, expect, it } from "vitest";
import { buildActivityRecapBlock, summarizeForRecap } from "./activity-recap";
import type { ActivityEntry } from "./activity-log";
import { RECAP_WINDOW_DAYS, type ActivitySummary } from "./history-search";
import type { AiConfig } from "./settings-types";
import { asTimeZoneForTests } from "./timezone";

const UTC = asTimeZoneForTests("UTC");
const BERLIN = asTimeZoneForTests("Europe/Berlin");

const s = (
  over: Partial<ActivitySummary["byActor"]>,
  total: number,
  latestAt = "2026-08-16T09:12:00.000Z",
  days = RECAP_WINDOW_DAYS,
): ActivitySummary => ({
  total,
  byActor: { user: 0, ai: 0, integration: 0, unknown: 0, ...over },
  latestAt,
  days,
});

describe("buildActivityRecapBlock", () => {
  it("returns an empty string for a null summary", () => {
    expect(buildActivityRecapBlock(null, UTC)).toBe("");
  });

  it("omits the breakdown when only one bucket is non-zero", () => {
    const out = buildActivityRecapBlock(s({ user: 14 }, 14), UTC);
    expect(out).toContain("14 changes in the last 7 days");
    expect(out).not.toContain("by the user");
    expect(out).toContain("search_history");
  });

  it("names each non-zero bucket when more than one is present", () => {
    const out = buildActivityRecapBlock(s({ user: 9, ai: 5 }, 14), UTC);
    expect(out).toContain("9 by the user");
    expect(out).toContain("5 by the AI assistant");
    expect(out).not.toContain("integration");
  });

  it("renders the unknown bucket only when non-zero", () => {
    expect(buildActivityRecapBlock(s({ user: 2, unknown: 3 }, 5), UTC)).toContain(
      "3 of unknown origin",
    );
    expect(buildActivityRecapBlock(s({ user: 2, ai: 3 }, 5), UTC)).not.toContain(
      "unknown origin",
    );
  });

  // ★ The one assertion a UTC-only fixture cannot fail: 23:30Z on the 16th is
  //   01:30 on the 17th in Berlin, so a renderer that sliced the raw UTC stamp
  //   would still say "2026-08-16" here.
  it("renders latestAt in the PROJECT zone", () => {
    const out = buildActivityRecapBlock(
      s({ user: 1 }, 1, "2026-08-16T23:30:00.000Z"),
      BERLIN,
    );
    expect(out).toContain("2026-08-17");
  });

  // ★ ANTI-VACUITY for the fallback branch: `dayInZone` returns null on an
  //   unparseable instant, and the block must still name the tool rather than
  //   render "latest null" or throw.
  it("falls back to the raw latestAt when it cannot be parsed", () => {
    const out = buildActivityRecapBlock(s({ user: 1 }, 1, "whenever"), UTC);
    expect(out).toContain("latest whenever");
    expect(out).toContain("Use search_history to read them.");
  });

  // ★★★ THE WINDOW COMES FROM THE SUMMARY, NOT FROM `RECAP_WINDOW_DAYS`.
  //    `summarizeRecentActivity` takes an overridable `days`; a renderer that
  //    re-stated the constant would tell the model "in the last 7 days" about a
  //    30-day count. A default-window fixture CANNOT fail this — both readings
  //    say 7 — so the assertion has to use a non-default window.
  it("states the summary's OWN window, not the default constant", () => {
    expect(buildActivityRecapBlock(s({ user: 4 }, 4, undefined, 30), UTC)).toContain(
      "in the last 30 days",
    );
    expect(buildActivityRecapBlock(s({ user: 4 }, 4, undefined, 30), UTC)).not.toContain(
      `in the last ${RECAP_WINDOW_DAYS} days`,
    );
  });

  it("pluralises the change count and the window", () => {
    expect(buildActivityRecapBlock(s({ user: 1 }, 1), UTC)).toContain("1 change in the last");
    expect(buildActivityRecapBlock(s({ user: 1 }, 1), UTC)).not.toContain("1 changes");
    // ★ "in the last 1 day" IS a substring of "…1 days", so the negative half
    //   is what actually carries this assertion.
    expect(buildActivityRecapBlock(s({ user: 1 }, 1, undefined, 1), UTC)).toContain(
      "in the last 1 day",
    );
    expect(buildActivityRecapBlock(s({ user: 1 }, 1, undefined, 1), UTC)).not.toContain(
      "in the last 1 days",
    );
    expect(buildActivityRecapBlock(s({ user: 2 }, 2), UTC)).toContain("2 changes in the last");
  });
});

describe("summarizeForRecap", () => {
  const entry = (actor: string): ActivityEntry =>
    ({ id: `e-${actor}`, timestamp: "2026-08-16T10:00:00.000Z", kind: "task.updated",
       args: [1, "x"], actor }) as ActivityEntry;
  // ★ Only the one field this gate reads is set; the rest of `AiConfig` is
  //   irrelevant to it, so the cast keeps the fixture honest about that.
  const ai = (over: object = {}): AiConfig => ({ ...over }) as AiConfig;

  it("summarises when the toggle is unset (default ON)", () => {
    const out = summarizeForRecap(ai(), [entry("user")], "2026-08-16", UTC);
    expect(out?.total).toBe(1);
    expect(out?.days).toBe(RECAP_WINDOW_DAYS);
  });

  it("summarises when the toggle is explicitly on", () => {
    expect(
      summarizeForRecap(ai({ activityRecap: true }), [entry("ai")], "2026-08-16", UTC)?.total,
    ).toBe(1);
  });

  // ★ ANTI-VACUITY: the SAME entries that produce a summary above must produce
  //   nothing here, so a gate that never fires cannot pass this.
  it("returns undefined when the toggle is off", () => {
    expect(
      summarizeForRecap(ai({ activityRecap: false }), [entry("user")], "2026-08-16", UTC),
    ).toBeUndefined();
  });

  // ★ `undefined`, never `null`: the snapshot field is optional, and a literal
  //   null would read as "computed, and the answer is nothing".
  it("maps an empty window to undefined rather than null", () => {
    expect(summarizeForRecap(ai(), [], "2026-08-16", UTC)).toBeUndefined();
  });
});
