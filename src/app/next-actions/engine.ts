// src/app/next-actions/engine.ts
import { isModuleEnabled } from "../feature-modules";
import { applyLearnedBias, bandTier } from "./score";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

/** Run enabled providers, dedup by id (first wins), drop dismissed, sort by
 *  score desc (id asc tiebreak), and re-band each action's tier from its score
 *  (single source of truth for tier). */
export function computeNextActions(
  input: ActionInput,
  providers: readonly ActionProvider[],
): SuggestedAction[] {
  const byId = new Map<string, SuggestedAction>();
  for (const p of providers) {
    if (p.moduleId && !isModuleEnabled(p.moduleId, input.features)) continue;
    for (const a of p.provide(input)) {
      if (input.dismissed.has(a.id)) continue;
      if (!byId.has(a.id)) {
        const kind = `${a.source}:${a.why.key}`;
        const final = applyLearnedBias(a.score, kind, input.learnedBias);
        const bias = final - a.score;
        byId.set(a.id, {
          ...a,
          score: final,
          tier: bandTier(final),
          learning: bias === 0 ? undefined : { bias, moved: bias > 0 ? "up" : "down" },
        });
      }
    }
  }
  return [...byId.values()].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}
