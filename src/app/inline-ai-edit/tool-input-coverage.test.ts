import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { INLINE_DESCRIPTORS, type EntityDescriptor } from "./entity-descriptor";
import { TOOL_DEFS } from "../chat-tool-defs";
import { stripComments } from "../../test/strip-comments";

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
// ★★ TWO SCANS, AND THEY ANSWER DIFFERENT QUESTIONS. The first describe below
//  reads the DECLARED schema — every property a `*Fields` helper advertises.
//  The second reads the task write path's SOURCE for `input.<name>`, so an
//  input `buildPatch` accepts that no schema advertises (the legacy `notes`
//  alias) is caught too. Neither is a superset of the other: a declared
//  property nothing reads is invisible to the second, and an accepted key
//  nothing declares is invisible to the first.
//
// ★★★ THE SOURCE SCAN IS WIDER THAN THE SET IT CHECKS AGAINST, and that
//  asymmetry is deliberate but must not be misread. It reads EVERY
//  `input.<name>` in `chat-tools-updates.ts` — a file that is NOT
//  `update_task`'s alone: `buildPatch` is task-only, but `patchWithoutId`
//  serves the other five update tools and `requireToken` serves all six (its
//  `input.expectedToken` read is already in the scanned set today). The
//  assertion then compares that file-wide set against `update_task`'s DECLARED
//  properties. So a key read only by some OTHER update tool in this file would
//  be reported as an undeclared `update_task` input — a loud, MISATTRIBUTED
//  finding. The direction is safe (it can over-report, never under-report), and
//  the scan is left wide on purpose: narrowing it to `buildPatch` would drop
//  `requireToken`'s read from the corpus the anti-vacuity guard below measures,
//  and would blind it to a future task-relevant read placed outside
//  `buildPatch`. Read a failure here as "some tool in this file reads a key
//  `update_task` does not declare", never as "`update_task` reads it".
//
// ★★★ WHAT REMAINS OUTSIDE BOTH, because a false coverage claim reads as
//  protection and stops the next audit. `update_task` is the ONLY update
//  tool whose accepted surface is enumerable from source at all: it is built by
//  `buildPatch`, a whitelist. The other five go through `patchWithoutId`, which
//  has no whitelist — it forwards whatever the model emits minus `id`,
//  `expectedToken` and the token-excluded fields (its docstring says so), so
//  their accepted surface is bounded downstream by the sanitizers, not by any
//  set of `input.<name>` reads a regex could find. Nothing here says anything
//  about those five, and a seventh update tool reading its inputs in some other
//  file would be invisible to both scans.

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

/** Inputs `buildPatch` accepts that `update_task`'s schema does not declare.
 *
 *  ★★ A finding here is a QUESTION, not automatically a defect — but it is
 *  never something to allowlist away to get a green run. `notes` earns its
 *  entry because it resolves INTO `description`, which IS previewed, so the
 *  user still sees the value the writer will store. An accepted key that lands
 *  anywhere else is a preview gap, and belongs in the register rather than
 *  here. */
const UNDECLARED_ACCEPTED: Record<string, string> = {
  "update_task.notes":
    "pre-0.196.0 write ALIAS; `buildPatch` resolves it into `description`, which IS previewed — kept so a stored insight recommendation minted before the rename still replays",
};

describe("every input read anywhere in the task dispatcher file is declared on update_task, or allowlisted", () => {
  // The whole file `buildPatch` lives in — which also holds `patchWithoutId`
  // and `requireToken`, shared with the other five update tools, so this set is
  // NOT `update_task`'s reads alone (see the ★★★ scope note at the top).
  // Reading the source rather than the schema is the point: an
  // accepted-but-undeclared key exists nowhere else.
  // ★★★ COMMENTS ARE BLANKED BEFORE THE SCAN, and skipping that step is a
  //  FALSE GREEN in the one direction that matters. This scan's whole job is to
  //  prove `UNDECLARED_ACCEPTED` still describes a key the code READS. Over raw
  //  text it reads PROSE as code — so deleting `input.notes` from the
  //  dispatcher and leaving a comment that names the removal (this repo's house
  //  style, and the shape the `notes` entry itself is written in) keeps this
  //  test green while the allowlist goes on excusing a key nothing reads. The
  //  allowlist would then be documenting a preview gap that no longer exists,
  //  which is the false-coverage shape this file exists to prevent.
  //  ★★ `stripComments` (`src/test/strip-comments.ts`), NOT a local regex: four
  //   hand-rolled strippers have shipped in this repo and all four were wrong,
  //   with OVER-blanking the dangerous direction — it deletes real code from
  //   the text this scan reads, which makes the set SMALLER and this test pass
  //   MORE. The shared helper uses the TypeScript parser and pins both
  //   directions in `strip-comments.test.ts`.
  //  ★ The FILE-WIDE scope documented above is UNCHANGED — blanking comments
  //   narrows what counts as code, never which file is read. Narrowing to
  //   `buildPatch` is the fix this deliberately does NOT make; the ★★★ scope
  //   note at the top of this file says why.
  //  ★ `.ts`, not the helper's `.tsx` default: the script kind decides how a
  //   non-comma generic arrow parses, and a garbage parse leaves comments
  //   readable — the benign direction, but the guarantee is worth keeping.
  const dispatcherSrc = stripComments(
    readFileSync(join(import.meta.dirname, "..", "chat-tools-updates.ts"), "utf8"),
    "chat-tools-updates.ts",
  );
  const readInputs = new Set(
    [...dispatcherSrc.matchAll(/\binput\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );

  const declaredTaskInputs = (): ReadonlySet<string> => {
    const def = TOOL_DEFS.find((d) => d.name === "update_task");
    const schema = def?.input_schema as { properties?: Record<string, unknown> } | undefined;
    return new Set(Object.keys(schema?.properties ?? {}));
  };

  it("reaches the real source — the scan is not matching an empty set", () => {
    // ★★★ THE ANTI-VACUITY GUARD, and it needs a POSITIVE observable beside the
    //  `toEqual([])` below: a regex that matches nothing reports every input as
    //  declared and passes forever. `taskName` is asserted by NAME because a
    //  bare count survives the file being replaced by something unrelated of
    //  the same size. 13 distinct reads today.
    expect(readInputs.has("taskName")).toBe(true);
    expect(readInputs.size).toBeGreaterThanOrEqual(10);
  });

  it("declares every input read in this file on update_task, or allowlists it with a reason", () => {
    const declared = declaredTaskInputs();
    const undeclared = [...readInputs]
      .filter((name) => !declared.has(name))
      .filter((name) => !UNDECLARED_ACCEPTED[`update_task.${name}`])
      .sort();
    expect(
      undeclared,
      "read in chat-tools-updates.ts but not declared on update_task. The scan is " +
        "FILE-WIDE and that file also holds `patchWithoutId`/`requireToken`, shared with " +
        "the other five update tools — so check WHICH tool reads the key before treating " +
        "this as an `update_task` preview gap.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry must still be read by the write path", () => {
    // An allowlist that outlives its call site is a false assurance, which is
    // the failure mode this register keeps recording.
    for (const key of Object.keys(UNDECLARED_ACCEPTED)) {
      const [tool, field] = key.split(".");
      // The tool half is checked too. The lookup above builds its probe as
      // `update_task.${name}`, so an entry keyed to any other tool is INERT —
      // it excuses nothing and reds nothing, which is the silent-rot shape this
      // test exists to catch. Measured: a mutant that broke only the tool half
      // left this test green until the check was added.
      expect(tool, `${key} names no tool this scan reads`).toBe("update_task");
      expect(readInputs.has(field), `${key} is no longer read; drop the entry`).toBe(true);
    }
  });
});
