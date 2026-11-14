import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n } from "../i18n";
import figuresJson from "../../../docs/briefs/figures.json";
import { cacheReadShare, renderFigureBlocks, type Figures } from "./brief-blocks";

const figures = figuresJson as Figures;

describe("brief-blocks", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it.each(["en", "de"] as const)("figures table caption names commit, date, model and demo data (%s)", (lang) => {
    const block = renderFigureBlocks(lang, figures).figures;
    expect(block).toContain(figures.commit.slice(0, 9));
    expect(block).not.toContain(figures.commit.slice(0, 10));
    expect(block).toContain(figures.runDate);
    expect(block).toContain(figures.model);
    expect(block).toContain(lang === "en" ? "demo project" : "Demoprojekt");
  });

  it("shows n for every row and the hidden paths in the on state", () => {
    const lines = renderFigureBlocks("en", figures).figures.split("\n");
    expect(lines.filter((l) => l.includes("hidden while people protection is on"))).toHaveLength(figures.hiddenWhenProtected.length);
    expect(lines.filter((l) => l.includes("| 2 |"))).toHaveLength(2);
  });

  it("team-month is labelled estimated and states its arithmetic", () => {
    const en = renderFigureBlocks("en", figures)["team-month"];
    expect(en).toContain("*Estimated*");
    expect(en).toContain("21 working days");
    expect(en).toContain("calls per user per day");
    expect(renderFigureBlocks("de", figures)["team-month"]).toContain("*Geschätzt*");
  });

  it("cache-read share = cacheRead / (input + cacheWrite + cacheRead)", () => {
    expect(cacheReadShare({ inputTokens: 100, cacheWriteTokens: 100, cacheReadTokens: 200 })).toBe(0.5);
    expect(cacheReadShare({ inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBe(0);
  });

  it("de uses decimal comma", () => {
    const de = renderFigureBlocks("de", figures);
    expect(de.figures).toContain("0,0711");
    expect(de.figures).not.toContain("0.0711");
    expect(de["team-month"]).toMatch(/\$ \d+,\d\d/);
    expect(renderFigureBlocks("en", figures).figures).toContain("0.0711");
  });
});
