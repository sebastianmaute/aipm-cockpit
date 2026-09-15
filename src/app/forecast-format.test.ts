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
    // Fix round 2: this Node's ICU does not abbreviate de-DE compact
    // currency below roughly EUR1M at maximumSignificantDigits:3 -- it
    // rounds to 3 significant digits and prints the full grouped number
    // with NO K/M-style suffix, which would read as an exact figure
    // ("261.000 €") rather than the rounded one it actually is. The
    // implementation detects the missing `type: "compact"` part in
    // `formatToParts` and falls back to the ordinary (non-compact,
    // maximumFractionDigits:0) currency format, which prints the real,
    // non-rounded figure instead. Literals are hardcoded, measured once on
    // this machine's Node (both carry a non-breaking space,  , before
    // "Mio."/"€").
    expect(formatMoneyCompact(261_150, "de-DE")).toBe("261.150 €");
    expect(formatMoneyCompact(1_240_000, "de-DE")).toBe("1,24 Mio. €");
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
