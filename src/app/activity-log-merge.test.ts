import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { mergeActivityLogs, ACTIVITY_MAX_ENTRIES } from "./activity-log-merge";
import { sanitizeActivityEntry, type ActivityEntry } from "./activity-log";

function entry(id: string, timestamp: string): ActivityEntry {
  return { id, timestamp, kind: "task.created", args: ["T-1"] };
}

describe("mergeActivityLogs", () => {
  it("unions entries from both sides, keeping one copy of a shared id", () => {
    // Arrange
    const a = [entry("dev1-1", "2026-08-01T00:00:00.000Z"), entry("dev1-2", "2026-08-02T00:00:00.000Z")];
    const b = [entry("dev1-2", "2026-08-02T00:00:00.000Z"), entry("dev2-1", "2026-08-03T00:00:00.000Z")];

    // Act
    const merged = mergeActivityLogs(a, b);

    // Assert
    expect(merged.map((e) => e.id)).toEqual(["dev1-1", "dev1-2", "dev2-1"]);
  });

  it("resolves a duplicate id in favour of b (the later side)", () => {
    const a = [{ ...entry("dev1-2", "2026-08-02T00:00:00.000Z"), args: ["FROM-A"] }];
    const b = [{ ...entry("dev1-2", "2026-08-02T00:00:00.000Z"), args: ["FROM-B"] }];
    expect(mergeActivityLogs(a, b)[0].args).toEqual(["FROM-B"]);
  });

  it("sorts by timestamp ascending regardless of input order", () => {
    const a = [entry("dev1-9", "2026-08-09T00:00:00.000Z")];
    const b = [entry("dev1-1", "2026-08-01T00:00:00.000Z")];
    expect(mergeActivityLogs(a, b).map((e) => e.id)).toEqual(["dev1-1", "dev1-9"]);
  });

  it("caps to the NEWEST entries, dropping the oldest", () => {
    const many = Array.from({ length: ACTIVITY_MAX_ENTRIES + 10 }, (_, i) =>
      entry(`dev1-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );
    const merged = mergeActivityLogs(many, []);
    expect(merged).toHaveLength(ACTIVITY_MAX_ENTRIES);
    expect(merged[merged.length - 1].id).toBe(`dev1-${ACTIVITY_MAX_ENTRIES + 9}`);
    expect(merged[0].id).toBe("dev1-10");
  });

  it("treats undefined sides as empty", () => {
    expect(mergeActivityLogs(undefined, undefined)).toEqual([]);
    expect(mergeActivityLogs(undefined, [entry("dev1-1", "2026-08-01T00:00:00.000Z")])).toHaveLength(1);
  });

  it("returns a NEW array even when one side is empty (reference-equality dirty check)", () => {
    const a = [entry("dev1-1", "2026-08-01T00:00:00.000Z")];
    expect(mergeActivityLogs(a, [])).not.toBe(a);
    const b = [entry("dev2-1", "2026-08-02T00:00:00.000Z")];
    expect(mergeActivityLogs([], b)).not.toBe(b);
  });

  // §161: `mergeActivityLogs`'s lexicographic sort-then-cap only equals
  //   chronological order once every timestamp is canonical `toISOString()`
  //   shape. This proves the fix reaches the cap, not just the comparator:
  //   entries are sanitized (the real load-boundary step) before merging.
  it("an offset stamp that is actually newest survives the cap after sanitize (§161)", () => {
    // ACTIVITY_MAX_ENTRIES canonical entries, one second apart, all within the
    // first ~8 minutes of the UTC day.
    const canonical = Array.from({ length: ACTIVITY_MAX_ENTRIES }, (_, i) =>
      entry(`dev1-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );
    // Its wall-clock digits ("00:00:00") are IDENTICAL to `dev1-0`'s, and the
    // offset sign "-" sorts lexicographically BEFORE the fraction-start ".",
    // so an unsanitized merge treats this as the single OLDEST entry and the
    // cap drops it. Its real instant (local + 14h) is 2026-01-01T14:00:00Z —
    // later than every canonical entry above (all ≤ 2026-01-01T00:08:19Z).
    const offsetNewest: ActivityEntry = {
      id: "dev2-newest",
      timestamp: "2026-01-01T00:00:00-14:00",
      kind: "task.created",
      args: ["Newest"],
    };

    const sanitized = [...canonical, offsetNewest].map((e) => sanitizeActivityEntry(e)!);
    const merged = mergeActivityLogs(sanitized, []);

    expect(merged).toHaveLength(ACTIVITY_MAX_ENTRIES);
    expect(merged[merged.length - 1].id).toBe("dev2-newest");
    expect(merged[merged.length - 1].timestamp).toBe("2026-01-01T14:00:00.000Z");
  });

  it("agrees on membership regardless of argument order, and never exceeds the cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 10 ** 12 })), { maxLength: 60 }),
        fc.array(fc.tuple(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 10 ** 12 })), { maxLength: 60 }),
        (rawA, rawB) => {
          const toEntries = (raw: [string, number][]) =>
            raw.map(([id, ms]) => entry(id, new Date(ms).toISOString()));
          const ab = mergeActivityLogs(toEntries(rawA), toEntries(rawB));
          const ba = mergeActivityLogs(toEntries(rawB), toEntries(rawA));
          const expectedIds = new Set([...rawA, ...rawB].map(([id]) => id));
          expect(new Set(ab.map((e) => e.id))).toEqual(expectedIds);
          expect(new Set(ba.map((e) => e.id))).toEqual(expectedIds);
          expect(ab.length).toBe(Math.min(expectedIds.size, ACTIVITY_MAX_ENTRIES));
        },
      ),
    );
  });
});
