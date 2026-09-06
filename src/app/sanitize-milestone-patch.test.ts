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
import { describe, it, expect } from "vitest";
import { dropUnacceptedMilestoneFields, sanitizeMilestone } from "./sanitize";

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
        const merged = sanitizeMilestone({
          ...BASE,
          ...dropUnacceptedMilestoneFields({ achievedDate: value }),
          id: BASE.id,
        });
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

    it("leaves a stored description alone when the patch value is not a string", () => {
      // ★★★ THIS LANDED WITH ITS PREVIEW HALF, NEVER ALONE. Guarding here while
      //  the card still PROJECTED a non-string would make the write keep a value
      //  the card said was changing — this slice's own defect, pointing the other
      //  way. `plan.test.ts`'s "refuses a non-string description instead of
      //  projecting one" is the other half; deleting either re-opens §398.
      const stored = { id: 1, name: "M", date: "2026-01-01", description: "<p>kept</p>" };
      const patch = dropUnacceptedMilestoneFields({ description: true });
      expect("description" in patch).toBe(false);
      const merged = sanitizeMilestone({ ...stored, ...patch });
      expect(merged!.description).toBe("<p>kept</p>");
    });
  });
});
