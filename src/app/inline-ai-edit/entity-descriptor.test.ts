import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, validSetFor, type InlineEntity } from "./entity-descriptor";
import type { RaidItem } from "../types";

describe("INLINE_DESCRIPTORS", () => {
  const entities: InlineEntity[] = ["task", "raid", "change", "milestone", "stakeholder"];

  it("has a descriptor per entity with matching update/delete tools", () => {
    expect(INLINE_DESCRIPTORS.task.updateTool).toBe("update_task");
    expect(INLINE_DESCRIPTORS.raid.deleteTool).toBe("delete_raid_item");
    expect(INLINE_DESCRIPTORS.change.updateTool).toBe("update_change");
    expect(INLINE_DESCRIPTORS.milestone.wsKey).toBe("milestones");
    expect(INLINE_DESCRIPTORS.stakeholder.titleOf({ name: "Ann" } as never)).toBe("Ann");
    for (const e of entities) expect(INLINE_DESCRIPTORS[e].entity).toBe(e);
  });

  it("excludes relational id-list + FK fields from diffFields", () => {
    for (const e of entities) {
      const f = INLINE_DESCRIPTORS[e].diffFields;
      for (const banned of ["linkedTaskIds", "causedByRaidIds", "stakeholderIds", "linkedRaidIds", "ownerResourceId", "resourceId", "raci"]) {
        expect(f).not.toContain(banned);
      }
    }
  });

  it("RAID status valid-set follows the item's category", () => {
    const risk = validSetFor("raid", "status", { category: "R" } as RaidItem);
    const issue = validSetFor("raid", "status", { category: "I" } as RaidItem);
    expect(risk.has("Open")).toBe(true);           // Risk: Open/Mitigated/Realized/Closed
    expect(risk.has("Resolved")).toBe(false);      // Resolved is Issue-only
    expect(issue.has("Resolved")).toBe(true);
    expect(issue.has("Mitigated")).toBe(false);
  });

  it("marks required-non-empty, date, int-range, enum, array fields", () => {
    expect(INLINE_DESCRIPTORS.milestone.requiredNonEmpty.has("name")).toBe(true);
    expect(INLINE_DESCRIPTORS.milestone.dateFields.has("date")).toBe(true);
    expect(INLINE_DESCRIPTORS.raid.intRangeFields.probability).toEqual([1, 5]);
    expect(INLINE_DESCRIPTORS.change.intRangeFields.scheduleImpactDays[0]).toBe(0);
    expect(INLINE_DESCRIPTORS.task.arrayFields.has("labels")).toBe(true);
    expect(Object.keys(INLINE_DESCRIPTORS.stakeholder.enumFields)).toContain("influence");
  });
});
