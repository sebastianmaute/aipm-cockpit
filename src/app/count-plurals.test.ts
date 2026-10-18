// §715 — a count that can be 1 is said in the singular ("1 bucket", not "1 buckets"). Found in the defect
// sweep after the video-guide recordings, the same class as the Dashboard's "1 RAID updates" (D3). Each
// string here has a "…One" form in English and German, and its call site goes through `tPlural`.
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadI18n, t, tPlural, type Lang, type TranslationKey } from "./i18n";

type Case = { key: string; file: string; one: (lang: Lang) => string; en: string; de: string };

// `one` renders the string with a count of 1 through tPlural, as the call site does.
const CASES: Case[] = [
  { key: "budgetBucketsCount", file: "budget-panel.tsx", one: (l) => tPlural(l, "budgetBucketsCount" as never, 1, 1), en: "1 bucket", de: "1 Bucket" },
  { key: "forecastRunOutBefore", file: "budget-forecast-cards.tsx", one: (l) => tPlural(l, "forecastRunOutBefore" as never, 1, "5 Oct 2026", "1"), en: "1 day before", de: "1 Tag vor" },
  { key: "forecastRunOutAfter", file: "budget-forecast-cards.tsx", one: (l) => tPlural(l, "forecastRunOutAfter" as never, 1, "5 Oct 2026", "1"), en: "1 day after", de: "1 Tag nach" },
  { key: "exportSubtitle", file: "export-menu.tsx", one: (l) => tPlural(l, "exportSubtitle" as never, 1, 1), en: "Download 1 task in", de: "1 Aufgabe im" },
  { key: "evmCoverage", file: "budget-report-panel.tsx", one: (l) => tPlural(l, "evmCoverage" as never, 1, "1", "1"), en: "Estimates on 1 of 1 task", de: "Schätzungen für 1 von 1 Aufgabe" },
  { key: "outlookImportedN", file: "use-outlook-imports.ts", one: (l) => tPlural(l, "outlookImportedN" as never, 1, 1), en: "Imported 1 contact", de: "1 Kontakt importiert" },
  { key: "wizardImportTasksPart", file: "create-project-wizard.tsx", one: (l) => tPlural(l, "wizardImportTasksPart" as never, 1, 1), en: "1 task", de: "1 Aufgabe" },
  { key: "wizardImportRaidPart", file: "create-project-wizard.tsx", one: (l) => tPlural(l, "wizardImportRaidPart" as never, 1, 1), en: "1 RAID item", de: "1 RAID-Eintrag" },
  { key: "wizardImportBudgetsPart", file: "create-project-wizard.tsx", one: (l) => tPlural(l, "wizardImportBudgetsPart" as never, 1, 1), en: "1 budget", de: "1 Budget" },
];

beforeAll(async () => { await loadI18n("de"); });

describe("§715 — counts that can be 1 are singular", () => {
  for (const c of CASES) {
    it(`${c.key}: singular in English and German, plural otherwise`, () => {
      expect(c.one("en-US")).toContain(c.en);
      expect(c.one("de")).toContain(c.de);
      // a count of 2 picks the plural, which is a different string
      expect(tPlural("en-US", c.key as never, 2, 2, 2, 2)).toBe(t("en-US", c.key as TranslationKey, 2, 2, 2));
      expect(t("en-US", c.key as TranslationKey, 2, 2, 2)).not.toBe(t("en-US", `${c.key}One` as TranslationKey, 2, 2, 2));
    });

    it(`${c.key}: its call site in ${c.file} goes through tPlural`, () => {
      const src = fs.readFileSync(path.join(__dirname, c.file), "utf8");
      expect(src).toMatch(new RegExp(String.raw`tPlural\(\s*[a-zA-Z.]+,\s*"${c.key}"`));
      expect(src).not.toMatch(new RegExp(String.raw`\bt\(\s*[a-zA-Z.]+,\s*"${c.key}"`));
    });
  }

  it("the wizard's import notice joins the three parts, so no count reads as a plural of one", () => {
    const parts = [tPlural("en-US", "wizardImportTasksPart" as never, 1, 1), tPlural("en-US", "wizardImportRaidPart" as never, 2, 2), tPlural("en-US", "wizardImportBudgetsPart" as never, 1, 1)];
    expect(t("en-US", "wizardImportWorkspaceNotice" as TranslationKey, "demo.json", parts.join(", "))).toBe("Importing demo.json: 1 task, 2 RAID items, 1 budget");
  });
});
