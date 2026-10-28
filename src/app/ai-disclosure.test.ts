import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AI_CONSENT_LEVELS, AI_DATA_PATHS, AI_DESTINATION_KEYS, aiDataPathsFor } from "./ai-disclosure";
import { type AiRoute, setAiDeploymentState } from "./ai-deployment";
import { DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { helpEntryBody } from "./help-content";
import { AI_DISCLOSURE_VERSION } from "./ai-consent";
import { loadI18n, t, type TranslationKey } from "./i18n";
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
    "chat|interactive|aiDataChatLabel|aiDataChat|0ab2b52cc0f9",
    "inline-edit|interactive|aiDataInlineEditLabel|aiDataInlineEdit|5f4bd300b6f6",
    "committee-report|interactive|aiDataCommitteeReportLabel|aiDataCommitteeReport|ec731819812b",
    "digest-narrative|interactive|aiDataDigestNarrativeLabel|aiDataDigestNarrative|d8ff9691d793",
    "forecast-import|interactive|aiDataForecastImportLabel|aiDataForecastImport|77d3b27235a2",
    "insight-recommendation|interactive|aiDataInsightRecommendationLabel|aiDataInsightRecommendation|dd308831307b",
    "action-analysis|interactive|aiDataActionAnalysisLabel|aiDataActionAnalysis|8454d8b056cd",
    "alloc-plan|interactive|aiDataAllocPlanLabel|aiDataAllocPlan|1d90c54d0111",
    "raci-suggest|interactive|aiDataRaciSuggestLabel|aiDataRaciSuggest|c8bdc16faa5f",
    "task-dedup|interactive|aiDataTaskDedupLabel|aiDataTaskDedup|b0832e394653",
    "wbs-plan|interactive|aiDataWbsPlanLabel|aiDataWbsPlan|1a29e0f163bd",
    "weight-suggestion|interactive|aiDataWeightSuggestionLabel|aiDataWeightSuggestion|f01d808dbb51",
    "project-proposal|interactive|aiDataProjectProposalLabel|aiDataProjectProposal|155bba30c3ac",
    "dictation|interactive|aiDataDictationLabel|aiDataDictation|11af271ca960",
    "scheduled-job|background|aiDataScheduledJobLabel|aiDataScheduledJob|43c341548943",
    "insight-recommendation-auto|background|aiDataInsightRecommendationAutoLabel|aiDataInsightRecommendation|5eb499ef50b6",
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

// Dictation is gated by a fourth predicate, `isAiConsentedForDictation` (settings-types.ts: the AI switch
// and the interactive consent, no Anthropic key), whose result its callers pass to `resolveDictationEngine`
// (dictation-config.ts). The activation-site table lists only the three AI predicates, so no site leads to it.
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

// ★ THE DESTINATION PIN. The texts that say WHERE the data goes — one set per AI route (direct to
// Anthropic, or through this app's server and the organisation's AI gateway) — are pinned here by a
// hash of their English text (first 12 hex digits of SHA-256), so a wording change is red until it is
// re-pinned. They do NOT bump `AI_DISCLOSURE_VERSION`: they describe the route, not what is sent, and
// a consent already records the route it was given for (`ai-consent.ts`), so a deployment that changes
// route asks every user again by itself.
// Re-pinned for the AI-06/AI-20 data-protection wording: a new `thirdParty` text per route (the gateway one
// names the gateway and its provider as recipients), and the gateway key note, key bullet and Help now say
// the app's server neither stores nor logs the key while the gateway receives it, and that the gateway may
// keep its own log.
const DESTINATION_PIN: readonly string[] = [
  "direct|interactive|aiConsentDataIntro|ef4b607923f8",
  "direct|background|aiConsentBackgroundDataIntro|9208fd9b4f5b",
  "direct|keyNote|aiApiKeyHint|98fd123e2e5d",
  "direct|keySecurity|aiConsentBullet2|7cb475af8600",
  "direct|thirdParty|aiConsentBullet3|29b307012a9b",
  "direct|help|helpSecAiBody|0709ff5576e1",
  "gateway|interactive|aiConsentDataIntroGateway|2b068f0d6388",
  "gateway|background|aiConsentBackgroundDataIntroGateway|da1bf190a9fa",
  "gateway|keyNote|aiApiKeyHintGateway|206769a38c0e",
  "gateway|keySecurity|aiConsentBullet2Gateway|eb11512a84f3",
  "gateway|thirdParty|aiConsentBullet3Gateway|e271fb1ba1f5",
  "gateway|help|helpSecAiBodyGateway|843ff1deb718",
];

const destinationFingerprint = () =>
  Object.entries(AI_DESTINATION_KEYS).flatMap(([route, keys]) =>
    Object.entries(keys).map(([kind, key]) =>
      `${route}|${kind}|${key}|${createHash("sha256").update(t("en-US", key)).digest("hex").slice(0, 12)}`,
    ),
  );

const routeKeys = (route: AiRoute): TranslationKey[] => Object.values(AI_DESTINATION_KEYS[route]);

describe("AI_DESTINATION_KEYS", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));

  it("is pinned by its English texts (re-pin a wording change; the version stays)", () => {
    expect(destinationFingerprint()).toEqual(DESTINATION_PIN);
  });

  it("direct keeps the keys the app has always shown", () => {
    expect(AI_DESTINATION_KEYS.direct).toEqual({
      interactive: "aiConsentDataIntro",
      background: "aiConsentBackgroundDataIntro",
      keyNote: "aiApiKeyHint",
      keySecurity: "aiConsentBullet2",
      thirdParty: "aiConsentBullet3",
      help: "helpSecAiBody",
    });
  });

  it("every text exists in English and German, and German is translated", () => {
    for (const key of [...routeKeys("direct"), ...routeKeys("gateway")]) {
      expect(t("en-US", key), key).not.toBe(key);
      expect(de[key]?.trim(), key).toBeTruthy();
      expect(de[key], key).not.toBe(t("en-US", key));
    }
  });

  it("gateway texts name the app's server and the gateway, and never a direct call", () => {
    // `thirdParty` names the gateway and its provider as recipients; it says nothing about the path.
    for (const key of routeKeys("gateway").filter((k) => k !== AI_DESTINATION_KEYS.gateway.thirdParty)) {
      const en = t("en-US", key);
      expect(en, key).toContain("this app's server and your organisation's AI gateway");
      expect(en, key).not.toMatch(/directly|api\.anthropic\.com/);
      expect(de[key], key).toContain("Gateway");
      expect(de[key], key).not.toMatch(/direkt|api\.anthropic\.com/);
    }
    // Positive control: the direct texts are the ones that say "directly … api.anthropic.com".
    expect(t("en-US", AI_DESTINATION_KEYS.direct.interactive)).toMatch(/directly from this browser to api\.anthropic\.com/);
  });

  it("the key texts say the app's server neither stores nor logs the key, and the gateway receives it", () => {
    for (const key of [AI_DESTINATION_KEYS.gateway.keyNote, AI_DESTINATION_KEYS.gateway.keySecurity, AI_DESTINATION_KEYS.gateway.help]) {
      expect(t("en-US", key), key).toContain("this app's server neither stores nor logs it, but your organisation's AI gateway receives it with every request");
      expect(t("en-US", key), key).not.toContain("not stored on the server");
      expect(de[key]?.toLowerCase(), key).toContain("der server dieser app speichert und protokolliert ihn nicht, das ki-gateway ihrer organisation erhält ihn jedoch mit jeder anfrage");
    }
  });

  it("gateway: the third-party bullet names the gateway and its provider as recipients", () => {
    const key = AI_DESTINATION_KEYS.gateway.thirdParty;
    expect(t("en-US", key)).toContain("your organisation's AI gateway and the provider that runs it");
    expect(t("en-US", key)).toContain("Your organisation decides what the gateway logs and for how long");
    // It keeps the direct bullet's Anthropic sentence word for word.
    expect(t("en-US", key)).toContain(t("en-US", "aiConsentBullet3"));
    expect(de[key]).toContain("das KI-Gateway Ihrer Organisation und den Anbieter, der es betreibt");
    expect(de[key]).toContain(de.aiConsentBullet3);
  });

  it("gateway Help says the gateway may keep its own log", () => {
    expect(t("en-US", AI_DESTINATION_KEYS.gateway.help)).toContain(
      "to Anthropic when you use it; the gateway may keep its own log under your organisation's settings",
    );
    expect(de[AI_DESTINATION_KEYS.gateway.help]).toContain(
      "das Gateway kann nach den Einstellungen Ihrer Organisation ein eigenes Protokoll führen",
    );
  });

  it("Help's AI entry follows the route", () => {
    const entry = { bodyKey: "helpSecAiBody" } as const;
    expect(helpEntryBody("en-US", entry)).toBe(t("en-US", "helpSecAiBody"));
    setAiDeploymentState({ off: false, route: "gateway", invalid: false });
    expect(helpEntryBody("en-US", entry)).toBe(t("en-US", AI_DESTINATION_KEYS.gateway.help));
    expect(helpEntryBody("de", entry)).toBe(de[AI_DESTINATION_KEYS.gateway.help]);
  });
});
