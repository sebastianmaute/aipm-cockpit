// src/app/sanitize-milestone-patch.test.ts
//
// ★★★ THE MERGE-SITE GUARD FOR MILESTONE, and the third of three siblings
// (`sanitize-raid-patch.test.ts`, `sanitize-change-patch.test.ts`).
//
// The defect it closes: `updateMilestone` merges `{...existing, ...patch}` and
// hands the result to `sanitizeMilestone`, a FULL-RECORD sanitizer that assigns
// its optional fields conditionally (`if (achievedDate) m.achievedDate = ...`).
// So a value the sanitizer does not accept does not merely fail to apply — the
// rebuilt record OMITS the key, and a populated field is CLEARED. The AI edit
// preview refuses that same value, so the card reads "unchanged" while the
// write wipes the date.
//
// ★★ The fix lives at the MERGE SITE, never in `sanitizeMilestone`: that
// function also runs on the load paths, where there is no prior value to
// preserve, and its own behaviour is pinned by `sanitize-records.test.ts`.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { dropUnacceptedMilestoneFields, sanitizeMilestone } from "./sanitize";
import { AI_RICH_FIELDS, withAiRichFields } from "./ai-rich-text";
import { describeEntityCalls } from "./inline-ai-edit/plan";
import { INLINE_DESCRIPTORS } from "./inline-ai-edit/entity-descriptor";
import { type Workspace } from "./workspace";

/** The composition `updateMilestone` (`use-register-tools.ts`) really performs.
 *
 *  ★★★ IT EXISTS BECAUSE A TEST THAT COMPOSES ITS OWN PATH PROVES NOTHING ABOUT
 *  PRODUCTION, and this file shipped exactly that defect. The first cut of the
 *  `description` test called `dropUnacceptedMilestoneFields` on a raw patch and
 *  spread the result into `sanitizeMilestone`, omitting the `withAiRichFields`
 *  step that sits between them at the ONLY call site. That step runs
 *  `sanitizeAiRichText`, which returns "" for every non-string — so in
 *  production the guard's `typeof v === "string"` was handed an
 *  already-stringified value and could NEVER fire. The test was green, the
 *  preview refused the value, and the write cleared the stored rich text
 *  anyway: the precise divergence §398 exists to close, shipped behind a
 *  passing suite.
 *
 *  ★★ The sibling `achievedDate` assertions had the same shape and were correct
 *  only BY LUCK — `achievedDate` is not in `AI_RICH_FIELDS.milestone`, so the
 *  omitted step was a no-op for it. That luck ran out the moment a RICH field
 *  joined the guard table, so they now route through here too: correct by
 *  construction rather than by a coincidence nothing was checking.
 *
 *  ★★ THIS IS STILL A MIRROR, NOT THE CALL SITE, so it cannot see the real one
 *  being re-nested — which is the very failure above, one level up. The
 *  "nests the guard OUTSIDE" source assertion at the bottom of this file is
 *  what closes that; neither half is sufficient alone. */
function applyMilestoneUpdate(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  return sanitizeMilestone({
    ...existing,
    ...withAiRichFields(dropUnacceptedMilestoneFields(patch), AI_RICH_FIELDS.milestone),
    id: existing.id,
  });
}

const BASE = {
  id: 5,
  name: "GA",
  date: "2026-01-01",
  achievedDate: "2026-02-02",
  linkedTaskIds: [] as number[],
};

/** The values a model actually reaches the writer with. */
const REFUSED = [
  { label: "the boolean true", value: true },
  { label: "the boolean false", value: false },
  { label: "the number 42", value: 42 },
  { label: "a padded non-date", value: "  padded  " },
];

describe("dropUnacceptedMilestoneFields", () => {
  describe("achievedDate", () => {
    for (const { label, value } of REFUSED) {
      it(`drops ${label} rather than letting the rebuild clear the stored date`, () => {
        const guarded = dropUnacceptedMilestoneFields({ achievedDate: value });
        // ★ Assert key ABSENCE with `in`, not `toEqual({})`: vitest's toEqual
        //  ignores properties whose value is `undefined`, so the obvious
        //  spelling passes against a guard that sets the key to undefined.
        expect("achievedDate" in guarded).toBe(false);
      });
    }

    it("keeps a valid date", () => {
      const guarded = dropUnacceptedMilestoneFields({ achievedDate: "2026-03-03" });
      expect(guarded).toEqual({ achievedDate: "2026-03-03" });
    });

    it("keeps an explicit empty string, which is a real clear the preview discloses", () => {
      // ★★★ THE CARVE-OUT. The preview's date rule is
      //  `after !== "" && sanitizeIsoDate(after) !== after`, so `""` sails
      //  through and is shown to the user AS a clear. Guarding it would invert
      //  this defect: the card would promise a clear the write no longer makes.
      const guarded = dropUnacceptedMilestoneFields({ achievedDate: "" });
      expect("achievedDate" in guarded).toBe(true);
      expect(guarded.achievedDate).toBe("");
    });

    for (const { label, value } of [
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "an empty array", value: [] },
    ]) {
      it(`keeps ${label}, which the preview also renders as a clear`, () => {
        // ★★★ FOUND IN COLD REVIEW, AND THE FIRST CUT OF THIS GUARD GOT IT
        //  WRONG. The preview renders a diff's `after` with `str(v)`, which
        //  yields "" for null, undefined and [] as well as for "" — so all four
        //  appear on the card as a DISCLOSED CLEAR. Refusing them here made the
        //  write silently KEEP the stored date against a card promising a clear:
        //  this guard's own defect, pointing the other way.
        //  ★★ `null` is not academic — it is what a model reaches for when it
        //  means "clear this", and `patchWithoutId` forwards it uncoerced.
        //  ★ It also split the apply paths: the inline consumer rebuilds from
        //  `FieldDiff.raw` (the rendered "") and cleared, while the two
        //  replaying consumers resend the raw value and did not — one approved
        //  card, two outcomes.
        const guarded = dropUnacceptedMilestoneFields({ achievedDate: value });
        expect("achievedDate" in guarded).toBe(true);
      });
    }

    it("leaves an untouched patch identical, not merely equal", () => {
      // Copy-on-write, matching the raid and change helpers.
      const patch = { name: "GA 2" };
      expect(dropUnacceptedMilestoneFields(patch)).toBe(patch);
    });
  });

  describe("the guard composed with the real sanitizer", () => {
    for (const { label, value } of REFUSED) {
      it(`preserves the stored achievedDate against ${label}`, () => {
        const merged = applyMilestoneUpdate(BASE, { achievedDate: value });
        expect(merged?.achievedDate).toBe("2026-02-02");
      });

      it(`clears the stored achievedDate against ${label} WITHOUT the guard`, () => {
        // The defect itself, pinned so the guard's value is observable rather
        // than asserted. Remove the guard above and the row loses its date.
        const merged = sanitizeMilestone({ ...BASE, achievedDate: value, id: BASE.id });
        expect(merged?.achievedDate).toBeUndefined();
      });
    }
  });

  describe("description — guarded, with its preview half (§398)", () => {
    it("is cleared by a non-string when the guard does not run", () => {
      // ★★ The defect itself, pinned so the guard's value stays OBSERVABLE
      //  rather than merely asserted. Same drop-key shape as `achievedDate`:
      //  `sanitizeRichText` returns "" for a boolean, so `if (description)`
      //  omits the key and the rebuilt record loses the stored rich text. This
      //  calls the sanitizer DIRECTLY — which is what the merge site would do
      //  if the guard below were removed.
      const merged = sanitizeMilestone({ ...BASE, description: "<p>hi</p>", id: BASE.id });
      expect(merged?.description).toBe("<p>hi</p>");
      const wiped = sanitizeMilestone({ ...BASE, description: true, id: BASE.id });
      expect(wiped?.description).toBeUndefined();
    });

    // ★★★ THROUGH THE REAL COMPOSITION, NEVER THE GUARD ALONE. Asserting on
    //  `dropUnacceptedMilestoneFields({ description: X })` in isolation is what
    //  let a guard that cannot fire in production ship green — see the
    //  `applyMilestoneUpdate` docstring. Every shape below is checked end to
    //  end against a stored value, which is the only claim that matters.
    const STORED = { id: 7, name: "M", date: "2026-01-01", description: "<p>kept</p>" };
    for (const { label, value } of [
      { label: "the boolean true", value: true },
      // ★★ `null` and `[]` are NOT a clear for a rich field, and that is the
      //  opposite of `achievedDate`, where the preview discloses them AS a
      //  clear and `acceptsPatchDate` carves them out to match. Here the
      //  preview REFUSES every non-string, so refusing them on the write side
      //  is what keeps the two in step. `null` is what a model reaches for when
      //  it means "clear this"; the string "" is the path that still works.
      { label: "null", value: null },
      { label: "an empty array", value: [] },
      { label: "the number 42", value: 42 },
    ]) {
      it(`preserves the stored description against ${label}`, () => {
        expect(applyMilestoneUpdate(STORED, { description: value })?.description).toBe("<p>kept</p>");
      });
    }

    it("still stores a real string, and still clears on an explicit empty one", () => {
      // The guard must not turn into a blanket refusal: a genuine edit lands,
      // and `""` — the one clear that IS a string — reaches `if (description)`
      // and omits the key, exactly as the card discloses it.
      expect(applyMilestoneUpdate(STORED, { description: "<p>new</p>" })?.description).toBe("<p>new</p>");
      expect(applyMilestoneUpdate(STORED, { description: "" })?.description).toBeUndefined();
    });

    it("loses the stored description under the ORDERING THIS COMMIT REPLACED", () => {
      // ★★★ THE DEFECT, PINNED AS A POSITIVE OBSERVABLE. Everything above is
      //  asserted through `applyMilestoneUpdate`, which carries the CORRECTED
      //  nesting — so every one of those assertions passed against the broken
      //  production code too, and measurably did (25 passed / 1 failed on the
      //  pre-inversion run; the single failure was the source assertion below).
      //  A behavioural test that composes its own path cannot see the path
      //  production actually has, which is the whole lesson of this fix.
      //
      //  This is the inner ordering the previous commit shipped, spelled out
      //  here and nowhere else. `sanitizeAiRichText(true)` is "", so the guard
      //  sees a string, keeps the key, and `if (description)` then omits it —
      //  the stored rich text is gone. If this assertion ever goes green, the
      //  inner ordering has stopped being harmful and this whole guard needs
      //  re-deriving rather than re-nesting.
      const broken = sanitizeMilestone({
        ...STORED,
        ...dropUnacceptedMilestoneFields(withAiRichFields({ description: true }, AI_RICH_FIELDS.milestone)),
        id: STORED.id,
      });
      expect(broken?.description).toBeUndefined();
    });

    it("leaves the stored description alone when the model omits the key", () => {
      // `withAiRichFields` SKIPS `undefined` rather than blanking it, so an
      // unrelated edit cannot wipe the field. Pinned here because the inversion
      // below moved that step and this is the property it must not disturb.
      expect(applyMilestoneUpdate(STORED, { name: "M2" })?.description).toBe("<p>kept</p>");
    });
  });

  describe("preview and write agree on every NON-STRING shape (§398's actual invariant)", () => {
    // ★★★ THE CLAIM THIS PINS is the one `MILESTONE_FIELD_GUARDS.description`'s
    //  comment USED TO make — "every input lands the same way on both sides",
    //  a sentence deleted in the same commit that added these rows, so do not
    //  go looking for it in `sanitize-records.ts`. It
    //  was written BEFORE it was true: with the guard nested inside
    //  `withAiRichFields` the preview refused `true`/`null`/`[]` while the write
    //  cleared the field, which is the divergence, not the agreement. A comment
    //  asserting a parity nothing measures is worse than no comment, so the
    //  parity is measured here.
    //
    //  ★★ It reads BOTH real implementations — `describeEntityCalls` for the
    //  card and the composed write path above — rather than restating either.
    const STORED_M = { id: 9, name: "M", date: "2026-01-01", description: "<p>kept</p>" };
    const wsM = { tasks: [], raid: [], changes: [], milestones: [STORED_M], stakeholders: [], resources: [] } as unknown as Workspace;

    /** What the CARD promises: the previewed new value, or null for a refusal. */
    function previewed(value: unknown): string | null {
      const plan = describeEntityCalls(
        [{ type: "tool_use", name: "update_milestone", input: { id: 9, description: value } }],
        { descriptor: INLINE_DESCRIPTORS.milestone, item: STORED_M, ws: wsM },
      );
      if (plan.rejected.length) return null;
      const [first] = plan.updates;
      // ★ `raw ?? after` is exactly what `use-inline-entity-edit.ts` puts back
      //  into the write patch, so this reads the value the card would APPLY,
      //  not merely the one it renders. `raw` is optional on `FieldDiff`.
      return first ? first.raw ?? first.after : "<p>kept</p>";
    }

    /** What the WRITE stores, projected to the same shape. */
    function written(value: unknown): string | null {
      const merged = applyMilestoneUpdate(STORED_M, { description: value });
      return merged?.description ?? "";
    }

    for (const { label, value, preview, store } of [
      { label: "the boolean true", value: true, preview: null, store: "<p>kept</p>" },
      { label: "null", value: null, preview: null, store: "<p>kept</p>" },
      { label: "an empty array", value: [], preview: null, store: "<p>kept</p>" },
      { label: "the number 42", value: 42, preview: null, store: "<p>kept</p>" },
      { label: "a real string", value: "<p>new</p>", preview: "<p>new</p>", store: "<p>new</p>" },
      { label: "an explicit empty string", value: "", preview: "", store: "" },
    ] as const) {
      it(`agrees on ${label}`, () => {
        // ★ A REFUSAL and a STORED-UNCHANGED are the same promise seen from the
        //  two sides: the card says "this will not happen", the write leaves the
        //  stored value in place. Both are asserted, so neither can drift alone.
        expect(previewed(value)).toBe(preview);
        expect(written(value)).toBe(store);
        if (preview === null) expect(written(value)).toBe("<p>kept</p>");
        else expect(written(value)).toBe(preview === "" ? "" : preview);
      });
    }

    it("DIVERGES on a string the allow-list reduces to empty — known, open, pre-existing", () => {
      // ★★★ THE EIGHTH SHAPE, AND THE REASON THE HEADING SAYS "NON-STRING".
      //  `stringOnlyFields` asks `typeof v === "string"` and this IS one, so
      //  the card previews it verbatim (milestone's `fieldSanitizers` has no
      //  `description` entry, so `after` is the raw `str(input[f])`). The write
      //  then runs `sanitizeAiRichText`, whose own docstring notes the
      //  allow-list pass can empty a value whose only content was a disallowed
      //  element — so `if (description)` omits the key and the STORED text is
      //  cleared. The card promises the new markup; the write deletes what was
      //  there. That is §398's shape, one input class over.
      //
      //  ★★ PRE-EXISTING AND DELIBERATELY NOT FIXED HERE. Both nestings treat a
      //  string identically, so neither this commit nor its parent caused or
      //  worsened it, and a fix needs the preview to model the allow-list —
      //  which needs a DOM, the reason rich fields have no `fieldSanitizers`
      //  entry in the first place. Filed as a register entry by the lead.
      //  ★★ It is NOT milestone-only: all SEVEN `RICH_FIELDS` members share it,
      //  by the three writer mechanisms listed in `entity-descriptor.ts`.
      //  Characterized rather than asserted, so the claim above is measured and
      //  so a future fix turns this red instead of passing silently.
      // ★★★ THE PROBE MUST OPEN WITH AN ALLOWED TAG, and the obvious one does
      //  NOT work — measured, not reasoned. A bare `"<script>x</script>"` is
      //  classified as PLAIN TEXT by the per-sink `isHtmlStart` rule and comes
      //  out ESCAPED as `<p>&lt;script&gt;x&lt;/script&gt;</p>`, i.e. stored
      //  rather than emptied. That is a divergence too (the card previews the
      //  raw string, the write stores escaped markup) but it is NOT this one.
      //  `sanitizeAiRichText`'s own docstring names the shape that empties:
      //  a value "whose only content was a disallowed element".
      const probe = "<p><script>x</script></p>";
      expect(previewed(probe)).toBe(probe);
      expect(written(probe)).toBe("");
    });
  });

  describe("the merge site's own nesting", () => {
    it("nests the guard OUTSIDE withAiRichFields at all three call sites", () => {
      // ★★★ THE ORDER IS THE WHOLE GUARD, and no behavioural test in this file
      //  can see it — `applyMilestoneUpdate` is a MIRROR of the call site, so
      //  re-nesting the real one leaves every assertion above green. That is
      //  not hypothetical: the previous commit shipped the inner ordering, and
      //  its test suite was green.
      //
      //  `withAiRichFields` runs `sanitizeAiRichText`, which returns "" for any
      //  non-string. Run INSIDE the guard it destroys the distinction the guard
      //  tests, so `typeof v === "string"` is unconditionally true and the guard
      //  is dead code. The guard must see the RAW model value — the same rule
      //  Task 6 established for the preview, for the same reason.
      //
      //  ★ Raid and change are asserted too even though neither guard table
      //  names a rich field TODAY, so nothing there depends on the order yet.
      //  That is exactly why they are worth pinning: the trap is armed for
      //  whoever adds one, and it is invisible until they do.
      const src = readFileSync("src/app/use-register-tools.ts", "utf8");
      const outer = src.match(/withAiRichFields\(\s*dropUnaccepted/g) ?? [];
      const inner = src.match(/dropUnaccepted\w+Fields\(\s*withAiRichFields/g) ?? [];
      // ★ Assert the POSITIVE count as well as the absence: a renamed helper
      //  would make both patterns match zero and the "no inner nesting" half
      //  would pass vacuously.
      expect(outer).toHaveLength(3);
      expect(inner).toHaveLength(0);
    });
  });
});
