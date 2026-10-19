// The portfolio switch's commit and reload, shared by the Settings section's "Save & switch" and the
// setup wizard's Finish (§715 D2). Re-exported by `settings-sections/integrations-section.tsx`.
import { hasUnsealedPassphraseSecret, hasUnsealedPassphraseToken } from "./turso-token-marker";
import { tokenSealsSettled } from "./turso-token-seals";
import { savePortfolioMode, type PortfolioMode } from "./portfolio-mode";
import { writeSettings } from "./use-settings";
import { sealSettingsUntilReload } from "./settings-reload-seal";
import { loadRegistry } from "./projects-registry";
import { defaultStorageConfig } from "./workspace";
import type { Settings } from "./settings-types";

/** §749 — the Claude key was typed under its passphrase lock and no seal covers it yet, so a reload (which
 *  blanks it, `writeSettings`) would bring back the OLD record or none. Every reload path refuses on it. */
export function aiKeyHeldUnsealed(settings: Settings): boolean {
  return hasUnsealedPassphraseSecret("anthropicApiKey", settings.ai?.apiKey);
}

/** Commits a portfolio switch and reloads onto it: this section's "Save & switch", and the setup
 *  wizard's Finish when the switch was picked on its storage step (§715 D2 — the wizard unmounts this
 *  section on the next step, so the choice used to be dropped). `base` is the settings to persist
 *  (with any Turso drafts already folded in). Resolves `false` — nothing written, no reload — when
 *  the durability gate below refuses, or `ownSealRefuses` does after the wait; `true` once the
 *  reload is under way. */
export async function commitPortfolioModeSwitch(
  base: Settings,
  mode: PortfolioMode,
  ownSealRefuses?: () => boolean,
): Promise<boolean> {
  // ★★★ A RELOAD BEFORE THE SEAL SETTLES LOSES THE TOKEN: `writeSettings` blanks it, so the
  // device-sealed copy is the only one that survives. Wait for every in-flight seal (this
  // switch's, an Apply's or a keystroke commit's — possibly from an instance a hold already
  // remounted away), bounded by `tokenSealsSettled`. No wait — not even a yield — when nothing is
  // in flight.
  const seals = tokenSealsSettled();
  if (seals) await seals;
  // ★★ §715 — THE DURABILITY GATE, shared with `migrateCurrentProjectToTurso`: a token committed in
  //   passphrase mode that no seal covers (none started, or it failed or timed out) is lost to the
  //   reload, so refuse — `false`, nothing written — and let the caller say how to save it.
  if (hasUnsealedPassphraseToken(base.integrations?.turso?.authToken)) return false;
  if (aiKeyHeldUnsealed(base)) return false; // §749 — the same gate for the Claude key; the caller says how to save it
  // The caller's own seal of a token the marker does not hold (a draft on Turso storage), read after
  // the same single wait.
  if (ownSealRefuses?.()) return false;
  savePortfolioMode(mode);
  // Keep the workspace storage backend aligned with the portfolio: switching TO
  // Turso must also persist storageConfig.kind "turso" (synchronously, so it
  // survives the reload), or the backend memo rebuilds a file/browser backend
  // and the workspace keeps loading the local file while the project list +
  // snapshots talk to Turso. (portfolioMode === "turso" ⟺ storageConfig "turso".)
  if (mode === "turso") {
    writeSettings({ ...base, storageConfig: { kind: "turso" } });
  } else if (base.storageConfig?.kind === "turso") {
    // Leaving Turso for the File portfolio: a leftover "turso" storageConfig
    // would keep the backend memo pointed at Turso after reload (no file-mode
    // bootstrap reconciles it), stranding the user. Restore the File portfolio's
    // current-project backend config (registry is its source of truth), or the
    // browser default if none.
    const reg = loadRegistry();
    const current = reg.projects.find((p) => p.id === reg.currentProjectId);
    writeSettings({ ...base, storageConfig: current?.storageConfig ?? defaultStorageConfig });
  } else {
    writeSettings(base);
  }
  sealSettingsUntilReload(); // §740 — no stale persist-effect write may land before the reload
  window.location.reload();
  return true;
}
