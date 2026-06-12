import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useWorkspace } from "./workspace-context";
import type { Settings } from "./settings-types";

/**
 * Keep the reactive `settings.features` synced to the current project's
 * `Workspace.features`. This is the bridge that makes per-project feature
 * modules (and mode changes) reactive without a page reload: the 45 consumers
 * read `settings.features`, while the per-project source of truth lives on the
 * workspace. When the active project changes (or its mode is committed),
 * `Workspace.features` updates and this effect mirrors it into settings.
 *
 * Undefined (legacy project / no override) leaves `settings.features` untouched.
 */
export function useFeaturesSync(setSettings: Dispatch<SetStateAction<Settings>>): void {
  const { features } = useWorkspace();
  useEffect(() => {
    if (features === undefined) return;
    // Cross-store sync: mirror the workspace's per-project features into the
    // reactive settings store. Guarded by an identity check so we never queue a
    // redundant update (and therefore never loop).
    setSettings((s) =>
      s.features === features ? s : { ...s, features: [...features] },
    );
  }, [features, setSettings]);
}
