"use client";

// Theme gallery: import shipped AIPM/Dashboard themes as removable USER schemes.
// Phase 2 moved AIPM + Mockup out of the built-in seed for fresh installs (which
// now show only Harbor/Meridian/Umber); this gallery re-introduces them on
// demand by fetching the portable /themes/*.json files and importing them
// through the same color-scheme pipeline (importScheme → addScheme +
// updateScheme). Imported schemes are ordinary deletable user schemes.

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { importScheme, addScheme, updateScheme } from "./color-schemes";
import { upsertSchemeAsync } from "./color-schemes-store";
import type { TursoConfig } from "./turso-config";
import { Button } from "./button";

interface ShippedTheme {
  id: string;
  name: string;
  file: string;
}

const SHIPPED: readonly ShippedTheme[] = [
  { id: "AIPM", name: "AIPM", file: "/themes/AIPM.json" },
  { id: "mockup", name: "Dashboard", file: "/themes/mockup.json" },
];

interface ThemeGalleryProps {
  lang: Lang;
  /** Turso config → persist the imported scheme to the cross-device DB too (else
   *  the localStorage sync-cache only). Optional (defaults null) for file mode +
   *  tests. */
  config?: TursoConfig | null;
  /** Called with the new user-scheme id after a successful import (parent applies it). */
  onImported: (newId: string) => void;
}

export function ThemeGallery({ lang, config = null, onImported }: ThemeGalleryProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importTheme(theme: ShippedTheme) {
    setBusy(theme.id);
    setError(null);
    try {
      const res = await fetch(theme.file);
      if (!res.ok) throw new Error("fetch");
      const parsed = importScheme(await res.text());
      if (!parsed) throw new Error("parse");
      let store = addScheme(parsed.name, parsed.light, parsed.branding);
      const newId = store.activeId;
      if (!newId) throw new Error("add");
      // addScheme creates a color-only scheme; carry over dark + structural.
      if (parsed.supportsDark || parsed.dark || parsed.structural) {
        store = updateScheme(newId, {
          supportsDark: parsed.supportsDark,
          dark: parsed.dark,
          structural: parsed.structural,
        });
      }
      // Persist to the cross-device DB when Turso is configured (mirrors the
      // editor). Without this the import lives only in the localStorage cache and
      // the next DB refresh drops it, orphaning activeId -> Harbor. No-op in file
      // mode (upsertSchemeAsync early-returns on null config).
      const created = store.schemes.find((s) => s.id === newId);
      if (created) await upsertSchemeAsync(config, created);
      onImported(newId);
    } catch {
      setError(t(lang, "themeGalleryImportError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t(lang, "themeGalleryHeading")}</p>
      <p className="text-xs text-muted-foreground">{t(lang, "themeGalleryHint")}</p>
      <div className="flex flex-wrap gap-2">
        {SHIPPED.map((th) => (
          <Button
            key={th.id}
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => importTheme(th)}
            aria-label={t(lang, "themeGalleryImport", th.name)}
          >
            {t(lang, "themeGalleryImport", th.name)}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-AIPM-pink-strong">{error}</p>}
    </div>
  );
}
