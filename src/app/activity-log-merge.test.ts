import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { mergeActivityLogs, ACTIVITY_MAX_ENTRIES } from "./activity-log-merge";
import type { ActivityEntry } from "./activity-log";

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
