import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useWorkspace } from "./workspace-context";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import type { Settings } from "./settings-types";

function sameFeatureSet(
  a: readonly FeatureModuleId[],
  b: readonly FeatureModuleId[],
): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

/**
 * Keep the reactive `settings.features` synced to the current project's
 * `Workspace.features`. This is the bridge that makes per-project feature
 * modules (and mode changes) reactive without a page reload: the 45 consumers
 * read `settings.features`, while the per-project source of truth lives on the
 * workspace. When the active project changes (or its mode is committed),
 * `Workspace.features` updates and this effect mirrors it into settings.
 *
 * Undefined (legacy project / no per-project override) resets the reactive
 * mirror to the all-modules DEFAULT so a legacy project never inherits the
 * previous project's set (portfolio leak). This touches `settings.features`
 * only — it never writes back onto the legacy project's `Workspace.features`,
 * which stays undefined.
 */
export function useFeaturesSync(setSettings: Dispatch<SetStateAction<Settings>>): void {
  const { features } = useWorkspace();
  useEffect(() => {
    const target = features ?? ALL_MODULE_IDS;
    // Cross-store sync: mirror the workspace's per-project features (or the
    // all-modules default for legacy projects) into the reactive settings store.
    // Guarded by a set-equality check so we never queue a redundant update
    // (and therefore never loop).
    setSettings((s) =>
      sameFeatureSet(s.features, target) ? s : { ...s, features: [...target] },
    );
  }, [features, setSettings]);
}
