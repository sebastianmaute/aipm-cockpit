import { describe, expect, it } from "vitest";
import type { ActivityEntry, ActivityKind } from "./activity-log";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, searchHistory } from "./history-search";

const at = (day: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `dev-1-${day}`,
  timestamp: `2026-08-${day}T09:00:00.000Z`,
  kind: "task.created",
  args: [1, "Fix login"],
  ...over,
});

describe("searchHistory", () => {
  it("returns newest first", () => {
    const r = searchHistory([at("10"), at("12"), at("11")], {});
    expect(r.events.map((e) => e.at.slice(8, 10))).toEqual(["12", "11", "10"]);
  });

  it("filters by kind", () => {
    // ★ Typed `ActivityKind[]` on purpose: `HistoryQuery.kinds` is deliberately
    //   the WIDER `readonly string[]` (the model is untrusted input and may send
    //   any string), and this call site proves the narrow union still assigns.
    const kinds: ActivityKind[] = ["milestone.deleted"];
    const r = searchHistory([at("10"), at("11", { kind: "milestone.deleted" })], { kinds });
    expect(r.events).toHaveLength(1);
    // ★ The EN template is "Deleted milestone #{0}" — LOWERCASE "milestone".
    //   Asserting the whole interpolated line rather than a substring also pins
    //   that the render layer ran at all, not just that the filter picked a row.
    expect(r.events[0].summary).toBe("Deleted milestone #1");
    expect(r.events[0].at).toBe("2026-08-11T09:00:00.000Z");
  });

  it("filters by since and until inclusively on the date part", () => {
    const entries = [at("10"), at("11"), at("12")];
    expect(searchHistory(entries, { since: "2026-08-11" }).events).toHaveLength(2);
    expect(searchHistory(entries, { until: "2026-08-11" }).events).toHaveLength(2);
    expect(
      searchHistory(entries, { since: "2026-08-11", until: "2026-08-11" }).events,
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
    expect(searchHistory(entries, { query: "FIX LOGIN" }).events).toHaveLength(1);
    // ★ "to do" appears ONLY in the detail line, so this fails if the haystack
    //   is built from the summary alone.
    const detailHit = searchHistory(entries, { query: "to do" });
    expect(detailHit.events).toHaveLength(1);
    expect(detailHit.events[0].detail).toBe("status: To Do → Done");
  });

  // ★ truncated must reflect whether the cap ACTUALLY cut, not whether a limit
  //   was supplied — the model uses it to decide whether to claim completeness.
  it("sets truncated only when the cap actually cuts", () => {
    const entries = Array.from({ length: 3 }, (_, i) => at(String(10 + i)));
    expect(searchHistory(entries, { limit: 3 }).truncated).toBe(false);
    expect(searchHistory(entries, { limit: 2 }).truncated).toBe(true);
    expect(searchHistory(entries, { limit: 2 }).events).toHaveLength(2);
  });

  // ★ The cap that cuts here is the DEFAULT, not a supplied one: a "truncated
  //   means a limit was passed" implementation reports false for both of these.
  it("sets truncated when an unsupplied default or clamped cap cuts", () => {
    const entries = Array.from({ length: 3 }, (_, i) => at(String(10 + i)));
    expect(searchHistory(entries, {}).truncated).toBe(false);
    expect(searchHistory(manyEntries(DEFAULT_HISTORY_LIMIT + 1), {}).truncated).toBe(true);
    expect(
      searchHistory(manyEntries(MAX_HISTORY_LIMIT + 1), { limit: 9999 }).truncated,
    ).toBe(true);
  });

  it("defaults to DEFAULT_HISTORY_LIMIT and clamps to MAX_HISTORY_LIMIT", () => {
    const entries = manyEntries(250);
    expect(searchHistory(entries, {}).events).toHaveLength(DEFAULT_HISTORY_LIMIT);
    expect(searchHistory(entries, { limit: 9999 }).events).toHaveLength(MAX_HISTORY_LIMIT);
    expect(searchHistory(entries, { limit: 0 }).events).toHaveLength(DEFAULT_HISTORY_LIMIT);
    // ★ The cap slices the NEWEST matches, so the first row must be the last
    //   minted entry — a cap applied before the sort would return the oldest.
    expect(searchHistory(entries, {}).events[0].at).toBe(entries[249].timestamp);
  });

  it("returns an empty result for an empty log", () => {
    expect(searchHistory([], { query: "anything" })).toEqual({ events: [], truncated: false });
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
