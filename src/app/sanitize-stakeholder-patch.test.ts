// src/app/sanitize-stakeholder-patch.test.ts
//
// ★★★ THE FOURTH MERGE-SITE GUARD, AND THE ONE NO GATE ASKED FOR.
//
// The other three (raid, change, milestone) were each reported by
// `plan.sanitizer-parity.test.ts` once its rejects direction stopped being
// swallowed. Stakeholder was NOT — because `sanitizeStakeholder` RESETS an
// unrecognised `category`/`influence`/`interest` to a hardcoded fallback, and
// that sweep's `STK_BASE` fixture happens to hold exactly those fallbacks. Every
// refused value therefore read back as the value already stored, and the sweep
// recorded agreement. A review probe that moved the fixture off its defaults
// measured 27 mismatch pairs.
//
// ★★ So the fixtures below are deliberately NON-DEFAULT. A test for this defect
// written against a row that already holds the fallback cannot fail, which is
// the whole reason the defect survived four earlier tasks.
//
// The user-visible shape: a stakeholder stored as "Sponsor" whose patch carries
// an unrecognised category is silently demoted to "Other". The preview refuses
// the value, so the card shows nothing about category at all, and the two
// REPLAYING consumers resend the original input regardless.
import { describe, it, expect } from "vitest";
import { dropUnacceptedStakeholderFields, sanitizeStakeholder } from "./sanitize";

/** ★ Every enum here is OFF its sanitizer's fallback ("Other"/"Medium"). */
const BASE = {
  id: 3,
  name: "Ada Lovelace",
  category: "Sponsor",
  influence: "High",
  interest: "Low",
  raci: {},
};

const REFUSED = [
  { label: "an unrecognised string", value: "Kategorie" },
  { label: "the boolean true", value: true },
  { label: "the number 42", value: 42 },
  { label: "an empty string", value: "" },
];

const GUARDED = ["category", "influence", "interest"] as const;

describe("dropUnacceptedStakeholderFields", () => {
  for (const field of GUARDED) {
    describe(field, () => {
      for (const { label, value } of REFUSED) {
        it(`drops ${label} rather than letting the rebuild reset the stored value`, () => {
          // ★ Key ABSENCE via `in`: vitest's toEqual ignores undefined-valued
          //  properties, so an object comparison passes against a guard that
          //  merely sets the key to undefined.
          expect(field in dropUnacceptedStakeholderFields({ [field]: value })).toBe(false);
        });

        it(`preserves the stored value against ${label}, composed with the real sanitizer`, () => {
          const merged = sanitizeStakeholder({
            ...BASE,
            ...dropUnacceptedStakeholderFields({ [field]: value }),
            id: BASE.id,
          });
          expect(merged?.[field]).toBe(BASE[field]);
        });

        it(`RESETS the stored value against ${label} WITHOUT the guard`, () => {
          // The defect itself, pinned so the guard's value is observable rather
          // than asserted. This is what the sweep could not see.
          const merged = sanitizeStakeholder({ ...BASE, [field]: value, id: BASE.id });
          expect(merged?.[field]).not.toBe(BASE[field]);
        });
      }

      it("keeps a valid value", () => {
        const kept = field === "category" ? "Vendor" : "Medium";
        expect(dropUnacceptedStakeholderFields({ [field]: kept })).toEqual({ [field]: kept });
      });
    });
  }

  it("leaves an untouched patch identical, not merely equal", () => {
    const patch = { name: "Ada L." };
    expect(dropUnacceptedStakeholderFields(patch)).toBe(patch);
  });

  describe("what is deliberately NOT guarded", () => {
    it("leaves `name` alone — the sanitizer returns null and the writer throws", () => {
      // A refusal the user SEES beats a silent partial write, so this stays a
      // throw rather than becoming a dropped key.
      expect("name" in dropUnacceptedStakeholderFields({ name: "" })).toBe(true);
      expect(sanitizeStakeholder({ ...BASE, name: "", id: BASE.id })).toBeNull();
    });

    it("leaves the drop-key TEXT fields alone, because the preview shows their clear", () => {
      // `organization`/`title`/`email`/`notes` are omitted when `sanitizeText`
      // blanks them — but the preview renders that same blank, so the card and
      // the write already agree. Guarding them would make the card promise a
      // clear the write stops performing: this slice's defect, inverted.
      const guarded = dropUnacceptedStakeholderFields({ organization: "", title: 42, notes: null });
      expect(Object.keys(guarded).sort()).toEqual(["notes", "organization", "title"]);
    });
  });
});
