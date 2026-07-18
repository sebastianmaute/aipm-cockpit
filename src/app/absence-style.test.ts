import { describe, expect, it } from "vitest";
import { absenceBg, absenceGlyph, absenceLegendBg } from "./absence-style";

describe("absence-style", () => {
  it("maps each absence type to its AIPM token background (+hover)", () => {
    // These strings are BYTE-IDENTICAL to the resource-calendar originals; the
    // calendar imports them, so the two surfaces can never drift.
    expect(absenceBg("vacation")).toBe(
      "bg-ui-blue/30 hover:bg-ui-blue/40 dark:bg-ui-blue/25 dark:hover:bg-ui-blue/35",
    );
    expect(absenceBg("sick")).toBe(
      "bg-ui-pink/30 hover:bg-ui-pink/40 dark:bg-ui-pink/25 dark:hover:bg-ui-pink/35",
    );
    expect(absenceBg("training")).toBe(
      "bg-ui-purple/30 hover:bg-ui-purple/40 dark:bg-ui-purple/25 dark:hover:bg-ui-purple/35",
    );
    expect(absenceBg("other")).toBe(
      "bg-ui-medium-grey/45 hover:bg-ui-medium-grey/55 dark:bg-ui-medium-grey/35 dark:hover:bg-ui-medium-grey/45",
    );
  });

  it("gives the sick type a pink token background", () => {
    expect(absenceBg("sick")).toContain("bg-ui-pink/30");
  });

  it("maps each absence type to its single-letter glyph", () => {
    expect(absenceGlyph("vacation")).toBe("V");
    expect(absenceGlyph("sick")).toBe("S");
    expect(absenceGlyph("training")).toBe("T");
    expect(absenceGlyph("other")).toBe("O");
  });

  it("provides resting-state legend swatch tints per type", () => {
    expect(absenceLegendBg("vacation")).toBe("bg-ui-blue/30 dark:bg-ui-blue/25");
    expect(absenceLegendBg("sick")).toBe("bg-ui-pink/30 dark:bg-ui-pink/25");
    expect(absenceLegendBg("training")).toBe("bg-ui-purple/30 dark:bg-ui-purple/25");
    expect(absenceLegendBg("other")).toBe("bg-ui-medium-grey/45 dark:bg-ui-medium-grey/35");
  });
});
