import { describe, expect, it } from "vitest";
import { formatDayMonth, formatDayMonthYear, formatMoneyCompact, formatSignedPercent } from "./forecast-format";

describe("forecast-format", () => {
  it("compact EUR", () => {
    expect(formatMoneyCompact(261_150, "en-US")).toBe("€261K");
    // Fix round 1, finding 1: maximumFractionDigits: 0 rounds to whole EUR,
    // which does NOT abbreviate a value >= 1M -- 1_240_000, 1_450_000 and
    // 1_499_999 all print "€1M", collapsing an EAC range like
    // "EAC {0}-{1}" to "€1M-€1M". maximumSignificantDigits: 3 keeps
    // abbreviation at every magnitude; this pins the >=1M case that the
    // original brief's test never exercised.
    expect(formatMoneyCompact(1_240_000, "en-US")).toBe("€1.24M");
    // Fix round 1, finding 3 (re-measured after the significant-digits
    // change): the de-DE assertion is a hardcoded literal measured once on
    // this machine's Node (a live `Intl` call built from the same options as
    // the implementation could never disagree with itself). At 3 significant
    // digits, 261_150 rounds to 261_000 and this Node's ICU still does not
    // abbreviate de-DE compact currency at this magnitude -- it prints the
    // full grouped number with a non-breaking space ( ) before the
    // currency symbol.
    expect(formatMoneyCompact(261_150, "de-DE")).toBe("261.000 €");
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
