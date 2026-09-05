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
  //  checks it. `numberFields` is what makes `describeEntityCalls` run the
  //  int-range guard on that field at all, so a range declared for a field
  //  outside the set is never enforced: the value is previewed and accepted
  //  whatever it is. Silent in both directions — no throw, no rejected row.
  //  ★★ The containment holds today by COINCIDENCE, not by construction — the
  //  two members are declared independently a few lines apart — which is why it
  //  is pinned here rather than left to be re-derived.
  //  ★★★ THIS COMMENT USED TO STATE A MECHANISM THAT NO LONGER EXISTS: that
  //  every non-`numberFields` field ran through `normalizePreviewValue` — a
  //  helper DELETED in `44c84bfc`, which exists nowhere in the tree today —
  //  which
  //  "mirrors `sanitizeText` and therefore BLANKS a non-string to `""`", so a
  //  numeric `probability: 9` previewed as `""` and `Number("")` slipped the
  //  guard. That was true of §373's FIRST cut and was reverted in the same
  //  branch — the default is now verbatim `str`, and `raid.probability` has no
  //  `fieldSanitizers` entry, so `str(9)` is `"9"`. The TEST is still right and
  //  still worth having; only its stated reason had rotted. `docs:symbols:check`
  //  cannot see a `src/` comment — `npm run src:symbols:check` is what reported
  //  the dangling `normalizePreviewValue`.
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
  //  is the defect `fieldSanitizers` exists to close: a stakeholder's email is
  //  clipped by `sanitizeText(o.email, BUDGET_NAME_MAX)` (200), a task's by
  //  EMAIL_MAX (320). They also live in two DIFFERENT modules.
  //  ★ Asserted on OUTPUT LENGTH rather than on a stored number, because the
  //  member no longer holds a number to compare — and the output is the thing
  //  the preview actually shows.
  it("does not share one email cap across entities", () => {
    const long = "a".repeat(1000);
    const task = INLINE_DESCRIPTORS.task.fieldSanitizers.assigneeEmail(long);
    const stakeholder = INLINE_DESCRIPTORS.stakeholder.fieldSanitizers.email(long);
    expect(task.length).toBeGreaterThan(0);
    expect(stakeholder.length).toBeGreaterThan(0);
    expect(stakeholder.length).not.toBe(task.length);
  });

  // ★★★ THE ONE NON-STRING `diffField` IN THE WHOLE SET, and the regression
  //  that motivated inverting `fieldSanitizers`' default. `FieldDiff.raw` is
  //  what `use-inline-entity-edit.ts` puts in the write patch, and
  //  `sanitizeResource` stores the flag only for `true` / `"true"` — so a TEXT
  //  sanitizer here (which blanks a non-string to `""`) does not merely
  //  mispreview, it DROPS the flag on apply.
  //  ★★ `"false"`, not `""`, is the assertion that matters: the flag is stored
  //  present-or-absent, so leaving the field OUT of the map (previewing
  //  `str(v)` verbatim) is right for `true` and still wrong for `false`, which
  //  would read as a change against an absent key. Both directions are pinned.
  it("normalises the one non-string diffField through the sanitizer's predicate", () => {
    const f = INLINE_DESCRIPTORS.resource.fieldSanitizers.isExternal;
    expect(INLINE_DESCRIPTORS.resource.diffFields).toContain("isExternal");
    expect(f(true)).toBe("true");
    expect(f("true")).toBe("true");
    // The stored shape of an INTERNAL resource: no key at all.
    expect(f(undefined)).toBe("false");
    expect(f(false)).toBe("false");
    expect(f("false")).toBe("false");
    // Not blanked, which is what a text sanitizer would have done.
    expect(f(true)).not.toBe("");
  });

  // ★★ A NUMBER FIELD MUST NOT CARRY A TEXT SANITIZER. Every text sanitizer in
  //  play blanks a non-string to `""`, and `Number("")` is `0` — which
  //  satisfies any range starting at 0 and silently skips the out-of-range
  //  rejection in `describeEntityCalls`. Same failure the int-range test above
  //  guards from the other direction, so both are needed.
  it("keeps numberFields out of fieldSanitizers", () => {
    const overlaps = entities.flatMap((e) =>
      [...INLINE_DESCRIPTORS[e].numberFields]
        .filter((f) => INLINE_DESCRIPTORS[e].fieldSanitizers[f] !== undefined)
        .map((f) => `${e}.${f}`),
    );
    // The population is asserted so a descriptor set declaring NO number field
    // could not read as a pass.
    expect(entities.flatMap((e) => [...INLINE_DESCRIPTORS[e].numberFields]).length).toBeGreaterThan(0);
    expect(overlaps).toEqual([]);
  });

  // ★★ A `fieldSanitizers` KEY THAT IS NOT A `diffField` IS DEAD — the preview
  //  loop only ever looks one up per `diffFields` member, so a typo'd or stale
  //  key is inert and invisible. Cheap to check, and the differential test in
  //  plan.sanitizer-parity.test.ts cannot see it (it iterates diffFields).
  it("has no fieldSanitizers key outside diffFields", () => {
    const strays = entities.flatMap((e) =>
      Object.keys(INLINE_DESCRIPTORS[e].fieldSanitizers)
        .filter((f) => !INLINE_DESCRIPTORS[e].diffFields.includes(f))
        .map((f) => `${e}.${f}`),
    );
    expect(strays).toEqual([]);
  });
});
