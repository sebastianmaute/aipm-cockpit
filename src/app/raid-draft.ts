// src/app/raid-draft.ts
//
// Pure, i18n-free builders for a RAID editor draft. `buildNewRaidDraft`,
// `applyStatus` and `applyMatrix` are moved verbatim from raid-panel.tsx
// (`openNew` and its two local helpers) so the RAID panel and the "Log as RAID"
// host (§515) build byte-identical drafts. `buildRaidSeedFromSignal` is the RAID
// counterpart of `buildTaskSeedFromAction`: the caller passes ALREADY-translated
// strings, so nothing here imports i18n.
import { defaultStatusForCategory, isTerminalStatus, nextRaidId, riskSeverityFromMatrix } from "./raid";
import type { RaidCategory, RaidItem, RaidStatus, RiskScale } from "./types";
import { sanitizeRichText } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";
import { plainToHtml } from "./sanitize-html";
import { TASK_NAME_MAX, TEXTAREA_MAX } from "./sanitize";

const DEFAULT_RISK_SCALE: RiskScale = 3;

/** A blank draft for `category`, with a freshly minted id. */
export function buildNewRaidDraft(raid: readonly RaidItem[], category: RaidCategory, today: string): RaidItem {
  const probability: RiskScale = DEFAULT_RISK_SCALE;
  const impact: RiskScale = DEFAULT_RISK_SCALE;
  return {
    id: nextRaidId(raid),
    category,
    title: "",
    severity: category === "R" ? riskSeverityFromMatrix(probability, impact) : "Medium",
    probability: category === "R" ? probability : undefined,
    impact: category === "R" ? impact : undefined,
    status: defaultStatusForCategory(category),
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    knowledgeLinks: [],
    raisedDate: today,
  };
}

/** When the user moves a draft into a terminal status, auto-fill `closedDate`
 *  with today (what the user almost always wants); leaving one clears it. */
export function applyStatus(d: RaidItem, status: RaidStatus, today: string): RaidItem {
  const terminal = isTerminalStatus(status, d.category);
  return {
    ...d,
    status,
    closedDate: terminal ? d.closedDate ?? today : undefined,
  };
}

export function applyMatrix(d: RaidItem, probability: RiskScale, impact: RiskScale): RaidItem {
  return {
    ...d,
    probability,
    impact,
    severity: riskSeverityFromMatrix(probability, impact),
  };
}

/** Title + "From: <source> — <why>" description for a RAID item raised from a
 *  signal. `note` is the caller's translated `actionCreatedFromNote` string. */
export function buildRaidSeedFromSignal(input: { title: string; note: string }): { title: string; description: string } {
  return {
    title: input.title.trim().slice(0, TASK_NAME_MAX),
    description: sanitizeRichText(plainToHtml(input.note), TEXTAREA_MAX, RICH_SINK),
  };
}
