// The single import routine for a portable theme JSON, shared by the theme
// gallery's file picker and the scheme editor's file picker.
//
// It exists because those two diverged: the gallery carried dark + structural
// onto the created scheme while the editor called addScheme alone, silently
// degrading a full portable theme (light + dark + structural) to light-only.
// One routine, so they cannot drift again — and dup:check is blocking, so the
// second call site could not have copied it anyway.
import { importScheme, addScheme, updateScheme, loadSchemes, type ColorScheme } from "./color-schemes";
import { upsertSchemeAsync } from "./color-schemes-store";
import type { TursoConfig } from "./turso-config";

/**
 * Parse `text` as a portable theme and add it to the user library.
 *
 * Returns the id of the scheme to activate, or `null` when the text is not a
 * valid theme. Never throws.
 *
 * Name-dedup: re-importing a theme whose name already exists in the library
 * activates the existing scheme rather than creating a second identical copy.
 * The existing scheme is still upserted, which covers a file-mode import later
 * reopened with Turso configured.
 */
export async function importSchemeText(
  text: string,
  config: TursoConfig | null,
): Promise<string | null> {
  const parsed = importScheme(text);
  if (!parsed) return null;

  const existing = loadSchemes().schemes.find((s) => !s.builtIn && s.name === parsed.name);
  if (existing) {
    await upsertSchemeAsync(config, existing);
    return existing.id;
  }

  let store = addScheme(parsed.name, parsed.light, parsed.branding);
  const newId = store.activeId;
  if (!newId) return null;

  // addScheme creates a COLOR-ONLY scheme — carry over the rest of the portable
  // format. Dropping this is the exact bug this module was extracted to kill.
  if (parsed.supportsDark || parsed.dark || parsed.structural) {
    store = updateScheme(newId, {
      supportsDark: parsed.supportsDark,
      dark: parsed.dark,
      structural: parsed.structural,
    });
  }

  const created: ColorScheme | undefined = store.schemes.find((s) => s.id === newId);
  if (created) await upsertSchemeAsync(config, created);
  return newId;
}
