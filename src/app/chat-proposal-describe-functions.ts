// src/app/chat-proposal-describe-functions.ts — the review card's detail for a staged
// `update_settings { enabledModules }` (§779).
//
// Pure, i18n-free. `update_settings` has no `INLINE_DESCRIPTORS` entry, so `describeEntityCalls` cannot
// diff it. Since §779 an `enabledModules` key writes the project's saved functions (`Workspace.features`)
// and counts at the staging gate (`isEntityWriteCall`), so a staged row must say what it switches. It is
// judged by `judgeEnabledModules`, the SAME judge the write runs, so the card cannot disagree with it:
// a value the write refuses is shown as a rejection on the `enabledModules` field, and
// `stripRejectedFields` then keeps it out of the replayed call.
import { carriesEnabledModules, type ProposedCall } from "./chat-proposal";
import { judgeEnabledModules } from "./chat-settings-patch";
import { ALL_MODULE_IDS, sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import type { EditPlan } from "./inline-ai-edit/plan";
import type { Workspace } from "./workspace";

const FIELD = "enabledModules";

/** What a staged functions change does to the project, in registry order. */
export interface FunctionsChange {
  readonly on: readonly FeatureModuleId[];
  readonly off: readonly FeatureModuleId[];
  /** Ids the write will ignore, as its `droppedModules` reports them. */
  readonly dropped: readonly string[];
}

/** The row's functions change and plan, or null for any call that is not a functions change.
 *
 *  ★ Compared with the project's SAVED list, `ws.features`; an absent list is the legacy all-on default
 *   (`sanitizeFeatures(undefined)`), which is what `useFeaturesSync` mirrors for such a project. */
export function describeFunctionsCall(
  call: ProposedCall,
  ws: Workspace,
): { functions?: FunctionsChange; plan: EditPlan } | null {
  if (!carriesEnabledModules(call)) return null;
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [] };
  let judged: ReturnType<typeof judgeEnabledModules>;
  try {
    judged = judgeEnabledModules(call.input[FIELD]);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    plan.rejected.push({ toolName: call.name, reason: "bad-input", detail, field: FIELD });
    return { plan };
  }
  const saved = new Set(sanitizeFeatures(ws.features));
  const next = new Set(judged.features);
  return {
    plan,
    functions: {
      on: ALL_MODULE_IDS.filter((id) => next.has(id) && !saved.has(id)),
      off: ALL_MODULE_IDS.filter((id) => saved.has(id) && !next.has(id)),
      dropped: judged.dropped,
    },
  };
}
