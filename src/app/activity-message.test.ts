import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_KIND_TO_KEY } from "./activity-log";
import {
  ACTIVITY_PLURAL_KINDS,
  activityMessage,
  activityPluralBase,
} from "./activity-message";
import { loadI18n } from "./i18n";

describe("activityMessage", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  /**
   * ★★★ THE DRIFT PIN. `ACTIVITY_PLURAL` restates the base key that
   * `ACTIVITY_KIND_TO_KEY` already maps the kind to, because typing it
   * `PluralBaseKey` is what makes an unpaired key a tsc error — a Record of
   * slot numbers alone could not. The cost of that duplication is exactly this
   * failure mode: the two tables disagreeing, and the renderer then pluralising
   * a key the entry does not use. Nothing else in the repo compares them.
   */
  it("keeps every plural base in step with the kind→key map", () => {
    // ★★ EXACT, not `> 0`, and the loose form is what this replaced. The
    // anti-vacuity floor is the guard meant to notice a DELETED row, and at
    // `> 0` it stays green with one member left — so it did not do the one job
    // it was there for. Measured 2026-09-08: two members. Bump this
    // deliberately when a third kind is added, which is the point.
    expect(ACTIVITY_PLURAL_KINDS.length).toBe(2);
    for (const kind of ACTIVITY_PLURAL_KINDS) {
      expect(activityPluralBase(kind)).toBe(ACTIVITY_KIND_TO_KEY[kind]);
    }
  });

  /**
   * ★★★ THE COMPLETENESS PIN, AND IT GUARDS THE ONLY DIRECTION LEFT OPEN.
   * The drift pin above compares the members that are PRESENT; a kind whose
   * key gains a `…One` sibling and never gets an `ACTIVITY_PLURAL` row is
   * invisible to it, and that omission IS the original defect — the renderer
   * silently keeps calling `t()` and emits "1 allocation cells" again.
   *
   * ★★ The i18n-plural scan is NOT a substitute, and reading it as one is the
   * trap. It would fire (the new base key sits as a bare literal in
   * `activity-log.ts`'s Record, so it lands in `bareOffenders`), but its own
   * failure message offers "convert it, OR add `key@file` to EXCEPTIONS with
   * the reason", modelling exactly the resolution that leaves the defect in
   * place. A developer following that message can turn the gate green without
   * touching `ACTIVITY_PLURAL`. This test is the one that cannot be satisfied
   * that way.
   *
   * ★ Reads the dictionary from SOURCE rather than importing it, because the
   * EN key set is a compile-time type (`keyof typeof enUS`) with no runtime
   * export. The key half of a line is never wrapped, so a `^  key:` anchor is
   * safe here — unlike a VALUE scan, where ~200 EN values wrap onto the next
   * line and an anchored grep undercounts by 24% (§450).
   */
  it("routes every map-reachable key that HAS a singular sibling through ACTIVITY_PLURAL", () => {
    const src = readFileSync("src/app/i18n.ts", "utf8");
    const keys = new Set([...src.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
    // Cross-check the scan itself: the sibling suite measures the same
    // population independently and quotes 42. A scan that reads nothing would
    // make this whole test vacuous.
    const paired = [...keys].filter((k) => !k.endsWith("One") && keys.has(`${k}One`));
    expect(paired.length).toBeGreaterThanOrEqual(40);

    const missing = Object.entries(ACTIVITY_KIND_TO_KEY)
      .filter(([kind, key]) => keys.has(`${key}One`) && !ACTIVITY_PLURAL_KINDS.includes(kind as never))
      .map(([kind, key]) => `${kind} → ${key} (has ${key}One)`);
    expect(missing, `add an ACTIVITY_PLURAL row for: ${missing.join(", ")}`).toEqual([]);
  });

  it("selects the singular at a count of one and the plural elsewhere", () => {
    expect(activityMessage("en-US", "ai.allocationPlan", [1])).toBe("AI planned 1 allocation cell");
    expect(activityMessage("en-US", "ai.allocationPlan", [2])).toBe(
      "AI planned 2 allocation cells",
    );
    // ★ Zero is a real count and takes the PLURAL in both supported languages —
    //   the reason the finite-check below cannot be a truthiness test.
    expect(activityMessage("en-US", "ai.allocationPlan", [0])).toBe(
      "AI planned 0 allocation cells",
    );
  });

  /**
   * ★ The panel stringifies through `changeText` before calling this, so the
   * count reaches it as `"1"`, not `1`. Both spellings must select the same
   * form or the two renderers disagree on the same entry.
   */
  it("selects on a stringified count exactly as on a numeric one", () => {
    expect(activityMessage("en-US", "ai.raciSuggest", ["1"])).toBe(
      "Applied 1 AI-proposed RACI assignment",
    );
    expect(activityMessage("en-US", "ai.raciSuggest", ["4"])).toBe(
      "Applied 4 AI-proposed RACI assignments",
    );
  });

  it("agrees the German forms too", () => {
    expect(activityMessage("de", "ai.allocationPlan", [1])).toBe("KI hat 1 Planungszelle geplant");
    expect(activityMessage("de", "ai.allocationPlan", [3])).toBe("KI hat 3 Planungszellen geplant");
  });

  /**
   * A count that is not a number must not throw and must not render
   * singular text.
   *
   * ★★★ THESE TWO CASES TAKE DIFFERENT BRANCHES AND PRODUCE DIFFERENT STRINGS,
   * and an earlier version of this comment called them "the same safe form"
   * three lines above two visibly different expectations. `[""]` is
   * `Number("") === 0`, which `Intl` puts in `other`, so it renders the plural
   * with an EMPTY slot; `[]` has no arg at all, so `t()` leaves the literal
   * `{0}` in place — a pre-existing property of `t()` (it only replaces slots
   * it was given args for), surfaced here rather than introduced.
   *
   * ★★ NEITHER CASE PINS A GUARD, because there is no guard left to pin: both
   * reach `other` through `Intl` itself. What they pin is that a malformed
   * count cannot produce the SINGULAR — which is the user-visible property —
   * and that neither input throws.
   */
  it("renders the plural, not the singular, for a count that is not a number", () => {
    // `Number("") === 0` → `other` → the plural key, with an empty slot.
    expect(activityMessage("en-US", "ai.allocationPlan", [""])).toBe(
      "AI planned  allocation cells",
    );
    // No arg at all → `t()` leaves the literal `{0}`. Different branch, and
    // deliberately a different expectation from the case above.
    expect(activityMessage("en-US", "ai.allocationPlan", [])).toBe(
      "AI planned {0} allocation cells",
    );
    // ★ The property the test is NAMED for, asserted rather than implied: the
    //   singular is the form that must never appear for a malformed count.
    for (const args of [[""], [], ["abc"], [Number.NaN]]) {
      expect(activityMessage("en-US", "ai.allocationPlan", args)).not.toContain(
        "1 allocation cell",
      );
    }
  });

  it("keeps the unknown-kind fallback for a kind this release does not know", () => {
    expect(activityMessage("en-US", "future.kind", [])).toBe("Unrecognized activity (future.kind)");
  });

  /**
   * ★ The own-property guard in `activityMessageKey` is what stops this
   * resolving to `Function.prototype.toString` and crashing the panel. Pinned
   * here as well as there because this module is now the only caller.
   */
  it("does not resolve a prototype member as a kind", () => {
    expect(activityMessage("en-US", "toString", [])).toBe("Unrecognized activity (toString)");
  });
});
