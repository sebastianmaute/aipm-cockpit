import { describe, expect, test } from "vitest";
import { bucketCurrencyLabel } from "./budget-currency-label";
import { loadI18n } from "./i18n";

// §474: budget-panel.tsx and budget-report-panel.tsx both append a `(×rate)`
// suffix after a bucket's currency code, and both must tell a genuinely
// resolved rate apart from a non-EUR bucket read at par because no rate ever
// resolved. `rate !== 1` alone cannot make that distinction — an "eur" source
// and an "unresolved" source both carry rate === 1 — so this pins the THREE
// states the RESOLVER's source distinguishes, not just two.
describe("bucketCurrencyLabel", () => {
  test("an EUR bucket renders its bare currency code, no suffix", () => {
    expect(bucketCurrencyLabel("en-US", "EUR", 1, "eur")).toBe("EUR");
  });

  test("a resolved non-EUR rate that happens to equal 1 renders its bare currency code, no marker", () => {
    // The case §474 exists to keep distinct from "unresolved" below — both
    // are rate === 1, and only the SOURCE tells them apart.
    expect(bucketCurrencyLabel("en-US", "USD", 1, "cached")).toBe("USD");
    expect(bucketCurrencyLabel("en-US", "USD", 1, "override")).toBe("USD");
  });

  test("a resolved non-EUR rate that is not 1 renders the (×rate) suffix", () => {
    expect(bucketCurrencyLabel("en-US", "USD", 1.1, "cached")).toBe("USD (×1.1)");
    expect(bucketCurrencyLabel("en-US", "GBP", 0.85, "override")).toBe("GBP (×0.85)");
  });

  test("an UNRESOLVED non-EUR bucket renders an explicit marker, distinct from both other states", () => {
    const label = bucketCurrencyLabel("en-US", "USD", 1, "unresolved");
    expect(label).not.toBe("USD");
    expect(label).not.toBe("EUR");
    expect(label).toContain("USD");
    expect(label).toMatch(/1:1/);
    // Direction-neutral: the Budget panel card shows EUR figures in the
    // bucket's currency at 1:1, so the marker must not claim "as EUR".
    expect(label).not.toMatch(/as EUR/);
  });

  test("renders in German too — the marker text is a real i18n key, not hardcoded English", async () => {
    // The DE dict is lazy (`activeDeDict` stays null until this resolves) —
    // without awaiting it, `t("de", …)` silently falls back to en-US and this
    // test would pass for the wrong reason.
    await loadI18n("de");
    const label = bucketCurrencyLabel("de", "USD", 1, "unresolved");
    expect(label).toContain("USD");
    expect(label).toMatch(/1:1/);
    expect(label).not.toMatch(/no rate/i);
  });
});
