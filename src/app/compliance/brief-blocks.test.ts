import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n } from "../i18n";
import figuresJson from "../../../docs/briefs/figures.json";
import { USAGE_GROUPS, cacheReadShare, renderFigureBlocks, type FigurePath, type Figures } from "./brief-blocks";

const published = figuresJson as Figures;

const HIDDEN = ["alloc-plan", "raci-suggest"];
const path = (id: string, protection: FigurePath["protection"], usdPerCall: number, over: Partial<FigurePath> = {}): FigurePath => ({
  id,
  protection,
  protectionUnverifiedCalls: 0,
  calls: 3,
  inputTokens: 100,
  cacheWriteTokens: 100,
  cacheReadTokens: 200,
  outputTokens: 10,
  usdPerCall,
  medianLatencyMs: 2500,
  ...over,
});

/** Every priced id: "on" at 0.02, except the two hidden ones, which only have an "off" row at 0.03. */
function fixture(): Figures {
  const ids = USAGE_GROUPS.flatMap((g) => g.paths);
  return {
    schema: 1,
    commit: "0123456789abcdef",
    runDate: "2026-01-02",
    model: "model-x",
    data: "demo project",
    hiddenWhenProtected: HIDDEN,
    paths: [
      ...ids.map((id) => path(id, "off", HIDDEN.includes(id) ? 0.03 : 0.02)),
      ...ids.filter((id) => !HIDDEN.includes(id)).map((id) => path(id, "on", 0.02, id === "insight-recommend-auto" ? { calls: 2 } : id === "chat" ? { protectionUnverifiedCalls: 3 } : {})),
      path("chat", "relay", 0.0632, { calls: 5 }),
    ],
    behaviour: { protectedNameHitsOn: 0, emailHitsOn: 0, documentedExceptionHitsOn: {}, positiveControlHitsOff: 0, inferenceGeo: {}, requests: {} },
    relayKeyCheck: { runs: [], warmExtraMs: null },
    rates: { fetchedAt: "2026-01-01" },
  };
}

describe("brief-blocks", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it.each(["en", "de"] as const)("figures table caption names commit, date, model and demo data (%s)", (lang) => {
    const block = renderFigureBlocks(lang, fixture()).figures;
    expect(block).toContain("012345678");
    expect(block).not.toContain("0123456789");
    expect(block).toContain("2026-01-02");
    expect(block).toContain("model-x");
    expect(block).toContain(lang === "en" ? "demo project" : "Demoprojekt");
    expect(block).toContain("2026-01-01");
  });

  it("shows n in every row, the hidden paths in the on state and the relay state", () => {
    const lines = renderFigureBlocks("en", fixture()).figures.split("\n");
    expect(lines.filter((l) => l.includes("hidden while people protection is on"))).toHaveLength(2);
    expect(lines.filter((l) => l.includes("| 2 |"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("| on (relay) | 5 |"))).toHaveLength(1);
    expect(renderFigureBlocks("de", fixture()).figures).toContain("| an (Relay) | 5 |");
  });

  it("shows unverified calls in the n cell and explains the word", () => {
    const en = renderFigureBlocks("en", fixture()).figures;
    expect(en).toContain("| 3 (3 unverified) |");
    expect(en).toContain("did not show the protection state");
    expect(renderFigureBlocks("de", fixture()).figures).toContain("| 3 (3 nicht bestätigt) |");
  });

  it("team-month is labelled estimated and states its arithmetic", () => {
    const en = renderFigureBlocks("en", fixture())["team-month"];
    expect(en).toContain("*Estimated*");
    expect(en).toContain("21 working days");
    expect(en).toContain("calls per user per day");
    expect(en).toContain("unweighted mean");
    expect(renderFigureBlocks("de", fixture())["team-month"]).toContain("*Geschätzt*");
  });

  it("team-month totals are pinned on the fixture (hidden paths priced at off)", () => {
    const en = renderFigureBlocks("en", fixture())["team-month"];
    expect(en).toContain("| $13.08 | $34.80 | $82.20 |");
    expect(en).toContain("0.0229");
    expect(renderFigureBlocks("de", fixture())["team-month"]).toContain("| 13,08 $ | 34,80 $ | 82,20 $ |");
  });

  it("cache-read share = cacheRead / (input + cacheWrite + cacheRead)", () => {
    expect(cacheReadShare({ inputTokens: 100, cacheWriteTokens: 100, cacheReadTokens: 200 })).toBe(0.5);
    expect(cacheReadShare({ inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBe(0);
    expect(renderFigureBlocks("en", fixture()).figures).toContain("| 50% |");
    expect(renderFigureBlocks("de", fixture()).figures).toContain("| 50 % |");
  });

  it("de uses decimal comma, en a point", () => {
    const de = renderFigureBlocks("de", fixture());
    expect(de.figures).toContain("0,0632");
    expect(de.figures).not.toContain("0.0632");
    expect(renderFigureBlocks("en", fixture()).figures).toContain("0.0632");
  });

  it("throws on a missing price row, an unknown feature name and non-demo data", () => {
    const f = fixture();
    expect(() => renderFigureBlocks("en", { ...f, paths: f.paths.filter((p) => p.id !== "wbs-plan") })["team-month"]).toThrow(/wbs-plan/);
    expect(() => renderFigureBlocks("en", { ...f, paths: [...f.paths, path("no-such-path", "off", 1)] })).toThrow(/no-such-path/);
    expect(() => renderFigureBlocks("en", { ...f, data: "customer project" })).toThrow(/demo project/);
  });

  it("the published figures render and give the published EN totals", () => {
    const blocks = renderFigureBlocks("en", published);
    expect(blocks.figures).toContain(published.commit.slice(0, 9));
    expect(blocks["team-month"]).toContain("| $25.25 | $67.31 | $165.19 |");
    expect(renderFigureBlocks("de", published).figures).toContain("Demoprojekt");
  });
});
