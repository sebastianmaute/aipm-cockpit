import { describe, expect, it } from "vitest";
import type { ActivityEntry, ActivityKind } from "./activity-log";
import { asTimeZoneForTests } from "./timezone";
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  RECAP_WINDOW_DAYS,
  searchHistory,
  summarizeRecentActivity,
} from "./history-search";

const at = (day: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `dev-1-${day}`,
  timestamp: `2026-08-${day}T09:00:00.000Z`,
  kind: "task.created",
  args: [1, "Fix login"],
  ...over,
});

describe("searchHistory", () => {
  it("returns newest first", () => {
    const r = searchHistory([at("10"), at("12"), at("11")], {}, "UTC");
    expect(r.events.map((e) => e.at.slice(8, 10))).toEqual(["12", "11", "10"]);
  });

  it("filters by kind", () => {
    // ★ Typed `ActivityKind[]` on purpose: `HistoryQuery.kinds` is deliberately
    //   the WIDER `readonly string[]` (the model is untrusted input and may send
    //   any string), and this call site proves the narrow union still assigns.
    const kinds: ActivityKind[] = ["milestone.deleted"];
    const r = searchHistory(
      [at("10"), at("11", { kind: "milestone.deleted" })],
      { kinds },
      "UTC",
    );
    expect(r.events).toHaveLength(1);
    // ★ The EN template is "Deleted milestone #{0}" — LOWERCASE "milestone".
    //   Asserting the whole interpolated line rather than a substring also pins
    //   that the render layer ran at all, not just that the filter picked a row.
    expect(r.events[0].summary).toBe("Deleted milestone #1");
    // ★ `at` is the instant carrying the PROJECT's offset, not the raw UTC
    //   stamp — the model quotes this back to a user whose Activity panel shows
    //   the same wall clock. A UTC project spells the offset `+00:00`.
    expect(r.events[0].at).toBe("2026-08-11T09:00:00+00:00");
  });

  it("filters by since and until inclusively on the date part", () => {
    const entries = [at("10"), at("11"), at("12")];
    expect(searchHistory(entries, { since: "2026-08-11" }, "UTC").events).toHaveLength(2);
    expect(searchHistory(entries, { until: "2026-08-11" }, "UTC").events).toHaveLength(2);
    expect(
      searchHistory(entries, { since: "2026-08-11", until: "2026-08-11" }, "UTC").events,
    ).toHaveLength(1);
  });

  it("matches query case-insensitively across summary and detail", () => {
    const entries = [
      at("10", { args: [1, "Fix login"] }),
      at("11", {
        kind: "task.updated",
        args: [2, "Other"],
        changes: [{ field: "status", from: "To Do", to: "Done" }],
      }),
    ];
    expect(searchHistory(entries, { query: "FIX LOGIN" }, "UTC").events).toHaveLength(1);
    // ★ "to do" appears ONLY in the detail line, so this fails if the haystack
    //   is built from the summary alone.
    const detailHit = searchHistory(entries, { query: "to do" }, "UTC");
    expect(detailHit.events).toHaveLength(1);
    expect(detailHit.events[0].detail).toBe("status: To Do → Done");
  });

  // ★ truncated must reflect whether the cap ACTUALLY cut, not whether a limit
  //   was supplied — the model uses it to decide whether to claim completeness.
  it("sets truncated only when the cap actually cuts", () => {
    const entries = Array.from({ length: 3 }, (_, i) => at(String(10 + i)));
    expect(searchHistory(entries, { limit: 3 }, "UTC").truncated).toBe(false);
    expect(searchHistory(entries, { limit: 2 }, "UTC").truncated).toBe(true);
    expect(searchHistory(entries, { limit: 2 }, "UTC").events).toHaveLength(2);
  });

  // ★ The cap that cuts here is the DEFAULT, not a supplied one: a "truncated
  //   means a limit was passed" implementation reports false for both of these.
  it("sets truncated when an unsupplied default or clamped cap cuts", () => {
    const entries = Array.from({ length: 3 }, (_, i) => at(String(10 + i)));
    expect(searchHistory(entries, {}, "UTC").truncated).toBe(false);
    expect(searchHistory(manyEntries(DEFAULT_HISTORY_LIMIT + 1), {}, "UTC").truncated).toBe(true);
    expect(
      searchHistory(manyEntries(MAX_HISTORY_LIMIT + 1), { limit: 9999 }, "UTC").truncated,
    ).toBe(true);
  });

  it("defaults to DEFAULT_HISTORY_LIMIT and clamps to MAX_HISTORY_LIMIT", () => {
    const entries = manyEntries(250);
    expect(searchHistory(entries, {}, "UTC").events).toHaveLength(DEFAULT_HISTORY_LIMIT);
    expect(searchHistory(entries, { limit: 9999 }, "UTC").events).toHaveLength(MAX_HISTORY_LIMIT);
    expect(searchHistory(entries, { limit: 0 }, "UTC").events).toHaveLength(DEFAULT_HISTORY_LIMIT);
    // ★ The cap slices the NEWEST matches, so the first row must be the last
    //   minted entry — a cap applied before the sort would return the oldest.
    expect(searchHistory(entries, {}, "UTC").events[0].at).toBe(
      entries[249].timestamp.replace(".000Z", "+00:00"),
    );
  });

  // ★★ `limit` is model-supplied, so a fraction below 1 is reachable. Flooring
  //    BEFORE the non-positive test is what stops it becoming a cap of zero —
  //    which would answer `{ events: [], truncated: true }`, i.e. show nothing
  //    while asserting something was withheld.
  it("falls back to the default for a fractional limit that floors to zero", () => {
    const entries = manyEntries(10);
    for (const limit of [0.5, 0.9, 0.0001]) {
      const r = searchHistory(entries, { limit }, "UTC");
      expect(r.events).toHaveLength(10);
      expect(r.truncated).toBe(false);
    }
  });

  it("floors a fractional limit of one or more instead of defaulting", () => {
    const entries = manyEntries(10);
    const r = searchHistory(entries, { limit: 2.9 }, "UTC");
    expect(r.events).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  // ★ `1e999` parses to Infinity, so this arrives from `JSON.parse` on a model
  //   payload. It fails the finite test before reaching the clamp, so it yields
  //   the DEFAULT rather than MAX_HISTORY_LIMIT — pinned so it cannot drift.
  it("falls back to the default for a non-finite limit", () => {
    const entries = manyEntries(DEFAULT_HISTORY_LIMIT + 10);
    expect(searchHistory(entries, { limit: Infinity }, "UTC").events).toHaveLength(
      DEFAULT_HISTORY_LIMIT,
    );
    expect(searchHistory(entries, { limit: NaN }, "UTC").events).toHaveLength(
      DEFAULT_HISTORY_LIMIT,
    );
  });

  it("treats an empty kinds list as no kind filter", () => {
    const entries = [at("10"), at("11", { kind: "milestone.deleted" })];
    expect(searchHistory(entries, { kinds: [] }, "UTC").events).toHaveLength(2);
  });

  it("treats a whitespace-only query as no query filter", () => {
    const entries = [at("10"), at("11")];
    expect(searchHistory(entries, { query: "   " }, "UTC").events).toHaveLength(2);
  });

  it("returns an empty result for an empty log", () => {
    expect(searchHistory([], { query: "anything" }, "UTC")).toEqual({
      events: [],
      truncated: false,
    });
  });

  // ★★★ THE DEFECT THIS SUITE EXISTS FOR. The engine used to file an entry
  //     under `timestamp.slice(0, 10)` — the UTC day — while the `Today is …`
  //     date the model is given and the Activity panel a user reads are BOTH in
  //     the project's zone. Every fixture here straddles a day boundary; one
  //     sitting mid-day passes identically under both implementations.
  describe("timezone-aware day bounds", () => {
    // 00:30 on the 17th in Berlin. Filed under the 16th by a UTC day filter.
    const BERLIN_LATE: ActivityEntry = {
      id: "berlin-late",
      timestamp: "2026-08-16T22:30:00.000Z",
      kind: "task.created",
      args: [1, "Late edit"],
    };
    // 18:00 on the 16th in Los Angeles. Filed under the 17th by a UTC filter,
    // i.e. everything after 17:00 local vanishes from "what changed today".
    const PACIFIC_EVENING: ActivityEntry = {
      id: "pacific-evening",
      timestamp: "2026-08-17T01:00:00.000Z",
      kind: "task.created",
      args: [2, "Evening edit"],
    };

    it("files a late-evening Berlin entry under its LOCAL day, not the UTC one", () => {
      const day = (d: string) =>
        searchHistory([BERLIN_LATE], { since: d, until: d }, "Europe/Berlin").events;
      expect(day("2026-08-17")).toHaveLength(1);
      expect(day("2026-08-16")).toHaveLength(0);
    });

    it("files an evening Pacific entry under its LOCAL day, not the UTC one", () => {
      const day = (d: string) =>
        searchHistory([PACIFIC_EVENING], { since: d, until: d }, "America/Los_Angeles").events;
      expect(day("2026-08-16")).toHaveLength(1);
      expect(day("2026-08-17")).toHaveLength(0);
    });

    // ★ The regression guard: a UTC project must file both of these exactly
    //   where the old `slice(0, 10)` did.
    it("is unchanged for a UTC project", () => {
      const entries = [BERLIN_LATE, PACIFIC_EVENING];
      const day = (d: string) => searchHistory(entries, { since: d, until: d }, "UTC").events;
      expect(day("2026-08-16").map((e) => e.summary)).toEqual(["Task #1 created: Late edit"]);
      expect(day("2026-08-17").map((e) => e.summary)).toEqual(["Task #2 created: Evening edit"]);
    });

    it("emits `at` with the project's offset so the model quotes the user's clock", () => {
      const [berlin] = searchHistory([BERLIN_LATE], {}, "Europe/Berlin").events;
      expect(berlin.at).toBe("2026-08-17T00:30:00+02:00");
      const [pacific] = searchHistory(
        [PACIFIC_EVENING],
        {},
        "America/Los_Angeles",
      ).events;
      expect(pacific.at).toBe("2026-08-16T18:00:00-07:00");
    });

    // ★★ Sorting must stay on the RAW instant. Across a DST transition the
    //    offset changes, so lexicographic compare on the OFFSET-BEARING string
    //    inverts the pair: "02:30+02:00" sorts after "02:00+01:00" while the
    //    later one is the real-time-earlier of the two. Berlin's 2026 autumn
    //    change is 03:00 CEST → 02:00 CET on 25 October (01:00 UTC).
    it("sorts on the real instant across a DST transition", () => {
      const before: ActivityEntry = {
        id: "cest", timestamp: "2026-10-25T00:30:00.000Z",
        kind: "task.created", args: [1, "Before"],
      };
      const after: ActivityEntry = {
        id: "cet", timestamp: "2026-10-25T01:30:00.000Z",
        kind: "task.created", args: [2, "After"],
      };
      const r = searchHistory([before, after], {}, "Europe/Berlin");
      expect(r.events.map((e) => e.at)).toEqual([
        "2026-10-25T02:30:00+01:00",
        "2026-10-25T02:30:00+02:00",
      ]);
    });

    it("keeps an entry whose timestamp cannot be parsed out of a bounded search", () => {
      const broken: ActivityEntry = {
        id: "broken", timestamp: "whenever", kind: "task.created", args: [1, "Broken"],
      };
      expect(searchHistory([broken], {}, "Europe/Berlin").events).toHaveLength(1);
      expect(
        searchHistory([broken], { since: "2026-08-01" }, "Europe/Berlin").events,
      ).toHaveLength(0);
    });
  });
});

describe("summarizeRecentActivity", () => {
  const UTC = asTimeZoneForTests("UTC");
  const BERLIN = asTimeZoneForTests("Europe/Berlin");
  const NEW_YORK = asTimeZoneForTests("America/New_York");
  const at = (iso: string, actor?: string): ActivityEntry =>
    ({ id: `e-${iso}`, timestamp: iso, kind: "task.updated", args: [1, "x"],
       ...(actor ? { actor } : {}) }) as ActivityEntry;

  it("returns null for an empty window rather than a zeroed summary", () => {
    expect(summarizeRecentActivity([], "2026-08-16", UTC)).toBeNull();
    expect(summarizeRecentActivity([at("2026-01-01T10:00:00.000Z")], "2026-08-16", UTC)).toBeNull();
  });

  it("tallies by actor, bucketing an absent actor as unknown", () => {
    const out = summarizeRecentActivity(
      [at("2026-08-16T10:00:00.000Z", "user"), at("2026-08-15T10:00:00.000Z", "ai"),
       at("2026-08-14T10:00:00.000Z", "integration"), at("2026-08-13T10:00:00.000Z")],
      "2026-08-16", UTC,
    );
    expect(out).toEqual({
      total: 4,
      byActor: { user: 1, ai: 1, integration: 1, unknown: 1 },
      latestAt: "2026-08-16T10:00:00.000Z",
      days: RECAP_WINDOW_DAYS,
    });
  });

  it("buckets an UNKNOWN-BUT-STRING actor as unknown, never crashing", () => {
    const out = summarizeRecentActivity([at("2026-08-16T10:00:00.000Z", "reviewer")], "2026-08-16", UTC);
    expect(out?.byActor.unknown).toBe(1);
  });

  // ★★ A prototype-method name is the case the own-property guard exists for:
  //    the sanitizer KEEPS an unknown-but-string actor, so `"toString"` reaches
  //    the tally and a bare index would resolve a Function and produce NaN.
  it("buckets a Function.prototype method name as unknown, never NaN", () => {
    const out = summarizeRecentActivity([at("2026-08-16T10:00:00.000Z", "toString")], "2026-08-16", UTC);
    expect(out).toEqual({
      total: 1,
      byActor: { user: 0, ai: 0, integration: 0, unknown: 1 },
      latestAt: "2026-08-16T10:00:00.000Z",
      days: RECAP_WINDOW_DAYS,
    });
  });

  // ★★ THE SUMMARY CARRIES ITS OWN WINDOW. `days` is overridable, so a renderer
  //    that re-stated `RECAP_WINDOW_DAYS` would misstate the window to the model
  //    the moment any caller passed something else — one value, one source.
  //    ★ The 30 case is the one a constant-importing renderer cannot pass.
  it("reports the window it actually counted, default and overridden", () => {
    const e = [at("2026-08-16T10:00:00.000Z", "user")];
    expect(summarizeRecentActivity(e, "2026-08-16", UTC)?.days).toBe(RECAP_WINDOW_DAYS);
    expect(summarizeRecentActivity(e, "2026-08-16", UTC, 30)?.days).toBe(30);
    expect(summarizeRecentActivity(e, "2026-08-16", UTC, 1)?.days).toBe(1);
  });

  // ★★★ THE ZONE TEST. A UTC-only fixture CANNOT fail this — the entry sits on
  //    the boundary and its inclusion flips with the project zone.
  it("classifies the window bound in the PROJECT zone, not UTC", () => {
    const boundary = [at("2026-08-09T23:30:00.000Z", "user")];
    // Berlin (UTC+2): local day is 2026-08-10, the window's first day → IN.
    expect(summarizeRecentActivity(boundary, "2026-08-16", BERLIN)?.total).toBe(1);
    // New York (UTC-4): local day is 2026-08-09, one day before → OUT.
    expect(summarizeRecentActivity(boundary, "2026-08-16", NEW_YORK)).toBeNull();
  });

  // ★ Pins the EXACT window bound: with `today` 2026-08-16 and the default
  //   7 days, `since` is 2026-08-10 — today plus six prior days, inclusive of
  //   both ends. An off-by-one here silently widens or narrows every recap.
  it("spans exactly `days` days INCLUDING today", () => {
    const inWindow = at("2026-08-10T00:00:00.000Z", "user");
    const outOfWindow = at("2026-08-09T23:59:59.000Z", "user");
    expect(summarizeRecentActivity([inWindow], "2026-08-16", UTC)?.total).toBe(1);
    expect(summarizeRecentActivity([outOfWindow], "2026-08-16", UTC)).toBeNull();
    // ★ And a non-default `days` moves the bound with it: 1 day is today alone.
    expect(summarizeRecentActivity([inWindow], "2026-08-16", UTC, 1)).toBeNull();
    expect(
      summarizeRecentActivity([at("2026-08-16T00:00:00.000Z", "user")], "2026-08-16", UTC, 1)?.total,
    ).toBe(1);
  });

  // ★ A future-dated entry is outside the window too — the upper bound is
  //   `today`, not "unbounded above".
  it("excludes an entry dated after today", () => {
    expect(
      summarizeRecentActivity([at("2026-08-17T00:00:00.000Z", "user")], "2026-08-16", UTC),
    ).toBeNull();
  });

  it("excludes an unparseable timestamp instead of inflating the total", () => {
    const out = summarizeRecentActivity(
      [at("2026-08-16T10:00:00.000Z", "user"), at("whenever", "user")], "2026-08-16", UTC,
    );
    expect(out?.total).toBe(1);
  });

  it("reports latestAt as the RAW UTC stamp, not an offset form", () => {
    const out = summarizeRecentActivity([at("2026-08-16T10:00:00.000Z", "user")], "2026-08-16", BERLIN);
    expect(out?.latestAt).toBe("2026-08-16T10:00:00.000Z");
  });

  // ★ `latestAt` seeds as "" — every real stamp sorts above it, so a positive
  //   total can never be reported alongside an empty stamp. Pinned because the
  //   caller renders it and an empty string would render as a broken date.
  it("never reports an empty latestAt alongside a positive total", () => {
    const out = summarizeRecentActivity(
      [at("2026-08-14T10:00:00.000Z", "ai"), at("2026-08-16T10:00:00.000Z", "user")],
      "2026-08-16", UTC,
    );
    expect(out?.total).toBe(2);
    expect(out?.latestAt).toBe("2026-08-16T10:00:00.000Z");
  });

  it("returns null for an unparseable today rather than throwing", () => {
    expect(summarizeRecentActivity([at("2026-08-16T10:00:00.000Z")], "not-a-date", UTC)).toBeNull();
  });
});

/** `n` entries with STRICTLY INCREASING, all-distinct timestamps, so an
 *  order-sensitive assertion over them is deterministic rather than resting on
 *  `Array.prototype.sort` being stable. */
function manyEntries(n: number): ActivityEntry[] {
  return Array.from({ length: n }, (_, i) =>
    at("10", {
      id: `e${i}`,
      timestamp: `2026-08-10T09:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(
        i % 60,
      ).padStart(2, "0")}.000Z`,
    }),
  );
}
