import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AI_CONSENT_LEVELS, AI_DATA_PATHS, aiDataPathsFor } from "./ai-disclosure";
import { AI_DISCLOSURE_VERSION } from "./ai-consent";
import { loadI18n, t } from "./i18n";
import { de } from "./i18n.de";
import { AI_ACTIVATION_SITES, AI_BACKGROUND_SITES } from "../test/ai-activation-sites";

// ★★ THE VERSION GUARD. Consent is recorded against `AI_DISCLOSURE_VERSION`; a table change that
// keeps the version would leave every existing consent "current" for a disclosure the user never saw.
// Each version's table is pinned below as `id|level|labelKey|dataKey`, and the test requires the
// pin for the CURRENT version to equal the live table. To change the table: bump
// `AI_DISCLOSURE_VERSION` in ai-consent.ts and ADD a pin for the new version; never edit an
// existing version's pin (it is the record of what that version's users accepted). A reviewer sees
// the version bump and the new pin side by side in the diff.
// It pins ids, levels and keys, not the texts: a wording fix to a key's text does not re-ask, so a
// text change that changes WHAT a path is said to send must also bump the version (rename the key,
// which this pin then catches).
const DISCLOSED_TABLES: Readonly<Record<number, readonly string[]>> = {
  1: [
    "chat|interactive|aiDataChatLabel|aiDataChat",
    "inline-edit|interactive|aiDataInlineEditLabel|aiDataInlineEdit",
    "committee-report|interactive|aiDataCommitteeReportLabel|aiDataCommitteeReport",
    "digest-narrative|interactive|aiDataDigestNarrativeLabel|aiDataDigestNarrative",
    "forecast-import|interactive|aiDataForecastImportLabel|aiDataForecastImport",
    "insight-recommendation|interactive|aiDataInsightRecommendationLabel|aiDataInsightRecommendation",
    "action-analysis|interactive|aiDataActionAnalysisLabel|aiDataActionAnalysis",
    "alloc-plan|interactive|aiDataAllocPlanLabel|aiDataAllocPlan",
    "raci-suggest|interactive|aiDataRaciSuggestLabel|aiDataRaciSuggest",
    "task-dedup|interactive|aiDataTaskDedupLabel|aiDataTaskDedup",
    "wbs-plan|interactive|aiDataWbsPlanLabel|aiDataWbsPlan",
    "weight-suggestion|interactive|aiDataWeightSuggestionLabel|aiDataWeightSuggestion",
    "project-proposal|interactive|aiDataProjectProposalLabel|aiDataProjectProposal",
    "dictation|interactive|aiDataDictationLabel|aiDataDictation",
    "scheduled-job|background|aiDataScheduledJobLabel|aiDataScheduledJob",
    "insight-recommendation-auto|background|aiDataInsightRecommendationAutoLabel|aiDataInsightRecommendation",
    "digest-narrative-scheduled|background|aiDataDigestNarrativeScheduledLabel|aiDataDigestNarrative",
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

const fingerprint = () => AI_DATA_PATHS.map((row) => `${row.id}|${row.level}|${row.labelKey}|${row.dataKey}`);
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

  it("is pinned for the current AI_DISCLOSURE_VERSION (bump the version to change the table)", () => {
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
