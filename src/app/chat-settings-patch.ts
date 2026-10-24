// Pure settings-patch computation for the AI `update_settings` tool. Extracted
// from use-chat-dispatcher so the hook stays under the 800-line ratchet and so
// the validation is unit-testable without React. No refs, no setters, no clock.
import { ALL_MODULE_IDS, sanitizeFeatures } from "./feature-modules";
import {
  NEXT_ACTIONS_FIELD_COERCE,
  resolveNextActionsConfig,
  type NextActionsConfig,
  type Settings,
} from "./settings-types";
import type { SettingsUpdateInput } from "./chat-tools";

export interface SettingsPatchResult {
  /** Only the CHANGED top-level fields, so the caller's functional setter merges
   *  onto the live `prev` and a concurrent non-AI edit keeps its own fields. */
  changes: Partial<Settings>;
  /** What to report back to the model as actually applied. Keys mirror
   *  `SettingsUpdateInput`'s tool-facing names, not `Settings`' internal
   *  ones (e.g. `enabledModules`/`nextActionsWeights` vs `features`/
   *  `nextActions`) — the model gets back an echo of what it asked for. */
  applied: Record<string, unknown>;
}

export function computeSettingsPatch(
  patch: SettingsUpdateInput,
  cur: Settings,
): SettingsPatchResult {
  // Accumulate ONLY the changed top-level fields, so the functional setter
  // below merges them onto the LIVE `prev` — a concurrent non-AI settings
  // edit in the same tick keeps its own fields instead of being clobbered.
  const changes: Partial<Settings> = {};
  const applied: Record<string, unknown> = {};

  if (patch.dashboardDensity === "comfortable" || patch.dashboardDensity === "compact") {
    changes.dashboardDensity = patch.dashboardDensity;
    applied.dashboardDensity = patch.dashboardDensity;
  }
  if (typeof patch.showViewHints === "boolean") {
    changes.showViewHints = patch.showViewHints;
    applied.showViewHints = patch.showViewHints;
  }
  if (
    patch.tasksViewMode === "table" ||
    patch.tasksViewMode === "board" ||
    patch.tasksViewMode === "swimlane"
  ) {
    changes.tasksViewMode = patch.tasksViewMode;
    applied.tasksViewMode = patch.tasksViewMode;
  }
  if (typeof patch.hideExternalTasks === "boolean") {
    changes.hideExternalTasks = patch.hideExternalTasks;
    applied.hideExternalTasks = patch.hideExternalTasks;
  }
  if (patch.enabledModules !== undefined) {
    // ★ §779 — the list is the PROJECT's saved functions now, so a value that would only read as
    // "switch everything off" is refused (the caller writes nothing) instead of sanitised to []:
    // `sanitizeFeatures` turns a non-array into [] and drops every unknown id. `[]` itself stays
    // allowed (it is the Simple preset, `deriveMode`), and a list mixing known and unknown ids keeps
    // the known ones, which `applied` echoes back to the model.
    const raw: unknown = patch.enabledModules;
    if (!Array.isArray(raw)) throw new Error("enabledModules must be a list of module ids");
    const feats = sanitizeFeatures(raw);
    if (raw.length > 0 && feats.length === 0) {
      throw new Error(`enabledModules names no known module: ${raw.map(String).join(", ")}; known ids: ${ALL_MODULE_IDS.join(", ")}`);
    }
    changes.features = feats;
    applied.enabledModules = feats;
  }
  if (patch.nextActionsWeights && typeof patch.nextActionsWeights === "object") {
    const curCfg = resolveNextActionsConfig(cur.nextActions);
    const cfg: NextActionsConfig = { ...curCfg };
    const appliedWeights: Record<string, number> = {};
    for (const [k, v] of Object.entries(patch.nextActionsWeights as Record<string, unknown>)) {
      // Only known tuning fields, each clamped by its own coercer — the
      // SAME validators the settings UI uses. Unknown keys are ignored.
      if (Object.prototype.hasOwnProperty.call(NEXT_ACTIONS_FIELD_COERCE, k)) {
        const key = k as keyof NextActionsConfig;
        const coerced = NEXT_ACTIONS_FIELD_COERCE[key](v, curCfg[key]);
        cfg[key] = coerced;
        appliedWeights[k] = coerced;
      }
    }
    if (Object.keys(appliedWeights).length > 0) {
      changes.nextActions = cfg;
      applied.nextActionsWeights = appliedWeights;
    }
  }

  return { changes, applied };
}
