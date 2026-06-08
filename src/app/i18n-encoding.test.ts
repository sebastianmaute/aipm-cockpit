import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { de } from "./i18n.de";

const DE_SOURCE = readFileSync(join(__dirname, "i18n.de.ts"), "utf8");

describe("i18n German encoding", () => {
  it("has no mojibake byte sequences in the DE source", () => {
    expect(DE_SOURCE).not.toMatch(/[ÃÂ]/);
  });

  it("uses literal UTF-8, not \\uXXXX escapes, for umlauts", () => {
    expect(DE_SOURCE).not.toMatch(/\\u00(e4|f6|fc|c4|d6|dc|df)/i);
  });

  it("renders required German terms with their umlaut/ß intact", () => {
    const all = Object.values(de).join("\n").toLowerCase();
    for (const term of [
      "für",
      "änderung",
      "müssen",
      "schließen",
      "gültig",
      "zurück",
      "löschen",
      "übernehmen",
    ]) {
      expect(all).toContain(term);
    }
  });

  it("contains no ASCII-substituted umlaut tokens in German values", () => {
    const all = Object.values(de).join(" ");
    expect(all).not.toMatch(/\bfuer\b|\bmuessen\b|\bgeloescht\b|\bSchliessen\b/);
  });
});
