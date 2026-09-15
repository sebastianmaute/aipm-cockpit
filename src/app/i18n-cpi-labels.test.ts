import { describe, expect, it } from "vitest";
import { en } from "./i18n";
import { de } from "./i18n.de";

// Spec §11 "Three indices, one word": after MR 2 a bare CPI/SPI label means the
// price-based forecast index. Every other user-visible CPI/SPI is the task-effort
// index and must say so. Allowlist = forecast keys that ACTUALLY MATCH the regex
// below today (verified in both EN and DE): `forecastCpi`/`forecastSpi` are the
// bare price-based labels; `forecastTipEtcEfficiency` embeds a literal "CPI" in
// its formula text. `forecastTipCpi`/`forecastTipSpi`/`forecastTipEfficiency` are
// ALSO price-based content, but spell the term out in full ("Cost performance
// index" / "Schedule performance index" / no acronym at all in EN, and the German
// equivalents in DE) — deliberately left OFF this list, so a bare "CPI"/"SPI"
// introduced into one of them later (a reword that drops the spelled-out form)
// is still caught rather than silently passing through a blanket allowlist entry.
// ★ The regex only catches the bare, singular, upper-case acronym at a word
// boundary — a plural ("CPIs"/"SPIs", no boundary after the trailing letter) or a
// lower/mixed-case form ("cpi") is NOT guarded.
const PRICE_BASED = new Set(["forecastCpi", "forecastSpi", "forecastTipEtcEfficiency"]);

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
