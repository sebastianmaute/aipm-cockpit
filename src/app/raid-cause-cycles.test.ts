import { describe, expect, test } from "vitest";
import { breakCauseCycles, wouldCreateCycle } from "./raid";
import type { RaidItem } from "./types";

function item(id: number, causedByRaidIds: number[]): RaidItem {
  return {
    id,
    category: "R",
    title: `Item ${id}`,
    status: "Open",
    linkedTaskIds: [],
    causedByRaidIds,
    stakeholderIds: [],
    raisedDate: "2026-01-01",
  };
}

/** True when no item can reach itself by following its causes. */
function isAcyclic(items: readonly RaidItem[]): boolean {
  return items.every((r) => r.causedByRaidIds.every((p) => !wouldCreateCycle(items.map((x) => (x.id === r.id ? { ...x, causedByRaidIds: x.causedByRaidIds.filter((q) => q !== p) } : x)), r.id, p)));
}

describe("breakCauseCycles (§674)", () => {
  test("returns the same array when the cause graph has no cycle", () => {
    const items = [item(1, []), item(2, [1]), item(3, [1, 2]), item(4, [99])];
    const out = breakCauseCycles(items);
    expect(out.items).toBe(items);
    expect(out.dropped).toEqual([]);
  });

  test("breaks a two-item cycle by dropping the higher id's cause", () => {
    const items = [item(1, [2]), item(2, [1])];
    const out = breakCauseCycles(items);
    expect(out.items.map((r) => [r.id, r.causedByRaidIds])).toEqual([[1, [2]], [2, []]]);
    expect(out.dropped).toEqual([{ childId: 2, parentId: 1 }]);
    expect(isAcyclic(out.items)).toBe(true);
  });

  test("drops a self-cause", () => {
    const out = breakCauseCycles([item(1, [1, 2]), item(2, [])]);
    expect(out.items[0].causedByRaidIds).toEqual([2]);
    expect(out.dropped).toEqual([{ childId: 1, parentId: 1 }]);
  });

  test("breaks a three-item cycle with one drop and keeps the other edges", () => {
    // 1 caused by 3, 2 caused by 1, 3 caused by 2: one loop of three.
    const items = [item(1, [3]), item(2, [1]), item(3, [2]), item(4, [1])];
    const out = breakCauseCycles(items);
    expect(out.dropped).toEqual([{ childId: 3, parentId: 2 }]);
    expect(out.items.map((r) => r.causedByRaidIds)).toEqual([[3], [1], [], [1]]);
    expect(isAcyclic(out.items)).toBe(true);
  });

  test("leaves untouched items as the same objects and keeps array order", () => {
    const items = [item(2, [1]), item(1, [2]), item(5, [])];
    const out = breakCauseCycles(items);
    expect(out.items.map((r) => r.id)).toEqual([2, 1, 5]);
    expect(out.items[1]).toBe(items[1]);
    expect(out.items[2]).toBe(items[2]);
    expect(out.items[0]).not.toBe(items[0]);
    expect(out.items[0].causedByRaidIds).toEqual([]);
  });

  test("keeps a cause on an id no item carries (dangling links are not its concern)", () => {
    const items = [item(1, [7]), item(2, [1])];
    expect(breakCauseCycles(items).items).toBe(items);
  });
});
