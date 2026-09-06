// src/app/sanitize-raid-patch.test.ts — the MERGE-SITE guard that stops an
// AI-supplied value the RAID sanitizer refuses from CLEARING a populated field.
//
// ★★★ THE DEFECT THIS PINS. `sanitizeRaidItem` REBUILDS a whole record, so a
// value it refuses is not "left alone": the key is DROPPED (`severity`,
// `probability`, `impact`, `targetDate`, `closedDate`), written as `""`
// (`raisedDate`), or reset to a HARDCODED DEFAULT (`category`, and `status`
// with it). `updateRaid` (`use-register-tools.ts`) hands it a merged
// `{...stored, ...patch}`, so a refused patch value wipes the STORED one —
// while the AI edit preview refuses that same value and shows the field as
// unchanged. The card says "unchanged"; the write wipes it.
//
// ★★ FIXED AT THE MERGE SITE, NEVER IN THE SANITIZER. That sanitizer also runs
// on JSON load, CSV decode, template apply and AI proposal, where there is no
// prior value to preserve and a hardcoded fallback is the right answer.
// `sanitize-raid.test.ts` pins that behaviour and is deliberately untouched —
// every "before" assertion below is the sanitizer's UNGUARDED output, so this
// file also documents what the guard is protecting against rather than merely
// asserting an absence.
//
// ★ Mirrors `applyModelChangeStatus` (`change-log.ts`), which does exactly this
// for `change.status` alone and whose docstring carries the reasoning.
import { describe, expect, it } from "vitest";
import { dropUnacceptedRaidFields, sanitizeRaidItem } from "./sanitize";
import { type RaidItem } from "./types";

/** A fully populated stored row: every guarded field carries a NON-DEFAULT
 *  value, so a reset-to-default is observable rather than indistinguishable
 *  from a preserved value. (`category: "A"` is not `RAID_CATEGORIES[0]`, and
 *  `status: "Validated"` is not `ASSUMPTION_STATUSES[0]`.) */
function storedRaid(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 7,
    category: "A",
    title: "Vendor availability",
    status: "Validated",
    raisedDate: "2026-01-02",
    targetDate: "2026-03-04",
    closedDate: "2026-05-06",
    severity: "High",
    probability: 3,
    impact: 4,
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

/** The merge `updateRaid` performs, minus the parts irrelevant here (the rich
 *  fields, the id restamp, `localModifiedAt`). Composed from the REAL guard and
 *  the REAL sanitizer — a hand-rolled mirror of either would only re-assert the
 *  reading of the code the guard already encodes. */
function mergeGuarded(stored: RaidItem, patch: Record<string, unknown>): RaidItem {
  const out = sanitizeRaidItem({ ...stored, ...dropUnacceptedRaidFields(patch, stored) });
  if (!out) throw new Error("the guarded merge was rejected outright");
  return out;
}

/** The merge as it was BEFORE the guard — the defect itself, kept so every
 *  assertion below has a positive observable to move away from. */
function mergeUnguarded(stored: RaidItem, patch: Record<string, unknown>): RaidItem {
  const out = sanitizeRaidItem({ ...stored, ...patch });
  if (!out) throw new Error("the unguarded merge was rejected outright");
  return out;
}

describe("dropUnacceptedRaidFields", () => {
  it("keeps every value the sanitizer accepts", () => {
    const patch = {
      category: "I",
      status: "Resolved",
      severity: "Critical",
      probability: 5,
      impact: 1,
      raisedDate: "2026-02-02",
      targetDate: "2026-02-03",
      closedDate: "2026-02-04",
    };
    expect(dropUnacceptedRaidFields(patch, storedRaid())).toEqual(patch);
  });

  it("returns the patch object itself when nothing is dropped", () => {
    // Copy-on-write, like `withAiRichFields` — the common case allocates
    // nothing, and a returned COPY would silently defeat any identity check a
    // caller makes.
    const patch = { title: "untouched by any guard" };
    expect(dropUnacceptedRaidFields(patch, storedRaid())).toBe(patch);
  });

  it("leaves unguarded fields alone, whatever they hold", () => {
    const patch = { title: "", owner: 42, linkedTaskIds: "nope" };
    expect(dropUnacceptedRaidFields(patch, storedRaid())).toEqual(patch);
  });

  it.each([
    ["severity", "Sehr hoch"],
    ["probability", 9],
    ["impact", 0],
    ["raisedDate", "02/01/2026"],
    ["targetDate", "not a date"],
    ["closedDate", "2026/05/06"],
    ["category", "Z"],
    ["status", "Bogus"],
  ])("drops %s when the sanitizer would not accept it", (field, value) => {
    expect(dropUnacceptedRaidFields({ [field]: value }, storedRaid())).toEqual({});
  });

  it("drops an explicitly undefined value rather than merging it over the stored one", () => {
    // Spreading `{severity: undefined}` over the stored row would make the
    // sanitizer drop the key, i.e. clear the field — the same wipe by another
    // route.
    // ★ `in`, never `toEqual({})`: vitest's `toEqual` IGNORES undefined-valued
    // properties, so the obvious spelling passes with the guard deleted.
    expect("severity" in dropUnacceptedRaidFields({ severity: undefined }, storedRaid()))
      .toBe(false);
    expect(mergeGuarded(storedRaid(), { severity: undefined }).severity).toBe("High");
  });
});

describe("dates: an explicit empty string is a real clear", () => {
  it.each(["raisedDate", "targetDate", "closedDate"])(
    "keeps %s = \"\" so a disclosed clear still lands",
    (field) => {
      // The preview's date guard is `after !== "" && sanitizeIsoDate(after) !==
      // after`, so `""` sails through it and IS shown to the user as a clear.
      // Guarding it here would make the card promise a clear the write refused
      // — the same disagreement, in the other direction.
      expect(dropUnacceptedRaidFields({ [field]: "" }, storedRaid())).toEqual({ [field]: "" });
      expect(mergeGuarded(storedRaid(), { [field]: "" })[field as keyof RaidItem]).toBeFalsy();
    },
  );
});

describe("a refused value leaves the stored field alone", () => {
  it.each([
    ["severity", "Sehr hoch", "High"],
    ["probability", 9, 3],
    ["impact", 0, 4],
    ["raisedDate", "02/01/2026", "2026-01-02"],
    ["targetDate", "not a date", "2026-03-04"],
    ["closedDate", "2026/05/06", "2026-05-06"],
  ])("%s survives a refused %s", (field, value, kept) => {
    const stored = storedRaid();
    const key = field as keyof RaidItem;
    // The defect, asserted first: without the guard the field is gone.
    expect(mergeUnguarded(stored, { [field]: value })[key]).not.toBe(kept);
    expect(mergeGuarded(stored, { [field]: value })[key]).toBe(kept);
  });
});

describe("category and status are coupled through statusSetForCategory", () => {
  it("a refused category moves the STATUS too, unguarded", () => {
    // `sanitizeRaidItem` falls back to "R", and "Validated" is not a RISK
    // status, so the status falls back with it — two fields wiped by one
    // refused value, neither of them disclosed by the card.
    const before = mergeUnguarded(storedRaid(), { category: "Z" });
    expect(before.category).toBe("R");
    expect(before.status).toBe("Open");
  });

  it("the guard keeps both halves of the pair", () => {
    const after = mergeGuarded(storedRaid(), { category: "Z" });
    expect(after.category).toBe("A");
    expect(after.status).toBe("Validated");
  });

  it("validates a patch status against the patch's OWN category when both move", () => {
    // "Resolved" is an ISSUE status and not an assumption one, so the guard
    // must read the INCOMING category, not the stored "A".
    expect(dropUnacceptedRaidFields({ category: "I", status: "Resolved" }, storedRaid()))
      .toEqual({ category: "I", status: "Resolved" });
    const after = mergeGuarded(storedRaid(), { category: "I", status: "Resolved" });
    expect(after.category).toBe("I");
    expect(after.status).toBe("Resolved");
  });

  it("validates a patch status against the STORED category when the patch's is refused", () => {
    // The refused category is dropped, so the effective category is the stored
    // "A" — and "Resolved" is not an assumption status.
    expect(dropUnacceptedRaidFields({ category: "Z", status: "Resolved" }, storedRaid()))
      .toEqual({});
    expect(mergeGuarded(storedRaid(), { category: "Z", status: "Resolved" }).status)
      .toBe("Validated");
  });

  it("cannot save a stored status the NEW category does not have, and does not pretend to", () => {
    // ★ The honest limit of a per-field guard: an ACCEPTED category change
    // narrows the status set, and the sanitizer's fallback then applies to a
    // status the patch never mentioned. There is no prior value to keep here —
    // "Validated" is not a valid ISSUE status — so the reset is correct.
    expect(mergeGuarded(storedRaid(), { category: "I" }).status).toBe("Open");
  });
});

describe("numeric coercion matches the sanitizer's own", () => {
  it("accepts a numeric STRING, as toNumber does", () => {
    expect(mergeGuarded(storedRaid(), { probability: "5" }).probability).toBe(5);
  });

  it("still accepts the boolean true as 1 — toNumber(true) is 1", () => {
    // ★★ NOT A REGRESSION AND NOT A FIX: the guard reuses `toNumber`, which is
    // what the sanitizer AND the preview's numeric coercion both use, so
    // `probability: true` goes on storing a fabricated score of 1 exactly as
    // before. A stricter `typeof === "number"` rule here would refuse a value
    // the preview accepts and shows as "1" — the SAME disagreement this file
    // exists to close, pointing the other way. Pinned so the trade is a
    // decision rather than an accident.
    expect(mergeGuarded(storedRaid(), { probability: true }).probability).toBe(1);
    expect(mergeUnguarded(storedRaid(), { probability: true }).probability).toBe(1);
  });

  it("refuses the boolean false — toNumber(false) is 0, out of the [1,5] range", () => {
    expect(mergeGuarded(storedRaid(), { impact: false }).impact).toBe(4);
  });
});
