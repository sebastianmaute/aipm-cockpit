import { describe, expect, it } from "vitest";
import { applyOwnerAssignment } from "./action-assign-owner";
import type { RaidItem } from "./types";

function makeItem(overrides?: Partial<RaidItem>): RaidItem {
  return {
    id: 1,
    category: "risk",
    title: "DB outage",
    owner: undefined,
    ownerEmail: undefined,
    ownerResourceId: null,
    ...overrides,
  } as RaidItem;
}

describe("applyOwnerAssignment", () => {
  it("writes owner, ownerEmail, ownerResourceId to the matching item", () => {
    const input: readonly RaidItem[] = [makeItem({ id: 1 }), makeItem({ id: 2 })];
    const result = applyOwnerAssignment(input, 1, { name: "Mara Vega", email: "mara@x.io", resourceId: 42 });
    expect(result[0]).toMatchObject({ owner: "Mara Vega", ownerEmail: "mara@x.io", ownerResourceId: 42 });
    expect(result[1]).toBe(input[1]); // non-matching row is referentially equal
  });

  it("returns the SAME array reference when no item matches id", () => {
    const input: readonly RaidItem[] = [makeItem({ id: 1 })];
    const result = applyOwnerAssignment(input, 999, { name: "X", email: "x@x.io", resourceId: null });
    expect(result).toBe(input);
  });

  it("leaves non-matching rows referentially unchanged", () => {
    const row1 = makeItem({ id: 1 });
    const row2 = makeItem({ id: 2 });
    const input: readonly RaidItem[] = [row1, row2];
    const result = applyOwnerAssignment(input, 1, { name: "Ana", email: "ana@x.io", resourceId: 7 });
    expect(result[1]).toBe(row2);
  });
});
