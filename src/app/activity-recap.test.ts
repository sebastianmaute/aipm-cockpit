import { describe, expect, it } from "vitest";
import { buildActivityRecapBlock, summarizeForRecap } from "./activity-recap";
import type { ActivityEntry } from "./activity-log";
import { RECAP_WINDOW_DAYS, type ActivitySummary } from "./history-search";
import type { AiConfig } from "./settings-types";
import { asTimeZoneForTests, createProjectClock } from "./timezone";
import { toolNamesFor } from "./chat-api";

const UTC = asTimeZoneForTests("UTC");
const BERLIN = asTimeZoneForTests("Europe/Berlin");

// ★★ THE REAL SETS, from the same `toolNamesFor` the wire uses. A hand-built
//    `new Set(["search_history"])` would keep the suppression test green after
//    the tool was renamed or detached from the toggle — i.e. it would assert
//    about the fixture rather than about the app.
const ALL = toolNamesFor(undefined); // history search ON (the default)
const NO_HISTORY = toolNamesFor(false); // the kill switch thrown

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
    expect(buildActivityRecapBlock(null, UTC, ALL)).toBe("");
  });

  it("omits the breakdown when only one bucket is non-zero", () => {
    const out = buildActivityRecapBlock(s({ user: 14 }, 14), UTC, ALL);
    expect(out).toContain("14 changes in the last 7 days");
    expect(out).not.toContain("by the user");
    expect(out).toContain("search_history");
  });

  it("names each non-zero bucket when more than one is present", () => {
    const out = buildActivityRecapBlock(s({ user: 9, ai: 5 }, 14), UTC, ALL);
    expect(out).toContain("9 by the user");
    expect(out).toContain("5 by the AI assistant");
    expect(out).not.toContain("integration");
  });

  it("renders the unknown bucket only when non-zero", () => {
    expect(buildActivityRecapBlock(s({ user: 2, unknown: 3 }, 5), UTC, ALL)).toContain(
      "3 of unknown origin",
    );
    expect(buildActivityRecapBlock(s({ user: 2, ai: 3 }, 5), UTC, ALL)).not.toContain(
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
      ALL,
    );
    expect(out).toContain("2026-08-17");
  });

  // ★ ANTI-VACUITY for the fallback branch: `dayInZone` returns null on an
  //   unparseable instant, and the block must still name the tool rather than
  //   render "latest null" or throw.
  it("falls back to the raw latestAt when it cannot be parsed", () => {
    const out = buildActivityRecapBlock(s({ user: 1 }, 1, "whenever"), UTC, ALL);
    expect(out).toContain("latest whenever");
    expect(out).toContain("Use search_history to read them.");
  });

  // ★★★ THE WINDOW COMES FROM THE SUMMARY, NOT FROM `RECAP_WINDOW_DAYS`.
  //    `summarizeRecentActivity` takes an overridable `days`; a renderer that
  //    re-stated the constant would tell the model "in the last 7 days" about a
  //    30-day count. A default-window fixture CANNOT fail this — both readings
  //    say 7 — so the assertion has to use a non-default window.
  it("states the summary's OWN window, not the default constant", () => {
    expect(buildActivityRecapBlock(s({ user: 4 }, 4, undefined, 30), UTC, ALL)).toContain(
      "in the last 30 days",
    );
    expect(buildActivityRecapBlock(s({ user: 4 }, 4, undefined, 30), UTC, ALL)).not.toContain(
      `in the last ${RECAP_WINDOW_DAYS} days`,
    );
  });

  it("pluralises the change count and the window", () => {
    expect(buildActivityRecapBlock(s({ user: 1 }, 1), UTC, ALL)).toContain("1 change in the last");
    expect(buildActivityRecapBlock(s({ user: 1 }, 1), UTC, ALL)).not.toContain("1 changes");
    // ★ "in the last 1 day" IS a substring of "…1 days", so the negative half
    //   is what actually carries this assertion.
    expect(buildActivityRecapBlock(s({ user: 1 }, 1, undefined, 1), UTC, ALL)).toContain(
      "in the last 1 day",
    );
    expect(buildActivityRecapBlock(s({ user: 1 }, 1, undefined, 1), UTC, ALL)).not.toContain(
      "in the last 1 days",
    );
    expect(buildActivityRecapBlock(s({ user: 2 }, 2), UTC, ALL)).toContain("2 changes in the last");
  });

  // ★★★ THE TWO TOGGLES ARE INDEPENDENT, and this block is the seam. Nothing
  // upstream couples them: `activityRecap` decides whether this sentence exists
  // (`summarizeForRecap`), `historySearch` decides whether the tool does
  // (`toolsFor`). So recap-ON + history-OFF is reachable — it is the DEFAULT for
  // anyone who threw only the search switch — and it shipped a prompt naming a
  // tool the request did not carry, on every turn of every conversation.
  describe("when search_history is not offered", () => {
    it("drops the closing instruction to call it", () => {
      const out = buildActivityRecapBlock(s({ user: 9, ai: 5 }, 14), UTC, NO_HISTORY);
      expect(out).not.toContain("search_history");
    });

    // ★★★ THE POSITIVE HALF IS THE POINT — the counts are NOT collateral. A
    // "fix" that returned "" when the tool is absent passes the negative above
    // and silently deletes the actor split, which is what stops the model
    // reading its own edits back as new user information. Assert the sentence
    // SURVIVES, breakdown and all.
    it("keeps the counts, the window and the actor breakdown", () => {
      const out = buildActivityRecapBlock(s({ user: 9, ai: 5 }, 14), UTC, NO_HISTORY);
      expect(out).toContain("14 changes in the last 7 days");
      expect(out).toContain("9 by the user");
      expect(out).toContain("5 by the AI assistant");
      expect(out).toContain("latest 2026-08-16");
    });

    // ★ Trailing whitespace is the obvious way to get this wrong (a blank third
    //   element joined by " " leaves the sentence ending "…). "), and it reaches
    //   the model verbatim. The `.join` must not emit the element at all.
    it("ends cleanly at the closing bracket", () => {
      const out = buildActivityRecapBlock(s({ user: 1 }, 1), UTC, NO_HISTORY);
      expect(out.endsWith(").")).toBe(true);
    });

    // ★ ANTI-VACUITY: the null case must stay empty for the OLD reason (no
    //   summary), not become empty for the new one.
    it("still returns an empty string for a null summary", () => {
      expect(buildActivityRecapBlock(null, UTC, NO_HISTORY)).toBe("");
    });
  });
});

describe("summarizeForRecap", () => {
  // ★★★ The day is pinned by the INSTANT, never by supplying `today` (§159).
  //   `createProjectClock` derives the date from the zone itself, so there is
  //   no way — even in a fixture — to hand it a date computed in a different
  //   zone from the one beside it. That is the whole point of the bag: the
  //   inconsistent pair is unrepresentable rather than merely discouraged.
  const CLOCK = createProjectClock(UTC, new Date("2026-08-16T12:00:00.000Z"));
  const entry = (actor: string): ActivityEntry =>
    ({ id: `e-${actor}`, timestamp: "2026-08-16T10:00:00.000Z", kind: "task.updated",
       args: [1, "x"], actor }) as ActivityEntry;
  // ★ Only the one field this gate reads is set; the rest of `AiConfig` is
  //   irrelevant to it, so the cast keeps the fixture honest about that.
  const ai = (over: object = {}): AiConfig => ({ ...over }) as AiConfig;

  it("summarises when the toggle is unset (default ON)", () => {
    const out = summarizeForRecap(ai(), [entry("user")], CLOCK);
    expect(out?.total).toBe(1);
    expect(out?.days).toBe(RECAP_WINDOW_DAYS);
  });

  it("summarises when the toggle is explicitly on", () => {
    expect(
      summarizeForRecap(ai({ activityRecap: true }), [entry("ai")], CLOCK)?.total,
    ).toBe(1);
  });

  // ★ ANTI-VACUITY: the SAME entries that produce a summary above must produce
  //   nothing here, so a gate that never fires cannot pass this.
  it("returns undefined when the toggle is off", () => {
    expect(
      summarizeForRecap(ai({ activityRecap: false }), [entry("user")], CLOCK),
    ).toBeUndefined();
  });

  // ★ `undefined`, never `null`: the snapshot field is optional, and a literal
  //   null would read as "computed, and the answer is nothing".
  it("maps an empty window to undefined rather than null", () => {
    expect(summarizeForRecap(ai(), [], CLOCK)).toBeUndefined();
  });
});
