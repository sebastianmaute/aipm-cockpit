import type { Lang, t } from "./i18n";
import type { ProjectsRegistry } from "./projects-registry";
import type { Settings } from "./settings-types";
import type { StorageConfig, StorageKind } from "./storage";
import type { ToastAction } from "./use-toast";

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
  // ★ `activityLog`/`setActivityLog` were args until the log became workspace
  // data — the hook now reads BOTH from `useWorkspace()`, so there is ONE
  // source. Re-adding them here would let the broadcast and the save see
  // different arrays.
  showToast: (kind: "info" | "error" | "success", text: string) => void;
  /** ★ The literal union rather than `ToastKind`, matching `showToast` above —
   *  the two args are read side by side and a lone alias reads as a difference. */
  showToastAction: (kind: "info" | "error" | "success", text: string, action: ToastAction) => void;
  /** Reveals a dismissed saving-paused banner. The refusal toast points here
   *  rather than carrying the destructive action itself.
   *
   *  ★★★ REQUIRED, and deliberately so. A consumer omitting it would get a refusal
   *  toast whose ONLY button silently did nothing, with every gate green: this is
   *  the sole route from the transient toast back to the persistent banner, so
   *  the omission leaves a paused save with no recourse the user can find. That
   *  is the same shape as the defect the banner exists to remove — a recourse
   *  that appears to exist and does not — so it is made unrepresentable rather
   *  than documented. A REQUIRED field is not by itself proof the action calls
   *  it (a required prop nothing invokes still typechecks); that half is pinned
   *  by "announces a refusal with an action toast ONCE, not again on each
   *  re-refusal" in `use-storage-backend.test.tsx`. */
  onRevealSavingPaused: () => void;
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
