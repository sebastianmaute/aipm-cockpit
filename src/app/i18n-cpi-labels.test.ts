import { describe, expect, it } from "vitest";
import { en } from "./i18n";
import { de } from "./i18n.de";

// Spec §11 "Three indices, one word": after MR 2 a bare CPI/SPI label means the
// price-based forecast index. Every other user-visible CPI/SPI is the task-effort
// index and must say so. Allowlist = forecast keys that really are price-based
// (verified by reading each: `forecastCpi`/`forecastSpi` are the bare price-based
// labels; `forecastTipEtcEfficiency` embeds a literal "CPI" in its formula text;
// `forecastTipCpi`/`forecastTipSpi`/`forecastTipEfficiency` spell the term out in
// full ("Cost performance index" / "Schedule performance index" / no acronym at
// all) so the bare-acronym regex never actually matches them, but they stay in
// the allowlist since they are price-based content and would need it if reworded).
const PRICE_BASED = new Set([
  "forecastCpi",
  "forecastSpi",
  "forecastTipCpi",
  "forecastTipSpi",
  "forecastTipEfficiency",
  "forecastTipEtcEfficiency",
]);

describe("CPI/SPI labels", () => {
  it("EN: every CPI/SPI outside the forecast is qualified as effort", () => {
    const bad = Object.entries(en)
      .filter(([k, v]) => !PRICE_BASED.has(k) && /(?<![Ee]ffort )\b(CPI|SPI)\b/.test(v as string))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("DE: every CPI/SPI outside the forecast is qualified as Aufwand", () => {
    const bad = Object.entries(de)
      .filter(([k, v]) => !PRICE_BASED.has(k) && /(?<!Aufwands-)\b(CPI|SPI)\b/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
