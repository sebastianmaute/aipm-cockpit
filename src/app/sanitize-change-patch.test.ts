// src/app/sanitize-change-patch.test.ts — the MERGE-SITE guard that stops an
// AI-supplied value the CHANGE sanitizer refuses from CLEARING a populated
// field. The sibling of `sanitize-raid-patch.test.ts`, one register over.
//
// ★★★ THE DEFECT THIS PINS. `sanitizeChangeItem` REBUILDS a whole record, so a
// value it refuses is not "left alone": the key is DROPPED (`impact`,
// `decisionDate`, `scheduleImpactDays`, `costImpact`), written as `""`
// (`raisedDate`), or reset to a HARDCODED DEFAULT (`type` -> "Other").
// `updateChange` (`use-register-tools.ts`) hands it a merged
// `{...stored, ...patch}`, so a refused patch value wipes the STORED one —
// while the AI edit preview refuses that same value and shows the field as
// unchanged. The card says "unchanged"; the write wipes it.
//
// ★★ FIXED AT THE MERGE SITE, NEVER IN THE SANITIZER. That sanitizer also runs
// on JSON load, CSV decode, template apply and AI proposal, where there is no
// prior value to preserve and a hardcoded fallback is the right answer.
// `sanitize-change.test.ts` pins that behaviour and is deliberately untouched —
// every "before" assertion below is the sanitizer's UNGUARDED output, so this
// file also documents what the guard is protecting against rather than merely
// asserting an absence.
//
// ★★★ `status` IS DELIBERATELY NOT GUARDED HERE, and that is the one structural
// difference from the raid guard. `updateChange` already runs
// `applyModelChangeStatus` (`change-log.ts`) AFTER the sanitizer: an
// unrecognised status is ignored and the STORED one restored, and a recognised
// one is routed through `applyChangeStatus` so the coupled `decisionDate` moves
// with it. Routing `status` through the patch guard too would be double
// handling — and worse than redundant, because dropping the key would deny
// `applyModelChangeStatus` the RAW value it gates on. The boundary is asserted
// below rather than left to a comment.
import { describe, expect, it } from "vitest";
import { applyModelChangeStatus } from "./change-log";
import { INLINE_DESCRIPTORS } from "./inline-ai-edit/entity-descriptor";
import { dropUnacceptedChangeFields, sanitizeChangeItem } from "./sanitize";
import { type ChangeItem } from "./types";

/** A fully populated stored row: every guarded field carries a NON-DEFAULT
 *  value, so a reset-to-default is observable rather than indistinguishable
 *  from a preserved value. (`type: "Scope"` is not the sanitizer's "Other"
 *  fallback, and `status: "Approved"` is not its "Proposed" one.) */
function storedChange(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 7,
    title: "Move the cutover window",
    description: "",
    type: "Scope",
    status: "Approved",
    impact: "High",
    scheduleImpactDays: 12,
    costImpact: 4500,
    requestedBy: "Ann",
    raisedDate: "2026-01-02",
    decisionBy: "Bob",
    decisionDate: "2026-03-04",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...over,
  };
}

/** The merge `updateChange` performs, minus the parts irrelevant here (the rich
 *  fields, the id restamp, `localModifiedAt`, the note-log re-apply). Composed
 *  from the REAL guard and the REAL sanitizer — a hand-rolled mirror of either
 *  would only re-assert the reading of the code the guard already encodes. */
function mergeGuarded(stored: ChangeItem, patch: Record<string, unknown>): ChangeItem {
  const out = sanitizeChangeItem({ ...stored, ...dropUnacceptedChangeFields(patch) });
  if (!out) throw new Error("the guarded merge was rejected outright");
  return out;
}

/** The merge as it was BEFORE the guard — the defect itself, kept so every
 *  assertion below has a positive observable to move away from. */
function mergeUnguarded(stored: ChangeItem, patch: Record<string, unknown>): ChangeItem {
  const out = sanitizeChangeItem({ ...stored, ...patch });
  if (!out) throw new Error("the unguarded merge was rejected outright");
  return out;
}

/** The FULL `updateChange` shape: the guarded merge followed by the real
 *  `applyModelChangeStatus`, which owns `status` and the `decisionDate`
 *  transition. Used only where the boundary between the two is what is under
 *  test. */
function mergeWithStatus(
  stored: ChangeItem,
  patch: Record<string, unknown>,
  today = "2026-09-05",
): ChangeItem {
  return applyModelChangeStatus(mergeGuarded(stored, patch), patch.status, stored.status, today);
}

describe("dropUnacceptedChangeFields", () => {
  it("keeps every value the sanitizer accepts", () => {
    const patch = {
      type: "Cost",
      impact: "Critical",
      raisedDate: "2026-02-02",
      decisionDate: "2026-02-03",
      scheduleImpactDays: 3,
      costImpact: 0,
    };
    expect(dropUnacceptedChangeFields(patch)).toEqual(patch);
  });

  it("returns the patch object itself when nothing is dropped", () => {
    // Copy-on-write, like `withAiRichFields` — the common case allocates
    // nothing, and a returned COPY would silently defeat any identity check a
    // caller makes.
    const patch = { title: "untouched by any guard" };
    expect(dropUnacceptedChangeFields(patch)).toBe(patch);
  });

  it("leaves unguarded fields alone, whatever they hold", () => {
    const patch = { title: "", requestedBy: 42, linkedTaskIds: "nope" };
    expect(dropUnacceptedChangeFields(patch)).toEqual(patch);
  });

  it.each([
    ["type", "Umfang"],
    ["impact", "Sehr hoch"],
    ["raisedDate", "02/01/2026"],
    ["decisionDate", "not a date"],
    ["scheduleImpactDays", "soon"],
    ["costImpact", -1],
  ])("drops %s when the sanitizer would not accept it", (field, value) => {
    expect(dropUnacceptedChangeFields({ [field]: value })).toEqual({});
  });

  it("drops an explicitly undefined value rather than merging it over the stored one", () => {
    // Spreading `{impact: undefined}` over the stored row would make the
    // sanitizer drop the key, i.e. clear the field — the same wipe by another
    // route.
    // ★ `in`, never `toEqual({})`: vitest's `toEqual` IGNORES undefined-valued
    // properties, so the obvious spelling passes with the guard deleted.
    expect("impact" in dropUnacceptedChangeFields({ impact: undefined })).toBe(false);
    expect(mergeGuarded(storedChange(), { impact: undefined }).impact).toBe("High");
  });
});

describe("dates: an explicit empty string is a real clear", () => {
  it.each(["raisedDate", "decisionDate"])(
    "keeps %s = \"\" so a disclosed clear still lands",
    (field) => {
      // The preview's date guard is `after !== "" && sanitizeIsoDate(after) !==
      // after`, so `""` sails through it and IS shown to the user as a clear.
      // Guarding it here would make the card promise a clear the write refused
      // — the same disagreement, in the other direction.
      expect(dropUnacceptedChangeFields({ [field]: "" })).toEqual({ [field]: "" });
      expect(mergeGuarded(storedChange(), { [field]: "" })[field as keyof ChangeItem]).toBeFalsy();
    },
  );
});

describe("a refused value leaves the stored field alone", () => {
  it.each([
    // ★ `type` is the RESET shape: the sanitizer's fallback is the hardcoded
    // "Other", so the fixture's "Scope" is what a refused value destroys. A
    // fixture already holding "Other" — which is what the parity sweep's
    // CHANGE_BASE holds — cannot observe this at all.
    ["type", "Umfang", "Scope"],
    ["impact", "Sehr hoch", "High"],
    ["raisedDate", "02/01/2026", "2026-01-02"],
    // ★ `decisionDate` is the DROP shape and is likewise invisible to any
    // fixture that leaves it blank.
    ["decisionDate", "not a date", "2026-03-04"],
    ["scheduleImpactDays", "soon", 12],
    ["costImpact", -1, 4500],
  ])("%s survives a refused value", (field, value, kept) => {
    const stored = storedChange();
    const key = field as keyof ChangeItem;
    // The defect, asserted first: without the guard the field is gone.
    expect(mergeUnguarded(stored, { [field]: value })[key]).not.toBe(kept);
    expect(mergeGuarded(stored, { [field]: value })[key]).toBe(kept);
  });
});

describe("status stays with applyModelChangeStatus", () => {
  it("is NOT dropped by the patch guard — that would deny the transition its RAW value", () => {
    // `applyModelChangeStatus` gates on the MODEL's raw field, so a guard that
    // removed the key would turn a recognised status into "the model said
    // nothing" and skip the `decisionDate` transition with it.
    expect(dropUnacceptedChangeFields({ status: "Bogus" })).toEqual({ status: "Bogus" });
    expect(dropUnacceptedChangeFields({ status: "Implemented" })).toEqual({ status: "Implemented" });
  });

  it("keeps the stored status when the model's is unrecognised", () => {
    // The sanitizer alone demotes it to "Proposed"; the real path does not.
    expect(mergeGuarded(storedChange(), { status: "Bogus" }).status).toBe("Proposed");
    expect(mergeWithStatus(storedChange(), { status: "Bogus" }).status).toBe("Approved");
  });

  it("still transitions on a recognised status, stamping the decision date", () => {
    const stored = storedChange({ status: "Proposed", decisionDate: undefined });
    expect(mergeWithStatus(stored, { status: "Implemented" }).decisionDate).toBe("2026-09-05");
  });

  it("does not let a refused decisionDate reach that transition as a blank", () => {
    // Both halves at once: the guard keeps the stored date on the merged row,
    // and `applyChangeStatus`'s `?? today` therefore never fires. Unguarded,
    // the merged row lost the key and the transition invented today's date.
    const stored = storedChange({ status: "Approved" });
    expect(mergeWithStatus(stored, { decisionDate: "not a date", status: "Implemented" }).decisionDate)
      .toBe("2026-03-04");
    expect(
      applyModelChangeStatus(
        mergeUnguarded(stored, { decisionDate: "not a date", status: "Implemented" }),
        "Implemented",
        stored.status,
        "2026-09-05",
      ).decisionDate,
    ).toBe("2026-09-05");
  });

  it("still clears the date when the model sends the row back to pending", () => {
    // ★ The honest limit, and it is `applyChangeStatus`'s designed behaviour
    // rather than a gap in the guard: a status the model DID send moves the
    // coupled date, and the card discloses the status line that caused it.
    expect(mergeWithStatus(storedChange(), { status: "Under Review" }).decisionDate)
      .toBeUndefined();
  });
});

describe("numeric coercion matches the sanitizer's own", () => {
  it("accepts a numeric STRING, as toNumber does", () => {
    expect(mergeGuarded(storedChange(), { costImpact: "250" }).costImpact).toBe(250);
  });

  it("refuses the booleans rather than storing a fabricated 1 or 0", () => {
    // ★★★ THIS PINNED THE OPPOSITE VERDICT AND CALLED IT A DELIBERATE TRADE.
    // The old comment read "NOT A REGRESSION AND NOT A FIX: the guard reuses
    // `toNumber` … so `scheduleImpactDays: true` goes on storing a fabricated 1
    // exactly as before — and `false` a 0, which the `[0, ∞)` range admits",
    // and argued a stricter rule would refuse a value the preview accepts. It
    // was the TWIN of the justification `acceptsRiskScale` carried, which §395
    // overturned two files away; only the raid half was closed, so this one was
    // left reading as a settled decision when it was an unclosed half. §399
    // closes it: both change amounts now reject a boolean through the SHARED
    // `isCoercibleNumber`, and the preview follows because it calls the same
    // predicate — so there is no disagreement to trade against.
    //
    // ★ The range wording had rotted too: there is no `[0, ∞)` range any more.
    // §395 replaced the preview's `[min, max]` tuple with `numericFields`, so
    // the rule lives inside `acceptsScheduleDays`/`acceptsCostAmount` and
    // nothing states a range at all.
    //
    // A refused key leaves the STORED value alone — that is what the merge-site
    // guard buys, and it is why the assertions below read the stored numbers.
    expect(mergeGuarded(storedChange(), { scheduleImpactDays: true }).scheduleImpactDays)
      .toBe(storedChange().scheduleImpactDays);
    expect(mergeGuarded(storedChange(), { costImpact: false }).costImpact)
      .toBe(storedChange().costImpact);
    // ★ The UNGUARDED merge is the control: without the guard the sanitizer
    // rebuilds the record from the raw blob and the boolean is simply dropped,
    // which is a different outcome from "the stored value survives".
    expect("scheduleImpactDays" in mergeUnguarded(storedChange(), { scheduleImpactDays: true })).toBe(false);
  });

  it("refuses a NON-INTEGER day count, and the preview agrees", () => {
    // ★★★ THE VERDICT HERE IS INVERTED FROM WHAT THIS TEST USED TO PIN, and the
    // old name ("accepts a NON-INTEGER, and the preview now agrees") went with
    // it. §395 closed the days divergence at the LOOSE end — it made the
    // preview accept 1.5, matching a writer that already did. §399 closes it at
    // the TIGHT end instead: `change-edit-modal.tsx` clamps this field with
    // `describeClamp(value, { min: 0, round: 0 })`, so the form cannot produce
    // a fraction and the writer had no business storing one. Both sides still
    // agree, because the preview calls `acceptsScheduleDays` rather than
    // restating it — which is exactly why reversing the rule moved both at once.
    expect("scheduleImpactDays" in mergeGuarded(storedChange(), { scheduleImpactDays: 1.5 })).toBe(true);
    expect(mergeGuarded(storedChange(), { scheduleImpactDays: 1.5 }).scheduleImpactDays)
      .toBe(storedChange().scheduleImpactDays);
    expect(INLINE_DESCRIPTORS.change.numericFields.scheduleImpactDays(1.5)).toBe(false);
    // ★ `costImpact` moves the OTHER way in the same commit: two decimals are
    // what `{ round: 2 }` produces, so money keeps a precision days lose.
    expect(INLINE_DESCRIPTORS.change.numericFields.costImpact(1500.55)).toBe(true);
  });
});
