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
import type { SettingsUpdateInput } from "./chat-tools";
import { computeSettingsPatch, judgeEnabledModules } from "./chat-settings-patch";
import { ALL_MODULE_IDS, sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import type { EditPlan } from "./inline-ai-edit/plan";
import { defaultSettings } from "./settings-types";

const FIELD = "enabledModules";

/** What a staged functions change does to the project, in registry order. */
export interface FunctionsChange {
  readonly on: readonly FeatureModuleId[];
  readonly off: readonly FeatureModuleId[];
  /** Ids the write will ignore, as its `droppedModules` reports them. */
  readonly dropped: readonly string[];
  /** The saved list this row was described against: the project's at staging, or the list an earlier
   *  functions row in the same plan leaves. Apply refuses the row as a conflict if the live list moved. */
  readonly before: readonly FeatureModuleId[];
  /** The list the write stores. */
  readonly after: readonly FeatureModuleId[];
  /** Every OTHER setting the same call changes, as the write accepts it (`computeSettingsPatch`'s
   *  `applied`), key and new value. The card lists them so a "Project functions" row hides nothing. */
  readonly others: readonly { readonly key: string; readonly value: string }[];
}

/** A settings value as one readable token: an object (`nextActionsWeights`) as its `key value` pairs. */
function settingText(value: unknown): string {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k} ${String(v)}`).join(", ");
  }
  return String(value);
}

/** What the write would apply for a settings patch, against the live settings it patches
 *  (`ToolDispatcher.previewSettings`). */
export type PreviewSettings = (patch: SettingsUpdateInput) => Record<string, unknown>;

/** The call's settings other than `enabledModules`, judged by the write's own patch against the LIVE settings (`preview`):
 *  `nextActionsWeights` keeps the current value for a weight its coercer refuses, so a preview against
 *  the defaults would show a value the write never stores. Without `preview` (a unit test's opt-out;
 *  `chat-panel.tsx` always passes it) it falls back to `defaultSettings`. */
export function previewedSettings(input: Readonly<Record<string, unknown>>, preview: PreviewSettings | undefined): FunctionsChange["others"] {
  const rest = Object.fromEntries(Object.entries(input).filter(([k]) => k !== FIELD)) as SettingsUpdateInput;
  if (Object.keys(rest).length === 0) return [];
  const applied = preview !== undefined ? preview(rest) : computeSettingsPatch(rest, defaultSettings).applied;
  return Object.entries(applied).map(([key, value]) => ({ key, value: settingText(value) }));
}

/** The row's functions change and plan, or null for any call that is not a functions change.
 *
 *  ★ Compared with `baseline`, a SAVED list: `describeProposal` passes the project's `ws.features` for
 *   the first functions row and the previous row's `after` for each later one. An absent list is the
 *   legacy all-on default (`sanitizeFeatures(undefined)`), which is what `useFeaturesSync` mirrors. */
export function describeFunctionsCall(
  call: ProposedCall,
  baseline: readonly FeatureModuleId[] | undefined,
  preview?: PreviewSettings,
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
  const before = sanitizeFeatures(baseline);
  const saved = new Set(before);
  const next = new Set(judged.features);
  return {
    plan,
    functions: {
      on: ALL_MODULE_IDS.filter((id) => next.has(id) && !saved.has(id)),
      off: ALL_MODULE_IDS.filter((id) => saved.has(id) && !next.has(id)),
      dropped: judged.dropped,
      before,
      after: judged.features,
      others: previewedSettings(call.input, preview),
    },
  };
}
