import { describe, expect, test } from "vitest";
import { densityClasses } from "./dashboard-density";

describe("densityClasses", () => {
  test("comfortable keeps the current spacing (no-op for existing users)", () => {
    expect(densityClasses("comfortable")).toEqual({ outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3", sectionGap: "gap-4", tileRow: "auto-rows-[80px]" });
  });

  test("compact tightens rhythm, KPI gap, and card padding", () => {
    expect(densityClasses("compact")).toEqual({ outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2", sectionGap: "gap-2", tileRow: "auto-rows-[72px]" });
  });

  test("exposes a grid row unit per density", () => {
    // ★ 80px comfortable was settled by eye-verify on 2026-08-14 against the
    // prototype. 72px compact was settled on 2026-08-15 by MEASUREMENT on a
    // seeded compact board in Chromium, replacing a provisional 64px that had
    // never been checked in either way.
    //
    // ★★★ NOTHING CLIPS AT ANY ROW UNIT, so "does content fit" is the wrong
    // question to ask of this constant. The tile body is
    // `min-h-0 flex-1 overflow-auto p-2` (`dashboard-tile.tsx`), so over-tall
    // content becomes an INNER SCROLL CONTAINER — it is never truncated and
    // never spills. The unit trades tiles-per-viewport against how often a tile
    // has to be scrolled to read.
    //
    // ★★★ AND INNER SCROLLING IS THIS DESIGN'S NORMAL MODE, NOT SOMETHING THE
    // COMPACT UNIT INTRODUCES. Measured on the default catalogue board at a
    // 1600px viewport against the e2e seed: 6 of 9 rendering tiles ALREADY
    // overflow at the shipped, eye-verified comfortable/80. `burn` is 507px
    // over there, `insights` 239px, `upcoming` 133px. Do not read a scrollbar
    // on a compact tile as a regression this constant caused — go and measure
    // comfortable first. No row unit fixes those three: fitting `burn` at h:2
    // would take a ~340px unit, which is what per-axis resize is for.
    //
    // ★★ WHAT THE VALUE ACTUALLY BUYS is the two tiles whose overflow status
    // CHANGES between comfortable/80 and compact: `kpi` and `milestones`, the
    // two most glanceable tiles on the board. Measured overflow at h:2 —
    // 64px: kpi 25px / milestones 22px over · 72px: 9px / 6px · 80px: both fit.
    // 64 was rejected for shipping a scrollbar worth two dozen pixels on a tile
    // whose whole value is not having to interact with it; 80 was rejected
    // because at that unit compact's overflow SET is identical to
    // comfortable's, making it compact in name only.
    expect(densityClasses("comfortable").tileRow).toBe("auto-rows-[80px]");
    expect(densityClasses("compact").tileRow).toBe("auto-rows-[72px]");
  });
});
