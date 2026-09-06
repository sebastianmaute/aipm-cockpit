import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, validSetFor, type InlineEntity } from "./entity-descriptor";
import { emptyWorkspace } from "../workspace";
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

  it("marks required-non-empty, date, numeric, enum, array fields", () => {
    expect(INLINE_DESCRIPTORS.milestone.requiredNonEmpty.has("name")).toBe(true);
    expect(INLINE_DESCRIPTORS.milestone.dateFields.has("date")).toBe(true);
    // ★ A numeric member is a PREDICATE now, not a `[min, max]` tuple, so it is
    //  asserted by BEHAVIOUR — there are no bounds left to compare. The boolean
    //  leg is the one the tuple form could not express at all (§395): it was
    //  checked against the RENDERED string, where `true` had already become
    //  "1".
    expect(INLINE_DESCRIPTORS.raid.numericFields.probability(3)).toBe(true);
    expect(INLINE_DESCRIPTORS.raid.numericFields.probability(9)).toBe(false);
    expect(INLINE_DESCRIPTORS.raid.numericFields.probability(true)).toBe(false);
    expect(INLINE_DESCRIPTORS.change.numericFields.scheduleImpactDays(0)).toBe(true);
    expect(INLINE_DESCRIPTORS.change.numericFields.scheduleImpactDays(-1)).toBe(false);
    expect(INLINE_DESCRIPTORS.task.arrayFields.has("labels")).toBe(true);
    expect(Object.keys(INLINE_DESCRIPTORS.stakeholder.enumFields)).toContain("influence");
  });

  // ★★★ EVERY NUMERIC FIELD MUST ALSO BE A NUMBER FIELD, and nothing else
  //  checks it.
  //  ★★★ THE REASON CHANGED WITH §395 AND THE OLD ONE IS NOW FALSE — it read
  //  "`numberFields` is what makes `describeEntityCalls` run the int-range
  //  guard on that field at all, so a range declared for a field outside the
  //  set is never enforced". That was true while the guard read the RENDERED
  //  `after`, which only became a number because `numberFields` routed it
  //  through `numberPreview`. The guard now reads `input[f]` RAW, so it fires
  //  for a numeric field whether or not the set contains it. What the
  //  containment buys today is the CARD: outside `numberFields` the value is
  //  previewed verbatim by `str`, so an accepted `"3.0"` renders as the model's
  //  spelling rather than the `3` the writer stores — a disclosure defect
  //  rather than an unenforced guard, and still worth pinning.
  //  ★ The example used to be `"3"`, which cannot illustrate the point:
  //  `str("3")` and `numberPreview("3")` both return `"3"`, so the two sides
  //  are indistinguishable at that value. It takes a spelling the coercion
  //  normalises — `"3.0"`, `" 3"`, `"3e0"` — for the divergence to be visible.
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
  it("keeps every numeric field inside numberFields", () => {
    const guarded = entities.flatMap((e) =>
      Object.keys(INLINE_DESCRIPTORS[e].numericFields).map((f) => `${e}.${f}`),
    );
    const gaps = guarded.filter((k) => {
      const [e, f] = k.split(".") as [InlineEntity, string];
      return !INLINE_DESCRIPTORS[e].numberFields.has(f);
    });
    // ★ The population is asserted separately so a descriptor set that declared
    //  NO numeric field at all could not read as a pass.
    expect(guarded.length).toBeGreaterThan(0);
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
    // ★ The row is the entry's second argument since §397; neither of these two
    //  reads it, so an empty one is the honest probe.
    const task = INLINE_DESCRIPTORS.task.fieldSanitizers.assigneeEmail(long, {});
    const stakeholder = INLINE_DESCRIPTORS.stakeholder.fieldSanitizers.email(long, {});
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
    const e = INLINE_DESCRIPTORS.resource.fieldSanitizers.isExternal;
    const f = (v: unknown): string => e(v, {});
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
  //  rejection in `describeEntityCalls`. Same failure the numeric-field test
  //  above guards from the other direction, so both are needed.
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

describe("linkFields", () => {
  it("names a real workspace array for every link field", () => {
    // A wrong wsKey resolves nothing and every title renders as unknown, which
    // reads like data loss on the card. The ws fixture proves the key exists.
    const ws = emptyWorkspace();
    let checked = 0;
    for (const d of Object.values(INLINE_DESCRIPTORS)) {
      for (const [field, link] of Object.entries(d.linkFields)) {
        expect(Array.isArray(ws[link.wsKey]), `${d.entity}.${field} -> ${String(link.wsKey)}`).toBe(true);
        checked += 1;
      }
    }
    // Guards against an empty map registering zero assertions and reporting green.
    expect(checked).toBe(8);
  });

  it("declares no link field that is also a diffField", () => {
    // The two sets must stay disjoint: a field in BOTH would be written back by
    // the inline editor as a title string. See the LinkDiff docstring.
    for (const d of Object.values(INLINE_DESCRIPTORS)) {
      for (const field of Object.keys(d.linkFields)) {
        expect(d.diffFields, `${d.entity}.${field}`).not.toContain(field);
      }
    }
  });

  // ★★★ `Role` HAS NO `name` FIELD — a role's human label is `disciplineId` +
  //  `gradeId` resolved against TWO OTHER workspace arrays (`roleLabel`), which
  //  is the whole reason `titleOf` takes the workspace as its second argument.
  //  A single-row accessor (`r.name`) returns `""` for EVERY role, and an empty
  //  title on this card is indistinguishable from the link having been dropped
  //  — the exact failure the disclosure exists to prevent. `version-diff.ts`
  //  solved the same problem the same way for its `roles` `nameOf`; this is not
  //  a new shape.
  it("resolves a role title through the workspace, not through a name field", () => {
    const ws = {
      ...emptyWorkspace(),
      disciplines: [{ id: 1, name: "Developer" }],
      grades: [{ id: 2, name: "Senior" }],
    };
    const link = INLINE_DESCRIPTORS.resource.linkFields.roleId;
    expect(link.titleOf({ id: 7, disciplineId: 1, gradeId: 2 }, ws)).toBe("Developer Senior");
  });

  // ★★ `sanitizeResource` coerces `roleId` with `toNumber`, NOT `Number`, and
  //  the two disagree on exactly the shape a model is most likely to emit for a
  //  link field: `Number([5])` is 5 (accepted) while `toNumber([5])` is NaN
  //  (rejected → the FK stores `null`). Previewing an array as a resolved link
  //  the writer then drops is the divergence `sanitize` exists to close, so the
  //  entry must call the writer's own coercion rather than restate its rule.
  it("rejects a roleId shape the resource writer would drop", () => {
    const link = INLINE_DESCRIPTORS.resource.linkFields.roleId;
    expect(link.sanitize(5)).toEqual([5]);
    expect(link.sanitize("5")).toEqual([5]);
    expect(link.sanitize([5])).toEqual([]);
    expect(link.sanitize(0)).toEqual([]);
    expect(link.sanitize(undefined)).toEqual([]);
  });

  // ★★ The descriptor must carry each writer's OWN function, never a copy of
  //  its rule. ★★★ THIS TEST NO LONGER DISCRIMINATES ON THE ID FIELDS, and that
  //  is a disclosed coverage loss, not an oversight: it used to assert
  //  `milestone("1;2")` was `[]` where raid was `[1, 2]`, and
  //  `milestone([3, 1, 3])` was `[3, 1, 3]` where raid deduped — the milestone
  //  rule was array-only and non-deduping. §403 aligned it onto `sanitizeIdList`
  //  in 0.289.0, so the two now agree on every probe and no id value can tell a
  //  real delegation from a shared approximation. The discriminator that
  //  SURVIVES is `resource.roleId`, pinned by the test above this one, which is
  //  the only reason that test must not be folded into this one.
  it("carries each writer's own id rule, not a shared approximation", () => {
    const raid = INLINE_DESCRIPTORS.raid.linkFields.linkedTaskIds.sanitize;
    const milestone = INLINE_DESCRIPTORS.milestone.linkFields.linkedTaskIds.sanitize;
    // A delimited string: both parse it.
    expect(raid("1;2")).toEqual([1, 2]);
    expect(milestone("1;2")).toEqual([1, 2]);
    // Duplicates: both dedupe, keeping first-occurrence order.
    expect(raid([3, 1, 3])).toEqual([3, 1]);
    expect(milestone([3, 1, 3])).toEqual([3, 1]);
  });
});
