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

  describe("description — measured, deliberately NOT guarded", () => {
    it("is cleared by a non-string, exactly like achievedDate", () => {
      // ★★ This is the same drop-key shape: `sanitizeRichText` returns "" for a
      //  boolean, so `if (description)` omits the key and the stored rich text
      //  is lost. It is NOT in the guard table, and that is a decision, not an
      //  oversight — see the sibling assertion below.
      const merged = sanitizeMilestone({ ...BASE, description: "<p>hi</p>", id: BASE.id });
      expect(merged?.description).toBe("<p>hi</p>");
      const wiped = sanitizeMilestone({ ...BASE, description: true, id: BASE.id });
      expect(wiped?.description).toBeUndefined();
    });

    it("is left alone by the guard, so the preview and the write cannot disagree", () => {
      // ★★★ WHY NOT GUARDED: `description` is a RICH field, and the preview
      //  does not refuse a non-string for it — it projects one. Guarding here
      //  would make the write keep a value the card says is changing, which is
      //  this slice's own defect pointing the other way. Closing it needs a
      //  coordinated change on BOTH sides and is filed, not patched.
      const guarded = dropUnacceptedMilestoneFields({ description: true });
      expect("description" in guarded).toBe(true);
    });
  });
});
