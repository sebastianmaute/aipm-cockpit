"use client";

// Theme library: load a portable theme JSON from disk, then apply, customise or
// remove it. AIPM and Dashboard no longer ship with the app in any form — a theme
// is whatever file the user supplies, so this surface is a file picker plus the
// list of what has been loaded.
//
// Presentational apart from the import itself: the scheme list, the active id
// and the apply/remove handlers are props, owned by AppearanceSection (which
// already holds useColorSchemes).

import { useRef, useState, type ChangeEvent } from "react";
import { type Lang, t } from "./i18n";
import type { ColorScheme } from "./color-schemes";
import { importSchemeText } from "./scheme-import";
import type { TursoConfig } from "./turso-config";
import { Button } from "./button";
import { Card } from "./card";
import { FieldError } from "./field-feedback";

interface ThemeGalleryProps {
  lang: Lang;
  /** The full scheme store list; built-ins are filtered out here. */
  schemes: readonly ColorScheme[];
  /** Turso config → persist the imported scheme to the cross-device DB too (else
   *  the localStorage sync-cache only). Optional (defaults null) for file mode +
   *  tests. */
  config?: TursoConfig | null;
  /** Called with the scheme id after a successful import (parent applies it). */
  onImported: (newId: string) => void;
  onRemove: (id: string) => void;
}

export function ThemeGallery({
  lang, schemes, config = null, onImported, onRemove,
}: ThemeGalleryProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const userSchemes = schemes.filter((s) => !s.builtIn);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      void importSchemeText(String(reader.result), config)
        .then((newId) => {
          if (!newId) { setError(t(lang, "themeGalleryImportError")); return; }
          onImported(newId);
        })
        .finally(() => setBusy(false));
    };
    reader.onerror = () => { setError(t(lang, "themeGalleryImportError")); setBusy(false); };
    reader.readAsText(file);
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t(lang, "themeGalleryHeading")}</p>
      <p className="text-xs text-muted-foreground">{t(lang, "themeGalleryHint")}</p>

      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {t(lang, "themeGalleryLoadFile")}
        </Button>
        {/* The Button is the control; this input is only its file dialog. It stays
            sr-only rather than hidden (a display:none input can't be clicked in
            every browser), so it needs tabIndex -1 + aria-hidden or it is a SECOND
            tab stop announcing the same name as the Button above it. */}
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>

      {userSchemes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(lang, "themeGalleryEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {userSchemes.map((s) => (
            <Card
              as="li"
              key={s.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.name}</span>
              {/* Row control carries the scheme NAME: N rows with an identical
                  "Remove" would be a WCAG 2.4.6 fail the axe gate cannot see
                  (it reports missing names, never duplicate ones). */}
              <Button
                variant="ghost"
                size="xs"
                aria-label={t(lang, "themeGalleryRemove", s.name)}
                onClick={() => onRemove(s.id)}
              >
                {t(lang, "themeGalleryRemove", s.name)}
              </Button>
            </Card>
          ))}
        </ul>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}
