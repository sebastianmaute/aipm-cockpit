import { describe, expect, it } from "vitest";
import { formatDayMonth, formatDayMonthYear, formatMoneyCompact, formatSignedPercent } from "./forecast-format";

describe("forecast-format", () => {
  it("compact EUR", () => {
    expect(formatMoneyCompact(261_150, "en-US")).toBe("€261K");
    // Controller ruling 3: the de-DE assertion is a hardcoded literal measured
    // once on this machine's Node (a live `Intl` call built from the same
    // options as the implementation could never disagree with itself). This
    // Node's ICU does not abbreviate de-DE compact currency at this
    // magnitude -- it prints the full grouped number with a non-breaking
    // space ( ) before the currency symbol.
    expect(formatMoneyCompact(261_150, "de-DE")).toBe("261.150 €");
  });

  it("signed percent", () => {
    expect(formatSignedPercent(-0.088125, "en-US", 1)).toBe("-8.8%");
    expect(formatSignedPercent(0.05, "en-US", 0)).toBe("+5%");
    expect(formatSignedPercent(0, "en-US", 0)).toBe("0%");
  });

  it("dates in UTC", () => {
    expect(formatDayMonthYear("2026-10-13", "en-US")).toBe("Oct 13, 2026");
    expect(formatDayMonthYear("2026-10-13", "en-GB")).toBe("13 Oct 2026");
    expect(formatDayMonth("2026-09-15", "en-US")).toBe("Sep 15");
    // Controller ruling 2: Node's ICU prints "15 Sept" for en-GB short month.
    expect(formatDayMonth("2026-09-15", "en-GB")).toMatch(/^15 Sept?$/);
  });
});
