import type { ActivityEntry } from "./activity-log";
import type { Lang, t } from "./i18n";
import type { ProjectsRegistry } from "./projects-registry";
import type { Settings } from "./settings-types";
import type { StorageConfig, StorageKind } from "./storage";

// The argument shape and the static label map for `useStorageBackend`, moved out
// verbatim so the hook itself stays under the 800-line ratchet. No behaviour
// lives here — this file is types plus one frozen lookup.

// Hoisted to module scope — static map, no per-render allocation
export const STORAGE_LABEL_KEYS: Record<StorageKind, Parameters<typeof t>[1]> = {
  browser: "storageBrowser",
  "local-json": "storageLocalJson",
  "local-csv": "storageLocalCsv",
  "local-md": "storageLocalMd",
  "sp-json": "storageSpJson",
  "sp-csv": "storageSpCsv",
  turso: "storageTurso",
};

export interface UseStorageBackendArgs {
  settings: Settings;
  lang: Lang;
  hydrated: boolean;
  /** True when this window was opened as a popout (`?popout=<tab>`). A popout is
   *  a mirror: it receives live state, forwards nothing, and must NOT persist.
   *  ★ Claimed popouts "forward their own edits via BroadcastChannel" until 2026-08-06. */
  isPopout: boolean;
  activityLog: ActivityEntry[];
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  showToast: (kind: "info" | "error" | "success", text: string) => void;
  setStorageConfig: (config: StorageConfig) => void;
  /** Reports the outcome of a load/save so the caller can drive the storage
   *  status bubble + banner. `null` = success (clear any error); an error value
   *  is classified (see storage-error.ts). */
  onStorageOutcome?: (err: unknown | null) => void;
  /** Notifies the caller after the projects registry is persisted (switch /
   *  create / load-from-file). Lets task-manager keep an observable copy of the
   *  registry in React state so the switcher list, empty-state gate, and Projects
   *  panel re-render. Receives the freshly-saved registry. */
  onRegistryChange?: (registry: ProjectsRegistry) => void;
}
