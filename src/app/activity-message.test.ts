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
    expect(ACTIVITY_PLURAL_KINDS.length).toBeGreaterThan(0);
    for (const kind of ACTIVITY_PLURAL_KINDS) {
      expect(activityPluralBase(kind)).toBe(ACTIVITY_KIND_TO_KEY[kind]);
    }
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
