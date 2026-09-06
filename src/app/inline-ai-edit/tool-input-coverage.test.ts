import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, type EntityDescriptor } from "./entity-descriptor";
import { TOOL_DEFS } from "../chat-tool-defs";

// The enumeration gate for the apply-preview.
//
// ★★★ WHAT THIS EXISTS TO STOP. The inline "Ask Claude" preview discloses what
//  an update tool will change BEFORE the user approves it. Eleven declared tool
//  inputs were once invisible to it — each one a value the model could rewrite
//  behind a preview that showed nothing. They were found by hand, one at a
//  time. This test is what stops the gap reopening: adding a property to any
//  `*Fields` helper in `chat-tool-defs.ts` now fails CI unless the field is
//  either previewable (`diffFields` / `linkFields`) or excluded HERE with a
//  written reason.
//
// ★★ IT READS THE DECLARED SCHEMA, so its reach ends there. An input the
//  dispatcher accepts but the schema never advertises is invisible to it —
//  `buildPatch` (`chat-tools-updates.ts`) still resolves a legacy `notes` key
//  into `description`, and no property named `notes` exists in `taskFields`, so
//  nothing below can see that alias. That one is harmless (it lands in
//  `description`, which IS previewed); the LIMIT is the point worth knowing.

/** Inputs a write tool accepts that the preview deliberately does NOT show.
 *
 *  Every entry needs a REASON, and the reason has to be about the FIELD — why
 *  showing it would be meaningless or wrong — never about the effort of
 *  showing it. Adding an entry to make this file go green defeats the only
 *  thing it checks, and a defeated gate reports success. If a name below looks
 *  like a user-visible value a write tool can change, it is a FINDING, not an
 *  exclusion. */
const DECLARED_EXCLUSIONS: Record<string, string> = {
  // `id` addresses the row the preview is ALREADY showing — it selects the
  // before-image rather than changing it, so a diff row for it would be a
  // tautology ("id: 7 → 7"). A tool call naming a DIFFERENT id is a different
  // record, not an undisclosed edit to this one.
  "update_task.id": "names the row being previewed, not a change to it",
  "update_raid_item.id": "names the row being previewed, not a change to it",
  "update_change.id": "names the row being previewed, not a change to it",
  "update_milestone.id": "names the row being previewed, not a change to it",
  "update_stakeholder.id": "names the row being previewed, not a change to it",
  "update_resource.id": "names the row being previewed, not a change to it",

  // `expectedToken` is the optimistic-concurrency token from the read that
  // produced this proposal (`expectedTokenField`, declared beside the
  // `requireToken` that enforces it). It is never stored on the row and never
  // shown to the user; its whole job is to make the write REFUSE if the record
  // moved. Nothing about it is user data.
  "update_task.expectedToken": "concurrency token, not user data — never persisted on the row",
  "update_raid_item.expectedToken": "concurrency token, not user data — never persisted on the row",
  "update_change.expectedToken": "concurrency token, not user data — never persisted on the row",
  "update_milestone.expectedToken": "concurrency token, not user data — never persisted on the row",
  "update_stakeholder.expectedToken": "concurrency token, not user data — never persisted on the row",
  "update_resource.expectedToken": "concurrency token, not user data — never persisted on the row",

  // ★★ The one exclusion that is NOT structural, and the one to re-check if
  //  `resourceFields.name` ever changes meaning. It is a write ALIAS: a
  //  convenience whole-name input the dispatcher splits onto `firstName` /
  //  `lastName` before the diff loop runs. BOTH halves are in `diffFields`, so
  //  its effect IS fully disclosed — under the two field names that actually
  //  get stored. Previewing `name` as well would show the same edit twice, and
  //  as a value no row carries.
  "update_resource.name": "a write ALIAS projected onto firstName/lastName, both of which ARE previewed",
};

/** The update tools that resolve to a previewable entity, paired with their
 *  descriptor. `update_settings` and the document tools deliberately resolve to
 *  nothing — they are not entity-row edits and the inline editor never opens on
 *  them. */
function previewableUpdateTools(): { tool: string; entity: EntityDescriptor; props: string[] }[] {
  const out: { tool: string; entity: EntityDescriptor; props: string[] }[] = [];
  for (const def of TOOL_DEFS) {
    if (!def.name.startsWith("update_")) continue;
    const entity = Object.values(INLINE_DESCRIPTORS).find((d) => d.updateTool === def.name);
    if (!entity) continue;
    const schema = def.input_schema as { properties?: Record<string, unknown> };
    out.push({ tool: def.name, entity, props: Object.keys(schema.properties ?? {}) });
  }
  return out;
}

/** What the preview can render for an entity: the scalar diff rows plus the
 *  relationship rows. Mirrors `use-inline-entity-edit.ts`, which builds its
 *  patch from exactly these two sets. */
const shownFields = (entity: EntityDescriptor): ReadonlySet<string> =>
  new Set([...entity.diffFields, ...Object.keys(entity.linkFields)]);

describe("every declared write-tool input is previewable or excluded with a reason", () => {
  it("has no undeclared input", () => {
    const resolved = previewableUpdateTools();
    const missing: string[] = [];
    let checked = 0;
    for (const { tool, entity, props } of resolved) {
      const shown = shownFields(entity);
      for (const field of props) {
        checked += 1;
        if (shown.has(field)) continue;
        if (DECLARED_EXCLUSIONS[`${tool}.${field}`]) continue;
        missing.push(`${tool}.${field}`);
      }
    }

    // ★★★ VACUITY GUARDS. A scan that resolves nothing passes everything, and
    //  that is this repo's recurring gate failure. Two of them, because the
    //  count alone is the weaker check: a floor is a magic number that drifts
    //  with every schema edit, while "all six entities resolved a tool" fails
    //  the moment a rename breaks the `updateTool` join — the realistic way
    //  this traversal goes quietly blind.
    expect(resolved.map((r) => r.entity.entity).sort()).toEqual(
      Object.keys(INLINE_DESCRIPTORS).sort(),
    );
    // 81 today. The floor is set just under "81 minus the SMALLEST entity"
    // (milestone contributes 7), so losing any one entity's properties — the
    // way this traversal would go blind if `input_schema`'s shape moved and
    // `properties ?? {}` started yielding nothing — reddens here. It leaves
    // room for a handful of fields to be legitimately retired without a
    // spurious failure. Measure the real total before changing it: flip this to
    // `toBe(-1)` and read the reported actual.
    expect(checked).toBeGreaterThanOrEqual(75);

    expect(missing).toEqual([]);
  });

  it("declares no exclusion for a field that is actually shown", () => {
    // A stale exclusion is how the set above rots into a rubber stamp: the
    // field gets added to the preview, the exclusion outlives it, and the next
    // reader takes the entry as evidence that the field is deliberately hidden.
    for (const key of Object.keys(DECLARED_EXCLUSIONS)) {
      const [tool, field] = key.split(".");
      const entity = Object.values(INLINE_DESCRIPTORS).find((d) => d.updateTool === tool);
      expect(entity, `${key} names no update tool; drop or fix the exclusion`).toBeDefined();
      if (!entity) continue;
      expect(shownFields(entity).has(field), `${key} is shown; drop the exclusion`).toBe(false);
    }
  });
});
