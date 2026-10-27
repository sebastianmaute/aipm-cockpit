import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AI_CONSENT_LEVELS, AI_DATA_PATHS, aiDataPathsFor } from "./ai-disclosure";
import { AI_DISCLOSURE_VERSION } from "./ai-consent";
import { loadI18n, t } from "./i18n";
import { de } from "./i18n.de";
import { AI_ACTIVATION_SITES, AI_BACKGROUND_SITES } from "../test/ai-activation-sites";

// ★★ THE VERSION GUARD. Consent is recorded against `AI_DISCLOSURE_VERSION`; a disclosure change that
// keeps the version would leave every existing consent "current" for a text the user never saw.
// Each version's table is pinned below, one line per row: `id|level|labelKey|dataKey|hash`, where
// `hash` is the first 12 hex digits of SHA-256 over the row's ENGLISH label, a newline, and its
// ENGLISH data text (`textHash` below). The test requires the highest pinned version to be
// `AI_DISCLOSURE_VERSION` and its pin to equal the live table, so ANY change to a row, a level, a key
// or an English text is red until someone decides which of the two cases it is:
//   • WHAT A PATH SENDS changed (a field added or dropped, a path added, removed or re-levelled):
//     bump `AI_DISCLOSURE_VERSION` in ai-consent.ts and ADD a pin for the new version. Never edit an
//     older version's pin; it records what that version's users accepted.
//   • WORDING ONLY (a typo, a clearer phrase, the same facts): re-pin the changed hash in the CURRENT
//     version's line and say "wording only" in the commit message. Existing consents stay valid.
// Print the live lines with `fingerprint()` (the failure diff shows them). German texts are not
// hashed: they translate the English, which is the reference text.
const DISCLOSED_TABLES: Readonly<Record<number, readonly string[]>> = {
  1: [
    "chat|interactive|aiDataChatLabel|aiDataChat|519b39b01089",
    "inline-edit|interactive|aiDataInlineEditLabel|aiDataInlineEdit|ddf595ddc45b",
    "committee-report|interactive|aiDataCommitteeReportLabel|aiDataCommitteeReport|ec731819812b",
    "digest-narrative|interactive|aiDataDigestNarrativeLabel|aiDataDigestNarrative|d8ff9691d793",
    "forecast-import|interactive|aiDataForecastImportLabel|aiDataForecastImport|7c62a3db181e",
    "insight-recommendation|interactive|aiDataInsightRecommendationLabel|aiDataInsightRecommendation|b1964a69f00e",
    "action-analysis|interactive|aiDataActionAnalysisLabel|aiDataActionAnalysis|8454d8b056cd",
    "alloc-plan|interactive|aiDataAllocPlanLabel|aiDataAllocPlan|0daca179cd94",
    "raci-suggest|interactive|aiDataRaciSuggestLabel|aiDataRaciSuggest|c8bdc16faa5f",
    "task-dedup|interactive|aiDataTaskDedupLabel|aiDataTaskDedup|b0832e394653",
    "wbs-plan|interactive|aiDataWbsPlanLabel|aiDataWbsPlan|1a29e0f163bd",
    "weight-suggestion|interactive|aiDataWeightSuggestionLabel|aiDataWeightSuggestion|f01d808dbb51",
    "project-proposal|interactive|aiDataProjectProposalLabel|aiDataProjectProposal|155bba30c3ac",
    "dictation|interactive|aiDataDictationLabel|aiDataDictation|c2ff7295a1a7",
    "scheduled-job|background|aiDataScheduledJobLabel|aiDataScheduledJob|43c341548943",
    "insight-recommendation-auto|background|aiDataInsightRecommendationAutoLabel|aiDataInsightRecommendation|583a60bae1ed",
    "digest-narrative-scheduled|background|aiDataDigestNarrativeScheduledLabel|aiDataDigestNarrative|490866689998",
  ],
};

// Which disclosure rows each activation site (src/test/ai-activation-sites.ts) leads to. A new site
// fails "every activation site maps to a row" until it is mapped here, i.e. until someone has
// decided which row of the disclosure covers it.
const SITE_ROWS: Readonly<Record<string, readonly string[]>> = {
  "app/create-project-wizard.tsx": ["project-proposal"],
  "app/digest/digest-card-connected.tsx": ["digest-narrative", "digest-narrative-scheduled"],
  // The note-log panel only says whether the assistant can read the log: the chat's read path.
  "app/note-log-panel.tsx": ["chat"],
  "app/settings-sections/next-actions-section.tsx": ["weight-suggestion"],
  "app/settings-sections/scheduled-jobs-section.tsx": ["scheduled-job"],
  "app/shell-chrome.tsx": ["chat"],
  "app/task-manager.tsx": ["chat", "committee-report"],
  "app/use-ai-orchestration.ts": ["action-analysis", "scheduled-job"],
  "app/use-alloc-plan.tsx": ["alloc-plan"],
  "app/use-entity-inline-ai-edit.tsx": ["inline-edit"],
  "app/use-forecast-import.ts": ["forecast-import"],
  "app/use-inline-entity-edit.ts": ["inline-edit"],
  "app/use-insight-recommendations.ts": ["insight-recommendation", "insight-recommendation-auto"],
  "app/use-meeting-report-actions.ts": ["committee-report"],
  "app/use-raci-suggest.tsx": ["raci-suggest"],
  "app/use-tasks-dedup.tsx": ["task-dedup"],
  "app/use-tasks-inline-ai-edit.tsx": ["inline-edit"],
  "app/use-wbs-plan.tsx": ["wbs-plan"],
  "app/workspace-section.tsx": ["chat", "insight-recommendation"],
};

// Dictation is gated on the consent record in `resolveDictationEngine` (dictation-config.ts), not
// on one of the three activation predicates, so no activation site leads to it.
const ROWS_WITHOUT_A_SITE = new Set(["dictation"]);

// Where the three predicates are DEFINED (each calls the next); every path reads them through this
// file, so it maps to no single row and is left out of the mapping on purpose.
const PREDICATE_DEFINITIONS = new Set(["app/settings-types.ts"]);

const textHash = (row: (typeof AI_DATA_PATHS)[number]) =>
  createHash("sha256").update(`${t("en-US", row.labelKey)}
${t("en-US", row.dataKey)}`).digest("hex").slice(0, 12);
const fingerprint = () =>
  AI_DATA_PATHS.map((row) => `${row.id}|${row.level}|${row.labelKey}|${row.dataKey}|${textHash(row)}`);
const ids = new Set(AI_DATA_PATHS.map((row) => row.id));

describe("AI_DATA_PATHS", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("has unique ids", () => {
    expect(ids.size).toBe(AI_DATA_PATHS.length);
  });

  it.each(AI_CONSENT_LEVELS)("has at least one %s row", (level) => {
    expect(aiDataPathsFor(level).length).toBeGreaterThan(0);
  });

  it("every label and data key has a non-empty English and German text", () => {
    const keys = AI_DATA_PATHS.flatMap((row) => [row.labelKey, row.dataKey]);
    expect(keys.length).toBe(AI_DATA_PATHS.length * 2);
    for (const key of keys) {
      expect(t("en-US", key).trim(), key).toBeTruthy();
      expect(t("en-US", key), key).not.toBe(key);
      expect(de[key]?.trim(), key).toBeTruthy();
      expect(t("de", key), key).toBe(de[key]);
    }
  });

  it("labels are unique per level, so each dialog names every row distinctly", () => {
    for (const level of AI_CONSENT_LEVELS) {
      const labels = aiDataPathsFor(level).map((row) => t("en-US", row.labelKey));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("is pinned, texts included, for the current AI_DISCLOSURE_VERSION (bump it, or re-pin a wording-only change)", () => {
    const versions = Object.keys(DISCLOSED_TABLES).map(Number);
    expect(Math.max(...versions)).toBe(AI_DISCLOSURE_VERSION);
    expect(fingerprint()).toEqual(DISCLOSED_TABLES[AI_DISCLOSURE_VERSION]);
  });

  it("every activation site maps to a row, and every row but dictation has a site", () => {
    for (const file of PREDICATE_DEFINITIONS) expect(AI_ACTIVATION_SITES[file], file).toBeDefined();
    const sites = Object.keys(AI_ACTIVATION_SITES).filter((file) => !PREDICATE_DEFINITIONS.has(file)).sort();
    expect(sites.length).toBeGreaterThan(0);
    expect(Object.keys(SITE_ROWS).sort()).toEqual(sites);
    for (const site of sites) {
      expect(SITE_ROWS[site].length, site).toBeGreaterThan(0);
      for (const id of SITE_ROWS[site]) expect(ids.has(id), `${site} → ${id}`).toBe(true);
    }
    const reached = new Set(Object.values(SITE_ROWS).flat());
    const unreached = AI_DATA_PATHS.map((row) => row.id).filter((id) => !reached.has(id));
    expect(unreached).toEqual([...ROWS_WITHOUT_A_SITE]);
  });

  it("every background runner site leads to a background row", () => {
    expect(AI_BACKGROUND_SITES.length).toBe(3);
    const background = new Set(aiDataPathsFor("background").map((row) => row.id));
    for (const site of AI_BACKGROUND_SITES) {
      expect(SITE_ROWS[site].some((id) => background.has(id)), site).toBe(true);
    }
  });

  it("docs/security.md lists every row, label and data text verbatim, under its level", () => {
    const doc = readFileSync(join(process.cwd(), "docs", "security.md"), "utf8");
    const interactiveAt = doc.indexOf("Interactive (");
    const backgroundAt = doc.indexOf("Background (");
    expect(interactiveAt).toBeGreaterThan(-1);
    expect(backgroundAt).toBeGreaterThan(interactiveAt);
    for (const row of AI_DATA_PATHS) {
      // The bullet is the row: its English label and data text, verbatim.
      const label = `- **${t("en-US", row.labelKey)}** — ${t("en-US", row.dataKey)}`;
      const at = doc.indexOf(label);
      expect(at, label).toBeGreaterThan(-1);
      if (row.level === "interactive") expect(at < backgroundAt, label).toBe(true);
      else expect(at > backgroundAt, label).toBe(true);
    }
  });
});
