import type { ProjectMeta } from "./types";
import type { ProjectTemplate } from "./templates";
import type { TranslationKey } from "./i18n";
import { deriveMode, type AppMode } from "./feature-modules";

export type SuggestTier = AppMode;
export interface SuggestReason { key: TranslationKey; args?: (string | number)[]; }
export interface TemplateSuggestion { templateId: string; tier: SuggestTier; reasons: SuggestReason[]; }

const DEPLOYMENT_POINTS: Record<ProjectMeta["deployment"], number> = { Cloud: 0, "On-premise": 1, Hybrid: 2 };
const TEAM_MID = 3, TEAM_LARGE = 8;
const DURATION_MID_MONTHS = 3, DURATION_LARGE_MONTHS = 12;
const SCALE_THRESHOLD = 1000;
const TIER_MODULAR_MIN = 2, TIER_ADVANCED_MIN = 5;
const TIER_RANK: Record<SuggestTier, number> = { simple: 0, modular: 1, advanced: 2 };

function monthsBetween(start: string, end: string): number {
  const s = Date.parse(start), e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return (e - s) / (1000 * 60 * 60 * 24 * 30.44);
}
function isRegulated(reg: readonly string[]): boolean {
  return reg.some((r) => !!r && r !== "Not applicable");
}

export function complexityScore(meta: ProjectMeta): { score: number; reasons: SuggestReason[] } {
  const reasons: SuggestReason[] = [];
  let score = 0;

  const team =
    (meta.keyStakeholdersInternal?.length ?? 0) +
    (meta.keyStakeholdersExternal?.length ?? 0);
  if (team >= TEAM_LARGE) { score += 2; reasons.push({ key: "suggestSignalTeam", args: [team] }); }
  else if (team >= TEAM_MID) { score += 1; reasons.push({ key: "suggestSignalTeam", args: [team] }); }

  if (isRegulated(meta.regulatory ?? [])) { score += 1; reasons.push({ key: "suggestSignalRegulated" }); }

  const dep = DEPLOYMENT_POINTS[meta.deployment] ?? 0;
  if (dep > 0) { score += dep; reasons.push({ key: "suggestSignalDeployment", args: [meta.deployment] }); }

  // endDate is optional (0.74) — no end date means unknown duration (0 signal).
  const months = meta.endDate ? Math.round(monthsBetween(meta.startDate, meta.endDate)) : 0;
  if (months > DURATION_LARGE_MONTHS) { score += 2; reasons.push({ key: "suggestSignalDuration", args: [months] }); }
  else if (months >= DURATION_MID_MONTHS) { score += 1; reasons.push({ key: "suggestSignalDuration", args: [months] }); }

  if ((meta.identityCount ?? 0) >= SCALE_THRESHOLD) { score += 1; reasons.push({ key: "suggestSignalScale" }); }

  return { score, reasons };
}

function tierForScore(score: number): SuggestTier {
  if (score >= TIER_ADVANCED_MIN) return "advanced";
  if (score >= TIER_MODULAR_MIN) return "modular";
  return "simple";
}

function pickTemplateForTier(tier: SuggestTier, templates: readonly ProjectTemplate[]): string {
  if (templates.length === 0) return "";
  const withMode = templates.map((tpl) => ({ tpl, mode: deriveMode(tpl.features) }));
  const builtinExact = withMode.find((x) => x.tpl.builtIn && x.mode === tier);
  if (builtinExact) return builtinExact.tpl.id;
  const anyExact = withMode.find((x) => x.mode === tier);
  if (anyExact) return anyExact.tpl.id;
  let best = withMode[0];
  let bestDist = Math.abs(TIER_RANK[best.mode] - TIER_RANK[tier]);
  for (const x of withMode.slice(1)) {
    const d = Math.abs(TIER_RANK[x.mode] - TIER_RANK[tier]);
    if (d < bestDist || (d === bestDist && x.tpl.builtIn && !best.tpl.builtIn)) { best = x; bestDist = d; }
  }
  return best.tpl.id;
}

export function suggestTemplate(meta: ProjectMeta, templates: readonly ProjectTemplate[]): TemplateSuggestion {
  const { score, reasons } = complexityScore(meta);
  const tier = tierForScore(score);
  return {
    templateId: pickTemplateForTier(tier, templates),
    tier,
    reasons: reasons.length ? reasons : [{ key: "suggestSignalLimited" }],
  };
}
