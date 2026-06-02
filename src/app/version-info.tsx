"use client";

// Shared version/highlights body rendered by both the VersionMenu popover (in
// the action menus) and the VersionInfoModal (opened from the sidebar version
// line and the Settings footer). Single source of truth for the "about" panel.

import { useEffect } from "react";
import { type Lang, t } from "./i18n";
import {
  APP_BUILD_DATE,
  APP_HIGHLIGHT_KEYS,
  APP_REPO_URL,
  APP_VERSION_LABEL,
} from "./version";

/** Centered modal wrapping VersionInfo, opened from the sidebar version line
 *  and the Settings footer. Controlled: parent owns the open boolean. */
export function VersionInfoModal({
  lang,
  open,
  onClose,
}: {
  lang: Lang;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, "version")}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-4"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(lang, "version")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue dark:text-muted-foreground dark:hover:text-AIPM-light-grey"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
        <VersionInfo lang={lang} />
      </div>
    </div>
  );
}

export function VersionInfo({ lang }: { lang: Lang }) {
  return (
    <>
      <p className="text-base font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {t(lang, "appTitle")}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <Row term={t(lang, "versionVersion")} value={APP_VERSION_LABEL} />
        <Row term={t(lang, "versionBuild")} value={APP_BUILD_DATE} />
      </dl>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(lang, "versionHighlightsHeader")}
      </p>
      <ul className="mt-1.5 space-y-1 text-xs text-foreground">
        {APP_HIGHLIGHT_KEYS.map((k) => (
          <li key={k} className="flex gap-2">
            <span aria-hidden className="mt-0.5 text-AIPM-green">
              •
            </span>
            <span>{t(lang, k)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-foreground">
        {t(lang, "versionTechStack")}
      </p>
      <div className="mt-4 border-t border-line pt-3 text-xs italic text-muted-foreground">
        <a
          href={APP_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium not-italic text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
        >
          Acme ↗
        </a>{" "}
        — Identity Excellence Delivered. Globally.
      </div>
    </>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {term}
      </dt>
      <dd className="font-mono text-foreground dark:text-AIPM-light-grey">
        {value}
      </dd>
    </div>
  );
}
