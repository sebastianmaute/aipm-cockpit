import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, validSetFor, type InlineEntity } from "./entity-descriptor";
import type { RaidItem } from "../types";

describe("INLINE_DESCRIPTORS", () => {
  // ★★ A HAND-COPY of the `InlineEntity` union, not a derivation — nothing in
  // TypeScript can enumerate a union at runtime, so widening the union does NOT
  // fail this file. A new member has to be added here by hand or every
  // per-entity check below silently skips it.
  const entities: InlineEntity[] = ["task", "raid", "change", "milestone", "stakeholder", "resource"];

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
      // `roleId` is Resource's FK to Role — the same exclusion as Task.resourceId.
      for (const banned of ["linkedTaskIds", "causedByRaidIds", "stakeholderIds", "linkedRaidIds", "ownerResourceId", "resourceId", "roleId", "raci"]) {
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

  // ★★★ EVERY INT-RANGE FIELD MUST ALSO BE A NUMBER FIELD, and nothing else
  //  checks it. `describeEntityCalls` routes a `numberFields` member through
  //  `str` and EVERY OTHER field through `normalizePreviewValue`, which mirrors
  //  `sanitizeText` and therefore BLANKS a non-string to `""`. A model sends
  //  `probability: 9` as a real JSON number, so an int-range field missing from
  //  `numberFields` previews as `""` — and `Number("")` is `0`, which satisfies
  //  any range starting at 0 and skips the out-of-range rejection outright.
  //  Silent in both directions: no throw, no rejected row, just a blank diff.
  //  ★★ The containment holds today by COINCIDENCE, not by construction — the
  //  two members are declared independently a few lines apart — which is why it
  //  is pinned here rather than left to be re-derived.
  it("keeps every int-range field inside numberFields", () => {
    const ranged = entities.flatMap((e) =>
      Object.keys(INLINE_DESCRIPTORS[e].intRangeFields).map((f) => `${e}.${f}`),
    );
    const gaps = ranged.filter((k) => {
      const [e, f] = k.split(".") as [InlineEntity, string];
      return !INLINE_DESCRIPTORS[e].numberFields.has(f);
    });
    // ★ The population is asserted separately so a descriptor set that declared
    //  NO int-range field at all could not read as a pass.
    expect(ranged.length).toBeGreaterThan(0);
    expect(gaps).toEqual([]);
  });

  // ★★ THE TWO EMAIL CAPS ARE NOT THE SAME NUMBER, and a shared-cap assumption
  //  is the defect `textCaps` exists to close: a stakeholder's email is clipped
  //  by `sanitizeText(o.email, BUDGET_NAME_MAX)` (200), a task's by EMAIL_MAX
  //  (320). They also live in two DIFFERENT modules.
  it("does not share one email cap across entities", () => {
    const task = INLINE_DESCRIPTORS.task.textCaps.assigneeEmail;
    const stakeholder = INLINE_DESCRIPTORS.stakeholder.textCaps.email;
    expect(task).toBeGreaterThan(0);
    expect(stakeholder).toBeGreaterThan(0);
    expect(stakeholder).not.toBe(task);
  });
});
